import type { Env } from "../env";

export interface TranscriptionResult {
  text: string;
  durationSeconds?: number;
}

/**
 * Transcripción con CADENA DE ALTERNATIVAS — un miembro que usa Claude (sin
 * llave de OpenAI) transcribe igual:
 *
 *  1. Workers AI (@cf/openai/whisper-large-v3-turbo) — viene GRATIS con la
 *     cuenta de Cloudflare del miembro vía el binding [ai]; no pide ninguna
 *     llave. Es la vía default.
 *  2. OpenAI Whisper API — SOLO si el miembro tiene OPENAI_API_KEY (p. ej.
 *     bots viejos cuyo wrangler.toml preservado aún no trae el bloque [ai]).
 *  3. Sin vía → error claro con el fix (agregar [ai]), no un fallo mudo.
 *
 * Cada caída de escalón deja línea en el log (regla: los fallos no son mudos).
 */
export async function transcribeAudio(
  audioUrl: string,
  env: Env,
): Promise<TranscriptionResult> {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const mime = (res.headers.get("content-type") ?? "audio/ogg").split(";")[0].trim();

  // 1) Workers AI — sin llave, en la cuenta del propio miembro.
  if (env.AI) {
    try {
      // whisper-large-v3-turbo expects a base64-encoded string in `audio` (per
      // the Cloudflare Workers AI docs), NOT a raw byte array. nodejs_compat is
      // enabled (see wrangler.toml) so Buffer is available.
      const base64 = Buffer.from(buffer).toString("base64");
      const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo" as any, {
        audio: base64,
      } as any);
      const text = ((result as any).text ?? "").trim();
      if (text) return { text };
      console.warn("[transcribe] Workers AI devolvió texto vacío — probando alternativa");
    } catch (e) {
      console.warn("[transcribe] Workers AI falló — probando alternativa:", e);
    }
  } else {
    console.warn(
      "[transcribe] este bot no tiene el binding [ai] en wrangler.toml (bots viejos: agrega el bloque `[ai]` + `binding = \"AI\"` y redeploy) — probando alternativa",
    );
  }

  // 2) OpenAI Whisper — solo si el miembro tiene llave.
  if (env.OPENAI_API_KEY) {
    const ext = /mp4|m4a|aac/.test(mime) ? "m4a" : /mpeg|mp3/.test(mime) ? "mp3" : "ogg";
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mime }), `audio.${ext}`);
    form.append("model", "whisper-1");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    if (r.ok) {
      const j = (await r.json()) as { text?: string };
      const text = (j.text ?? "").trim();
      if (text) return { text };
      console.warn("[transcribe] OpenAI Whisper devolvió texto vacío");
    } else {
      console.warn(
        `[transcribe] OpenAI Whisper http_${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`,
      );
    }
  }

  throw new Error(
    "sin vía de transcripción: ni binding [ai] (Workers AI) ni OPENAI_API_KEY — agrega el bloque [ai] a wrangler.toml y redeploy",
  );
}
