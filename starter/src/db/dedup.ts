// Dedup de mensajes entrantes por id del proveedor (Meta/WhatsApp reenvían el
// batch completo si el webhook responde no-2xx). seenBefore() es idempotente:
// la primera vez que ve un id devuelve false y lo marca; las siguientes true.
// Tabla auto-creada (mismo patrón que funnels/store) — no toca schema.sql, así
// funciona en bots ya instalados sin migración. GC oportunista de >24h.
import { Db } from "./client";

let ensured = false;

async function ensure(db: Db): Promise<void> {
  if (ensured) return;
  await db.run(
    "CREATE TABLE IF NOT EXISTS processed_messages (id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL)",
  );
  ensured = true;
}

/**
 * ¿Ya procesamos este mensaje? Marca-y-reporta atómico vía INSERT OR IGNORE.
 * Devuelve true si el id ya existía (duplicado → saltar). Fail-open: ante
 * cualquier error de D1 devuelve false (mejor un doble raro que perder mensajes).
 */
export async function seenBefore(db: Db, providerMessageId: string): Promise<boolean> {
  const id = String(providerMessageId).trim();
  if (!id) return false;
  try {
    await ensure(db);
    const res = await db.run(
      "INSERT OR IGNORE INTO processed_messages (id, seen_at) VALUES (?, ?)",
      [id, Date.now()],
    );
    const inserted = (res as { meta?: { changes?: number } })?.meta?.changes ?? 1;
    if (inserted === 0) return true; // ya existía → duplicado
    // GC oportunista (1 de cada ~20 escrituras): borra ids de más de 24h.
    if (id.charCodeAt(id.length - 1) % 20 === 0) {
      await db
        .run("DELETE FROM processed_messages WHERE seen_at < ?", [Date.now() - 86_400_000])
        .catch(() => {});
    }
    return false;
  } catch {
    return false;
  }
}
