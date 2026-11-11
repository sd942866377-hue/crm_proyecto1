import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";

// Tools del nicho Restaurante. Ambas registran un "lead" con metadata propia del
// giro (fecha/hora/personas/tipo) para que el dashboard lo muestre como reserva
// o pedido. NO confirman nada — solo registran para que el dueño lo procese.

export function crearReservacionTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra una RESERVACIÓN de mesa cuando el cliente ya dio día, hora, número de personas y nombre. No la des por confirmada tú — el restaurante confirma.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre de quien reserva"),
      fecha: z.string().describe("Día de la reserva, tal como lo dijo el cliente (ej. '2026-07-20', 'sábado')"),
      hora: z.string().describe("Hora de la reserva (ej. '9pm', '21:00')"),
      personas: z.number().int().positive().describe("Número de comensales"),
      contacto: z.string().optional().describe("Teléfono del cliente si lo dio"),
      notas: z.string().optional().describe("Peticiones especiales (cumpleaños, silla de bebé, etc.)"),
    }),
    execute: async ({ nombre, fecha, hora, personas, contacto, notas }) => {
      const leads = new LeadsRepo(new Db(env.DB), env);
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Reservación · ${personas} pers. · ${fecha} ${hora}`,
        notes: notas,
        metadata: { tipo: "Mesa", fecha, hora, personas },
      });
      return { reservacionId: id, message: "Reservación registrada. El restaurante la confirma." };
    },
  });
}

export function tomarPedidoTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra un PEDIDO para llevar o a domicilio cuando el cliente ya dio los platillos, la dirección (si es delivery) y el método de pago. Verifica antes que la dirección esté en zona de reparto. No confirmes la orden como lista — solo la registras.",
    inputSchema: z.object({
      nombre: z.string().optional().describe("Nombre del cliente"),
      tipo: z.enum(["delivery", "llevar"]).describe("delivery = a domicilio; llevar = pasa por él"),
      platillos: z.string().describe("Lista de platillos y cantidades, tal como los pidió"),
      direccion: z.string().optional().describe("Dirección de entrega (solo si es delivery)"),
      pago: z.string().describe("Método de pago (efectivo, transferencia, tarjeta…)"),
      contacto: z.string().optional().describe("Teléfono del cliente"),
    }),
    execute: async ({ nombre, tipo, platillos, direccion, pago, contacto }) => {
      const leads = new LeadsRepo(new Db(env.DB), env);
      const tipoLabel = tipo === "delivery" ? "Delivery" : "Para llevar";
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Pedido ${tipoLabel.toLowerCase()} · ${platillos}`.slice(0, 300),
        notes: [direccion ? `Dirección: ${direccion}` : "", `Pago: ${pago}`].filter(Boolean).join(" · "),
        metadata: { tipo: tipoLabel, platillos, ...(direccion ? { direccion } : {}), pago },
      });
      return { pedidoId: id, message: "Pedido registrado. El restaurante lo procesa." };
    },
  });
}
