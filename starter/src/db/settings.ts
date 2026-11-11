import { Db } from "./client";
import type { Env } from "../env";

// Canonical setting keys. Every value is stored as TEXT; the loader parses.
// Empty/absent => default (see settings-loader.ts).
export const SETTING_KEYS = {
  systemPromptOverride: "system_prompt_override",
  businessContext: "business_context",
  botName: "bot_name",
  tone: "tone", // línea corta de estilo (las 3 tarjetas del panel: cálido/formal/divertido)
  brandVoice: "brand_voice", // guía de voz COMPLETA que arma el skill /voz-de-marca (Pro): retrato, muletillas, así-sí/así-no, situaciones. Se inyecta como bloque <brand_voice>.
  customInstructions: "custom_instructions", // reglas de comportamiento ADITIVAS del dueño (modo guiado): bloque <custom_instructions>, subordinado a los frenos. Se SUMA al prompt generado; NO lo reemplaza (eso es system_prompt_override). Per-canal con :<canal>.
  bufferSeconds: "buffer_seconds",
  maxChunks: "max_chunks",
  interChunkDelayMs: "inter_chunk_delay_ms",
  escalationKeywords: "escalation_keywords",
  modelOverride: "model_override", // auto | haiku | sonnet
  // Textos del login/invitación (white-label): vacío = texto default del idioma.
  loginTitulo: "login_titulo",
  loginSub: "login_sub",
  loginFrase: "login_frase",      // titular del panel oscuro
  loginPie: "login_pie",          // nota chica bajo el botón
  loginBoton: "login_boton",
  staffTabs: "staff_tabs", // Equipo: JSON de ids de tabs que ve el rol staff (ausente = default STAFF_HIDDEN_TABS)
  bovedaEnabled: "boveda_enabled", // superpoder Bóveda: archiva imágenes/docs del cliente en R2 (1 | 0, default 0)
  botPaused: "bot_paused", // 0 | 1
  // Pausa TEMPORAL (Modo Agencia, panel de la nube): epoch ms hasta el que el
  // bot enmudece. Vacío/0 = sin pausa temporal. Se combina con bot_paused por
  // OR en settings-loader; el toggle Estado del dueño la limpia (routes.ts).
  botPausedUntil: "bot_paused_until",
  // Botones tocables (opt-in, default OFF): "1" enseña al modelo el marcador
  // [[botones: …]] en el prompt generado. Skill /botones lo prende y configura.
  buttonsEnabled: "buttons_enabled",
  // Galería (superpoder Pro, opt-in, default OFF): "1" enseña al modelo el
  // marcador [[media: id]] para mandar fotos/audios del negocio. Los assets
  // viven en settings como media_meta:<id> (JSON chico, viaja en all()) +
  // media_blob:<id> (data-URI, EXCLUIDO de all() — solo lo lee GET /media/:id).
  // Skill /galeria sube/administra los assets.
  galeriaEnabled: "galeria_enabled",
  takeoverMinutes: "takeover_minutes", // human-in-the-loop: minutos que el bot se queda callado tras tu intervención (0 = hasta que reanudes). Vacío = 60.
  disabledTools: "disabled_tools", // comma-separated tool names turned off from the dashboard
  temperature: "temperature", // LLM sampling temperature 0-1; empty = provider default
  monthlyBudget: "monthly_budget", // USD cap for monthly AI spend; empty = no cap
  learnedLessons: "learned_lessons", // JSON array of rules distilled from owner takeovers
  twilioHandoffContentSid: "twilio_handoff_content_sid", // HSM del aviso de handoff (fallback del secret)
  autonomyLevel: "autonomy_level",
  boostMode: "boost_mode", // switch "modo evento": on = la persona ":boost" manda sobre canal y global // flywheel: manual (default) | copilot (auto-aplica lo seguro de noche)
  // BYO-LLM (dashboard "Modelo de IA"): the owner plugs their own provider,
  // API key and/or concrete model. Empty = the instance's env defaults.
  llmProvider: "llm_provider", // "" (auto) | anthropic | openai
  llmApiKey: "llm_api_key", // owner's API key; empty = use the env key
  llmModel: "llm_model", // concrete model id; empty = auto tiers (fast⇄smart)
  // Blindaje anti-invento (verificador pre-envío, Pro): contadores para el panel.
  blindajeChecks: "blindaje_checks", // respuestas verificadas contra la KB
  blindajeBlocked: "blindaje_blocked", // respuestas reemplazadas por "déjame confirmarlo"
  blindajeEnabled: "blindaje_enabled", // "off" apaga el Blindaje en este bot (default: on si Pro). Sin redeploy.
  blindajeMode: "blindaje_mode", // "full" | "negaciones" | "off" — rigor del Blindaje sin redeploy (override de env BLINDAJE_MODE)
  // Tier efectivo empujado por el control plane (POST /api/tier al activar
  // Forja+): "pro" | "free". Vacío = manda el BOT_TIER del wrangler.toml.
  tierOverride: "tier_override",
  // Auto-cura del origin: base URL real del worker aprendida de las requests
  // entrantes cuando DASHBOARD_BASE_URL viene vacío del install. Le da un origin
  // al código de cron (que no tiene request). Ver src/lib/self-origin.ts.
  selfOrigin: "self_origin",
  // ── Superpoderes Forja+ (runtime real, gated a Pro) ──────────────────────
  // Multi-idioma: 1 = el bot espeja el idioma del cliente (ES/EN/PT) en vez de
  // forzar BOT_LANGUAGE. Vacío/0 = comportamiento clásico (idioma fijo).
  multiLanguage: "multi_language",
  // Idioma del bot elegido en el panel (es-419 | es-ES | en | pt-BR | espejo).
  // Vacío = manda el BOT_LANGUAGE del wrangler.toml. Ver src/idioma.ts.
  botLanguage: "bot_language",
  // Símbolo de moneda con el que el bot habla de precios ($ | € | R$ …).
  // NO afecta la pestaña de Costos: esa va en USD porque los proveedores de IA
  // facturan en dólares y convertirla sería inventar un tipo de cambio.
  botCurrency: "bot_currency",
  // Idioma del PANEL (interfaz), independiente del idioma del bot: hay quien
  // quiere su panel en español y su bot contestando en inglés.
  panelLanguage: "panel_language",
  // Reportes automáticos: 1 = resumen diario al dueño por su canal. Guarda el
  // último envío para no duplicar si el cron de 3am corre dos veces.
  dailyReport: "daily_report",
  dailyReportLastAt: "daily_report_last_at",
  // Reporte diseñado (superpoder Reportes): el skill /reportes los llena a la
  // medida del negocio. format = html (default) | docx | pdf; template = HTML con
  // placeholders {{X}} (custom de Claude); accent = color de marca; logo = URL.
  reportFormat: "report_format",
  reportTemplate: "report_template",
  reportAccent: "report_accent",
  reportLogo: "report_logo",
  reportLastHtml: "report_last_html", // último reporte rico, para servir /admin/report
  // El mismo reporte como DATOS (JSON, ver owner/report/build.ts ReportSnapshot):
  // lo sirve GET /api/report/latest para la pantalla Reporte de la app. Se guarda
  // también en un día vacío — la app tiene que poder decir "día tranquilo".
  reportLastJson: "report_last_json",
  // Encuestas de satisfacción: 1 = tras una conversación resuelta, pide rating
  // 1-5 y alerta al dueño si es bajo.
  satisfactionSurvey: "satisfaction_survey",
  // Modo de la encuesta: numerico (default, rating 1-5) | abierto (opinión de
  // texto libre) | ambos (rating + comentario). Lo elige el dueño al activarla.
  surveyMode: "survey_mode",
  // Recupera no-shows / leads fríos: 1 = re-engancha leads calientes que se
  // enfriaron por días (segundo toque, ventana 2-7 días).
  reengageColdLeads: "reengage_cold_leads",
  // Cazador de ventas: default ON (ausente/"1"). "0" apaga el follow-up
  // automático (3-20h) sin bajar de tier. Ver src/followup/run.ts.
  salesHunter: "sales_hunter",
  // Plantilla HSM aprobada para reenganchar FUERA de la ventana de 24h. Dos vías
  // según el método de WhatsApp del miembro (la plantilla debe tener {{1}} =
  // nombre del cliente):
  //  • Twilio (BSP): el Content SID (HX…).
  //  • Cloud API oficial (Meta): nombre + idioma de la plantilla de Meta.
  // Vacío = fuera de ventana no reengancha (dentro de ventana y en Telegram sí).
  reengageTemplateSid: "reengage_template_sid",
  reengageTemplateName: "reengage_template_name", // Cloud API: nombre de la plantilla de Meta
  reengageTemplateLang: "reengage_template_lang", // Cloud API: idioma (es, es_MX, en_US…); default es
  // Pide reseñas: 1 = tras resolución positiva invita a dejar reseña. Requiere
  // review_url (el link de Google del negocio) para activarse de verdad.
  reviewRequests: "review_requests",
  reviewUrl: "review_url",
  // Cobros por WhatsApp: 1 = habilita la tool de cobro. Requiere el secret
  // STRIPE_SECRET_KEY para funcionar (sin él, la tool avisa "sin conectar").
  paymentsEnabled: "payments_enabled",
  // Config por-tool de Composio (JSON string, toolkit slug -> objeto de config)
  // que el dueño dejó vía el skill /conexiones-composio — ej. a qué base de
  // Airtable, qué calendario de Google Calendar, qué event_type de Cal.com
  // apunta cada app. El adaptador (src/integrations/composio.ts) lo lee y lo
  // inyecta al LLM en el system prompt para que use el recurso correcto sin
  // adivinar.
  composioContext: "composio_context",
  // White-label del panel (Modo Agencia): logo self-hosted. El skill /whitelabel
  // guarda aquí el logo optimizado como data-URI (data:image/…;base64,…) y pone
  // BRAND_LOGO_URL="/brand/logo" en el wrangler.toml. Lo sirve la ruta pública
  // GET /brand/logo. Así el miembro NO necesita hosting externo para su logo.
  // Alternativa: BRAND_LOGO_URL con una URL https propia (no usa esta setting).
  brandLogo: "brand_logo",
  // White-label — estilo del panel EN CALIENTE (nimbus|onyx|terra; vacío = tema
  // Forja). Es la versión "setting" de la env BRAND_STYLE: `applyBranding` (en el
  // middleware, junto a applyTier/applyLanguage) lo lee y pisa la env, así se
  // cambia sin redeploy — desde el panel del bot o desde el control plane
  // (POST /api/settings). Ver src/admin/branding.ts.
  brandStyle: "brand_style",
  // ── Forja Inbox móvil (Wiring v2) ─────────────────────────────────────────
  // Respuestas rápidas del composer: JSON [{label, text}], máx ~20. Ver
  // GET/PUT /api/quick-replies en api-inbox.ts.
  quickReplies: "quick_replies",
  // Horario estructurado: JSON {days:{lun:{from,to}|null,...7 días}, awayMessage}.
  // NO reemplaza el texto libre de horarios que ya viviera en business_context /
  // member/config.local — settings-loader.ts lo AGREGA con precedencia de
  // lectura, nunca lo borra. Ver GET/PUT /api/hours.
  businessHours: "business_hours",
  // Preguntas frecuentes (Forja Inbox móvil). Ver src/faqs.ts + GET/PUT /api/faqs.
  faqs: "faqs",
  // Datos universales editables desde la app (src/businessInfo.ts). Se inyectan
  // al business_context como fuente de verdad, fail-open, igual que hours/faqs.
  promo: "promo", // oferta vigente con on/off + vencimiento. GET/PUT /api/promo.
  location: "location", // ubicación y cobertura. GET/PUT /api/location.
  paymentMethods: "payment_methods", // formas de pago. GET/PUT /api/payment-methods.
  catalog: "catalog", // servicios y precios (lista corta). GET/PUT /api/catalog.
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

interface SettingRow {
  key: string;
  value: string;
}

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.first<SettingRow>(
      "SELECT value FROM settings WHERE key = ?",
      [key],
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, Date.now()],
    );
  }

  async all(): Promise<Record<string, string>> {
    // media_blob:* son data-URIs de la Galería (hasta ~1.7MB c/u) — se quedan
    // fuera: all() corre en CADA turno y arrastrarlos multiplicaría el costo de
    // cada mensaje. Solo GET /media/:id los lee, uno a la vez, con get().
    // report_last_% es el mismo problema: el HTML del último reporte pesa
    // decenas de KB y nadie lo necesita en el turno del cliente — lo leen
    // /admin/report y GET /api/report/latest, con get().
    const rows = await this.db.all<SettingRow>(
      "SELECT key, value FROM settings WHERE key NOT LIKE 'media_blob:%' AND key NOT LIKE 'report_last_%'",
    );
    const out: Record<string, string> = {};
    for (const row of rows) {
      out[row.key] = row.value;
    }
    return out;
  }
}

const DEFAULT_TAKEOVER_MIN = 60;
export const MANUAL_RESUME_MS = 365 * 24 * 60 * 60 * 1000; // "hasta reactivar" (pausa ≈ 1 año)

/**
 * Cuánto se queda callado el bot tras una intervención del dueño (setting
 * `takeoverMinutes`: vacío = 60 min, 0 = hasta que el dueño reactive). Lo
 * comparten el panel (reply/pause) y el handler de COEXISTENCIA de Kapso y
 * YCloud — cuando el dueño responde a un cliente desde su app de WhatsApp
 * Business, el bot pausa esa conversación exactamente igual que un takeover del panel.
 * (admin/routes.ts mantiene una copia local histórica de esta misma lógica.)
 */
export async function resolveTakeoverMs(env: Env): Promise<number> {
  const raw = ((await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.takeoverMinutes)) ?? "").trim();
  const min = raw === "" ? DEFAULT_TAKEOVER_MIN : parseInt(raw, 10);
  if (!Number.isFinite(min)) return DEFAULT_TAKEOVER_MIN * 60_000;
  return min <= 0 ? MANUAL_RESUME_MS : min * 60_000;
}
