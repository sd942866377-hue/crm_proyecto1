// Genera un lead magnet como página web estilizada (colores tipo Claude: coral
// sobre crema, limpio y atractivo) y lo hostea en R2. Devuelve la URL en el
// dominio del Worker (GET /lm/:id la sirve). El agente-dueño escribe el contenido
// en markdown; aquí lo renderizamos y publicamos.
import type { Env } from "../env";
import { selfOrigin } from "../lib/self-origin";

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/** Markdown mínimo → HTML (# ## ###, **bold**, *italic*, - listas, [links](url), párrafos). */
export function renderMarkdown(md: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of (md ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}

export function leadMagnetPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#faf7f2;--card:#fff;--ink:#2b2724;--muted:#6b6259;--accent:#cc785c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:48px 22px 80px}
.badge{display:inline-block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:10px}
h1{font-size:2.1rem;line-height:1.2;margin:.2em 0 .6em}
h2{color:var(--accent);margin-top:1.8em;font-size:1.35rem}
h3{margin-top:1.4em;font-size:1.08rem}
a{color:var(--accent);font-weight:600}ul{padding-left:1.2em}li{margin:.35em 0}p{margin:.9em 0}
.card{background:var(--card);border:1px solid #ece4d8;border-radius:18px;padding:38px 34px;box-shadow:0 8px 30px rgba(80,60,40,.06)}
.foot{margin-top:34px;text-align:center;color:var(--muted);font-size:13px}.foot b{color:var(--accent)}
</style></head><body><div class="wrap"><div class="card">
<div class="badge">Horizontes IA</div>
<h1>${esc(title)}</h1>
${bodyHtml}
</div><div class="foot">Hecho con 🧡 por <b>Horizontes IA</b> · horizontesia.com</div></div></body></html>`;
}

/** Renderiza + hostea el lead magnet en R2. Devuelve la URL (en el Worker). */
export async function publishLeadMagnet(title: string, markdown: string, env: Env): Promise<string> {
  if (!env.CATALOG)
    throw new Error("R2 no está activado — los lead magnets requieren R2. Guía: docs/opcional-lead-magnets.md");
  const slug =
    (title || "recurso").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "recurso";
  const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
  const html = leadMagnetPage(title || "Recurso", renderMarkdown(markdown));
  await env.CATALOG.put(`lm/${id}.html`, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });
  const base = await selfOrigin(env);
  return `${base}/lm/${id}`;
}
