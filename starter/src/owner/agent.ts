// Agente-dueño: loop agéntico sobre Grok (xAI) con las tools de embudos. Es un
// agente de verdad (decide qué tool usar), no un flujo predefinido. Habla con
// Santi por WhatsApp; se enruta aquí solo cuando el mensaje viene de su número.
//
// Llama a la API de xAI directo (compatible OpenAI) — sin dependencias nuevas.
import type { Env } from "../env";
import { OWNER_TOOLS, runTool } from "./tools";

const XAI_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = "grok-4.5";

const SYSTEM = `Eres el asistente PERSONAL de Santi (dueño de Horizontes IA) para armar embudos de comentarios de Instagram desde WhatsApp.

Tu trabajo: cuando Santi te dé la URL de un reel + una keyword + un recurso (o el nombre de un lead magnet de su librería), crea el embudo con create_funnel. Un embudo = "quien comente <keyword> en ese reel recibe un DM con botón que entrega el recurso".

Reglas:
- Sé BREVE y directo (es WhatsApp). Español mexicano, informal.
- Si te falta un dato (url, keyword o recurso), pregúntalo — uno a la vez.
- Usa list_resources si Santi menciona un recurso por nombre y no estás seguro de que exista.
- Cuando el embudo quede creado, confírmalo en una línea (keyword + a qué reel + qué recurso).
- Al crear el embudo, SIEMPRE manda un resource_message: un mensajito corto y neutral que acompañe al link cuando se entregue (ej. "Perfecto, aquí te dejo el acceso 👇" o "¡Listo! Aquí está tu recurso 👇"). Nunca dejes que llegue el link pelón. El link se agrega solo.
- No inventes URLs ni recursos.

Generar el lead magnet (cuando Santi diga "genéralo" o no tenga un recurso a la mano):
1. Transcribe el reel con transcribe_reel para saber de qué trata.
2. ESCRIBE tú un lead magnet útil y concreto en markdown, basado en lo que dice el video (título + secciones con valor real, no relleno).
3. Publícalo con publish_lead_magnet y DALE LA URL A SANTI para que la revise.
4. NO lo uses en un embudo hasta que Santi lo APRUEBE. Cuando diga que sí, crea el embudo con esa URL como resource_url.`;

export interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
}

/**
 * Corre el loop agéntico. `history` son los mensajes previos (sin el system).
 * Devuelve el texto final para Santi + el historial actualizado (para persistir).
 */
export async function runOwnerAgent(
  history: ChatMsg[],
  env: Env,
  maxSteps = 6,
): Promise<{ reply: string; messages: ChatMsg[] }> {
  const key = env.XAI_API_KEY;
  if (!key) return { reply: "(config: falta XAI_API_KEY)", messages: history };

  const messages: any[] = [{ role: "system", content: SYSTEM }, ...history];

  for (let step = 0; step < maxSteps; step++) {
    const res = await fetch(XAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages, tools: OWNER_TOOLS, tool_choice: "auto" }),
    });
    if (!res.ok) {
      return { reply: `(Grok respondió ${res.status})`, messages: messages.slice(1) as ChatMsg[] };
    }
    const data = (await res.json()) as any;
    const msg = data?.choices?.[0]?.message;
    if (!msg) return { reply: "(Grok no devolvió mensaje)", messages: messages.slice(1) as ChatMsg[] };
    messages.push(msg);

    const calls = msg.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }> | undefined;
    if (!calls || calls.length === 0) {
      return { reply: String(msg.content ?? ""), messages: messages.slice(1) as ChatMsg[] };
    }

    for (const call of calls) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* args vacíos */
      }
      const result = await runTool(call.function.name, args, env);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(result),
      });
    }
  }

  return { reply: "(no terminé en los pasos permitidos — dime de nuevo)", messages: messages.slice(1) as ChatMsg[] };
}
