/**
 * Tests de la tab "Plantillas": lista las plantillas HSM de la cuenta (Twilio
 * Content API, fetch stubbeado), muestra el rol asignado a cada una, y el POST
 * /plantillas/use asigna el SID de reenganche. Gate Pro. D1 real vía miniflare.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { adminApp } from "../../src/admin/routes";
import { layout } from "../../src/admin/views/layout";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const AUTH = {
  Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString("base64")}`,
};

let env: Env;
let settings: SettingsRepo;
const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function baseEnv(d1: any, tier: "pro" | "free" = "pro"): Env {
  return {
    DB: d1,
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "tok",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio",
    BOT_LANGUAGE: "es",
    BOT_TIER: tier,
    BUFFER_SECONDS: "8",
    DASHBOARD_PASSWORD: PASSWORD,
  } as unknown as Env;
}

const CONTENT_LIST = {
  contents: [
    {
      sid: "HXreengage1",
      friendly_name: "reenganche_no_show",
      types: { "twilio/text": { body: "Hola {{1}}, te esperábamos en la clase 👀" } },
      variables: { "1": "nombre" },
    },
    {
      sid: "HXotra2",
      friendly_name: "recordatorio_evento",
      types: { "twilio/text": { body: "Falta poco para tu evento." } },
      variables: {},
    },
  ],
};

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = baseEnv(d1);
  settings = new SettingsRepo(new Db(d1));
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("GET /plantillas", () => {
  it("lista las plantillas de la cuenta y marca la asignada a reenganche", async () => {
    await settings.set(SETTING_KEYS.reengageTemplateSid, "HXreengage1");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(CONTENT_LIST), { status: 200 }));

    const res = await adminApp.request("/plantillas", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Plantillas en tu cuenta de Twilio");
    expect(html).toContain("Twilio (BSP)"); // indica el método detectado
    expect(html).toContain("reenganche_no_show");
    expect(html).toContain("recordatorio_evento");
    // La asignada muestra "En reenganche" en vez del botón "Usar".
    expect(html).toContain("En reenganche");
    // El rol de reenganche aparece como Configurada.
    expect(html).toContain("Configurada");
  });

  it("renderiza con estado vacío cuando no hay credenciales/plantillas", async () => {
    env = baseEnv(env.DB); // sin cambiar creds; forzamos lista vacía vía fetch
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ contents: [] }), { status: 200 }));
    const res = await adminApp.request("/plantillas", { headers: AUTH }, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No hay plantillas aprobadas");
  });

  it("Cloud API oficial: muestra el form de nombre+idioma de la plantilla de Meta", async () => {
    const cloudEnv = {
      ...baseEnv(env.DB),
      TWILIO_ACCOUNT_SID: undefined,
      TWILIO_AUTH_TOKEN: undefined,
      WHATSAPP_PHONE_NUMBER_ID: "1234567890",
      WHATSAPP_ACCESS_TOKEN: "EAAtoken",
    } as unknown as Env;
    await new SettingsRepo(new Db(cloudEnv.DB)).set(SETTING_KEYS.reengageTemplateName, "reenganche_lead");
    const res = await adminApp.request("/plantillas", { headers: AUTH }, cloudEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Cloud API oficial de Meta");
    expect(html).toContain("WhatsApp oficial");
    expect(html).toContain("reenganche_lead"); // el nombre configurado, prellenado
    expect(html).not.toContain("cuenta de Twilio"); // no muestra la sección Twilio
  });

  it("es un tab Pro: en free sale bloqueado en el nav (apunta a upgrade)", () => {
    const freeHtml = layout({
      title: "T",
      activeTab: "overview",
      body: "x",
      env: baseEnv(env.DB, "free"),
    });
    // El item Plantillas existe pero linkea al upgrade, no a su vista real.
    expect(freeHtml).toContain("Plantillas");
    expect(freeHtml).not.toContain('href="/admin/plantillas"');
    const proHtml = layout({
      title: "T",
      activeTab: "overview",
      body: "x",
      env: baseEnv(env.DB, "pro"),
    });
    expect(proHtml).toContain('href="/admin/plantillas"');
  });
});

describe("POST /plantillas/use", () => {
  it("asigna el SID al rol de reenganche (Twilio)", async () => {
    const body = new URLSearchParams({ sid: "HXotra2" });
    const res = await adminApp.request(
      "/plantillas/use",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/plantillas?saved=1");
    expect(await settings.get(SETTING_KEYS.reengageTemplateSid)).toBe("HXotra2");
  });
});

describe("POST /plantillas/wa-template", () => {
  it("guarda el nombre + idioma de la plantilla de Meta (Cloud API)", async () => {
    const body = new URLSearchParams({ name: "reenganche_lead", lang: "es_MX" });
    const res = await adminApp.request(
      "/plantillas/wa-template",
      { method: "POST", headers: { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }, body },
      env,
    );
    expect(res.status).toBe(302);
    expect(await settings.get(SETTING_KEYS.reengageTemplateName)).toBe("reenganche_lead");
    expect(await settings.get(SETTING_KEYS.reengageTemplateLang)).toBe("es_MX");
  });
});
