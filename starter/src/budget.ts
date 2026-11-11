/**
 * Monthly AI budget guard.
 *
 * The owner can set `monthly_budget` (USD) from the Costos tab. When the
 * month-to-date AI spend reaches it, the agent downgrades to the "fast" tier
 * (cheap model) instead of going silent — the bot keeps answering, it just
 * stops burning money on the smart model.
 */
import { Db } from "./db/client";
import { costOfUsage, type ModelId } from "./pricing";
import type { Tier } from "./upgrade/modelSelector";

/** UTC start of the current month (injectable clock for tests). */
export function monthStartMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Exact month-to-date AI cost, computed from per-message token usage. */
export async function monthIaCostUsd(db: Db, now = Date.now()): Promise<number> {
  const rows = await db.all<{ model_used: string; input: number; output: number; cached: number }>(
    `SELECT model_used,
            SUM(COALESCE(input_tokens, 0)) as input,
            SUM(COALESCE(output_tokens, 0)) as output,
            SUM(COALESCE(cached_input_tokens, 0)) as cached
     FROM messages
     WHERE created_at >= ? AND model_used IS NOT NULL
     GROUP BY model_used`,
    [monthStartMs(now)],
  );
  let total = 0;
  for (const r of rows) {
    total += costOfUsage(r.model_used as ModelId, {
      input: r.input,
      output: r.output,
      cached: r.cached,
    });
  }
  return total;
}

// Techo duro = múltiplo del presupuesto en el que el bot DEJA de responder para
// proteger la llave del miembro de una fuga (bot en loop, ataque, integración
// rota). En operación normal nunca se toca: al presupuesto solo se degrada de
// modelo; el corte es la red de seguridad al 2× del cap.
export const HARD_STOP_MULTIPLIER = 2;

/**
 * Decisión pura del guard de presupuesto:
 *  - bajo el presupuesto → sin cambios.
 *  - al presupuesto → baja a "fast" (sigue respondiendo, barato).
 *  - al 2× del presupuesto → CORTA (stop) para no quemar la llave del miembro.
 */
export function applyBudgetGuard(
  tier: Tier,
  monthCostUsd: number,
  budgetUsd: number | undefined,
): { tier: Tier; downgraded: boolean; stop: boolean } {
  if (budgetUsd === undefined || budgetUsd <= 0) return { tier, downgraded: false, stop: false };
  if (monthCostUsd >= budgetUsd * HARD_STOP_MULTIPLIER) {
    // downgraded refleja si CAMBIAMOS de tier; ya-fast no se "degrada", solo se corta.
    return { tier: "fast", downgraded: tier !== "fast", stop: true };
  }
  if (monthCostUsd >= budgetUsd && tier !== "fast") {
    return { tier: "fast", downgraded: true, stop: false };
  }
  return { tier, downgraded: false, stop: false };
}
