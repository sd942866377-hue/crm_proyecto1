// Embudo de comentarios de Instagram (feature personal, estilo ManyChat):
//   comenta <keyword> → DM con botón "Obtener" → al clic → recurso/lead magnet.
//
// Por qué 2 pasos: Instagram deja mandar UN mensaje sin invitación (el private
// reply al comentario). El botón (quick reply) hace que el usuario interactúe,
// lo que ABRE la ventana de mensajería de 24h y nos permite mandar el recurso
// real. Es exactamente lo que hace ManyChat.
//
// ⚠️ VERIFICAR EN VIVO al desplegar: el formato exacto de `quick_replies` dentro
// de un private reply (recipient.comment_id) y la forma del postback/quick_reply
// de vuelta pueden requerir ajuste según lo que Instagram acepte. El parseo y el
// match están cubiertos por tests; los envíos se validan en el primer deploy.
import type { Env } from "../env";
import { commentFunnels } from "../../member/config.local";
import { Db } from "../db/client";
import { listFunnels, funnelId, type FunnelRule } from "../funnels/store";

const GRAPH_VERSION = "v21.0";
const IG_BASE = "https://graph.instagram.com";
const PAYLOAD_PREFIX = "HZN_FUNNEL:";

export interface CommentFunnel {
  /** id estable (opcional en el config; el runtime lo deriva si falta). */
  id?: string;
  /** Subcadena a buscar en el comentario (case-insensitive). "" = cualquier comentario. */
  keyword: string;
  /** Opcional: restringir el embudo a un post (media id) específico. */
  mediaId?: string;
  /** DM inicial que se manda como private reply al comentario. */
  dm: string;
  /** Texto del botón (quick reply), ej. "Obtener". */
  buttonLabel: string;
  /** Mensaje/recurso que se entrega cuando dan clic al botón. */
  resource: string;
  /** Opcional: respuesta pública en el hilo del comentario. */
  publicReply?: string;
}

export interface CommentEvent {
  commentId: string;
  text: string;
  fromId: string;
  mediaId?: string;
}

export interface PostbackEvent {
  senderId: string;
  payload: string;
}

interface MetaBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{ field?: string; value?: Record<string, any> }>;
    messaging?: Array<Record<string, any>>;
  }>;
}

/** Extrae los comentarios (entry[].changes[] con field="comments") del webhook. */
export function parseMetaComments(body: MetaBody): CommentEvent[] {
  const out: CommentEvent[] = [];
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "comments") continue;
      const v = ch.value ?? {};
      const commentId = v.id;
      const text = v.text;
      const fromId = v.from?.id;
      if (!commentId || typeof text !== "string" || !fromId) continue;
      out.push({
        commentId: String(commentId),
        text,
        fromId: String(fromId),
        mediaId: v.media?.id ? String(v.media.id) : undefined,
      });
    }
  }
  return out;
}

/** Extrae los clics de botón: postback y quick_reply (entry[].messaging[]). */
export function parseMetaPostbacks(body: MetaBody): PostbackEvent[] {
  const out: PostbackEvent[] = [];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const senderId = ev.sender?.id;
      if (!senderId) continue;
      const payload = ev.postback?.payload ?? ev.message?.quick_reply?.payload;
      if (typeof payload !== "string" || !payload) continue;
      out.push({ senderId: String(senderId), payload });
    }
  }
  return out;
}

/** Embudos activos: los dinámicos de D1 + los del config (con id asignado). */
async function getFunnels(env: Env): Promise<FunnelRule[]> {
  const fromDb = await listFunnels(new Db(env.DB));
  const seen = new Set(fromDb.map((f) => f.id));
  const fromCfg: FunnelRule[] = ((commentFunnels as CommentFunnel[] | undefined) ?? []).map((f) => ({
    id: f.id ?? funnelId(f.mediaId, f.keyword),
    mediaId: f.mediaId,
    keyword: f.keyword,
    dm: f.dm,
    buttonLabel: f.buttonLabel,
    resource: f.resource,
    publicReply: f.publicReply,
  }));
  // D1 tiene prioridad si un id se repite.
  return [...fromDb, ...fromCfg.filter((f) => !seen.has(f.id))];
}

/** Devuelve la primera regla que hace match con el comentario (texto + post). */
export function matchFunnel(
  text: string,
  mediaId: string | undefined,
  funnels: FunnelRule[],
): { funnel: FunnelRule; index: number } | undefined {
  const t = text.toLowerCase();
  for (let i = 0; i < funnels.length; i++) {
    const f = funnels[i];
    if (f.mediaId && f.mediaId !== mediaId) continue;
    const kw = (f.keyword ?? "").trim().toLowerCase();
    if (kw === "" || t.includes(kw)) return { funnel: f, index: i };
  }
  return undefined;
}

export function payloadForId(id: string): string {
  return `${PAYLOAD_PREFIX}${id}`;
}

export function funnelByPayload(payload: string, funnels: FunnelRule[]): FunnelRule | undefined {
  if (!payload.startsWith(PAYLOAD_PREFIX)) return undefined;
  const id = payload.slice(PAYLOAD_PREFIX.length);
  return funnels.find((f) => f.id === id);
}

// --- Envíos (Instagram API con Instagram Login, graph.instagram.com) ---------

async function igSend(env: Env, recipient: Record<string, unknown>, message: Record<string, unknown>): Promise<void> {
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN not set");
  await fetch(`${IG_BASE}/${GRAPH_VERSION}/me/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient, message }),
  });
}

async function igCommentReply(env: Env, commentId: string, text: string): Promise<void> {
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN not set");
  await fetch(`${IG_BASE}/${GRAPH_VERSION}/${commentId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
    body: new URLSearchParams({ message: text }),
  });
}

/** Paso 1: alguien comentó → DM (private reply) con botón + respuesta pública opcional. */
export async function handleComment(c: CommentEvent, env: Env): Promise<void> {
  const match = matchFunnel(c.text, c.mediaId, await getFunnels(env));
  if (!match) return;
  const { funnel } = match;
  await igSend(
    env,
    { comment_id: c.commentId },
    {
      text: funnel.dm,
      quick_replies: [{ content_type: "text", title: funnel.buttonLabel, payload: payloadForId(funnel.id) }],
    },
  );
  if (funnel.publicReply) await igCommentReply(env, c.commentId, funnel.publicReply);
}

/** Paso 2: dio clic al botón → entrega el recurso. */
export async function handlePostback(p: PostbackEvent, env: Env): Promise<void> {
  const funnel = funnelByPayload(p.payload, await getFunnels(env));
  if (!funnel) return;
  await igSend(env, { id: p.senderId }, { text: funnel.resource });
}
