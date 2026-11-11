/**
 * Tests del webhook de Stripe (handleStripeWebhook): rechaza firmas inválidas,
 * marca el intent como pagado, avisa al dueño y es idempotente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const messageOwnerMock = vi.fn();
vi.mock("../../src/tools/handoffHuman", () => ({
  messageOwner: (...a: unknown[]) => messageOwnerMock(...a),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { handleStripeWebhook } from "../../src/integrations/stripeWebhook";
import type { Env } from "../../src/env";

const SECRET = "whsec_test_abc";
let env: Env;
let db: Db;

async function sign(t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

function req(body: string, sig: string | null): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sig) headers["Stripe-Signature"] = sig;
  return new Request("https://bot.test/webhooks/stripe", { method: "POST", body, headers });
}

async function seedIntent(id: string, status = "pending") {
  await db.run(
    `INSERT INTO payment_intents (id, conversation_id, amount, currency, description, provider, status, created_at)
     VALUES (?, NULL, 25000, 'mxn', 'Corte', 'stripe', ?, ?)`,
    [id, status, Date.now()],
  );
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    BUSINESS_NAME: "Horizontes IA",
    DASHBOARD_BASE_URL: "https://panel.test",
    STRIPE_WEBHOOK_SECRET: SECRET,
  } as unknown as Env;
  db = new Db(d1);
  messageOwnerMock.mockReset().mockResolvedValue(undefined);
});

it("503 si no hay webhook secret configurado", async () => {
  const res = await handleStripeWebhook(req("{}", "t=1,v1=x"), { ...env, STRIPE_WEBHOOK_SECRET: undefined } as Env);
  expect(res.status).toBe(503);
});

it("400 si la firma es inválida", async () => {
  const res = await handleStripeWebhook(req(JSON.stringify({ type: "x" }), "t=1,v1=deadbeef"), env);
  expect(res.status).toBe(400);
});

it("marca pagado y avisa al dueño en checkout.session.completed", async () => {
  await seedIntent("intent-1");
  const body = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { payment_status: "paid", metadata: { intent_id: "intent-1" } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const res = await handleStripeWebhook(req(body, await sign(t, body)), env);
  expect(res.status).toBe(200);
  const row = await db.first<{ status: string; paid_at: number }>(
    "SELECT status, paid_at FROM payment_intents WHERE id = 'intent-1'",
    [],
  );
  expect(row?.status).toBe("paid");
  expect(row?.paid_at).toBeTruthy();
  expect(messageOwnerMock).toHaveBeenCalledTimes(1);
});

it("es idempotente: no reavisa si ya estaba pagado", async () => {
  await seedIntent("intent-2", "paid");
  const body = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { payment_status: "paid", metadata: { intent_id: "intent-2" } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const res = await handleStripeWebhook(req(body, await sign(t, body)), env);
  expect(res.status).toBe(200);
  expect(messageOwnerMock).not.toHaveBeenCalled();
});

it("ignora eventos que no son de pago exitoso", async () => {
  const body = JSON.stringify({ type: "payment_intent.created", data: { object: {} } });
  const t = Math.floor(Date.now() / 1000);
  const res = await handleStripeWebhook(req(body, await sign(t, body)), env);
  expect(res.status).toBe(200);
  expect(messageOwnerMock).not.toHaveBeenCalled();
});
