import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { LeadsRepo } from "../db/leads";

// Tool compartida por los nichos de COMERCIO / PEDIDOS (tienda, panadería).
// Registra un "lead" con metadata del giro (productos/entrega/fecha/pago) para que
// el dashboard lo muestre como un pedido. NO confirma la orden como lista — solo la
// registra para que el dueño la procese.

export function registrarPedidoTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Registra un PEDIDO cuando el cliente ya dijo qué productos quiere, cómo lo recibe (recoger en tienda o envío a domicilio) y cómo paga. Para pedidos por encargo (pasteles, mercancía sobre pedido) confirma también la fecha de entrega. No confirmes el pedido como listo — solo lo registras para que el negocio lo procese.",
    inputSchema: z.object({
      nombre: z.string().optional().describe("Nombre del cliente"),
      productos: z.string().describe("Lista de productos y cantidades, tal como los pidió"),
      entrega: z
        .enum(["recoger", "domicilio"])
        .describe("recoger = pasa a la tienda por él; domicilio = envío a su dirección"),
      direccion: z.string().optional().describe("Dirección de entrega (solo si es a domicilio)"),
      fecha: z
        .string()
        .optional()
        .describe("Para cuándo lo necesita / fecha de recolección o entrega (clave en pedidos por encargo)"),
      pago: z.string().describe("Método de pago (efectivo, transferencia, tarjeta…)"),
      contacto: z.string().optional().describe("Teléfono del cliente"),
    }),
    execute: async ({ nombre, productos, entrega, direccion, fecha, pago, contacto }) => {
      const leads = new LeadsRepo(new Db(env.DB), env);
      const entregaLabel = entrega === "domicilio" ? "Domicilio" : "Recoger";
      const id = await leads.create({
        conversationId: getConversationId(),
        channelUserId: null,
        name: nombre,
        contact: contacto,
        intent: `Pedido · ${productos}`.slice(0, 300),
        notes: [direccion ? `Dirección: ${direccion}` : "", `Pago: ${pago}`].filter(Boolean).join(" · "),
        metadata: {
          productos: productos.slice(0, 120),
          entrega: entregaLabel,
          ...(fecha ? { fecha } : {}),
          pago,
        },
      });
      return { pedidoId: id, message: "Pedido registrado. El negocio lo procesa." };
    },
  });
}
