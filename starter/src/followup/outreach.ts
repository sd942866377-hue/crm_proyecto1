/**
 * Outreach post-conversación (superpoderes Pro): Encuestas de satisfacción y
 * Pide reseñas. Ambos mandan UN mensaje después de que la conversación se
 * resolvió, así que comparten selección y clasificación en una sola pasada:
 *
 *  1. Candidatos: conversaciones que terminaron con el bot, con enganche real
 *     (2+ mensajes del cliente), sin ticket abierto, sin pausa, DENTRO de la
 *     ventana de 24 h (para que el free-form sea válido en todo canal), y que
 *     nunca recibieron encuesta NI invitación de reseña.
 *  2. Un solo llamado al modelo rápido clasifica {resuelta, sentimiento}.
 *  3. Encuesta (si está activa y quedó resuelta) tiene prioridad — un toque por
 *     conversación de por vida. Si no, y la reseña está activa + hay review_url
 *     + el cliente quedó contento → invitación de reseña.
 *
 * Claim-before-send (survey_sends / review_requests) igual que el follow-up:
 * imposible mandar dos veces. Corre en el cron frecuente. Best-effort.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { resolveAgentConfig } from "../settings-loader";
import { workModel } from "../llm/work-model";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { isPro } from "../config";
import { sendOutbound } from "./send";

const MIN_IDLE_MS = 60 * 60 * 1000; // 1 h — dale aire para que se asiente
const MAX_IDLE_MS = 20 * 60 * 60 * 1000; // 20 h — margen dentro de las 24 h

interface CandidateRow {
  id: string;
  channel: string;
  channel_user_id: string;
  display_name: string | null;
}

export interface OutreachResult {
  surveys: number;
  reviews: number;
  skipped: number;
  errors: number;
}

type Verdict = { resolved: boolean; sentiment: "positive" | "neutral" | "negative" };

async function classify(
  env: Env,
  transcript: string,
): Promise<Verdict> {
  const llm = await workModel(env, "fast", "followups");
  const result = await llm.generate({
    prompt: `Analiza esta conversación de atención al cliente y responde SOLO con JSON compacto, sin explicación.

${transcript}

Formato exacto: {"resolved": true|false, "sentiment": "positive"|"neutral"|"negative"}
- resolved: ¿el cliente quedó atendido/sin pendientes abiertos?
- sentiment: cómo quedó el cliente al final.`,
  });
  try {
    const m = result.text.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    const sentiment =
      parsed.sentiment === "positive" || parsed.sentiment === "negative"
        ? parsed.sentiment
        : "neutral";
    return { resolved: parsed.resolved === true, sentiment };
  } catch {
    return { resolved: false, sentiment: "neutral" };
  }
}

function surveyMessage(name: string | null): string {
  const hi = name ? `${name}, ` : "";
  return `${hi}¿qué tan bien te atendí hoy? Del 1 al 5 (5 = excelente), respóndeme con un número 🙏`;
}

// Modo abierto: pide una opinión en palabras del cliente (sin número).
function surveyMessageOpen(name: string | null): string {
  const hi = name ? `${name}, ` : "";
  return `${hi}¿cómo te fue hoy? Cuéntame en tus palabras qué te pareció la atención 🙏`;
}

// Modo ambos: número + comentario en un solo mensaje (no mandamos dos).
function surveyMessageBoth(name: string | null): string {
  const hi = name ? `${name}, ` : "";
  return `${hi}¿qué tan bien te atendí hoy? Del 1 al 5 (5 = excelente) y, si quieres, cuéntame por qué 🙏`;
}

// Elige el texto de la encuesta según el modo configurado.
function surveyTextForMode(mode: string, name: string | null): string {
  if (mode === "abierto") return surveyMessageOpen(name);
  if (mode === "ambos") return surveyMessageBoth(name);
  return surveyMessage(name);
}

function reviewMessage(name: string | null, url: string): string {
  const hi = name ? `${name}, ` : "";
  return `${hi}¡gracias por tu preferencia! Si te sirvió, ¿me regalas una reseña? Me ayuda muchísimo: ${url}`;
}

export async function runOutreach(
  env: Env,
  opts: { now?: number; limit?: number; dailyCap?: number } = {},
): Promise<OutreachResult> {
  const empty: OutreachResult = { surveys: 0, reviews: 0, skipped: 0, errors: 0 };
  if (!isPro(env)) return empty;

  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 6;
  const dailyCap = opts.dailyCap ?? 40;
  const db = new Db(env.DB);

  const settings = new SettingsRepo(db);
  const surveyOn = (await settings.get(SETTING_KEYS.satisfactionSurvey)) === "1";
  const surveyMode = (await settings.get(SETTING_KEYS.surveyMode)) || "numerico";
  const reviewsOn = (await settings.get(SETTING_KEYS.reviewRequests)) === "1";
  const reviewUrl = ((await settings.get(SETTING_KEYS.reviewUrl)) ?? "").trim();
  if (!surveyOn && !(reviewsOn && reviewUrl)) return empty;

  // Respeta la pausa global del bot.
  const cfg = await resolveAgentConfig(env, []);
  if (cfg.botPaused) return empty;

  // Cap diario combinado de toques de outreach.
  const sentToday =
    (
      await db.first<{ n: number }>(
        `SELECT
           (SELECT COUNT(*) FROM survey_sends WHERE sent_at > ?) +
           (SELECT COUNT(*) FROM review_requests WHERE sent_at > ?) AS n`,
        [now - 24 * 60 * 60 * 1000, now - 24 * 60 * 60 * 1000],
      )
    )?.n ?? 0;
  if (sentToday >= dailyCap) return empty;

  const rows = await db.all<CandidateRow>(
    `SELECT c.id, c.channel, c.channel_user_id, c.display_name
       FROM conversations c
       LEFT JOIN survey_sends s ON s.conversation_id = c.id
       LEFT JOIN review_requests r ON r.conversation_id = c.id
       WHERE s.conversation_id IS NULL
         AND r.conversation_id IS NULL
         AND c.open_ticket_id IS NULL
         AND c.channel NOT IN ('instagram', 'test')
         AND (c.paused_until IS NULL OR c.paused_until < ?)
         AND (SELECT MAX(created_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
               BETWEEN ? AND ?
         AND (SELECT role FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) = 'assistant'
         AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') >= 2
       ORDER BY c.last_message_at DESC
       LIMIT ?`,
    [now, now - MAX_IDLE_MS, now - MIN_IDLE_MS, Math.min(limit, dailyCap - sentToday)],
  );
  if (rows.length === 0) return empty;

  const msgs = new MessagesRepo(db);
  const out = { ...empty };

  for (const cand of rows) {
    try {
      const history = await msgs.lastN(cand.id, 8);
      const transcript = history
        .map((m) => `${m.role === "user" ? "Cliente" : "Bot"}: ${m.content.slice(0, 300)}`)
        .join("\n");
      const verdict = await classify(env, transcript);
      if (!verdict.resolved) {
        out.skipped++;
        continue;
      }

      // Encuesta primero (si está activa). Un toque por conversación de por vida.
      if (surveyOn) {
        const claim = await db.run(
          "INSERT OR IGNORE INTO survey_sends (conversation_id, sent_at) VALUES (?, ?)",
          [cand.id, now],
        );
        if ((claim.meta.changes ?? 0) === 0) {
          out.skipped++;
          continue;
        }
        await sendOutbound(
          env,
          { conversationId: cand.id, channel: cand.channel, channelUserId: cand.channel_user_id, text: surveyTextForMode(surveyMode, cand.display_name) },
          now,
        );
        out.surveys++;
        continue;
      }

      // Reseña: solo si el cliente quedó contento.
      if (reviewsOn && reviewUrl && verdict.sentiment === "positive") {
        const claim = await db.run(
          "INSERT OR IGNORE INTO review_requests (conversation_id, sent_at) VALUES (?, ?)",
          [cand.id, now],
        );
        if ((claim.meta.changes ?? 0) === 0) {
          out.skipped++;
          continue;
        }
        await sendOutbound(
          env,
          { conversationId: cand.id, channel: cand.channel, channelUserId: cand.channel_user_id, text: reviewMessage(cand.display_name, reviewUrl) },
          now,
        );
        out.reviews++;
        continue;
      }

      out.skipped++;
    } catch (e) {
      out.errors++;
      console.error(`[outreach] failed for ${cand.id}:`, e);
    }
  }

  if (out.surveys || out.reviews) {
    console.log(`[outreach] surveys=${out.surveys} reviews=${out.reviews} skipped=${out.skipped} errors=${out.errors}`);
  }
  return out;
}
