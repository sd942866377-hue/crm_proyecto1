import type { ModelMessage } from "ai";
import type { Env } from "../env";

/**
 * ALTERNATIVA de visión cuando el modelo del chat no puede ver imágenes (un
 * modelo BYO solo-texto, o todas las vías multimodales fallaron): Workers AI
 * (llava, en la cuenta CF del propio miembro — sin llave extra) DESCRIBE la
 * imagen y el turno se reintenta con la descripción como texto. Devuelve null
 * si no hay binding [ai] o si la descripción falla — el caller decide.
 */
export async function describeImage(env: Env, imageUrl: string): Promise<string | null> {
  if (!env.AI) {
    console.warn("[vision] sin binding [ai] — no hay alternativa de visión");
    return null;
  }
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.warn(`[vision] fallback: no pude bajar la imagen (http_${res.status})`);
      return null;
    }
    const bytes = [...new Uint8Array(await res.arrayBuffer())];
    const out = (await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf" as any, {
      image: bytes,
      prompt:
        "Describe esta imagen en español en 2-4 frases, con los detalles útiles para un agente de atención a clientes: qué se ve, textos legibles, productos, cantidades, estado.",
      max_tokens: 512,
    } as any)) as { description?: string; text?: string };
    const desc = (out?.description ?? out?.text ?? "").trim();
    return desc || null;
  } catch (e) {
    console.warn("[vision] fallback de Workers AI falló:", e);
    return null;
  }
}

export function buildMultimodalUserMessage(
  text: string | undefined,
  imageUrl: string | undefined,
): ModelMessage {
  if (!imageUrl) {
    return { role: "user", content: text ?? "" };
  }
  return {
    role: "user",
    content: [
      { type: "image", image: new URL(imageUrl) },
      ...(text ? [{ type: "text" as const, text }] : []),
    ],
  };
}
