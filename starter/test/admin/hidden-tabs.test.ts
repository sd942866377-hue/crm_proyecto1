import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { layout } from "../../src/admin/views/layout";
import { hiddenTabs } from "../../src/config";
import { adminApp } from "../../src/admin/routes";
import { ADMIN_USERNAME } from "../../src/admin/auth";
import type { Env } from "../../src/env";

// HIDDEN_TABS (Modo Agencia): la agencia oculta tabs del panel de su cliente.
// Tres capas a probar: el parser (config), el sidebar (layout) y el guard de
// rutas (la URL directa redirige a Resumen).

const envOf = (tier: "free" | "pro", hidden?: string) =>
  ({ BOT_TIER: tier, HIDDEN_TABS: hidden }) as unknown as Env;

const page = (tier: "free" | "pro", hidden?: string) =>
  layout({ title: "Test", activeTab: "overview", body: "<p>body</p>", env: envOf(tier, hidden) });

describe("hiddenTabs (parser)", () => {
  it("parsea CSV con espacios y mayúsculas, y tira ids desconocidos", () => {
    expect(hiddenTabs(envOf("pro", " costs, Config ,noexiste"))).toEqual(["costs", "config"]);
  });

  it("overview nunca es ocultable", () => {
    expect(hiddenTabs(envOf("pro", "overview,costs"))).toEqual(["costs"]);
  });

  it("free ignora la var por completo (gate técnico, como BRAND_*)", () => {
    expect(hiddenTabs(envOf("free", "conversations,costs"))).toEqual([]);
  });

  it("sin var → nada oculto", () => {
    expect(hiddenTabs(envOf("pro"))).toEqual([]);
  });
});

describe("hidden tabs (sidebar)", () => {
  it("pro: las tabs ocultas desaparecen del nav (sin candado ni upsell)", () => {
    const html = page("pro", "costs,config");
    expect(html).not.toContain('href="/admin/costs"');
    expect(html).not.toContain('href="/admin/config"');
    // Las demás siguen igual.
    expect(html).toContain('href="/admin/conversations"');
    expect(html).toContain('href="/admin/overview"');
  });

  it("una sección cuyos items quedan todos ocultos desaparece completa", () => {
    const html = page("pro", "insights,stats,costs");
    expect(html).not.toContain("Análisis");
  });

  it("free: la var se ignora — las tabs básicas siguen visibles", () => {
    const html = page("free", "conversations");
    expect(html).toContain('href="/admin/conversations"');
  });

  it("overview no se puede ocultar ni poniéndolo en la var", () => {
    const html = page("pro", "overview");
    expect(html).toContain('href="/admin/overview"');
  });
});

// ── Guard de rutas: la URL directa a una tab oculta redirige a Resumen ───────

const PASSWORD = "secret123";
const auth = { Authorization: `Basic ${btoa(`${ADMIN_USERNAME}:${PASSWORD}`)}` };

// Stub D1 mínimo: el middleware de idioma lee settings — con esto le basta.
const stubDb = {
  prepare: () => {
    const stmt: any = {
      bind: () => stmt,
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({}),
    };
    return stmt;
  },
} as unknown as D1Database;

const routeEnv = (hidden?: string) =>
  ({
    DB: stubDb,
    DASHBOARD_PASSWORD: PASSWORD,
    BUSINESS_NAME: "Test Biz",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    HIDDEN_TABS: hidden,
  }) as unknown as Env;

describe("hidden tabs (guard de rutas)", () => {
  // Como en producción: el subapp montado en /admin (los guards comparan
  // c.req.path completo, que en el mount sí trae el prefijo).
  const app = new Hono<{ Bindings: Env }>();
  app.route("/admin", adminApp);

  it("la vista oculta redirige a /admin/overview", async () => {
    const res = await app.request("/admin/costs", { headers: auth }, routeEnv("costs"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/overview");
  });

  it("las subrutas de la tab oculta también redirigen (POSTs incluidos)", async () => {
    const res = await app.request("/admin/costs/budget", { headers: auth }, routeEnv("costs"));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/overview");
  });

  it("una tab no listada no se toca", async () => {
    const res = await app.request("/admin/tickets", { headers: auth }, routeEnv("costs"));
    expect(res.status).toBe(200);
  });
});
