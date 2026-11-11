const DEFAULT_MAX_CHUNKS = 3;

// Protege URLs/dominios (forjabots.com, https://…/l/abc) de que el split por
// PUNTOS los rompa en pedazos o les meta espacios. Bug real: un link de registro
// salía partido en 3 mensajes en Instagram/WhatsApp ("horizontes-bot-demo." +
// "innovandohorizontes. workers." + "dev/l/…"), inclickeable. Se enmascaran con
// un token [[URL#]] (sin puntos ni espacios → los splits por oración no lo
// tocan; no choca con texto normal), se procesa el texto, y se restauran al final.
const URL_RE =
  /https?:\/\/[^\s]+|www\.[^\s]+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s]*)?/g;

function withUrlsMasked(text: string, fn: (masked: string) => string): string {
  const urls: string[] = [];
  const masked = text.replace(URL_RE, (m) => "[[URL" + (urls.push(m) - 1) + "]]");
  return fn(masked).replace(/\[\[URL(\d+)\]\]/g, (_, i) => urls[Number(i)] ?? "");
}

/**
 * Repara "palabra.Palabra" (punto sin espacio antes de mayúscula): Instagram y
 * WhatsApp lo linkifican como dominio (bug real: "Cobra.Es" → preview de
 * cobra.es). Los URLs de verdad van en minúsculas (forjabots.com), así que
 * exigir MAYÚSCULA tras el punto no toca links legítimos (y además van
 * enmascarados, por si acaso).
 */
export function fixStuckSentences(text: string): string {
  return withUrlsMasked(text, (t) =>
    t
      .replace(/([a-záéíóúñü0-9!?)])\.([A-ZÁÉÍÓÚÑ¡¿])/g, "$1. $2")
      .replace(/([!?])([¡¿])/g, "$1 $2"),
  );
}

/**
 * En turnos multi-paso el modelo a veces repite la MISMA frase tras una tool
 * call y el stream las concatena ("¿En qué te dedicas?¿En qué te dedicas?").
 * Colapsa oraciones consecutivas idénticas (normalizadas, ≥10 chars).
 */
export function dedupeRepeatedSentences(text: string): string {
  return withUrlsMasked(text, (masked) => {
    const parts = masked.split(/(?<=[.!?…])\s*/).filter(Boolean);
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const out: string[] = [];
    let i = 0;
    let removedAny = false;
    while (i < parts.length) {
      let skipped = false;
      // bloques de 3, 2 o 1 oraciones que repiten EXACTO lo recién dicho
      for (const w of [3, 2, 1]) {
        if (out.length >= w && i + w <= parts.length) {
          const prevBlock = norm(out.slice(-w).join(" "));
          const nextBlock = norm(parts.slice(i, i + w).join(" "));
          if (prevBlock.length >= 10 && prevBlock === nextBlock) {
            i += w;
            skipped = true;
            removedAny = true;
            break;
          }
        }
      }
      if (!skipped) {
        out.push(parts[i]);
        i++;
      }
    }
    // Sin repeticiones (el caso normal): devuelve el texto TAL CUAL. El
    // join(" ")+collapse borraba TODOS los saltos de línea y aplastaba comandas,
    // confirmaciones y resúmenes multilínea en un párrafo ilegible. Solo
    // colapsamos cuando de verdad quitamos una repetición. Reportado por Adrián.
    if (!removedAny) return masked;
    return out.join(" ").replace(/\s+/g, " ").trim();
  });
}

export function chunkReply(text: string, maxChunks: number = DEFAULT_MAX_CHUNKS): string[] {
  const cap = Math.max(1, Math.floor(maxChunks));
  const trimmed = dedupeRepeatedSentences(fixStuckSentences(text.trim()));

  if (cap === 1) return [trimmed];

  // Try paragraph split first (explicit breaks win over length)
  const paras = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 1 && paras.length <= cap) {
    return paras;
  }
  if (paras.length > cap) {
    // Keep the first cap-1 paragraphs, merge the tail into the last chunk
    const head = paras.slice(0, cap - 1);
    const tail = paras.slice(cap - 1).join(" ");
    return [...head, tail];
  }

  // Single paragraph — try sentence split. Un URL no se parte aquí: no lleva
  // espacio tras sus puntos y este split exige \s+ (espacio real).
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return [trimmed];

  // Distribute sentences into <= cap groups
  const chunks: string[] = [];
  const perChunk = Math.ceil(sentences.length / cap);
  for (let i = 0; i < sentences.length; i += perChunk) {
    chunks.push(sentences.slice(i, i + perChunk).join(" "));
  }
  return chunks.slice(0, cap);
}
