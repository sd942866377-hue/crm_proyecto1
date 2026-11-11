import { Db } from "./client";

/**
 * Marca de "leído" por conversación para el inbox móvil (Forja Inbox):
 * unread = mensajes del cliente posteriores a last_read_at.
 *
 * La tabla se asegura LAZY (CREATE TABLE IF NOT EXISTS memoizado por isolate)
 * porque `forjabot update` NO re-ejecuta schema.sql en bots ya desplegados —
 * mismo patrón que ensurePanelUsersTable en admin/equipo.ts. schema.sql también
 * la trae para instalaciones nuevas.
 */
let ensured = false;

export async function ensureConversationReads(db: Db): Promise<void> {
  if (ensured) return;
  await db.run(
    `CREATE TABLE IF NOT EXISTS conversation_reads (
      conversation_id TEXT PRIMARY KEY,
      last_read_at INTEGER NOT NULL)`,
  );
  ensured = true;
}

/** Solo para tests: resetea el memo del CREATE TABLE. */
export function __resetConversationReadsEnsured(): void {
  ensured = false;
}

export class ConversationReadsRepo {
  constructor(private readonly db: Db) {}

  async markRead(conversationId: string, at = Date.now()): Promise<void> {
    await ensureConversationReads(this.db);
    await this.db.run(
      `INSERT INTO conversation_reads (conversation_id, last_read_at) VALUES (?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET last_read_at = excluded.last_read_at`,
      [conversationId, at],
    );
  }
}
