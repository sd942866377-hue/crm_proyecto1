/**
 * Rutas del canal web. Se montan en index.ts junto a los webhooks del resto de
 * canales, para que quien lea el enrutador vea todos los canales en el mismo
 * sitio.
 */
import type { Context } from "hono";
import type { Env } from "../env";
import { Db } from "../db/client";
import { widgetOpciones, widgetScript } from "./script";
import {
  avisaDeSaturacion,
  ipDe,
  limites,
  nuevaSesion,
  origenPermitido,
  turnosDeIp,
  turnosDeSesion,
  turnosDelDia,
  webChannelEnabled,
} from "./widget";

/** CORS: solo para los sitios del negocio; el navegador exige el eco del Origin. */
function cors(c: Context<{ Bindings: Env }>): Record<string, string> {
  const origin = c.req.header("Origin");
  if (!origin || !origenPermitido(c.env, c.req.raw)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/** GET /widget.js — el script que el dueño pega en su sitio. */
export async function widgetJs(c: Context<{ Bindings: Env }>) {
  if (!webChannelEnabled(c.env)) {
    return c.text("/* El canal web de este bot no está activado. */", 404, {
      "content-type": "application/javascript; charset=utf-8",
    });
  }
  const origen = new URL(c.req.url).origin;
  const js = widgetScript(await widgetOpciones(c.env, origen));
  return c.body(js, 200, {
    "content-type": "application/javascript; charset=utf-8",
    // Cache corto: que un cambio de color o saludo se vea el mismo día, sin
    // obligar al visitante a descargarlo en cada carga.
    "cache-control": "public, max-age=900",
    "access-control-allow-origin": "*", // el script en sí no es secreto
  });
}

export function widgetPreflight(c: Context<{ Bindings: Env }>) {
  return c.body(null, 204, cors(c));
}

/**
 * POST /web/send — el visitante manda un mensaje.
 *
 * Devuelve el `sessionId` que debe usar de aquí en adelante: si no traía uno o
 * el que traía no es de esta IP, se le asigna uno nuevo. Así el tope diario por
 * IP no se puede esquivar borrando el almacenamiento del navegador.
 */
export async function webSend(
  c: Context<{ Bindings: Env }>,
  seguir: () => Promise<Response>,
): Promise<Response> {
  const cabeceras = cors(c);

  if (!webChannelEnabled(c.env)) {
    return c.json({ ok: false, error: "canal_apagado" }, 404, cabeceras);
  }
  if (!origenPermitido(c.env, c.req.raw)) {
    return c.json({ ok: false, error: "origen_no_permitido" }, 403, cabeceras);
  }

  const ip = ipDe(c.req.raw);
  const body = (await c.req.raw.clone().json().catch(() => ({}))) as { sessionId?: string };
  const pedida = String(body.sessionId ?? "").slice(0, 64);
  const prefijo = nuevaSesion(ip).split("-")[0];
  // La sesión solo vale si la emitimos para esta IP; si no, se emite otra.
  const sessionId = pedida.startsWith(`${prefijo}-`) ? pedida : nuevaSesion(ip);

  // Los tres topes, del más específico al más general. Todos se revisan ANTES
  // de tocar el modelo: rechazar tiene que costar menos que responder, o el
  // freno se vuelve el ataque.
  const tope = await limites(c.env);
  if ((await turnosDeSesion(c.env, sessionId)) >= tope.sesion) {
    return c.json({ ok: false, error: "limite_sesion", sessionId }, 429, cabeceras);
  }
  if ((await turnosDeIp(c.env, ip)) >= tope.ipDia) {
    return c.json({ ok: false, error: "limite_ip", sessionId }, 429, cabeceras);
  }
  if ((await turnosDelDia(c.env)) >= tope.dia) {
    // El aviso al dueño no debe retrasar la respuesta al visitante.
    c.executionCtx.waitUntil(
      avisaDeSaturacion(c.env, tope.dia).catch((e) =>
        console.error("[web] aviso de saturación falló:", e),
      ),
    );
    return c.json({ ok: false, error: "limite_global", sessionId }, 429, cabeceras);
  }

  // El adapter lee el cuerpo otra vez, así que se reescribe con la sesión ya
  // decidida: el visitante nunca elige con qué identidad entra al pipeline.
  const original = (await c.req.raw.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const req = new Request(c.req.raw.url, {
    method: "POST",
    headers: c.req.raw.headers,
    body: JSON.stringify({ ...original, sessionId }),
  });
  (c.req as unknown as { raw: Request }).raw = req;

  const res = await seguir();
  // La respuesta del pipeline es un ack; le añadimos la sesión y el CORS.
  const cuerpo = await res.json().catch(() => ({ ok: res.ok }));
  return c.json({ ...(cuerpo as object), sessionId }, res.status as 200, cabeceras);
}

/** GET /web/poll?session=…&after=… — respuestas del bot para esa sesión. */
export async function webPoll(c: Context<{ Bindings: Env }>) {
  const cabeceras = cors(c);
  if (!webChannelEnabled(c.env)) {
    return c.json({ ok: false, error: "canal_apagado" }, 404, cabeceras);
  }
  if (!origenPermitido(c.env, c.req.raw)) {
    return c.json({ ok: false, error: "origen_no_permitido" }, 403, cabeceras);
  }

  const sessionId = (c.req.query("session") ?? "").slice(0, 64);
  const after = Number(c.req.query("after") ?? 0) || 0;
  if (!sessionId) return c.json({ ok: false, error: "falta_sesion" }, 400, cabeceras);

  const db = new Db(c.env.DB);
  const conv = await db.first<{ id: string }>(
    "SELECT id FROM conversations WHERE channel = 'web' AND channel_user_id = ? LIMIT 1",
    [sessionId],
  );
  if (!conv) return c.json({ ok: true, messages: [] }, 200, cabeceras);

  const filas = await db.all<{ content: string; created_at: number }>(
    `SELECT content, created_at FROM messages
      WHERE conversation_id = ? AND created_at > ? AND role = 'assistant'
      ORDER BY created_at ASC LIMIT 20`,
    [conv.id, after],
  );
  return c.json({ ok: true, messages: filas }, 200, cabeceras);
}
