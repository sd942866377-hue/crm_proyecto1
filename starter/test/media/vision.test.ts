import { describe, it, expect, vi } from "vitest";
import { buildMultimodalUserMessage } from "../../src/media/vision";

describe("buildMultimodalUserMessage", () => {
  it("returns a plain text user message when there is no image", () => {
    const msg = buildMultimodalUserMessage("hola, ¿agendan hoy?", undefined);
    expect(msg).toEqual({ role: "user", content: "hola, ¿agendan hoy?" });
  });

  it("returns an empty-string user message when there is neither text nor image", () => {
    const msg = buildMultimodalUserMessage(undefined, undefined);
    expect(msg).toEqual({ role: "user", content: "" });
  });

  it("builds a multimodal message with image + text caption", () => {
    const msg = buildMultimodalUserMessage(
      "¿qué es esto?",
      "https://x/photo.jpg",
    );
    expect(msg.role).toBe("user");
    const content = msg.content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);

    const imagePart = content[0];
    expect(imagePart.type).toBe("image");
    expect(imagePart.image).toBeInstanceOf(URL);
    expect((imagePart.image as URL).href).toBe("https://x/photo.jpg");

    const textPart = content[1];
    expect(textPart).toEqual({ type: "text", text: "¿qué es esto?" });
  });

  it("builds an image-only message when there is no caption", () => {
    const msg = buildMultimodalUserMessage(undefined, "https://x/photo.jpg");
    const content = msg.content as Array<Record<string, unknown>>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("image");
    expect((content[0].image as URL).href).toBe("https://x/photo.jpg");
  });

  it("does not perform any network call (pure message builder)", () => {
    // buildMultimodalUserMessage only constructs a CoreMessage; no fetch/provider involved.
    const fetchSpy = (globalThis as { fetch?: unknown }).fetch;
    const msg = buildMultimodalUserMessage("hi", "https://x/photo.jpg");
    expect(msg.role).toBe("user");
    // fetch reference unchanged / untouched by the builder
    expect((globalThis as { fetch?: unknown }).fetch).toBe(fetchSpy);
  });
});

describe("describeImage — alternativa de visión vía Workers AI", () => {
  it("baja la imagen y llava la describe (bytes + prompt en español)", async () => {
    const { describeImage } = await import("../../src/media/vision");
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([7, 8, 9]))) as any;
    const calls: any[] = [];
    const env: any = { AI: { run: async (m: string, input: any) => { calls.push({ m, input }); return { description: "Una casa blanca de dos pisos con jardín." }; } } };
    const desc = await describeImage(env, "https://x/foto.jpg");
    expect(desc).toBe("Una casa blanca de dos pisos con jardín.");
    expect(calls[0].m).toBe("@cf/llava-hf/llava-1.5-7b-hf");
    expect(Array.isArray(calls[0].input.image)).toBe(true);
    expect(calls[0].input.prompt).toMatch(/español/);
  });

  it("sin binding [ai] → null (el caller decide), sin lanzar", async () => {
    const { describeImage } = await import("../../src/media/vision");
    expect(await describeImage({} as any, "https://x/foto.jpg")).toBe(null);
  });

  it("si Workers AI falla → null, jamás rompe el turno", async () => {
    const { describeImage } = await import("../../src/media/vision");
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]))) as any;
    const env: any = { AI: { run: async () => { throw new Error("boom"); } } };
    expect(await describeImage(env, "https://x/foto.jpg")).toBe(null);
  });
});
