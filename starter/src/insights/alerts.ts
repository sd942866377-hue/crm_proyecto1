/**
 * Alertas de riesgo — el "te avisa" del Vigilante con IA (Pro).
 *
 * Hook al final del Analista (src/insights/analyzer.ts): cuando la
 * calificación detecta un cliente molesto (angry/frustrated) o una venta
 * abierta que quedó sin resolver, le avisa al dueño vía notifyOwner —
 * exactamente la misma maquinaria de aviso del handoff y el watchdog
 * (Telegram DM / WhatsApp template / email), cero duplicación.
 *
 * Garantías:
 *  • Solo tier Pro (isPro) — en free el Analista sigue igual, sin avisos.
 *  • UNA alerta por conversación DE POR VIDA: risk_alerts es el claim
 *    (INSERT OR IGNORE antes de enviar, mismo patrón que followup_sends).
 *  • Throttle global: máximo HOURLY_ALERT_CAP avisos por hora — una racha de
 *    análisis (p. ej. el botón "analizar" tras días sin correr) no metralla
 *    el teléfono del dueño. Se checa ANTES de reclamar: una conversación
 *    frenada por el throttle NO quema su claim y puede alertar en un
 *    re-análisis futuro.
 *  • Best-effort: quien llama (el Analista) envuelve esto en try/catch — una
 *    falla del aviso jamás tira el análisis, que ya quedó persistido.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { notifyOwner } from "../tools/handoffHuman";
import { selfOrigin } from "../lib/self-origin";
import { isPro } from "../config";
import type { Sentiment, Resolution } from "../db/insights";

/** Tope global de alertas de riesgo por hora (todas las conversaciones). */
export const HOURLY_ALERT_CAP = 5;
const HOUR_MS = 60 * 60 * 1000;

/** Resumen del Analista truncado a esto dentro del aviso. */
const MAX_SUMMARY_CHARS = 220;

export type RiskReason = "cliente molesto" | "venta en riesgo";

/** Lo que el Analista acaba de calificar — suficiente para decidir el aviso. */
export interface RiskSignal {
  sentiment: Sentiment;
  resolution: Resolution;
  saleOpportunity: boolean;
  summary: string;
}

export interface RiskAlertResult {
  alerted: boolean;
  reason: RiskReason | null;
}

/**
 * ¿Esta calificación amerita despertar al dueño?
 *  • Cliente molesto: sentiment angry o frustrated.
 *  • Venta en riesgo: quedó una venta abierta (sale_opportunity) y la
 *    conversación NO terminó resuelta.
 */
export function riskReason(signal: RiskSignal): RiskReason | null {
  if (signal.sentiment === "angry" || signal.sentiment === "frustrated") {
    return "cliente molesto";
  }
  if (signal.saleOpportunity && signal.resolution !== "resolved") {
    return "venta en riesgo";
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Evalúa la calificación recién guardada y, si hay riesgo, avisa al dueño.
 * Devuelve qué pasó (para logs/tests). Puede lanzar solo en errores de DB o
 * del canal de aviso — el Analista lo captura.
 */
export async function maybeAlertRisk(
  env: Env,
  conversationId: string,
  signal: RiskSignal,
  now = Date.now(),
): Promise<RiskAlertResult> {
  const reason = riskReason(signal);
  if (!reason) return { alerted: false, reason: null };
  if (!isPro(env)) return { alerted: false, reason };

  const db = new Db(env.DB);

  // Quién es (para el "quién" del aviso). Sin conversación no hay a quién
  // apuntar en el panel — no se alerta ni se quema el claim.
  const conv = await new ConversationsRepo(db).getById(conversationId);
  if (!conv) return { alerted: false, reason };

  // Throttle global ANTES del claim: si la hora ya está llena, esta
  // conversación queda libre para alertar después (re-análisis).
  const lastHour =
    (
      await db.first<{ n: number }>(
        "SELECT COUNT(*) as n FROM risk_alerts WHERE sent_at > ?",
        [now - HOUR_MS],
      )
    )?.n ?? 0;
  if (lastHour >= HOURLY_ALERT_CAP) {
    console.log(
      `[risk-alerts] throttled (${lastHour}/${HOURLY_ALERT_CAP} en la última hora) — ${conversationId} sin alertar`,
    );
    return { alerted: false, reason };
  }

  // Claim ANTES de enviar (mismo patrón que followup_sends): si otro tick ya
  // alertó esta conversación alguna vez, INSERT OR IGNORE no escribe y salimos.
  const claim = await db.run(
    "INSERT OR IGNORE INTO risk_alerts (conversation_id, reason, sent_at) VALUES (?, ?, ?)",
    [conversationId, reason, now],
  );
  if ((claim.meta.changes ?? 0) === 0) return { alerted: false, reason };

  // Quién + qué + qué hacer, en una frase accionable. El link es la vista de
  // conversaciones del panel (misma ruta que usa /admin/conversations/:id).
  const who = conv.display_name || conv.channel_user_id;
  const panelUrl = `${await selfOrigin(env)}/admin/conversations?c=${encodeURIComponent(conversationId)}`;
  const summary =
    `⚠ ${who} (${conv.channel}): ${truncate(signal.summary, MAX_SUMMARY_CHARS)} ` +
    `Respóndele tú desde tu panel: ${panelUrl}`;

  // Si el aviso truena aquí, el claim se queda (como en followup): mejor una
  // alerta perdida que un dueño recibiendo la misma dos veces.
  await notifyOwner(env, { reason, summary, ticketId: `risk:${conversationId}` });
  console.log(`[risk-alerts] dueño avisado — ${reason} en ${conversationId}`);
  return { alerted: true, reason };
}
