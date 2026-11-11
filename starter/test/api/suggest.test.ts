/**
 * Contrato v3.2 §3 — POST /api/conversations/:id/suggest ("sugiere qué
 * contestarle"). Sin red: `generateText` del AI SDK y el provider de Anthropic
 * van mockeados; D1 es real (miniflare).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { apiApp } from "../../src/api";
import { Db } from "../../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../../src/db/settings";
import { __resetSuggestThrottle } from "../../src/copilot";
import type { Env } from "../../src/env";

const TOKEN = "cp-secret-token";
const NOW = Date.now();

let d1: any;
let db: Db;

function authedEnv(): Env {
  return {
    DB: d1,
    ANTHROPIC_API_KEY: "sk-test",
    BOT_NAME: "Testi",
    BUSINESS_NAME: "Test",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "8",
    CONTROL_PLANE_TOKEN: TOKEN,
  } as unknown as Env;
}

const bearer = { Authorization: `Bearer ${TOKEN}` };
const jsonHeaders = { ...bearer, "Content-Type": "application/json" };
const json = (res: Response): Promise<any> => res.json() as Promise<any>;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  d1 = (await mf.getD1Database("DB")) as any;
  db = new Db(d1);
  __resetSuggestThrottle();
  generateTextMock.mockReset();
  generateTextMock.mockResolvedValue({
    text: "  Claro, te lo aparto hasta mañana a las 6.  ",
    usage: { inputTokens: 1840, outputTokens: 42 },
  });
});

async function seedConv(id = "whatsapp:u1", conMensajes = true) {
  await db.run(
    `INSERT INTO conversations (id, channel, channel_user_id, display_name, started_at, last_message_at)
     VALUES (?, 'whatsapp', ?, 'Ana', ?, ?)`,
    [id, id.split(":")[1], NOW - 5000, NOW],
  );
  if (!conMensajes) return;
  await db.run(
    `INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES
       (?, ?, 'assistant', 'Con gusto, ¿qué necesitas?', ?),
       (?, ?, 'user', '¿me lo puedes apartar?', ?)`,
    [`q1:${id}`, id, NOW - 4000, `q2:${id}`, id, NOW - 3000],
  );
}

const sugerir = (id = "whatsapp:u1", body?: unknown) =>
  apiApp.request(
    `/conversations/${encodeURIComponent(id)}/suggest`,
    {
      method: "POST",
      headers: jsonHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    authedEnv(),
  );

describe("POST /api/conversations/:id/suggest (§3)", () => {
  it("401 sin Bearer", async () => {
    const env = authedEnv() as any;
    delete env.CONTROL_PLANE_TOKEN;
    const res = await apiApp.request(
      "/conversations/whatsapp:u1/suggest",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("shape del contrato: sugerencia limpia, modelo y tokens", async () => {
    await seedConv();
    const res = await sugerir();
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      ok: true,
      suggestion: "Claro, te lo aparto hasta mañana a las 6.",
      model: "claude-haiku-4-5-20251001", // tier fast por default
      tokens: { input: 1840, output: 42 },
    });
  });

  it("no persiste NADA: la sugerencia no entra al hilo ni pausa la conversación", async () => {
    await seedConv();
    await sugerir();
    const n = await db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?",
      ["whatsapp:u1"],
    );
    expect(n!.n).toBe(2);
    const conv = await db.first<{ paused_until: number | null }>(
      "SELECT paused_until FROM conversations WHERE id = ?",
      ["whatsapp:u1"],
    );
    expect(conv!.paused_until).toBeNull();
  });

  it("usa el prompt EFECTIVO del bot y los últimos turnos, sin arrancar con el bot", async () => {
    await seedConv();
    await new SettingsRepo(db).set(SETTING_KEYS.systemPromptOverride, "PROMPT DEL DUEÑO");
    await sugerir();
    const arg = generateTextMock.mock.calls[0][0] as {
      system: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(arg.system).toBe("PROMPT DEL DUEÑO");
    // El primer turno del historial era del BOT: se descarta para que el
    // proveedor no rechace la llamada por empezar con "assistant".
    expect(arg.messages[0].role).toBe("user");
    expect(arg.messages[0].content).toContain("apartar");
    expect(arg.messages[arg.messages.length - 1].content).toContain("asistente del dueño");
  });

  it("el hint del dueño viaja en la instrucción y se recorta a 200", async () => {
    await seedConv();
    await sugerir("whatsapp:u1", { hint: "dile que hoy cerramos a las 5" });
    let arg = generateTextMock.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(arg.messages[arg.messages.length - 1].content).toContain("hoy cerramos a las 5");

    __resetSuggestThrottle();
    await sugerir("whatsapp:u1", { hint: "x".repeat(500) });
    arg = generateTextMock.mock.calls[1][0] as { messages: Array<{ content: string }> };
    const instruccion = arg.messages[arg.messages.length - 1].content;
    expect(instruccion).toContain("x".repeat(200));
    expect(instruccion).not.toContain("x".repeat(201));
  });

  it("sin body (o con body roto) funciona igual: es el botón ✨ a secas", async () => {
    await seedConv();
    expect((await sugerir()).status).toBe(200);
    __resetSuggestThrottle();
    const res = await apiApp.request(
      "/conversations/whatsapp:u1/suggest",
      { method: "POST", headers: jsonHeaders, body: "{roto" },
      authedEnv(),
    );
    expect(res.status).toBe(200);
  });

  it("404 not_found si la conversación no existe (y sin gastar IA)", async () => {
    const res = await sugerir("whatsapp:fantasma");
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("not_found");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("409 no_history con el hilo vacío", async () => {
    await seedConv("whatsapp:u1", false);
    const res = await sugerir();
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("no_history");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("429 suggest_throttled: 1 por conversación cada 5s, y no frena a las demás", async () => {
    await seedConv();
    await seedConv("whatsapp:u2");
    expect((await sugerir()).status).toBe(200);

    const segunda = await sugerir();
    expect(segunda.status).toBe(429);
    expect((await json(segunda)).error).toBe("suggest_throttled");
    expect(generateTextMock).toHaveBeenCalledTimes(1);

    // Otra conversación tiene su propio cupo.
    expect((await sugerir("whatsapp:u2")).status).toBe(200);
  });

  it("502 llm_failed con el detalle del proveedor", async () => {
    await seedConv();
    generateTextMock.mockRejectedValue(new Error("overloaded_error"));
    const res = await sugerir();
    expect(res.status).toBe(502);
    expect(await json(res)).toEqual({
      ok: false,
      error: "llm_failed",
      detail: "overloaded_error",
    });
  });

  // REGRESIÓN: con una `llm_api_key` vencida guardada en el panel, el agente
  // seguía contestando (él sí reintenta con otro proveedor) y ✨ sugerir
  // devolvía 502 "API key is invalid.". El dueño veía su bot sano y el botón
  // roto. Ver src/llm/work-model.ts.
  it("con la llave del panel vencida sugiere igual: cae a la del sistema", async () => {
    await seedConv();
    await new SettingsRepo(db).set(SETTING_KEYS.llmApiKey, "sk-ant-vencida");
    generateTextMock
      .mockRejectedValueOnce(new Error("API key is invalid."))
      .mockResolvedValueOnce({ text: "Va, te lo aparto.", usage: {} });

    const res = await sugerir();
    expect(res.status).toBe(200);
    expect((await json(res)).suggestion).toBe("Va, te lo aparto.");
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("si tampoco la del sistema sirve, el 502 lleva el error de la llave del dueño", async () => {
    await seedConv();
    await new SettingsRepo(db).set(SETTING_KEYS.llmApiKey, "sk-ant-vencida");
    generateTextMock
      .mockRejectedValueOnce(new Error("API key is invalid."))
      .mockRejectedValueOnce(new Error("overloaded_error"));

    const res = await sugerir();
    expect(res.status).toBe(502);
    // El detalle es el del PRIMER candidato: lo que el dueño tiene que arreglar
    // es SU llave, no el estado del respaldo.
    expect((await json(res)).detail).toBe("API key is invalid.");
  });
});
