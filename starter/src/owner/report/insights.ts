/**
 * Insights del reporte — la parte inteligente. Usa el MISMO modelo que el bot
 * (workModel: el que el dueño configuró, con el failover del agente detrás)
 * para leer los datos del día y escribir un análisis de negocio: resumen,
 * hallazgos y acciones para mañana. Grounded: solo razona sobre los datos que
 * se le pasan, no inventa. Si el modelo falla o devuelve basura, cae a un
 * resumen mínimo con los números — por eso una llave BYO muerta se veía como
 * "el reporte salió sin insights" y no como un error.
 */
import type { Env } from "../../env";
import { workModel } from "../../llm/work-model";
import type { ReportContext } from "./collect";

export interface ReportInsights {
  summary: string; // 2-3 frases
  insights: string[]; // 2-4 hallazgos
  actions: string[]; // 2-3 acciones para mañana
}

function fallback(ctx: ReportContext): ReportInsights {
  const s = ctx.stats;
  return {
    summary: `Hoy tu bot atendió ${s.customerMessages} mensajes de ${s.newConversations} clientes y capturó ${s.newLeads} leads.`,
    insights: s.hotLeads > 0 ? [`Quedaron ${s.hotLeads} ventas calientes sin cerrar — vale la pena darles seguimiento.`] : [],
    actions: [],
  };
}

function delta(a: number, b: number): string {
  if (b === 0) return a > 0 ? `nuevo (${a})` : "sin cambio";
  const d = a - b;
  return `${d >= 0 ? "+" : ""}${d} vs ayer (${b})`;
}

export async function generateReportInsights(env: Env, ctx: ReportContext): Promise<ReportInsights> {
  const { stats, prev } = ctx;
  const material = [
    `Negocio: ${env.BUSINESS_NAME}`,
    ``,
    `MÉTRICAS (hoy vs ayer):`,
    `- Mensajes de clientes: ${stats.customerMessages} (${delta(stats.customerMessages, prev.customerMessages)})`,
    `- Clientes que escribieron: ${stats.newConversations} (${delta(stats.newConversations, prev.newConversations)})`,
    `- Leads nuevos: ${stats.newLeads} (${delta(stats.newLeads, prev.newLeads)})`,
    `- Ventas calientes sin cerrar: ${stats.hotLeads}`,
    `- Tickets abiertos: ${stats.ticketsOpened}`,
    `- Clientes molestos: ${stats.upsetCustomers}`,
    ctx.topics.length ? `\nTEMAS FRECUENTES HOY: ${ctx.topics.join(", ")}` : "",
    ctx.hotLeadSummaries.length ? `\nVENTAS CALIENTES:\n${ctx.hotLeadSummaries.map((s) => "- " + s).join("\n")}` : "",
    ctx.summaries.length ? `\nMUESTRA DE CONVERSACIONES:\n${ctx.summaries.slice(0, 12).map((s) => "- " + s).join("\n")}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const prompt = `Eres el analista de negocio de ${env.BUSINESS_NAME}. Con los datos del día de su asistente de WhatsApp, escríbele al dueño (NO técnico) un análisis breve, concreto y accionable. Español claro y directo, sin relleno, sin tecnicismos. NO inventes nada que no esté en los datos; si un dato no está, no lo menciones.

DATOS:
${material}

Devuelve SOLO un JSON válido, sin texto alrededor, con esta forma:
{
  "summary": "2-3 frases que resuman el día en lenguaje de negocio (cómo estuvo, lo más importante)",
  "insights": ["2 a 4 hallazgos concretos: patrones, cambios vs ayer, riesgos u oportunidades que veas en los datos"],
  "actions": ["2 a 3 acciones específicas y realistas para mañana"]
}`;

  try {
    const llm = await workModel(env, "smart", "reportes");
    const { text } = await llm.generate({ prompt });
    const parsed = parseInsights(text);
    if (parsed) return parsed;
  } catch (e) {
    console.error("[report] insights failed:", e instanceof Error ? e.message : e);
  }
  return fallback(ctx);
}

function parseInsights(text: string): ReportInsights | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    if (typeof o.summary !== "string" || !o.summary.trim()) return null;
    const arr = (x: unknown): string[] =>
      Array.isArray(x) ? x.map((v) => String(v).trim()).filter(Boolean).slice(0, 5) : [];
    return { summary: o.summary.trim(), insights: arr(o.insights), actions: arr(o.actions) };
  } catch {
    return null;
  }
}
