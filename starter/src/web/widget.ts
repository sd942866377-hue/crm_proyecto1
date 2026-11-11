/**
 * CANAL WEB — el bot atendiendo en el sitio del negocio.
 *
 * Un canal más, al mismo nivel que Telegram o WhatsApp: entra por `webAdapter`
 * al mismo pipeline (buffer, tools, KB, handoff) y aparece en Conexiones como
 * los demás. La diferencia es de dónde viene el mensaje: no hay proveedor que
 * empuje un webhook, el navegador del visitante ES el canal.
 *
 * Se activa poniendo `WEB_SITES` en wrangler.toml con los dominios del negocio.
 * Sin esa var el canal no existe — mismo criterio que el resto: nada abierto
 * por defecto.
 *
 * Piezas:
 *   GET  /widget.js     el script que el dueño pega en su sitio
 *   POST /web/send      el visitante manda un mensaje
 *   GET  /web/poll      el navegador recoge la respuesta
 *
 * Defensas (importa: esto queda expuesto a internet 24/7 con la llave de IA del
 * miembro detrás):
 *   · solo responde a los dominios de WEB_SITES (Origin/Referer)
 *   · tope de turnos por sesión y por IP al día
 *   · el visitante nunca elige su identidad: el id de sesión se firma aquí
 */
import type { Env } from "../env";
import { Db } from "../db/client";

/**
 * TOPES. Tres capas, porque cada una tapa lo que la anterior deja pasar:
 *
 *   1. por conversación — el que se aburre y sigue escribiendo
 *   2. por visitante y día — el que borra su almacenamiento y vuelve
 *   3. por bot y día — el que llega con muchas IPs (o el día que un video se
 *      hace viral). Es el único que protege la CUENTA de IA del miembro: sin
 *      él, 100 IPs × 60 = 6,000 llamadas al modelo en un día, pagadas por él.
 *
 * Son valores por defecto: el miembro los sube desde `/admin/config` si su
 * sitio tiene tráfico de verdad.
 */
export const MAX_TURNS_SESION = 30;
export const MAX_TURNS_IP_DIA = 60;
export const MAX_TURNS_DIA = 500;

export interface Limites {
  sesion: number;
  ipDia: number;
  dia: number;
}

/** Lee los topes del panel; cualquier cosa rara cae al valor por defecto. */
export async function limites(env: Env): Promise<Limites> {
  const { SettingsRepo } = await import("../db/settings");
  const s = new SettingsRepo(new Db(env.DB));
  const [sesion, ipDia, dia] = await Promise.all([
    s.get("web_limite_sesion"),
    s.get("web_limite_ip_dia"),
    s.get("web_limite_dia"),
  ]);
  // Solo dígitos. `parseInt` es demasiado indulgente para esto: "1e5" le sale
  // 1, así que quien quisiera SUBIR el tope acabaría con un chat que muere al
  // primer mensaje. Si no es un número limpio, mejor el valor por defecto.
  const num = (v: string | null | undefined, porDefecto: number) => {
    const crudo = String(v ?? "").trim();
    if (!/^\d+$/.test(crudo)) return porDefecto;
    const n = Number.parseInt(crudo, 10);
    return n > 0 ? n : porDefecto;
  };
  return {
    sesion: num(sesion, MAX_TURNS_SESION),
    ipDia: num(ipDia, MAX_TURNS_IP_DIA),
    dia: num(dia, MAX_TURNS_DIA),
  };
}

export function webChannelEnabled(env: Env): boolean {
  return Boolean(env.WEB_SITES && env.WEB_SITES.trim() !== "");
}

/** Dominios autorizados, normalizados a host sin protocolo ni barra final. */
export function sitiosPermitidos(env: Env): string[] {
  return (env.WEB_SITES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean);
}

/**
 * ¿La petición viene de un sitio autorizado? Acepta subdominios (`www.` y
 * demás) y, en desarrollo, localhost si está en la lista.
 */
export function origenPermitido(env: Env, request: Request): boolean {
  const permitidos = sitiosPermitidos(env);
  if (permitidos.length === 0) return false;
  if (permitidos.includes("*")) return true; // escotilla explícita, no default

  const crudo = request.headers.get("Origin") ?? request.headers.get("Referer") ?? "";
  if (!crudo) return false;
  let host: string;
  try {
    host = new URL(crudo).hostname.toLowerCase();
  } catch {
    return false;
  }
  return permitidos.some((p) => host === p || host.endsWith(`.${p}`));
}

/** Turnos que lleva esta sesión (un turno = un mensaje del visitante). */
export async function turnosDeSesion(env: Env, sessionId: string): Promise<number> {
  const db = new Db(env.DB);
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.channel = 'web' AND c.channel_user_id = ? AND m.role = 'user'`,
    [sessionId],
  );
  return row?.n ?? 0;
}

/** Turnos de esta IP en las últimas 24 h, mirando todas sus sesiones. */
export async function turnosDeIp(env: Env, ip: string): Promise<number> {
  if (!ip) return 0;
  const db = new Db(env.DB);
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.channel = 'web'
        AND c.channel_user_id LIKE ?
        AND m.role = 'user'
        AND m.created_at > ?`,
    [`${hashIp(ip)}-%`, Date.now() - 24 * 3600_000],
  );
  return row?.n ?? 0;
}

/**
 * Turnos de TODO el canal en las últimas 24 h. Es el tope que protege la cuenta
 * de IA del miembro: los otros dos son por visitante, y quien trae muchas IPs
 * los esquiva sumando.
 */
export async function turnosDelDia(env: Env): Promise<number> {
  const db = new Db(env.DB);
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.channel = 'web' AND m.role = 'user' AND m.created_at > ?`,
    [Date.now() - 24 * 3600_000],
  );
  return row?.n ?? 0;
}

/**
 * La misma IPv6 no existe: a un cliente doméstico le dan un /64 entero y puede
 * estrenar dirección en cada petición sin pagar nada. Si contáramos la
 * dirección completa, el tope por visitante sería decorativo — así que en IPv6
 * se cuenta el /64 (el hogar), no la dirección.
 */
export function claveDeIp(ip: string): string {
  if (!ip.includes(":")) return ip; // IPv4 tal cual
  const [cabeza, cola = ""] = ip.split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = cola ? cola.split(":") : [];
  const grupos = [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  return grupos
    .slice(0, 4)
    .map((g) => (g || "0").toLowerCase().padStart(4, "0"))
    .join(":");
}

/**
 * Prefijo de sesión derivado de la IP. No es criptografía: sirve para agrupar
 * las sesiones de un mismo visitante y poder aplicarle un tope diario aunque
 * borre su almacenamiento local y pida una sesión nueva.
 */
export function hashIp(ip: string): string {
  const clave = claveDeIp(ip);
  let h = 2166136261;
  for (let i = 0; i < clave.length; i++) {
    h ^= clave.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Avisa al dueño cuando el canal topa. Un tope alcanzado en silencio es lo peor
 * de los dos mundos: o le están haciendo spam y no se entera, o su chat lleva
 * horas rechazando clientes reales y tampoco. Con throttle de 6 h para no
 * convertir el aviso en su propio spam.
 */
export async function avisaDeSaturacion(env: Env, tope: number): Promise<void> {
  const CLAVE = "web_ultimo_aviso_tope";
  const THROTTLE_MS = 6 * 3600_000;
  const { SettingsRepo } = await import("../db/settings");
  const s = new SettingsRepo(new Db(env.DB));
  const ultimo = Number.parseInt((await s.get(CLAVE)) ?? "", 10);
  const ahora = Date.now();
  if (Number.isFinite(ultimo) && ahora - ultimo < THROTTLE_MS) return;
  await s.set(CLAVE, String(ahora));

  const { notifyOwner } = await import("../tools/handoffHuman");
  await notifyOwner(env, {
    reason: "chat del sitio web saturado",
    summary:
      `⚠ El chat de tu sitio web llegó a ${tope} mensajes en 24 h y está rechazando mensajes nuevos. ` +
      `Si es tráfico real (una promoción, un video que se hizo viral), sube el tope en Config → Chat del sitio web. ` +
      `Si no esperabas ese volumen, revisa Conversaciones: puede ser spam.`,
    ticketId: "web-tope",
  });
}

/** Id de sesión: <ipHash>-<aleatorio>. Lo emite el worker, nunca el cliente. */
export function nuevaSesion(ip: string): string {
  const rnd = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${hashIp(ip)}-${rnd}`;
}

export function ipDe(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "";
}
