/**
 * El failover de los superpoderes (src/llm/work-model.ts).
 *
 * REGRESIÓN: con una `llm_api_key` inválida guardada en el panel, el agente
 * seguía contestando (él SÍ tiene failover) mientras ✨ sugerir, "que el bot
 * aprenda esto", el Analista, los follow-ups y el reporte del dueño devolvían
 * "API key is invalid.". El bot se veía sano con la mitad de sus superpoderes
 * muertos.
 *
 * Aquí `ai` va mockeado y los SDK de proveedor también: no hay red, solo la
 * cadena de candidatos y a cuál se le pidió el texto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: ({ apiKey }: { apiKey?: string }) => (modelId: string) => ({
    p: "anthropic",
    modelId,
    apiKey,
  }),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: ({ apiKey }: { apiKey?: string }) => (modelId: string) => ({
    p: "openai",
    modelId,
    apiKey,
  }),
}));
vi.mock("@ai-sdk/xai", () => ({
  createXai: ({ apiKey }: { apiKey?: string }) => (modelId: string) => ({ p: "xai", modelId, apiKey }),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: ({ apiKey }: { apiKey?: string }) => (modelId: string) => ({
    p: "google",
    modelId,
    apiKey,
  }),
}));

import { workModelFrom } from "../../src/llm/work-model";
import type { Env } from "../../src/env";

const LLAVE_MALA = new Error("API key is invalid.");

function env(over: Partial<Env> = {}): Env {
  return { ANTHROPIC_API_KEY: "sk-ant-del-sistema", ...over } as Env;
}

/** El modelo al que se le pidió el texto en la llamada n (0-based). */
function pedidoA(n: number): { p: string; modelId: string; apiKey?: string } {
  return (generateTextMock.mock.calls[n][0] as { model: any }).model;
}

beforeEach(() => {
  generateTextMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("workModel — failover de los superpoderes", () => {
  it("llave BYO vencida del MISMO proveedor: cae a la llave del sistema", async () => {
    generateTextMock.mockRejectedValueOnce(LLAVE_MALA).mockResolvedValueOnce({ text: "listo" });

    const llm = workModelFrom(env(), "fast", { apiKey: "sk-ant-vencida" });
    expect(await llm.generate({ prompt: "x" })).toMatchObject({ text: "listo" });

    expect(pedidoA(0).apiKey).toBe("sk-ant-vencida");
    expect(pedidoA(1).apiKey).toBe("sk-ant-del-sistema");
    expect(pedidoA(1).p).toBe("anthropic"); // misma casa, no le cambiamos de proveedor
  });

  it("llave BYO de un proveedor sin llave del sistema: cae al proveedor que sí tiene", async () => {
    generateTextMock.mockRejectedValueOnce(LLAVE_MALA).mockResolvedValueOnce({ text: "listo" });

    // Grok elegido en el panel con una llave muerta; el env solo tiene Anthropic.
    const llm = workModelFrom(env(), "fast", { provider: "xai", apiKey: "xai-muerta" });
    await llm.generate({ prompt: "x" });

    expect(pedidoA(0).p).toBe("xai");
    expect(pedidoA(1)).toMatchObject({ p: "anthropic", apiKey: "sk-ant-del-sistema" });
    // Y el modelo que se reporta es el que DE VERDAD escribió (costos, la app).
    expect(llm.modelId).toBe("claude-haiku-4-5-20251001");
    expect(llm.provider).toBe("anthropic");
  });

  it("si ninguno puede, relanza el error del PRIMER candidato (la config del dueño)", async () => {
    generateTextMock
      .mockRejectedValueOnce(LLAVE_MALA)
      .mockRejectedValueOnce(new Error("el respaldo tambien trono"));

    const llm = workModelFrom(env(), "fast", { apiKey: "sk-ant-vencida" });
    // El dueño tiene que leer "tu llave está mal", no el error del respaldo.
    await expect(llm.generate({ prompt: "x" })).rejects.toThrow("API key is invalid.");
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it("sin overrides del panel no hay a dónde caer: un intento y el error tal cual", async () => {
    generateTextMock.mockRejectedValueOnce(LLAVE_MALA);
    const llm = workModelFrom(env(), "fast", {});
    await expect(llm.generate({ prompt: "x" })).rejects.toThrow("API key is invalid.");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("es pegajoso: un bucle no vuelve a tocar la llave muerta en cada vuelta", async () => {
    generateTextMock
      .mockRejectedValueOnce(LLAVE_MALA)
      .mockResolvedValue({ text: "listo" });

    const llm = workModelFrom(env(), "fast", { apiKey: "sk-ant-vencida" });
    for (let i = 0; i < 4; i++) await llm.generate({ prompt: `x${i}` });

    // 1 fallo + 4 respuestas = 5 llamadas, no 8 (2 por vuelta).
    expect(generateTextMock).toHaveBeenCalledTimes(5);
    for (let n = 1; n < 5; n++) expect(pedidoA(n).apiKey).toBe("sk-ant-del-sistema");
  });

  it("camino feliz: sin fallos no se toca ningún respaldo", async () => {
    generateTextMock.mockResolvedValue({ text: "listo" });
    const llm = workModelFrom(env(), "fast", { apiKey: "sk-ant-buena", model: "claude-opus-5" });
    await llm.generate({ prompt: "x" });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(llm.modelId).toBe("claude-opus-5");
  });
});
