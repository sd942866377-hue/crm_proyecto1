/**
 * Chunking compartido del KB. Lo usan las DOS fuentes de KB para que troceen
 * IGUAL (mismo tamaño y límites), y no haya una calidad de retrieval para los
 * docs del panel y otra para los archivos de member/kb/:
 *   - kb/docs.ts        → docs editables desde /admin/kb (D1 kb_docs)
 *   - scripts/generate-fixtures.ts → archivos de member/kb/ (build-time)
 *
 * Sin dependencias (funciones puras de string): seguro de importar tanto en el
 * worker como en el script de build (tsx).
 */

/** Máximo de caracteres por doc del PANEL — acota los chunks (≤ MAX_CHUNKS). */
export const MAX_DOC_CHARS = 24_000;
export const CHUNK_CHARS = 1_200;
/** Tope de chunks de un doc del PANEL (input acotado a MAX_DOC_CHARS). */
export const MAX_CHUNKS = 24;
/** Tope para un ARCHIVO de member/kb/ — referencia curada que puede ser grande
 *  (p. ej. un PDF de decenas de páginas). Alto para no truncar contenido, pero
 *  acotado para no disparar el costo de embeddings con un archivo patológico. */
export const MAX_FILE_CHUNKS = 500;

/** Parte el contenido en piezas de ~CHUNK_CHARS sobre fronteras de párrafo.
 *  `maxChunks` acota el total (24 para docs del panel; alto para archivos). */
export function chunkContent(content: string, maxChunks: number = MAX_CHUNKS): string[] {
  const paras = content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const p of paras) {
    if (p.length > CHUNK_CHARS) {
      push();
      for (let i = 0; i < p.length; i += CHUNK_CHARS) chunks.push(p.slice(i, i + CHUNK_CHARS));
      continue;
    }
    if (current.length + p.length + 2 > CHUNK_CHARS) push();
    current = current ? `${current}\n\n${p}` : p;
  }
  push();
  return chunks.slice(0, maxChunks);
}
