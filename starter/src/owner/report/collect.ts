/**
 * Recolección de datos para el reporte. Junta TODO lo que el reporte muestra:
 * conteos del día, tendencia (vs ayer y vs 7 días), resolución, sentimiento,
 * rating del bot, actividad por hora, temas, preguntas sin responder,
 * seguimientos del Cazador y reseñas. Y una muestra de resúmenes: el material
 * que la IA usa para escribir insights reales (no inventa).
 */
import type { Env } from "../../env";
import { Db } from "../../db/client";
import { NOT_TEST_CONV, NOT_TEST_REF, NOT_TEST_REF_NULLABLE } from "../../db/testFilter";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReportStats {
  customerMessages: number;
  newConversations: number;
  newLeads: number;
  hotLeads: number;
  ticketsOpened: number;
  ticketsResolved: number;
  upsetCustomers: number;
}

export interface Sentiment {
  contentos: number;
  neutrales: number;
  frustrados: number;
  molestos: number;
}

export interface ReportContext {
  stats: ReportStats;
  prev: ReportStats;
  resolutionRate: number | null; // 0-100, null si no hubo análisis
  analyzed: number;
  sentiment: Sentiment;
  botRating: number | null; // promedio bot_score 1-5
  hourly: number[]; // 24 buckets (UTC) de mensajes de clientes
  peakHour: number | null;
  topics: { name: string; count: number }[];
  missedQuestions: string[];
  followupsSent: number; // Cazador
  reviewsRequested: number;
  trend7: number[]; // 7 días, izquierda→derecha (índice 6 = hoy)
  trendDeltaPct: number | null; // hoy vs promedio de 7 días
  summaries: string[]; // material para la IA
  hotLeadSummaries: string[];
}

async function baseStats(db: Db, since: number, until: number): Promise<ReportStats> {
  const c = async (sql: string): Promise<number> =>
    (await db.first<{ n: number }>(sql, [since, until]))?.n ?? 0;
  const [customerMessages, newConversations, newLeads, hotLeads, ticketsOpened, ticketsResolved, upsetCustomers] =
    await Promise.all([
      c(`SELECT COUNT(*) AS n FROM messages WHERE created_at > ? AND created_at <= ? AND role = 'user' AND ${NOT_TEST_REF}`),
      c(`SELECT COUNT(*) AS n FROM conversations WHERE started_at > ? AND started_at <= ? AND ${NOT_TEST_CONV}`),
      c(`SELECT COUNT(*) AS n FROM leads WHERE created_at > ? AND created_at <= ? AND ${NOT_TEST_REF_NULLABLE}`),
      c("SELECT COUNT(*) AS n FROM conversation_insights WHERE analyzed_at > ? AND analyzed_at <= ? AND sale_opportunity = 1"),
      c(`SELECT COUNT(*) AS n FROM tickets WHERE created_at > ? AND created_at <= ? AND ${NOT_TEST_REF}`),
      c(`SELECT COUNT(*) AS n FROM tickets WHERE resolved_at > ? AND resolved_at <= ? AND ${NOT_TEST_REF}`),
      c("SELECT COUNT(*) AS n FROM conversation_insights WHERE analyzed_at > ? AND analyzed_at <= ? AND sentiment IN ('angry','frustrated')"),
    ]);
  return { customerMessages, newConversations, newLeads, hotLeads, ticketsOpened, ticketsResolved, upsetCustomers };
}

/** Conteos de las últimas 24 h (compat con callers/tests previos). */
export async function collectDailyStats(env: Env, now: number): Promise<ReportStats> {
  return baseStats(new Db(env.DB), now - DAY_MS, now);
}

export async function collectReportContext(env: Env, now: number): Promise<ReportContext> {
  const db = new Db(env.DB);
  const since = now - DAY_MS;

  const [stats, prev] = await Promise.all([
    baseStats(db, since, now),
    baseStats(db, now - 2 * DAY_MS, since),
  ]);

  // Análisis de hoy: sentimiento, resolución, rating, temas, preguntas sin responder.
  const insightRows = await db.all<{
    sentiment: string | null;
    resolution: string | null;
    bot_score: number | null;
    topics: string | null;
    summary: string | null;
    missed_kb: string | null;
    sale_opportunity: number | null;
  }>(
    "SELECT sentiment, resolution, bot_score, topics, summary, missed_kb, sale_opportunity FROM conversation_insights WHERE analyzed_at > ? ORDER BY analyzed_at DESC LIMIT 200",
    [since],
  );

  const sentiment: Sentiment = { contentos: 0, neutrales: 0, frustrados: 0, molestos: 0 };
  let resolved = 0;
  let scoreSum = 0;
  let scoreN = 0;
  const topicCount = new Map<string, number>();
  const missedQuestions: string[] = [];
  const summaries: string[] = [];
  const hotLeadSummaries: string[] = [];

  for (const r of insightRows) {
    if (r.sentiment === "positive") sentiment.contentos++;
    else if (r.sentiment === "neutral" || r.sentiment === "meh") sentiment.neutrales++;
    else if (r.sentiment === "frustrated") sentiment.frustrados++;
    else if (r.sentiment === "angry") sentiment.molestos++;
    if (r.resolution === "resolved") resolved++;
    if (typeof r.bot_score === "number") {
      scoreSum += r.bot_score;
      scoreN++;
    }
    if (r.topics) {
      let ts: string[] = [];
      try {
        const p = JSON.parse(r.topics);
        ts = Array.isArray(p) ? p.map(String) : [];
      } catch {
        ts = r.topics.split(",").map((s) => s.trim());
      }
      for (const t of ts) if (t) topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    }
    if (r.missed_kb && r.missed_kb.trim() && missedQuestions.length < 6) missedQuestions.push(r.missed_kb.trim());
    if (r.summary) {
      summaries.push(r.summary);
      if ((r.sale_opportunity ?? 0) === 1) hotLeadSummaries.push(r.summary);
    }
  }
  const analyzed = insightRows.length;

  // Actividad por hora (UTC) + follow-ups + reseñas + tendencia 7 días.
  const [msgRows, followupsSent, reviewsRequested, trendRows] = await Promise.all([
    db.all<{ created_at: number }>(
      `SELECT created_at FROM messages WHERE created_at > ? AND role = 'user' AND ${NOT_TEST_REF}`,
      [since],
    ),
    db.first<{ n: number }>("SELECT COUNT(*) AS n FROM followup_sends WHERE sent_at > ?", [since]).then((r) => r?.n ?? 0),
    db.first<{ n: number }>("SELECT COUNT(*) AS n FROM review_requests WHERE sent_at > ?", [since]).then((r) => r?.n ?? 0),
    db.all<{ d: number; n: number }>(
      `SELECT CAST((? - created_at) / 86400000 AS INTEGER) AS d, COUNT(*) AS n FROM messages WHERE created_at > ? AND role = 'user' AND ${NOT_TEST_REF} GROUP BY d`,
      [now, now - 7 * DAY_MS],
    ),
  ]);

  const hourly = new Array(24).fill(0) as number[];
  for (const m of msgRows) {
    const h = new Date(m.created_at).getUTCHours();
    if (h >= 0 && h < 24) hourly[h]++;
  }
  const peakVal = Math.max(0, ...hourly);
  const peakHour = peakVal > 0 ? hourly.indexOf(peakVal) : null;

  // trend7[6] = hoy, [0] = hace 6 días
  const trend7 = new Array(7).fill(0) as number[];
  for (const t of trendRows) {
    const idx = 6 - t.d;
    if (idx >= 0 && idx < 7) trend7[idx] = t.n;
  }
  const avg7 = trend7.reduce((a, b) => a + b, 0) / 7;
  const trendDeltaPct = avg7 > 0 ? Math.round(((trend7[6] - avg7) / avg7) * 100) : null;

  const topics = [...topicCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  return {
    stats,
    prev,
    resolutionRate: analyzed > 0 ? Math.round((resolved / analyzed) * 100) : null,
    analyzed,
    sentiment,
    botRating: scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) / 10 : null,
    hourly,
    peakHour,
    topics,
    missedQuestions,
    followupsSent,
    reviewsRequested,
    trend7,
    trendDeltaPct,
    summaries: summaries.slice(0, 20),
    hotLeadSummaries: hotLeadSummaries.slice(0, 8),
  };
}
