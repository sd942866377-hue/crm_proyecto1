import type { Env } from "../env";
import { Db } from "../db/client";

// Bóveda (superpoder Forja+): archiva las imágenes/documentos/audios que mandan
// los clientes. Las URLs que dan los proveedores (WhatsApp/Telegram/Twilio)
// EXPIRAN o van con auth, así que para que el dueño las vea después hay que
// copiarlas al R2 del miembro (binding MEDIA). El panel las sirve tras su auth
// y el inbox móvil por GET /api/media/:id.
//
// La tabla es la MISMA que usa el hilo móvil (Contrato v3 §A): además del
// archivo guarda a qué mensaje pertenece (message_id), en qué dirección viajó y
// cuánto dura el audio.

export type MediaKind = "image" | "audio" | "document";

export interface MediaRow {
  id: string;
  conversation_id: string | null;
  r2_key: string;
  kind: MediaKind;
  mime: string | null;
  filename: string | null;
  caption: string | null;
  bytes: number | null;
  created_at: number;
  /** Mensaje del hilo al que pertenece. NULL en filas viejas → se intercalan
   *  por timestamp, igual que hace el panel. */
  message_id: string | null;
  /** 'in' = del cliente al bot · 'out' = del humano/app al cliente. */
  direction: string | null;
  duration_s: number | null;
}

// Tabla auto-creada (mismo patrón que dedup/processed_messages): así funciona en
// bots ya instalados sin migración de schema.sql. Idempotente, una vez por isolate.
let ensured = false;
export async function ensureMediaTable(db: Db): Promise<void> {
  if (ensured) return;
  await db.run(
    `CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY, conversation_id TEXT, r2_key TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'image', mime TEXT, filename TEXT, caption TEXT,
      bytes INTEGER, created_at INTEGER NOT NULL)`,
  );
  await db.run("CREATE INDEX IF NOT EXISTS idx_media_conv ON media(conversation_id, created_at)");
  await db.run("CREATE INDEX IF NOT EXISTS idx_media_time ON media(created_at)");
  // Columnas del hilo móvil sobre bots YA instalados: `forjabot update` no
  // re-ejecuta schema.sql. SQLite no tiene ADD COLUMN IF NOT EXISTS — se traga
  // el "duplicate column" (mismo patrón que ensurePanelUsersTable).
  for (const col of ["message_id TEXT", "direction TEXT DEFAULT 'in'", "duration_s REAL"]) {
    await db.run(`ALTER TABLE media ADD COLUMN ${col}`).catch(() => {});
  }
  ensured = true;
}

/** Solo para tests: resetea el memo del CREATE/ALTER. */
export function __resetMediaEnsured(): void {
  ensured = false;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
};

/** Extensión sugerida para un mime (bin si es desconocido). */
export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] || "bin";
}

/** Clasificación por mime cuando el proveedor no dice el tipo. */
export function kindForMime(mime: string): MediaKind {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

// Tope de tamaño: no vaciar el R2 del miembro con un archivo gigante. 20 MB
// cubre fotos y PDFs de cotización de sobra.
export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Baja el archivo entrante desde la URL del proveedor (mientras aún sirve) y lo
 * copia al R2 del miembro, con su fila en `media`. FAIL-OPEN: cualquier falla
 * (URL muerta, R2 caído, archivo enorme) se traga — NUNCA rompe el turno del
 * bot; solo no se archiva. Devuelve el id de la fila o null.
 */
export async function captureIncomingMedia(
  env: Env,
  db: Db,
  opts: {
    conversationId: string;
    url: string;
    mime?: string;
    caption?: string;
    kind?: MediaKind;
    filename?: string;
    /** Duración del audio en segundos, cuando el canal la da (Telegram voice). */
    durationS?: number;
  },
): Promise<string | null> {
  if (!env.MEDIA) return null;
  try {
    // La CDN de Meta (lookaside.fbsbx.com / cdninstagram) le sirve una PÁGINA
    // HTML de error a los clientes sin User-Agent de navegador — el fetch pelón
    // del Worker guardaba ese HTML como si fuera la imagen y el inbox mostraba
    // "esa imagen ya no está disponible". Con UA + Accept de navegador devuelve
    // el binario real. Inofensivo para WhatsApp/Telegram/Twilio (ignoran el UA).
    const res = await fetch(opts.url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "image/avif,image/webp,image/apng,image/*,video/*,audio/*,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    // Si aun así devolvió una página (HTML/JSON de error) en vez del binario, NO
    // la archives: guardar el HTML crea una burbuja rota. Mejor no-op → el hilo
    // muestra el caption y el marcador [IMAGE_URL:], sin media fantasma.
    const resCt = (res.headers.get("content-type") ?? "").toLowerCase();
    if (/^\s*(text\/html|application\/json|text\/plain)/.test(resCt)) return null;
    const mime = opts.mime || res.headers.get("content-type") || "application/octet-stream";
    const kind: MediaKind = opts.kind || kindForMime(mime);
    const body = await res.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MEDIA_MAX_BYTES) return null;

    const id = crypto.randomUUID();
    const key = `media/${opts.conversationId}/${id}.${extForMime(mime)}`;
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: mime } });

    await ensureMediaTable(db);
    await db.run(
      `INSERT INTO media (id, conversation_id, r2_key, kind, mime, filename, caption, bytes,
                          created_at, direction, duration_s)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in', ?)`,
      [
        id,
        opts.conversationId,
        key,
        kind,
        mime,
        opts.filename ?? null,
        opts.caption ?? null,
        body.byteLength,
        Date.now(),
        opts.durationS ?? null,
      ],
    );
    return id;
  } catch (e) {
    console.warn("[boveda] no se pudo archivar el media (se ignora):", e);
    return null;
  }
}

/**
 * Liga filas de media al mensaje del hilo. Se corre DESPUÉS del append (el id
 * del mensaje no existe cuando se captura el archivo). Best-effort: si falla,
 * el hilo las sigue intercalando por timestamp.
 */
export async function attachMediaToMessage(
  db: Db,
  mediaIds: string[],
  messageId: string,
): Promise<void> {
  if (!mediaIds.length) return;
  try {
    await ensureMediaTable(db);
    await db.run(
      `UPDATE media SET message_id = ? WHERE id IN (${mediaIds.map(() => "?").join(",")})`,
      [messageId, ...mediaIds],
    );
  } catch (e) {
    console.warn("[boveda] no se pudo ligar el media al mensaje (se ignora):", e);
  }
}

/** Una fila de media por id (null si no existe o la tabla aún no fue creada). */
export async function getMediaRow(db: Db, id: string): Promise<MediaRow | null> {
  try {
    await ensureMediaTable(db);
    return await db.first<MediaRow>("SELECT * FROM media WHERE id = ?", [id]);
  } catch {
    return null;
  }
}
