// Enruta los mensajes del DUEÑO (su WhatsApp) al agente-dueño en Grok, en vez de
// al bot de clientes. Mantiene el historial en D1 y responde por Twilio.
import type { Env } from "../env";
import type { IncomingMessage } from "../channels/shared";
import { Db } from "../db/client";
import { twilioAdapter } from "../channels/twilio";
import { runOwnerAgent } from "./agent";
import { loadSession, saveSession, resetSession } from "./session";

/**
 * ¿El mensaje viene del dueño? Compara solo dígitos. Tolera variaciones de
 * formato (el "1" móvil de México: +52 vs +521, etc.) comparando los últimos 10
 * dígitos (número nacional) cuando no hay match exacto.
 */
export function isOwner(channelUserId: string, ownerNumber: string | undefined): boolean {
  if (!ownerNumber) return false;
  const digits = (s: string) => s.replace(/\D/g, "");
  const a = digits(channelUserId);
  const b = digits(ownerNumber);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length >= 10 && b.length >= 10 && a.slice(-10) === b.slice(-10);
}

async function reply(msg: IncomingMessage, text: string, env: Env): Promise<void> {
  await twilioAdapter.sendReply(
    { channel: "twilio", channelUserId: msg.channelUserId, chunks: [text] },
    env,
  );
}

export async function handleOwnerMessage(msg: IncomingMessage, env: Env): Promise<void> {
  const db = new Db(env.DB);
  const text = (msg.text ?? "").trim();
  if (!text) {
    await reply(msg, "Mándame texto: la URL del reel + la keyword + el recurso. (Escribe 'reset' para empezar de cero.)", env);
    return;
  }
  if (/^(reset|reiniciar|nuevo)$/i.test(text)) {
    await resetSession(db);
    await reply(msg, "Listo, empecé de cero 🧹 Pásame la URL del reel + la keyword + el recurso.", env);
    return;
  }
  const history = await loadSession(db);
  history.push({ role: "user", content: text });
  const { reply: out, messages } = await runOwnerAgent(history, env);
  await saveSession(db, messages);
  await reply(msg, out || "(sin respuesta)", env);
}
