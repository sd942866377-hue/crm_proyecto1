import type { Message } from "./db/messages";
import { markersToPrompt } from "./lib/media-markers";

/**
 * Traduce UN row de `messages` a un turno del historial que ve el LLM.
 * Roles reales en D1: user, assistant, tool, owner, note — el AI SDK solo
 * conoce user/assistant/system/tool, así que cada uno se mapea EXPLÍCITO
 * (nunca un pass-through "lo que sea"): un rol nuevo que se cuele aquí sin
 * mapeo reventaría el proveedor en pleno turno del cliente.
 *   - tool  → user (igual que siempre: contexto, no un turno real del LLM)
 *   - owner → assistant (lo que el dueño le mandó al cliente, como si el bot
 *     lo hubiera dicho — mantiene la conversación coherente al retomar)
 *   - note  → user, envuelto en un marcador claro: es contexto INTERNO del
 *     dueño (Forja Inbox móvil, "Nota"), nunca algo que dijo el cliente ni
 *     algo que el bot prometió. NUNCA se manda por ningún adapter — solo
 *     entra aquí, al razonamiento del modelo.
 *
 * Vive fuera de agent.ts (que arrastra "agents"/streamText/tools) para que
 * consumidores livianos — el "Suggest Reply" del panel admin, tests — no
 * tengan que importar todo ese grafo solo por esta traducción.
 */
export function mapMessageToAiTurn(m: Pick<Message, "role" | "content">): {
  role: "user" | "assistant";
  content: string;
} {
  // Los marcadores internos ([MEDIA:], [IMAGE_URL:], [FILE:], [TPL:]) NO van al
  // prompt: son contabilidad, gastan tokens y el modelo llegaba a repetírselos
  // al cliente. Lo que sí aporta contexto ("hubo una foto", "hubo un archivo
  // ilegible") queda como frase corta — ver markersToPrompt.
  //
  // OJO: el ÚLTIMO turno NO pasa por aquí. agent.ts lo arma aparte porque
  // necesita la URL cruda del [IMAGE_URL:] para el mensaje multimodal, y el
  // Blindaje lee los rows de `history` directo. Ninguno depende de esta función.
  const content = markersToPrompt(m.content, m.role === "user" || m.role === "tool" ? "cliente" : "negocio");
  if (m.role === "tool") return { role: "user", content };
  if (m.role === "owner") return { role: "assistant", content };
  if (m.role === "note") {
    return { role: "user", content: `[Nota interna del dueño — el cliente NO ve esto]: ${content}` };
  }
  return { role: m.role as "user" | "assistant", content };
}
