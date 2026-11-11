// Almacén dinámico de embudos de comentarios en D1 (feature personal).
// Se guardan como un blob JSON en la tabla `settings` (key `comment_funnels`),
// así NO tocamos schema.sql (cero conflicto con el otro agente). El id es estable
// (va en el payload del botón), así que agregar/quitar embudos no rompe un flujo
// a medias.
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";

const KEY = "comment_funnels";

export interface FunnelRule {
  id: string; // id estable (usado en el payload del botón)
  mediaId?: string; // post de IG; undefined = global (cualquier post)
  keyword: string;
  dm: string;
  buttonLabel: string;
  resource: string;
  publicReply?: string;
}

/** id estable y legible: <mediaId|global>:<keyword-normalizada>. */
export function funnelId(mediaId: string | undefined, keyword: string): string {
  const kw = keyword.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${mediaId ?? "global"}:${kw || "kw"}`;
}

export async function listFunnels(db: Db): Promise<FunnelRule[]> {
  const raw = await new SettingsRepo(db).get(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as FunnelRule[]) : [];
  } catch {
    return [];
  }
}

async function writeFunnels(db: Db, funnels: FunnelRule[]): Promise<void> {
  await new SettingsRepo(db).set(KEY, JSON.stringify(funnels));
}

/** Upsert por id (si no trae id, se deriva de mediaId+keyword). */
export async function saveFunnel(
  db: Db,
  rule: Omit<FunnelRule, "id"> & { id?: string },
): Promise<FunnelRule> {
  const id = rule.id ?? funnelId(rule.mediaId, rule.keyword);
  const full: FunnelRule = { ...rule, id };
  const funnels = await listFunnels(db);
  const idx = funnels.findIndex((f) => f.id === id);
  if (idx >= 0) funnels[idx] = full;
  else funnels.push(full);
  await writeFunnels(db, funnels);
  return full;
}

export async function deleteFunnel(db: Db, id: string): Promise<boolean> {
  const funnels = await listFunnels(db);
  const next = funnels.filter((f) => f.id !== id);
  if (next.length === funnels.length) return false;
  await writeFunnels(db, next);
  return true;
}
