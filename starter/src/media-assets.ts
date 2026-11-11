import { Db } from "./db/client";
import { SettingsRepo } from "./db/settings";

/**
 * Galería (superpoder Pro): fotos y audios del negocio que el bot puede MANDAR
 * en sus respuestas con el marcador [[media: <id>]] (mismo patrón que los
 * botones). Sin migración de esquema: cada asset son DOS keys en `settings` —
 *
 *   media_meta:<id> → JSON chico {k,n,d,mime,size,at} — viaja en SettingsRepo.all(),
 *                     de ahí sale la lista para el prompt y el panel.
 *   media_blob:<id> → data-URI completo — EXCLUIDO de all(); solo lo lee la
 *                     ruta pública GET /media/:id, un asset a la vez.
 *
 * El id lleva el tipo en el prefijo (img_/aud_/vid_): el sender deduce el tipo
 * sin tocar D1. Los ids son aleatorios → la URL pública no es adivinable y se
 * puede cachear como inmutable.
 */

export type MediaKind = "image" | "audio" | "video";

export interface MediaAssetMeta {
  id: string;
  kind: MediaKind;
  /** Nombre corto que ve el dueño ("menú", "fachada", "audio-precios"). */
  nombre: string;
  /** Cuándo usarlo — el modelo decide con esto. */
  desc: string;
  mime: string;
  /** Bytes del binario (no del base64). 0 en assets por URL. */
  size: number;
  createdAt: number;
  /**
   * MODO URL: el archivo vive FUERA del bot (R2 público, Supabase Storage,
   * Google Drive con link directo, el sitio del negocio…) y esta es su URL
   * pública directa. Sin blob en D1 → sin límite de 1.2MB ni de cantidad —
   * el modo recomendado para catálogos grandes (inmobiliarias, tiendas).
   * Vacío/ausente = modo self-hosted (media_blob:<id> + GET /media/:id).
   */
  url?: string;
}

export const MEDIA_META_PREFIX = "media_meta:";
export const MEDIA_BLOB_PREFIX = "media_blob:";

/** Límite del binario. El data-URI (~4/3×) debe caber holgado en el row de D1 (2MB). */
export const MEDIA_MAX_BYTES = 1_200_000;

const MIME_KIND: Record<string, MediaKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "audio/ogg": "audio",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/aac": "audio",
  // Video: mp4 (H.264+AAC) es el único formato que TODOS los canales aceptan
  // (WhatsApp 16MB, Twilio 20MB, Instagram 25MB, Telegram 50MB). Self-hosted
  // solo cabe un clip muy corto (límite 1.2MB) — para video, URL externa.
  "video/mp4": "video",
  "video/3gpp": "video",
};

export function kindForMime(mime: string): MediaKind | null {
  return MIME_KIND[mime.toLowerCase().split(";")[0].trim()] ?? null;
}

export function kindFromId(id: string): MediaKind | null {
  if (id.startsWith("img_")) return "image";
  if (id.startsWith("aud_")) return "audio";
  if (id.startsWith("vid_")) return "video";
  return null;
}

const ID_RE = /^(img|aud|vid)_[a-z0-9]{8,12}$/;
export const isMediaId = (id: string): boolean => ID_RE.test(id);

function newId(kind: MediaKind): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = "";
  for (const b of bytes) s += abc[b % abc.length];
  return `${kind === "image" ? "img" : kind === "video" ? "vid" : "aud"}_${s}`;
}

/** Parsea las metas presentes en un record de settings (el de all()). */
export function listMediaAssets(settings: Record<string, string>): MediaAssetMeta[] {
  const out: MediaAssetMeta[] = [];
  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(MEDIA_META_PREFIX) || !value) continue;
    const id = key.slice(MEDIA_META_PREFIX.length);
    const kind = kindFromId(id);
    if (!kind) continue;
    try {
      const m = JSON.parse(value);
      const url = typeof m.url === "string" && /^https:\/\//i.test(m.url) ? m.url : undefined;
      out.push({
        id,
        kind,
        nombre: String(m.n ?? id),
        desc: String(m.d ?? ""),
        mime: String(m.mime ?? ""),
        size: Number(m.size ?? 0),
        createdAt: Number(m.at ?? 0),
        ...(url ? { url } : {}),
      });
    } catch { /* meta corrupta: se ignora, no tumba el prompt */ }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** Alta de un asset: valida, genera id y escribe meta + blob. */
export async function putMediaAsset(
  db: Db,
  input: { nombre: string; desc: string; mime: string; dataBase64: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const kind = kindForMime(input.mime);
  if (!kind) return { ok: false, error: `mime no soportado: ${input.mime}` };
  const size = Math.floor((input.dataBase64.length * 3) / 4);
  if (size > MEDIA_MAX_BYTES) return { ok: false, error: `excede ${MEDIA_MAX_BYTES} bytes (${size})` };
  if (!input.nombre.trim()) return { ok: false, error: "falta nombre" };
  const id = newId(kind);
  const repo = new SettingsRepo(db);
  await repo.set(
    MEDIA_BLOB_PREFIX + id,
    `data:${input.mime};base64,${input.dataBase64}`,
  );
  // El meta se escribe AL FINAL: si el blob falla, no queda un asset fantasma
  // listado en el prompt apuntando a un 404.
  await repo.set(
    MEDIA_META_PREFIX + id,
    JSON.stringify({ n: input.nombre.trim(), d: input.desc.trim(), mime: input.mime, size, at: Date.now() }),
  );
  return { ok: true, id };
}

/**
 * Alta de un asset por URL EXTERNA (modo recomendado para catálogos grandes):
 * solo se guarda el meta con la URL pública directa — sin blob, sin límite de
 * tamaño en D1. La URL debe ser https y servir el archivo directo (no una
 * página HTML) — el skill /galeria valida eso ANTES de dar de alta.
 */
export async function putMediaAssetUrl(
  db: Db,
  input: { nombre: string; desc: string; kind: MediaKind; url: string; mime?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!/^https:\/\/\S+$/i.test(input.url)) return { ok: false, error: "la URL debe ser https directa" };
  if (!input.nombre.trim()) return { ok: false, error: "falta nombre" };
  const id = newId(input.kind);
  await new SettingsRepo(db).set(
    MEDIA_META_PREFIX + id,
    JSON.stringify({
      n: input.nombre.trim(),
      d: input.desc.trim(),
      mime: input.mime ?? "",
      size: 0,
      at: Date.now(),
      url: input.url.trim(),
    }),
  );
  return { ok: true, id };
}

/** Baja: borra meta y blob (rows de verdad, no value vacío — son grandes). */
export async function deleteMediaAsset(db: Db, id: string): Promise<void> {
  if (!isMediaId(id)) return;
  await db.run("DELETE FROM settings WHERE key IN (?, ?)", [
    MEDIA_META_PREFIX + id,
    MEDIA_BLOB_PREFIX + id,
  ]);
}

/** Blob decodificado para servirlo (GET /media/:id). null = no existe. */
export async function getMediaBlob(
  db: Db,
  id: string,
): Promise<{ mime: string; bytes: Uint8Array } | null> {
  if (!isMediaId(id)) return null;
  const raw = await new SettingsRepo(db).get(MEDIA_BLOB_PREFIX + id);
  if (!raw) return null;
  const m = raw.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes };
  } catch {
    return null;
  }
}
