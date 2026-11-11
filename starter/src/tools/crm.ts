import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";

// Tool del nicho CRM / ventas B2B. El bot califica prospectos entrantes (agencias,
// consultores, freelancers, PYMEs) y los mete al pipeline: quién es, de qué empresa,
// qué necesita, presupuesto y para cuándo. NO cierra la venta — deja el prospecto
// calificado para que el dueño le dé seguimiento.

export function registrarProspectoTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra un PROSPECTO de venta cuando ya sabes qué necesita y quién es. Captura empresa, la necesidad concreta y, si los dio, presupuesto y para cuándo. Es el registro más valioso del bot: alimenta el pipeline de ventas.",
    inputSchema: z.object({
      nombre: z.string().describe("Nombre de la persona con la que hablas"),
      empresa: z.string().optional().describe("Empresa o negocio del prospecto (si aplica; puede ser independiente)"),
      necesidad: z.string().describe("Qué necesita o qué problema quiere resolver, en concreto"),
      presupuesto: z.string().optional().describe("Presupuesto o rango de inversión que mencionó (ej. '30-50k', 'no sé aún')"),
      timeline: z.string().optional().describe("Para cuándo lo necesita / urgencia (ej. 'este mes', 'explorando')"),
      contacto: z.string().optional().describe("Email o teléfono para dar seguimiento"),
    }),
    execute: async ({ nombre, empresa, necesidad, presupuesto, timeline, contacto }) => {
      const leads = new LeadsRepo(new Db(env.DB), env);
      const quien = empresa || nombre;
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Prospecto · ${quien} · ${necesidad}`.slice(0, 300),
        notes: [presupuesto ? `Presupuesto: ${presupuesto}` : "", timeline ? `Timeline: ${timeline}` : ""].filter(Boolean).join(" · ") || undefined,
        metadata: {
          ...(empresa ? { empresa } : {}),
          necesidad,
          ...(presupuesto ? { presupuesto } : {}),
          ...(timeline ? { timeline } : {}),
        },
      });
      return { prospectoId: id, message: "Prospecto registrado en el pipeline." };
    },
  });
}
