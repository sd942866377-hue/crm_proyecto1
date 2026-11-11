// Equipo del panel: el jefe del negocio (rol admin) crea accesos para su
// gente (rol staff) con links de invitación — pensado para la entrega de un
// bot white-label a un cliente (Modo Agencia). También las páginas sueltas de
// login e invitación (fuera del layout: ahí todavía no hay sesión).
import type { Env } from "../../env";
import { traductor } from "../i18n";
import { layout } from "./layout";
import { resolveBranding } from "../branding";
import type { PanelUser, AuditRow } from "../equipo";

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

/**
 * Páginas sueltas (login / invitación) — diseño split: tarjeta clara con el
 * form a la izquierda, panel oscuro con gradiente granulado del acento a la
 * derecha (replica en CSS puro la referencia de Santi — sin librerías). Toma
 * la marca del bot (white-label): nombre, logo y color de acento.
 */
function paginaSuelta(env: Env, titulo: string, cuerpo: string, ladoOscuro: string): string {
  const b = resolveBranding(env);
  const acc = b.accent || "#FC7819";
  const logo = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="" style="height:56px;max-width:220px;object-fit:contain">`
    : `<div style="font-weight:700;font-size:19px;letter-spacing:-.02em">${esc(b.name)}</div>`;
  // Ruido de grano: SVG feTurbulence embebido (data-uri) — cero dependencias.
  const noise = "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>`.replace("%23", "#"),
  );
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)} — ${esc(b.name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; font-synthesis: none; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #fff; color: #000; min-height: 100vh; padding: 12px; }
  .split { display: grid; gap: 24px; min-height: calc(100vh - 24px); }
  @media (min-width: 1024px) { .split { grid-template-columns: 0.94fr 1.06fr; } }
  .lado-form { border: 1px solid rgba(0,0,0,.2); border-radius: 6px; background: #fff;
               display: flex; align-items: center; padding: 48px 24px; }
  @media (min-width: 1024px) { .lado-form { padding: 48px 56px; } }
  .caja { width: 100%; max-width: 480px; margin: 0 auto; }
  h1 { font-size: clamp(30px, 4vw, 44px); font-weight: 500; letter-spacing: -.04em; margin: 26px 0 8px; }
  p.sub { font-size: clamp(16px, 2vw, 20px); color: rgba(0,0,0,.6); line-height: 1.35; }
  form { margin-top: 40px; display: flex; flex-direction: column; gap: 18px; }
  .campo { display: flex; height: 56px; align-items: center; justify-content: space-between; gap: 16px;
           border: 1px solid rgba(0,0,0,.25); border-radius: 10px; background: #fff; padding: 0 20px; }
  .campo:focus-within { border-color: rgba(0,0,0,.55); }
  .campo input { flex: 1; min-width: 0; border: none; outline: none; font-size: 17px; color: #000; background: transparent; }
  .campo input::placeholder { color: transparent; }
  .campo span { flex: none; font-size: 17px; color: #000; pointer-events: none; }
  .campo input:not(:placeholder-shown) + span, .campo input:focus + span { display: none; }
  button[type=submit] { margin-top: 22px; height: 48px; width: 100%; border-radius: 10px;
    border: 1px solid rgba(0,0,0,.4); background: #000; color: #fff; font-size: 19px; font-weight: 500; cursor: pointer; }
  button[type=submit]:hover { background: rgba(0,0,0,.85); }
  .btn-sec { display: flex; align-items: center; justify-content: center; margin-top: 10px;
    height: 44px; width: 100%; border-radius: 10px; background: #fff; color: #000;
    border: 1px solid rgba(0,0,0,.3); font-size: 15px; font-weight: 400;
    cursor: pointer; text-decoration: none; }
  .btn-sec:hover { background: rgba(0,0,0,.05); }
  a.btn-cloud { display: flex; align-items: center; justify-content: center; margin-top: 40px;
    height: 48px; width: 100%; border-radius: 10px; border: 1px solid rgba(0,0,0,.4);
    background: #000; color: #fff; font-size: 18px; font-weight: 500; text-decoration: none; }
  a.btn-cloud:hover { background: rgba(0,0,0,.85); }
  details.det { margin-top: 18px; }
  details.det summary { cursor: pointer; font-size: 13.5px; color: rgba(0,0,0,.55);
    text-decoration: underline; text-underline-offset: 2px; list-style: none; width: fit-content; }
  details.det summary::-webkit-details-marker { display: none; }
  details.det form { margin-top: 14px; }
  .nota { margin-top: 16px; font-size: 13.5px; color: rgba(0,0,0,.35); line-height: 1.5; }
  .err { border: 1px solid #d99a83; background: #fbe9e4; border-radius: 10px; padding: 10px 14px; font-size: 14px; margin-top: 18px; }
  .ok { border: 1px solid #9ec89a; background: #eaf6e8; border-radius: 10px; padding: 10px 14px; font-size: 14px; margin-top: 18px; line-height: 1.5; }
  .grupo { border: 1px solid rgba(0,0,0,.15); border-radius: 10px; padding: 14px 16px; }
  .grupo-t { font-size: 14px; font-weight: 600; } .grupo-s { font-size: 12.5px; color: rgba(0,0,0,.5); margin-top: 2px; }
  .dias { display: flex; gap: 6px; margin-top: 10px; }
  .dias label { flex: 1; } .dias input { display: none; }
  .dias span { display: block; text-align: center; padding: 8px 0; border: 1px solid rgba(0,0,0,.25); border-radius: 8px; font-size: 13px; cursor: pointer; }
  .dias input:checked + span { background: #000; color: #fff; border-color: #000; }
  .horas { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 14px; color: rgba(0,0,0,.6); }
  .horas input { flex: 1; min-width: 0; height: 44px; border: 1px solid rgba(0,0,0,.25); border-radius: 8px;
                 padding: 0 12px; font-size: 15px; font-family: inherit; color: #000; background: #fff; }
  .horas input:focus { outline: none; border-color: rgba(0,0,0,.55); }
  .radios { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
  .radios label { display: flex; align-items: center; gap: 9px; font-size: 14px; cursor: pointer; }
  .radios input { accent-color: #000; width: 15px; height: 15px; }
  a.link { color: rgba(0,0,0,.55); font-size: 13.5px; text-decoration: underline; text-underline-offset: 2px; }
  .lado-brand { position: relative; overflow: hidden; border-radius: 6px; background: #000; color: #fff;
                padding: 48px; display: none; }
  @media (min-width: 1024px) { .lado-brand { display: flex; } }
  /* Gradiente granulado EN MOVIMIENTO: cuatro manchas del acento que derivan
     por las esquinas (como el shader de la referencia) — CSS puro, sin
     librerías; cada una con su propio ciclo para que nunca se repita igual. */
  .blobs { position: absolute; inset: 0; background: #000; overflow: hidden; }
  .blob { position: absolute; width: 82%; height: 82%; border-radius: 50%;
          filter: blur(64px) saturate(1.25); will-change: transform; opacity: 1; }
  .b1 { left: -20%; top: -22%; background: ${acc}; animation: der1 18s ease-in-out infinite; }
  .b2 { right: -22%; top: -18%; background: ${acc}cc; animation: der2 23s ease-in-out infinite; }
  .b3 { right: -20%; bottom: -24%; background: ${acc}; animation: der3 20s ease-in-out infinite; }
  .b4 { left: -24%; bottom: -20%; background: #ffffff66; animation: der4 26s ease-in-out infinite; }
  @keyframes der1 { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(14%,10%) scale(1.15); } 66% { transform: translate(-6%,16%) scale(.95); } }
  @keyframes der2 { 0%,100% { transform: translate(0,0) scale(1); } 40% { transform: translate(-16%,12%) scale(1.1); } 70% { transform: translate(-4%,-8%) scale(1.2); } }
  @keyframes der3 { 0%,100% { transform: translate(0,0) scale(1); } 30% { transform: translate(-12%,-14%) scale(1.12); } 65% { transform: translate(8%,-4%) scale(.9); } }
  @keyframes der4 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(18%,-16%) scale(1.25); } }
  @media (prefers-reduced-motion: reduce) { .blob { animation: none; } }
  .grano { position: absolute; inset: 0; background-image: url("${noise}"); mix-blend-mode: overlay; opacity: .5; }
  .brand-int { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: space-between; width: 100%; }
  .brand-int h2 { font-size: clamp(40px, 4.6vw, 66px); font-weight: 500; letter-spacing: -.05em; line-height: .98; max-width: 560px; padding-top: 40px; }
  .brand-pie { display: inline-flex; align-items: center; gap: 10px; font-size: 15px; color: rgba(255,255,255,.85);
               border: 1px solid rgba(255,255,255,.25); border-radius: 10px; padding: 0 18px; height: 46px;
               width: fit-content; backdrop-filter: blur(4px); }
</style></head><body>
<div class="split">
  <div class="lado-form"><div class="caja">${logo}${cuerpo}</div></div>
  <div class="lado-brand"><div class="blobs"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="blob b4"></div></div><div class="grano"></div>
    <div class="brand-int">${ladoOscuro}</div>
  </div>
</div></body></html>`;
}

/** Textos del login: los del white-label (settings) o el default del idioma. */
export interface LoginCopy { titulo: string; sub: string; frase: string; pie: string; boton: string }
export function loginCopy(env: Env, settings: Record<string, string> = {}): LoginCopy {
  const t = traductor(env);
  const pick = (k: string, def: string) => (settings[k] ?? "").trim().slice(0, 160) || def;
  return {
    titulo: pick("login_titulo", t("equipo.loginTitulo")),
    sub: pick("login_sub", t("equipo.loginSub")),
    frase: pick("login_frase", t("equipo.brandTitulo")),
    pie: pick("login_pie", t("equipo.loginMaster")),
    boton: pick("login_boton", t("equipo.entrar")),
  };
}

export function renderLogin(env: Env, opts: { error?: string; copy?: LoginCopy; cloudUrl?: string; variant?: "admin" | "equipo" } = {}): string {
  const t = traductor(env);
  const b = resolveBranding(env);
  const c = opts.copy ?? loginCopy(env);
  // Dos puertas sobre el mismo render (decisión de Santi 2026-08-28):
  //  - /equipo (variant "equipo"): el link que se comparte con el equipo y el
  //    dueño — solo el form, sin mención de Forja Cloud.
  //  - /admin/login (variant "admin"): la puerta del administrador — Forja
  //    Cloud primario y el form plegado como rescate (la maestra nunca se
  //    quita: es el único camino si forja-cloud no responde). Tras un error el
  //    form vuelve a verse completo.
  const esEquipo = opts.variant === "equipo";
  const cloudPrimario = !esEquipo && Boolean(opts.cloudUrl) && !opts.error;
  const form = `
    <form method="POST" action="/admin/login">
      ${esEquipo ? `<input type="hidden" name="from" value="equipo">` : ""}
      <label class="campo"><input type="text" name="email" placeholder=" " autocomplete="username"><span>${esc(t("equipo.loginUsuario"))}</span></label>
      <label class="campo"><input type="password" name="password" placeholder=" " autocomplete="current-password" required><span>${esc(t("equipo.password"))}</span></label>
      <button type="submit">${esc(c.boton)}</button>
      ${!esEquipo && !cloudPrimario && opts.cloudUrl ? `<a class="btn-sec" href="${esc(opts.cloudUrl)}">${esc(t("equipo.entrarCloud"))}</a>` : ""}
      <p class="nota"><a class="link" href="/admin/recuperar">${esc(t("equipo.olvide"))}</a></p>
      <p class="nota">${esc(c.pie)}</p>
    </form>`;
  const cuerpo = cloudPrimario
    ? `<a class="btn-cloud" href="${esc(opts.cloudUrl!)}">${esc(t("equipo.entrarCloud"))}</a>
       <details class="det"><summary>${esc(t("equipo.entrarPassword"))}</summary>${form}</details>`
    : form;
  return paginaSuelta(env, c.titulo, `
    <h1>${esc(c.titulo)}</h1>
    <p class="sub">${esc(c.sub)}</p>
    ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
    ${cuerpo}`, `
    <h2>${esc(c.frase)}</h2>
    <div class="brand-pie">${esc(b.name)}</div>`);
}

export function renderInvitacion(
  env: Env,
  token: string,
  opts: { error?: string; email?: string; name?: string | null; phone?: string | null; settings?: Record<string, string> } = {},
): string {
  const t = traductor(env);
  const b = resolveBranding(env);
  return paginaSuelta(env, t("equipo.inviteTitulo"), `
    <h1>${esc(t("equipo.inviteTitulo"))}</h1>
    <p class="sub">${esc(t("equipo.inviteSub"))}${opts.email ? ` <b>${esc(opts.email)}</b>` : ""}</p>
    ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
    <form method="POST" action="/admin/invitacion/${esc(token)}">
      <label class="campo"><input type="text" name="name" placeholder=" " autocomplete="name" value="${esc(opts.name ?? "")}"><span>${esc(t("equipo.nombre"))}</span></label>
      <label class="campo"><input type="tel" name="phone" placeholder=" " autocomplete="tel" value="${esc(opts.phone ?? "")}"><span>${esc(t("equipo.whatsapp"))}</span></label>
      <label class="campo"><input type="text" name="puesto" placeholder=" " maxlength="60"><span>${esc(t("equipo.puesto"))}</span></label>
      <div class="grupo">
        <div class="grupo-t">${esc(t("equipo.horarioTitulo"))}</div>
        <div class="grupo-s">${esc(t("equipo.horarioSub"))}</div>
        <div class="horas"><span>${esc(t("equipo.horarioDe"))}</span><input type="time" name="horario_de" oninput="hReq(this.form)"><span>${esc(t("equipo.horarioA"))}</span><input type="time" name="horario_a" oninput="hReq(this.form)"></div>
        <script>function hReq(f){const r=!!(f.horario_de.value||f.horario_a.value);f.horario_de.required=r;f.horario_a.required=r}</script>
        <div class="dias">${["L", "M", "X", "J", "V", "S", "D"].map((d, i) => `<label><input type="checkbox" name="dias" value="${i + 1}" ${i < 5 ? "checked" : ""}><span>${d}</span></label>`).join("")}</div>
      </div>
      <div class="grupo">
        <div class="grupo-t">${esc(t("equipo.avisoTitulo"))}</div>
        <div class="grupo-s">${esc(t("equipo.avisoSub"))}</div>
        <div class="radios">
          <label><input type="radio" name="aviso_canal" value="email" checked><span>${esc(t("equipo.avisoEmail"))}</span></label>
          <label><input type="radio" name="aviso_canal" value="whatsapp"><span>${esc(t("equipo.avisoWhatsapp"))}</span></label>
          <label><input type="radio" name="aviso_canal" value="ninguno"><span>${esc(t("equipo.avisoNinguno"))}</span></label>
        </div>
      </div>
      <label class="campo"><input type="password" name="password" placeholder=" " autocomplete="new-password" minlength="8" required><span>${esc(t("equipo.passwordNueva"))}</span></label>
      <label class="campo"><input type="password" name="password2" placeholder=" " autocomplete="new-password" minlength="8" required><span>${esc(t("equipo.passwordRepite"))}</span></label>
      <button type="submit">${esc(t("equipo.crearAcceso"))}</button>
    </form>`, `
    <h2>${esc(loginCopy(env, opts.settings).frase)}</h2>
    <div class="brand-pie">${esc(b.name)}</div>`);
}

export function renderRecuperar(env: Env, opts: { enviado?: boolean; conCorreo?: boolean; avisado?: boolean }): string {
  const t = traductor(env);
  const b = resolveBranding(env);
  const msgEnviado = opts.avisado
    ? t("equipo.avisadoAdmin")
    : opts.conCorreo ? t("equipo.recuperarEnviado") : t("equipo.recuperarSinCorreo");
  const cuerpo = opts.enviado
    ? `<h1>${esc(t("equipo.recuperarTitulo"))}</h1>
       <div class="ok">${esc(msgEnviado)}</div>
       <p class="nota"><a class="link" href="/equipo">${esc(t("equipo.volverLogin"))}</a></p>`
    : `<h1>${esc(t("equipo.recuperarTitulo"))}</h1>
       <p class="sub">${esc(t("equipo.recuperarSub"))}</p>
       <form method="POST" action="/admin/recuperar">
         <label class="campo"><input type="email" name="email" placeholder=" " autocomplete="username" required><span>${esc(t("equipo.correo"))}</span></label>
         <button type="submit">${esc(t("equipo.recuperarBtn"))}</button>
         <button type="submit" class="btn-sec" name="via" value="admin">${esc(t("equipo.avisarAdmin"))}</button>
         <p class="nota">${esc(t("equipo.usuarioAyuda"))}</p>
         <p class="nota"><a class="link" href="/equipo">${esc(t("equipo.volverLogin"))}</a></p>
       </form>`;
  return paginaSuelta(env, t("equipo.recuperarTitulo"), cuerpo, `<h2>${esc(t("equipo.brandTitulo"))}</h2><div class="brand-pie">${esc(b.name)}</div>`);
}

export function renderRestablecer(env: Env, token: string, opts: { error?: string }): string {
  const t = traductor(env);
  const b = resolveBranding(env);
  return paginaSuelta(env, t("equipo.restablecerTitulo"), `
    <h1>${esc(t("equipo.restablecerTitulo"))}</h1>
    <p class="sub">${esc(t("equipo.restablecerSub"))}</p>
    ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
    <form method="POST" action="/admin/restablecer/${esc(token)}">
      <label class="campo"><input type="password" name="password" placeholder=" " autocomplete="new-password" minlength="8" required><span>${esc(t("equipo.passwordNueva"))}</span></label>
      <label class="campo"><input type="password" name="password2" placeholder=" " autocomplete="new-password" minlength="8" required><span>${esc(t("equipo.passwordRepite"))}</span></label>
      <button type="submit">${esc(t("equipo.restablecerBtn"))}</button>
    </form>`, `<h2>${esc(t("equipo.brandTitulo"))}</h2><div class="brand-pie">${esc(b.name)}</div>`);
}

export function renderBitacora(env: Env, rows: AuditRow[]): string {
  const t = traductor(env);
  const fecha = (ts: number) => {
    try { return new Intl.DateTimeFormat(env.BOT_LANGUAGE || "es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts)); }
    catch { return new Date(ts).toISOString().slice(0, 16); }
  };
  const filas = rows.map((r) => `
    <tr style="border-top:1px solid var(--line)">
      <td style="padding:8px 12px;font-size:12px;color:var(--dim);white-space:nowrap">${esc(fecha(r.at))}</td>
      <td style="padding:8px 12px;font-size:12.5px">${esc(r.actor_label)}</td>
      <td style="padding:8px 12px;font-size:12.5px"><span style="padding:2px 8px;border:1px solid var(--line);background:var(--bg);font-size:11px">${esc(r.accion)}</span></td>
      <td style="padding:8px 12px;font-size:12.5px;color:var(--muted)">${esc(r.detalle ?? "")}</td>
    </tr>`).join("");
  const body = `
    <p style="max-width:640px;color:var(--dim);font-size:13.5px;line-height:1.6;margin-bottom:16px">${esc(t("equipo.bitacoraIntro"))}</p>
    <div style="border:1px solid var(--line);background:var(--panel)">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)">
          <th style="padding:9px 12px">${esc(t("equipo.bitCuando"))}</th><th style="padding:9px 12px">${esc(t("equipo.bitQuien"))}</th>
          <th style="padding:9px 12px">${esc(t("equipo.bitQue"))}</th><th style="padding:9px 12px">${esc(t("equipo.bitDetalle"))}</th>
        </tr></thead>
        <tbody>${filas || `<tr><td colspan="4" style="padding:16px 12px;color:var(--dim)">${esc(t("equipo.bitVacia"))}</td></tr>`}</tbody>
      </table>
    </div>
    <p style="margin-top:14px"><a href="/admin/equipo" style="color:var(--accent);font-size:13px">← ${esc(t("nav.equipo"))}</a></p>`;
  return layout({ title: t("equipo.bitacora"), activeTab: "equipo", body, env });
}

const DIAS_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];

function camposHorario(t: ReturnType<typeof traductor>, u: { horario: string | null; dias: string | null; puesto: string | null }, INP: string): string {
  const diasSet = new Set((u.dias ?? "1,2,3,4,5").split(",").map(Number));
  const [hDe = "", hA = ""] = (u.horario ?? "").split("-");
  return `
    <label style="display:block;margin-bottom:12px"><div style="font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin-bottom:5px">${esc(t("equipo.puesto"))}</div>
      <input name="puesto" type="text" value="${esc(u.puesto ?? "")}" maxlength="60" style="${INP}"></label>
    <div style="margin-bottom:8px"><div style="font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin-bottom:5px">${esc(t("equipo.horario"))}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12.5px;color:var(--dim)">${esc(t("equipo.horarioDe"))}</span>
        <input name="horario_de" type="time" value="${esc(hDe)}" oninput="hReq(this.form)" style="${INP};width:auto;flex:1">
        <span style="font-size:12.5px;color:var(--dim)">${esc(t("equipo.horarioA"))}</span>
        <input name="horario_a" type="time" value="${esc(hA)}" oninput="hReq(this.form)" style="${INP};width:auto;flex:1">
      </div></div>
    <script>function hReq(f){const r=!!(f.horario_de.value||f.horario_a.value);f.horario_de.required=r;f.horario_a.required=r}</script>
    <div style="display:flex;gap:6px;margin-bottom:14px">${DIAS_CORTOS.map((d, i) => `<label style="flex:1;cursor:pointer"><input type="checkbox" name="dias" value="${i + 1}" ${diasSet.has(i + 1) ? "checked" : ""} style="display:none"><span class="dia-chip">${d}</span></label>`).join("")}</div>
    <style>.dia-chip{display:block;text-align:center;padding:7px 0;border:1px solid var(--line);background:var(--bg);color:var(--cream);font-size:12.5px}input:checked+.dia-chip{background:var(--accent);color:#20140a;border-color:var(--accent)}</style>`;
}

// Estilo canónico de inputs del panel (mismo que config.ts): tokens del tema,
// así se lee igual en el tema oscuro (onyx) que en los claros.
const INP = "background:var(--bg);border:1px solid var(--line);color:var(--cream);padding:10px 12px;font-size:13.5px;outline:none;width:100%";

// Tabs que el admin puede dar o quitar al rol Equipo (las bloqueadas ni se listan).
const TABS_VISIBILIDAD: { id: string; labelKey: string }[] = [
  { id: "conversations", labelKey: "nav.conversations" }, { id: "boveda", labelKey: "nav.boveda" },
  { id: "leads", labelKey: "nav.leads" }, { id: "cobros", labelKey: "nav.cobros" },
  { id: "tickets", labelKey: "nav.tickets" }, { id: "reviews", labelKey: "nav.reviews" },
  { id: "campanas", labelKey: "nav.campanas" }, { id: "plantillas", labelKey: "nav.plantillas" },
  { id: "agente", labelKey: "nav.agente" }, { id: "kb", labelKey: "nav.kb" },
  { id: "mejoras", labelKey: "nav.mejoras" }, { id: "insights", labelKey: "nav.insights" },
  { id: "stats", labelKey: "nav.stats" },
];

export function renderPerfil(env: Env, u: PanelUser, opts: { error?: string; ok?: boolean }): string {
  const t = traductor(env);
  const campo = (name: string, label: string, type: string, value = "", extra = "") =>
    `<label style="display:block;margin-bottom:12px"><div style="font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin-bottom:5px">${esc(label)}</div>
     <input name="${name}" type="${type}" value="${esc(value)}" ${extra} style="${INP}"></label>`;
  const body = `
    ${opts.ok ? `<div style="background:var(--accent-soft);border:1.5px solid var(--accent);padding:10px 14px;font-size:13px;margin-bottom:14px">${esc(t("perfil.guardado"))}</div>` : ""}
    ${opts.error ? `<div style="background:#fbe9e4;border:1.5px solid #d99a83;padding:10px 14px;font-size:13px;margin-bottom:14px">${esc(opts.error)}</div>` : ""}
    <form method="POST" action="/admin/perfil" style="max-width:460px;border:1.5px solid var(--line);background:var(--panel);padding:20px">
      <div style="font-size:12px;color:var(--dim);margin-bottom:14px">${esc(u.email)} · ${u.role === "admin" ? esc(t("equipo.rolAdmin")) : esc(t("equipo.rolStaff"))}</div>
      ${campo("name", t("equipo.nombre"), "text", u.name ?? "", 'autocomplete="name"')}
      ${campo("phone", t("equipo.whatsapp"), "tel", u.phone ?? "", 'autocomplete="tel"')}
      ${camposHorario(t, u, INP)}
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin:6px 0 8px">${esc(t("equipo.avisoTitulo"))}</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;font-size:13px">
        <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="aviso_canal" value="email" ${u.avisos.canal === "email" ? "checked" : ""} style="accent-color:var(--accent)"> ${esc(t("equipo.avisoEmail"))}</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="aviso_canal" value="whatsapp" ${u.avisos.canal === "whatsapp" ? "checked" : ""} style="accent-color:var(--accent)"> ${esc(t("equipo.avisoWhatsapp"))}</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="radio" name="aviso_canal" value="ninguno" ${u.avisos.canal === "ninguno" ? "checked" : ""} style="accent-color:var(--accent)"> ${esc(t("equipo.avisoNinguno"))}</label>
        <div style="height:1px;background:var(--line);margin:4px 0"></div>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="av_escalamientos" value="1" ${u.avisos.escalamientos ? "checked" : ""} style="accent-color:var(--accent)"> ${esc(t("perfil.avEscalamientos"))}</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="av_tickets" value="1" ${u.avisos.tickets ? "checked" : ""} style="accent-color:var(--accent)"> ${esc(t("perfil.avTickets"))}</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="av_resenas" value="1" ${u.avisos.resenas ? "checked" : ""} style="accent-color:var(--accent)"> ${esc(t("perfil.avResenas"))}</label>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="av_reporte" value="1" ${u.avisos.reporte ? "checked" : ""} style="accent-color:var(--accent)"> ${esc(t("perfil.avReporte"))}</label>
      </div>
      <div style="font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin:18px 0 8px">${esc(t("perfil.cambiarPassword"))}</div>
      ${campo("password", t("equipo.passwordNueva"), "password", "", 'autocomplete="new-password" minlength="8"')}
      ${campo("password2", t("equipo.passwordRepite"), "password", "", 'autocomplete="new-password" minlength="8"')}
      <div style="font-size:12px;color:var(--dim);margin:-4px 0 14px">${esc(t("perfil.passwordNota"))}</div>
      <button type="submit" style="padding:10px 18px;font-weight:800;background:var(--accent);color:#20140a;border:none;cursor:pointer">${esc(t("perfil.guardar"))}</button>
    </form>
    <form method="POST" action="/admin/perfil/cerrar-todas" style="max-width:460px;margin-top:14px" onsubmit="return confirm('${esc(t("perfil.cerrarTodasConfirm"))}')">
      <button type="submit" style="padding:9px 14px;font-size:12.5px;background:none;border:1px solid #d99a83;color:#a4442a;cursor:pointer">${esc(t("perfil.cerrarTodas"))}</button>
      <div style="font-size:12px;color:var(--dim);margin-top:6px">${esc(t("perfil.cerrarTodasNota"))}</div>
    </form>`;
  return layout({ title: t("perfil.miPerfil"), activeTab: "overview", body, env });
}

export function renderEquipo(
  env: Env,
  usuarios: PanelUser[],
  opts: { inviteUrl?: string; error?: string; origin: string; staffVisibles?: string[]; guardado?: boolean; correoEnviado?: boolean },
): string {
  const t = traductor(env);
  const visibles = new Set(opts.staffVisibles ?? []);
  const checks = TABS_VISIBILIDAD.map((tab) => `
      <label style="display:flex;align-items:center;gap:9px;padding:8px 10px;border:1px solid var(--line);background:var(--bg);color:var(--cream);cursor:pointer;font-size:13px">
        <input type="checkbox" name="tabs" value="${tab.id}" ${visibles.has(tab.id) ? "checked" : ""} style="width:15px;height:15px;accent-color:var(--accent)">
        <span>${esc(t(tab.labelKey as any))}</span>
      </label>`).join("");
  const visibilidad = `
    <div style="margin-top:26px;border:1.5px solid var(--line);background:var(--panel);padding:18px">
      <div style="font-weight:800;margin-bottom:4px">${esc(t("equipo.visTitulo"))}</div>
      <div style="font-size:12.5px;color:var(--dim);line-height:1.55;margin-bottom:12px">${esc(t("equipo.visIntro"))}</div>
      ${opts.guardado ? `<div style="background:var(--accent-soft);border:1.5px solid var(--accent);padding:8px 12px;font-size:12.5px;margin-bottom:12px">${esc(t("equipo.visGuardado"))}</div>` : ""}
      <form method="POST" action="/admin/equipo/visibilidad">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px">${checks}</div>
        <div style="font-size:11.5px;color:var(--dim);margin:12px 0 10px">${esc(t("equipo.visBloqueadas"))}</div>
        <button type="submit" style="padding:9px 16px;font-weight:800;background:var(--accent);color:#20140a;border:none;cursor:pointer">${esc(t("equipo.visGuardar"))}</button>
      </form>
    </div>`;
  const filas = usuarios
    .map((u) => `
      <tr style="border-top:1.5px solid var(--line)">
        <td style="padding:10px 12px">
          <div style="font-weight:700">${esc(u.name || u.email)}</div>
          <div style="font-size:12px;color:var(--dim)">${esc(u.email)}${u.phone ? ` · ${esc(u.phone)}` : ""}</div>
        </td>
        <td style="padding:10px 12px;font-size:12.5px">${u.role === "admin" ? esc(t("equipo.rolAdmin")) : esc(t("equipo.rolStaff"))}${u.puesto ? `<div style="font-size:11px;color:var(--dim)">${esc(u.puesto)}</div>` : ""}${u.horario ? `<div style="font-size:11px;color:var(--dim)">${esc(u.horario)}${u.dias ? ` · ${esc(u.dias.split(",").map((d) => DIAS_CORTOS[Number(d) - 1] ?? "").join(""))}` : ""}</div>` : ""}</td>
        <td style="padding:10px 12px;font-size:12.5px;color:var(--dim)">
          ${u.pendiente ? esc(t("equipo.pendiente")) : esc(t("equipo.activo"))}
        </td>
        <td style="padding:10px 12px;text-align:right;white-space:nowrap">
          <details style="display:inline-block;position:relative"><summary style="list-style:none;display:inline-block;border:1.5px solid var(--line);padding:5px 10px;font-size:12px;cursor:pointer">${esc(t("equipo.editar"))}</summary>
            <form method="POST" action="/admin/equipo/${esc(u.id)}/editar" style="position:absolute;right:0;z-index:20;margin-top:6px;width:300px;background:var(--panel);border:1px solid var(--linelit);box-shadow:6px 6px 0 rgba(0,0,0,.35);padding:14px;text-align:left">
              <label style="display:block;margin-bottom:10px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--dim);margin-bottom:4px">${esc(t("equipo.colRol"))}</div>
                <select name="role" style="${INP}"><option value="admin" ${u.role === "admin" ? "selected" : ""}>${esc(t("equipo.rolAdmin"))}</option><option value="staff" ${u.role === "staff" ? "selected" : ""}>${esc(t("equipo.rolStaff"))}</option></select></label>
              ${camposHorario(t, u, INP)}
              <button type="submit" style="width:100%;padding:9px;font-weight:800;background:var(--accent);color:#20140a;border:none;cursor:pointer">${esc(t("perfil.guardar"))}</button>
            </form></details>
          <form method="POST" action="/admin/equipo/${esc(u.id)}/reset" style="display:inline">
            <button type="submit" style="background:none;border:1.5px solid var(--line);padding:5px 10px;font-size:12px;cursor:pointer">${esc(t("equipo.reinvitar"))}</button>
          </form>
          <form method="POST" action="/admin/equipo/${esc(u.id)}/borrar" style="display:inline" onsubmit="return confirm('${esc(t("equipo.confirmarBorrar"))}')">
            <button type="submit" style="background:none;border:1.5px solid #d99a83;color:#a4442a;padding:5px 10px;font-size:12px;cursor:pointer">${esc(t("equipo.quitar"))}</button>
          </form>
        </td>
      </tr>`)
    .join("");

  const body = `
    <p style="max-width:640px;color:var(--dim);font-size:13.5px;line-height:1.6;margin-bottom:12px">${esc(t("equipo.intro"))} <a href="/admin/equipo/bitacora" style="color:var(--accent)">${esc(t("equipo.bitacora"))} →</a></p>
    <div style="max-width:640px;margin-bottom:18px;display:flex;align-items:center;gap:10px">
      <span style="font-size:12.5px;color:var(--dim);white-space:nowrap">${esc(t("equipo.puertaEquipo"))}</span>
      <input readonly value="${esc(opts.origin.replace(/^https?:\/\//, ""))}/equipo" onclick="this.select()" style="${INP};font-size:12.5px;flex:1;width:auto">
    </div>
    ${opts.error ? `<div style="background:#fbe9e4;border:1.5px solid #d99a83;padding:10px 14px;font-size:13px;margin-bottom:14px">${esc(opts.error)}</div>` : ""}
    ${opts.inviteUrl ? `
    <div style="background:var(--accent-soft);border:1.5px solid var(--accent);padding:14px 16px;margin-bottom:18px">
      <div style="font-weight:800;font-size:13px;margin-bottom:6px">${esc(t("equipo.inviteListo"))}</div>
      <input readonly value="${esc(opts.inviteUrl)}" onclick="this.select()" style="${INP};font-size:12.5px">
      <div style="font-size:12px;color:var(--dim);margin-top:6px">${esc(t("equipo.inviteNota"))}${opts.correoEnviado ? ` ${esc(t("equipo.inviteCorreoOk"))}` : ""}</div>
    </div>` : ""}
    <div style="border:1.5px solid var(--line);background:var(--panel)">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px">
        <thead><tr style="text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)">
          <th style="padding:10px 12px">${esc(t("equipo.colPersona"))}</th>
          <th style="padding:10px 12px">${esc(t("equipo.colRol"))}</th>
          <th style="padding:10px 12px">${esc(t("equipo.colEstado"))}</th><th></th>
        </tr></thead>
        <tbody>${filas || `<tr><td colspan="4" style="padding:18px 12px;color:var(--dim)">${esc(t("equipo.vacio"))}</td></tr>`}</tbody>
      </table>
    </div>
    <div style="margin-top:22px;border:1.5px solid var(--line);background:var(--panel);padding:18px;max-width:520px">
      <div style="font-weight:800;margin-bottom:10px">${esc(t("equipo.nuevoTitulo"))}</div>
      <form method="POST" action="/admin/equipo" style="display:flex;flex-direction:column;gap:10px">
        <input name="name" placeholder="${esc(t("equipo.nombrePh"))}" style="${INP}">
        <input name="email" type="email" required placeholder="jefe@negocio.com" style="${INP}">
        <select name="role" style="${INP}">
          <option value="admin">${esc(t("equipo.rolAdmin"))}</option>
          <option value="staff" selected>${esc(t("equipo.rolStaff"))}</option>
        </select>
        <button type="submit" style="padding:10px;font-weight:800;background:var(--accent);color:#20140a;border:none;cursor:pointer">${esc(t("equipo.crearInvitacion"))}</button>
      </form>
    </div>
    ${visibilidad}`;

  return layout({ title: t("nav.equipo"), activeTab: "equipo", body, env });
}
