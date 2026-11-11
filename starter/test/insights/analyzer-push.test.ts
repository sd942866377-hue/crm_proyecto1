/**
 * Integración: el Analista dispara el push de Forja Inbox desde la MISMA
 * calificación (cero IA extra). Cubre el cableado real:
 *  • grader angry → push 'upset'
 *  • grader cancel_intent → push 'cancel'
 *  • frustrado la 1a vez (sin prior) → nada; frustrado OTRA vez (prior frustrado)
 *    → 'upset' (lee el sentiment anterior antes de que el upsert lo pise)
 *  • tranquilo → nada
 *
 * ai.generateText y provider mockeados (patrón de analyzer.test.ts);
 * dispatchMobilePush espiado; notifyOwner silenciado; D1 real vía miniflare.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
const dispatchMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  tool: (def: unknown) => def,
}));

vi.mock("../../src/llm/provider", () => ({
  envKeyFor: () => undefined,
  fallbackModel: () => null,
  createModel: () => ({
    provider: "anthropic",
    modelId: "claude-haiku-test",
    model: { modelId: "claude-haiku-test" },
    supportsPromptCache: true,
  }),
}));

vi.mock("../../src/mobile-push", () => ({
  dispatchMobilePush: (...args: unknown[]) => dispatchMock(...args),
}));

// Silenciar el aviso al dueño (la otra rama del Analista) para aislar el push.
vi.mock("../../src/tools/handoffHuman", () => ({
  notifyOwner: vi.fn().mockResolvedValue(undefined),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { analyzeConversations, IDLE_MS } from "../../src/insights/analyzer";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;

const angryGrade = {
  sentiment: "angry",
  resolution: "unresolved",
  bot_score: 2,
  topics: ["pedido"],
  summary: "María lleva dos mensajes molesta por su pedido.",
  missed_kb: null,
  sale_opportunity: false,
};

const cancelGrade = {
  sentiment: "frustrated",
  resolution: "unresolved",
  bot_score: 3,
  topics: ["membresía"],
  summary: "Pidió cancelar su membresía.",
  missed_kb: null,
  sale_opportunity: false,
  cancel_intent: true,
};

const frustratedGrade = {
  sentiment: "frustrated",
  resolution: "unresolved",
  bot_score: 3,
  topics: ["acceso"],
  summary: "Sigue sin poder entrar y se nota fastidiado.",
  missed_kb: null,
  sale_opportunity: false,
};

const calmGrade = {
  sentiment: "positive",
  resolution: "resolved",
  bot_score: 5,
  topics: ["horario"],
  summary: "Preguntó el horario y quedó conforme.",
  missed_kb: null,
  sale_opportunity: false,
};

async function seedIdleConversation(userId: string, displayName?: string): Promise<string> {
  const conv = await convs.getOrCreate("whatsapp", userId, displayName);
  const old = Date.now() - IDLE_MS - 60_000;
  await msgs.append(conv.id, "user", "Sigo esperando", { createdAt: old - 2000 });
  await msgs.append(conv.id, "assistant", "Déjame revisar.", { createdAt: old - 1000 });
  await convs.touchLastMessage(conv.id, old);
  return conv.id;
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    BOT_TIER: "pro",
    BUSINESS_NAME: "Negocio Test",
    CONTROL_PLANE_TOKEN: "fcp",
  } as unknown as Env;
  db = new Db(d1);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  generateTextMock.mockReset();
  dispatchMock.mockReset();
  dispatchMock.mockResolvedValue(undefined);
});

describe("Analista → push Forja Inbox", () => {
  it("grader angry → push 'upset'", async () => {
    generateTextMock.mockResolvedValue({ text: JSON.stringify(angryGrade) });
    const convId = await seedIdleConversation("521555000001", "María");

    const res = await analyzeConversations(env);
    expect(res.analyzed).toBe(1);
    expect(res.errors).toBe(0);

    const upset = dispatchMock.mock.calls.find((c) => (c[1] as { type: string }).type === "upset");
    expect(upset).toBeTruthy();
    const ev = upset![1] as { type: string; title: string; conversationId: string };
    expect(ev.title).toBe("😠 María está molesto");
    expect(ev.conversationId).toBe(convId);
  });

  it("grader con cancel_intent → push 'cancel'", async () => {
    generateTextMock.mockResolvedValue({ text: JSON.stringify(cancelGrade) });
    await seedIdleConversation("521555000002", "Luis");

    await analyzeConversations(env);
    const cancel = dispatchMock.mock.calls.find((c) => (c[1] as { type: string }).type === "cancel");
    expect(cancel).toBeTruthy();
    expect((cancel![1] as { title: string }).title).toBe("🚫 Luis quiere darse de baja");
  });

  it("frustrado 1a vez → nada; frustrado OTRA vez (prior frustrado) → 'upset'", async () => {
    generateTextMock.mockResolvedValue({ text: JSON.stringify(frustratedGrade) });
    const convId = await seedIdleConversation("521555000003", "Ana");

    await analyzeConversations(env);
    expect(dispatchMock).not.toHaveBeenCalled(); // frustrado aislado no despierta

    // Regresa fastidiada y se vuelve a calificar (prior = frustrado).
    const later = Date.now() - IDLE_MS - 1000;
    await msgs.append(convId, "user", "¿¡Sigue sin funcionar!?", { createdAt: later });
    await convs.touchLastMessage(convId, later);
    await db.run("UPDATE conversation_insights SET analyzed_at = ? WHERE conversation_id = ?", [
      later - 5000,
      convId,
    ]);

    await analyzeConversations(env);
    const upset = dispatchMock.mock.calls.find((c) => (c[1] as { type: string }).type === "upset");
    expect(upset).toBeTruthy();
  });

  it("grader tranquilo → sin push", async () => {
    generateTextMock.mockResolvedValue({ text: JSON.stringify(calmGrade) });
    await seedIdleConversation("521555000004", "Pedro");
    await analyzeConversations(env);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
