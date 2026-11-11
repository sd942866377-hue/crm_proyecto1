import { tool } from "ai";
import { z } from "zod";
import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";
import { createPaymentLink, stripeConfigured } from "../integrations/stripe";

/**
 * Cobros por WhatsApp (superpoder Pro) — el bot genera un link de pago de Stripe
 * y se lo manda al cliente. El webhook /api/stripe/webhook confirma cuando pagan
 * y avisa al dueño. Requiere STRIPE_SECRET_KEY (secret del miembro); sin él la
 * tool no se registra. El toggle payments_enabled (setting) lo pausa sin borrar
 * la llave.
 */
export function sendPaymentLinkTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Genera un link de pago de Stripe para cobrarle a un cliente por WhatsApp. Úsalo cuando el cliente quiere pagar o confirmar una compra. Devuelve el link para mandárselo; el dueño recibe aviso cuando el pago se confirma.",
    inputSchema: z.object({
      amount: z.number().positive().describe("Monto a cobrar (ej. 250 = $250)"),
      currency: z.string().length(3).default("mxn").describe("Moneda ISO: mxn, usd…"),
      description: z.string().max(200).describe("Qué se está cobrando (ej. 'Corte + barba')"),
    }),
    execute: async ({ amount, currency, description }) => {
      if (!stripeConfigured(env)) return { error: "payments_not_connected" as const };

      const db = new Db(env.DB);
      const settings = new SettingsRepo(db);
      // El dueño puede pausar los cobros sin quitar la llave.
      if ((await settings.get(SETTING_KEYS.paymentsEnabled)) === "0") {
        return { error: "payments_disabled" as const };
      }

      const intentId = crypto.randomUUID();
      const conversationId = getConversationId();
      const now = Date.now();

      try {
        const { url, providerId } = await createPaymentLink(env, {
          amount,
          currency,
          description,
          intentId,
          conversationId: conversationId ?? undefined,
        });
        await db.run(
          `INSERT INTO payment_intents
             (id, conversation_id, amount, currency, description, provider, provider_id, url, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'stripe', ?, ?, 'pending', ?)`,
          [intentId, conversationId, Math.round(amount * 100), currency.toLowerCase(), description, providerId, url, now],
        );
        return { url, amount, currency: currency.toLowerCase(), description };
      } catch (e: any) {
        console.error("[cobros] createPaymentLink failed:", e);
        return { error: "payment_link_failed" as const, message: String(e?.message ?? e) };
      }
    },
  });
}
