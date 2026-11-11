// Transcribe un reel/video de Instagram con Supadata. Devuelve el texto o un
// error legible para el agente. Endpoint: GET /v1/transcript?url=&text=true
// con header x-api-key.
import type { Env } from "../env";

export async function transcribeReel(
  url: string,
  env: Env,
): Promise<{ text: string } | { error: string }> {
  const key = env.SUPADATA_API_KEY;
  if (!key) return { error: "SUPADATA_API_KEY no configurada" };
  const api = `https://api.supadata.ai/v1/transcript?url=${encodeURIComponent(url)}&text=true`;
  let res: Response;
  try {
    res = await fetch(api, { headers: { "x-api-key": key } });
  } catch (e) {
    return { error: `no pude llamar a Supadata: ${e instanceof Error ? e.message : e}` };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    return { error: String(data?.message || data?.error || `Supadata devolvió ${res.status}`) };
  }
  const text =
    typeof data.content === "string"
      ? data.content
      : typeof data.text === "string"
        ? data.text
        : Array.isArray(data.transcript)
          ? data.transcript.map((s: any) => s?.text ?? "").join(" ")
          : typeof data.transcript === "string"
            ? data.transcript
            : "";
  if (!text.trim()) return { error: "ese video no tiene transcripción disponible (poco/nada de habla)" };
  return { text };
}
