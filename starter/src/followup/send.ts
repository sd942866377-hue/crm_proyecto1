/**
 * Envío outbound compartido por los superpoderes de seguimiento (encuestas,
 * reseñas, re-enganche): persiste el mensaje como del asistente (visible en la
 * Bandeja), toca la conversación y lo manda por el adapter del canal.
 *
 * Enviar SIEMPRE dentro de la ventana de 24 h del último mensaje del cliente —
 * así el free-form es válido en todos los canales (WhatsApp incluido), igual
 * que hace el follow-up. Los jobs que usan esto ya filtran por esa ventana.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { ConversationsRepo } from "../db/conversations";
import { pickAdapter } from "../replies/sender";
import type { ChannelId } from "../channels/shared";

/** Manda un texto a una conversación y lo deja registrado. Lanza si el canal
 *  rechaza el envío (el llamador lo captura por candidato). */
export async function sendOutbound(
  env: Env,
  target: { conversationId: string; channel: string; channelUserId: string; text: string },
  now: number = Date.now(),
): Promise<void> {
  const db = new Db(env.DB);
  await new MessagesRepo(db).append(target.conversationId, "assistant", target.text);
  await new ConversationsRepo(db).touchLastMessage(target.conversationId, now);
  const adapter = pickAdapter(target.channel as ChannelId);
  await adapter.sendReply(
    {
      channel: target.channel as ChannelId,
      channelUserId: target.channelUserId,
      chunks: [target.text],
      interChunkDelayMs: 0,
    },
    env,
  );
}
