// Librería de recursos (lead magnets) del dueño: nombre → URL. Vive en D1
// (settings key resource_library) con defaults seed. El agente-dueño la consulta
// cuando Santi dice "el recurso a la masterclass".
import { Db } from "../db/client";
import { SettingsRepo } from "../db/settings";

const KEY = "resource_library";

const DEFAULTS: Record<string, string> = {
  comunidad: "https://horizontesia.com",
  masterclass: "https://masterclass.horizontesia.com",
};

/** Parsea el JSON guardado y lo mezcla sobre los defaults (puro, testeable). */
export function mergeLibrary(raw: string | null | undefined): Record<string, string> {
  let stored: Record<string, string> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") stored = parsed as Record<string, string>;
    } catch {
      /* ignora JSON inválido */
    }
  }
  return { ...DEFAULTS, ...stored };
}

export async function getLibrary(db: Db): Promise<Record<string, string>> {
  return mergeLibrary(await new SettingsRepo(db).get(KEY));
}

export async function lookupResource(db: Db, name: string): Promise<string | null> {
  const lib = await getLibrary(db);
  return lib[name.trim().toLowerCase()] ?? null;
}

export async function setResource(db: Db, name: string, url: string): Promise<void> {
  const repo = new SettingsRepo(db);
  const lib = mergeLibrary(await repo.get(KEY));
  lib[name.trim().toLowerCase()] = url.trim();
  // No re-guardamos los defaults salvo que se hayan sobreescrito; simple: guarda todo.
  await repo.set(KEY, JSON.stringify(lib));
}
