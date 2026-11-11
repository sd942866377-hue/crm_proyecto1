import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { executeComposioTool } from "../integrations/composio";

/**
 * Puente genérico a Composio (composio.dev): ejecuta CUALQUIER tool de
 * cualquier app que el miembro haya conectado (Google Calendar, Gmail, Slack,
 * Notion, CRMs…), sin código por app. El LLM ve qué apps/tools tiene
 * disponibles vía el bloque <integraciones_composio> del system prompt
 * (armado en agent.ts a partir de listConnectedTools) y llama esta tool con
 * el slug exacto + los argumentos que esa tool pida.
 */
export function composioTool(env: Env) {
  return tool({
    description:
      "Ejecuta una acción en una app externa que el dueño conectó vía Composio (Google Calendar, Gmail, Slack, Notion, CRMs…). Usa el tool_slug EXACTO de la lista en <integraciones_composio> del system prompt — nunca inventes uno. Pásale los argumentos que esa tool necesite según su propia descripción.",
    inputSchema: z.object({
      tool_slug: z
        .string()
        .describe('Slug exacto de la tool de Composio a ejecutar, ej. "GOOGLECALENDAR_CREATE_EVENT"'),
      arguments: z
        .record(z.string(), z.unknown())
        .default({})
        .describe("Argumentos de la tool, según lo que pida su descripción"),
    }),
    execute: async ({ tool_slug, arguments: args }) => {
      const result = await executeComposioTool(env, tool_slug, (args ?? {}) as Record<string, unknown>);
      if (!result.ok) return { error: result.error };
      return { data: result.data };
    },
  });
}
