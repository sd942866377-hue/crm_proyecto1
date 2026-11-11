import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";

// Tools del nicho Hotelería / hospedaje (hoteles, cabañas, hostales, bodas destino,
// eventos VIP). reservarHospedaje toma solicitudes de habitación; cotizarEvento toma
// solicitudes de evento (alto ticket → siempre pasa al dueño para cotizar). NO
// confirman disponibilidad ni precio final — solo registran para que el dueño responda.

export function reservarHospedajeTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra una SOLICITUD DE HOSPEDAJE cuando el huésped ya dio fecha de entrada, fecha de salida, número de personas y su nombre. No la des por confirmada tú — el hotel confirma disponibilidad y tarifa.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre de quien reserva"),
      checkin: z.string().describe("Fecha de entrada, tal como la dijo (ej. '2026-08-10', 'viernes 10')"),
      checkout: z.string().describe("Fecha de salida"),
      huespedes: z.string().describe("Número de personas (ej. '2 adultos', '2 adultos y 1 niño')"),
      habitacion: z.string().optional().describe("Tipo de habitación o unidad si lo pidió (sencilla, doble, suite, cabaña…)"),
      contacto: z.string().optional().describe("Teléfono o email del huésped"),
      notas: z.string().optional().describe("Peticiones especiales (cuna, vista, llegada tarde, mascota, etc.)"),
    }),
    execute: async ({ nombre, checkin, checkout, huespedes, habitacion, contacto, notas }) => {
      const leads = new LeadsRepo(new Db(env.DB), env);
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Hospedaje · ${checkin} → ${checkout} · ${huespedes}`.slice(0, 300),
        notes: [habitacion ? `Habitación: ${habitacion}` : "", notas ?? ""].filter(Boolean).join(" · ") || undefined,
        metadata: { tipo: "Hospedaje", fecha: checkin, salida: checkout, huespedes, ...(habitacion ? { habitacion } : {}) },
      });
      return { reservaId: id, message: "Solicitud de hospedaje registrada. El hotel confirma disponibilidad y tarifa." };
    },
  });
}

export function cotizarEventoTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra una SOLICITUD DE EVENTO (boda, XV, evento corporativo, reunión) cuando el cliente ya dio el tipo de evento, la fecha y el número aproximado de personas. Son de alto valor: al registrar, avisa que un asesor lo cotiza personalmente.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre de quien organiza"),
      evento: z.string().describe("Tipo de evento (boda, XV años, corporativo, cumpleaños…)"),
      fecha: z.string().describe("Fecha tentativa del evento"),
      personas: z.string().describe("Número aproximado de invitados"),
      contacto: z.string().optional().describe("Teléfono o email"),
      notas: z.string().optional().describe("Detalles (hospedaje para invitados, catering, salón, presupuesto, etc.)"),
    }),
    execute: async ({ nombre, evento, fecha, personas, contacto, notas }) => {
      const leads = new LeadsRepo(new Db(env.DB), env);
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Evento · ${evento} · ${fecha} · ${personas} pers.`.slice(0, 300),
        notes: notas,
        metadata: { tipo: "Evento", fecha, huespedes: personas, evento },
      });
      return { eventoId: id, message: "Solicitud de evento registrada. Un asesor la cotiza personalmente." };
    },
  });
}
