/**
 * Integración Stripe para el superpoder "Cobros por WhatsApp".
 *
 * Con la llave secreta del miembro (STRIPE_SECRET_KEY) creamos un Payment Link
 * de monto arbitrario en dos pasos de API (precio inline → payment link) y el
 * webhook confirma el pago. La llave vive como secret de Cloudflare; el bot
 * nunca la ve en texto ni la guarda en D1.
 *
 * Verificación de firma del webhook (Stripe-Signature) con Web Crypto —
 * HMAC-SHA256 sobre `${t}.${payload}`, comparación timing-safe.
 */
import type { Env } from "../env";

const STRIPE_API = "https://api.stripe.com/v1";

export function stripeConfigured(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

async function stripePost(
  env: Env,
  path: string,
  form: Record<string, string>,
): Promise<any> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  const body = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(`stripe ${path} ${res.status}: ${body?.error?.message ?? "error"}`);
  }
  return body;
}

export interface PaymentLinkInput {
  amount: number; // en la unidad mayor (pesos, dólares) — se convierte a centavos
  currency: string; // "mxn", "usd"…
  description: string;
  intentId: string; // nuestro payment_intents.id — viaja en metadata para el webhook
  conversationId?: string;
}

export interface PaymentLinkOutput {
  url: string;
  providerId: string; // id del payment link
}

/** Crea un Payment Link de Stripe por un monto arbitrario. */
export async function createPaymentLink(
  env: Env,
  input: PaymentLinkInput,
): Promise<PaymentLinkOutput> {
  const unitAmount = Math.round(input.amount * 100); // centavos

  // Paso 1: precio inline (crea producto + precio en un solo llamado).
  const price = await stripePost(env, "/prices", {
    currency: input.currency.toLowerCase(),
    unit_amount: String(unitAmount),
    "product_data[name]": input.description.slice(0, 250) || "Cobro",
  });

  // Paso 2: payment link con ese precio. La metadata viaja al checkout session
  // para que el webhook encuentre nuestro intent.
  const link = await stripePost(env, "/payment_links", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": "1",
    "metadata[intent_id]": input.intentId,
    ...(input.conversationId ? { "metadata[conversation_id]": input.conversationId } : {}),
    "payment_intent_data[metadata][intent_id]": input.intentId,
  });

  return { url: link.url as string, providerId: link.id as string };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifica la firma de un webhook de Stripe. Header formato:
 *   t=1712345678,v1=<hex>,v0=<hex>
 * signed_payload = `${t}.${rawBody}`; HMAC-SHA256 con el whsec.
 * Tolerancia de 5 min contra replay.
 */
export async function verifyStripeSignature(
  secret: string,
  rawBody: string,
  sigHeader: string | null,
  now: number = Date.now(),
): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const [k, ...rest] = kv.split("=");
      return [k.trim(), rest.join("=").trim()];
    }),
  ) as Record<string, string>;
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  // Anti-replay: rechaza timestamps de hace > 5 min.
  const ts = Number.parseInt(t, 10);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  return timingSafeEqual(toHex(mac), v1);
}
