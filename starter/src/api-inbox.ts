/**
 * Inbox móvil (Forja Inbox) — contrato bot ≥ 1.1.0. Sub-app montada bajo /api
 * desde api.ts, así que hereda el guard fail-closed del control plane
 * (Bearer CONTROL_PLANE_TOKEN). PRINCIPIO DE PRIVACIDAD igual que /api/leads:
 * la nube LEE en vivo y hace proxy; los mensajes NUNCA se almacenan fuera del
 * bot. Es la MISMA bandeja del panel /admin (misma tabla conversations, todos
 * los canales) expuesta como JSON — cualquier canal presente o futuro entra
 * solo, porque todo cae en conversations.channel.
 *
 * CAMPOS OPCIONALES del mensaje en GET /conversations/:id/messages — ausentes
 * salvo que apliquen, y la app ignora lo que no conoce:
 *   · `media[]`   → adjuntos del mensaje (Contrato v3 §A1).
 *   · `template`  → `true` solo si ese mensaje salió como plantilla aprobada de
 *                   WhatsApp; con él la app pinta "Tú · recordatorio" +
 *                   "enviado como recordatorio aprobado" (diseño 6b). Los
 *                   mensajes de plantilla anteriores a este marcador NO lo
 *                   traen: la etiqueta simplemente no aparece, nada se rompe.
 */
import { Hono, type Context } from "hono";
import type { Env } from "./env";
import { Db } from "./db/client";
import { ConversationsRepo, ensureTakenBy, parseTakenBy } from "./db/conversations";
import { MessagesRepo } from "./db/messages";
import { ConversationReadsRepo, ensureConversationReads } from "./db/conversationReads";
import { MagicLinksRepo, SSO_MASTER_EMAIL } from "./db/magicLinks";
import { SettingsRepo, SETTING_KEYS, resolveTakeoverMs } from "./db/settings";
import { LEAD_STATUSES } from "./db/leads";
import { pickAdapter } from "./replies/sender";
import { FILE_CHANNELS, MEDIA_CHANNELS, type ChannelId } from "./channels/shared";
import { agentStub } from "./agent-stub";
import { TEST_CHANNEL, notTestConv } from "./db/testFilter";
import { computeWindow, isWindowedChannel, type WaWindow } from "./lib/wa-window";
import {
  extractMediaIds,
  isTemplateMessage,
  mediaMarker,
  stripMediaMarkers,
  templateMarker,
} from "./lib/media-markers";
import { maskContact } from "./lib/mask";
import { selfOriginFromRequest } from "./lib/self-origin";
import {
  BUSINESS_HOURS_DAY_KEYS,
  BUSINESS_HOURS_MODES,
  isValidTimezone,
  legacyHours,
  renderBusinessContext,
  sanitizeServices,
  type BusinessHours,
  type BusinessHoursMode,
} from "./businessContext";
import { businessContextOk } from "./settings-mutations";
import { sanitizeFaqs } from "./faqs";
import {
  sanitizePromo,
  sanitizeLocation,
  sanitizePaymentMethods,
  sanitizeCatalog,
} from "./businessInfo";
import { getNiche } from "./niches";
import { readPerms, writePerms, readCustomRules, writeCustomRules } from "./voice-blocks";
import { claimSuggestSlot, CopilotError, COPILOT_HINT_MAX, suggestReply } from "./copilot";
import { decodeCursor, encodeCursor } from "./lib/cursor";
import { contains } from "./lib/search-sql";
import { auditApp, readActor, type Actor } from "./lib/actor";
import { isPro } from "./config";
import { resolvePromptOverride } from "./settings-loader";

export const inboxApi = new Hono<{ Bindings: Env }>();

// ── Quién atiende (Contrato v3.2 §2) ─────────────────────────────────────────
//
// La nube manda en cada llamada a /conversations/* el header `X-Forja-Actor`
// con quién está usando la app. Sin header, todo se comporta como siempre: el
// bot NO depende de la identidad para nada, solo la anota para que la bandeja
// pueda decir "Beto la está atendiendo" en vez de un "modo humano" anónimo.

/**
 * `handoff_by` de una conversación: quién la está atendiendo, o null.
 * Solo aplica en modo humano (pausa vigente) — sin pausa el bot es el que
 * contesta, aunque quede un taken_by viejo de la última vez.
 */
function handoffBy(
  takenByRaw: string | null | undefined,
  pausedUntil: number | null,
  now: number,
  actor: Actor | null,
): { name: string; is_me: boolean } | null {
  if (pausedUntil == null || pausedUntil <= now) return null;
  const taken = parseTakenBy(takenByRaw);
  if (!taken) return null;
  return { name: taken.name, is_me: !!actor && actor.id === taken.id };
}

// ── Búsqueda de la bandeja (Contrato v3.2 §1) ────────────────────────────────

/** Texto más largo que esto no busca mejor, solo pesa más en el barrido. */
const SEARCH_MAX_LEN = 60;
/** Con 1 carácter media bandeja "coincide": no es una búsqueda, es ruido. */
const SEARCH_MIN_LEN = 2;
/** Hasta dónde se busca DENTRO de los mensajes. Más atrás no hay índice que valga. */
const SEARCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Por qué salió esta conversación en los resultados (la app resalta según esto). */
function searchMatch(row: InboxRow, needle: string): "name" | "contact" | "message" {
  if ((row.display_name ?? "").toLowerCase().includes(needle)) return "name";
  if (row.channel_user_id.toLowerCase().includes(needle)) return "contact";
  return "message";
}

// unread = mensajes del CLIENTE posteriores a la última lectura (app o panel
// vía POST /read, o al responder). Expresión compartida entre SELECT y WHERE.
const UNREAD_SQL = `(SELECT COUNT(*) FROM messages m
  WHERE m.conversation_id = c.id AND m.role = 'user'
    AND m.created_at > COALESCE((SELECT r.last_read_at FROM conversation_reads r
                                 WHERE r.conversation_id = c.id), 0))`;

interface InboxRow {
  id: string;
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  last_message_at: number;
  paused_until: number | null;
  last_msg: string | null;
  unread: number;
  lead_intent: string | null;
  lead_status: string | null;
  open_tickets: number;
  last_user_at: number | null;
  taken_by: string | null;
}

// ── Ventana de 24 h de WhatsApp (Contrato v3 §B) ─────────────────────────────

/**
 * Plataforma subyacente de cada conversación de Zernio (es multi-plataforma:
 * solo las de WhatsApp tienen ventana). Una sola query en vez de N lecturas, y
 * tolerante a que `zernio_ctx` no exista — es una tabla lazy, un bot que nunca
 * recibió por Zernio no la tiene creada.
 */
async function zernioPlatforms(db: Db, channelUserIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!channelUserIds.length) return out;
  try {
    const rows = await db.all<{ channel_user_id: string; platform: string | null }>(
      `SELECT channel_user_id, platform FROM zernio_ctx
        WHERE channel_user_id IN (${channelUserIds.map(() => "?").join(",")})`,
      channelUserIds,
    );
    for (const r of rows) out.set(r.channel_user_id, r.platform);
  } catch {
    /* tabla lazy inexistente (bot sin Zernio) — todas quedan sin plataforma */
  }
  return out;
}

/** `window` de UNA conversación: null si su canal no tiene ventana. */
async function windowFor(
  db: Db,
  conv: { id: string; channel: string; channel_user_id: string },
  now: number,
): Promise<WaWindow | null> {
  let platform: string | null = null;
  if (conv.channel === "zernio") {
    platform = (await zernioPlatforms(db, [conv.channel_user_id])).get(conv.channel_user_id) ?? null;
  }
  if (!isWindowedChannel(conv.channel, platform)) return null;
  const row = await db.first<{ t: number | null }>(
    "SELECT MAX(created_at) AS t FROM messages WHERE conversation_id = ? AND role = 'user'",
    [conv.id],
  );
  return computeWindow(row?.t ?? null, now);
}

// GET /api/conversations?filter=all|handoff|unread|hot&limit=30&cursor=…
// El campo `channel` viaja tal cual (ChannelId del bot: whatsapp, web, zernio,
// ycloud, kapso…) — la app trata valores desconocidos como genéricos, así un
// canal nuevo funciona sin tocar el contrato.
inboxApi.get("/conversations", async (c) => {
  const db = new Db(c.env.DB);
  await ensureConversationReads(db);
  // La columna se SELECCIONA explícito abajo: en un bot al que nunca le corrió
  // el ALTER, la query reventaría sin esto.
  await ensureTakenBy(db);
  const actor = readActor(c);
  const now = Date.now();

  const rawLimit = Number.parseInt(c.req.query("limit") ?? "30", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 30;
  const filter = c.req.query("filter") ?? "all";

  // El chat de prueba de la app (canal `test`) JAMÁS sale en la bandeja —
  // ver src/db/testFilter.ts.
  const conds: string[] = [notTestConv("c")];
  const params: (string | number)[] = [];
  if (filter === "handoff") {
    // Mismo criterio que el filtro "atención" del panel: pausada (humano al
    // mando) O con ticket abierto.
    conds.push(
      "((c.paused_until IS NOT NULL AND c.paused_until > ?) OR EXISTS (SELECT 1 FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved'))",
    );
    params.push(now);
  } else if (filter === "unread") {
    conds.push(`${UNREAD_SQL} > 0`);
  } else if (filter === "hot") {
    // Mismo criterio que el filtro "leads" del panel: la conversación produjo
    // al menos un lead (intención de compra registrada).
    conds.push("EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)");
  }

  // Búsqueda libre: se SUMA al filtro y al cursor (AND), nunca los reemplaza.
  // Busca en el nombre, en el contacto crudo (el dueño se acuerda del teléfono,
  // no del enmascarado) y dentro de lo dicho el último mes.
  const q = (c.req.query("q") ?? "").trim().slice(0, SEARCH_MAX_LEN);
  const buscando = q.length >= SEARCH_MIN_LEN;
  if (buscando) {
    conds.push(
      `(${contains("c.display_name")} OR ${contains("c.channel_user_id")}
        OR EXISTS (SELECT 1 FROM messages m
                    WHERE m.conversation_id = c.id AND m.role IN ('user','assistant','owner')
                      AND m.created_at > ? AND ${contains("m.content")}))`,
    );
    params.push(q, q, now - SEARCH_WINDOW_MS, q);
  }

  const cursor = decodeCursor(c.req.query("cursor"));
  if (cursor) {
    conds.push("(c.last_message_at < ? OR (c.last_message_at = ? AND c.id < ?))");
    params.push(cursor[0], cursor[0], cursor[1]);
  }
  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const rows = await db.all<InboxRow>(
    `SELECT c.id, c.channel, c.channel_user_id, c.display_name, c.last_message_at, c.paused_until,
       c.taken_by,
       (SELECT content FROM messages WHERE conversation_id = c.id AND role != 'tool'
        ORDER BY created_at DESC LIMIT 1) AS last_msg,
       ${UNREAD_SQL} AS unread,
       (SELECT intent FROM leads l WHERE l.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS lead_intent,
       (SELECT status FROM leads l WHERE l.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS lead_status,
       (SELECT COUNT(*) FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved') AS open_tickets,
       (SELECT MAX(m2.created_at) FROM messages m2
         WHERE m2.conversation_id = c.id AND m2.role = 'user') AS last_user_at
     FROM conversations c
     ${whereSql}
     ORDER BY c.last_message_at DESC, c.id DESC
     LIMIT ?`,
    [...params, limit + 1],
  );

  const page = rows.slice(0, limit);
  // Ventana de 24 h: una sola lectura de zernio_ctx para toda la página (Zernio
  // es multi-plataforma y solo sus conversaciones de WhatsApp la tienen).
  const platforms = await zernioPlatforms(
    db,
    page.filter((r) => r.channel === "zernio").map((r) => r.channel_user_id),
  );
  const needle = q.toLowerCase();
  const conversations = page.map((r) => {
    const paused = r.paused_until != null && r.paused_until > now;
    const windowed = isWindowedChannel(r.channel, platforms.get(r.channel_user_id) ?? null);
    return {
      id: r.id,
      name: r.display_name || maskContact(r.channel_user_id) || "Cliente",
      contact_hint: maskContact(r.channel_user_id),
      channel: r.channel,
      preview: stripMediaMarkers(r.last_msg ?? "").replace(/\s+/g, " ").slice(0, 140),
      unread: r.unread,
      intent: r.lead_intent ?? "",
      status: r.lead_status || "new",
      handoff: paused ? "human" : r.open_tickets > 0 ? "pending" : "bot",
      // Quién la está atendiendo desde la app (null si la lleva el bot, o si
      // el takeover salió del panel y no dejó nombre).
      handoff_by: handoffBy(r.taken_by, r.paused_until, now, actor),
      updated_at: r.last_message_at,
      // null = canal sin ventana (telegram, web, instagram, test…): la app deja
      // el composer libre.
      window: windowed ? computeWindow(r.last_user_at, now) : null,
      // Solo cuando se está buscando: dice dónde pegó, para que la app resalte
      // el nombre, el contacto o el preview del mensaje.
      ...(buscando ? { match: searchMatch(r, needle) } : {}),
    };
  });

  const last = page[page.length - 1];
  const next_cursor =
    rows.length > limit && last ? encodeCursor(last.last_message_at, last.id) : null;
  return c.json({ ok: true, conversations, next_cursor }, 200);
});

// ── Adjuntos del hilo (Contrato v3 §A) ───────────────────────────────────────

const MESSAGES_PAGE = 50;
/** Ventana para pegar una fila de media SIN message_id al mensaje más cercano. */
const MEDIA_MATCH_WINDOW_MS = 90_000;

interface ThreadMedia {
  kind: "image" | "audio" | "file" | "video";
  /** SIEMPRE relativa al bot: la nube la reescribe antes de dársela a la app.
   *  Jamás la URL cruda del proveedor (la de Telegram lleva el token dentro y
   *  la de WhatsApp muere en 10 min). */
  url: string;
  caption?: string;
  duration_s?: number;
  filename?: string;
  size?: number;
}

interface MediaThreadRow {
  id: string;
  message_id: string | null;
  kind: string;
  mime: string | null;
  filename: string | null;
  caption: string | null;
  bytes: number | null;
  duration_s: number | null;
  created_at: number;
  direction: string | null;
}

function threadMediaKind(row: MediaThreadRow): ThreadMedia["kind"] {
  if ((row.mime ?? "").startsWith("video/")) return "video";
  if (row.kind === "image") return "image";
  if (row.kind === "audio") return "audio";
  return "file"; // document y cualquier kind futuro desconocido
}

function toThreadMedia(row: MediaThreadRow): ThreadMedia {
  return {
    kind: threadMediaKind(row),
    url: `/api/media/${row.id}`,
    ...(row.caption ? { caption: row.caption } : {}),
    ...(row.duration_s != null ? { duration_s: row.duration_s } : {}),
    ...(row.filename ? { filename: row.filename } : {}),
    ...(row.bytes != null ? { size: row.bytes } : {}),
  };
}

/**
 * Filas de `media` de la conversación en el rango de la página. La tabla es
 * lazy (la crea la primera captura): en un bot sin bucket R2 nunca existe, y
 * eso NO es un error — el hilo sale sin adjuntos y ya.
 *
 * `ensureMediaTable` va PRIMERO, y no es decorativo: un bot con la Bóveda vieja
 * YA tiene la tabla `media` pero SIN message_id/direction/duration_s — esas
 * columnas solo las agrega el ALTER de ensureMediaTable. Si ese bot no capturó
 * nada desde el update, nadie la habría llamado todavía y este SELECT reventaba
 * por columna inexistente: el catch devolvía [] y el hilo se pintaba SIN
 * adjuntos, en silencio.
 */
async function loadThreadMedia(
  db: Db,
  conversationId: string,
  fromTs: number,
  toTs: number,
): Promise<MediaThreadRow[]> {
  try {
    const { ensureMediaTable } = await import("./media/boveda");
    await ensureMediaTable(db);
    return await db.all<MediaThreadRow>(
      `SELECT id, message_id, kind, mime, filename, caption, bytes, duration_s, created_at, direction
         FROM media
        WHERE conversation_id = ? AND created_at BETWEEN ? AND ?
        ORDER BY created_at ASC`,
      [conversationId, fromTs - MEDIA_MATCH_WINDOW_MS, toTs + MEDIA_MATCH_WINDOW_MS],
    );
  } catch {
    return [];
  }
}

// GET /api/conversations/:id/messages?cursor=… — la última página en orden
// natural del chat; el cursor pagina HACIA ATRÁS en el historial. `tool` no
// viaja (ruido interno); `owner` sale como `human` (contrato de la app).
inboxApi.get("/conversations/:id/messages", async (c) => {
  const db = new Db(c.env.DB);
  const convId = c.req.param("id");

  const conds = ["conversation_id = ?", "role != 'tool'"];
  const params: (string | number)[] = [convId];
  const cursor = decodeCursor(c.req.query("cursor"));
  if (cursor) {
    conds.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor[0], cursor[0], cursor[1]);
  }

  // Conversación y página de mensajes en PARALELO (2026-08-29): mismo id, dos
  // round-trips a D1 que antes iban en fila — la app abre el hilo un viaje antes.
  const [conv, rows] = await Promise.all([
    new ConversationsRepo(db).getById(convId),
    db.all<{ id: string; role: string; content: string; created_at: number }>(
      `SELECT id, role, content, created_at FROM messages
       WHERE ${conds.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [...params, MESSAGES_PAGE + 1],
    ),
  ]);
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);

  const page = rows.slice(0, MESSAGES_PAGE);
  const oldest = page[page.length - 1];
  const next_cursor =
    rows.length > MESSAGES_PAGE && oldest ? encodeCursor(oldest.created_at, oldest.id) : null;
  const ordered = page.reverse(); // orden natural del chat

  // Adjuntos: primero por message_id (lo escribe agent.ts al persistir el
  // turno); las filas viejas no lo tienen, así que se pegan al mensaje más
  // cercano en el tiempo — la misma heurística que ya usa el panel. Con una
  // ráfaga de fotos puede pegar una al mensaje vecino: el orden visual del hilo
  // se conserva igual, y todo lo nuevo viene con message_id.
  const mediaRows = ordered.length
    ? await loadThreadMedia(db, conv.id, ordered[0].created_at, ordered[ordered.length - 1].created_at)
    : [];
  const byMessage = new Map<string, ThreadMedia[]>();
  const sueltas: MediaThreadRow[] = [];
  for (const row of mediaRows) {
    if (row.message_id) {
      const list = byMessage.get(row.message_id) ?? [];
      list.push(toThreadMedia(row));
      byMessage.set(row.message_id, list);
      continue;
    }
    const rolesEsperados = row.direction === "out" ? ["owner"] : ["user"];
    let mejor: { id: string; delta: number } | null = null;
    for (const m of ordered) {
      if (!rolesEsperados.includes(m.role)) continue;
      const delta = Math.abs(m.created_at - row.created_at);
      if (delta <= MEDIA_MATCH_WINDOW_MS && (!mejor || delta < mejor.delta)) {
        mejor = { id: m.id, delta };
      }
    }
    if (mejor) {
      const list = byMessage.get(mejor.id) ?? [];
      list.push(toThreadMedia(row));
      byMessage.set(mejor.id, list);
    } else {
      sueltas.push(row);
    }
  }

  const messages: {
    id: string;
    role: string;
    text: string;
    created_at: number;
    media?: ThreadMedia[];
    template?: true;
  }[] = ordered.map((m) => {
    const media = byMessage.get(m.id) ?? [];
    // Imagen histórica que solo dejó el marcador [IMAGE_URL:] (bots sin bucket
    // R2, o anteriores a esta versión): se resuelve on-demand contra el
    // proveedor. Si la URL ya murió, la ruta devuelve 410 y la app pinta
    // "imagen ya no disponible".
    if (!media.length && !extractMediaIds(m.content).length && /\[IMAGE_URL: /.test(m.content)) {
      media.push({ kind: "image", url: `/api/media/legacy/${m.id}` });
    }
    return {
      id: m.id,
      role: m.role === "owner" ? "human" : m.role,
      // El texto sale LIMPIO: los marcadores son contabilidad interna.
      text: stripMediaMarkers(m.content),
      created_at: m.created_at,
      ...(media.length ? { media } : {}),
      // Solo cuando el mensaje salió como plantilla aprobada; ausente en todo lo
      // demás (incluidos los mensajes de plantilla anteriores a este marcador).
      ...(isTemplateMessage(m.content) ? { template: true } : {}),
    };
  });

  // Archivos sin mensaje al cual pegarse (Bóveda histórica): entran como
  // mensaje sintético para que el hilo los muestre igual que el panel.
  for (const row of sueltas) {
    messages.push({
      id: `media:${row.id}`,
      role: row.direction === "out" ? "human" : "user",
      text: row.caption ?? "",
      created_at: row.created_at,
      media: [toThreadMedia(row)],
    });
  }
  if (sueltas.length) messages.sort((a, b) => a.created_at - b.created_at);
  // `window` y `handoff_by` van en la RAÍZ (no por mensaje): son el estado del
  // hilo con el que la app pinta el composer y el banner de modo humano. El
  // polling de 5s ya los refresca.
  const now = Date.now();
  const waWindow = await windowFor(db, conv, now);
  return c.json(
    {
      ok: true,
      messages,
      next_cursor,
      window: waWindow,
      handoff_by: handoffBy(conv.taken_by, conv.paused_until, now, readActor(c)),
    },
    200,
  );
});

// POST /api/conversations/:id/messages {text} — responder COMO HUMANO desde la
// app: persistir como owner + takeover + responder AL INSTANTE, y mandar por el
// adapter del canal en background (waitUntil). La falla común (ventana de 24 h
// de WhatsApp) rebota ANTES de persistir con su 409 legible; una falla rara del
// proveedor (token vencido, red) aterriza como nota interna EN el hilo con el
// motivo real — visible en app y panel. Nunca un "200 fantasma" silencioso:
// ese contrato (strict) sigue, solo cambió DÓNDE aterriza el error.
inboxApi.post("/conversations/:id/messages", async (c) => {
  let body: { text?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const text = String(body.text ?? "").trim();
  if (!text || text.length > 4000) return c.json({ ok: false, error: "invalid_text" }, 400);

  const db = new Db(c.env.DB);
  const convs = new ConversationsRepo(db);
  const conv = await convs.getById(c.req.param("id"));
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);

  // Ventana de 24 h cerrada: el proveedor iba a rechazarlo de todas formas.
  // Rebotar aquí ahorra el fetch y le da a la app un motivo legible con el que
  // ofrecer el sheet de plantillas en vez de un error crudo de Meta.
  const waWindow = await windowFor(db, conv, Date.now());
  if (waWindow?.state === "closed") {
    return c.json({ ok: false, error: "send_failed", detail: "window_closed" }, 409);
  }

  const now = Date.now();
  const actor = readActor(c);
  const msgs = new MessagesRepo(db);
  const msgId = await msgs.append(conv.id, "owner", text);
  await convs.touchLastMessage(conv.id);
  await convs.setPausedUntil(conv.id, now + (await resolveTakeoverMs(c.env)));
  // Responder ES tomar la conversación: quien contestó queda anotado.
  await convs.setTakenBy(conv.id, actor);
  await new ConversationReadsRepo(db).markRead(conv.id, now);

  // Envío en BACKGROUND (2026-08-29, velocidad del app): el 200 sale ya
  // (~100ms percibidos) en vez de esperar los 300–1000ms del proveedor.
  // strict sigue: si el proveedor rechaza, el adapter LANZA con su motivo real
  // y la nota de abajo lo hace visible — jamás un fallo tragado en silencio.
  const envio = (async () => {
    try {
      const adapter = pickAdapter(conv.channel as ChannelId);
      await adapter.sendReply(
        {
          channel: conv.channel as ChannelId,
          channelUserId: conv.channel_user_id,
          chunks: [text],
          interChunkDelayMs: 0,
        },
        c.env,
        { strict: true },
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const resumen = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      await msgs
        .append(conv.id, "note", `⚠️ Mensaje NO entregado: "${resumen}" — ${detail}. Reintenta o usa una plantilla.`)
        .catch(() => {});
    }
  })();
  try {
    c.executionCtx.waitUntil(envio);
  } catch {
    // tests / entornos sin executionCtx: la promesa corre suelta igual
  }

  return c.json(
    { ok: true, id: msgId, delivery: "sending", handoff_by: actor ? { name: actor.name, is_me: true } : null },
    200,
  );
});

// POST /api/conversations/:id/handoff {action:"take"|"release"} — pausar /
// devolver el bot en ESTA conversación. `release` NO inserta resúmenes en el
// hilo (eso es del flujo del panel): la app solo suelta la pausa.
inboxApi.post("/conversations/:id/handoff", async (c) => {
  let body: { action?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const action = body.action;
  if (action !== "take" && action !== "release") {
    return c.json({ ok: false, error: "invalid_action" }, 400);
  }

  const db = new Db(c.env.DB);
  const convs = new ConversationsRepo(db);
  const conv = await convs.getById(c.req.param("id"));
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);

  const actor = readActor(c);
  if (action === "take") {
    await convs.setPausedUntil(conv.id, Date.now() + (await resolveTakeoverMs(c.env)));
    await convs.setTakenBy(conv.id, actor);
    // Solo se audita el take/release explícito: anotar cada mensaje enviado
    // convertiría la bitácora del panel en un log de chat.
    await auditApp(db, actor, "conversacion_tomada", conv.id);
    return c.json(
      { ok: true, handoff: "human", handoff_by: actor ? { name: actor.name, is_me: true } : null },
      200,
    );
  }
  await convs.setPausedUntil(conv.id, null);
  // Cualquiera puede devolverla al bot, la haya tomado quien la haya tomado.
  await convs.setTakenBy(conv.id, null);
  await auditApp(db, actor, "conversacion_devuelta", conv.id);
  return c.json({ ok: true, handoff: "bot" }, 200);
});

// POST /api/conversations/:id/status {status} — estado del lead más reciente
// de la conversación. Dominio REAL (LEAD_STATUSES en db/leads.ts, el mismo que
// usa el panel /admin/leads): new|contacted|sold|lost — cualquier otro valor
// corrompería las métricas del panel (conteos por status), así que se valida
// contra la lista cerrada en vez de aceptar cualquier slug corto.
inboxApi.post("/conversations/:id/status", async (c) => {
  let body: { status?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const status = String(body.status ?? "").trim();
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    return c.json({ ok: false, error: "invalid_status" }, 400);
  }

  const db = new Db(c.env.DB);
  const res = await db.run(
    `UPDATE leads SET status = ?, updated_at = ?
     WHERE id = (SELECT id FROM leads WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1)`,
    [status, Date.now(), c.req.param("id")],
  );
  if (!res.meta.changes) return c.json({ ok: false, error: "no_lead" }, 404);
  return c.json({ ok: true, status }, 200);
});

// POST /api/conversations/:id/suggest {hint?} — "¿qué le contesto?" (Contrato
// v3.2 §3). El bot redacta UN mensaje con SU prompt efectivo; la app lo mete en
// el composer para que el dueño lo edite. NO se manda ni se persiste nada.
inboxApi.post("/conversations/:id/suggest", async (c) => {
  let body: { hint?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    // Body vacío o roto = sugerencia sin pista. Es el caso normal del botón ✨.
    body = {};
  }
  const hint = String(body.hint ?? "").trim().slice(0, COPILOT_HINT_MAX) || undefined;

  const db = new Db(c.env.DB);
  const conv = await new ConversationsRepo(db).getById(c.req.param("id"));
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);

  if (!claimSuggestSlot(conv.id)) {
    return c.json({ ok: false, error: "suggest_throttled" }, 429);
  }

  try {
    const out = await suggestReply(c.env, conv, hint);
    return c.json({ ok: true, ...out }, 200);
  } catch (e) {
    if (e instanceof CopilotError) {
      if (e.code === "no_history") return c.json({ ok: false, error: "no_history" }, 409);
      return c.json({ ok: false, error: "llm_failed", detail: e.message }, 502);
    }
    throw e;
  }
});

// POST /api/conversations/:id/read — el dueño abrió el hilo en la app.
inboxApi.post("/conversations/:id/read", async (c) => {
  const db = new Db(c.env.DB);
  const conv = await new ConversationsRepo(db).getById(c.req.param("id"));
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);
  await new ConversationReadsRepo(db).markRead(conv.id);
  return c.json({ ok: true }, 200);
});

const ADMIN_LINK_TTL_MS = 2 * 60 * 1000;

// POST /api/admin-link — SSO de un solo uso al /admin del bot (Modo Agencia /
// app móvil): token efímero que /admin/entrar/:token canjea por la sesión
// maestra. Reusa la maquinaria de magic_links (single-use + TTL).
inboxApi.post("/admin-link", async (c) => {
  const links = new MagicLinksRepo(new Db(c.env.DB));
  const token = await links.create(SSO_MASTER_EMAIL, ADMIN_LINK_TTL_MS);
  // Esta ruta SÍ tiene el request a mano (Hono, no un cron): selfOriginFromRequest
  // cae al origin real de la request entrante si DASHBOARD_BASE_URL/self_origin
  // están vacíos — selfOrigin() a secas devolvía "" en ese caso y la app móvil
  // recibía una URL sin dominio (`/admin/entrar/<token>` a palo, inutilizable
  // como link absoluto).
  const origin = await selfOriginFromRequest(c.env, c.req.url);
  // Purga oportunista de tokens vencidos/usados — magic_links nunca se limpiaba
  // solo (best-effort, nunca bloquea la respuesta si falla).
  await links.purgeExpired().catch(() => {});
  return c.json(
    { ok: true, url: `${origin}/admin/entrar/${token}`, expires_at: Date.now() + ADMIN_LINK_TTL_MS },
    200,
  );
});

// ── 1. Notas internas (Wiring v2 §1) ─────────────────────────────────────────

const NOTE_MAX_LEN = 2000;

// POST /api/conversations/:id/notes {text} — nota interna del dueño/equipo,
// NUNCA se manda por ningún adapter (no toca sender.ts). Se persiste como
// role `note`: agent.ts la mete al historial del LLM como contexto interno
// (ver mapHistoryToAiMessages) y GET .../messages la incluye tal cual.
inboxApi.post("/conversations/:id/notes", async (c) => {
  let body: { text?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const text = String(body.text ?? "").trim();
  if (!text || text.length > NOTE_MAX_LEN) return c.json({ ok: false, error: "invalid_text" }, 400);

  const db = new Db(c.env.DB);
  const conv = await new ConversationsRepo(db).getById(c.req.param("id"));
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);

  const id = await new MessagesRepo(db).append(conv.id, "note", text);
  return c.json({ ok: true, id }, 200);
});

// ── 2. Respuestas rápidas (Wiring v2 §2) ─────────────────────────────────────

interface QuickReplyItem {
  label: string;
  text: string;
}
const QUICK_REPLIES_MAX = 20;
const QUICK_REPLY_LABEL_MAX = 30;
const QUICK_REPLY_TEXT_MAX = 500;

function isValidQuickReplies(items: unknown): items is QuickReplyItem[] {
  if (!Array.isArray(items) || items.length > QUICK_REPLIES_MAX) return false;
  return items.every((it) => {
    if (!it || typeof it !== "object") return false;
    const { label, text } = it as Record<string, unknown>;
    return (
      typeof label === "string" &&
      label.trim().length > 0 &&
      label.length <= QUICK_REPLY_LABEL_MAX &&
      typeof text === "string" &&
      text.trim().length > 0 &&
      text.length <= QUICK_REPLY_TEXT_MAX
    );
  });
}

// GET /api/quick-replies → items del sheet de respuestas rápidas del composer.
inboxApi.get("/quick-replies", async (c) => {
  const raw = await new SettingsRepo(new Db(c.env.DB)).get(SETTING_KEYS.quickReplies);
  let items: QuickReplyItem[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (isValidQuickReplies(parsed)) items = parsed;
    } catch {
      /* setting malformado — como si no hubiera ninguna */
    }
  }
  return c.json({ ok: true, items }, 200);
});

// PUT /api/quick-replies {items} → reemplaza la lista completa (máx 20).
inboxApi.put("/quick-replies", async (c) => {
  let body: { items?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!isValidQuickReplies(body.items)) return c.json({ ok: false, error: "invalid_items" }, 400);
  const trimmed = body.items.map((it) => ({ label: it.label.trim(), text: it.text.trim() }));
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.quickReplies, JSON.stringify(trimmed));
  return c.json({ ok: true }, 200);
});

// ── 3. Horario y ausencias (Wiring v2 §3, solo la parte del bot) ────────────

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function emptyHoursDays(): BusinessHours["days"] {
  const days = {} as BusinessHours["days"];
  for (const d of BUSINESS_HOURS_DAY_KEYS) days[d] = null;
  return days;
}

function isValidDaysPatch(v: unknown): v is Partial<BusinessHours["days"]> {
  if (!v || typeof v !== "object") return false;
  for (const [k, slot] of Object.entries(v as Record<string, unknown>)) {
    if (!(BUSINESS_HOURS_DAY_KEYS as readonly string[]).includes(k)) return false;
    if (slot === null) continue;
    if (!slot || typeof slot !== "object") return false;
    const { from, to } = slot as Record<string, unknown>;
    if (typeof from !== "string" || typeof to !== "string") return false;
    if (!HHMM_RE.test(from) || !HHMM_RE.test(to)) return false;
  }
  return true;
}

async function loadBusinessHours(db: Db): Promise<BusinessHours> {
  const raw = await new SettingsRepo(db).get(SETTING_KEYS.businessHours);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.days) {
        return {
          days: { ...emptyHoursDays(), ...parsed.days },
          awayMessage: typeof parsed.awayMessage === "string" ? parsed.awayMessage : "",
          mode: BUSINESS_HOURS_MODES.includes(parsed.mode)
            ? (parsed.mode as BusinessHoursMode)
            : undefined,
          timezone: isValidTimezone(parsed.timezone) ? parsed.timezone : undefined,
          services: sanitizeServices(parsed.services),
        };
      }
    } catch {
      /* setting malformado — cae al default vacío */
    }
  }
  return { days: emptyHoursDays(), awayMessage: "" };
}

// GET /api/hours → horario estructurado + el texto libre viejo de referencia
// (legacy_hours = member/config.local businessConfig.hours, solo lectura).
inboxApi.get("/hours", async (c) => {
  const hours = await loadBusinessHours(new Db(c.env.DB));
  return c.json(
    {
      ok: true,
      days: hours.days,
      away_message: hours.awayMessage ?? "",
      mode: hours.mode ?? null,
      timezone: hours.timezone ?? null,
      // snake_case para el contrato de la app (el store interno es camelCase).
      services: (hours.services ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        duration_min: s.durationMin,
      })),
      legacy_hours: legacyHours(),
    },
    200,
  );
});

// PUT /api/hours {days?, away_message?} — parcial: solo se tocan los días/
// campo que vienen en el body; el resto se conserva. NUNCA borra legacy_hours
// (esa es una lectura del código del template, no un setting).
inboxApi.put("/hours", async (c) => {
  let body: {
    days?: unknown;
    away_message?: unknown;
    mode?: unknown;
    timezone?: unknown;
    services?: unknown;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  if (body.days !== undefined && !isValidDaysPatch(body.days)) {
    return c.json({ ok: false, error: "invalid_days" }, 400);
  }
  if (
    body.away_message !== undefined &&
    (typeof body.away_message !== "string" || body.away_message.length > 500)
  ) {
    return c.json({ ok: false, error: "invalid_away_message" }, 400);
  }
  if (body.mode !== undefined && !BUSINESS_HOURS_MODES.includes(body.mode as BusinessHoursMode)) {
    return c.json({ ok: false, error: "invalid_mode" }, 400);
  }
  if (body.timezone !== undefined && body.timezone !== "" && !isValidTimezone(body.timezone)) {
    return c.json({ ok: false, error: "invalid_timezone" }, 400);
  }

  const db = new Db(c.env.DB);
  const current = await loadBusinessHours(db);
  const next: BusinessHours = {
    days: { ...current.days, ...(body.days as Partial<BusinessHours["days"]> | undefined) },
    awayMessage:
      body.away_message !== undefined ? (body.away_message as string).trim() : current.awayMessage,
    mode: body.mode !== undefined ? (body.mode as BusinessHoursMode) : current.mode,
    // "" limpia la timezone (cae al env); un valor válido la fija.
    timezone:
      body.timezone !== undefined
        ? (body.timezone as string) || undefined
        : current.timezone,
    services: body.services !== undefined ? sanitizeServices(body.services) : current.services,
  };
  await new SettingsRepo(db).set(SETTING_KEYS.businessHours, JSON.stringify(next));
  return c.json({ ok: true }, 200);
});

// GET /api/faqs → preguntas frecuentes del negocio (editables desde la app).
inboxApi.get("/faqs", async (c) => {
  const raw = await new SettingsRepo(new Db(c.env.DB)).get(SETTING_KEYS.faqs);
  let faqs: ReturnType<typeof sanitizeFaqs> = [];
  if (raw) {
    try {
      faqs = sanitizeFaqs(JSON.parse(raw));
    } catch {
      /* setting malformado → lista vacía */
    }
  }
  return c.json({ ok: true, faqs }, 200);
});

// PUT /api/faqs {faqs:[{id?,question,answer}]} — reemplaza la lista completa
// (saneada). El bot las inyecta al prompt (settings-loader).
inboxApi.put("/faqs", async (c) => {
  let body: { faqs?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const faqs = sanitizeFaqs(body.faqs);
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.faqs, JSON.stringify(faqs));
  return c.json({ ok: true, faqs }, 200);
});

// Helper: lee un setting JSON y lo sanea; devuelve el default si falta/está roto.
async function readInfoSetting<T>(db: Db, key: string, sanitize: (v: unknown) => T): Promise<T> {
  const raw = await new SettingsRepo(db).get(key);
  if (raw) {
    try {
      return sanitize(JSON.parse(raw));
    } catch {
      /* setting malformado → default */
    }
  }
  return sanitize(undefined);
}

async function writeInfoSetting(db: Db, key: string, value: unknown): Promise<void> {
  await new SettingsRepo(db).set(key, JSON.stringify(value));
}

// GET/PUT /api/promo → oferta vigente (on/off + vencimiento). El bot la inyecta
// como fuente de verdad SOLO si está activa y no ha vencido (settings-loader).
inboxApi.get("/promo", async (c) => {
  const promo = await readInfoSetting(new Db(c.env.DB), SETTING_KEYS.promo, sanitizePromo);
  return c.json({ ok: true, promo }, 200);
});
inboxApi.put("/promo", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const promo = sanitizePromo(body);
  await writeInfoSetting(new Db(c.env.DB), SETTING_KEYS.promo, promo);
  return c.json({ ok: true, promo }, 200);
});

// GET/PUT /api/location → ubicación y cobertura.
inboxApi.get("/location", async (c) => {
  const location = await readInfoSetting(new Db(c.env.DB), SETTING_KEYS.location, sanitizeLocation);
  return c.json({ ok: true, location }, 200);
});
inboxApi.put("/location", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const location = sanitizeLocation(body);
  await writeInfoSetting(new Db(c.env.DB), SETTING_KEYS.location, location);
  return c.json({ ok: true, location }, 200);
});

// GET/PUT /api/payment-methods → formas de pago que acepta el negocio.
inboxApi.get("/payment-methods", async (c) => {
  const payment_methods = await readInfoSetting(new Db(c.env.DB), SETTING_KEYS.paymentMethods, sanitizePaymentMethods);
  return c.json({ ok: true, payment_methods }, 200);
});
inboxApi.put("/payment-methods", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const payment_methods = sanitizePaymentMethods(body);
  await writeInfoSetting(new Db(c.env.DB), SETTING_KEYS.paymentMethods, payment_methods);
  return c.json({ ok: true, payment_methods }, 200);
});

// GET/PUT /api/catalog → servicios y precios (lista corta). Body PUT: {catalog:[…]}.
inboxApi.get("/catalog", async (c) => {
  const catalog = await readInfoSetting(new Db(c.env.DB), SETTING_KEYS.catalog, sanitizeCatalog);
  return c.json({ ok: true, catalog }, 200);
});
inboxApi.put("/catalog", async (c) => {
  let body: { catalog?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const catalog = sanitizeCatalog(body.catalog);
  await writeInfoSetting(new Db(c.env.DB), SETTING_KEYS.catalog, catalog);
  return c.json({ ok: true, catalog }, 200);
});

// GET /api/business → el business_context EFECTIVO (el setting si el dueño ya lo
// editó y no está vacío; si no, el render del onboarding) + `rendered_default`
// SIEMPRE (el render del onboarding), para que la app muestre de dónde partir y
// el dueño no borre a ciegas. Mismo estilo que GET /hours con `legacy_hours`.
// El prompt YA lee este setting (settings-loader.ts) — aquí NO se toca el prompt.
inboxApi.get("/business", async (c) => {
  const repo = new SettingsRepo(new Db(c.env.DB));
  const stored = (await repo.get(SETTING_KEYS.businessContext)) ?? "";
  const rendered_default = renderBusinessContext();
  const business_context = stored.trim().length > 0 ? stored : rendered_default;
  return c.json({ ok: true, business_context, rendered_default }, 200);
});

// PUT /api/business { business_context } — valida con businessContextOk (la MISMA
// regla que el panel /admin/config: una sola fuente). Rechaza vacío para no
// borrar por accidente. Si pasa, escribe el setting DIRECTO — igual que PUT
// /hours escribe `business_hours`: business_context sigue en NEVER_WRITABLE (la
// reja genérica de POST /api/settings lo prohíbe), este endpoint dedicado es su
// única puerta de escritura remota.
inboxApi.put("/business", async (c) => {
  let body: { business_context?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const v = typeof body.business_context === "string" ? body.business_context : "";
  if (!businessContextOk(v)) {
    return c.json({ ok: false, error: "invalid_business_context" }, 400);
  }
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.businessContext, v);
  return c.json({ ok: true, business_context: v }, 200);
});

// ── 4. Cómo habla tu bot (Wiring v2 §4) ─────────────────────────────────────

// Valores REALES que consume system-prompt.ts / settings-loader.ts (setting
// `tone`, panel "Config" — ver src/admin/views/config.ts). El diseño pedía
// Formal/Cercano/Breve; los 3 tonos reales del sistema son estos, así que el
// mapeo es id corto → valor real (i18n: src/admin/i18n.ts "control.tono*").
const TONE_OPTIONS = [
  {
    id: "calido",
    value: "cálido y cercano",
    label: "Cálido",
    sample: "¡Hola! Con gusto te ayudo, cuéntame qué necesitas.",
  },
  {
    id: "formal",
    value: "formal y profesional",
    label: "Formal",
    sample: "Buen día, quedo a sus órdenes. ¿En qué puedo apoyarle?",
  },
  {
    id: "divertido",
    value: "divertido y relajado",
    label: "Divertido",
    sample: "¡Ey, qué tal! Aquí andamos, dime en qué te echo la mano.",
  },
] as const;
type ToneId = (typeof TONE_OPTIONS)[number]["id"];

function toneIdForValue(value: string): ToneId | null {
  return TONE_OPTIONS.find((t) => t.value === value)?.id ?? null;
}

// "agendar" SÍ corresponde a tools reales (revisado en src/tools/index.ts):
// el genérico scheduleAppointment (free tier) y agendarCita/cancelarCita (los
// giros de cita — barbería, salón, dentista, clínica, spa, gimnasio, coach).
// Apagarlas vía disabled_tools es más fuerte que solo pedírselo por texto: el
// modelo ni siquiera las ve en el prompt. verDisponibilidad (solo lectura) se
// deja encendida a propósito — el permiso es sobre RESERVAR, no sobre ver.
const AGENDAR_TOOL_NAMES = ["scheduleAppointment", "agendarCita", "cancelarCita"];

function agendarAllowed(disabledCsv: string[]): boolean {
  return !AGENDAR_TOOL_NAMES.some((n) => disabledCsv.includes(n));
}
function withAgendarDisabled(disabledCsv: string[], disabled: boolean): string[] {
  const set = new Set(disabledCsv);
  for (const n of AGENDAR_TOOL_NAMES) {
    if (disabled) set.add(n);
    else set.delete(n);
  }
  return [...set];
}

// "queja" y "cambiar_cita" SÍ mapean a escalation_keywords (config de
// escalación existente — settings-loader.ts las mete al prompt como
// "El cliente escribe alguna de estas palabras: …"). Se agregan/quitan como
// conjunto exacto para no tocar otras palabras que el dueño ya tenía a mano
// (panel Config → "Palabras que escalan a humano").
const RULE_KEYWORDS = {
  queja: ["queja", "reclamo", "insatisfecho", "mal servicio"],
  cambiar_cita: ["cambiar cita", "reagendar", "cancelar cita"],
} as const;
type KeywordRuleId = keyof typeof RULE_KEYWORDS;

function csvToList(raw: string | null): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
function ruleKeywordsEnabled(list: string[], ruleId: KeywordRuleId): boolean {
  const lower = list.map((w) => w.toLowerCase());
  return RULE_KEYWORDS[ruleId].every((kw) => lower.includes(kw));
}
function withRuleKeywords(list: string[], ruleId: KeywordRuleId, enabled: boolean): string[] {
  const set = new Set(list);
  for (const kw of RULE_KEYWORDS[ruleId]) {
    if (enabled) set.add(kw);
    else set.delete(kw);
  }
  return [...set];
}

const RULE_IDS = ["pide_humano", "queja", "regatea", "cambiar_cita", "no_entendio"] as const;
type RuleId = (typeof RULE_IDS)[number];

// GET /api/voice → estado efectivo de tono, permisos y reglas de escalación.
inboxApi.get("/voice", async (c) => {
  const settings = new SettingsRepo(new Db(c.env.DB));
  const [toneRaw, customInstructionsRaw, escalationRaw, disabledRaw] = await Promise.all([
    settings.get(SETTING_KEYS.tone),
    settings.get(SETTING_KEYS.customInstructions),
    settings.get(SETTING_KEYS.escalationKeywords),
    settings.get(SETTING_KEYS.disabledTools),
  ]);
  // Mismo fallback que settings-loader.ts: sin tono elegido, manda el
  // defaultTone del nicho (texto libre, no necesariamente uno de los 3 ids).
  const niche = getNiche(c.env);
  const effectiveToneValue = toneRaw ?? (niche.defaultTone || "");
  const customInstructions = customInstructionsRaw ?? "";
  const escalationList = csvToList(escalationRaw);
  const disabledList = csvToList(disabledRaw);
  const perms = readPerms(customInstructions);
  const customRules = readCustomRules(customInstructions);

  const rules: Record<RuleId, { enabled: boolean; locked: boolean }> = {
    pide_humano: { enabled: true, locked: true }, // regla de seguridad fija (siempre en <escalation_rules>)
    queja: { enabled: ruleKeywordsEnabled(escalationList, "queja"), locked: false },
    regatea: { enabled: customRules.regatea, locked: false },
    cambiar_cita: { enabled: ruleKeywordsEnabled(escalationList, "cambiar_cita"), locked: false },
    no_entendio: { enabled: customRules.no_entendio, locked: false },
  };

  return c.json(
    {
      ok: true,
      tone: {
        value: effectiveToneValue,
        id: toneIdForValue(effectiveToneValue),
        options: TONE_OPTIONS.map(({ id, label, sample }) => ({ id, label, sample })),
      },
      perms: { ...perms, agendar: perms.agendar && agendarAllowed(disabledList) },
      rules: RULE_IDS.map((id) => ({ id, ...rules[id] })),
    },
    200,
  );
});

// PUT /api/voice {tone?, perms?, rules?} — aditivo sobre settings existentes.
// JAMÁS toca system_prompt_override ni borra custom_instructions fuera de los
// bloques [[forja-app:perms]] / [[forja-app:rules]] (ver voice-blocks.ts).
inboxApi.put("/voice", async (c) => {
  let body: { tone?: unknown; perms?: unknown; rules?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const db = new Db(c.env.DB);
  const settings = new SettingsRepo(db);

  if (body.tone !== undefined) {
    const opt = TONE_OPTIONS.find((t) => t.id === body.tone);
    if (!opt) return c.json({ ok: false, error: "invalid_tone" }, 400);
    await settings.set(SETTING_KEYS.tone, opt.value);
  }

  if (body.perms !== undefined) {
    const raw = body.perms;
    if (!raw || typeof raw !== "object") return c.json({ ok: false, error: "invalid_perms" }, 400);
    const entries = raw as Record<string, unknown>;
    const patch: Partial<Record<"precios" | "agendar" | "descuentos", boolean>> = {};
    for (const key of ["precios", "agendar", "descuentos"] as const) {
      if (entries[key] === undefined) continue;
      if (typeof entries[key] !== "boolean") return c.json({ ok: false, error: "invalid_perms" }, 400);
      patch[key] = entries[key] as boolean;
    }
    const currentCustom = (await settings.get(SETTING_KEYS.customInstructions)) ?? "";
    await settings.set(SETTING_KEYS.customInstructions, writePerms(currentCustom, patch));
    if (patch.agendar !== undefined) {
      const currentDisabled = csvToList(await settings.get(SETTING_KEYS.disabledTools));
      await settings.set(
        SETTING_KEYS.disabledTools,
        withAgendarDisabled(currentDisabled, !patch.agendar).join(","),
      );
    }
  }

  if (body.rules !== undefined) {
    const raw = body.rules;
    if (!raw || typeof raw !== "object") return c.json({ ok: false, error: "invalid_rules" }, 400);
    const entries = raw as Record<string, unknown>;
    for (const [key, val] of Object.entries(entries)) {
      if (!(RULE_IDS as readonly string[]).includes(key) || typeof val !== "boolean") {
        return c.json({ ok: false, error: "invalid_rules" }, 400);
      }
    }
    // pide_humano es regla de seguridad fija: se acepta en el body (para que
    // la app pueda mandar de vuelta el estado completo que le dio el GET) pero
    // NUNCA se apaga — se ignora en silencio si viene.
    if (entries.queja !== undefined || entries.cambiar_cita !== undefined) {
      const currentList = csvToList(await settings.get(SETTING_KEYS.escalationKeywords));
      let nextList = currentList;
      if (entries.queja !== undefined) nextList = withRuleKeywords(nextList, "queja", entries.queja as boolean);
      if (entries.cambiar_cita !== undefined) {
        nextList = withRuleKeywords(nextList, "cambiar_cita", entries.cambiar_cita as boolean);
      }
      await settings.set(SETTING_KEYS.escalationKeywords, nextList.join(","));
    }
    if (entries.regatea !== undefined || entries.no_entendio !== undefined) {
      const currentCustom = (await settings.get(SETTING_KEYS.customInstructions)) ?? "";
      const patch: Partial<Record<"regatea" | "no_entendio", boolean>> = {};
      if (entries.regatea !== undefined) patch.regatea = entries.regatea as boolean;
      if (entries.no_entendio !== undefined) patch.no_entendio = entries.no_entendio as boolean;
      await settings.set(SETTING_KEYS.customInstructions, writeCustomRules(currentCustom, patch));
    }
  }

  return c.json({ ok: true }, 200);
});

// ── 7. Que el bot aprenda esto (Contrato v3.2 §10, Forja+) ───────────────────
//
// El dueño acaba de contestar a mano y quiere que la próxima vez lo haga el
// bot. Se destila UNA regla corta del hilo (el mismo destilador del flywheel
// nocturno) y se guarda en `learned_lessons`, que el prompt generado inyecta
// como <lecciones_aprendidas>. Con vista previa antes de guardar: el dueño lee
// la regla y decide.

const LEARN_INSTRUCTION_MAX = 300;
/** Cuánto historial ve el destilador (igual que el flywheel nocturno). */
const LEARN_HISTORY_TURNS = 30;

/** Largo de una regla: el destilador las pide de ≤140, aquí se hace cumplir. */
const LESSON_MAX = 140;

/** Fuera `<`/`>`: este texto acaba DENTRO de un bloque del system prompt. */
function stripAngles(text: string): string {
  return text.replace(/[<>]/g, "").trim();
}

function sanitizeLesson(text: string): string {
  return stripAngles(text).slice(0, LESSON_MAX);
}

// POST /api/conversations/:id/learn {message_id?, instruction?, preview?}
inboxApi.post("/conversations/:id/learn", async (c) => {
  if (!isPro(c.env)) return c.json({ ok: false, error: "pro_required" }, 403);

  let body: { message_id?: unknown; instruction?: unknown; preview?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const instruction = stripAngles(String(body.instruction ?? "")).slice(0, LEARN_INSTRUCTION_MAX) || undefined;
  const preview = body.preview === true;
  const messageId = String(body.message_id ?? "") || undefined;

  const db = new Db(c.env.DB);
  const conv = await new ConversationsRepo(db).getById(c.req.param("id"));
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);

  const history = await new MessagesRepo(db).lastN(conv.id, LEARN_HISTORY_TURNS);
  if (!history.length) return c.json({ ok: false, error: "no_history" }, 409);

  const { distillLesson, lessonTranscript, getLessons, saveLessons, lessonId, MAX_LESSONS } =
    await import("./flywheel/detect");
  let lesson: string | null;
  try {
    lesson = await distillLesson(c.env, lessonTranscript(history, messageId), { instruction });
  } catch (e) {
    return c.json(
      { ok: false, error: "llm_failed", detail: e instanceof Error ? e.message : String(e) },
      502,
    );
  }
  // Sin regla clara pero CON instrucción del dueño, manda la suya: el campo
  // "¿qué debe aprender?" existe justo para cuando el destilador no la ve.
  const text = sanitizeLesson(lesson || instruction || "");
  if (!text) {
    return c.json(
      {
        ok: false,
        error: "no_lesson",
        detail: "No encontré una regla general que sacar de aquí. Dime tú qué debe aprender.",
      },
      409,
    );
  }

  // Vista previa: el dueño lee la regla ANTES de que exista. Sin tocar D1.
  if (preview) {
    return c.json({ ok: true, lesson: { id: null, text }, saved: false }, 200);
  }

  const lessons = await getLessons(c.env);
  if (lessons.includes(text)) {
    return c.json(
      { ok: true, lesson: { id: await lessonId(text), text }, saved: false, reason: "duplicate" },
      200,
    );
  }
  if (lessons.length >= MAX_LESSONS) {
    return c.json(
      {
        ok: false,
        error: "lessons_full",
        detail: `Tu bot ya tiene ${MAX_LESSONS} lecciones. Quita una para enseñarle otra.`,
      },
      409,
    );
  }

  await saveLessons(c.env, [...lessons, text]);

  // Queda también en ✦ Mejoras del panel, ya aplicada: el dueño ve en un solo
  // lugar todo lo que el bot ha aprendido, venga del cron o de la app. El
  // fingerprint lleva un uuid porque una conversación puede enseñar varias
  // cosas (el del cron es el id de la conversación, uno por vida).
  try {
    const { SuggestionsRepo } = await import("./db/suggestions");
    const repo = new SuggestionsRepo(db);
    const id = await repo.createIfNew({
      kind: "leccion",
      fingerprint: `app:${crypto.randomUUID()}`,
      title: text,
      payload: { lesson: text, conversationId: conv.id },
      evidence: "Desde la app: el dueño marcó su respuesta para que el bot la aprenda.",
    });
    if (id) await repo.setStatus(id, "applied");
  } catch (e) {
    // La lección YA está guardada; el registro en Mejoras es la bitácora.
    console.warn("[learn] no se pudo registrar en Mejoras:", e);
  }

  // Con un system prompt override, el prompt GENERADO no se usa — y las
  // lecciones viven ahí dentro. Se guarda igual (si quita el override, aplican)
  // pero la app tiene que poder decírselo.
  const override = resolvePromptOverride(await new SettingsRepo(db).all(), conv.channel);
  return c.json(
    {
      ok: true,
      lesson: { id: await lessonId(text), text },
      saved: true,
      applies: !override,
      count: lessons.length + 1,
      max: MAX_LESSONS,
      ...(override ? { warning: "prompt_override" } : {}),
    },
    200,
  );
});

// GET /api/lessons → "Lo que ha aprendido" (pantalla de la app).
inboxApi.get("/lessons", async (c) => {
  if (!isPro(c.env)) return c.json({ ok: false, error: "pro_required" }, 403);
  const { getLessons, lessonId, MAX_LESSONS } = await import("./flywheel/detect");
  const texts = await getLessons(c.env);
  const lessons = await Promise.all(texts.map(async (text) => ({ id: await lessonId(text), text })));
  return c.json({ ok: true, lessons, count: lessons.length, max: MAX_LESSONS }, 200);
});

// DELETE /api/lessons/:id → el dueño la quita ("eso ya no aplica").
inboxApi.delete("/lessons/:id", async (c) => {
  if (!isPro(c.env)) return c.json({ ok: false, error: "pro_required" }, 403);
  const { getLessons, saveLessons, lessonId } = await import("./flywheel/detect");
  const target = c.req.param("id");
  const texts = await getLessons(c.env);
  const ids = await Promise.all(texts.map((t) => lessonId(t)));
  const idx = ids.indexOf(target);
  if (idx === -1) return c.json({ ok: false, error: "not_found" }, 404);
  const quedan = texts.filter((_, i) => i !== idx);
  await saveLessons(c.env, quedan);
  return c.json({ ok: true, count: quedan.length }, 200);
});

// ── Subir y mandar un archivo desde la app (Contrato v3 §A3) ─────────────────

const CAPTION_MAX = 1000;
/** Mínimo común de los canales: WhatsApp imagen 5MB · audio 16MB · doc 100MB
 *  (aquí 20MB, el tope del bucket y sano para el proxy de dos Workers). */
const UPLOAD_LIMITS: Record<"image" | "audio" | "document", number> = {
  image: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 20 * 1024 * 1024,
};
const UPLOAD_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic",
  "audio/ogg", "audio/opus", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav",
  "application/pdf", "application/msword", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// POST /api/conversations/:id/media (multipart: file, caption?) — el dueño le
// manda una foto / nota de voz / documento al cliente desde el hilo.
inboxApi.post("/conversations/:id/media", async (c) => {
  const db = new Db(c.env.DB);
  const convs = new ConversationsRepo(db);
  const conv = await convs.getById(c.req.param("id"));
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);

  // Sin bucket R2 no hay dónde dejar el archivo para que el proveedor lo baje.
  // NO se cae al blob de settings: 1.2MB no alcanza y ensuciaría la Galería.
  if (!c.env.MEDIA) {
    return c.json(
      {
        ok: false,
        error: "media_storage_unavailable",
        detail: "El bot no tiene almacenamiento de archivos (Bóveda, Forja+). Actívalo con el skill /boveda.",
      },
      409,
    );
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ ok: false, error: "invalid_form" }, 400);
  }
  // Los tipos de workerd declaran las entradas del form como string: el cast
  // es a `File` real (Hono ya lo parsea así en runtime), validado por pato.
  const entry = form.get("file") as unknown;
  if (!entry || typeof entry === "string" || typeof (entry as File).arrayBuffer !== "function") {
    return c.json({ ok: false, error: "invalid_file" }, 400);
  }
  const file = entry as File;
  const caption = String(form.get("caption") ?? "").trim().slice(0, CAPTION_MAX);

  const { kindForMime, extForMime, ensureMediaTable } = await import("./media/boveda");
  const mime = (file.type || "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!UPLOAD_MIMES.has(mime)) {
    return c.json({ ok: false, error: "unsupported_type", detail: mime }, 415);
  }
  const kind = kindForMime(mime);
  // Nota de voz (Contrato v3.2 §4): la app graba AAC y marca `voice=1` para que
  // salga como PTT donde el canal lo soporte (Telegram sendVoice, WhatsApp
  // audio) en vez de como archivo adjunto. Solo tiene sentido en audio: en una
  // foto o un PDF se ignora. `duration_s` es lo que midió el grabador — se
  // persiste para que la burbuja del hilo diga "0:12" sin abrir el archivo.
  const isVoice = kind === "audio" && String(form.get("voice") ?? "") === "1";
  const durationRaw = Number.parseFloat(String(form.get("duration_s") ?? ""));
  const durationS = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null;
  if (file.size > UPLOAD_LIMITS[kind]) {
    return c.json(
      {
        ok: false,
        error: "too_large",
        detail: `El archivo pesa ${Math.round(file.size / 1024 / 1024)}MB y el máximo aquí es ${Math.round(UPLOAD_LIMITS[kind] / 1024 / 1024)}MB.`,
      },
      413,
    );
  }

  // Ventana de 24 h cerrada: el proveedor lo va a rechazar. Se rebota ANTES de
  // subir nada, así no queda basura en el bucket.
  const waWindow = await windowFor(db, conv, Date.now());
  if (waWindow?.state === "closed") {
    return c.json({ ok: false, error: "send_failed", detail: "window_closed" }, 409);
  }

  const mediaId = crypto.randomUUID();
  const filename = (file.name || "").slice(0, 120) || undefined;
  const r2Key = `media/${conv.id}/${mediaId}.${extForMime(mime)}`;
  await c.env.MEDIA.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: mime } });
  await ensureMediaTable(db);
  await db.run(
    `INSERT INTO media (id, conversation_id, r2_key, kind, mime, filename, caption, bytes,
                        duration_s, created_at, direction)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'out')`,
    [mediaId, conv.id, r2Key, kind, mime, filename ?? null, caption || null, file.size, durationS, Date.now()],
  );

  /** Deja el bucket y la tabla como estaban: nada persiste si no se entregó. */
  const rollback = async () => {
    await c.env.MEDIA!.delete(r2Key).catch(() => {});
    await db.run("DELETE FROM media WHERE id = ?", [mediaId]).catch(() => {});
  };

  const origin = await selfOriginFromRequest(c.env, c.req.url);
  const { signedOutboundUrl } = await import("./media/outbound");
  const url = await signedOutboundUrl(c.env, mediaId, origin);
  if (!url) {
    await rollback();
    return c.json(
      {
        ok: false,
        error: "send_failed",
        detail: "El bot no sabe su propia URL pública (configura DASHBOARD_BASE_URL).",
      },
      409,
    );
  }

  const channel = conv.channel as ChannelId;
  const replyKind = kind === "document" ? "file" : kind;
  // Canal sin media nativa (o sin documentos nativos, como Instagram/ManyChat):
  // el archivo va como link en texto — llega igual, sin burbuja.
  const nativo = MEDIA_CHANNELS.has(channel) && (replyKind !== "file" || FILE_CHANNELS.has(channel));
  try {
    await pickAdapter(channel).sendReply(
      nativo
        ? {
            channel,
            channelUserId: conv.channel_user_id,
            chunks: [],
            media: [
              {
                kind: replyKind,
                url,
                ...(caption ? { caption } : {}),
                ...(filename ? { filename } : {}),
                // Marcada por la app, o formato que YA es de nota de voz.
                ...(isVoice || mime === "audio/ogg" || mime === "audio/opus" ? { voice: true } : {}),
              },
            ],
          }
        : {
            channel,
            channelUserId: conv.channel_user_id,
            chunks: [caption ? `${caption}\n${url}` : url],
          },
      c.env,
      // strict: un rechazo del proveedor tiene que llegar como excepción para
      // que el rollback borre el objeto de R2 y su fila — si no, el bucket se
      // queda con un archivo que nadie recibió.
      { strict: true },
    );
  } catch (e) {
    await rollback();
    const detail = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: "send_failed", detail }, 409);
  }

  const now = Date.now();
  const msgId = await new MessagesRepo(db).append(
    conv.id,
    "owner",
    caption ? `${caption}\n${mediaMarker(mediaId)}` : mediaMarker(mediaId),
  );
  const { attachMediaToMessage } = await import("./media/boveda");
  await attachMediaToMessage(db, [mediaId], msgId);
  await convs.touchLastMessage(conv.id);
  await convs.setPausedUntil(conv.id, now + (await resolveTakeoverMs(c.env)));
  await convs.setTakenBy(conv.id, readActor(c));
  await new ConversationReadsRepo(db).markRead(conv.id, now);

  return c.json(
    {
      ok: true,
      id: msgId,
      media: {
        kind: replyKind,
        url: `/api/media/${mediaId}`,
        ...(caption ? { caption } : {}),
        ...(filename ? { filename } : {}),
        size: file.size,
      },
    },
    200,
  );
});

// GET /api/media/:id → los BYTES del archivo, desde el R2 del miembro. Hereda
// el Bearer del control plane; la nube hace proxy en streaming hacia la app con
// su propia auth y NUNCA guarda el archivo (principio de privacidad: los
// archivos del cliente no salen del bot más que para pasar por el cable).
inboxApi.get("/media/:id", async (c) => {
  const db = new Db(c.env.DB);
  const { getMediaRow } = await import("./media/boveda");
  const row = await getMediaRow(db, c.req.param("id"));
  if (!row) return c.json({ ok: false, error: "media_not_found" }, 404);
  if (!c.env.MEDIA) return c.json({ ok: false, error: "media_gone" }, 410);

  const obj = await c.env.MEDIA.get(row.r2_key);
  // La fila existe pero el objeto ya no (purga del bucket, borrado manual).
  if (!obj) return c.json({ ok: false, error: "media_gone" }, 410);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": row.mime || "application/octet-stream",
      ...(row.filename
        ? { "Content-Disposition": `inline; filename="${row.filename.replace(/"/g, "")}"` }
        : {}),
      "Cache-Control": "private, max-age=3600",
    },
  });
});

// GET /api/media/legacy/:messageId → imagen histórica que solo dejó el marcador
// [IMAGE_URL:] (bots sin bucket R2). Se resuelve contra el proveedor AL VUELO:
// el token de Telegram se des-enmascara aquí y jamás sale del server. Esas URLs
// caducan (WhatsApp 10 min, Telegram ~1h), así que un 410 es el caso NORMAL en
// mensajes viejos — la app pinta el placeholder.
inboxApi.get("/media/legacy/:messageId", async (c) => {
  const db = new Db(c.env.DB);
  const row = await db.first<{ content: string }>("SELECT content FROM messages WHERE id = ?", [
    c.req.param("messageId"),
  ]);
  const marker = row?.content.match(/\[IMAGE_URL: (.+?)\]/);
  if (!marker) return c.json({ ok: false, error: "media_not_found" }, 404);

  const { unmaskTelegramToken } = await import("./telegramFiles");
  const url = unmaskTelegramToken(marker[1], c.env.TELEGRAM_BOT_TOKEN);
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return c.json({ ok: false, error: "media_gone" }, 410);
  }
  if (!res.ok || !res.body) return c.json({ ok: false, error: "media_gone" }, 410);
  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
});

// ── 5. Plantillas aprobadas de WhatsApp (Contrato v3 §B) ─────────────────────
//
// Fuera de la ventana de 24 h, WhatsApp solo deja pasar una plantilla aprobada.
// Hay DOS mundos y el bot ya sabe mandar en los dos (campaigns.ts / reengage):
//   · Twilio → Content API: listado REAL con SID, texto y variables.
//   · Cloud API y sus proxies (Meta oficial, Kapso, YCloud, Zernio-WhatsApp) →
//     NO existe listado; solo la plantilla que el dueño configuró a mano por
//     nombre+idioma (settings reengage_template_name/_lang) y el bot NO conoce
//     su texto — por eso `body: null` y la app pinta "texto aprobado en
//     WhatsApp Manager".

interface TemplateVariable {
  key: string;
  example?: string;
}
interface TemplateItem {
  id: string;
  provider: "twilio" | "cloud";
  label: string;
  body: string | null;
  variables: TemplateVariable[];
  approved: boolean;
}

const CLOUD_TEMPLATE_PREFIX = "cloud:";
const TEMPLATE_VARS_MAX = 10;
const TEMPLATE_VAR_LEN_MAX = 1000;

function twilioConnected(env: Env): boolean {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}
function cloudWaConnected(env: Env): boolean {
  return !!(
    (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) ||
    env.KAPSO_API_KEY ||
    env.YCLOUD_API_KEY ||
    env.ZERNIO_API_KEY
  );
}

/** Plantilla Cloud configurada a mano por el dueño (nombre + idioma). */
async function cloudTemplateSetting(db: Db): Promise<{ name: string; lang: string } | null> {
  const settings = new SettingsRepo(db);
  const [rawName, rawLang] = await Promise.all([
    settings.get(SETTING_KEYS.reengageTemplateName),
    settings.get(SETTING_KEYS.reengageTemplateLang),
  ]);
  const name = (rawName ?? "").trim();
  if (!name) return null;
  return { name, lang: (rawLang ?? "").trim() || "es" };
}

/** `cloud:<name>:<lang>` → {name, lang}. null si no es un id de ese tipo. */
function parseCloudTemplateId(id: string): { name: string; lang: string } | null {
  if (!id.startsWith(CLOUD_TEMPLATE_PREFIX)) return null;
  const rest = id.slice(CLOUD_TEMPLATE_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep <= 0) return { name: rest, lang: "es" };
  return { name: rest.slice(0, sep), lang: rest.slice(sep + 1) || "es" };
}

// GET /api/templates → sheet "Mensajes aprobados" + cuánto queda del tope diario.
inboxApi.get("/templates", async (c) => {
  const db = new Db(c.env.DB);
  const hasTwilio = twilioConnected(c.env);
  const hasCloud = cloudWaConnected(c.env);
  // Ningún WhatsApp conectado: la app no ofrece el sheet.
  if (!hasTwilio && !hasCloud) return c.json({ ok: true, templates: [], daily_cap: null }, 200);

  const templates: TemplateItem[] = [];
  if (hasTwilio) {
    const { listContentTemplates } = await import("./campaigns");
    // Fail-open: si la Content API no responde, la app ve la lista sin Twilio
    // en vez de un error — el resto del sheet (cloud + cuota) sigue sirviendo.
    const list = await listContentTemplates(c.env).catch((e) => {
      console.warn("[templates] Content API falló:", e);
      return [];
    });
    for (const t of list) {
      templates.push({
        id: t.sid,
        provider: "twilio",
        label: t.name,
        body: t.body || null,
        variables: t.variables.map((k) => {
          const example = t.variableExamples?.[k];
          return example ? { key: k, example } : { key: k };
        }),
        // El listado de Twilio no filtra por aprobación (contentApprovalStatus
        // sería 1 fetch por SID). Igual que el panel: se listan todas.
        approved: true,
      });
    }
  }
  if (hasCloud) {
    const cloud = await cloudTemplateSetting(db);
    if (cloud) {
      templates.push({
        id: `${CLOUD_TEMPLATE_PREFIX}${cloud.name}:${cloud.lang}`,
        provider: "cloud",
        label: cloud.name,
        body: null, // Meta no nos da el texto — solo el nombre configurado
        variables: [{ key: "1", example: "nombre del cliente" }],
        approved: true,
      });
    }
  }

  const { dailyTemplateCap, templatesSentLast24h } = await import("./campaigns");
  return c.json(
    {
      ok: true,
      templates,
      daily_cap: { limit: dailyTemplateCap(c.env), used: await templatesSentLast24h(db) },
    },
    200,
  );
});

/** Variables del body → Record<string,string> validado, o null si viene mal. */
function readTemplateVariables(raw: unknown): Record<string, string> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > TEMPLATE_VARS_MAX) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof v !== "string" || v.length > TEMPLATE_VAR_LEN_MAX) return null;
    out[k] = v;
  }
  return out;
}

/** {"2":"b","1":"a"} → ["a","b"] — Meta llena {{1}}, {{2}}… POR ORDEN. */
function orderedVariableValues(variables: Record<string, string>): string[] {
  return Object.entries(variables)
    .sort(([a], [b]) => (Number(a) || 0) - (Number(b) || 0))
    .map(([, v]) => v);
}

// POST /api/conversations/:id/template {template_id, variables?} — mandar un
// "recordatorio aprobado" desde el hilo. Mandar plantilla DENTRO de ventana es
// legal (no se exige state==="closed"), así que no se valida el estado: solo
// que el canal tenga plantillas.
inboxApi.post("/conversations/:id/template", async (c) => {
  let body: { template_id?: unknown; variables?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const templateId = String(body.template_id ?? "").trim();
  if (!templateId) return c.json({ ok: false, error: "invalid_template" }, 400);
  const variables = readTemplateVariables(body.variables);
  if (!variables) return c.json({ ok: false, error: "invalid_variables" }, 400);

  const db = new Db(c.env.DB);
  const convs = new ConversationsRepo(db);
  const conv = await convs.getById(c.req.param("id"));
  if (!conv) return c.json({ ok: false, error: "not_found" }, 404);

  const { getZernioCtx } = await import("./channels/zernio");
  const zctx = conv.channel === "zernio" ? await getZernioCtx(c.env, conv.channel_user_id) : null;
  if (!isWindowedChannel(conv.channel, zctx?.platform ?? null)) {
    return c.json(
      {
        ok: false,
        error: "channel_without_templates",
        detail: "Este canal no usa plantillas aprobadas — escríbele normal.",
      },
      400,
    );
  }

  const { dailyTemplateCap, templatesSentLast24h, sendTwilioTemplate, renderTemplateBody } =
    await import("./campaigns");
  if ((await templatesSentLast24h(db)) >= dailyTemplateCap(c.env)) {
    return c.json(
      {
        ok: false,
        error: "template_quota",
        detail: "Tu número llegó al tope diario de recordatorios de WhatsApp.",
      },
      429,
    );
  }

  // Cloud API y sus proxies referencian la plantilla por nombre+idioma; Twilio
  // por Content SID. El CANAL decide cuál aplica (no el id que mandó la app).
  const isCloudWa =
    conv.channel === "whatsapp" || conv.channel === "kapso" || conv.channel === "ycloud" || !!zctx;
  let cloud = isCloudWa ? parseCloudTemplateId(templateId) : null;
  if (isCloudWa && !cloud) cloud = await cloudTemplateSetting(db);
  if (isCloudWa && !cloud) {
    return c.json(
      {
        ok: false,
        error: "channel_without_templates",
        detail: "Aún no hay una plantilla aprobada configurada para este WhatsApp.",
      },
      400,
    );
  }

  // Claim ANTES de mandar (patrón de campaigns.ts): la fila es el registro del
  // gasto contra el tope diario. campaign_key único por envío — el
  // UNIQUE(campaign_key, conversation_id) NO debe bloquear un segundo
  // recordatorio legítimo al mismo cliente.
  const now = Date.now();
  const campaignKey = `inbox:${crypto.randomUUID()}`;
  await db.run(
    `INSERT INTO template_sends (campaign_key, conversation_id, kind, template_sid, sent_at)
     VALUES (?, ?, 'template', ?, ?)`,
    [campaignKey, conv.id, cloud ? `${CLOUD_TEMPLATE_PREFIX}${cloud.name}` : templateId, now],
  );

  // Texto renderizado: solo Twilio nos da el body de la plantilla. Se busca
  // ANTES de mandar para poder persistir lo que el cliente realmente va a leer
  // (así el agente tiene contexto cuando conteste "SÍ").
  let renderedText: string | null = null;
  if (!cloud) {
    const { listContentTemplates } = await import("./campaigns");
    const tpl = (await listContentTemplates(c.env).catch(() => [])).find((t) => t.sid === templateId);
    renderedText = renderTemplateBody(tpl?.body, variables);
  }

  const params = orderedVariableValues(
    Object.keys(variables).length ? variables : { "1": conv.display_name || "cliente" },
  );
  // Las 5 funciones de plantilla ya LANZAN en !res.ok (equivalente al modo
  // strict de los adapters), así que aquí no hace falta pedirlo: el catch de
  // abajo sí ve el rechazo del proveedor.
  try {
    if (conv.channel === "kapso") {
      const { sendKapsoTemplate } = await import("./channels/kapso");
      await sendKapsoTemplate(c.env, conv.channel_user_id, cloud!.name, cloud!.lang, params);
    } else if (conv.channel === "ycloud") {
      const { sendYCloudTemplate } = await import("./channels/ycloud");
      await sendYCloudTemplate(c.env, conv.channel_user_id, cloud!.name, cloud!.lang, params);
    } else if (zctx) {
      const { sendZernioTemplate } = await import("./channels/zernio");
      await sendZernioTemplate(
        c.env,
        zctx.conversation_id,
        zctx.account_id,
        cloud!.name,
        cloud!.lang,
        params,
      );
    } else if (isCloudWa) {
      const { sendWhatsappTemplate } = await import("./channels/whatsapp");
      await sendWhatsappTemplate(c.env, conv.channel_user_id, cloud!.name, cloud!.lang, params);
    } else {
      await sendTwilioTemplate(
        c.env,
        conv.channel_user_id,
        templateId,
        Object.keys(variables).length ? variables : { "1": conv.display_name || "" },
      );
    }
  } catch (e) {
    // Igual que el POST de texto: nada persistido en el hilo. El claim se queda
    // (mismo criterio que campaigns.ts): mejor gastar un cupo que arriesgar un
    // doble mensaje si el envío sí llegó y falló la respuesta.
    const detail = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: "send_failed", detail }, 409);
  }

  const label = cloud ? cloud.name : templateId;
  // El marcador [TPL:…] va al INICIO del content y se limpia server-side: sin él,
  // un mensaje con el texto renderizado de Twilio parece escrito a mano y la app
  // perdía la etiqueta "enviado como recordatorio aprobado" al recargar.
  const msgId = await new MessagesRepo(db).append(
    conv.id,
    "owner",
    templateMarker(templateId) + (renderedText ?? `[plantilla ${label} enviada]`),
  );
  await convs.touchLastMessage(conv.id);
  await convs.setPausedUntil(conv.id, now + (await resolveTakeoverMs(c.env)));
  await convs.setTakenBy(conv.id, readActor(c));
  await new ConversationReadsRepo(db).markRead(conv.id, now);
  return c.json({ ok: true, id: msgId, rendered_text: renderedText }, 200);
});

// ── 6. Chat de prueba (Contrato v3 §C) ───────────────────────────────────────
//
// "Solo tú lo ves. No cuenta como conversación." El mensaje entra por el
// pipeline REAL del agente (misma config, tools, KB, modelo) usando el canal
// dedicado `test`, así que el dueño ve EXACTAMENTE lo que vería un cliente. La
// respuesta no se empuja a ningún proveedor (el adapter de `test` es el web,
// sendReply no-op): vive en `messages` y la app la recoge por polling.
//
// Nada de esto ensucia el negocio — todas las consultas de bandeja, métricas,
// leads, insights, follow-ups y /show excluyen el canal (src/db/testFilter.ts).

const TEST_SESSION_RE = /^[A-Za-z0-9-]{8,64}$/;
const TEST_TEXT_MAX = 2000;
/** Tope de turnos por sesión — mismo espíritu que el demo (anti-fuga de costo). */
const TEST_MAX_TURNS = 60;
const TEST_POLL_LIMIT = 20;

function testConvId(session: string): string {
  return `${TEST_CHANNEL}:${session}`;
}

/** Session válida del body/query, o null. */
function readSession(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return TEST_SESSION_RE.test(s) ? s : null;
}

// POST /api/test-chat/send {session, text} → el bot contesta por el poll.
inboxApi.post("/test-chat/send", async (c) => {
  let body: { session?: unknown; text?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const session = readSession(body.session);
  if (!session) return c.json({ ok: false, error: "invalid_session" }, 400);
  const text = String(body.text ?? "").trim().slice(0, TEST_TEXT_MAX);
  if (!text) return c.json({ ok: false, error: "invalid_text" }, 400);

  const db = new Db(c.env.DB);
  const used = await db.first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'user'",
    [testConvId(session)],
  );
  if ((used?.n ?? 0) >= TEST_MAX_TURNS) {
    return c.json(
      { ok: false, error: "test_limit", detail: "Esta sesión de prueba llegó a su tope. Empieza de nuevo." },
      429,
    );
  }

  await agentStub(c.env, TEST_CHANNEL, session).ingest({
    channel: TEST_CHANNEL,
    channelUserId: session,
    text,
  });
  return c.json({ ok: true }, 200);
});

// GET /api/test-chat/poll?session=…&after=<epochMs> → lo que contestó el bot.
inboxApi.get("/test-chat/poll", async (c) => {
  const session = readSession(c.req.query("session"));
  if (!session) return c.json({ ok: false, error: "invalid_session" }, 400);
  const after = Number(c.req.query("after") ?? 0) || 0;

  const rows = await new Db(c.env.DB).all<{ id: string; content: string; created_at: number }>(
    `SELECT id, content, created_at FROM messages
      WHERE conversation_id = ? AND created_at > ? AND role = 'assistant'
      ORDER BY created_at ASC LIMIT ?`,
    [testConvId(session), after, TEST_POLL_LIMIT],
  );

  return c.json(
    {
      ok: true,
      messages: rows.map((r) => ({
        id: r.id,
        role: "assistant" as const,
        text: r.content,
        created_at: r.created_at,
      })),
    },
    200,
  );
});

// POST /api/test-chat/reset {session} — "Empezar de nuevo": borra el hilo de
// prueba. Los leads/tickets que el LLM haya creado durante la prueba llevan el
// mismo conversation_id, así que se van con él (y de todas formas ya estaban
// filtrados de la bandeja).
inboxApi.post("/test-chat/reset", async (c) => {
  let body: { session?: unknown } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  const session = readSession(body.session);
  if (!session) return c.json({ ok: false, error: "invalid_session" }, 400);

  const db = new Db(c.env.DB);
  const convId = testConvId(session);
  await db.run("DELETE FROM messages WHERE conversation_id = ?", [convId]);
  await db.run("DELETE FROM leads WHERE conversation_id = ?", [convId]);
  await db.run("DELETE FROM tickets WHERE conversation_id = ?", [convId]);
  await db.run("DELETE FROM conversations WHERE id = ?", [convId]);
  return c.json({ ok: true }, 200);
});
