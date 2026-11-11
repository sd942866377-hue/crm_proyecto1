/**
 * Mutaciones de settings compartidas — UNA sola tabla de validadores y UNA sola
 * definición de los superpoderes, para que el panel (/admin/config), el control
 * plane (POST /api/settings) y el Centro de Mantenimiento de la app
 * (GET/PATCH /api/maintenance) no puedan desincronizarse.
 *
 * Antes esto vivía dentro de api.ts; se sacó aquí cuando la app ganó su propio
 * PATCH: dos listas de "qué se puede cambiar y con qué forma" habrían derivado
 * la primera vez que alguien agregara un superpoder.
 *
 * REGLA DE SEGURIDAD (Contrato v3.3 §6): el mapa ES el whitelist. Un key sin
 * validador NO se escribe, y `NEVER_WRITABLE` fija por escrito lo que jamás
 * puede aceptarse aunque alguien le agregue un validador por descuido.
 */
import { SETTING_KEYS } from "./db/settings";
import { isValidStyle } from "./admin/branding";

// ── Validadores de valor ─────────────────────────────────────────────────────

export const bool01 = (v: string) => v === "0" || v === "1";

/** Idioma leniente igual que idioma.ts (es, es-MX, es-419, pt-BR, en, espejo),
 *  pero SIN caracteres raros (bloquea inyección): 2 letras + sufijo opcional. */
export const langOk = (v: string) =>
  v === "" || v === "espejo" || /^[a-z]{2}(-[A-Za-z0-9]{2,4})?$/.test(v);

/** Texto corto SIN HTML (bloquea `<`/`>` en el origen: nada de XSS almacenado). */
export const shortText = (max: number) => (v: string) => v.length <= max && !/[<>]/.test(v);

/** Cerebro del bot: los MISMOS tres valores que normaliza settings-loader. */
export const modelOverrideOk = (v: string) => v === "auto" || v === "haiku" || v === "sonnet";

/** Tope mensual en USD: entero/decimal de hasta 2 cifras, 0..1000. "0" = sin
 *  tope explícito y "" = default del bot ($25) — la misma semántica que lee
 *  settings-loader. */
export const monthlyBudgetOk = (v: string) =>
  v === "" || (/^\d{1,4}(\.\d{1,2})?$/.test(v) && Number.parseFloat(v) <= 1000);

/** Instrucciones adicionales del dueño: texto libre (el LLM lo lee, no el DOM)
 *  con tope de largo. Los marcadores gestionados se limpian aparte, en
 *  voice-blocks.ts — aquí solo se acota el tamaño. */
export const CUSTOM_INSTRUCTIONS_MAX = 16000;
export const customInstructionsOk = (v: string) => v.length <= CUSTOM_INSTRUCTIONS_MAX;

/**
 * Info del negocio (BLOB `business_context`). El texto va DENTRO de
 * <business_context>…</business_context> en el system prompt (system-prompt.ts).
 * El dueño es de confianza, pero defensa en profundidad: no vaciar (evita wipe
 * accidental), no pasarse de largo, no CERRAR el tag ni ABRIR ninguna otra
 * sección de sistema del prompt, y no colar los marcadores internos de la app
 * ([[forja-app:*]]). La lista de tags refleja TODAS las secciones tag-eadas del
 * TEMPLATE de system-prompt.ts — impedir abrir/cerrar cualquiera de ellas.
 */
export const BUSINESS_CONTEXT_MAX = 12000;
export const businessContextOk = (v: string): boolean =>
  v.trim().length > 0 &&
  v.length <= BUSINESS_CONTEXT_MAX &&
  !/<\/?(business_context|core_principles|anti_patterns|escalation_rules|style_guide|tools|output_language|identity_and_voice|role|moneda|brand_voice|custom_instructions|botones|galeria|lecciones_aprendidas)\b/i.test(
    v,
  ) &&
  !/\[\[\s*forja-app\s*:/i.test(v);

/**
 * Settings escribibles en REMOTO (control plane / app), CON su validador de
 * valor. Solo lo HOT + no-sensible que se administra como servicio: nunca
 * llaves, secrets, prompt override ni nada de Equipo. Cada valor se valida
 * ESTRICTO — un valor fuera de forma se rechaza (defensa en profundidad aunque
 * el writer sea de confianza).
 */
export const SETTING_VALIDATORS: Record<string, (v: string) => boolean> = {
  [SETTING_KEYS.brandStyle]: (v) => v === "" || isValidStyle(v),
  [SETTING_KEYS.botPaused]: bool01,
  // Epoch ms futuro razonable (10-16 dígitos) o vacío para limpiar la pausa temporal.
  [SETTING_KEYS.botPausedUntil]: (v) => v === "" || /^\d{10,16}$/.test(v),
  [SETTING_KEYS.buttonsEnabled]: bool01,
  [SETTING_KEYS.galeriaEnabled]: bool01,
  [SETTING_KEYS.dailyReport]: bool01,
  [SETTING_KEYS.multiLanguage]: bool01,
  [SETTING_KEYS.satisfactionSurvey]: bool01,
  [SETTING_KEYS.reengageColdLeads]: bool01,
  [SETTING_KEYS.reviewRequests]: bool01,
  [SETTING_KEYS.paymentsEnabled]: bool01,
  [SETTING_KEYS.bovedaEnabled]: bool01,
  [SETTING_KEYS.salesHunter]: bool01,
  [SETTING_KEYS.blindajeEnabled]: (v) => v === "on" || v === "off",
  [SETTING_KEYS.blindajeMode]: (v) => v === "full" || v === "negaciones" || v === "off",
  [SETTING_KEYS.surveyMode]: (v) => v === "numerico" || v === "abierto" || v === "ambos",
  [SETTING_KEYS.botLanguage]: langOk,
  [SETTING_KEYS.panelLanguage]: langOk,
  [SETTING_KEYS.botCurrency]: shortText(4),
  [SETTING_KEYS.botName]: (v) => v.length >= 1 && shortText(60)(v),
  [SETTING_KEYS.tone]: shortText(300),
  // Los dos que agregó el Centro de Mantenimiento (v3.3): cerebro y tope de
  // gasto. Reversibles al instante y sin secretos, como el resto de la tabla.
  [SETTING_KEYS.modelOverride]: modelOverrideOk,
  [SETTING_KEYS.monthlyBudget]: monthlyBudgetOk,
  [SETTING_KEYS.customInstructions]: customInstructionsOk,
};

/**
 * Lista NEGRA explícita (Contrato v3.3 §6). No se aceptan JAMÁS desde la nube
 * ni desde la app, pase lo que pase: prompt override, llaves/secrets del
 * proveedor, tools crudas, tier (solo POST /api/tier lo mueve), config de
 * canales/integraciones y todo lo de Equipo del panel. Un test fija esta lista
 * contra SETTING_VALIDATORS: si alguien le pone validador a una de estas, el
 * test truena antes de que llegue a producción.
 */
export const NEVER_WRITABLE: readonly string[] = [
  SETTING_KEYS.systemPromptOverride,
  SETTING_KEYS.llmApiKey,
  SETTING_KEYS.llmProvider,
  SETTING_KEYS.llmModel,
  SETTING_KEYS.disabledTools,
  SETTING_KEYS.staffTabs,
  SETTING_KEYS.tierOverride,
  SETTING_KEYS.businessContext,
  SETTING_KEYS.twilioHandoffContentSid,
  SETTING_KEYS.composioContext,
  SETTING_KEYS.selfOrigin,
  SETTING_KEYS.learnedLessons,
  SETTING_KEYS.brandLogo,
  SETTING_KEYS.reportTemplate,
] as const;

/** ¿Este key está prohibido para siempre? (fail-closed antes de cualquier set) */
export function isNeverWritable(key: string): boolean {
  return NEVER_WRITABLE.includes(key);
}

// ── Superpoderes ─────────────────────────────────────────────────────────────

/** Ids públicos de los superpoderes (los del contrato con la app). */
export type SuperpowerId =
  | "salesHunter"
  | "blindaje"
  | "dailyReport"
  | "multiLanguage"
  | "satisfactionSurvey"
  | "reengage"
  | "reviews"
  | "payments"
  | "boveda";

export interface SuperpowerDef {
  id: SuperpowerId;
  /** Setting donde vive el on/off. */
  key: string;
  /** Cómo se codifica: "1"/"0" o, para el Blindaje, "on"/"off". */
  encoding: "bool01" | "onoff";
  /** Estado cuando el setting está AUSENTE (Cazador y Blindaje vienen ON). */
  defaultOn: boolean;
  /**
   * Superpoder Forja+. OJO: son los NUEVE — el gate real es el del panel (la
   * sección de superpoderes solo se renderiza y solo se guarda en Pro) y el del
   * runtime (runFollowups/runOutreach/runReengage/dailyReport/blindaje/bóveda y
   * el espejo de idioma cortan con isPro). El ejemplo del contrato listaba 7
   * porque dejaba fuera Cazador y Multi-idioma, pero en free esos dos tampoco
   * corren: prometerlos editables sería mentirle al dueño.
   */
  pro: boolean;
}

export const SUPERPOWERS: readonly SuperpowerDef[] = [
  { id: "salesHunter", key: SETTING_KEYS.salesHunter, encoding: "bool01", defaultOn: true, pro: true },
  { id: "blindaje", key: SETTING_KEYS.blindajeEnabled, encoding: "onoff", defaultOn: true, pro: true },
  { id: "dailyReport", key: SETTING_KEYS.dailyReport, encoding: "bool01", defaultOn: false, pro: true },
  { id: "multiLanguage", key: SETTING_KEYS.multiLanguage, encoding: "bool01", defaultOn: false, pro: true },
  { id: "satisfactionSurvey", key: SETTING_KEYS.satisfactionSurvey, encoding: "bool01", defaultOn: false, pro: true },
  { id: "reengage", key: SETTING_KEYS.reengageColdLeads, encoding: "bool01", defaultOn: false, pro: true },
  { id: "reviews", key: SETTING_KEYS.reviewRequests, encoding: "bool01", defaultOn: false, pro: true },
  { id: "payments", key: SETTING_KEYS.paymentsEnabled, encoding: "bool01", defaultOn: false, pro: true },
  { id: "boveda", key: SETTING_KEYS.bovedaEnabled, encoding: "bool01", defaultOn: false, pro: true },
] as const;

export const SUPERPOWERS_PRO: readonly SuperpowerId[] = SUPERPOWERS.filter((s) => s.pro).map(
  (s) => s.id,
);

export function findSuperpower(id: string): SuperpowerDef | undefined {
  return SUPERPOWERS.find((s) => s.id === id);
}

/** Estado EFECTIVO de un superpoder a partir del valor crudo del setting. */
export function superpowerIsOn(def: SuperpowerDef, raw: string | undefined): boolean {
  const v = raw ?? "";
  if (def.encoding === "onoff") return def.defaultOn ? v !== "off" : v === "on";
  return def.defaultOn ? v !== "0" : v === "1";
}

/** Valor a persistir para dejar el superpoder prendido/apagado. */
export function superpowerValue(def: SuperpowerDef, on: boolean): string {
  if (def.encoding === "onoff") return on ? "on" : "off";
  return on ? "1" : "0";
}

/** Los nueve superpoderes leídos de un `settings.all()`. Lo comparten
 *  GET /api/config y GET /api/maintenance: un solo lugar donde equivocarse. */
export function readSuperpowers(all: Record<string, string>): Record<SuperpowerId, boolean> {
  const out = {} as Record<SuperpowerId, boolean>;
  for (const def of SUPERPOWERS) out[def.id] = superpowerIsOn(def, all[def.key]);
  return out;
}
