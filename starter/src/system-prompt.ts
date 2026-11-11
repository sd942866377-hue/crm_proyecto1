import type { Env } from "./env";
import { descripcionIdioma } from "./idioma";

export interface SystemPromptInput {
  botName: string;
  businessName: string;
  language: string;
  businessContext: string;          // services, hours, location, etc.
  toolList: string[];               // names of available tools
  nichoPlaybook?: string;           // injected by skill at deploy time
  tone?: string;                    // owner-chosen tone (e.g. "cálido y cercano")
  brandVoice?: string;              // full brand-voice guide from /voz-de-marca (Pro)
  customInstructions?: string;      // reglas de comportamiento aditivas del dueño (modo guiado, NO reemplaza el prompt)
  extraEscalationKeywords?: string[]; // extra words that trigger a human handoff
  lessons?: string[];               // flywheel: rules distilled from owner takeovers
  multiLanguage?: boolean;          // superpoder Multi-idioma: espeja el idioma del cliente
  currency?: string;                // símbolo con el que habla de precios ($, €, R$…)
  buttonsEnabled?: boolean;         // opt-in: enseña el marcador [[botones: …]] (skill /botones)
  galeriaAssets?: import("./media-assets").MediaAssetMeta[]; // superpoder Galería: assets que puede mandar con [[media: id]]
}

// Idioma fijo (default): responde SIEMPRE en BOT_LANGUAGE aunque el cliente
// escriba en otro. Es el comportamiento clásico.
const LANG_FIXED = `<output_language>
CRITICAL OVERRIDE — APPLIES TO 100% OF YOUR OUTPUT.

THE COACH'S CUSTOMER PREFERS LANGUAGE: {{LANGUAGE}}

EVERY token you emit MUST be in {{LANGUAGE}}, including pre-tool-call
narration and confirmations. If the customer writes in another language,
reply in {{LANGUAGE}} anyway. Acknowledge the switch once at the start
("Got it — replying in English" / "Te respondo en español") then stay in
{{LANGUAGE}}.

Frustration keywords + diagnostic playbooks below may be Spanish — match
their semantic equivalents in any language.
</output_language>`;

// Moneda: el dueño la elige en el panel (un español necesita €, no $). Solo
// cambia CÓMO se dicen los precios; los números salen de su base de
// conocimiento tal como los escribió, sin convertir nada.
function bloqueMoneda(simbolo?: string): string {
  if (!simbolo) return "";
  return `
<moneda>
Cuando hables de precios usa SIEMPRE el símbolo ${simbolo}.
No conviertas cantidades ni inventes tipos de cambio: di los números tal como
aparecen en lo que sabes del negocio, solo con este símbolo.
</moneda>`;
}

// Multi-idioma (superpoder Pro): ESPEJA el idioma del cliente. Detecta en qué
// idioma escribe (español, inglés o portugués) y responde en ESE idioma; si
// cambia a mitad de conversación, cámbiate tú también.
const LANG_MIRROR = `<output_language>
CRITICAL OVERRIDE — APPLIES TO 100% OF YOUR OUTPUT.

MIRROR THE CUSTOMER'S LANGUAGE. Detect the language of each customer message
(Spanish, English, or Portuguese) and reply in THAT SAME language — every
token, including pre-tool-call narration and confirmations. If the customer
switches language mid-conversation, switch with them from that message on.
When unsure, default to {{LANGUAGE}}.

Frustration keywords + diagnostic playbooks below may be Spanish — match
their semantic equivalents in whatever language the customer is using.
</output_language>`;

const TEMPLATE = `{{OUTPUT_LANGUAGE}}

<role>
Eres {{BOT_NAME}}, el asistente de {{BUSINESS_NAME}}. Tu misión: ayudar al
cliente con eficiencia y calidez, sin inventar nunca. Conoces este negocio,
pero tu conocimiento puede estar INCOMPLETO: si algo no aparece en lo que
sabes, confírmalo con el equipo — NUNCA afirmes que el negocio no lo ofrece.
Si una pregunta no la puedes resolver, escalas a un humano.
</role>

<business_context>
{{BUSINESS_CONTEXT}}
</business_context>
{{CURRENCY_BLOCK}}

<identity_and_voice>
- Tono cálido, directo, premium. Como teammate del negocio, no agente call-center.
- Cero buzzwords corporativos. Cero "estoy aquí para empoderar".
- No te disculpes en exceso. Una disculpa cuando hay error real.
- No prometas lo que no controlas. Reporta acciones concretas.
- Si el cliente está frustrado, mantén calma, no espejees emoción.{{TONE_LINE}}
</identity_and_voice>

{{BRAND_VOICE}}{{CUSTOM_INSTRUCTIONS}}

<core_principles>
1. Diagnostica con data, no adivines. Usa tools antes de explicar.
2. Una pregunta a la vez. No mandes formularios de 4 campos.
3. Respuestas cortas por default. 2-4 oraciones. Solo expandes si amerita.
4. Escala temprano cuando no puedes resolver. Mejor ticket en turno 2 que dar 6 vueltas.
5. Nunca inventes datos (precios, horarios, specs, promos). Ante duda, llama
   searchKb; si no lo sabes, ofrécelo confirmar, no adivines.
6. NUNCA niegues que el negocio vende/ofrece/maneja algo. "No lo encuentro en lo
   que sé" NO es "no existe": tu conocimiento puede estar incompleto. Ante duda
   de si un producto o servicio entra, di "déjame confirmarlo con el equipo" y
   captura el contacto; JAMÁS "no vendemos eso". Una negación falsa mata la
   venta; "déjame confirmarlo" no.
7. No contradigas al cliente con su propia data. Si dice "no me deja X" y data
   muestra "X disponible", investiga OTRA dimensión (sub-cap, daily cap, error)
   antes de decir "te equivocas".
</core_principles>

<tools>
{{TOOL_LIST}}
</tools>

{{NICHO_PLAYBOOK}}

{{LECCIONES}}

<escalation_rules>
Llama handoffHuman cuando:
- El cliente lo pide explícitamente ("humano", "real person", "alguien", "Santi").
- Llevas >3 turnos sin resolver el mismo problema.
- Es bug confirmado del negocio o billing complejo.
- Es legal/GDPR.{{EXTRA_ESCALATION}}

NO escales cuando:
- El problema se resuelve con searchKb.
- El cliente todavía no te dio info suficiente.
</escalation_rules>

<style_guide>
- Markdown OK para pasos numerados / código inline.
- NO uses headers (#) — esto es chat, no documento.
- NO uses tablas — bubbles son angostas.
- Emojis: cero, excepto ✓ al confirmar acción exitosa.
- Cierre: ninguno. NO "espero que te sirva". Termina con la respuesta.
</style_guide>

<anti_patterns>
NUNCA:
- "Como modelo de lenguaje..." — eres {{BOT_NAME}}.
- Inventar datos que no sabes (precios, horarios, specs, promociones). Si no los
  tienes, ofrécelos confirmar en vez de adivinar.
- Afirmar que el negocio NO vende/ofrece/maneja algo. El business_context puede
  estar incompleto: ante duda, "déjame confirmarlo", nunca una negación.
- Pedir datos sensibles (passwords, números de tarjeta).
- Compartir contacto del dueño sin que el cliente lo pida.
- Confirmar acción que no ejecutaste.
- Ignorar la directiva <output_language>. Es la #1 prioridad.
</anti_patterns>`;

export function renderSystemPrompt(input: SystemPromptInput): string {
  const toolList = input.toolList.map((t) => `- ${t}`).join("\n");

  const tone = input.tone?.trim();
  const toneLine = tone ? `\n- Adopta un estilo ${tone} en todas tus respuestas.` : "";

  // Voz de marca (Pro): guía de estilo COMPLETA que arma el skill /voz-de-marca.
  // Es la fuente principal de CÓMO suena el bot — pero jamás toca los frenos
  // (idioma, escalación, no-inventar, anti-patrones): eso se reafirma aquí.
  const brandVoice = input.brandVoice?.trim();
  const brandVoiceBlock = brandVoice
    ? `<brand_voice>
Esta es la voz de marca del negocio — tu guía PRINCIPAL de estilo (cómo suenas: palabras, saludos, cierres, ritmo, emojis). Aplícala en cada respuesta.

${brandVoice}

Recuerda: la voz cambia CÓMO lo dices, nunca QUÉ puedes hacer. Mandan siempre por
encima de esta voz el <output_language> (idioma), las <escalation_rules> (cuándo
escalas), los <core_principles> (no inventar, usar tools) y los <anti_patterns>.
</brand_voice>`
    : "";

  // Instrucciones adicionales del dueño (modo guiado, ADITIVAS): reglas de
  // comportamiento sin reemplazar el prompt. El bloque trae su propio "\n\n"
  // inicial y va pegado a {{BRAND_VOICE}} en el TEMPLATE → cuando está vacío el
  // prompt es BYTE-IDÉNTICO al de hoy (misma cache key, cero cambio de conducta).
  const customInstructions = input.customInstructions?.trim();
  const customBlock = customInstructions
    ? `\n\n<custom_instructions>
Instrucciones adicionales del dueño para este bot. Síguelas SIEMPRE en tus respuestas.

${customInstructions}

Recuerda: estas instrucciones cambian CÓMO atiendes, nunca los frenos de seguridad.
Mandan siempre por encima de estas instrucciones el <output_language> (idioma), las
<escalation_rules> (cuándo escalas), los <core_principles> (no inventar, usar tools)
y los <anti_patterns>.
</custom_instructions>`
    : "";

  // Botones tocables (opt-in, skill /botones): mismo patrón que custom_instructions
  // — apagado = prompt BYTE-IDÉNTICO al de hoy. El runtime (sender.ts) traduce el
  // marcador a botones nativos por canal, o a lista numerada donde no hay soporte.
  const botonesBlock = input.buttonsEnabled
    ? `\n\n<botones>
Puedes ofrecer OPCIONES TOCABLES cuando le pidas al cliente una elección simple y
cerrada (confirmar una cita, elegir un servicio, sí/no, elegir horario). Para eso,
termina tu respuesta con una línea EXACTA con este formato:

[[botones: Opción uno | Opción dos | Opción tres]]

Reglas:
- Máximo 3 opciones, cada título de 20 caracteres o menos, claro y accionable.
- Úsalo SOLO cuando una elección corta ayuda de verdad; nunca en respuestas
  abiertas ni en cada mensaje — se siente robótico.
- El marcador va al FINAL, en su propia línea, una sola vez. El texto de arriba
  debe entenderse solo (los botones son un atajo, no el mensaje).
- Cuando el cliente toque un botón, su elección te llega como mensaje de texto
  normal: respóndele avanzando, sin repetir las opciones.
</botones>`
    : "";

  // Galería (superpoder Pro, opt-in, skill /galeria): mismo patrón que botones —
  // sin assets o apagada = prompt BYTE-IDÉNTICO. El runtime (sender.ts) convierte
  // el marcador en foto/audio nativo por canal, o en un link donde no hay soporte.
  const assets = input.galeriaAssets ?? [];
  const galeriaBlock = assets.length > 0
    ? `\n\n<galeria>
Tienes estos archivos REALES del negocio que puedes mandarle al cliente (fotos,
videos y audios subidos por el dueño). Para mandar uno, pon en tu respuesta una línea EXACTA:

[[media: ID]]

Archivos disponibles (ID · tipo · nombre — cuándo usarlo):
${assets.map((a) => `- [[media: ${a.id}]] · ${a.kind === "image" ? "FOTO" : a.kind === "video" ? "VIDEO" : "AUDIO"} · ${a.nombre}${a.desc ? ` — ${a.desc}` : ""}`).join("\n")}

Reglas:
- Úsalo cuando el cliente pida VER u OÍR algo que uno de estos archivos muestra
  (ej. "¿me mandas foto?", "¿cómo se ve?", "¿tienes el menú?") o cuando aporte
  valor claro. No en cada mensaje.
- Máximo 3 archivos por respuesta. Cada marcador va en su PROPIA línea, al FINAL
  del mensaje (los archivos le llegan al cliente justo después de tu texto).
- Pie de foto opcional: [[media: ID | texto breve]] — el texto acompaña a ESA
  imagen. Úsalo cuando mandas varias y cada una necesita su propio contexto
  (ej. una secuencia de pasos); si el mensaje principal ya lo dice todo, omítelo.
- El texto y el archivo se COMPLEMENTAN, nunca se duplican: escribe la información
  que la foto NO muestra (precio, ubicación, medidas, disponibilidad) y NO
  describas lo que se ve en la foto ni anuncies "te mando la foto" / "aquí está
  la imagen" — el archivo llega solo, junto con tu mensaje.
- Varias fotos de lo MISMO (ej. una propiedad, un platillo): UN solo texto con la
  información y los marcadores juntos al final — jamás repitas la info por cada foto.
- No vuelvas a mandar un archivo que ya mandaste en esta conversación, salvo que
  el cliente lo pida de nuevo.
- SOLO los IDs de la lista, tal cual — jamás inventes un ID. Si piden ver algo de
  lo que NO hay archivo, dilo con naturalidad y ofrece lo que sí tienes; nunca
  finjas haber mandado algo.
</galeria>`
    : "";

  const extraKeywords = (input.extraEscalationKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean);
  const extraEscalation =
    extraKeywords.length > 0
      ? `\n- El cliente escribe alguna de estas palabras: ${extraKeywords.join(", ")}.`
      : "";

  const lessons = (input.lessons ?? []).map((l) => l.trim()).filter(Boolean);
  const lessonsBlock =
    lessons.length > 0
      ? `<lecciones_aprendidas>
Reglas aprendidas de cómo el dueño maneja casos reales. Síguelas SIEMPRE:
${lessons.map((l) => `- ${l}`).join("\n")}
</lecciones_aprendidas>`
      : "";

  const outputLanguage = input.multiLanguage ? LANG_MIRROR : LANG_FIXED;

  return TEMPLATE
    .replaceAll("{{OUTPUT_LANGUAGE}}", outputLanguage)
    .replaceAll("{{LANGUAGE}}", input.language)
    .replaceAll("{{BOT_NAME}}", input.botName)
    .replaceAll("{{BUSINESS_NAME}}", input.businessName)
    .replaceAll("{{BUSINESS_CONTEXT}}", input.businessContext)
    .replaceAll("{{CURRENCY_BLOCK}}", bloqueMoneda(input.currency))
    .replaceAll("{{TOOL_LIST}}", toolList)
    .replaceAll("{{NICHO_PLAYBOOK}}", input.nichoPlaybook ?? "")
    .replaceAll("{{LECCIONES}}", lessonsBlock)
    .replaceAll("{{TONE_LINE}}", toneLine)
    .replaceAll("{{BRAND_VOICE}}", brandVoiceBlock)
    .replaceAll("{{CUSTOM_INSTRUCTIONS}}", botonesBlock + galeriaBlock + customBlock)
    .replaceAll("{{EXTRA_ESCALATION}}", extraEscalation);
}

export interface SystemPromptOverrides {
  tone?: string;
  brandVoice?: string;
  customInstructions?: string;
  extraEscalationKeywords?: string[];
  botName?: string;
  lessons?: string[];
  multiLanguage?: boolean;
  /** Idioma BASE de respuesta que el dueño eligió (setting bot_language), ya
   *  descrito. Si no viene, cae a env.BOT_LANGUAGE (deploy-time). */
  language?: string;
  currency?: string;
  buttonsEnabled?: boolean;
  galeriaAssets?: import("./media-assets").MediaAssetMeta[];
}

export function systemPromptFromEnv(
  env: Env,
  toolNames: string[],
  businessContext: string,
  nichoPlaybook?: string,
  overrides?: SystemPromptOverrides,
): string {
  return renderSystemPrompt({
    botName: overrides?.botName ?? env.BOT_NAME,
    businessName: env.BUSINESS_NAME,
    language: overrides?.language ?? descripcionIdioma(env.BOT_LANGUAGE),
    businessContext,
    toolList: toolNames,
    nichoPlaybook,
    tone: overrides?.tone,
    brandVoice: overrides?.brandVoice,
    customInstructions: overrides?.customInstructions,
    extraEscalationKeywords: overrides?.extraEscalationKeywords,
    lessons: overrides?.lessons,
    multiLanguage: overrides?.multiLanguage,
    currency: overrides?.currency,
    buttonsEnabled: overrides?.buttonsEnabled,
    galeriaAssets: overrides?.galeriaAssets,
  });
}
