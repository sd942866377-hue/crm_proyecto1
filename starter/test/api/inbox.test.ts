/**
 * Tests del inbox móvil (src/api-inbox.ts) — contrato Forja Inbox ≥ 1.1.0.
 * Real D1 vía miniflare, sub-app ejercida directo (apiApp.request) igual que
 * los contract tests. El adapter de canal se mockea: aquí probamos el contrato
 * y la persistencia, no los proveedores.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import type { Env } from "../../src/env";

const { sendReplyMock } = vi.hoisted(() => ({ sendReplyMock: vi.fn() }));
vi.mock("../../src/replies/sender", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/replies/sender")>();
  return { ...mod, pickAdapter: () => ({ sendReply: sendReplyMock }) };
});

// El chat de prueba entra por el DO del agente: aquí solo verificamos QUÉ se le
// pide ingerir (el pipeline real ya tiene sus propios tests).
const { ingestMock, stubNames } = vi.hoisted(() => ({
  ingestMock: vi.fn(),
  stubNames: [] as string[],
}));
vi.mock("../../src/agent-stub", () => ({
  agentStub: (_env: unknown, channel: string, channelUserId: string) => {
    stubNames.push(`${channel}:${channelUserId}`);
    return { ingest: ingestMock };
  },
}));

import { apiApp } from "../../src/api";
import { adminApp } from "../../src/admin/routes";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { computeWindow, isWindowedChannel } from "../../src/lib/wa-window";
import { __resetTakenByEnsured } from "../../src/db/conversations";
import { __resetEnsured as __resetPanelUsersEnsured } from "../../src/admin/equipo";

const TOKEN = "cp-secret-token";
const NOW = Date.now();

let d1: any;
let db: Db;
// Los proveedores de plantillas (Twilio Content API, Cloud API, Kapso, YCloud,
// Zernio) se hablan por fetch — aquí se stubea, sin red.
const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

function authedEnv(extra: Record<string, string> = {}): Env {
  return {
    DB: d1,
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    CONTROL_PLANE_TOKEN: TOKEN,
    DASHBOARD_PASSWORD: "secret123",
    ...extra,
  } as unknown as Env;
}

const bearer = { Authorization: `Bearer ${TOKEN}` };
const jsonHeaders = { ...bearer, "Content-Type": "application/json" };

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
  db = new Db(d1);
  sendReplyMock.mockReset();
  sendReplyMock.mockResolvedValue(undefined);
  ingestMock.mockReset();
  ingestMock.mockResolvedValue({ acknowledged: true });
  stubNames.length = 0;
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Cada test estrena D1: los memos de "esto ya lo creé" (ALTER lazy / CREATE
  // TABLE) tienen que empezar en frío o el segundo test corre contra una base
  // a la que nunca le corrieron.
  __resetTakenByEnsured();
  __resetPanelUsersEnsured();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Seed: 3 conversaciones en 3 canales distintos (whatsapp, web, zernio). */
async function seedInbox() {
  await db.run(
    `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at, paused_until)
     VALUES
       ('whatsapp:5215512344821','whatsapp','5215512344821','María G.',?,?,NULL),
       ('web:visitor-abc','web','visitor-abc',NULL,?,?,?),
       ('zernio:999888777','zernio','999888777','Luis',?,?,NULL)`,
    [NOW - 9000, NOW - 1000, NOW - 9000, NOW - 500, NOW + 60_000, NOW - 9000, NOW - 2000],
  );
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES
       ('mA1','whatsapp:5215512344821','user','hola',?),
       ('mA2','whatsapp:5215512344821','assistant','buenas, ¿en qué ayudo?',?),
       ('mA3','whatsapp:5215512344821','tool','{"tool":"searchKb"}',?),
       ('mA4','whatsapp:5215512344821','user','¿cuánto cuesta?',?),
       ('mB1','web:visitor-abc','user','info porfa',?),
       ('mC1','zernio:999888777','user','quiero 2 tacos',?),
       ('mC2','zernio:999888777','owner','te los aparto',?)`,
    [NOW - 3000, NOW - 2500, NOW - 2200, NOW - 1000, NOW - 500, NOW - 2500, NOW - 2000],
  );
  await db.run(
    `INSERT INTO leads (id, conversation_id, intent, status, created_at, updated_at)
     VALUES ('l1','zernio:999888777','Pedido · 2 tacos','new',?,?)`,
    [NOW - 2100, NOW - 2100],
  );
  await db.run(
    `INSERT INTO tickets (id, conversation_id, summary, transcript, created_at)
     VALUES ('t1','zernio:999888777','[pedido] quiere humano','...',?)`,
    [NOW - 2000],
  );
}

describe("guard fail-closed", () => {
  it("401 sin Bearer en todas las rutas del inbox", async () => {
    for (const [method, path] of [
      ["GET", "/conversations"],
      ["GET", "/conversations/x/messages"],
      ["POST", "/conversations/x/messages"],
      ["POST", "/conversations/x/handoff"],
      ["POST", "/conversations/x/status"],
      ["POST", "/conversations/x/read"],
      ["POST", "/conversations/x/notes"],
      ["GET", "/quick-replies"],
      ["PUT", "/quick-replies"],
      ["GET", "/hours"],
      ["PUT", "/hours"],
      ["GET", "/business"],
      ["PUT", "/business"],
      ["GET", "/voice"],
      ["PUT", "/voice"],
      ["POST", "/admin-link"],
    ] as const) {
      const res = await apiApp.request(path, { method }, authedEnv());
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("GET /conversations", () => {
  it("lista todos los canales tal cual, ordenados por actividad", async () => {
    await seedInbox();
    const res = await apiApp.request("/conversations", { headers: bearer }, authedEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.conversations.map((c: any) => c.channel)).toEqual(["web", "whatsapp", "zernio"]);
    expect(body.next_cursor).toBeNull();

    const [web, wa, zern] = body.conversations;
    // web pausada → handoff human; sin display_name → cae al contacto enmascarado
    expect(web.handoff).toBe("human");
    // whatsapp: unread = 2 mensajes user, preview del último NO-tool, contacto enmascarado
    expect(wa.name).toBe("María G.");
    expect(wa.contact_hint).toBe("***4821");
    expect(wa.unread).toBe(2);
    expect(wa.preview).toBe("¿cuánto cuesta?");
    expect(wa.handoff).toBe("bot");
    // zernio: ticket abierto sin pausa → pending; intent/status del lead
    expect(zern.handoff).toBe("pending");
    expect(zern.intent).toBe("Pedido · 2 tacos");
    expect(zern.status).toBe("new");
  });

  it("filtra handoff (pausada u OR ticket abierto) y hot (con lead)", async () => {
    await seedInbox();
    const env = authedEnv();
    const handoff = (await (
      await apiApp.request("/conversations?filter=handoff", { headers: bearer }, env)
    ).json()) as any;
    expect(handoff.conversations.map((c: any) => c.id).sort()).toEqual([
      "web:visitor-abc",
      "zernio:999888777",
    ]);

    const hot = (await (
      await apiApp.request("/conversations?filter=hot", { headers: bearer }, env)
    ).json()) as any;
    expect(hot.conversations.map((c: any) => c.id)).toEqual(["zernio:999888777"]);
  });

  it("pagina con cursor keyset sin repetir ni saltarse", async () => {
    await seedInbox();
    const env = authedEnv();
    const p1 = (await (
      await apiApp.request("/conversations?limit=2", { headers: bearer }, env)
    ).json()) as any;
    expect(p1.conversations).toHaveLength(2);
    expect(p1.next_cursor).toBeTruthy();

    const p2 = (await (
      await apiApp.request(
        `/conversations?limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`,
        { headers: bearer },
        env,
      )
    ).json()) as any;
    expect(p2.conversations.map((c: any) => c.id)).toEqual(["zernio:999888777"]);
    expect(p2.next_cursor).toBeNull();
  });

  it("un id de conversación con unicode no revienta el cursor (btoa Latin1-only)", async () => {
    await seedInbox();
    // channel_user_id con acentos/emoji — el id de la conversación es
    // literalmente `${channel}:${channelUserId}` (makeConvId), así que esto
    // SÍ puede pasar con un nombre de usuario real de algunos canales.
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES ('web:sofía-😀','web','sofía-😀','Sofía',?,?)`,
      [NOW, NOW + 1000],
    );
    const env = authedEnv();
    const res = await apiApp.request("/conversations?limit=1", { headers: bearer }, env);
    expect(res.status).toBe(200);
    const p1 = (await res.json()) as any;
    expect(p1.conversations[0].id).toBe("web:sofía-😀");
    expect(p1.next_cursor).toBeTruthy();

    // El cursor emitido para esa fila también debe poder decodificarse de vuelta.
    const p2 = (await (
      await apiApp.request(
        `/conversations?limit=1&cursor=${encodeURIComponent(p1.next_cursor)}`,
        { headers: bearer },
        env,
      )
    ).json()) as any;
    expect(p2.conversations).toHaveLength(1);
    expect(p2.conversations[0].id).not.toBe("web:sofía-😀");
  });
});

describe("read / unread", () => {
  it("POST read deja unread en 0 y lo saca del filtro unread", async () => {
    await seedInbox();
    const env = authedEnv();
    const mark = await apiApp.request(
      "/conversations/whatsapp:5215512344821/read",
      { method: "POST", headers: bearer },
      env,
    );
    expect(mark.status).toBe(200);

    const all = (await (
      await apiApp.request("/conversations", { headers: bearer }, env)
    ).json()) as any;
    const wa = all.conversations.find((c: any) => c.channel === "whatsapp");
    expect(wa.unread).toBe(0);

    const unread = (await (
      await apiApp.request("/conversations?filter=unread", { headers: bearer }, env)
    ).json()) as any;
    expect(unread.conversations.map((c: any) => c.id).sort()).toEqual([
      "web:visitor-abc",
      "zernio:999888777",
    ]);
  });
});

describe("GET /conversations/:id/messages", () => {
  it("orden natural, owner→human, tool excluido; 404 si no existe", async () => {
    await seedInbox();
    const env = authedEnv();
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/messages",
      { headers: bearer },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.messages.map((m: any) => m.id)).toEqual(["mA1", "mA2", "mA4"]);
    expect(body.messages.map((m: any) => m.role)).toEqual(["user", "assistant", "user"]);

    const zern = (await (
      await apiApp.request("/conversations/zernio:999888777/messages", { headers: bearer }, env)
    ).json()) as any;
    expect(zern.messages.find((m: any) => m.id === "mC2").role).toBe("human");

    const missing = await apiApp.request("/conversations/nope/messages", { headers: bearer }, env);
    expect(missing.status).toBe(404);
  });
});

// El envío ahora corre en background (waitUntil): un tick de reloj deja que la
// promesa suelta termine antes de asertar sobre el adapter o las notas.
const flushEnvio = () => new Promise((r) => setTimeout(r, 10));

describe("POST /conversations/:id/messages", () => {
  it("envía por el adapter del canal, persiste como owner, pausa y marca leído", async () => {
    await seedInbox();
    const env = authedEnv();
    const res = await apiApp.request("/conversations/whatsapp:5215512344821/messages", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ text: "Te atiendo yo, dame un segundo." }),
    }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
    expect(body.delivery).toBe("sending");

    await flushEnvio();
    expect(sendReplyMock).toHaveBeenCalledTimes(1);
    expect(sendReplyMock.mock.calls[0][0]).toMatchObject({
      channel: "whatsapp",
      channelUserId: "5215512344821",
      chunks: ["Te atiendo yo, dame un segundo."],
    });

    const msg = await db.first<{ role: string; content: string }>(
      "SELECT role, content FROM messages WHERE id = ?",
      [body.id],
    );
    expect(msg).toMatchObject({ role: "owner", content: "Te atiendo yo, dame un segundo." });

    const conv = await db.first<{ paused_until: number | null }>(
      "SELECT paused_until FROM conversations WHERE id = ?",
      ["whatsapp:5215512344821"],
    );
    expect(conv!.paused_until).toBeGreaterThan(Date.now());

    const read = await db.first<{ last_read_at: number }>(
      "SELECT last_read_at FROM conversation_reads WHERE conversation_id = ?",
      ["whatsapp:5215512344821"],
    );
    expect(read).toBeTruthy();
  });

  it("si el proveedor rechaza (tras el 200): el mensaje queda y aterriza una NOTA con el motivo", async () => {
    await seedInbox();
    sendReplyMock.mockRejectedValueOnce(new Error("token de acceso vencido"));
    const env = authedEnv();
    const res = await apiApp.request("/conversations/whatsapp:5215512344821/messages", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ text: "hola" }),
    }, env);
    // El 200 sale ANTES del proveedor (envío en background) — la velocidad es el punto.
    expect(res.status).toBe(200);
    await flushEnvio();

    const owners = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'owner'",
      ["whatsapp:5215512344821"],
    );
    expect(owners!.n).toBe(1);
    // La falla NUNCA es silenciosa: nota interna en el hilo con el motivo real.
    const nota = await db.first<{ content: string }>(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'note' ORDER BY id DESC LIMIT 1",
      ["whatsapp:5215512344821"],
    );
    expect(nota!.content).toContain("NO entregado");
    expect(nota!.content).toContain("token de acceso vencido");
  });

  // El 409 de arriba solo dispara si el adapter LANZA — y hasta v3.1 casi todos
  // se tragaban el !res.ok con un console.error. Estos dos tests fijan el
  // contrato: el inbox pide strict, y con strict un 4xx del proveedor no
  // persiste nada.
  it("le pide al adapter modo strict (si no, un 4xx del proveedor pasaría por bueno)", async () => {
    await seedInbox();
    await apiApp.request("/conversations/whatsapp:5215512344821/messages", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "hola" }),
    }, authedEnv());
    await flushEnvio();
    expect(sendReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ chunks: ["hola"] }),
      expect.anything(),
      { strict: true },
    );
  });

  it("adapter que responde 4xx (solo lanza en strict) → el motivo del proveedor llega a la nota", async () => {
    await seedInbox();
    // Imita a un adapter real de v3.1: logea y sigue sin strict, lanza con strict.
    sendReplyMock.mockImplementation(async (_reply: unknown, _env: unknown, opts?: { strict?: boolean }) => {
      if (opts?.strict) throw new Error("whatsapp sendReply 400: (#131047) Message failed to send");
    });
    const res = await apiApp.request("/conversations/whatsapp:5215512344821/messages", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "hola" }),
    }, authedEnv());
    expect(res.status).toBe(200);
    await flushEnvio();
    const nota = await db.first<{ content: string }>(
      "SELECT content FROM messages WHERE conversation_id = ? AND role = 'note' ORDER BY id DESC LIMIT 1",
      ["whatsapp:5215512344821"],
    );
    expect(nota!.content).toContain("131047");
  });

  it("valida el texto (vacío / >4000) y 404 si la conversación no existe", async () => {
    await seedInbox();
    const env = authedEnv();
    const vacio = await apiApp.request("/conversations/whatsapp:5215512344821/messages", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "  " }),
    }, env);
    expect(vacio.status).toBe(400);
    const largo = await apiApp.request("/conversations/whatsapp:5215512344821/messages", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "x".repeat(4001) }),
    }, env);
    expect(largo.status).toBe(400);
    const missing = await apiApp.request("/conversations/nope/messages", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "hola" }),
    }, env);
    expect(missing.status).toBe(404);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });
});

describe("POST /conversations/:id/handoff", () => {
  it("take pausa el bot; release lo devuelve SIN insertar mensajes", async () => {
    await seedInbox();
    const env = authedEnv();
    const take = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/handoff", {
        method: "POST", headers: jsonHeaders, body: JSON.stringify({ action: "take" }),
      }, env)
    ).json()) as any;
    expect(take).toMatchObject({ ok: true, handoff: "human" });
    let conv = await db.first<{ paused_until: number | null }>(
      "SELECT paused_until FROM conversations WHERE id = ?", ["whatsapp:5215512344821"],
    );
    expect(conv!.paused_until).toBeGreaterThan(Date.now());

    const before = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", ["whatsapp:5215512344821"],
    );
    const release = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/handoff", {
        method: "POST", headers: jsonHeaders, body: JSON.stringify({ action: "release" }),
      }, env)
    ).json()) as any;
    expect(release).toMatchObject({ ok: true, handoff: "bot" });
    conv = await db.first<{ paused_until: number | null }>(
      "SELECT paused_until FROM conversations WHERE id = ?", ["whatsapp:5215512344821"],
    );
    expect(conv!.paused_until).toBeNull();
    const after = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", ["whatsapp:5215512344821"],
    );
    expect(after!.n).toBe(before!.n); // sin resúmenes fantasma en el hilo

    const bad = await apiApp.request("/conversations/whatsapp:5215512344821/handoff", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ action: "pausa" }),
    }, env);
    expect(bad.status).toBe(400);
  });
});

describe("POST /conversations/:id/status", () => {
  it("actualiza el lead más reciente; sin lead → 404 no_lead", async () => {
    await seedInbox();
    const env = authedEnv();
    const ok = (await (
      await apiApp.request("/conversations/zernio:999888777/status", {
        method: "POST", headers: jsonHeaders, body: JSON.stringify({ status: "contacted" }),
      }, env)
    ).json()) as any;
    expect(ok).toMatchObject({ ok: true, status: "contacted" });
    const lead = await db.first<{ status: string }>("SELECT status FROM leads WHERE id = 'l1'");
    expect(lead!.status).toBe("contacted");

    const sinLead = await apiApp.request("/conversations/web:visitor-abc/status", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ status: "sold" }),
    }, env);
    expect(sinLead.status).toBe(404);
    expect(((await sinLead.json()) as any).error).toBe("no_lead");

    const invalido = await apiApp.request("/conversations/zernio:999888777/status", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ status: "<script>" }),
    }, env);
    expect(invalido.status).toBe(400);

    // Dominio real: new|contacted|sold|lost (LEAD_STATUSES en db/leads.ts,
    // mismo que usa el panel /admin/leads) — "won" pinta bien pero NO es un
    // valor válido; aceptarlo corrompería los conteos por status del panel.
    const fueraDeDominio = await apiApp.request("/conversations/zernio:999888777/status", {
      method: "POST", headers: jsonHeaders, body: JSON.stringify({ status: "won" }),
    }, env);
    expect(fueraDeDominio.status).toBe(400);
  });
});

describe("POST /admin-link + GET /admin/entrar/:token", () => {
  it("emite URL de un solo uso que canjea la sesión maestra del panel", async () => {
    const env = authedEnv({ DASHBOARD_BASE_URL: "https://bot.example.com" });
    const res = await apiApp.request("/admin-link", { method: "POST", headers: bearer }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.url).toMatch(/^https:\/\/bot\.example\.com\/admin\/entrar\/[a-f0-9]{64}$/);
    expect(body.expires_at).toBeGreaterThan(Date.now());

    const token = body.url.split("/").pop()!;
    const enter = await adminApp.request(`/entrar/${token}`, {}, env);
    expect(enter.status).toBe(302);
    expect(enter.headers.get("Location")).toBe("/admin/overview");
    const setCookie = enter.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("hz_panel=");

    // TTL corto (Wiring v2 §6b): una sesión "master" de SSO no es revocable
    // por session_version, así que NO debe heredar los 14 días de una sesión
    // normal con password — el cookie value es `master.<exp>.<ver>.<sig>`.
    const cookieValue = /hz_panel=([^;]+)/.exec(setCookie)?.[1] ?? "";
    const exp = Number(cookieValue.split(".")[1]);
    const ttlMs = exp - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(8 * 3600_000 + 5_000); // margen de reloj
    expect(ttlMs).toBeLessThan(24 * 3600_000); // bien lejos de los 14 días normales

    // Single-use: el segundo canje rebota al login sin sesión.
    const again = await adminApp.request(`/entrar/${token}`, {}, env);
    expect(again.status).toBe(302);
    expect(again.headers.get("Location")).toBe("/admin/login");
    expect(again.headers.get("Set-Cookie") ?? "").not.toContain("hz_panel=");
  });
});

describe("POST /conversations/:id/notes (Wiring v2 §1)", () => {
  it("agrega una nota interna, NUNCA se manda por el adapter, y sale tal cual en GET messages", async () => {
    await seedInbox();
    const env = authedEnv();
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/notes",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ text: "Cliente frecuente, no cobrar cambio" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
    expect(sendReplyMock).not.toHaveBeenCalled();

    const msgs = (await (
      await apiApp.request(
        "/conversations/whatsapp:5215512344821/messages",
        { headers: bearer },
        env,
      )
    ).json()) as any;
    const note = msgs.messages.find((m: any) => m.id === body.id);
    expect(note).toMatchObject({ role: "note", text: "Cliente frecuente, no cobrar cambio" });

    const row = await db.first<{ role: string }>("SELECT role FROM messages WHERE id = ?", [body.id]);
    expect(row!.role).toBe("note");
  });

  it("valida texto vacío / >2000 y 404 si la conversación no existe", async () => {
    await seedInbox();
    const env = authedEnv();
    const vacio = await apiApp.request(
      "/conversations/whatsapp:5215512344821/notes",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "  " }) },
      env,
    );
    expect(vacio.status).toBe(400);
    const largo = await apiApp.request(
      "/conversations/whatsapp:5215512344821/notes",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "x".repeat(2001) }) },
      env,
    );
    expect(largo.status).toBe(400);
    const missing = await apiApp.request(
      "/conversations/nope/notes",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "hola" }) },
      env,
    );
    expect(missing.status).toBe(404);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });
});

describe("GET/PUT /quick-replies (Wiring v2 §2)", () => {
  it("default vacío; PUT valida shape, recorta espacios y persiste; GET lo refleja", async () => {
    const env = authedEnv();
    const empty = (await (await apiApp.request("/quick-replies", { headers: bearer }, env)).json()) as any;
    expect(empty).toEqual({ ok: true, items: [] });

    const put = await apiApp.request(
      "/quick-replies",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          items: [
            { label: "Precio", text: "Cuesta $500" },
            { label: " Horario ", text: " Lun-Vie 9-6 " },
          ],
        }),
      },
      env,
    );
    expect(put.status).toBe(200);

    const get = (await (await apiApp.request("/quick-replies", { headers: bearer }, env)).json()) as any;
    expect(get.items).toEqual([
      { label: "Precio", text: "Cuesta $500" },
      { label: "Horario", text: "Lun-Vie 9-6" },
    ]);
  });

  it("rechaza más de 20 items, label >30 chars o text >500 chars", async () => {
    const env = authedEnv();
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ label: `L${i}`, text: "x" }));
    const r1 = await apiApp.request(
      "/quick-replies",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ items: tooMany }) },
      env,
    );
    expect(r1.status).toBe(400);

    const r2 = await apiApp.request(
      "/quick-replies",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ items: [{ label: "x".repeat(31), text: "ok" }] }),
      },
      env,
    );
    expect(r2.status).toBe(400);

    const r3 = await apiApp.request(
      "/quick-replies",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ items: [{ label: "ok", text: "x".repeat(501) }] }),
      },
      env,
    );
    expect(r3.status).toBe(400);
  });
});

describe("GET/PUT /hours (Wiring v2 §3)", () => {
  it("default: los 7 días null, away_message vacío, legacy_hours de member/config.local", async () => {
    const env = authedEnv();
    const get = (await (await apiApp.request("/hours", { headers: bearer }, env)).json()) as any;
    expect(get.ok).toBe(true);
    expect(Object.keys(get.days).sort()).toEqual(["dom", "jue", "lun", "mar", "mie", "sab", "vie"].sort());
    expect(get.days.lun).toBeNull();
    expect(get.days.dom).toBeNull();
    expect(get.away_message).toBe("");
    expect(typeof get.legacy_hours === "string" || get.legacy_hours === null).toBe(true);
  });

  it("PUT es parcial (solo toca lo que viene) y valida formato HH:MM + días conocidos", async () => {
    const env = authedEnv();
    const put1 = await apiApp.request(
      "/hours",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          days: {
            lun: { from: "10:00", to: "20:00" },
            mar: { from: "10:00", to: "20:00" },
          },
          away_message: "Ya cerramos, te contestamos mañana.",
        }),
      },
      env,
    );
    expect(put1.status).toBe(200);

    // Segundo PUT parcial: solo toca miércoles — lunes/martes/away_message sobreviven.
    const put2 = await apiApp.request(
      "/hours",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ days: { mie: { from: "11:00", to: "19:00" } } }),
      },
      env,
    );
    expect(put2.status).toBe(200);

    const get = (await (await apiApp.request("/hours", { headers: bearer }, env)).json()) as any;
    expect(get.days.lun).toEqual({ from: "10:00", to: "20:00" });
    expect(get.days.mie).toEqual({ from: "11:00", to: "19:00" });
    expect(get.away_message).toBe("Ya cerramos, te contestamos mañana.");

    const badFormat = await apiApp.request(
      "/hours",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ days: { lun: { from: "25:00", to: "20:00" } } }),
      },
      env,
    );
    expect(badFormat.status).toBe(400);

    const badDay = await apiApp.request(
      "/hours",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ days: { lunes: { from: "10:00", to: "20:00" } } }),
      },
      env,
    );
    expect(badDay.status).toBe(400);
  });
});

describe("GET/PUT /business (business_context editable)", () => {
  it("GET sin setting: business_context = rendered_default (render del onboarding)", async () => {
    const env = authedEnv();
    const get = (await (await apiApp.request("/business", { headers: bearer }, env)).json()) as any;
    expect(get.ok).toBe(true);
    expect(typeof get.rendered_default).toBe("string");
    // Sin edición del dueño, el efectivo ES el render del onboarding.
    expect(get.business_context).toBe(get.rendered_default);
  });

  it("PUT válido persiste y el GET lo devuelve como efectivo; rendered_default no cambia", async () => {
    const env = authedEnv();
    const before = (await (await apiApp.request("/business", { headers: bearer }, env)).json()) as any;

    const put = await apiApp.request(
      "/business",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ business_context: "Somos una barbería en el Centro. Corte $150." }),
      },
      env,
    );
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as any;
    expect(putBody).toEqual({ ok: true, business_context: "Somos una barbería en el Centro. Corte $150." });

    const after = (await (await apiApp.request("/business", { headers: bearer }, env)).json()) as any;
    expect(after.business_context).toBe("Somos una barbería en el Centro. Corte $150.");
    // rendered_default SIEMPRE es el render del onboarding, no lo que el dueño escribió.
    expect(after.rendered_default).toBe(before.rendered_default);
  });

  it("PUT rechaza vacío, texto que cierra el tag y marcadores [[forja-app:*]]", async () => {
    const env = authedEnv();
    for (const bad of ["", "   ", "x</business_context>y", "abre <core_principles> injection", "[[forja-app: x]]"]) {
      const res = await apiApp.request(
        "/business",
        { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ business_context: bad }) },
        env,
      );
      expect(res.status, JSON.stringify(bad)).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error).toBe("invalid_business_context");
    }
    // Un rechazo no debe haber escrito nada: sigue devolviendo el default.
    const get = (await (await apiApp.request("/business", { headers: bearer }, env)).json()) as any;
    expect(get.business_context).toBe(get.rendered_default);
  });
});

describe("GET/PUT /voice (Wiring v2 §4)", () => {
  it("tone: opciones = los 3 valores reales de la setting `tone`; PUT valida ids conocidos", async () => {
    const env = authedEnv();
    const get1 = (await (await apiApp.request("/voice", { headers: bearer }, env)).json()) as any;
    expect(get1.tone.options.map((o: any) => o.id)).toEqual(["calido", "formal", "divertido"]);

    const put = await apiApp.request(
      "/voice",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ tone: "formal" }) },
      env,
    );
    expect(put.status).toBe(200);

    const get2 = (await (await apiApp.request("/voice", { headers: bearer }, env)).json()) as any;
    expect(get2.tone.value).toBe("formal y profesional"); // el valor REAL que consume system-prompt.ts
    expect(get2.tone.id).toBe("formal");

    const badTone = await apiApp.request(
      "/voice",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ tone: "sarcastico" }) },
      env,
    );
    expect(badTone.status).toBe(400);
  });

  it("perms.agendar=false apaga las tools de cita vía disabled_tools, sin tocar system_prompt_override", async () => {
    const env = authedEnv();
    const put = await apiApp.request(
      "/voice",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ perms: { agendar: false } }) },
      env,
    );
    expect(put.status).toBe(200);

    const get = (await (await apiApp.request("/voice", { headers: bearer }, env)).json()) as any;
    expect(get.perms).toMatchObject({ precios: true, agendar: false, descuentos: true });

    const disabled = await new SettingsRepo(db).get(SETTING_KEYS.disabledTools);
    expect(disabled).toContain("scheduleAppointment");
    expect(disabled).toContain("agendarCita");
    expect(disabled).toContain("cancelarCita");
    expect(await new SettingsRepo(db).get(SETTING_KEYS.systemPromptOverride)).toBeNull();

    // Re-encender: quita las 3 tools de disabled_tools de vuelta.
    const putBack = await apiApp.request(
      "/voice",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ perms: { agendar: true } }) },
      env,
    );
    expect(putBack.status).toBe(200);
    expect(await new SettingsRepo(db).get(SETTING_KEYS.disabledTools)).toBe("");
  });

  it("perms/rules por texto viven en bloques [[forja-app:*]] SIN borrar lo que el dueño ya tenía escrito", async () => {
    const env = authedEnv();
    await new SettingsRepo(db).set(
      SETTING_KEYS.customInstructions,
      "Texto que el dueño escribió a mano.",
    );

    const put = await apiApp.request(
      "/voice",
      {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({
          perms: { precios: false },
          rules: { regatea: true, no_entendio: true },
        }),
      },
      env,
    );
    expect(put.status).toBe(200);

    const custom = await new SettingsRepo(db).get(SETTING_KEYS.customInstructions);
    expect(custom).toContain("Texto que el dueño escribió a mano.");
    expect(custom).toContain("[[forja-app:perms]]");
    expect(custom).toContain("[[forja-app:rules]]");

    const get = (await (await apiApp.request("/voice", { headers: bearer }, env)).json()) as any;
    expect(get.perms.precios).toBe(false);
    const rules = Object.fromEntries(get.rules.map((r: any) => [r.id, r.enabled]));
    expect(rules.regatea).toBe(true);
    expect(rules.no_entendio).toBe(true);
    expect(rules.pide_humano).toBe(true); // regla fija, siempre encendida
  });

  it("rules.queja / cambiar_cita mapean a escalation_keywords SIN borrar palabras propias del dueño", async () => {
    const env = authedEnv();
    await new SettingsRepo(db).set(SETTING_KEYS.escalationKeywords, "reembolso, gerente");

    const put = await apiApp.request(
      "/voice",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ rules: { queja: true } }) },
      env,
    );
    expect(put.status).toBe(200);

    const kw = await new SettingsRepo(db).get(SETTING_KEYS.escalationKeywords);
    expect(kw).toContain("reembolso");
    expect(kw).toContain("gerente");
    expect(kw).toContain("queja");

    const get = (await (await apiApp.request("/voice", { headers: bearer }, env)).json()) as any;
    const rules = Object.fromEntries(get.rules.map((r: any) => [r.id, r.enabled]));
    expect(rules.queja).toBe(true);
  });

  it("pide_humano no se puede apagar — se ignora en silencio si viene en el body", async () => {
    const env = authedEnv();
    const put = await apiApp.request(
      "/voice",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ rules: { pide_humano: false } }) },
      env,
    );
    expect(put.status).toBe(200);
    const get = (await (await apiApp.request("/voice", { headers: bearer }, env)).json()) as any;
    const rules = Object.fromEntries(get.rules.map((r: any) => [r.id, r.enabled]));
    expect(rules.pide_humano).toBe(true);
  });

  it("rechaza JSON inválido / tono desconocido / perms o rules con shape incorrecto", async () => {
    const env = authedEnv();
    const badJson = await apiApp.request("/voice", { method: "PUT", headers: jsonHeaders, body: "{" }, env);
    expect(badJson.status).toBe(400);

    const badPerms = await apiApp.request(
      "/voice",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ perms: { agendar: "no" } }) },
      env,
    );
    expect(badPerms.status).toBe(400);

    const badRules = await apiApp.request(
      "/voice",
      { method: "PUT", headers: jsonHeaders, body: JSON.stringify({ rules: { inventada: true } }) },
      env,
    );
    expect(badRules.status).toBe(400);
  });
});

describe("chat de prueba — canal `test` (Contrato v3 §C)", () => {
  /** Conversación de prueba con mensajes, lead y ticket: NADA debe contar. */
  async function seedTestChat() {
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES ('test:sesion-de-prueba','test','sesion-de-prueba','Prueba',?,?)`,
      [NOW - 5000, NOW - 100],
    );
    await db.run(
      `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES
         ('mT1','test:sesion-de-prueba','user','hola, ¿cuánto cuesta?',?),
         ('mT2','test:sesion-de-prueba','assistant','Cuesta $500, ¿te aparto uno?',?)`,
      [NOW - 3000, NOW - 2000],
    );
    await db.run(
      `INSERT INTO leads (id, conversation_id, intent, status, created_at, updated_at)
       VALUES ('lT','test:sesion-de-prueba','Prueba del instalador','new',?,?)`,
      [NOW - 1900, NOW - 1900],
    );
    await db.run(
      `INSERT INTO tickets (id, conversation_id, summary, transcript, created_at)
       VALUES ('tT','test:sesion-de-prueba','[prueba] escaló','...',?)`,
      [NOW - 1800],
    );
    // Lead sin conversación (ON DELETE SET NULL): el filtro nullable-safe NO
    // debe comérselo — es el bug clásico de `NOT LIKE` contra NULL.
    await db.run(
      `INSERT INTO leads (id, conversation_id, intent, status, created_at, updated_at)
       VALUES ('lHuerfano', NULL, 'Lead sin conversación','new',?,?)`,
      [NOW - 1700, NOW - 1700],
    );
  }

  it("la conversación de prueba es INVISIBLE en bandeja, métricas y leads", async () => {
    await seedInbox();
    await seedTestChat();
    const env = authedEnv();

    const inbox = (await (
      await apiApp.request("/conversations", { headers: bearer }, env)
    ).json()) as any;
    expect(inbox.conversations.map((c: any) => c.channel)).toEqual(["web", "whatsapp", "zernio"]);
    expect(inbox.conversations.some((c: any) => c.id.startsWith("test:"))).toBe(false);

    // También fuera de los filtros que podrían colarla por ticket/lead.
    for (const filter of ["handoff", "hot", "unread"]) {
      const res = (await (
        await apiApp.request(`/conversations?filter=${filter}`, { headers: bearer }, env)
      ).json()) as any;
      expect(res.conversations.some((c: any) => c.id.startsWith("test:")), filter).toBe(false);
    }

    const metrics = (await (
      await apiApp.request("/metrics?range=all", { headers: bearer }, env)
    ).json()) as any;
    // El seed real trae 3 conversaciones, 7 mensajes, 1 lead — la prueba no suma.
    expect(metrics.conversations).toBe(3);
    expect(metrics.messages).toBe(7);
    expect(metrics.leads).toBe(2); // el del seed + el huérfano (conversation_id NULL)

    const leads = (await (await apiApp.request("/leads", { headers: bearer }, env)).json()) as any;
    expect(leads.leads.map((l: any) => l.id).sort()).toEqual(["l1", "lHuerfano"]);
  });

  it("poll SÍ ve los mensajes de la prueba (y respeta `after`)", async () => {
    await seedTestChat();
    const env = authedEnv();
    const all = (await (
      await apiApp.request("/test-chat/poll?session=sesion-de-prueba&after=0", { headers: bearer }, env)
    ).json()) as any;
    expect(all.ok).toBe(true);
    expect(all.messages).toHaveLength(1); // solo role=assistant
    expect(all.messages[0]).toMatchObject({
      id: "mT2",
      role: "assistant",
      text: "Cuesta $500, ¿te aparto uno?",
    });

    const nada = (await (
      await apiApp.request(
        `/test-chat/poll?session=sesion-de-prueba&after=${NOW}`,
        { headers: bearer },
        env,
      )
    ).json()) as any;
    expect(nada.messages).toEqual([]);
  });

  it("send entra al pipeline real por el canal `test` y valida session/texto", async () => {
    const env = authedEnv();
    const ok = await apiApp.request(
      "/test-chat/send",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ session: "abcd-1234-efgh", text: "¿a qué hora abren?" }),
      },
      env,
    );
    expect(ok.status).toBe(200);
    expect(stubNames).toEqual(["test:abcd-1234-efgh"]);
    expect(ingestMock.mock.calls[0][0]).toMatchObject({
      channel: "test",
      channelUserId: "abcd-1234-efgh",
      text: "¿a qué hora abren?",
    });

    const sesionCorta = await apiApp.request(
      "/test-chat/send",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ session: "corta", text: "hola" }) },
      env,
    );
    expect(sesionCorta.status).toBe(400);

    const sesionRara = await apiApp.request(
      "/test-chat/send",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ session: "con espacios!!", text: "hola" }) },
      env,
    );
    expect(sesionRara.status).toBe(400);

    const sinTexto = await apiApp.request(
      "/test-chat/send",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ session: "abcd-1234-efgh", text: "  " }) },
      env,
    );
    expect(sinTexto.status).toBe(400);
    expect(ingestMock).toHaveBeenCalledTimes(1);
  });

  it("reset borra el hilo de prueba completo (mensajes, lead y ticket)", async () => {
    await seedTestChat();
    const env = authedEnv();
    const res = await apiApp.request(
      "/test-chat/reset",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ session: "sesion-de-prueba" }) },
      env,
    );
    expect(res.status).toBe(200);

    for (const [table, col] of [
      ["messages", "conversation_id"],
      ["leads", "conversation_id"],
      ["tickets", "conversation_id"],
      ["conversations", "id"],
    ] as const) {
      const row = await db.first<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = 'test:sesion-de-prueba'`,
      );
      expect(row!.n, table).toBe(0);
    }
    // El lead huérfano (sin conversación) sobrevive intacto.
    const huerfano = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM leads WHERE id = 'lHuerfano'");
    expect(huerfano!.n).toBe(1);
  });

  it("401 sin Bearer en las rutas del chat de prueba", async () => {
    for (const [method, path] of [
      ["POST", "/test-chat/send"],
      ["GET", "/test-chat/poll"],
      ["POST", "/test-chat/reset"],
    ] as const) {
      const res = await apiApp.request(path, { method }, authedEnv());
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("ventana de 24h (Contrato v3 §B)", () => {
  it("computeWindow: open / closing (<3h) / closed / sin mensajes del cliente", () => {
    const now = 1_000_000_000_000;
    expect(computeWindow(now - 1 * 3600_000, now)).toEqual({
      state: "open",
      until: now - 1 * 3600_000 + 24 * 3600_000,
    });
    // Quedan 2h → closing
    expect(computeWindow(now - 22 * 3600_000, now).state).toBe("closing");
    expect(computeWindow(now - 25 * 3600_000, now).state).toBe("closed");
    // Nunca escribió = fuera de ventana
    expect(computeWindow(null, now)).toEqual({ state: "closed", until: 0 });
  });

  it("isWindowedChannel: WhatsApp sí, telegram/web/test no, zernio según plataforma", () => {
    for (const ch of ["twilio", "whatsapp", "kapso", "ycloud"]) {
      expect(isWindowedChannel(ch, null), ch).toBe(true);
    }
    for (const ch of ["telegram", "web", "instagram", "messenger", "manychat", "test"]) {
      expect(isWindowedChannel(ch, null), ch).toBe(false);
    }
    expect(isWindowedChannel("zernio", "whatsapp")).toBe(true);
    expect(isWindowedChannel("zernio", "instagram")).toBe(false);
    expect(isWindowedChannel("zernio", null)).toBe(false);
  });

  it("GET /conversations trae window por canal (null en web, calculado en whatsapp)", async () => {
    await seedInbox();
    const env = authedEnv();
    const body = (await (
      await apiApp.request("/conversations", { headers: bearer }, env)
    ).json()) as any;
    const byId = Object.fromEntries(body.conversations.map((c: any) => [c.id, c]));

    expect(byId["web:visitor-abc"].window).toBeNull();
    // whatsapp con último mensaje del cliente hace 1s → abierta
    expect(byId["whatsapp:5215512344821"].window).toMatchObject({ state: "open" });
    expect(byId["whatsapp:5215512344821"].window.until).toBeGreaterThan(Date.now());
    // zernio SIN zernio_ctx (tabla lazy, nunca entró un mensaje) → sin ventana
    expect(byId["zernio:999888777"].window).toBeNull();
  });

  it("zernio con plataforma whatsapp SÍ tiene ventana; con instagram no", async () => {
    await seedInbox();
    await db.run(
      `CREATE TABLE IF NOT EXISTS zernio_ctx (
         channel_user_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
         account_id TEXT NOT NULL, platform TEXT, updated_at INTEGER NOT NULL)`,
    );
    await db.run(
      "INSERT INTO zernio_ctx (channel_user_id, conversation_id, account_id, platform, updated_at) VALUES (?,?,?,?,?)",
      ["999888777", "zconv-1", "zacc-1", "whatsapp", NOW],
    );
    const env = authedEnv();
    const wa = (await (
      await apiApp.request("/conversations", { headers: bearer }, env)
    ).json()) as any;
    expect(wa.conversations.find((c: any) => c.id === "zernio:999888777").window).toMatchObject({
      state: "open",
    });

    await db.run("UPDATE zernio_ctx SET platform = 'instagram' WHERE channel_user_id = ?", ["999888777"]);
    const ig = (await (
      await apiApp.request("/conversations", { headers: bearer }, env)
    ).json()) as any;
    expect(ig.conversations.find((c: any) => c.id === "zernio:999888777").window).toBeNull();
  });

  it("GET messages trae window en la RAÍZ", async () => {
    await seedInbox();
    const env = authedEnv();
    const wa = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, env)
    ).json()) as any;
    expect(wa.window).toMatchObject({ state: "open" });

    const web = (await (
      await apiApp.request("/conversations/web:visitor-abc/messages", { headers: bearer }, env)
    ).json()) as any;
    expect(web.window).toBeNull();
  });

  it("free-form con la ventana cerrada rebota 409 window_closed ANTES de tocar al proveedor", async () => {
    await seedInbox();
    // El último mensaje del cliente de whatsapp pasa a hace 30h.
    await db.run("UPDATE messages SET created_at = ? WHERE conversation_id = ? AND role = 'user'", [
      NOW - 30 * 3600_000,
      "whatsapp:5215512344821",
    ]);
    const env = authedEnv();
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/messages",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "¿sigues ahí?" }) },
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ error: "send_failed", detail: "window_closed" });
    expect(sendReplyMock).not.toHaveBeenCalled();
    const owners = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'owner'",
      ["whatsapp:5215512344821"],
    );
    expect(owners!.n).toBe(0);
  });
});

describe("GET /templates (Contrato v3 §B2)", () => {
  it("sin ningún WhatsApp conectado → lista vacía y daily_cap null", async () => {
    const res = (await (await apiApp.request("/templates", { headers: bearer }, authedEnv())).json()) as any;
    expect(res).toEqual({ ok: true, templates: [], daily_cap: null });
  });

  it("solo Twilio: listado real de la Content API con body y variables", async () => {
    const env = authedEnv({ TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok" });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          contents: [
            {
              sid: "HXabc",
              friendly_name: "Recordatorio de cita",
              types: { "twilio/text": { body: "Hola {{1}}, te recordamos tu cita." } },
              variables: { "1": "Ana" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const res = (await (await apiApp.request("/templates", { headers: bearer }, env)).json()) as any;
    expect(res.ok).toBe(true);
    expect(res.templates).toEqual([
      {
        id: "HXabc",
        provider: "twilio",
        label: "Recordatorio de cita",
        body: "Hola {{1}}, te recordamos tu cita.",
        variables: [{ key: "1", example: "Ana" }],
        approved: true,
      },
    ]);
    expect(res.daily_cap).toEqual({ limit: 250, used: 0 });
  });

  it("solo Cloud: UN item con body null e id cloud:<name>:<lang>; sin plantilla configurada, lista vacía", async () => {
    const env = authedEnv({ KAPSO_API_KEY: "k-123" });
    const sinPlantilla = (await (
      await apiApp.request("/templates", { headers: bearer }, env)
    ).json()) as any;
    expect(sinPlantilla.templates).toEqual([]);
    expect(sinPlantilla.daily_cap).toEqual({ limit: 250, used: 0 });

    const settings = new SettingsRepo(db);
    await settings.set(SETTING_KEYS.reengageTemplateName, "recordatorio_cita");
    await settings.set(SETTING_KEYS.reengageTemplateLang, "es_MX");
    const res = (await (await apiApp.request("/templates", { headers: bearer }, env)).json()) as any;
    expect(res.templates).toEqual([
      {
        id: "cloud:recordatorio_cita:es_MX",
        provider: "cloud",
        label: "recordatorio_cita",
        body: null,
        variables: [{ key: "1", example: "nombre del cliente" }],
        approved: true,
      },
    ]);
  });

  it("daily_cap.used cuenta las plantillas de las últimas 24h (compartido con campañas)", async () => {
    const env = authedEnv({ KAPSO_API_KEY: "k-123" });
    await db.run(
      `INSERT INTO template_sends (campaign_key, conversation_id, kind, template_sid, sent_at)
       VALUES ('camp-1','whatsapp:1','template','HX1',?), ('camp-2','whatsapp:2','template','HX1',?),
              ('camp-3','whatsapp:3','freeform',NULL,?), ('camp-4','whatsapp:4','template','HX1',?)`,
      [Date.now() - 1000, Date.now() - 2000, Date.now() - 3000, Date.now() - 48 * 3600_000],
    );
    const res = (await (await apiApp.request("/templates", { headers: bearer }, env)).json()) as any;
    expect(res.daily_cap).toEqual({ limit: 250, used: 2 }); // freeform y la de 48h no cuentan
  });
});

describe("POST /conversations/:id/template (Contrato v3 §B3)", () => {
  it("Twilio: manda ContentSid + ContentVariables, persiste el texto RENDERIZADO y pausa el bot", async () => {
    // Canal `twilio` = plantillas por Content SID (el canal `whatsapp` es Cloud
    // API de Meta y va por nombre+idioma — ver el test de Kapso).
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES ('twilio:5215512344821','twilio','5215512344821','María G.',?,?)`,
      [NOW - 9000, NOW - 1000],
    );
    await db.run(
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('mTw','twilio:5215512344821','user','hola',?)",
      [NOW - 3000],
    );
    const env = authedEnv({ TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok", TWILIO_WA_FROM: "+52155" });
    // 1) listContentTemplates (para el body) · 2) Messages.json (el envío)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          contents: [
            {
              sid: "HXabc",
              friendly_name: "Recordatorio",
              types: { "twilio/text": { body: "Hola {{1}}, te esperamos." } },
              variables: { "1": "Ana" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));

    const res = await apiApp.request(
      "/conversations/twilio:5215512344821/template",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ template_id: "HXabc", variables: { "1": "María" } }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.rendered_text).toBe("Hola María, te esperamos.");

    const sendCall = fetchMock.mock.calls[1];
    expect(String(sendCall[0])).toContain("api.twilio.com");
    const form = new URLSearchParams(sendCall[1].body as string);
    expect(form.get("ContentSid")).toBe("HXabc");
    expect(JSON.parse(form.get("ContentVariables")!)).toEqual({ "1": "María" });

    const msg = await db.first<{ role: string; content: string }>(
      "SELECT role, content FROM messages WHERE id = ?",
      [body.id],
    );
    // En D1 el content lleva el marcador oculto de plantilla + el texto real.
    expect(msg!.role).toBe("owner");
    expect(msg!.content).toBe("[TPL:HXabc] Hola María, te esperamos.");

    // …y por la API sale limpio, con la marca que la app necesita para pintar
    // "Tú · recordatorio" aunque el dueño recargue el hilo (diseño 6b).
    const hilo = (await (
      await apiApp.request("/conversations/twilio:5215512344821/messages", { headers: bearer }, env)
    ).json()) as any;
    const burbuja = hilo.messages.find((m: any) => m.id === body.id);
    expect(burbuja.text).toBe("Hola María, te esperamos.");
    expect(burbuja.template).toBe(true);
    // Un mensaje normal NO trae el campo (ausente ≡ no es plantilla).
    expect(hilo.messages.find((m: any) => m.id === "mTw").template).toBeUndefined();

    // Claim registrado como gasto del tope diario.
    const claim = await db.first<{ n: number; kind: string }>(
      "SELECT COUNT(*) AS n, kind FROM template_sends WHERE conversation_id = ?",
      ["twilio:5215512344821"],
    );
    expect(claim).toMatchObject({ n: 1, kind: "template" });

    // Takeover + leído, igual que el POST de texto.
    const conv = await db.first<{ paused_until: number | null }>(
      "SELECT paused_until FROM conversations WHERE id = ?",
      ["twilio:5215512344821"],
    );
    expect(conv!.paused_until).toBeGreaterThan(Date.now());
    const read = await db.first<{ last_read_at: number }>(
      "SELECT last_read_at FROM conversation_reads WHERE conversation_id = ?",
      ["twilio:5215512344821"],
    );
    expect(read).toBeTruthy();
  });

  it("Cloud (Kapso): manda name+lang, persiste marcador y funciona con la ventana CERRADA", async () => {
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES ('kapso:5215599','kapso','5215599','Ana',?,?)`,
      [NOW - 90_000, NOW - 80_000],
    );
    await db.run(
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('mK1','kapso:5215599','user','hola',?)",
      [NOW - 30 * 3600_000],
    );
    const env = authedEnv({ KAPSO_API_KEY: "k-123", KAPSO_PHONE_NUMBER_ID: "pn-1" });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const res = await apiApp.request(
      "/conversations/kapso:5215599/template",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ template_id: "cloud:recordatorio_cita:es_MX", variables: { "1": "Ana" } }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Cloud API no expone el texto de la plantilla → rendered_text null.
    expect(body.rendered_text).toBeNull();

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.template).toMatchObject({ name: "recordatorio_cita", language: { code: "es_MX" } });
    expect(sent.template.components[0].parameters[0].text).toBe("Ana");

    const msg = await db.first<{ role: string; content: string }>(
      "SELECT role, content FROM messages WHERE id = ?",
      [body.id],
    );
    expect(msg!.content).toBe(
      "[TPL:cloud:recordatorio_cita:es_MX] [plantilla recordatorio_cita enviada]",
    );

    const hilo = (await (
      await apiApp.request("/conversations/kapso:5215599/messages", { headers: bearer }, env)
    ).json()) as any;
    const burbuja = hilo.messages.find((m: any) => m.id === body.id);
    expect(burbuja.template).toBe(true);
    // Cloud API no da el texto: la app pinta el label, no una burbuja vacía.
    expect(burbuja.text).toBe("[plantilla recordatorio_cita enviada]");
  });

  it("retrocompat: un mensaje de plantilla viejo (sin marcador) no trae `template`", async () => {
    await seedInbox();
    await db.run(
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('mOld','whatsapp:5215512344821','owner','Hola Luis, te recordamos tu cita.',?)",
      [NOW - 400],
    );
    const hilo = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, authedEnv())
    ).json()) as any;
    const vieja = hilo.messages.find((m: any) => m.id === "mOld");
    expect(vieja.text).toBe("Hola Luis, te recordamos tu cita.");
    expect(vieja.template).toBeUndefined();
  });

  it("canal sin plantillas (telegram/web) → 400 channel_without_templates", async () => {
    await seedInbox();
    const res = await apiApp.request(
      "/conversations/web:visitor-abc/template",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ template_id: "HXabc" }) },
      authedEnv(),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("channel_without_templates");
  });

  it("tope diario alcanzado → 429 template_quota sin tocar al proveedor", async () => {
    await seedInbox();
    const rows = Array.from({ length: 3 }, (_, i) => `('cap-${i}','whatsapp:x${i}','template','HX1',${Date.now()})`);
    await db.run(
      `INSERT INTO template_sends (campaign_key, conversation_id, kind, template_sid, sent_at) VALUES ${rows.join(",")}`,
    );
    const env = authedEnv({
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "tok",
      TWILIO_WA_FROM: "+52155",
      WA_DAILY_TEMPLATE_CAP: "3",
    });
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/template",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ template_id: "HXabc" }) },
      env,
    );
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error).toBe("template_quota");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el proveedor rechaza → 409 send_failed SIN persistir mensaje", async () => {
    await seedInbox();
    const env = authedEnv({ KAPSO_API_KEY: "k-123", KAPSO_PHONE_NUMBER_ID: "pn-1" });
    await db.run(
      `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
       VALUES ('kapso:5215599','kapso','5215599','Ana',?,?)`,
      [NOW - 90_000, NOW - 80_000],
    );
    fetchMock.mockResolvedValueOnce(new Response("template not approved", { status: 400 }));

    const res = await apiApp.request(
      "/conversations/kapso:5215599/template",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ template_id: "cloud:x:es" }) },
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("send_failed");
    expect(body.detail).toContain("400");

    const owners = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'owner'",
      ["kapso:5215599"],
    );
    expect(owners!.n).toBe(0);
    const conv = await db.first<{ paused_until: number | null }>(
      "SELECT paused_until FROM conversations WHERE id = ?",
      ["kapso:5215599"],
    );
    expect(conv!.paused_until).toBeNull();
  });

  it("404 si la conversación no existe; 400 si el body viene mal", async () => {
    await seedInbox();
    const env = authedEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_WA_FROM: "+1" });
    const missing = await apiApp.request(
      "/conversations/nope/template",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({ template_id: "HXabc" }) },
      env,
    );
    expect(missing.status).toBe(404);

    const sinId = await apiApp.request(
      "/conversations/whatsapp:5215512344821/template",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify({}) },
      env,
    );
    expect(sinId.status).toBe(400);

    const varsMalas = await apiApp.request(
      "/conversations/whatsapp:5215512344821/template",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ template_id: "HXabc", variables: { "1": 42 } }),
      },
      env,
    );
    expect(varsMalas.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401 sin Bearer en las rutas de plantillas", async () => {
    for (const [method, path] of [
      ["GET", "/templates"],
      ["POST", "/conversations/x/template"],
    ] as const) {
      const res = await apiApp.request(path, { method }, authedEnv());
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

// ── Adjuntos en el hilo (Contrato v3 §A) ─────────────────────────────────────

/** R2 en memoria: el código solo usa put/get/delete del binding MEDIA. */
function fakeR2() {
  const store = new Map<string, ArrayBuffer>();
  return {
    store,
    async put(key: string, body: ArrayBuffer) {
      store.set(key, body);
    },
    async get(key: string) {
      const v = store.get(key);
      return v ? { body: new Blob([v]).stream() } : null;
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

async function seedMediaTable() {
  await db.run(
    `CREATE TABLE IF NOT EXISTS media (
       id TEXT PRIMARY KEY, conversation_id TEXT, r2_key TEXT NOT NULL,
       kind TEXT NOT NULL DEFAULT 'image', mime TEXT, filename TEXT, caption TEXT,
       bytes INTEGER, created_at INTEGER NOT NULL,
       message_id TEXT, direction TEXT DEFAULT 'in', duration_s REAL)`,
  );
}

describe("GET messages con adjuntos (Contrato v3 §A1)", () => {
  it("liga por message_id, limpia marcadores y expone kind/filename/size/duración", async () => {
    await seedInbox();
    await seedMediaTable();
    // El mensaje del cliente quedó con la transcripción + el marcador interno.
    await db.run(
      "UPDATE messages SET content = ? WHERE id = 'mA4'",
      ["¿cuánto cuesta?\n[MEDIA: 11111111-1111-1111-1111-111111111111]"],
    );
    await db.run(
      `INSERT INTO media (id, conversation_id, r2_key, kind, mime, filename, caption, bytes, created_at, message_id, direction, duration_s)
       VALUES ('11111111-1111-1111-1111-111111111111','whatsapp:5215512344821','media/k1.ogg','audio','audio/ogg',NULL,NULL,4096,?, 'mA4','in', 7.5)`,
      [NOW - 1000],
    );

    const body = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, authedEnv())
    ).json()) as any;
    const msg = body.messages.find((m: any) => m.id === "mA4");
    expect(msg.text).toBe("¿cuánto cuesta?"); // marcador fuera
    expect(msg.media).toEqual([
      { kind: "audio", url: "/api/media/11111111-1111-1111-1111-111111111111", duration_s: 7.5, size: 4096 },
    ]);
    // Los mensajes sin adjunto NO traen el campo (ausente ≡ []).
    expect(body.messages.find((m: any) => m.id === "mA1").media).toBeUndefined();
  });

  it("kind document → 'file'; una fila sin message_id se pega al mensaje más cercano", async () => {
    await seedInbox();
    await seedMediaTable();
    await db.run(
      `INSERT INTO media (id, conversation_id, r2_key, kind, mime, filename, caption, bytes, created_at, message_id, direction)
       VALUES ('22222222-2222-2222-2222-222222222222','whatsapp:5215512344821','media/k2.pdf','document','application/pdf','cotizacion.pdf',NULL,2048,?, NULL,'in')`,
      [NOW - 1010], // ~10ms del mensaje mA4 (NOW - 1000)
    );
    const body = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, authedEnv())
    ).json()) as any;
    const msg = body.messages.find((m: any) => m.id === "mA4");
    expect(msg.media).toEqual([
      {
        kind: "file",
        url: "/api/media/22222222-2222-2222-2222-222222222222",
        filename: "cotizacion.pdf",
        size: 2048,
      },
    ]);
  });

  it("una fila lejana en el tiempo sale como mensaje sintético, intercalada por fecha", async () => {
    await seedInbox();
    await seedMediaTable();
    // Mensaje viejo para que el hilo abarque varios minutos: así la foto de la
    // Bóveda histórica cae en el hueco, a más de 90s de CUALQUIER mensaje.
    await db.run(
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ('mA0','whatsapp:5215512344821','user','buenas',?)",
      [NOW - 600_000],
    );
    await db.run(
      `INSERT INTO media (id, conversation_id, r2_key, kind, mime, filename, caption, bytes, created_at, message_id, direction)
       VALUES ('33333333-3333-3333-3333-333333333333','whatsapp:5215512344821','media/k3.jpg','image','image/jpeg',NULL,'mira esto',900,?, NULL,'in')`,
      [NOW - 300_000],
    );
    const body = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, authedEnv())
    ).json()) as any;
    const sintetico = body.messages.find((m: any) => m.id.startsWith("media:"));
    expect(sintetico).toMatchObject({ role: "user", text: "mira esto" });
    expect(sintetico.media[0].kind).toBe("image");
    // Sigue ordenado por fecha.
    const fechas = body.messages.map((m: any) => m.created_at);
    expect([...fechas].sort((a: number, b: number) => a - b)).toEqual(fechas);
  });

  it("imagen histórica con solo [IMAGE_URL:] → url legacy y texto limpio", async () => {
    await seedInbox();
    await db.run("UPDATE messages SET content = ? WHERE id = 'mA1'", [
      "mira la fachada\n[IMAGE_URL: https://proveedor.example/foto.jpg]",
    ]);
    const body = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, authedEnv())
    ).json()) as any;
    const msg = body.messages.find((m: any) => m.id === "mA1");
    expect(msg.text).toBe("mira la fachada");
    expect(msg.media).toEqual([{ kind: "image", url: "/api/media/legacy/mA1" }]);
  });

  it("bot con la tabla `media` VIEJA (sin las columnas nuevas): el ALTER corre solo y los adjuntos salen", async () => {
    await seedInbox();
    // Tabla tal cual la dejó la Bóveda vieja: sin message_id / direction /
    // duration_s. Es el estado REAL de un bot que ya archivaba imágenes y
    // todavía no ha capturado nada después del update.
    // (el schema.sql de los tests ya la trae migrada — hay que volverla atrás)
    await db.run("DROP TABLE IF EXISTS media");
    await db.run(
      `CREATE TABLE media (
         id TEXT PRIMARY KEY, conversation_id TEXT, r2_key TEXT NOT NULL,
         kind TEXT NOT NULL DEFAULT 'image', mime TEXT, filename TEXT, caption TEXT,
         bytes INTEGER, created_at INTEGER NOT NULL)`,
    );
    await db.run(
      `INSERT INTO media (id, conversation_id, r2_key, kind, mime, filename, caption, bytes, created_at)
       VALUES ('77777777-7777-7777-7777-777777777777','whatsapp:5215512344821','media/vieja.jpg','image','image/jpeg',NULL,'la fachada',1234,?)`,
      [NOW - 1005],
    );
    // El memo del CREATE/ALTER es por isolate: sin resetearlo, otro test del
    // archivo ya lo marcó como hecho y el ALTER no correría.
    const { __resetMediaEnsured } = await import("../../src/media/boveda");
    __resetMediaEnsured();

    const body = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, authedEnv())
    ).json()) as any;
    // Antes del fix: el SELECT reventaba por columna inexistente, el catch
    // devolvía [] y el hilo salía SIN adjuntos, sin un solo error visible.
    const msg = body.messages.find((m: any) => m.id === "mA4");
    expect(msg.media).toEqual([
      { kind: "image", url: "/api/media/77777777-7777-7777-7777-777777777777", caption: "la fachada", size: 1234 },
    ]);
    // Y la tabla quedó migrada para el resto de la vida del bot.
    const cols = await db.all<{ name: string }>("PRAGMA table_info(media)");
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["message_id", "direction", "duration_s"]),
    );
  });

  it("el preview de la lista también sale sin marcadores", async () => {
    await seedInbox();
    await db.run("UPDATE messages SET content = ? WHERE id = 'mA4'", [
      "te mando la foto\n[MEDIA: 44444444-4444-4444-4444-444444444444]",
    ]);
    const body = (await (
      await apiApp.request("/conversations", { headers: bearer }, authedEnv())
    ).json()) as any;
    const wa = body.conversations.find((c: any) => c.channel === "whatsapp");
    expect(wa.preview).toBe("te mando la foto");
  });
});

describe("GET /api/media/:id (Contrato v3 §A2)", () => {
  it("devuelve los bytes con content-type y filename; 404 si no existe", async () => {
    await seedInbox();
    await seedMediaTable();
    const r2 = fakeR2();
    await r2.put("media/k.pdf", new TextEncoder().encode("%PDF-fake").buffer as ArrayBuffer);
    await db.run(
      `INSERT INTO media (id, conversation_id, r2_key, kind, mime, filename, caption, bytes, created_at, message_id, direction)
       VALUES ('55555555-5555-5555-5555-555555555555','whatsapp:5215512344821','media/k.pdf','document','application/pdf','cotización.pdf',NULL,9,?, NULL,'in')`,
      [NOW],
    );
    const env = { ...authedEnv(), MEDIA: r2 } as unknown as Env;

    const res = await apiApp.request(
      "/media/55555555-5555-5555-5555-555555555555",
      { headers: bearer },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("cotización.pdf");
    expect(await res.text()).toBe("%PDF-fake");

    const missing = await apiApp.request(
      "/media/99999999-9999-9999-9999-999999999999",
      { headers: bearer },
      env,
    );
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as any).error).toBe("media_not_found");
  });

  it("410 media_gone cuando la fila existe pero el objeto ya no está en R2", async () => {
    await seedInbox();
    await seedMediaTable();
    await db.run(
      `INSERT INTO media (id, conversation_id, r2_key, kind, mime, filename, caption, bytes, created_at, message_id, direction)
       VALUES ('66666666-6666-6666-6666-666666666666','whatsapp:5215512344821','media/borrado.jpg','image','image/jpeg',NULL,NULL,10,?, NULL,'in')`,
      [NOW],
    );
    const env = { ...authedEnv(), MEDIA: fakeR2() } as unknown as Env;
    const res = await apiApp.request(
      "/media/66666666-6666-6666-6666-666666666666",
      { headers: bearer },
      env,
    );
    expect(res.status).toBe(410);
    expect(((await res.json()) as any).error).toBe("media_gone");
  });

  it("legacy: resuelve el [IMAGE_URL:] contra el proveedor; 410 si ya murió", async () => {
    await seedInbox();
    await db.run("UPDATE messages SET content = ? WHERE id = 'mA1'", [
      "[IMAGE_URL: https://proveedor.example/foto.jpg]",
    ]);
    const env = authedEnv();
    fetchMock.mockResolvedValueOnce(
      new Response("bytes-de-la-foto", { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const ok = await apiApp.request("/media/legacy/mA1", { headers: bearer }, env);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("bytes-de-la-foto");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://proveedor.example/foto.jpg");

    fetchMock.mockResolvedValueOnce(new Response("expired", { status: 404 }));
    const muerta = await apiApp.request("/media/legacy/mA1", { headers: bearer }, env);
    expect(muerta.status).toBe(410);

    const sinMarcador = await apiApp.request("/media/legacy/mA2", { headers: bearer }, env);
    expect(sinMarcador.status).toBe(404);
  });
});

describe("POST /conversations/:id/media (Contrato v3 §A3)", () => {
  function jpg(name = "foto.jpg", bytes = 512) {
    return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
  }
  function upload(file: File, caption?: string) {
    const form = new FormData();
    form.set("file", file);
    if (caption) form.set("caption", caption);
    return form;
  }

  it("sin binding MEDIA → 409 media_storage_unavailable con el copy de /boveda", async () => {
    await seedInbox();
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: upload(jpg()) },
      authedEnv(),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("media_storage_unavailable");
    expect(body.detail).toContain("/boveda");
    // El copy nombra la Bóveda y el tier: sin eso el dueño no sabe QUÉ activar.
    expect(body.detail).toContain("Bóveda, Forja+");
  });

  it("sube a R2, manda por el adapter con chunks vacíos, persiste como owner y pausa", async () => {
    await seedInbox();
    const r2 = fakeR2();
    const env = {
      ...authedEnv({ DASHBOARD_BASE_URL: "https://bot.example.com" }),
      MEDIA: r2,
    } as unknown as Env;

    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: upload(jpg(), "aquí está la cotización") },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.media).toMatchObject({
      kind: "image",
      caption: "aquí está la cotización",
      filename: "foto.jpg",
      size: 512,
    });
    expect(body.media.url).toMatch(/^\/api\/media\/[0-9a-f-]{36}$/);
    expect(r2.store.size).toBe(1);

    // El adapter recibe chunks:[] + media con la URL pública FIRMADA.
    const enviado = sendReplyMock.mock.calls[0][0];
    expect(enviado.chunks).toEqual([]);
    expect(enviado.media[0].kind).toBe("image");
    expect(enviado.media[0].url).toMatch(
      /^https:\/\/bot\.example\.com\/media-out\/[0-9a-f-]{36}\?exp=\d+&sig=[0-9a-f]{64}$/,
    );

    // Mensaje del hilo: caption + marcador interno, ligado a la fila de media.
    const msg = await db.first<{ role: string; content: string }>(
      "SELECT role, content FROM messages WHERE id = ?",
      [body.id],
    );
    expect(msg!.role).toBe("owner");
    expect(msg!.content).toContain("aquí está la cotización");
    expect(msg!.content).toMatch(/\[MEDIA: [0-9a-f-]{36}\]/);
    const row = await db.first<{ direction: string; message_id: string }>(
      "SELECT direction, message_id FROM media WHERE conversation_id = ?",
      ["whatsapp:5215512344821"],
    );
    expect(row).toMatchObject({ direction: "out", message_id: body.id });

    // Y el hilo lo devuelve limpio, con su adjunto.
    const hilo = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, env)
    ).json()) as any;
    const burbuja = hilo.messages.find((m: any) => m.id === body.id);
    expect(burbuja.text).toBe("aquí está la cotización");
    expect(burbuja.media[0].filename).toBe("foto.jpg");

    const conv = await db.first<{ paused_until: number | null }>(
      "SELECT paused_until FROM conversations WHERE id = ?",
      ["whatsapp:5215512344821"],
    );
    expect(conv!.paused_until).toBeGreaterThan(Date.now());
  });

  it("canal sin documentos nativos (web) → el archivo va como link en texto", async () => {
    await seedInbox();
    const env = {
      ...authedEnv({ DASHBOARD_BASE_URL: "https://bot.example.com" }),
      MEDIA: fakeR2(),
    } as unknown as Env;
    const pdf = new File([new Uint8Array(64)], "plan.pdf", { type: "application/pdf" });
    const res = await apiApp.request(
      "/conversations/web:visitor-abc/media",
      { method: "POST", headers: bearer, body: upload(pdf, "el plan") },
      env,
    );
    expect(res.status).toBe(200);
    const enviado = sendReplyMock.mock.calls[0][0];
    expect(enviado.media).toBeUndefined();
    expect(enviado.chunks[0]).toContain("el plan");
    expect(enviado.chunks[0]).toContain("/media-out/");
  });

  it("415 por tipo no permitido y 413 por tamaño, sin dejar basura en R2", async () => {
    await seedInbox();
    const r2 = fakeR2();
    const env = { ...authedEnv(), MEDIA: r2 } as unknown as Env;

    const exe = new File([new Uint8Array(8)], "virus.exe", { type: "application/x-msdownload" });
    const tipo = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: upload(exe) },
      env,
    );
    expect(tipo.status).toBe(415);

    const grande = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: upload(jpg("enorme.jpg", 6 * 1024 * 1024)) },
      env,
    );
    expect(grande.status).toBe(413);
    expect(((await grande.json()) as any).error).toBe("too_large");

    expect(r2.store.size).toBe(0);
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("si el proveedor rechaza: 409 send_failed y se BORRA el archivo de R2", async () => {
    await seedInbox();
    const r2 = fakeR2();
    const env = {
      ...authedEnv({ DASHBOARD_BASE_URL: "https://bot.example.com" }),
      MEDIA: r2,
    } as unknown as Env;
    sendReplyMock.mockRejectedValueOnce(new Error("ventana de 24h cerrada"));

    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: upload(jpg()) },
      env,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe("send_failed");
    expect(r2.store.size).toBe(0);
    const filas = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM media");
    expect(filas!.n).toBe(0);
    const owners = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'owner'",
      ["whatsapp:5215512344821"],
    );
    expect(owners!.n).toBe(0);
  });

  it("adapter que responde 4xx (solo lanza en strict) → 409, R2 vacío y sin fila", async () => {
    await seedInbox();
    const r2 = fakeR2();
    const env = {
      ...authedEnv({ DASHBOARD_BASE_URL: "https://bot.example.com" }),
      MEDIA: r2,
    } as unknown as Env;
    sendReplyMock.mockImplementation(async (_reply: unknown, _e: unknown, opts?: { strict?: boolean }) => {
      if (opts?.strict) throw new Error("whatsapp media send 400: (#131047) Message failed to send");
    });

    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: upload(jpg()) },
      env,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toContain("131047");
    expect(sendReplyMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), { strict: true });
    expect(r2.store.size).toBe(0);
    const filas = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM media");
    expect(filas!.n).toBe(0);
  });

  it("con la ventana cerrada rebota antes de subir nada", async () => {
    await seedInbox();
    await db.run("UPDATE messages SET created_at = ? WHERE conversation_id = ? AND role = 'user'", [
      NOW - 30 * 3600_000,
      "whatsapp:5215512344821",
    ]);
    const r2 = fakeR2();
    const env = { ...authedEnv(), MEDIA: r2 } as unknown as Env;
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: upload(jpg()) },
      env,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).detail).toBe("window_closed");
    expect(r2.store.size).toBe(0);
  });

  it("401 sin Bearer en las rutas de media", async () => {
    for (const [method, path] of [
      ["GET", "/media/x"],
      ["GET", "/media/legacy/x"],
      ["POST", "/conversations/x/media"],
    ] as const) {
      const res = await apiApp.request(path, { method }, authedEnv());
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
});

// ── Contrato v3.2 §1: búsqueda en la bandeja ─────────────────────────────────

describe("GET /api/conversations?q= (Contrato v3.2 §1)", () => {
  const buscar = (qs: string) =>
    apiApp.request(`/conversations?${qs}`, { headers: bearer }, authedEnv());
  const ids = async (res: Response) =>
    ((await res.json()) as any).conversations.map((c: any) => c.id);

  it("busca por nombre y marca match:'name' (sin importar mayúsculas)", async () => {
    await seedInbox();
    for (const q of ["Mar", "mar"]) {
      const body = (await (await buscar(`q=${q}`)).json()) as any;
      expect(body.conversations).toHaveLength(1);
      expect(body.conversations[0].id).toBe("whatsapp:5215512344821");
      expect(body.conversations[0].match).toBe("name");
    }
  });

  it("busca por el contacto CRUDO (el dueño se acuerda del teléfono, no del enmascarado)", async () => {
    await seedInbox();
    const body = (await (await buscar("q=5512344821")).json()) as any;
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0].match).toBe("contact");
    // Y el contacto sigue saliendo enmascarado en la respuesta.
    expect(body.conversations[0].contact_hint).toBe("***4821");
  });

  it("busca dentro de los mensajes (user, assistant y owner) y marca match:'message'", async () => {
    await seedInbox();
    // user
    expect(await ids(await buscar("q=tacos"))).toEqual(["zernio:999888777"]);
    // owner
    expect(await ids(await buscar("q=aparto"))).toEqual(["zernio:999888777"]);
    // assistant
    expect(await ids(await buscar("q=ayudo"))).toEqual(["whatsapp:5215512344821"]);
    const body = (await (await buscar("q=tacos")).json()) as any;
    expect(body.conversations[0].match).toBe("message");
  });

  it("ignora los mensajes de más de 30 días", async () => {
    await seedInbox();
    await db.run("UPDATE messages SET created_at = ? WHERE id = 'mC1'", [NOW - 31 * 86_400_000]);
    expect(await ids(await buscar("q=tacos"))).toEqual([]);
  });

  it("con menos de 2 caracteres no busca: la bandeja completa y sin `match`", async () => {
    await seedInbox();
    for (const q of ["", "a", "%20"]) {
      const body = (await (await buscar(`q=${q}`)).json()) as any;
      expect(body.conversations).toHaveLength(3);
      expect(body.conversations[0].match).toBeUndefined();
    }
  });

  it("los comodines del dueño son literales: '50%' no matchea '50 pesos'", async () => {
    await seedInbox();
    await db.run("UPDATE messages SET content = 'descuento 50% hoy' WHERE id = 'mB1'");
    await db.run("UPDATE messages SET content = '50 pesos' WHERE id = 'mA1'");
    expect(await ids(await buscar(`q=${encodeURIComponent("50%")}`))).toEqual(["web:visitor-abc"]);
    // El guion bajo, igual: comodín de SQL, literal para el dueño.
    await db.run("UPDATE messages SET content = 'codigo a_b' WHERE id = 'mB1'");
    await db.run("UPDATE messages SET content = 'codigo axb' WHERE id = 'mA1'");
    expect(await ids(await buscar("q=a_b"))).toEqual(["web:visitor-abc"]);
  });

  it("se SUMA al filtro (AND), no lo reemplaza", async () => {
    await seedInbox();
    // "hola" solo está en la de WhatsApp, que no tiene lead → hot la descarta.
    expect(await ids(await buscar("q=hola&filter=hot"))).toEqual([]);
    expect(await ids(await buscar("q=tacos&filter=hot"))).toEqual(["zernio:999888777"]);
  });

  it("recorta espacios alrededor", async () => {
    await seedInbox();
    expect(await ids(await buscar(`q=${encodeURIComponent("  tacos  ")}`))).toEqual([
      "zernio:999888777",
    ]);
  });

  // Regresión: la búsqueda tronaba (500) con q de 49 BYTES o más. D1 rechaza
  // patrones LIKE de más de 50 bytes ("LIKE or GLOB pattern too complex") y el
  // patrón era `%q%`, así que buscar el nombre completo de un cliente tumbaba
  // la bandeja entera. Ver src/lib/search-sql.ts.
  it("aguanta q larga sin reventar — el techo eran BYTES, no caracteres", async () => {
    await seedInbox();
    const casos: [string, string][] = [
      ["48 bytes (el último que funcionaba)", "z".repeat(48)],
      ["49 bytes (el primero que tronaba)", "z".repeat(49)],
      ["50 bytes", "z".repeat(50)],
      ["60 bytes = el tope del contrato", "z".repeat(60)],
      // 25 'ñ' son 50 bytes en UTF-8: se ven como 25 letras y ya rompían.
      ["24 ñ = 48 bytes", "ñ".repeat(24)],
      ["25 ñ = 50 bytes", "ñ".repeat(25)],
      ["60 ñ = 120 bytes", "ñ".repeat(60)],
      // Cada comodín pesaba DOBLE al escaparse: 25 '%' eran 50 bytes de patrón.
      ["30 comodines", "%".repeat(30)],
    ];
    for (const [caso, q] of casos) {
      const res = await buscar(`q=${encodeURIComponent(q)}&limit=3`);
      expect(res.status, caso).toBe(200);
      expect(await res.json(), caso).toMatchObject({ ok: true, conversations: [] });
    }
  });

  it("una q larga busca de verdad: encuentra la frase completa, no un prefijo", async () => {
    await seedInbox();
    // 56 caracteres / 61 bytes con acentos — antes ni siquiera llegaba a correr.
    const frase = "necesito la cotización con envío incluido para mañana ya";
    await db.run("UPDATE messages SET content = ? WHERE id = 'mB1'", [`hola, ${frase}, gracias`]);
    expect(await ids(await buscar(`q=${encodeURIComponent(frase)}`))).toEqual(["web:visitor-abc"]);
    // Y sigue siendo exacta: si cambia el final, ya no debe traerla (si el fix
    // hubiera sido "recortar la q", este prefijo la seguiría encontrando).
    expect(await ids(await buscar(`q=${encodeURIComponent(`${frase.slice(0, -2)}no`)}`))).toEqual(
      [],
    );
  });
});

// ── Contrato v3.2 §4: nota de voz desde la app ──────────────────────────────

describe("POST /conversations/:id/media con voice=1 (Contrato v3.2 §4)", () => {
  function nota(type = "audio/mp4", name = "nota.m4a") {
    return new File([new Uint8Array(1024)], name, { type });
  }
  function envConR2() {
    return {
      ...authedEnv({ DASHBOARD_BASE_URL: "https://bot.example.com" }),
      MEDIA: fakeR2(),
    } as unknown as Env;
  }
  function subir(file: File, extra: Record<string, string> = {}) {
    const form = new FormData();
    form.set("file", file);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  }

  it("sale como PTT y guarda la duración que midió el grabador", async () => {
    await seedInbox();
    const env = envConR2();
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: subir(nota(), { voice: "1", duration_s: "12.4" }) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;

    const enviado = sendReplyMock.mock.calls[0][0];
    expect(enviado.media[0]).toMatchObject({ kind: "audio", voice: true });

    const row = await db.first<{ duration_s: number | null; kind: string }>(
      "SELECT duration_s, kind FROM media WHERE conversation_id = ?",
      ["whatsapp:5215512344821"],
    );
    expect(row).toMatchObject({ kind: "audio", duration_s: 12.4 });

    // El hilo la devuelve con su duración, para pintar "0:12" sin abrir nada.
    const hilo = (await (
      await apiApp.request("/conversations/whatsapp:5215512344821/messages", { headers: bearer }, env)
    ).json()) as any;
    expect(hilo.messages.find((m: any) => m.id === body.id).media[0]).toMatchObject({
      kind: "audio",
      duration_s: 12.4,
    });
  });

  it("un audio SIN voice=1 va como archivo (y sin duración si no la mandan)", async () => {
    await seedInbox();
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: subir(nota()) },
      envConR2(),
    );
    expect(res.status).toBe(200);
    expect(sendReplyMock.mock.calls[0][0].media[0].voice).toBeUndefined();
    const row = await db.first<{ duration_s: number | null }>(
      "SELECT duration_s FROM media WHERE conversation_id = ?",
      ["whatsapp:5215512344821"],
    );
    expect(row!.duration_s).toBeNull();
  });

  it("voice=1 en una foto se ignora: una imagen no es nota de voz", async () => {
    await seedInbox();
    const foto = new File([new Uint8Array(256)], "foto.jpg", { type: "image/jpeg" });
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: subir(foto, { voice: "1" }) },
      envConR2(),
    );
    expect(res.status).toBe(200);
    expect(sendReplyMock.mock.calls[0][0].media[0]).toMatchObject({ kind: "image" });
    expect(sendReplyMock.mock.calls[0][0].media[0].voice).toBeUndefined();
  });

  it("una duración basura o negativa no se guarda", async () => {
    await seedInbox();
    const env = envConR2();
    await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: bearer, body: subir(nota(), { voice: "1", duration_s: "-3" }) },
      env,
    );
    await apiApp.request(
      "/conversations/zernio:999888777/media",
      { method: "POST", headers: bearer, body: subir(nota(), { voice: "1", duration_s: "ayer" }) },
      env,
    );
    const rows = await db.all<{ duration_s: number | null }>("SELECT duration_s FROM media");
    expect(rows.map((r) => r.duration_s)).toEqual([null, null]);
  });
});

// ── Contrato v3.2 §2: quién atiende (handoff_by) ─────────────────────────────

describe("handoff_by (Contrato v3.2 §2)", () => {
  /** El header que manda la nube: base64url(JSON {id,name}), sin padding. */
  function actorHeader(id: string, name: string) {
    const json = JSON.stringify({ id, name });
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return {
      "X-Forja-Actor": btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    };
  }
  const beto = actorHeader("subj-beto", "Beto");
  const santi = actorHeader("subj-santi", "Santi");

  const tomar = (headers: Record<string, string>) =>
    apiApp.request(
      "/conversations/whatsapp:5215512344821/handoff",
      {
        method: "POST",
        headers: { ...jsonHeaders, ...headers },
        body: JSON.stringify({ action: "take" }),
      },
      authedEnv(),
    );

  const lista = async (headers: Record<string, string> = {}) =>
    ((await (
      await apiApp.request("/conversations", { headers: { ...bearer, ...headers } }, authedEnv())
    ).json()) as any).conversations.find((c: any) => c.channel === "whatsapp");

  it("take anota quién y lo devuelve; is_me es true para él y false para los demás", async () => {
    await seedInbox();
    const res = await tomar(beto);
    expect(await res.json()).toMatchObject({
      ok: true,
      handoff: "human",
      handoff_by: { name: "Beto", is_me: true },
    });

    expect((await lista(beto)).handoff_by).toEqual({ name: "Beto", is_me: true });
    expect((await lista(santi)).handoff_by).toEqual({ name: "Beto", is_me: false });
    // Sin header no hay identidad contra la cual comparar: nunca es "yo".
    expect((await lista()).handoff_by).toEqual({ name: "Beto", is_me: false });
  });

  it("el hilo lo trae en la RAÍZ, junto a window", async () => {
    await seedInbox();
    await tomar(beto);
    const hilo = (await (
      await apiApp.request(
        "/conversations/whatsapp:5215512344821/messages",
        { headers: { ...bearer, ...santi } },
        authedEnv(),
      )
    ).json()) as any;
    expect(hilo.handoff_by).toEqual({ name: "Beto", is_me: false });
  });

  it("release lo borra y cualquiera puede devolverla al bot", async () => {
    await seedInbox();
    await tomar(beto);
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/handoff",
      { method: "POST", headers: { ...jsonHeaders, ...santi }, body: JSON.stringify({ action: "release" }) },
      authedEnv(),
    );
    expect(await res.json()).toEqual({ ok: true, handoff: "bot" });
    const row = await db.first<{ taken_by: string | null }>(
      "SELECT taken_by FROM conversations WHERE id = ?",
      ["whatsapp:5215512344821"],
    );
    expect(row!.taken_by).toBeNull();
    expect((await lista(beto)).handoff_by).toBeNull();
  });

  it("responder ES tomarla: queda anotado quien contestó", async () => {
    await seedInbox();
    const res = await apiApp.request(
      "/conversations/whatsapp:5215512344821/messages",
      { method: "POST", headers: { ...jsonHeaders, ...beto }, body: JSON.stringify({ text: "ya voy" }) },
      authedEnv(),
    );
    expect((await res.json()) as any).toMatchObject({ handoff_by: { name: "Beto", is_me: true } });
    expect((await lista(beto)).handoff_by).toEqual({ name: "Beto", is_me: true });
  });

  it("mandar un archivo también la toma", async () => {
    await seedInbox();
    const env = {
      ...authedEnv({ DASHBOARD_BASE_URL: "https://bot.example.com" }),
      MEDIA: fakeR2(),
    } as unknown as Env;
    const form = new FormData();
    form.set("file", new File([new Uint8Array(64)], "foto.jpg", { type: "image/jpeg" }));
    await apiApp.request(
      "/conversations/whatsapp:5215512344821/media",
      { method: "POST", headers: { ...bearer, ...beto }, body: form },
      env,
    );
    expect((await lista(beto)).handoff_by).toEqual({ name: "Beto", is_me: true });
  });

  it("sin pausa vigente no hay nadie atendiendo, aunque quede un taken_by viejo", async () => {
    await seedInbox();
    await tomar(beto);
    await db.run("UPDATE conversations SET paused_until = ? WHERE id = ?", [
      NOW - 1000,
      "whatsapp:5215512344821",
    ]);
    expect((await lista(beto)).handoff_by).toBeNull();
  });

  it("sin header X-Forja-Actor todo sigue igual que antes (nadie anotado)", async () => {
    await seedInbox();
    const res = await tomar({});
    expect(await res.json()).toEqual({ ok: true, handoff: "human", handoff_by: null });
    expect((await lista()).handoff_by).toBeNull();
  });

  it("un header basura no rompe nada: se ignora", async () => {
    await seedInbox();
    for (const raw of ["no-es-base64!!", btoa("{}"), btoa('{"id":"x"}')]) {
      const res = await tomar({ "X-Forja-Actor": raw });
      expect((await res.json()) as any).toMatchObject({ ok: true, handoff_by: null });
    }
  });

  it("deja rastro en la bitácora del panel, con la etiqueta (app)", async () => {
    await seedInbox();
    await tomar(beto);
    const row = await db.first<{ actor_id: string | null; actor_label: string; accion: string }>(
      "SELECT actor_id, actor_label, accion FROM panel_audit ORDER BY at DESC LIMIT 1",
    );
    expect(row).toMatchObject({
      actor_id: null,
      actor_label: "Beto (app)",
      accion: "conversacion_tomada",
    });
  });

  it("bot VIEJO sin la columna taken_by: el ALTER corre solo y la bandeja no se cae", async () => {
    // Un bot desplegado antes de v3.2 nunca re-ejecutó schema.sql.
    await db.run("DROP TABLE IF EXISTS conversations");
    await db.run(
      `CREATE TABLE conversations (
        id TEXT PRIMARY KEY, channel TEXT NOT NULL, channel_user_id TEXT NOT NULL,
        display_name TEXT, started_at INTEGER NOT NULL, last_message_at INTEGER NOT NULL,
        paused_until INTEGER, open_ticket_id TEXT, metadata TEXT)`,
    );
    await seedInbox();
    expect((await lista(beto)).handoff_by).toBeNull();
    await tomar(beto);
    expect((await lista(beto)).handoff_by).toEqual({ name: "Beto", is_me: true });
  });

  it("NO se mezcla con assigned_to: son dos cosas distintas", async () => {
    await seedInbox();
    await db.run("ALTER TABLE conversations ADD COLUMN assigned_to TEXT").catch(() => {});
    await db.run("UPDATE conversations SET assigned_to = 'panel-user-1' WHERE id = ?", [
      "whatsapp:5215512344821",
    ]);
    await tomar(beto);
    const row = await db.first<{ assigned_to: string | null; taken_by: string | null }>(
      "SELECT assigned_to, taken_by FROM conversations WHERE id = ?",
      ["whatsapp:5215512344821"],
    );
    expect(row!.assigned_to).toBe("panel-user-1");
    expect(JSON.parse(row!.taken_by!)).toMatchObject({ id: "subj-beto", name: "Beto" });
  });
});
