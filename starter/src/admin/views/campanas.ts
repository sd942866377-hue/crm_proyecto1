// Campañas — envío segmentado por WhatsApp respetando las reglas del canal:
// dentro de la ventana de 24h va mensaje free-form (gratis); fuera va plantilla
// HSM aprobada (Twilio Content API) que gasta el tope diario del número
// (default 250). La página enseña ambos números ANTES de mandar para que el
// dueño planee — la cuota es oro el día del evento.
import type { Env } from "../../env";
import { traductor, type Traductor } from "../i18n";
import { Db } from "../../db/client";
import { layout, renderConfigPrompt } from "./layout";
import { segments, segmentCounts } from "../../segments";
import {
  listContentTemplates,
  templatesSentLast24h,
  dailyTemplateCap,
  campaignHistory,
} from "../../campaigns";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function fmtAgo(ms: number, tr: Traductor): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 60) return tr("campanas.haceMin").replace("{n}", String(min));
  const h = Math.floor(min / 60);
  if (h < 24) return tr("campanas.haceHoras").replace("{n}", String(h));
  return tr("campanas.haceDias").replace("{n}", String(Math.floor(h / 24)));
}

export async function renderCampanas(
  env: Env,
  q: Record<string, string | undefined> = {},
): Promise<string> {
  const tr = traductor(env);
  const db = new Db(env.DB);
  const [counts, templates, spent, history] = await Promise.all([
    segmentCounts(db),
    listContentTemplates(env).catch(() => []),
    templatesSentLast24h(db),
    campaignHistory(db),
  ]);
  const cap = dailyTemplateCap(env);
  const pct = Math.min(100, Math.round((spent / cap) * 100));

  const banner = q.ok
    ? `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.08);padding:12px 16px;margin-bottom:18px;font-size:12.5px">
        ${esc(tr("campanas.enviadaTitulo"))} — ${esc(tr("campanas.resumenFreeform"))}: <b>${esc(q.ff ?? "0")}</b> · ${esc(tr("campanas.resumenPlantillas"))}: <b>${esc(q.tp ?? "0")}</b>
        · ${esc(tr("campanas.resumenDuplicados"))}: ${esc(q.dup ?? "0")} · ${esc(tr("campanas.resumenSinCuota"))}: ${esc(q.quota ?? "0")} · ${esc(tr("campanas.resumenFallidos"))}: ${esc(q.fail ?? "0")}
      </div>`
    : q.err
      ? `<div style="border:1px solid var(--bad);background:rgba(220,120,120,.08);padding:12px 16px;margin-bottom:18px;font-size:12.5px">⚠️ ${esc(q.err)}</div>`
      : "";

  const defs = segments(tr);
  const segRows = counts
    .map((s, i) => {
      const def = defs.find((d) => d.id === s.id)!;
      return `
      <label style="display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);padding:12px 14px;cursor:pointer;background:var(--panel)">
        <input type="radio" name="segment" value="${esc(s.id)}" ${i === 0 ? "checked" : ""} style="margin-top:3px">
        <div style="min-width:0;flex:1">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:13px">${esc(def.label)}</span>
            <span class="font-mono" style="font-size:11px">
              <b>${s.total}</b> ${esc(tr("campanas.segTotal"))} ·
              <span style="color:var(--ok)">${s.inWindow} ${esc(tr("campanas.segEnVentana"))}</span> ·
              <span style="color:var(--warn,#d9a441)">${s.outWindow} ${esc(tr("campanas.segNecesitanPlantilla"))}</span>
            </span>
          </div>
          <div class="text-dim" style="font-size:11.5px;margin-top:2px">${esc(def.desc)}</div>
        </div>
      </label>`;
    })
    .join("");

  const templateOpts =
    templates.length > 0
      ? templates
          .map(
            (t) =>
              `<option value="${esc(t.sid)}">${esc(t.name)} — “${esc(t.body.slice(0, 70))}${t.body.length > 70 ? "…" : ""}”</option>`,
          )
          .join("")
      : "";

  const templateSection =
    templates.length > 0
      ? `<select name="template_sid" style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:9px 10px;font-size:12px">
          <option value="">${esc(tr("campanas.sinPlantillaOpcion"))}</option>
          ${templateOpts}
        </select>
        <input name="template_vars" placeholder="${esc(tr("campanas.variablesPlaceholder"))}" class="font-mono"
          style="width:100%;margin-top:8px;background:var(--panel);border:1px solid var(--line);color:inherit;padding:8px 10px;font-size:11.5px">`
      : `<div class="text-dim" style="font-size:12px;border:1px dashed var(--line);padding:12px 14px">
          ${esc(tr("campanas.sinPlantillasAprobadas"))}
        </div>`;

  const historyRows =
    history.length === 0
      ? `<tr><td colspan="4" class="text-dim" style="padding:14px;text-align:center;font-size:12px">${esc(tr("campanas.sinCampanas"))}</td></tr>`
      : history
          .map(
            (h) => `<tr style="border-top:1px solid var(--line)">
          <td style="padding:8px 12px;font-size:12px" class="font-mono">${esc(h.campaign_key)}</td>
          <td style="padding:8px 12px;font-size:12px;text-align:right">${h.freeform}</td>
          <td style="padding:8px 12px;font-size:12px;text-align:right">${h.template}</td>
          <td style="padding:8px 12px;font-size:11px;text-align:right" class="text-dim">${esc(fmtAgo(h.last_at, tr))}</td>
        </tr>`,
          )
          .join("");

  // Primer uso: sin campañas y sin plantillas aprobadas. Explica qué es la tab y
  // deja el prompt para que Claude Code deje listo WhatsApp + la plantilla HSM.
  const firstRun = history.length === 0 && templates.length === 0;
  const guide = firstRun
    ? `
    <div style="border:1px solid var(--line);background:var(--panel);padding:16px 18px;margin-bottom:18px;max-width:860px">
      <div class="text-cream" style="font-size:14px;font-weight:700;margin-bottom:6px">${esc(tr("campanas.guiaTitulo"))}</div>
      <p class="text-dim" style="font-size:12.5px;line-height:1.6;margin:0 0 10px">
        ${tr("campanas.guiaQueEs")}
      </p>
      <p class="text-dim" style="font-size:12px;line-height:1.6;margin:0 0 14px">
        ${tr("campanas.guiaRequisitos")}
      </p>
      ${renderConfigPrompt(
        esc(tr("campanas.promptConfig")),
        esc(tr("campanas.promptAyuda")),
      tr,
      )}
    </div>`
    : "";

  const body = `
  ${banner}
  ${guide}

  <div style="display:grid;grid-template-columns:1fr;gap:18px;max-width:860px">

    <div style="border:1px solid var(--line);background:var(--panel2);padding:16px 18px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap">
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase" class="text-dim">${esc(tr("campanas.cuotaTitulo"))}</div>
        <div class="font-mono" style="font-size:13px"><b>${spent}</b> / ${cap}</div>
      </div>
      <div style="height:8px;background:var(--raise);margin-top:8px;border:1px solid var(--line)">
        <div style="height:100%;width:${pct}%;background:${pct > 85 ? "var(--bad)" : "var(--accent,#d9a441)"}"></div>
      </div>
      <div class="text-dim" style="font-size:11px;margin-top:6px">
        ${tr("campanas.cuotaAyuda")}
      </div>
    </div>

    <form method="post" action="/admin/campanas/send"
      onsubmit="return confirm(${esc(JSON.stringify(tr("campanas.confirmarEnvio")))})">

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px" class="text-dim">${esc(tr("campanas.paso1Segmento"))}</div>
      <div style="display:grid;gap:8px">${segRows}</div>

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">${esc(tr("campanas.paso2Freeform"))}</div>
      <textarea name="freeform_text" rows="3" placeholder="${esc(tr("campanas.freeformPlaceholder"))}"
        style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:10px 12px;font-size:12.5px"></textarea>

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">${esc(tr("campanas.paso3Plantilla"))}</div>
      ${templateSection}

      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin:18px 0 8px" class="text-dim">${esc(tr("campanas.paso4Nombre"))}</div>
      <input name="campaign_key" required placeholder="${esc(tr("campanas.nombrePlaceholder"))}" class="font-mono"
        style="width:100%;background:var(--panel);border:1px solid var(--line);color:inherit;padding:9px 10px;font-size:12px">
      <div class="text-dim" style="font-size:11px;margin-top:4px">
        ${esc(tr("campanas.nombreAyuda"))}
      </div>

      <button type="submit" class="btn" style="margin-top:16px;border:1px solid var(--accent,#d9a441);background:rgba(217,164,65,.12);padding:10px 22px;font-weight:700;font-size:12px;letter-spacing:.08em;cursor:pointer">
        ${esc(tr("campanas.botonEnviar"))}
      </button>
      <span class="text-dim" style="font-size:11px;margin-left:10px">${esc(tr("campanas.avisoDuracion"))}</span>
    </form>

    <div>
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-bottom:8px" class="text-dim">${esc(tr("campanas.historialTitulo"))}</div>
      <table style="width:100%;border:1px solid var(--line);border-collapse:collapse;background:var(--panel)">
        <thead><tr class="text-dim" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase">
          <th style="padding:8px 12px;text-align:left">${esc(tr("campanas.tablaCampana"))}</th>
          <th style="padding:8px 12px;text-align:right">${esc(tr("campanas.tablaFreeform"))}</th>
          <th style="padding:8px 12px;text-align:right">${esc(tr("campanas.tablaPlantillas"))}</th>
          <th style="padding:8px 12px;text-align:right">${esc(tr("campanas.tablaUltimoEnvio"))}</th>
        </tr></thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  </div>`;

  return layout({ title: esc(tr("campanas.titulo")), activeTab: "campanas", body, env });
}
