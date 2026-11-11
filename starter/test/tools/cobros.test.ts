/**
 * Tests de la tool sendPaymentLink (Cobros por WhatsApp): sin Stripe avisa "no
 * conectado", el toggle apagado la pausa, y en el happy path crea el link +
 * persiste el payment_intent. fetch de Stripe stubeado; D1 real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { sendPaymentLinkTool } from "../../src/tools/cobros";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;

function buildTool(e: Env) {
  return sendPaymentLinkTool(e, () => "conv-1") as any;
}

function stubStripeOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/prices")) {
        return new Response(JSON.stringify({ id: "price_1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ id: "plink_1", url: "https://buy.stripe.com/test_x" }),
        { status: 200 },
      );
    }),
  );
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = { DB: d1, STRIPE_SECRET_KEY: "sk_test" } as unknown as Env;
  db = new Db(d1);
});
afterEach(() => vi.restoreAllMocks());

it("avisa 'no conectado' sin STRIPE_SECRET_KEY", async () => {
  const tool = buildTool({ DB: env.DB } as Env);
  const out = await tool.execute({ amount: 250, currency: "mxn", description: "Corte" });
  expect(out).toEqual({ error: "payments_not_connected" });
});

it("pausado si payments_enabled = 0", async () => {
  await new SettingsRepo(db).set(SETTING_KEYS.paymentsEnabled, "0");
  const tool = buildTool(env);
  const out = await tool.execute({ amount: 250, currency: "mxn", description: "Corte" });
  expect(out).toEqual({ error: "payments_disabled" });
});

it("happy path: crea el link y persiste el intent", async () => {
  // La conversación debe existir (FK payment_intents → conversations).
  await db.run(
    "INSERT INTO conversations (id, channel, channel_user_id, started_at, last_message_at) VALUES ('conv-1','telegram','u1',?,?)",
    [Date.now(), Date.now()],
  );
  stubStripeOk();
  const tool = buildTool(env);
  const out = await tool.execute({ amount: 250, currency: "MXN", description: "Corte + barba" });
  expect(out.url).toBe("https://buy.stripe.com/test_x");
  const row = await db.first<{ amount: number; currency: string; status: string; url: string }>(
    "SELECT amount, currency, status, url FROM payment_intents WHERE conversation_id = 'conv-1'",
    [],
  );
  expect(row?.amount).toBe(25000); // centavos
  expect(row?.currency).toBe("mxn");
  expect(row?.status).toBe("pending");
  expect(row?.url).toBe("https://buy.stripe.com/test_x");
});

it("devuelve error si Stripe falla (no persiste como pagado)", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 })));
  const tool = buildTool(env);
  const out = await tool.execute({ amount: 10, currency: "usd", description: "x" });
  expect(out.error).toBe("payment_link_failed");
});
