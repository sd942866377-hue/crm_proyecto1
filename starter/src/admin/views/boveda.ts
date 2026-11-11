// Bóveda (superpoder Forja+): galería de las imágenes/documentos que los clientes
// mandaron, archivados en el R2 del miembro. Read-only. Cada item enlaza a su
// conversación. Los archivos se sirven tras el auth del panel (GET /admin/media/:id),
// nunca públicos.
import type { Env } from "../../env";
import { traductor } from "../i18n";
import { Db } from "../../db/client";
import { layout } from "./layout";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

interface MediaRow {
  id: string;
  conversation_id: string | null;
  kind: string;
  mime: string | null;
  caption: string | null;
  created_at: number;
  display_name: string | null;
  channel_user_id: string | null;
}

function fechaCorta(env: Env, ts: number): string {
  try {
    return new Intl.DateTimeFormat(env.BOT_LANGUAGE || "es-MX", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
  }
}

function card(env: Env, r: MediaRow): string {
  const cliente = esc(r.display_name ?? r.channel_user_id ?? "—");
  const fecha = esc(fechaCorta(env, r.created_at));
  const convLink = r.conversation_id
    ? `/admin/conversations?c=${encodeURIComponent(r.conversation_id)}`
    : "#";
  const cap = r.caption ? `<div style="font-size:10.5px;color:var(--dim);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.caption)}</div>` : "";

  const visual =
    r.kind === "image"
      ? `<a href="/admin/media/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">
           <img src="/admin/media/${encodeURIComponent(r.id)}" loading="lazy" alt="${cliente}"
                style="width:100%;height:150px;object-fit:cover;display:block;background:var(--panel2);border:1px solid var(--line)">
         </a>`
      : `<a href="/admin/media/${encodeURIComponent(r.id)}" target="_blank" rel="noopener"
            style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:150px;background:var(--panel2);border:1px solid var(--line);text-decoration:none">
           <i data-lucide="file-text" width="34" height="34" style="color:var(--accent)"></i>
           <span style="font-size:10.5px;color:var(--dim)">${esc((r.mime ?? "archivo").split("/").pop() ?? "archivo")}</span>
         </a>`;

  return `
  <div style="background:var(--panel);border:1px solid var(--line);overflow:hidden">
    ${visual}
    <div style="padding:8px 10px">
      <a href="${convLink}" style="font-size:12px;font-weight:600;color:var(--cream);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${cliente}</a>
      ${cap}
      <div style="font-size:10px;color:var(--dim);margin-top:3px">${fecha}</div>
    </div>
  </div>`;
}

export async function renderBoveda(env: Env): Promise<string> {
  const tr = traductor(env);
  const db = new Db(env.DB);

  // Sin binding MEDIA = superpoder no provisionado: invita a activarlo con /boveda.
  if (!env.MEDIA) {
    const body = `<div style="max-width:560px;margin:56px auto;text-align:center;padding:0 20px">
      <i data-lucide="images" width="36" height="36" style="color:var(--dim);margin:0 auto 14px;display:block"></i>
      <div style="font-family:'Space Grotesk';font-size:17px;color:var(--cream);margin-bottom:10px">${esc(tr("boveda.tituloVacio"))}</div>
      <div style="font-size:12.5px;color:var(--dim);line-height:1.6">${esc(tr("boveda.activarAyuda"))}</div>
    </div>`;
    return layout({ title: esc(tr("boveda.titulo")), activeTab: "boveda", body, env });
  }

  let rows: MediaRow[] = [];
  try {
    rows = await db.all<MediaRow>(
      `SELECT m.id, m.conversation_id, m.kind, m.mime, m.caption, m.created_at,
              c.display_name, c.channel_user_id
       FROM media m LEFT JOIN conversations c ON c.id = m.conversation_id
       ORDER BY m.created_at DESC LIMIT 300`,
    );
  } catch {
    rows = []; // la tabla media aún no existe (nada archivado todavía)
  }

  const body =
    rows.length === 0
      ? `<div style="max-width:520px;margin:56px auto;text-align:center;padding:0 20px">
           <i data-lucide="image-off" width="34" height="34" style="color:var(--dim);margin:0 auto 12px;display:block"></i>
           <div style="font-size:13px;color:var(--muted)">${esc(tr("boveda.sinArchivos"))}</div>
         </div>`
      : `<div style="padding:18px 22px">
           <div style="font-size:11px;color:var(--dim);margin-bottom:14px">${rows.length} ${esc(tr("boveda.contador"))}</div>
           <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">
             ${rows.map((r) => card(env, r)).join("")}
           </div>
         </div>`;

  return layout({ title: esc(tr("boveda.titulo")), activeTab: "boveda", body, env });
}
