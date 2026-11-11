// White-label del dashboard. El agencia/cliente pone SU marca (nombre, logo,
// colores, tipografía) vía env vars BRAND_*. Todo se VALIDA aquí: un color o una
// fuente inválidos caen al default de Forja, así el panel nunca se rompe por un
// branding mal puesto. El logo va por URL https propia O self-hosted en el bot
// (ruta /brand/logo, sin hosting externo); los colores por hex; la fuente se
// elige de una lista blanca (evita inyección de URLs arbitrarias).
import type { Env } from "../env";
import { isPro } from "../config";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

// Defaults = el tema Forja (deben coincidir con :root de layout.ts).
const DEFAULT_ACCENT = "#f07a3f";
const DEFAULT_ACCENT_2 = "#f5a623";
const DEFAULT_ACCENT_SOFT = "rgba(240,122,63,.14)";
const DEFAULT_NAME = "HorizontesAgentOS";

// Fuentes permitidas (Google Fonts). Clave = lo que pone el usuario (case-insensitive);
// valor = el `family` param de Google Fonts. Space Grotesk es el default del tema.
const FONTS: Record<string, string> = {
  "space grotesk": "Space+Grotesk",
  inter: "Inter",
  poppins: "Poppins",
  montserrat: "Montserrat",
  roboto: "Roboto",
  lato: "Lato",
  nunito: "Nunito",
  "work sans": "Work+Sans",
  manrope: "Manrope",
  "dm sans": "DM+Sans",
  sora: "Sora",
  outfit: "Outfit",
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Un hex válido (#rgb | #rrggbb | #rrggbbaa) o null. */
function validHex(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? s : null;
}

/** El logo puede venir de DOS formas, ambas seguras:
 *   • URL https externa (el logo vive en el CDN/sitio del miembro), o
 *   • ruta same-origin "/brand/logo" (self-hosted: lo sirve el worker desde D1,
 *     lo pone el skill /whitelabel). Sin dependencia de hosting externo.
 * Cualquier otra cosa (http://, javascript:, //otro-host, data:) → null. */
function validLogo(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s; // URL propia del miembro
  if (/^\/[a-z0-9/_.-]+$/i.test(s)) return s; // ruta same-origin (self-hosted)
  return null;
}

/** hex → "r, g, b" para construir el rgba del accent-soft. */
function hexToRgb(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  h = h.slice(0, 6);
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** hex → {h,s,l} (H 0-360, S/L 0-100). Para derivar toda la paleta de un color. */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let x = hex.replace("#", "");
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  x = x.slice(0, 6);
  const r = parseInt(x.slice(0, 2), 16) / 255;
  const g = parseInt(x.slice(2, 4), 16) / 255;
  const b = parseInt(x.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** {h,s,l} → hex. */
function hslToHex(h: number, s: number, l: number): string {
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** De un color BASE (el fondo) deriva toda la escalera de superficies + el texto
 *  legible, conservando su tono. Así la marca tiñe TODO el panel (no solo el
 *  acento) y el cambio se nota de verdad. Si el base es claro, el texto se vuelve
 *  oscuro (y viceversa), para que siempre haya contraste. */
function surfaceTheme(base: string): string {
  const { h, s, l } = hexToHsl(base);
  const sat = Math.min(s, 40); // superficies con tono pero sin saturar de más
  const step = (dl: number) => hslToHex(h, sat, l + dl);
  const dark = l < 50;
  const text = dark ? hslToHex(h, 14, 92) : hslToHex(h, 28, 15);
  const muted = dark ? hslToHex(h, 12, 63) : hslToHex(h, 20, 38);
  const dim = dark ? hslToHex(h, 10, 46) : hslToHex(h, 16, 52);
  const linL = dark ? l + 22 : l - 16;
  return (
    `:root{--bg:${base};--panel:${step(dark ? 3 : -3)};--panel2:${step(dark ? 6 : -6)};` +
    `--raise:${step(dark ? 9 : -9)};--line:${step(dark ? 12 : -11)};--linelit:${hslToHex(h, sat, linL)};` +
    `--cream:${text};--fg:${text};--muted:${muted};--dim:${dim}}`
  );
}

// ── Presets de estilo (BRAND_STYLE) ──────────────────────────────────────────
// Un preset re-mapea TODA la paleta de tokens Forja + la "forma" (radio, sombra,
// grosor de borde, scanlines, fuentes) del panel. NO toca el markup ni el
// GLOBAL_STYLE: brandingStyle() inyecta un <style> que gana por cascada. Así un
// cambio funcional futuro (tab nueva) se propaga a los 3 presets solo. El accent
// del preset es el DEFAULT — si el miembro puso BRAND_ACCENT válido, ése gana.
export type StyleKey = "nimbus" | "onyx" | "terra";

interface StylePreset {
  // color tokens (espejan los --bg/--panel/... de layout.ts). `cream` = texto (== --fg).
  bg: string; panel: string; panel2: string; raise: string;
  line: string; linelit: string;
  cream: string; muted: string; dim: string;
  accent: string; accent2: string; accentSoft: string;
  // forma
  radius: string;      // border-radius de cajas/botones/chips
  shadowCard: string;  // sombra de cards/modales/toasts
  shadowBtn: string;   // sombra de .bigbtn en hover/active
  borderWidth: string; // grosor de los bordes declarados por clase
  scanlines: boolean;  // overlay de líneas de barrido
  bodyFont: string;    // fuente de cuerpo (Google Font family)
  displayFont: string; // fuente de títulos (== bodyFont si no hay display aparte)
}

const STYLES: Record<StyleKey, StylePreset> = {
  // Claro minimal (Linear/Stripe/Notion).
  nimbus: {
    bg: "#F6F7F9", panel: "#FFFFFF", panel2: "#F1F3F6", raise: "#F1F3F6",
    line: "#E4E7EC", linelit: "#D8DCE3",
    cream: "#111827", muted: "#5B6472", dim: "#9AA1AC",
    accent: "#4F7CFF", accent2: "#7CA0FF", accentSoft: "rgba(79,124,255,.10)",
    radius: "10px",
    shadowCard: "0 1px 2px rgba(16,24,40,.06)",
    shadowBtn: "0 1px 2px rgba(16,24,40,.12)",
    borderWidth: "1px", scanlines: false,
    bodyFont: "Inter", displayFont: "Inter",
  },
  // Oscuro moderno neutro (Vercel/Linear-dark/Supabase).
  onyx: {
    bg: "#0A0A0C", panel: "#141417", panel2: "#1C1C20", raise: "#232327",
    line: "#28282E", linelit: "#34343B",
    cream: "#F3F3F6", muted: "#9A9AA4", dim: "#63636C",
    accent: "#7C5CFF", accent2: "#9D86FF", accentSoft: "rgba(124,92,255,.16)",
    radius: "10px",
    shadowCard: "0 2px 10px rgba(0,0,0,.35)",
    shadowBtn: "0 4px 14px rgba(124,92,255,.35)",
    borderWidth: "1px", scanlines: false,
    bodyFont: "Inter", displayFont: "Inter",
  },
  // Cálido bold editorial (Gumroad/editorial); sombra DURA + serif de títulos.
  terra: {
    bg: "#FBF4E9", panel: "#FFFDF9", panel2: "#F7ECDA", raise: "#F2E4CE",
    line: "#211812", linelit: "#4a3826",
    cream: "#211812", muted: "#6E5C46", dim: "#A18F76",
    accent: "#DB5B34", accent2: "#F0A24E", accentSoft: "rgba(219,91,52,.12)",
    radius: "8px",
    shadowCard: "4px 4px 0 rgba(33,24,18,.10)",
    shadowBtn: "3px 3px 0 rgba(33,24,18,.9)",
    borderWidth: "1.5px", scanlines: false,
    bodyFont: "Inter", displayFont: "Fraunces",
  },
};

/** El CSS de un preset: paleta (tokens + utilidades Tailwind hardcodeadas),
 *  cromo inline oscuro, forma y scanlines. `accent/accent2/accentSoft` llegan YA
 *  resueltos (con el override del miembro aplicado si lo hay). */
function styleCss(p: StylePreset, accent: string, accent2: string, accentSoft: string): string {
  // 1. Tokens :root — todo lo que usa var() (shell, sidebar, estilos inline).
  const root =
    `:root{--bg:${p.bg};--panel:${p.panel};--panel2:${p.panel2};--raise:${p.raise};` +
    `--line:${p.line};--linelit:${p.linelit};--cream:${p.cream};--fg:${p.cream};` +
    `--muted:${p.muted};--dim:${p.dim};--border:${p.line};--border-lit:${p.linelit};` +
    `--accent:${accent};--accent-2:${accent2};--accent-soft:${accentSoft}}`;
  // 2. Utilidades Tailwind: el tailwind.config de layout.ts mapea estos tokens a
  //    HEX FIJO (no var), y el CDN los inyecta en runtime DESPUÉS de este <style>,
  //    así que hace falta !important para re-apuntarlas a los tokens del preset.
  //    Sin esto, los ~420 usos de text-cream/bg-panel/… conservan la paleta
  //    oscura de Forja (y un preset claro pintaría texto claro sobre claro).
  const util =
    `.bg-bg{background-color:var(--bg)!important}` +
    `.bg-panel{background-color:var(--panel)!important}` +
    `.bg-panel2{background-color:var(--panel2)!important}` +
    `.bg-raise{background-color:var(--raise)!important}` +
    `.bg-line{background-color:var(--line)!important}` +
    `.bg-linelit{background-color:var(--linelit)!important}` +
    `.text-cream{color:var(--cream)!important}` +
    `.text-muted{color:var(--muted)!important}` +
    `.text-dim{color:var(--dim)!important}` +
    `.border-line{border-color:var(--line)!important}` +
    `.border-linelit{border-color:var(--linelit)!important}`;
  // 3. Cromo inline con color oscuro literal (header + <select> de proyectos):
  //    !important porque el color va en el atributo style inline.
  const chrome =
    `.shell>div>header{background:var(--panel)!important}` +
    `#proj-switcher select{background:var(--panel)!important;border-color:var(--line)!important}`;
  // 4. Forma: radio en las clases estructurales; las sombras pisan las DURAS del
  //    GLOBAL_STYLE (van después en la cascada → sin !important).
  const radiusSel =
    `.bigbtn,.ghostbtn,.chip,.tkcard,.cfgcard,.node,.node-card,.modal-card,.toast,.live-pill,.card,.subtab`;
  const shape =
    `${radiusSel}{border-radius:${p.radius}}` +
    `.bigbtn:hover,.bigbtn:active{box-shadow:${p.shadowBtn}}` +
    `.node:hover,.node-card:hover{box-shadow:${p.shadowCard}}` +
    `.toast{box-shadow:${p.shadowCard}}` +
    `.modal-card{box-shadow:${p.shadowCard};border-width:${p.borderWidth}}` +
    `.toast,.live-pill{border-width:${p.borderWidth}}`;
  // 5. Scanlines (los 3 presets las apagan).
  const scan = p.scanlines ? "" : `.scanlines::after{display:none}`;
  return root + util + chrome + shape + scan;
}

export interface Branding {
  name: string;
  logoUrl: string | null;
  accent: string;
  accent2: string;
  accentSoft: string; // rgba del accent (default del preset, o derivado del override)
  fontName: string | null; // nombre "bonito" (ej. "Poppins") o null si default
  fontFamily: string | null; // el family param de Google Fonts o null
  surface: string | null; // color base del fondo — tiñe TODO el panel; null = superficies Forja
  style: StyleKey | null; // preset de estilo completo (nimbus|onyx|terra) o null
  hideForja: boolean;
  isCustom: boolean; // hay al menos un override de marca
}

// El tema Forja (branding no-custom). Es lo que ve un bot free y el fallback
// de todo. Un solo objeto para no repetir los defaults.
const FORJA_THEME: Branding = {
  name: DEFAULT_NAME,
  logoUrl: null,
  accent: DEFAULT_ACCENT,
  accent2: DEFAULT_ACCENT_2,
  accentSoft: DEFAULT_ACCENT_SOFT,
  fontName: null,
  fontFamily: null,
  surface: null,
  style: null,
  hideForja: false,
  isCustom: false,
};

export function resolveBranding(env: Env): Branding {
  // GATE: el white-label es Forja+ (Modo Agencia). Un bot free IGNORA las
  // BRAND_* y usa el tema Forja, aunque estén puestas en su wrangler.toml. El
  // tier efectivo ya está en env.BOT_TIER (applyTier corre en el middleware de
  // CADA request, antes de renderizar el panel), así que un cliente de agencia
  // Pro con override sí obtiene su marca.
  if (!isPro(env)) return FORJA_THEME;

  // Preset de estilo: normaliza y valida contra las 3 claves; inválido/vacío = null.
  const styleKey = (env.BRAND_STYLE ?? "").trim().toLowerCase();
  const style: StyleKey | null =
    styleKey === "nimbus" || styleKey === "onyx" || styleKey === "terra" ? styleKey : null;
  const preset = style ? STYLES[style] : null;

  // El accent del miembro (si es válido) GANA sobre el default del preset; si no
  // hay override, se usa el del preset (o el de Forja cuando no hay preset).
  const memberAccent = validHex(env.BRAND_ACCENT);
  const accent = memberAccent ?? (preset ? preset.accent : DEFAULT_ACCENT);
  const accent2 = validHex(env.BRAND_ACCENT_2) ?? (preset ? preset.accent2 : DEFAULT_ACCENT_2);
  const accentSoft = memberAccent
    ? `rgba(${hexToRgb(memberAccent)},.14)`
    : preset
      ? preset.accentSoft
      : DEFAULT_ACCENT_SOFT;
  const logoUrl = validLogo(env.BRAND_LOGO_URL);
  const name = (env.BRAND_NAME ?? "").trim().slice(0, 40) || DEFAULT_NAME;
  const fontKey = (env.BRAND_FONT ?? "").trim().toLowerCase();
  const fontFamily = fontKey && fontKey !== "space grotesk" && FONTS[fontKey] ? FONTS[fontKey] : null;
  const fontName = fontFamily ? env.BRAND_FONT!.trim() : null;
  const surface = validHex(env.BRAND_SURFACE);
  const hideForja = (env.BRAND_HIDE_FORJA ?? "").trim().toLowerCase() === "on";
  const isCustom =
    name !== DEFAULT_NAME || !!logoUrl || accent !== DEFAULT_ACCENT || accent2 !== DEFAULT_ACCENT_2 ||
    !!fontFamily || !!surface || !!style || hideForja;
  return { name, logoUrl, accent, accent2, accentSoft, fontName, fontFamily, surface, style, hideForja, isCustom };
}

/** <link>(s) de fuentes para el <head>. La fuente del miembro (BRAND_FONT) gana;
 *  si no, la(s) del preset de estilo (Inter siempre; + la display si difiere,
 *  ej. Fraunces en Terra). Vacío si no hay ninguna fuente custom. */
export function brandingHead(env: Env): string {
  const b = resolveBranding(env);
  const families: string[] = [];
  if (b.fontFamily) {
    families.push(b.fontFamily);
  } else if (b.style) {
    const p = STYLES[b.style];
    families.push(p.bodyFont);
    if (p.displayFont !== p.bodyFont) families.push(p.displayFont);
  }
  if (!families.length) return "";
  return families
    .map((f) => `\n  <link href="https://fonts.googleapis.com/css2?family=${f}:wght@400;500;600;700&display=swap" rel="stylesheet">`)
    .join("");
}

/** <style> que sobreescribe tokens de color y tipografía. Va DESPUÉS del
 *  GLOBAL_STYLE del layout para ganar por cascada. Vacío si no hay overrides. */
export function brandingStyle(env: Env): string {
  const b = resolveBranding(env);
  if (!b.isCustom) return "";
  const parts: string[] = [];
  // 1. Preset de estilo PRIMERO: paleta + forma + scanlines. El accent ya viene
  //    resuelto (override del miembro aplicado). Va antes que surface/accent/font
  //    para que esos overrides del miembro puedan pisarlo encima.
  if (b.style) {
    parts.push(styleCss(STYLES[b.style], b.accent, b.accent2, b.accentSoft));
  }
  // 2. Superficies del miembro (BRAND_SURFACE) — pisan las del preset si ambos.
  if (b.surface) parts.push(surfaceTheme(b.surface));
  // 3. Accent del miembro cuando NO hay preset (con preset ya lo pintó styleCss).
  if (!b.style && (b.accent !== DEFAULT_ACCENT || b.accent2 !== DEFAULT_ACCENT_2)) {
    parts.push(`:root{--accent:${b.accent};--accent-2:${b.accent2};--accent-soft:${b.accentSoft}}`);
  }
  // 4. Fuente: el miembro (BRAND_FONT) gana; si no, la del preset.
  if (b.fontFamily) {
    const fam = `'${b.fontName}', ui-sans-serif, system-ui, sans-serif`;
    // El texto base + los títulos con inline 'Space Grotesk' (no usan var).
    parts.push(`body{font-family:${fam}}`);
    parts.push(`[style*="Space Grotesk"]{font-family:${fam} !important}`);
    // Bajo preset, la utilidad font-display (hardcodeada a Space Grotesk) también.
    if (b.style) parts.push(`.font-display{font-family:${fam} !important}`);
  } else if (b.style) {
    const p = STYLES[b.style];
    const bodyFam = `'${p.bodyFont}', ui-sans-serif, system-ui, sans-serif`;
    const displayFam =
      p.displayFont === p.bodyFont ? bodyFam : `'${p.displayFont}', Georgia, 'Times New Roman', serif`;
    parts.push(`body{font-family:${bodyFam}}`);
    // Títulos: inline 'Space Grotesk' + la utilidad Tailwind font-display.
    parts.push(`[style*="Space Grotesk"]{font-family:${displayFam} !important}`);
    parts.push(`.font-display{font-family:${displayFam} !important}`);
  }
  return parts.length ? `\n<style id="brand">${parts.join("")}</style>` : "";
}

/** El "logo + nombre" para el sidebar. Fallback: el wordmark HorizontesAgentOS. */
export function brandMark(env: Env): string {
  const b = resolveBranding(env);
  if (b.logoUrl) {
    return `<img src="${esc(b.logoUrl)}" alt="${esc(b.name)}" style="max-height:34px;max-width:170px;width:auto;object-fit:contain;display:block">`;
  }
  if (b.name !== DEFAULT_NAME) {
    return `<div style="font-family:'Space Grotesk';font-weight:700;font-size:15px;letter-spacing:-.02em;color:var(--cream)">${esc(b.name)}</div>`;
  }
  // Default Forja wordmark.
  return `<div style="font-family:'Space Grotesk';font-weight:700;font-size:15px;letter-spacing:-.02em">Horizontes<span style="color:var(--accent)">AgentOS</span></div>`;
}

/** true si se debe ocultar la marca Forja (Modo Agencia con hideForja). */
export function hidesForja(env: Env): boolean {
  return resolveBranding(env).hideForja;
}

/** Estilos válidos — para validar la entrada del panel y del control plane. */
export const STYLE_KEYS: readonly StyleKey[] = ["nimbus", "onyx", "terra"];
export function isValidStyle(v: string): v is StyleKey {
  return (STYLE_KEYS as readonly string[]).includes(v);
}

/** Aplica el branding EN CALIENTE: lee el estilo guardado en D1 (`brand_style`)
 *  y pisa `env.BRAND_STYLE`, para que cambiarlo desde el panel del bot o desde el
 *  control plane surta efecto SIN redeploy. Se llama en el middleware del panel,
 *  igual que applyTier/applyLanguage. El setting D1 manda sobre el wrangler.toml;
 *  vacío = respeta la env. Best-effort: si D1 falla, se queda con la env. */
export async function applyBranding(env: Env): Promise<void> {
  try {
    const s = (await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.brandStyle))?.trim();
    if (s) env.BRAND_STYLE = s;
  } catch {
    // best-effort — sin D1, el panel usa la env del wrangler.toml
  }
}
