/**
 * Cómo SE VE el chat del sitio web.
 *
 * El bot vive en sitios que no controlamos: una barbería con plantilla de
 * WordPress, una clínica de fondo blanco impecable, un portafolio en negro. Un
 * solo look no funciona en los tres, así que el dueño elige uno de cuatro
 * ESTILOS y uno de dos FORMATOS.
 *
 * Los estilos son TOKENS, no hojas de estilo sueltas: cambiar un color aquí lo
 * cambia en el widget y en la vista previa del panel a la vez.
 *
 * El color de marca y el lado NO se hornean en el CSS: viajan como variables
 * (`--fc`, `--der`, `--izq`) que se fijan en el navegador. Gracias a eso el
 * archivo servido es el mismo para todos —una sola entrada de caché— y el
 * dueño puede cambiar color, lado, estilo o formato editando un atributo del
 * <script>, sin volver a desplegar el bot.
 */

export type Tema = "suave" | "minimal" | "oscuro" | "vidrio";
/** burbuja = flota en la esquina · ventana = incrustada en una sección. */
export type Modo = "burbuja" | "ventana";

export const TEMAS: Tema[] = ["suave", "minimal", "oscuro", "vidrio"];
export const MODOS: Modo[] = ["burbuja", "ventana"];

export const NOMBRE_TEMAS: Record<Tema, string> = {
  suave: "Suave",
  minimal: "Minimal",
  oscuro: "Oscuro",
  vidrio: "Vidrio",
};

export const DESCRIPCION_TEMAS: Record<Tema, string> = {
  suave: "Redondeado y cálido, con sombras y la cabecera en tu color. Le queda a casi cualquier negocio.",
  minimal: "Plano, líneas finas, sin sombras. Para sitios sobrios o corporativos.",
  oscuro: "Panel oscuro. Para sitios de fondo negro, donde el blanco deslumbra.",
  vidrio: "Traslúcido con desenfoque. Luce sobre fotos o degradados; sobre blanco liso, no.",
};

interface Tokens {
  panelBg: string;
  panelBorde: string;
  panelSombra: string;
  panelExtra: string; // filtros y demás, si el tema los necesita
  radio: string;
  cabBg: string;
  cabTexto: string;
  cabBorde: string;
  chatBg: string;
  botBg: string;
  botTexto: string;
  botSombra: string;
  radioBub: string;
  yoTexto: string;
  pieBg: string;
  pieBorde: string;
  entradaBg: string;
  entradaBorde: string;
  entradaTexto: string;
  puntos: string;
  avisoBg: string;
  avisoTexto: string;
  anilloFoco: string; // contra qué fondo se dibuja el foco del teclado
}

/** `var(--fc)` es el color de marca; cada tema decide dónde y cuánto usarlo. */
function tokens(tema: Tema): Tokens {
  switch (tema) {
    // Plano y sobrio: el color solo aparece en el título y en lo que el
    // visitante escribe. Sin cabecera de bloque.
    case "minimal":
      return {
        panelBg: "#fff",
        panelBorde: "1px solid #e4e4e7",
        panelSombra: "0 8px 28px rgba(0,0,0,.10)",
        panelExtra: "",
        radio: "12px",
        cabBg: "#fff",
        cabTexto: "var(--fc)",
        cabBorde: "1px solid #ececef",
        chatBg: "#fff",
        botBg: "#f4f4f5",
        botTexto: "#18181b",
        botSombra: "none",
        radioBub: "10px",
        yoTexto: "#fff",
        pieBg: "#fff",
        pieBorde: "1px solid #ececef",
        entradaBg: "#fff",
        entradaBorde: "#dedee2",
        entradaTexto: "#18181b",
        puntos: "#b8b8bf",
        avisoBg: "#fafafa",
        avisoTexto: "#6b6b73",
        anilloFoco: "#fff",
      };

    // Para sitios de fondo negro. Ahí el blanco de los otros temas deslumbra.
    case "oscuro":
      return {
        panelBg: "#16161b",
        panelBorde: "1px solid #26262f",
        panelSombra: "0 24px 70px rgba(0,0,0,.6)",
        panelExtra: "",
        radio: "16px",
        cabBg: "#16161b",
        cabTexto: "#f4f4f6",
        cabBorde: "1px solid #26262f",
        chatBg: "#0e0e12",
        botBg: "#22222b",
        botTexto: "#e9e9ee",
        botSombra: "none",
        radioBub: "14px",
        yoTexto: "#fff",
        pieBg: "#16161b",
        pieBorde: "1px solid #26262f",
        entradaBg: "#1c1c23",
        entradaBorde: "#31313c",
        entradaTexto: "#f0f0f4",
        puntos: "#565663",
        avisoBg: "#2a2116",
        avisoTexto: "#f0c88a",
        anilloFoco: "#0e0e12",
      };

    // Traslúcido: se apoya en lo que hay detrás. Sobre blanco liso no luce, y
    // la descripción lo dice para que nadie lo elija a ciegas.
    case "vidrio":
      return {
        panelBg: "rgba(255,255,255,.74)",
        panelBorde: "1px solid rgba(255,255,255,.65)",
        panelSombra: "0 20px 60px rgba(15,15,25,.28)",
        panelExtra:
          "backdrop-filter:blur(20px) saturate(165%);-webkit-backdrop-filter:blur(20px) saturate(165%)",
        radio: "20px",
        cabBg: "transparent",
        cabTexto: "#1a1a22",
        cabBorde: "1px solid rgba(0,0,0,.07)",
        chatBg: "transparent",
        botBg: "rgba(255,255,255,.82)",
        botTexto: "#1a1a22",
        botSombra: "0 2px 10px rgba(0,0,0,.06)",
        radioBub: "16px",
        yoTexto: "#fff",
        pieBg: "transparent",
        pieBorde: "1px solid rgba(0,0,0,.07)",
        entradaBg: "rgba(255,255,255,.7)",
        entradaBorde: "rgba(0,0,0,.12)",
        entradaTexto: "#1a1a22",
        puntos: "#9a9aa6",
        avisoBg: "rgba(255,244,228,.92)",
        avisoTexto: "#7a4a10",
        anilloFoco: "#fff",
      };

    // El de siempre: cabecera con el color de marca, sombras suaves.
    default:
      return {
        panelBg: "#fff",
        panelBorde: "none",
        panelSombra: "0 24px 70px rgba(0,0,0,.3)",
        panelExtra: "",
        radio: "16px",
        cabBg: "var(--fc)",
        cabTexto: "#fff",
        cabBorde: "none",
        chatBg: "#f7f7f8",
        botBg: "#fff",
        botTexto: "#1b1b1f",
        botSombra: "0 1px 2px rgba(0,0,0,.08)",
        radioBub: "14px",
        yoTexto: "#fff",
        pieBg: "#fff",
        pieBorde: "1px solid #ececf0",
        entradaBg: "#fff",
        entradaBorde: "#dcdce2",
        entradaTexto: "#1b1b1f",
        puntos: "#c3c3c9",
        avisoBg: "#fdf2e2",
        avisoTexto: "#7a4a10",
        anilloFoco: "#fff",
      };
  }
}

/**
 * CSS de un estilo+formato. Sin color ni lado: esos entran por variables, para
 * que el mismo archivo sirva a todos los sitios.
 */
export function cssTema(tema: Tema, modo: Modo): string {
  const t = tokens(tema);

  const comun = `
:host,*{box-sizing:border-box}
.panel{background:${t.panelBg};border:${t.panelBorde};border-radius:${t.radio};overflow:hidden;
flex-direction:column;box-shadow:${t.panelSombra};${t.panelExtra};
font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.cab{background:${t.cabBg};color:${t.cabTexto};padding:14px 16px;display:flex;align-items:center;gap:10px;flex:none;border-bottom:${t.cabBorde}}
.cab b{font-size:15px;font-weight:600;line-height:1.2}
.cab span{display:block;font-size:11.5px;opacity:.72}
.chat{flex:1;overflow-y:auto;padding:16px;background:${t.chatBg};display:flex;flex-direction:column;gap:10px}
.fila{display:flex}
.fila.yo{justify-content:flex-end}
.bub{max-width:82%;padding:10px 13px;border-radius:${t.radioBub};font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.fila.bot .bub{background:${t.botBg};color:${t.botTexto};border-bottom-left-radius:4px;box-shadow:${t.botSombra}}
.fila.yo .bub{background:var(--fc);color:${t.yoTexto};border-bottom-right-radius:4px}
.bub.aviso{background:${t.avisoBg};color:${t.avisoTexto};font-size:13px;box-shadow:none}
.esc{display:flex;gap:4px;padding:12px 13px}
.esc i{width:7px;height:7px;border-radius:50%;background:${t.puntos};animation:p 1.2s infinite}
.esc i:nth-child(2){animation-delay:.15s}.esc i:nth-child(3){animation-delay:.3s}
@keyframes p{0%,60%,100%{opacity:.3}30%{opacity:1}}
.pie{display:flex;gap:8px;padding:10px;background:${t.pieBg};border-top:${t.pieBorde};flex:none}
textarea{flex:1;resize:none;border:1px solid ${t.entradaBorde};border-radius:10px;padding:9px 11px;
font:inherit;font-size:14.5px;max-height:110px;outline:none;background:${t.entradaBg};color:${t.entradaTexto}}
textarea::placeholder{color:${t.puntos}}
textarea:focus{border-color:var(--fc)}
.enviar{background:var(--fc);border:0;border-radius:10px;color:#fff;padding:0 15px;cursor:pointer;font-size:17px}
.enviar:disabled{opacity:.5;cursor:default}
.enviar:focus-visible,textarea:focus-visible{outline:2px solid var(--fc);outline-offset:2px}`;

  // Incrustado: ocupa el hueco que le deje el sitio. Sin burbuja ni cerrar.
  if (modo === "ventana") {
    return `${comun}
:host{display:block;width:100%;height:100%}
.panel{display:flex;width:100%;height:100%;min-height:420px}
.burbuja,.cerrar{display:none}
@media (prefers-reduced-motion:reduce){.esc i{animation:none}}`;
  }

  // Flotante: fijo sobre el sitio, a pantalla completa en móvil.
  // Alturas en dvh (con 100vh de fallback): en móvil, 100vh NO descuenta la barra del
  // navegador ni el teclado y el compositor quedaba fuera de pantalla (reporte de un
  // miembro, sep-2026). El safe-area del pie solo aplica al panel a pantalla completa.
  return `${comun}
.burbuja{position:fixed;bottom:20px;right:var(--der);left:var(--izq);width:58px;height:58px;border-radius:50%;
background:var(--fc);border:0;cursor:pointer;display:grid;place-items:center;
box-shadow:0 10px 30px rgba(0,0,0,.28);z-index:2147483000;transition:transform .18s}
.burbuja:hover{transform:scale(1.06)}
.burbuja:focus-visible{outline:3px solid ${t.anilloFoco};outline-offset:3px}
.burbuja svg{width:26px;height:26px;fill:#fff}
.panel{position:fixed;bottom:88px;right:var(--der);left:var(--izq);width:360px;max-width:calc(100vw - 32px);
height:520px;max-height:calc(100vh - 120px);max-height:calc(100dvh - 120px);display:none;z-index:2147483000}
.panel.abierto{display:flex}
.cerrar{margin-left:auto;background:transparent;border:0;color:${t.cabTexto};font-size:22px;line-height:1;cursor:pointer;opacity:.8}
.cerrar:hover{opacity:1}
@media (max-width:420px){.panel{bottom:0;right:0;left:0;width:100%;max-width:100%;height:100vh;height:100dvh;max-height:100vh;max-height:100dvh;border-radius:0}
.pie{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}}
@media (prefers-reduced-motion:reduce){.burbuja,.esc i{transition:none;animation:none}}`;
}

/** Los 8 CSS (4 estilos × 2 formatos) que viajan dentro de widget.js. */
export function todosLosTemas(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tema of TEMAS) for (const modo of MODOS) out[`${tema}:${modo}`] = cssTema(tema, modo);
  return out;
}

/**
 * Markup del panel, con `__NOMBRE__` de hueco: el navegador lo sustituye por el
 * nombre del negocio ya escapado. Así la vista previa y el widget real dibujan
 * exactamente la misma estructura.
 */
export const MARKUP_PANEL =
  '<div class="cab"><div><b>__NOMBRE__</b><span>__INSTANTE__</span></div>' +
  '<button class="cerrar" aria-label="__CERRAR__">&times;</button></div>' +
  '<div class="chat" role="log" aria-live="polite"></div>' +
  '<div class="pie"><textarea rows="1" placeholder="__ESCRIBE__" aria-label="__TUMSJ__"></textarea>' +
  '<button class="enviar" aria-label="__ENVIAR__">&#10148;</button></div>';

export const ICONO_BURBUJA =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.9 2 11.7c0 2.5 1.2 4.7 3.2 6.3-.1 1.1-.5 2.4-1.4 3.5 1.8-.2 3.4-.9 4.6-1.8 1.1.3 2.3.5 3.6.5 5.5 0 10-3.9 10-8.5S17.5 3 12 3z"/></svg>';

export function normalizaTema(v: unknown): Tema {
  return TEMAS.includes(v as Tema) ? (v as Tema) : "suave";
}

export function normalizaModo(v: unknown): Modo {
  return v === "ventana" ? "ventana" : "burbuja";
}

/** Solo colores que el navegador entiende sin ambigüedad; si no, el de Forja. */
export function normalizaColor(v: unknown): string {
  return /^#[0-9a-f]{3,8}$/i.test(String(v ?? "")) ? String(v) : "#ff6a1f";
}
