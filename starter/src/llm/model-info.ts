/**
 * Bloque `model` del Centro de Mantenimiento (CONTRACT-AGENCY-MODELS §1).
 *
 * Modo Agencia: el revendedor ve el MODELO REAL que usa cada bot (Claude/Grok/
 * GPT/Gemini) + su costo, y puede cambiar de proveedor. Reusa `createModel`
 * (resuelve provider+modelo desde llm_provider/llm_model/BYO o el default del
 * env) y `src/pricing.ts` — sin inventar precios.
 *
 * `providerReady` es la fuente ÚNICA de "¿hay llave para este proveedor?": la
 * usan el picker (available_providers) del GET y el gate 409 del PATCH, para que
 * no se desincronicen.
 */
import type { Env } from "../env";
import { SETTING_KEYS } from "../db/settings";
import {
  createModel,
  envKeyFor,
  modelIdFor,
  CURATED_MODELS,
  type LlmProvider,
} from "./provider";
import { llmOverridesFrom, normalizeModelOverride, type ModelOverride } from "../settings-loader";
import { ratesFor } from "../pricing";
import type { Tier } from "../upgrade/modelSelector";

/** Proveedores reales que este bot puede correr (los que provider.ts soporta). */
export const PROVIDERS: readonly LlmProvider[] = ["anthropic", "openai", "xai", "google"];

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai: "GPT (OpenAI)",
  xai: "Grok (xAI)",
  google: "Gemini (Google)",
};

export interface AvailableProvider {
  id: LlmProvider;
  label: string;
  ready: boolean;
  cost_per_mtok: { in: number; out: number } | null;
}

export interface ModelBlock {
  provider: LlmProvider;
  provider_label: string;
  model_id: string;
  model_label: string;
  source: "forja" | "byo";
  tier: ModelOverride; // model_override actual (Equilibrado/Máximo/Económico)
  cost_per_mtok: { in: number; out: number } | null;
  month_usd: number;
  available_providers: AvailableProvider[];
}

/** Proveedor al que pertenece una API key BYO, por su prefijo (mismo criterio
 *  que createModel). null = prefijo no reconocido. */
export function providerOfKey(key: string): LlmProvider | null {
  const k = key.trim();
  if (/^sk-ant-/i.test(k)) return "anthropic";
  if (/^xai-/i.test(k)) return "xai";
  if (/^AIza/.test(k)) return "google";
  if (/^sk-/i.test(k)) return "openai";
  return null;
}

/** El proveedor de la llave propia del dueño (BYO), si la hay y se reconoce:
 *  el llm_provider elegido manda; si no, se deduce por el prefijo de la key. */
function byoProviderOf(all: Record<string, string>): LlmProvider | null {
  const key = (all[SETTING_KEYS.llmApiKey] ?? "").trim();
  if (!key) return null;
  const explicit = (all[SETTING_KEYS.llmProvider] ?? "").trim().toLowerCase();
  if ((PROVIDERS as readonly string[]).includes(explicit)) return explicit as LlmProvider;
  return providerOfKey(key);
}

/**
 * ¿Hay una llave usable para este proveedor? = un secret del env (llave del
 * SISTEMA / Forja) para ese proveedor, o la llave BYO del dueño si es de ese
 * proveedor. Es lo que decide si cambiar a él es un setting o queda gateado.
 */
export function providerReady(env: Env, all: Record<string, string>, provider: LlmProvider): boolean {
  if (envKeyFor(env, provider)) return true;
  return byoProviderOf(all) === provider;
}

/** Nombre bonito de un modelo: el `nombre` curado si lo conocemos, si no el id. */
function modelLabelOf(modelId: string): string {
  return CURATED_MODELS.find((m) => m.id === modelId)?.nombre ?? modelId;
}

/**
 * Arma el bloque `model` para GET /api/maintenance. `monthUsd` viaja ya
 * calculado (mismo número que budget.month_usd) para no pegarle dos veces a D1.
 *
 * El modelo efectivo se resuelve al tier que corresponde al cerebro elegido:
 * Económico→fast, Equilibrado/Máximo→smart. En "auto" el bot escala por turno;
 * mostramos el modelo inteligente (el techo real de capacidad/costo, como en el
 * ejemplo del contrato) y el nivel "auto" viaja aparte en `tier`.
 */
export function describeModel(env: Env, all: Record<string, string>, monthUsd: number): ModelBlock {
  const tier: ModelOverride = normalizeModelOverride(all[SETTING_KEYS.modelOverride]);
  const displayTier: Tier = tier === "haiku" ? "fast" : "smart";
  const overrides = llmOverridesFrom(all);

  const resolved = createModel(env, displayTier, overrides);
  const source: "forja" | "byo" = overrides.apiKey ? "byo" : "forja";

  const available: AvailableProvider[] = PROVIDERS.map((p) => ({
    id: p,
    label: PROVIDER_LABELS[p],
    ready: providerReady(env, all, p),
    // Costo del modelo que ESE proveedor usaría al tier actual (para comparar).
    cost_per_mtok: ratesFor(modelIdFor(env, p, displayTier)),
  }));

  return {
    provider: resolved.provider,
    provider_label: PROVIDER_LABELS[resolved.provider],
    model_id: resolved.modelId,
    model_label: modelLabelOf(resolved.modelId),
    source,
    tier,
    cost_per_mtok: ratesFor(resolved.modelId),
    month_usd: monthUsd,
    available_providers: available,
  };
}
