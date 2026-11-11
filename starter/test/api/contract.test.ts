/**
 * Contract tests for the control-plane API (src/api.ts). Verifies the
 * fail-closed Bearer guard and the response shapes of /api/health and
 * /api/metrics. Real D1 via miniflare; the sub-app is exercised directly
 * (apiApp.request), the same way the admin tests hit adminApp.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { apiApp, type MetricsResponse } from "../../src/api";
import { Db } from "../../src/db/client";
import { BOT_VERSION } from "../../src/version";
import type { Env } from "../../src/env";

const TOKEN = "cp-secret-token";
const NOW = Date.now();
const IN_WINDOW = NOW - 60 * 60 * 1000; // 1h ago → inside the 7d window

let d1: any;
let db: Db;

/** env WITH the control-plane token configured (auth can pass). */
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

/** env WITHOUT the token → every /api/* call must fail closed. */
function noTokenEnv(): Env {
  const e = authedEnv() as any;
  delete e.CONTROL_PLANE_TOKEN;
  return e as Env;
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
  db = new Db(d1);
});

/** Seed: 2 conversations (one escalated via a ticket), 3 messages, 2 leads. */
async function seedActivity() {
  await db.run(
    `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
     VALUES ('cA','twilio','uA','A',?,?), ('cB','twilio','uB','B',?,?)`,
    [IN_WINDOW, IN_WINDOW, IN_WINDOW, IN_WINDOW],
  );
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ('m1','cA','user','hola',?), ('m2','cA','assistant','buenas',?), ('m3','cB','user','info',?)`,
    [IN_WINDOW, IN_WINDOW, IN_WINDOW],
  );
  await db.run(
    `INSERT INTO leads (id, conversation_id, intent, created_at, updated_at)
     VALUES ('l1','cA','compra',?,?), ('l2','cB','duda',?,?)`,
    [IN_WINDOW, IN_WINDOW, IN_WINDOW, IN_WINDOW],
  );
  // conv A escalated to a human → one handoff ticket.
  await db.run(
    `INSERT INTO tickets (id, conversation_id, summary, transcript, created_at)
     VALUES ('t1','cA','handoff','...',?)`,
    [IN_WINDOW],
  );
}

describe("control-plane guard (fail-closed)", () => {
  for (const path of ["/health", "/metrics"]) {
    it(`${path}: 401 when CONTROL_PLANE_TOKEN is unset (even with a Bearer)`, async () => {
      const res = await apiApp.request(path, { headers: bearer(TOKEN) }, noTokenEnv());
      expect(res.status).toBe(401);
    });

    it(`${path}: 401 with token set but missing Bearer`, async () => {
      const res = await apiApp.request(path, {}, authedEnv());
      expect(res.status).toBe(401);
    });

    it(`${path}: 401 with token set but wrong Bearer`, async () => {
      const res = await apiApp.request(path, { headers: bearer("wrong-token") }, authedEnv());
      expect(res.status).toBe(401);
    });
  }
});

describe("GET /api/health", () => {
  it("200 + { ok, version, tier } with the right Bearer", async () => {
    const res = await apiApp.request("/health", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; tier: string };
    expect(body).toEqual({ ok: true, version: BOT_VERSION, tier: "pro" });
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });
});

describe("GET /api/metrics", () => {
  it("200 + correct shape and numeric aggregates with the right Bearer", async () => {
    await seedActivity();
    const res = await apiApp.request("/metrics?range=7d", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsResponse;

    expect(body.range).toBe("7d");
    expect(typeof body.leads).toBe("number");
    expect(typeof body.messages).toBe("number");
    expect(typeof body.conversations).toBe("number");
    expect(typeof body.health_score).toBe("number");

    // Seeded: 2 leads, 3 messages, 2 conversations, 1 of 2 escalated → score 50.
    expect(body.leads).toBe(2);
    expect(body.messages).toBe(3);
    expect(body.conversations).toBe(2);
    expect(body.health_score).toBe(50);
    expect(body.health_score).toBeGreaterThanOrEqual(0);
    expect(body.health_score).toBeLessThanOrEqual(100);
  });

  it("defaults to range=7d when the param is absent/invalid", async () => {
    const res = await apiApp.request("/metrics?range=bogus", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsResponse;
    expect(body.range).toBe("7d");
  });

  it("range=all counts everything and reports 100 with no traffic", async () => {
    const res = await apiApp.request("/metrics?range=all", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsResponse;
    expect(body.range).toBe("all");
    expect(body.conversations).toBe(0);
    expect(body.health_score).toBe(100); // no conversations ≠ unhealthy
  });
});

// ── POST /api/tier — push del control plane (Forja+ en caliente) ─────────────
import { bustTierCache, effectiveTier } from "../../src/tier";

describe("POST /api/tier — tier push", () => {
  beforeEach(() => bustTierCache());

  it("sin token → 401 fail-closed", async () => {
    const res = await apiApp.request("/tier", { method: "POST", body: JSON.stringify({ tier: "pro" }) }, noTokenEnv());
    expect(res.status).toBe(401);
  });

  it("tier inválido → 400", async () => {
    const res = await apiApp.request(
      "/tier",
      { method: "POST", headers: bearer(TOKEN), body: JSON.stringify({ tier: "vip" }) },
      authedEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("sube a pro en caliente: persiste, health lo reporta y effectiveTier lo ve", async () => {
    const env = { ...authedEnv(), BOT_TIER: "free" } as Env;
    const res = await apiApp.request(
      "/tier",
      { method: "POST", headers: bearer(TOKEN), body: JSON.stringify({ tier: "pro" }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tier: "pro" });

    // health reporta el tier EFECTIVO aunque el var siga en free
    const fresh = { ...authedEnv(), BOT_TIER: "free" } as Env;
    const h = await apiApp.request("/health", { headers: bearer(TOKEN) }, fresh);
    expect(((await h.json()) as { tier: string }).tier).toBe("pro");
    expect(await effectiveTier(fresh)).toBe("pro");
  });

  it("baja a free (downgrade) también manda sobre el var", async () => {
    const env = { ...authedEnv(), BOT_TIER: "pro" } as Env;
    await apiApp.request(
      "/tier",
      { method: "POST", headers: bearer(TOKEN), body: JSON.stringify({ tier: "free" }) },
      env,
    );
    bustTierCache(); // simula otro isolate: relee de D1
    expect(await effectiveTier(env)).toBe("free");
  });

  it("sin override, manda el BOT_TIER del wrangler.toml", async () => {
    expect(await effectiveTier(authedEnv())).toBe("pro");
    bustTierCache(); // otro "bot" (env distinto) → base estática fresca
    expect(await effectiveTier({ ...authedEnv(), BOT_TIER: "free" } as Env)).toBe("free");
  });
});

// ── GET /api/config — resumen para el panel de la nube (sin secrets) ─────────
describe("GET /api/config", () => {
  it("sin token → 401", async () => {
    const res = await apiApp.request("/config", {}, noTokenEnv());
    expect(res.status).toBe(401);
  });

  it("reporta negocio, nicho, canales (estado, no secrets) y pausa", async () => {
    const env = { ...authedEnv(), TELEGRAM_BOT_TOKEN: "tg-secreto", BOT_NICHE: "barberia" } as Env;
    const res = await apiApp.request("/config", { headers: bearer(TOKEN) }, env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.ok).toBe(true);
    expect(j.business).toBe("Test");
    expect(j.niche).toBe("barberia");
    expect(j.channels_total).toBeGreaterThan(0);
    const tg = j.channels.find((ch: any) => ch.id === "telegram");
    expect(tg.connected).toBe(true);
    expect(j.channels_connected).toBeGreaterThanOrEqual(1);
    expect(j.paused).toBe(false);
    // JAMÁS secrets en la respuesta
    expect(JSON.stringify(j)).not.toContain("tg-secreto");
  });

  it("cuenta los pendientes abiertos para el badge de la app (§3), sin el chat de prueba", async () => {
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, started_at, last_message_at)
       VALUES ('twilio:u1','twilio','u1',?,?), ('test:x','test','x',?,?)`,
      [IN_WINDOW, IN_WINDOW, IN_WINDOW, IN_WINDOW],
    );
    await db.run(
      `INSERT INTO tickets (id, conversation_id, category, summary, transcript, status, created_at) VALUES
        ('k1','twilio:u1','handoff','Pidió humano','...','open',?),
        ('k2','twilio:u1','handoff','Ya atendida','...','resolved',?),
        ('k3','test:x','handoff','De prueba','...','open',?)`,
      [IN_WINDOW, IN_WINDOW, IN_WINDOW],
    );
    const j = (await (
      await apiApp.request("/config", { headers: bearer(TOKEN) }, authedEnv())
    ).json()) as any;
    expect(j.open_tickets).toBe(1);
  });

  it("trae `address` desde member/config.local — la misma ubicación que ve el bot", async () => {
    const { businessLocation } = await import("../../src/businessContext");
    const j = (await (
      await apiApp.request("/config", { headers: bearer(TOKEN) }, authedEnv())
    ).json()) as any;
    // Fuente única: la línea "Ubicación:" del business context, no un campo aparte.
    expect(j.address).toBe(businessLocation());
    expect(j.address === null || typeof j.address === "string").toBe(true);
  });
});

// ── GET /api/leads — bandeja de clientes (Forja+), lectura en vivo ───────────
describe("GET /api/leads", () => {
  it("sin token → 401", async () => {
    const res = await apiApp.request("/leads", {}, noTokenEnv());
    expect(res.status).toBe(401);
  });

  it("devuelve leads recientes con contacto ENMASCARADO (no expone el dato entero)", async () => {
    await db.run(
      "INSERT INTO leads (id, name, contact, intent, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ["L1", "María G.", "5215518290000", "hot", "new", "quiere cita", NOW, NOW],
    );
    await db.run(
      "INSERT INTO leads (id, name, contact, intent, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ["L2", "Luis", "luis@gmail.com", "warm", "new", "pidió menú", NOW - 1000, NOW - 1000],
    );
    const res = await apiApp.request("/leads?limit=10", { headers: bearer(TOKEN) }, authedEnv());
    expect(res.status).toBe(200);
    const j = (await res.json()) as any;
    expect(j.ok).toBe(true);
    expect(j.count).toBe(2);
    expect(j.leads[0].name).toBe("María G."); // más reciente primero
    // el número completo JAMÁS sale; solo la pista enmascarada
    expect(JSON.stringify(j)).not.toContain("5215518290000");
    expect(j.leads[0].contact_hint).toContain("***");
    expect(j.leads[1].contact_hint).toContain("@");
  });

  // ── Extensión v3.2 §8: la pantalla "Interesados" de la app ────────────────

  /** n interesados, del más viejo al más nuevo, con metadata y conversación. */
  async function seedLeads(n: number, status = "new") {
    for (let i = 0; i < n; i++) {
      await db.run(
        `INSERT INTO conversations (id, channel, channel_user_id, started_at, last_message_at)
         VALUES (?, 'whatsapp', ?, ?, ?)`,
        [`whatsapp:52155123445${i}`, `52155123445${i}`, NOW, NOW],
      );
      await db.run(
        `INSERT INTO leads (id, conversation_id, name, contact, intent, status, notes, metadata, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          `LX${i}`,
          `whatsapp:52155123445${i}`,
          `Cliente ${i}`,
          `52155123445${i}`,
          `Cotización · ${i} llantas`,
          status,
          "nota",
          JSON.stringify({ fecha: "2026-08-27" }),
          NOW - (n - i) * 1000,
          NOW - (n - i) * 500,
        ],
      );
    }
  }

  it("cada interesado trae con qué abrir su hilo: conversación, canal, metadata y updated_at", async () => {
    await seedLeads(1);
    const j = (await (
      await apiApp.request("/leads", { headers: bearer(TOKEN) }, authedEnv())
    ).json()) as any;
    expect(j.leads[0]).toMatchObject({
      id: "LX0",
      name: "Cliente 0",
      intent: "Cotización · 0 llantas",
      status: "new",
      conversation_id: "whatsapp:521551234450",
      channel: "whatsapp",
      metadata: { fecha: "2026-08-27" },
    });
    expect(typeof j.leads[0].updated_at).toBe("number");
  });

  it("metadata vacía viaja como null, no como {}", async () => {
    await db.run(
      "INSERT INTO leads (id, intent, status, created_at, updated_at) VALUES (?,?,?,?,?)",
      ["LY", "pregunta", "new", NOW, NOW],
    );
    const j = (await (
      await apiApp.request("/leads", { headers: bearer(TOKEN) }, authedEnv())
    ).json()) as any;
    expect(j.leads[0].metadata).toBeNull();
    // Y un lead sin conversación (ON DELETE SET NULL) no se pierde ni revienta.
    expect(j.leads[0].conversation_id).toBeNull();
    expect(j.leads[0].channel).toBeNull();
  });

  it("filtra por status y rechaza un status inventado", async () => {
    await seedLeads(2, "sold");
    await db.run(
      "INSERT INTO leads (id, intent, status, created_at, updated_at) VALUES (?,?,?,?,?)",
      ["LZ", "otro", "lost", NOW, NOW],
    );
    const vendidos = (await (
      await apiApp.request("/leads?status=sold", { headers: bearer(TOKEN) }, authedEnv())
    ).json()) as any;
    expect(vendidos.count).toBe(2);
    expect(vendidos.leads.every((l: any) => l.status === "sold")).toBe(true);

    const malo = await apiApp.request("/leads?status=vendido", { headers: bearer(TOKEN) }, authedEnv());
    expect(malo.status).toBe(400);
    expect(((await malo.json()) as any).error).toBe("invalid_status");
  });

  it("pagina con cursor sin repetir ni saltarse a nadie", async () => {
    await seedLeads(5);
    const p1 = (await (
      await apiApp.request("/leads?limit=2", { headers: bearer(TOKEN) }, authedEnv())
    ).json()) as any;
    expect(p1.count).toBe(2);
    expect(p1.next_cursor).toBeTruthy();

    const p2 = (await (
      await apiApp.request(
        `/leads?limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`,
        { headers: bearer(TOKEN) },
        authedEnv(),
      )
    ).json()) as any;
    const p3 = (await (
      await apiApp.request(
        `/leads?limit=2&cursor=${encodeURIComponent(p2.next_cursor)}`,
        { headers: bearer(TOKEN) },
        authedEnv(),
      )
    ).json()) as any;
    expect(p3.next_cursor).toBeNull();

    const ids = [...p1.leads, ...p2.leads, ...p3.leads].map((l: any) => l.id);
    expect(ids).toEqual(["LX4", "LX3", "LX2", "LX1", "LX0"]); // más nuevo primero
  });

  it("el cursor se combina con el filtro de status", async () => {
    await seedLeads(3, "contacted");
    await db.run(
      "INSERT INTO leads (id, intent, status, created_at, updated_at) VALUES (?,?,?,?,?)",
      ["LW", "otro", "new", NOW, NOW],
    );
    const p1 = (await (
      await apiApp.request("/leads?limit=2&status=contacted", { headers: bearer(TOKEN) }, authedEnv())
    ).json()) as any;
    const p2 = (await (
      await apiApp.request(
        `/leads?limit=2&status=contacted&cursor=${encodeURIComponent(p1.next_cursor)}`,
        { headers: bearer(TOKEN) },
        authedEnv(),
      )
    ).json()) as any;
    expect([...p1.leads, ...p2.leads].map((l: any) => l.id)).toEqual(["LX2", "LX1", "LX0"]);
  });

  it("limit se acota a 100 y el chat de prueba nunca sale", async () => {
    await seedLeads(3);
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, started_at, last_message_at)
       VALUES ('test:sesion-de-prueba','test','sesion-de-prueba',?,?)`,
      [NOW, NOW],
    );
    await db.run(
      "INSERT INTO leads (id, conversation_id, intent, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ["LTEST", "test:sesion-de-prueba", "prueba", "new", NOW, NOW],
    );
    const j = (await (
      await apiApp.request("/leads?limit=999", { headers: bearer(TOKEN) }, authedEnv())
    ).json()) as any;
    expect(j.count).toBe(3);
    expect(j.leads.some((l: any) => l.id === "LTEST")).toBe(false);
  });
});
