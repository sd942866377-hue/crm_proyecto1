/**
 * Cursor keyset opaco para las listas paginadas de la API (bandeja, hilo,
 * interesados): base64 de `[orden, id]`, donde `orden` es la columna por la que
 * se ordena (last_message_at, created_at…) e `id` el desempate.
 *
 * btoa()/atob() crudos solo entienden Latin1 (1 byte por char) — y el `id` que
 * se codifica puede ser un id de conversación, que es literalmente
 * `${channel}:${channelUserId}` (ver db/conversations.ts makeConvId): un
 * channelUserId con unicode (nombre acentuado, emoji, alfabeto no latino de
 * algún canal) reventaba btoa() con InvalidCharacterError → 500 al armar el
 * next_cursor. Por eso se codifica a bytes UTF-8 primero, simétrico a cómo
 * decodeCursor envuelve todo en try/catch.
 */

/** Texto → base64, a prueba de unicode. */
export function toBase64Unicode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** base64 → texto, a prueba de unicode. */
export function fromBase64Unicode(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(ts: number, id: string): string {
  return toBase64Unicode(JSON.stringify([ts, id]));
}

/** Cursor → [orden, id]. null si viene vacío o corrupto (= como si no viniera). */
export function decodeCursor(raw: string | undefined): [number, string] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(fromBase64Unicode(raw)) as unknown;
    if (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "string") {
      return [v[0], v[1]];
    }
  } catch {
    /* cursor inválido → como si no viniera */
  }
  return null;
}
