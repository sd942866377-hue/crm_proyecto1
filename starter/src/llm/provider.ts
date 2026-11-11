import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { Env } from "../env";
import type { Tier } from "../upgrade/modelSelector";

/**
 * LLM provider abstraction.
 *
 * The bot's chat brain can run on Anthropic (default) or OpenAI. Model selection
 * is decoupled into TIERS ("fast" = cheap default, "smart" = upgrade); each
 * provider maps a tier to a concrete model id (env-overridable). Embeddings and
 * voice transcription stay on Cloudflare Workers AI regardless of this setting.
 */
export type LlmProvider = "anthropic" | "openai" | "xai" | "google";

const ANTHROPIC_DEFAULTS: Record<Tier, string> = {
  fast: "claude-haiku-4-5-20251001",
  smart: "claude-sonnet-5",
};

const OPENAI_DEFAULTS: Record<Tier, string> = {
  fast: "gpt-4o-mini",
  smart: "gpt-4o",
};

const XAI_DEFAULTS: Record<Tier, string> = {
  fast: "grok-4-fast-non-reasoning",
  smart: "grok-4",
};

const GOOGLE_DEFAULTS: Record<Tier, string> = {
  fast: "gemini-2.5-flash",
  smart: "gemini-2.5-pro",
};

/**
 * Owner overrides from the dashboard (D1 `settings`): provider, BYO API key
 * and/or a concrete model id. Anything empty falls back to env behavior.
 * Load with `loadLlmOverrides()` (settings-loader) and pass to createModel.
 */
export interface LlmOverrides {
  provider?: string;
  apiKey?: string;
  model?: string;
}

/** Models offered in the dashboard picker. */
// El nombre del modelo NUNCA se traduce; el descriptor sí. Por eso van
// separados: `label` mezclaba ambos y no se podía localizar sin romper el
// nombre del producto.
export const CURATED_MODELS: { id: string; nombre: string; desc: string; provider: LlmProvider }[] = [
  { id: "claude-haiku-4-5-20251001", nombre: "Claude Haiku 4.5", desc: "modeloDesc.rapidoBarato", provider: "anthropic" },
  { id: "claude-sonnet-5", nombre: "Claude Sonnet 5", desc: "modeloDesc.mejorEquilibrio", provider: "anthropic" },
  { id: "claude-sonnet-4-6", nombre: "Claude Sonnet 4.6", desc: "modeloDesc.equilibrado", provider: "anthropic" },
  { id: "claude-sonnet-4-5-20250929", nombre: "Claude Sonnet 4.5", desc: "modeloDesc.equilibrado", provider: "anthropic" },
  { id: "claude-opus-5", nombre: "Claude Opus 5", desc: "modeloDesc.maxInteligencia", provider: "anthropic" },
  { id: "claude-opus-4-6", nombre: "Claude Opus 4.6", desc: "modeloDesc.masCapaz", provider: "anthropic" },
  { id: "gpt-4o-mini", nombre: "GPT-4o mini", desc: "modeloDesc.rapidoBarato", provider: "openai" },
  { id: "gpt-4o", nombre: "GPT-4o", desc: "modeloDesc.equilibrado", provider: "openai" },
  { id: "gpt-4.1-mini", nombre: "GPT-4.1 mini", desc: "modeloDesc.rapido", provider: "openai" },
  { id: "gpt-4.1", nombre: "GPT-4.1", desc: "modeloDesc.masCapaz", provider: "openai" },
  { id: "grok-4-fast-non-reasoning", nombre: "Grok 4 Fast", desc: "modeloDesc.rapidoBarato", provider: "xai" },
  { id: "grok-3-mini", nombre: "Grok 3 mini", desc: "modeloDesc.economico", provider: "xai" },
  { id: "grok-4", nombre: "Grok 4", desc: "modeloDesc.masCapaz", provider: "xai" },
  { id: "gemini-2.5-flash-lite", nombre: "Gemini 2.5 Flash-Lite", desc: "modeloDesc.masRapidoBarato", provider: "google" },
  { id: "gemini-2.5-flash", nombre: "Gemini 2.5 Flash", desc: "modeloDesc.equilibradoEconomico", provider: "google" },
  { id: "gemini-2.5-pro", nombre: "Gemini 2.5 Pro", desc: "modeloDesc.maxInteligencia", provider: "google" },
];

/**
 * Decide which provider to use. Explicit LLM_PROVIDER wins; otherwise, if only
 * an OpenAI key is set, use OpenAI; default to Anthropic.
 */
export function resolveProvider(env: Env): LlmProvider {
  const explicit = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "anthropic") return "anthropic";
  // BUG FIX 2026-07-12: faltaba la rama xai — LLM_PROVIDER="xai" caía al
  // default (anthropic), dejando a Grok como mero fallback todo el tiempo.
  if (explicit === "xai") return "xai";
  if (explicit === "google") return "google";
  if (!env.ANTHROPIC_API_KEY && env.OPENAI_API_KEY) return "openai";
  return "anthropic";
}

/** Resolve the concrete model id for a provider + tier (env-overridable). */
export function modelIdFor(env: Env, provider: LlmProvider, tier: Tier): string {
  if (provider === "openai") {
    const smart = env.OPENAI_MODEL_SMART?.trim() || OPENAI_DEFAULTS.smart;
    const fast = env.OPENAI_MODEL_FAST?.trim() || OPENAI_DEFAULTS.fast;
    return tier === "smart" ? smart : fast;
  }
  if (provider === "xai") {
    return tier === "smart" ? XAI_DEFAULTS.smart : XAI_DEFAULTS.fast;
  }
  if (provider === "google") {
    const smart = env.GOOGLE_MODEL_SMART?.trim() || GOOGLE_DEFAULTS.smart;
    const fast = env.GOOGLE_MODEL_FAST?.trim() || GOOGLE_DEFAULTS.fast;
    return tier === "smart" ? smart : fast;
  }
  const smart = env.ANTHROPIC_MODEL_SMART?.trim() || ANTHROPIC_DEFAULTS.smart;
  const fast = env.ANTHROPIC_MODEL_FAST?.trim() || ANTHROPIC_DEFAULTS.fast;
  return tier === "smart" ? smart : fast;
}

export interface ResolvedModel {
  provider: LlmProvider;
  modelId: string;
  /** AI SDK LanguageModel instance, ready to pass to streamText/generateText. */
  model: any;
  /** Only Anthropic supports the ephemeral prompt-cache breakpoint we use. */
  supportsPromptCache: boolean;
}

/** env API key for a provider (la del SISTEMA, no la BYO del dueño). */
export function envKeyFor(env: Env, provider: LlmProvider): string | undefined {
  if (provider === "openai") return env.OPENAI_API_KEY;
  if (provider === "xai") return env.XAI_API_KEY;
  if (provider === "google") return env.GOOGLE_API_KEY;
  return env.ANTHROPIC_API_KEY;
}

/** ¿Hay ALGUNA llave de IA usable? — la BYO del dueño (setting llm_api_key) o una
 *  del sistema (env). Sin esto, los paneles que dependen de IA (Insights, Mejoras)
 *  no pueden analizar; se usa para mostrarles el empty-state correcto. */
export function hasLlmKey(env: Env, byoKey?: string): boolean {
  if ((byoKey ?? "").trim() !== "") return true;
  return Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.XAI_API_KEY || env.GOOGLE_API_KEY);
}

/**
 * Build the AI SDK model for the given tier. Dashboard overrides (BYO key /
 * provider / concrete model) win over env. Si el dueño eligió un proveedor
 * para el que no hay NINGUNA llave (ni suya ni del sistema), caemos al default
 * del env — el bot nunca se queda mudo por una config incompleta.
 */
export function createModel(env: Env, tier: Tier, ov?: LlmOverrides): ResolvedModel {
  const ovModel = (ov?.model ?? "").trim();
  const ovKey = (ov?.apiKey ?? "").trim();
  const ovProviderRaw = (ov?.provider ?? "").trim().toLowerCase();

  let provider: LlmProvider | null =
    ovProviderRaw === "anthropic" ||
    ovProviderRaw === "openai" ||
    ovProviderRaw === "xai" ||
    ovProviderRaw === "google"
      ? ovProviderRaw
      : null;
  // Modelo elegido sin proveedor explícito → dedúcelo del id.
  if (!provider && ovModel) {
    provider = /^grok/i.test(ovModel)
      ? "xai"
      : /^gemini/i.test(ovModel)
        ? "google"
        : /^(gpt|o\d)/i.test(ovModel)
          ? "openai"
          : "anthropic";
  }
  // Proveedor "Automático" + key BYO → dedúcelo del PREFIJO de la key. Sin esto,
  // pegar una key de OpenAI/xAI/Google en Automático la probaba contra Anthropic
  // (el default del sistema) y devolvía "API key is invalid" aunque fuera válida.
  if (!provider && ovKey) {
    provider = /^sk-ant-/i.test(ovKey)
      ? "anthropic"
      : /^xai-/i.test(ovKey)
        ? "xai"
        : /^AIza/.test(ovKey)
          ? "google"
          : /^sk-/i.test(ovKey)
            ? "openai"
            : null;
  }
  if (!provider) provider = resolveProvider(env);

  let apiKey = ovKey || envKeyFor(env, provider);
  let useOvModel = ovModel;
  if (!apiKey) {
    console.warn(`[llm] no API key for provider "${provider}" — falling back to env default`);
    provider = resolveProvider(env);
    apiKey = envKeyFor(env, provider);
    useOvModel = ""; // el modelo elegido era del proveedor sin llave — no aplica
  }

  const modelId = useOvModel || modelIdFor(env, provider, tier);

  if (provider === "openai") {
    const openai = createOpenAI({ apiKey });
    return { provider, modelId, model: openai(modelId), supportsPromptCache: false };
  }

  if (provider === "xai") {
    const xai = createXai({ apiKey });
    return { provider, modelId, model: xai(modelId), supportsPromptCache: false };
  }

  if (provider === "google") {
    const google = createGoogleGenerativeAI({ apiKey });
    return { provider, modelId, model: google(modelId), supportsPromptCache: false };
  }

  // ANTHROPIC_BASE_URL (opcional): ruta alterna hacia el API de Anthropic.
  // Existe para el 403 {"forbidden","Request not allowed"} — el edge de
  // Cloudflare que protege api.anthropic.com puede rechazar subrequests de un
  // Worker cuando hereda un origen de mala reputación o región bloqueada (p.ej.
  // webhooks que llegan desde Asia). Apuntarla a un AI Gateway del propio
  // Cloudflare del miembro lo resuelve; el SDK le anexa "/messages".
  const baseURL = (env.ANTHROPIC_BASE_URL ?? "").trim() || undefined;
  const anthropic = createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  return { provider, modelId, model: anthropic(modelId), supportsPromptCache: true };
}

/**
 * Modelos de Anthropic (Opus 4.7 en adelante, y toda la generación 5) que
 * RECHAZAN sampling params con 400. En ellos la temperatura del dashboard se
 * ignora en vez de tumbar cada respuesta del bot.
 */
export function modelAcceptsTemperature(modelId: string): boolean {
  return !/^claude-(opus-4-[78]|fable|mythos|[a-z]+-5(?:$|[.-]))/i.test(modelId);
}

/**
 * Plan B ante fallo del proveedor primario (rate limit, 5xx, red): el primer
 * proveedor DISTINTO al que falló que tenga API key en el env, con sus modelos
 * default del tier. null = no hay respaldo configurado.
 */
export function fallbackModel(
  env: Env,
  tier: Tier,
  failedProvider: LlmProvider,
): ResolvedModel | null {
  const order: LlmProvider[] = ["anthropic", "openai", "xai", "google"];
  for (const p of order) {
    if (p === failedProvider) continue;
    if (!envKeyFor(env, p)) continue;
    return createModel(env, tier, { provider: p });
  }
  return null;
}
