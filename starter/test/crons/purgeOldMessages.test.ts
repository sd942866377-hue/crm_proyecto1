import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import {
  purgeOldMessages,
  purgeOldMedia,
  purgeOldTestChats,
  MESSAGE_RETENTION_DAYS,
  TEST_CHAT_RETENTION_DAYS,
} from "../../src/crons/purgeOldMessages";

let env: any;
let db: Db;
let convId: string;

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  env = { DB: d1 };
  db = new Db(d1 as any);
  const conv = await new ConversationsRepo(db).getOrCreate("telegram", "purge-test");
  convId = conv.id;
});

/** Insert a message with an explicit created_at so we can simulate age. */
async function insertAged(content: string, createdAt: number) {
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`,
    [crypto.randomUUID(), convId, content, createdAt],
  );
}

describe("purgeOldMessages cron", () => {
  it("deletes messages older than the retention window but keeps recent ones", async () => {
    const now = 1_000 * DAY; // arbitrary fixed "now"
    await insertAged("old-1", now - (MESSAGE_RETENTION_DAYS + 5) * DAY);
    await insertAged("old-2", now - (MESSAGE_RETENTION_DAYS + 1) * DAY);
    await insertAged("recent", now - 3 * DAY);

    const deleted = await purgeOldMessages(env, now);
    expect(deleted).toBe(2);

    const remaining = await new MessagesRepo(db).lastN(convId, 50);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].content).toBe("recent");
  });

  it("deletes nothing when all messages are within the window", async () => {
    const now = 1_000 * DAY;
    await insertAged("a", now - 1 * DAY);
    await insertAged("b", now - 10 * DAY);
    const deleted = await purgeOldMessages(env, now);
    expect(deleted).toBe(0);
  });
});

// ── Archivos (fuga de storage preexistente) ─────────────────────────────────
// purgeOlderThan borraba los mensajes pero nadie borraba `media` ni R2: con el
// hilo móvil archivando cada foto entrante, el bucket crecía sin límite.

/** R2 de mentiras: guarda las llaves para poder afirmar qué se borró. */
function fakeR2() {
  const store = new Map<string, string>();
  return {
    store,
    async put(key: string, body: string) { store.set(key, body); },
    async get(key: string) { return store.has(key) ? { body: store.get(key) } : null; },
    async delete(key: string) { store.delete(key); },
  };
}

async function insertMedia(id: string, key: string, createdAt: number, conversationId = convId) {
  await db.run(
    `INSERT INTO media (id, conversation_id, r2_key, kind, mime, bytes, created_at, direction)
     VALUES (?, ?, ?, 'image', 'image/jpeg', 10, ?, 'in')`,
    [id, conversationId, key, createdAt],
  );
}

describe("purgeOldMedia cron", () => {
  it("borra las filas viejas Y sus objetos de R2, respetando las recientes", async () => {
    const now = 1_000 * DAY;
    const r2 = fakeR2();
    await r2.put("media/vieja-1.jpg", "x");
    await r2.put("media/vieja-2.jpg", "x");
    await r2.put("media/nueva.jpg", "x");
    await insertMedia("11111111-1111-1111-1111-111111111111", "media/vieja-1.jpg", now - (MESSAGE_RETENTION_DAYS + 5) * DAY);
    await insertMedia("22222222-2222-2222-2222-222222222222", "media/vieja-2.jpg", now - (MESSAGE_RETENTION_DAYS + 1) * DAY);
    await insertMedia("33333333-3333-3333-3333-333333333333", "media/nueva.jpg", now - 3 * DAY);

    const borrados = await purgeOldMedia({ ...env, MEDIA: r2 } as any, now);
    expect(borrados).toBe(2);
    expect([...r2.store.keys()]).toEqual(["media/nueva.jpg"]);
    const quedan = await db.all<{ id: string }>("SELECT id FROM media");
    expect(quedan).toHaveLength(1);
  });

  it("no borra más de un lote por corrida", async () => {
    const now = 1_000 * DAY;
    const r2 = fakeR2();
    for (let i = 0; i < 105; i++) {
      const id = `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`;
      await r2.put(`media/v${i}.jpg`, "x");
      await insertMedia(id, `media/v${i}.jpg`, now - (MESSAGE_RETENTION_DAYS + 1) * DAY);
    }
    expect(await purgeOldMedia({ ...env, MEDIA: r2 } as any, now)).toBe(100);
    expect(await purgeOldMedia({ ...env, MEDIA: r2 } as any, now)).toBe(5);
    expect(r2.store.size).toBe(0);
  });

  it("sin binding R2 borra las filas igual (ya son referencias muertas)", async () => {
    const now = 1_000 * DAY;
    await insertMedia("44444444-4444-4444-4444-444444444444", "media/huerfana.jpg", now - 200 * DAY);
    expect(await purgeOldMedia(env, now)).toBe(1);
  });

  it("sin tabla `media` (bot que nunca activó la Bóveda) no truena", async () => {
    await db.run("DROP TABLE media");
    expect(await purgeOldMedia(env, 1_000 * DAY)).toBe(0);
  });
});

// ── Chats de prueba ─────────────────────────────────────────────────────────

describe("purgeOldTestChats cron", () => {
  const now = 1_000 * DAY;

  /** Chat de prueba con un mensaje, un lead, un ticket y un archivo colgando. */
  async function seedTestChat(session: string, lastMessageAt: number) {
    const id = `test:${session}`;
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, started_at, last_message_at)
       VALUES (?, 'test', ?, ?, ?)`,
      [id, session, lastMessageAt, lastMessageAt],
    );
    await db.run(
      `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', 'probando', ?)`,
      [crypto.randomUUID(), id, lastMessageAt],
    );
    await db.run(
      `INSERT INTO leads (id, conversation_id, name, intent, created_at, updated_at)
       VALUES (?, ?, 'Prueba', 'prueba', ?, ?)`,
      [crypto.randomUUID(), id, lastMessageAt, lastMessageAt],
    );
    await db.run(
      `INSERT INTO tickets (id, conversation_id, summary, transcript, status, created_at)
       VALUES (?, ?, 'prueba', '—', 'open', ?)`,
      [crypto.randomUUID(), id, lastMessageAt],
    );
    return id;
  }

  it("borra el chat viejo con sus mensajes, leads, tickets y archivos", async () => {
    const r2 = fakeR2();
    const viejo = await seedTestChat("sesion-vieja", now - (TEST_CHAT_RETENTION_DAYS + 5) * DAY);
    await r2.put("media/test-vieja.jpg", "x");
    await insertMedia("55555555-5555-5555-5555-555555555555", "media/test-vieja.jpg", now - 40 * DAY, viejo);

    const borrados = await purgeOldTestChats({ ...env, MEDIA: r2 } as any, now);
    expect(borrados).toBe(1);

    for (const tabla of ["messages", "leads", "tickets", "media"]) {
      const fila = await db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${tabla} WHERE conversation_id = ?`,
        [viejo],
      );
      expect({ tabla, n: fila!.n }).toEqual({ tabla, n: 0 });
    }
    const conv = await db.first("SELECT id FROM conversations WHERE id = ?", [viejo]);
    expect(conv).toBeNull();
    expect(r2.store.size).toBe(0);
  });

  it("respeta los chats de prueba recientes y las conversaciones reales", async () => {
    await seedTestChat("sesion-fresca", now - 3 * DAY);
    // La conversación real del beforeEach (telegram) tiene su propio mensaje.
    await insertAged("de un cliente real", now - 500 * DAY);

    expect(await purgeOldTestChats(env, now)).toBe(0);
    const convs = await db.all<{ id: string }>("SELECT id FROM conversations ORDER BY id");
    expect(convs.map((c) => c.id)).toEqual(["telegram:purge-test", "test:sesion-fresca"]);
  });

  it("no borra más de un lote por corrida", async () => {
    for (let i = 0; i < 103; i++) {
      await seedTestChat(`s${i}`, now - (TEST_CHAT_RETENTION_DAYS + 1) * DAY);
    }
    expect(await purgeOldTestChats(env, now)).toBe(100);
    expect(await purgeOldTestChats(env, now)).toBe(3);
    expect(await purgeOldTestChats(env, now)).toBe(0);
  });
});
