import { describe, it, expect, vi } from "vitest";

// Mock both providers so createModel returns predictable model objects without
// importing the real SDK client internals.
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ p: "anthropic", modelId }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (modelId: string) => ({ p: "openai", modelId }),
}));

import { resolveProvider, modelIdFor, createModel, modelAcceptsTemperature } from "../../src/llm/provider";
import type { Env } from "../../src/env";

function env(over: Partial<Env> = {}): Env {
  return { ANTHROPIC_API_KEY: "sk-ant", ...over } as Env;
}

describe("resolveProvider", () => {
  it("defaults to anthropic", () => {
    expect(resolveProvider(env())).toBe("anthropic");
  });
  it("honors LLM_PROVIDER=openai", () => {
    expect(resolveProvider(env({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-oa" }))).toBe("openai");
  });
  it("honors LLM_PROVIDER=anthropic even with an openai key present", () => {
    expect(resolveProvider(env({ LLM_PROVIDER: "anthropic", OPENAI_API_KEY: "sk-oa" }))).toBe("anthropic");
  });
  it("auto-selects openai when only the openai key is set", () => {
    expect(resolveProvider({ OPENAI_API_KEY: "sk-oa" } as Env)).toBe("openai");
  });
});

describe("modelIdFor", () => {
  it("anthropic tier defaults", () => {
    expect(modelIdFor(env(), "anthropic", "fast")).toBe("claude-haiku-4-5-20251001");
    expect(modelIdFor(env(), "anthropic", "smart")).toBe("claude-sonnet-5");
  });
  it("openai tier defaults", () => {
    expect(modelIdFor(env(), "openai", "fast")).toBe("gpt-4o-mini");
    expect(modelIdFor(env(), "openai", "smart")).toBe("gpt-4o");
  });
  it("env overrides win", () => {
    expect(modelIdFor(env({ OPENAI_MODEL_SMART: "gpt-5" }), "openai", "smart")).toBe("gpt-5");
    expect(modelIdFor(env({ ANTHROPIC_MODEL_FAST: "claude-x" }), "anthropic", "fast")).toBe("claude-x");
  });
});

describe("createModel", () => {
  it("anthropic supports prompt cache", () => {
    const r = createModel(env(), "fast");
    expect(r.provider).toBe("anthropic");
    expect(r.supportsPromptCache).toBe(true);
    expect(r.modelId).toBe("claude-haiku-4-5-20251001");
  });
  it("openai does NOT support prompt cache", () => {
    const r = createModel(env({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-oa" }), "smart");
    expect(r.provider).toBe("openai");
    expect(r.supportsPromptCache).toBe(false);
    expect(r.modelId).toBe("gpt-4o");
  });

  // Provider "Automático" + BYO key → dedúcelo del prefijo de la key, para que
  // pegar una key de OpenAI (sk-…) no se pruebe contra Anthropic y falle.
  describe("BYO key sin proveedor explícito → deducido del prefijo", () => {
    it("sk-ant- → anthropic", () => {
      const r = createModel(env(), "fast", { apiKey: "sk-ant-abc123" });
      expect(r.provider).toBe("anthropic");
    });
    it("sk- (OpenAI) → openai aunque haya key de anthropic en el env", () => {
      const r = createModel(env(), "fast", { apiKey: "sk-proj-xyz789" });
      expect(r.provider).toBe("openai");
      expect(r.modelId).toBe("gpt-4o-mini");
    });
    it("proveedor explícito gana sobre el prefijo de la key", () => {
      const r = createModel(env(), "fast", { provider: "anthropic", apiKey: "sk-proj-xyz" });
      expect(r.provider).toBe("anthropic");
    });
  });
});

describe("modelAcceptsTemperature", () => {
  it("gen 5 y Opus 4.7+ RECHAZAN temperature (se ignora la del dashboard)", () => {
    expect(modelAcceptsTemperature("claude-sonnet-5")).toBe(false);
    expect(modelAcceptsTemperature("claude-opus-5")).toBe(false);
    expect(modelAcceptsTemperature("claude-opus-4-7")).toBe(false);
    expect(modelAcceptsTemperature("claude-opus-4-8")).toBe(false);
    expect(modelAcceptsTemperature("claude-fable-5")).toBe(false);
  });
  it("modelos previos y otros proveedores sí la aceptan", () => {
    expect(modelAcceptsTemperature("claude-haiku-4-5-20251001")).toBe(true);
    expect(modelAcceptsTemperature("claude-sonnet-4-5-20250929")).toBe(true);
    expect(modelAcceptsTemperature("claude-sonnet-4-6")).toBe(true);
    expect(modelAcceptsTemperature("claude-opus-4-6")).toBe(true);
    expect(modelAcceptsTemperature("gpt-4o")).toBe(true);
    expect(modelAcceptsTemperature("gemini-2.5-flash")).toBe(true);
    expect(modelAcceptsTemperature("grok-4")).toBe(true);
  });
});
