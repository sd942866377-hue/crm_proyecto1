// Canal WhatsApp por KAPSO — extra a Twilio y a la Cloud API oficial.
//
// Kapso es un PROXY sobre la Cloud API de Meta. Su gran diferenciador es la
// COEXISTENCIA: el negocio conecta su MISMO número y sigue usando su app de
// WhatsApp Business mientras el bot también contesta (Twilio obliga a migrar el
// número y perder la app).
//
//  • Enviar:  POST api.kapso.ai/meta/whatsapp/<v>/<phone_number_id>/messages
//             con header X-API-Key (NO Bearer). Body igual que la Cloud API.
//  • Recibir: webhook de EVENTOS de Kapso (kind=kapso, payload v2). A diferencia
//             de la Cloud API cruda, el audio ya viene TRANSCRITO
//             (message.kapso.transcript.text) y el media ya viene RESUELTO a una
//             URL pública (message.kapso.media_url) — nada de proxy firmado.
//  • Firma:   X-Webhook-Signature = HMAC-SHA256(KAPSO_WEBHOOK_SECRET, rawBody) hex.
//
// COEXISTENCIA (lo que la hace funcionar bien): cuando el dueño le responde a un
// cliente DESDE SU APP, Kapso emite whatsapp.message.sent con
// message.kapso.origin="business_app". El adapter lo detecta y PAUSA esa
// conversación (mismo takeover que el panel), para que el bot no responda encima.
// Un origin "cloud_api" es el eco del propio bot → se ignora. No hay que
// recordar ids: el campo `origin` ya distingue el origen.
import type { ChannelAdapter, IncomingMessage, OutgoingReply, SendOptions } from "./shared";
import { reportSendFailure } from "./shared";
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { resolveTakeoverMs } from "../db/settings";

const KAPSO_BASE = "https://api.kapso.ai";
const GRAPH_VERSION = "v24.0"; // versión Graph que Kapso proxya (META_GRAPH_VERSION default)

interface KapsoMessage {
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
  document?: { id?: string; filename?: string; caption?: string; mime_type?: string };
  kapso?: {
    direction?: "inbound" | "outbound";
    origin?: "cloud_api" | "business_app" | "history_sync";
    status?: string;
    has_media?: boolean;
    content?: string;
    transcript?: { text?: string };
    media_url?: string;
    message_type_data?: { caption?: string };
  };
}

interface KapsoConversation {
  id?: string;
  phone_number?: string;
  phone_number_id?: string;
  kapso?: { contact_name?: string };
}

interface KapsoWebhookBody {
  message?: KapsoMessage;
  conversation?: KapsoConversation;
  phone_number_id?: string;
  is_new_conversation?: boolean;
}

/** Número → solo dígitos, para un channelUserId estable entre recibir y enviar. */
function normPhone(p: string | undefined | null): string {
  return (p ?? "").replace(/[^\d]/g, "");
}

/**
 * Normaliza el cuerpo del webhook a una lista de eventos individuales. Caso
 * normal (buffering OFF, lo recomendado — Forja ya bufferea en el DO): un evento
 * por POST → `[body]`. Si alguien activa el buffering de Kapso (`buffer_enabled`,
 * header `X-Webhook-Batch: true`), el cuerpo puede venir como un ARRAY de eventos
 * o como `{ events: [...] }`: lo expandimos para NO perder mensajes en silencio.
 */
export function normalizeKapsoEvents(body: unknown): KapsoWebhookBody[] {
  if (Array.isArray(body)) return body as KapsoWebhookBody[];
  const b = body as { events?: unknown } | null;
  if (b && Array.isArray(b.events)) return b.events as KapsoWebhookBody[];
  return [body as KapsoWebhookBody];
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
 * Verifica la firma del webhook de Kapso: HMAC-SHA256(secret, rawBody) en hex,
 * contra el header X-Webhook-Signature. Fail-closed: sin secret o sin firma,
 * false. SIEMPRE contra los bytes crudos, antes de parsear el JSON.
 */
export async function verifyKapsoSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret || !signature) return false;
  const expected = await hmacHex(secret, rawBody);
  return timingSafeEqual(expected, signature.trim());
}

/**
 * Convierte un evento `whatsapp.message.received` de Kapso en 0..1 mensajes
 * entrantes. Solo procesa `direction: inbound` y tipos soportados (texto,
 * imagen, audio). Los eventos outbound/status/conversation devuelven [] (los
 * maneja kapsoOwnerTakeover o simplemente se ignoran con 200).
 */
export async function parseKapsoEvents(body: KapsoWebhookBody, _env: Env): Promise<IncomingMessage[]> {
  const m = body.message;
  const k = m?.kapso;
  if (!m || !k) return [];
  if (k.direction && k.direction !== "inbound") return []; // sent/delivered/read/failed
  const from = normPhone(body.conversation?.phone_number);
  if (!from) return [];

  let text: string | undefined;
  let audioUrl: string | undefined;
  let imageUrl: string | undefined;
  let fileUrl: string | undefined;

  if (m.type === "text") {
    text = m.text?.body || undefined;
  } else if (m.type === "image") {
    imageUrl = k.media_url || undefined;
    text = m.image?.caption || k.message_type_data?.caption || undefined;
  } else if (m.type === "audio") {
    // Kapso ya transcribió la nota de voz → usamos el texto directo (sin re-
    // transcribir). Si el transcript vino vacío, caemos al audio para que el
    // pipeline de Forja lo transcriba con media_url.
    const t = k.transcript?.text?.trim();
    if (t) text = t;
    else audioUrl = k.media_url || undefined;
  } else if (m.type === "document") {
    // Kapso ya resuelve el media a una URL pública (media_url) — sin proxy.
    fileUrl = k.media_url || undefined;
    text = m.document?.caption || k.message_type_data?.caption || undefined;
  } else {
    return []; // location/template/interactive/reaction/… no soportados aún
  }

  if (!text && !audioUrl && !imageUrl && !fileUrl) return [];

  console.log(
    "kapso in:",
    JSON.stringify({ from, type: m.type, hasText: !!text, hasAudio: !!audioUrl, hasImage: !!imageUrl, hasFile: !!fileUrl }),
  );

  return [
    {
      channel: "kapso",
      channelUserId: from,
      displayName: body.conversation?.kapso?.contact_name || undefined,
      text,
      audioUrl,
      imageUrl,
      fileUrl,
      fileName: m.document?.filename,
      fileMime: m.document?.mime_type,
      isOwnerMessage: false,
      receivedAt: Date.now(),
      rawPayload: m,
      providerMessageId: m.id,
    },
  ];
}

/**
 * COEXISTENCIA. Un evento `whatsapp.message.sent`: si el dueño respondió DESDE
 * SU APP de WhatsApp Business (origin="business_app"), pausa esa conversación
 * igual que un takeover del panel — para que el bot se haga a un lado. Si el
 * origin es "cloud_api" (eco del propio bot) o "history_sync" (backfill), no
 * hace nada. Devuelve true si pausó.
 */
export async function kapsoOwnerTakeover(body: KapsoWebhookBody, env: Env): Promise<boolean> {
  const k = body.message?.kapso;
  if (!k || k.direction !== "outbound") return false;
  if (k.origin !== "business_app") return false; // eco del bot / sync → ignora
  const phone = normPhone(body.conversation?.phone_number);
  if (!phone) return false;
  const convs = new ConversationsRepo(new Db(env.DB));
  const conv = await convs.getOrCreate("kapso", phone, body.conversation?.kapso?.contact_name);
  await convs.setPausedUntil(conv.id, Date.now() + (await resolveTakeoverMs(env)));
  console.log("kapso coexistence: owner replied from app → paused", JSON.stringify({ phone }));
  return true;
}

export const kapsoAdapter: ChannelAdapter = {
  // Existe por la interfaz ChannelAdapter; la ruta /webhooks/kapso usa
  // parseKapsoEvents directamente (y desvía los outbound a kapsoOwnerTakeover).
  async parseIncoming(request: Request, env: Env): Promise<IncomingMessage> {
    const body = (await request.json()) as KapsoWebhookBody;
    const [first] = await parseKapsoEvents(body, env);
    if (!first) throw new Error("kapso webhook sin mensaje procesable");
    return first;
  },

  async sendReply(reply: OutgoingReply, env: Env, opts?: SendOptions): Promise<void> {
    const phoneId = env.KAPSO_PHONE_NUMBER_ID;
    const apiKey = env.KAPSO_API_KEY;
    if (!phoneId || !apiKey) {
      throw new Error("Kapso: falta KAPSO_PHONE_NUMBER_ID o KAPSO_API_KEY.");
    }
    const url = `${KAPSO_BASE}/meta/whatsapp/${GRAPH_VERSION}/${phoneId}/messages`;
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: reply.channelUserId,
          type: "text",
          text: { preview_url: false, body: reply.chunks[i] },
        }),
      });
      // Fuera de la ventana de 24h Meta rechaza texto libre (pide plantilla HSM):
      // logéalo con el cuerpo para ver el motivo exacto, no lo tragues en
      // silencio. En strict además lanza para que la app pinte el motivo.
      if (!res.ok) await reportSendFailure("kapso sendReply", res, opts);
    }
    // Galería: cada archivo va como mensaje propio DESPUÉS del texto (Kapso
    // proxya la Cloud API — mismo shape image/audio por link).
    for (const m of reply.media ?? []) {
      const payload =
        m.kind === "image"
          ? { messaging_product: "whatsapp", recipient_type: "individual", to: reply.channelUserId, type: "image", image: { link: m.url, ...(m.caption ? { caption: m.caption } : {}) } }
          : m.kind === "video"
            ? { messaging_product: "whatsapp", recipient_type: "individual", to: reply.channelUserId, type: "video", video: { link: m.url, ...(m.caption ? { caption: m.caption } : {}) } }
            : m.kind === "file"
              ? { messaging_product: "whatsapp", recipient_type: "individual", to: reply.channelUserId, type: "document", document: { link: m.url, ...(m.filename ? { filename: m.filename } : {}), ...(m.caption ? { caption: m.caption } : {}) } }
              : { messaging_product: "whatsapp", recipient_type: "individual", to: reply.channelUserId, type: "audio", audio: { link: m.url } };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(payload),
      });
      if (!res.ok) await reportSendFailure("kapso media send", res, opts);
    }
  },
};

// Envío de PLANTILLA HSM por Kapso (para reenganchar fuera de la ventana de 24h).
// Kapso proxya la Cloud API, así que la plantilla se referencia igual que el
// canal oficial: por nombre + idioma (no un SID). `bodyParams` llena {{1}}, {{2}}…
// en orden; la convención de Forja es {{1}} = nombre del cliente.
export async function sendKapsoTemplate(
  env: Env,
  to: string,
  name: string,
  lang: string,
  bodyParams: string[] = [],
): Promise<void> {
  const phoneId = env.KAPSO_PHONE_NUMBER_ID;
  const apiKey = env.KAPSO_API_KEY;
  if (!phoneId || !apiKey) {
    throw new Error("Kapso: falta KAPSO_PHONE_NUMBER_ID o KAPSO_API_KEY.");
  }
  const components = bodyParams.length
    ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }]
    : [];
  const res = await fetch(`${KAPSO_BASE}/meta/whatsapp/${GRAPH_VERSION}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
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
    throw new Error(`kapso template ${res.status}: ${errBody}`);
  }
}
