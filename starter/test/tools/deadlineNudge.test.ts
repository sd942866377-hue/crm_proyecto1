import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";

// Capturamos los envíos sin tocar la red (los adapters reales llaman fetch).
const sends = vi.hoisted(
  () => [] as { channel: string; userId: string; chunks: string[] }[],
);
vi.mock("../../src/replies/sender", () => ({
  pickAdapter: () => ({ sendReply: async () => {} }),
  sendChunkedReply: async (
    _adapter: unknown,
    channel: string,
    userId: string,
    chunks: string[],
  ) => {
    sends.push({ channel, userId, chunks });
  },
}));

import { maybeSendDeadlineNudge, bonosDeadlineMs } from "../../src/tools/masterclass";

const EVENT_ENV = {
  EVENT_NAME: "Test Masterclass",
  EVENT_STARTS_AT: "2026-07-26T13:00:00-06:00",
  EVENT_DURATION_MIN: "90",
  EVENT_REGISTER_URL: "https://x.test/registro",
  EVENT_OFFER_URL: "https://x.test/oferta",
  DASHBOARD_BASE_URL: "https://bot.test",
};

const STARTS_AT = Date.parse(EVENT_ENV.EVENT_STARTS_AT);
const HOUR = 3600_000;

let env: any;
let db: Db;
let convs: ConversationsRepo;

async function seedConv(userId: string, lastUserMsgAt: number) {
  const conv = await convs.getOrCreate("telegram", userId);
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`,
    [crypto.randomUUID(), conv.id, `hola de ${userId}`, lastUserMsgAt],
  );
  return conv;
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  env = { DB: d1, ...EVENT_ENV };
  db = new Db(d1 as any);
  convs = new ConversationsRepo(db);
  sends.length = 0;
});

describe("bonosDeadlineMs", () => {
  it("es 11:59:59pm CDMX del día del evento", () => {
    // 26 jul 11:59:59pm CDMX (UTC-6) = 27 jul 05:59:59 UTC
    expect(bonosDeadlineMs(env)).toBe(Date.parse("2026-07-27T05:59:59Z"));
  });
  it("null sin fecha configurada", () => {
    expect(bonosDeadlineMs({ ...env, EVENT_STARTS_AT: "" })).toBeNull();
  });
});

describe("maybeSendDeadlineNudge", () => {
  it("fuera de la ventana [deadline-2h, deadline] no hace nada", async () => {
    const deadline = bonosDeadlineMs(env)!;
    await seedConv("early", STARTS_AT + 30 * 60_000);
    expect(await maybeSendDeadlineNudge(env, deadline - 3 * HOUR)).toBeNull();
    expect(await maybeSendDeadlineNudge(env, deadline + 60_000)).toBeNull();
    expect(sends).toHaveLength(0);
  });

  it("manda a quien escribió alrededor de la clase, con link trackeado, y persiste el mensaje", async () => {
    const deadline = bonosDeadlineMs(env)!;
    const now = deadline - HOUR;
    const inConv = await seedConv("asistio", STARTS_AT + 30 * 60_000);
    await seedConv("viejo", now - 40 * HOUR); // fuera de la ventana de 24h
    const paused = await seedConv("takeover", STARTS_AT + 10 * 60_000);
    await convs.setPausedUntil(paused.id, now + HOUR); // dueño en control

    const res = await maybeSendDeadlineNudge(env, now);
    expect(res).toEqual({ sent: 1, failed: 0 });
    expect(sends).toHaveLength(1);
    expect(sends[0].userId).toBe("asistio");
    expect(sends[0].chunks[0]).toContain("11:59pm");
    expect(sends[0].chunks[0]).toContain("https://bot.test/l/");

    const persisted = await db.first<{ content: string }>(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'assistant'",
      [inConv.id],
    );
    expect(persisted?.content).toContain("Último aviso");
  });

  it("solo manda UNA vez (claim del flag antes de enviar)", async () => {
    const deadline = bonosDeadlineMs(env)!;
    const now = deadline - HOUR;
    await seedConv("asistio", STARTS_AT + 30 * 60_000);

    expect(await maybeSendDeadlineNudge(env, now)).toEqual({ sent: 1, failed: 0 });
    expect(await maybeSendDeadlineNudge(env, now + 10 * 60_000)).toBeNull();
    expect(sends).toHaveLength(1);
  });

  it("no-op sin modo masterclass (instancias normales)", async () => {
    const deadline = bonosDeadlineMs(env)!;
    await seedConv("x", STARTS_AT + 30 * 60_000);
    const bare = { ...env, EVENT_REGISTER_URL: "" };
    expect(await maybeSendDeadlineNudge(bare, deadline - HOUR)).toBeNull();
  });
});
