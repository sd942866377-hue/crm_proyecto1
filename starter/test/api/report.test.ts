/**
 * Contrato v3.2 §9 — el reporte del día en la app (Forja+):
 * GET /api/report/latest y lo que el cron nocturno persiste para que exista.
 * Resend + IA mockeados; D1 real (miniflare).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) };
  },
}));

const generateTextMock = vi.fn();
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }));
vi.mock("../../src/llm/provider", () => ({
  // llm/work-model arma con estas dos la cadena de respaldo (el failover que
  // ya tenía el agente). Aquí: un solo candidato, el de createModel.
  envKeyFor: () => undefined,
  fallbackModel: () => null,
  createModel: () => ({ provider: "anthropic", modelId: "test", model: {}, supportsPromptCache: false }),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { apiApp } from "../../src/api";
import { Db } from "../../src/db/client";

import { MessagesRepo } from "../../src/db/messages";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { sendDailyReport } from "../../src/owner/dailyReport";
import type { Env } from "../../src/env";

const TOKEN = "cp-secret-token";
const NOW = Date.now();

let d1: any;
let db: Db;
let settings: SettingsRepo;
const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

function authedEnv(extra: Record<string, unknown> = {}): Env {
  return {
    DB: d1,
    BOT_NAME: "Santi",
    BUSINESS_NAME: "Barbería Fierro",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    CONTROL_PLANE_TOKEN: TOKEN,
    DASHBOARD_BASE_URL: "https://panel.test",
    RESEND_API_KEY: "re_test",
    OWNER_EMAIL: "owner@test.com",
    ...extra,
  } as unknown as Env;
}

const bearer = { Authorization: `Bearer ${TOKEN}` };
const json = (res: Response): Promise<any> => res.json() as Promise<any>;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
  db = new Db(d1);
  settings = new SettingsRepo(db);
  sendMock.mockReset().mockResolvedValue({ id: "email_1" });
  generateTextMock.mockReset().mockResolvedValue({
    text: JSON.stringify({
      summary: "Buen día: subieron los mensajes.",
      insights: ["hallazgo uno"],
      actions: ["acción uno"],
    }),
  });
  fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function seedActivity() {
  // started_at explícito: el reporte cuenta las conversaciones ABIERTAS en la
  // ventana, y un getOrCreate las marca con el reloj real (posterior a NOW).
  await db.run(
    `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
     VALUES ('telegram:u1','telegram','u1','Ana',?,?)`,
    [NOW - 3600_000, NOW - 3600_000],
  );
  await new MessagesRepo(db).append("telegram:u1", "user", "hola", { createdAt: NOW - 3600_000 });
  await db.run("INSERT INTO leads (id, intent, created_at, updated_at) VALUES ('l1','compra',?,?)", [
    NOW - 3600_000,
    NOW - 3600_000,
  ]);
}

const pedirReporte = (qs = "", env = authedEnv()) =>
  apiApp.request(`/report/latest${qs}`, { headers: bearer }, env);

describe("GET /api/report/latest (§9)", () => {
  it("401 sin Bearer", async () => {
    const env = authedEnv() as any;
    delete env.CONTROL_PLANE_TOKEN;
    expect((await apiApp.request("/report/latest", {}, env)).status).toBe(401);
  });

  it("403 pro_required en un bot free", async () => {
    const res = await pedirReporte("", authedEnv({ BOT_TIER: "free" }));
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("pro_required");
  });

  it("404 no_report antes de que el cron genere el primero", async () => {
    const res = await pedirReporte();
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("no_report");
  });

  it("shape del contrato tras el reporte nocturno", async () => {
    await settings.set(SETTING_KEYS.dailyReport, "1");
    await seedActivity();
    await sendDailyReport(authedEnv(), { now: NOW });

    const j = await json(await pedirReporte());
    expect(j.ok).toBe(true);
    expect(j.report).toMatchObject({
      generated_at: NOW,
      period: { from: NOW - 86_400_000, to: NOW },
      title: "Tu resumen de hoy — Barbería Fierro",
      empty: false,
      summary: "Buen día: subieron los mensajes.",
      insights: ["hallazgo uno"],
      actions: ["acción uno"],
      stats: {
        messages: 1,
        conversations: 1,
        leads: 1,
        hot_leads: 0,
        tickets_opened: 0,
        tickets_resolved: 0,
        upset: 0,
      },
    });
    expect(j.report.prev).toMatchObject({ messages: 0, conversations: 0, leads: 0 });
    expect(Array.isArray(j.report.topics)).toBe(true);
    expect(Array.isArray(j.report.missed_questions)).toBe(true);
    // El cuerpo en markdown lleva el resumen y los números.
    expect(j.body_markdown).toContain("Buen día: subieron los mensajes.");
    expect(j.body_markdown).toContain("Barbería Fierro");
    expect(j.body_markdown).toContain("**Lo que veo**");
    expect(j.body_markdown).toContain("- hallazgo uno");
    // Y NADA de HTML: la app lo pinta con sus propias tarjetas.
    expect(JSON.stringify(j)).not.toContain("<!doctype");
  });

  it("un día tranquilo TAMBIÉN se guarda, para que la app lo pueda decir", async () => {
    await settings.set(SETTING_KEYS.dailyReport, "1");
    const r = await sendDailyReport(authedEnv(), { now: NOW });
    expect(r.sent).toBe(false);

    const j = await json(await pedirReporte());
    expect(j.report.empty).toBe(true);
    expect(j.report.stats.messages).toBe(0);
    // Pero no se molesta a nadie: ni correo ni push.
    expect(sendMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("?fresh=1 arma uno al vuelo y NO lo persiste", async () => {
    await seedActivity();
    const j = await json(await pedirReporte("?fresh=1"));
    expect(j.ok).toBe(true);
    expect(j.report.stats.messages).toBe(1);
    expect(await settings.get(SETTING_KEYS.reportLastJson)).toBeNull();
  });

  it("un setting corrupto se ve como 'aún no hay reporte', no como un 500", async () => {
    await settings.set(SETTING_KEYS.reportLastJson, "{roto");
    const res = await pedirReporte();
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("no_report");
  });
});

describe("push `report` y persistencia (§9 / §12)", () => {
  it("avisa a la app con el título del reporte y el resumen recortado", async () => {
    await settings.set(SETTING_KEYS.dailyReport, "1");
    await seedActivity();
    await sendDailyReport(authedEnv({ CONTROL_PLANE_TOKEN: TOKEN }), { now: NOW });

    const push = fetchMock.mock.calls.find((c) => String(c[0]).includes("/push/dispatch"));
    expect(push).toBeTruthy();
    const body = JSON.parse((push![1] as RequestInit).body as string);
    expect(body.type).toBe("report");
    expect(body.title).toBe("📊 Tu resumen de hoy — Barbería Fierro");
    expect(body.body).toBe("Buen día: subieron los mensajes.");
    expect(body.conversation_id).toBeUndefined();
  });

  it("sin correo ni Telegram el reporte sigue llegando por la app", async () => {
    const env = authedEnv();
    delete (env as any).RESEND_API_KEY;
    delete (env as any).OWNER_EMAIL;
    await settings.set(SETTING_KEYS.dailyReport, "1");
    await seedActivity();
    await sendDailyReport(env, { now: NOW });

    expect(await settings.get(SETTING_KEYS.reportLastJson)).toBeTruthy();
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("/push/dispatch")),
    ).toBe(true);
  });

  it("report_last_% no viaja en settings.all() (corre en cada turno del cliente)", async () => {
    await settings.set(SETTING_KEYS.reportLastHtml, "<!doctype html>…");
    await settings.set(SETTING_KEYS.reportLastJson, '{"empty":true}');
    await settings.set(SETTING_KEYS.tone, "cálido y cercano");
    const all = await settings.all();
    expect(all[SETTING_KEYS.tone]).toBe("cálido y cercano");
    expect(all[SETTING_KEYS.reportLastHtml]).toBeUndefined();
    expect(all[SETTING_KEYS.reportLastJson]).toBeUndefined();
    // Pero con get() siguen ahí.
    expect(await settings.get(SETTING_KEYS.reportLastHtml)).toContain("doctype");
  });
});
