import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";
import { calcomConfigured, calcomTimeZone, resolveEventTypeId, getAvailableSlots, createBooking, cancelBooking } from "../integrations/calcom";
import { leadMetadata } from "../db/leads";

// Tools de los nichos de SERVICIOS POR CITA (barbería, salón, dentista, gimnasio,
// coach). Método base: agendarCita registra la cita como lead para que el dueño la
// confirme. Método adicional (opt-in): si el dueño conectó Cal.com (CALCOM_*), el
// bot consulta disponibilidad real con verDisponibilidad y agendarCita reserva en el
// calendario. Ambos casos SIEMPRE dejan el registro local para el dashboard.

/** "2:30pm" → "14:30" · "5 pm" → "17:00" · "17:00" → "17:00" · "12am" → "00:00".
 * Devuelve null si no se entiende — el caller NUNCA debe aproximar. */
export function aHora24(hora: string): string | null {
  const t = hora.trim().toLowerCase().replace(/\s+/g, "");
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ?? "00";
  const suf = m[3]?.[0]; // "a" | "p" | undefined
  if (h > 23 || parseInt(min, 10) > 59) return null;
  if (suf === "p" && h !== 12) h += 12;
  if (suf === "a" && h === 12) h = 0;
  if (!suf && h > 23) return null;
  return `${String(h).padStart(2, "0")}:${min}`;
}

/**
 * Casa la hora que dijo el cliente contra los slots reales del día y devuelve
 * el startTime ISO exacto — el dato que el modelo casi nunca arrastra hasta
 * agendarCita (reporte de Eduardo Cume: la mayoría de las citas caían a lead
 * local en silencio). El modelo interpreta la intención; el código busca.
 * Si la hora no casa EXACTO con un hueco, undefined: reservar a una hora que
 * el cliente no pidió es peor que no reservar.
 */
export async function buscarSlot(
  env: Env,
  servicio: string | undefined,
  fecha: string,
  hora: string,
): Promise<string | undefined> {
  const eventTypeId = resolveEventTypeId(env, servicio);
  if (!eventTypeId) return undefined;
  const buscada = aHora24(hora);
  if (!buscada) return undefined;
  const res = await getAvailableSlots(env, eventTypeId, fecha, calcomTimeZone(env));
  if (!res.ok) return undefined;
  // Cal.com devuelve el start con la hora local de la zona pedida.
  return res.slots.find((s) => s.slice(11, 16) === buscada);
}

export function verDisponibilidadTool(env: Env, _getConversationId: () => string | null) {
  return tool({
    description:
      "Consulta los HORARIOS LIBRES reales en la agenda (Cal.com) para un servicio y un día. Úsala ANTES de agendar cuando el cliente ya eligió qué servicio quiere y para qué día, para ofrecerle horas que de verdad están disponibles. Devuelve una lista de horas con su startTime exacto — pásale ese startTime a agendarCita.",
    inputSchema: z.object({
      fecha: z.string().describe("Día a consultar en formato YYYY-MM-DD (ej. '2026-07-20')"),
      servicio: z.string().optional().describe("Servicio que quiere el cliente (para elegir el tipo de cita correcto)"),
    }),
    execute: async ({ fecha, servicio }) => {
      // Los cortes previos a la llamada también se loguean: sin esto eran un
      // punto ciego (la tool "corría" y no quedaba ni una línea del porqué).
      if (!calcomConfigured(env)) {
        console.warn("[calcom] verDisponibilidad sin configurar (falta CALCOM_API_KEY o event types)");
        return { error: "calcom_not_configured" as const };
      }
      const eventTypeId = resolveEventTypeId(env, servicio);
      if (!eventTypeId) {
        console.warn(`[calcom] verDisponibilidad sin event type para servicio="${servicio ?? ""}"`);
        return { error: "no_event_type" as const };
      }
      const tz = calcomTimeZone(env);
      const res = await getAvailableSlots(env, eventTypeId, fecha, tz);
      if (!res.ok) return { error: "calcom_failed" as const, reason: res.reason };
      // Cal.com devuelve el start con la hora local de la zona pedida; extraemos HH:MM.
      const slots = res.slots.slice(0, 12).map((start) => ({ hora: start.slice(11, 16), startTime: start }));
      if (!slots.length) return { fecha, slots: [], message: "No hay horarios libres ese día. Ofrece otra fecha." };
      return { fecha, timeZone: tz, slots };
    },
  });
}

export function agendarCitaTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra una CITA cuando el cliente ya dio el servicio que quiere, el día, la hora y su nombre. Sirve para barbería, salón, dentista, gimnasio (clase de prueba) y coach (llamada de descubrimiento). Si tienes la tool verDisponibilidad (agenda Cal.com conectada), primero úsala para obtener horarios reales y pásame el `startTime` exacto del slot elegido y el `email` del cliente: así la reservo en el calendario. Si no hay agenda conectada, solo registro la cita para que el negocio la confirme.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre de quien agenda"),
      servicio: z
        .string()
        .describe(
          "Servicio o motivo de la cita, tal como lo pidió (ej. 'corte + barba', 'limpieza dental', 'clase de prueba', 'llamada de descubrimiento')",
        ),
      fecha: z.string().describe("Día de la cita, tal como lo dijo el cliente (ej. 'sábado', '2026-07-20')"),
      hora: z.string().describe("Hora de la cita (ej. '5pm', '17:00')"),
      startTime: z
        .string()
        .optional()
        .describe("ISO exacto del slot elegido, tomado de verDisponibilidad. Solo si hay agenda Cal.com conectada."),
      email: z.string().optional().describe("Email del cliente. Necesario para reservar en Cal.com."),
      profesional: z
        .string()
        .optional()
        .describe("Con quién quiere la cita, si pidió a alguien en particular (barbero, estilista, doctor, coach)"),
      contacto: z.string().optional().describe("Teléfono del cliente si lo dio"),
      notas: z.string().optional().describe("Detalles extra (primera vez, urgencia, meta que busca, etc.)"),
    }),
    execute: async ({ nombre, servicio, fecha, hora, startTime, email, profesional, contacto, notas }) => {
      const metadata: Record<string, string | number | null> = { servicio, fecha, hora };
      if (profesional) metadata.profesional = profesional;

      // Método adicional: reservar en Cal.com si está conectado y tenemos slot + email.
      let calMessage = "El negocio la confirma.";
      let booked = false;
      if (calcomConfigured(env)) {
        // Si el modelo no arrastró el startTime ISO, lo busca el CÓDIGO casando
        // la hora contra los slots reales. Sin aproximar jamás: si no casa
        // exacto, la cita queda local (y abajo se loguea el porqué).
        let slot = startTime;
        if (!slot && email) {
          slot = await buscarSlot(env, servicio, fecha, hora);
          if (!slot) console.warn(`[calcom] agendarCita sin slot casable · fecha=${fecha} hora=${hora} → cita LOCAL (no se intentó reservar)`);
        }
        if (!email) console.warn("[calcom] agendarCita sin email del cliente → cita LOCAL (no se intentó reservar)");
        if (slot && email) {
          const eventTypeId = resolveEventTypeId(env, servicio);
          if (!eventTypeId) console.warn(`[calcom] agendarCita sin event type para servicio="${servicio}" → cita LOCAL`);
          if (eventTypeId) {
            const b = await createBooking(env, {
              eventTypeId,
              start: slot,
              name: nombre,
              email,
              timeZone: calcomTimeZone(env),
              phone: contacto,
              notes: notas,
            });
            if (b.ok) {
              booked = true;
              metadata.calBooking = String(b.bookingId);
              // Cal.com cancela por uid, no por id — sin esto una cita creada
              // hoy no se puede cancelar mañana (ver cancelarCitaTool).
              if (b.uid) metadata.calBookingUid = b.uid;
              if (b.start ?? slot) metadata.calStart = String(b.start ?? slot);
              metadata.estado = "Reservada (Cal.com)";
              calMessage = "Quedó reservada en la agenda.";
            } else {
              // El slot pudo ocuparse; guardamos el lead pero pedimos reintentar.
              metadata.estado = "Por confirmar (falló Cal.com)";
              const leads = new LeadsRepo(new Db(env.DB), env);
              const id = await leads.create({
                conversationId: getConversationId(),
                channelUserId: null,
                name: nombre,
                contact: contacto,
                intent: `Cita · ${servicio} · ${fecha} ${hora}`.slice(0, 300),
                notes: [profesional ? `Con: ${profesional}` : "", notas ?? "", `Cal.com: ${b.reason}`].filter(Boolean).join(" · ") || undefined,
                metadata,
              });
              return {
                citaId: id,
                booked: false,
                retry: true,
                message: "No pude reservar ese horario (quizás se acaba de ocupar). Ofrece otro horario con verDisponibilidad.",
              };
            }
          }
        }
      }

      const leads = new LeadsRepo(new Db(env.DB), env);
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Cita · ${servicio} · ${fecha} ${hora}`.slice(0, 300),
        notes: [profesional ? `Con: ${profesional}` : "", notas ?? ""].filter(Boolean).join(" · ") || undefined,
        metadata,
      });
      return { citaId: id, booked, message: `Cita registrada. ${calMessage}` };
    },
  });
}

export function cancelarCitaTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "CANCELA una cita ya registrada de ESTE cliente (y si está reservada en la agenda Cal.com, la libera de verdad). Úsala SIEMPRE que el cliente pida cancelar — NUNCA afirmes que una cita quedó cancelada sin haberla llamado y recibido ok:true. Para reagendar: primero cancela con esta tool y SOLO si salió bien agenda la nueva (quedarse con una cita equivocada es mejor que quedarse con dos).",
    inputSchema: z.object({
      motivo: z.string().optional().describe("Motivo de la cancelación si el cliente lo dio"),
      cual: z
        .string()
        .optional()
        .describe("Cuál cita, si el cliente tiene varias (ej. 'la del lunes', 'la de limpieza'). Si hay varias y no sabes cuál, pregunta ANTES de llamar."),
    }),
    execute: async ({ motivo, cual }) => {
      const convId = getConversationId();
      const db = new Db(env.DB);
      // Citas de ESTA conversación, recientes primero. Cancelar la de otro
      // cliente por adivinar sería peor que no cancelar.
      const rows = convId
        ? await db.all<{ id: string; intent: string; metadata: string | null }>(
            `SELECT id, intent, metadata FROM leads
             WHERE conversation_id = ? AND intent LIKE 'Cita ·%'
             ORDER BY created_at DESC LIMIT 10`,
            [convId],
          )
        : [];
      const vivas = rows.filter((r) => {
        const m = leadMetadata({ metadata: r.metadata });
        return m.estado !== "Cancelada";
      });

      if (!vivas.length) {
        return {
          cancelada: false,
          error: "sin_citas" as const,
          message: "No encuentro ninguna cita registrada en esta conversación. NO afirmes que cancelaste nada; pregunta al cliente los datos de su cita y ofrece pasar el caso al negocio.",
        };
      }

      // Varias vivas y sin pista de cuál → preguntar, no adivinar.
      let objetivo = vivas[0];
      if (vivas.length > 1) {
        const pista = (cual ?? "").toLowerCase();
        const match = pista ? vivas.filter((r) => r.intent.toLowerCase().includes(pista)) : [];
        if (match.length === 1) {
          objetivo = match[0];
        } else {
          return {
            cancelada: false,
            error: "varias_citas" as const,
            citas: vivas.map((r) => r.intent),
            message: "El cliente tiene varias citas vivas. Pregúntale CUÁL quiere cancelar (muéstrale la lista) antes de volver a llamar esta tool. No adivines: cancelarle la cita equivocada es peor.",
          };
        }
      }

      const meta = leadMetadata({ metadata: objetivo.metadata });
      const uid = meta.calBookingUid;

      // Reservada en Cal.com pero sin uid (anterior a este cambio): decirlo y
      // escalar, no fingir.
      if (meta.estado === "Reservada (Cal.com)" && !uid) {
        return {
          cancelada: false,
          error: "sin_uid" as const,
          cita: objetivo.intent,
          message: "Esta cita está reservada en la agenda pero es anterior al sistema de cancelación (no tengo su identificador). NO afirmes que quedó cancelada: dile al cliente que el negocio la cancelará y crea un pendiente con handoffHuman.",
        };
      }

      if (uid) {
        const r = await cancelBooking(env, uid, motivo);
        if (!r.ok) {
          console.error(`[calcom] cancelarCita falló · uid=${uid} · ${r.reason}`);
          return {
            cancelada: false,
            error: "calcom_failed" as const,
            reason: r.reason,
            cita: objetivo.intent,
            message: "La agenda rechazó la cancelación. NO afirmes que quedó cancelada y NO agendes ninguna cita nueva todavía: dile al cliente que lo confirmas con el negocio y escala con handoffHuman.",
          };
        }
      }

      // Marca el lead local (con o sin Cal.com) para que el panel refleje la verdad.
      try {
        const nueva = JSON.stringify({ ...meta, estado: "Cancelada", canceladaEl: new Date().toISOString().slice(0, 10) });
        await db.run(`UPDATE leads SET metadata = ? WHERE id = ?`, [nueva, objetivo.id]);
      } catch (e) {
        console.warn("[calcom] cancelarCita: no se pudo marcar el lead local:", e);
      }

      return {
        cancelada: true,
        cita: objetivo.intent,
        enAgenda: Boolean(uid),
        message: uid
          ? "Cita cancelada y liberada en la agenda. Ya puedes confirmárselo al cliente (y agendar una nueva si quiere reagendar)."
          : "Cita cancelada en el registro local (no estaba reservada en la agenda). Confírmaselo al cliente; el negocio verá la cancelación en su panel.",
      };
    },
  });
}
