// Guardrail anti-spam determinístico — corre ANTES del LLM, así el spam no
// cuesta ni un token. Si el mensaje entrante es idéntico (normalizado) a 2+ de
// los últimos 5 mensajes del usuario (es decir, va por la 3ª vez), la
// conversación se manda "a descansar": paused_until = ahora + 1 hora y el bot
// la ignora por completo. El caso abusivo-pero-variado (insultos, bots que
// varían el texto) lo cubre la tool snoozeUser, que decide el LLM.
import { Db } from "./db/client";

export const SPAM_SNOOZE_MS = 60 * 60_000;

// Aviso ÚNICO antes de la pausa por repetición. Neutral y sin marca (sale en el
// bot de cualquier miembro). No promete respuesta inmediata: la conversación
// queda pausada 1h — por eso se avisa que una persona la retoma.
export const REPEAT_PAUSE_MESSAGE =
  "Ya recibí tu mensaje 🙂 Le paso tu conversación a una persona del equipo para que te atienda en cuanto pueda.";

const SPAM_LOOKBACK = 5;
// El entrante + 2 iguales previos = 3ª repetición → cooldown.
const SPAM_REPEATS = 2;
// Solo cuentan repeticiones RECIENTES: el spam real es una ráfaga. Sin ventana,
// un lead que respondió "Forja" a tres historias distintas a lo largo de un mes
// quedaba pausado como spammer (santiago_g_19, 27-ago-2026).
export const SPAM_WINDOW_MS = 10 * 60_000;
// Una sola palabra corta ("Forja", "Info", "Quiero") es una keyword de funnel
// ("comenta X y te mando la info"), no abuso — se exenta. El abuso de verdad lo
// frena el tope diario de turnos.
const SPAM_KEYWORD_MAX_LEN = 20;

/** "  ¡HOLA!! " → "¡hola!!" no — quita acentos/espacios extra y baja a minúsculas. */
export function normalizeForSpam(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Una sola palabra de ≤20 chars (sin espacios, ya normalizada) = keyword de funnel. */
export function looksLikeKeyword(norm: string): boolean {
  return norm.length <= SPAM_KEYWORD_MAX_LEN && !/\s/.test(norm);
}

export async function isRepeatSpam(
  db: Db,
  conversationId: string,
  text: string,
  now = Date.now(),
): Promise<boolean> {
  const norm = normalizeForSpam(text);
  if (norm.length < 2) return false; // "ok"/"sí" sueltos no cuentan como spam
  if (looksLikeKeyword(norm)) return false;
  const rows = await db.all<{ content: string }>(
    `SELECT content FROM messages
     WHERE conversation_id = ? AND role = 'user' AND created_at > ?
     ORDER BY created_at DESC LIMIT ?`,
    [conversationId, now - SPAM_WINDOW_MS, SPAM_LOOKBACK],
  );
  const same = rows.filter((r) => normalizeForSpam(r.content) === norm).length;
  return same >= SPAM_REPEATS;
}

// ── Tope diario de turnos (backstop anti "ChatGPT gratis") ──────────────────
// El caso fino (preguntas fuera de tema) lo decide el LLM con snoozeUser; este
// tope es el respaldo determinístico de costos: nadie legítimo cruza 50 turnos
// de usuario en 24h (cada turno ya viene agrupado por el buffer). Al cruzarlo,
// UNA despedida amable y la conversación descansa 12 horas.

export const DAILY_TURN_CAP = 50;
export const DAILY_CAP_SNOOZE_MS = 12 * 3600_000;
// Despedida NEUTRAL (sin marca): este mensaje sale en el bot de CUALQUIER
// miembro, así que no puede mencionar a Santi, Horizontes IA ni su comunidad —
// era una fuga de marca (un bot de cliente promocionando Horizontes a SUS
// clientes). Reportado por Eduardo Cruz (bot "Max"), 5-ago-2026.
export const DAILY_CAP_MESSAGE =
  "Por hoy ya te ayudé bastante 🙂 Si necesitas algo más, con gusto seguimos mañana.";

export async function isOverDailyCap(
  db: Db,
  conversationId: string,
  now = Date.now(),
): Promise<boolean> {
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) as n FROM messages
     WHERE conversation_id = ? AND role = 'user' AND created_at > ?`,
    [conversationId, now - 24 * 3600_000],
  );
  return (row?.n ?? 0) >= DAILY_TURN_CAP;
}
