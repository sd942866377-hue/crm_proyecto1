import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "./helpers/miniflareSetup";
import { Db } from "../src/db/client";
import { ConversationsRepo } from "../src/db/conversations";
import {
  normalizeForSpam,
  isRepeatSpam,
  isOverDailyCap,
  looksLikeKeyword,
  SPAM_WINDOW_MS,
  DAILY_TURN_CAP,
  DAILY_CAP_MESSAGE,
} from "../src/spam";

let db: Db;
let convId: string;

async function addUserMsg(content: string, createdAt: number) {
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)`,
    [crypto.randomUUID(), convId, content, createdAt],
  );
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  db = new Db(d1 as any);
  const conv = await new ConversationsRepo(db).getOrCreate("telegram", "spam-test");
  convId = conv.id;
});

describe("normalizeForSpam", () => {
  it("quita acentos, espacios extra y mayúsculas", () => {
    expect(normalizeForSpam("  ¿CUÁNTO   Cuesta? ")).toBe("¿cuanto cuesta?");
    expect(normalizeForSpam("Órale\n\nsí")).toBe("orale si");
  });
});

describe("isRepeatSpam", () => {
  // Los mensajes previos se insertan DENTRO de la ventana de 10 min (segundos
  // antes de NOW), como una ráfaga real.
  const NOW = 1_800_000_000_000;

  it("mismo mensaje por 3ª vez entre los últimos 5 → spam", async () => {
    await addUserMsg("compra mi curso ya", NOW - 3000);
    await addUserMsg("hola", NOW - 2000);
    await addUserMsg("COMPRA MI CURSO YA", NOW - 1000);
    expect(await isRepeatSpam(db, convId, "compra mi curso ya!", NOW)).toBe(false); // "!" lo hace distinto
    expect(await isRepeatSpam(db, convId, "Compra mi curso ya", NOW)).toBe(true);
  });

  it("una repetición aislada no es spam", async () => {
    await addUserMsg("¿cuánto cuesta?", NOW - 1000);
    expect(await isRepeatSpam(db, convId, "¿cuánto cuesta?", NOW)).toBe(false);
  });

  it("solo mira los últimos 5 mensajes", async () => {
    await addUserMsg("promo total", NOW - 9000);
    await addUserMsg("promo total", NOW - 8000);
    for (let i = 0; i < 5; i++) await addUserMsg(`otro mensaje ${i}`, NOW - 5000 + i);
    expect(await isRepeatSpam(db, convId, "promo total", NOW)).toBe(false);
  });

  it("mensajes ultracortos no cuentan", async () => {
    await addUserMsg("k", NOW - 2000);
    await addUserMsg("k", NOW - 1000);
    expect(await isRepeatSpam(db, convId, "k", NOW)).toBe(false);
  });

  it("repeticiones FUERA de la ventana de 10 min no cuentan (lead que responde a varias historias)", async () => {
    // Caso real 27-ago-2026: "Forja" el 28-jul, 17-ago y hoy → quedaba pausado.
    await addUserMsg("mandame la info completa", NOW - 30 * 24 * 3600_000);
    await addUserMsg("mandame la info completa", NOW - 10 * 24 * 3600_000);
    expect(await isRepeatSpam(db, convId, "mandame la info completa", NOW)).toBe(false);
    // Dentro de la ventana sí cuenta.
    await addUserMsg("mandame la info completa", NOW - 60_000);
    await addUserMsg("mandame la info completa", NOW - 30_000);
    expect(await isRepeatSpam(db, convId, "mandame la info completa", NOW)).toBe(true);
    expect(SPAM_WINDOW_MS).toBe(10 * 60_000);
  });

  it("una sola palabra (keyword de funnel: Forja/Info/Quiero) nunca es spam, ni en ráfaga", async () => {
    await addUserMsg("Forja", NOW - 2000);
    await addUserMsg("FORJA", NOW - 1000);
    expect(await isRepeatSpam(db, convId, "forja", NOW)).toBe(false);
    expect(looksLikeKeyword(normalizeForSpam("  MASTERCLASS "))).toBe(true);
    expect(looksLikeKeyword(normalizeForSpam("compra mi curso"))).toBe(false);
    expect(looksLikeKeyword("a".repeat(21))).toBe(false);
  });
});

describe("isOverDailyCap (backstop ChatGPT gratis)", () => {
  const NOW = 1_800_000_000_000;

  it("bajo el tope no pasa nada, al llegar al tope se activa", async () => {
    for (let i = 0; i < DAILY_TURN_CAP - 1; i++) {
      await addUserMsg(`pregunta ${i}`, NOW - i * 60_000);
    }
    expect(await isOverDailyCap(db, convId, NOW)).toBe(false);

    await addUserMsg("una mas", NOW - 1000);
    expect(await isOverDailyCap(db, convId, NOW)).toBe(true);
  });

  it("solo cuenta las últimas 24h y solo mensajes de usuario", async () => {
    // 50 turnos pero de hace 2 días → no cuenta.
    for (let i = 0; i < DAILY_TURN_CAP; i++) {
      await addUserMsg(`vieja ${i}`, NOW - 48 * 3600_000 - i * 1000);
    }
    expect(await isOverDailyCap(db, convId, NOW)).toBe(false);

    // Mensajes del bot no cuentan para el tope.
    for (let i = 0; i < DAILY_TURN_CAP; i++) {
      await db.run(
        `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)`,
        [crypto.randomUUID(), convId, `respuesta ${i}`, NOW - i * 1000],
      );
    }
    expect(await isOverDailyCap(db, convId, NOW)).toBe(false);
  });

  it("la despedida es NEUTRAL — sin marca Horizontes (fuga reportada por Eduardo Cruz)", () => {
    // Este mensaje sale en el bot de CUALQUIER miembro. Jamás puede mencionar a
    // Santi, Horizontes IA ni su comunidad — sería promocionar a Horizontes a
    // los clientes de otro. Ver src/spam.ts.
    expect(DAILY_CAP_MESSAGE.toLowerCase()).not.toMatch(/horizontes|santi|comunidad|skool/);
    expect(DAILY_CAP_MESSAGE).not.toMatch(/https?:\/\//);
    expect(DAILY_CAP_MESSAGE).not.toMatch(/[—–]/);
  });
});
