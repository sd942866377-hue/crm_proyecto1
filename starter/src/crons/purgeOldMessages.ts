import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { TEST_CONV_PREFIX } from "../db/testFilter";

/** Messages older than this are purged by the daily cron. Leads + tickets are kept forever. */
export const MESSAGE_RETENTION_DAYS = 90;

/** Un chat de prueba es desechable por diseño: nadie vuelve a él. */
export const TEST_CHAT_RETENTION_DAYS = 30;

/** Tope de filas por corrida. Nada de barridos gigantes en un cron: si queda
 *  cola, la siguiente noche sigue donde se quedó. */
const PURGE_BATCH = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily cron: delete messages older than the retention window (90 days).
 * Conversations, leads and tickets are NOT touched. Returns the number of
 * deleted rows so the caller can log it.
 *
 * `now` is injectable for tests; defaults to the current time.
 */
export async function purgeOldMessages(env: Env, now: number = Date.now()): Promise<number> {
  const cutoff = now - MESSAGE_RETENTION_DAYS * DAY_MS;
  const msgs = new MessagesRepo(new Db(env.DB));
  const deleted = await msgs.purgeOlderThan(cutoff);
  console.log(`[cron purgeOldMessages] deleted ${deleted} messages older than ${MESSAGE_RETENTION_DAYS}d`);
  return deleted;
}

interface MediaKeyRow {
  id: string;
  r2_key: string | null;
}

/**
 * Borra filas de `media` y sus objetos de R2. El objeto se borra ANTES que la
 * fila: si la corrida se muere a la mitad, la fila sobrevive y la próxima noche
 * vuelve a intentarlo — al revés quedaría un archivo huérfano que nadie sabe
 * que existe. Best-effort en cada borrado.
 */
async function deleteMediaRows(env: Env, db: Db, rows: MediaKeyRow[]): Promise<number> {
  if (!rows.length) return 0;
  for (const row of rows) {
    if (env.MEDIA && row.r2_key) {
      await env.MEDIA.delete(row.r2_key).catch((e) =>
        console.warn(`[purge] no se pudo borrar ${row.r2_key} de R2 (se ignora):`, e),
      );
    }
  }
  const ids = rows.map((r) => r.id);
  await db.run(`DELETE FROM media WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  return ids.length;
}

/**
 * Purga de archivos vieja (misma retención que los mensajes, 90 días).
 *
 * Existía una fuga: `purgeOlderThan` borraba los mensajes pero NADIE borraba
 * las filas de `media` ni los objetos de R2 — con el hilo móvil archivando cada
 * foto y cada nota de voz entrante, el bucket del miembro crecía para siempre.
 *
 * Tolera que la tabla `media` no exista (bots viejos que nunca activaron la
 * Bóveda) y que no haya binding R2: en ese caso las filas ya son referencias
 * muertas y se borran igual, que para eso venció la retención.
 */
export async function purgeOldMedia(env: Env, now: number = Date.now()): Promise<number> {
  const cutoff = now - MESSAGE_RETENTION_DAYS * DAY_MS;
  const db = new Db(env.DB);
  try {
    const rows = await db.all<MediaKeyRow>(
      "SELECT id, r2_key FROM media WHERE created_at < ? ORDER BY created_at LIMIT ?",
      [cutoff, PURGE_BATCH],
    );
    const deleted = await deleteMediaRows(env, db, rows);
    if (deleted) {
      console.log(
        `[cron purgeOldMedia] borrados ${deleted} archivos de más de ${MESSAGE_RETENTION_DAYS}d`,
      );
    }
    return deleted;
  } catch (e) {
    // Tabla inexistente o D1 con hipo: la purga es higiene, no la ruta crítica.
    console.warn("[cron purgeOldMedia] no se pudo purgar (se ignora):", e);
    return 0;
  }
}

/** Tablas hijas de una conversación, en orden de borrado (todas antes que la
 *  conversación misma). Las que no existan en un bot viejo se ignoran. */
const TABLAS_HIJAS = [
  "messages",
  "leads",
  "tickets",
  "conversation_reads",
  "conversation_insights",
  "followup_sends",
  "risk_alerts",
  "customer_facts",
  "tracked_links",
  "keyword_hits",
  "conv_labels",
  "survey_sends",
  "reengage_sends",
  "review_requests",
  "survey_open_responses",
  "payment_intents",
  "template_sends",
  "forja_features",
];

/**
 * Limpieza de chats de PRUEBA (canal `test`, ids `test:<session>`).
 *
 * Son conversaciones desechables: el instalador o el dueño le escriben a su
 * propio bot para verlo contestar y no vuelven nunca. Ya están fuera de la
 * bandeja y de las métricas (db/testFilter.ts), pero seguían acumulando filas
 * para siempre. A los 30 días sin actividad se borran ellas y todo lo que
 * cuelga de ellas.
 *
 * Se borran los hijos ANTES que la conversación a propósito: las FKs de leads,
 * tickets y media son ON DELETE SET NULL, así que tumbar la conversación
 * primero dejaría filas huérfanas con conversation_id NULL — invisibles y
 * eternas. Best-effort tabla por tabla (un bot viejo no tiene todas).
 */
export async function purgeOldTestChats(env: Env, now: number = Date.now()): Promise<number> {
  const cutoff = now - TEST_CHAT_RETENTION_DAYS * DAY_MS;
  const db = new Db(env.DB);
  let convIds: string[];
  try {
    const rows = await db.all<{ id: string }>(
      `SELECT id FROM conversations
        WHERE id LIKE '${TEST_CONV_PREFIX}%' AND last_message_at < ?
        ORDER BY last_message_at LIMIT ?`,
      [cutoff, PURGE_BATCH],
    );
    convIds = rows.map((r) => r.id);
  } catch (e) {
    console.warn("[cron purgeOldTestChats] no se pudieron listar (se ignora):", e);
    return 0;
  }
  if (!convIds.length) return 0;

  const marcadores = convIds.map(() => "?").join(",");

  // Los archivos primero: hay que sacarlos de R2 antes de perder su r2_key.
  try {
    const media = await db.all<MediaKeyRow>(
      `SELECT id, r2_key FROM media WHERE conversation_id IN (${marcadores})`,
      convIds,
    );
    await deleteMediaRows(env, db, media);
  } catch (e) {
    console.warn("[cron purgeOldTestChats] media (se ignora):", e);
  }

  for (const tabla of TABLAS_HIJAS) {
    await db
      .run(`DELETE FROM ${tabla} WHERE conversation_id IN (${marcadores})`, convIds)
      .catch(() => {
        /* tabla que este bot no tiene: nada que borrar */
      });
  }
  await db.run(`DELETE FROM conversations WHERE id IN (${marcadores})`, convIds);

  console.log(
    `[cron purgeOldTestChats] borrados ${convIds.length} chats de prueba sin actividad en ${TEST_CHAT_RETENTION_DAYS}d`,
  );
  return convIds.length;
}
