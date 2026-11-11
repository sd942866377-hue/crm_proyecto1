/**
 * Tests de la integración Stripe (superpoder Cobros por WhatsApp):
 * verificación de firma del webhook (Web Crypto) y creación del payment link
 * (fetch mockeado). La firma es crítica — un webhook falso NO debe pasar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifyStripeSignature,
  createPaymentLink,
  stripeConfigured,
} from "../../src/integrations/stripe";
import type { Env } from "../../src/env";

const SECRET = "whsec_test_1234567890";

/** Firma un payload como lo hace Stripe: HMAC-SHA256 de `${t}.${body}`. */
async function sign(secret: string, t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

describe("verifyStripeSignature", () => {
  const body = JSON.stringify({ type: "checkout.session.completed" });
  const now = 1_700_000_000_000; // ms
  const t = Math.floor(now / 1000);

  it("acepta una firma válida y reciente", async () => {
    const header = await sign(SECRET, t, body);
    expect(await verifyStripeSignature(SECRET, body, header, now)).toBe(true);
  });

  it("rechaza firma con secret equivocado", async () => {
    const header = await sign("whsec_otro", t, body);
    expect(await verifyStripeSignature(SECRET, body, header, now)).toBe(false);
  });

  it("rechaza si el payload fue alterado", async () => {
    const header = await sign(SECRET, t, body);
    expect(await verifyStripeSignature(SECRET, body + "x", header, now)).toBe(false);
  });

  it("rechaza timestamps viejos (anti-replay > 5 min)", async () => {
    const header = await sign(SECRET, t, body);
    const sixMinLater = now + 6 * 60 * 1000;
    expect(await verifyStripeSignature(SECRET, body, header, sixMinLater)).toBe(false);
  });

  it("rechaza header ausente o malformado", async () => {
    expect(await verifyStripeSignature(SECRET, body, null, now)).toBe(false);
    expect(await verifyStripeSignature(SECRET, body, "t=123", now)).toBe(false);
  });
});

describe("stripeConfigured", () => {
  it("true solo con STRIPE_SECRET_KEY", () => {
    expect(stripeConfigured({} as Env)).toBe(false);
    expect(stripeConfigured({ STRIPE_SECRET_KEY: "sk_test" } as Env)).toBe(true);
  });
});

describe("createPaymentLink", () => {
  const env = { STRIPE_SECRET_KEY: "sk_test_x" } as Env;

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crea precio inline y payment link, y devuelve la url", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        calls.push({ url, body: String(init.body) });
        if (url.endsWith("/prices")) {
          return new Response(JSON.stringify({ id: "price_123" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ id: "plink_123", url: "https://buy.stripe.com/test_abc" }),
          { status: 200 },
        );
      }),
    );

    const out = await createPaymentLink(env, {
      amount: 250,
      currency: "MXN",
      description: "Corte + barba",
      intentId: "intent-1",
      conversationId: "conv-1",
    });

    expect(out).toEqual({ url: "https://buy.stripe.com/test_abc", providerId: "plink_123" });
    // Precio en centavos y en minúsculas la moneda.
    expect(calls[0].body).toContain("unit_amount=25000");
    expect(calls[0].body).toContain("currency=mxn");
    // El intent viaja en metadata para que el webhook lo encuentre.
    expect(calls[1].body).toContain("intent-1");
    expect(calls[1].body).toContain("price_123");
  });

  it("lanza si Stripe responde error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "no auth" } }), { status: 401 })),
    );
    await expect(
      createPaymentLink(env, { amount: 10, currency: "usd", description: "x", intentId: "i" }),
    ).rejects.toThrow(/stripe/);
  });
});
