import { Hono } from "hono";
import { applyLanguage } from "./idioma";
import type { Env } from "./env";
import type { ChannelAdapter, IncomingMessage } from "./channels/shared";
import { IgnoredUpdate } from "./channels/shared";
import { agentStub } from "./agent-stub";
import { telegramAdapter } from "./channels/telegram";
import { webAdapter } from "./channels/web";
import { demoPage, demoPoll, demoEnabled, demoTurnsUsed, demoOverLimit } from "./demo";
import { manychatAdapter } from "./channels/manychat";
import { twilioAdapter } from "./channels/twilio";
import { parseMetaEvents, verifyMetaSignature, metaProfileName } from "./channels/meta";
import { parseWhatsAppEvents, serveWhatsAppMedia } from "./channels/whatsapp";
import { serveOutboundMedia } from "./media/outbound";
import { parseKapsoEvents, verifyKapsoSignature, kapsoOwnerTakeover, normalizeKapsoEvents } from "./channels/kapso";
import { parseZernioEvents, verifyZernioSignature, normalizeZernioEvents, rememberZernioCtx } from "./channels/zernio";
import { parseYCloudEvents, verifyYCloudSignature, ycloudOwnerTakeover, normalizeYCloudEvents, serveYCloudMedia } from "./channels/ycloud";
import {
  parseMetaComments,
  parseMetaPostbacks,
  handleComment,
  handlePostback,
} from "./channels/comment-funnel";
import { adminApp } from "./admin/routes";
import { funnelsApp } from "./funnels/routes";
import { applyTier } from "./tier";
import { applyBranding } from "./admin/branding";
import { isOwner, handleOwnerMessage } from "./owner/handler";
import { purgeOldMessages, purgeOldMedia, purgeOldTestChats } from "./crons/purgeOldMessages";
import { reindexFixtures } from "./kb/reindex";
import { widgetJs, widgetPreflight, webPoll, webSend } from "./web/rutas";
import { analyzeConversations } from "./insights/analyzer";
import { Db } from "./db/client";
import { NOT_TEST_REF } from "./db/testFilter";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { detectKind } from "./learn/fieldPath";
import { saveCapture, isLearnMode } from "./learn/mapping";
import { renderShow } from "./show";
import { salesVariantFor } from "./tools/masterclass";
import { costOfUsage } from "./pricing";
import { tokensMatch } from "./http-auth";
import { apiApp } from "./api";
import { persistSelfOrigin } from "./lib/self-origin";

export { SupportAgent } from "./agent";

const app = new Hono<{ Bindings: Env }>();

// Throttle por isolate de la auto-cura del origin. NO es estado de request:
// el origin es el hostname del propio worker (estable para todo el deploy), y
// persistSelfOrigin revalida contra D1 antes de escribir — este cache solo
// evita leer settings en cada request. Si el isolate se recicla, a lo mucho se
// repite una lectura/escritura.
let lastKnownOrigin: string | undefined;

// Tier efectivo ANTES de cualquier ruta (webhooks incluidos): si el control
// plane empujó un override (Forja+ activado en caliente), env.BOT_TIER queda
// corregido y todos los isPro(env) del código ven la verdad. Fail-open al
// var estático si D1 no responde.
app.use("*", async (c, next) => {
  await applyTier(c.env);
  await applyLanguage(c.env);
  await next();
});

// Auto-cura del origin (BUG 6): si el miembro NO fijó DASHBOARD_BASE_URL,
// aprende el origin real de las requests entrantes y lo persiste en settings
// para que el código de cron (sin request) tenga una base URL. Throttled por
// isolate + revalidado en D1; nunca bloquea la respuesta (ctx.waitUntil).
app.use("*", async (c, next) => {
  if (!c.env.DASHBOARD_BASE_URL?.trim()) {
    try {
      const origin = new URL(c.req.url).origin;
      if (origin && origin !== lastKnownOrigin) {
        c.executionCtx.waitUntil(persistSelfOrigin(c.env, origin));
        lastKnownOrigin = origin; // solo tras agendar (executionCtx puede faltar en tests)
      }
    } catch {
      // sin executionCtx (tests) u origin inválido — se ignora
    }
  }
  await next();
});

app.get("/health", (c) => c.text("ok", 200));

// ── Modo evento/masterclass ─────────────────────────────────────────────────

// Redirect de los links de trackeo del bot (tool trackedLink): loguea el click
// y manda al destino con UTMs de atribución (la plataforma guarda utm_* al
// registrarse → sabemos quién llegó desde WhatsApp y desde qué conversación).
app.get("/l/:code", async (c) => {
  const code = c.req.param("code");
  const db = new Db(c.env.DB);
  const link = await db.first<{ target: string; target_url: string; conversation_id: string }>(
    "SELECT target, target_url, conversation_id FROM tracked_links WHERE code = ?",
    [code],
  );
  if (!link) {
    const fallback = c.env.EVENT_REGISTER_URL;
    return fallback ? c.redirect(fallback, 302) : c.text("not found", 404);
  }
  await db.run(
    "UPDATE tracked_links SET clicks = clicks + 1, last_click_at = ? WHERE code = ?",
    [Date.now(), code],
  );
  const url = new URL(link.target_url);
  url.searchParams.set("utm_source", "whatsapp_bot");
  url.searchParams.set("utm_medium", "bot");
  url.searchParams.set("utm_campaign", "masterclass");
  // utm_content = el "vendedor" A/B que atendió esta conversación
  url.searchParams.set("utm_content", salesVariantFor(link.conversation_id));
  url.searchParams.set("btl", code); // bot tracked link — ata el click a la conversación
  return c.redirect(url.toString(), 302);
});

// Live wall para proyectar durante la presentación (contador + feed en vivo).
// Protegido con SHOW_TOKEN: /show?t=<token>.
app.get("/show", async (c) => {
  const token = c.env.SHOW_TOKEN?.trim();
  if (!token || !tokensMatch(c.req.query("t") ?? "", token)) {
    return c.text("not found", 404);
  }
  return c.html(await renderShow(c.env));
});

// Embudo del modo evento en JSON (lo consume el panel de la plataforma):
// keywords recibidas, links generados y clicks. Mismo token que /show.
app.get("/funnel-stats", async (c) => {
  const token = c.env.SHOW_TOKEN?.trim();
  if (!token || !tokensMatch(c.req.query("t") ?? "", token)) {
    return c.text("not found", 404);
  }
  const db = new Db(c.env.DB);
  const keywords = await db.all<{ keyword: string; hits: number; personas: number }>(
    `SELECT keyword, COUNT(*) AS hits, COUNT(DISTINCT conversation_id) AS personas
     FROM keyword_hits GROUP BY keyword`,
  );
  const links = await db.all<{ target: string; links: number; clicks: number; personas_click: number }>(
    `SELECT target, COUNT(*) AS links, SUM(clicks) AS clicks,
            SUM(CASE WHEN clicks > 0 THEN 1 ELSE 0 END) AS personas_click
     FROM tracked_links GROUP BY target`,
  );
  const convRows = await db.all<{ id: string }>(
    `SELECT DISTINCT conversation_id AS id FROM messages WHERE role = 'user' AND ${NOT_TEST_REF}`,
  );

  // Breakdown por "vendedor" A/B — el hash es determinístico, se calcula al
  // vuelo sin guardar nada.
  const variantes: Record<
    string,
    { conversaciones: number; quiero: number; clicks_oferta: number; calientes: number }
  > = {
    consultivo: { conversaciones: 0, quiero: 0, clicks_oferta: 0, calientes: 0 },
    directo: { conversaciones: 0, quiero: 0, clicks_oferta: 0, calientes: 0 },
  };
  for (const r of convRows) variantes[salesVariantFor(r.id)].conversaciones++;
  const quieroRows = await db.all<{ id: string }>(
    "SELECT DISTINCT conversation_id AS id FROM keyword_hits WHERE keyword = 'QUIERO'",
  );
  for (const r of quieroRows) variantes[salesVariantFor(r.id)].quiero++;
  const clickRows = await db.all<{ id: string }>(
    "SELECT DISTINCT conversation_id AS id FROM tracked_links WHERE target = 'oferta' AND clicks > 0",
  );
  for (const r of clickRows) variantes[salesVariantFor(r.id)].clicks_oferta++;

  // Etiquetas de la minería (interés + objeciones) y lista de leads calientes
  const interesRows = await db.all<{ interest: string; n: number }>(
    "SELECT interest, COUNT(*) AS n FROM conv_labels GROUP BY interest",
  );
  const objecionRows = await db.all<{ objection: string; n: number }>(
    "SELECT objection, COUNT(*) AS n FROM conv_labels GROUP BY objection",
  );
  const calienteRows = await db.all<{ id: string }>(
    "SELECT conversation_id AS id FROM conv_labels WHERE interest = 'caliente'",
  );
  for (const r of calienteRows) variantes[salesVariantFor(r.id)].calientes++;
  const hotLeads = await db.all<{
    name: string | null;
    channel: string;
    summary: string | null;
    labeled_at: number;
  }>(
    `SELECT co.display_name AS name, co.channel AS channel, l.summary AS summary, l.labeled_at
     FROM conv_labels l JOIN conversations co ON co.id = l.conversation_id
     WHERE l.interest = 'caliente' ORDER BY l.labeled_at DESC LIMIT 12`,
  );

  // Costo IA acumulado de todas las respuestas del bot
  const usageRows = await db.all<{ model: string | null; inp: number; out: number; cached: number }>(
    `SELECT model_used AS model, SUM(COALESCE(input_tokens,0)) AS inp,
            SUM(COALESCE(output_tokens,0)) AS out, SUM(COALESCE(cached_input_tokens,0)) AS cached
     FROM messages WHERE role = 'assistant' GROUP BY model_used`,
  );
  let costoUsd = 0;
  for (const r of usageRows) {
    if (!r.model) continue;
    costoUsd += costOfUsage(r.model, { input: r.inp, cached: r.cached, output: r.out });
  }

  return c.json({
    conversaciones: convRows.length,
    keywords,
    links,
    variantes,
    labels: {
      interes: Object.fromEntries(interesRows.map((r) => [r.interest, r.n])),
      objeciones: Object.fromEntries(objecionRows.map((r) => [r.objection, r.n])),
    },
    hot_leads: hotLeads,
    costo_usd: Math.round(costoUsd * 10000) / 10000,
  });
});

// Parse the provider payload via the channel adapter, derive the per-user DO id
// (channel + ':' + channelUserId), and forward the normalized message to the
// SupportAgent's `/ingest` endpoint. The DO buffers + schedules the alarm.
// Entrega un mensaje ya parseado al DO, con dedup por id de proveedor y sin
// que un fallo tumbe la respuesta al canal. Meta/WhatsApp reenvían el batch
// completo ante un no-2xx: dedup + catch evitan respuestas dobles y doble gasto.
async function ingestOne(env: Env, msg: IncomingMessage): Promise<void> {
  try {
    if (msg.providerMessageId) {
      const { seenBefore } = await import("./db/dedup");
      if (await seenBefore(new Db(env.DB), msg.providerMessageId)) return; // reenvío duplicado
    }
    await agentStub(env, msg.channel, msg.channelUserId).ingest(msg);
  } catch (e) {
    console.error(`ingest ${msg.channel}:`, e);
  }
}

async function routeToAgent(c: { req: { raw: Request }; env: Env; text: (t: string, s: number) => Response }, adapter: ChannelAdapter) {
  try {
    const env = c.env;
    const msg = await adapter.parseIncoming(c.req.raw, env);
    const stub = agentStub(env, msg.channel, msg.channelUserId);
    // Call the agent directly via RPC. Do NOT use stub.fetch(): the `agents` SDK
    // intercepts the Durable Object fetch and expects partyserver namespace/room
    // headers, so an ad-hoc fetch to /ingest fails to connect. RPC invokes the
    // method directly — it buffers the message and schedules the alarm.
    await stub.ingest(msg);
    // Twilio treats the webhook's HTTP body as a reply to send. The real reply
    // is delivered asynchronously via the REST API, so ack with empty TwiML
    // (`<Response></Response>`) to tell Twilio to send nothing. Other channels
    // ignore the body, so a plain "ok" is fine for them.
    if (msg.channel === "twilio") {
      return new Response("<Response></Response>", {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }
    return c.text("ok", 200);
  } catch (e: any) {
    // Update no procesable (edited_message, callback_query…) → 200 para que el
    // canal NO lo reintente en loop. Solo los errores REALES devuelven 500.
    if (e instanceof IgnoredUpdate) return c.text("ignored", 200);
    console.error("webhook error:", e);
    return c.text(`err: ${e?.message ?? e}`, 500);
  }
}


// ── MODO DEMO · chat web público para enseñarle el bot a un prospecto ────────
// Solo vive si DEMO_MODE="on" (instancia desechable). Ver src/demo.ts.
app.get("/demo", (c) => demoPage(c));
app.get("/demo/poll", (c) => demoPoll(c));
app.post("/demo/send", async (c) => {
  if (!demoEnabled(c.env)) return c.json({ ok: false, error: "demo_off" }, 404);
  const body = (await c.req.raw.clone().json().catch(() => ({}))) as { sessionId?: string };
  const sid = String(body.sessionId ?? "").slice(0, 64);
  if (sid && demoOverLimit(await demoTurnsUsed(c.env, sid))) {
    return c.json({ ok: false, error: "limit" }, 429);
  }
  return routeToAgent(c, webAdapter);
});

// ── CANAL WEB · el bot en el sitio del negocio ──────────────────────────────
// Un canal más (ver src/web/): el visitante escribe desde el widget y entra al
// MISMO pipeline que Telegram o WhatsApp. Se enciende con WEB_SITES.
app.get("/widget.js", (c) => widgetJs(c));
app.options("/web/send", (c) => widgetPreflight(c));
app.options("/web/poll", (c) => widgetPreflight(c));
app.post("/web/send", (c) => webSend(c, () => routeToAgent(c, webAdapter)));
app.get("/web/poll", (c) => webPoll(c));

// Telegram no firma sus webhooks (a diferencia de Kapso/YCloud): sin el
// secret_token cualquiera con la URL puede inyectar mensajes eligiendo el
// from.id — quemando la llave de IA del dueño o pausando a un cliente real.
// Se exige solo si el secret existe, para no romper bots registrados sin él.
app.post("/webhooks/telegram", (c) => {
  const esperado = c.env.TELEGRAM_WEBHOOK_SECRET;
  if (esperado && c.req.header("X-Telegram-Bot-Api-Secret-Token") !== esperado) {
    return c.text("forbidden", 403);
  }
  return routeToAgent(c, telegramAdapter);
});
app.post("/webhooks/manychat", (c) => routeToAgent(c, manychatAdapter));
// WhatsApp (Twilio): si el mensaje viene del DUEÑO (su número) → agente-dueño
// en Grok (arma embudos); si no → bot de clientes (Claude). El body se lee UNA
// vez; ack con TwiML vacío para que Twilio no reenvíe el cuerpo como mensaje.
app.post("/webhooks/twilio", async (c) => {
  let msg;
  try {
    msg = await twilioAdapter.parseIncoming(c.req.raw, c.env);
  } catch (e) {
    console.error("twilio parse error:", e);
    return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
  }
  // OWNER_AGENT="off" pausa el desvío al agente-dueño: los mensajes del número
  // del dueño entran al flujo NORMAL de clientes (útil para probar el bot desde
  // el propio teléfono). Quitar la var (o "on") lo reactiva.
  if (c.env.OWNER_AGENT !== "off" && isOwner(msg.channelUserId, c.env.OWNER_WA_NUMBER)) {
    await handleOwnerMessage(msg, c.env).catch((e) => console.error("owner agent:", e));
  } else {
    await agentStub(c.env, msg.channel, msg.channelUserId).ingest(msg).catch((e) => console.error("ingest:", e));
  }
  return new Response("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
});

// --- Meta oficial (Facebook Messenger + Instagram DMs, sin ManyChat) --------
// GET = handshake de verificación de Meta: devuelve hub.challenge si el
// hub.verify_token coincide con nuestro secreto. Se llama una vez al configurar
// el webhook en la app de Meta.
app.get("/webhooks/meta", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token && token === c.env.META_VERIFY_TOKEN) {
    return c.text(challenge ?? "", 200);
  }
  return c.text("forbidden", 403);
});

// POST = eventos de mensajes. Meta firma el cuerpo con el App Secret; validamos
// la firma (fail-closed) antes de procesar. Un POST puede traer varios mensajes
// (varias páginas/usuarios): rutea cada uno a su Durable Object. Responde 200
// rápido para que Meta no reintente.
app.post("/webhooks/meta", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-hub-signature-256");
  // Messenger (app de Facebook) e Instagram (IG Login) pueden firmar con App
  // Secrets DISTINTOS aunque sea la misma app de Meta. Aceptamos la firma si
  // cuadra con cualquiera de los dos secretos configurados (fail-closed si con
  // ninguno). Así un solo webhook /webhooks/meta sirve para ambos canales.
  const valid =
    (!!c.env.META_APP_SECRET && (await verifyMetaSignature(raw, sig, c.env.META_APP_SECRET))) ||
    (!!c.env.INSTAGRAM_APP_SECRET && (await verifyMetaSignature(raw, sig, c.env.INSTAGRAM_APP_SECRET)));
  if (!valid) return c.text("bad signature", 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }
  // Kill-switch del canal oficial de Instagram (IG_OFFICIAL="off"): se ignora
  // TODO lo de IG por esta vía — DMs, comentarios del embudo y postbacks — el
  // bot de IG vive únicamente en ManyChat (decisión de Santi 2026-07-12).
  // Messenger (object === "page") no se ve afectado. Para reactivar: quitar la
  // var y redeploy.
  if ((body as { object?: string }).object === "instagram" && c.env.IG_OFFICIAL === "off") {
    return c.text("EVENT_RECEIVED", 200);
  }

  for (const msg of parseMetaEvents(body as any)) {
    // Anti-duplicado: cuando IG_DM_SOURCE="manychat", los DMs de Instagram
    // entran SOLO por el webhook de ManyChat — el canal oficial los ignora
    // (si no, cada DM se procesa DOBLE: 2x LLM, 2x respuestas al lead y
    // colisiones de rate limit en ráfagas de historias). Los comentarios y
    // postbacks del embudo NO pasan por aquí y siguen funcionando igual.
    if (msg.channel === "instagram" && c.env.IG_DM_SOURCE === "manychat") continue;
    // Instagram: el webhook no trae el nombre, así que la conversación se crearía
    // con el id opaco. Lo resolvemos a "Nombre · @usuario" (best-effort, cacheado).
    if (msg.channel === "instagram" && !msg.displayName) {
      msg.displayName = await metaProfileName(c.env, msg.channelUserId);
    }
    await ingestOne(c.env, msg); // dedup + catch → nunca tumba el 200 a Meta
  }
  // Embudo de comentarios (feature personal): comentarios → DM con botón, y el
  // clic del botón → recurso. Los errores se logean pero no tumban el 200 a Meta.
  for (const cm of parseMetaComments(body as any)) {
    await handleComment(cm, c.env).catch((e) => console.error("comment funnel:", e));
  }
  for (const pb of parseMetaPostbacks(body as any)) {
    await handlePostback(pb, c.env).catch((e) => console.error("postback:", e));
  }
  return c.text("EVENT_RECEIVED", 200);
});

// --- WhatsApp OFICIAL (Cloud API de Meta, sin Twilio/BSP) -------------------
// GET = handshake de verificación (igual que Meta). Acepta el WHATSAPP_VERIFY_TOKEN
// propio o, si no se configuró, cae al META_VERIFY_TOKEN (misma app de Meta).
app.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const expected = c.env.WHATSAPP_VERIFY_TOKEN || c.env.META_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected) {
    return c.text(challenge ?? "", 200);
  }
  return c.text("forbidden", 403);
});

// POST = mensajes entrantes. Firma X-Hub-Signature-256 con el App Secret de
// WhatsApp (o el de Meta si comparten app). Un POST puede traer varios mensajes.
app.post("/webhooks/whatsapp", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-hub-signature-256");
  const secret = c.env.WHATSAPP_APP_SECRET || c.env.META_APP_SECRET;
  const valid = !!secret && (await verifyMetaSignature(raw, sig, secret));
  if (!valid) return c.text("bad signature", 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }
  const origin = c.env.DASHBOARD_BASE_URL || new URL(c.req.url).origin;
  for (const msg of await parseWhatsAppEvents(body as any, c.env, origin)) {
    await ingestOne(c.env, msg); // dedup + catch → nunca tumba el 200 a WhatsApp
  }
  return c.text("EVENT_RECEIVED", 200);
});

// Proxy FIRMADO del media entrante de WhatsApp Cloud (audio/imagen). Hace el
// media públicamente fetchable (para transcribe/vision) sin exponer el token.
app.get("/webhooks/whatsapp/media/:id", (c) =>
  serveWhatsAppMedia(c.req.param("id"), c.req.query("exp") ?? null, c.req.query("sig") ?? null, c.env),
);

// Archivo que el DUEÑO mandó desde la app: público pero FIRMADO (HMAC + 15 min)
// porque los proveedores descargan por link, sin auth. Solo sirve filas
// direction='out' — lo que manda el cliente nunca es público. Ver media/outbound.ts.
app.get("/media-out/:id", (c) =>
  serveOutboundMedia(c.env, c.req.param("id"), c.req.query("exp") ?? null, c.req.query("sig") ?? null),
);

// --- WhatsApp por KAPSO (proxy de la Cloud API, con COEXISTENCIA) ------------
// Webhook de EVENTOS de Kapso (kind=kapso, payload v2). Firma propia:
// X-Webhook-Signature = HMAC-SHA256(KAPSO_WEBHOOK_SECRET, rawBody) hex — se
// valida contra los bytes crudos (fail-closed). Debe responder 200 en <10 s o
// Kapso reintenta (10/40/90 s).
app.post("/webhooks/kapso", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-webhook-signature");
  const valid = await verifyKapsoSignature(raw, sig, c.env.KAPSO_WEBHOOK_SECRET);
  if (!valid) return c.text("bad signature", 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }
  // Buffering de Kapso debe estar OFF (Forja ya bufferea por conversación en el
  // DO). Aun así, si llega un batch (X-Webhook-Batch), lo expandimos para no
  // perder mensajes; decidimos por evento con su propio `direction`.
  if (c.req.header("x-webhook-batch") === "true") {
    console.warn(`kapso: webhook batch recibido (size=${c.req.header("x-batch-size") ?? "?"}); el buffering debería estar OFF`);
  }
  for (const ev of normalizeKapsoEvents(body)) {
    // COEXISTENCIA: mensaje SALIENTE. Si el dueño respondió desde su app (origin
    // business_app) pausamos esa conversación (takeover); el eco del propio bot
    // (cloud_api) y los recibos (delivered/read) no hacen nada.
    if (ev?.message?.kapso?.direction === "outbound") {
      await kapsoOwnerTakeover(ev, c.env).catch((e) => console.error("kapso takeover:", e));
      continue;
    }
    // Mensaje ENTRANTE del cliente → al pipeline (dedup + buffer del DO).
    for (const msg of await parseKapsoEvents(ev, c.env)) {
      await ingestOne(c.env, msg); // dedup + catch → nunca tumba el 200 a Kapso
    }
  }
  return c.text("ok", 200);
});

// --- ZERNIO (proveedor unificado: IG/Messenger/WhatsApp/Telegram/X/…) --------
// Webhook `message.received`. Firma HMAC-SHA256 directa (X-Zernio-Signature).
// Guarda el contexto de envío (conversationId + accountId, por persona) al
// recibir, para poder responder por el inbox de Zernio.
app.post("/webhooks/zernio", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-zernio-signature") ?? c.req.header("x-late-signature");
  const valid = await verifyZernioSignature(raw, sig, c.env.ZERNIO_WEBHOOK_SECRET);
  if (!valid) return c.text("bad signature", 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }
  for (const ev of normalizeZernioEvents(body)) {
    if (ev?.event !== "message.received") continue; // message.sent/otros → 200 sin procesar
    const convId = ev.message?.conversationId;
    const acctId = ev.account?.accountId || ev.account?.id;
    const userId = ev.message?.sender?.id;
    if (convId && acctId && userId)
      await rememberZernioCtx(c.env, userId, convId, acctId, ev.message?.platform);
    for (const msg of parseZernioEvents(ev)) {
      await ingestOne(c.env, msg); // dedup + catch → nunca tumba el 200 a Zernio
    }
  }
  return c.text("ok", 200);
});

// --- WhatsApp por YCLOUD (BSP oficial, con COEXISTENCIA) ---------------------
// Webhook de eventos de YCloud. Firma tipo Stripe (anti-replay):
// YCloud-Signature: t=<unix>,s=HMAC-SHA256(YCLOUD_WEBHOOK_SECRET,"<t>.<body>") — se
// valida contra los bytes crudos + tolerancia de timestamp (fail-closed).
app.post("/webhooks/ycloud", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("ycloud-signature");
  const valid = await verifyYCloudSignature(raw, sig, c.env.YCLOUD_WEBHOOK_SECRET);
  if (!valid) return c.text("bad signature", 403);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text("bad json", 400);
  }
  const origin = c.env.DASHBOARD_BASE_URL || new URL(c.req.url).origin;
  for (const ev of normalizeYCloudEvents(body)) {
    // COEXISTENCIA: el dueño respondió desde su app (whatsapp.smb.message.echoes) →
    // pausamos esa conversación (takeover). El resto de eventos entrantes van al pipeline.
    if (ev?.type === "whatsapp.smb.message.echoes") {
      await ycloudOwnerTakeover(ev, c.env).catch((e) => console.error("ycloud takeover:", e));
      continue;
    }
    for (const msg of await parseYCloudEvents(ev, c.env, origin)) {
      await ingestOne(c.env, msg); // dedup + catch → nunca tumba el 200 a YCloud
    }
  }
  return c.text("ok", 200);
});

// Proxy FIRMADO del media entrante de YCloud (audio/imagen). Hace el media
// públicamente fetchable (para transcribe/vision) sin exponer el X-API-Key.
app.get("/webhooks/ycloud/media/:id", (c) =>
  serveYCloudMedia(c.req.param("id"), c.req.query("exp") ?? null, c.req.query("sig") ?? null, c.env),
);

// Universal webhook LEARN endpoint. When learn mode is ON for `:channel`, this
// captures a real payload (classified by media kind) so the bot can later infer
// where each field lives — instead of hardcoding one app's contract. It NEVER
// runs the LLM; it only observes. When learn mode is OFF it returns 409 so the
// caller knows nothing was captured.
app.post("/webhooks/learn/:channel", async (c) => {
  const channel = c.req.param("channel");
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }

  const repo = new SettingsRepo(new Db(c.env.DB));
  const kind = detectKind(payload);

  if (!(await isLearnMode(repo, channel))) {
    return c.json({ ok: false, error: "learn mode off" }, 409);
  }

  await saveCapture(repo, channel, kind, payload);
  return c.json({ ok: true, captured: kind, channel }, 200);
});

// Cobros por WhatsApp (superpoder Pro): confirmación de pago de Stripe. Fuera
// del guard del control plane — Stripe autentica por firma (whsec), no Bearer.
app.post("/webhooks/stripe", async (c) => {
  const { handleStripeWebhook } = await import("./integrations/stripeWebhook");
  return handleStripeWebhook(c.req.raw, c.env);
});

// Estilo del panel EN CALIENTE: antes de renderizar el /admin, aplica el
// brand_style guardado en D1 (pisa la env). Solo aquí — un webhook no renderiza
// el panel, así que no gasta el read. Ver applyBranding en admin/branding.ts.
app.use("/admin/*", async (c, next) => {
  await applyBranding(c.env);
  await next();
});

// /equipo — el login del EQUIPO y el dueño (correo/contraseña, sin mención de
// Forja Cloud). Es el link que el administrador comparte con dominio propio:
// "entra en tunegocio.com/equipo". La puerta del administrador es /admin
// (Forja Cloud primario). Mismo POST /admin/login para ambos.
app.get("/equipo", async (c) => {
  const { renderLogin, loginCopy } = await import("./admin/views/equipo");
  const settings = await new SettingsRepo(new Db(c.env.DB)).all().catch(() => ({} as Record<string, string>));
  return c.html(renderLogin(c.env, { copy: loginCopy(c.env, settings), variant: "equipo" }));
});

// GET /admin/ (slash final — Chrome lo agrega solo desde el historial): el
// subapp montado solo matchea "/admin" exacto para su ruta raíz, así que CON
// sesión válida el slash caía al 404 global ("not found", 2026-08-29). Sin
// sesión nunca se veía: el middleware redirige al login antes del matching.
app.get("/admin/", (c) => c.redirect("/admin/overview"));

// Admin dashboard — Basic Auth guarded sub-app mounted at /admin/*.
app.route("/admin", adminApp);

// Control-plane API — Bearer-guarded (CONTROL_PLANE_TOKEN) read-only sub-app
// mounted at /api/* for a future hosted control plane (health + metrics).
app.route("/api", apiApp);

// Embudos de comentarios dinámicos — endpoint /funnels (auth X-Funnel-Token).
// Crea/lista/borra embudos por reel desde el CRM/script/agente-dueño.
app.route("/funnels", funnelsApp);

// Sirve los lead magnets generados por el agente-dueño (HTML en R2). Público
// (se entrega a los leads); la URL es <worker>/lm/<id>.
app.get("/lm/:id", async (c) => {
  if (!c.env.CATALOG) return c.text("Lead magnets no están activados en este bot.", 404);
  const obj = await c.env.CATALOG.get(`lm/${c.req.param("id")}.html`);
  if (!obj) return c.text("not found", 404);
  return new Response(obj.body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});

// White-label del panel (Modo Agencia): logo self-hosted. El skill /whitelabel
// guarda el logo optimizado como data-URI en settings(brand_logo) y pone
// BRAND_LOGO_URL="/brand/logo". Público (es solo un logo, mismo origin que el
// panel) → así el miembro no necesita hosting externo. Ver src/admin/branding.ts.
app.get("/brand/logo", async (c) => {
  const raw = ((await new SettingsRepo(new Db(c.env.DB)).get(SETTING_KEYS.brandLogo)) ?? "").trim();
  const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(raw);
  if (!m) return c.text("not found", 404);
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=300" },
  });
});

// Galería (superpoder /galeria): sirve las fotos/audios que el bot manda en sus
// respuestas. Público a propósito — los proveedores (Meta/Twilio/YCloud/…)
// descargan por link sin auth. El id es aleatorio (no adivinable) e inmutable
// (borrar+subir = id nuevo), por eso el cache largo. Blob en settings
// (media_blob:<id>), mismo mecanismo self-hosted que /brand/logo.
app.get("/media/:id", async (c) => {
  const { getMediaBlob } = await import("./media-assets");
  const blob = await getMediaBlob(new Db(c.env.DB), c.req.param("id"));
  if (!blob) return c.text("not found", 404);
  return new Response(blob.bytes, {
    headers: {
      "Content-Type": blob.mime,
      "Content-Length": String(blob.bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

// KB reindex — embeds scripts/kb-fixtures.json into Vectorize. Guarded by the
// KB_REINDEX_TOKEN secret via the X-Reindex-Token header. Trigger after deploy:
//   curl -X POST https://<worker>/kb/reindex -H "X-Reindex-Token: <token>"
app.post("/kb/reindex", async (c) => {
  const provided = c.req.header("X-Reindex-Token") ?? "";
  const expected = c.env.KB_REINDEX_TOKEN ?? "";
  if (!expected || !tokensMatch(provided, expected)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  const r = await reindexFixtures(c.env);
  return c.json({ ok: true, indexed: r.indexed, removed: r.removed }, 200);
});

app.notFound((c) => c.text("not found", 404));

export default {
  // Bind so Hono keeps its `this` when invoked as `worker.fetch(req, env, ctx)`
  // (both by the Cloudflare runtime and by tests). Passing `app.fetch` unbound
  // loses the receiver and throws "Cannot read properties of undefined".
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Cron dedicado del aviso de precio: hace SOLO eso y se sale (un tick extra
    // no debe disparar followups/watchdog fuera de su cadencia normal).
    if (event.cron === "9,24,39 5 27 7 *") {
      const { runAvisosProgramados } = await import("./crons/avisoPrecio");
      await runAvisosProgramados(env).catch((e) => console.error("aviso:", e));
      return;
    }

    // Tier efectivo también en el cron (followups/analyzer/alertas usan isPro).
    await applyTier(env);
    await applyLanguage(env);
    // Nudge de deadline del evento (cron "*/10 * * * *" en instancias con modo
    // masterclass): manda el "quedan 2 horas de bonos" a quien escribió durante
    // la clase. Fuera de la ventana regresa al instante; en instancias sin
    // EVENT_* es un no-op.
    const { maybeSendDeadlineNudge } = await import("./tools/masterclass");
    await maybeSendDeadlineNudge(env).catch((e) => console.error("deadlineNudge:", e));

    // Minería de objeciones + interés (modo evento): etiqueta conversaciones
    // idle ≥30 min. No-op en instancias sin EVENT_*.
    const { labelConversations } = await import("./insights/objections");
    await labelConversations(env).catch((e) => console.error("objections:", e));

    // Follow-up bot: UN mensaje breve de seguimiento a leads que lo ameritan
    // (venta abierta / 4+ preguntas / keyword del evento), dentro de la ventana
    // de 24h y máximo una vez por conversación. Acotado por caps internos.
    const { runFollowups } = await import("./followup/run");
    await runFollowups(env).catch((e) => console.error("followups:", e));

    // Superpoderes de seguimiento (Pro): encuestas de satisfacción + pide
    // reseñas (outreach dentro de ventana), captura de la calificación de la
    // encuesta, y re-enganche de leads fríos a 2-7 días. Cada uno respeta su
    // propio toggle y caps; en free/desactivados regresan al instante.
    const { runOutreach } = await import("./followup/outreach");
    await runOutreach(env).catch((e) => console.error("outreach:", e));
    const { captureSurveyResponses } = await import("./followup/surveyResponse");
    await captureSurveyResponses(env).catch((e) => console.error("surveyResponse:", e));
    const { runReengage } = await import("./followup/reengage");
    await runReengage(env).catch((e) => console.error("reengage:", e));

    // Watchdog: si el bot está fallando en cadena (3+ "Algo falló" en 30 min),
    // avisa al dueño por su canal de handoff. Throttle 6h. Lo ÚNICO que debe
    // despertarlo en la noche.
    const { checkBotHealth } = await import("./watchdog");
    await checkBotHealth(env).catch((e) => console.error("watchdog:", e));

    // Avisos programados one-shot (ej. "sube el precio en 30 min"). No hacen
    // nada fuera de su ventana; el claim en template_sends evita duplicados.
    const { runAvisosProgramados } = await import("./crons/avisoPrecio");
    await runAvisosProgramados(env).catch((e) => console.error("aviso:", e));

    // Los trabajos nocturnos SOLO corren en el tick diario (3am UTC) — el tick
    // de cada 10 min del modo evento no debe purgar/analizar 144 veces al día.
    if (event.cron && event.cron !== "0 3 * * *") return;

    // Heartbeat al control plane (best-effort): le informa la base URL real de
    // este bot self-hosted. No-op sin CONTROL_PLANE_URL/TOKEN; nunca tumba el
    // cron (ctx.waitUntil + try/catch propio).
    ctx.waitUntil(
      (async () => {
        const { selfOrigin, sendHeartbeat } = await import("./lib/self-origin");
        const tierPlan = await sendHeartbeat(env, await selfOrigin(env));
        // Self-heal diario del tier (1.0.74): aplica lo que el plan del dueño
        // dice, sin que nadie visite ninguna página. "free" solo llega con
        // cancelación explícita (garantía del control plane); null = no tocar.
        if (tierPlan) {
          const { effectiveTier, bustTierCache } = await import("./tier");
          if ((await effectiveTier(env)) !== tierPlan) {
            const { Db } = await import("./db/client");
            const { SettingsRepo, SETTING_KEYS } = await import("./db/settings");
            await new SettingsRepo(new Db(env.DB)).set(SETTING_KEYS.tierOverride, tierPlan);
            bustTierCache(tierPlan);
            console.log(`[heartbeat] tier self-heal → ${tierPlan}`);
          }
        }
      })().catch((e) => console.error("heartbeat:", e)),
    );

    // Daily cron (wrangler.toml: "0 3 * * *") — purge messages older than 90 days.
    await purgeOldMessages(env);
    // …y sus archivos: la fuga era real (los mensajes se borraban, las filas de
    // `media` y los objetos de R2 no). Lotes chicos y best-effort — ninguna de
    // las dos debe tumbar los trabajos nocturnos que siguen.
    await purgeOldMedia(env).catch((e) => console.error("purgeOldMedia:", e));
    // Chats de prueba de la app (test:<session>) sin actividad en 30 días: se
    // borran con todo lo que cuelga de ellos.
    await purgeOldTestChats(env).catch((e) => console.error("purgeOldTestChats:", e));
    // Corrida nocturna del Analista de insights (F2). No debe tumbar la purga.
    await analyzeConversations(env, { limit: 50 }).catch((e) => console.error("insights:", e));
    // Reportes automáticos (superpoder Pro): resumen del día al dueño. Corre
    // DESPUÉS del Analista para incluir sus insights (ventas calientes, molestos).
    const { sendDailyReport } = await import("./owner/dailyReport");
    await sendDailyReport(env).catch((e) => console.error("dailyReport:", e));
    // Flywheel (F5): detecta huecos de KB y lecciones de takeovers → propone
    // mejoras en /admin/mejoras. Corre DESPUÉS del analizador (usa su output).
    const { runFlywheel } = await import("./flywheel/detect");
    await runFlywheel(env).catch((e) => console.error("flywheel:", e));
    // Modo COPILOTO (autonomy_level="copilot"): auto-aplica las mejoras seguras
    // detectadas (lecciones + KB sin huecos). Lo delicado espera al dueño.
    try {
      const level = await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.autonomyLevel);
      if (level === "copilot") {
        const { autoApplyPending } = await import("./flywheel/apply");
        await autoApplyPending(env);
      }
    } catch (e) {
      console.error("copiloto:", e);
    }
  },
} satisfies ExportedHandler<Env>;
