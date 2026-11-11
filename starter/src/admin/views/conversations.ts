// Bandeja de entrada (F1) — dos paneles estilo WhatsApp Web.
//
// Izquierda: lista de conversaciones (filtros + búsqueda), refrescada por HTMX
// cada 10 s. Derecha: el hilo seleccionado (?c=<id>) — cabecera de estado +
// mensajes, refrescado cada 5 s — y el composer para responder COMO HUMANO
// desde el dashboard (sale por el adapter del canal y pausa el bot).
//
// El hilo muestra lo que el bot HIZO, no solo lo que dijo: cada tool call es
// un chip, cada respuesta trae modelo + costo del turno.
//
// Truco de scroll: el contenedor de mensajes usa flex-col-reverse con los
// mensajes en orden DESC, así el scroll queda pegado abajo aun cuando el
// polling reemplaza el contenido.
import type { Env } from "../../env";
import { traductor, traductorNeutro, localePanel, type Traductor, type LocalePanel } from "../i18n";
import { Db } from "../../db/client";
import { NOT_TEST_CONV, NOT_TEST_REF_NULLABLE, notTestConv } from "../../db/testFilter";
import { InsightsRepo } from "../../db/insights";
import { sentimentBadgeMap } from "./insights";
import { costOfUsage, type ModelId } from "../../pricing";
import { channelLabel } from "../../channels/labels";
import { contains } from "../../lib/search-sql";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

/** Tiempo relativo corto en el idioma del panel (ej. "hace 5 min", "2 h ago"). */
function ago(ms: number | null | undefined, tr: Traductor): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return esc(tr("conversations.ahora"));
  if (min < 60) return esc(tr("conversations.haceMinutos").replace("{n}", String(min)));
  const h = Math.floor(min / 60);
  if (h < 24) return esc(tr("conversations.haceHoras").replace("{n}", String(h)));
  const d = Math.floor(h / 24);
  return esc(tr("conversations.haceDias").replace("{n}", String(d)));
}

// Lead pill colors follow the design-system's own "Lead" example (accent) —
// see docs/design-system.md §3 Pill/badge.
function leadBadge(tr: Traductor): Record<string, { txt: string; color: string }> {
  return {
    new: { txt: esc(tr("conversations.leadNuevo")), color: "var(--accent)" },
    contacted: { txt: esc(tr("conversations.leadContactado")), color: "var(--info)" },
    sold: { txt: esc(tr("conversations.leadVendido")), color: "var(--ok)" },
    lost: { txt: esc(tr("conversations.leadPerdido")), color: "var(--dim)" },
  };
}

// We reuse SENTIMENT_BADGE's `.txt` labels (insights.ts) but render inbox pills
// with inline token colors; both maps use the same semantics (frustrated→amber,
// angry→red) so the two views stay visually coherent.
const SENTIMENT_COLOR: Record<string, string> = {
  positive: "var(--ok)",
  neutral: "var(--dim)",
  frustrated: "var(--accent-2)",
  angry: "var(--bad)",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function modelShort(modelId: string): string {
  if (modelId.includes("haiku")) return "haiku";
  if (modelId.includes("sonnet")) return "sonnet";
  if (modelId.includes("opus")) return "opus";
  return modelId.length > 14 ? `${modelId.slice(0, 14)}…` : modelId;
}

function turnCost(m: {
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
}): string {
  if (!m.model_used) return "";
  const cost = costOfUsage(m.model_used as ModelId, {
    input: m.input_tokens ?? 0,
    output: m.output_tokens ?? 0,
    cached: m.cached_input_tokens ?? 0,
  });
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

/** Short human summary of a tool call's input for the chip. */
function toolInputSummary(input: unknown): string {
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const pick = o.query ?? o.reason ?? o.summary ?? o.name ?? o.intent;
    if (typeof pick === "string") return pick;
    const json = JSON.stringify(o);
    return json.length > 42 ? `${json.slice(0, 42)}…` : json;
  }
  return String(input ?? "");
}

// Pill recipes (docs/design-system.md §3): text = border = the variant color.
const smallPill = (color: string) =>
  `font-size:9px;letter-spacing:.03em;color:${color};border:1px solid ${color};padding:1px 6px`;
const statusBadge = (color: string) =>
  `font-size:10px;letter-spacing:.03em;color:${color};border:1px solid ${color};padding:2px 8px`;

/** Two-letter avatar initials from a display name (or channel-id fallback). */
function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

/** El sello de hora de cada burbuja se formatea con el idioma del panel, no con es-MX fijo. */
const LOCALE_FECHA: Record<LocalePanel, string> = {
  "es-419": "es-MX",
  "es-ES": "es-ES",
  en: "en-US",
  "pt-BR": "pt-BR",
};

/** WhatsApp gets info-blue, every other channel gets accent-2 amber — mirrors the mockup's WA/other split. */
function channelColor(channel: string): string {
  return channel === "twilio" || channel === "whatsapp" || channel === "kapso" || channel === "ycloud"
    ? "var(--info)"
    : "var(--accent-2)";
}

interface InboxParams {
  search?: string;
  filter?: string;
  selectedId?: string;
}

/** Preserve the current filter/search when building inbox URLs. */
function inboxUrl(p: InboxParams, convId?: string): string {
  const qs = new URLSearchParams();
  if (convId) qs.set("c", convId);
  if (p.filter) qs.set("f", p.filter);
  if (p.search) qs.set("q", p.search);
  const s = qs.toString();
  return `/admin/conversations${s ? `?${s}` : ""}`;
}

// --- Left pane: conversation list --------------------------------------------

export async function renderInboxList(env: Env, p: InboxParams): Promise<string> {
  const tr = traductor(env);
  const db = new Db(env.DB);
  const now = Date.now();

  // El chat de prueba de la app (canal `test`) no es un cliente — fuera de la
  // bandeja y de los conteos (ver src/db/testFilter.ts).
  const conds: string[] = [notTestConv("c")];
  const params: (string | number)[] = [];
  if (p.search) {
    // instr y no LIKE: el patrón de LIKE muere a los 50 bytes en D1 y tumbaba
    // la bandeja al buscar un nombre completo. Ver src/lib/search-sql.ts.
    conds.push(`(${contains("c.display_name")} OR ${contains("c.channel_user_id")})`);
    params.push(p.search, p.search);
  }
  if (p.filter === "leads") {
    conds.push("EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = c.id)");
  } else if (p.filter === "atencion") {
    conds.push(
      "((c.paused_until IS NOT NULL AND c.paused_until > ?) OR EXISTS (SELECT 1 FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved'))",
    );
    params.push(now);
  } else if (p.filter === "molestos") {
    // Clasificación del Analista: revisar estas conversaciones = oro para mejorar.
    conds.push(
      "EXISTS (SELECT 1 FROM conversation_insights i WHERE i.conversation_id = c.id AND i.sentiment IN ('frustrated','angry'))",
    );
  } else if (p.filter === "contentos") {
    conds.push(
      "EXISTS (SELECT 1 FROM conversation_insights i WHERE i.conversation_id = c.id AND i.sentiment = 'positive')",
    );
  }
  const whereSql = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  // id → nombre del equipo para el badge de asignación (vacío si no hay Equipo).
  const nombresEquipo: Record<string, string> = {};
  try {
    const { listPanelUsers } = await import("../equipo");
    for (const u of await listPanelUsers(db)) nombresEquipo[u.id] = u.name || u.email;
  } catch { /* sin tabla: sin badges */ }
  const rows = await db.all<any>(
    `SELECT c.*,
       (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_msg,
       (SELECT COUNT(*) FROM leads l WHERE l.conversation_id = c.id) as lead_count,
       (SELECT status FROM leads l WHERE l.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as lead_status,
       (SELECT COUNT(*) FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved') as open_tickets,
       (SELECT sentiment FROM conversation_insights i WHERE i.conversation_id = c.id) as ai_sentiment
     FROM conversations c
     ${whereSql}
     ORDER BY c.last_message_at DESC LIMIT 50`,
    params,
  );

  const LEAD_BADGE = leadBadge(tr);
  const SENTIMENT_BADGE = sentimentBadgeMap(tr);
  const items = rows
    .map((r) => {
      const paused = r.paused_until && r.paused_until > now;
      const badges: string[] = [];
      if (r.lead_count > 0) {
        const b = LEAD_BADGE[r.lead_status as string] ?? LEAD_BADGE.new;
        badges.push(`<span style="${smallPill(b.color)}">${b.txt}</span>`);
      }
      if (r.open_tickets > 0) badges.push(`<span style="${smallPill("var(--accent-2)")}">🔔</span>`);
      // Asignado a alguien del equipo: iniciales (la columna existe solo si se usó Equipo).
      if (r.assigned_to && nombresEquipo[r.assigned_to]) {
        const n = nombresEquipo[r.assigned_to];
        const ini = n.split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? "").join("");
        badges.push(`<span title="${esc(n)}" style="${smallPill("var(--accent)")}">${esc(ini)}</span>`);
      }
      if (paused) badges.push(`<span style="${smallPill("var(--dim)")}">⏸</span>`);
      if (r.ai_sentiment === "frustrated" || r.ai_sentiment === "angry") {
        const s = SENTIMENT_BADGE[r.ai_sentiment as string];
        badges.push(`<span style="${smallPill(SENTIMENT_COLOR[r.ai_sentiment as string])}">${s.txt}</span>`);
      }
      const selected = r.id === p.selectedId;
      const name = escapeHtml(r.display_name ?? r.channel_user_id ?? "—");
      const preview = escapeHtml((r.last_msg ?? "").replace(/\s+/g, " ").slice(0, 60));
      const initials = initialsOf(r.display_name ?? r.channel_user_id ?? "?");
      const chanColor = channelColor(r.channel);

      return `
      <a href="${inboxUrl(p, r.id)}" class="convrow"
         hx-get="/admin/conversations/pane/${encodeURIComponent(r.id)}"
         hx-target="#conv-pane" hx-swap="innerHTML" hx-push-url="${inboxUrl(p, r.id)}"
         style="display:flex;gap:11px;padding:12px 14px;border-bottom:1px solid var(--line);cursor:pointer;${selected ? "background:var(--panel2);border-left:2px solid var(--accent)" : "border-left:2px solid transparent"}">
        <div style="width:34px;height:34px;flex:none;background:var(--raise);border:1px solid var(--linelit);display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;color:var(--accent)">${initials}</div>
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12.5px;font-weight:600;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;color:var(--cream)">${name}</span>
            <span style="font-size:9px;letter-spacing:.05em;color:${chanColor};border:1px solid ${chanColor};padding:0 5px;flex:none">${escapeHtml(channelLabel(r.channel))}</span>
            <span style="margin-left:auto;font-size:9.5px;color:var(--dim);white-space:nowrap">${ago(r.last_message_at, tr)}</span>
          </div>
          <div style="font-size:11.5px;color:var(--muted);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;margin-top:3px">${preview || "—"}</div>
          ${badges.length ? `<div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">${badges.join("")}</div>` : ""}
        </div>
      </a>`;
    })
    .join("") ||
    // Dos casos: sin resultados por el filtro activo (mensaje corto) vs. bot
    // recién instalado sin ninguna conversación aún (mensaje orientador).
    (p.filter
      ? `<div style="padding:32px 16px;text-align:center;font-size:12.5px;color:var(--dim)">${esc(tr("conversations.sinResultadosFiltro"))}</div>`
      : `<div style="padding:44px 16px;text-align:center">
           <i data-lucide="messages-square" width="22" height="22" style="color:var(--dim);margin:0 auto 10px;display:block"></i>
           <div style="font-size:12.5px;color:var(--muted);font-weight:600">${esc(tr("conversations.vacioTitulo"))}</div>
           <div style="font-size:11.5px;color:var(--dim);margin-top:5px;line-height:1.5">${esc(tr("conversations.vacioAyuda"))}</div>
         </div>`);

  return items;
}

// --- Right pane: live thread (header + messages, polled) ----------------------

// Burbuja de un archivo de la Bóveda (imagen/documento) en el hilo. Se sirve
// tras el auth del panel (GET /admin/media/:id), nunca público.
function mediaBubble(r: { id: string; kind: string; mime: string | null }): string {
  const src = `/admin/media/${encodeURIComponent(r.id)}`;
  const inner =
    r.kind === "image"
      ? `<a href="${src}" target="_blank" rel="noopener"><img src="${src}" loading="lazy" style="max-width:220px;max-height:220px;display:block;border:1px solid var(--line);background:var(--panel2)"></a>`
      : `<a href="${src}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;background:var(--panel2);border:1px solid var(--line);padding:10px 14px;text-decoration:none;color:var(--cream);font-size:12px"><i data-lucide="file-text" width="18" height="18" style="color:var(--accent)"></i> ${escapeHtml((r.mime ?? "archivo").split("/").pop() ?? "archivo")}</a>`;
  return `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;max-width:78%">${inner}</div>`;
}

export async function renderThreadLive(env: Env, convId: string): Promise<string> {
  const tr = traductor(env);
  const SENTIMENT_BADGE = sentimentBadgeMap(tr);
  const db = new Db(env.DB);
  const conv = await db.first<any>("SELECT * FROM conversations WHERE id = ?", [convId]);
  if (!conv) return `<div style="padding:24px;font-size:12.5px;color:var(--dim)">${esc(tr("conversations.noEncontrada"))}</div>`;

  const insight = await new InsightsRepo(db).getByConversation(convId);
  const msgs = await db.all<any>(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 100",
    [convId],
  );

  const now = Date.now();
  const paused = conv.paused_until && conv.paused_until > now;
  const openTicket =
    (await db.first<{ n: number }>(
      "SELECT COUNT(*) as n FROM tickets WHERE conversation_id = ? AND status != 'resolved'",
      [convId],
    ))?.n ?? 0;

  // Header: identity + live state + takeover controls.
  const statusColor = paused ? "var(--accent-2)" : "var(--ok)";
  const statusPill = `<span style="${statusBadge(statusColor)}">${
    paused ? esc(tr("conversations.botPausado")) : esc(tr("conversations.botActivo"))
  }</span>`;

  const sentBadge =
    insight?.sentiment && SENTIMENT_BADGE[insight.sentiment]
      ? `<span style="${statusBadge(SENTIMENT_COLOR[insight.sentiment])}">${SENTIMENT_BADGE[insight.sentiment].txt}</span>`
      : "";

  // Asignar a alguien del equipo (solo si el bot ya tiene usuarios de panel).
  // La columna assigned_to se crea al primer uso (ALTER idempotente en la ruta).
  let asignarSelector = "";
  try {
    const { listPanelUsers } = await import("../equipo");
    const equipo = await listPanelUsers(db);
    if (equipo.length) {
      const actual = String((conv as any).assigned_to ?? "");
      const opts = [`<option value="">${esc(tr("equipo.sinAsignar"))}</option>`]
        .concat(equipo.filter((u) => !u.pendiente).map((u) =>
          `<option value="${esc(u.id)}" ${u.id === actual ? "selected" : ""}>${esc(u.name || u.email)}${u.puesto ? ` · ${esc(u.puesto)}` : ""}</option>`))
        .join("");
      asignarSelector = `<form method="POST" action="/admin/conversations/${encodeURIComponent(convId)}/asignar" style="display:inline-flex;align-items:center;gap:6px;margin-left:auto">
        <span style="font-size:10.5px;color:var(--dim);letter-spacing:.06em;text-transform:uppercase">${esc(tr("equipo.asignadoA"))}</span>
        <select name="user_id" onchange="this.form.submit()" style="background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:5px 8px;font-size:11.5px;outline:none">${opts}</select>
      </form>`;
    }
  } catch { /* sin tabla de equipo: sin selector */ }

  const controls = paused
    ? `
    <details style="position:relative;margin-left:auto">
      <summary class="chip" style="cursor:pointer;list-style:none;font-size:11px;color:var(--accent-2);background:var(--panel2);border:1px solid var(--linelit);padding:6px 11px;display:inline-flex;align-items:center;gap:6px">▸ ${esc(tr("conversations.devolverAlBot"))}</summary>
      <form method="POST" action="/admin/conversations/${encodeURIComponent(convId)}/resume"
            style="position:absolute;right:0;z-index:10;margin-top:8px;width:280px;background:var(--panel);border:1px solid var(--linelit);box-shadow:6px 6px 0 rgba(0,0,0,.4);padding:12px">
        <p style="font-size:11px;color:var(--muted);margin:0 0 8px">${esc(tr("conversations.resumenParaBot"))}</p>
        <textarea name="summary" rows="3" required placeholder="${esc(tr("conversations.resumenPlaceholder"))}"
                  style="width:100%;background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:8px 10px;font-size:12px;outline:none;resize:vertical;margin-bottom:8px"></textarea>
        <button class="bigbtn" style="width:100%;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:9px;font-size:12px;font-weight:700;font-family:'Space Grotesk';cursor:pointer">${esc(tr("conversations.devolverAlBot"))}</button>
      </form>
    </details>`
    : (() => {
        // Selector de duración por conversación (estilo ManyChat): el dueño
        // elige cuánto se queda callado el bot en ESTE chat. Cada opción manda
        // su `minutes`; "0" = hasta reactivar. El endpoint respeta la elección
        // y, sin ella, cae a la config global.
        const opciones: Array<[number, string]> = [
          [30, esc(tr("conversations.pausa30"))],
          [60, esc(tr("conversations.pausa1h"))],
          [180, esc(tr("conversations.pausa3h"))],
          [480, esc(tr("conversations.pausa8h"))],
          [0, esc(tr("conversations.pausaManual"))],
        ];
        const items = opciones
          .map(
            ([min, label]) => `
        <button hx-post="/admin/conversations/${encodeURIComponent(convId)}/pause"
                hx-vals='{"minutes":"${min}"}' hx-target="#thread-live" hx-swap="innerHTML"
                style="width:100%;text-align:left;background:transparent;border:0;border-radius:0;color:var(--cream);padding:9px 11px;font-size:12px;cursor:pointer;display:block"
                onmouseover="this.style.background='var(--panel2)'" onmouseout="this.style.background='transparent'">
          ${label}
        </button>`,
          )
          .join("");
        return `
    <details style="position:relative;margin-left:auto">
      <summary class="chip" style="cursor:pointer;list-style:none;font-size:11px;color:var(--muted);background:var(--panel2);border:1px solid var(--linelit);padding:6px 11px;display:inline-flex;align-items:center;gap:6px">${esc(tr("conversations.pausarBot"))}</summary>
      <div style="position:absolute;right:0;z-index:10;margin-top:8px;width:220px;background:var(--panel);border:1px solid var(--linelit);box-shadow:6px 6px 0 rgba(0,0,0,.4);padding:6px">
        <p style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:4px 8px 6px">${esc(tr("conversations.pausarCuanto"))}</p>
        ${items}
      </div>
    </details>`;
      })();

  const header = `
  <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel)">
    <span style="font-family:'Space Grotesk';font-weight:600;font-size:14px;color:var(--cream)">${escapeHtml(conv.display_name ?? conv.channel_user_id)}</span>
    <span style="${smallPill("var(--info)")}">${escapeHtml(channelLabel(conv.channel))}</span>
    ${statusPill}
    ${sentBadge}
    ${openTicket > 0 ? `<span style="${statusBadge("var(--accent-2)")}">${esc(tr("conversations.ticketAbierto"))}</span>` : ""}
    ${asignarSelector}
    ${controls}
  </div>`;

  // Messages, DESC in the DOM + column-reverse = pinned to bottom.
  const localeFecha = LOCALE_FECHA[localePanel(env)];
  const msgItems = msgs
    .map((m) => {
      const time = new Date(m.created_at).toLocaleString(localeFecha, {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      });

      // Tool chips (what the bot DID this turn) render above the bubble; in a
      // reversed column that means AFTER it in the DOM.
      let chips = "";
      if (m.tool_calls) {
        try {
          const calls = JSON.parse(m.tool_calls) as { toolName: string; input?: unknown }[];
          chips = calls
            .map(
              (tc) => `
            <div style="align-self:flex-end;display:inline-flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dim);border:1px dashed var(--linelit);padding:3px 10px;margin-bottom:2px">→ <span style="color:var(--accent);font-weight:600">${escapeHtml(tc.toolName ?? "?")}</span> «${escapeHtml(toolInputSummary(tc.input))}»</div>`,
            )
            .join("");
        } catch { /* legacy/malformed tool_calls JSON — skip chips */ }
      }

      if (m.role === "user") {
        // Quita el marcador [IMAGE_URL: …] del texto: la imagen sale como su
        // propia burbuja (Bóveda). Si el mensaje era solo la imagen, no hay texto.
        const shown = m.content.replace(/\s*\[IMAGE_URL:[^\]]*\]/g, "").trim();
        const bubble = shown
          ? `<div style="background:var(--panel2);border:1px solid var(--line);padding:9px 13px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;color:var(--cream)">${escapeHtml(shown)}</div>`
          : "";
        return {
          created_at: m.created_at as number,
          html: `
        <div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;max-width:78%">
          ${bubble}
          <span style="font-size:9.5px;color:var(--dim)">${time}</span>
        </div>`,
        };
      }

      // Nota interna (Forja Inbox móvil / resume del panel): burbuja ámbar
      // aparte de "Tú" — nunca se mandó al cliente, así que ni el meta de
      // modelo/costo ni el label de owner aplican aquí.
      if (m.role === "note") {
        return {
          created_at: m.created_at as number,
          html: `
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;max-width:78%;margin-left:auto">
        <div style="background:rgba(245,166,35,.1);border:1px solid rgba(245,166,35,.4);padding:9px 13px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;color:var(--cream)">${escapeHtml(m.content)}</div>
        <span style="font-size:9.5px;color:var(--dim)">Nota interna · ${time}</span>
      </div>`,
        };
      }

      const isOwner = m.role === "owner";
      const cost = turnCost(m);
      const meta = isOwner
        ? `${esc(tr("conversations.tu"))} · ${time}`
        : [m.model_used ? modelShort(m.model_used) : null, cost || null, time].filter(Boolean).join(" · ");
      const bubbleBg = isOwner
        ? "background:rgba(245,166,35,.1);border:1px solid rgba(245,166,35,.4)"
        : "background:var(--accent-soft);border:1px solid var(--linelit)";
      return {
        created_at: m.created_at as number,
        html: `
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;max-width:78%;margin-left:auto">
        ${chips}
        <div style="${bubbleBg};padding:9px 13px;font-size:12.5px;line-height:1.5;white-space:pre-wrap;color:var(--cream)">${escapeHtml(m.content)}</div>
        <span style="font-size:9.5px;color:var(--dim)">${meta}</span>
      </div>`,
      };
    });

  // Bóveda: imágenes/docs que el cliente mandó, archivados en R2. Solo si el bot
  // tiene el binding MEDIA. Se interleavan por tiempo, del lado del cliente.
  let mediaItems: Array<{ created_at: number; html: string }> = [];
  if (env.MEDIA) {
    try {
      const mrows = await db.all<{ id: string; kind: string; mime: string | null; created_at: number }>(
        "SELECT id, kind, mime, created_at FROM media WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 100",
        [convId],
      );
      mediaItems = mrows.map((r) => ({ created_at: r.created_at, html: mediaBubble(r) }));
    } catch {
      /* la tabla media aún no existe (nada archivado) → sin media */
    }
  }

  const bubbles = [...msgItems, ...mediaItems]
    .sort((a, b) => b.created_at - a.created_at)
    .map((i) => i.html)
    .join("");

  return `
  ${header}
  <div data-hilo style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column-reverse;gap:12px;padding:16px;background:var(--bg)">
    ${bubbles || `<div style="text-align:center;font-size:12.5px;color:var(--dim);padding:32px 0">${esc(tr("conversations.sinMensajes"))}</div>`}
  </div>`;
}

// --- Composer (static per selection — NOT inside the polled fragment) ---------

function renderComposer(convId: string, tr: Traductor): string {
  const id = encodeURIComponent(convId);
  return `
  <div style="border-top:1px solid var(--line);background:var(--panel);padding:12px;display:flex;flex-direction:column;gap:8px">
    <div id="suggestion-box"></div>
    <form hx-post="/admin/conversations/${id}/reply" hx-target="#send-status" hx-swap="innerHTML"
          hx-on::after-request="if(event.detail.xhr.getResponseHeader('X-Sent')==='1')this.reset()"
          style="display:flex;align-items:flex-end;gap:9px">
      <textarea name="text" id="reply-text" rows="2" required
                placeholder="${esc(tr("conversations.responderPlaceholder"))}"
                style="flex:1;background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;resize:none;outline:none"></textarea>
      <button type="button" hx-post="/admin/conversations/${id}/suggest" hx-target="#suggestion-box" hx-swap="innerHTML"
              class="chip" style="background:var(--panel2);border:1px solid var(--linelit);color:var(--accent-2);padding:11px 13px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px" title="${esc(tr("conversations.sugerirTooltip"))}">
        <i data-lucide="sparkles" width="13" height="13"></i> ${esc(tr("conversations.sugerir"))}
      </button>
      <button type="submit" class="bigbtn" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:4px 4px 0 var(--linelit);padding:11px 18px;font-size:12.5px;font-weight:700;font-family:'Space Grotesk';cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:6px">
        ${esc(tr("conversations.enviar"))} <i data-lucide="send" width="14" height="14"></i>
      </button>
    </form>
    <div id="send-status" style="font-size:11px;min-height:1rem;color:var(--muted)"></div>
  </div>`;
}

/** Fragment returned by /suggest — suggestion + a "use it" button that fills the textarea. */
export function renderSuggestionBox(text: string, tr: Traductor = traductorNeutro): string {
  return `
  <div style="border:1px solid var(--accent-2);background:rgba(245,166,35,.08);padding:10px 12px;font-size:12.5px;display:flex;align-items:flex-start;gap:10px">
    <div style="flex:1">
      <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent-2);margin-bottom:3px">${esc(tr("conversations.sugerenciaTitulo"))}</div>
      <div class="sugg-text" style="white-space:pre-wrap;color:var(--cream)">${escapeHtml(text)}</div>
    </div>
    <button type="button"
            onclick="document.getElementById('reply-text').value=this.parentElement.querySelector('.sugg-text').textContent;document.getElementById('suggestion-box').innerHTML=''"
            class="chip" style="font-size:11px;background:var(--accent-2);color:#1a1206;font-weight:700;border:1px solid var(--accent-2);padding:5px 10px;white-space:nowrap;cursor:pointer">${esc(tr("conversations.usarSugerencia"))}</button>
  </div>`;
}

// --- Full page -----------------------------------------------------------------

// Pane derecho de UNA conversación: el poller del hilo + el composer. Lo usa
// renderInbox y el fragment /admin/conversations/pane/:id — el click en la
// lista cambia SOLO esto (HTMX), sin recargar la página completa.
export async function renderConvPane(env: Env, selectedId: string): Promise<string> {
  const tr = traductor(env);
  const thread = await renderThreadLive(env, selectedId);
  return `
      <div id="thread-live" class="flex flex-col flex-1 min-h-0"
           hx-get="/admin/conversations/thread/${encodeURIComponent(selectedId)}"
           hx-trigger="every 5s[window.puedeRefrescar('thread-live')]" hx-swap="innerHTML">
        ${thread}
      </div>
      ${renderComposer(selectedId, tr)}`;
}

export async function renderInbox(env: Env, p: InboxParams): Promise<string> {
  const tr = traductor(env);
  const db = new Db(env.DB);
  const now = Date.now();

  // Los 5 contadores en PARALELO (2026-08-29): antes eran 5 round-trips a D1
  // en fila ANTES de pintar nada — puro lag de apertura del inbox.
  const [totalConvs, totalLeads, nMolestos, nContentos, needAttention] = (
    await Promise.all([
      db.first<{ n: number }>(`SELECT COUNT(*) as n FROM conversations WHERE ${NOT_TEST_CONV}`),
      db.first<{ n: number }>(`SELECT COUNT(*) as n FROM leads WHERE ${NOT_TEST_REF_NULLABLE}`),
      db.first<{ n: number }>(
        "SELECT COUNT(*) as n FROM conversation_insights WHERE sentiment IN ('frustrated','angry')",
      ),
      db.first<{ n: number }>(
        "SELECT COUNT(*) as n FROM conversation_insights WHERE sentiment = 'positive'",
      ),
      db.first<{ n: number }>(
        `SELECT COUNT(*) as n FROM conversations c
         WHERE ${notTestConv("c")}
           AND ((c.paused_until IS NOT NULL AND c.paused_until > ?)
                OR EXISTS (SELECT 1 FROM tickets t WHERE t.conversation_id = c.id AND t.status != 'resolved'))`,
        [now],
      ),
    ])
  ).map((r) => r?.n ?? 0);

  const filterPill = (href: string, label: string, active: boolean, color: string) =>
    `<a href="${href}" class="chip" style="font-size:11px;letter-spacing:.05em;padding:5px 12px;white-space:nowrap;border:1px solid ${color};${
      active ? `background:${color};color:#1a1206;font-weight:700` : `color:${color}`
    }">${label}</a>`;

  // Lista y pane del hilo en paralelo (independientes entre sí).
  const [list, paneSeleccionado] = await Promise.all([
    renderInboxList(env, p),
    p.selectedId ? renderConvPane(env, p.selectedId) : Promise.resolve(null),
  ]);

  let rightPane: string;
  if (paneSeleccionado !== null) {
    rightPane = paneSeleccionado;
  } else if (totalConvs === 0) {
    // Bot recién instalado: no hay nada que seleccionar todavía — explica qué
    // va a pasar aquí en vez de un placeholder mudo.
    rightPane = `
      <div class="flex-1 flex flex-col items-center justify-center text-center gap-2" style="background:var(--bg);padding:0 28px">
        <i data-lucide="messages-square" width="26" height="26" style="color:var(--dim)"></i>
        <div style="font-size:12.5px;color:var(--muted);font-weight:600">${esc(tr("conversations.panelVacioTitulo"))}</div>
        <div style="font-size:11.5px;color:var(--dim);line-height:1.5;max-width:300px">${esc(tr("conversations.panelVacioAyuda"))}</div>
      </div>`;
  } else {
    rightPane = `
      <div class="flex-1 flex items-center justify-center" style="font-size:12.5px;color:var(--dim);background:var(--bg)">
        ${esc(tr("conversations.seleccionaConversacion"))}
      </div>`;
  }

  const body = `
    <div class="flex flex-wrap items-center gap-2" style="margin-bottom:14px">
      ${filterPill(inboxUrl({ selectedId: p.selectedId }), `${esc(tr("conversations.filtroTodas"))} · ${totalConvs}`, !p.filter, "var(--accent)")}
      ${filterPill(inboxUrl({ filter: "leads", selectedId: p.selectedId }), `${esc(tr("conversations.filtroLeads"))} · ${totalLeads}`, p.filter === "leads", "var(--accent)")}
      ${filterPill(inboxUrl({ filter: "atencion", selectedId: p.selectedId }), `${esc(tr("conversations.filtroAtencion"))} · ${needAttention}`, p.filter === "atencion", "var(--bad)")}
      ${filterPill(inboxUrl({ filter: "molestos", selectedId: p.selectedId }), `${esc(tr("conversations.filtroMolestos"))} · ${nMolestos}`, p.filter === "molestos", "var(--bad)")}
      ${filterPill(inboxUrl({ filter: "contentos", selectedId: p.selectedId }), `${esc(tr("conversations.filtroContentos"))} · ${nContentos}`, p.filter === "contentos", "var(--ok)")}
      <form method="GET" action="/admin/conversations" class="ml-auto" style="display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);padding:7px 12px;min-width:220px">
        <i data-lucide="search" width="14" height="14" style="color:var(--dim)"></i>
        ${p.filter ? `<input type="hidden" name="f" value="${escapeHtml(p.filter)}">` : ""}
        ${p.selectedId ? `<input type="hidden" name="c" value="${escapeHtml(p.selectedId)}">` : ""}
        <input name="q" value="${escapeHtml(p.search ?? "")}" placeholder="${esc(tr("conversations.buscarPlaceholder"))}"
               style="flex:1;background:transparent;border:none;color:var(--cream);font-size:12px;outline:none">
      </form>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-[320px_1fr] overflow-hidden" style="border:1px solid var(--line);background:var(--panel);height:calc(100vh - 200px);min-height:480px">
      <div class="border-r border-line flex flex-col" style="min-height:0">
        <div id="conv-list" class="overflow-y-auto flex-1"
             hx-get="/admin/conversations/list-fragment"
             hx-vals="js:{...Object.fromEntries(new URLSearchParams(location.search))}"
             hx-trigger="every 10s[window.puedeRefrescar('conv-list')]" hx-swap="innerHTML">
          ${list}
        </div>
      </div>
      <div id="conv-pane" class="flex flex-col" style="min-height:0;background:var(--bg)">
        ${rightPane}
      </div>
    </div>
    <script>
    // Pausa el auto-refresco (htmx evalúa este filtro en cada tick de 'every Ns[...]')
    // cuando NO conviene reemplazar el contenido: pestaña en segundo plano, un
    // popover abierto (Devolver al bot / Pausar), o el usuario escribiendo dentro
    // del fragmento. Sin esto, el swap de cada 5s cerraba la ventanita de contexto
    // a media escritura. Reportado en comunidad; misma familia que el PR #10.
    // Click en una fila: pinta la selección AL INSTANTE (el poll de la lista la
    // confirma después con el estado real del server vía location.search).
    document.getElementById('conv-list')?.addEventListener('click', function(e){
      var a = e.target && e.target.closest ? e.target.closest('a.convrow') : null;
      if (!a) return;
      document.querySelectorAll('#conv-list a.convrow').forEach(function(r){
        r.style.background = ''; r.style.borderLeft = '2px solid transparent';
      });
      a.style.background = 'var(--panel2)'; a.style.borderLeft = '2px solid var(--accent)';
    });
    window.puedeRefrescar = window.puedeRefrescar || function(id){
      if (document.hidden) return false;
      var el = document.getElementById(id);
      if (!el) return true;
      if (el.querySelector('details[open]')) return false;
      var a = document.activeElement;
      if (a && el.contains(a) && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)) return false;
      // Si el dueño está scrolleado LEYENDO la historia, no reemplaces el hilo:
      // el swap lo regresaba al fondo cada 5s (auto-scroll reportado en comunidad,
      // 20-ago-2026). Con column-reverse "abajo" es scrollTop 0 y leer hacia
      // arriba lo vuelve negativo; el refresco se reanuda solo al volver al fondo.
      var hilo = el.querySelector('[data-hilo]');
      if (hilo && hilo.scrollTop < -40) return false;
      return true;
    };
    </script>`;

  return layout({ title: esc(tr("conversations.titulo")), activeTab: "conversations", body, env });
}
