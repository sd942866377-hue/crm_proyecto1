/**
 * Push móvil de riesgo desde el Analista (v3.4) — "cliente molesto" / "quiere
 * cancelar" hacia Forja Inbox.
 *
 * Hermano de alerts.ts: aquel avisa al DUEÑO por sus canales (Telegram/WhatsApp/
 * email, Pro, 1 vez por conversación de por vida). Éste manda el PUSH a la app
 * (APNs vía control plane) reusando la MISMA señal que el Analista ya calculó
 * (sentiment + intención de cancelar) — cero llamadas extra de IA.
 *
 * Se corre desde analyzeConversations, justo donde ya vive maybeAlertRisk.
 *
 * Anti-spam: throttle por (tipo + conversación) en una ventana, guardado en
 * `settings` (mismo patrón KV que el watchdog: una marca de tiempo por llave).
 * Un cliente que sigue enojado no metralla el teléfono. El gate de entrega es
 * el pairing/APNs — sin CONTROL_PLANE_TOKEN, dispatchMobilePush es no-op.
 *
 * Best-effort: quien llama (el Analista) lo envuelve en try/catch; una falla
 * aquí jamás tira el análisis, que ya quedó persistido.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";
import { ConversationsRepo } from "../db/conversations";
import { dispatchMobilePush, type MobilePushType } from "../mobile-push";
import { renderPush } from "../lib/push-templates";
import { maskContact } from "../lib/mask";
import type { Sentiment } from "../db/insights";

/** Ventana del throttle por (tipo + conversación). */
export const INSIGHT_PUSH_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6h

/** Recorte del motivo (cuerpo del push) y del preview. */
const MAX_MOTIVO = 160;
const MAX_PREVIEW = 140;

/** Señal del Analista, suficiente para decidir el push. */
export interface InsightPushSignal {
  sentiment: Sentiment;
  /** El cliente pidió cancelar / darse de baja (del grader del Analista). */
  cancelIntent: boolean;
  /** Sentiment de la calificación ANTERIOR de esta conversación (si la hubo). */
  priorSentiment?: Sentiment | null;
  /** Resumen del Analista (motivo corto del aviso). */
  summary: string;
  /** Último mensaje del cliente, para la vista previa. */
  lastUserText?: string;
}

/** Copy fija por tipo — el resto de la plantilla vive en push-templates.ts. */
const KIND: Record<"upset" | "cancel", { emoji: string; accion: string }> = {
  upset: { emoji: "😠", accion: "está molesto" },
  cancel: { emoji: "🚫", accion: "quiere darse de baja" },
};

/**
 * ¿Qué push amerita esta calificación?
 *  • cancel: el cliente pidió cancelar/darse de baja (gana sobre molesto — es lo
 *    más urgente: se está yendo).
 *  • upset: sentiment angry, o frustrated REPETIDO (la calificación anterior ya
 *    venía frustrada/enojada) — un frustrado aislado no despierta a nadie.
 */
export function insightPushType(signal: InsightPushSignal): "upset" | "cancel" | null {
  if (signal.cancelIntent) return "cancel";
  if (signal.sentiment === "angry") return "upset";
  if (
    signal.sentiment === "frustrated" &&
    (signal.priorSentiment === "frustrated" || signal.priorSentiment === "angry")
  ) {
    return "upset";
  }
  return null;
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function throttleKey(type: MobilePushType, conversationId: string): string {
  return `push_alert_at:${type}:${conversationId}`;
}

/**
 * Evalúa la calificación y, si hay riesgo, manda el push a la app. Devuelve qué
 * pasó (para logs/tests). Puede lanzar solo por errores de DB o del canal — el
 * Analista lo captura.
 */
export async function maybeDispatchInsightPush(
  env: Env,
  conversationId: string,
  signal: InsightPushSignal,
  now = Date.now(),
): Promise<{ pushed: boolean; type: "upset" | "cancel" | null }> {
  const type = insightPushType(signal);
  if (!type) return { pushed: false, type: null };

  const db = new Db(env.DB);
  const settings = new SettingsRepo(db);

  // Throttle por (tipo + conversación): si ya avisamos esto hace poco, no se
  // repite. Se checa ANTES de armar nada.
  const key = throttleKey(type, conversationId);
  const lastRaw = await settings.get(key);
  const last = lastRaw ? Number.parseInt(lastRaw, 10) : 0;
  if (Number.isFinite(last) && last > 0 && now - last < INSIGHT_PUSH_THROTTLE_MS) {
    return { pushed: false, type };
  }

  // Quién es (título PII-safe: display_name o contacto enmascarado, nunca crudo).
  const conv = await new ConversationsRepo(db).getById(conversationId).catch(() => null);
  const cliente = conv?.display_name || maskContact(conv?.channel_user_id ?? null) || "Cliente";

  // Marca el throttle ANTES de enviar (como watchdog/risk): mejor un aviso
  // perdido que el mismo dos veces.
  await settings.set(key, String(now));

  const { emoji, accion } = KIND[type];
  const push = renderPush(type, {
    emoji,
    cliente,
    accion,
    motivo: truncate(signal.summary, MAX_MOTIVO),
    preview: signal.lastUserText ? truncate(signal.lastUserText, MAX_PREVIEW) : "",
  });
  await dispatchMobilePush(env, {
    type,
    title: push.title,
    body: push.body,
    conversationId,
  });
  console.log(`[insight-push] ${type} enviado — ${conversationId}`);
  return { pushed: true, type };
}
