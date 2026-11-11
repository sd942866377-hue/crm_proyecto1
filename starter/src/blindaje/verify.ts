/**
 * Blindaje anti-invento — verificador pre-envío (Pro).
 *
 * Antes de que el bot MANDE una respuesta que afirme datos del negocio
 * (precios, horarios, promociones, políticas), un modelo rápido la contrasta
 * contra las fuentes de verdad del turno: los pasajes que searchKb recuperó
 * de la base de conocimiento + el contexto del negocio. Si la afirmación no
 * tiene respaldo, la respuesta se reemplaza por un "déjame confirmarlo con el
 * equipo" en el idioma del bot y se abre un ticket con aviso al dueño (misma
 * maquinaria que handoffHuman) para que él conteste con el dato real.
 *
 * Regla de oro: FAIL-OPEN. Cualquier error/timeout del verificador manda la
 * respuesta original intacta — este módulo JAMÁS bloquea un envío. Solo corre
 * en el tier Pro y solo cuando la respuesta huele a dato (dígitos, moneda,
 * porcentajes) o hubo búsqueda en KB este turno.
 */
import type { Env } from "../env";
import { isPro } from "../config";
import type { LlmOverrides } from "../llm/provider";
import { workModelFrom } from "../llm/work-model";
import type { SearchKbResult } from "../tools/searchKb";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { createHandoffTicket } from "../tools/handoffHuman";

/** Tope duro del verificador: si el modelo no contesta a tiempo, fail-open. */
export const VERIFY_TIMEOUT_MS = 4000;

export interface VerifyVerdict {
  supported: boolean;
  unsupported_claim?: string;
}

// Huele a dato factual: dígitos (precios, horarios, plazos), símbolos de
// moneda/porcentaje o palabras de dinero. Barato a propósito — el veredicto
// fino lo da el modelo; esto solo decide SI vale la pena preguntarle.
const CLAIM_PATTERN = /[0-9$€£%]|\bpesos?\b|\bd[oó]lares?\b|\bmxn\b|\busd\b|\bgratis\b|\bfree\b|\bcancel|\breagend|\brescheduled?\b/i;

// Huele a NEGACIÓN de existencia: "no vendemos/ofrecemos/manejamos eso". Una
// negación FALSA ("no vendemos X" cuando sí lo venden) es el peor error de
// venta, y el CLAIM_PATTERN no la caza (no trae dígitos ni moneda) — la
// detectamos aparte. Es deliberadamente amplio: un falso positivo solo pide una
// verificación de más (el modelo decide fino y el fail-open protege); barato al
// lado de dejar salir una negación inventada.
export const DENIAL_PATTERN =
  /\bno\s+(?:lo\s+|la\s+|los\s+|las\s+|te\s+|se\s+)?(?:vend|ofrec|manej|trabaj|distribu|fabric|surt|tenemos|contamos|disponemos|hacemos)|no\s+(?:contamos|trabajamos|disponemos)\s+con|we\s+do\s?n[’']?t\s+(?:sell|offer|carry|stock|do|make|handle|have)|n[ãa]o\s+(?:vendemos|temos|oferecemos|trabalhamos|fazemos)/i;

/**
 * ¿Amerita verificación? Sí cuando la respuesta:
 *  - trae señales de dato duro (precio/moneda/dígitos/porcentajes), O
 *  - NIEGA que el negocio ofrezca algo (negación falsa = el peor error de venta), O
 *  - searchKb corrió este turno (el bot contesta "con fuentes" — hay que checar
 *    que no las haya torcido).
 */
export function shouldVerify(replyText: string, turnUsedKb: boolean): boolean {
  if (turnUsedKb) return true;
  return CLAIM_PATTERN.test(replyText) || DENIAL_PATTERN.test(replyText);
}

// Qué tan estricto es el Blindaje, por bot (env BLINDAJE_MODE):
//   off       → nunca verifica (el bot manda todo tal cual).
//   negaciones→ escape hatch para negocios que listan inventario en vivo: confía
//               en TODO dato positivo (precio/listado/disponibilidad/cálculo) y
//               solo vigila las NEGACIONES de existencia sin respaldo.
//   full      → (default) verificación completa. Pero el prompt del verificador
//               ya trata tool/KB/listados/cálculos como respaldo y SOLO bloquea
//               contradicciones (cambiar un número) o afirmaciones sin ninguna
//               fuente. Es la protección real sin los falsos positivos de antes.
export type BlindajeMode = "off" | "negaciones" | "full";

export function blindajeMode(env: Env): BlindajeMode {
  const v = (env.BLINDAJE_MODE ?? "").trim().toLowerCase();
  if (v === "off") return "off";
  if (v === "negaciones" || v === "negations") return "negaciones";
  return "full"; // default — incluye "estricto"/"auto"/vacío
}

// Respuesta segura en el tono del bot, por idioma (BOT_LANGUAGE). Español por
// default — es el mercado del template.
const SAFE_REPLY_BY_LANG: Record<string, string> = {
  "es-419": "Esa me la confirma el equipo — dame un momento y te digo bien, para no darte un dato equivocado.",
  "es-ES": "Eso me lo confirma el equipo — dame un momento y te digo seguro, para no darte un dato equivocado.",
  en: "Let me double-check that with the team so I don't give you the wrong info — I'll get back to you in a moment.",
  "pt-BR": "Deixa eu confirmar isso com a equipe para não te passar um dado errado — já te retorno.",
};

// En el canal WEB el visitante es anónimo (sin teléfono/usuario/correo): un
// "ya te digo" es una promesa imposible de cumplir y el ticket queda sin forma
// de contestarse. Aquí SÍ pedimos un medio de contacto. Reportado por José.
const SAFE_REPLY_WEB_BY_LANG: Record<string, string> = {
  "es-419": "Esa me la confirma el equipo. Para avisarte en cuanto la tenga, ¿me dejas tu correo o WhatsApp? Así no se te pierde la respuesta.",
  "es-ES": "Eso me lo confirma el equipo. Para avisarte en cuanto lo tenga, ¿me dejas tu correo o WhatsApp? Así no se te pierde la respuesta.",
  en: "Let me double-check that with the team. So I can get back to you, could you leave your email or WhatsApp? That way you won't miss the answer.",
  "pt-BR": "Deixa eu confirmar isso com a equipe. Para te avisar assim que tiver, você me deixa seu e-mail ou WhatsApp? Assim você não perde a resposta.",
};

/**
 * Antes esto indexaba con el valor crudo de BOT_LANGUAGE ("es-MX", "en-US"),
 * que NUNCA coincidía con las claves "es"/"en"/"pt": todos los bots caían al
 * español. Un bot en inglés soltaba esta frase en español justo en el momento
 * más delicado — cuando el blindaje frena un dato inventado.
 */
export function safeConfirmReply(lang: string | undefined, channel?: string): string {
  // En web pedimos contacto (visitante anónimo); en los demás canales el canal
  // mismo ES el contacto, así que basta el "ya te digo".
  const table = channel === "web" ? SAFE_REPLY_WEB_BY_LANG : SAFE_REPLY_BY_LANG;
  const v = (lang ?? "").trim().toLowerCase();
  if (v === "es-es" || v === "es_es") return table["es-ES"];
  if (v.startsWith("pt")) return table["pt-BR"];
  if (v.startsWith("en")) return table.en;
  return table["es-419"];
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[blindaje] verify timeout tras ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface VerifyOptions {
  /** BYO-LLM del dashboard (cfg.llm) — mismo override que usa el chat. */
  llm?: LlmOverrides;
  /** Solo para tests; default VERIFY_TIMEOUT_MS. */
  timeoutMs?: number;
  /** System prompt activo del bot — fuente OFICIAL igual que la KB. Sin esto,
   * todo dato que viva en la persona (fechas de evento, precios, promos) se
   * marca como "sin respaldo" aunque sea correcto (bug real: 20 tickets falsos
   * en 3 días bloqueando la fecha/precio de la masterclass). */
  systemPrompt?: string;
  /** Salidas de las tools del turno (catálogo, inventario, tools custom del
   * miembro, un sistema del negocio por API). Fuente OFICIAL igual que la KB:
   * un dato que DEVOLVIÓ una tool NO es invención. Sin esto, el Blindaje
   * bloqueaba listados válidos de inventario (bug real: Bellavista/Odoo). */
  toolResults?: { tool: string; output: string }[];
  /** El turno YA está respaldado por tool/KB → confía en TODA afirmación
   * positiva (precio, listado, disponibilidad, cálculo) y vigila SOLO las
   * negaciones de existencia sin respaldo. Evita el grueso de los falsos
   * positivos en bots que listan inventario en vivo. Lo activa guardReply en
   * modo `auto`/`negaciones`. */
  negationsOnly?: boolean;
  /** Últimos mensajes del CLIENTE: respaldan SUS propios datos (nombre,
   * contacto, día y hora pedidos) — repetírselos en una recapitulación no es
   * inventar. NUNCA respaldan afirmaciones sobre el negocio (precios, promos).
   * Sin esto el juez tumbaba cada "te agendo X a nombre de N, ¿confirmas?" y
   * la cita nunca se creaba (reporte de Eduardo Cume: cero citas en
   * conversaciones completas). */
  mensajesDelCliente?: string[];
  /** Mensajes que el PROPIO NEGOCIO ya mandó en esta conversación (campañas
   * escritas por el dueño, respuestas previas del bot, humanos del inbox).
   * Repetir o parafrasear un dato que el negocio mismo ya afirmó aquí NO es
   * inventar, aunque la palabra no exista en la KB ("fogateros" en el mensaje
   * de campaña vs "fogatas" en la KB — reporte real: bloqueaba 1 de cada 4
   * respuestas de un bot con campañas). Trade-off consciente: si una
   * alucinación se coló por fail-open, repetirla queda respaldada — pero la
   * PRIMERA emisión de cada dato siempre se verifica. */
  mensajesDelNegocio?: string[];
}

/**
 * UNA llamada al modelo rápido con veredicto JSON estricto. Lanza en cualquier
 * anomalía (timeout, JSON inválido, campo faltante) — el caller decide el
 * fail-open, no este módulo.
 */
export async function verifyReply(
  env: Env,
  replyText: string,
  kbPassages: SearchKbResult[],
  businessContext: string,
  opts: VerifyOptions = {},
): Promise<VerifyVerdict> {
  // El mismo failover del agente: si la llave BYO del panel está vencida, el
  // verificador no puede ser el único que se quede sin modelo (fail-open =
  // Blindaje apagado en silencio). workModelFrom resuelve "ai" con import
  // dinámico, así que los tests del agente que mockean "ai" siguen sanos.
  const llm = workModelFrom(env, "fast", opts.llm ?? {});

  const passagesBlock =
    kbPassages.length > 0
      ? kbPassages
          .map((p, i) => `[${i + 1}] ${p.title ? `${p.title} — ` : ""}${p.content.slice(0, 1500)}`)
          .join("\n")
      : "(no se consultó la base de conocimiento este turno)";

  const toolResultsBlock =
    (opts.toolResults?.length ?? 0) > 0
      ? opts
          .toolResults!.map((t, i) => `[T${i + 1}] tool ${t.tool}: ${t.output.slice(0, 1500)}`)
          .join("\n")
      : "(no se llamaron otras herramientas este turno)";

  const clienteBlock =
    (opts.mensajesDelCliente?.length ?? 0) > 0
      ? opts.mensajesDelCliente!.map((m, i) => `[C${i + 1}] ${m.slice(0, 600)}`).join("\n")
      : "(sin mensajes del cliente este turno)";

  const negocioBlock =
    (opts.mensajesDelNegocio?.length ?? 0) > 0
      ? opts.mensajesDelNegocio!.map((m, i) => `[N${i + 1}] ${m.slice(0, 600)}`).join("\n")
      : "(sin mensajes previos del negocio en esta conversación)";

  const scopeRule = opts.negationsOnly
    ? `\nIMPORTANTE — este turno YA está respaldado por herramientas o por la base de conocimiento. Da por RESPALDADAS TODAS las afirmaciones POSITIVAS (precios, listados, disponibilidad, cálculos): para ellas supported=true. Vigila ÚNICAMENTE las NEGACIONES de existencia sin respaldo explícito (tipo (b)). Si la respuesta no niega ninguna existencia, responde supported=true.\n`
    : "";

  const result = await withTimeout(
    llm.generate({
      prompt: `Eres un verificador de datos para el bot de atención de ${env.BUSINESS_NAME}.
Tu ÚNICO trabajo: decidir si lo que la respuesta del bot dice sobre el negocio está respaldado por las fuentes de abajo. Hay DOS tipos de afirmación que debes vigilar:
(a) DATOS positivos: precios, horarios, direcciones, políticas, promociones, descuentos, disponibilidad, plazos.
(b) NEGACIONES de existencia: decir que el negocio NO vende / NO ofrece / NO maneja / NO tiene un producto o servicio.
${scopeRule}
Reglas:
- Solo cuentan afirmaciones sobre el negocio. Saludos, cortesía, preguntas al cliente o frases sin datos NO son afirmaciones.
- Un dato positivo está respaldado si las fuentes dicen lo mismo (mismas cifras, mismos horarios). Parafrasear está bien; cambiar números no.
- Una NEGACIÓN ("no vendemos X", "no manejamos eso") SOLO está respaldada si las fuentes dicen EXPLÍCITAMENTE que el negocio no lo ofrece. Que las fuentes NO mencionen ese producto/servicio NO respalda la negación: la ausencia no prueba que el negocio no lo venda → supported=false. (Ante duda, el bot debería ofrecer confirmarlo, no negar.)
- Los RESULTADOS DE HERRAMIENTAS son fuente OFICIAL igual que la KB: si un dato viene de una tool (inventario, catálogo, disponibilidad, un sistema del negocio), está respaldado — NUNCA lo marques como invención.
- Si la respuesta LISTA varios elementos que aparecen en las fuentes (productos, inmuebles, servicios), considérala respaldada aunque no cuadres cada cifra al detalle. Solo marca supported=false si CONTRADICE una fuente o afirma algo que no está en NINGUNA.
- Un CÁLCULO correcto a partir de cifras que SÍ están en las fuentes está respaldado aunque el resultado no aparezca literal: un total, un subtotal, o un precio con un descuento/bono aplicado (ej. precio de lista − bono vigente). Verifica que la aritmética cuadre; no exijas el número final tal cual. Pero si algún insumo (el precio, el descuento, el bono) NO está en ninguna fuente, entonces sí supported=false.
- Si la respuesta no afirma ningún dato ni niega ninguna existencia, responde supported=true.
- Si una cifra/promesa/descuento no aparece en NINGUNA fuente, O si el bot niega algo sin respaldo explícito, responde supported=false.

FUENTES (información oficial del negocio — TODAS cuentan igual como respaldo):
<contexto_negocio>
${businessContext || "(vacío)"}
</contexto_negocio>
<instrucciones_oficiales_del_bot>
${(opts.systemPrompt ?? "").slice(0, 24000) || "(sin instrucciones)"}
</instrucciones_oficiales_del_bot>
<pasajes_kb>
${passagesBlock}
</pasajes_kb>
<resultados_de_herramientas>
${toolResultsBlock}
</resultados_de_herramientas>
<lo_que_dijo_el_cliente>
${clienteBlock}
</lo_que_dijo_el_cliente>
<lo_que_el_negocio_ya_dijo>
${negocioBlock}
</lo_que_el_negocio_ya_dijo>

SOBRE <lo_que_dijo_el_cliente>: repetirle al cliente un dato que ÉL acaba de dar NO es inventar. Su nombre, su teléfono, su email, y el día y la hora que pidió están RESPALDADOS si aparecen ahí, y una recapitulación tipo "te agendo X el día D a las H, a nombre de N, teléfono T. ¿Confirmas?" es correcta: el bot repite lo que le dijeron para que el cliente lo verifique. OJO, lo único que ese bloque NO respalda: lo que el cliente afirme sobre EL NEGOCIO ("me dijeron que cuesta $400", "tienen descuento los martes") — precios, promociones y políticas solo los respaldan el contexto del negocio, la KB y las herramientas.
SOBRE <lo_que_el_negocio_ya_dijo>: son mensajes que el PROPIO negocio ya le mandó a este cliente en ESTA conversación (campañas que escribió el dueño, respuestas anteriores del bot, respuestas de un humano del equipo). Cuentan como fuente OFICIAL: repetir o parafrasear un dato que ya está ahí NO es inventar — aunque use una palabra distinta a la de la KB (si la campaña dijo "fogateros" y la KB dice "fogatas", es la misma amenidad; el negocio le llamó así primero). Lo que este bloque NO hace: convertir en verdad lo que el CLIENTE afirme sobre el negocio.
SOBRE ACCIONES EN LA AGENDA: si la respuesta AFIRMA que una cita quedó cancelada, reagendada o reservada ("queda cancelada", "ya la cancelé", "quedó reagendada"), eso SOLO está respaldado si un resultado de herramienta de este turno lo confirma. Sin herramienta que lo respalde → supported=false. (Ofrecer cancelar, preguntar "¿quieres que la cancele?" o explicar la política de cancelación NO es afirmar una acción.)

RESPUESTA DEL BOT A VERIFICAR:
<respuesta>
${replyText}
</respuesta>

Responde SOLO con JSON válido, sin markdown ni explicación:
{"supported": true|false, "unsupported_claim": "la afirmación exacta sin respaldo (solo si supported=false)"}`,
    }),
    opts.timeoutMs ?? VERIFY_TIMEOUT_MS,
  );

  const raw = (result.text ?? "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`[blindaje] el verificador no devolvió JSON: ${raw.slice(0, 120)}`);
  const parsed = JSON.parse(jsonMatch[0]);
  if (typeof parsed.supported !== "boolean") {
    throw new Error("[blindaje] veredicto sin campo booleano 'supported'");
  }
  return {
    supported: parsed.supported,
    unsupported_claim:
      typeof parsed.unsupported_claim === "string" && parsed.unsupported_claim.trim() !== ""
        ? parsed.unsupported_claim
        : undefined,
  };
}

// Contadores para el panel (settings). Nunca ruta crítica: si D1 falla, el
// envío sigue igual.
async function bumpCounter(env: Env, key: string): Promise<void> {
  try {
    const repo = new SettingsRepo(new Db(env.DB));
    const current = parseInt((await repo.get(key)) ?? "0", 10) || 0;
    await repo.set(key, String(current + 1));
  } catch {
    /* contador es cosmético — jamás tumba el envío */
  }
}

export type GuardAction =
  | "skipped-free" // tier free: el verificador es Pro-only
  | "skipped-mode-off" // BLINDAJE_MODE=off — el dueño lo apagó por env
  | "skipped-no-claims" // la respuesta no afirma datos (o, en modo permisivo, no niega nada)
  | "sent-original" // verificada y respaldada — sale tal cual
  | "replaced" // sin respaldo — sale el "déjame confirmarlo" + ticket
  | "fail-open"; // el verificador falló/timeout — sale la original intacta

export interface GuardOptions {
  replyText: string;
  turnUsedKb: boolean;
  kbPassages: SearchKbResult[];
  /** Salidas de las tools del turno (además de searchKb) — fuente oficial. */
  toolResults?: { tool: string; output: string }[];
  businessContext?: string;
  /** System prompt activo — fuente oficial para el verificador (ver VerifyOptions). */
  systemPrompt?: string;
  /** Últimos mensajes del cliente (ver VerifyOptions.mensajesDelCliente). */
  mensajesDelCliente?: string[];
  /** Mensajes previos del negocio en la conversación (ver VerifyOptions). */
  mensajesDelNegocio?: string[];
  /** Rigor efectivo del Blindaje. Viene de settings D1 (blindaje_mode — se
   * cambia sin redeploy); sin valor, manda env BLINDAJE_MODE (wrangler.toml). */
  mode?: BlindajeMode;
  conversationId: string | null;
  /** Canal de la conversación. En "web" el escalamiento pide contacto (anónimo). */
  channel?: string;
  llm?: LlmOverrides;
  /** Solo para tests; default VERIFY_TIMEOUT_MS. */
  timeoutMs?: number;
}

export interface GuardResult {
  finalText: string;
  action: GuardAction;
  unsupportedClaim?: string;
}

/**
 * Punto de entrada del agente: decide qué texto sale al cliente. Nunca lanza
 * — cualquier falla interna resuelve a la respuesta original (fail-open).
 */
export async function guardReply(env: Env, opts: GuardOptions): Promise<GuardResult> {
  const original = opts.replyText;

  if (!isPro(env)) return { finalText: original, action: "skipped-free" };

  const mode = opts.mode ?? blindajeMode(env);
  if (mode === "off") return { finalText: original, action: "skipped-mode-off" };

  // negaciones: confía en TODO dato positivo (inventario en vivo) y solo vigila
  // negaciones de existencia — si la respuesta no niega nada, ni se verifica.
  // full (default): verificación completa; el prompt ya es lenient con tool/KB.
  let negationsOnly = false;
  if (mode === "negaciones") {
    if (!DENIAL_PATTERN.test(original)) {
      return { finalText: original, action: "skipped-no-claims" };
    }
    negationsOnly = true;
  } else if (!shouldVerify(original, opts.turnUsedKb)) {
    return { finalText: original, action: "skipped-no-claims" };
  }

  let verdict: VerifyVerdict;
  try {
    verdict = await verifyReply(env, original, opts.kbPassages, opts.businessContext ?? "", {
      llm: opts.llm,
      timeoutMs: opts.timeoutMs,
      systemPrompt: opts.systemPrompt,
      toolResults: opts.toolResults,
      negationsOnly,
      mensajesDelCliente: opts.mensajesDelCliente,
      mensajesDelNegocio: opts.mensajesDelNegocio,
    });
  } catch (e) {
    console.warn("[blindaje] verificador falló — fail-open, va la respuesta original:", e);
    return { finalText: original, action: "fail-open" };
  }

  await bumpCounter(env, SETTING_KEYS.blindajeChecks);

  if (verdict.supported) return { finalText: original, action: "sent-original" };

  const claim = (verdict.unsupported_claim ?? original).slice(0, 200);

  // Ticket + aviso al dueño con la MISMA maquinaria del handoff (cero
  // duplicación). Best-effort: si el ticket falla, la respuesta segura sale
  // igual — nunca dejamos pasar el dato sin respaldo por un error de D1.
  try {
    await createHandoffTicket(env, {
      conversationId: opts.conversationId,
      reason: "dato sin respaldo",
      summary: `El bot iba a decirle al cliente algo que tu información no respalda (un dato inventado, o negar algo que quizá sí ofreces): "${claim}". Se le dijo que lo confirmas tú, para no dar un dato equivocado.`,
      category: "other",
    });
  } catch (e) {
    console.error("[blindaje] no se pudo crear el ticket/aviso:", e);
  }

  await bumpCounter(env, SETTING_KEYS.blindajeBlocked);
  console.warn(`[blindaje] respuesta reemplazada (dato sin respaldo): "${claim.slice(0, 120)}"`);

  return {
    finalText: safeConfirmReply(env.BOT_LANGUAGE, opts.channel),
    action: "replaced",
    unsupportedClaim: claim,
  };
}
