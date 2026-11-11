/**
 * Centro de Mantenimiento (Contrato v3.3 §1, §2, §6): GET compone el estado del
 * bot, PATCH cambia SOLO lo permitido y con los validadores del propio bot.
 * D1 real vía miniflare; la sub-app se ejercita directo (apiApp.request), igual
 * que el resto de los tests de la API del control plane.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { apiApp } from "../../src/api";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { bustTierCache } from "../../src/tier";
import { bustIdiomaCache } from "../../src/idioma";
import { NEVER_WRITABLE, SETTING_VALIDATORS } from "../../src/settings-mutations";
import { BOT_VERSION } from "../../src/version";
import type { Env } from "../../src/env";

const TOKEN = "cp-secret-token";
const NOW = Date.now();

let d1: any;
let db: Db;
let settings: SettingsRepo;

function envWith(tier: "pro" | "free" = "pro", extra: Partial<Env> = {}): Env {
  return {
    DB: d1,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: tier,
    BUFFER_SECONDS: "8",
    CONTROL_PLANE_TOKEN: TOKEN,
    TELEGRAM_BOT_TOKEN: "tg-token",
    ...extra,
  } as unknown as Env;
}

const bearer = { Authorization: `Bearer ${TOKEN}` };

async function get(tier: "pro" | "free" = "pro", extra: Partial<Env> = {}) {
  const res = await apiApp.request("/maintenance", { headers: bearer }, envWith(tier, extra));
  return { res, body: (await res.json()) as any };
}

async function patch(body: unknown, tier: "pro" | "free" = "pro", extra: Partial<Env> = {}) {
  const res = await apiApp.request(
    "/maintenance",
    {
      method: "PATCH",
      headers: { ...bearer, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    envWith(tier, extra),
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

describe("GET /api/maintenance", () => {
  it("compone el estado completo con los defaults del bot", async () => {
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    expect(body.bot).toMatchObject({
      name: "Testi",
      version: BOT_VERSION,
      tier: "pro",
      language: "es-419", // BOT_LANGUAGE "es" normalizado como en idioma.ts
      currency: "",
      paused: false,
      paused_mode: "off",
    });
    expect(body.brain).toEqual({ model_override: "auto" });
    expect(body.budget).toEqual({
      monthly_usd: 25,
      is_default: true,
      month_usd: 0,
      pct: 0,
    });
    // Cazador y Blindaje vienen ON; el resto opt-in.
    expect(body.superpowers).toEqual({
      salesHunter: true,
      blindaje: true,
      dailyReport: false,
      multiLanguage: false,
      satisfactionSurvey: false,
      reengage: false,
      reviews: false,
      payments: false,
      boveda: false,
    });
    expect(body.superpowers_pro).toContain("blindaje");
    expect(body.custom_instructions).toBe("");
    expect(body.alerts).toEqual([]);
    expect(body.tickets).toEqual({ open: 0 });
    // Los canales salen del MISMO helper del panel: con TELEGRAM_BOT_TOKEN,
    // Telegram aparece conectado y nunca viaja un secret.
    const telegram = body.channels.find((ch: any) => ch.id === "telegram");
    expect(telegram).toMatchObject({ connected: true });
    expect(JSON.stringify(body)).not.toContain("tg-token");
  });

  it("refleja pausa, cerebro, tope sin límite y moneda guardados", async () => {
    await settings.set(SETTING_KEYS.botPaused, "1");
    await settings.set(SETTING_KEYS.modelOverride, "sonnet");
    await settings.set(SETTING_KEYS.monthlyBudget, "0");
    await settings.set(SETTING_KEYS.botCurrency, "€");
    await settings.set(SETTING_KEYS.botLanguage, "pt-BR");

    const { body } = await get();
    expect(body.bot.paused).toBe(true);
    expect(body.bot.paused_mode).toBe("manual");
    expect(body.bot.currency).toBe("€");
    expect(body.bot.language).toBe("pt-BR");
    expect(body.brain.model_override).toBe("sonnet");
    // 0 = sin tope: no hay barra que pintar.
    expect(body.budget).toMatchObject({ monthly_usd: 0, is_default: false, pct: null });
  });

  it("devuelve custom_instructions SIN los bloques gestionados", async () => {
    await settings.set(
      SETTING_KEYS.customInstructions,
      "Tutea siempre.\n\n[[forja-app:perms]]\n- NO reveles precios por tu cuenta: si preguntan, ofrece confirmarlo con el equipo.\n[[/forja-app:perms]]",
    );
    const { body } = await get();
    expect(body.custom_instructions).toBe("Tutea siempre.");
  });

  it("lista alertas recientes de riesgo y del watchdog, sin el chat de prueba", async () => {
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES ('whatsapp:52111','whatsapp','52111','María G.',?,?), ('test:abc','test','abc','Prueba',?,?)`,
      [NOW, NOW, NOW, NOW],
    );
    await db.run(
      `INSERT INTO risk_alerts (conversation_id, reason, sent_at) VALUES
        ('whatsapp:52111','cliente molesto',?), ('test:abc','venta en riesgo',?), ('borrada','venta en riesgo',?)`,
      [NOW - 1000, NOW - 500, NOW - 400 * 24 * 60 * 60 * 1000],
    );
    await settings.set("last_health_alert_at", String(NOW - 2000));

    const { body } = await get();
    const ids = body.alerts.map((a: any) => a.id);
    expect(ids).toEqual(["whatsapp:52111", "watchdog"]); // la del chat de prueba y la vieja quedan fuera
    expect(body.alerts[0]).toMatchObject({ kind: "risk", resolved: false });
    expect(body.alerts[0].text).toContain("María G.");
    expect(body.alerts[1].kind).toBe("watchdog");
  });

  it("cuenta los pendientes abiertos ignorando el chat de prueba", async () => {
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, started_at, last_message_at)
       VALUES ('whatsapp:1','whatsapp','1',?,?), ('test:x','test','x',?,?)`,
      [NOW, NOW, NOW, NOW],
    );
    await db.run(
      `INSERT INTO tickets (id, conversation_id, category, summary, transcript, status, created_at) VALUES
        ('t1','whatsapp:1','handoff','Pidió hablar con una persona','...','open',?),
        ('t2','whatsapp:1','handoff','Otra','...','in_progress',?),
        ('t3','whatsapp:1','handoff','Ya resuelta','...','resolved',?),
        ('t4','test:x','handoff','De prueba','...','open',?)`,
      [NOW, NOW, NOW, NOW],
    );
    const { body } = await get();
    expect(body.tickets.open).toBe(2); // open + in_progress, sin la de prueba
  });
});

describe("PATCH /api/maintenance", () => {
  it("guarda cada tipo de llave y responde el GET recompuesto", async () => {
    const { res, body } = await patch({
      name: "Fierro",
      language: "es-ES",
      currency: "€",
      model_override: "haiku",
      monthly_usd: 40,
      custom_instructions: "Nunca prometas entregas el mismo día.",
    });
    expect(res.status).toBe(200);
    expect(body.bot).toMatchObject({ name: "Fierro", language: "es-ES", currency: "€" });
    expect(body.brain.model_override).toBe("haiku");
    expect(body.budget).toMatchObject({ monthly_usd: 40, is_default: false });
    expect(body.custom_instructions).toBe("Nunca prometas entregas el mismo día.");

    // Y quedó en los MISMOS settings que lee el bot en su próximo mensaje.
    expect(await settings.get(SETTING_KEYS.botName)).toBe("Fierro");
    expect(await settings.get(SETTING_KEYS.botLanguage)).toBe("es-ES");
    expect(await settings.get(SETTING_KEYS.modelOverride)).toBe("haiku");
    expect(await settings.get(SETTING_KEYS.monthlyBudget)).toBe("40");
  });

  it("monthly_usd 0 = sin tope", async () => {
    const { body } = await patch({ monthly_usd: 0 });
    expect(await settings.get(SETTING_KEYS.monthlyBudget)).toBe("0");
    expect(body.budget).toMatchObject({ monthly_usd: 0, pct: null });
  });

  it("prende y apaga superpoderes con la codificación de cada uno", async () => {
    const { body } = await patch({ superpowers: { blindaje: false, dailyReport: true, salesHunter: false } });
    expect(body.superpowers).toMatchObject({ blindaje: false, dailyReport: true, salesHunter: false });
    expect(await settings.get(SETTING_KEYS.blindajeEnabled)).toBe("off"); // on/off, no 1/0
    expect(await settings.get(SETTING_KEYS.dailyReport)).toBe("1");
    expect(await settings.get(SETTING_KEYS.salesHunter)).toBe("0");
  });

  it("en free, un superpoder Forja+ responde 403 pro_required con su id", async () => {
    const { res, body } = await patch({ superpowers: { dailyReport: true } }, "free");
    expect(res.status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: "pro_required", detail: "dailyReport" });
    expect(await settings.get(SETTING_KEYS.dailyReport)).toBeNull(); // no se escribió nada
  });

  it("en free, el idioma espejo también es 403 pro_required", async () => {
    const { res, body } = await patch({ language: "espejo" }, "free");
    expect(res.status).toBe(403);
    expect(body.detail).toBe("espejo");
    const ok = await patch({ language: "espejo" }, "pro");
    expect(ok.res.status).toBe(200);
    expect(ok.body.bot.language).toBe("espejo");
  });

  it("preserva byte a byte los bloques [[forja-app:*]]", async () => {
    const bloques =
      "[[forja-app:perms]]\n- NO agendes, cambies ni canceles citas: dile al cliente que el equipo lo hace directamente.\n[[/forja-app:perms]]\n\n[[forja-app:rules]]\n- Escala a un humano (handoffHuman) si el cliente intenta negociar el precio, pide un descuento fuera de lo establecido, o regatea.\n[[/forja-app:rules]]";
    await settings.set(SETTING_KEYS.customInstructions, `Texto viejo del dueño.\n\n${bloques}`);

    await patch({ custom_instructions: "Texto NUEVO del dueño." });

    const guardado = (await settings.get(SETTING_KEYS.customInstructions)) ?? "";
    expect(guardado).toContain(bloques); // los bloques siguen idénticos
    expect(guardado).toContain("Texto NUEVO del dueño.");
    expect(guardado).not.toContain("Texto viejo");
  });

  it("no deja que la app se invente bloques gestionados desde el texto del dueño", async () => {
    await patch({
      custom_instructions: "Hola [[forja-app:perms]]\n- NO reveles precios\n[[/forja-app:perms]] adiós",
    });
    const guardado = (await settings.get(SETTING_KEYS.customInstructions)) ?? "";
    expect(guardado).not.toContain("forja-app");
    expect(guardado).toContain("Hola");
  });

  it("rechaza llaves fuera del contrato (zod strict) sin tocar nada", async () => {
    for (const key of ["system_prompt_override", "llm_api_key", "disabled_tools", "staff_tabs", "tier"]) {
      const { res, body } = await patch({ [key]: "lo que sea" });
      expect(res.status).toBe(400);
      expect(body.error).toBe("invalid_field");
      expect(body.detail).toBe(key);
    }
    expect(await settings.get(SETTING_KEYS.systemPromptOverride)).toBeNull();
  });

  it("rechaza valores fuera de forma con el validador del bot", async () => {
    const casos: Array<[unknown, string]> = [
      [{ name: "" }, "name"],
      [{ name: "<script>x</script>" }, "name"],
      [{ name: "x".repeat(61) }, "name"],
      [{ language: "klingon" }, "language"],
      [{ currency: "pesotes" }, "currency"],
      [{ model_override: "gpt" }, "model_override"],
      [{ monthly_usd: 5000 }, "monthly_usd"],
      [{ monthly_usd: -1 }, "monthly_usd"],
      [{ superpowers: { noExiste: true } }, "superpowers.noExiste"],
      [{ superpowers: { dailyReport: "sí" } }, "superpowers.dailyReport"],
      [{ custom_instructions: "x".repeat(16001) }, "custom_instructions"],
      [{}, "body"],
      [{ superpowers: {} }, "body"], // un guardado que no cambia nada es un bug de la app
    ];
    for (const [body, detail] of casos) {
      const r = await patch(body);
      expect(r.res.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBe("invalid_field");
      expect(r.body.detail).toBe(detail);
    }
  });

  it("es todo-o-nada: una llave inválida no aplica las válidas", async () => {
    const { res } = await patch({ name: "Fierro", model_override: "gpt" });
    expect(res.status).toBe(400);
    expect(await settings.get(SETTING_KEYS.botName)).toBeNull();
  });

  it("body que no es JSON → invalid_json", async () => {
    const res = await apiApp.request(
      "/maintenance",
      { method: "PATCH", headers: bearer, body: "no soy json" },
      envWith(),
    );
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("invalid_json");
  });

  it("sin Bearer, el guard del control plane cierra la puerta", async () => {
    const res = await apiApp.request("/maintenance", {}, envWith());
    expect(res.status).toBe(401);
  });
});

describe("GET superpowers_meta (v3.3.1 §1)", () => {
  it("los cuatro toggle limpio salen como configurable:false", async () => {
    const { body } = await get();
    for (const id of ["salesHunter", "blindaje", "dailyReport", "multiLanguage"]) {
      expect(body.superpowers_meta[id]).toEqual({ configurable: false });
    }
  });

  it("survey es configurable pero siempre configurado (default cuenta)", async () => {
    const { body } = await get();
    expect(body.superpowers_meta.satisfactionSurvey).toEqual({
      configurable: true,
      configured: true,
      needs: [],
    });
  });

  it("reviews/reengage/payments/boveda sin setup: configured:false con hint+panel", async () => {
    const { body } = await get();
    expect(body.superpowers_meta.reviews).toEqual({
      configurable: true,
      configured: false,
      needs: ["review_url"],
      hint: "Falta el link de reseña",
      panel: "reviews",
    });
    expect(body.superpowers_meta.reengage).toMatchObject({
      configurable: true,
      configured: false,
      needs: ["reengage_template"],
      panel: "reengage",
    });
    expect(body.superpowers_meta.payments).toEqual({
      configurable: true,
      configured: false,
      needs: ["stripe", "prices"],
      hint: "Conecta Stripe y define precios",
      panel: "cobros",
    });
    expect(body.superpowers_meta.boveda).toMatchObject({
      configurable: true,
      configured: false,
      needs: ["r2"],
      panel: "boveda",
    });
  });

  it("reviews con link, reengage con plantilla → configured:true sin hint/panel", async () => {
    await settings.set(SETTING_KEYS.reviewUrl, "https://g.page/r/negocio/review");
    await settings.set(SETTING_KEYS.reengageTemplateSid, "HX123");
    const { body } = await get();
    expect(body.superpowers_meta.reviews).toEqual({
      configurable: true,
      configured: true,
      needs: ["review_url"],
    });
    expect(body.superpowers_meta.reengage).toEqual({
      configurable: true,
      configured: true,
      needs: ["reengage_template"],
    });
    expect(body.superpowers_meta.reviews.hint).toBeUndefined();
    expect(body.superpowers_meta.reengage.panel).toBeUndefined();
  });

  it("reengage también cuenta configurado con el nombre de plantilla (Cloud API)", async () => {
    await settings.set(SETTING_KEYS.reengageTemplateName, "reenganche_es");
    const { body } = await get();
    expect(body.superpowers_meta.reengage.configured).toBe(true);
  });

  it("payments configurado si hay STRIPE_SECRET_KEY; boveda si hay binding R2", async () => {
    const { body } = await get("pro", {
      STRIPE_SECRET_KEY: "sk_test_x",
      MEDIA: {} as any,
    });
    expect(body.superpowers_meta.payments.configured).toBe(true);
    expect(body.superpowers_meta.payments.hint).toBeUndefined();
    expect(body.superpowers_meta.boveda.configured).toBe(true);
  });
});

describe("GET scheduling (v3.3.1 §5)", () => {
  it("nicho que no agenda (default genérico) → enabled:false, provider:null", async () => {
    const { body } = await get();
    expect(body.scheduling).toEqual({ enabled: false, provider: null });
  });

  it("nicho de cita sin Cal.com → enabled:true, provider:null", async () => {
    const { body } = await get("pro", { BOT_NICHE: "barberia" });
    expect(body.scheduling).toEqual({ enabled: true, provider: null });
  });

  it("nicho de cita con CALCOM_API_KEY → provider:calcom", async () => {
    const { body } = await get("pro", { BOT_NICHE: "spa", CALCOM_API_KEY: "cal_x" });
    expect(body.scheduling).toEqual({ enabled: true, provider: "calcom" });
  });

  it("nicho de reservas (restaurante) NO agenda citas", async () => {
    const { body } = await get("pro", { BOT_NICHE: "restaurante", CALCOM_API_KEY: "cal_x" });
    expect(body.scheduling.enabled).toBe(false);
  });
});

describe("PATCH gate not_configured (v3.3.1 §2)", () => {
  it("prender payments sin Stripe → 409 not_configured con needs+hint, no escribe", async () => {
    const { res, body } = await patch({ superpowers: { payments: true } });
    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: "not_configured",
      detail: "payments",
      needs: ["stripe", "prices"],
      hint: "Conecta Stripe y define precios",
    });
    expect(await settings.get(SETTING_KEYS.paymentsEnabled)).toBeNull();
  });

  it("prender payments CON Stripe → 200 y queda guardado", async () => {
    const { res, body } = await patch({ superpowers: { payments: true } }, "pro", {
      STRIPE_SECRET_KEY: "sk_test_x",
    });
    expect(res.status).toBe(200);
    expect(body.superpowers.payments).toBe(true);
    expect(await settings.get(SETTING_KEYS.paymentsEnabled)).toBe("1");
  });

  it("prender reviews sin link → 409; con link → 200", async () => {
    const sinLink = await patch({ superpowers: { reviews: true } });
    expect(sinLink.res.status).toBe(409);
    expect(sinLink.body.detail).toBe("reviews");
    expect(await settings.get(SETTING_KEYS.reviewRequests)).toBeNull();

    await settings.set(SETTING_KEYS.reviewUrl, "https://g.page/r/x/review");
    const conLink = await patch({ superpowers: { reviews: true } });
    expect(conLink.res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.reviewRequests)).toBe("1");
  });

  it("prender boveda sin R2 → 409; con binding R2 → 200", async () => {
    const sinR2 = await patch({ superpowers: { boveda: true } });
    expect(sinR2.res.status).toBe(409);
    expect(sinR2.body).toMatchObject({ error: "not_configured", detail: "boveda", needs: ["r2"] });

    const conR2 = await patch({ superpowers: { boveda: true } }, "pro", { MEDIA: {} as any });
    expect(conR2.res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.bovedaEnabled)).toBe("1");
  });

  it("prender reengage sin plantilla → 409; con plantilla → 200", async () => {
    const sin = await patch({ superpowers: { reengage: true } });
    expect(sin.res.status).toBe(409);
    expect(sin.body.detail).toBe("reengage");

    await settings.set(SETTING_KEYS.reengageTemplateName, "reenganche_es");
    const con = await patch({ superpowers: { reengage: true } });
    expect(con.res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.reengageColdLeads)).toBe("1");
  });

  it("APAGAR un superpoder sin configurar SIEMPRE se permite", async () => {
    const { res } = await patch({ superpowers: { payments: false, boveda: false } });
    expect(res.status).toBe(200);
    expect(await settings.get(SETTING_KEYS.paymentsEnabled)).toBe("0");
    expect(await settings.get(SETTING_KEYS.bovedaEnabled)).toBe("0");
  });

  it("survey (siempre configurado) y los toggle limpio se prenden sin 409", async () => {
    const { res, body } = await patch({
      superpowers: { satisfactionSurvey: true, dailyReport: true },
    });
    expect(res.status).toBe(200);
    expect(body.superpowers).toMatchObject({ satisfactionSurvey: true, dailyReport: true });
  });
});

describe("lista negra (§6)", () => {
  it("ninguna llave prohibida tiene validador — jamás se escribe desde la nube", () => {
    for (const key of NEVER_WRITABLE) {
      expect(SETTING_VALIDATORS[key], key).toBeUndefined();
    }
  });

  it("POST /api/settings las rechaza una por una", async () => {
    const payload: Record<string, string> = {};
    for (const key of NEVER_WRITABLE) payload[key] = "pwned";
    const res = await apiApp.request(
      "/settings",
      {
        method: "POST",
        headers: { ...bearer, "Content-Type": "application/json" },
        body: JSON.stringify({ settings: payload }),
      },
      envWith(),
    );
    const body = (await res.json()) as any;
    expect(body.applied).toEqual([]);
    expect(body.rejected.sort()).toEqual([...NEVER_WRITABLE].sort());
    for (const key of NEVER_WRITABLE) {
      expect(await settings.get(key), key).toBeNull();
    }
  });
});
