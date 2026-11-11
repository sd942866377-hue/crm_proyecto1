import type { Env } from "../env";

/**
 * Zona horaria efectiva del bot para resolver fechas. Prioridad:
 * BOT_TIMEZONE (explícita) → CALCOM_TIMEZONE (bots con agenda) → CDMX (default).
 */
export function botTimezone(env: Env, override?: string): string {
  // `override` = la timezone que el dueño eligió en "Disponibilidad" (setting
  // business_hours.timezone). Si no hay, cae al env como siempre.
  return (override && override.trim()) || env.BOT_TIMEZONE || env.CALCOM_TIMEZONE || "America/Mexico_City";
}

/**
 * Bloque <fecha_actual> que ancla al bot en el día de hoy.
 *
 * Sin esto, el modelo resolvía las fechas relativas o incompletas del cliente
 * ("el jueves 27", "mañana", "el viernes") desde su entrenamiento e inventaba el
 * AÑO: en un caso real mandó fecha 2025 en vez de 2026 → la agenda devolvió cero
 * horarios (día ya pasado) → el bot escaló en vez de agendar. Pega a todos los
 * giros con fecha (citas, reservas, visitas, eventos). Reportado en producción.
 *
 * Va como bloque de sistema SIN cachear (ver agent.ts, igual que la memoria del
 * cliente): así el prompt grande cacheado no se invalida al cambiar el día.
 *
 * `now` es inyectable para tests; en producción es el instante del turno.
 */
export function dateAnchorBlock(env: Env, now: Date = new Date(), tzOverride?: string): string {
  const tz = botTimezone(env, tzOverride);
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // AAAA-MM-DD, el ancla que jamás falla

  let legible = iso;
  try {
    legible = new Intl.DateTimeFormat(env.BOT_LANGUAGE || "es-MX", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now);
  } catch {
    /* locale inválido (p. ej. BOT_LANGUAGE="catalán"): nos quedamos con el ISO */
  }

  return (
    `<fecha_actual>\n` +
    `Hoy es ${legible} (${iso}, zona horaria ${tz}). ` +
    `Resuelve SIEMPRE las fechas relativas o incompletas del cliente ("hoy", "mañana", "el viernes", "el 27") contra esta fecha de hoy. ` +
    `Usa el año en curso salvo que el cliente indique otro; NUNCA agendes ni consultes una fecha en el pasado. ` +
    `Cuando llames una tool con fecha, mándala ya resuelta en formato AAAA-MM-DD.\n` +
    `</fecha_actual>`
  );
}
