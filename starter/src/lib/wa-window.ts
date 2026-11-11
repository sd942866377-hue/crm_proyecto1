/**
 * Ventana de servicio de 24 h de WhatsApp — la regla de Meta: el negocio solo
 * puede mandar texto libre dentro de las 24 h posteriores al ÚLTIMO mensaje
 * ENTRANTE del cliente. Fuera de ahí solo pasa una plantilla aprobada (HSM).
 *
 * Es la misma cuenta que ya hacen reengage.ts (24 h exactas desde
 * MAX(messages.created_at) con role='user') y segments.ts; aquí se aísla para
 * que el inbox móvil pueda PINTAR el estado antes de que el proveedor rebote,
 * en vez de descubrirlo con un 409 críptico.
 */

export const WA_WINDOW_MS = 24 * 3600_000;
/** A menos de esto para cerrar, la app avisa "te quedan X horas". */
export const CLOSING_MS = 3 * 3600_000;

export type WindowState = "open" | "closing" | "closed";

export interface WaWindow {
  state: WindowState;
  until: number;
}

/**
 * Canales cuyo mensaje iniciado por el negocio cae bajo la ventana de Meta.
 * `zernio` NO está aquí: es multi-plataforma y se resuelve por su
 * `zernio_ctx.platform` (ver isWindowedChannel).
 *
 * manychat/messenger están en el WINDOWED de reengage (también son de Meta)
 * pero quedan FUERA de v3: no hay listado de plantillas confiable para ellos,
 * así que reportan `window: null` y un free-form fuera de ventana sigue
 * rebotando con el error crudo del proveedor — el comportamiento de hoy, sin
 * regresión.
 */
export const WINDOWED_TEMPLATE_CHANNELS: ReadonlySet<string> = new Set([
  "twilio",
  "whatsapp",
  "kapso",
  "ycloud",
]);

/** ¿Este canal (con su plataforma de Zernio, si aplica) tiene ventana de 24 h? */
export function isWindowedChannel(channel: string, zernioPlatform: string | null): boolean {
  if (WINDOWED_TEMPLATE_CHANNELS.has(channel)) return true;
  return channel === "zernio" && (zernioPlatform ?? "").toLowerCase() === "whatsapp";
}

/**
 * Estado de la ventana a partir del último mensaje ENTRANTE del cliente.
 * `lastUserAt` null = nunca escribió → fuera de ventana (until 0).
 */
export function computeWindow(lastUserAt: number | null, now: number = Date.now()): WaWindow {
  if (!lastUserAt) return { state: "closed", until: 0 };
  const until = lastUserAt + WA_WINDOW_MS;
  if (now >= until) return { state: "closed", until };
  return { state: until - now < CLOSING_MS ? "closing" : "open", until };
}
