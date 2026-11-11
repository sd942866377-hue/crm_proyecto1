import { Db } from "./client";

export interface Conversation {
  id: string;
  channel: string;
  channel_user_id: string;
  display_name: string | null;
  started_at: number;
  last_message_at: number;
  paused_until: number | null;
  open_ticket_id: string | null;
  metadata: string | null;
  /** Quién de la app la está atendiendo (JSON de TakenBy). `undefined` en bots
   *  a los que todavía no les corrió el ALTER lazy — ver ensureTakenBy. */
  taken_by?: string | null;
}

/** Persona de la app que tomó la conversación (columna `taken_by`). */
export interface TakenBy {
  id: string;
  name: string;
  at: number;
}

let takenByEnsured = false;

/**
 * `conversations.taken_by` — quién está atendiendo desde la app, para que la
 * bandeja diga "Beto la está atendiendo" en vez de solo "modo humano". ALTER
 * idempotente y LAZY porque `forjabot update` NO re-ejecuta schema.sql en bots
 * ya desplegados (mismo patrón que ensureConversationReads); schema.sql también
 * la trae para instalaciones nuevas.
 *
 * NO se mezcla con `assigned_to` (asignación del panel, apunta a panel_users):
 * son dos cosas distintas — a quién le TOCA vs quién está AHORITA respondiendo.
 */
export async function ensureTakenBy(db: Db): Promise<void> {
  if (takenByEnsured) return;
  await db.run("ALTER TABLE conversations ADD COLUMN taken_by TEXT").catch(() => {});
  takenByEnsured = true;
}

/** Solo para tests: resetea el memo del ALTER. */
export function __resetTakenByEnsured(): void {
  takenByEnsured = false;
}

/** JSON de la columna → TakenBy. null si está vacía o malformada. */
export function parseTakenBy(raw: string | null | undefined): TakenBy | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const id = String(o?.id ?? "");
    const name = String(o?.name ?? "");
    if (!id || !name) return null;
    return { id, name, at: Number(o?.at) || 0 };
  } catch {
    return null;
  }
}

function makeConvId(channel: string, channelUserId: string): string {
  return `${channel}:${channelUserId}`;
}

export class ConversationsRepo {
  constructor(private readonly db: Db) {}

  async getOrCreate(
    channel: string,
    channelUserId: string,
    displayName?: string,
  ): Promise<Conversation> {
    const id = makeConvId(channel, channelUserId);
    const existing = await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    );
    if (existing) return existing;

    const now = Date.now();
    await this.db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, channel, channelUserId, displayName ?? null, now, now],
    );
    return (await this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    ))!;
  }

  async getById(id: string): Promise<Conversation | null> {
    return this.db.first<Conversation>(
      "SELECT * FROM conversations WHERE id = ?",
      [id],
    );
  }

  async setPausedUntil(id: string, until: number | null): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET paused_until = ? WHERE id = ?",
      [until, id],
    );
  }

  /** Marca (o borra) quién la está atendiendo desde la app. */
  async setTakenBy(id: string, actor: { id: string; name: string } | null): Promise<void> {
    await ensureTakenBy(this.db);
    await this.db.run("UPDATE conversations SET taken_by = ? WHERE id = ?", [
      actor ? JSON.stringify({ id: actor.id, name: actor.name, at: Date.now() }) : null,
      id,
    ]);
  }

  async isPaused(id: string): Promise<boolean> {
    const conv = await this.getById(id);
    if (!conv?.paused_until) return false;
    return conv.paused_until > Date.now();
  }

  async touchLastMessage(id: string, when: number = Date.now()): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET last_message_at = ? WHERE id = ?",
      [when, id],
    );
  }

  async setOpenTicket(id: string, ticketId: string | null): Promise<void> {
    await this.db.run(
      "UPDATE conversations SET open_ticket_id = ? WHERE id = ?",
      [ticketId, id],
    );
  }
}
