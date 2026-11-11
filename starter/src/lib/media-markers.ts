/**
 * Marcadores de media dentro de `messages.content`.
 *
 * El bot nunca tuvo columnas de media en `messages`: la imagen entrante sobrevivía
 * como el marcador de texto `[IMAGE_URL: …]` y el audio solo como su transcripción.
 * El hilo móvil necesita el ARCHIVO, así que ahora también se escribe
 * `[MEDIA: <id de la fila media>]` — pero `[IMAGE_URL:]` se conserva TAL CUAL
 * porque de él dependen el flujo multimodal (agent.ts) y el Blindaje en bots ya
 * desplegados. Se COMPLEMENTA, no se reemplaza.
 *
 * Los marcadores son internos: se limpian server-side antes de mandar el texto a
 * la app (api-inbox.ts) y antes de armar el último turno del LLM (agent.ts).
 */

const IMAGE_URL_RE = /\n?\[IMAGE_URL: .+?\]/g;
const MEDIA_RE = /\n?\[MEDIA: [0-9a-fA-F-]{36}\]/g;
const FILE_RE = /\n?\[FILE: [^\]]*\]/g;
// `[TPL:<template_id>] ` al INICIO del content: marca que ese mensaje salió como
// plantilla aprobada de WhatsApp. Sin él, un mensaje de plantilla que persistió
// el texto RENDERIZADO de Twilio es indistinguible de uno escrito a mano, y la
// app perdía la etiqueta "Tú · recordatorio" al recargar el hilo (diseño 6b).
const TPL_RE = /^\[TPL:[^\]\n]{1,120}\]\s*/;

/** Marcador de una fila de media: `[MEDIA: <uuid>]`. */
export function mediaMarker(mediaId: string): string {
  return `[MEDIA: ${mediaId}]`;
}

/** Marcador de un archivo que el bot no puede leer: `[FILE: cotizacion.pdf]`. */
export function fileMarker(filename: string): string {
  return `[FILE: ${filename}]`;
}

/** Marcador de plantilla aprobada. Va al INICIO del content, antes del texto. */
export function templateMarker(templateId: string): string {
  return `[TPL:${templateId.replace(/[\]\n]/g, "").slice(0, 120)}] `;
}

/** Ids de las filas de media referenciadas en el texto. */
export function extractMediaIds(text: string): string[] {
  return [...text.matchAll(/\[MEDIA: ([0-9a-fA-F-]{36})\]/g)].map((m) => m[1]);
}

/** ¿Este mensaje salió como plantilla aprobada? Los viejos (sin marcador) → false. */
export function isTemplateMessage(text: string): boolean {
  return TPL_RE.test(text);
}

/** Texto sin ningún marcador — lo que ve la app. */
export function stripMediaMarkers(text: string): string {
  return text
    .replace(TPL_RE, "")
    .replace(IMAGE_URL_RE, "")
    .replace(MEDIA_RE, "")
    .replace(FILE_RE, "")
    .trim();
}

/** Quién mandó el mensaje — para redactar la frase en la persona correcta. */
export type Remitente = "cliente" | "negocio";

const FILE_CAPTURA_RE = /\n?\[FILE: ([^\]]*)\]/g;
const TIENE_MARCADOR_RE = /\[(?:IMAGE_URL|MEDIA|FILE):/;

/**
 * Versión del texto para el PROMPT del modelo.
 *
 * Igual que `stripMediaMarkers` con los marcadores que son pura contabilidad
 * ([MEDIA:], [TPL:]) o una URL que el modelo no puede abrir ([IMAGE_URL:]:
 * expira en minutos y encima gasta tokens). La diferencia: los dos que SÍ
 * aportan contexto no se borran a secas, se vuelven una frase corta —
 * "hubo una foto" y "hubo un archivo que no puedo leer" cambian lo que el
 * modelo debe contestar, y borrarlos lo dejaría respondiendo a un mensaje
 * vacío.
 */
export function markersToPrompt(text: string, de: Remitente): string {
  const habiaMarcador = TIENE_MARCADOR_RE.test(text) || TPL_RE.test(text);
  const out = text
    .replace(TPL_RE, "")
    .replace(FILE_CAPTURA_RE, (_m, nombre: string) =>
      de === "cliente"
        ? `\n(el cliente mandó un archivo: ${nombre || "documento"} — el bot no puede leerlo, lo revisa una persona)`
        : `\n(le mandaste el archivo ${nombre || "documento"})`,
    )
    .replace(IMAGE_URL_RE, de === "cliente" ? "\n(el cliente mandó una foto)" : "\n(le mandaste una foto)")
    .replace(MEDIA_RE, "")
    .trim();
  // Un mensaje que era SOLO `[MEDIA: uuid]` (foto sin caption mandada desde la
  // app) se quedaría en cadena vacía, y un turno vacío revienta a algunos
  // proveedores. Que al menos diga que hubo un archivo.
  if (!out && habiaMarcador) {
    return de === "cliente" ? "(el cliente mandó un archivo)" : "(le mandaste un archivo)";
  }
  return out;
}
