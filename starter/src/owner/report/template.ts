/**
 * Plantilla del reporte + render.
 *
 * Dos salidas del mismo modelo:
 *  • renderReportHtml → reporte COMPLETO (página/PDF): rico, con gráficas SVG,
 *    paginado (print CSS). Es lo que se hostea en /admin/report y lo que se
 *    imprime a PDF. El dueño puede reemplazar la plantilla (report_template,
 *    la diseña Claude vía /reportes con su branding) mientras use los {{X}}.
 *  • renderReportEmail → email-safe compacto (resumen + KPIs + botón al completo),
 *    porque los clientes de correo rompen CSS moderno/SVG.
 *
 * Las gráficas se generan aquí, coloreadas con el acento del negocio, y se
 * inyectan como placeholders — así una plantilla custom las reordena sin recalcular.
 */
import type { ReportContext } from "./collect";
import type { ReportInsights } from "./insights";

export const DEFAULT_ACCENT = "#0f766e";
const SENT_COLORS = { contentos: "#3f8f5b", neutrales: "#c9bda6", frustrados: "#d9a441", molestos: "#c0512f" };

export interface ReportModel {
  businessName: string;
  dateLabel: string;
  accent: string;
  logoUrl: string | null;
  panelUrl: string;
  ctx: ReportContext;
  insights: ReportInsights;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ── gráficas (SVG/HTML estático, coloreado por acento) ──────────────────────
function donut(pct: number | null, accent: string): string {
  const p = pct ?? 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const off = c * (1 - p / 100);
  return `<svg width="148" height="148" viewBox="0 0 150 150" role="img" aria-label="Tasa de resolución ${p}%">
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="#ece9e3" stroke-width="14"/>
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 75 75)"/>
    <text x="75" y="80" text-anchor="middle" font-size="32" font-weight="800" fill="#16181d" font-family="sans-serif">${pct == null ? "—" : p + "%"}</text>
    <text x="75" y="99" text-anchor="middle" font-size="10.5" fill="#8a8f98" font-family="sans-serif">resueltas solo</text>
  </svg>`;
}

function hourlyChart(arr: number[], accent: string): string {
  const max = Math.max(1, ...arr);
  const peak = arr.indexOf(Math.max(...arr));
  const w = 15;
  const gap = 3;
  const h = 56;
  const bars = arr
    .map((v, i) => {
      const bh = Math.max(2, Math.round((v / max) * h));
      return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="2.5" fill="${i === peak && max > 1 ? accent : "#e2ded6"}"/>`;
    })
    .join("");
  const labels = [0, 6, 12, 18]
    .map((hh) => `<text x="${hh * (w + gap)}" y="${h + 12}" font-size="9" fill="#9aa0a8" font-family="sans-serif">${hh}</text>`)
    .join("");
  const tw = 24 * (w + gap);
  return `<svg width="100%" viewBox="0 0 ${tw} ${h + 14}" preserveAspectRatio="xMidYMax meet" role="img" aria-label="Actividad por hora">${bars}${labels}</svg>`;
}

function sentimentBar(ctx: ReportContext): string {
  const s = ctx.sentiment;
  const seg = (n: number, color: string): string => (n > 0 ? `<span style="flex:${n};background:${color}"></span>` : "");
  return `<div style="display:flex;height:13px;border-radius:7px;overflow:hidden;gap:2px;background:#f0ede8">${seg(s.contentos, SENT_COLORS.contentos)}${seg(s.neutrales, SENT_COLORS.neutrales)}${seg(s.frustrados, SENT_COLORS.frustrados)}${seg(s.molestos, SENT_COLORS.molestos)}</div>`;
}

function trendBars(arr: number[], accent: string): string {
  const max = Math.max(1, ...arr);
  return `<div style="display:flex;align-items:flex-end;gap:7px;height:62px">${arr
    .map((v, i) => `<span style="flex:1;height:${Math.max(6, Math.round((v / max) * 62))}px;border-radius:5px;background:${i === 6 ? accent : "#e2ded6"};display:block"></span>`)
    .join("")}</div>`;
}

function pills(topics: { name: string; count: number }[], accent: string): string {
  if (!topics.length) return `<span style="color:#9aa0a8;font-size:13px">Sin temas frecuentes hoy.</span>`;
  return topics
    .map(
      (t) =>
        `<span style="display:inline-block;background:#f2efe9;border-radius:999px;padding:5px 12px;margin:0 6px 8px 0;font-size:13px;color:#3a3d43">${esc(t.name)} <b style="color:${accent}">${t.count}</b></span>`,
    )
    .join("");
}

function starRow(rating: number | null, accent: string): string {
  if (rating == null) return `<span style="color:#9aa0a8">sin datos</span>`;
  const full = Math.round(rating);
  return `<span style="color:${accent};letter-spacing:1px">${"★".repeat(full)}${"☆".repeat(5 - full)}</span> <b style="color:#16181d">${rating}</b>`;
}

function delta(a: number, b: number): string {
  if (b === 0) return a > 0 ? `▲ ${a} nuevos` : "";
  const d = a - b;
  return d === 0 ? "sin cambio" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)} vs ayer`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ── llenado ─────────────────────────────────────────────────────────────────
function fillMap(model: ReportModel): Record<string, string> {
  const { ctx, insights, accent } = model;
  const s = ctx.stats;
  const bullets = (insights.insights.length ? insights.insights : ["Sin hallazgos que resaltar hoy."])
    .map(
      (x) =>
        `<div style="display:flex;gap:9px;margin:0 0 9px"><span style="color:${accent};font-weight:800">›</span><span style="line-height:1.5;color:#33373d">${esc(x)}</span></div>`,
    )
    .join("");
  const actions = (insights.actions.length ? insights.actions : ["Mantén el ritmo — nada urgente para mañana."])
    .map(
      (x) =>
        `<li style="margin:0 0 10px;line-height:1.5;color:#efe7d9"><span style="color:${accent}">●</span>&nbsp; ${esc(x)}</li>`,
    )
    .join("");
  const missed = ctx.missedQuestions.length
    ? ctx.missedQuestions
        .map(
          (q) =>
            `<div style="padding:9px 0;border-bottom:1px solid #efece6;font-size:13.5px;color:#33373d"><b style="color:${SENT_COLORS.molestos}">?</b>&nbsp; ${esc(q)}</div>`,
        )
        .join("")
    : `<div style="color:#3f8f5b;font-size:13.5px;padding:8px 0">Ninguna — el bot respondió todo lo que le preguntaron ✓</div>`;
  const logo = model.logoUrl
    ? `<img src="${esc(model.logoUrl)}" alt="" width="52" height="52" style="border-radius:12px;object-fit:cover">`
    : `<span style="display:inline-flex;width:52px;height:52px;border-radius:12px;background:${accent};color:#fff;align-items:center;justify-content:center;font-weight:800;font-size:19px">${esc(initials(model.businessName))}</span>`;

  return {
    ACCENT: accent,
    BUSINESS_NAME: esc(model.businessName),
    DATE_LABEL: esc(model.dateLabel),
    LOGO: logo,
    SUMMARY: esc(insights.summary),
    INSIGHT_BULLETS: bullets,
    ACTIONS_ITEMS: actions,
    DONUT: donut(ctx.resolutionRate, accent),
    HOURLY: hourlyChart(ctx.hourly, accent),
    SENTIMENT_BAR: sentimentBar(ctx),
    TREND: trendBars(ctx.trend7, accent),
    TOPIC_PILLS: pills(ctx.topics, accent),
    MISSED: missed,
    STARS: starRow(ctx.botRating, accent),
    PEAK_HOUR: ctx.peakHour == null ? "—" : `${String(ctx.peakHour).padStart(2, "0")}:00 UTC`,
    TREND_DELTA: ctx.trendDeltaPct == null ? "" : `▲ ${ctx.trendDeltaPct}% vs promedio`,
    CUSTOMER_MESSAGES: String(s.customerMessages),
    NEW_CONVERSATIONS: String(s.newConversations),
    NEW_LEADS: String(s.newLeads),
    HOT_LEADS: String(s.hotLeads),
    D_MESSAGES: delta(s.customerMessages, ctx.prev.customerMessages),
    D_CONVERSATIONS: delta(s.newConversations, ctx.prev.newConversations),
    SENT_CONTENTOS: String(ctx.sentiment.contentos),
    SENT_NEUTRALES: String(ctx.sentiment.neutrales),
    SENT_FRUSTRADOS: String(ctx.sentiment.frustrados),
    SENT_MOLESTOS: String(ctx.sentiment.molestos),
    UPSET: String(s.upsetCustomers),
    FOLLOWUPS_SENT: String(ctx.followupsSent),
    REVIEWS_REQUESTED: String(ctx.reviewsRequested),
    TICKETS: `${s.ticketsResolved}/${s.ticketsOpened}`,
    PANEL_URL: model.panelUrl,
  };
}

export function renderReportHtml(model: ReportModel, template: string = DEFAULT_REPORT_TEMPLATE): string {
  const map = fillMap(model);
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (k in map ? map[k] : ""));
}

/** Email-safe: teaser compacto (los clientes rompen CSS/SVG). Botón al completo. */
export function renderReportEmail(model: ReportModel): string {
  const { ctx, insights, accent } = model;
  const s = ctx.stats;
  const bullets = insights.insights
    .slice(0, 3)
    .map((x) => `<li style="margin:0 0 8px;line-height:1.5">${esc(x)}</li>`)
    .join("");
  const kpi = (v: string | number, l: string): string =>
    `<td width="25%" style="padding:6px"><div style="border:1px solid #e6e8eb;border-radius:12px;padding:14px 10px;text-align:center"><div style="font-size:26px;font-weight:800;color:#16181d">${v}</div><div style="font-size:11px;color:#6b7280;margin-top:2px">${l}</div></div></td>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:26px 14px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6e8eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16181d">
  <tr><td style="height:5px;background:${accent}"></td></tr>
  <tr><td style="padding:26px 30px 6px"><div style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${accent}">Reporte diario · ${esc(model.dateLabel)}</div><div style="font-size:24px;font-weight:800;letter-spacing:-.02em;margin-top:5px">${esc(model.businessName)}</div></td></tr>
  <tr><td style="padding:10px 30px 4px"><p style="font-size:15.5px;line-height:1.5;color:#2b2f36;margin:0">${esc(insights.summary)}</p></td></tr>
  <tr><td style="padding:14px 24px 2px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${kpi(s.customerMessages, "Mensajes")}${kpi(s.newConversations, "Clientes")}${kpi(s.newLeads, "Leads")}${kpi(s.hotLeads, "Ventas 🔥")}</tr></table></td></tr>
  ${bullets ? `<tr><td style="padding:12px 30px 2px"><div style="border-left:3px solid ${accent};background:#f8fafa;border-radius:0 12px 12px 0;padding:14px 16px"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${accent};margin-bottom:6px">Lo que veo</div><ul style="margin:0;padding-left:18px;font-size:14px;color:#22262d">${bullets}</ul></div></td></tr>` : ""}
  <tr><td style="padding:20px 30px 30px"><a href="${model.panelUrl}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:10px">Ver el reporte completo →</a><p style="font-size:11px;color:#9aa1ab;margin:16px 0 0;line-height:1.5">Reporte con gráficas, temas y tendencia en tu panel. El análisis lo escribe la misma IA que atiende a tus clientes.</p></td></tr>
</table></td></tr></table></body></html>`;
}

/** Texto plano (fallback email + Telegram). */
export function renderReportText(model: ReportModel): string {
  const s = model.ctx.stats;
  const out = [
    `${model.businessName} — ${model.dateLabel}`,
    ``,
    model.insights.summary,
    ``,
    `${s.customerMessages} mensajes · ${s.newConversations} clientes · ${s.newLeads} leads · ${s.hotLeads} ventas calientes`,
  ];
  if (model.insights.insights.length) out.push(``, "Lo que veo:", ...model.insights.insights.map((x) => "• " + x));
  if (model.insights.actions.length) out.push(``, "Para mañana:", ...model.insights.actions.map((x) => "→ " + x));
  out.push(``, `Reporte completo: ${model.panelUrl}`);
  return out.join("\n");
}

// Plantilla COMPLETA (página/PDF). CSS moderno + print para buena paginación.
export const DEFAULT_REPORT_TEMPLATE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte · {{BUSINESS_NAME}} · {{DATE_LABEL}}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#eceae6;color:#16181d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .page{max-width:820px;margin:0 auto;padding:26px 20px 44px}
  .card{background:#fff;border:1px solid #e7e4dd;border-radius:18px;padding:22px 24px}
  .grid{display:grid;gap:16px}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:{{ACCENT}};display:flex;align-items:center;gap:8px}
  .eyebrow::before{content:"";width:4px;height:15px;border-radius:2px;background:{{ACCENT}};display:inline-block}
  .kpi-num{font-size:40px;font-weight:800;letter-spacing:-.03em;line-height:1}
  .muted{color:#6b7280;font-size:12.5px}
  h1{font-size:26px;font-weight:800;letter-spacing:-.03em;margin:0}
  @media print{
    body{background:#fff}
    .page{max-width:none;padding:0}
    .card,section,.kpirow{page-break-inside:avoid;break-inside:avoid}
    @page{size:A4;margin:12mm}
  }
  @media(max-width:640px){.two{grid-template-columns:1fr!important}.kpirow{grid-template-columns:1fr 1fr!important}}
</style></head>
<body><div class="page">

  <!-- HEADER -->
  <div style="background:#211d18;border-radius:18px;padding:24px 28px;display:flex;align-items:center;justify-content:space-between;gap:16px;color:#f3ede2">
    <div style="display:flex;align-items:center;gap:16px">{{LOGO}}
      <div><div style="font-size:23px;font-weight:800;letter-spacing:-.02em">{{BUSINESS_NAME}}</div>
      <div style="font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#b9ac97;margin-top:3px">Reporte de operación · Diario</div></div></div>
    <div style="text-align:right"><div style="font-weight:700;font-size:14px">{{DATE_LABEL}}</div>
    <div style="font-size:12px;color:#b9ac97;margin-top:2px">Generado por tu bot de Forja</div></div>
  </div>

  <!-- RESUMEN + DONUT -->
  <div class="grid two" style="grid-template-columns:1.9fr 1fr;margin-top:16px">
    <div class="card">
      <div class="eyebrow">Resumen del día</div>
      <p style="font-size:18px;line-height:1.5;color:#22262d;margin:12px 0 14px">{{SUMMARY}}</p>
      {{INSIGHT_BULLETS}}
    </div>
    <div class="card" style="text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div class="eyebrow" style="align-self:flex-start">Tasa de resolución</div>
      <div style="margin:12px 0 4px">{{DONUT}}</div>
    </div>
  </div>

  <!-- KPIs -->
  <div class="grid kpirow" style="grid-template-columns:repeat(4,1fr);margin-top:16px">
    <div class="card"><div class="kpi-num">{{CUSTOMER_MESSAGES}}</div><div class="muted" style="margin-top:6px">Mensajes de clientes</div></div>
    <div class="card"><div class="kpi-num">{{NEW_CONVERSATIONS}}</div><div class="muted" style="margin-top:6px">Conversaciones</div></div>
    <div class="card"><div class="kpi-num">{{NEW_LEADS}}</div><div class="muted" style="margin-top:6px">Leads nuevos</div></div>
    <div class="card" style="background:#f6efe3;border-color:#ecdcc2"><div class="kpi-num">{{HOT_LEADS}}</div><div class="muted" style="margin-top:6px">Ventas calientes</div></div>
  </div>

  <!-- CALIDAD + ACTIVIDAD -->
  <div class="grid two" style="grid-template-columns:1fr 1fr;margin-top:16px">
    <div class="card"><div class="eyebrow">Calidad de atención</div>
      <div style="margin:14px 0 10px">{{SENTIMENT_BAR}}</div>
      <div class="muted" style="display:flex;flex-wrap:wrap;gap:12px">
        <span>● {{SENT_CONTENTOS}} contentos</span><span style="color:#8a8f98">● {{SENT_NEUTRALES}} neutrales</span>
        <span style="color:#c99a2e">● {{SENT_FRUSTRADOS}} frustrados</span><span style="color:#c0512f">● {{SENT_MOLESTOS}} molestos</span></div>
      <div style="display:flex;justify-content:space-between;margin-top:16px;font-size:14px"><span class="muted">Calificación del bot</span><span>{{STARS}}</span></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:14px"><span class="muted">Clientes molestos</span><b style="color:#c0512f">{{UPSET}}</b></div>
    </div>
    <div class="card"><div class="eyebrow">Actividad por hora</div>
      <div style="margin:16px 0 8px">{{HOURLY}}</div>
      <div class="muted">Hora más movida: <b style="color:#16181d">{{PEAK_HOUR}}</b></div>
    </div>
  </div>

  <!-- TEMAS + VENTAS -->
  <div class="grid two" style="grid-template-columns:1.15fr 1fr;margin-top:16px">
    <div class="card"><div class="eyebrow">Lo que más preguntaron</div>
      <div style="margin:14px 0 6px">{{TOPIC_PILLS}}</div>
      <div class="eyebrow" style="margin-top:18px;color:#c0512f">Preguntas que el bot no supo</div>
      <div style="margin-top:8px">{{MISSED}}</div>
    </div>
    <div class="card"><div class="eyebrow">Ventas y seguimiento</div>
      <div style="margin-top:12px">
        <div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #efece6;font-size:14px"><span>Seguimientos enviados (Cazador)</span><b>{{FOLLOWUPS_SENT}}</b></div>
        <div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #efece6;font-size:14px"><span>Tickets resueltos / abiertos</span><b>{{TICKETS}}</b></div>
        <div style="display:flex;justify-content:space-between;padding:11px 0;font-size:14px"><span>Reseñas pedidas</span><b>{{REVIEWS_REQUESTED}}</b></div>
      </div>
    </div>
  </div>

  <!-- TENDENCIA + ACCIONES -->
  <div class="grid two" style="grid-template-columns:1fr 1fr;margin-top:16px">
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div class="eyebrow">Tendencia · 7 días</div><span style="font-size:12px;font-weight:700;color:#3f8f5b">{{TREND_DELTA}}</span></div>
      <div style="margin-top:16px">{{TREND}}</div></div>
    <div class="card" style="background:#211d18;color:#f3ede2;border-color:#211d18">
      <div style="font-size:22px;font-weight:800;letter-spacing:-.02em;color:{{ACCENT}};line-height:1.1">Acciones<br>recomendadas</div>
      <ul style="list-style:none;margin:16px 0 0;padding:0;font-size:14px">{{ACTIONS_ITEMS}}</ul>
    </div>
  </div>

  <div style="text-align:center;margin-top:22px"><a href="{{PANEL_URL}}" style="color:#6b7280;font-size:12px;text-decoration:none">Abrir mi panel →</a></div>

</div></body></html>`;
