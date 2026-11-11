import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";

// Tools del nicho Inmobiliaria. Registran un "lead" con metadata del giro
// (operación/tipo/zona/presupuesto…) para el pipeline de compradores. NO cierran
// nada ni prometen precios/comisiones — solo capturan para el asesor.

export function calificarCompradorTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra un COMPRADOR CALIFICADO cuando ya sabes qué busca: operación, tipo de propiedad, zona y presupuesto (recámaras/timeline/financiamiento si los dio). Es el registro más valioso del bot.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre del prospecto"),
      operacion: z.enum(["compra", "renta"]).describe("Si quiere comprar o rentar"),
      tipo: z.string().describe("Tipo de propiedad (casa, departamento, terreno, local, oficina)"),
      zona: z.string().describe("Zona o colonia de interés"),
      presupuesto: z.string().describe("Presupuesto aproximado, tal como lo dijo (ej. '2.5 mdp', 'hasta 18 mil/mes')"),
      recamaras: z.string().optional().describe("Recámaras o m2 mínimos, si lo mencionó"),
      timeline: z.string().optional().describe("Para cuándo busca mudarse/comprar (ej. 'este mes', 'en 6 meses')"),
      financiamiento: z.string().optional().describe("Cómo pagaría (contado, Infonavit, crédito bancario…)"),
      contacto: z.string().optional().describe("Teléfono o email"),
    }),
    execute: async ({ nombre, operacion, tipo, zona, presupuesto, recamaras, timeline, financiamiento, contacto }) => {
      const leads = new LeadsRepo(new Db(env.DB), env);
      const op = operacion === "renta" ? "Renta" : "Compra";
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Comprador · ${op} de ${tipo} en ${zona} · ${presupuesto}`.slice(0, 300),
        notes: [timeline ? `Timeline: ${timeline}` : "", financiamiento ? `Financiamiento: ${financiamiento}` : ""].filter(Boolean).join(" · ") || undefined,
        metadata: {
          operacion: op,
          tipo,
          zona,
          presupuesto,
          ...(recamaras ? { recamaras } : {}),
          ...(timeline ? { timeline } : {}),
          ...(financiamiento ? { financiamiento } : {}),
        },
      });
      return { compradorId: id, message: "Comprador calificado registrado." };
    },
  });
}

export function registrarVisitaTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra una VISITA a una propiedad cuando el cliente ya dio la propiedad de interés, el día, la hora y su nombre. No la des por confirmada tú — un asesor confirma.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre de quien visita"),
      propiedad: z.string().describe("Propiedad o dirección que quiere visitar"),
      fecha: z.string().describe("Día de la visita, tal como lo dijo (ej. 'sábado', '2026-07-20')"),
      hora: z.string().describe("Hora de la visita"),
      contacto: z.string().optional().describe("Teléfono del cliente"),
    }),
    execute: async ({ nombre, propiedad, fecha, hora, contacto }) => {
      const leads = new LeadsRepo(new Db(env.DB), env);
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Visita · ${propiedad} · ${fecha} ${hora}`.slice(0, 300),
        // operacion="Visita" para que se distinga en el pipeline de compradores.
        metadata: { operacion: "Visita", propiedad, fecha, hora },
      });
      return { visitaId: id, message: "Visita registrada. Un asesor la confirma." };
    },
  });
}
