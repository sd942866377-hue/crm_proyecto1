/**
 * Captura de respuesta de la encuesta de satisfacción (superpoder Pro).
 *
 * Tras mandar la encuesta (outreach.ts), el cliente responde con un número.
 * Este job del cron frecuente busca encuestas sin calificar (survey_sends.score
 * IS NULL) cuyo cliente ya respondió después del envío, extrae el 1-5 de su
 * mensaje y lo guarda. Si la calificación es baja (≤ 2), avisa al dueño para
 * que recupere al cliente molesto — el "te avisa apenas queda molesto".
 *
 * Fuera del hot path (no toca el ingest): el cliente igual recibe la respuesta
 * normal del agente a su número; aquí solo registramos la métrica + la alerta.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { messageOwner } from "../tools/handoffHuman";
import { selfOrigin } from "../lib/self-origin";
import { isPro } from "../config";

/** Calificación por debajo (incluida) de esto dispara la alerta al dueño. */
export const LOW_SCORE_THRESHOLD = 2;

interface PendingRow {
  conversation_id: string;
  sent_at: number;
  reply: string | null;
}

/** Extrae un 1-5 del texto del cliente. null si no hay un número claro. */
export function parseScore(text: string): number | null {
  // Un dígito 1-5 aislado (no parte de "15", "2026", etc.).
  const m = text.match(/(?:^|[^\d])([1-5])(?:[^\d]|$)/);
  if (m) return Number.parseInt(m[1], 10);
  // Palabras comunes en español.
  const t = text.toLowerCase();
  if (/\b(excelente|excellent|perfecto|genial|buen[íi]simo)\b/.test(t)) return 5;
  if (/\b(muy mal|p[ée]simo|horrible|terrible)\b/.test(t)) return 1;
  return null;
}

export interface SurveyResponseResult {
  scored: number;
  alerted: number;
  open: number; // opiniones de texto libre guardadas (modo abierto/ambos)
}

export async function captureSurveyResponses(
  env: Env,
  opts: { now?: number; limit?: number } = {},
): Promise<SurveyResponseResult> {
  const result: SurveyResponseResult = { scored: 0, alerted: 0, open: 0 };
  if (!isPro(env)) return result;

  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 20;
  const db = new Db(env.DB);

  // Modo de la encuesta: en "abierto"/"ambos" guardamos la opinión de texto libre
  // en vez de descartarla cuando no trae un número.
  const mode = (await new SettingsRepo(db).get(SETTING_KEYS.surveyMode)) || "numerico";
  const wantsOpen = mode === "abierto" || mode === "ambos";

  // Encuestas sin calificar donde el cliente ya respondió algo después del
  // envío. Tomamos su PRIMER mensaje posterior como la respuesta.
  const rows = await db.all<PendingRow>(
    `SELECT s.conversation_id, s.sent_at,
       (SELECT m.content FROM messages m
          WHERE m.conversation_id = s.conversation_id AND m.role = 'user' AND m.created_at > s.sent_at
          ORDER BY m.created_at ASC LIMIT 1) AS reply
     FROM survey_sends s
     WHERE s.score IS NULL AND s.responded_at IS NULL
     ORDER BY s.sent_at DESC
     LIMIT ?`,
    [limit],
  );

  const convs = new ConversationsRepo(db);

  for (const row of rows) {
    if (!row.reply) continue;
    const score = parseScore(row.reply);
    // Modo numérico: si no hay un número claro, seguimos esperando (no marcamos).
    if (score === null && !wantsOpen) continue;

    // Marca la encuesta como respondida (con score si lo hubo) — no se reprocesa.
    await db.run(
      "UPDATE survey_sends SET score = ?, responded_at = ? WHERE conversation_id = ?",
      [score, now, row.conversation_id],
    );
    if (score !== null) result.scored++;

    // Guarda la opinión abierta cuando el modo la pide (y no es solo el número).
    if (wantsOpen) {
      const text = row.reply.trim();
      if (text && !/^[1-5]$/.test(text)) {
        await db.run(
          "INSERT OR IGNORE INTO survey_open_responses (conversation_id, response_text, created_at) VALUES (?, ?, ?)",
          [row.conversation_id, text.slice(0, 2000), now],
        );
        result.open++;
      }
    }

    if (score !== null && score <= LOW_SCORE_THRESHOLD) {
      try {
        const conv = await convs.getById(row.conversation_id);
        const who = conv?.display_name || conv?.channel_user_id || row.conversation_id;
        const panelUrl = `${await selfOrigin(env)}/admin/conversations?c=${encodeURIComponent(row.conversation_id)}`;
        await messageOwner(env, {
          heading: `⚠ Calificación baja (${score}/5)`,
          body: `${who} te calificó ${score}/5. Vale la pena que lo recuperes tú.`,
          url: panelUrl,
        });
        result.alerted++;
      } catch (e) {
        console.error(`[surveyResponse] alert failed for ${row.conversation_id}:`, e);
      }
    }
  }

  if (result.scored || result.open)
    console.log(`[surveyResponse] scored=${result.scored} open=${result.open} alerted=${result.alerted}`);
  return result;
}
