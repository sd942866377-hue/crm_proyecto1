// esc(tr("reviews.tituloPagina")) — el dueño lee las respuestas de la encuesta de satisfacción:
// calificación 1-5 (modo numérico/ambos) y/o la opinión en palabras del cliente
// (modo abierto/ambos). Read-only; una fila por conversación con encuesta
// respondida, más una tira de resumen (total, promedio, con comentario).
import type { Env } from "../../env";
import { traductor, type Traductor } from "../i18n";
import { Db } from "../../db/client";
import { layout, renderConfigPrompt } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

interface Row {
  conversation_id: string;
  score: number | null;
  responded_at: number;
  response_text: string | null;
  display_name: string | null;
  channel_user_id: string | null;
}

function stars(score: number): string {
  const full = Math.max(0, Math.min(5, score));
  return `<span style="color:var(--accent-2);letter-spacing:2px">${"★".repeat(full)}<span style="color:var(--dim)">${"★".repeat(5 - full)}</span></span>`;
}

function timeAgo(ts: number, now: number, tr: Traductor): string {
  const h = Math.floor(Math.max(0, now - ts) / 3_600_000);
  if (h < 1) return esc(tr("reviews.haceUnMomento"));
  if (h < 24) return esc(tr("reviews.haceHoras").replace("{n}", String(h)));
  return esc(tr("reviews.haceDias").replace("{n}", String(Math.floor(h / 24))));
}

export async function renderReviews(env: Env): Promise<string> {
  const tr = traductor(env);
  const db = new Db(env.DB);
  const now = Date.now();
  const rows = await db.all<Row>(
    `SELECT s.conversation_id, s.score, s.responded_at, o.response_text,
       c.display_name, c.channel_user_id
     FROM survey_sends s
     LEFT JOIN survey_open_responses o ON o.conversation_id = s.conversation_id
     LEFT JOIN conversations c ON c.id = s.conversation_id
     WHERE s.responded_at IS NOT NULL
     ORDER BY s.responded_at DESC
     LIMIT 100`,
    [],
  );

  const scored = rows.filter((r) => r.score !== null);
  const avg = scored.length
    ? (scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length).toFixed(1)
    : "—";
  const withText = rows.filter((r) => r.response_text).length;

  const configPrompt = tr("reviews.promptConfig");

  const stat = (num: string, label: string): string =>
    `<div><div class="font-display" style="font-size:26px;font-weight:700;line-height:1">${num}</div><div class="text-dim" style="font-size:11px;margin-top:4px">${label}</div></div>`;
  const strip = `<div style="display:flex;gap:30px;flex-wrap:wrap;margin-bottom:20px">
    ${stat(String(rows.length), esc(tr("reviews.statRespuestas")))}
    ${stat(scored.length ? `${avg}<span style="font-size:14px;color:var(--dim)">/5</span>` : "—", esc(tr("reviews.statPromedio")))}
    ${stat(String(withText), esc(tr("reviews.statConComentario")))}
  </div>`;

  const list = rows.length
    ? rows
        .map((r) => {
          const who = esc(r.display_name || r.channel_user_id || esc(tr("reviews.clienteSinNombre")));
          const link = `/admin/conversations?c=${encodeURIComponent(r.conversation_id)}`;
          const scoreEl =
            r.score !== null ? stars(r.score) : `<span class="text-dim" style="font-size:11px">${esc(tr("reviews.soloComentario"))}</span>`;
          const lowFlag =
            r.score !== null && r.score <= 2
              ? `<span style="border:1px solid var(--bad);color:var(--bad);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;padding:1px 6px;margin-left:8px">${esc(tr("reviews.etiquetaBaja"))}</span>`
              : "";
          const textEl = r.response_text
            ? `<div style="font-size:13px;color:var(--cream);margin-top:7px;line-height:1.55">“${esc(r.response_text)}”</div>`
            : "";
          return `<a href="${link}" class="leadrow" style="display:block;border-top:1px solid var(--line);padding:14px 16px;color:inherit">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="display:flex;align-items:center;min-width:0"><span class="font-mono" style="font-size:12.5px;color:var(--cream)">${who}</span>${lowFlag}</div>
              <div style="display:flex;align-items:center;gap:12px;flex:none">${scoreEl}<span class="text-dim" style="font-size:10.5px">${timeAgo(r.responded_at, now, tr)}</span></div>
            </div>
            ${textEl}
          </a>`;
        })
        .join("")
    : `<div style="padding:22px 16px">
        <div class="text-dim" style="font-size:12.5px;line-height:1.6">
          ${tr("reviews.vacioTexto")}
        </div>
        <div style="max-width:560px;margin-top:16px">
          ${renderConfigPrompt(
            configPrompt,
            esc(tr("reviews.vacioPromptClaude")),
          tr,
          )}
        </div>
      </div>`;

  const body = `<div style="max-width:760px">
    ${strip}
    <div style="border:1px solid var(--line);background:var(--panel)">${list}</div>
  </div>`;

  return layout({ title: esc(tr("reviews.tituloPagina")), activeTab: "reviews", body, env });
}
