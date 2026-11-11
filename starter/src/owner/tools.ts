// Tools del agente-dueño (formato OpenAI/xAI) + sus ejecutores. Cada tool es una
// capacidad; agregar una tool = agregar una función del agente.
import type { Env } from "../env";
import { Db } from "../db/client";
import { resolveReelToMediaId } from "../funnels/reel";
import { saveFunnel } from "../funnels/store";
import { getLibrary, lookupResource } from "./library";
import { transcribeReel } from "./supadata";
import { publishLeadMagnet } from "./leadmagnet";

export const OWNER_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_resources",
      description: "Lista los lead magnets guardados en la librería (nombre → url).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_reel",
      description: "Resuelve la URL de un reel/post de Instagram a su media id.",
      parameters: {
        type: "object",
        properties: { reel_url: { type: "string", description: "URL pública del reel" } },
        required: ["reel_url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transcribe_reel",
      description: "Transcribe el audio de un reel de IG. Úsalo para basar el lead magnet en lo que dice el video.",
      parameters: {
        type: "object",
        properties: { reel_url: { type: "string" } },
        required: ["reel_url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "publish_lead_magnet",
      description:
        "Publica un lead magnet como página web estilizada y devuelve su URL. TÚ escribes el content en markdown (útil, concreto, basado en el reel). Dale la URL a Santi para que la REVISE antes de usarla como recurso de un embudo.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string", description: "cuerpo del lead magnet en markdown (# títulos, **negritas**, - listas)" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_funnel",
      description:
        "Crea el embudo de comentarios para un reel. Requiere reel_url + keyword, y el recurso: resource_name (de la librería) O resource_url directo.",
      parameters: {
        type: "object",
        properties: {
          reel_url: { type: "string" },
          keyword: { type: "string", description: "palabra que dispara el embudo, ej. QUIERO" },
          resource_name: { type: "string", description: "nombre en la librería, ej. masterclass" },
          resource_url: { type: "string", description: "URL directa del recurso (alternativa a resource_name)" },
          resource_message: { type: "string", description: "mensajito neutral que acompaña al link al entregarlo, ej. 'Perfecto, aquí te dejo el acceso 👇'. El link se agrega solo." },
          dm: { type: "string", description: "texto del primer DM con botón (opcional; si falta, uno por defecto)" },
          public_reply: { type: "string", description: "respuesta pública en el comentario (opcional)" },
        },
        required: ["reel_url", "keyword"],
      },
    },
  },
] as const;

/** Ejecuta una tool por nombre. Devuelve un objeto JSON-serializable para el modelo. */
export async function runTool(name: string, args: Record<string, any>, env: Env): Promise<unknown> {
  const db = new Db(env.DB);

  if (name === "list_resources") {
    return { resources: await getLibrary(db) };
  }

  if (name === "resolve_reel") {
    const id = await resolveReelToMediaId(String(args.reel_url ?? ""), env);
    return id ? { media_id: id } : { error: "no encontré ese reel en /me/media" };
  }

  if (name === "transcribe_reel") {
    return await transcribeReel(String(args.reel_url ?? ""), env);
  }

  if (name === "publish_lead_magnet") {
    if (!env.CATALOG)
      return {
        error:
          'Los lead magnets aún no están activados en este bot. Requieren R2 (opcional). Para activarlo, dile a Claude "activa los lead magnets" y sigue docs/opcional-lead-magnets.md.',
      };
    const url = await publishLeadMagnet(String(args.title ?? "Recurso"), String(args.content ?? ""), env);
    return { ok: true, url, note: "Dale esta URL a Santi para que la revise ANTES de usarla en un embudo." };
  }

  if (name === "create_funnel") {
    const mediaId = await resolveReelToMediaId(String(args.reel_url ?? ""), env);
    if (!mediaId) return { error: "no encontré ese reel en tu cuenta" };
    let url = args.resource_url ? String(args.resource_url) : "";
    if (!url && args.resource_name) {
      const r = await lookupResource(db, String(args.resource_name));
      if (!r) return { error: `no tengo un recurso llamado "${args.resource_name}" en la librería` };
      url = r;
    }
    if (!url) return { error: "falta el recurso (resource_url o resource_name)" };
    // El recurso que se entrega = mensajito neutral + el link (no el link pelón).
    const msg = String(args.resource_message ?? "").trim() || "¡Aquí lo tienes! 👇";
    const rule = await saveFunnel(db, {
      mediaId,
      keyword: String(args.keyword ?? "").trim(),
      dm: String(args.dm ?? "¡Qué bueno que te interesa! 🎉 Dale al botón de abajo 👇"),
      buttonLabel: "Obtener",
      resource: `${msg}\n${url}`,
      publicReply: args.public_reply ? String(args.public_reply) : undefined,
    });
    return { ok: true, funnel: rule };
  }

  return { error: `tool desconocida: ${name}` };
}
