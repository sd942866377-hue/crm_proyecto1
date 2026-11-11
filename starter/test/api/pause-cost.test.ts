/**
 * Contrato v3.2 §6 (pausa global) y §7 (gasto de IA del mes) — src/api.ts.
 * D1 real vía miniflare, sub-app ejercida directo (apiApp.request) igual que
 * los demás contract tests.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { apiApp, pauseState } from "../../src/api";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import type { Env } from "../../src/env";

const TOKEN = "cp-secret-token";
const DAY_MS = 24 * 60 * 60 * 1000;

let d1: any;
let db: Db;

function authedEnv(): Env {
  return {
    DB: d1,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    CONTROL_PLANE_TOKEN: TOKEN,
  } as unknown as Env;
}

const bearer = { Authorization: `Bearer ${TOKEN}` };
/** El body de la respuesta, sin pelearse con `unknown` en cada assert. */
const json = (res: Response): Promise<any> => res.json() as Promise<any>;
const jsonHeaders = { ...bearer, "Content-Type": "application/json" };

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
  db = new Db(d1);
});

function pausa(body: unknown) {
  return apiApp.request(
    "/pause",
    { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) },
    authedEnv(),
  );
}

describe("POST /api/pause (§6)", () => {
  it("401 sin Bearer", async () => {
    const env = authedEnv() as any;
    delete env.CONTROL_PLANE_TOKEN;
    const res = await apiApp.request(
      "/pause",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("epochMs futuro → paused_mode 'until' y persiste bot_paused_until", async () => {
    const until = Date.now() + 60 * 60 * 1000;
    const res = await pausa({ until });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      ok: true,
      paused: true,
      paused_until: until,
      paused_mode: "until",
    });
    const settings = new SettingsRepo(db);
    expect(await settings.get(SETTING_KEYS.botPausedUntil)).toBe(String(until));
    expect(await settings.get(SETTING_KEYS.botPaused)).toBe("0");
  });

  it("'manual' → paused_mode 'manual', sin hora de término", async () => {
    const res = await pausa({ until: "manual" });
    expect(await json(res)).toEqual({
      ok: true,
      paused: true,
      paused_until: 0,
      paused_mode: "manual",
    });
    expect(await new SettingsRepo(db).get(SETTING_KEYS.botPaused)).toBe("1");
  });

  it("null → prende el bot y limpia ambos settings", async () => {
    await pausa({ until: "manual" });
    const res = await pausa({ until: null });
    expect(await json(res)).toEqual({
      ok: true,
      paused: false,
      paused_until: 0,
      paused_mode: "off",
    });
    const settings = new SettingsRepo(db);
    expect(await settings.get(SETTING_KEYS.botPaused)).toBe("0");
    expect(await settings.get(SETTING_KEYS.botPausedUntil)).toBe("");
  });

  it("una pausa CON fecha apaga el switch manual (si no, sería eterna)", async () => {
    await pausa({ until: "manual" });
    const until = Date.now() + 60 * 60 * 1000;
    const res = await pausa({ until });
    expect((await json(res)).paused_mode).toBe("until");
    expect(await new SettingsRepo(db).get(SETTING_KEYS.botPaused)).toBe("0");
  });

  it("400 invalid_until: pasado, >30 días, no entero, string suelto y sin campo", async () => {
    const casos: unknown[] = [
      { until: Date.now() - 1000 },
      { until: Date.now() + 31 * DAY_MS },
      { until: Date.now() + 1000.5 },
      { until: "mañana" },
      {},
    ];
    for (const body of casos) {
      const res = await pausa(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await json(res)).error).toBe("invalid_until");
    }
    // Nada se escribió: el bot sigue prendido.
    expect(await new SettingsRepo(db).get(SETTING_KEYS.botPaused)).toBeNull();
  });

  it("400 invalid_json con body roto", async () => {
    const res = await apiApp.request(
      "/pause",
      { method: "POST", headers: jsonHeaders, body: "{no-json" },
      authedEnv(),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("invalid_json");
  });
});

describe("GET /api/config gana paused_mode (§6)", () => {
  it("refleja el modo de la pausa vigente", async () => {
    const sinPausa = await json(await apiApp.request("/config", { headers: bearer }, authedEnv()));
    expect(sinPausa.paused_mode).toBe("off");
    expect(sinPausa.paused).toBe(false);

    const until = Date.now() + 60 * 60 * 1000;
    await pausa({ until });
    const conPausa = await json(await apiApp.request("/config", { headers: bearer }, authedEnv()));
    expect(conPausa.paused_mode).toBe("until");
    expect(conPausa.paused_until).toBe(until);
  });

  it("una pausa temporal VENCIDA ya no pausa", async () => {
    await new SettingsRepo(db).set(SETTING_KEYS.botPausedUntil, String(Date.now() - 1000));
    const j = await json(await apiApp.request("/config", { headers: bearer }, authedEnv()));
    expect(j.paused).toBe(false);
    expect(j.paused_mode).toBe("off");
    expect(j.paused_until).toBe(0);
  });
});

describe("pauseState()", () => {
  it("el switch manual gana y no arrastra un bot_paused_until viejo", () => {
    const viejo = String(Date.now() - 99_000);
    expect(pauseState("1", viejo)).toEqual({ paused: true, paused_until: 0, paused_mode: "manual" });
  });
});

describe("GET /api/cost (§7)", () => {
  /** $2 de input (2M tokens haiku a $1/MTok) + $1 de output (200k a $5/MTok) = $3. */
  async function seedGasto() {
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, started_at, last_message_at)
       VALUES ('whatsapp:u1','whatsapp','u1',?,?)`,
      [Date.now(), Date.now()],
    );
    await db.run(
      `INSERT INTO messages (id, conversation_id, role, content, model_used, input_tokens, output_tokens, created_at)
       VALUES ('m1','whatsapp:u1','assistant','hola','claude-haiku-4-5-20251001',2000000,200000,?)`,
      [Date.now()],
    );
  }

  it("401 sin Bearer", async () => {
    const env = authedEnv() as any;
    delete env.CONTROL_PLANE_TOKEN;
    expect((await apiApp.request("/cost", {}, env)).status).toBe(401);
  });

  it("shape completo con el tope por default ($25)", async () => {
    await seedGasto();
    const j = await json(await apiApp.request("/cost", { headers: bearer }, authedEnv()));
    expect(j.ok).toBe(true);
    expect(j.month_usd).toBe(3);
    expect(j.budget_usd).toBe(25);
    expect(j.budget_is_default).toBe(true);
    expect(j.pct).toBe(12);
    expect(j.downgraded).toBe(false);
    expect(j.hard_stop).toBe(false);
    expect(j.currency).toBe("USD");
    expect(typeof j.month_start).toBe("number");
    // Proyección lineal: nunca por debajo de lo ya gastado.
    expect(j.projected_usd).toBeGreaterThanOrEqual(j.month_usd);
  });

  it("tope 0 = sin tope → budget_usd y pct en null, sin guard", async () => {
    await seedGasto();
    await new SettingsRepo(db).set(SETTING_KEYS.monthlyBudget, "0");
    const j = await json(await apiApp.request("/cost", { headers: bearer }, authedEnv()));
    expect(j.budget_usd).toBeNull();
    expect(j.pct).toBeNull();
    expect(j.budget_is_default).toBe(false);
    expect(j.downgraded).toBe(false);
    expect(j.hard_stop).toBe(false);
  });

  it("pasado el tope → downgraded; al doble → hard_stop", async () => {
    await seedGasto();
    const settings = new SettingsRepo(db);

    await settings.set(SETTING_KEYS.monthlyBudget, "2");
    let j = await json(await apiApp.request("/cost", { headers: bearer }, authedEnv()));
    expect(j.budget_usd).toBe(2);
    expect(j.budget_is_default).toBe(false);
    expect(j.pct).toBe(100); // 150% topado a 100: la app lo pinta como barra
    expect(j.downgraded).toBe(true);
    expect(j.hard_stop).toBe(false);

    await settings.set(SETTING_KEYS.monthlyBudget, "1");
    j = await json(await apiApp.request("/cost", { headers: bearer }, authedEnv()));
    expect(j.hard_stop).toBe(true);
  });

  it("sin actividad: 0 gastado, tope default", async () => {
    const j = await json(await apiApp.request("/cost", { headers: bearer }, authedEnv()));
    expect(j.month_usd).toBe(0);
    expect(j.pct).toBe(0);
    expect(j.projected_usd).toBe(0);
  });
});
