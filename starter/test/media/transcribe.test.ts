import { describe, it, expect, vi } from "vitest";
import { transcribeAudio } from "../../src/media/transcribe";

describe("transcribeAudio", () => {
  it("calls Workers AI Whisper with base64 audio + returns text", async () => {
    const calls: any[] = [];
    const fakeEnv: any = {
      AI: {
        run: async (model: string, input: any) => {
          calls.push({ model, input });
          return { text: "hola que tal" };
        },
      },
    };
    // mock global fetch for the audio download
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as any;
    const result = await transcribeAudio("https://x/audio.ogg", fakeEnv);
    expect(result.text).toBe("hola que tal");
    expect(calls[0].model).toBe("@cf/openai/whisper-large-v3-turbo");
    // whisper-large-v3-turbo expects a base64 STRING (per Cloudflare docs), not bytes.
    expect(typeof calls[0].input.audio).toBe("string");
    // bytes [1,2,3] -> base64 "AQID"
    expect(calls[0].input.audio).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });
});

describe("transcribeAudio — cadena de alternativas (sin llave de OpenAI obligatoria)", () => {
  it("sin binding AI pero con OPENAI_API_KEY → cae a Whisper de OpenAI", async () => {
    const fetched: string[] = [];
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      fetched.push(String(url));
      if (String(url).includes("api.openai.com")) {
        expect(init.headers.Authorization).toBe("Bearer sk-test");
        return new Response(JSON.stringify({ text: "hola desde whisper de openai" }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/ogg" } });
    }) as any;
    const result = await transcribeAudio("https://x/audio.ogg", { OPENAI_API_KEY: "sk-test" } as any);
    expect(result.text).toBe("hola desde whisper de openai");
    expect(fetched.some((u) => u.includes("api.openai.com/v1/audio/transcriptions"))).toBe(true);
  });

  it("Workers AI falla y hay llave de OpenAI → la alternativa rescata el turno", async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes("api.openai.com")) {
        return new Response(JSON.stringify({ text: "rescatado" }), { status: 200 });
      }
      return new Response(new Uint8Array([9]), { headers: { "content-type": "audio/mp4" } });
    }) as any;
    const env: any = {
      AI: { run: async () => { throw new Error("workers ai caído"); } },
      OPENAI_API_KEY: "sk-test",
    };
    const result = await transcribeAudio("https://x/nota.m4a", env);
    expect(result.text).toBe("rescatado");
  });

  it("sin AI y sin OPENAI_API_KEY → error CLARO con el fix ([ai])", async () => {
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "audio/ogg" } })) as any;
    await expect(transcribeAudio("https://x/a.ogg", {} as any)).rejects.toThrow(/\[ai\]/);
  });
});
