import type { ChannelAdapter, IncomingMessage, OutgoingReply, SendOptions } from "./shared";
import { reportSendFailure } from "./shared";
import type { Env } from "../env";

const MANYCHAT_API = "https://api.manychat.com/fb";

// Aligned with Santi's production n8n flow ("CHATBOT DEF V PRO"):
// - ManyChat posts the subscriber in `id` (NOT `subscriber_id`).
// - The text arrives in `last_input_text`.
// - sendContent REQUIRES `content.type` to match the channel (instagram /
//   whatsapp / etc.) — without it the message is rejected for IG.
// The original message timestamp (e.g. `ig_last_interaction`) is intentionally
// ignored; we stamp `receivedAt` with the bot's own clock to avoid the
// per-channel timestamp-format transformations ManyChat would otherwise need.
interface ManychatPayload {
  id: string | number;
  // fallback for setups that send subscriber_id instead of id
  subscriber_id?: string | number;
  first_name?: string;
  last_name?: string;
  last_input_text?: string;
  attachments?: { type: string; payload: { url: string } }[] | string;
  custom_fields?: Record<string, string>;
}

const IMG_EXT = /\.(jpe?g|png|gif|webp|heic)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|mp4|m4a|ogg|oga|wav|aac|webm|amr)(\?|#|$)/i;
// CDNs de Meta desde donde ManyChat entrega el media de IG (el contrato real:
// cuando el usuario manda foto/audio, ManyChat pone ese link COMO last_input_text).
const MEDIA_HOSTS = /(lookaside\.fbsbx\.com|fbsbx\.com|cdninstagram\.com|fbcdn\.net|manychat)/i;
// CDNs de Meta que entregan MEDIA por contrato (ig_messaging_cdn, fotos de IG):
// si el probe de Content-Type queda inconcluso, estos son imagen —no texto—.
// (No incluye "manychat" a secas: un link genérico de manychat.com no es media.)
const STRONG_MEDIA_CDN = /(lookaside\.fbsbx\.com|cdninstagram\.com|fbcdn\.net)/i;

/** Si el texto completo es un solo URL, lo devuelve; si trae más palabras, null. */
function soleUrl(text: string | undefined): string | null {
  const t = (text ?? "").trim();
  return /^https?:\/\/\S+$/.test(t) ? t : null;
}

/** Clasifica un URL de media: por extensión y, si no alcanza, sondeando el
 * Content-Type (el "patch" del flujo n8n original de Santi). mp4/video cuenta
 * como audio: las notas de voz de IG llegan como mp4 y Whisper las transcribe. */
async function classifyMediaUrl(url: string): Promise<"image" | "audio" | null> {
  if (IMG_EXT.test(url)) return "image";
  if (AUDIO_EXT.test(url)) return "audio";
  if (!MEDIA_HOSTS.test(url)) return null;
  // Meta le devuelve HTML a clientes sin UA de navegador → el probe salía
  // inconcluso y todo caía al default "image". Con UA sí manda el content-type
  // real y distingue nota de voz (audio) de foto.
  const uaHeaders = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    Accept: "image/*,audio/*,video/*,*/*;q=0.8",
  };
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", headers: uaHeaders });
    if (!res.ok || !res.headers.get("content-type")) {
      res = await fetch(url, {
        headers: { ...uaHeaders, Range: "bytes=0-0" },
        redirect: "follow",
      });
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct.startsWith("image/")) return "image";
    if (ct.startsWith("audio/") || ct.startsWith("video/")) return "audio";
  } catch {
    // la sonda es best-effort: si falla, caemos al default de abajo.
  }
  // Probe inconcluso (Meta a veces no manda content-type, o el fetch falla): si
  // es un CDN de media de Meta, es imagen por contrato. NO lo tires a texto —esas
  // URLs firmadas expiran y se verían como link crudo en la bandeja.
  if (STRONG_MEDIA_CDN.test(url)) return "image";
  return null;
}

/** ManyChat a veces manda attachments como JSON-string (mapeo de texto en el
 * External Request) y con tipos variados (image/file/story_mention). Se
 * normaliza todo a una lista { type, url }. */
function normalizeAttachments(raw: ManychatPayload["attachments"]): { type: string; url: string }[] {
  let list: unknown = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      // Un solo URL pegado como texto también cuenta.
      return IMG_EXT.test(list as string) ? [{ type: "image", url: list as string }] : [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: { type: string; url: string }[] = [];
  for (const a of list) {
    const url: string = a?.payload?.url ?? a?.url ?? "";
    if (!url) continue;
    let type: string = a?.type ?? "";
    // story_mention / share / file con extensión de imagen → tratarlo como imagen.
    if (type !== "image" && type !== "audio" && (IMG_EXT.test(url) || type === "story_mention")) type = "image";
    out.push({ type, url });
  }
  return out;
}

export const manychatAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, _env: Env): Promise<IncomingMessage> {
    const body = (await request.json()) as ManychatPayload;
    const subscriber = body.id ?? body.subscriber_id;
    const displayName =
      [body.first_name, body.last_name].filter(Boolean).join(" ").trim() || undefined;
    const atts = normalizeAttachments(body.attachments);
    let audioUrl = atts.find((a) => a.type === "audio")?.url;
    let imageUrl = atts.find((a) => a.type === "image")?.url;
    let text =
      body.last_input_text && body.last_input_text !== "[audio]"
        ? body.last_input_text
        : undefined;
    // El contrato real de IG vía ManyChat: cuando el usuario manda foto o nota
    // de voz, el "texto" del mensaje ES el link del CDN de Meta. Se detecta y
    // se rutea a visión/transcripción en vez de dárselo al modelo como texto.
    if (text && !audioUrl && !imageUrl) {
      const u = soleUrl(text);
      if (u) {
        const kind = await classifyMediaUrl(u);
        if (kind === "image") { imageUrl = u; text = undefined; }
        else if (kind === "audio") { audioUrl = u; text = undefined; }
      }
    }
    // Diagnóstico: qué llegó realmente. Si no hay ni texto ni media (el caso
    // "mandó una imagen y no pasó nada"), se loguea el body completo para ver
    // qué campos está mapeando el flow de ManyChat.
    console.log(
      "[manychat]",
      JSON.stringify({ sub: String(subscriber), hasText: !!text, img: !!imageUrl, aud: !!audioUrl, atts: atts.map((a) => a.type) }),
    );
    if (!text && !audioUrl && !imageUrl) console.log("[manychat] payload sin texto/media:", JSON.stringify(body).slice(0, 1500));
    return {
      channel: "manychat",
      channelUserId: String(subscriber),
      displayName,
      text,
      audioUrl,
      imageUrl,
      isOwnerMessage: false, // ManyChat outbound owner msgs do not hit this webhook
      receivedAt: Date.now(),
      rawPayload: body,
    };
  },

  async sendReply(reply: OutgoingReply, env: Env, opts?: SendOptions): Promise<void> {
    const apiKey = env.MANYCHAT_API_KEY;
    if (!apiKey) throw new Error("MANYCHAT_API_KEY not set");
    // ManyChat needs the content type to match the channel (instagram is the
    // default since that's Santi's primary IG flow).
    const contentType = env.MANYCHAT_CONTENT_TYPE ?? "instagram";
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const res = await fetch(`${MANYCHAT_API}/sending/sendContent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscriber_id: reply.channelUserId,
          data: {
            version: "v2",
            content: {
              type: contentType,
              messages: [{ type: "text", text: reply.chunks[i] }],
            },
          },
        }),
      });
      // ManyChat rechaza en silencio (content type != canal, subscriber fuera de
      // la ventana de 24h…) devolviendo 4xx con detalle. Sin esto el mensaje se
      // pierde y es imposible diagnosticar por qué el cliente no recibió nada.
      // En strict además lanza: la app necesita ese detalle.
      if (!res.ok) await reportSendFailure(`[manychat sendContent] (type=${contentType})`, res, opts);
    }
    // Galería: cada archivo va como mensaje propio DESPUÉS del texto. Imagen y
    // audio se intentan NATIVOS ({type:"image"|"audio", url}); si ManyChat
    // rechaza el audio en este canal, cae a mandar el link — nunca se pierde.
    const mandaContenido = async (mensajes: Record<string, string>[]) =>
      fetch(`${MANYCHAT_API}/sending/sendContent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subscriber_id: reply.channelUserId,
          data: {
            version: "v2",
            content: { type: contentType, messages: mensajes },
          },
        }),
      });
    for (const m of reply.media ?? []) {
      // IG/Messenger no soportan caption en attachments → el caption va como
      // mensaje de texto en el MISMO sendContent, justo ANTES del archivo.
      // Audio ogg (voice=true) en Instagram: IG lo descarga y lo TIRA en
      // silencio (visto en prueba real) → mejor el link directo, que sí llega.
      const oggEnIG = m.kind === "audio" && m.voice && contentType === "instagram";
      const mensajes: Record<string, string>[] = [];
      if (m.caption) mensajes.push({ type: "text", text: m.caption });
      mensajes.push(oggEnIG ? { type: "text", text: m.url } : { type: m.kind, url: m.url });
      const res = await mandaContenido(mensajes);
      if (!res.ok) {
        const cuerpo = await res.text().catch(() => "<sin cuerpo>");
        console.error(`[manychat media send] ${res.status} (type=${contentType}) →`, cuerpo);
        if (m.kind === "audio") {
          // Canal sin audio saliente → el link como texto (con su caption si no salió).
          const fallback: Record<string, string>[] = [];
          if (m.caption) fallback.push({ type: "text", text: m.caption });
          fallback.push({ type: "text", text: m.url });
          const res2 = await mandaContenido(fallback);
          // OJO con strict: si el fallback SÍ entregó el link, el cliente ya lo
          // recibió — lanzar aquí haría que la app borrara el archivo y pintara
          // un error por un mensaje que sí llegó. Solo lanza si tampoco entró.
          if (!res2.ok) await reportSendFailure("[manychat audio fallback]", res2, opts);
        } else if (opts?.strict) {
          throw new Error(`[manychat media send] ${res.status} (type=${contentType}): ${cuerpo.slice(0, 300)}`);
        }
      }
    }
  },
};
