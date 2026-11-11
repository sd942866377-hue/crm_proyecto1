// Live wall "/show" — pantalla pública (con token) para PROYECTAR durante la
// masterclass: contador de mensajes en vivo + últimos mensajes entrantes
// anonimizados. Auto-refresca cada 4s. Estética: negro #0a0a0a + naranja.
import type { Env } from "./env";
import { Db } from "./db/client";
import { NOT_TEST_REF } from "./db/testFilter";

interface RecentMsg {
  content: string;
  created_at: number;
  conversation_id: string;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

/** "instagram:1803875733595655" → "insta…5655" (anónimo pero distinguible). */
function anonId(convId: string): string {
  const [channel, id] = convId.split(":");
  const tail = (id ?? convId).slice(-4);
  return `${(channel ?? "chat").slice(0, 5)}…${tail}`;
}

export async function renderShow(env: Env): Promise<string> {
  const db = new Db(env.DB);
  const hourAgo = Date.now() - 3600_000;
  const dayAgo = Date.now() - 86_400_000;

  const lastHour = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages WHERE role = 'user' AND created_at > ? AND ${NOT_TEST_REF}`,
    [hourAgo],
  );
  const convsToday = await db.first<{ n: number }>(
    `SELECT COUNT(DISTINCT conversation_id) AS n FROM messages WHERE created_at > ? AND ${NOT_TEST_REF}`,
    [dayAgo],
  );
  const recent = await db.all<RecentMsg>(
    `SELECT content, created_at, conversation_id FROM messages
     WHERE role = 'user' AND ${NOT_TEST_REF} ORDER BY created_at DESC LIMIT 8`,
  );

  const rows = recent
    .map((m) => {
      const txt = m.content.replace(/\s+/g, " ").slice(0, 90);
      return `<div class="msg"><span class="who">${esc(anonId(m.conversation_id))}</span><span class="txt">${esc(txt)}${m.content.length > 90 ? "…" : ""}</span></div>`;
    })
    .join("");

  const eventName = env.EVENT_NAME ?? "la masterclass";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="4">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EN VIVO — ${esc(eventName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0a0a0a;color:#F5EFE3;font-family:'JetBrains Mono',monospace;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;padding:40px;overflow:hidden}
  body::before{content:"";position:fixed;inset:0;background:radial-gradient(70% 55% at 50% 0%,rgba(255,106,0,.16),transparent 60%);pointer-events:none}
  .live{display:flex;align-items:center;gap:10px;font-size:14px;letter-spacing:.3em;color:#F2624C;text-transform:uppercase}
  .dot{width:12px;height:12px;border-radius:50%;background:#F2624C;animation:p 1.4s ease-out infinite}
  @keyframes p{0%{box-shadow:0 0 0 0 rgba(242,98,76,.6)}100%{box-shadow:0 0 0 18px rgba(242,98,76,0)}}
  .big{font-family:'Anton',sans-serif;font-size:clamp(90px,18vw,220px);line-height:.9;color:#FF6A00;text-shadow:0 0 80px rgba(255,106,0,.35)}
  .lbl{font-size:15px;letter-spacing:.18em;text-transform:uppercase;color:#d3cabb}
  .sub{font-size:13px;color:#8b8b84}
  .feed{width:min(880px,92vw);display:flex;flex-direction:column;gap:9px}
  .msg{display:flex;gap:14px;align-items:baseline;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.02);padding:11px 16px;border-radius:10px}
  .who{flex:none;color:#FF8a33;font-size:12px}
  .txt{color:#d3cabb;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style>
</head>
<body>
  <div class="live"><span class="dot"></span> mensajes al agente · en vivo</div>
  <div style="text-align:center">
    <div class="big">${lastHour?.n ?? 0}</div>
    <div class="lbl">mensajes en la última hora</div>
    <div class="sub">${convsToday?.n ?? 0} personas conversando hoy · ${esc(eventName)}</div>
  </div>
  <div class="feed">${rows || '<div class="msg"><span class="txt">esperando el primer mensaje…</span></div>'}</div>
</body>
</html>`;
}
