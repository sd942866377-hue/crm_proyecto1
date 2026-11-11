/**
 * Canal `test` — el chat de prueba de la app (Forja Inbox): el instalador o el
 * dueño le escriben a su propio bot para verlo contestar. Entra por el pipeline
 * REAL del agente (misma config, tools, KB, modelo) pero NO es una conversación
 * de negocio: no debe contar en la bandeja, las métricas, los leads, los
 * tickets, los insights, los follow-ups, los reportes ni el muro /show.
 *
 * ⚠️ REGLA PARA CUALQUIER QUERY NUEVA sobre `conversations`, `messages`,
 * `leads`, `tickets` o `keyword_hits`: excluye el canal `test` con una de las
 * consts/ayudas de aquí. Como el id de la conversación es literalmente
 * `${channel}:${channelUserId}` (db/conversations.ts makeConvId), en las tablas
 * que NO tienen columna `channel` basta con el prefijo del string — sin JOIN.
 *
 * OJO con las columnas NULLABLE (`leads.conversation_id` es ON DELETE SET NULL):
 * `conversation_id NOT LIKE 'test:%'` es NULL cuando la columna es NULL, y un
 * WHERE con NULL descarta la fila — usa la variante nullable-safe o te comes
 * los leads sin conversación.
 *
 * Lo que SÍ cuenta (deliberado): el costo de IA (tab Costos, budget guard) —
 * el gasto de una prueba es real y el freno de presupuesto debe protegerlo
 * igual — y los spam-guards por conversación.
 */

/** Canal dedicado del chat de prueba. */
export const TEST_CHANNEL = "test";

/** Prefijo del id de conversación de una prueba (`test:<session>`). */
export const TEST_CONV_PREFIX = "test:";

/** Para queries sobre `conversations` SIN alias de tabla. */
export const NOT_TEST_CONV = "channel != 'test'";

/** Para queries sobre tablas con `conversation_id` NOT NULL (messages, tickets…). */
export const NOT_TEST_REF = "conversation_id NOT LIKE 'test:%'";

/** Igual que NOT_TEST_REF pero conserva las filas con `conversation_id` NULL. */
export const NOT_TEST_REF_NULLABLE =
  "(conversation_id IS NULL OR conversation_id NOT LIKE 'test:%')";

/** `c.channel != 'test'` — para queries con alias (`FROM conversations c`). */
export function notTestConv(alias: string): string {
  return `${alias}.channel != '${TEST_CHANNEL}'`;
}

/** `m.conversation_id NOT LIKE 'test:%'` — columna calificada. */
export function notTestRef(column: string): string {
  return `${column} NOT LIKE '${TEST_CONV_PREFIX}%'`;
}

/** Variante nullable-safe de notTestRef (leads, tickets sin conversación). */
export function notTestRefNullable(column: string): string {
  return `(${column} IS NULL OR ${column} NOT LIKE '${TEST_CONV_PREFIX}%')`;
}

/** ¿Este id de conversación es del chat de prueba? */
export function isTestConversationId(conversationId: string | null | undefined): boolean {
  return !!conversationId && conversationId.startsWith(TEST_CONV_PREFIX);
}
