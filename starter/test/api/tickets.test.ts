/**
 * Pendientes (Contrato v3.3 §4): la MISMA cola de tickets del panel, expuesta
 * como JSON para la app. Resolver desde aquí tiene que dejar la conversación
 * igual que resolver desde /admin/tickets — es lo que la saca del filtro
 * "Te necesita" de la bandeja.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { apiApp } from "../../src/api";
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

const TOKEN = "cp-secret-token";
const NOW = Date.now();

let d1: any;
let db: Db;

function env(): Env {
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
/** `X-Forja-Actor` como lo manda la nube: base64url de {id,name}. */
const actorHeader = (name: string) => ({
  "X-Forja-Actor": btoa(JSON.stringify({ id: "u1", name })).replace(/\+/g, "-").replace(/\//g, "_"),
});

async function list(query = "") {
  const res = await apiApp.request(`/tickets${query}`, { headers: bearer }, env());
  return { res, body: (await res.json()) as any };
}

async function resolve(id: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await apiApp.request(
    `/tickets/${id}/resolve`,
    {
      method: "POST",
      headers: { ...bearer, ...headers, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(),
  );
  return { res, body: (await res.json()) as any };
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
  db = new Db(d1);

  await db.run(
    `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
     VALUES ('whatsapp:5215512345678','whatsapp','5215512345678','María G.',?,?),
            ('telegram:99','telegram','99',NULL,?,?),
            ('test:abc','test','abc','Prueba',?,?)`,
    [NOW, NOW, NOW, NOW, NOW, NOW],
  );
  await db.run(
    `INSERT INTO tickets (id, conversation_id, category, summary, transcript, status, created_at, resolved_at) VALUES
      ('t1','whatsapp:5215512345678','handoff','Pidió hablar con una persona','...','open',?,NULL),
      ('t2','telegram:99','handoff','No entendió el precio','...','open',?,NULL),
      ('t3','whatsapp:5215512345678','queja','Ya atendida','...','resolved',?,?),
      ('t4','test:abc','handoff','Del chat de prueba','...','open',?,NULL),
      ('t5',NULL,'handoff','Sin conversación','...','open',?,NULL)`,
    [NOW - 1000, NOW - 2000, NOW - 3000, NOW - 3000, NOW - 4000, NOW - 5000],
  );
});

describe("GET /api/tickets", () => {
  it("lista los abiertos con nombre, canal y motivo — sin el chat de prueba", async () => {
    const { res, body } = await list();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.tickets.map((t: any) => t.id)).toEqual(["t1", "t2", "t5"]);
    expect(body.next_cursor).toBeNull();

    expect(body.tickets[0]).toEqual({
      id: "t1",
      conversation_id: "whatsapp:5215512345678",
      name: "María G.",
      channel: "whatsapp",
      reason: "Pidió hablar con una persona",
      category: "handoff",
      status: "open",
      created_at: NOW - 1000,
      resolved_at: null,
    });
    // Sin nombre guardado cae al contacto enmascarado por el MISMO helper de la
    // bandeja (maskContact deja los cortitos tal cual: no hay qué esconder).
    expect(body.tickets[1]).toMatchObject({ name: "99", channel: "telegram" });
    // Ticket sin conversación (ON DELETE SET NULL): sigue saliendo, no se pierde.
    expect(body.tickets[2]).toMatchObject({ id: "t5", channel: null, name: "Cliente" });
  });

  it("filtra por status y valida el valor", async () => {
    const resueltos = await list("?status=resolved");
    expect(resueltos.body.tickets.map((t: any) => t.id)).toEqual(["t3"]);

    const todos = await list("?status=all");
    expect(todos.body.tickets.map((t: any) => t.id)).toEqual(["t1", "t2", "t3", "t5"]);

    const malo = await list("?status=pendientes");
    expect(malo.res.status).toBe(400);
    expect(malo.body.error).toBe("invalid_status");
  });

  it("pagina con cursor sin repetir ni saltarse filas", async () => {
    const p1 = await list("?limit=2");
    expect(p1.body.tickets.map((t: any) => t.id)).toEqual(["t1", "t2"]);
    expect(p1.body.next_cursor).toBeTruthy();

    const p2 = await list(`?limit=2&cursor=${encodeURIComponent(p1.body.next_cursor)}`);
    expect(p2.body.tickets.map((t: any) => t.id)).toEqual(["t5"]);
    expect(p2.body.next_cursor).toBeNull();
  });

  it("sin Bearer no contesta nada", async () => {
    const res = await apiApp.request("/tickets", {}, env());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/tickets/:id/resolve", () => {
  it("resuelve igual que el panel y lo devuelve ya resuelto", async () => {
    const { res, body } = await resolve("t1", {}, actorHeader("Beto"));
    expect(res.status).toBe(200);
    expect(body.ticket).toMatchObject({ id: "t1", status: "resolved" });
    expect(body.ticket.resolved_at).toBeGreaterThan(0);

    const row = await db.first<{ status: string; resolved_by: string }>(
      "SELECT status, resolved_by FROM tickets WHERE id = 't1'",
    );
    expect(row?.status).toBe("resolved");
    expect(row?.resolved_by).toBe("Beto (app)"); // el "(app)" dice de dónde vino

    // Y ya no está en los abiertos: eso saca la conversación de "Te necesita".
    const abiertos = await list();
    expect(abiertos.body.tickets.map((t: any) => t.id)).not.toContain("t1");
  });

  it("guarda la nota como nota interna del hilo", async () => {
    await resolve("t1", { note: "Le hablé por teléfono, ya quedó." });
    const nota = await db.first<{ role: string; content: string }>(
      "SELECT role, content FROM messages WHERE conversation_id = 'whatsapp:5215512345678'",
    );
    expect(nota).toMatchObject({ role: "note", content: "Le hablé por teléfono, ya quedó." });
  });

  it("acepta resolver sin cuerpo", async () => {
    const { res, body } = await resolve("t2");
    expect(res.status).toBe(200);
    expect(body.ticket.status).toBe("resolved");
  });

  it("rechaza una nota larguísima sin resolver el ticket", async () => {
    const { res, body } = await resolve("t1", { note: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid_note");
    const row = await db.first<{ status: string }>("SELECT status FROM tickets WHERE id = 't1'");
    expect(row?.status).toBe("open");
  });

  it("un ticket que no existe es 404, no un 200 mentiroso", async () => {
    const { res, body } = await resolve("no-existe");
    expect(res.status).toBe(404);
    expect(body.error).toBe("not_found");
  });
});
