/**
 * Co-pilot del panel — POST /admin/conversations/:id/suggest.
 *
 * Devuelve un fragmento HTML (HTMX) con UNA respuesta sugerida para que el
 * dueño la copie; nunca le manda nada al cliente. Guarded por el Basic Auth
 * wildcard del panel. La cabeza vive en src/copilot.ts y la comparte con el
 * botón ✨ de la app: aquí se verifica que el panel la usa de verdad, con el
 * prompt EFECTIVO del bot.
 *
 * Sin red: se mockea `generateText` del AI SDK y el provider de Anthropic. D1
 * es real (miniflare), así que el historial y los settings son los de verdad.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  // createAnthropic devuelve una fábrica; el "modelo" es opaco y generateText
  // (mockeado) nunca lo usa de verdad.
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { adminApp } from "../../src/admin/routes";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { __resetSuggestThrottle } from "../../src/copilot";
import type { Env } from "../../src/env";

const PASSWORD = "secret123";
const NOW = Date.now();

let d1: any;
let db: Db;

function makeEnv(): Env {
  return {
    DB: d1,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "TestBot",
    BUSINESS_NAME: "Negocio de Prueba",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "5",
    DASHBOARD_BASE_URL: "https://example.com",
    DASHBOARD_PASSWORD: PASSWORD,
    OWNER_EMAIL: "owner@example.com",
  } as unknown as Env;
}

function basicAuthHeader(user: string, pass: string): string {
  const raw = `${user}:${pass}`;
  const b64 = typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "utf-8").toString("base64");
  return `Basic ${b64}`;
}

async function seedConv(id = "whatsapp:u1") {
  await db.run(
    `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
     VALUES (?, 'whatsapp', 'u1', 'Ana', ?, ?)`,
    [id, NOW - 5000, NOW],
  );
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES
       ('s1', ?, 'user', 'Hola, ¿tienen disponibilidad mañana?', ?),
       ('s2', ?, 'assistant', 'Déjame revisar.', ?)`,
    [id, NOW - 4000, id, NOW - 3000],
  );
}

const pedirSugerencia = (id = "whatsapp:u1", pass = PASSWORD) =>
  adminApp.request(
    `/conversations/${encodeURIComponent(id)}/suggest`,
    { method: "POST", headers: { Authorization: basicAuthHeader("admin", pass) } },
    makeEnv(),
  );

describe("admin co-pilot suggestion endpoint", () => {
  beforeEach(async () => {
    const mf = await createTestMiniflare();
    d1 = (await mf.getD1Database("DB")) as any;
    db = new Db(d1);
    __resetSuggestThrottle();
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({
      text: "Claro, tenemos espacio mañana a las 3pm. ¿Te reservo?",
      usage: { inputTokens: 120, outputTokens: 18 },
    });
  });

  it("returns 200 with the suggestion fragment when authenticated", async () => {
    await seedConv();
    const res = await pedirSugerencia();

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sugerencia del co-pilot");
    expect(html).toContain("Claro, tenemos espacio mañana a las 3pm. ¿Te reservo?");
    expect(generateTextMock).toHaveBeenCalledTimes(1);

    const callArg = generateTextMock.mock.calls[0][0] as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArg.system.length).toBeGreaterThan(0);
    // El historial viaja + la instrucción final del dueño.
    expect(callArg.messages[0].content).toContain("disponibilidad mañana");
    const last = callArg.messages[callArg.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("asistente del dueño");
  });

  it("usa el prompt EFECTIVO del bot, no el generado a secas", async () => {
    await seedConv();
    await new SettingsRepo(db).set(SETTING_KEYS.systemPromptOverride, "MI PROMPT CUSTOM DEL DUEÑO");
    await pedirSugerencia();
    const callArg = generateTextMock.mock.calls[0][0] as { system: string };
    expect(callArg.system).toBe("MI PROMPT CUSTOM DEL DUEÑO");
  });

  it("escapes HTML in the LLM output (no injection)", async () => {
    await seedConv();
    generateTextMock.mockResolvedValue({ text: "<script>alert(1)</script>" });
    const res = await pedirSugerencia();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("una conversación inexistente no truena: lo dice en la misma cajita", async () => {
    const res = await pedirSugerencia("whatsapp:fantasma");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ya no existe");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("si el proveedor falla, el motivo sale en la cajita en vez de un 500", async () => {
    await seedConv();
    generateTextMock.mockRejectedValue(new Error("overloaded_error"));
    const res = await pedirSugerencia();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("overloaded_error");
  });

  it("returns 401 without auth", async () => {
    const res = await adminApp.request(
      "/conversations/whatsapp:u1/suggest",
      { method: "POST" },
      makeEnv(),
    );
    expect(res.status).toBe(401);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("returns 401 with a wrong password", async () => {
    const res = await pedirSugerencia("whatsapp:u1", "wrong");
    expect(res.status).toBe(401);
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
