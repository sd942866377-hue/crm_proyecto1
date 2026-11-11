// USD per million tokens. Update when providers adjust pricing.
export const PRICING = {
  haiku: {
    input: 1.00, // Haiku 4.5 oficial: $1/MTok in, $5/MTok out (verificado ago-2026, platform.claude.com/pricing)
    cacheRead: 0.10, // 0.1× input (cache read Anthropic)
    output: 5.00,
  },
  sonnet: {
    input: 3.00,
    cacheRead: 0.30,
    output: 15.00,
  },
  // OpenAI alternative (defaults mapped in src/llm/provider.ts).
  "gpt-4o-mini": {
    input: 0.15,
    cacheRead: 0.075,
    output: 0.60,
  },
  "gpt-4o": {
    input: 2.50,
    cacheRead: 1.25,
    output: 10.00,
  },
} as const;

interface Rates {
  input: number;
  cacheRead: number;
  output: number;
}

// Concrete model ids we price natively. Unknown ids fall back to the cheapest
// rate (Haiku) so cost logging never throws — it just under/over-estimates.
const RATES: Record<string, Rates> = {
  "claude-haiku-4-5-20251001": PRICING.haiku,
  "claude-sonnet-4-5-20250929": PRICING.sonnet,
  "gpt-4o-mini": PRICING["gpt-4o-mini"],
  "gpt-4o": PRICING["gpt-4o"],
  // BYO-LLM picker (dashboard "Modelo de IA")
  // Sonnet 5: sticker $3/$15 (intro $2/$10 hasta 2026-08-31 — cobramos sticker,
  // el sub-cobro de agosto es a favor del miembro). Opus 5: $5/$25.
  "claude-sonnet-5": PRICING.sonnet,
  "claude-opus-5": { input: 5.0, cacheRead: 0.5, output: 25.0 },
  "claude-sonnet-4-6": PRICING.sonnet,
  "claude-opus-4-6": { input: 5.0, cacheRead: 0.5, output: 25.0 },
  "gpt-4.1": { input: 2.0, cacheRead: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cacheRead: 0.1, output: 1.6 },
  "grok-4": { input: 3.0, cacheRead: 0.75, output: 15.0 },
  "grok-4-fast-non-reasoning": { input: 0.2, cacheRead: 0.05, output: 0.5 },
  "grok-3-mini": { input: 0.3, cacheRead: 0.075, output: 0.5 },
  // Gemini (Google) — input/output verificados contra ai.google.dev/pricing (ago-2026).
  // Pro es tier ≤200k tokens; >200k sube a 2.50/15.00 (no lo distinguimos aquí).
  "gemini-2.5-flash-lite": { input: 0.10, cacheRead: 0.01, output: 0.40 },
  "gemini-2.5-flash": { input: 0.30, cacheRead: 0.03, output: 2.50 },
  "gemini-2.5-pro": { input: 1.25, cacheRead: 0.125, output: 10.00 },
};

// Any concrete model id string (Anthropic or OpenAI). Kept as a string alias so
// env-overridden / custom models still type-check at call sites.
export type ModelId = string;

export interface Usage {
  /** Input TOTAL del turno: fresh + cacheCreation + cacheRead. Es lo que el AI
   *  SDK reporta como `usage.inputTokens` (inputTokens.total del provider
   *  anthropic = input_tokens + cache_creation + cache_read). */
  input: number;
  /** cache-READ (leer del caché) — 0.1× input. `inputTokenDetails.cacheReadTokens`. */
  cached: number;
  /** cache-WRITE / creation (escribir al caché la 1ª vez) — 1.25× input.
   *  `providerMetadata.anthropic.cacheCreationInputTokens`. Opcional: los callers
   *  viejos no lo pasan → 0 → el cálculo queda IDÉNTICO al anterior. */
  cacheCreation?: number;
  output: number;
}

export function costOfUsage(model: ModelId, usage: Usage): number {
  const rates = RATES[model] ?? PRICING.haiku;
  const creation = usage.cacheCreation ?? 0;
  // Cada balde a su tarifa: fresh (= total − read − creation) a 1×, cacheRead a
  // 0.1×, cacheCreation a 1.25× (caché efímera de Anthropic). En otros providers
  // creation llega en 0 (no aplicamos cacheControl ahí), así que el término se anula.
  const fresh = usage.input - usage.cached - creation;
  return (
    fresh * (rates.input / 1_000_000) +
    usage.cached * (rates.cacheRead / 1_000_000) +
    creation * ((rates.input * 1.25) / 1_000_000) +
    usage.output * (rates.output / 1_000_000)
  );
}

/**
 * Precio in/out por millón de tokens de un modelo, para MOSTRAR (no para cobrar).
 * A diferencia de costOfUsage, NO cae a Haiku: si el id no está en la tabla
 * devuelve null — el contrato de Mantenimiento pide `cost_per_mtok: null` cuando
 * no hay precio nativo, en vez de inventar uno. */
export function ratesFor(model: ModelId): { in: number; out: number } | null {
  const rates = RATES[model];
  return rates ? { in: rates.input, out: rates.output } : null;
}
