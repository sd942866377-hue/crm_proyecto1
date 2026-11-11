import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";

/**
 * Modo auditoría (instancia Horizontes, gated por AUDIT_MODE="on"):
 * guarda el caso auditado de un negocio para la dinámica de la masterclass.
 * Upsert por conversación — una auditoría por persona.
 */
export function submitAuditCaseTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Guarda el caso de auditoría de automatización de un negocio (dinámica de la masterclass). Llámala UNA vez al cerrar la auditoría, con todo lo aprendido en la conversación.",
    inputSchema: z.object({
      name: z.string().describe("Nombre de la persona"),
      giro: z.string().describe("Giro/tipo de negocio (ej. barbería, restaurante, inmobiliaria)"),
      problema: z.string().describe("El dolor principal detectado, en 1-2 frases concretas"),
      cuantificacion: z
        .string()
        .describe("Los números: mensajes/clientes por semana, valor de un cliente, clientes perdidos al mes"),
      costo_estimado: z
        .string()
        .describe("El costo anual estimado de NO automatizar que calculaste (ej. '$14,400 USD/año')"),
      recomendacion: z
        .string()
        .describe("La primera automatización recomendada y qué haría su bot (2-3 puntos específicos)"),
      consentimiento_publico: z
        .boolean()
        .describe("true si autorizó que su caso se muestre en vivo en la masterclass"),
      resumen: z.string().describe("Resumen del caso en 3 líneas, listo para leerse en voz alta"),
    }),
    execute: async (c) => {
      const convId = getConversationId();
      await env.DB.prepare(
        `INSERT INTO audit_cases (id, conversation_id, name, giro, problema, cuantificacion, costo_estimado, recomendacion, consentimiento_publico, resumen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           name=excluded.name, giro=excluded.giro, problema=excluded.problema,
           cuantificacion=excluded.cuantificacion, costo_estimado=excluded.costo_estimado,
           recomendacion=excluded.recomendacion, consentimiento_publico=excluded.consentimiento_publico,
           resumen=excluded.resumen`,
      )
        .bind(
          crypto.randomUUID(),
          convId,
          c.name,
          c.giro,
          c.problema,
          c.cuantificacion,
          c.costo_estimado,
          c.recomendacion,
          c.consentimiento_publico ? 1 : 0,
          c.resumen,
          Date.now(),
        )
        .run();
      return { ok: true, message: "Caso de auditoría guardado. La persona ya participa en la dinámica." };
    },
  });
}
