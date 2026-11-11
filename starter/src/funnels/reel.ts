// Resuelve la URL pública de un reel/post de IG a su media id, matándola contra
// el `permalink` de GET /me/media. Así el dueño solo pega la URL del reel y el
// embudo queda ligado a ESE post. Usa INSTAGRAM_ACCESS_TOKEN.
import type { Env } from "../env";

const GRAPH = "https://graph.instagram.com/v21.0";

/**
 * Extrae el shortcode de una URL de IG (el segmento tras /reel/, /p/ o /tv/).
 * Comparar por shortcode ignora www/no-www, query, slash y /reel vs /p.
 * Case-sensitive a propósito: los shortcodes de IG distinguen mayúsculas.
 */
export function reelShortcode(url: string): string {
  const m = (url ?? "").trim().match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : "";
}

/** Devuelve el mediaId del post cuyo permalink coincide con `url`, o null. */
export async function resolveReelToMediaId(url: string, env: Env): Promise<string | null> {
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new Error("INSTAGRAM_ACCESS_TOKEN not set");
  const target = reelShortcode(url);
  if (!target) return null;
  let next: string | null =
    `${GRAPH}/me/media?fields=id,permalink&limit=50&access_token=${encodeURIComponent(token)}`;
  // Pagina por si el post no está en la primera página (hasta 5 páginas).
  for (let page = 0; page < 5 && next; page++) {
    const res: Response = await fetch(next);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { id: string; permalink?: string }[];
      paging?: { next?: string };
    };
    for (const m of data.data ?? []) {
      if (m.permalink && reelShortcode(m.permalink) === target) return m.id;
    }
    next = data.paging?.next ?? null;
  }
  return null;
}
