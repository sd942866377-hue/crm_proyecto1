/**
 * Tests de los superpoderes de outreach: Encuestas de satisfacción + Pide
 * reseñas (runOutreach) y la captura de la calificación (captureSurveyResponses
 * / parseScore). LLM + adapter + messageOwner mockeados; D1 real via miniflare.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
const sendReplyMock = vi.fn();
const messageOwnerMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...a: unknown[]) => generateTextMock(...a),
}));
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
vi.mock("../../src/tools/handoffHuman", () => ({
  messageOwner: (...a: unknown[]) => messageOwnerMock(...a),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { runOutreach } from "../../src/followup/outreach";
import {
  captureSurveyResponses,
  parseScore,
} from "../../src/followup/surveyResponse";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let settings: SettingsRepo;

const NOW = Date.now();
const IN_WINDOW = NOW - 3 * 60 * 60 * 1000; // 3h atrás: dentro de la ventana 1-20h

async function seed(userId: string, opts: { userAt?: number; userMsgs?: number; endsWithUser?: boolean; channel?: string } = {}): Promise<string> {
  const userAt = opts.userAt ?? IN_WINDOW;
  const n = opts.userMsgs ?? 2;
  const conv = await convs.getOrCreate(opts.channel ?? "telegram", userId, `Lead ${userId}`);
  for (let i = 0; i < n; i++) {
    await msgs.append(conv.id, "user", `msg ${i + 1}`, { createdAt: userAt - (n - i) * 1000 });
  }
  if (!opts.endsWithUser) {
    await msgs.append(conv.id, "assistant", "respuesta", { createdAt: userAt + 500 });
  }
  await convs.touchLastMessage(conv.id, userAt + (opts.endsWithUser ? 0 : 500));
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
    DASHBOARD_BASE_URL: "https://panel.test",
  } as unknown as Env;
  db = new Db(d1);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  settings = new SettingsRepo(db);
  generateTextMock.mockReset().mockResolvedValue({ text: '{"resolved":true,"sentiment":"positive"}' });
  sendReplyMock.mockReset().mockResolvedValue(undefined);
  messageOwnerMock.mockReset().mockResolvedValue(undefined);
});

describe("runOutreach — encuestas", () => {
  it("no hace nada si ningún toggle está activo", async () => {
    await seed("a");
    const r = await runOutreach(env, { now: NOW });
    expect(r).toEqual({ surveys: 0, reviews: 0, skipped: 0, errors: 0 });
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("manda la encuesta a una conversación resuelta en ventana", async () => {
    await settings.set(SETTING_KEYS.satisfactionSurvey, "1");
    await seed("a");
    const r = await runOutreach(env, { now: NOW });
    expect(r.surveys).toBe(1);
    expect(sendReplyMock).toHaveBeenCalledTimes(1);
    // claim escrito
    const row = await db.first<{ n: number }>("SELECT COUNT(*) n FROM survey_sends", []);
    expect(row?.n).toBe(1);
  });

  it("NO manda si el modelo dice que no quedó resuelta", async () => {
    await settings.set(SETTING_KEYS.satisfactionSurvey, "1");
    generateTextMock.mockResolvedValue({ text: '{"resolved":false,"sentiment":"neutral"}' });
    await seed("a");
    const r = await runOutreach(env, { now: NOW });
    expect(r.surveys).toBe(0);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("no repite encuesta (claim único de por vida)", async () => {
    await settings.set(SETTING_KEYS.satisfactionSurvey, "1");
    await seed("a");
    await runOutreach(env, { now: NOW });
    sendReplyMock.mockClear();
    const r2 = await runOutreach(env, { now: NOW + 1000 });
    expect(r2.surveys).toBe(0);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("respeta free tier (no Pro → no manda)", async () => {
    await settings.set(SETTING_KEYS.satisfactionSurvey, "1");
    await seed("a");
    const r = await runOutreach({ ...env, BOT_TIER: "free" } as Env, { now: NOW });
    expect(r).toEqual({ surveys: 0, reviews: 0, skipped: 0, errors: 0 });
  });

  it("modo abierto: la encuesta pide opinión en palabras (no un número)", async () => {
    await settings.set(SETTING_KEYS.satisfactionSurvey, "1");
    await settings.set(SETTING_KEYS.surveyMode, "abierto");
    await seed("uOpen");
    const r = await runOutreach(env, { now: NOW });
    expect(r.surveys).toBe(1);
    // el primer arg de sendReply es el payload (con el texto); el 2º es env (RPC, no serializable)
    expect(JSON.stringify(sendReplyMock.mock.calls[0]?.[0] ?? {})).toContain("en tus palabras");
  });
});

describe("runOutreach — reseñas", () => {
  it("pide reseña solo si hay review_url y el cliente quedó contento", async () => {
    await settings.set(SETTING_KEYS.reviewRequests, "1");
    await settings.set(SETTING_KEYS.reviewUrl, "https://g.page/r/negocio");
    await seed("happy");
    const r = await runOutreach(env, { now: NOW });
    expect(r.reviews).toBe(1);
    const call = sendReplyMock.mock.calls[0][0];
    expect(call.chunks[0]).toContain("https://g.page/r/negocio");
  });

  it("NO pide reseña si el cliente quedó neutral/molesto", async () => {
    await settings.set(SETTING_KEYS.reviewRequests, "1");
    await settings.set(SETTING_KEYS.reviewUrl, "https://g.page/r/negocio");
    generateTextMock.mockResolvedValue({ text: '{"resolved":true,"sentiment":"neutral"}' });
    await seed("meh");
    const r = await runOutreach(env, { now: NOW });
    expect(r.reviews).toBe(0);
  });

  it("NO pide reseña sin review_url configurada", async () => {
    await settings.set(SETTING_KEYS.reviewRequests, "1");
    await seed("happy");
    const r = await runOutreach(env, { now: NOW });
    expect(r.reviews).toBe(0);
  });
});

describe("parseScore", () => {
  it("extrae 1-5 de números aislados", () => {
    expect(parseScore("5")).toBe(5);
    expect(parseScore("un 4 la verdad")).toBe(4);
    expect(parseScore("le pongo 1")).toBe(1);
  });
  it("no confunde con números grandes", () => {
    expect(parseScore("2026")).toBe(null);
    expect(parseScore("mi tel 5512345678")).toBe(null);
  });
  it("entiende palabras comunes", () => {
    expect(parseScore("excelente servicio")).toBe(5);
    expect(parseScore("pésimo, horrible")).toBe(1);
  });
  it("null si no hay señal", () => {
    expect(parseScore("gracias")).toBe(null);
  });
});

describe("captureSurveyResponses", () => {
  async function sendSurvey(convId: string, at: number) {
    await db.run("INSERT INTO survey_sends (conversation_id, sent_at) VALUES (?, ?)", [convId, at]);
  }

  it("guarda la calificación cuando el cliente responde un número", async () => {
    const conv = await convs.getOrCreate("telegram", "u1", "Ana");
    await sendSurvey(conv.id, NOW - 1000);
    await msgs.append(conv.id, "user", "5", { createdAt: NOW });
    const r = await captureSurveyResponses(env, { now: NOW + 100 });
    expect(r.scored).toBe(1);
    expect(r.alerted).toBe(0);
    const row = await db.first<{ score: number }>("SELECT score FROM survey_sends WHERE conversation_id = ?", [conv.id]);
    expect(row?.score).toBe(5);
  });

  it("alerta al dueño cuando la calificación es baja (≤2)", async () => {
    const conv = await convs.getOrCreate("telegram", "u2", "Beto");
    await sendSurvey(conv.id, NOW - 1000);
    await msgs.append(conv.id, "user", "1", { createdAt: NOW });
    const r = await captureSurveyResponses(env, { now: NOW + 100 });
    expect(r.scored).toBe(1);
    expect(r.alerted).toBe(1);
    expect(messageOwnerMock).toHaveBeenCalledTimes(1);
  });

  it("ignora encuestas sin respuesta numérica (modo numérico)", async () => {
    const conv = await convs.getOrCreate("telegram", "u3", "Cyn");
    await sendSurvey(conv.id, NOW - 1000);
    await msgs.append(conv.id, "user", "gracias!", { createdAt: NOW });
    const r = await captureSurveyResponses(env, { now: NOW + 100 });
    expect(r.scored).toBe(0);
    expect(r.open).toBe(0);
  });

  it("modo abierto: guarda la opinión de texto libre (no la pierde)", async () => {
    await settings.set(SETTING_KEYS.surveyMode, "abierto");
    const conv = await convs.getOrCreate("telegram", "uo1", "Ana");
    await sendSurvey(conv.id, NOW - 1000);
    await msgs.append(conv.id, "user", "me atendieron increíble, gracias", { createdAt: NOW });
    const r = await captureSurveyResponses(env, { now: NOW + 100 });
    expect(r.open).toBe(1);
    expect(r.scored).toBe(0);
    const row = await db.first<{ response_text: string }>(
      "SELECT response_text FROM survey_open_responses WHERE conversation_id = ?",
      [conv.id],
    );
    expect(row?.response_text).toContain("increíble");
    // marcada como respondida → no se reprocesa
    const s = await db.first<{ responded_at: number | null }>(
      "SELECT responded_at FROM survey_sends WHERE conversation_id = ?",
      [conv.id],
    );
    expect(s?.responded_at).not.toBeNull();
  });

  it("modo ambos: guarda el número Y el comentario", async () => {
    await settings.set(SETTING_KEYS.surveyMode, "ambos");
    const conv = await convs.getOrCreate("telegram", "uo2", "Beto");
    await sendSurvey(conv.id, NOW - 1000);
    await msgs.append(conv.id, "user", "5, todo excelente", { createdAt: NOW });
    const r = await captureSurveyResponses(env, { now: NOW + 100 });
    expect(r.scored).toBe(1);
    expect(r.open).toBe(1);
    const row = await db.first<{ score: number }>(
      "SELECT score FROM survey_sends WHERE conversation_id = ?",
      [conv.id],
    );
    expect(row?.score).toBe(5);
  });
});
