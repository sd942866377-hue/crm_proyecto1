/**
 * Centro de Mantenimiento (Contrato v3.3) — lo que el revendedor/instalador
 * puede revisar y cambiar del bot DESDE LA APP, y los "Pendientes" (tickets).
 * Sub-app montada bajo /api desde api.ts: hereda el guard fail-closed del
 * control plane (Bearer CONTROL_PLANE_TOKEN).
 *
 * REGLA (§6): SOLO settings que ya existen, reversibles al instante y validados
 * por el propio bot. NADA que pueda tumbarlo — ni deploy, ni secrets, ni prompt
 * override, ni KB, ni canales. La lista negra y la tabla de validadores viven en
 * settings-mutations.ts, COMPARTIDAS con POST /api/settings y con el panel: si
 * un valor no lo aceptaría el panel, aquí tampoco.
 *
 * Nada de esto aplica en caliente a una conversación en curso: el agente relee
 * settings.all() en el siguiente mensaje. Por eso la app dice "aplica en la
 * próxima conversación" y no promete un efecto inmediato.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { TicketsRepo } from "./db/tickets";
import { MessagesRepo } from "./db/messages";
import { channelStatuses } from "./admin/views/conexiones";
import { monthIaCostUsd } from "./budget";
import { DEFAULT_MONTHLY_BUDGET_USD, normalizeModelOverride } from "./settings-loader";
import { describeModel, providerReady, PROVIDERS } from "./llm/model-info";
import type { LlmProvider } from "./llm/provider";
import { effectiveTier } from "./tier";
import { isPro } from "./config";
import { BOT_VERSION } from "./version";
import { pauseState } from "./lib/pause-state";
import {
  CUSTOM_INSTRUCTIONS_MAX,
  SETTING_VALIDATORS,
  SUPERPOWERS_PRO,
  findSuperpower,
  isNeverWritable,
  readSuperpowers,
  superpowerValue,
} from "./settings-mutations";
import { superpowerConfig, superpowersMeta } from "./lib/superpower-config";
import { nicheSchedulesAppointments } from "./niches";
import { ownerText, withOwnerText } from "./voice-blocks";
import { esCodigoValido, bustIdiomaCache, ESPEJO } from "./idioma";
import { LAST_ALERT_KEY } from "./watchdog";
import { maskContact } from "./lib/mask";
import { auditApp, readActor } from "./lib/actor";
import { decodeCursor, encodeCursor } from "./lib/cursor";
import { NOT_TEST_REF_NULLABLE, notTestConv, notTestRefNullable } from "./db/testFilter";

export const maintenanceApi = new Hono<{ Bindings: Env }>();

/** Centavos: el dinero viaja redondeado, no con la cola binaria del float. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── GET /api/maintenance (§1) ────────────────────────────────────────────────

/** Alertas más viejas que esto ya no son "recientes": no sirven para decidir. */
const ALERTS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const ALERTS_MAX = 10;

const RISK_TEXT: Record<string, string> = {
  "cliente molesto": "se quedó molesto en una conversación",
  "venta en riesgo": "dejó una venta abierta sin cerrar",
};

interface MaintenanceAlert {
  id: string;
  kind: string;
  text: string;
  created_at: number;
  resolved: boolean;
}

/**
 * Últimas alertas: las de riesgo del Vigilante (`risk_alerts`) más la de salud
 * del watchdog (que no tiene tabla propia, solo su marca de tiempo en settings).
 * Solo lectura — resolverlas no es una acción de la app, por eso `resolved`
 * viaja siempre en false. Tolerante: un bot sin la tabla devuelve la lista sin
 * las de riesgo en vez de reventar la pantalla entera.
 */
async function recentAlerts(
  db: Db,
  all: Record<string, string>,
  now: number,
): Promise<MaintenanceAlert[]> {
  const since = now - ALERTS_WINDOW_MS;
  const out: MaintenanceAlert[] = [];

  try {
    const rows = await db.all<{
      conversation_id: string;
      reason: string;
      sent_at: number;
      display_name: string | null;
      channel_user_id: string | null;
    }>(
      `SELECT ra.conversation_id, ra.reason, ra.sent_at, c.display_name, c.channel_user_id
         FROM risk_alerts ra
         LEFT JOIN conversations c ON c.id = ra.conversation_id
        WHERE ra.sent_at >= ? AND (c.channel IS NULL OR ${notTestConv("c")})
        ORDER BY ra.sent_at DESC
        LIMIT ?`,
      [since, ALERTS_MAX],
    );
    for (const r of rows) {
      const quien = r.display_name || maskContact(r.channel_user_id) || "Un cliente";
      out.push({
        id: r.conversation_id,
        kind: "risk",
        text: `${quien} ${RISK_TEXT[r.reason] ?? r.reason}`,
        created_at: r.sent_at,
        resolved: false,
      });
    }
  } catch {
    /* bot sin risk_alerts (schema viejo) → solo las de salud */
  }

  const watchdogAt = Number.parseInt(all[LAST_ALERT_KEY] ?? "", 10) || 0;
  if (watchdogAt >= since) {
    out.push({
      id: "watchdog",
      kind: "watchdog",
      text: "El bot encadenó respuestas fallidas — revisa tu proveedor de IA (límites o llave).",
      created_at: watchdogAt,
      resolved: false,
    });
  }

  return out.sort((a, b) => b.created_at - a.created_at).slice(0, ALERTS_MAX);
}

/**
 * Idioma que la app puede pintar Y volver a mandar en el PATCH: siempre uno de
 * los valores válidos. Un bot instalado con "es-MX" en su wrangler.toml cae a
 * "es-419" con la MISMA regla de idioma.ts (todo español que no es de España es
 * latino), así que guardar la pantalla nunca lo deja hablando raro.
 */
export function idiomaVisible(raw: string | undefined, envLanguage: string | undefined): string {
  const v = (raw ?? "").trim();
  if (v === ESPEJO || esCodigoValido(v)) return v;
  const base = (envLanguage ?? "").trim();
  if (esCodigoValido(base)) return base;
  const bajo = base.toLowerCase();
  if (bajo.startsWith("pt")) return "pt-BR";
  if (bajo.startsWith("en")) return "en";
  return "es-419";
}

async function buildMaintenance(c: Context<{ Bindings: Env }>) {
  const db = new Db(c.env.DB);
  const now = Date.now();
  const [all, tier, monthUsd] = await Promise.all([
    new SettingsRepo(db).all(),
    effectiveTier(c.env),
    monthIaCostUsd(db, now),
  ]);

  const pausa = pauseState(all[SETTING_KEYS.botPaused], all[SETTING_KEYS.botPausedUntil], now);

  // Tope de gasto: "" = default del bot ($25); "0" = sin tope. Misma lectura
  // que settings-loader y que la tab Costos.
  const rawBudget = (all[SETTING_KEYS.monthlyBudget] ?? "").trim();
  const budgetIsDefault = rawBudget === "";
  const parsedBudget = budgetIsDefault ? DEFAULT_MONTHLY_BUDGET_USD : Number.parseFloat(rawBudget);
  const monthlyUsd = Number.isFinite(parsedBudget) && parsedBudget > 0 ? round2(parsedBudget) : 0;

  const openTickets =
    (
      await db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM tickets WHERE status != 'resolved' AND ${NOT_TEST_REF_NULLABLE}`,
      )
    )?.n ?? 0;

  return {
    ok: true,
    bot: {
      name: all[SETTING_KEYS.botName] || c.env.BOT_NAME || "",
      version: BOT_VERSION,
      tier,
      language: idiomaVisible(all[SETTING_KEYS.botLanguage], c.env.BOT_LANGUAGE),
      // "" = sin símbolo elegido (el bot no fuerza moneda), igual que el panel.
      currency: all[SETTING_KEYS.botCurrency] ?? "",
      paused: pausa.paused,
      paused_mode: pausa.paused_mode,
    },
    brain: { model_override: normalizeModelOverride(all[SETTING_KEYS.modelOverride]) },
    // Modelo REAL + costo por bot (Agencia §1): proveedor/modelo efectivos,
    // precio por MTok y picker de proveedores con candados. month_usd repite el
    // de budget por conveniencia (mismo número).
    model: describeModel(c.env, all, round2(monthUsd)),
    budget: {
      monthly_usd: monthlyUsd, // 0 = sin tope
      is_default: budgetIsDefault,
      month_usd: round2(monthUsd),
      // Tope al 100% porque la app lo pinta como barra; null cuando no hay tope.
      pct: monthlyUsd > 0 ? Math.min(100, Math.round((monthUsd / monthlyUsd) * 100)) : null,
    },
    superpowers: readSuperpowers(all),
    // Estado de configuración por superpoder (§1): honestidad de toggles —
    // los que necesitan setup (Cobros→Stripe, Bóveda→R2, Reseñas→link,
    // Reenganche→plantilla) no se prenden "en falso". Calculado EN VIVO.
    superpowers_meta: superpowersMeta(c.env, all),
    superpowers_pro: SUPERPOWERS_PRO,
    // Agenda de citas (§5), SOLO lectura: distingue el "Horario de atención"
    // (informativo) de la agenda real. enabled = el nicho agenda citas;
    // provider = "calcom" si el dueño puso la llave de Cal.com.
    scheduling: {
      enabled: nicheSchedulesAppointments(c.env),
      provider: c.env.CALCOM_API_KEY ? ("calcom" as const) : null,
    },
    // El texto del dueño SIN los bloques que administra "Cómo habla".
    custom_instructions: ownerText(all[SETTING_KEYS.customInstructions] ?? ""),
    channels: channelStatuses(c.env).map((ch) => ({ id: ch.id, name: ch.name, connected: ch.ok })),
    alerts: await recentAlerts(db, all, now),
    tickets: { open: openTickets },
  };
}

maintenanceApi.get("/maintenance", async (c) => c.json(await buildMaintenance(c), 200));

// ── PATCH /api/maintenance (§2) ──────────────────────────────────────────────

/**
 * Body parcial y ESTRICTO: una llave que no esté aquí se rechaza sola (zod
 * strict). Es la primera de las dos rejas — la segunda es el validador del
 * propio bot, el MISMO de POST /api/settings (settings-mutations.ts).
 */
const patchSchema = z
  .object({
    name: z.string().min(1).max(60),
    language: z.enum(["es-419", "es-ES", "en", "pt-BR", "espejo"]),
    currency: z.string().max(4),
    model_override: z.enum(["auto", "haiku", "sonnet"]),
    // Proveedor de IA (Agencia §2). "" = Automático (default del env). Los 4
    // concretos se validan contra "hay llave" (si no → 409 más abajo).
    provider: z.enum(["anthropic", "openai", "xai", "google", ""]),
    monthly_usd: z.number().min(0).max(1000),
    superpowers: z.record(z.string(), z.boolean()),
    custom_instructions: z.string().max(CUSTOM_INSTRUCTIONS_MAX),
  })
  .partial()
  .strict();

/** Un cambio pedido, ya traducido a "qué setting y con qué valor". `field` es
 *  el nombre del CONTRATO (el que la app conoce): el `detail` de un 400 tiene
 *  que decirle a la pantalla cuál de sus campos rechazó el bot, no un key
 *  interno de D1 que la app nunca vio. */
interface PendingSet {
  field: string;
  key: string;
  /** Lo que se guarda. */
  value: string;
  /** Lo que se VALIDA, cuando no es lo mismo que se guarda (custom_instructions
   *  se guarda con los bloques gestionados pegados, pero lo que el dueño puede
   *  escribir —y lo que se le mide— es solo su texto). */
  check?: string;
}

const bad = (c: Context<{ Bindings: Env }>, detail: string) =>
  c.json({ ok: false, error: "invalid_field", detail }, 400);

maintenanceApi.patch("/maintenance", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Una llave fuera del contrato no tiene `path`: el nombre viene en `keys`.
    const unknownKey =
      issue?.code === "unrecognized_keys" ? (issue as { keys?: string[] }).keys?.[0] : undefined;
    return bad(c, unknownKey || issue?.path?.join(".") || "body");
  }
  const body = parsed.data;

  const pending: PendingSet[] = [];
  const cambios: string[] = [];

  // Cambio de proveedor de IA (Agencia §2). NO pasa por la reja genérica —
  // llm_provider es NEVER_WRITABLE ahí a propósito; aquí se valida con la MISMA
  // regla "hay llave" del picker (providerReady) y se escribe directo, igual que
  // el panel. Se resuelve ANTES de escribir nada: un 409 no deja a medias.
  let providerToWrite: string | null = null;
  if (body.provider !== undefined) {
    const v = body.provider.trim().toLowerCase();
    if (v === "") {
      providerToWrite = ""; // Automático — siempre ok (cae al default del env).
    } else {
      if (!(PROVIDERS as readonly string[]).includes(v)) return bad(c, "provider");
      const snapshot = await new SettingsRepo(new Db(c.env.DB)).all();
      if (!providerReady(c.env, snapshot, v as LlmProvider)) {
        return c.json({ ok: false, error: "provider_not_configured", detail: v }, 409);
      }
      providerToWrite = v;
    }
    cambios.push(`proveedor=${providerToWrite || "auto"}`);
  }

  if (body.name !== undefined) {
    pending.push({ field: "name", key: SETTING_KEYS.botName, value: body.name.trim() });
    cambios.push("nombre");
  }
  if (body.language !== undefined) {
    // "Espeja al cliente" es el superpoder Multi-idioma con otro nombre: en free
    // el bot no lo corre (settings-loader), así que el panel solo lo ofrece en
    // Pro y aquí se responde igual que un toggle bloqueado.
    if (body.language === ESPEJO && !isPro(c.env)) {
      return c.json({ ok: false, error: "pro_required", detail: ESPEJO }, 403);
    }
    pending.push({ field: "language", key: SETTING_KEYS.botLanguage, value: body.language });
    cambios.push("idioma");
  }
  if (body.currency !== undefined) {
    pending.push({ field: "currency", key: SETTING_KEYS.botCurrency, value: body.currency.trim() });
    cambios.push("moneda");
  }
  if (body.model_override !== undefined) {
    pending.push({
      field: "model_override",
      key: SETTING_KEYS.modelOverride,
      value: body.model_override,
    });
    cambios.push("cerebro");
  }
  if (body.monthly_usd !== undefined) {
    // 0 = sin tope explícito (settings-loader lo lee así). Se guarda redondeado
    // a centavos para no meter la cola binaria del float en un setting de texto.
    pending.push({
      field: "monthly_usd",
      key: SETTING_KEYS.monthlyBudget,
      value: String(round2(body.monthly_usd)),
    });
    cambios.push("presupuesto");
  }

  if (body.superpowers !== undefined) {
    // Estado de configuración en vivo — solo hace falta leer settings si se
    // intenta PRENDER algo (apagar nunca se bloquea, §2).
    const wantsOn = Object.values(body.superpowers).some((v) => v === true);
    const liveSettings = wantsOn
      ? await new SettingsRepo(new Db(c.env.DB)).all()
      : {};
    for (const [id, on] of Object.entries(body.superpowers)) {
      const def = findSuperpower(id);
      if (!def) return bad(c, `superpowers.${id}`);
      // El gate lo pone el BOT, no la nube: en free el superpoder ni corre.
      if (def.pro && !isPro(c.env)) {
        return c.json({ ok: false, error: "pro_required", detail: id }, 403);
      }
      // Segunda disciplina (§2): prender un superpoder que necesita setup y no lo
      // tiene → 409. Aunque la UI fallara, el backend no deja "activar" algo roto.
      // Apagar (`false`) SIEMPRE se permite; los `configurable:false` no aplican.
      if (on) {
        const meta = superpowerConfig(def.id, c.env, liveSettings);
        if (meta.configurable && meta.configured === false) {
          return c.json(
            { ok: false, error: "not_configured", detail: id, needs: meta.needs ?? [], hint: meta.hint },
            409,
          );
        }
      }
      pending.push({
        field: `superpowers.${id}`,
        key: def.key,
        value: superpowerValue(def, on),
      });
      cambios.push(`${id}=${on ? "on" : "off"}`);
    }
  }

  // custom_instructions se resuelve contra lo que HAY (para preservar los
  // bloques gestionados), así que necesita leer el setting antes de escribir.
  const db = new Db(c.env.DB);
  const settings = new SettingsRepo(db);
  if (body.custom_instructions !== undefined) {
    const actual = (await settings.get(SETTING_KEYS.customInstructions)) ?? "";
    const next = withOwnerText(actual, body.custom_instructions);
    pending.push({
      field: "custom_instructions",
      key: SETTING_KEYS.customInstructions,
      value: next,
      check: body.custom_instructions,
    });
    cambios.push("instrucciones");
  }

  // Un PATCH que no pide ningún cambio real (body vacío, o un `superpowers: {}`)
  // no es un guardado: es un error de la app. Cambiar solo el proveedor SÍ es un
  // cambio real aunque `pending` quede vacío.
  if (pending.length === 0 && providerToWrite === null) return bad(c, "body");

  // Segunda reja: el validador del propio bot, el mismo del panel/POST
  // /api/settings. Se corre sobre TODO antes de escribir NADA — un patch
  // inválido no deja la mitad aplicada.
  for (const { field, key, value, check } of pending) {
    const validate = SETTING_VALIDATORS[key];
    if (isNeverWritable(key) || !validate || !validate(check ?? value)) return bad(c, field);
  }

  for (const { key, value } of pending) await settings.set(key, value);
  // Proveedor de IA: escritura directa (fuera de la reja genérica), ya validado.
  if (providerToWrite !== null) await settings.set(SETTING_KEYS.llmProvider, providerToWrite);

  // El caché de idioma vive por isolate y dura 30s: sin esto el dueño guarda,
  // prueba enseguida y parece que no funcionó (mismo bust que el panel).
  if (body.language !== undefined) bustIdiomaCache();

  await auditApp(db, readActor(c), "mantenimiento_editado", cambios.join(", ").slice(0, 300));

  return c.json(await buildMaintenance(c), 200);
});

// ── Pendientes / tickets (§4) ────────────────────────────────────────────────

const TICKETS_LIMIT_MAX = 50;
const RESOLVE_NOTE_MAX = 500;

interface TicketRow {
  id: string;
  conversation_id: string | null;
  category: string | null;
  summary: string | null;
  status: string | null;
  created_at: number;
  resolved_at: number | null;
  display_name: string | null;
  channel_user_id: string | null;
}

/** Fila de ticket como la pinta la app: nombre enmascarado igual que la bandeja
 *  y canal derivado del id de conversación (`${channel}:${channelUserId}`). */
function ticketJson(r: TicketRow) {
  return {
    id: r.id,
    conversation_id: r.conversation_id,
    name: r.display_name || maskContact(r.channel_user_id) || "Cliente",
    channel: r.conversation_id ? r.conversation_id.split(":")[0] : null,
    reason: r.summary ?? "",
    category: r.category ?? "",
    status: r.status === "resolved" ? "resolved" : "open",
    created_at: r.created_at,
    resolved_at: r.resolved_at,
  };
}

const TICKET_SELECT = `SELECT t.id, t.conversation_id, t.category, t.summary, t.status,
         t.created_at, t.resolved_at, c.display_name, c.channel_user_id
    FROM tickets t
    LEFT JOIN conversations c ON c.id = t.conversation_id`;

// GET /api/tickets?status=open|resolved|all&limit&cursor
maintenanceApi.get("/tickets", async (c) => {
  const status = c.req.query("status") ?? "open";
  if (status !== "open" && status !== "resolved" && status !== "all") {
    return c.json({ ok: false, error: "invalid_status" }, 400);
  }
  const rawLimit = Number.parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), TICKETS_LIMIT_MAX) : 20;

  // `in_progress` cuenta como abierto: es el MISMO criterio del panel y del
  // filtro "Te necesita" de la bandeja (status != 'resolved').
  const conds: string[] = [notTestRefNullable("t.conversation_id")];
  const params: (string | number)[] = [];
  if (status === "open") conds.push("t.status != 'resolved'");
  else if (status === "resolved") conds.push("t.status = 'resolved'");

  const cursor = decodeCursor(c.req.query("cursor"));
  if (cursor) {
    conds.push("(t.created_at < ? OR (t.created_at = ? AND t.id < ?))");
    params.push(cursor[0], cursor[0], cursor[1]);
  }

  const rows = await new Db(c.env.DB).all<TicketRow>(
    `${TICKET_SELECT}
      WHERE ${conds.join(" AND ")}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ?`,
    [...params, limit + 1],
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return c.json(
    {
      ok: true,
      tickets: page.map(ticketJson),
      next_cursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    },
    200,
  );
});

// POST /api/tickets/:id/resolve {note?} — lo MISMO que resolver desde el panel
// (tickets.resolve), y si viene nota se guarda como nota interna del hilo: es
// donde el dueño la va a buscar mañana, no en una columna que nadie lee.
maintenanceApi.post("/tickets/:id/resolve", async (c) => {
  let body: { note?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {}; // sin cuerpo = resolver sin nota
  }
  const note = String(body.note ?? "").trim();
  if (note.length > RESOLVE_NOTE_MAX) return c.json({ ok: false, error: "invalid_note" }, 400);

  const db = new Db(c.env.DB);
  const repo = new TicketsRepo(db);
  const id = c.req.param("id");
  const ticket = await repo.getById(id);
  if (!ticket) return c.json({ ok: false, error: "not_found" }, 404);

  const actor = readActor(c);
  // `resolved_by` es la misma columna que llena el panel; el "(app)" dice de
  // dónde vino, igual que en la bitácora.
  await repo.resolve(id, actor ? `${actor.name} (app)` : "app");

  if (note && ticket.conversation_id) {
    await new MessagesRepo(db).append(ticket.conversation_id, "note", note);
  }

  const row = await db.first<TicketRow>(`${TICKET_SELECT} WHERE t.id = ?`, [id]);
  await auditApp(db, actor, "ticket_resuelto", `${id}${note ? " (con nota)" : ""}`);
  return c.json({ ok: true, ticket: row ? ticketJson(row) : null }, 200);
});
