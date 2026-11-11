// Punto de extensión del miembro: carga las tools custom definidas en
// member/tools.local.ts y las suma a las del bot. La carpeta member/ es del
// usuario y `forjabot update` NUNCA la pisa — por eso las funciones extra que
// vivan ahí sobreviven cada actualización, ya conectadas (a diferencia de tocar
// src/, que el update reemplaza).
import type { Env } from "../env";
import { memberTools } from "../../member/tools.local";

/** Contexto que reciben las tools custom del miembro. */
export interface MemberToolCtx {
  env: Env;
  getConversationId: () => string | null;
}

/**
 * Construye las tools custom del miembro. Fail-soft: si su archivo truena al
 * armar sus tools, el bot sigue con las suyas — el set de tools jamás se cae por
 * un error del código del miembro.
 */
export function loadMemberTools(ctx: MemberToolCtx): Record<string, unknown> {
  try {
    const t = memberTools(ctx);
    return t && typeof t === "object" ? t : {};
  } catch (e) {
    console.error(
      "[member-tools] error al cargar tus tools (member/tools.local.ts) — se ignoran este turno:",
      e,
    );
    return {};
  }
}

/**
 * Suma las tools del miembro a las del bot SIN pisar las base: si el miembro
 * nombra una tool igual que una del core (p. ej. searchKb), gana la del core.
 * Muta y devuelve `base`.
 */
export function mergeMemberTools(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  for (const [name, t] of Object.entries(extra)) {
    if (!(name in base)) base[name] = t;
  }
  return base;
}
