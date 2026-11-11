/**
 * Empty-state de paneles que dependen de IA (Insights, Mejoras): sin ninguna
 * llave (ni del sistema ni BYO) muestran cómo configurarla en vez de un
 * "Analizar ahora" que fallaría en silencio. Con llave, render normal.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { renderInsights } from "../../src/admin/views/insights";
import { renderMejoras } from "../../src/admin/views/mejoras";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

let d1: any;

function mkEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: d1,
    BOT_NAME: "Bot",
    BUSINESS_NAME: "Negocio",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    ...extra,
  } as unknown as Env;
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
});

describe("empty-state cuando falta la llave de IA", () => {
  it("Insights SIN llave (ni sistema ni BYO) → guía a configurarla", async () => {
    const html = await renderInsights(mkEnv());
    expect(html).toContain("necesita una llave de IA");
    expect(html).toContain("Copiar prompt");
    expect(html).toContain("/admin/config"); // opción manual
  });

  it("Insights CON llave del sistema → render normal, sin el empty-state", async () => {
    const html = await renderInsights(mkEnv({ ANTHROPIC_API_KEY: "sk-ant-test" } as Partial<Env>));
    expect(html).not.toContain("necesita una llave de IA");
  });

  it("Mejoras SIN llave → guía", async () => {
    const html = await renderMejoras(mkEnv());
    expect(html).toContain("necesita una llave de IA");
  });

  it("Mejoras CON BYO key (setting) → render normal", async () => {
    await new SettingsRepo(new Db(d1)).set(SETTING_KEYS.llmApiKey, "sk-ant-byo");
    const html = await renderMejoras(mkEnv());
    expect(html).not.toContain("necesita una llave de IA");
  });
});
