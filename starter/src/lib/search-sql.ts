/**
 * Búsqueda por texto libre dentro de una columna, para las bandejas (la de la
 * app y la del panel).
 *
 * POR QUÉ NO `LIKE '%q%'`, que es lo obvio: D1 (el SQLite de workerd) tiene
 * `SQLITE_MAX_LIKE_PATTERN_LENGTH` en **50 BYTES** — no los 50.000 del SQLite
 * de escritorio. Un patrón más largo no devuelve cero filas: revienta la query
 * entera con `LIKE or GLOB pattern too complex: SQLITE_ERROR`, y con ella el
 * request (500). Y son BYTES, no caracteres: 25 'ñ' ya lo rompen aunque se vean
 * como 25 letras. Buscar el nombre completo de un cliente estaba tirando la
 * bandeja.
 *
 * `instr()` hace exactamente lo mismo (¿está esta subcadena dentro?) sin techo
 * de largo, y de paso trata los comodines como literales por naturaleza: buscar
 * "50%" encuentra "50%" sin tener que escapar nada ni arrastrar `ESCAPE '\'`.
 *
 * El `lower()` de los dos lados replica el case-insensitive de `LIKE`, que en
 * SQLite también es solo-ASCII: la equivalencia con lo que había es exacta.
 */

/**
 * Fragmento SQL "esta columna contiene el texto buscado", case-insensitive.
 * Consume UN parámetro posicional: el texto crudo, sin comodines ni escapes.
 *
 * ```ts
 * conds.push(contains("c.display_name"));
 * params.push(q);
 * ```
 */
export function contains(column: string): string {
  return `instr(lower(${column}), lower(?)) > 0`;
}
