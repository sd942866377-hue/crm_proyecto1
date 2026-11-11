// Control-plane API — glue so the hosted control plane (app.forjabots.com)
// can poll this self-hosted bot and push its tier. Mounted at /api from
// index.ts. Every route is guarded (fail-closed Bearer via requireControlPlane).
import { Hono } from "hono";
import type { Env } from "./env";
import { channelStatuses } from "./admin/views/conexiones";
import { businessLocation } from "./businessContext";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { requireControlPlane } from "./http-auth";
import { SETTING_VALIDATORS, isNeverWritable, readSuperpowers } from "./settings-mutations";
import { bustTierCache, effectiveTier } from "./tier";
import { BOT_VERSION } from "./version";
import { composioEnabled, listConnectedTools, getComposioContext } from "./integrations/composio";
import { inboxApi } from "./api-inbox";
import { maintenanceApi } from "./api-maintenance";
import { pauseState, type PausedMode } from "./lib/pause-state";
import { NOT_TEST_CONV, NOT_TEST_REF, NOT_TEST_REF_NULLABLE } from "./db/testFilter";
import { maskContact } from "./lib/mask";
import { applyBudgetGuard, monthIaCostUsd, monthStartMs } from "./budget";
import { monthIaBreakdown } from "./db/ia-usage";
import { DEFAULT_MONTHLY_BUDGET_USD } from "./settings-loader";
import { isPro } from "./config";
import { LEAD_STATUSES, leadMetadata } from "./db/leads";
import { decodeCursor, encodeCursor } from "./lib/cursor";

/** Centavos: el dinero viaja redondeado, no con la cola binaria del float. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const apiApp = new Hono<{ Bindings: Env }>();

// Pausa global del bot (Contrato v3.2 §6). La implementación vive en
// lib/pause-state.ts; se re-exporta aquí porque este ES el módulo público de la
// API del control plane.
export { pauseState, type PausedMode };

// Fail-closed Bearer guard on the whole sub-app (same pattern as /admin, /funnels).
apiApp.use("*", async (c, next) => {
  if (!requireControlPlane(c.req.raw, c.env)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  await next();
});

// Inbox móvil (Forja Inbox): /api/conversations*, /api/admin-link. Montado
// DESPUÉS del guard, así hereda el mismo Bearer fail-closed.
apiApp.route("/", inboxApi);

// Centro de Mantenimiento (v3.3): /api/maintenance, /api/tickets*. Mismo
// montaje, mismo guard. Import diferido en el módulo para no cruzar el ciclo
// con pauseState (api-maintenance lo importa de aquí).
apiApp.route("/", maintenanceApi);

// GET /api/health → liveness + identity. Reporta el tier EFECTIVO (override
// del control plane incluido), no el var estático — es la verdad del bot.
apiApp.get("/health", async (c) =>
  c.json({ ok: true, version: BOT_VERSION, tier: await effectiveTier(c.env) }, 200),
);

// GET /api/config → resumen de configuración para el panel de la nube (Fase 1
// del contrato): negocio, nicho, idioma, canales conectados (estado, JAMÁS
// secrets) y pausa. Con esto app.forjabots.com muestra la interfaz completa
// del bot apenas el onboarding termina.
apiApp.get("/config", async (c) => {
  const db = new Db(c.env.DB);
  const settings = new SettingsRepo(db);
  const [botNameOverride, paused, brandStyleOverride, allS, openTickets] = await Promise.all([
    settings.get(SETTING_KEYS.botName),
    settings.get(SETTING_KEYS.botPaused),
    settings.get(SETTING_KEYS.brandStyle),
    settings.all(),
    // Pendientes abiertos (v3.3 §3): un COUNT sobre el índice de status, para
    // que la lista de bots de la app pinte el badge sin pedir el mantenimiento
    // completo de cada bot.
    db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tickets WHERE status != 'resolved' AND ${NOT_TEST_REF_NULLABLE}`,
    ),
  ]);
  // Pausa efectiva = switch manual O pausa temporal vigente (mismo OR que
  // settings-loader). paused_until viaja para que la nube muestre "hasta cuándo".
  const pausa = pauseState(paused, allS[SETTING_KEYS.botPausedUntil]);

  // Estado EFECTIVO de cada superpoder (defaults como en admin/views/config.ts):
  // Cazador y Blindaje vienen ON (se apagan con "0"/"off"); el resto default OFF
  // (on = "1"). Misma tabla que usa el Centro de Mantenimiento — ver
  // settings-mutations.ts.
  const superpowers = readSuperpowers(allS);
  const channels = channelStatuses(c.env).map((ch) => ({
    id: ch.id,
    name: ch.name,
    connected: ch.ok,
  }));

  // Composio: solo estado/config para el panel de la nube — NUNCA la API key
  // del miembro ni ningún otro secret (ver src/integrations/composio.ts).
  const composioIsEnabled = composioEnabled(c.env);
  const [composioTools, composioContext] = composioIsEnabled
    ? await Promise.all([listConnectedTools(c.env), getComposioContext(c.env)])
    : [[], {}];
  const composio = {
    enabled: composioIsEnabled,
    toolkits: [...new Set(composioTools.map((t) => t.toolkitSlug))],
    context: composioContext,
  };

  return c.json(
    {
      ok: true,
      business: c.env.BUSINESS_NAME ?? "",
      // Ubicación del negocio (member/config.local, la MISMA que el bot ve en su
      // business context). La pinta la pantalla "¿Este es tu negocio?" del
      // onboarding del dueño. null si el onboarding no la capturó.
      address: businessLocation(),
      bot_name: botNameOverride || c.env.BOT_NAME || "",
      niche: c.env.BOT_NICHE || "generico",
      language: c.env.BOT_LANGUAGE || "es",
      channels,
      channels_connected: channels.filter((ch) => ch.connected).length,
      channels_total: channels.length,
      paused: pausa.paused,
      paused_until: pausa.paused_until,
      // Aditivo (v3.2): con qué modo está apagado — la app distingue "hasta que
      // lo prenda" de "hasta las 18:00" sin adivinar por el timestamp.
      paused_mode: pausa.paused_mode,
      // Valores actuales de los controles remotos del panel de agencia (los
      // settings ya eran escribibles vía /api/settings; esto solo los LEE).
      tone: allS[SETTING_KEYS.tone] ?? "",
      bot_language: allS[SETTING_KEYS.botLanguage] ?? "",
      bot_currency: allS[SETTING_KEYS.botCurrency] ?? "",
      brand_style: (brandStyleOverride || c.env.BRAND_STYLE || "").trim(), // estilo del panel efectivo (nimbus|onyx|terra|"")
      superpowers, // estado on/off de los superpoderes (Centro de Mantenimiento)
      // Cuántos pendientes tiene el dueño esperándolo (§3): el badge de la app.
      open_tickets: openTickets?.n ?? 0,
      // Dominio canónico del panel (modo DOMINIO de /whitelabel): "" si el
      // miembro no fijó DASHBOARD_BASE_URL. forja-cloud lo prefiere sobre la
      // workers.dev para pintar las puertas (/equipo, /admin) del bot.
      panel_url: (c.env.DASHBOARD_BASE_URL ?? "").trim().replace(/\/+$/, ""),
      version: BOT_VERSION,
      tier: await effectiveTier(c.env),
      composio,
    },
    200,
  );
});

// GET /api/leads?limit=20 → leads recientes para la Bandeja de clientes del
// control plane (Forja+). PRINCIPIO DE PRIVACIDAD: la nube LEE en vivo, no
// almacena. Devolvemos lo justo para la bandeja (nombre, canal, intención,
// estado, cuándo, nota corta) — el contenido completo de la conversación NUNCA
// sale del bot; para eso está el panel /admin del propio bot.
const LEADS_LIMIT_MAX = 100;

apiApp.get("/leads", async (c) => {
  const raw = Number.parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), LEADS_LIMIT_MAX) : 20;

  // Dominio REAL del status (db/leads.ts, el mismo del panel): un slug
  // inventado devolvería lista vacía y parecería "no hay interesados".
  const status = (c.req.query("status") ?? "").trim();
  if (status && !(LEAD_STATUSES as readonly string[]).includes(status)) {
    return c.json({ ok: false, error: "invalid_status" }, 400);
  }

  // OJO con el filtro del chat de prueba: conversation_id es NULLABLE en leads
  // (ON DELETE SET NULL), así que va la variante nullable-safe o se pierden los
  // leads sin conversación — ver db/testFilter.ts.
  const conds: string[] = [NOT_TEST_REF_NULLABLE];
  const params: (string | number)[] = [];
  if (status) {
    conds.push("status = ?");
    params.push(status);
  }
  const cursor = decodeCursor(c.req.query("cursor"));
  if (cursor) {
    conds.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor[0], cursor[0], cursor[1]);
  }

  const rows = await new Db(c.env.DB).all<{
    id: string; conversation_id: string | null; name: string | null; contact: string | null;
    channel_user_id: string | null; intent: string; notes: string | null; status: string | null;
    metadata: string | null; created_at: number; updated_at: number;
  }>(
    `SELECT id, conversation_id, name, contact, channel_user_id, intent, notes, status,
            metadata, created_at, updated_at
       FROM leads
      WHERE ${conds.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    [...params, limit + 1],
  );

  const page = rows.slice(0, limit);
  const leads = page.map((r) => {
    const campos = leadMetadata(r);
    return {
      id: r.id,
      name: r.name || "Cliente",
      // contacto enmascarado: suficiente para reconocerlo, sin volcar el dato entero.
      contact_hint: maskContact(r.contact),
      intent: r.intent,
      status: r.status || "new",
      notes: (r.notes || "").slice(0, 140),
      created_at: r.created_at,
      updated_at: r.updated_at,
      // Con esto la app abre el hilo desde la fila del interesado.
      conversation_id: r.conversation_id,
      // El id de conversación ES `${channel}:${channelUserId}` (makeConvId).
      channel: r.conversation_id ? r.conversation_id.split(":")[0] : null,
      // Campos propios del giro (fecha de la cita, modelo del coche…). null
      // cuando no hay ninguno: la app no pinta una sección vacía.
      metadata: Object.keys(campos).length ? campos : null,
    };
  });

  const last = page[page.length - 1];
  const next_cursor = rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null;
  return c.json({ ok: true, leads, count: leads.length, next_cursor }, 200);
});

/** Tope de la pausa temporal: 30 días. Más que eso es "apagarlo", no pausarlo. */
const MAX_PAUSE_MS = 30 * 24 * 60 * 60 * 1000;

// POST /api/pause {until} — apagar/prender el bot desde la app (Contrato v3.2 §6):
//   · <epochMs>  → pausa con hora de término ("1 hora", "hasta mañana 9:00")
//   · "manual"   → apagado hasta que el dueño lo prenda
//   · null       → prendido
// Escribe los MISMOS settings que ya lee settings-loader (bot_paused /
// bot_paused_until), así que no hay una segunda fuente de verdad de la pausa.
apiApp.post("/pause", async (c) => {
  let body: { until?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const repo = new SettingsRepo(new Db(c.env.DB));
  const now = Date.now();
  const until = body.until;
  let untilSetting = "";
  let pausedSetting = "0";

  if (until === "manual") {
    pausedSetting = "1";
  } else if (typeof until === "number") {
    if (!Number.isInteger(until) || until <= now || until > now + MAX_PAUSE_MS) {
      return c.json({ ok: false, error: "invalid_until" }, 400);
    }
    untilSetting = String(until);
    // El switch manual se APAGA a propósito: la pausa efectiva es un OR, así que
    // un bot_paused="1" viejo volvería eterna una pausa que sí tiene fin.
  } else if (until !== null) {
    return c.json({ ok: false, error: "invalid_until" }, 400);
  }

  await repo.set(SETTING_KEYS.botPaused, pausedSetting);
  await repo.set(SETTING_KEYS.botPausedUntil, untilSetting);
  return c.json({ ok: true, ...pauseState(pausedSetting, untilSetting, now) }, 200);
});

// GET /api/cost → gasto de IA del mes (Contrato v3.2 §7). Los mismos números de
// la tab Costos del panel: costo real por tokens, tope del dueño (default $25),
// proyección de fin de mes y el veredicto del guard de presupuesto. Gate free —
// saber cuánto gasta su propia llave no puede costar.
apiApp.get("/cost", async (c) => {
  const db = new Db(c.env.DB);
  const now = Date.now();
  const monthUsd = await monthIaCostUsd(db, now);

  // Desglose por función desde la libreta (ia_usage). `ledger_usd` es el total
  // REAL — TODAS las funciones (conversación + follow-ups + insights + copilot +
  // reportes + flywheel + blindaje), con caché-creation a 1.25×. `month_usd`
  // (arriba) sigue siendo el número del guard (solo conversación, de `messages`)
  // por compatibilidad. En bots recién actualizados el desglose arranca vacío y
  // se llena solo desde su primera llamada.
  const breakdown = await monthIaBreakdown(db, now);
  const ledgerUsd = breakdown.reduce((s, r) => s + (r.cost_usd ?? 0), 0);

  // Mismo default que settings-loader: sin setting = $25; "0" = sin tope.
  const raw = ((await new SettingsRepo(db).get(SETTING_KEYS.monthlyBudget)) ?? "").trim();
  const budgetIsDefault = raw === "";
  const parsed = budgetIsDefault ? DEFAULT_MONTHLY_BUDGET_USD : Number.parseFloat(raw);
  const budgetUsd = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  // Proyección lineal: lo gastado por día × los días del mes (igual que la tab
  // Costos). El mes se mide en UTC, como monthStartMs.
  const d = new Date(now);
  const dayOfMonth = d.getUTCDate();
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = dayOfMonth > 0 ? (monthUsd / dayOfMonth) * daysInMonth : 0;

  const guard = applyBudgetGuard("smart", monthUsd, budgetUsd ?? undefined);
  return c.json(
    {
      ok: true,
      month_usd: round2(monthUsd),
      budget_usd: budgetUsd,
      budget_is_default: budgetIsDefault,
      // Tope al 100% porque la app lo pinta como barra; que se haya pasado ya
      // lo dicen downgraded / hard_stop.
      pct: budgetUsd ? Math.min(100, Math.round((monthUsd / budgetUsd) * 100)) : null,
      projected_usd: round2(projected),
      downgraded: guard.downgraded,
      hard_stop: guard.stop,
      month_start: monthStartMs(now),
      currency: "USD",
      // Total real (todas las funciones) + desglose. Aditivo: la app puede
      // mostrar el desglose sin tocar los campos de arriba.
      ledger_usd: round2(ledgerUsd),
      breakdown: breakdown.map((r) => ({
        fn: r.fn,
        cost_usd: round2(r.cost_usd ?? 0),
        calls: r.calls ?? 0,
      })),
    },
    200,
  );
});

// GET /api/report/latest → el reporte del día para la app (Contrato v3.2 §9).
// Sirve el último que generó el cron (persistido como DATOS, sin HTML); con
// ?fresh=1 arma uno al vuelo SIN persistirlo — gasta una llamada de IA, igual
// que el ?preview=1 del panel. Forja+: el reporte diseñado es superpoder Pro.
apiApp.get("/report/latest", async (c) => {
  if (!isPro(c.env)) return c.json({ ok: false, error: "pro_required" }, 403);

  const { buildReport, reportMarkdown, reportSnapshot } = await import("./owner/report/build");

  if (c.req.query("fresh") === "1") {
    const now = Date.now();
    const snap = reportSnapshot(await buildReport(c.env, now), now);
    return c.json({ ok: true, report: snap, body_markdown: reportMarkdown(snap, c.env.BUSINESS_NAME) }, 200);
  }

  const raw = await new SettingsRepo(new Db(c.env.DB)).get(SETTING_KEYS.reportLastJson);
  if (!raw) return c.json({ ok: false, error: "no_report" }, 404);
  let report: unknown;
  try {
    report = JSON.parse(raw);
  } catch {
    // Setting corrupto: para la app es lo mismo que no tener reporte todavía.
    return c.json({ ok: false, error: "no_report" }, 404);
  }

  // El markdown NO se persiste (sería el mismo texto dos veces en D1): se arma
  // desde el snapshot, que es todo lo que el renderer necesita.
  const snap = report as import("./owner/report/build").ReportSnapshot;
  return c.json({ ok: true, report: snap, body_markdown: reportMarkdown(snap, c.env.BUSINESS_NAME) }, 200);
});

// POST /api/tier {tier:"pro"|"free"} → el control plane sube/baja el tier en
// caliente (al activar Forja+, o al expirar). Persiste en settings y aplica al
// siguiente request (cache 30s por isolate; este isolate aplica al instante).
apiApp.post("/tier", async (c) => {
  let body: { tier?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const tier = body.tier;
  if (tier !== "pro" && tier !== "free") {
    return c.json({ ok: false, error: "invalid_tier" }, 400);
  }
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.tierOverride, tier);
  bustTierCache(tier);
  c.env.BOT_TIER = tier;
  return c.json({ ok: true, tier }, 200);
});

// POST /api/settings {settings:{key:value,…}} → la agencia cambia settings
// permitidos EN CALIENTE (sin redeploy, sin tocar el wrangler.toml del cliente).
// FAIL-CLOSED: un key sin validador, uno de la lista negra (§6 del contrato) o
// un valor fuera de forma se rechazan. Guarded por el Bearer del sub-app
// (requireControlPlane). La tabla de validadores vive en settings-mutations.ts,
// compartida con el Centro de Mantenimiento de la app.
apiApp.post("/settings", async (c) => {
  let body: { settings?: Record<string, unknown> } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const incoming = body.settings ?? {};
  const repo = new SettingsRepo(new Db(c.env.DB));
  const applied: string[] = [];
  const rejected: string[] = [];
  for (const [key, raw] of Object.entries(incoming)) {
    const validate = SETTING_VALIDATORS[key];
    const val = String(raw ?? "").trim();
    if (isNeverWritable(key) || !validate || !validate(val)) {
      rejected.push(key); // key prohibido, sin validador, O valor fuera de forma
      continue;
    }
    await repo.set(key, val);
    applied.push(key);
  }
  return c.json({ ok: true, applied, rejected }, 200);
});

export type MetricsRange = "7d" | "30d" | "all";

/** Window start (ms epoch) for a range. "all" = 0 (no lower bound). */
export function sinceForRange(range: MetricsRange, now: number): number {
  if (range === "all") return 0;
  const days = range === "30d" ? 30 : 7; // default / fallback = 7d
  return now - days * 24 * 60 * 60 * 1000;
}

/** Normalize the ?range query param to a supported value (default 7d). */
export function parseRange(raw: string | undefined): MetricsRange {
  return raw === "30d" || raw === "all" ? raw : "7d";
}

export interface MetricsResponse {
  range: MetricsRange;
  leads: number;
  messages: number;
  conversations: number;
  health_score: number;
}

/**
 * Aggregate the bot's activity over the requested window from the real D1
 * tables (schema.sql):
 *   leads          = COUNT(leads)          created_at >= since
 *   messages       = COUNT(messages)       created_at >= since
 *   conversations  = COUNT(conversations)  last_message_at >= since (active in window)
 *
 * health_score (0–100): the share of in-window conversations that did NOT get
 * escalated to a human — i.e. never opened a handoff ticket (the tickets table
 * is written only on handoffHuman). 100 = nobody had to be escalated; lower =
 * more conversations needed a human. escalated is clamped to [0, conversations]
 * so the ratio stays in range, and with zero conversations we report 100
 * (no traffic ≠ unhealthy).
 */
export async function computeMetrics(
  db: Db,
  range: MetricsRange,
  now = Date.now(),
): Promise<MetricsResponse> {
  const since = sinceForRange(range, now);

  // El chat de prueba de la app (canal `test`) no es tráfico del negocio y no
  // cuenta en ninguna métrica — ver src/db/testFilter.ts.
  const leads =
    (await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND ${NOT_TEST_REF_NULLABLE}`,
      [since],
    ))?.n ?? 0;
  const messages =
    (await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM messages WHERE created_at >= ? AND ${NOT_TEST_REF}`,
      [since],
    ))?.n ?? 0;
  const conversations =
    (await db.first<{ n: number }>(
      `SELECT COUNT(*) AS n FROM conversations WHERE last_message_at >= ? AND ${NOT_TEST_CONV}`,
      [since],
    ))?.n ?? 0;

  // Distinct conversations that opened a handoff ticket in the window.
  const escalatedRaw =
    (await db.first<{ n: number }>(
      `SELECT COUNT(DISTINCT conversation_id) AS n FROM tickets
        WHERE conversation_id IS NOT NULL AND created_at >= ? AND ${NOT_TEST_REF}`,
      [since],
    ))?.n ?? 0;

  const escalated = Math.min(escalatedRaw, conversations);
  const healthScore =
    conversations === 0
      ? 100
      : Math.max(0, Math.min(100, Math.round(((conversations - escalated) / conversations) * 100)));

  return { range, leads, messages, conversations, health_score: healthScore };
}

// GET /api/metrics?range=7d|30d|all → aggregates for the control-plane dashboard.
apiApp.get("/metrics", async (c) => {
  const range = parseRange(c.req.query("range"));
  const metrics = await computeMetrics(new Db(c.env.DB), range);
  return c.json(metrics, 200);
});
