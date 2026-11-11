/**
 * Wiring del Blindaje dentro de SupportAgent.processBuffer:
 *  • la verificación corre DESPUÉS de armar la respuesta y ANTES del envío
 *  • unsupported → se envía y PERSISTE la respuesta segura (no la inventada)
 *  • verificador falla → fail-open: se envía la original
 *  • tier free → ni una llamada al verificador
 *  • searchKb del turno alimenta al verificador y revive lastSearchKbScore
 * Mismo patrón de mocks que test/agent.media.test.ts (base Agent + "ai").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bustTierCache } from "../../src/tier";

vi.mock("agents", () => ({
  Agent: class {
    ctx: any;
    env: any;
    state: any;
    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
    setState(s: any) {
      this.state = s;
    }
    sql(..._args: any[]) {
      return undefined;
    }
  },
}));

const streamTextMock = vi.fn();
const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  generateText: (...args: any[]) => generateTextMock(...args),
  tool: (def: any) => def,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { SupportAgent } from "../../src/agent";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { SettingsRepo } from "../../src/db/settings";
import { TicketsRepo } from "../../src/db/tickets";
import * as senderMod from "../../src/replies/sender";
import { safeConfirmReply } from "../../src/blindaje/verify";

const KB_MATCHES = [
  { score: 0.42, metadata: { title: "Precios", content: "Corte de cabello: $150." } },
];

function makeAgent(tier: "free" | "pro") {
  const storage = { setAlarm: vi.fn(), getAlarm: vi.fn() };
  const env: any = {
    DB: {},
    AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })) },
    KB: { query: vi.fn(async () => ({ matches: KB_MATCHES })) },
    ANTHROPIC_API_KEY: "sk-test",
    BOT_TIER: tier,
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
    DASHBOARD_BASE_URL: "https://dash.test",
  };
  // waitUntil: aunque este archivo no ejercita la rama pausada de ingest()
  // (que es la que lo usa), lo agregamos por consistencia con el ctx real —
  // que un test futuro aquí no se tope con "waitUntil is not a function".
  const agent: any = new (SupportAgent as any)({ storage, waitUntil: vi.fn() }, env);
  agent.setState({
    conversationId: "conv-1",
    channel: "telegram",
    channelUserId: "u1",
    pendingMessages: [],
    lastAlarmAt: 0,
    lastUserLang: "es",
    toolCallsInLast2Turns: 0,
    lastSearchKbScore: 1,
    imageRetryCount: 0,
    lastMessagePushAt: 0,
  });
  return agent;
}

let sendReplyMock: ReturnType<typeof vi.fn>;
let appendSpy: ReturnType<typeof vi.spyOn>;
let ticketCreateSpy: ReturnType<typeof vi.spyOn>;

/** Corre processBuffer con el "modelo" respondiendo `replyText`; si
 *  `callSearchKb`, el stream simula que el LLM llamó a la tool searchKb real. */
async function runTurn(agent: any, replyText: string, opts: { callSearchKb?: boolean } = {}) {
  streamTextMock.mockReset();
  streamTextMock.mockImplementation((args: any) => ({
    textStream: (async function* () {
      if (opts.callSearchKb && args.tools?.searchKb) {
        await args.tools.searchKb.execute({ query: "cuánto cuesta el corte" }, {} as any);
      }
      yield replyText;
    })(),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
    steps: Promise.resolve([{ toolCalls: [] }]),
  }));

  agent.state.pendingMessages = [{ text: "hola, precio?", receivedAt: Date.now() }];
  await agent.processBuffer();
}

beforeEach(() => {
    bustTierCache();
  vi.restoreAllMocks();
  // resolveAgentConfig lee settings de D1; aquí no hay D1 real → sin overrides.
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue({});
  // bumpCounter (contadores del panel) usa get/set — no-op en el test.
  vi.spyOn(SettingsRepo.prototype, "get").mockResolvedValue(null);
  vi.spyOn(SettingsRepo.prototype, "set").mockResolvedValue(undefined);

  appendSpy = vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue(undefined as any);
  vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
    { role: "user", content: "hola, precio?" },
  ] as any);
  vi.spyOn(ConversationsRepo.prototype, "touchLastMessage").mockResolvedValue(undefined as any);
  vi.spyOn(ConversationsRepo.prototype, "setOpenTicket").mockResolvedValue(undefined as any);
  ticketCreateSpy = vi
    .spyOn(TicketsRepo.prototype, "create")
    .mockResolvedValue("ticket-1") as any;

  sendReplyMock = vi.fn(async () => {});
  vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply: sendReplyMock } as any);

  generateTextMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SupportAgent.processBuffer — hook del Blindaje", () => {
  it("unsupported → envía y persiste la respuesta segura + abre ticket", async () => {
    generateTextMock.mockResolvedValue({
      text: '{"supported": false, "unsupported_claim": "el corte cuesta $80"}',
    });
    const agent = makeAgent("pro");

    await runTurn(agent, "¡Claro! El corte cuesta $80.", { callSearchKb: true });

    const safe = safeConfirmReply("es");
    // Lo que salió al cliente es la respuesta segura, no el invento
    expect(sendReplyMock).toHaveBeenCalledTimes(1);
    expect(sendReplyMock.mock.calls[0][0].chunks[0]).toBe(safe);
    // Lo que quedó en la Bandeja es lo que el cliente realmente recibió
    const assistantAppend = appendSpy.mock.calls.find((c: any[]) => c[1] === "assistant");
    expect(assistantAppend?.[2]).toBe(safe);
    // Ticket con el claim, vía la maquinaria del handoff
    expect(ticketCreateSpy).toHaveBeenCalledTimes(1);
    const ticketInput = ticketCreateSpy.mock.calls[0][0] as any;
    expect(ticketInput.summary).toContain("el corte cuesta $80");
    // El verificador recibió los pasajes de KB del turno como fuentes
    const prompt = (generateTextMock.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain("Corte de cabello: $150.");
  });

  it("supported → envía la respuesta original tal cual", async () => {
    generateTextMock.mockResolvedValue({ text: '{"supported": true}' });
    const agent = makeAgent("pro");

    await runTurn(agent, "El corte cuesta $150, te agendo cuando gustes.", {
      callSearchKb: true,
    });

    expect(sendReplyMock.mock.calls[0][0].chunks[0]).toBe(
      "El corte cuesta $150, te agendo cuando gustes.",
    );
    expect(ticketCreateSpy).not.toHaveBeenCalled();
  });

  it("verificador truena → FAIL-OPEN: se envía la original", async () => {
    generateTextMock.mockRejectedValue(new Error("modelo caído"));
    const agent = makeAgent("pro");

    await runTurn(agent, "El corte cuesta $150.", { callSearchKb: true });

    expect(sendReplyMock).toHaveBeenCalledTimes(1);
    expect(sendReplyMock.mock.calls[0][0].chunks[0]).toBe("El corte cuesta $150.");
    expect(ticketCreateSpy).not.toHaveBeenCalled();
  });

  it("tier FREE → ni una llamada al verificador, la respuesta sale directa", async () => {
    const agent = makeAgent("free");

    await runTurn(agent, "El corte cuesta $9999.");

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(sendReplyMock.mock.calls[0][0].chunks[0]).toBe("El corte cuesta $9999.");
  });

  it("sin datos y sin KB → no se llama al verificador (respuesta directa)", async () => {
    const agent = makeAgent("pro");

    await runTurn(agent, "Con gusto te ayudo, cuéntame qué necesitas");

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(sendReplyMock.mock.calls[0][0].chunks[0]).toBe(
      "Con gusto te ayudo, cuéntame qué necesitas",
    );
  });

  it("revive lastSearchKbScore: toma el score top-1 real de searchKb", async () => {
    generateTextMock.mockResolvedValue({ text: '{"supported": true}' });
    const agent = makeAgent("pro");

    await runTurn(agent, "El corte cuesta $150.", { callSearchKb: true });
    expect(agent.state.lastSearchKbScore).toBe(0.42);

    // Turno sin búsqueda → regresa a neutral (el boost dura un turno)
    await runTurn(agent, "¡Va, aquí te espero!");
    expect(agent.state.lastSearchKbScore).toBe(1);
  });
});
