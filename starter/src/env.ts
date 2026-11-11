import type { D1Database, DurableObjectNamespace, R2Bucket, VectorizeIndex, Ai } from "@cloudflare/workers-types";
import type { SupportAgent } from "./agent";

export interface Env {
  // Bindings
  // Typed namespace so we can call the agent's methods via RPC (stub.ingest()).
  AGENT: DurableObjectNamespace<SupportAgent>;
  DB: D1Database;
  KB: VectorizeIndex;
  // R2 = OPCIONAL (solo lead magnets). Ausente en el bot default. Guía: docs/opcional-lead-magnets.md
  CATALOG?: R2Bucket;
  // R2 de la Bóveda (superpoder Forja+): archiva imágenes/docs del cliente.
  // OPCIONAL, ausente por default — la skill /boveda crea el bucket y el binding.
  MEDIA?: R2Bucket;
  AI: Ai;
  // Cloudflare Email Service (binding `send_email`, OPCIONAL): correos del
  // panel (invitaciones, recuperar contraseña, avisos al equipo). Requiere
  // dominio onboardeado en Email Service + Workers Paid para destinatarios
  // arbitrarios. Sin él, cae a RESEND_API_KEY; sin ambos, el panel degrada
  // (muestra el link para mandarlo a mano). Ver src/mailer.ts.
  EMAIL?: { send(msg: { from: string; to: string; subject: string; html?: string; text?: string }): Promise<{ messageId?: string }> };

  // Vars (member-set)
  BOT_NAME: string;
  PEER_BOTS?: string; // JSON [{name,url}] — otras instancias para el selector de proyectos
  WA_DAILY_TEMPLATE_CAP?: string; // tope diario de plantillas HSM (default 250 — tier 1 de Meta)
  BUSINESS_NAME: string;
  // White-label del dashboard (Modo Agencia): el agencia/cliente pone SU marca.
  // Todas opcionales — sin ellas, el panel usa el tema Forja por defecto. Se
  // validan al aplicarse (ver src/admin/branding.ts); un valor inválido cae al
  // default, así el panel NUNCA se rompe por un branding mal puesto.
  BRAND_NAME?: string; // nombre en el sidebar (default: "HorizontesAgentOS")
  BRAND_LOGO_URL?: string; // URL https del logo (default: sin logo, solo texto)
  BRAND_ACCENT?: string; // acento principal, hex #rgb/#rrggbb (default: #f07a3f)
  BRAND_ACCENT_2?: string; // acento secundario, hex (default: #f5a623)
  BRAND_SURFACE?: string; // color base del fondo, hex — tiñe TODO el panel (default: superficies Forja)
  BRAND_FONT?: string; // fuente de la lista blanca (default: Space Grotesk)
  BRAND_HIDE_FORJA?: string; // "on" oculta el "powered by Forja" (solo Agencia)
  // Preset de estilo completo del panel: "nimbus" (claro minimal), "onyx"
  // (oscuro moderno) o "terra" (cálido editorial). Vacío/ inválido = tema Forja
  // (retro-terminal). Es un PRESET de tokens/forma; no cambia tabs ni rutas. El
  // BRAND_ACCENT/logo del miembro, si existen, ganan sobre el default del preset.
  BRAND_STYLE?: string; // nimbus | onyx | terra (default: tema Forja)
  // Tabs del dashboard que este bot OCULTA (Modo Agencia: el panel del cliente
  // sin Costos, Config, etc.). CSV de ids del NAV ("costs,config"). Solo ids de
  // HIDEABLE_TABS aplican; "overview" nunca se oculta. Free la ignora (como
  // BRAND_*). Además de desaparecer del sidebar, la ruta directa redirige.
  HIDDEN_TABS?: string;
  BOT_LANGUAGE: string;
  // Zona horaria del bot para resolver fechas relativas del cliente ("mañana",
  // "el jueves 27"). Opcional: si falta, cae a CALCOM_TIMEZONE y luego a
  // America/Mexico_City. Ver src/time/dateAnchor.ts.
  BOT_TIMEZONE?: string;
  // Idioma del PANEL, resuelto por el middleware desde el ajuste panel_language.
  // No viene del wrangler.toml: lo elige el dueño en Configuración.
  PANEL_LANGUAGE?: string;
  BOT_TIER: "free" | "pro";
  /** Estrictez del Blindaje anti-invento (Pro): off | negaciones | auto | estricto.
   * Ausente = "auto" (turno respaldado por tool/KB → solo vigila negaciones;
   * sin respaldo → verificación completa). Ver src/blindaje/verify.ts. */
  BLINDAJE_MODE?: string;
  // Nicho del bot (restaurante, inmobiliaria…). Selecciona el "niche pack" que
  // re-etiqueta el dashboard, aporta el playbook del giro y sus columnas.
  // Ausente/desconocido → pack genérico (comportamiento actual). Ver src/niches/.
  BOT_NICHE?: string;
  /** "on" enciende el chat web público de demo (/demo). APAGADO por defecto. */
  DEMO_MODE?: string;

  // CANAL WEB — dominios del sitio del negocio, separados por coma
  // ("minegocio.com, www.minegocio.com"). Sin esta var el canal no existe.
  // El widget solo responde a peticiones que vengan de esos dominios.
  WEB_SITES?: string;
  // LLM provider for the chat brain: "anthropic" (default) | "openai" | "xai" | "google".
  // If unset and only OPENAI_API_KEY is present, auto-selects "openai".
  // (Voice transcription + embeddings always run on Cloudflare Workers AI.)
  LLM_PROVIDER?: "anthropic" | "openai" | "xai" | "google";
  // Optional per-tier model id overrides (fast = cheap default, smart = upgrade).
  ANTHROPIC_MODEL_FAST?: string;
  ANTHROPIC_MODEL_SMART?: string;
  // FIX PRINCIPAL del 403 {"forbidden","Request not allowed"} de Anthropic:
  // región donde corre el agente (Durable Object). Sin webhook de por medio el
  // DO nace junto al proveedor del canal — si ese proveedor está en Asia (p.ej.
  // YCloud), el edge de api.anthropic.com veta el egress. "enam"/"wnam" lo
  // mueve a Norteamérica y las llamadas pasan con la misma API key. Valores:
  // wnam|enam|sam|weur|eeur|apac|oc|afr|me. Vacío = comportamiento de siempre.
  AGENT_LOCATION_HINT?: string;
  // Plan B del mismo 403: ruta alterna al API de Anthropic (p.ej. un Cloudflare
  // AI Gateway propio). También cubre las llamadas LLM del cron (follow-ups,
  // insights) si algún día fallaran. El SDK le anexa "/messages" — termina en
  // el segmento equivalente a /v1:
  // https://gateway.ai.cloudflare.com/v1/<account>/<gw>/anthropic/v1
  ANTHROPIC_BASE_URL?: string;
  OPENAI_MODEL_FAST?: string;
  OPENAI_MODEL_SMART?: string;
  GOOGLE_MODEL_FAST?: string;
  GOOGLE_MODEL_SMART?: string;
  BUFFER_SECONDS: string;
  DASHBOARD_BASE_URL: string;

  // Secrets (member-set via wrangler secret put)
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY?: string;  // alternative LLM provider (see LLM_PROVIDER)
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;  // remitente del panel, ej. bot@tunegocio.com (dominio onboardeado en CF Email o verificado en Resend)
  TELEGRAM_BOT_TOKEN?: string;
  // Telegram no firma sus webhooks: la defensa es el secret_token que se pasa a
  // setWebhook y que Telegram repite en X-Telegram-Bot-Api-Secret-Token. Si esta
  // var existe, el route la exige (403 si no coincide); si no existe (bots
  // registrados antes del secreto), el webhook sigue abierto — deploy-check avisa.
  TELEGRAM_WEBHOOK_SECRET?: string;
  // Zernio — proveedor unificado (Instagram/Messenger/WhatsApp/Telegram/X/…).
  // Canal adicional. ZERNIO_API_KEY = Bearer del dashboard; ZERNIO_WEBHOOK_SECRET
  // firma el webhook (X-Zernio-Signature). Ver src/channels/zernio.ts.
  ZERNIO_API_KEY?: string;
  ZERNIO_WEBHOOK_SECRET?: string;
  ZERNIO_API_BASE?: string; // default https://zernio.com/api/v1
  MANYCHAT_API_KEY?: string;
  MANYCHAT_CONTENT_TYPE?: "instagram" | "whatsapp" | "telegram" | "messenger"; // ManyChat channel for sendContent; defaults to "instagram"
  // Tool de soporte de Forja (solo la instancia de Horizontes; inerte sin ambos).
  FORJA_SUPPORT_URL?: string;    // ej. https://horizontes-license-server.….workers.dev
  FORJA_SUPPORT_TOKEN?: string;  // Bearer del lookup /v1/support/license
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WA_FROM?: string;
  TWILIO_HANDOFF_CONTENT_SID?: string;  // approved WhatsApp template for owner handoff DM
  // Meta oficial (Facebook Messenger + Instagram DMs, sin ManyChat).
  META_PAGE_ACCESS_TOKEN?: string;  // Messenger / IG ligado a Página (graph.facebook.com)
  INSTAGRAM_ACCESS_TOKEN?: string;  // Instagram API con Instagram Login, token IGAA… (graph.instagram.com)
  META_VERIFY_TOKEN?: string;       // string que tú eliges; valida el handshake GET del webhook
  META_APP_SECRET?: string;
  // "manychat" = los DMs de Instagram entran SOLO por ManyChat (el webhook
  // oficial de Meta los ignora para no procesarlos doble). Comentarios y
  // postbacks del embudo no se ven afectados.
  IG_DM_SOURCE?: string;
  // "off" = el agente-dueño de WhatsApp se pausa: los mensajes del número del
  // dueño entran al flujo normal de clientes (para probar el bot desde su cel).
  OWNER_AGENT?: string;
  /** "on" activa el modo auditoría (dinámica masterclass, instancia Horizontes). */
  AUDIT_MODE?: string;
  /** "on" activa la recopilación de funciones para Forja (historia de IG, instancia Horizontes). */
  FEATURE_MODE?: string;
  // "off" = canal oficial de IG apagado por completo (DMs + embudo de
  // comentarios + postbacks). El bot de IG vive solo en ManyChat.
  IG_OFFICIAL?: string;         // App Secret de Facebook; firma los webhooks de Messenger
  INSTAGRAM_APP_SECRET?: string;    // App Secret del producto Instagram (IG Login); firma los webhooks de IG
  // WhatsApp OFICIAL (Cloud API de Meta, sin BSP/Twilio). Mismo ecosistema Graph
  // que Meta; el número corre en la cuenta del miembro con SU token. El envío es
  // a graph.facebook.com/<phone_number_id>/messages; el media entrante se sirve
  // por el proxy firmado /webhooks/whatsapp/media/:id (Cloud API exige el token
  // para descargarlo, así queda del lado del server).
  WHATSAPP_PHONE_NUMBER_ID?: string;  // el Phone Number ID del número (no el número)
  WHATSAPP_ACCESS_TOKEN?: string;     // token del system user / WABA (Bearer)
  WHATSAPP_VERIFY_TOKEN?: string;     // handshake GET del webhook (si falta, usa META_VERIFY_TOKEN)
  WHATSAPP_APP_SECRET?: string;       // firma X-Hub-Signature-256 (si falta, usa META_APP_SECRET)
  // WhatsApp por KAPSO (proxy de la Cloud API con COEXISTENCIA — el negocio
  // conserva su app de WhatsApp Business en el mismo número). Extra a Twilio y
  // Cloud API. Envío por api.kapso.ai (X-API-Key); webhook de eventos Kapso.
  KAPSO_API_KEY?: string;             // API key del proyecto Kapso (header X-API-Key)
  KAPSO_PHONE_NUMBER_ID?: string;     // phone_number_id del número conectado en Kapso
  KAPSO_WEBHOOK_SECRET?: string;      // firma X-Webhook-Signature = HMAC-SHA256(secret, rawBody) hex
  // WhatsApp por YCLOUD (BSP oficial con COEXISTENCIA y zero-markup). Envío por
  // api.ycloud.com (X-API-Key); firma de webhook tipo Stripe (t + HMAC).
  YCLOUD_API_KEY?: string;            // API key de YCloud (header X-API-Key)
  YCLOUD_WA_FROM?: string;            // el NÚMERO del negocio en E.164 (el `from` del envío)
  YCLOUD_WEBHOOK_SECRET?: string;     // firma YCloud-Signature = HMAC-SHA256(secret, "<t>.<body>") hex
  // Embudos de comentarios dinámicos (feature personal): endpoint POST /funnels.
  FUNNEL_API_TOKEN?: string;        // guarda el endpoint /funnels (header X-Funnel-Token)
  SUPADATA_API_KEY?: string;        // transcripción de reels (Supadata) — para el agente-dueño (F3)
  XAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;          // Gemini (BYO-LLM) — ver LLM_PROVIDER="google"

  // ── Modo evento/masterclass (opt-in; enciende tools extra del bot) ────────
  EVENT_NAME?: string;              // "Crear y Dominar Agentes IA con Claude Code"
  EVENT_STARTS_AT?: string;         // ISO con offset, ej. "2026-07-26T13:00:00-06:00"
  EVENT_DURATION_MIN?: string;      // duración en minutos (default 120)
  EVENT_REGISTER_URL?: string;      // landing de registro (activa el modo evento)
  EVENT_SLUG?: string;              // slug del evento en la plataforma (para el registro conversacional)
  EVENT_GROUP_URL?: string;         // grupo de WhatsApp del evento
  EVENT_OFFER_URL?: string;         // página de la oferta/comunidad
  EVENT_RESOURCES_URL?: string;     // materiales del evento (keyword RECURSOS)
  EVENT_KEYWORDS?: string;          // palabras de registro de la campaña (coma-separadas). Vacío = set amplio por default. La keyword varía por historia — nunca se exige coincidencia exacta.
  EVENT_FASTACTION_NOTE?: string;   // línea del bono fast-action (se muestra en la fase EN VIVO)
  REGISTRATION_WEBHOOK_URL?: string;   // endpoint de la plataforma para registro conversacional
  REGISTRATION_WEBHOOK_SECRET?: string; // secret compartido con ese endpoint
  SHOW_TOKEN?: string;              // token del live wall /show (proyección en vivo)             // Grok (xAI) — cerebro del agente-dueño (F2)
  // ── Cal.com (agenda real para los nichos de cita) ────────────────────────
  // Con estas vars, el bot consulta disponibilidad real y reserva en Cal.com.
  // Sin ellas, agendarCita solo registra la cita para que el dueño la confirme.
  CALCOM_API_KEY?: string;                 // secret: API key de Cal.com (cal_...)
  CALCOM_EVENT_TYPE_ID?: string;           // event type por defecto (numérico, como string)
  CALCOM_EVENT_TYPES?: string;             // opcional: JSON {"corte":123,"barba":456} servicio→eventTypeId
  CALCOM_TIMEZONE?: string;                // zona horaria (default America/Mexico_City)
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;  // base64-encoded JSON
  // ── Cobros por WhatsApp (superpoder Pro) ─────────────────────────────────
  // Con la llave secreta de Stripe del miembro, la tool sendPaymentLink crea un
  // link de pago y el webhook /api/stripe/webhook confirma cuando pagan. Sin
  // ella, la tool avisa "cobros sin conectar" (no se inventa un cobro).
  STRIPE_SECRET_KEY?: string;      // secret: sk_live_… / sk_test_… del miembro
  STRIPE_WEBHOOK_SECRET?: string;  // secret: whsec_… para verificar la firma del webhook
  // ── Composio (superpoder Pro): integraciones genéricas por app ───────────
  // Con la API key del proyecto de Composio del miembro, el bot puede usar
  // CUALQUIER app que haya conectado ahí (Google Calendar, Gmail, Slack,
  // Notion, CRMs…) sin código por app — ver src/integrations/composio.ts.
  // Sin ella, la tool "composio" ni se registra (no-op).
  COMPOSIO_API_KEY?: string;    // secret: llave del proyecto de Composio (composio.dev)
  COMPOSIO_ENTITY_ID?: string;  // opcional: filtra las cuentas conectadas por user_id (Composio v3); sin ella se usan TODAS las del proyecto
  OWNER_EMAIL: string;  // for handoff notifications (email)
  OWNER_TELEGRAM_CHAT_ID?: string;  // for handoff notifications (default channel)
  OWNER_WA_NUMBER?: string;  // for Pro handoff WhatsApp DM (requires template)

  // HTTP Basic Auth password for the admin dashboard (secret).
  // Username is always "admin". Set via `wrangler secret put DASHBOARD_PASSWORD`.
  DASHBOARD_PASSWORD: string;

  // "1" = panel admin PÚBLICO (sin Basic Auth). Solo cuando el dueño lo decide
  // explícitamente (var en wrangler.toml); sin la var, el guard queda activo.
  DASHBOARD_PUBLIC?: string;

  // Token guarding POST /kb/reindex (header: X-Reindex-Token). Secret.
  // Set via `wrangler secret put KB_REINDEX_TOKEN`.
  KB_REINDEX_TOKEN: string;

  // Control plane (hosted): glue para que un plano de control externo lea este
  // bot self-hosted vía los endpoints /api/*. Ambos opcionales; sin el token,
  // /api/* queda cerrado (fail-closed).
  CONTROL_PLANE_TOKEN?: string;  // secret; Bearer que el control plane presenta para llamar /api/*
  CONTROL_PLANE_URL?: string;    // base URL del control plane (para reportes / license check futuros)
}
