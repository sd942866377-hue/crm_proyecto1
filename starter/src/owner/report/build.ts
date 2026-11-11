/**
 * Arma el reporte completo: junta datos → IA escribe insights → llena la
 * plantilla (la custom del dueño si existe, si no la default). Devuelve el HTML
 * rico (página/PDF), el email-safe y el texto. No manda nada (eso lo hace dailyReport).
 */
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { selfOrigin } from "../../lib/self-origin";
import { collectReportContext, type ReportContext } from "./collect";
import { generateReportInsights } from "./insights";
import {
  DEFAULT_ACCENT,
  DEFAULT_REPORT_TEMPLATE,
  renderReportEmail,
  renderReportHtml,
  renderReportText,
  type ReportModel,
} from "./template";

export interface BuiltReport {
  /** Título limpio del reporte (lo que ve la app). El subject del email es este + 📊. */
  title: string;
  subject: string;
  html: string; // reporte completo (página/PDF)
  emailHtml: string; // email-safe (teaser + botón)
  text: string;
  model: ReportModel;
  empty: boolean;
}

function dateLabel(now: number): string {
  try {
    return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
      new Date(now),
    );
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

export async function buildReport(env: Env, now: number): Promise<BuiltReport> {
  const ctx = await collectReportContext(env, now);
  const empty = ctx.stats.customerMessages === 0 && ctx.stats.newLeads === 0;

  const settings = new SettingsRepo(new Db(env.DB));
  const [customTemplate, accent, logo] = await Promise.all([
    settings.get(SETTING_KEYS.reportTemplate),
    settings.get(SETTING_KEYS.reportAccent),
    settings.get(SETTING_KEYS.reportLogo),
  ]);

  const insights = empty
    ? { summary: "Día tranquilo — hoy no hubo mensajes de clientes.", insights: [], actions: [] }
    : await generateReportInsights(env, ctx);

  const model: ReportModel = {
    businessName: env.BUSINESS_NAME,
    dateLabel: dateLabel(now),
    accent: (accent && accent.trim()) || DEFAULT_ACCENT,
    logoUrl: (logo && logo.trim()) || null,
    panelUrl: `${await selfOrigin(env)}/admin/report`,
    ctx,
    insights,
  };

  const title = `Tu resumen de hoy — ${env.BUSINESS_NAME}`;
  return {
    title,
    subject: `📊 ${title}`,
    html: renderReportHtml(model, (customTemplate && customTemplate.trim()) || DEFAULT_REPORT_TEMPLATE),
    emailHtml: renderReportEmail(model),
    text: renderReportText(model),
    model,
    empty,
  };
}

/** Ventana que cubre el reporte (las últimas 24 h). */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * El reporte como DATOS (Contrato v3.2 §9): lo que se guarda en
 * `report_last_json` y lo que sirve GET /api/report/latest. La app lo pinta con
 * sus propias tarjetas, así que aquí no va nada de HTML — solo números, textos
 * y el markdown del cuerpo.
 */
export interface ReportSnapshot {
  generated_at: number;
  period: { from: number; to: number };
  title: string;
  empty: boolean;
  summary: string;
  insights: string[];
  actions: string[];
  stats: ReportSnapshotStats;
  prev: ReportSnapshotStats;
  topics: { name: string; count: number }[];
  missed_questions: string[];
}

export interface ReportSnapshotStats {
  messages: number;
  conversations: number;
  leads: number;
  hot_leads: number;
  tickets_opened: number;
  tickets_resolved: number;
  upset: number;
}

function snapshotStats(s: ReportContext["stats"]): ReportSnapshotStats {
  return {
    messages: s.customerMessages,
    conversations: s.newConversations,
    leads: s.newLeads,
    hot_leads: s.hotLeads,
    tickets_opened: s.ticketsOpened,
    tickets_resolved: s.ticketsResolved,
    upset: s.upsetCustomers,
  };
}

/**
 * Cuerpo del reporte en markdown, para la app (Contrato v3.2 §9). Se arma
 * SIEMPRE desde el snapshot — el guardado o el recién construido — así hay un
 * solo renderer y no dos textos que se separen con el tiempo. Es el mismo
 * contenido que renderReportText, con marcas y sin el link a /admin/report: en
 * la app el reporte YA está abierto, y ese link exige pasar por el SSO.
 */
export function reportMarkdown(snap: ReportSnapshot, businessName: string): string {
  const s = snap.stats;
  const out = [
    `**${businessName}** · ${dateLabel(snap.generated_at)}`,
    ``,
    snap.summary,
    ``,
    `**${s.messages}** mensajes · **${s.conversations}** clientes · **${s.leads}** interesados · **${s.hot_leads}** ventas calientes`,
  ];
  if (snap.insights.length) out.push(``, `**Lo que veo**`, ...snap.insights.map((x) => `- ${x}`));
  if (snap.actions.length) out.push(``, `**Para mañana**`, ...snap.actions.map((x) => `- ${x}`));
  if (snap.topics.length) {
    out.push(``, `**Temas de hoy**: ${snap.topics.map((t) => `${t.name} (${t.count})`).join(" · ")}`);
  }
  if (snap.missed_questions.length) {
    out.push(``, `**Lo que no supo contestar**`, ...snap.missed_questions.map((q) => `- ${q}`));
  }
  return out.join("\n");
}

export function reportSnapshot(report: BuiltReport, now: number): ReportSnapshot {
  const { ctx, insights } = report.model;
  return {
    generated_at: now,
    period: { from: now - DAY_MS, to: now },
    title: report.title,
    empty: report.empty,
    summary: insights.summary,
    insights: insights.insights,
    actions: insights.actions,
    stats: snapshotStats(ctx.stats),
    prev: snapshotStats(ctx.prev),
    topics: ctx.topics,
    missed_questions: ctx.missedQuestions,
  };
}
