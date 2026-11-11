/**
 * Mantenimiento — modelo/costo de Agencia (CONTRACT-AGENCY-MODELS):
 *  • GET expone el bloque `model` (proveedor/modelo reales, costo, picker)
 *  • PATCH acepta `provider`: si hay llave → escribe llm_provider; si no → 409
 *    provider_not_configured; "" (auto) siempre ok; cambiar solo el proveedor
 *    cuenta como cambio real.
 * D1 real vía miniflare; la sub-app se ejercita directo (apiApp.request).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { apiApp } from "../../src/api";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { bustTierCache } from "../../src/tier";
import { bustIdiomaCache } from "../../src/idioma";
import type { Env } from "../../src/env";

const TOKEN = "cp-secret-token";
let d1: any;
let db: Db;
let settings: SettingsRepo;

function envWith(extra: Partial<Env> = {}): Env {
  return {
    DB: d1,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    CONTROL_PLANE_TOKEN: TOKEN,
    ...extra,
  } as unknown as Env;
}

const bearer = { Authorization: `Bearer ${TOKEN}` };

async function get(extra: Partial<Env> = {}) {
  const res = await apiApp.request("/maintenance", { headers: bearer }, envWith(extra));
  return { res, body: (await res.json()) as any };
}

async function patch(body: unknown, extra: Partial<Env> = {}) {
  const res = await apiApp.request(
    "/maintenance",
    { method: "PATCH", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    envWith(extra),
  );
  return { res, body: (await res.json()) as any };
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
  db = new Db(d1);
  settings = new SettingsRepo(db);
  bustTierCache();
  bustIdiomaCache();
});

describe("GET /api/maintenance — bloque model", () => {
  it("expone el modelo real, costo y el picker de proveedores", async () => {
    const { body } = await get({ ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(body.model).toMatchObject({
      provider: "anthropic",
      provider_label: "Claude (Anthropic)",
      model_id: "claude-sonnet-5",
      model_label: "Claude Sonnet 5",
      source: "forja",
      tier: "auto",
      cost_per_mtok: { in: 3, out: 15 },
      month_usd: 0,
    });
    const ids = body.model.available_providers.map((p: any) => p.id);
    expect(ids).toEqual(["anthropic", "openai", "xai", "google"]);
    // Con solo la llave de Anthropic en el env, solo ese proveedor queda ready.
    const readiness = Object.fromEntries(
      body.model.available_providers.map((p: any) => [p.id, p.ready]),
    );
    expect(readiness).toEqual({ anthropic: true, openai: false, xai: false, google: false });
    // Nunca viaja el secret.
    expect(JSON.stringify(body)).not.toContain("sk-ant-x");
  });

  it("refleja el cerebro Económico como Haiku (fast) con su costo", async () => {
    await settings.set(SETTING_KEYS.modelOverride, "haiku");
    const { body } = await get();
    expect(body.model.tier).toBe("haiku");
    expect(body.model.model_id).toBe("claude-haiku-4-5-20251001");
    expect(body.model.cost_per_mtok).toEqual({ in: 1, out: 5 });
  });
});

describe("PATCH /api/maintenance — provider (Agencia §2)", () => {
  it("proveedor con llave en el env → 200 y escribe llm_provider", async () => {
    const { res, body } = await patch({ provider: "anthropic" }, { ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.llmProvider)).toBe("anthropic");
    // El GET recompuesto ya refleja el proveedor efectivo.
    expect(body.model.provider).toBe("anthropic");
  });

  it("proveedor SIN llave → 409 provider_not_configured, no escribe nada", async () => {
    const { res, body } = await patch({ provider: "xai" }); // sin XAI_API_KEY
    expect(res.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: "provider_not_configured", detail: "xai" });
    expect(await settings.get(SETTING_KEYS.llmProvider)).toBeNull();
  });

  it("provider '' (Automático) siempre se permite y limpia el override", async () => {
    await settings.set(SETTING_KEYS.llmProvider, "anthropic");
    const { res } = await patch({ provider: "" });
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.llmProvider)).toBe("");
  });

  it("cambiar SOLO el proveedor cuenta como cambio real (no es 400 body)", async () => {
    const { res } = await patch({ provider: "anthropic" }, { ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(res.status).toBe(200);
  });

  it("BYO: si el dueño ya tiene su llave xai, cambiar a xai es un setting (200)", async () => {
    await settings.set(SETTING_KEYS.llmApiKey, "xai-abc");
    await settings.set(SETTING_KEYS.llmProvider, "xai"); // ya venía en byo
    const { res } = await patch({ provider: "xai" });
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.llmProvider)).toBe("xai");
  });

  it("valor de proveedor fuera del enum → 400 invalid_field", async () => {
    const { res, body } = await patch({ provider: "minimax" });
    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: "invalid_field", detail: "provider" });
  });

  it("provider ready + model_override juntos se aplican ambos", async () => {
    const { res, body } = await patch(
      { provider: "anthropic", model_override: "sonnet" },
      { ANTHROPIC_API_KEY: "sk-ant-x" },
    );
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.llmProvider)).toBe("anthropic");
    expect(await settings.get(SETTING_KEYS.modelOverride)).toBe("sonnet");
    expect(body.brain.model_override).toBe("sonnet");
  });
});
