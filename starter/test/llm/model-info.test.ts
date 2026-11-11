/**
 * Tests del bloque `model` de Mantenimiento (Agencia §1): describeModel resuelve
 * el modelo REAL + costo, source forja/byo, y el picker available_providers con
 * candados (ready) y costos nativos (o null si no hay precio).
 */
import { describe, it, expect } from "vitest";
import {
  describeModel,
  providerReady,
  providerOfKey,
  PROVIDERS,
} from "../../src/llm/model-info";
import { SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const envWith = (extra: Record<string, unknown> = {}): Env => ({ ...extra }) as unknown as Env;

describe("providerOfKey", () => {
  it("deduce el proveedor por el prefijo de la llave", () => {
    expect(providerOfKey("sk-ant-abc")).toBe("anthropic");
    expect(providerOfKey("xai-abc")).toBe("xai");
    expect(providerOfKey("AIzaXYZ")).toBe("google");
    expect(providerOfKey("sk-proj-abc")).toBe("openai");
    expect(providerOfKey("random")).toBeNull();
  });
});

describe("providerReady", () => {
  it("true si hay secret del env para ese proveedor", () => {
    const env = envWith({ ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(providerReady(env, {}, "anthropic")).toBe(true);
    expect(providerReady(env, {}, "xai")).toBe(false);
  });

  it("true si la llave BYO del dueño es de ese proveedor", () => {
    const all = { [SETTING_KEYS.llmProvider]: "xai", [SETTING_KEYS.llmApiKey]: "xai-abc" };
    expect(providerReady(envWith(), all, "xai")).toBe(true);
    expect(providerReady(envWith(), all, "anthropic")).toBe(false);
  });
});

describe("describeModel", () => {
  it("sin ninguna llave: default Claude Sonnet, source forja, tier auto, todo gateado", () => {
    const m = describeModel(envWith(), {}, 0);
    expect(m.provider).toBe("anthropic");
    expect(m.provider_label).toBe("Claude (Anthropic)");
    expect(m.model_id).toBe("claude-sonnet-5");
    expect(m.model_label).toBe("Claude Sonnet 5");
    expect(m.source).toBe("forja");
    expect(m.tier).toBe("auto");
    expect(m.cost_per_mtok).toEqual({ in: 3, out: 15 });
    expect(m.month_usd).toBe(0);
    // Los 4 proveedores reales, con costo nativo y ready=false (no hay llaves).
    expect(m.available_providers.map((p) => p.id)).toEqual([...PROVIDERS]);
    for (const p of m.available_providers) expect(p.ready).toBe(false);
    const xai = m.available_providers.find((p) => p.id === "xai")!;
    expect(xai.label).toBe("Grok (xAI)");
    expect(xai.cost_per_mtok).toEqual({ in: 3, out: 15 }); // grok-4 (smart)
  });

  it("con ANTHROPIC_API_KEY: anthropic queda ready", () => {
    const m = describeModel(envWith({ ANTHROPIC_API_KEY: "sk-ant-x" }), {}, 1.23);
    const anthropic = m.available_providers.find((p) => p.id === "anthropic")!;
    expect(anthropic.ready).toBe(true);
    expect(m.month_usd).toBe(1.23);
  });

  it("cerebro Económico (haiku) → modelo fast Haiku con su costo", () => {
    const m = describeModel(envWith(), { [SETTING_KEYS.modelOverride]: "haiku" }, 0);
    expect(m.tier).toBe("haiku");
    expect(m.model_id).toBe("claude-haiku-4-5-20251001");
    expect(m.model_label).toBe("Claude Haiku 4.5");
    expect(m.cost_per_mtok).toEqual({ in: 1, out: 5 });
  });

  it("BYO (llave propia xai) → source byo, proveedor xai, modelo Grok", () => {
    const all = { [SETTING_KEYS.llmProvider]: "xai", [SETTING_KEYS.llmApiKey]: "xai-abc" };
    const m = describeModel(envWith(), all, 0);
    expect(m.source).toBe("byo");
    expect(m.provider).toBe("xai");
    expect(m.model_id).toBe("grok-4");
    expect(m.provider_label).toBe("Grok (xAI)");
    expect(m.available_providers.find((p) => p.id === "xai")!.ready).toBe(true);
  });

  it("modelo sin precio nativo → cost_per_mtok null (no se inventa)", () => {
    const all = { [SETTING_KEYS.llmModel]: "claude-zzz-unknown" };
    const m = describeModel(envWith({ ANTHROPIC_API_KEY: "sk-ant-x" }), all, 0);
    expect(m.model_id).toBe("claude-zzz-unknown");
    expect(m.cost_per_mtok).toBeNull();
  });
});
