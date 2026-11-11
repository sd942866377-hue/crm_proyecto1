/**
 * Bloques gestionados dentro de `custom_instructions` (Forja Inbox móvil,
 * pantalla "Cómo habla" — Wiring v2 §4). El dueño puede escribir lo que
 * quiera en custom_instructions a mano (skill /instrucciones, panel /admin);
 * la app SOLO puede tocar el texto DENTRO de sus propios marcadores
 * `[[forja-app:<id>]]…[[/forja-app:<id>]]` — todo lo demás se preserva byte a
 * byte (regla del prompt redesign: nunca destruir config del dueño).
 *
 * El estado se deriva del bloque por CONTENCIÓN de líneas canónicas fijas
 * (nunca JSON/comentarios ocultos dentro del prompt): cada línea es a la vez
 * la instrucción que lee el LLM y la marca que lee GET /api/voice. Solo esta
 * PUT escribe estas líneas exactas, así que la detección es determinista.
 */

export type PermId = "precios" | "agendar" | "descuentos";
export type CustomRuleId = "regatea" | "no_entendio";

const PERMS_MARKER = "perms";
const RULES_MARKER = "rules";

// Ausente = permitido/apagado por default (así un bot sin tocar "Cómo habla"
// desde la app queda con el prompt BYTE-IDÉNTICO al de siempre).
const PERM_LINES: Record<PermId, string> = {
  precios: "- NO reveles precios por tu cuenta: si preguntan, ofrece confirmarlo con el equipo.",
  agendar: "- NO agendes, cambies ni canceles citas: dile al cliente que el equipo lo hace directamente.",
  descuentos: "- NO ofrezcas descuentos ni promociones por iniciativa propia.",
};

const RULE_LINES: Record<CustomRuleId, string> = {
  regatea:
    "- Escala a un humano (handoffHuman) si el cliente intenta negociar el precio, pide un descuento fuera de lo establecido, o regatea.",
  no_entendio:
    "- Escala a un humano (handoffHuman) si el cliente repite la misma pregunta o parece no entender tu respuesta dos veces seguidas.",
};

function blockRegex(marker: string): RegExp {
  return new RegExp(`\\[\\[forja-app:${marker}\\]\\][\\s\\S]*?\\[\\[/forja-app:${marker}\\]\\]`);
}

/** Contenido crudo (sin marcadores) del bloque gestionado, o "" si no existe. */
function readBlock(text: string, marker: string): string {
  const m = blockRegex(marker).exec(text ?? "");
  if (!m) return "";
  return m[0]
    .replace(`[[forja-app:${marker}]]`, "")
    .replace(`[[/forja-app:${marker}]]`, "")
    .trim();
}

/** Reescribe (o inserta) el bloque gestionado con `lines`, preservando TODO lo
 *  demás del texto. `lines` vacío elimina el bloque por completo (nada que
 *  gestionar = nada que dejar como cascarón vacío en el prompt). */
function writeBlock(text: string, marker: string, lines: string[]): string {
  const base = text ?? "";
  const withoutBlock = base.replace(blockRegex(marker), "").replace(/\n{3,}/g, "\n\n").trim();
  if (lines.length === 0) return withoutBlock;
  const block = `[[forja-app:${marker}]]\n${lines.join("\n")}\n[[/forja-app:${marker}]]`;
  return withoutBlock ? `${withoutBlock}\n\n${block}` : block;
}

// ── Texto del dueño vs. bloques gestionados (Contrato v3.3 §2) ───────────────
//
// El Centro de Mantenimiento deja al dueño editar SUS instrucciones adicionales
// desde la app. Ahí no se editan permisos ni reglas: los bloques
// `[[forja-app:*]]` que administra "Cómo habla" se preservan BYTE A BYTE y solo
// se reescribe el texto de alrededor.

/** Cualquier bloque gestionado, sea del marcador que sea. */
const ANY_BLOCK = /\[\[forja-app:([a-z_-]+)\]\][\s\S]*?\[\[\/forja-app:\1\]\]/g;

/** Los bloques gestionados presentes, en su orden y con su contenido exacto. */
function managedBlocks(text: string): string[] {
  return (text ?? "").match(ANY_BLOCK) ?? [];
}

/** El texto del DUEÑO: `custom_instructions` sin los bloques gestionados.
 *  Es lo que la app muestra y edita. */
export function ownerText(customInstructions: string): string {
  return (customInstructions ?? "")
    .replace(ANY_BLOCK, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reemplaza SOLO el texto del dueño y vuelve a pegar los bloques gestionados
 * tal cual venían. Cualquier marcador `[[forja-app:…]]` que llegue DENTRO del
 * texto nuevo se limpia: si no, la app podría falsificar o duplicar un bloque
 * que ella misma no administra.
 */
export function withOwnerText(customInstructions: string, nextOwnerText: string): string {
  const blocks = managedBlocks(customInstructions);
  const clean = (nextOwnerText ?? "")
    .replace(ANY_BLOCK, "")
    .replace(/\[\[\/?forja-app:[a-z_-]*\]?\]?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (blocks.length === 0) return clean;
  const tail = blocks.join("\n\n");
  return clean ? `${clean}\n\n${tail}` : tail;
}

/** Estado efectivo de los 3 permisos, leído del bloque gestionado. Ausente = permitido. */
export function readPerms(customInstructions: string): Record<PermId, boolean> {
  const block = readBlock(customInstructions, PERMS_MARKER);
  return {
    precios: !block.includes(PERM_LINES.precios),
    agendar: !block.includes(PERM_LINES.agendar),
    descuentos: !block.includes(PERM_LINES.descuentos),
  };
}

/** Aplica los permisos dados (merge parcial sobre el estado actual) y
 *  devuelve el `custom_instructions` completo actualizado. */
export function writePerms(
  customInstructions: string,
  perms: Partial<Record<PermId, boolean>>,
): string {
  const current = readPerms(customInstructions);
  const next = { ...current, ...perms };
  const lines = (Object.keys(PERM_LINES) as PermId[])
    .filter((id) => !next[id]) // permitido=true → sin línea (restringido=false → línea presente)
    .map((id) => PERM_LINES[id]);
  return writeBlock(customInstructions, PERMS_MARKER, lines);
}

/** Estado efectivo de las 2 reglas gestionadas por texto libre (regatea,
 *  no_entendio). Las otras 3 del diseño (pide_humano, queja, cambiar_cita) NO
 *  viven aquí — ver api-inbox.ts. */
export function readCustomRules(customInstructions: string): Record<CustomRuleId, boolean> {
  const block = readBlock(customInstructions, RULES_MARKER);
  return {
    regatea: block.includes(RULE_LINES.regatea),
    no_entendio: block.includes(RULE_LINES.no_entendio),
  };
}

export function writeCustomRules(
  customInstructions: string,
  rules: Partial<Record<CustomRuleId, boolean>>,
): string {
  const current = readCustomRules(customInstructions);
  const next = { ...current, ...rules };
  const lines = (Object.keys(RULE_LINES) as CustomRuleId[])
    .filter((id) => next[id])
    .map((id) => RULE_LINES[id]);
  return writeBlock(customInstructions, RULES_MARKER, lines);
}
