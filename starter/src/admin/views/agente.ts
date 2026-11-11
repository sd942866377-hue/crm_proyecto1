// Tab esc(tr("agente.tituloPagina")) — la radiografía del chatbot, estilo canvas de n8n.
//
// Server-rendered: nodos posicionados en absoluto + conectores SVG, con DATOS
// REALES (canales desde D1, config efectiva, contadores de tools desde
// messages.tool_calls). El flujo es fijo (no editable): es una radiografía
// honesta de cómo funciona el bot, no un editor. Cada nodo es clickeable y
// carga su panel de configuración vía HTMX; el canvas se refresca solo cada
// 15 s para que el "pulso" de actividad esté vivo.
import type { Env } from "../../env";
import { traductor, type Traductor } from "../i18n";
import { Db } from "../../db/client";
import { NOT_TEST_CONV, NOT_TEST_REF, notTestRef } from "../../db/testFilter";
import { SettingsRepo, SETTING_KEYS } from "../../db/settings";
import { resolveAgentConfig, type AgentConfig } from "../../settings-loader";
import { buildTools } from "../../tools";
import { resolveProvider, modelIdFor } from "../../llm/provider";
import { channelLabel, configuredChannels } from "../../channels/labels";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

function ago(ms: number | null | undefined, tr: Traductor): string {
  if (!ms) return esc(tr("agente.tiempoNunca"));
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return esc(tr("agente.tiempoAhora"));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

/** A node lights up when it saw activity within this window. */
const LIVE_MS = 5 * 60_000;

// --- Friendly metadata --------------------------------------------------------

interface ToolMeta {
  label: string;
  desc: string;
  /** lucide icon name for the canvas node + modal header. */
  icon: string;
  /** Turning this off is a bad idea — the panel warns about it. */
  critical?: boolean;
}

function toolMetaMap(tr: Traductor): Record<string, ToolMeta> {
  return {
    searchKb: {
      label: esc(tr("agente.toolBuscarConocimientoLabel")),
      desc: esc(tr("agente.toolBuscarConocimientoDesc")),
      icon: "book-open",
      critical: true,
    },
    handoffHuman: {
      label: esc(tr("agente.toolPasarAHumanoLabel")),
      desc: esc(tr("agente.toolPasarAHumanoDesc")),
      icon: "user-round",
      critical: true,
    },
    pauseBot: {
      label: esc(tr("agente.toolPausarBotLabel")),
      desc: esc(tr("agente.toolPausarBotDesc")),
      icon: "pause",
    },
    snoozeUser: {
      label: esc(tr("agente.toolDescansarUsuarioLabel")),
      desc: esc(tr("agente.toolDescansarUsuarioDesc")),
      icon: "shield",
    },
    eventInfo: {
      label: esc(tr("agente.toolInfoEventoLabel")),
      desc: esc(tr("agente.toolInfoEventoDesc")),
      icon: "calendar-days",
    },
    trackedLink: {
      label: esc(tr("agente.toolLinkTrackeadoLabel")),
      desc: esc(tr("agente.toolLinkTrackeadoDesc")),
      icon: "link",
    },
    registerMasterclass: {
      label: esc(tr("agente.toolRegistrarEventoLabel")),
      desc: esc(tr("agente.toolRegistrarEventoDesc")),
      icon: "user-check",
    },
    captureLead: {
      label: esc(tr("agente.toolCapturarLeadLabel")),
      desc: esc(tr("agente.toolCapturarLeadDesc")),
      icon: "user-plus",
    },
    scheduleAppointment: {
      label: esc(tr("agente.toolAgendarCitaLabel")),
      desc: esc(tr("agente.toolAgendarCitaDesc")),
      icon: "calendar",
    },
    catalogQuery: {
      label: esc(tr("agente.toolConsultarCatalogoLabel")),
      desc: esc(tr("agente.toolConsultarCatalogoDesc")),
      icon: "package",
    },
    pauseSuspectedBot: {
      label: esc(tr("agente.toolFrenarBotsLabel")),
      desc: esc(tr("agente.toolFrenarBotsDesc")),
      icon: "shield-alert",
    },
    submitAuditCase: {
      label: esc(tr("agente.toolAuditarNegociosLabel")),
      desc: esc(tr("agente.toolAuditarNegociosDesc")),
      icon: "clipboard-check",
    },
    sendPaymentLink: {
      label: esc(tr("agente.toolCobrarPorChatLabel")),
      desc: esc(tr("agente.toolCobrarPorChatDesc")),
      icon: "credit-card",
    },
    composio: {
      label: esc(tr("agente.toolAppsConectadasLabel")),
      desc: esc(tr("agente.toolAppsConectadasDesc")),
      icon: "plug",
    },
    forjaLicenseStatus: {
      label: esc(tr("agente.toolLicenciaForjaLabel")),
      desc: esc(tr("agente.toolLicenciaForjaDesc")),
      icon: "key",
    },
    crearReservacion: {
      label: esc(tr("agente.toolCrearReservacionLabel")),
      desc: esc(tr("agente.toolCrearReservacionDesc")),
      icon: "utensils",
    },
    tomarPedido: {
      label: esc(tr("agente.toolTomarPedidoLabel")),
      desc: esc(tr("agente.toolTomarPedidoDesc")),
      icon: "shopping-bag",
    },
    calificarComprador: {
      label: esc(tr("agente.toolCalificarCompradorLabel")),
      desc: esc(tr("agente.toolCalificarCompradorDesc")),
      icon: "badge-check",
    },
    registrarVisita: {
      label: esc(tr("agente.toolRegistrarVisitaLabel")),
      desc: esc(tr("agente.toolRegistrarVisitaDesc")),
      icon: "map-pin",
    },
    agendarCita: {
      label: esc(tr("agente.toolAgendarCitaLabel")),
      desc: esc(tr("agente.toolAgendarCitaCanonicaDesc")),
      icon: "calendar-check",
    },
    verDisponibilidad: {
      label: esc(tr("agente.toolVerDisponibilidadLabel")),
      desc: esc(tr("agente.toolVerDisponibilidadDesc")),
      icon: "calendar-search",
    },
    registrarPedido: {
      label: esc(tr("agente.toolRegistrarPedidoLabel")),
      desc: esc(tr("agente.toolRegistrarPedidoDesc")),
      icon: "shopping-bag",
    },
    registrarProspecto: {
      label: esc(tr("agente.toolRegistrarProspectoLabel")),
      desc: esc(tr("agente.toolRegistrarProspectoDesc")),
      icon: "clipboard-list",
    },
    reservarHospedaje: {
      label: esc(tr("agente.toolReservarHospedajeLabel")),
      desc: esc(tr("agente.toolReservarHospedajeDesc")),
      icon: "bed",
    },
    cotizarEvento: {
      label: esc(tr("agente.toolCotizarEventoLabel")),
      desc: esc(tr("agente.toolCotizarEventoDesc")),
      icon: "party-popper",
    },
  };
}

function toolMeta(name: string, tr: Traductor): ToolMeta {
  return toolMetaMap(tr)[name] ?? { label: name, desc: esc(tr("agente.toolPersonalizadaDesc")), icon: "wrench" };
}

/** Parse a comma-separated settings value into a trimmed, non-empty list. */
function csvList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** lucide icon per channel id — falls back to a generic radio icon. */
const CHANNEL_ICON: Record<string, string> = {
  twilio: "message-circle",
  whatsapp: "message-circle",
  telegram: "send",
  // OJO: lucide eliminó los íconos de MARCA (instagram/facebook/etc.) — usar
  // solo íconos del core o salen cuadros vacíos en el canvas.
  instagram: "camera",
  messenger: "message-square",
  manychat: "zap",
};

function channelIcon(channel: string): string {
  return CHANNEL_ICON[channel] ?? "radio";
}

// --- Data ----------------------------------------------------------------------

interface ChannelRow {
  channel: string;
  convs: number;
  last: number | null;
}

interface ToolUsageRow {
  tool: string;
  n: number;
  last: number;
}

interface AgenteData {
  /** The channel this radiography is drawn FOR — undefined = General (global).
   *  Validated against configuredChannels; an unknown value falls back to
   *  General so a bad ?channel can never desync the view. */
  channel?: string;
  channels: ChannelRow[];
  turns30d: number;
  lastAssistantAt: number | null;
  toolNames: string[];
  /** Descripción model-facing de cada tool (lo que el modelo recibe además del prompt). */
  toolDefs: Record<string, string>;
  usage: Map<string, ToolUsageRow>;
  /** Effective config for `channel` (its prompt override + union of disabled
   *  tools). For General this is the global config, unchanged. */
  cfg: AgentConfig;
  /** Tools off in the current view (global OR, for a channel, its per-channel
   *  set too — the union). */
  disabled: string[];
  /** Tools off GLOBALLY, regardless of channel. Lets a channel view show a
   *  tool as "locked off in General" (can't re-enable per-channel). */
  globalDisabled: string[];
  settings: Record<string, string>;
}

async function loadAgenteData(env: Env, channel?: string): Promise<AgenteData> {
  const tr = traductor(env);
  const db = new Db(env.DB);
  const thirtyDays = Date.now() - 30 * 86_400_000;
  // Only draw FOR a channel that is actually configured — otherwise General.
  const viewChannel = channel && configuredChannels(env).some((c) => c.id === channel) ? channel : undefined;

  const channels = await db.all<ChannelRow>(
    `SELECT channel, COUNT(*) as convs, MAX(last_message_at) as last
     FROM conversations WHERE ${NOT_TEST_CONV} GROUP BY channel ORDER BY convs DESC`,
  );
  // Every channel with credentials configured appears in the canvas, even at
  // zero traffic — the owner must SEE what their bot is connected to.
  for (const cfg of configuredChannels(env)) {
    if (!channels.some((c) => c.channel === cfg.id)) {
      channels.push({ channel: cfg.id, convs: 0, last: null });
    }
  }
  if (channels.length === 0) {
    channels.push({ channel: "twilio", convs: 0, last: null });
  }

  const turns30d =
    (
      await db.first<{ n: number }>(
        `SELECT COUNT(*) as n FROM messages WHERE role = 'assistant' AND created_at > ? AND ${NOT_TEST_REF}`,
        [thirtyDays],
      )
    )?.n ?? 0;

  const lastAssistantAt =
    (
      await db.first<{ t: number | null }>(
        `SELECT MAX(created_at) as t FROM messages WHERE role = 'assistant' AND ${NOT_TEST_REF}`,
      )
    )?.t ?? null;

  const usageRows = await db
    .all<ToolUsageRow>(
      `SELECT json_extract(value, '$.toolName') as tool,
              COUNT(*) as n,
              MAX(messages.created_at) as last
       FROM messages, json_each(messages.tool_calls)
       WHERE messages.tool_calls IS NOT NULL AND messages.created_at > ?
         AND ${notTestRef("messages.conversation_id")}
       GROUP BY tool`,
      [thirtyDays],
    )
    .catch(() => [] as ToolUsageRow[]);
  const usage = new Map(usageRows.filter((r) => r.tool).map((r) => [r.tool, r]));

  const builtTools = buildTools({ env, getConversationId: () => null });
  const toolNames = Object.keys(builtTools);
  const toolDefs: Record<string, string> = {};
  for (const [n, t] of Object.entries(builtTools)) {
    toolDefs[n] = String((t as { description?: string })?.description ?? "").trim();
  }
  // cfg is resolved FOR the viewed channel: prompt override + disabled_tools
  // union both come channel-aware from resolveAgentConfig. General = global.
  const cfg = await resolveAgentConfig(env, toolNames, viewChannel);
  const disabled = toolNames.filter((n) => !cfg.enabledToolNames.includes(n));
  const settings = await new SettingsRepo(db).all();
  const globalDisabled = toolNames.filter((n) => csvList(settings[SETTING_KEYS.disabledTools]).includes(n));

  return { channel: viewChannel, channels, turns30d, lastAssistantAt, toolNames, toolDefs, usage, cfg, disabled, globalDisabled, settings };
}

function modelLabel(env: Env, cfg: AgentConfig): string {
  const tr = traductor(env);
  const provider = resolveProvider(env);
  if (cfg.modelOverride === "haiku") return modelIdFor(env, provider, "fast");
  if (cfg.modelOverride === "sonnet") return modelIdFor(env, provider, "smart");
  return `auto · ${modelIdFor(env, provider, "fast")} ⇄ ${modelIdFor(env, provider, "smart")}`;
}

// --- Canvas --------------------------------------------------------------------

interface NodeSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  icon: string;
  title: string;
  caption: string;
  /** CSS color value (var(--token)) for the icon box, border + count badge. */
  accent: string;
  live: boolean;
  count?: string;
  off?: boolean;
  big?: boolean;
  /** Canal con tráfico: borde+fondo+chip verdes, imposible no verlo. */
  on?: boolean;
}

function nodeHtml(n: NodeSpec, channelQS: string, tr: Traductor): string {
  return `
  <div class="node-card absolute cursor-pointer"
       style="left:${n.x}px;top:${n.y}px;width:${n.w}px;padding:11px 13px;${
         n.on
           ? "background:linear-gradient(135deg, rgba(127,183,126,.16), rgba(127,183,126,.05)), var(--panel2);border:1px solid var(--ok);box-shadow:0 0 0 1px rgba(127,183,126,.25), 0 0 18px -6px rgba(127,183,126,.5);"
           : "background:var(--panel2);border:1px solid var(--linelit);"
       }${n.off ? "opacity:.55;" : ""}"
       hx-get="/admin/agente/node/${encodeURIComponent(n.id)}${channelQS}" hx-target="#modal-root" hx-swap="innerHTML"
       title="${esc(tr("agente.tooltipConfigurar"))}">
    <div class="flex items-center gap-2">
      <span class="w-[22px] h-[22px] flex-none flex items-center justify-center" style="border:1px solid ${n.accent};background:${n.on ? "rgba(127,183,126,.18)" : "var(--panel2)"}">
        <i data-lucide="${n.icon}" width="13" height="13" style="color:${n.accent}"></i>
      </span>
      <span class="font-display font-semibold text-cream whitespace-nowrap overflow-hidden text-ellipsis" style="font-size:${n.big ? "14px" : "12.5px"}">${esc(n.title)}</span>
      ${n.off ? `<span class="ml-auto text-[8.5px] tracking-[.1em]" style="color:var(--dim);border:1px solid var(--linelit);padding:0 4px">OFF</span>` : ""}
      ${n.on ? `<span class="ml-auto text-[8.5px] tracking-[.1em] font-semibold" style="color:var(--ok);border:1px solid var(--ok);padding:0 4px;background:rgba(127,183,126,.12)">${esc(tr("agente.badgeActivoCanvas"))}</span>` : ""}
    </div>
    <div class="text-[10.5px] mt-1 leading-snug" style="color:var(--muted)">${n.caption}</div>
    ${n.count ? `<div class="text-[9.5px] mt-1.5" style="color:var(--accent)">${esc(n.count)}</div>` : ""}
    ${n.live ? `<span class="absolute -top-1.5 -right-1.5 w-[11px] h-[11px] rounded-full" style="background:var(--ok);border:2px solid var(--panel);animation:pulse 1.8s ease-in-out infinite"></span>` : ""}
  </div>`;
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(30, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function bezierDown(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.max(30, (y2 - y1) / 2);
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

export async function renderAgenteCanvas(env: Env, channel?: string): Promise<string> {
  const tr = traductor(env);
  const d = await loadAgenteData(env, channel);
  const now = Date.now();
  // Baked into every node's hx-get so clicking a node opens its modal FOR the
  // channel currently being viewed (empty for General). d.channel is the
  // validated value — a bogus ?channel never leaks into the links.
  const channelQS = d.channel ? `?channel=${encodeURIComponent(d.channel)}` : "";

  // Channel view = clean toolbox: draw ONLY the tools enabled for that channel
  // (hide the ones off in disabled_tools:<canal>). General view draws all —
  // globally-off tools still show grayed/OFF there. Re-enabling a hidden tool
  // lives in the Agente modal's per-channel tools list.
  const toolsToDraw = d.channel ? d.toolNames.filter((n) => !d.disabled.includes(n)) : d.toolNames;

  // --- geometry ---
  const CH_X = 16, CH_W = 150, CH_H = 60, CH_STEP = 84, TOP = 36;
  const nCh = d.channels.length;
  const stackH = nCh * CH_STEP - (CH_STEP - CH_H);
  const midY = TOP + stackH / 2; // vertical center of the main flow

  const BUF = { x: 230, w: 150, h: 64 };
  const BRAIN = { x: 440, w: 200, h: 96 };
  const REPLY = { x: 760, w: 170, h: 64 };
  const row2Y = Math.max(midY + BRAIN.h / 2 + 66, 250);
  const row3Y = row2Y + 118;
  const TOOL_W = 140, TOOL_STEP = 155, TOOL_X0 = 25;

  const width = Math.max(960, TOOL_X0 + toolsToDraw.length * TOOL_STEP + 20);
  const height = row3Y + 100;

  const nodes: NodeSpec[] = [];
  const paths: string[] = [];

  // flujo de mensajes = acento naranja cuando hay actividad, gris/café cuando no.
  const FLOW_ON = "var(--accent)";
  const FLOW_OFF = "var(--linelit)";
  // recursos del agente (model/memory/tools) = conector punteado gris.
  const RES_ON = "var(--muted)";
  const RES_OFF = "var(--linelit)";

  // Channels → Buffer
  d.channels.forEach((ch, i) => {
    const y = TOP + i * CH_STEP;
    const live = !!ch.last && now - ch.last < LIVE_MS;
    nodes.push({
      id: `channel:${ch.channel}`,
      x: CH_X, y, w: CH_W,
      icon: channelIcon(ch.channel),
      title: channelLabel(ch.channel),
      caption: ch.convs === 0
        ? esc(tr("agente.canalConfiguradoSinTrafico"))
        : `${ch.convs} ${ch.convs === 1 ? esc(tr("agente.conversacionSingular")) : esc(tr("agente.conversacionesPlural"))}`,
      accent: ch.convs === 0 ? "var(--dim)" : "var(--ok)",
      live,
      on: ch.convs > 0,
    });
    paths.push(
      `<path d="${bezier(CH_X + CH_W, y + CH_H / 2, BUF.x, midY)}" fill="none" stroke="${live ? FLOW_ON : FLOW_OFF}" stroke-width="2"/>`,
    );
  });

  const brainLive = !!d.lastAssistantAt && now - d.lastAssistantAt < LIVE_MS;

  nodes.push({
    id: "buffer",
    x: BUF.x, y: midY - BUF.h / 2, w: BUF.w,
    icon: "layers",
    title: "Buffer",
    caption: `agrupa mensajes · ${Math.round(d.cfg.bufferMs / 1000)} s`,
    accent: "var(--accent)",
    live: false,
  });
  paths.push(
    `<path d="${bezier(BUF.x + BUF.w, midY, BRAIN.x, midY)}" fill="none" stroke="${brainLive ? FLOW_ON : FLOW_OFF}" stroke-width="2"/>`,
  );

  // Prompt badge reflects the VIEWED channel: its own override (personalidad
  // propia) vs inheriting the general (usando la general). General view keeps
  // the classic personalizado/automático wording.
  const brainPromptLabel = d.channel
    ? d.settings[`${SETTING_KEYS.systemPromptOverride}:${d.channel}`]?.trim()
      ? esc(tr("agente.brainPersonalidadPropia"))
      : esc(tr("agente.brainUsandoLaGeneral"))
    : d.settings[SETTING_KEYS.systemPromptOverride]?.trim()
      ? esc(tr("agente.brainPromptPersonalizado"))
      : esc(tr("agente.brainPromptAutomatico"));
  nodes.push({
    id: "brain",
    x: BRAIN.x, y: midY - BRAIN.h / 2, w: BRAIN.w,
    icon: "cpu",
    title: d.cfg.botPaused ? esc(tr("agente.agentePausadoTitulo")) : esc(tr("agente.nodoAgente")),
    caption: `${brainPromptLabel} · máx 6 pasos`,
    accent: "var(--accent)",
    live: brainLive,
    count: `${d.turns30d} turnos/30d`,
    big: true,
  });
  paths.push(
    `<path d="${bezier(BRAIN.x + BRAIN.w, midY, REPLY.x, midY)}" fill="none" stroke="${brainLive ? FLOW_ON : FLOW_OFF}" stroke-width="2"/>`,
  );

  nodes.push({
    id: "reply",
    x: REPLY.x, y: midY - REPLY.h / 2, w: REPLY.w,
    icon: "message-square-reply",
    title: esc(tr("agente.nodoRespuesta")),
    caption: `máx ${d.cfg.maxChunks} mensajes · ${(d.cfg.interChunkDelayMs / 1000).toFixed(1)} s entre msgs`,
    accent: "var(--ok)",
    live: false,
  });

  // Row 2: model + memory hang below the brain (n8n-style dotted resources)
  const modelNode = { x: BRAIN.x - 110, y: row2Y, w: 170 };
  const memNode = { x: BRAIN.x + 130, y: row2Y, w: 170 };
  nodes.push({
    id: "model",
    x: modelNode.x, y: modelNode.y, w: modelNode.w,
    icon: "brain-circuit",
    title: esc(tr("agente.nodoModelo")),
    caption: esc(modelLabel(env, d.cfg)),
    accent: "var(--violet)",
    live: false,
  });
  nodes.push({
    id: "memory",
    x: memNode.x, y: memNode.y, w: memNode.w,
    icon: "database",
    title: esc(tr("agente.nodoMemoria")),
    caption: esc(tr("agente.memoriaCaption")),
    accent: "var(--violet)",
    live: false,
  });
  const brainBottom = midY + BRAIN.h / 2;
  paths.push(
    `<path d="${bezierDown(BRAIN.x + 60, brainBottom, modelNode.x + modelNode.w / 2, row2Y)}" fill="none" stroke="${RES_ON}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    `<path d="${bezierDown(BRAIN.x + 140, brainBottom, memNode.x + memNode.w / 2, row2Y)}" fill="none" stroke="${RES_ON}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
  );

  // Row 3: tools (channel view shows only the channel's enabled tools).
  toolsToDraw.forEach((name, i) => {
    const x = TOOL_X0 + i * TOOL_STEP;
    const u = d.usage.get(name);
    const off = d.disabled.includes(name); // always false in a channel view (filtered out)
    const live = !off && !!u?.last && now - u.last < LIVE_MS;
    nodes.push({
      id: `tool:${name}`,
      x, y: row3Y, w: TOOL_W,
      icon: toolMeta(name, tr).icon,
      title: name,
      caption: off ? esc(tr("agente.estadoApagada")) : `${u?.n ?? 0} llamadas/30d`,
      accent: off ? "var(--dim)" : "var(--accent-2)",
      live,
      off,
    });
    const fanX = BRAIN.x + 30 + (i * (BRAIN.w - 60)) / Math.max(1, toolsToDraw.length - 1);
    paths.push(
      `<path d="${bezierDown(fanX, brainBottom, x + TOOL_W / 2, row3Y)}" fill="none" stroke="${off ? RES_OFF : RES_ON}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
    );
  });

  return `
  <div class="overflow-x-auto border border-line bg-panel">
    <div class="relative" style="min-width:${width}px;height:${height}px;background:radial-gradient(circle,var(--line) 1px,transparent 1px) 0 0/22px 22px">
      <svg class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">${paths.join("")}</svg>
      ${nodes.map((n) => nodeHtml(n, channelQS, tr)).join("")}
    </div>
  </div>`;
}

// --- Page ---------------------------------------------------------------------

export async function renderAgentePage(env: Env, channel?: string): Promise<string> {
  const tr = traductor(env);
  const viewChannel = channel && configuredChannels(env).some((c) => c.id === channel) ? channel : undefined;
  const canvas = await renderAgenteCanvas(env, viewChannel);
  const chOptions = configuredChannels(env)
    .map((c) => `<option value="${esc(c.id)}" ${viewChannel === c.id ? "selected" : ""}>${esc(channelLabel(c.id))}</option>`)
    .join("");
  // Channel selector — lives OUTSIDE #canvas-wrap so it survives every canvas
  // swap. On change it reloads the canvas for the chosen channel; the canvas
  // poll (every 15s + canvas-refresh) hx-includes this select so it stays on
  // the same channel. General = value "" (empty ?channel → global view).
  const selector = `
    <div class="flex items-center gap-2 text-[12px]">
      <span style="color:var(--dim)">${esc(tr("agente.selectorViendoFlujo"))}</span>
      <select id="channel-select" name="channel"
              hx-get="/admin/agente/canvas" hx-target="#canvas-wrap" hx-swap="innerHTML" hx-trigger="change"
              class="font-display font-semibold cursor-pointer text-[12px]"
              style="background:var(--panel2);border:1px solid var(--line);color:var(--cream);padding:5px 10px">
        <option value="" ${viewChannel ? "" : "selected"}>${esc(tr("agente.selectorGeneralTodos"))}</option>
        ${chOptions}
      </select>
    </div>`;
  const body = `
    <div class="flex flex-col gap-3.5">
      <div class="flex flex-wrap items-center gap-3.5">
        <p class="text-[12px] max-w-[440px] leading-relaxed" style="color:var(--muted)">${esc(tr("agente.introRadiografia"))}</p>
        ${configuredChannels(env).length > 0 ? selector : ""}
        <div class="ml-auto flex items-center gap-4 text-[10.5px]" style="color:var(--dim)">
          <span class="flex items-center gap-1.5"><span class="inline-block w-4 h-0.5 align-middle" style="background:var(--accent)"></span>${esc(tr("agente.leyendaFlujoMensajes"))}</span>
          <span class="flex items-center gap-1.5"><span class="inline-block w-4 align-middle" style="border-top:1.5px dashed var(--muted)"></span>${esc(tr("agente.leyendaRecursosAgente"))}</span>
          <span class="flex items-center gap-1.5"><span class="inline-block w-2 h-2 rounded-full align-middle" style="background:var(--ok)"></span>${esc(tr("agente.leyendaActividad"))}</span>
        </div>
      </div>
      <div id="canvas-wrap" hx-get="/admin/agente/canvas" hx-include="#channel-select" hx-trigger="every 15s, canvas-refresh from:body" hx-swap="innerHTML">
        ${canvas}
      </div>
      <p class="text-[10.5px]" style="color:var(--dim)">${esc(tr("agente.notaFlujoFijo"))}</p>
    </div>`;
  return layout({ title: esc(tr("agente.tituloPagina")), activeTab: "agente", body, env });
}

// --- Node modal (pop-up, editable) ---------------------------------------------

/** OOB fragment that drops a self-dismissing toast in #toast-root. */
export function toastOob(msg: string): string {
  return `<div id="toast-root" hx-swap-oob="innerHTML"><div class="toast text-[12.5px] px-4 py-2.5">${esc(msg)}</div></div>`;
}

function savedBanner(tr: Traductor): string {
  return `<div class="px-3 py-2 text-[12.5px] mb-4" style="border:1px solid var(--ok);background:rgba(127,183,126,.08);color:var(--ok)">${esc(tr("agente.guardadoBanner"))}</div>`;
}

function modalShell(icon: string, title: string, badge: string, inner: string, saved: boolean, wide: boolean, tr: Traductor): string {
  return `
  <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
    <div class="modal-card w-full ${wide ? "max-w-4xl" : "max-w-lg"} max-h-[88vh] overflow-y-auto">
      <div class="flex items-center gap-2.5 sticky top-0 z-10" style="padding:16px 18px;border-bottom:1px solid var(--line);background:var(--panel)">
        <span class="w-[26px] h-[26px] flex-none flex items-center justify-center" style="border:1px solid var(--accent);background:var(--accent-soft)">
          <i data-lucide="${icon}" width="15" height="15" style="color:var(--accent)"></i>
        </span>
        <span class="font-display font-bold text-[15px] text-cream">${title}</span>${badge}
        <button type="button" aria-label="${esc(tr("agente.botonCerrar"))}"
                class="ml-auto cursor-pointer" style="color:var(--dim)"
                onclick="document.getElementById('modal-root').innerHTML=''">
          <i data-lucide="x" width="18" height="18"></i>
        </button>
      </div>
      <div class="p-[18px]">${saved ? savedBanner(tr) : ""}${inner}</div>
    </div>
  </div>`;
}

/** Range slider with a live value display next to the label. */
function slider(opts: {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  hint: string;
}): string {
  const outId = `${opts.name}-out`;
  return `
  <div class="mb-5">
    <div class="flex items-baseline justify-between mb-1.5">
      <label for="${opts.name}" class="text-[12.5px] text-cream">${esc(opts.label)}</label>
      <span class="text-[12.5px] font-mono font-semibold" style="color:var(--accent)"><output id="${outId}">${opts.value}</output>${esc(opts.unit)}</span>
    </div>
    <input type="range" id="${opts.name}" name="${opts.name}" min="${opts.min}" max="${opts.max}" step="${opts.step}" value="${opts.value}"
           class="w-full" oninput="document.getElementById('${outId}').textContent=this.value">
    <p class="text-[10.5px] mt-1.5" style="color:var(--dim)">${esc(opts.hint)}</p>
  </div>`;
}

function saveBtn(tr: Traductor): string {
  return `<button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:8px 16px">${esc(tr("agente.botonGuardar"))}</button>`;
}

function saveForm(nodeId: string, inner: string, tr: Traductor): string {
  return `
  <form hx-post="/admin/agente/node/${encodeURIComponent(nodeId)}/save" hx-target="#modal-root" hx-swap="innerHTML">
    ${inner}
    ${saveBtn(tr)}
  </form>`;
}

// --- Brain modal: single-channel prompt editor ---------------------------------
//
// The brain node's prompt is GLOBAL by default but can be overridden per channel
// (system_prompt_override:<canal>) so WhatsApp/Instagram/etc. each get their own
// personality without touching the others. The modal shows ONE channel at a time
// — whichever the canvas selector is viewing. Everything here only READS
// existing settings and WRITES exclusively in response to an explicit user
// action in the form below (guardar / reset / copiar-general) — never as a side
// effect of rendering.

/** Prompt editor for the current view: General (channelId undefined) or one
 *  channel. Textarea always shows the EFFECTIVE text (own override, or — when
 *  inheriting — the general effective prompt, so the owner starts from what the
 *  bot actually uses today). */
// Parte el prompt ENSAMBLADO en sus bloques <tag> y los pinta por dueño: en ÁMBAR lo
// que el miembro controla (info/instrucciones/voz), en gris 🔒 lo automático. El bloque
// de instrucciones se RESALTA (y si está vacío, se inyecta un placeholder en su lugar)
// para que vea EXACTAMENTE dónde entran sus instrucciones dentro del prompt.
const PROMPT_TUYO = new Set(["business_context", "custom_instructions", "brand_voice"]);
const PROMPT_LABEL: Record<string, string> = {
  output_language: "Idioma", role: "Rol", business_context: "Info del negocio",
  identity_and_voice: "Estilo base", brand_voice: "Voz de marca",
  custom_instructions: "✍️ Tus instrucciones", core_principles: "Frenos · no inventar",
  moneda: "Moneda", tools: "Herramientas", escalation_rules: "Escalación",
  style_guide: "Guía de estilo", anti_patterns: "Anti-patrones",
  lecciones_aprendidas: "Lecciones", diagnostic_playbooks: "Tu giro",
};
function humanizeTag(tag: string): string {
  const s = tag.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// expert=true (override): todo es del dueño (ámbar), etiqueta = el tag humanizado.
// expert=false (generado): split tuyo/automático + resalta <custom_instructions>.
function promptSectionCard(tag: string, body: string, expert = false): string {
  const isCustom = !expert && tag === "custom_instructions";
  const mine = expert || PROMPT_TUYO.has(tag);
  const rail = isCustom || mine ? "var(--accent)" : "var(--dim)";
  const who = isCustom ? "AQUÍ ENTRAN TUS INSTRUCCIONES" : mine ? "tuyo" : "🔒 automático";
  const bg = isCustom ? "background:linear-gradient(90deg,var(--accent-soft),transparent 60%);" : "background:var(--bg);";
  const label = expert ? humanizeTag(tag) : (PROMPT_LABEL[tag] ?? tag);
  const shown = esc(body) || `<span style="color:var(--dim)">— escríbelas arriba ↑ —</span>`;
  return `
  <div style="border-left:3px solid ${rail};${bg}padding:8px 11px;margin-bottom:5px">
    <div class="flex items-center gap-2 mb-1">
      <span class="font-mono text-[11px] font-medium" style="color:${mine ? "var(--accent)" : "var(--dim)"}">${esc(label)}</span>
      <span class="font-mono text-[8.5px] tracking-[.07em] uppercase ml-auto" style="color:${isCustom || mine ? "var(--accent-2)" : "var(--dim)"}">${who}</span>
    </div>
    <div class="font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap" style="color:${mine ? "var(--cream)" : "var(--muted)"};max-height:110px;overflow:auto">${shown}</div>
  </div>`;
}
function renderPromptSectioned(assembled: string, hasCustom: boolean, customValue: string, expert = false): string {
  const blocks: { tag: string; body: string }[] = [];
  const re = /<([a-z_]+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(assembled)) !== null) blocks.push({ tag: m[1], body: m[2].trim() });
  if (expert) {
    // Override: muestra cualquier texto ANTES del primer tag como "Introducción",
    // luego cada bloque <tag> como una sección (todo del dueño).
    const firstTag = assembled.search(/<[a-z_]+>/);
    const intro = firstTag < 0 ? assembled.trim() : firstTag > 0 ? assembled.slice(0, firstTag).trim() : "";
    let out = intro ? promptSectionCard("introducción / rol", intro, true) : "";
    for (const b of blocks) out += promptSectionCard(b.tag, b.body, true);
    return out;
  }
  let done = false;
  let out = "";
  for (const b of blocks) {
    if (!done && !hasCustom && b.tag === "core_principles") {
      out += promptSectionCard("custom_instructions", ""); // placeholder en su lugar real
      done = true;
    }
    if (b.tag === "custom_instructions") { out += promptSectionCard("custom_instructions", customValue); done = true; }
    else out += promptSectionCard(b.tag, b.body);
  }
  if (!done) out += promptSectionCard("custom_instructions", customValue);
  return out;
}

// El cerebro se muestra POR SECCIONES: arriba las Instrucciones (aditivas) que el dueño
// edita; en medio, SIEMPRE visible, su prompt completo por secciones y con colores (lo
// suyo en ámbar, lo automático 🔒 en gris, sus instrucciones resaltadas donde entran); y
// abajo el "Modo experto" (el override de siempre, reemplaza TODO) plegado. El editor de
// override se conserva INTACTO (mismos forms/strings) — no cambia el guardado ni el canvas.
function promptPanel(d: AgenteData, channelId: string | undefined, tr: Traductor): string {
  const key = channelId ? `${SETTING_KEYS.systemPromptOverride}:${channelId}` : SETTING_KEYS.systemPromptOverride;
  const ownRaw = d.settings[key]?.trim();
  const hasOwn = !!ownRaw;
  const textValue = hasOwn ? ownRaw! : d.cfg.systemPrompt;

  const customKey = channelId ? `${SETTING_KEYS.customInstructions}:${channelId}` : SETTING_KEYS.customInstructions;
  const customRaw = d.settings[customKey]?.trim();
  const hasCustom = !!customRaw;
  const customValue = customRaw ?? "";

  const badgeHtml = channelId
    ? hasOwn
      ? `<span class="text-[9.5px] tracking-[.05em]" style="color:var(--accent-2);border:1px solid var(--accent-2);padding:1px 7px">${esc(tr("agente.badgePersonalidadPropia"))}</span>`
      : `<span class="text-[9.5px] tracking-[.05em]" style="color:var(--info);border:1px solid var(--info);padding:1px 7px">${esc(tr("agente.badgeUsandoLaGeneral"))}</span>`
    : `<span class="text-[9.5px] tracking-[.05em]" style="color:${hasOwn ? "var(--accent-2)" : "var(--info)"};border:1px solid ${hasOwn ? "var(--accent-2)" : "var(--info)"};padding:1px 7px">${hasOwn ? "✍ manual" : esc(tr("agente.badgeAutomatico"))}</span>`;

  const introText = channelId
    ? hasOwn
      ? `Este canal (${esc(channelLabel(channelId))}) tiene su propio prompt — se usa tal cual, sin importar lo que diga la General.`
      : `Este canal (${esc(channelLabel(channelId))}) no tiene prompt propio: está usando exactamente el mismo texto que la General (mostrado abajo). Edítalo y guarda para darle personalidad propia, o copia la general primero.`
    : `Este es el prompt efectivo — exactamente lo que Claude recibe. ${
        hasOwn
          ? esc(tr("agente.promptModoManual"))
          : esc(tr("agente.promptModoAutomatico"))
      }`;

  // ── 1) Instrucciones (ADITIVAS, lo primario) — su propio form ────────────────
  const instrucciones = `
  <form hx-post="/admin/agente/node/brain/save" hx-target="#modal-root" hx-swap="innerHTML" class="mb-4">
    <input type="hidden" name="channel" value="${esc(channelId ?? "")}">
    <div class="flex items-center justify-between mb-1.5">
      <label class="text-[12.5px] font-medium text-cream">✍️ Instrucciones${channelId ? ` · ${esc(channelLabel(channelId))}` : ""}</label>
      <span class="text-[9.5px] tracking-[.05em]" style="color:var(--ok);border:1px solid var(--ok);padding:1px 7px">se suman</span>
    </div>
    <p class="text-[11px] mb-2 leading-relaxed" style="color:var(--dim)">Dile cómo comportarse: reglas, prioridades, qué NO hacer. Tu info, tus tools y tus frenos ya están puestos — esto se <b class="text-cream">suma</b>, no los reemplaza. Lo que escribas aquí lo verás <b style="color:var(--accent)">resaltado en ámbar</b> abajo, dentro de tu prompt.</p>
    <textarea name="custom_instructions" rows="7"
              class="w-full font-mono text-[11px] p-3 outline-none resize-y"
              style="background:var(--bg);border:1px solid var(--line);color:var(--cream)"
              placeholder="Ej: No agendes citas los domingos. Ofrece siempre el envío exprés. Si preguntan por la competencia, no la critiques.">${esc(customValue)}</textarea>
    <div class="flex flex-wrap gap-2 mt-3">
      <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:8px 16px">Guardar instrucciones</button>
      ${hasCustom ? `<button type="submit" name="action" value="reset-custom" formnovalidate class="ghostbtn text-[12.5px] cursor-pointer" style="background:var(--panel2);border:1px solid var(--line);color:var(--muted);padding:8px 16px">Borrar instrucciones</button>` : ""}
    </div>
    ${hasOwn ? `<p class="text-[10.5px] mt-2 leading-relaxed" style="color:var(--accent-2)"><i data-lucide="triangle-alert" width="11" height="11" class="inline align-[-1px]"></i> Tienes un <b>prompt manual</b> activo (Modo experto, abajo) que reemplaza todo — estas instrucciones no aplican hasta que lo quites.</p>` : ""}
  </form>`;

  // ── 2) Tu prompt completo, por secciones y con colores — SIEMPRE visible ─────
  // Las herramientas (incl. escalar a humano) NO viven en el texto del prompt: van
  // conectadas en el código y el modelo las recibe siempre. En modo experto el override
  // no las lista como sección, así que las mostramos como una tarjeta para que el
  // "cerebro" quede completo. (En modo generado ya salen como sección <tools>.)
  // Definiciones de las tools = lo que el modelo TAMBIÉN recibe (aparte del texto del
  // prompt): nombre + descripción real de cada tool. Así el usuario ve TODO el input.
  const toolDefsSection = `
  <div class="mb-4">
    <div class="flex items-center gap-3 mb-2 flex-wrap">
      <div class="text-[11px] tracking-[.04em] uppercase font-medium" style="color:var(--ok)">🛠 Herramientas — el modelo TAMBIÉN recibe esto</div>
      <span class="text-[9.5px] ml-auto" style="color:var(--dim)">${d.cfg.enabledToolNames.length} conectadas</span>
    </div>
    ${d.cfg.enabledToolNames.map((n) => `
      <div style="border-left:3px solid var(--ok);background:var(--bg);padding:7px 11px;margin-bottom:4px">
        <div class="font-mono text-[10.5px] font-medium" style="color:var(--ok)">${esc(n)}</div>
        <div class="text-[10.5px] leading-relaxed" style="color:var(--muted)">${esc(d.toolDefs[n] ?? "")}</div>
      </div>`).join("") || `<div class="text-[10.5px]" style="color:var(--dim)">(ninguna activa)</div>`}
    <p class="text-[10px] mt-1 leading-relaxed" style="color:var(--dim)">Esto NO va en el texto del prompt: son <b style="color:var(--muted)">funciones</b> que el modelo recibe aparte (nombre + descripción + parámetros). Así sabe qué hace cada tool y CUÁNDO usarla — incluye escalar a humano (handoff). Se togglean en <b class="text-cream">Tools</b> ↓.</p>
  </div>`;
  const preview = hasOwn
    ? `
  <div class="mb-4">
    <div class="flex items-center gap-3 mb-2 flex-wrap">
      <div class="text-[11px] tracking-[.04em] uppercase font-medium" style="color:var(--accent-2)">👁 Tu prompt (Modo experto) — por secciones</div>
      <span class="text-[9.5px] flex items-center gap-1.5 ml-auto" style="color:var(--dim)"><span style="display:inline-block;width:9px;height:9px;background:var(--accent)"></span>&nbsp;todo es tuyo</span>
    </div>
    ${renderPromptSectioned(d.cfg.systemPrompt, false, "", true)}
    ${toolDefsSection}
    <p class="text-[10.5px] mt-2 leading-relaxed" style="color:var(--dim)">Reemplazaste el frame automático, así que <b style="color:var(--accent)">todo el texto es tuyo</b> (no hay secciones 🔒). Las <b style="color:var(--ok)">herramientas</b> sí siguen conectadas aparte (arriba). Para editar el prompt, usa el texto completo en <b class="text-cream">Modo experto</b> abajo.</p>
  </div>`
    : `
  <div class="mb-4">
    <div class="flex items-center gap-3 mb-2 flex-wrap">
      <div class="text-[11px] tracking-[.04em] uppercase font-medium" style="color:var(--cream)">👁 Tu prompt completo — por secciones</div>
      <span class="text-[9.5px] flex items-center gap-1.5 ml-auto" style="color:var(--dim)"><span style="display:inline-block;width:9px;height:9px;background:var(--accent)"></span>&nbsp;tuyo&nbsp;&nbsp;<span style="display:inline-block;width:9px;height:9px;background:var(--dim)"></span>&nbsp;🔒 automático</span>
    </div>
    ${renderPromptSectioned(d.cfg.systemPrompt, hasCustom, customValue)}
    ${toolDefsSection}
    <p class="text-[10.5px] mt-2 leading-relaxed" style="color:var(--dim)">Lo <b style="color:var(--accent)">ámbar</b> es tuyo (lo editas). Lo gris con 🔒 (frenos, tools, idioma, giro) lo pone Forja y no lo puedes borrar sin querer.</p>
  </div>`;

  // ── 4) Modo experto: el editor de override de SIEMPRE, intacto (reemplaza todo)
  const expert = `
  <details ${hasOwn ? "open" : ""}>
    <summary class="text-[12px] cursor-pointer" style="color:var(--dim)">⚙ Modo experto — reemplazar el prompt entero</summary>
    <p class="text-[10.5px] mt-2 mb-2 leading-relaxed" style="color:var(--accent-2)"><b>Reemplaza TODO</b> — pierdes tus tools, tu info y tus frenos automáticos. Solo si sabes lo que haces.</p>
    <form hx-post="/admin/agente/node/brain/save" hx-target="#modal-root" hx-swap="innerHTML">
      <input type="hidden" name="channel" value="${esc(channelId ?? "")}">
      <div class="flex items-center justify-between mb-1.5">
        <label class="text-[12.5px] font-medium text-cream">${channelId ? `Prompt en ${esc(channelLabel(channelId))}` : esc(tr("agente.promptDelAgente"))}</label>
        ${badgeHtml}
      </div>
      <p class="text-[11px] mb-2 leading-relaxed" style="color:var(--dim)">${introText}</p>
      <textarea name="system_prompt_override" rows="14" required
                class="w-full font-mono text-[11px] p-3 outline-none resize-y"
                style="background:var(--bg);border:1px solid var(--line);color:var(--cream)">${esc(textValue)}</textarea>
      <div class="flex flex-wrap gap-2 mt-3">
        <button type="submit" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:8px 16px">Guardar${channelId ? "" : " prompt manual"}</button>
        ${channelId && !hasOwn ? `<button type="submit" name="action" value="copy-general" formnovalidate class="ghostbtn text-[12.5px] cursor-pointer" style="background:var(--panel2);border:1px solid var(--line);color:var(--muted);padding:8px 16px">${esc(tr("agente.copiarLaGeneral"))}</button>` : ""}
        ${channelId && hasOwn ? `<button type="submit" name="action" value="reset" formnovalidate class="ghostbtn text-[12.5px] cursor-pointer" style="background:var(--panel2);border:1px solid var(--line);color:var(--muted);padding:8px 16px">${esc(tr("agente.borrarPersonalizado"))}</button>` : ""}
        ${!channelId && hasOwn ? `<button type="submit" name="action" value="reset" formnovalidate class="ghostbtn text-[12.5px] cursor-pointer" style="background:var(--panel2);border:1px solid var(--line);color:var(--muted);padding:8px 16px">${esc(tr("agente.volverAlAutomatico"))}</button>` : ""}
      </div>
    </form>
  </details>`;

  return `<div class="mb-2">${instrucciones}${preview}${expert}</div>`;
}

/** Tools list inside the Agente modal, scoped to the viewed channel. Since a
 *  channel view HIDES its off tools from the canvas, this list is the one place
 *  to see ALL tools and turn one back on. Each toggle writes disabled_tools
 *  (General) or disabled_tools:<canal> and re-renders the WHOLE Agente modal so
 *  the list + the redrawn canvas stay on the same channel. A tool off GLOBALLY
 *  is locked in a channel view (can't re-enable per-channel — do it in General). */
function toolsPanel(d: AgenteData, channelId: string | undefined, tr: Traductor): string {
  const globalDisabled = new Set(d.globalDisabled);
  const channelDisabled = channelId ? new Set(csvList(d.settings[`${SETTING_KEYS.disabledTools}:${channelId}`])) : null;

  const rows = d.toolNames
    .map((name) => {
      const meta = toolMeta(name, tr);
      const forcedOff = globalDisabled.has(name);
      const localOff = channelDisabled ? channelDisabled.has(name) : forcedOff;
      const effOff = channelId ? forcedOff || localOff : forcedOff;
      const lockedByGlobal = !!channelId && forcedOff;
      return `
      <div class="flex items-center gap-2.5 py-2" style="border-bottom:1px solid var(--linelit)">
        <span class="w-[20px] h-[20px] flex-none flex items-center justify-center" style="border:1px solid var(--linelit)">
          <i data-lucide="${meta.icon}" width="11" height="11" style="color:var(--dim)"></i>
        </span>
        <span class="text-[11.5px] text-cream flex-1 truncate">${esc(meta.label)}</span>
        ${meta.critical ? `<i data-lucide="triangle-alert" width="12" height="12" style="color:var(--accent-2)" title="${esc(tr("agente.avisoToolCritica"))}"></i>` : ""}
        <span class="text-[9px] tracking-[.05em] flex-none" style="color:${effOff ? "var(--dim)" : "var(--ok)"};border:1px solid ${effOff ? "var(--linelit)" : "var(--ok)"};padding:1px 6px">${effOff ? esc(tr("agente.estadoApagada")) : esc(tr("agente.estadoEncendida"))}</span>
        <form hx-post="/admin/agente/node/brain/tools/${encodeURIComponent(name)}/toggle" hx-target="#modal-root" hx-swap="innerHTML" class="flex-none">
          <input type="hidden" name="channel" value="${esc(channelId ?? "")}">
          <button type="submit" ${lockedByGlobal ? "disabled" : ""}
                  class="text-[10px] cursor-pointer" style="background:var(--panel2);border:1px solid var(--line);color:var(--muted);padding:3px 8px;${lockedByGlobal ? "opacity:.45;cursor:not-allowed" : ""}"
                  ${lockedByGlobal ? `title="${esc(tr("agente.toolBloqueadaPorGeneral"))}"` : ""}>
            ${effOff ? esc(tr("agente.botonEncender")) : esc(tr("agente.botonApagar"))}
          </button>
        </form>
      </div>`;
    })
    .join("");

  return `
  <div class="mt-5">
    <div class="text-[10.5px] tracking-[.05em] uppercase mb-1.5" style="color:var(--dim)">${channelId ? `Tools en ${esc(channelLabel(channelId))}` : esc(tr("agente.toolsTodosLosCanales"))}</div>
    <p class="text-[11px] mb-1.5 leading-relaxed" style="color:var(--dim)">${channelId
      ? `Apaga una tool para quitarla del flujo de ${esc(channelLabel(channelId))} (los demás canales no se tocan). Vuélvela a encender desde aquí.`
      : esc(tr("agente.toolsAfectaTodosCanales"))}</p>
    ${rows}
  </div>`;
}

export async function renderNodeModal(env: Env, nodeId: string, saved = false, activeChannel?: string): Promise<string> {
  const tr = traductor(env);
  const d = await loadAgenteData(env, activeChannel);
  const channel = d.channel; // validated (undefined = General)

  if (nodeId === "buffer") {
    return modalShell("layers", esc(tr("agente.bufferModalTitulo")), "", saveForm("buffer", `
      <p class="text-[12.5px] mb-4 leading-relaxed" style="color:var(--muted)">${esc(tr("agente.bufferExplicacion"))}</p>
      ${slider({
        name: "buffer_seconds", label: esc(tr("agente.tiempoDeEspera")),
        min: 3, max: 30, step: 1, value: Math.round(d.cfg.bufferMs / 1000), unit: " s",
        hint: esc(tr("agente.bufferHint")),
      })}`, tr), saved, false, tr);
  }

  if (nodeId === "reply") {
    return modalShell("message-square-reply", esc(tr("agente.nodoRespuesta")), "", saveForm("reply", `
      <p class="text-[12.5px] mb-4 leading-relaxed" style="color:var(--muted)">${esc(tr("agente.respuestaExplicacion"))}</p>
      ${slider({
        name: "max_chunks", label: esc(tr("agente.maxMensajesPorRespuesta")),
        min: 1, max: 5, step: 1, value: d.cfg.maxChunks, unit: "",
        hint: esc(tr("agente.maxChunksHint")),
      })}
      ${slider({
        name: "inter_chunk_delay_s", label: esc(tr("agente.pausaEntreMensajes")),
        min: 0, max: 5, step: 0.25, value: +(d.cfg.interChunkDelayMs / 1000).toFixed(2), unit: " s",
        hint: esc(tr("agente.pausaEntreMensajesHint")),
      })}`, tr), saved, false, tr);
  }

  if (nodeId === "model") {
    const current = d.cfg.modelOverride;
    const card = (value: string, icon: string, label: string, desc: string): string => `
      <label class="relative block cursor-pointer">
        <input type="radio" name="model_override" value="${value}" class="peer sr-only" ${current === value ? "checked" : ""}>
        <span class="cfgcard block h-full border border-line bg-panel2 p-3 transition peer-checked:border-accent peer-checked:bg-accent-soft">
          <i data-lucide="${icon}" width="18" height="18" class="text-muted"></i>
          <span class="block font-display font-semibold text-[12.5px] text-cream mt-1.5">${label}</span>
          <span class="block text-[10px] text-dim mt-1 leading-snug">${desc}</span>
        </span>
      </label>`;
    return modalShell("brain-circuit", esc(tr("agente.modeloModalTitulo")), "", saveForm("model", `
      <p class="text-[12.5px] mb-3" style="color:var(--muted)">${esc(tr("agente.queCerebro"))} <span class="font-mono text-[11px]" style="color:var(--dim)">${esc(modelLabel(env, d.cfg))}</span></p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
        ${card("auto", "scale", esc(tr("agente.modeloAutoLabel")), esc(tr("agente.modeloAutoDesc")))}
        ${card("haiku", "feather", esc(tr("agente.modeloRapidoLabel")), esc(tr("agente.modeloRapidoDesc")))}
        ${card("sonnet", "brain", esc(tr("agente.modeloInteligenteLabel")), esc(tr("agente.modeloInteligenteDesc")))}
      </div>
      ${slider({
        name: "temperature", label: esc(tr("agente.temperatura")),
        min: 0, max: 1, step: 0.05, value: d.cfg.temperature ?? 1, unit: "",
        hint: esc(tr("agente.temperaturaHint")),
      })}`, tr), saved, false, tr);
  }

  if (nodeId === "brain") {
    const badge = d.cfg.botPaused
      ? `<span class="text-[9.5px]" style="color:var(--dim);border:1px solid var(--linelit);padding:1px 8px">${esc(tr("agente.badgePausado"))}</span>`
      : `<span class="text-[9.5px]" style="color:var(--ok);border:1px solid var(--ok);padding:1px 8px">${esc(tr("agente.badgeActivo"))}</span>`;

    // Which channel this brain modal is FOR is driven entirely by the canvas
    // selector (activeChannel → d.channel). One channel at a time.
    const title = channel ? `Agente en ${esc(channelLabel(channel))}` : esc(tr("agente.cerebroTitulo"));

    const summary = `
      <div class="text-[12.5px] space-y-1 mb-4" style="color:var(--muted)">
        <div><b class="text-cream">${esc(tr("agente.modeloResumen"))}</b> <span class="font-mono text-[11px]">${esc(modelLabel(env, d.cfg))}</span></div>
        <div><b class="text-cream">${esc(tr("agente.turnosRespondidos"))}</b> ${d.turns30d}</div>
        <div><b class="text-cream">Tools activas${channel ? ` en ${esc(channelLabel(channel))}` : ""}:</b> ${d.cfg.enabledToolNames.length} de ${d.toolNames.length}</div>
      </div>`;

    // Pause is GLOBAL (bot_paused). Only offer it in the General view so the
    // owner never thinks they're pausing just one channel. In a channel view a
    // short note points them to General for model/buffer/pause.
    const pauseForm = channel
      ? `<p class="text-[11px] mb-4 leading-relaxed" style="color:var(--dim)"><i data-lucide="info" width="12" height="12" class="inline align-[-1px]"></i> Aquí solo cambias el <b class="text-cream">prompt</b> y las <b class="text-cream">tools</b> de ${esc(channelLabel(channel))}. El modelo, el buffer y la pausa son globales — ajústalos en la vista <b class="text-cream">General</b>.</p>`
      : `<form hx-post="/admin/agente/node/brain/save" hx-target="#modal-root" hx-swap="innerHTML" class="mb-5">
          <input type="hidden" name="bot_paused" value="${d.cfg.botPaused ? "0" : "1"}">
          <button type="submit" class="${d.cfg.botPaused ? "bigbtn font-display font-bold" : "ghostbtn"} text-[12.5px] cursor-pointer inline-flex items-center gap-2"
                  style="${d.cfg.botPaused
                    ? "background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:9px 16px"
                    : "background:var(--panel2);border:1px solid var(--line);color:var(--muted);padding:9px 16px"}">
            <i data-lucide="${d.cfg.botPaused ? "play" : "pause"}" width="14" height="14"></i>
            ${d.cfg.botPaused ? esc(tr("agente.reactivarBot")) : esc(tr("agente.pausarBotTodasConversaciones"))}
          </button>
        </form>`;

    return modalShell("cpu", title, badge, `${summary}${pauseForm}${promptPanel(d, channel, tr)}${toolsPanel(d, channel, tr)}`, saved, true, tr);
  }

  if (nodeId === "memory") {
    return modalShell("database", esc(tr("agente.nodoMemoria")), "", `
      <p class="text-[12.5px] leading-relaxed" style="color:var(--muted)">${tr("agente.memoriaExplicacion")}</p>`, false, false, tr);
  }

  if (nodeId.startsWith("channel:")) {
    const name = nodeId.slice("channel:".length);
    const ch = d.channels.find((c) => c.channel === name);
    if (!ch) return modalShell("radio", esc(tr("agente.nodoCanal")), "", `<p class="text-[12.5px]" style="color:var(--dim)">${esc(tr("agente.canalSinActividad"))}</p>`, false, false, tr);
    return modalShell(channelIcon(ch.channel), `Canal: ${esc(channelLabel(ch.channel))}`, "", `
      <div class="text-[12.5px] space-y-1 mb-3" style="color:var(--muted)">
        <div><b class="text-cream">${esc(tr("agente.canalConversaciones"))}</b> ${ch.convs}</div>
        <div><b class="text-cream">${esc(tr("agente.canalUltimaActividad"))}</b> ${ago(ch.last, tr)}</div>
      </div>
      <a href="/admin/conversations" class="text-[12.5px] hover:underline">${esc(tr("agente.verConversaciones"))}</a>`, false, false, tr);
  }

  if (nodeId.startsWith("tool:")) {
    const name = nodeId.slice("tool:".length);
    if (!d.toolNames.includes(name)) {
      return modalShell("wrench", "Tool", "", `<p class="text-[12.5px]" style="color:var(--dim)">${esc(tr("agente.toolNoEncontrada"))}</p>`, false, false, tr);
    }
    const meta = toolMeta(name, tr);
    const u = d.usage.get(name);
    // `off` = effective for the viewed channel (union global + per-channel).
    const off = d.disabled.includes(name);
    // In a channel view, a tool off GLOBALLY can't be re-enabled just for the
    // channel — it's locked; the owner must turn it back on in General.
    const lockedByGlobal = !!channel && d.globalDisabled.includes(name);
    const scopeNote = channel
      ? `<p class="text-[11px] mb-3 leading-relaxed" style="color:var(--dim)">Estás viendo el flujo de <b class="text-cream">${esc(channelLabel(channel))}</b>. Prender/apagar aquí solo afecta a ${esc(channelLabel(channel))} — los demás canales no se tocan.</p>`
      : `<p class="text-[11px] mb-3 leading-relaxed" style="color:var(--dim)">${tr("agente.alcanceGeneral")}</p>`;

    const toggleBtn = lockedByGlobal
      ? `<div class="text-[11px] flex items-start gap-2 leading-relaxed" style="color:var(--muted);border:1px solid var(--linelit);background:var(--panel2);padding:10px">
           <i data-lucide="lock" width="14" height="14" class="flex-none mt-0.5"></i>
           Esta tool está apagada en <b class="text-cream">General</b> (todos los canales). Para controlarla solo en ${esc(channelLabel(channel!))}, préndela primero en la vista General.
         </div>`
      : `<form hx-post="/admin/agente/tools/${encodeURIComponent(name)}/toggle" hx-target="#modal-root" hx-swap="innerHTML" class="inline">
          <input type="hidden" name="channel" value="${esc(channel ?? "")}">
          <button class="${off ? "bigbtn font-display font-bold" : "ghostbtn"} text-[12.5px] cursor-pointer"
                  style="${off
                    ? "background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:3px 3px 0 var(--linelit);padding:9px 16px"
                    : "background:var(--panel2);border:1px solid var(--line);color:var(--muted);padding:9px 16px"}">
            ${off ? esc(tr("agente.encenderTool")) : esc(tr("agente.apagarTool"))}${channel ? ` en ${esc(channelLabel(channel))}` : ""}
          </button>
        </form>`;

    return modalShell(
      meta.icon,
      `${esc(meta.label)} <span class="font-mono text-[11px]" style="color:var(--dim)">(${esc(name)})</span>`,
      off
        ? `<span class="text-[9.5px]" style="color:var(--dim);border:1px solid var(--linelit);padding:1px 8px">${esc(tr("agente.estadoApagada"))}</span>`
        : `<span class="text-[9.5px]" style="color:var(--ok);border:1px solid var(--ok);padding:1px 8px">${esc(tr("agente.estadoEncendida"))}</span>`,
      `
      <p class="text-[12.5px] mb-2 leading-relaxed" style="color:var(--muted)">${esc(meta.desc)}</p>
      <div class="text-[12.5px] space-y-1 mb-3" style="color:var(--muted)">
        <div><b class="text-cream">${esc(tr("agente.llamadas30dias"))}</b> ${u?.n ?? 0}</div>
        <div><b class="text-cream">${esc(tr("agente.ultimaVezUsada"))}</b> ${ago(u?.last, tr)}</div>
      </div>
      ${scopeNote}
      ${meta.critical && !off ? `<div class="text-[11px] mb-3.5 flex items-start gap-2 leading-relaxed" style="color:var(--accent-2);border:1px solid rgba(245,166,35,.35);background:rgba(245,166,35,.08);padding:10px"><i data-lucide="triangle-alert" width="14" height="14" class="flex-none mt-0.5"></i> No recomendamos apagar esta tool: el bot la necesita para funcionar bien.</div>` : ""}
      ${toggleBtn}
      <p class="text-[10.5px] mt-2" style="color:var(--dim)">${esc(tr("agente.cambioAplicaSiguienteMensaje"))}</p>`, saved, false, tr);
  }

  return modalShell("box", esc(tr("agente.nodoGenerico")), "", `<p class="text-[12.5px]" style="color:var(--dim)">${esc(tr("agente.nodoDesconocido"))}</p>`, false, false, tr);
}

/**
 * Flip a tool in/out of the disabled_tools setting — GLOBAL by default, or
 * scoped to one channel's disabled_tools:<canal> when `channel` is given.
 * Unknown names are rejected (returns false) so the route can't write garbage
 * into settings.
 */
export async function toggleTool(env: Env, name: string, channel?: string): Promise<boolean> {
  const tr = traductor(env);
  const known = Object.keys(buildTools({ env, getConversationId: () => null }));
  if (!known.includes(name)) return false;

  const key = channel ? `${SETTING_KEYS.disabledTools}:${channel}` : SETTING_KEYS.disabledTools;
  const repo = new SettingsRepo(new Db(env.DB));
  const raw = (await repo.get(key)) ?? "";
  const disabled = new Set(
    raw.split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (disabled.has(name)) disabled.delete(name);
  else disabled.add(name);
  await repo.set(key, [...disabled].join(","));
  return true;
}

/**
 * The GLOBAL effective system prompt right now — the manual override if one
 * is set, otherwise the generated prompt. Used by the "copiar la general"
 * action so a channel tab can fork off the CURRENT text (not a stale copy
 * from when the modal was opened).
 */
export async function currentGlobalSystemPrompt(env: Env): Promise<string> {
  const tr = traductor(env);
  const toolNames = Object.keys(buildTools({ env, getConversationId: () => null }));
  const cfg = await resolveAgentConfig(env, toolNames);
  return cfg.systemPrompt;
}
