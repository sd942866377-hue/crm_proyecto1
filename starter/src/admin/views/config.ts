// Pro dashboard "Config" tab — a VISUAL CONTROL PANEL for a non-technical owner
// (e.g. a barbershop owner). No raw numbers, no "pick 1-10": every technical
// setting is a group of 2-3 selectable cards (radio + inline SVG icon + short
// label + one-line plain-Spanish description). Text settings are plain inputs /
// textareas with clear labels (no jargon). The form POSTs to /admin/config.
import type { Env } from "../../env";
import { LOCALES_PANEL, traductor, type Traductor } from "../i18n";
import { IDIOMAS } from "../../idioma";
import { SETTING_KEYS } from "../../db/settings";
import { isPro } from "../../config";
import { stripeConfigured } from "../../integrations/stripe";
import { handoffNotifyStatus } from "../../tools/handoffHuman";
import { renderBusinessContext } from "../../businessContext";
import { CURATED_MODELS } from "../../llm/provider";
import {
  CONTROL_LIST,
  valueToLevel,
  type ControlDef,
} from "../control-levels";
import { layout } from "./layout";

/** Escape untrusted text before interpolating it into an HTML attribute/body. */
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// Brand accent = orange (Horizontes retro-terminal theme). The selected card
// lights up accent; the hidden radio drives the highlight via Tailwind's `peer`
// utilities so the whole card is clickable (it's a <label>).
const CARD_BASE =
  "peer-checked:border-accent peer-checked:bg-accent-soft " +
  "peer-checked:[&_.card-icon]:text-accent peer-checked:[&_.card-label]:text-accent " +
  "cfgcard flex flex-col gap-1 h-full border border-line bg-panel2 p-4 cursor-pointer";

/** Textos traducidos de un control de tarjetas. Los DATOS (valores guardados,
 *  iconos, orden) siguen viviendo en control-levels.ts; aquí solo el idioma. */
interface TextosControl {
  titulo: string;
  ayuda: string;
  /** Por valor guardado del option. */
  opciones: Record<string, { label: string; desc: string }>;
}

/** El diccionario de los controles de tarjetas, ya en el idioma del panel. */
function textosControles(tr: Traductor): Record<string, TextosControl> {
  return {
    [SETTING_KEYS.tone]: {
      titulo: tr("control.tonoTitulo"),
      ayuda: tr("control.tonoAyuda"),
      opciones: {
        "cálido y cercano": { label: tr("control.tonoCalido"), desc: tr("control.tonoCalidoDesc") },
        "formal y profesional": { label: tr("control.tonoFormal"), desc: tr("control.tonoFormalDesc") },
        "divertido y relajado": {
          label: tr("control.tonoDivertido"),
          desc: tr("control.tonoDivertidoDesc"),
        },
      },
    },
    [SETTING_KEYS.bufferSeconds]: {
      titulo: tr("control.velocidadTitulo"),
      ayuda: tr("control.velocidadAyuda"),
      opciones: {
        "5": { label: tr("control.velocidadRapido"), desc: tr("control.velocidadRapidoDesc") },
        "15": { label: tr("control.velocidadNormal"), desc: tr("control.velocidadNormalDesc") },
        "30": { label: tr("control.velocidadPausado"), desc: tr("control.velocidadPausadoDesc") },
      },
    },
    [SETTING_KEYS.maxChunks]: {
      titulo: tr("control.estiloTitulo"),
      ayuda: tr("control.estiloAyuda"),
      opciones: {
        "1": { label: tr("control.estiloUno"), desc: tr("control.estiloUnoDesc") },
        "3": { label: tr("control.estiloPocos"), desc: tr("control.estiloPocosDesc") },
        "5": { label: tr("control.estiloVarios"), desc: tr("control.estiloVariosDesc") },
      },
    },
    [SETTING_KEYS.modelOverride]: {
      titulo: tr("control.cerebroTitulo"),
      ayuda: tr("control.cerebroAyuda"),
      opciones: {
        haiku: { label: tr("control.cerebroEconomico"), desc: tr("control.cerebroEconomicoDesc") },
        auto: {
          label: tr("control.cerebroEquilibrado"),
          desc: tr("control.cerebroEquilibradoDesc"),
        },
        sonnet: { label: tr("control.cerebroMaximo"), desc: tr("control.cerebroMaximoDesc") },
      },
    },
    [SETTING_KEYS.botPaused]: {
      titulo: tr("control.estadoTitulo"),
      ayuda: tr("control.estadoAyuda"),
      opciones: {
        "0": { label: tr("control.estadoActivo"), desc: tr("control.estadoActivoDesc") },
        "1": { label: tr("control.estadoPausa"), desc: tr("control.estadoPausaDesc") },
      },
    },
    [SETTING_KEYS.takeoverMinutes]: {
      titulo: tr("control.takeoverTitulo"),
      ayuda: tr("control.takeoverAyuda"),
      opciones: {
        "60": { label: tr("control.takeover1h"), desc: tr("control.takeover1hDesc") },
        "180": { label: tr("control.takeover3h"), desc: tr("control.takeover3hDesc") },
        "0": { label: tr("control.takeoverManual"), desc: tr("control.takeoverManualDesc") },
      },
    },
  };
}

/** Render one card group (radio cards) for a level-based control. */
function renderCardGroup(
  control: ControlDef,
  settings: Record<string, string>,
  textos?: TextosControl,
): string {
  const currentLevel = valueToLevel(control.key, settings[control.key]);
  const cards = control.options
    .map((opt) => {
      const id = `${control.key}__${opt.value}`;
      const checked = opt.label === currentLevel ? "checked" : "";
      const texto = textos?.opciones[opt.value];
      return `
        <div class="relative">
          <input type="radio" id="${esc(id)}" name="${esc(control.key)}" value="${esc(opt.value)}"
                 class="peer sr-only absolute" ${checked}>
          <label for="${esc(id)}" class="${CARD_BASE}">
            <span class="card-icon text-dim">${opt.svg}</span>
            <span class="card-label font-display font-semibold text-[12.5px] text-cream">${esc(texto?.label ?? opt.label)}</span>
            <span class="text-dim text-[11px] leading-snug">${esc(texto?.desc ?? opt.desc)}</span>
          </label>
        </div>`;
    })
    .join("");
  return `
    <fieldset style="display:flex;flex-direction:column;gap:8px">
      <legend class="font-display font-semibold text-[13.5px] text-cream">${esc(textos?.titulo ?? control.title)}</legend>
      <p class="text-muted text-[12px]">${esc(textos?.ayuda ?? control.help)}</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">${cards}</div>
    </fieldset>`;
}

const INPUT_STYLE =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%";

/** Render a labeled single-line text field. */
function renderTextField(opts: {
  name: string;
  label: string;
  help: string;
  value: string;
  placeholder?: string;
}): string {
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label for="${esc(opts.name)}" class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</label>
      <p class="text-dim text-[11px]">${esc(opts.help)}</p>
      <input type="text" id="${esc(opts.name)}" name="${esc(opts.name)}"
             value="${esc(opts.value)}" placeholder="${esc(opts.placeholder ?? "")}"
             style="${INPUT_STYLE}">
    </div>`;
}

/** Render a labeled multi-line textarea. */
function renderTextArea(opts: {
  name: string;
  label: string;
  help: string;
  value: string;
  placeholder?: string;
  rows?: number;
}): string {
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label for="${esc(opts.name)}" class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</label>
      <p class="text-dim text-[11px]">${esc(opts.help)}</p>
      <textarea id="${esc(opts.name)}" name="${esc(opts.name)}" rows="${opts.rows ?? 4}"
                placeholder="${esc(opts.placeholder ?? "")}"
                style="${INPUT_STYLE};resize:vertical">${esc(opts.value)}</textarea>
    </div>`;
}

const SELECT_STYLE =
  "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:12.5px;outline:none;width:100%";

/** Sección "Modelo de IA": proveedor + API key propia + modelo concreto. */
function renderLlmSection(
  settings: Record<string, string>,
  llmTest: string | undefined,
  tr: Traductor,
): string {
  const provider = settings[SETTING_KEYS.llmProvider] ?? "";
  const model = settings[SETTING_KEYS.llmModel] ?? "";
  const hasKey = (settings[SETTING_KEYS.llmApiKey] ?? "").trim() !== "";
  const keyTail = hasKey ? (settings[SETTING_KEYS.llmApiKey] ?? "").trim().slice(-4) : "";

  const providerOpts = [
    { v: "", l: esc(tr("config.llmProveedorAuto")) },
    { v: "anthropic", l: "Claude (Anthropic)" },
    { v: "openai", l: "ChatGPT (OpenAI)" },
    { v: "xai", l: "Grok (xAI)" },
    { v: "google", l: "Gemini (Google)" },
  ]
    .map((o) => `<option value="${o.v}" ${provider === o.v ? "selected" : ""}>${o.l}</option>`)
    .join("");

  const anthropicOpts = CURATED_MODELS.filter((m) => m.provider === "anthropic")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.nombre)} · ${esc(tr(m.desc as never))}</option>`)
    .join("");
  const openaiOpts = CURATED_MODELS.filter((m) => m.provider === "openai")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.nombre)} · ${esc(tr(m.desc as never))}</option>`)
    .join("");
  const xaiOpts = CURATED_MODELS.filter((m) => m.provider === "xai")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.nombre)} · ${esc(tr(m.desc as never))}</option>`)
    .join("");
  const googleOpts = CURATED_MODELS.filter((m) => m.provider === "google")
    .map((m) => `<option value="${esc(m.id)}" ${model === m.id ? "selected" : ""}>${esc(m.nombre)} · ${esc(tr(m.desc as never))}</option>`)
    .join("");

  let testBanner = "";
  if (llmTest?.startsWith("ok:")) {
    testBanner = `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);padding:10px 13px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px">${esc(tr("config.llmPruebaOk"))} ${esc(llmTest.slice(3))}</div>`;
  } else if (llmTest?.startsWith("err:")) {
    testBanner = `<div style="border:1px solid var(--danger,#e0654d);background:rgba(224,101,77,.1);color:var(--danger,#e0654d);padding:10px 13px;font-size:12px;font-weight:600;display:flex;flex-direction:column;gap:4px"><span>${esc(tr("config.llmPruebaFallida"))} ${esc(llmTest.slice(4, 320))}</span><span style="font-weight:400;opacity:.85">${esc(tr("config.llmPruebaFallidaAyuda"))}</span></div>`;
  }

  // Estado activo actual — para que de un vistazo sepas qué IA está corriendo.
  const auto = tr("config.llmAutoCorto");
  const provLabel: Record<string, string> = {
    "": auto,
    anthropic: "Claude (Anthropic)",
    openai: "ChatGPT (OpenAI)",
    xai: "Grok (xAI)",
    google: "Gemini (Google)",
  };
  const curProv = provLabel[provider] ?? auto;
  const encontrado = model ? CURATED_MODELS.find((m) => m.id === model) : undefined;
  const curModel = encontrado ? `${encontrado.nombre} · ${tr(encontrado.desc as never)}` : (model || auto);
  const curKeySrc = hasKey
    ? `${esc(tr("config.llmTuKey"))} ····${esc(keyTail)}`
    : esc(tr("config.llmKeySistema"));

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:3px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">${esc(tr("config.llmTitulo"))}</h3>
        <p class="text-dim text-[12px]">${tr("config.llmIntro")}</p>
      </div>

      <!-- Para qué se usa esta IA -->
      <div style="border:1px solid var(--line);background:var(--panel2);padding:11px 13px;display:flex;flex-direction:column;gap:6px">
        <span class="text-cream text-[11.5px]" style="font-weight:600">${esc(tr("config.llmUsosTitulo"))}</span>
        <ul class="text-dim text-[11px]" style="display:flex;flex-direction:column;gap:3px;margin:0;padding-left:16px;list-style:disc">
          <li>${tr("config.llmUsoMensajes")}</li>
          <li>${tr("config.llmUsoInsights")}</li>
          <li>${tr("config.llmUsoExtras")}</li>
        </ul>
        <span class="text-dim text-[10.5px] leading-snug">${tr("config.llmUsoNota")}</span>
      </div>

      <!-- Estado activo -->
      <div style="display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:var(--panel2);padding:9px 12px;font-size:11.5px">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--ok);flex:none"></span>
        <span class="text-dim">${esc(tr("config.llmEstadoAhora"))}</span>
        <span class="text-cream" style="font-weight:600">${esc(curProv)}</span>
        <span class="text-dim">·</span>
        <span class="text-cream">${esc(curModel)}</span>
        <span class="text-dim">·</span>
        <span class="text-cream">${curKeySrc}</span>
      </div>

      ${testBanner}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="font-display font-semibold text-[12.5px] text-cream">${esc(tr("config.llmProveedorLabel"))}</label>
          <select name="${SETTING_KEYS.llmProvider}" style="${SELECT_STYLE}">${providerOpts}</select>
          <p class="text-dim text-[10.5px] leading-snug">${tr("config.llmProveedorAyuda")}</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <label class="font-display font-semibold text-[12.5px] text-cream">${esc(tr("config.llmModeloLabel"))}</label>
          <select name="${SETTING_KEYS.llmModel}" style="${SELECT_STYLE}">
            <option value="" ${model === "" ? "selected" : ""}>${esc(tr("config.llmModeloAuto"))}</option>
            <optgroup label="Claude (Anthropic)">${anthropicOpts}</optgroup>
            <optgroup label="ChatGPT (OpenAI)">${openaiOpts}</optgroup>
            <optgroup label="Grok (xAI)">${xaiOpts}</optgroup>
            <optgroup label="Gemini (Google)">${googleOpts}</optgroup>
          </select>
          <p class="text-dim text-[10.5px] leading-snug">${esc(tr("config.llmModeloAyuda"))}</p>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <label class="font-display font-semibold text-[12.5px] text-cream">${tr("config.llmApiKeyLabel")}</label>
        <p class="text-dim text-[11px]">${hasKey ? `${esc(tr("config.llmKeyGuardadaPre"))}${esc(keyTail)}${esc(tr("config.llmKeyGuardadaPost"))}` : esc(tr("config.llmApiKeyAyuda"))}</p>
        <input type="password" name="${SETTING_KEYS.llmApiKey}" value="" autocomplete="off"
               placeholder="${hasKey ? "••••••••••••" : "sk-ant-…  ·  sk-…  ·  xai-…  ·  AIza…"}" style="${INPUT_STYLE}">
        ${hasKey ? `<label class="text-dim text-[11.5px]" style="display:flex;align-items:center;gap:7px;cursor:pointer"><input type="checkbox" name="llm_api_key_clear" value="1"> ${esc(tr("config.llmQuitarKey"))}</label>` : ""}
      </div>

      <div style="display:flex;flex-direction:column;gap:7px">
        <button type="submit" formmethod="post" formaction="/admin/config/llm-test" class="bigbtn font-display font-bold text-[12.5px] cursor-pointer" style="width:fit-content">
          ${esc(tr("config.llmProbar"))}
        </button>
        <p class="text-dim text-[11px]">${tr("config.llmProbarAyuda")}</p>
      </div>
    </div>`;
}

/** Un toggle (checkbox) de superpoder con etiqueta + descripción. */
function renderToggle(opts: {
  name: string;
  label: string;
  desc: string;
  checked: boolean;
  note?: string;
}): string {
  return `
    <label style="display:flex;gap:11px;align-items:flex-start;cursor:pointer;border:1px solid var(--line);background:var(--panel2);padding:13px 14px">
      <input type="checkbox" name="${esc(opts.name)}" value="1" ${opts.checked ? "checked" : ""}
             style="margin-top:3px;width:16px;height:16px;flex:none;accent-color:var(--accent)">
      <span style="display:flex;flex-direction:column;gap:2px">
        <span class="font-display font-semibold text-[12.5px] text-cream">${esc(opts.label)}</span>
        <span class="text-dim text-[11px] leading-snug">${esc(opts.desc)}</span>
        ${opts.note ? `<span class="text-accent2 text-[10.5px]" style="margin-top:2px">${esc(opts.note)}</span>` : ""}
      </span>
    </label>`;
}

/** Sección "Superpoderes Forja+": los interruptores de los superpoderes de
 *  seguimiento. Solo Pro. Cobros/Reseñas muestran su requisito de conexión.
 *  El Cazador es default-ON (se apaga con "0"); el resto es opt-in ("1"). */
function renderSuperpoderesSection(env: Env, settings: Record<string, string>): string {
  const tr = traductor(env);
  const on = (k: string) => settings[k] === "1";
  const stripeOk = stripeConfigured(env);
  // Estado REAL (para que ningún toggle mienta): un superpoder puede estar
  // encendido pero no funcionar por falta de un prerequisito.
  const notify = handoffNotifyStatus(env); // canal para avisarte (Telegram/WhatsApp/correo)
  const reportOk =
    Boolean(env.RESEND_API_KEY && env.OWNER_EMAIL) ||
    Boolean(env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID);
  const reviewOk = (settings[SETTING_KEYS.reviewUrl] ?? "").trim() !== "";
  const mediaOk = !!env.MEDIA; // Bóveda: ¿el R2 ya está provisionado? (skill /boveda)
  const waTemplateOk =
    (settings[SETTING_KEYS.reengageTemplateSid] ?? "").trim() !== "" ||
    (settings[SETTING_KEYS.reengageTemplateName] ?? "").trim() !== "";
  const blindajeOn = (settings[SETTING_KEYS.blindajeEnabled] ?? "") !== "off";
  const voiceCustom =
    (settings[SETTING_KEYS.brandVoice] ?? "").trim() !== "" ||
    (settings[SETTING_KEYS.tone] ?? "").trim() !== "";

  // Fila read-only de un superpoder automático (sin switch): punto verde/gris + estado.
  const statusRow = (label: string, ok: boolean, detail: string): string => `
    <div style="display:flex;align-items:flex-start;gap:9px;border:1px solid var(--line);background:var(--bg);padding:11px 13px">
      <span style="width:8px;height:8px;flex:none;margin-top:5px;border-radius:50%;background:${ok ? "var(--ok)" : "var(--dim)"}"></span>
      <span style="min-width:0">
        <span class="text-cream" style="font-size:12.5px;display:block">${label}</span>
        <span class="${ok ? "text-muted" : "text-dim"}" style="font-size:11px;line-height:1.4">${detail}</span>
      </span>
    </div>`;

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:16px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">${esc(tr("config.superTitulo"))}</h3>
        <p class="text-dim text-[12px]">${esc(tr("config.superIntro"))}</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
        ${renderToggle({
          name: SETTING_KEYS.dailyReport,
          label: esc(tr("config.superReportes")),
          desc: esc(tr("config.superReportesDesc")),
          checked: on(SETTING_KEYS.dailyReport),
          note: reportOk ? esc(tr("config.superReportesOk")) : esc(tr("config.superReportesFalta")),
        })}
        ${renderToggle({
          name: SETTING_KEYS.multiLanguage,
          label: esc(tr("config.superMultiIdioma")),
          desc: esc(tr("config.superMultiIdiomaDesc")),
          checked: on(SETTING_KEYS.multiLanguage),
        })}
        ${renderToggle({
          name: SETTING_KEYS.satisfactionSurvey,
          label: esc(tr("config.superEncuestas")),
          desc: esc(tr("config.superEncuestasDesc")),
          checked: on(SETTING_KEYS.satisfactionSurvey),
        })}
        ${renderToggle({
          name: SETTING_KEYS.reengageColdLeads,
          label: esc(tr("config.superRecuperaNoShows")),
          desc: esc(tr("config.superRecuperaNoShowsDesc")),
          checked: on(SETTING_KEYS.reengageColdLeads),
          note: waTemplateOk
            ? esc(tr("config.superPlantillaOk"))
            : esc(tr("config.superPlantillaFalta")),
        })}
        ${renderToggle({
          name: SETTING_KEYS.salesHunter,
          label: esc(tr("config.superCazador")),
          desc: esc(tr("config.superCazadorDesc")),
          checked: settings[SETTING_KEYS.salesHunter] !== "0",
        })}
        ${renderToggle({
          name: SETTING_KEYS.reviewRequests,
          label: esc(tr("config.superResenas")),
          desc: esc(tr("config.superResenasDesc")),
          checked: on(SETTING_KEYS.reviewRequests),
          note: reviewOk ? esc(tr("config.superResenasOk")) : esc(tr("config.superResenasFalta")),
        })}
        ${renderToggle({
          name: SETTING_KEYS.paymentsEnabled,
          label: esc(tr("config.superCobros")),
          desc: esc(tr("config.superCobrosDesc")),
          checked: on(SETTING_KEYS.paymentsEnabled),
          note: stripeOk ? esc(tr("config.superCobrosOk")) : esc(tr("config.superCobrosFalta")),
        })}
        ${renderToggle({
          name: SETTING_KEYS.bovedaEnabled,
          label: esc(tr("config.superBoveda")),
          desc: esc(tr("config.superBovedaDesc")),
          checked: on(SETTING_KEYS.bovedaEnabled),
          note: mediaOk ? esc(tr("config.superBovedaOk")) : esc(tr("config.superBovedaFalta")),
        })}
      </div>
      ${renderTextField({
        name: SETTING_KEYS.reviewUrl,
        label: esc(tr("config.superResenasLinkLabel")),
        help: esc(tr("config.superResenasLinkAyuda")),
        value: settings[SETTING_KEYS.reviewUrl] ?? "",
        placeholder: "https://g.page/r/tu-negocio/review",
      })}
      ${renderTextField({
        name: SETTING_KEYS.reengageTemplateSid,
        label: esc(tr("config.superPlantillaLabel")),
        help: esc(tr("config.superPlantillaAyuda")),
        value: settings[SETTING_KEYS.reengageTemplateSid] ?? "",
        placeholder: "HX…",
      })}
      ${renderSurveyMode(settings, tr)}
      ${renderReportFormat(settings, tr)}

      <div style="border-top:1px solid var(--line);padding-top:15px">
        <p class="text-dim" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 4px">${esc(tr("config.superAutomaticosTitulo"))}</p>
        <p class="text-dim text-[11.5px]" style="margin:0 0 12px;line-height:1.5">${esc(tr("config.superAutomaticosAyuda"))}</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
          ${statusRow(esc(tr("config.superBlindaje")), blindajeOn, blindajeOn ? esc(tr("config.superBlindajeOk")) : esc(tr("config.superBlindajeOff")))}
          ${statusRow(esc(tr("config.superVigilante")), notify.ok, notify.ok ? `${esc(tr("config.superAvisaPor"))} ${notify.channels.join(" / ")}` : esc(tr("config.superSinCanalAviso")))}
          ${statusRow(esc(tr("config.superHandoff")), notify.ok, notify.ok ? `${esc(tr("config.superPasaHumanoPor"))} ${notify.channels.join(" / ")}` : esc(tr("config.superSinCanalAviso")))}
          ${statusRow(esc(tr("config.superOidoVista")), true, esc(tr("config.superOidoVistaDetalle")))}
          ${statusRow(esc(tr("config.superVozMarca")), voiceCustom, voiceCustom ? esc(tr("config.superVozMarcaOk")) : esc(tr("config.superVozMarcaOff")))}
        </div>
      </div>
    </div>`;
}

/** Cómo pide la encuesta de satisfacción: número, opinión abierta o ambas. */
function renderSurveyMode(settings: Record<string, string>, tr: Traductor): string {
  const cur = settings[SETTING_KEYS.surveyMode] || "numerico";
  const opt = (v: string, label: string): string =>
    `<option value="${v}" ${cur === v ? "selected" : ""}>${label}</option>`;
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="text-cream text-[13px] font-medium">${esc(tr("config.encuestaModoLabel"))}</label>
      <select name="${SETTING_KEYS.surveyMode}" style="${SELECT_STYLE}">
        ${opt("numerico", esc(tr("config.encuestaModoNumerico")))}
        ${opt("abierto", esc(tr("config.encuestaModoAbierto")))}
        ${opt("ambos", esc(tr("config.encuestaModoAmbos")))}
      </select>
      <p class="text-dim text-[11.5px]" style="line-height:1.5">${tr("config.encuestaModoAyuda")}</p>
    </div>`;
}

/** Selector de formato del reporte diario, con los requisitos de cada opción. */
function renderReportFormat(settings: Record<string, string>, tr: Traductor): string {
  const cur = settings[SETTING_KEYS.reportFormat] || "html";
  const opt = (v: string, label: string): string =>
    `<option value="${v}" ${cur === v ? "selected" : ""}>${label}</option>`;
  return `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label class="text-cream text-[13px] font-medium">${esc(tr("config.reporteFormatoLabel"))}</label>
      <select name="${SETTING_KEYS.reportFormat}" style="${SELECT_STYLE}">
        ${opt("html", esc(tr("config.reporteFormatoHtml")))}
        ${opt("docx", esc(tr("config.reporteFormatoDocx")))}
        ${opt("pdf", esc(tr("config.reporteFormatoPdf")))}
      </select>
      <p class="text-dim text-[11.5px]" style="line-height:1.5">${tr("config.reporteFormatoAyuda")}</p>
    </div>`;
}

/**
 * Render the Config tab. Receives the current settings overlay (Record from
 * SettingsRepo.all()). `saved` shows the "Guardado ✓" confirmation banner after
 * a redirect from POST /admin/config?saved=1.
 */

/**
 * Idioma y moneda. Va FUERA de la sección Pro a propósito: un negocio en
 * España necesita hablar español de España y cobrar en euros desde el primer
 * día, no cuando pague. Lo único Pro es "espejar" el idioma del cliente, que
 * era el superpoder Multi-idioma.
 *
 * Es UN solo selector de idioma, no dos controles: antes existía el toggle
 * Multi-idioma por separado y habría contradicho a este.
 */
// ── Login (white-label): los textos de la pantalla de entrada e invitaciones ──
// Vacío = default del idioma. Logo, nombre y color vienen de las BRAND_* del
// wrangler.toml (skill /whitelabel); aquí solo el COPY, editable sin redeploy.
function renderLoginSection(env: Env, settings: Record<string, string>): string {
  const tr = traductor(env);
  const campo = (key: string, label: string, ph: string, multi = false) => `
    <label style="display:flex;flex-direction:column;gap:5px">
      <span class="text-dim text-[11.5px]" style="letter-spacing:.04em;text-transform:uppercase;font-weight:700">${esc(label)}</span>
      ${multi
        ? `<textarea name="${key}" rows="2" placeholder="${esc(ph)}" style="${INPUT_STYLE};resize:vertical">${esc(settings[key] ?? "")}</textarea>`
        : `<input name="${key}" value="${esc(settings[key] ?? "")}" placeholder="${esc(ph)}" maxlength="160" style="${INPUT_STYLE}">`}
    </label>`;
  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <div style="font-family:'Space Grotesk';font-weight:700;font-size:14px">${esc(tr("config.loginTitulo"))}</div>
        <div class="text-muted" style="font-size:12px;line-height:1.5">${esc(tr("config.loginSub"))}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
        ${campo(SETTING_KEYS.loginTitulo, tr("config.loginCampoTitulo"), tr("equipo.loginTitulo"))}
        ${campo(SETTING_KEYS.loginBoton, tr("config.loginCampoBoton"), tr("equipo.entrar"))}
        ${campo(SETTING_KEYS.loginSub, tr("config.loginCampoSub"), tr("equipo.loginSub"))}
        ${campo(SETTING_KEYS.loginFrase, tr("config.loginCampoFrase"), tr("equipo.brandTitulo"))}
      </div>
      ${campo(SETTING_KEYS.loginPie, tr("config.loginCampoPie"), tr("equipo.loginMaster"), true)}
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="/admin/login?preview=1" target="_blank" class="text-accent2" style="font-size:12.5px">${esc(tr("config.loginPreview"))} ↗</a>
        <span class="text-dim" style="font-size:11.5px">${esc(tr("config.loginNota"))}</span>
      </div>
    </div>`;
}

function renderIdiomaSection(env: Env, settings: Record<string, string>): string {
  const tr = traductor(env);
  const actual = settings[SETTING_KEYS.botLanguage] || "";
  const moneda = settings[SETTING_KEYS.botCurrency] || "";
  const panel = settings[SETTING_KEYS.panelLanguage] || "";

  const opciones = Object.entries(IDIOMAS)
    .map(
      ([codigo, def]) =>
        `<option value="${esc(codigo)}"${actual === codigo ? " selected" : ""}>${esc(def.etiqueta)}</option>`,
    )
    .join("");

  const espejo = isPro(env)
    ? `<option value="espejo"${actual === "espejo" ? " selected" : ""}>${esc(tr("config.idiomaEspejo"))}</option>`
    : "";

  // Sin ajuste guardado, el bot sigue con el idioma que trae su wrangler.toml.
  const heredado = `<option value=""${actual === "" ? " selected" : ""}>${esc(tr("config.idiomaHeredado"))} (${esc(env.BOT_LANGUAGE || "es-MX")})</option>`;

  const monedas = ["$", "€", "R$", "£", "S/", "₡", "Bs", "COP$", "CLP$", "ARS$"]
    .map((m) => `<option value="${esc(m)}"${moneda === m ? " selected" : ""}>${esc(m)}</option>`)
    .join("");

  return `
    <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <h3 class="font-display font-semibold text-[13.5px] text-cream">${esc(tr("config.idiomaSeccion"))}</h3>
        <p class="text-muted text-[12px]">${esc(tr("config.idiomaAyuda"))}</p>
      </div>

      <label style="display:flex;flex-direction:column;gap:6px">
        <span class="text-cream text-[12.5px] font-semibold">${esc(tr("config.idiomaBot"))}</span>
        <select name="${SETTING_KEYS.botLanguage}" class="border border-line bg-bg text-cream" style="padding:9px 11px;font-size:13px">
          ${heredado}${opciones}${espejo}
        </select>
        <span class="text-dim text-[11.5px]">${esc(tr("config.idiomaBotAyuda"))}${
          isPro(env) ? "" : " " + esc(tr("config.idiomaBotEspejoPro"))
        }</span>
      </label>

      <label style="display:flex;flex-direction:column;gap:6px">
        <span class="text-cream text-[12.5px] font-semibold">${esc(tr("config.idiomaPanel"))}</span>
        <select name="${SETTING_KEYS.panelLanguage}" class="border border-line bg-bg text-cream" style="padding:9px 11px;font-size:13px">
          <option value=""${panel === "" ? " selected" : ""}>${esc(tr("config.idiomaHeredado"))}</option>
          ${Object.entries(LOCALES_PANEL)
            .map(([c, n]) => `<option value="${esc(c)}"${panel === c ? " selected" : ""}>${esc(n)}</option>`)
            .join("")}
        </select>
        <span class="text-dim text-[11.5px]">${esc(tr("config.idiomaPanelAyuda"))}</span>
      </label>

      <label style="display:flex;flex-direction:column;gap:6px">
        <span class="text-cream text-[12.5px] font-semibold">${esc(tr("config.moneda"))}</span>
        <select name="${SETTING_KEYS.botCurrency}" class="border border-line bg-bg text-cream" style="padding:9px 11px;font-size:13px">
          <option value=""${moneda === "" ? " selected" : ""}>${esc(tr("config.monedaSinEspecificar"))}</option>
          ${monedas}
        </select>
        <span class="text-dim text-[11.5px]">${esc(tr("config.monedaAyuda"))}</span>
      </label>
    </div>`;
}

export function renderConfig(
  env: Env,
  settings: Record<string, string>,
  saved = false,
  llmTest?: string,
): string {
  const tr = traductor(env);
  const textos = textosControles(tr);
  const cardGroups = CONTROL_LIST.map((c) => renderCardGroup(c, settings, textos[c.key])).join("");

  const savedBanner = saved
    ? `<div style="border:1px solid var(--ok);background:rgba(127,183,126,.1);color:var(--ok);padding:10px 14px;font-size:12.5px;font-weight:600">${esc(tr("comun.guardado"))}</div>`
    : "";

  const body = `
    <form method="POST" action="/admin/config" style="display:flex;flex-direction:column;gap:28px">
      ${savedBanner}

      <div style="display:flex;flex-direction:column;gap:2px">
        <h2 class="font-display font-semibold text-[15px] text-cream">${esc(tr("config.panelTitulo"))} ${esc(env.BUSINESS_NAME)}</h2>
        <p class="text-muted text-[12.5px]">${esc(tr("config.panelIntro"))}</p>
      </div>

      <!-- Idioma y moneda — gratis; solo "espejar" es Pro.
           Va PRIMERO a propósito: estaba al final y los dueños no la
           encontraban ("no veo dónde se cambia el idioma", 29-jul-2026).
           Además es la config más de fondo — decide en qué idioma lee el
           dueño todo lo que sigue. -->
      ${renderIdiomaSection(env, settings)}
      ${renderLoginSection(env, settings)}

      <!-- Card-based controls (tono, velocidad, estilo, cerebro, estado) -->
      <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:22px">
        ${cardGroups}
      </div>

      <!-- Superpoderes Forja+ (toggles) — solo Pro -->
      ${isPro(env) ? renderSuperpoderesSection(env, settings) : ""}

      <!-- Modelo de IA (BYO provider/key/model) -->
      ${renderLlmSection(settings, llmTest, tr)}

      <!-- Free-text settings -->
      <div class="bg-panel border border-line" style="padding:20px;display:flex;flex-direction:column;gap:18px">
        ${renderTextField({
          name: SETTING_KEYS.botName,
          label: esc(tr("config.botNombreLabel")),
          help: esc(tr("config.botNombreAyuda")),
          value: settings[SETTING_KEYS.botName] ?? "",
          placeholder: env.BOT_NAME ?? esc(tr("config.botNombrePlaceholder")),
        })}

        ${renderTextArea({
          name: SETTING_KEYS.businessContext,
          label: esc(tr("config.negocioInfoLabel")),
          help: esc(tr("config.negocioInfoAyuda")),
          // Pre-llenado: si el panel aún no tiene override, muestra lo que el
          // onboarding cargó en member/config.local (renderBusinessContext) para
          // que el miembro VEA y edite sus horarios aquí desde el día 1.
          value: settings[SETTING_KEYS.businessContext] || renderBusinessContext(),
          placeholder: esc(tr("config.negocioInfoPlaceholder")),
          rows: 6,
        })}

        ${renderTextArea({
          name: SETTING_KEYS.systemPromptOverride,
          label: esc(tr("config.instruccionesLabel")),
          help: esc(tr("config.instruccionesAyuda")),
          value: settings[SETTING_KEYS.systemPromptOverride] ?? "",
          placeholder: esc(tr("config.instruccionesPlaceholder")),
          rows: 4,
        })}

        ${renderTextField({
          name: SETTING_KEYS.escalationKeywords,
          label: esc(tr("config.escalacionLabel")),
          help: esc(tr("config.escalacionAyuda")),
          value: settings[SETTING_KEYS.escalationKeywords] ?? "",
          placeholder: esc(tr("config.escalacionPlaceholder")),
        })}
      </div>

      <button type="submit" class="bigbtn font-display font-bold text-[13px] cursor-pointer"
              style="width:fit-content;background:var(--accent);border:1px solid var(--accent);color:#1a1206;box-shadow:4px 4px 0 var(--linelit);padding:13px 24px;display:flex;align-items:center;gap:9px">
        <i data-lucide="check" width="16" height="16"></i> ${esc(tr("comun.guardar"))}
      </button>
    </form>`;

  return layout({ title: esc(tr("nav.config")), activeTab: "config", body, env });
}
