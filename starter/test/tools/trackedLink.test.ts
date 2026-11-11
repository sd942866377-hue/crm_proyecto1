/**
 * Tests del candado de la oferta en trackedLink: antes del día del evento
 * (fase "pre") el target "oferta" se rechaza a nivel servidor — la página no
 * es pública y el bot no debe poder filtrarla aunque el prompt falle. Los
 * demás targets siguen funcionando en cualquier fase.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { trackedLinkTool } from "../../src/tools/masterclass";
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

const DAY = 24 * 3600_000;

let env: Env;
let db: Db;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    DASHBOARD_BASE_URL: "https://bot.example.com",
    EVENT_REGISTER_URL: "https://masterclass.example.com",
    EVENT_OFFER_URL: "https://masterclass.example.com/oferta/secreta",
  } as unknown as Env;
  db = new Db(d1);
});

async function run(target: string) {
  const tool = trackedLinkTool(env, () => "twilio:u1") as any;
  return tool.execute({ target }, { toolCallId: "t1", messages: [] });
}

describe("trackedLink — candado de la oferta pre-evento", () => {
  it("rechaza 'oferta' antes del evento y NO crea el link", async () => {
    (env as any).EVENT_STARTS_AT = new Date(Date.now() + 7 * DAY).toISOString();

    const r = await run("oferta");
    expect(r.error).toContain("NO es pública");
    expect(r.error).toContain("horizontesia.com");
    expect(r.url).toBeUndefined();

    const rows = await db.all("SELECT * FROM tracked_links WHERE target = 'oferta'");
    expect(rows.length).toBe(0);
  });

  it("sin fecha configurada también cuenta como pre (rechaza)", async () => {
    const r = await run("oferta");
    expect(r.error).toContain("NO es pública");
  });

  it("el día del evento (ya en vivo) la oferta SÍ sale", async () => {
    (env as any).EVENT_STARTS_AT = new Date(Date.now() - 30 * 60_000).toISOString();
    (env as any).EVENT_DURATION_MIN = "120";

    const r = await run("oferta");
    expect(r.error).toBeUndefined();
    expect(r.url).toMatch(/https:\/\/bot\.example\.com\/l\/[a-z2-9]{7}/);
  });

  it("'registro' funciona normal aunque el evento no haya empezado", async () => {
    (env as any).EVENT_STARTS_AT = new Date(Date.now() + 7 * DAY).toISOString();

    const r = await run("registro");
    expect(r.error).toBeUndefined();
    expect(r.url).toMatch(/\/l\/[a-z2-9]{7}$/);
  });
});
