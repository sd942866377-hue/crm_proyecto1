// Historial de la conversación del agente-dueño, en D1 (settings key
// owner_session). Un solo dueño → un solo blob. Se trunca a los últimos N.
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";
import type { ChatMsg } from "./agent";

const KEY = "owner_session";
const MAX = 24;

export async function loadSession(db: Db): Promise<ChatMsg[]> {
  const raw = await new SettingsRepo(db).get(KEY);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? (a as ChatMsg[]) : [];
  } catch {
    return [];
  }
}

export async function saveSession(db: Db, messages: ChatMsg[]): Promise<void> {
  await new SettingsRepo(db).set(KEY, JSON.stringify(messages.slice(-MAX)));
}

export async function resetSession(db: Db): Promise<void> {
  await new SettingsRepo(db).set(KEY, "[]");
}
