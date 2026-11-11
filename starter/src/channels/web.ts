import type { ChannelAdapter, IncomingMessage, OutgoingReply, SendOptions } from "./shared";
import type { Env } from "../env";

/**
 * Canal WEB — el chat de demo que se le enseña a un prospecto en vivo.
 *
 * Diferencia clave con Telegram/WhatsApp/Meta: ahí la respuesta se EMPUJA a la
 * API del proveedor. Aquí no hay proveedor — el navegador es el canal. El
 * agente ya persiste cada turno en D1 (`messages`), así que la página recoge la
 * respuesta con polling en `GET /demo/poll` y `sendReply` no tiene nada que
 * mandar. Mantenerlo como no-op es intencional: así el canal web reusa TODO el
 * pipeline del agente (buffer, tools, KB, handoff) sin ramas especiales.
 */
export const webAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, _env: Env): Promise<IncomingMessage> {
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      text?: string;
      name?: string;
    };

    const sessionId = (body.sessionId ?? "").trim();
    const text = (body.text ?? "").trim();
    if (!sessionId || !text) {
      throw new Error("web: falta sessionId o text");
    }

    return {
      channel: "web",
      // El sessionId lo genera el navegador (uuid). Acotado para que no se use
      // como vector de basura contra el nombre del Durable Object.
      channelUserId: sessionId.slice(0, 64),
      displayName: (body.name ?? "").trim().slice(0, 60) || undefined,
      text: text.slice(0, 2000),
      receivedAt: Date.now(),
      rawPayload: body,
    };
  },

  /** No-op: la respuesta ya quedó en D1 y el navegador la lee por polling.
   *  Tampoco hay nada que fallar en modo strict — no hay proveedor que rechace
   *  (esto también cubre el canal `test` del inbox móvil, que reusa este
   *  adapter). */
  async sendReply(_reply: OutgoingReply, _env: Env, _opts?: SendOptions): Promise<void> {},
};
