// `test` = chat de prueba de la app (Forja Inbox): el dueño/instalador le
// escribe a su propio bot. Usa el pipeline REAL pero queda fuera de la bandeja
// y de todas las métricas — ver src/db/testFilter.ts.
export type ChannelId = "manychat" | "telegram" | "twilio" | "messenger" | "instagram" | "whatsapp" | "kapso" | "ycloud" | "web" | "zernio" | "test";

// El proveedor mandó un update que NO es un mensaje procesable (Telegram:
// edited_message, callback_query, my_chat_member…). NO es un error de infra:
// hay que responder 200 para que el canal no lo reintente en loop. parseIncoming
// la lanza; routeToAgent la traduce a un 200 "ignorado".
export class IgnoredUpdate extends Error {
  constructor(reason = "update ignorado") {
    super(reason);
    this.name = "IgnoredUpdate";
  }
}

export interface IncomingMessage {
  channel: ChannelId;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  /** Duración de la nota de voz en segundos, cuando el canal la trae. */
  audioDurationS?: number;
  imageUrl?: string;
  /** Documento/PDF del cliente. El bot NO lo lee: lo archiva, lo muestra en el
   *  hilo y escala la conversación a una persona (ver agent.ts processMedia).
   *  Antes de esto, un documento se perdía en silencio en todos los canales. */
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
  isOwnerMessage?: boolean;
  receivedAt: number;
  rawPayload: unknown;
  /** id del mensaje en el proveedor (Meta mid / WhatsApp id) — dedup de
   *  reenvíos del webhook. Opcional: canales sin id no deduplican. */
  providerMessageId?: string;
}

// Botón tocable (opt-in, ver skill/botones.md). El tap regresa como mensaje de
// texto normal (el título o el payload), así el cerebro no cambia.
export interface ReplyButton {
  title: string; // lo que ve el cliente (≤20 chars — límite de WhatsApp)
  payload: string; // id que regresa en el tap donde la plataforma lo soporta
}

// Canales que renderizan botones NATIVOS. El resto recibe el fallback numerado
// en texto (sender.ts) — nada se rompe, nadie ve el marcador crudo.
export const BUTTON_CHANNELS: ReadonlySet<ChannelId> = new Set([
  "telegram", "whatsapp", "zernio", "messenger", "instagram",
]);

// Archivo de la Galería (superpoder, ver skill/galeria.md) que el bot manda en
// la respuesta. `url` es pública (GET /media/:id del propio worker) — todos los
// proveedores descargan por link. `voice` = mandarlo como NOTA DE VOZ (PTT)
// donde el canal lo distingue (solo audio ogg/opus).
export interface ReplyMedia {
  kind: "image" | "audio" | "video" | "file";
  url: string;
  voice?: boolean;
  /** Caption opcional ([[media: id | texto]]). Nativo en WhatsApp/Telegram/
   *  Twilio/Zernio; en IG/Messenger/ManyChat va como mensaje de texto justo
   *  ANTES del archivo (sus APIs no soportan caption en attachments). */
  caption?: string;
  /** Nombre visible del documento (kind "file"). WhatsApp lo muestra en la
   *  burbuja; sin él el cliente ve un archivo sin nombre. */
  filename?: string;
}

// Canales que mandan media NATIVA (foto/audio como archivo). El resto recibe el
// link en texto (sender.ts) — nada se rompe, nadie ve el marcador crudo.
// manychat: imagen nativa, audio como link (IG vía ManyChat no acepta audio).
export const MEDIA_CHANNELS: ReadonlySet<ChannelId> = new Set([
  "telegram", "whatsapp", "twilio", "kapso", "ycloud", "zernio", "messenger", "instagram", "manychat",
]);

// Canales que mandan un DOCUMENTO nativo (kind "file"). Instagram y ManyChat
// NO: ahí el archivo va como link en texto — llega igual, sin burbuja bonita.
export const FILE_CHANNELS: ReadonlySet<ChannelId> = new Set([
  "telegram", "whatsapp", "twilio", "kapso", "ycloud", "zernio", "messenger",
]);

export interface OutgoingReply {
  channel: ChannelId;
  channelUserId: string;
  chunks: string[];
  interChunkDelayMs?: number;
  // Botones para el ÚLTIMO chunk (máx 3). Solo lo puebla sender.ts cuando el
  // modelo emite el marcador [[botones: …]] y el canal está en BUTTON_CHANNELS.
  buttons?: ReplyButton[];
  // Media de la Galería (máx 2). Solo lo puebla sender.ts cuando el modelo
  // emite [[media: id]] y el canal está en MEDIA_CHANNELS. Se manda DESPUÉS de
  // los chunks de texto, un mensaje por archivo.
  media?: ReplyMedia[];
}

/**
 * Opciones de envío. Hoy solo `strict`, y existe por una asimetría real:
 *
 *  • El bot contestando: si el proveedor rechaza UN archivo de la Galería, el
 *    turno NO se puede caer — el texto ya salió y el cliente está esperando. Se
 *    logea y se sigue. Ese es el comportamiento por default (sin strict).
 *  • Un HUMANO escribiendo desde el inbox móvil: ahí el silencio es lo peor que
 *    puede pasar. La app tiene que recibir un 409 `send_failed` con el motivo
 *    REAL del proveedor (ventana de 24h, número inválido…) y el bot no debe
 *    persistir nada — si no, el dueño ve su mensaje en el hilo y jura que salió.
 *
 * `strict: true` lo usan SOLO los tres caminos humanos de api-inbox.ts (texto,
 * media y plantilla).
 */
export interface SendOptions {
  strict?: boolean;
}

/**
 * Rechazo del proveedor: se logea SIEMPRE (con status y cuerpo, para poder
 * diagnosticar) y en modo strict además lanza con ese mismo detalle legible,
 * que es lo que la app pinta en el `detail` del 409.
 */
export async function reportSendFailure(
  etiqueta: string,
  res: Response,
  opts?: SendOptions,
): Promise<void> {
  const cuerpo = await res.text().catch(() => "");
  const detalle = `${etiqueta} ${res.status}${cuerpo ? `: ${cuerpo.slice(0, 300)}` : ""}`;
  console.error(detalle);
  if (opts?.strict) throw new Error(detalle);
}

export interface ChannelAdapter {
  parseIncoming(request: Request, env: any): Promise<IncomingMessage>;
  sendReply(reply: OutgoingReply, env: any, opts?: SendOptions): Promise<void>;
  showTyping?(channelUserId: string, env: any): Promise<void>;
}
