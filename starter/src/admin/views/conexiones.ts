// "Conexiones" tab — el mapa de canales del bot. Cada canal es una card con
// estado VERDE (conectado) o gris (sin conectar), qué falta exactamente para
// conectarlo, y su webhook URL lista para copiar. Es la vista que guía el
// paso 4 del onboarding (CLAUDE.md): conectar canales uno por uno y verlos
// ponerse verdes.
import type { Env } from "../../env";
import { traductor } from "../i18n";
import { layout, renderConfigPrompt } from "./layout";
import { selfOriginFromRequest } from "../../lib/self-origin";

interface ChannelStatus {
  id: string;
  name: string;
  icon: string; // lucide icon name
  desc: string;
  ok: boolean;
  /** Piezas faltantes (nombre de secret/var) cuando NO está conectado. */
  missing: string[];
  /** Ruta del webhook a registrar en el proveedor (si aplica). */
  webhookPath?: string;
  /** Nota de seguridad opcional (ej. secret del webhook sin configurar). */
  securityNote?: string;
  /** Cómo conectar, en 1-2 líneas. */
  howTo: string;
}

export function channelStatuses(env: Env): ChannelStatus[] {
  const tr = traductor(env);
  const has = (v?: string) => Boolean(v && v.trim() !== "");

  const telegramMissing = [!has(env.TELEGRAM_BOT_TOKEN) && "TELEGRAM_BOT_TOKEN"].filter(
    Boolean,
  ) as string[];
  const twilioMissing = [
    !has(env.TWILIO_ACCOUNT_SID) && "TWILIO_ACCOUNT_SID",
    !has(env.TWILIO_AUTH_TOKEN) && "TWILIO_AUTH_TOKEN",
    !has(env.TWILIO_WA_FROM) && "TWILIO_WA_FROM",
  ].filter(Boolean) as string[];
  const metaMissing = [
    !has(env.META_PAGE_ACCESS_TOKEN) && "META_PAGE_ACCESS_TOKEN",
    !has(env.META_VERIFY_TOKEN) && "META_VERIFY_TOKEN",
    !has(env.META_APP_SECRET) && "META_APP_SECRET",
  ].filter(Boolean) as string[];
  const manychatMissing = [!has(env.MANYCHAT_API_KEY) && "MANYCHAT_API_KEY"].filter(
    Boolean,
  ) as string[];
  const whatsappCloudMissing = [
    !has(env.WHATSAPP_PHONE_NUMBER_ID) && "WHATSAPP_PHONE_NUMBER_ID",
    !has(env.WHATSAPP_ACCESS_TOKEN) && "WHATSAPP_ACCESS_TOKEN",
    !has(env.WHATSAPP_VERIFY_TOKEN || env.META_VERIFY_TOKEN) && "WHATSAPP_VERIFY_TOKEN",
    !has(env.WHATSAPP_APP_SECRET || env.META_APP_SECRET) && "WHATSAPP_APP_SECRET",
  ].filter(Boolean) as string[];
  const kapsoMissing = [
    !has(env.KAPSO_API_KEY) && "KAPSO_API_KEY",
    !has(env.KAPSO_PHONE_NUMBER_ID) && "KAPSO_PHONE_NUMBER_ID",
    !has(env.KAPSO_WEBHOOK_SECRET) && "KAPSO_WEBHOOK_SECRET",
  ].filter(Boolean) as string[];
  const ycloudMissing = [
    !has(env.YCLOUD_API_KEY) && "YCLOUD_API_KEY",
    !has(env.YCLOUD_WA_FROM) && "YCLOUD_WA_FROM",
    !has(env.YCLOUD_WEBHOOK_SECRET) && "YCLOUD_WEBHOOK_SECRET",
  ].filter(Boolean) as string[];
  const zernioMissing = [
    !has(env.ZERNIO_API_KEY) && "ZERNIO_API_KEY",
    !has(env.ZERNIO_WEBHOOK_SECRET) && "ZERNIO_WEBHOOK_SECRET",
  ].filter(Boolean) as string[];

  const webSitios = (env.WEB_SITES ?? "").split(",").map((x) => x.trim()).filter(Boolean);

  return [
    {
      id: "web",
      name: tr("conexiones.canalWebNombre"),
      icon: "globe",
      desc: tr("conexiones.canalWebDesc"),
      ok: webSitios.length > 0,
      missing: webSitios.length === 0 ? ["WEB_SITES"] : [],
      howTo:
        webSitios.length > 0
          ? `${tr("conexiones.canalWebActivoEn")} ${webSitios.join(", ")}. ${tr("conexiones.canalWebPegaScriptAbajo")}`
          : tr("conexiones.canalWebComoConectar"),
    },
    {
      id: "telegram",
      name: "Telegram",
      icon: "send",
      desc: tr("conexiones.canalTelegramDesc"),
      ok: telegramMissing.length === 0,
      missing: telegramMissing,
      webhookPath: "/webhooks/telegram",
      howTo: tr("conexiones.canalTelegramComoConectar"),
    },
    {
      id: "whatsapp",
      name: "WhatsApp (Twilio)",
      icon: "phone",
      desc: tr("conexiones.canalTwilioDesc"),
      ok: twilioMissing.length === 0,
      missing: twilioMissing,
      webhookPath: "/webhooks/twilio",
      securityNote:
        twilioMissing.length === 0 && !has(env.TWILIO_HANDOFF_CONTENT_SID)
          ? tr("conexiones.canalTwilioNotaHandoff")
          : undefined,
      howTo: tr("conexiones.canalTwilioComoConectar"),
    },
    {
      id: "whatsapp-cloud",
      name: tr("conexiones.canalWhatsappCloudNombre"),
      icon: "message-circle",
      desc: tr("conexiones.canalWhatsappCloudDesc"),
      ok: whatsappCloudMissing.length === 0,
      missing: whatsappCloudMissing,
      webhookPath: "/webhooks/whatsapp",
      howTo: tr("conexiones.canalWhatsappCloudComoConectar"),
    },
    {
      id: "kapso",
      name: tr("conexiones.canalKapsoNombre"),
      icon: "message-circle",
      desc: tr("conexiones.canalKapsoDesc"),
      ok: kapsoMissing.length === 0,
      missing: kapsoMissing,
      webhookPath: "/webhooks/kapso",
      howTo: tr("conexiones.canalKapsoComoConectar"),
    },
    {
      id: "ycloud",
      name: tr("conexiones.canalYcloudNombre"),
      icon: "message-circle",
      desc: tr("conexiones.canalYcloudDesc"),
      ok: ycloudMissing.length === 0,
      missing: ycloudMissing,
      webhookPath: "/webhooks/ycloud",
      howTo: tr("conexiones.canalYcloudComoConectar"),
    },
    {
      id: "zernio",
      name: tr("conexiones.canalZernioNombre"),
      icon: "share-2",
      desc: tr("conexiones.canalZernioDesc"),
      ok: zernioMissing.length === 0,
      missing: zernioMissing,
      webhookPath: "/webhooks/zernio",
      howTo: tr("conexiones.canalZernioComoConectar"),
    },
    {
      id: "meta",
      name: "Instagram + Messenger (Meta)",
      icon: "instagram",
      desc: tr("conexiones.canalMetaDesc"),
      ok: metaMissing.length === 0,
      missing: metaMissing,
      webhookPath: "/webhooks/meta",
      howTo: tr("conexiones.canalMetaComoConectar"),
    },
    {
      id: "manychat",
      name: "ManyChat",
      icon: "bot",
      desc: tr("conexiones.canalManychatDesc"),
      ok: manychatMissing.length === 0,
      missing: manychatMissing,
      webhookPath: "/webhooks/manychat",
      howTo: tr("conexiones.canalManychatComoConectar"),
    },
  ];
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// ---------------------------------------------------------------------------
// Logos de marca reales (solo presentación — no toca channelStatuses ni el
// resto de la lógica de arriba). Los paths de Telegram/WhatsApp/Instagram son
// los oficiales estilo simple-icons (CC0), coloreados con el color de marca.
// ManyChat no tiene un ícono vectorial público reusable: se usa un PNG de su
// isotipo real ("m", tomado de su favicon en vivo) recoloreado a su azul.
// ---------------------------------------------------------------------------

const LOGO_PATHS: Record<string, string> = {
  telegram:
    "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  whatsapp:
    "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  instagram:
    "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
};

// Isotipo real de ManyChat (su "m"), extraído de su favicon en vivo y
// recoloreado a su azul de marca — no existe como SVG público reusable.
const MANYCHAT_LOGO_PNG =
  "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";

const CHANNEL_VISUAL: Record<string, { color: string; tag?: string; tileBg: string; logo: string }> = {
  telegram: {
    color: "#229ED9",
    tileBg: "rgba(34,158,217,.16)",
    logo: `<svg viewBox="0 0 24 24" width="25" height="25" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="#229ED9" d="${LOGO_PATHS.telegram}"/></svg>`,
  },
  whatsapp: {
    color: "#25D366",
    tag: "Twilio",
    tileBg: "rgba(37,211,102,.16)",
    logo: `<svg viewBox="0 0 24 24" width="25" height="25" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="#25D366" d="${LOGO_PATHS.whatsapp}"/></svg>`,
  },
  "whatsapp-cloud": {
    color: "#25D366",
    tag: "Meta",
    tileBg: "rgba(37,211,102,.16)",
    logo: `<svg viewBox="0 0 24 24" width="25" height="25" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="#25D366" d="${LOGO_PATHS.whatsapp}"/></svg>`,
  },
  meta: {
    color: "#D6249F",
    tileBg: "linear-gradient(0deg,#FEDA75 0%,#FA7E1E 25%,#D62976 50%,#962FBF 75%,#4F5BD5 100%)",
    logo: `<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="#fff" d="${LOGO_PATHS.instagram}"/></svg>`,
  },
  manychat: {
    color: "#2E86DE",
    tileBg: "rgba(46,134,222,.16)",
    logo: `<img src="data:image/png;base64,${MANYCHAT_LOGO_PNG}" width="28" height="21" alt="" style="display:block" />`,
  },
};

/** Tile redondeado (~44px) con el logo real de marca del canal, tintado con su color. */
function channelLogo(id: string): string {
  const v = CHANNEL_VISUAL[id];
  if (!v) return "";
  return `<div style="width:44px;height:44px;flex:none;border-radius:12px;display:flex;align-items:center;justify-content:center;background:${v.tileBg};box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)">${v.logo}</div>`;
}

export async function renderConexiones(env: Env, reqUrl: string): Promise<string> {
  const tr = traductor(env);
  const channels = channelStatuses(env);
  const connected = channels.filter((ch) => ch.ok).length;
  const base = await selfOriginFromRequest(env, reqUrl);

  const cards = channels
    .map((ch) => {
      const v = CHANNEL_VISUAL[ch.id] ?? { color: "var(--accent)", tileBg: "var(--panel2)", logo: "" };

      const badge = ch.ok
        ? `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--ok);flex:none">
             <span style="width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px rgba(127,183,126,.16)"></span>
             ${esc(tr("conexiones.estadoConectado"))}
           </span>`
        : `<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--dim);flex:none">
             <span style="width:7px;height:7px;border-radius:50%;border:1.5px solid var(--dim)"></span>
             ${esc(tr("conexiones.estadoSinConectar"))}
           </span>`;

      const missing = ch.ok
        ? ""
        : `<div style="border-left:2px solid var(--bad);padding:2px 0 2px 10px;display:flex;flex-direction:column;gap:4px">
             <div class="text-[11.5px]" style="color:var(--bad);font-weight:600">${esc(tr("conexiones.faltaConfigurar"))} <span class="font-mono" style="font-weight:500">${ch.missing
               .map(esc)
               .join(", ")}</span></div>
             <div class="text-dim text-[11.5px]" style="line-height:1.5">${esc(ch.howTo)}</div>
           </div>`;

      const webhook =
        ch.webhookPath && base
          ? `<div style="display:flex;flex-direction:column;gap:6px">
               <div style="font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">Webhook</div>
               <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                 <span class="font-mono text-dim text-[10.5px]" style="border:1px solid var(--line);padding:6px 10px;background:var(--bg);flex:1;min-width:0;overflow-wrap:anywhere">${esc(base + ch.webhookPath)}</span>
                 <button type="button" class="ghostbtn font-mono" style="font-size:10.5px;border:1px solid var(--line);color:var(--cream);padding:6px 10px;cursor:pointer;background:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:none"
                         onclick="navigator.clipboard.writeText('${esc(base + ch.webhookPath)}');this.innerHTML='${esc(tr("conexiones.botonCopiado"))}'">
                   <i data-lucide="copy" width="12" height="12"></i>${esc(tr("conexiones.botonCopiar"))}
                 </button>
               </div>
             </div>`
          : "";

      // El canal web no se conecta con un webhook: se conecta pegando este
      // <script> en el sitio. Es su equivalente, así que va en el mismo lugar.
      const embed =
        ch.id === "web" && base
          ? (() => {
              const tag = `<script src="${base}/widget.js"></script>`;
              return `<div style="display:flex;flex-direction:column;gap:6px">
               <div style="font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)">${tr("conexiones.pegarAntesDeBody")}</div>
               <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                 <span class="font-mono text-dim text-[10.5px]" style="border:1px solid var(--line);padding:6px 10px;background:var(--bg);flex:1;min-width:0;overflow-wrap:anywhere">${esc(tag)}</span>
                 <button type="button" class="ghostbtn font-mono" style="font-size:10.5px;border:1px solid var(--line);color:var(--cream);padding:6px 10px;cursor:pointer;background:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:none"
                         onclick="navigator.clipboard.writeText(this.parentNode.querySelector('span').textContent);this.innerHTML='${esc(tr("conexiones.botonCopiado"))}'">
                   <i data-lucide="copy" width="12" height="12"></i>${esc(tr("conexiones.botonCopiar"))}
                 </button>
               </div>
               <div class="text-dim text-[11px]" style="line-height:1.55">${esc(tr("conexiones.widgetAtributos"))}
                 <span class="font-mono" style="color:var(--cream)">data-tema</span> (suave · minimal · oscuro · vidrio),
                 <span class="font-mono" style="color:var(--cream)">data-color</span>,
                 <span class="font-mono" style="color:var(--cream)">data-posicion</span>.
                 ${esc(tr("conexiones.widgetIncrustado"))}</div>
             </div>`;
            })()
          : "";

      const security = ch.securityNote
        ? `<div class="text-[11px]" style="color:var(--warn,#e9ad4f);line-height:1.5">⚠ ${esc(ch.securityNote)}</div>`
        : "";

      const tag = v.tag
        ? `<span style="font-size:9px;letter-spacing:.08em;color:var(--dim);border:1px solid var(--line);padding:1px 6px;text-transform:uppercase;flex:none">${esc(v.tag)}</span>`
        : "";

      return `
        <div class="card" style="background:var(--panel);border:1px solid var(--line);border-top:2px solid ${ch.ok ? v.color : "var(--line)"};padding:20px;display:flex;flex-direction:column;gap:14px;${ch.ok ? `box-shadow:0 12px 28px -18px ${v.color}` : ""}">
          <div style="display:flex;align-items:flex-start;gap:13px">
            ${channelLogo(ch.id)}
            <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
                <div class="font-display font-semibold text-cream" style="font-size:14.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;line-height:1.3">
                  <span>${esc(ch.name)}</span>
                  ${tag}
                </div>
                ${badge}
              </div>
              <p class="text-muted text-[12px]" style="margin:0;line-height:1.5">${esc(ch.desc)}</p>
            </div>
          </div>
          ${missing}
          ${security}
          ${webhook}
          ${embed}
        </div>`;
    })
    .join("");

  // Primer uso: nadie ha conectado un canal todavía. En vez de dejar puras
  // tarjetas grises, explicamos qué es esta tab y ofrecemos que Claude Code
  // guíe la conexión de punta a punta (sacar credenciales → secrets → probar).
  const emptyGuide =
    connected === 0
      ? `
      <div style="border:1px solid var(--line);background:var(--panel);padding:16px 18px;display:flex;flex-direction:column;gap:8px">
        <div class="text-cream" style="font-size:13px;font-weight:600">${esc(tr("conexiones.vacioTitulo"))}</div>
        <p class="text-muted text-[12.5px]" style="margin:0;max-width:640px;line-height:1.6">${tr("conexiones.vacioTexto")}</p>
        ${renderConfigPrompt(
          esc(tr("conexiones.promptConectarCanal")),
          esc(tr("conexiones.promptAyuda")),
        tr,
        )}
      </div>`
      : "";

  const body = `
    <div style="display:flex;flex-direction:column;gap:20px">
      <div style="display:flex;flex-direction:column;gap:4px">
        <h2 class="font-display font-semibold text-cream" style="font-size:16px;display:flex;align-items:baseline;gap:8px">
          ${esc(tr("conexiones.tituloCanales"))}
          <span style="font-size:13px;font-weight:700;color:${connected === channels.length ? "var(--ok)" : "var(--accent)"}">${connected} / ${channels.length}</span>
        </h2>
        <p class="text-muted text-[12.5px]" style="max-width:640px;line-height:1.6">${esc(tr("conexiones.introSecrets"))} <span class="font-mono" style="color:var(--cream)">wrangler secret put NOMBRE</span> ${esc(tr("conexiones.introSecretsFin"))}</p>
      </div>
      ${emptyGuide}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:16px">
        ${cards}
      </div>
    </div>`;

  return layout({ title: esc(tr("nav.conexiones")), activeTab: "conexiones", body, env });
}

/** Resumen corto para el badge de salud del Resumen. */
export function connectionsSummary(env: Env): { connected: number; total: number } {
  const channels = channelStatuses(env);
  return { connected: channels.filter((ch) => ch.ok).length, total: channels.length };
}
