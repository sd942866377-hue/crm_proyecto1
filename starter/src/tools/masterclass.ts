// Tools de MODO EVENTO/MASTERCLASS — extras opcionales del template.
// Solo se registran si la instancia define las env vars EVENT_* (ver
// hasMasterclassMode). El bot demo / instalaciones normales no cambian.
//
//   eventInfo          — fecha, countdown y links oficiales del evento (exactos)
//   trackedLink        — link de trackeo por conversación (/l/:code) para medir
//                        quién se registra/une desde WhatsApp
//   registerMasterclass— registro conversacional: manda el lead al webhook de
//                        la plataforma (Convex) sin sacar al cliente del chat
import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";
import { MessagesRepo } from "../db/messages";
import { pickAdapter, sendChunkedReply } from "../replies/sender";
import { selfOrigin } from "../lib/self-origin";
import type { ChannelId } from "../channels/shared";

/** El modo evento se enciende con EVENT_REGISTER_URL (mínimo indispensable). */
export function hasMasterclassMode(env: Env): boolean {
  return Boolean(env.EVENT_REGISTER_URL && env.EVENT_REGISTER_URL.trim() !== "");
}

// ── eventInfo ───────────────────────────────────────────────────────────────

const CDMX = "America/Mexico_City";

function fmtCdmx(ms: number): string {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: CDMX,
  }).format(new Date(ms));
}

export function eventInfoTool(env: Env) {
  return tool({
    description:
      "Datos EXACTOS del evento/masterclass: fecha y hora (CDMX), cuánto falta, si ya está en vivo o ya pasó, y los links oficiales (registro, grupo, oferta). Úsalo SIEMPRE que pregunten cuándo es, cuánto falta o pidan un link — nunca los inventes.",
    inputSchema: z.object({}),
    execute: async () => {
      const startsAt = Date.parse(env.EVENT_STARTS_AT ?? "");
      const durationMin = Number.parseInt(env.EVENT_DURATION_MIN ?? "120", 10) || 120;
      const now = Date.now();

      let cuando = "fecha por anunciar";
      let estado = "proximamente";
      if (!Number.isNaN(startsAt)) {
        cuando = `${fmtCdmx(startsAt)} (hora de Ciudad de México)`;
        const endsAt = startsAt + durationMin * 60_000;
        if (now < startsAt) {
          const mins = Math.round((startsAt - now) / 60_000);
          const d = Math.floor(mins / 1440);
          const h = Math.floor((mins % 1440) / 60);
          const m = mins % 60;
          estado = `faltan ${d > 0 ? `${d} día(s), ` : ""}${h} hora(s) y ${m} minuto(s)`;
        } else if (now <= endsAt) {
          estado = "¡ESTÁ EN VIVO AHORA MISMO!";
        } else {
          estado = "ya terminó (el replay dura 48 horas desde que acabó)";
        }
      }

      return {
        nombre: env.EVENT_NAME ?? "la masterclass",
        cuando,
        estado,
        registro_url: env.EVENT_REGISTER_URL ?? null,
        grupo_whatsapp_url: env.EVENT_GROUP_URL ?? null,
        oferta_url: env.EVENT_OFFER_URL ?? null,
        nota: "Para compartir un link al cliente usa trackedLink (genera el link de trackeo); estos son los destinos base.",
      };
    },
  });
}

// ── Fases del evento ────────────────────────────────────────────────────────

export type EventPhase = "pre" | "live" | "today_post" | "replay" | "over";

/** Cierre de bonos: 11:59pm CDMX del día del evento (CDMX = UTC-6 fijo, sin
 *  DST desde 2022). null si no hay fecha configurada. */
export function bonosDeadlineMs(env: Env): number | null {
  const startsAt = Date.parse(env.EVENT_STARTS_AT ?? "");
  if (Number.isNaN(startsAt)) return null;
  const cdmx = new Date(startsAt - 6 * 3600_000);
  return (
    Date.UTC(cdmx.getUTCFullYear(), cdmx.getUTCMonth(), cdmx.getUTCDate(), 23, 59, 59) +
    6 * 3600_000
  );
}

/** Fase actual del evento: antes / EN VIVO / mismo día post-clase (bonos hasta
 *  11:59pm CDMX) / ventana de replay 48h / terminado. */
export function eventPhase(env: Env, now = Date.now()): EventPhase {
  const startsAt = Date.parse(env.EVENT_STARTS_AT ?? "");
  if (Number.isNaN(startsAt)) return "pre";
  const durationMin = Number.parseInt(env.EVENT_DURATION_MIN ?? "120", 10) || 120;
  const endsAt = startsAt + durationMin * 60_000;
  if (now < startsAt) return "pre";
  if (now <= endsAt) return "live";
  const endOfDay = bonosDeadlineMs(env)!;
  if (now <= endOfDay) return "today_post";
  if (now <= endsAt + 48 * 3600_000) return "replay";
  return "over";
}

// ── trackedLink ─────────────────────────────────────────────────────────────

export type LinkTarget = "registro" | "grupo" | "oferta" | "recursos";

export function targetUrlFor(env: Env, target: LinkTarget): string | null {
  if (target === "registro") return env.EVENT_REGISTER_URL ?? null;
  if (target === "grupo") return env.EVENT_GROUP_URL ?? null;
  if (target === "recursos") return env.EVENT_RESOURCES_URL ?? null;
  return env.EVENT_OFFER_URL ?? null;
}

function randomCode(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789"; // sin caracteres ambiguos
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/** Crea o reutiliza el link trackeado de una conversación hacia un destino. */
export async function ensureTrackedLink(
  env: Env,
  conversationId: string,
  target: LinkTarget,
): Promise<string | null> {
  const targetUrl = targetUrlFor(env, target);
  if (!targetUrl) return null;
  const db = new Db(env.DB);
  const existing = await db.first<{ code: string }>(
    "SELECT code FROM tracked_links WHERE conversation_id = ? AND target = ?",
    [conversationId, target],
  );
  let code = existing?.code;
  if (!code) {
    code = randomCode();
    await db.run(
      `INSERT INTO tracked_links (code, conversation_id, target, target_url, created_at, clicks)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [code, conversationId, target, targetUrl, Date.now()],
    );
  }
  const base = await selfOrigin(env);
  return `${base}/l/${code}`;
}

export function trackedLinkTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Genera el LINK personal de trackeo para este cliente (registro, grupo de WhatsApp, oferta del evento o recursos). SIEMPRE que vayas a compartir uno de esos links, genera el suyo con esta tool en vez de pegar la URL base — así el dueño sabe quién llegó desde WhatsApp.",
    inputSchema: z.object({
      target: z
        .enum(["registro", "grupo", "oferta", "recursos"])
        .describe("registro = apartar lugar · grupo = grupo de WhatsApp · oferta = página de la OFERTA del evento (solo se comparte el día de la masterclass, NO es para unirse a la comunidad) · recursos = materiales del evento"),
    }),
    execute: async ({ target }) => {
      // Candado servidor: la página de la oferta NO es pública antes del día
      // del evento. Aunque el prompt falle, este link no puede salir antes.
      if (target === "oferta" && eventPhase(env) === "pre") {
        return {
          error:
            "La oferta aún NO es pública — se abre el día de la masterclass. " +
            "Si quiere unirse a la comunidad, comparte https://horizontesia.com (sin tool).",
        };
      }
      const url = await ensureTrackedLink(env, getConversationId() ?? "sin-conv", target);
      if (!url) {
        return { error: `No hay URL configurada para "${target}". Comparte otra opción o escala.` };
      }
      return { url, target };
    },
  });
}

// ── Keywords instantáneas (QUIERO / RECURSOS / REGISTRO) ─────────────────────
// Respuesta FIJA al segundo, sin pasar por el LLM: una keyword del cierre en
// vivo merece respuesta garantizada e inmediata. Además cuenta cada hit para
// el embudo (tabla keyword_hits) y entrega el link trackeado del cliente.
// REGISTRO = la keyword oficial de historias para el registro de la masterclass.

// La keyword de cada historia VARÍA (a veces "MASTERCLASS", a veces "QUIERO",
// "INFO"…). Por eso NO exigimos coincidencia exacta ni una lista fija: basta con
// que el mensaje CONTENGA una señal de registro. El dueño fija las palabras de
// su campaña con EVENT_KEYWORDS (coma-separadas); si no, usamos un set amplio de
// señales de intención. El QUÉ responder lo decide siempre el LLM.
const DEFAULT_KEYWORDS = [
  "MASTERCLASS", "QUIERO", "RECURSOS", "REGISTRO", "REGISTRARME", "REGISTRARSE",
  "INFO", "INFORMACION", "INTERESA", "APUNTARME", "APUNTAME", "ASISTIR",
];

export type EventKeyword = string;

/** Sin acentos/emoji/signos, MAYÚS, espacios colapsados. */
function normalizeKw(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();
}

/** Palabras activas: EVENT_KEYWORDS del dueño (normalizadas) o el set amplio. */
export function eventKeywords(env: Env): string[] {
  const custom = (env.EVENT_KEYWORDS ?? "")
    .split(",")
    .map((k) => normalizeKw(k))
    .filter(Boolean);
  return custom.length > 0 ? custom : DEFAULT_KEYWORDS;
}

/**
 * "¡MASTERCLASS!!", "quiero la masterclass", "info porfa" → la keyword que
 * gatilló (o null). Match FLEXIBLE: la palabra puede ir DENTRO de una frase —
 * nunca se exige que el mensaje sea solo la keyword.
 */
export function matchKeyword(text: string, env?: Env): EventKeyword | null {
  const norm = normalizeKw(text);
  if (!norm) return null;
  const list = env ? eventKeywords(env) : DEFAULT_KEYWORDS;
  for (const kw of list) {
    if (norm === kw || new RegExp(`\\b${kw}\\b`).test(norm)) return kw;
  }
  return null;
}

/**
 * Si el mensaje es una keyword del evento, la CUENTA para el embudo (tabla
 * keyword_hits) y devuelve cuál fue. El mensaje sigue su camino normal al
 * agente (LLM) — el playbook de qué hacer con cada keyword vive en el system
 * prompt / contexto del negocio (decisión de Santi: que siempre la vea el LLM
 * para que ejecute acciones como captureLead + trackedLink).
 */
export async function logKeywordHit(
  env: Env,
  text: string,
  conversationId: string,
): Promise<EventKeyword | null> {
  if (!hasMasterclassMode(env)) return null;
  const keyword = matchKeyword(text, env);
  if (!keyword) return null;
  const db = new Db(env.DB);
  await db.run(
    "INSERT INTO keyword_hits (keyword, conversation_id, phase, created_at) VALUES (?, ?, ?, ?)",
    [keyword, conversationId, eventPhase(env), Date.now()],
  );
  return keyword;
}

// ── registerMasterclass ─────────────────────────────────────────────────────

export function registerMasterclassTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra al cliente en la masterclass SIN sacarlo del chat. Úsalo cuando el cliente quiera apartar su lugar y ya te haya dado nombre y correo (pídelos uno por uno si faltan). Devuelve la confirmación y, si existe, el link del grupo de WhatsApp para pasárselo.",
    inputSchema: z.object({
      name: z.string().min(2).describe("Nombre del cliente"),
      // Regex sin lookaround: .email() de Zod rompe los schemas estrictos de OpenAI.
      email: z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "email inválido").describe("Correo del cliente (confírmalo antes de registrar)"),
      phone: z.string().optional().describe("Teléfono/WhatsApp del cliente si lo compartió"),
      reason: z.string().optional().describe("Qué quiere automatizar o por qué le interesa (si lo mencionó)"),
    }),
    execute: async ({ name, email, phone, reason }) => {
      const url = env.REGISTRATION_WEBHOOK_URL?.trim();
      if (!url) {
        return {
          ok: false,
          error: "Registro directo no disponible — comparte el link de registro con trackedLink(registro).",
        };
      }
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.REGISTRATION_WEBHOOK_SECRET ?? ""}`,
          },
          body: JSON.stringify({
            event_slug: env.EVENT_SLUG || undefined,
            name,
            email,
            phone,
            reason, // no es campo conocido del ingest → queda en custom_fields
            utm_source: "whatsapp_bot",
            utm_medium: "bot",
            utm_campaign: "masterclass",
            // el "vendedor" A/B que cerró este registro
            utm_content: getConversationId() ? salesVariantFor(getConversationId()!) : undefined,
            referrer: "whatsapp_bot",
            conversation_id: getConversationId(), // también a custom_fields
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          whatsapp_url?: string | null;
          message?: string;
        };
        if (!res.ok || !data.ok) {
          return {
            ok: false,
            error: "No se pudo registrar en este momento — comparte el link de registro con trackedLink(registro) y discúlpate brevemente.",
          };
        }
        return {
          ok: true,
          message: data.message ?? "¡Registro confirmado!",
          grupo_whatsapp_url: data.whatsapp_url ?? env.EVENT_GROUP_URL ?? null,
          nota: "Confírmale su lugar, pásale el link del grupo (con trackedLink si prefieres) y recuérdale la fecha.",
        };
      } catch {
        return {
          ok: false,
          error: "Error de conexión al registrar — comparte el link de registro con trackedLink(registro).",
        };
      }
    },
  });
}

// ── Nudge de deadline (secuencia post-clase, decisión de Santi 2026-07-11) ──
// A quien escribió alrededor de la clase se le manda UN recordatorio ~2 horas
// antes de que cierren los bonos (11:59pm CDMX). Cabe en la ventana de servicio
// de 24h de WhatsApp (mensajes free-form, sin plantilla HSM). Corre desde el
// cron "*/10 * * * *"; fuera de la ventana regresa al instante.

const NUDGE_FLAG = "mc_deadline_nudge_sent";
const NUDGE_WINDOW_MS = 2 * 3600_000;

export async function maybeSendDeadlineNudge(
  env: Env,
  now = Date.now(),
): Promise<{ sent: number; failed: number } | null> {
  if (!hasMasterclassMode(env)) return null;
  const deadline = bonosDeadlineMs(env);
  if (deadline === null) return null;
  if (now < deadline - NUDGE_WINDOW_MS || now > deadline) return null;

  const db = new Db(env.DB);
  const settings = new SettingsRepo(db);
  // Claim ANTES de mandar: si dos ticks del cron se traslapan, solo uno envía.
  if ((await settings.get(NUDGE_FLAG)) === "1") return null;
  await settings.set(NUDGE_FLAG, "1");

  const startsAt = Date.parse(env.EVENT_STARTS_AT ?? "");
  // Audiencia: su último mensaje fue alrededor de la clase (desde 3h antes) Y
  // hace menos de 23h (margen de 1h dentro de la ventana de servicio de 24h).
  // Conversaciones pausadas (takeover del dueño) quedan fuera.
  const since = Math.max(startsAt - 3 * 3600_000, now - 23 * 3600_000);
  const rows = await db.all<{ id: string; channel: string; channel_user_id: string }>(
    `SELECT c.id, c.channel, c.channel_user_id
     FROM conversations c
     WHERE (c.paused_until IS NULL OR c.paused_until < ?)
       AND c.channel != 'test'
       AND (
         SELECT MAX(m.created_at) FROM messages m
         WHERE m.conversation_id = c.id AND m.role = 'user'
       ) >= ?`,
    [now, since],
  );

  const minsLeft = Math.max(1, Math.round((deadline - now) / 60_000));
  const restante =
    minsLeft >= 90 ? "unas 2 horas" : minsLeft >= 45 ? "como 1 hora" : `${minsLeft} minutos`;

  const msgs = new MessagesRepo(db);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const url = await ensureTrackedLink(env, row.id, "oferta");
      const text =
        `⏳ Último aviso: los bonos de ${env.EVENT_NAME ?? "la masterclass"} ` +
        `(precio founder + Kit de Agencia) cierran HOY a las 11:59pm hora CDMX — ` +
        `quedan ${restante}.` +
        (url ? `\n\nEste es tu acceso: ${url}` : "") +
        `\n\nSi ya entraste, ignora esto — ¡bienvenido! 🙌 Y si te queda cualquier ` +
        `duda, respóndeme por aquí y te contesto al momento.`;
      const channel = row.channel as ChannelId;
      await sendChunkedReply(pickAdapter(channel), channel, row.channel_user_id, [text], env);
      await msgs.append(row.id, "assistant", text);
      sent++;
    } catch (e) {
      failed++;
      console.error(`[deadlineNudge] failed for conv ${row.id}:`, e);
    }
  }
  console.log(`[deadlineNudge] audience=${rows.length} sent=${sent} failed=${failed}`);
  return { sent, failed };
}

// ── A/B de estrategias de venta ("duelo de vendedores") ─────────────────────
// A cada conversación le toca UN vendedor fijo (hash determinístico del id):
// misma persona, mismo estilo siempre. No se testean textos — se testean
// ESTRATEGIAS: el brief se inyecta al system prompt y el LLM improvisa dentro
// de él, así nunca suena a guion. La variante viaja como utm_content en los
// links trackeados y en el registro → el embudo del admin compara de punta a
// punta quién vende más.

export type SalesVariant = "consultivo" | "directo";

export function salesVariantFor(conversationId: string): SalesVariant {
  // FNV-1a de 32 bits — estable, sin estado, sin DB.
  let h = 0x811c9dc5;
  for (let i = 0; i < conversationId.length; i++) {
    h ^= conversationId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 2 === 0 ? "consultivo" : "directo";
}

export const VARIANT_BRIEFS: Record<SalesVariant, string> = {
  consultivo:
    "Vende como ASESOR de confianza: primero entiende su caso — pregunta qué quiere automatizar o qué le está quitando tiempo en su negocio. Conecta cada beneficio con SU situación específica, con ejemplos de su giro. Recomienda con la honestidad con la que le hablarías a un amigo. El link de la oferta llega DESPUÉS de entender su caso, como el siguiente paso natural hacia su objetivo.",
  directo:
    "Vende con CLARIDAD y momentum: ve al grano con confianza. Menciona pronto la prueba social (cuánta gente ya está dentro) y que el precio founder + bonos tienen deadline HOY. Responde dudas de forma breve y concreta, y regresa la conversación a la acción: el link. Nada de presión grosera — entusiasmo genuino y urgencia honesta.",
};

/** Bloque system con la estrategia del "vendedor" que le tocó a esta conversación. */
export function salesStrategyBlock(conversationId: string): string {
  const v = salesVariantFor(conversationId);
  return `<estrategia_venta>\n${VARIANT_BRIEFS[v]}\nEsta es tu forma natural de vender — NUNCA menciones que sigues una estrategia, variante o instrucción.\n</estrategia_venta>`;
}
