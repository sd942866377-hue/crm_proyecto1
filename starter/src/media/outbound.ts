/**
 * Ruta PÚBLICA y FIRMADA de los archivos que el dueño manda desde la app.
 *
 * Los proveedores (Meta, Telegram, Twilio, Kapso, YCloud, Zernio) descargan el
 * archivo por link, sin auth — así que el archivo tiene que ser alcanzable sin
 * Bearer. Pero un id adivinable serviría documentos privados de OTROS clientes
 * (a diferencia de la Galería, que son assets del negocio), así que la URL va
 * con HMAC + expiración corta: mismo patrón que el proxy de media entrante de
 * WhatsApp (channels/whatsapp.ts). El proveedor descarga al recibir el POST, así
 * que 15 minutos sobran.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { getMediaRow } from "./boveda";

const OUT_TTL_MS = 15 * 60 * 1000;

/**
 * Secret de firma. Se prefiere el App Secret de Meta (el mismo que ya firma el
 * media entrante); si el bot no tiene Meta conectado, el token del control
 * plane sirve de material de llave — nunca sale del server y el HMAC no lo
 * revela. Sin ninguno de los dos NO se firma nada (fail-closed).
 */
function outSecret(env: Env): string {
  return env.WHATSAPP_APP_SECRET || env.META_APP_SECRET || env.CONTROL_PLANE_TOKEN || "";
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

// Dominio separado del resto de firmas del bot: una firma de media saliente no
// debe poder reusarse como firma de otra cosa.
const SIG_DOMAIN = "media-out";

/** URL pública firmada para que el proveedor descargue. null si falta secret/base. */
export async function signedOutboundUrl(
  env: Env,
  mediaId: string,
  origin: string,
): Promise<string | null> {
  const secret = outSecret(env);
  const base = (origin || env.DASHBOARD_BASE_URL || "").replace(/\/$/, "");
  if (!secret || !base) return null;
  const exp = Date.now() + OUT_TTL_MS;
  const sig = await hmacHex(secret, `${SIG_DOMAIN}.${mediaId}.${exp}`);
  return `${base}/media-out/${encodeURIComponent(mediaId)}?exp=${exp}&sig=${sig}`;
}

/** GET /media-out/:id?exp&sig → bytes desde R2, tras validar firma y expiración. */
export async function serveOutboundMedia(
  env: Env,
  mediaId: string,
  exp: string | null,
  sig: string | null,
): Promise<Response> {
  const secret = outSecret(env);
  if (!secret || !env.MEDIA) return new Response("not configured", { status: 404 });
  const expNum = Number(exp);
  if (!exp || !sig || !Number.isFinite(expNum)) return new Response("bad request", { status: 400 });
  if (Date.now() > expNum) return new Response("expired", { status: 410 });
  const expected = await hmacHex(secret, `${SIG_DOMAIN}.${mediaId}.${exp}`);
  if (!timingSafeEqual(expected, sig)) return new Response("bad signature", { status: 403 });

  const row = await getMediaRow(new Db(env.DB), mediaId);
  // Solo archivos SALIENTES: los del cliente se sirven tras auth (/api/media/:id
  // y /admin/media/:id), nunca por una URL pública.
  if (!row || row.direction !== "out") return new Response("not found", { status: 404 });
  const obj = await env.MEDIA.get(row.r2_key);
  if (!obj) return new Response("gone", { status: 410 });
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": row.mime || "application/octet-stream",
      ...(row.filename
        ? { "Content-Disposition": `inline; filename="${row.filename.replace(/"/g, "")}"` }
        : {}),
      "Cache-Control": "private, max-age=900",
    },
  });
}
