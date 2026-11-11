/**
 * Webhook de Stripe — confirma cobros del superpoder "Cobros por WhatsApp".
 * Verifica la firma (whsec) con Web Crypto, marca el payment_intent como pagado
 * y avisa al dueño. Idempotente: si ya estaba pagado, no reavisa.
 *
 * Montado en POST /webhooks/stripe (fuera del guard del control plane — Stripe
 * autentica por firma, no por Bearer).
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { ConversationsRepo } from "../db/conversations";
import { messageOwner } from "../tools/handoffHuman";
import { selfOriginFromRequest } from "../lib/self-origin";
import { verifyStripeSignature } from "./stripe";

interface PaymentRow {
  id: string;
  conversation_id: string | null;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
}

export async function handleStripeWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    // Sin secret configurado no podemos verificar — no procesamos nada.
    return new Response(JSON.stringify({ ok: false, error: "not_configured" }), { status: 503 });
  }

  const raw = await req.text();
  const sig = req.headers.get("Stripe-Signature");
  const valid = await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, raw, sig);
  if (!valid) {
    return new Response(JSON.stringify({ ok: false, error: "bad_signature" }), { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad_json" }), { status: 400 });
  }

  // Eventos que indican pago exitoso. El checkout.session trae la metadata del
  // payment link; el payment_intent la trae vía payment_intent_data.
  const type = event?.type as string | undefined;
  const isPaid =
    (type === "checkout.session.completed" && event?.data?.object?.payment_status === "paid") ||
    type === "payment_intent.succeeded";
  if (!isPaid) return new Response(JSON.stringify({ ok: true, ignored: type }), { status: 200 });

  const intentId = event?.data?.object?.metadata?.intent_id as string | undefined;
  if (!intentId) return new Response(JSON.stringify({ ok: true, no_intent: true }), { status: 200 });

  const db = new Db(env.DB);
  const row = await db.first<PaymentRow>(
    "SELECT id, conversation_id, amount, currency, description, status FROM payment_intents WHERE id = ?",
    [intentId],
  );
  if (!row) return new Response(JSON.stringify({ ok: true, unknown_intent: true }), { status: 200 });
  if (row.status === "paid") {
    return new Response(JSON.stringify({ ok: true, already_paid: true }), { status: 200 });
  }

  await db.run("UPDATE payment_intents SET status = 'paid', paid_at = ? WHERE id = ?", [Date.now(), intentId]);

  // Aviso al dueño: "te pagaron".
  try {
    let who = "un cliente";
    if (row.conversation_id) {
      const conv = await new ConversationsRepo(db).getById(row.conversation_id);
      who = conv?.display_name || conv?.channel_user_id || who;
    }
    const amount = (row.amount / 100).toFixed(2);
    await messageOwner(env, {
      heading: "💰 ¡Te pagaron!",
      body: `${who} pagó $${amount} ${row.currency.toUpperCase()}${row.description ? ` — ${row.description}` : ""}.`,
      url: `${await selfOriginFromRequest(env, req.url)}/admin`,
    });
  } catch (e) {
    console.error("[stripeWebhook] owner notify failed:", e);
  }

  return new Response(JSON.stringify({ ok: true, paid: intentId }), { status: 200 });
}
