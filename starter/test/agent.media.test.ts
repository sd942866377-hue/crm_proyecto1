import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bustTierCache } from "../src/tier";

// `SupportAgent` extends `Agent` from the `agents` SDK, which (via
// `partyserver`) imports the virtual `cloudflare:workers` module at load time —
// Node's ESM loader can't resolve the `cloudflare:` scheme outside workerd.
// Mock the `agents` package (same pattern as test/index.test.ts) so the import
// graph stays in Node-land. The base class accepts (ctx, env) and stashes them,
// so we can instantiate SupportAgent via `new` — this runs the class field
// initializers, including the arrow-function `alarm` field (which is NOT on the
// prototype and would be undefined under Object.create()).
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
    // Tagged-template stub: ingest() upserts into cf_agents_schedules via this.sql
    sql(..._args: any[]) {
      return undefined;
    }
  },
}));

// El handoff por archivo del cliente escala vía createHandoffTicket (ticket +
// aviso al dueño + push a la app): aquí solo se verifica QUE se llame.
const { handoffTicketMock } = vi.hoisted(() => ({ handoffTicketMock: vi.fn() }));
vi.mock("../src/tools/handoffHuman", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/tools/handoffHuman")>();
  return { ...mod, createHandoffTicket: handoffTicketMock };
});

import { SupportAgent } from "../src/agent";
import { Db } from "../src/db/client";
import { ConversationsRepo } from "../src/db/conversations";
import { MessagesRepo } from "../src/db/messages";
import { SettingsRepo } from "../src/db/settings";
import * as senderMod from "../src/replies/sender";

// resolveAgentConfig() (used by both ingest() and alarm()) reads the D1
// `settings` table via SettingsRepo. These tests run against a fake env.DB ({}),
// so stub the repo to return no overrides → all config falls back to env/defaults
// (bot not paused, BUFFER_SECONDS-derived buffer, maxChunks=3, delay=1000ms,
// modelOverride="auto"). Call AFTER vi.restoreAllMocks() in each beforeEach.
function stubSettings(overrides: Record<string, string> = {}) {
  vi.spyOn(SettingsRepo.prototype, "all").mockResolvedValue(overrides);
}

// Task 6.3: voice transcription + image input wired into ingest()/alarm().
// All media + LLM calls are mocked — no real network to Workers AI or Anthropic.
// Audio: the REAL transcribeAudio runs but hits a fake env.AI + stubbed fetch
// (same no-network pattern as test/media/transcribe.test.ts), so the dynamic
// import("./media/transcribe") inside ingest() resolves to the real module.

const streamTextMock = vi.fn();

vi.mock("ai", () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (def: any) => def,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

function makeStreamResult(text: string) {
  async function* gen() {
    yield text;
  }
  return {
    textStream: gen(),
    usage: Promise.resolve({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 0,
    }),
    steps: Promise.resolve([{ toolCalls: [] }]),
  };
}

function makeAgent(opts?: { tier?: "free" | "pro"; aiText?: string }) {
  const storage = { setAlarm: vi.fn(), getAlarm: vi.fn() };
  // waitUntil: el push best-effort en la rama pausada de ingest() ahora se
  // dispara vía this.ctx.waitUntil (no bloquea el ack) — DurableObjectState
  // real lo trae; el mock necesita el mismo método o revienta con
  // "waitUntil is not a function" en cuanto lastMessagePushAt supere el throttle.
  const waitUntil = vi.fn();

  const env: any = {
    DB: {},
    AI: { run: vi.fn(async () => ({ text: opts?.aiText ?? "" })) },
    ANTHROPIC_API_KEY: "sk-test",
    BOT_TIER: opts?.tier ?? "free",
    BOT_LANGUAGE: "es",
    BUFFER_SECONDS: "8",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "TestCo",
  };

  // Instantiate via the constructor so class field initializers run — this is
  // what makes the arrow-function `alarm` field exist on the instance.
  // `setState` lives on the mocked base `Agent` prototype.
  const agent: any = new (SupportAgent as any)({ storage, waitUntil }, env);
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

  return { agent, env, storage, waitUntil };
}

function stubConversations(opts?: { paused?: boolean }) {
  vi.spyOn(ConversationsRepo.prototype, "getOrCreate").mockResolvedValue({
    id: "conv-1",
    paused_until: null,
  } as any);
  vi.spyOn(ConversationsRepo.prototype, "isPaused").mockResolvedValue(
    opts?.paused ?? false,
  );
}

describe("SupportAgent.ingest — media (Task 6.3)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    bustTierCache();
    vi.restoreAllMocks();
    stubSettings();
    originalFetch = globalThis.fetch;
    // Audio download is stubbed: transcribeAudio fetches the audioUrl then
    // hands bytes to env.AI.run — neither touches the real network.
    globalThis.fetch = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3])),
    ) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("transcribes audio and buffers it as text", async () => {
    const { agent } = makeAgent({ aiText: "hola desde un audio" });
    stubConversations();

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      audioUrl: "https://example.com/voice.ogg",
    });

    expect(agent.env.AI.run).toHaveBeenCalled();
    expect(agent.state.pendingMessages).toHaveLength(1);
    expect(agent.state.pendingMessages[0].text).toBe("hola desde un audio");
  });

  it("falls back to a friendly message when transcription throws", async () => {
    const { agent } = makeAgent();
    stubConversations();
    // Make the audio fetch fail → transcribeAudio throws → ingest catches it.
    (globalThis.fetch as any).mockRejectedValueOnce(new Error("network down"));

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      audioUrl: "https://example.com/voice.ogg",
    });

    expect(agent.state.pendingMessages[0].text).toBe(
      "(no pude entender el audio)",
    );
  });

  it("free tier: strips the image and informs the bot it's unsupported", async () => {
    const { agent } = makeAgent({ tier: "free" });
    stubConversations();

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      text: "mira esto",
      imageUrl: "https://example.com/pic.png",
    });

    const buffered = agent.state.pendingMessages[0].text;
    expect(buffered).toContain("mira esto");
    expect(buffered).toContain("no soporta análisis de imágenes");
    expect(buffered).not.toContain("IMAGE_URL");
  });

  it("pro tier: keeps the image as an [IMAGE_URL] marker in the buffer", async () => {
    const { agent } = makeAgent({ tier: "pro" });
    stubConversations();

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      text: "describe esta foto",
      imageUrl: "https://example.com/pic.png",
    });

    const buffered = agent.state.pendingMessages[0].text;
    expect(buffered).toContain("describe esta foto");
    expect(buffered).toContain("[IMAGE_URL: https://example.com/pic.png]");
    expect(agent.state.imageRetryCount).toBe(0);
  });
});

describe("SupportAgent.alarm — multimodal last message (Task 6.3)", () => {
  beforeEach(() => {
    bustTierCache();
    vi.restoreAllMocks();
    stubSettings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runAlarm(opts: { tier: "free" | "pro"; lastContent: string }) {
    const { agent } = makeAgent({ tier: opts.tier });

    // Fresh stream result per call (the async generator is one-shot).
    streamTextMock.mockReset();
    streamTextMock.mockImplementation(() => makeStreamResult("ok"));

    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
      { role: "user", content: "mensaje previo" },
      { role: "assistant", content: "respuesta previa" },
      { role: "user", content: opts.lastContent },
    ] as any);
    vi.spyOn(ConversationsRepo.prototype, "touchLastMessage").mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({
      sendReply: vi.fn(async () => {}),
    } as any);

    // Seed buffer so alarm processes
    agent.state.pendingMessages = [
      { text: opts.lastContent, receivedAt: Date.now() },
    ];

    await agent.processBuffer();
    return streamTextMock.mock.calls[0][0].messages;
  }

  it("pro tier: builds a multimodal message from the [IMAGE_URL] marker", async () => {
    const messages = await runAlarm({
      tier: "pro",
      lastContent: "describe esto\n[IMAGE_URL: https://example.com/pic.png]",
    });

    const last = messages[messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
    expect(last.content).toEqual([
      { type: "image", image: new URL("https://example.com/pic.png") },
      { type: "text", text: "describe esto" },
    ]);
  });

  // Los turnos VIEJOS pasan por mapMessageToAiTurn: ahí los marcadores son puro
  // ruido (la URL firmada ya expiró). El ÚLTIMO turno sigue leyendo el content
  // crudo del row para armar el mensaje multimodal — las dos cosas conviven.
  it("los turnos históricos llegan limpios y el último sigue siendo multimodal", async () => {
    const { agent } = makeAgent({ tier: "pro" });
    streamTextMock.mockReset();
    streamTextMock.mockImplementation(() => makeStreamResult("ok"));
    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue(undefined as any);
    vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
      { role: "user", content: "mira esta\n[IMAGE_URL: https://example.com/vieja.png]\n[MEDIA: 8f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f]" },
      { role: "owner", content: "[TPL:HX1] Hola Luis, te recordamos tu cita." },
      { role: "user", content: "y esta otra\n[IMAGE_URL: https://example.com/nueva.png]" },
    ] as any);
    vi.spyOn(ConversationsRepo.prototype, "touchLastMessage").mockResolvedValue(undefined as any);
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply: vi.fn(async () => {}) } as any);
    agent.state.pendingMessages = [{ text: "y esta otra", receivedAt: Date.now() }];

    await agent.processBuffer();
    const messages = streamTextMock.mock.calls[0][0].messages;
    const historicos = messages.filter((m: any) => typeof m.content === "string" && m.role !== "system");
    for (const m of historicos) {
      expect(m.content).not.toContain("IMAGE_URL");
      expect(m.content).not.toContain("MEDIA:");
      expect(m.content).not.toContain("TPL:");
    }
    expect(historicos.some((m: any) => m.content.includes("una foto"))).toBe(true);
    expect(historicos.some((m: any) => m.content === "Hola Luis, te recordamos tu cita.")).toBe(true);
    // El último turno conserva la imagen real.
    expect(messages[messages.length - 1].content).toEqual([
      { type: "image", image: new URL("https://example.com/nueva.png") },
      { type: "text", text: "y esta otra" },
    ]);
  });

  it("free tier: leaves the last message as plain text (no multimodal build)", async () => {
    const messages = await runAlarm({
      tier: "free",
      lastContent: "hola normal",
    });

    const last = messages[messages.length - 1];
    expect(last).toEqual({ role: "user", content: "hola normal" });
  });

  it("caches the system prompt as a SystemModelMessage with an ephemeral breakpoint", async () => {
    const { agent } = makeAgent({ tier: "free" });

    streamTextMock.mockReset();
    streamTextMock.mockImplementation(() => makeStreamResult("ok"));

    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
      { role: "user", content: "hola" },
    ] as any);
    vi.spyOn(ConversationsRepo.prototype, "touchLastMessage").mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({
      sendReply: vi.fn(async () => {}),
    } as any);

    agent.state.pendingMessages = [{ text: "hola", receivedAt: Date.now() }];
    await agent.processBuffer();

    const arg = streamTextMock.mock.calls[0][0];
    expect(Array.isArray(arg.system)).toBe(true);
    // Bloque [0] = prompt grande CACHEADO. Pueden seguir bloques chicos sin
    // caché (canal, memoria del cliente, A/B de venta) — esos no se fijan aquí.
    expect(arg.system.length).toBeGreaterThanOrEqual(1);
    expect(arg.system[0].role).toBe("system");
    expect(typeof arg.system[0].content).toBe("string");
    expect(arg.system[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("honors model_override=sonnet from settings", async () => {
    stubSettings({ model_override: "sonnet" });
    const { agent } = makeAgent({ tier: "free" });

    streamTextMock.mockReset();
    streamTextMock.mockImplementation(() => makeStreamResult("ok"));

    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(MessagesRepo.prototype, "lastN").mockResolvedValue([
      { role: "user", content: "hola" },
    ] as any);
    vi.spyOn(ConversationsRepo.prototype, "touchLastMessage").mockResolvedValue(
      undefined as any,
    );
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({
      sendReply: vi.fn(async () => {}),
    } as any);

    agent.state.pendingMessages = [{ text: "hola", receivedAt: Date.now() }];
    await agent.processBuffer();

    const arg = streamTextMock.mock.calls[0][0];
    expect(arg.model).toEqual({ modelId: "claude-sonnet-5" });
  });
});

describe("SupportAgent.ingest — bot_paused (settings)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    bustTierCache();
    vi.restoreAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("buffers the client message but does NOT arm the alarm when bot_paused=1", async () => {
    stubSettings({ bot_paused: "1" });
    const { agent, storage } = makeAgent({ tier: "free" });
    stubConversations();

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      text: "hola, estoy pausado?",
    });

    // Message is persisted in the buffer …
    expect(agent.state.pendingMessages).toHaveLength(1);
    expect(agent.state.pendingMessages[0].text).toBe("hola, estoy pausado?");
    // … but the bot stays silent: no alarm scheduled.
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });

  it("arms the alarm when bot is not paused", async () => {
    stubSettings();
    const { agent, storage } = makeAgent({ tier: "free" });
    stubConversations();

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      text: "hola",
    });

    expect(storage.setAlarm).toHaveBeenCalledTimes(1);
  });
});

// Fixes portados de la comunidad (PRs #6/#7 de conconfianza).
describe("ingest — mensajes en pausa y alarmas perdidas (PRs #6/#7)", () => {
  beforeEach(() => {
    bustTierCache();
    vi.restoreAllMocks();
    stubSettings();
  });

  it("#6 re-arma la alarma si la plataforma no la registró", async () => {
    const { agent, storage } = makeAgent({ tier: "free" });
    stubConversations();
    storage.getAlarm.mockResolvedValue(null); // la plataforma la perdió
    await agent.ingest({ channel: "telegram", channelUserId: "u1", text: "hola" });
    expect(storage.setAlarm).toHaveBeenCalledTimes(2);
  });

  it("#6 procesa casi al instante cuando un mensaje quedó varado", async () => {
    const { agent, storage } = makeAgent({ tier: "free" });
    stubConversations();
    agent.state.pendingMessages = [{ text: "hola", receivedAt: Date.now() - 600_000 }];
    const before = Date.now();
    await agent.ingest({ channel: "telegram", channelUserId: "u1", text: "hola?" });
    const alarmAt = storage.setAlarm.mock.calls[0][0];
    expect(alarmAt - before).toBeLessThan(2_000);
  });

  it("#7 con la conversación en pausa, registra el mensaje del cliente", async () => {
    const { agent } = makeAgent({ tier: "free" });
    stubConversations({ paused: true });
    const append = vi
      .spyOn(MessagesRepo.prototype, "append")
      .mockResolvedValue(undefined as any);
    await agent.ingest({ channel: "telegram", channelUserId: "u1", text: "necesito ayuda" });
    expect(append).toHaveBeenCalledWith("conv-1", "user", "necesito ayuda");
  });

  it("#7 el ping a la app móvil NO bloquea el ack (ctx.waitUntil) y se throttlea", async () => {
    const { agent, waitUntil } = makeAgent({ tier: "free" });
    stubConversations({ paused: true });
    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue(undefined as any);

    const result = await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      text: "necesito ayuda",
    });
    // ingest() ya resolvió (el ack se puede mandar) sin esperar el push: el
    // push va colgado de ctx.waitUntil, no de un await directo.
    expect(result).toEqual({ acknowledged: true });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    const pushPromise: Promise<unknown> = waitUntil.mock.calls[0][0];
    await pushPromise; // dispatchMobilePush no revienta sin CONTROL_PLANE_TOKEN (no-op)

    // Segundo mensaje inmediato en la misma conversación pausada: throttle —
    // NO manda un segundo push (nada de 15 mensajes = 15 notificaciones).
    await agent.ingest({ channel: "telegram", channelUserId: "u1", text: "otra vez" });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("#7 con el bot globalmente en pausa, registra el mensaje", async () => {
    const { agent } = makeAgent({ tier: "free" });
    stubConversations({ paused: false });
    stubSettings({ bot_paused: "1" });
    const append = vi
      .spyOn(MessagesRepo.prototype, "append")
      .mockResolvedValue(undefined as any);
    await agent.ingest({ channel: "telegram", channelUserId: "u1", text: "hola?" });
    expect(append).toHaveBeenCalledWith("conv-1", "user", "hola?");
  });
});

// Archivos del cliente (Contrato v3 §A4): hasta ahora un PDF se perdía en
// silencio en TODOS los canales — los parsers lo descartaban antes de llegar aquí.
describe("ingest — documento del cliente (Contrato v3 §A4)", () => {
  beforeEach(() => {
    bustTierCache();
    vi.restoreAllMocks();
    stubSettings();
    handoffTicketMock.mockReset();
    handoffTicketMock.mockResolvedValue({ ticketId: "t-1" });
    // El check de "¿ya hay ticket abierto?" corre contra D1.
    vi.spyOn(Db.prototype, "first").mockResolvedValue({ n: 0 } as any);
  });

  it("solo el archivo: lo registra, escala a una persona, contesta fijo y NO llama al LLM", async () => {
    const { agent } = makeAgent({ tier: "pro" });
    stubConversations();
    const append = vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue("msg-1" as any);
    const sendReply = vi.fn();
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply } as any);

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      fileUrl: "https://example.com/cotizacion.pdf",
      fileName: "cotizacion.pdf",
      fileMime: "application/pdf",
    });

    expect(handoffTicketMock).toHaveBeenCalledTimes(1);
    expect(handoffTicketMock.mock.calls[0][1]).toMatchObject({
      conversationId: "conv-1",
      reason: "archivo del cliente",
    });
    // El hilo muestra el archivo…
    expect(append.mock.calls[0]).toEqual([
      "conv-1",
      "user",
      expect.stringContaining("[FILE: cotizacion.pdf]"),
    ]);
    // …y el cliente no se queda en visto.
    expect(append.mock.calls[1][1]).toBe("assistant");
    expect(sendReply.mock.calls[0][0].chunks[0]).toContain("Recibí tu archivo");
    // Sin buffer = el archivo nunca entra al turno del LLM.
    expect(agent.state.pendingMessages).toHaveLength(0);
  });

  it("archivo CON texto: escala igual, pero el texto sí sigue al LLM", async () => {
    const { agent } = makeAgent({ tier: "pro" });
    stubConversations();
    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue("msg-1" as any);
    const sendReply = vi.fn();
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply } as any);

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      text: "¿me cotizas esto?",
      fileUrl: "https://example.com/plano.pdf",
      fileName: "plano.pdf",
    });

    expect(handoffTicketMock).toHaveBeenCalledTimes(1);
    expect(sendReply).not.toHaveBeenCalled(); // el bot contesta la pregunta, no la línea fija
    expect(agent.state.pendingMessages).toHaveLength(1);
    expect(agent.state.pendingMessages[0].text).toContain("¿me cotizas esto?");
    expect(agent.state.pendingMessages[0].text).toContain("[FILE: plano.pdf]");
  });

  it("con un ticket ya abierto no escala de nuevo (5 PDFs ≠ 5 avisos)", async () => {
    const { agent } = makeAgent({ tier: "pro" });
    stubConversations();
    vi.spyOn(Db.prototype, "first").mockResolvedValue({ n: 1 } as any);
    vi.spyOn(MessagesRepo.prototype, "append").mockResolvedValue("msg-1" as any);
    vi.spyOn(senderMod, "pickAdapter").mockReturnValue({ sendReply: vi.fn() } as any);

    await agent.ingest({
      channel: "telegram",
      channelUserId: "u1",
      fileUrl: "https://example.com/otro.pdf",
      fileName: "otro.pdf",
    });
    expect(handoffTicketMock).not.toHaveBeenCalled();
  });
});
