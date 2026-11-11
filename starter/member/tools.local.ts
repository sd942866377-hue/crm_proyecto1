// member/tools.local.ts — TUS funciones extra del bot ("tools").
//
// Esta carpeta (member/) es TUYA: las actualizaciones (`forjabot update`) NUNCA
// la tocan. Todo lo que definas aquí SOBREVIVE cada actualización, ya conectado
// (a diferencia de editar src/, que el update reemplaza).
//
// Devuelve un objeto { nombreDeLaTool: tool(...) }. Déjalo vacío ({}) para no
// agregar ninguna. Para escribir una sin programar, usa el skill /agregar-tool.
//
// Para agregar una tool, importa los helpers y regrésala:
//   import { tool } from "ai";
//   import { z } from "zod";
//
// `ctx.env` = variables/bindings del bot; `ctx.getConversationId()` = la
// conversación en curso.
import type { MemberToolCtx } from "../src/tools/member";

export function memberTools(ctx: MemberToolCtx): Record<string, unknown> {
  void ctx; // quítalo cuando uses ctx dentro de tus tools
  return {
    // Ejemplo — descomenta, agrega los imports de arriba y adáptalo:
    //
    // estatusPedido: tool({
    //   description: "Consulta el estatus de un pedido por su número de orden.",
    //   inputSchema: z.object({ orden: z.string().describe("número de orden") }),
    //   execute: async ({ orden }) => {
    //     // Tu lógica. Puedes usar ctx.env y ctx.getConversationId().
    //     return `El pedido ${orden} está en preparación.`;
    //   },
    // }),
  };
}
