/**
 * Tests de Reportes automáticos (sendDailyReport): gating (Pro + toggle),
 * throttle anti-doble-tick, día vacío no molesta, y el envío del reporte
 * diseñado. Resend + IA (generateText) mockeados; D1 real via miniflare.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => sendMock(...a) };
  },
}));

const generateTextMock = vi.fn();
vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => generateTextMock(...a),
}));
vi.mock("../../src/llm/provider", () => ({
  // llm/work-model arma con estas dos la cadena de respaldo (el failover que
  // ya tenía el agente). Aquí: un solo candidato, el de createModel.
  envKeyFor: () => undefined,
  fallbackModel: () => null,
  createModel: () => ({ provider: "anthropic", modelId: "test", model: {}, supportsPromptCache: false }),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { sendDailyReport, collectDailyStats } from "../../src/owner/dailyReport";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let settings: SettingsRepo;

const NOW = Date.now();

async function seedActivity() {
  const conv = await convs.getOrCreate("telegram", "u1", "Ana");
  await msgs.append(conv.id, "user", "hola", { createdAt: NOW - 3600_000 });
  await db.run("INSERT INTO leads (id, intent, created_at, updated_at) VALUES ('l1', 'compra', ?, ?)", [
    NOW - 3600_000,
    NOW - 3600_000,
  ]);
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    BOT_NAME: "Santi",
    BUSINESS_NAME: "Horizontes IA",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_BASE_URL: "https://panel.test",
    RESEND_API_KEY: "re_test",
    OWNER_EMAIL: "owner@test.com",
  } as unknown as Env;
  db = new Db(d1);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  settings = new SettingsRepo(db);
  sendMock.mockReset().mockResolvedValue({ id: "email_1" });
  generateTextMock
    .mockReset()
    .mockResolvedValue({ text: JSON.stringify({ summary: "Buen día.", insights: ["hallazgo"], actions: ["acción"] }) });
});

it("no manda si no es Pro", async () => {
  await settings.set(SETTING_KEYS.dailyReport, "1");
  await seedActivity();
  const r = await sendDailyReport({ ...env, BOT_TIER: "free" } as Env, { now: NOW });
  expect(r.reason).toBe("not_pro");
  expect(sendMock).not.toHaveBeenCalled();
});

it("no manda si el toggle está apagado", async () => {
  await seedActivity();
  const r = await sendDailyReport(env, { now: NOW });
  expect(r.reason).toBe("disabled");
});

it("manda el reporte con stats + insights en un día con actividad", async () => {
  await settings.set(SETTING_KEYS.dailyReport, "1");
  await seedActivity();
  const r = await sendDailyReport(env, { now: NOW });
  expect(r.sent).toBe(true);
  expect(r.stats?.newLeads).toBe(1);
  expect(r.stats?.customerMessages).toBe(1);
  expect(sendMock).toHaveBeenCalledTimes(1);
  const [payload] = sendMock.mock.calls[0] as [{ html: string; subject: string }];
  expect(payload.html).toContain("Horizontes IA");
  expect(payload.html).toContain("Buen día."); // el resumen de la IA
  // guardó el HTML rico para servir en /admin/report
  expect(await settings.get(SETTING_KEYS.reportLastHtml)).toContain("Reporte de operación");
});

it("no manda dos veces el mismo día (throttle)", async () => {
  await settings.set(SETTING_KEYS.dailyReport, "1");
  await seedActivity();
  await sendDailyReport(env, { now: NOW });
  sendMock.mockClear();
  const r2 = await sendDailyReport(env, { now: NOW + 3600_000 });
  expect(r2.reason).toBe("throttled");
  expect(sendMock).not.toHaveBeenCalled();
});

it("no molesta en un día sin actividad", async () => {
  await settings.set(SETTING_KEYS.dailyReport, "1");
  const r = await sendDailyReport(env, { now: NOW });
  expect(r.sent).toBe(false);
  expect(r.reason).toBe("no_channel_or_empty");
  expect(sendMock).not.toHaveBeenCalled();
});

describe("collectDailyStats", () => {
  it("cuenta solo la actividad de las últimas 24h", async () => {
    await seedActivity();
    const conv = await convs.getOrCreate("telegram", "old", "Viejo");
    await msgs.append(conv.id, "user", "viejo", { createdAt: NOW - 48 * 3600_000 });
    const stats = await collectDailyStats(env, NOW);
    expect(stats.newLeads).toBe(1);
    expect(stats.customerMessages).toBe(1);
  });
});
