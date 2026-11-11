// Tier EFECTIVO del bot: el control plane puede subirlo/bajarlo en caliente
// (POST /api/tier al activar Forja+) sin re-desplegar. El override vive en
// settings.tier_override; si está vacío manda el BOT_TIER del wrangler.toml.
//
// applyTier() se llama al entrar CADA request (middleware), cada cron, y al
// inicio de ingest()/processBuffer() del Durable Object del chat (que corre en
// su PROPIO env y no pasa por el middleware). Muta env.BOT_TIER al valor
// efectivo, así TODOS los isPro(env) del código siguen funcionando sin refactor.
// Cache en memoria (por isolate) para no pegarle a D1 en cada mensaje.
import type { Env } from "./env";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";

const TTL_MS = 30_000;
let cache: { value: "pro" | "free" | null; at: number } = { value: null, at: 0 };

// BOT_TIER del wrangler.toml, capturado UNA vez por isolate ANTES de que
// applyTier lo mute. Sin esto, un fallo de D1 tras un override haría que la
// "base" se leyera del env ya mutado (un free podría quedar pro por accidente).
let staticBase: "pro" | "free" | null = null;

/** Deja el cache como si nunca se hubiera leído (tests / POST /api/tier). */
export function bustTierCache(next?: "pro" | "free" | null): void {
  cache = next ? { value: next, at: Date.now() } : { value: null, at: 0 };
  staticBase = null;
}

export async function effectiveTier(env: Env): Promise<"pro" | "free"> {
  if (staticBase === null) staticBase = env.BOT_TIER === "pro" ? "pro" : "free";
  const now = Date.now();
  if (now - cache.at > TTL_MS) {
    try {
      const raw = await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.tierOverride);
      cache = { value: raw === "pro" || raw === "free" ? raw : null, at: now };
    } catch {
      // D1 no disponible → fail-open a la base ESTÁTICA (no al env mutado);
      // reintenta al expirar el TTL.
      cache = { value: null, at: now };
    }
  }
  return cache.value ?? staticBase;
}

/** Muta env.BOT_TIER al tier efectivo — llamar al entrar de fetch/scheduled
 *  Y al inicio de ingest()/processBuffer() del DO del chat. */
export async function applyTier(env: Env): Promise<void> {
  env.BOT_TIER = await effectiveTier(env);
}
