/**
 * Provider-agnostic model tier. The active provider (Anthropic/OpenAI) maps each
 * tier to a concrete model id in src/llm/provider.ts.
 *   fast  = cheap default (e.g. Haiku / gpt-4o-mini)
 *   smart = upgrade for hard turns (e.g. Sonnet / gpt-4o)
 */
export type Tier = "fast" | "smart";

export const FRUSTRATION_KEYWORDS_BY_LANG: Record<string, string[]> = {
  es: ["no sirve", "no funciona", "está roto", "horrible", "una porquería", "qué basura", "harta", "harto"],
  en: ["doesn't work", "doesnt work", "broken", "nothing works", "useless", "garbage", "frustrating", "ridiculous"],
  pt: ["não funciona", "nao funciona", "horrível", "horrivel", "uma porcaria", "lixo"],
};

export interface ModelSelectionContext {
  toolCallsInLast2Turns: number;
  lastUserText: string;
  lastUserLang: string;
  hasImage: boolean;
  imageRetryCount: number;
  lastSearchKbScore: number;
  /** El bot toma pedidos/citas/reservas (tiene tools de intake habilitadas). Esos
   *  flujos son de varios pasos ("un dato a la vez") y el tier barato los aplasta
   *  en un solo mensaje — por eso arrancan directo en el modelo inteligente. */
  transactional: boolean;
}

export function selectModel(ctx: ModelSelectionContext): Tier {
  // Bots transaccionales: el flujo de pedido/cita es de varios pasos y el modelo
  // barato lo rompe (junta bebida + dirección + pago en una burbuja, sin pedir la
  // variedad primero). Se resuelve con el tier inteligente. El tope de presupuesto
  // aún puede bajarlo, y el dueño puede forzar "Económico" si prefiere ahorrar.
  if (ctx.transactional) return "smart";
  if (ctx.toolCallsInLast2Turns > 3) return "smart";
  if (ctx.hasImage && ctx.imageRetryCount > 0) return "smart";
  if (ctx.lastSearchKbScore < 0.5) return "smart";

  const keywords = FRUSTRATION_KEYWORDS_BY_LANG[ctx.lastUserLang] ?? [];
  const lower = ctx.lastUserText.toLowerCase();
  if (keywords.some((k) => lower.includes(k))) return "smart";

  return "fast";
}
