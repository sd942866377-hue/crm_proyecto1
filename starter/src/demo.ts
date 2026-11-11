import type { Context } from "hono";
import type { Env } from "./env";
import { Db } from "./db/client";
import { conNegocio, htmlLang, textosWidget } from "./web/textos";

/**
 * MODO DEMO — chat web público para enseñarle el bot a un prospecto en vivo.
 *
 * Se activa con la var `DEMO_MODE = "on"` en wrangler.toml. APAGADO por defecto:
 * un bot de producción NUNCA debe exponer un chat sin autenticar (es acceso
 * gratis a tu llave de IA). El skill `/demo` lo prende solo en la instancia
 * desechable del prospecto.
 *
 * Flujo: el navegador genera un sessionId → POST /demo/send entra por el canal
 * `web` al mismo pipeline del agente → la respuesta se persiste en D1 → la
 * página la recoge con GET /demo/poll. Sin webhooks, sin WhatsApp, sin Telegram.
 */

/** Tope de turnos por sesión: un demo real no pasa de ~15 preguntas. */
const MAX_TURNS_PER_SESSION = 40;

export function demoEnabled(env: Env): boolean {
  return (env.DEMO_MODE ?? "").toLowerCase() === "on";
}

/** Cuántos mensajes del visitante lleva esta sesión (anti-abuso de costo). */
export async function demoTurnsUsed(env: Env, sessionId: string): Promise<number> {
  const db = new Db(env.DB);
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
      WHERE c.channel = 'web' AND c.channel_user_id = ? AND m.role = 'user'`,
    [sessionId],
  );
  return row?.n ?? 0;
}

export function demoOverLimit(used: number): boolean {
  return used >= MAX_TURNS_PER_SESSION;
}

/** GET /demo/poll?session=…&after=… → mensajes del bot posteriores a `after`. */
export async function demoPoll(c: Context<{ Bindings: Env }>) {
  if (!demoEnabled(c.env)) return c.json({ ok: false, error: "demo_off" }, 404);

  const sessionId = (c.req.query("session") ?? "").slice(0, 64);
  const after = Number(c.req.query("after") ?? 0) || 0;
  if (!sessionId) return c.json({ ok: false, error: "missing_session" }, 400);

  const db = new Db(c.env.DB);
  const conv = await db.first<{ id: string }>(
    "SELECT id FROM conversations WHERE channel = 'web' AND channel_user_id = ? LIMIT 1",
    [sessionId],
  );
  if (!conv) return c.json({ ok: true, messages: [] });

  const rows = await db.all<{ role: string; content: string; created_at: number }>(
    `SELECT role, content, created_at FROM messages
      WHERE conversation_id = ? AND created_at > ? AND role = 'assistant'
      ORDER BY created_at ASC LIMIT 20`,
    [conv.id, after],
  );

  return c.json({
    ok: true,
    messages: rows.map((r) => ({ text: r.content, at: r.created_at })),
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GET /demo → la página de chat, con la marca del negocio del prospecto. */
export function demoPage(c: Context<{ Bindings: Env }>) {
  if (!demoEnabled(c.env)) return c.text("Not found", 404);

  // El prospecto que abre la demo lee el idioma con el que atiende el bot.
  const tx = textosWidget(c.env.BOT_LANGUAGE || "");
  const business = esc(c.env.BUSINESS_NAME || "Tu negocio");
  const bot = esc(c.env.BOT_NAME || `${tx.demoAsistenteDe} ${business}`);
  const initial = business.trim().charAt(0).toUpperCase() || "•";

  return c.html(`<!doctype html>
<html lang="${esc(htmlLang(c.env.BOT_LANGUAGE || ""))}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${bot}</title>
<meta name="theme-color" content="#0e1116">
<meta property="og:title" content="${bot}">
<meta property="og:description" content="${esc(tx.demoOgDescripcion)}">
<style>
  *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  :root{--bg:#0e1116;--panel:#161b22;--line:#232a34;--ink:#e9edf2;--dim:#9aa4b2;
        --me:#2f6df6;--bot:#1c222c;--accent:#FF6A00}
  html,body{height:100%}
  body{background:var(--bg);color:var(--ink);
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
       display:flex;flex-direction:column;overscroll-behavior:none}
  header{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--panel);
         border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2;
         padding-top:calc(14px + env(safe-area-inset-top))}
  .avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#ff9a4d);
          display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;color:#111;flex:0 0 auto}
  .who{min-width:0}
  .who b{display:block;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .who span{font-size:12px;color:#3ddc84;display:flex;align-items:center;gap:5px;margin-top:2px}
  .dot{width:7px;height:7px;border-radius:50%;background:#3ddc84;display:inline-block}
  main{flex:1;overflow-y:auto;padding:18px 14px 8px;display:flex;flex-direction:column;gap:10px}
  .row{display:flex;max-width:82%}
  .row.me{align-self:flex-end;justify-content:flex-end}
  .row.bot{align-self:flex-start}
  .bub{padding:11px 14px;border-radius:18px;font-size:15px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
  .me .bub{background:var(--me);border-bottom-right-radius:5px}
  .bot .bub{background:var(--bot);border:1px solid var(--line);border-bottom-left-radius:5px}
  .typing{display:flex;gap:4px;padding:14px 16px}
  .typing i{width:7px;height:7px;border-radius:50%;background:var(--dim);animation:b 1.3s infinite}
  .typing i:nth-child(2){animation-delay:.18s}.typing i:nth-child(3){animation-delay:.36s}
  @keyframes b{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}
  footer{padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:var(--panel);
         border-top:1px solid var(--line);display:flex;gap:10px;align-items:flex-end}
  textarea{flex:1;resize:none;background:#0e1116;color:var(--ink);border:1px solid var(--line);
           border-radius:20px;padding:11px 15px;font:inherit;font-size:15px;max-height:120px;outline:none}
  textarea:focus{border-color:var(--me)}
  button{background:var(--me);color:#fff;border:none;border-radius:50%;width:42px;height:42px;
         font-size:18px;cursor:pointer;flex:0 0 auto;transition:.15s}
  button:disabled{opacity:.4;cursor:default}
  .note{text-align:center;font-size:11.5px;color:var(--dim);padding:8px 16px 14px}
  .err{background:#3a1d1d;border:1px solid #66302f;color:#ffb3ae}
</style></head>
<body>
  <header>
    <div class="avatar">${initial}</div>
    <div class="who"><b>${bot}</b><span><i class="dot"></i>${esc(tx.demoEnLinea)}</span></div>
  </header>

  <main id="chat">
    <div class="row bot"><div class="bub">${conNegocio(tx.demoSaludo, business)}</div></div>
  </main>

  <footer>
    <textarea id="t" rows="1" placeholder="${esc(tx.escribeTuMensaje)}" autocomplete="off"></textarea>
    <button id="s" aria-label="${esc(tx.enviar)}">➤</button>
  </footer>
  <div class="note">Demo de ${business} · atendido por IA</div>

<script>
(function(){
  var KEY='forja_demo_session';
  var sid=localStorage.getItem(KEY);
  if(!sid){ sid=(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2));
            localStorage.setItem(KEY,sid); }

  var chat=document.getElementById('chat'), ta=document.getElementById('t'), btn=document.getElementById('s');
  var since=0, polling=null, waiting=false;

  function scroll(){ chat.scrollTop=chat.scrollHeight; }
  function add(text,who,cls){
    var r=document.createElement('div'); r.className='row '+who;
    var b=document.createElement('div'); b.className='bub'+(cls?' '+cls:''); b.textContent=text;
    r.appendChild(b); chat.appendChild(r); scroll(); return r;
  }
  function typing(){
    var r=document.createElement('div'); r.className='row bot'; r.id='typing';
    r.innerHTML='<div class="bub typing"><i></i><i></i><i></i></div>';
    chat.appendChild(r); scroll(); return r;
  }
  function stopTyping(){ var e=document.getElementById('typing'); if(e) e.remove(); }

  ta.addEventListener('input',function(){ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,120)+'px'; });
  ta.addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });
  btn.addEventListener('click',send);

  function poll(){
    fetch('/demo/poll?session='+encodeURIComponent(sid)+'&after='+since)
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(!d||!d.ok||!d.messages||!d.messages.length) return;
        stopTyping();
        d.messages.forEach(function(m){ add(m.text,'bot'); if(m.at>since) since=m.at; });
        waiting=false; btn.disabled=false;
        if(polling){ clearInterval(polling); polling=null; }
      }).catch(function(){});
  }

  function send(){
    var text=ta.value.trim(); if(!text||waiting) return;
    add(text,'me'); ta.value=''; ta.style.height='auto';
    waiting=true; btn.disabled=true; typing();
    if(!since) since=Date.now()-1000;

    fetch('/demo/send',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sessionId:sid,text:text})})
      .then(function(r){ return r.json().catch(function(){ return {ok:r.ok}; }); })
      .then(function(d){
        if(d&&d.ok===false){
          stopTyping(); waiting=false; btn.disabled=false;
          add(d.error==='limit'
              ? ${JSON.stringify(tx.demoSeAcabo)}
              : ${JSON.stringify(tx.demoErrorGenerico)},'bot','err');
          return;
        }
        if(polling) clearInterval(polling);
        polling=setInterval(poll,1200);
        setTimeout(function(){ if(waiting){ stopTyping(); waiting=false; btn.disabled=false;
          if(polling){clearInterval(polling);polling=null;} } },45000);
      })
      .catch(function(){ stopTyping(); waiting=false; btn.disabled=false;
                         add(${JSON.stringify(tx.demoSinConexion)},'bot','err'); });
  }
})();
</script>
</body></html>`);
}
