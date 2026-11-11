import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";

/**
 * Recopilación de funciones para Forja (instancia Horizontes, gated por
 * FEATURE_MODE="on"): guarda una sugerencia de función/mejora que un usuario
 * quiere que se agregue a Forja. Nace de una historia de Instagram donde Santi
 * pide que le manden las funciones que les gustaría. Upsert por conversación:
 * si la persona manda varias ideas en el mismo chat, se acumulan (una fila por
 * llamada, no se sobrescribe) para no perder ninguna.
 */
export function forjaFeatureTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Guarda una función, mejora o idea que un usuario quiere que se agregue a Forja (la app de chatbots). Úsala SIEMPRE que alguien proponga, pida o sugiera algo que le gustaría que Forja tuviera o hiciera, aunque lo diga de pasada. Después de guardarla, agradécele y dile que se la pasas al equipo. Si menciona varias ideas, llama la tool una vez por cada idea.",
    inputSchema: z.object({
      feature: z
        .string()
        .describe("La función o mejora que pide, en 1-2 frases claras y concretas"),
      motivo: z
        .string()
        .optional()
        .describe("Por qué la quiere o qué problema le resolvería, si lo dijo"),
      nombre: z.string().optional().describe("Nombre de la persona, si lo sabes"),
    }),
    execute: async ({ feature, motivo, nombre }) => {
      const convId = getConversationId();
      await env.DB.prepare(
        `INSERT INTO forja_features (id, conversation_id, feature, motivo, nombre, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), convId, feature, motivo ?? null, nombre ?? null, Date.now())
        .run();
      return { ok: true, message: "Función guardada. Agradécele y dile que se la pasas al equipo de Forja." };
    },
  });
}
