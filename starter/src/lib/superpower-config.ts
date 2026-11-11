/**
 * Estado de CONFIGURACIÓN de cada superpoder, en vivo (env + settings). Fuente
 * ÚNICA para las dos piezas del Contrato v3.3.1:
 *   (§1) el `superpowers_meta` del GET /api/maintenance, y
 *   (§2) la reja del PATCH que impide "prender" un superpoder que no funcionaría.
 *
 * Los checks de "¿está configurado X?" ESPEJAN uno a uno los del panel
 * (src/admin/views/config.ts → renderSuperpoderesSection): reviewOk, stripeOk,
 * mediaOk, waTemplateOk. Un solo lugar donde equivocarse — si el panel y la app
 * juzgaran distinto, un toggle mentiría.
 *
 * Fail-open en lectura (§7): si un check no puede determinarse, `configured:true`
 * para no bloquear de más. El toggle no miente por eso, porque el runtime del
 * superpoder igual valida su prerequisito (p. ej. la tool de Cobros checa
 * STRIPE_SECRET_KEY antes de cobrar); y el PATCH, aun así, valida antes de prender.
 */
import type { Env } from "../env";
import { SETTING_KEYS } from "../db/settings";
import { stripeConfigured } from "../integrations/stripe";
import { SUPERPOWERS, type SuperpowerId } from "../settings-mutations";

/**
 * Entrada de `superpowers_meta` (§1). Para los toggles limpios solo viaja
 * `configurable:false`; para los que piden setup, el estado en vivo + los datos
 * para guiar al dueño al panel (`hint`/`panel`), presentes SOLO cuando de verdad
 * falta algo (iOS únicamente los usa con `configured:false`).
 */
export interface SuperpowerMetaEntry {
  configurable: boolean;
  configured?: boolean;
  needs?: string[];
  hint?: string;
  panel?: string;
}

/** Descriptor estático + check en vivo de un superpoder que REQUIERE setup. */
interface ConfigurableDescriptor {
  /** Prerequisitos que la app nombra (para el deep-link / instrucción). */
  needs: string[];
  /** Texto para el dueño cuando falta configurarlo. */
  hint?: string;
  /** Slug de la sección del panel donde se arregla. */
  panel?: string;
  /** ¿Está configurado en vivo? Fail-open: true cuando no se puede saber. */
  isConfigured: (env: Env, settings: Record<string, string>) => boolean;
}

/**
 * Los superpoderes con prerequisito. Los otros cuatro (salesHunter, blindaje,
 * dailyReport, multiLanguage) son toggle limpio → NO aparecen aquí y salen como
 * `{ configurable:false }`. Cada `isConfigured` copia el juicio del panel.
 */
const CONFIGURABLE: Partial<Record<SuperpowerId, ConfigurableDescriptor>> = {
  // survey_mode tiene default válido ("numerico") → siempre cuenta como
  // configurado (§7). Es `configurable:true` porque el modo SE puede cambiar,
  // pero nunca bloquea: iOS lo pinta como toggle normal.
  satisfactionSurvey: {
    needs: [],
    isConfigured: () => true,
  },
  // reviewOk (config.ts): el link de reseña de Google, no vacío.
  reviews: {
    needs: ["review_url"],
    hint: "Falta el link de reseña",
    panel: "reviews",
    isConfigured: (_env, s) => (s[SETTING_KEYS.reviewUrl] ?? "").trim() !== "",
  },
  // waTemplateOk (config.ts): SID (Twilio) O nombre (Cloud API) de la plantilla
  // aprobada de WhatsApp para reenganchar fuera de la ventana de 24h.
  reengage: {
    needs: ["reengage_template"],
    hint: "Falta una plantilla aprobada de WhatsApp",
    panel: "reengage",
    isConfigured: (_env, s) =>
      (s[SETTING_KEYS.reengageTemplateSid] ?? "").trim() !== "" ||
      (s[SETTING_KEYS.reengageTemplateName] ?? "").trim() !== "",
  },
  // stripeOk (config.ts): la llave secreta de Stripe del miembro. Los precios los
  // arma el bot inline por monto (integrations/stripe.ts crea el price al vuelo)
  // — no hay catálogo local que checar, así que "prices" viaja en `needs` como
  // paso de setup para el dueño pero no forma parte del gate (§7, fail-open).
  payments: {
    needs: ["stripe", "prices"],
    hint: "Conecta Stripe y define precios",
    panel: "cobros",
    isConfigured: (env) => stripeConfigured(env),
  },
  // mediaOk (config.ts): el binding R2 de la Bóveda ya provisionado (skill /boveda).
  boveda: {
    needs: ["r2"],
    hint: "Necesita almacenamiento (se activa desde el panel)",
    panel: "boveda",
    isConfigured: (env) => !!env.MEDIA,
  },
};

/**
 * Estado de configuración de UN superpoder. Lo usan tanto el `superpowers_meta`
 * como la reja del PATCH (§2), para que "lo que la app ve" y "lo que el backend
 * deja prender" no puedan desincronizarse.
 */
export function superpowerConfig(
  id: SuperpowerId,
  env: Env,
  settings: Record<string, string>,
): SuperpowerMetaEntry {
  const desc = CONFIGURABLE[id];
  if (!desc) return { configurable: false };

  const configured = desc.isConfigured(env, settings);
  const entry: SuperpowerMetaEntry = { configurable: true, configured, needs: desc.needs };
  // hint/panel SOLO cuando de verdad falta algo: el payload nunca dice "Falta X"
  // sobre algo ya configurado (iOS únicamente los lee con configured:false).
  if (!configured) {
    if (desc.hint) entry.hint = desc.hint;
    if (desc.panel) entry.panel = desc.panel;
  }
  return entry;
}

/** `superpowers_meta` completo (§1): una entrada por cada superpoder. */
export function superpowersMeta(
  env: Env,
  settings: Record<string, string>,
): Record<SuperpowerId, SuperpowerMetaEntry> {
  const out = {} as Record<SuperpowerId, SuperpowerMetaEntry>;
  for (const def of SUPERPOWERS) out[def.id] = superpowerConfig(def.id, env, settings);
  return out;
}
