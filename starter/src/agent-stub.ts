import type { Env } from "./env";

// Regiones válidas de locationHint de Durable Objects (docs de Cloudflare).
const DO_LOCATION_HINTS = new Set(["wnam", "enam", "sam", "weur", "eeur", "apac", "oc", "afr", "me"]);

/**
 * Stub del agente de una conversación — ÚNICO punto que deriva el nombre del DO.
 *
 * AGENT_LOCATION_HINT (opcional, p.ej. "enam") fija la región donde corre el
 * agente. Existe para el 403 "Request not allowed" de Anthropic: el DO nace en
 * el colo cercano a quien manda el webhook, y si el proveedor del canal tiene
 * servidores en Asia (p.ej. YCloud) el agente queda corriendo allá — el edge de
 * api.anthropic.com veta ese origen en TODAS las llamadas al LLM. Con el hint
 * en Norteamérica el egress sale de EE.UU. y pasa, con la misma API key.
 *
 * El hint solo aplica al CREAR el DO, por eso el nombre se sala con la región:
 * al poner (o cambiar) la var nacen agentes frescos donde se pidió. El historial
 * vive en D1 — solo se pierde el buffer de segundos en vuelo en ese momento.
 * SIN la var: nombre y comportamiento IDÉNTICOS a siempre (cero cambios).
 */
export function agentStub(env: Env, channel: string, channelUserId: string) {
  const raw = (env.AGENT_LOCATION_HINT ?? "").trim().toLowerCase();
  const hint = DO_LOCATION_HINTS.has(raw) ? (raw as DurableObjectLocationHint) : undefined;
  if (raw && !hint) console.warn(`[agentStub] AGENT_LOCATION_HINT inválido: "${raw}" — se ignora`);
  const name = hint ? `${hint}:${channel}:${channelUserId}` : `${channel}:${channelUserId}`;
  const doId = env.AGENT.idFromName(name);
  return env.AGENT.get(doId, hint ? { locationHint: hint } : undefined);
}
