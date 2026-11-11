/**
 * Tests de Recupera no-shows / leads fríos (runReengage): selección de leads
 * calientes fríos 2-7 días, entrega honesta por canal (Telegram free-form
 * out-of-window; WhatsApp fuera de ventana requiere plantilla), y claim único.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
const sendReplyMock = vi.fn();
const sendTemplateMock = vi.fn(); // Twilio
const sendWaTemplateMock = vi.fn(); // Cloud API oficial

vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }));
vi.mock("../../src/llm/provider", () => ({
  // llm/work-model arma con estas dos la cadena de respaldo (el failover que
  // ya tenía el agente). Aquí: un solo candidato, el de createModel.
  envKeyFor: () => undefined,
  fallbackModel: () => null,
  createModel: () => ({ provider: "anthropic", modelId: "m", model: {}, supportsPromptCache: true }),
}));
vi.mock("../../src/replies/sender", () => ({
  pickAdapter: () => ({ sendReply: (...a: unknown[]) => sendReplyMock(...a) }),
}));
vi.mock("../../src/campaigns", () => ({
  sendTwilioTemplate: (...a: unknown[]) => sendTemplateMock(...a),
}));
vi.mock("../../src/channels/whatsapp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/channels/whatsapp")>();
  return { ...actual, sendWhatsappTemplate: (...a: unknown[]) => sendWaTemplateMock(...a) };
});

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { InsightsRepo } from "../../src/db/insights";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { runReengage } from "../../src/followup/reengage";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let insights: InsightsRepo;
let settings: SettingsRepo;

const NOW = Date.now();
const COLD = NOW - 4 * 24 * 60 * 60 * 1000; // 4 días atrás: dentro de 2-7 días

async function seedHot(userId: string, channel: string, userAt = COLD): Promise<string> {
  const conv = await convs.getOrCreate(channel, userId, `Lead ${userId}`);
  await msgs.append(conv.id, "user", "me interesa", { createdAt: userAt - 1000 });
  await msgs.append(conv.id, "assistant", "claro, te cuento", { createdAt: userAt + 500 });
  await convs.touchLastMessage(conv.id, userAt + 500);
  await insights.upsert({
    conversationId: conv.id,
    sentiment: "positive",
    resolution: "unresolved",
    botScore: 4,
    topics: [],
    summary: "interesado",
    missedKb: null,
    saleOpportunity: true,
  });
  return conv.id;
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
  } as unknown as Env;
  db = new Db(d1);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  insights = new InsightsRepo(db);
  settings = new SettingsRepo(db);
  generateTextMock.mockReset().mockResolvedValue({ text: "¡Hola! ¿Seguimos con lo que hablamos?" });
  sendReplyMock.mockReset().mockResolvedValue(undefined);
  sendTemplateMock.mockReset().mockResolvedValue(undefined);
  sendWaTemplateMock.mockReset().mockResolvedValue(undefined);
  await settings.set(SETTING_KEYS.reengageColdLeads, "1");
});

it("no hace nada si el toggle está apagado", async () => {
  await settings.set(SETTING_KEYS.reengageColdLeads, "0");
  await seedHot("a", "telegram");
  const r = await runReengage(env, { now: NOW });
  expect(r).toEqual({ sent: 0, skipped: 0, errors: 0 });
});

it("reengancha un lead frío en Telegram (free-form out-of-window)", async () => {
  await seedHot("a", "telegram");
  const r = await runReengage(env, { now: NOW });
  expect(r.sent).toBe(1);
  expect(sendReplyMock).toHaveBeenCalledTimes(1);
});

it("en WhatsApp fuera de ventana SIN plantilla → skip, no quema el claim", async () => {
  await seedHot("a", "twilio");
  const r = await runReengage(env, { now: NOW });
  expect(r.sent).toBe(0);
  expect(r.skipped).toBe(1);
  expect(sendReplyMock).not.toHaveBeenCalled();
  expect(sendTemplateMock).not.toHaveBeenCalled();
  // claim NO escrito → puede reengancharse después
  const row = await db.first<{ n: number }>("SELECT COUNT(*) n FROM reengage_sends", []);
  expect(row?.n).toBe(0);
});

it("en WhatsApp (Twilio) fuera de ventana CON plantilla → usa el Content SID de Twilio", async () => {
  await settings.set(SETTING_KEYS.reengageTemplateSid, "HXtemplate123");
  await seedHot("a", "twilio");
  const r = await runReengage(env, { now: NOW });
  expect(r.sent).toBe(1);
  expect(sendTemplateMock).toHaveBeenCalledTimes(1);
  expect(sendWaTemplateMock).not.toHaveBeenCalled();
  expect(sendReplyMock).not.toHaveBeenCalled();
});

it("en WhatsApp (Cloud API oficial) fuera de ventana CON nombre → usa la plantilla de Meta, no Twilio", async () => {
  await settings.set(SETTING_KEYS.reengageTemplateName, "reenganche_lead");
  await settings.set(SETTING_KEYS.reengageTemplateLang, "es_MX");
  await seedHot("a", "whatsapp");
  const r = await runReengage(env, { now: NOW });
  expect(r.sent).toBe(1);
  expect(sendWaTemplateMock).toHaveBeenCalledTimes(1);
  const [, to, name, lang] = sendWaTemplateMock.mock.calls[0];
  expect(name).toBe("reenganche_lead");
  expect(lang).toBe("es_MX");
  expect(to).toBe("a");
  expect(sendTemplateMock).not.toHaveBeenCalled(); // NO usó Twilio
});

it("en WhatsApp (Cloud API oficial) fuera de ventana SIN nombre → skip (el SID de Twilio no aplica)", async () => {
  await settings.set(SETTING_KEYS.reengageTemplateSid, "HXtemplate123"); // configurado, pero es de Twilio
  await seedHot("a", "whatsapp");
  const r = await runReengage(env, { now: NOW });
  expect(r.sent).toBe(0);
  expect(r.skipped).toBe(1);
  expect(sendWaTemplateMock).not.toHaveBeenCalled();
  expect(sendTemplateMock).not.toHaveBeenCalled();
});

it("claim único: no reengancha dos veces la misma conversación", async () => {
  await seedHot("a", "telegram");
  await runReengage(env, { now: NOW });
  sendReplyMock.mockClear();
  const r2 = await runReengage(env, { now: NOW + 1000 });
  expect(r2.sent).toBe(0);
  expect(sendReplyMock).not.toHaveBeenCalled();
});

it("no toca leads tibios (sin sale_opportunity ni keyword)", async () => {
  const conv = await convs.getOrCreate("telegram", "tibio", "Tibio");
  await msgs.append(conv.id, "user", "hola", { createdAt: COLD - 1000 });
  await msgs.append(conv.id, "assistant", "hola!", { createdAt: COLD });
  await convs.touchLastMessage(conv.id, COLD);
  const r = await runReengage(env, { now: NOW });
  expect(r.sent).toBe(0);
});
