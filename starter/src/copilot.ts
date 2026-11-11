/**
 * Co-pilot — "sugiere qué contestarle". El bot redacta UN mensaje que el dueño
 * puede mandar tal cual o editar; NUNCA se envía solo ni se persiste nada.
 *
 * Vivía suelto dentro de la ruta del panel (admin/routes.ts); ahora es un
 * módulo porque lo usan DOS entradas: el panel (devuelve HTML) y la app
 * (POST /api/conversations/:id/suggest, devuelve JSON). Una sola cabeza para
 * los dos: si mejora el prompt, mejora en ambos lados.
 *
 * Usa el system prompt EFECTIVO del bot (resolveAgentConfig) — no el generado
 * desde el env: así la sugerencia respeta el tono elegido, las instrucciones
 * del dueño, las lecciones aprendidas y el override si lo hay. Modelo "fast"
 * (barato) y los últimos 20 turnos: es un borrador, no una respuesta.
 */
import type { Env } from "./env";
import { Db } from "./db/client";
import { MessagesRepo } from "./db/messages";
import { mapMessageToAiTurn } from "./history";
import { workModel } from "./llm/work-model";
import { resolveAgentConfig } from "./settings-loader";

/** Cuántos turnos de contexto ve el co-pilot. */
export const COPILOT_HISTORY_TURNS = 20;
/** Tope del "¿qué le digo?" que puede escribir el dueño. */
export const COPILOT_HINT_MAX = 200;

export type CopilotErrorCode = "no_history" | "llm_failed";

/** Falla con código, para que cada entrada la traduzca a lo suyo (HTTP o HTML). */
export class CopilotError extends Error {
  constructor(
    readonly code: CopilotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CopilotError";
  }
}

export interface CopilotSuggestion {
  suggestion: string;
  /** Modelo concreto que la escribió (la app lo muestra en letra chica). */
  model: string;
  tokens: { input: number; output: number };
}

/**
 * La instrucción final. Deliberadamente NO fija el idioma: el system prompt
 * efectivo ya lo decide (un bot en inglés debe sugerir en inglés) — pedirle
 * "en español" aquí lo contradecía.
 */
function instruction(hint?: string): string {
  const base =
    "Eres asistente del dueño. Sugiere UN solo mensaje corto, en el MISMO idioma de la conversación, que el dueño podría enviarle al cliente para resolver la última consulta. NO incluyas preámbulo ni comillas, solo la frase lista para copiar y pegar.";
  return hint ? `${base}\n\nAdemás, el dueño te pide esto para la respuesta: ${hint}` : base;
}

/**
 * Redacta la sugerencia. No toca D1 más que para LEER el historial.
 * Lanza CopilotError("no_history") si el hilo está vacío y
 * CopilotError("llm_failed") si el proveedor falla (el detalle va en .message).
 */
export async function suggestReply(
  env: Env,
  conv: { id: string; channel: string },
  hint?: string,
): Promise<CopilotSuggestion> {
  const db = new Db(env.DB);
  const history = await new MessagesRepo(db).lastN(conv.id, COPILOT_HISTORY_TURNS);
  if (!history.length) {
    throw new CopilotError("no_history", "Esta conversación todavía no tiene mensajes.");
  }

  const turns = history.map(mapMessageToAiTurn);
  // Anthropic exige que el primer turno sea del usuario. Una ventana de 20 que
  // arranque con el bot (le contestó y siguieron hablando) reventaba el
  // proveedor por una razón que nada tiene que ver con la sugerencia.
  while (turns.length && turns[0].role === "assistant") turns.shift();
  turns.push({ role: "user", content: instruction(hint) });

  const [llm, cfg] = await Promise.all([
    workModel(env, "fast", "copilot"),
    resolveAgentConfig(env, [], conv.channel),
  ]);

  try {
    const result = await llm.generate({ system: cfg.systemPrompt, messages: turns });
    return {
      suggestion: result.text.trim(),
      // Se lee DESPUÉS de generar: si hubo failover, quien la escribió es otro.
      model: llm.modelId,
      tokens: {
        input: result.usage?.inputTokens ?? 0,
        output: result.usage?.outputTokens ?? 0,
      },
    };
  } catch (e) {
    throw new CopilotError("llm_failed", e instanceof Error ? e.message : String(e));
  }
}

// ── Throttle: 1 sugerencia por conversación cada 5 s ─────────────────────────
//
// Vive en memoria del isolate a propósito: es un freno anti-doble-tap del botón
// ✨, no una cuota que haya que auditar. Escribirlo en D1 costaría una lectura y
// una escritura por sugerencia para proteger de algo que ya casi no pasa. Peor
// caso (isolate nuevo): pasa una sugerencia de más — el presupuesto de IA sigue
// siendo el freno real del gasto.

const THROTTLE_MS = 5_000;
/** Techo del mapa: un bot con miles de conversaciones no se lleva la memoria. */
const THROTTLE_MAX_ENTRIES = 500;
const lastSuggestAt = new Map<string, number>();

/** ¿Se puede sugerir YA en esta conversación? Registra el intento si sí. */
export function claimSuggestSlot(conversationId: string, now = Date.now()): boolean {
  const last = lastSuggestAt.get(conversationId) ?? 0;
  if (now - last < THROTTLE_MS) return false;
  if (lastSuggestAt.size >= THROTTLE_MAX_ENTRIES) {
    for (const [id, at] of lastSuggestAt) {
      if (now - at >= THROTTLE_MS) lastSuggestAt.delete(id);
    }
  }
  lastSuggestAt.set(conversationId, now);
  return true;
}

/** Solo para tests: olvida los intentos registrados. */
export function __resetSuggestThrottle(): void {
  lastSuggestAt.clear();
}
