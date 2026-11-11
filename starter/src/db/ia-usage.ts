/**
 * Libreta de gastos de IA — el ledger completo de CADA llamada al LLM, con su
 * función y su costo fino.
 *
 * POR QUÉ EXISTE
 * --------------
 * `monthIaCostUsd` (budget.ts) suma tokens de la tabla `messages`, que SOLO
 * guarda la conversación con el cliente. Todo lo demás que gasta IA —follow-ups,
 * insights, copilot, reportes, flywheel, blindaje (el work-model)— nunca se
 * anotaba, así que el gasto mostrado salía por debajo del real (Gap 2). Además
 * la caché-creation se cobraba a 1× en vez de 1.25× (Gap 1).
 *
 * Esta libreta anota TODO, etiquetado por función, para que la app muestre el
 * gasto desglosado (y por cliente en modo agencia). El guard sigue usando
 * `messages` — esto es ADITIVO, no cambia el freno.
 *
 * Tabla LAZY auto-creada (mismo patrón que dedup/conversationReads): `forjabot
 * update` NO re-corre schema.sql en bots ya desplegados, así que se crea sola
 * la primera vez que el bot anota — cero migración, cero riesgo para bots viejos.
 */
import { Db } from "./client";
import { costOfUsage, type ModelId, type Usage } from "../pricing";

// UTC start of the current month — MISMO límite que el guard (budget.monthStartMs).
// Inline a propósito: mantiene este módulo como hoja (solo importa pricing/client)
// y evita un ciclo si budget.ts algún día lee la libreta.
function monthStartMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

let ensured = false;
async function ensure(db: Db): Promise<void> {
  if (ensured) return;
  await db.run(
    `CREATE TABLE IF NOT EXISTS ia_usage (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       created_at INTEGER NOT NULL,
       fn TEXT NOT NULL,
       model TEXT NOT NULL,
       input_tokens INTEGER NOT NULL DEFAULT 0,
       cached_input_tokens INTEGER NOT NULL DEFAULT 0,
       cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
       output_tokens INTEGER NOT NULL DEFAULT 0,
       cost_usd REAL NOT NULL DEFAULT 0,
       conversation_id TEXT
     )`,
  );
  await db.run("CREATE INDEX IF NOT EXISTS idx_ia_usage_created ON ia_usage(created_at)");
  ensured = true;
}

/** Funciones canónicas — lo que la app muestra desglosado. Un solo lugar para
 *  la lista, así el work-model y la UI hablan el mismo idioma. */
export type IaFn =
  | "conversacion" // el agente contestando al cliente
  | "copilot" // ✨ sugerir respuesta / "que el bot aprenda esto"
  | "followups" // outreach / run / reengage
  | "insights" // analista / objeciones / analyzer
  | "reportes" // reporte del dueño
  | "flywheel" // detección nocturna
  | "blindaje" // guard anti-alucinación
  | "trabajo"; // fallback genérico del work-model

export interface RecordArgs {
  fn: IaFn;
  model: ModelId;
  usage: Usage;
  conversationId?: string | null;
}

/**
 * Anota UN cargo de IA. Fail-safe TOTAL: si D1 falla se traga el error — anotar
 * el costo NUNCA puede tumbar la feature que lo generó (un follow-up no se cae
 * porque no se pudo escribir su renglón).
 */
export async function recordIaUsage(db: Db, args: RecordArgs): Promise<void> {
  try {
    await ensure(db);
    const cost = costOfUsage(args.model, args.usage);
    // Cargo de $0 con 0 tokens no aporta nada a la libreta (ej. una llamada que
    // falló antes de gastar) — no lo anotamos para no ensuciar el conteo.
    if (cost <= 0 && (args.usage.input ?? 0) === 0 && (args.usage.output ?? 0) === 0) return;
    await db.run(
      `INSERT INTO ia_usage
         (created_at, fn, model, input_tokens, cached_input_tokens,
          cache_creation_tokens, output_tokens, cost_usd, conversation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(),
        args.fn,
        args.model,
        Math.round(args.usage.input ?? 0),
        Math.round(args.usage.cached ?? 0),
        Math.round(args.usage.cacheCreation ?? 0),
        Math.round(args.usage.output ?? 0),
        cost,
        args.conversationId ?? null,
      ],
    );
  } catch (e) {
    console.warn(
      "[ia_usage] no pude anotar el cargo (fail-safe, sigo):",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Extrae el usage (input total + caché-read + caché-creation + output) de un
 * resultado del AI SDK. Sirve igual para streamText (agente) y generateText
 * (work-model). `inputTokens` ya es el TOTAL (fresh + creation + read); la
 * creation vive en providerMetadata.anthropic (solo Anthropic la reporta).
 */
export async function usageFromResult(result: {
  usage: Promise<unknown> | unknown;
  providerMetadata?: Promise<unknown> | unknown;
}): Promise<Usage> {
  const usage = (await result.usage) as
    | { inputTokens?: number; outputTokens?: number; inputTokenDetails?: { cacheReadTokens?: number } }
    | undefined;
  const meta = (await result.providerMetadata) as
    | { anthropic?: { cacheCreationInputTokens?: number } }
    | undefined;
  return {
    input: usage?.inputTokens ?? 0,
    cached: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheCreation: meta?.anthropic?.cacheCreationInputTokens ?? 0,
    output: usage?.outputTokens ?? 0,
  };
}

export interface IaBreakdownRow {
  fn: string;
  cost_usd: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
}

/**
 * Gasto del mes DESGLOSADO por función, desde la libreta. Costo SIN redondear
 * (redondea la capa que muestra). Vacío si el bot aún no ha anotado nada (recién
 * actualizado) — la tabla se auto-crea, así que nunca truena.
 */
export async function monthIaBreakdown(db: Db, now = Date.now()): Promise<IaBreakdownRow[]> {
  try {
    await ensure(db);
    return await db.all<IaBreakdownRow>(
      `SELECT fn,
              SUM(cost_usd) as cost_usd,
              COUNT(*) as calls,
              SUM(input_tokens) as input_tokens,
              SUM(output_tokens) as output_tokens
       FROM ia_usage
       WHERE created_at >= ?
       GROUP BY fn
       ORDER BY cost_usd DESC`,
      [monthStartMs(now)],
    );
  } catch {
    return [];
  }
}
