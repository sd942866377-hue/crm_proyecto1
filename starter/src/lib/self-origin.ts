import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

// Auto-cura del origin (BUG 6). El CLI deja DASHBOARD_BASE_URL="" en el install,
// así que los link-builders (paneles, tickets, tracked links, lead magnets…)
// generaban URLs sin raíz hasta que el miembro la fijaba a mano. Este helper
// resuelve la base URL propia del worker con esta precedencia:
//   1. env.DASHBOARD_BASE_URL (si el miembro la fijó)
//   2. settings.self_origin (aprendido de requests entrantes — ver persistSelfOrigin)
//   3. new URL(req.url).origin (solo en código con request-context)
// Devuelve SIEMPRE sin "/" final. "" cuando no hay ninguna fuente (comportamiento
// previo cuando DASHBOARD_BASE_URL estaba vacío).

const stripTrailingSlash = (s: string): string => s.replace(/\/+$/, "");

/**
 * Base URL propia del worker para código SIN request (cron, tools dentro del DO).
 * Precedencia: DASHBOARD_BASE_URL → settings.self_origin → "".
 * Nunca lanza: si settings no está disponible, cae al siguiente nivel.
 */
export async function selfOrigin(env: Env): Promise<string> {
  const explicit = env.DASHBOARD_BASE_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  try {
    const stored = (await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.selfOrigin))?.trim();
    if (stored) return stripTrailingSlash(stored);
  } catch {
    // settings no disponible — se comporta como no configurado
  }
  return "";
}

/**
 * Igual que selfOrigin pero con el origin del request entrante como último
 * fallback. Úsalo en código con acceso al Request (rutas admin, webhooks).
 */
export async function selfOriginFromRequest(env: Env, reqUrl: string): Promise<string> {
  const base = await selfOrigin(env);
  if (base) return base;
  try {
    return new URL(reqUrl).origin;
  } catch {
    return "";
  }
}

/**
 * Persiste el origin real (aprendido de un request entrante) en settings, solo
 * si cambió — para que el código de cron tenga una base URL sin que el miembro
 * la fije a mano. Best-effort: envuelto en try/catch, nunca lanza. Se dispara
 * con ctx.waitUntil desde el middleware de index.ts.
 */
export async function persistSelfOrigin(env: Env, origin: string): Promise<void> {
  try {
    const repo = new SettingsRepo(new Db(env.DB));
    const current = (await repo.get(SETTING_KEYS.selfOrigin))?.trim();
    if (current !== origin) {
      await repo.set(SETTING_KEYS.selfOrigin, origin);
    }
  } catch (e) {
    console.error("[self-origin] persist failed:", e);
  }
}

/**
 * Heartbeat best-effort worker→control-plane. Le informa al plano de control la
 * base URL real de este bot self-hosted. No-op sin CONTROL_PLANE_URL/TOKEN;
 * nunca lanza (try/catch). Contrato: POST {CONTROL_PLANE_URL}/api/bots/heartbeat
 * con Authorization: Bearer {CONTROL_PLANE_TOKEN} y body { origin }.
 */
export async function sendHeartbeat(env: Env, origin: string): Promise<"pro" | "free" | null> {
  const base = env.CONTROL_PLANE_URL?.trim();
  const token = env.CONTROL_PLANE_TOKEN?.trim();
  if (!base || !token) return null;
  try {
    const res = await fetch(`${stripTrailingSlash(base)}/api/bots/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ origin }),
    });
    // El control plane responde el tier del PLAN (contrato 2026-08-29):
    // "pro"/"free" para aplicar, null/ausente = sin información, no tocar.
    // "free" solo llega con suscripción explícitamente cancelada — el plano
    // de control lo garantiza; ver forja-cloud heartbeat/route.ts.
    const body = (await res.json().catch(() => null)) as { tier?: unknown } | null;
    return body?.tier === "pro" || body?.tier === "free" ? body.tier : null;
  } catch (e) {
    console.error("[heartbeat] failed:", e);
    return null;
  }
}
