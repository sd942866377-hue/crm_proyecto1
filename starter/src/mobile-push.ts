/**
 * Push móvil hacia el control plane (Forja Inbox) — el bot avisa "pasó algo
 * que te importa" y app.forjabots.com lo convierte en notificación APNs.
 *
 * Auth: el MISMO Bearer CONTROL_PLANE_TOKEN que ya usa /api/* — el control
 * plane deriva QUÉ bot es por el hash del token, así que un bot ya emparejado
 * no necesita ninguna var nueva. Sin token (bot sin pairing) → no-op.
 *
 * SIEMPRE best-effort: nunca lanza, timeout corto. NUNCA el transcript
 * completo — pero OJO, no es "solo metadata": `body` puede llevar una vista
 * previa CORTA y RECORTADA del texto real del cliente (ej. el tipo `message`
 * en agent.ts, cuando el cliente escribe con la conversación pausada); los
 * demás tipos (handoff/lead_hot/watchdog) mandan un resumen redactado, no el
 * texto crudo. `title` NUNCA debe llevar el contacto crudo (teléfono/usuario)
 * — el caller lo enmascara (ver `maskContact` en lib/mask.ts) o usa el
 * display_name/"Cliente" antes de armar el evento; esta función no lo valida.
 */
import type { Env } from "./env";

export type MobilePushType =
  | "handoff"
  | "message"
  | "watchdog"
  | "lead_hot"
  | "report"
  // v3.4 — señales del Analista (insights): cliente molesto / quiere cancelar.
  | "upset"
  | "cancel";

export interface MobilePushEvent {
  type: MobilePushType;
  title: string; // ≤120 chars (límite del contrato; aquí se trunca) — sin contacto crudo, ver arriba
  body: string; // ≤240 chars — preview recortado, nunca el transcript completo
  conversationId?: string;
}

const DEFAULT_CONTROL_PLANE = "https://app.forjabots.com";
const TIMEOUT_MS = 5_000;

export async function dispatchMobilePush(env: Env, ev: MobilePushEvent): Promise<void> {
  const token = env.CONTROL_PLANE_TOKEN?.trim();
  if (!token) return;
  const base = (env.CONTROL_PLANE_URL || DEFAULT_CONTROL_PLANE).replace(/\/+$/, "");
  try {
    await fetch(`${base}/api/internal/push/dispatch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: ev.type,
        title: ev.title.slice(0, 120),
        body: ev.body.slice(0, 240),
        conversation_id: ev.conversationId,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Sin red / control plane caído / push no configurado: el evento vive
    // igual en el panel del bot — la notificación es solo el "ping".
  }
}
