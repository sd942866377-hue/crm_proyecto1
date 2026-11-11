import type { Env } from "./env";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";
import { systemPromptFromEnv } from "./system-prompt";
import { descripcionIdioma, ESPEJO } from "./idioma";
import { renderBusinessContext, renderBusinessHoursBlock, type BusinessHours } from "./businessContext";
import { renderFaqsBlock, sanitizeFaqs } from "./faqs";
import {
  sanitizePromo,
  renderPromoBlock,
  sanitizeLocation,
  renderLocationBlock,
  sanitizePaymentMethods,
  renderPaymentMethodsBlock,
  sanitizeCatalog,
  renderCatalogBlock,
} from "./businessInfo";
import { getBufferMs, isPro } from "./config";
import { getNiche } from "./niches";
import type { LlmOverrides } from "./llm/provider";

export type ModelOverride = "auto" | "haiku" | "sonnet";

/**
 * Tope de gasto de IA mensual por default (USD). Protege la llave del miembro
 * no-técnico desde el día uno (un bot en loop no la quema sin freno). El dueño
 * lo sube desde la tab Costos, o lo apaga poniendo "0" (= sin tope, bajo su
 * responsabilidad). El corte duro (2× el tope) es la red de seguridad final.
 * Lo comparten el agente y GET /api/cost — un solo número, no dos.
 */
export const DEFAULT_MONTHLY_BUDGET_USD = 25;

export interface AgentConfig {
  systemPrompt: string;
  bufferMs: number;
  maxChunks: number;
  interChunkDelayMs: number;
  modelOverride: ModelOverride;
  botPaused: boolean;
  /** Tool names still enabled after applying the dashboard's disabled_tools. */
  enabledToolNames: string[];
  /** Sampling temperature (0-1). undefined = use the provider default. */
  temperature?: number;
  /** Monthly AI budget (USD). undefined = no cap. */
  monthlyBudgetUsd?: number;
  /** BYO-LLM del dashboard (proveedor / API key / modelo). */
  llm: LlmOverrides;
  /** Info oficial del negocio (settings o member/config.local) — la fuente de
   *  verdad que usa el Blindaje anti-invento además de los pasajes de KB. */
  businessContext: string;
  /** Blindaje anti-invento activo: Pro Y no apagado (blindaje_enabled≠"off"). */
  blindajeEnabled: boolean;
  /** Rigor del Blindaje desde settings D1 (blindaje_mode); undefined → env decide. */
  blindajeMode?: "full" | "negaciones" | "off";
  /** Bóveda activa: Pro Y encendida (boveda_enabled="on", opt-in default off). */
  bovedaEnabled: boolean;
}

/** Extract the BYO-LLM overrides from a settings snapshot. */
export function llmOverridesFrom(settings: Record<string, string>): LlmOverrides {
  const pick = (key: string): string | undefined => {
    const v = settings[key];
    return v !== undefined && v.trim() !== "" ? v.trim() : undefined;
  };
  return {
    provider: pick(SETTING_KEYS.llmProvider),
    apiKey: pick(SETTING_KEYS.llmApiKey),
    model: pick(SETTING_KEYS.llmModel),
  };
}

/** Load just the BYO-LLM overrides (para analyzer/flywheel/admin, fuera del agente).
 *  Nunca truena: si settings no está disponible, se usan los defaults del env. */
export async function loadLlmOverrides(env: Env): Promise<LlmOverrides> {
  try {
    const settings = await new SettingsRepo(new Db(env.DB)).all();
    return llmOverridesFrom(settings);
  } catch {
    return {};
  }
}

/**
 * El system prompt override EFECTIVO para un canal, si lo hay.
 *
 * Precedencia: MODO BOOST (persona ":boost", manda sobre todo cuando
 * boost_mode="on") → override del canal → override global. Vive aparte porque
 * no solo lo necesita resolveAgentConfig: cuando hay override, el prompt
 * GENERADO no se usa — y con él se van las lecciones aprendidas y las
 * instrucciones del dueño. Quien enseñe algo al bot tiene que poder avisarlo.
 */
export function resolvePromptOverride(
  settings: Record<string, string>,
  channel?: string,
): string | undefined {
  const get = (key: string): string | undefined => {
    const v = settings[key];
    return v !== undefined && v.trim() !== "" ? v : undefined;
  };
  const boost =
    get(SETTING_KEYS.boostMode) === "on"
      ? get(`${SETTING_KEYS.systemPromptOverride}:boost`)
      : undefined;
  return (
    boost ??
    (channel ? get(`${SETTING_KEYS.systemPromptOverride}:${channel}`) : undefined) ??
    get(SETTING_KEYS.systemPromptOverride)
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Ausente/basura = "auto": el cerebro del bot nunca queda en un valor inventado.
 *  Lo comparte GET /api/maintenance para no tener dos defaults distintos. */
export function normalizeModelOverride(value: string | undefined): ModelOverride {
  if (value === "haiku" || value === "sonnet" || value === "auto") return value;
  return "auto";
}

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the effective agent config by overlaying D1 `settings` on top of env
 * defaults. Anything empty/absent in settings falls back to the env/default.
 */
export async function resolveAgentConfig(
  env: Env,
  toolNames: string[],
  channel?: string,
): Promise<AgentConfig> {
  const repo = new SettingsRepo(new Db(env.DB));
  const settings = await repo.all();

  const get = (key: string): string | undefined => {
    const v = settings[key];
    return v !== undefined && v.trim() !== "" ? v : undefined;
  };

  // Niche pack activo (BOT_NICHE). Aporta el playbook del giro y un tono por
  // defecto; ambos se pueden sobreescribir desde el panel.
  const niche = getNiche(env);

  // Override por CANAL primero (key "system_prompt_override:<canal>", ej.
  // ":twilio" = WhatsApp) y si no existe, el override global. Así cada canal
  // puede tener su propia persona sin tocar la de los demás.
  // MODO BOOST (switch del dashboard): cuando boost_mode="on", la persona
  // ":boost" manda sobre TODO (canal y global). Un click para enfocar el bot
  // en un evento (ej. día de la masterclass) y otro para revertir.
  const systemPromptOverride = resolvePromptOverride(settings, channel);
  const businessContextBase = get(SETTING_KEYS.businessContext) ?? renderBusinessContext();
  // Horario estructurado (Forja Inbox móvil, setting `business_hours`): se
  // AGREGA al final del texto existente, nunca lo reemplaza (regla: no
  // destruir config del dueño) — la línea agregada se anuncia como fuente de
  // verdad para horarios si contradice lo de arriba. JSON malformado se
  // ignora en silencio (fail-open: el prompt sigue con el texto de siempre).
  let businessContext = businessContextBase;
  const hoursRaw = get(SETTING_KEYS.businessHours);
  if (hoursRaw) {
    try {
      const parsed = JSON.parse(hoursRaw) as Partial<BusinessHours>;
      if (parsed && typeof parsed === "object" && (parsed.days || parsed.mode || parsed.services)) {
        const rendered = renderBusinessHoursBlock(parsed as BusinessHours);
        if (rendered) businessContext = `${businessContextBase}\n\n${rendered}`;
      }
    } catch { /* malformed setting — ignore, keep the text as-is */ }
  }
  // Preguntas frecuentes (setting `faqs`): se agregan AL FINAL, como el horario.
  const faqsRaw = get(SETTING_KEYS.faqs);
  if (faqsRaw) {
    try {
      const rendered = renderFaqsBlock(sanitizeFaqs(JSON.parse(faqsRaw)));
      if (rendered) businessContext = `${businessContext}\n\n${rendered}`;
    } catch { /* malformed — ignore */ }
  }
  // Datos universales editables desde la app (src/businessInfo.ts): oferta vigente,
  // ubicación, formas de pago y servicios/precios. Cada uno se AGREGA al final como
  // fuente de verdad, fail-open (JSON malformado se ignora), vacío = sin cambio.
  const appendInfo = (key: string, toBlock: (parsed: unknown) => string): void => {
    const raw = get(key);
    if (!raw) return;
    try {
      const block = toBlock(JSON.parse(raw));
      if (block) businessContext = `${businessContext}\n\n${block}`;
    } catch { /* malformed — ignore */ }
  };
  appendInfo(SETTING_KEYS.promo, (p) => renderPromoBlock(sanitizePromo(p)));
  appendInfo(SETTING_KEYS.location, (p) => renderLocationBlock(sanitizeLocation(p)));
  appendInfo(SETTING_KEYS.paymentMethods, (p) => renderPaymentMethodsBlock(sanitizePaymentMethods(p)));
  appendInfo(SETTING_KEYS.catalog, (p) => renderCatalogBlock(sanitizeCatalog(p)));
  const botName = get(SETTING_KEYS.botName) ?? env.BOT_NAME;
  // Tono elegido en el panel gana; si no hay, el tono por defecto del nicho.
  const tone = get(SETTING_KEYS.tone) ?? (niche.defaultTone || undefined);
  // Voz de marca (superpoder Pro /voz-de-marca): guía de estilo completa. Solo
  // aplica en Pro; se lee en vivo desde D1 (cambia sin redeploy).
  const brandVoice = isPro(env) ? get(SETTING_KEYS.brandVoice) : undefined;
  // Instrucciones adicionales del dueño (modo guiado, ADITIVAS): reglas de
  // comportamiento que se SUMAN al prompt generado sin reemplazarlo. Per-canal
  // (como el override) y luego global. NO es Pro-gated — dar reglas es gratis.
  // Solo aplica al prompt GENERADO: un system_prompt_override lo reemplaza todo.
  const customInstructions =
    (channel ? get(`${SETTING_KEYS.customInstructions}:${channel}`) : undefined) ??
    get(SETTING_KEYS.customInstructions);
  const escalationKeywords = parseCsvList(get(SETTING_KEYS.escalationKeywords));

  // Flywheel lessons (JSON array). Only injected into the GENERATED prompt —
  // a manual override replaces the whole prompt, lessons included.
  let lessons: string[] = [];
  try {
    const parsed = JSON.parse(get(SETTING_KEYS.learnedLessons) ?? "[]");
    if (Array.isArray(parsed)) lessons = parsed.filter((l) => typeof l === "string");
  } catch { /* malformed setting — ignore */ }

  // Dashboard tool toggles: the prompt only advertises the enabled tools, so
  // the model never tries to call something that was turned off. A tool
  // disabled GLOBALLY or just for THIS channel (key "disabled_tools:<canal>")
  // is disabled — union of both sets, deduped.
  const disabledToolsGlobal = parseCsvList(get(SETTING_KEYS.disabledTools));
  const disabledToolsChannel = channel
    ? parseCsvList(get(`${SETTING_KEYS.disabledTools}:${channel}`))
    : [];
  const disabledTools = [...new Set([...disabledToolsGlobal, ...disabledToolsChannel])];
  const enabledToolNames = toolNames.filter((n) => !disabledTools.includes(n));

  // "Espeja el idioma del cliente": es una OPCIÓN del selector de idioma, no un
  // interruptor aparte — así el dueño tiene un solo control y no dos que se
  // contradigan. Se acepta el multi_language viejo por compatibilidad con
  // quienes ya lo tenían encendido. Sigue siendo Pro: elegir idioma es gratis,
  // espejarlo no.
  const multiLanguage =
    isPro(env) &&
    (get(SETTING_KEYS.botLanguage) === "espejo" || get(SETTING_KEYS.multiLanguage) === "1");

  // Idioma BASE de respuesta que el dueño eligió en la app (setting bot_language).
  // Es GRATIS (a diferencia de "espejo"/mirror, que es Pro). Antes se ignoraba: el
  // idioma base salía de env.BOT_LANGUAGE (deploy-time) y elegir otro en la app NO
  // surtía efecto. "espejo" no es un idioma → no cuenta como base (cae al env).
  const rawLang = get(SETTING_KEYS.botLanguage);
  const baseLanguage = rawLang && rawLang !== ESPEJO ? descripcionIdioma(rawLang) : undefined;

  // Moneda con la que el bot habla de precios. Gratis: un negocio en España
  // necesita € desde el primer día, no cuando pague.
  const currency = get(SETTING_KEYS.botCurrency) || undefined;

  // Blindaje anti-invento (Pro): ON por default; el dueño lo apaga con
  // blindaje_enabled="off" (D1/panel) si el verificador le bloquea respuestas
  // legítimas — sin necesidad de redeploy.
  // Rigor del Blindaje desde D1 (blindaje_mode) — override caliente del env
  // BLINDAJE_MODE, para bajarlo a "negaciones" (o apagarlo) sin redeploy.
  const blindajeModeRaw = get(SETTING_KEYS.blindajeMode);
  const blindajeMode =
    blindajeModeRaw === "full" || blindajeModeRaw === "negaciones" || blindajeModeRaw === "off"
      ? blindajeModeRaw
      : undefined;
  const blindajeEnabled =
    isPro(env) && get(SETTING_KEYS.blindajeEnabled) !== "off" && blindajeMode !== "off";
  // Opt-in (default OFF): la GALERÍA de la Bóveda en el panel solo se muestra
  // si el dueño la prendió (toggle "1"/"0" como los demás superpoderes) Y es
  // Pro. OJO: la CAPTURA de archivos a R2 ya NO depende de este flag — el hilo
  // del inbox móvil necesita el archivo aunque la Bóveda esté apagada, así que
  // el opt-in de facto es tener el binding MEDIA (ver media/boveda.ts).
  const bovedaEnabled = isPro(env) && get(SETTING_KEYS.bovedaEnabled) === "1";

  // Botones tocables (opt-in, default OFF — skill /botones lo prende).
  const buttonsEnabled = get(SETTING_KEYS.buttonsEnabled) === "1";

  // Galería (superpoder Pro, opt-in default OFF — skill /galeria): fotos/audios
  // que el bot puede mandar. Solo entra al prompt si hay assets subidos.
  const { listMediaAssets } = await import("./media-assets");
  const galeriaAssets =
    isPro(env) && get(SETTING_KEYS.galeriaEnabled) === "1" ? listMediaAssets(settings) : [];

  const systemPrompt =
    systemPromptOverride ??
    systemPromptFromEnv(env, enabledToolNames, businessContext, niche.playbook || undefined, {
      tone,
      brandVoice,
      customInstructions,
      extraEscalationKeywords: escalationKeywords,
      botName,
      lessons,
      multiLanguage,
      language: baseLanguage,
      currency,
      buttonsEnabled,
      galeriaAssets,
    });

  const bufferSecondsRaw = get(SETTING_KEYS.bufferSeconds);
  const bufferMs =
    bufferSecondsRaw !== undefined
      ? Math.max(1000, parseIntOr(bufferSecondsRaw, 1) * 1000)
      : getBufferMs(env);

  const maxChunks = clamp(parseIntOr(get(SETTING_KEYS.maxChunks), 3), 1, 5);
  const interChunkDelayMs = clamp(parseIntOr(get(SETTING_KEYS.interChunkDelayMs), 1000), 0, 5000);
  const modelOverride = normalizeModelOverride(get(SETTING_KEYS.modelOverride));
  // Pausado = switch manual O pausa temporal vigente (bot_paused_until, epoch ms).
  const pausedUntilMs = parseIntOr(get(SETTING_KEYS.botPausedUntil), 0);
  const botPaused = get(SETTING_KEYS.botPaused) === "1" || (pausedUntilMs > 0 && Date.now() < pausedUntilMs);

  const tempRaw = get(SETTING_KEYS.temperature);
  let temperature: number | undefined;
  if (tempRaw !== undefined) {
    const t = Number.parseFloat(tempRaw);
    if (!Number.isNaN(t)) temperature = clamp(t, 0, 1);
  }

  // Tope de gasto de IA mensual (ver DEFAULT_MONTHLY_BUDGET_USD arriba).
  const budgetRaw = get(SETTING_KEYS.monthlyBudget);
  let monthlyBudgetUsd: number | undefined = DEFAULT_MONTHLY_BUDGET_USD;
  if (budgetRaw !== undefined && budgetRaw.trim() !== "") {
    const b = Number.parseFloat(budgetRaw);
    if (!Number.isNaN(b)) monthlyBudgetUsd = b > 0 ? b : undefined; // "0" = sin tope explícito
  }

  return {
    systemPrompt,
    bufferMs,
    maxChunks,
    interChunkDelayMs,
    modelOverride,
    botPaused,
    blindajeEnabled,
    blindajeMode,
    bovedaEnabled,
    enabledToolNames,
    temperature,
    monthlyBudgetUsd,
    llm: llmOverridesFrom(settings),
    businessContext,
  };
}
