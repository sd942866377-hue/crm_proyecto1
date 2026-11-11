// Canal WhatsApp por YCLOUD — BSP oficial de WhatsApp con COEXISTENCIA y zero-markup.
//
// Como Kapso, conserva la app de WhatsApp Business en el mismo número (coexistencia
// de Meta): el negocio sigue respondiendo a mano desde su app y el bot también
// contesta. Diferencias con Kapso que marcan este adapter:
//  • Enviar:  POST api.ycloud.com/v2/whatsapp/messages/sendDirectly con X-API-Key.
//             El emisor es el NÚMERO en E.164 (`from`), NO un phone_number_id.
//  • Recibir: eventos YCloud. El media NO es público ni viene transcrito: los
//             `link` de audio/imagen exigen X-API-Key para descargar → los servimos
//             por un proxy FIRMADO (como el Cloud API), y Forja transcribe el audio.
//  • Firma:   YCloud-Signature: t=<unix>,s=<hex>, s = HMAC-SHA256(secret, "<t>.<body>")
//             — tipo Stripe, con validación de timestamp (anti-replay).
//
// COEXISTENCIA: cuando el dueño responde a un cliente DESDE SU APP, YCloud emite el
// evento `whatsapp.smb.message.echoes` (el tipo de evento YA identifica que es del
// business app — los mensajes que el bot manda por la API generan
// `whatsapp.message.updated` de status, no echoes). El adapter pausa esa conversación
// (takeover), igual que en Kapso.
import type { ChannelAdapter, IncomingMessage, OutgoingReply, SendOptions } from "./shared";
import { reportSendFailure } from "./shared";
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { resolveTakeoverMs } from "../db/settings";

const YCLOUD_BASE = "https://api.ycloud.com/v2";
const MEDIA_TTL_MS = 10 * 60 * 1000; // la URL firmada del proxy vive 10 min
const SIG_TOLERANCE_S = 5 * 60; // ±5 min de tolerancia para el timestamp de la firma

interface YCloudMedia {
  link?: string;
  id?: string;
  caption?: string;
  mime_type?: string;
}

interface YCloudInboundMessage {
  id?: string;
  wamid?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: { body?: string };
  image?: YCloudMedia;
  audio?: YCloudMedia;
  document?: YCloudMedia & { filename?: string };
  customerProfile?: { name?: string; username?: string };
}

interface YCloudEchoMessage {
  wamid?: string;
  from?: string; // negocio
  to?: string; // cliente
  type?: string;
  customerProfile?: { name?: string };
}

interface YCloudWebhookBody {
  id?: string;
  type?: string; // whatsapp.inbound_message.received | whatsapp.smb.message.echoes | …
  apiVersion?: string;
  whatsappInboundMessage?: YCloudInboundMessage;
  whatsappMessage?: YCloudEchoMessage;
}

/** Número → solo dígitos, para un channelUserId estable entre recibir y enviar. */
function normPhone(p: string | undefined | null): string {
  return (p ?? "").replace(/[^\d]/g, "");
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifica la firma del webhook de YCloud (tipo Stripe). Header:
 * `YCloud-Signature: t=<unix_s>,s=<hex>`, con s = HMAC-SHA256(secret, "<t>.<rawBody>").
 * Fail-closed: sin secret/header, o con timestamp fuera de tolerancia (anti-replay), false.
 * Verifica SIEMPRE contra los bytes crudos, antes de parsear el JSON.
 */
export async function verifyYCloudSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string | undefined,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!secret || !header) return false;
  const parts: Record<string, string> = {};
  for (const kv of header.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = parts.t;
  const s = parts.s;
  if (!t || !s) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > SIG_TOLERANCE_S) return false; // replay
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, s);
}

/** Construye la URL firmada del proxy para un media id (o null si no hay secret/base). */
async function signedMediaUrl(mediaId: string, env: Env, origin: string): Promise<string | null> {
  const secret = env.YCLOUD_WEBHOOK_SECRET || env.YCLOUD_API_KEY || "";
  const base = (origin || env.DASHBOARD_BASE_URL || "").replace(/\/$/, "");
  if (!secret || !base) return null;
  const exp = Date.now() + MEDIA_TTL_MS;
  const sig = await hmacHex(secret, `${mediaId}.${exp}`);
  return `${base}/webhooks/ycloud/media/${encodeURIComponent(mediaId)}?exp=${exp}&sig=${sig}`;
}

/**
 * Sirve el media entrante de YCloud: valida la firma HMAC + expiración, descarga el
 * archivo de YCloud (`/whatsapp/media/download/<id>` con X-API-Key) y devuelve los
 * bytes. Público pero firmado — el X-API-Key nunca sale del server. Lo usa la ruta
 * GET /webhooks/ycloud/media/:id (ver index.ts).
 */
export async function serveYCloudMedia(
  mediaId: string,
  exp: string | null,
  sig: string | null,
  env: Env,
): Promise<Response> {
  const secret = env.YCLOUD_WEBHOOK_SECRET || env.YCLOUD_API_KEY || "";
  const apiKey = env.YCLOUD_API_KEY;
  if (!secret || !apiKey) return new Response("not configured", { status: 404 });
  const expNum = Number(exp);
  if (!exp || !sig || !Number.isFinite(expNum)) return new Response("bad request", { status: 400 });
  if (Date.now() > expNum) return new Response("expired", { status: 410 });
  const expected = await hmacHex(secret, `${mediaId}.${exp}`);
  if (!timingSafeEqual(expected, sig)) return new Response("bad signature", { status: 403 });

  const res = await fetch(`${YCLOUD_BASE}/whatsapp/media/download/${encodeURIComponent(mediaId)}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) return new Response("media download failed", { status: 502 });
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return new Response(res.body, { status: 200, headers: { "Content-Type": contentType } });
}

/**
 * Normaliza el cuerpo del webhook a una lista de eventos. YCloud manda un evento por
 * POST (sin buffering), pero por robustez toleramos un array o `{ items: [...] }` sin
 * perder mensajes en silencio.
 */
export function normalizeYCloudEvents(body: unknown): YCloudWebhookBody[] {
  if (Array.isArray(body)) return body as YCloudWebhookBody[];
  const b = body as { items?: unknown } | null;
  if (b && Array.isArray(b.items)) return b.items as YCloudWebhookBody[];
  return [body as YCloudWebhookBody];
}

/**
 * Convierte un evento `whatsapp.inbound_message.received` de YCloud en 0..1 mensajes
 * entrantes (texto, imagen, audio). Otros tipos (echoes, status, …) devuelven [].
 * `origin` es la base pública del worker, para firmar las URLs de media entrante.
 */
export async function parseYCloudEvents(
  body: YCloudWebhookBody,
  env: Env,
  origin: string,
): Promise<IncomingMessage[]> {
  if (body.type && body.type !== "whatsapp.inbound_message.received") return [];
  const m = body.whatsappInboundMessage;
  if (!m) return [];
  const from = normPhone(m.from);
  if (!from) return [];

  let text: string | undefined;
  let audioUrl: string | undefined;
  let imageUrl: string | undefined;
  let fileUrl: string | undefined;

  if (m.type === "text") {
    text = m.text?.body || undefined;
  } else if (m.type === "image" && m.image?.id) {
    imageUrl = (await signedMediaUrl(m.image.id, env, origin)) ?? undefined;
    text = m.image.caption || undefined;
  } else if (m.type === "audio" && m.audio?.id) {
    audioUrl = (await signedMediaUrl(m.audio.id, env, origin)) ?? undefined;
  } else if (m.type === "document" && m.document?.id) {
    // Documento/PDF: el bot no lo lee, pero se archiva y escala a una persona.
    fileUrl = (await signedMediaUrl(m.document.id, env, origin)) ?? undefined;
    text = m.document.caption || undefined;
  } else {
    return []; // video/location/… no soportados aún
  }

  if (!text && !audioUrl && !imageUrl && !fileUrl) return [];

  console.log(
    "ycloud in:",
    JSON.stringify({ from, type: m.type, hasText: !!text, hasAudio: !!audioUrl, hasImage: !!imageUrl, hasFile: !!fileUrl }),
  );

  return [
    {
      channel: "ycloud",
      channelUserId: from,
      displayName: m.customerProfile?.name || undefined,
      text,
      audioUrl,
      imageUrl,
      fileUrl,
      fileName: m.document?.filename,
      fileMime: m.document?.mime_type,
      isOwnerMessage: false,
      receivedAt: Date.now(),
      rawPayload: m,
      providerMessageId: m.wamid || m.id,
    },
  ];
}

/**
 * COEXISTENCIA. Evento `whatsapp.smb.message.echoes`: el dueño respondió a un cliente
 * DESDE SU APP de WhatsApp Business. Pausa esa conversación (takeover), igual que el
 * panel — para que el bot no responda encima. El cliente es `whatsappMessage.to`.
 * Devuelve true si pausó.
 */
export async function ycloudOwnerTakeover(body: YCloudWebhookBody, env: Env): Promise<boolean> {
  if (body.type !== "whatsapp.smb.message.echoes") return false;
  const phone = normPhone(body.whatsappMessage?.to);
  if (!phone) return false;
  const convs = new ConversationsRepo(new Db(env.DB));
  const conv = await convs.getOrCreate("ycloud", phone, body.whatsappMessage?.customerProfile?.name);
  await convs.setPausedUntil(conv.id, Date.now() + (await resolveTakeoverMs(env)));
  console.log("ycloud coexistence: owner replied from app → paused", JSON.stringify({ phone }));
  return true;
}

export const ycloudAdapter: ChannelAdapter = {
  // Existe por la interfaz ChannelAdapter; la ruta /webhooks/ycloud usa
  // parseYCloudEvents directamente (y desvía los echoes a ycloudOwnerTakeover).
  async parseIncoming(request: Request, env: Env): Promise<IncomingMessage> {
    const body = (await request.json()) as YCloudWebhookBody;
    const origin = new URL(request.url).origin;
    const [first] = await parseYCloudEvents(body, env, origin);
    if (!first) throw new Error("ycloud webhook sin mensaje procesable");
    return first;
  },

  async sendReply(reply: OutgoingReply, env: Env, opts?: SendOptions): Promise<void> {
    const from = env.YCLOUD_WA_FROM;
    const apiKey = env.YCLOUD_API_KEY;
    if (!from || !apiKey) {
      throw new Error("YCloud: falta YCLOUD_WA_FROM o YCLOUD_API_KEY.");
    }
    const url = `${YCLOUD_BASE}/whatsapp/messages/sendDirectly`;
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          from,
          to: `+${reply.channelUserId}`,
          type: "text",
          text: { body: reply.chunks[i] },
        }),
      });
      // Fuera de la ventana de 24h Meta rechaza texto libre (pide plantilla HSM):
      // logéalo con el cuerpo para ver el motivo exacto, no lo tragues en
      // silencio. En strict además lanza para que la app pinte el motivo.
      if (!res.ok) await reportSendFailure("ycloud sendReply", res, opts);
    }
    // Galería: cada archivo va como mensaje propio DESPUÉS del texto (YCloud
    // espeja la Cloud API: image jpg/png ≤5MB, audio aac/mp3/ogg ≤16MB, por link).
    for (const m of reply.media ?? []) {
      const payload =
        m.kind === "image"
          ? { from, to: `+${reply.channelUserId}`, type: "image", image: { link: m.url, ...(m.caption ? { caption: m.caption } : {}) } }
          : m.kind === "video"
            ? { from, to: `+${reply.channelUserId}`, type: "video", video: { link: m.url, ...(m.caption ? { caption: m.caption } : {}) } }
            : m.kind === "file"
              ? { from, to: `+${reply.channelUserId}`, type: "document", document: { link: m.url, ...(m.filename ? { filename: m.filename } : {}), ...(m.caption ? { caption: m.caption } : {}) } }
              : { from, to: `+${reply.channelUserId}`, type: "audio", audio: { link: m.url } };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(payload),
      });
      if (!res.ok) await reportSendFailure("ycloud media send", res, opts);
    }
  },
};

// Envío de PLANTILLA HSM por YCloud (para reenganchar fuera de la ventana de 24h).
// Referencia por nombre + idioma (igual que la Cloud API). `bodyParams` llena
// {{1}}, {{2}}… en orden; la convención de Forja es {{1}} = nombre del cliente.
export async function sendYCloudTemplate(
  env: Env,
  to: string,
  name: string,
  lang: string,
  bodyParams: string[] = [],
): Promise<void> {
  const from = env.YCLOUD_WA_FROM;
  const apiKey = env.YCLOUD_API_KEY;
  if (!from || !apiKey) {
    throw new Error("YCloud: falta YCLOUD_WA_FROM o YCLOUD_API_KEY.");
  }
  const components = bodyParams.length
    ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }]
    : [];
  const res = await fetch(`${YCLOUD_BASE}/whatsapp/messages/sendDirectly`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      from,
      to: to.startsWith("+") ? to : `+${to}`,
      type: "template",
      template: {
        name,
        language: { code: lang || "es" },
        ...(components.length ? { components } : {}),
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`ycloud template ${res.status}: ${errBody}`);
  }
}
