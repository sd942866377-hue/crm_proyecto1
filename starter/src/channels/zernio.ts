// Canal ZERNIO — proveedor UNIFICADO (zernio.com): un solo webhook + una sola
// API para Instagram, Messenger, WhatsApp, Telegram, X DMs, Discord… Se agrega
// como canal ADICIONAL (no reemplaza los directos). Contrato verificado en vivo
// por Santi (2026-08-07).
//
//  • Recibir: webhook `message.received` (message.direction="incoming"). El texto
//    vive en message.text, el media en message.attachments[], la plataforma en
//    message.platform, el remitente en sender.id (estable por persona → el mejor
//    channelUserId) con sender.username legible. Dedup por el id del evento
//    (payload.id, también header X-Zernio-Event-Id).
//  • Firma:  X-Zernio-Signature = HMAC-SHA256(ZERNIO_WEBHOOK_SECRET, rawBody) hex
//    (alias legacy X-Late-Signature). Fail-closed.
//  • Responder: POST /inbox/conversations/{conversationId}/messages con Bearer y
//    body { accountId, message } — el campo es `message` (con `text` lo rechaza),
//    y accountId es OBLIGATORIO. Ambos (conversationId + accountId) llegan en el
//    webhook y son POR CONVERSACIÓN, así que se guardan en `zernio_ctx` al recibir
//    para poder responder después.
import type { ChannelAdapter, IncomingMessage, OutgoingReply, SendOptions } from "./shared";
import { reportSendFailure } from "./shared";
import type { Env } from "../env";
import { Db } from "../db/client";

const DEFAULT_BASE = "https://zernio.com/api/v1";
function zernioBase(env: Env): string {
  return (env.ZERNIO_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
}

interface ZernioSender {
  id?: string;
  name?: string;
  username?: string;
  contactId?: string;
}
interface ZernioAttachment {
  type?: string;
  url?: string;
  contentType?: string;
  mimeType?: string;
  filename?: string;
  name?: string;
}
interface ZernioMessage {
  id?: string;
  conversationId?: string;
  platform?: string;
  direction?: "incoming" | "outgoing";
  text?: string;
  attachments?: ZernioAttachment[];
  sender?: ZernioSender;
  // Taps de mensajes interactivos (botones): WhatsApp trae interactiveId/Type,
  // Telegram trae callbackData. En Meta el chip manda su texto como text normal.
  metadata?: {
    interactiveType?: string;
    interactiveId?: string;
    callbackData?: string;
  };
}
interface ZernioAccount {
  id?: string;
  accountId?: string;
  platform?: string;
  username?: string;
}
interface ZernioEvent {
  id?: string;
  event?: string;
  message?: ZernioMessage;
  account?: ZernioAccount;
}

// ── firma ────────────────────────────────────────────────────────────────────
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
/** HMAC-SHA256(secret, rawBody) hex contra X-Zernio-Signature. Fail-closed. */
export async function verifyZernioSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret || !signature) return false;
  const expected = await hmacHex(secret, rawBody);
  return timingSafeEqual(expected, signature.trim());
}

// ── normalización ─────────────────────────────────────────────────────────────
/** Tolera un evento suelto o un batch (array / {items|events:[]}). */
export function normalizeZernioEvents(body: unknown): ZernioEvent[] {
  if (Array.isArray(body)) return body as ZernioEvent[];
  const o = (body ?? {}) as { items?: unknown; events?: unknown };
  if (Array.isArray(o.items)) return o.items as ZernioEvent[];
  if (Array.isArray(o.events)) return o.events as ZernioEvent[];
  return [body as ZernioEvent];
}

interface ZernioMedia {
  imageUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  fileMime?: string;
}

function pickMedia(atts: ZernioAttachment[] | undefined): ZernioMedia {
  const out: ZernioMedia = {};
  for (const a of atts ?? []) {
    if (!a?.url) continue;
    const kind = `${a.type ?? ""} ${a.contentType ?? ""} ${a.mimeType ?? ""}`.toLowerCase();
    if (!out.imageUrl && /image|photo/.test(kind)) out.imageUrl = a.url;
    else if (!out.audioUrl && /audio|voice/.test(kind)) out.audioUrl = a.url;
    else if (!out.fileUrl && /document|file|pdf|application\//.test(kind)) {
      // El bot no lee documentos: se archivan y escalan a una persona.
      out.fileUrl = a.url;
      out.fileName = a.filename || a.name || undefined;
      out.fileMime = a.contentType || a.mimeType || undefined;
    }
    // Nota: el shape exacto de attachments se confirma con un payload de media real.
  }
  return out;
}

/**
 * Un evento Zernio → 0/1 IncomingMessage. Solo procesa `message.received`
 * entrante (los `message.sent` / eco no entran al pipeline). channelUserId =
 * sender.id (estable por persona).
 */
export function parseZernioEvents(ev: ZernioEvent): IncomingMessage[] {
  if (ev?.event !== "message.received") return [];
  const m = ev.message;
  if (!m || m.direction === "outgoing") return [];
  const channelUserId = m.sender?.id?.trim();
  if (!channelUserId) return [];
  const { imageUrl, audioUrl, fileUrl, fileName, fileMime } = pickMedia(m.attachments);
  return [
    {
      channel: "zernio",
      channelUserId,
      displayName: m.sender?.username || m.sender?.name || undefined,
      // Tap de botón sin texto (algunas plataformas mandan solo el payload):
      // se usa el payload/callback como texto para que el cerebro lo entienda.
      text: m.text || m.metadata?.interactiveId || m.metadata?.callbackData || undefined,
      imageUrl,
      audioUrl,
      fileUrl,
      fileName,
      fileMime,
      receivedAt: Date.now(),
      rawPayload: ev,
      providerMessageId: ev.id || m.id || undefined,
    },
  ];
}

// ── contexto de envío (conversationId + accountId por persona) ─────────────────
// Zernio responde por conversationId (URL) + accountId (body), ambos por
// conversación. Se guardan al recibir, keyeados por channelUserId (=sender.id),
// para poder responder después. Tabla auto-creada (patrón dedup) — sin migración.
let ctxEnsured = false;
async function ensureCtx(db: Db): Promise<void> {
  if (ctxEnsured) return;
  await db.run(
    `CREATE TABLE IF NOT EXISTS zernio_ctx (
       channel_user_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
       account_id TEXT NOT NULL, platform TEXT, updated_at INTEGER NOT NULL)`,
  );
  ctxEnsured = true;
}
export interface ZernioCtx {
  conversation_id: string;
  account_id: string;
  platform: string | null;
}
/** Contexto de envío guardado al recibir (conversationId + accountId + plataforma
 *  subyacente). null si esa persona nunca escribió por Zernio. */
export async function getZernioCtx(env: Env, channelUserId: string): Promise<ZernioCtx | null> {
  try {
    const db = new Db(env.DB);
    await ensureCtx(db);
    return await db.first<ZernioCtx>(
      "SELECT conversation_id, account_id, platform FROM zernio_ctx WHERE channel_user_id = ?",
      [channelUserId],
    );
  } catch (e) {
    console.error("[zernio] getCtx:", e);
    return null;
  }
}
export async function rememberZernioCtx(
  env: Env,
  channelUserId: string,
  conversationId: string,
  accountId: string,
  platform?: string,
): Promise<void> {
  try {
    const db = new Db(env.DB);
    await ensureCtx(db);
    await db.run(
      `INSERT INTO zernio_ctx (channel_user_id, conversation_id, account_id, platform, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel_user_id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         account_id = excluded.account_id,
         platform = excluded.platform,
         updated_at = excluded.updated_at`,
      [channelUserId, conversationId, accountId, platform ?? null, Date.now()],
    );
  } catch (e) {
    console.error("[zernio] rememberCtx:", e);
  }
}

/**
 * Manda una PLANTILLA aprobada de WhatsApp a una conversación EXISTENTE por Zernio.
 * Es la vía para re-enganchar fuera de la ventana de 24h (WhatsApp no permite
 * texto libre para reabrir). Va por el MISMO endpoint que el texto libre
 * (POST /inbox/conversations/{conversationId}/messages) pero con el campo
 * `template.elements` en vez de `message` — así lo documenta Zernio. `templateParams`
 * llena las variables {{1}}, {{2}}… del body de la plantilla, en orden. Solo aplica a
 * conversaciones cuyo platform sea "whatsapp". (Para abrir una conversación con un
 * número con el que aún NO hay hilo, Zernio usa POST /inbox/conversations; aquí
 * siempre hay hilo previo porque el contacto ya nos escribió.)
 */
export async function sendZernioTemplate(
  env: Env,
  conversationId: string,
  accountId: string,
  templateName: string,
  templateLanguage: string,
  templateParams: string[],
): Promise<void> {
  const apiKey = env.ZERNIO_API_KEY;
  // LANZA (no console.error): las otras 4 funciones de plantilla lanzan, y quien
  // llama (reengage, el inbox móvil) necesita distinguir "se mandó" de "rebotó".
  // Tragarse el error persistía un mensaje que el cliente nunca recibió.
  if (!apiKey) throw new Error("Zernio: falta ZERNIO_API_KEY.");
  const element: Record<string, unknown> = { name: templateName, language: templateLanguage };
  if (templateParams.length) {
    element.components = [
      { type: "body", parameters: templateParams.map((text) => ({ type: "text", text })) },
    ];
  }
  const url = `${zernioBase(env)}/inbox/conversations/${encodeURIComponent(conversationId)}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ accountId, template: { elements: [element] } }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`zernio template ${res.status}: ${errBody.slice(0, 300)}`);
  }
}

// ── adapter ───────────────────────────────────────────────────────────────────
export const zernioAdapter: ChannelAdapter = {
  // Existe por la interfaz; la ruta /webhooks/zernio usa parseZernioEvents directo.
  async parseIncoming(request: Request): Promise<IncomingMessage> {
    const body = (await request.json()) as ZernioEvent;
    const [first] = parseZernioEvents(body);
    if (!first) throw new Error("zernio webhook sin mensaje procesable");
    return first;
  },

  async sendReply(reply: OutgoingReply, env: Env, opts?: SendOptions): Promise<void> {
    // Zernio es el único adapter que se rendía en silencio (return) cuando le
    // faltaba la llave o el contexto de la conversación. Para el bot eso está
    // bien (el turno sigue), pero un humano escribiendo desde la app vería su
    // mensaje en el hilo sin que nadie lo recibiera → en strict, lanza.
    const apiKey = env.ZERNIO_API_KEY;
    if (!apiKey) {
      const err = "[zernio] falta ZERNIO_API_KEY — no se puede responder";
      console.error(err);
      if (opts?.strict) throw new Error(err);
      return;
    }
    const ctx = await getZernioCtx(env, reply.channelUserId);
    if (!ctx) {
      const err = `[zernio] sin contexto de envío para ${reply.channelUserId} — no se responde`;
      console.error(err);
      if (opts?.strict) throw new Error(err);
      return;
    }
    const url = `${zernioBase(env)}/inbox/conversations/${encodeURIComponent(ctx.conversation_id)}/messages`;
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      // El campo es `message` (con `text` Zernio lo rechaza); accountId obligatorio.
      const body: Record<string, unknown> = { accountId: ctx.account_id, message: reply.chunks[i] };
      // Botones (opt-in) en el ÚLTIMO chunk. `buttons` postback funciona en
      // WhatsApp (reply buttons), IG/FB (button_template, visible en Message
      // Requests — mejor que chips para leads fríos) y Telegram (inline). En
      // plataformas SIN soporte (X, SMS, Slack…) van como lista numerada.
      if (reply.buttons?.length && i === reply.chunks.length - 1) {
        const plat = (ctx.platform ?? "").toLowerCase();
        // El body interactivo de WhatsApp tope a 1024 chars (límite de Meta):
        // con un chunk más largo, mejor lista numerada que arriesgar el envío.
        const soporta =
          ["instagram", "facebook", "messenger", "telegram"].includes(plat) ||
          (plat === "whatsapp" && reply.chunks[i].length <= 1024);
        if (soporta) {
          body.buttons = reply.buttons.map((b) => ({
            type: "postback",
            title: b.title,
            payload: b.payload,
          }));
        } else {
          body.message = `${reply.chunks[i]}\n\n${reply.buttons.map((b, n) => `${n + 1}) ${b.title}`).join("\n")}`;
        }
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) await reportSendFailure("[zernio] sendReply", res, opts);
    }
    // Galería: cada archivo va como mensaje propio DESPUÉS del texto —
    // attachmentUrl + attachmentType (spec de Zernio). voiceNote=true manda el
    // audio como NOTA DE VOZ en WhatsApp (solo válido con ogg/opus; sender.ts
    // ya marca voice únicamente en audio/ogg).
    for (const m of reply.media ?? []) {
      const body: Record<string, unknown> = {
        accountId: ctx.account_id,
        attachmentUrl: m.url,
        // Zernio nombra el documento "file"; el resto de kinds ya coinciden.
        attachmentType: m.kind,
        ...(m.filename ? { attachmentName: m.filename } : {}),
        // El caption viaja como `message` en el MISMO send (Zernio lo soporta).
        ...(m.caption ? { message: m.caption } : {}),
      };
      if (m.kind === "audio" && m.voice && (ctx.platform ?? "").toLowerCase() === "whatsapp") {
        body.voiceNote = true;
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) await reportSendFailure("[zernio] media send", res, opts);
    }
  },
};
