/**
 * Idioma EFECTIVO del bot — el dueño lo cambia desde su panel, sin redesplegar.
 *
 * Antes el idioma vivía SOLO en `BOT_LANGUAGE` del wrangler.toml, así que
 * cambiarlo exigía editar un archivo y volver a desplegar. Varios miembros
 * preguntaron dónde se cambiaba; no se cambiaba en ningún lado.
 *
 * Mismo patrón que `tier.ts`, a propósito: el override vive en un ajuste de D1,
 * hay caché por isolate para no pegarle a la base en cada mensaje, y
 * `applyLanguage()` MUTA `env.BOT_LANGUAGE` al entrar. Así los cinco lugares
 * que ya leían esa variable —la API, el agente, el blindaje— siguen
 * funcionando sin tocarlos.
 *
 * El valor que llega al modelo no es un código seco ("es-ES") sino una
 * DESCRIPCIÓN ("español de España, de vosotros…"). Es lo que hace que separar
 * los dos españoles funcione de verdad: el modelo ya sabe hablar ambos, solo
 * hay que decirle cuál.
 */
import type { Env } from "./env";
import { Db } from "./db/client";
import { SettingsRepo, SETTING_KEYS } from "./db/settings";

const TTL_MS = 30_000;

/** Los idiomas que el dueño puede elegir en el panel. */
export const IDIOMAS = {
  "es-419": {
    etiqueta: "Español (Latinoamérica)",
    // Lo que se le inyecta al prompt en {{LANGUAGE}}.
    prompt: "español latinoamericano (de tú, natural y cercano; NUNCA uses 'vosotros')",
  },
  "es-ES": {
    etiqueta: "Español (España)",
    prompt:
      "español de España (usa 'vosotros' cuando hables en plural y expresiones de allá como 'vale'; NO uses mexicanismos como 'órale', 'ahorita' o 'platicar')",
  },
  en: {
    etiqueta: "English",
    prompt: "English",
  },
  "pt-BR": {
    etiqueta: "Português (Brasil)",
    prompt: "português do Brasil",
  },
} as const;

export type CodigoIdioma = keyof typeof IDIOMAS;

/** "Espeja al cliente" no es un idioma: es el modo que ya existía como
 *  superpoder Multi-idioma. Vive en la misma lista para que el dueño tenga UN
 *  solo control y no dos que se contradigan. */
export const ESPEJO = "espejo" as const;
export type OpcionIdioma = CodigoIdioma | typeof ESPEJO;

export function esCodigoValido(v: unknown): v is CodigoIdioma {
  return typeof v === "string" && v in IDIOMAS;
}

/**
 * Traduce lo que haya en `BOT_LANGUAGE` a una descripción para el prompt.
 *
 * Acepta códigos nuevos ("es-ES") y lo que ya traen los bots instalados
 * ("es-MX", "es", "en-US"…). Si no reconoce nada, devuelve el valor tal cual:
 * un bot con `BOT_LANGUAGE="catalán"` seguirá hablando catalán en vez de que
 * se lo cambiemos por debajo.
 */
export function descripcionIdioma(valor: string): string {
  const v = (valor || "").trim();
  if (esCodigoValido(v)) return IDIOMAS[v].prompt;

  const bajo = v.toLowerCase();
  if (bajo === "es-es" || bajo === "es_es") return IDIOMAS["es-ES"].prompt;
  if (bajo.startsWith("pt")) return IDIOMAS["pt-BR"].prompt;
  if (bajo.startsWith("en")) return IDIOMAS.en.prompt;
  // es, es-MX, es-419, es-CO… — lo que traen hoy los bots instalados.
  if (bajo.startsWith("es")) return IDIOMAS["es-419"].prompt;
  return v || IDIOMAS["es-419"].prompt;
}

let cache: { value: string | null; at: number } = { value: null, at: 0 };
// BOT_LANGUAGE del wrangler.toml capturado UNA vez por isolate, ANTES de que
// applyLanguage lo mute. Sin esto, un fallo de D1 tras un cambio leería la
// "base" del env ya mutado y el idioma anterior se volvería permanente.
let baseEstatica: string | null = null;

/** Deja el caché como si nunca se hubiera leído (tests / al guardar el ajuste). */
export function bustIdiomaCache(next?: string | null): void {
  cache = next ? { value: next, at: Date.now() } : { value: null, at: 0 };
  baseEstatica = null;
}

export async function idiomaEfectivo(env: Env): Promise<string> {
  if (baseEstatica === null) baseEstatica = env.BOT_LANGUAGE || "es-419";
  const ahora = Date.now();
  if (ahora - cache.at > TTL_MS) {
    try {
      const raw = await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.botLanguage);
      cache = { value: esCodigoValido(raw) ? raw : null, at: ahora };
    } catch {
      // D1 no disponible → caemos a la base ESTÁTICA y reintentamos al expirar.
      cache = { value: null, at: ahora };
    }
  }
  return cache.value ?? baseEstatica;
}

/** ¿El dueño eligió "espeja al cliente"? Reemplaza al viejo multi_language. */
export async function espejaAlCliente(env: Env): Promise<boolean> {
  try {
    const s = new SettingsRepo(new Db(env.DB));
    if ((await s.get(SETTING_KEYS.botLanguage)) === ESPEJO) return true;
    // Compatibilidad: bots que ya tenían encendido el superpoder Multi-idioma
    // antes de que existiera este selector.
    return (await s.get(SETTING_KEYS.multiLanguage)) === "1";
  } catch {
    return false;
  }
}

/** Muta env.BOT_LANGUAGE al valor efectivo — se llama junto a applyTier(). */
export async function applyLanguage(env: Env): Promise<void> {
  env.BOT_LANGUAGE = await idiomaEfectivo(env);
}

/** Resuelve el idioma del PANEL y lo deja en env para las vistas. */
export async function applyPanelLanguage(env: Env): Promise<void> {
  try {
    const v = await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.panelLanguage);
    if (v) (env as { PANEL_LANGUAGE?: string }).PANEL_LANGUAGE = v;
  } catch {
    // Sin D1 el panel cae al idioma del bot — nunca se queda sin renderizar.
  }
}
