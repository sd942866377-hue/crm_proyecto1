/**
 * Admin dashboard routes (Hono sub-app mounted at `/admin`).
 *
 * Auth is HTTP Basic Auth (owner override of the original magic-link plan):
 * every route is guarded by `adminAuth(env)`, which prompts the browser's
 * native Basic Auth dialog. Username is always "admin", password lives in the
 * `DASHBOARD_PASSWORD` secret. There are NO /login or /logout routes — Basic
 * Auth does not need them.
 *
 * Because the Basic Auth middleware needs the per-request `Env` (to read
 * `DASHBOARD_PASSWORD` from the binding), it is applied inside a wildcard
 * middleware that has access to `c.env` rather than at module-init time.
 */
import { parsePeerBots } from "./projects";
import { applyPanelLanguage, bustIdiomaCache, esCodigoValido } from "../idioma";
import { esLocalePanel, traductor } from "./i18n";
import { Hono } from "hono";
import { generateText } from "ai";
import { createModel } from "../llm/provider";
import { loadLlmOverrides } from "../settings-loader";
import { businessContextOk } from "../settings-mutations";
import { suggestReply } from "../copilot";
import type { Env } from "../env";
import { adminAuth, checkBasicCredentials } from "./auth";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { layout, renderUpgrade } from "./views/layout";
import { isPro, hiddenTabs } from "../config";
import { renderOverview } from "./views/overview";
import { renderStats } from "./views/stats";
import { renderCosts } from "./views/costs";
import {
  renderConvPane,
  renderInbox,
  renderInboxList,
  renderThreadLive,
  renderSuggestionBox,
} from "./views/conversations";
import { pickAdapter } from "../replies/sender";
import { channelLabel } from "../channels/labels";
import type { ChannelId } from "../channels/shared";
import { renderInsights } from "./views/insights";
import { analyzeConversations } from "../insights/analyzer";
import { renderAgentePage, renderAgenteCanvas, renderNodeModal, toggleTool, toastOob, currentGlobalSystemPrompt } from "./views/agente";
import { renderKbList, renderKbEditor } from "./views/kb";
import { KbDocsRepo, indexDoc, removeDocVectors, reindexAll, MAX_DOC_CHARS } from "../kb/docs";
import { renderMejoras } from "./views/mejoras";
import { runFlywheel, getLessons, saveLessons } from "../flywheel/detect";
import { applySuggestion, dismissSuggestion } from "../flywheel/apply";
import { renderLeads, exportLeadsCsv } from "./views/leads";
import { renderTickets } from "./views/tickets";
import { renderCobros } from "./views/cobros";
import { renderConfig } from "./views/config";
import { renderConexiones } from "./views/conexiones";
import { renderCampanas } from "./views/campanas";
import { renderPlantillas } from "./views/plantillas";
import { renderReviews } from "./views/reviews";
import { renderBoveda } from "./views/boveda";
import { sendCampaign, createHandoffTemplate, contentApprovalStatus } from "../campaigns";
import { Db } from "../db/client";
import { LeadsRepo, LEAD_STATUSES, type Lead } from "../db/leads";
import { TicketsRepo } from "../db/tickets";
import { ConversationsRepo } from "../db/conversations";
import { MessagesRepo } from "../db/messages";
import { SettingsRepo, SETTING_KEYS, type SettingKey, resolveTakeoverMs, MANUAL_RESUME_MS } from "../db/settings";
import { CONTROLS, levelToValue } from "./control-levels";

export const adminApp = new Hono<{ Bindings: Env }>();

// Guard every admin route with Basic Auth. The middleware factory needs the
// request-scoped Env to read DASHBOARD_PASSWORD, so build it per request here.
// DASHBOARD_PUBLIC="1" (wrangler.toml de esta instancia) apaga el guard —
// decisión explícita de Santi (2026-07-11): su panel es público a propósito.
// Para volver a protegerlo: quitar esa var y redeploy.
// Auth del panel: cookie de sesión (usuarios del Equipo) O la contraseña
// maestra por Basic (agencia/scripts — SIEMPRE válida, es el rescate). Un bot
// SIN usuarios de panel se comporta EXACTO como siempre: Basic Auth pelón.
const AUTH_LIBRE = ["/login", "/logout", "/invitacion", "/recuperar", "/restablecer", "/entrar"];

// Los forms mandan el horario en dos <input type="time"> (de/a); aquí se
// recompone al HH:MM-HH:MM que espera normalizaHorario. Uno solo lleno = vacío
// (el form marca ambos required en cuanto llenas uno, así que no llega a pasar).
const horarioDelBody = (body: Record<string, unknown>): string => {
  const de = String(body["horario_de"] ?? "").trim();
  const a = String(body["horario_a"] ?? "").trim();
  return de && a ? `${de}-${a}` : "";
};
adminApp.use("*", async (c, next) => {
  if (c.env.DASHBOARD_PUBLIC === "1") return next();
  const sub = c.req.path.replace(/^\/admin/, "");
  if (AUTH_LIBRE.some((p) => sub === p || sub.startsWith(p + "/"))) return next();
  const { verifySession, roleForSession, SESSION_COOKIE } = await import("./equipo");
  const cookie = getCookie(c, SESSION_COOKIE);
  const ses = await verifySession(c.env, cookie);
  const uid = ses?.uid ?? null;
  if (uid && ses) {
    const db = new Db(c.env.DB);
    // "Cerrar sesión en todos lados" / reset de contraseña suben session_version:
    // una cookie con versión vieja deja de valer aunque la firma sea correcta.
    let vigente = true;
    if (uid !== "master") {
      const { sessionVersion } = await import("./equipo");
      const v = await sessionVersion(db, uid).catch(() => null);
      vigente = v !== null && v === ses.version;
    }
    const rol = !vigente ? null : uid === "master" ? "master" : await roleForSession(db, uid).catch(() => null);
    if (rol) {
      const e = c.env as unknown as Record<string, string | undefined>;
      e.PANEL_ROLE = rol;
      e.PANEL_UID = uid;
      if (rol === "staff") {
        // Visibilidad configurada por el admin (tab Equipo) — hiddenTabs() la lee
        // de aquí, y como hiddenTabs gobierna nav Y rutas, aplica de verdad.
        const { SettingsRepo, SETTING_KEYS } = await import("../db/settings");
        e.PANEL_STAFF_TABS = (await new SettingsRepo(db).get(SETTING_KEYS.staffTabs).catch(() => null)) ?? undefined;
      }
      if (uid !== "master") {
        const { getPanelUser } = await import("./equipo");
        const u = await getPanelUser(db, uid).catch(() => null);
        if (u) { e.PANEL_NAME = u.name ?? undefined; e.PANEL_EMAIL = u.email; }
      }
      return next();
    }
  }
  if (checkBasicCredentials(c.req.header("Authorization"), c.env)) {
    (c.env as unknown as { PANEL_ROLE?: string }).PANEL_ROLE = "master";
    return next();
  }
  // Sin credenciales: los navegadores van SIEMPRE al login bonito — acepta la
  // maestra con el correo vacío o "admin" (mismas credenciales del Basic de
  // siempre), haya o no usuarios de Equipo. Scripts/curl (Accept sin text/html)
  // siguen con Basic: el header Authorization funciona igual que siempre.
  const esNavegador = (c.req.header("Accept") ?? "").includes("text/html");
  if (esNavegador && c.req.method === "GET") return c.redirect("/admin/login");
  return adminAuth(c.env)(c, next);
});

// Gate de tier: el panel free ve el nav Pro bloqueado; si aun así navega a una
// ruta Pro (URL directa, bookmark, click al item bloqueado), servimos la página
// de upgrade en vez de la vista real. Los datos Pro nunca se exponen en free.
const PRO_GATE: Array<[string, string]> = [
  ["/admin/cobros", "Cobros"],
  ["/admin/insights", "Insights"],
  ["/admin/stats", "Estadísticas"],
  ["/admin/costs", "Costos"],
  ["/admin/mejoras", "Mejoras"],
  ["/admin/campanas", "Campañas"],
  ["/admin/plantillas", "Plantillas"],
  ["/admin/reviews", "Reseñas"],
  ["/admin/boveda", "Bóveda"],
  ["/admin/report", "Reportes"],
];
// El idioma del panel se resuelve UNA vez por petición y queda en env; las
// vistas lo leen con traductor(env) sin volver a pegarle a D1.
adminApp.use("*", async (c, next) => {
  await applyPanelLanguage(c.env);
  return next();
});

adminApp.use("*", async (c, next) => {
  if (isPro(c.env)) return next();
  const path = c.req.path;
  const hit = PRO_GATE.find(([pre]) => path === pre || path.startsWith(pre + "/"));
  if (hit) return c.html(renderUpgrade(c.env, hit[1]));
  return next();
});

// Tabs ocultas por la agencia (HIDDEN_TABS en wrangler.toml, Modo Agencia):
// además de desaparecer del sidebar, la URL directa (bookmark, historial)
// tampoco entra — redirige a Resumen. Cubre la vista y sus subrutas (POSTs).
// "overview" nunca es ocultable (ver hiddenTabs en config.ts).
adminApp.use("*", async (c, next) => {
  const hidden = hiddenTabs(c.env);
  if (hidden.length === 0) return next();
  const path = c.req.path;
  const hit = hidden.find((id) => path === `/admin/${id}` || path.startsWith(`/admin/${id}/`));
  if (hit) return c.redirect("/admin/overview");
  return next();
});

// ── Equipo del panel: login / logout / invitación / gestión ──────────────────
const COOKIE_OPTS = { path: "/admin", httpOnly: true, secure: true, sameSite: "Lax" as const, maxAge: 14 * 24 * 3600 };

async function copyLogin(env: Env) {
  const { loginCopy } = await import("./views/equipo");
  const settings = await new SettingsRepo(new Db(env.DB)).all().catch(() => ({} as Record<string, string>));
  return loginCopy(env, settings);
}

// Botón "Entrar con Forja Cloud" del login: manda al administrador a
// autenticarse en app.forjabots.com (estilo `gh auth login`) y regresar ya
// adentro vía el salto SSO (disponible para todos los planes — entrar a tu
// propio bot es autenticación, no feature). Se esconde en bots white-label
// (BRAND_HIDE_FORJA): el cliente de la agencia nunca ve Forja.
async function cloudLoginUrl(c: { env: Env; req: { url: string } }): Promise<string | undefined> {
  const { resolveBranding } = await import("./branding");
  if (resolveBranding(c.env).hideForja) return undefined;
  const host = new URL(c.req.url).host;
  return `https://app.forjabots.com/api/bots/abrir-por-host?host=${encodeURIComponent(host)}`;
}

adminApp.get("/login", async (c) => {
  const { renderLogin } = await import("./views/equipo");
  return c.html(renderLogin(c.env, { copy: await copyLogin(c.env), cloudUrl: await cloudLoginUrl(c), variant: "admin" }));
});

adminApp.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const eq = await import("./equipo");
  const { renderLogin } = await import("./views/equipo");
  const { traductor } = await import("./i18n");
  const db = new Db(c.env.DB);
  const t = traductor(c.env);
  let uid: string | "bloqueado" | null = null;
  // "admin" era el usuario fijo del Basic Auth de siempre: quien lo teclee por
  // costumbre en el campo de correo entra con la contraseña maestra, igual que
  // si lo dejara vacío.
  if (!email || email.toLowerCase() === "admin") {
    uid = eq.loginMaster(c.env, password) ? "master" : null;
  } else {
    uid = await eq.loginPanelUser(db, email, password).catch(() => null);
  }
  // El error regresa a la MISMA puerta de la que vino el intento (hidden from=equipo).
  const variant = body.from === "equipo" ? ("equipo" as const) : ("admin" as const);
  if (uid === "bloqueado") return c.html(renderLogin(c.env, { error: t("equipo.errorBloqueado"), copy: await copyLogin(c.env), cloudUrl: await cloudLoginUrl(c), variant }), 429);
  if (!uid) return c.html(renderLogin(c.env, { error: t("equipo.errorLogin"), copy: await copyLogin(c.env), cloudUrl: await cloudLoginUrl(c), variant }), 401);
  const version = uid === "master" ? 1 : (await eq.sessionVersion(db, uid)) ?? 1;
  setCookie(c, eq.SESSION_COOKIE, await eq.mintSession(c.env, uid, Date.now(), version), COOKIE_OPTS);
  await eq.audit(db, { id: uid === "master" ? null : uid, label: uid === "master" ? "acceso maestro" : email }, "login");
  return c.redirect("/admin/overview");
});

adminApp.get("/logout", async (c) => {
  const { SESSION_COOKIE } = await import("./equipo");
  deleteCookie(c, SESSION_COOKIE, { path: "/admin" });
  return c.redirect("/admin/login");
});

// SSO de un solo uso desde la app móvil / panel de agencia: POST /api/admin-link
// genera el token (guarded por el Bearer del control plane) y este canje lo
// convierte en la sesión maestra. Single-use + TTL ~2 min (magic_links.consume).
adminApp.get("/entrar/:token", async (c) => {
  const { MagicLinksRepo, SSO_MASTER_EMAIL } = await import("../db/magicLinks");
  const db = new Db(c.env.DB);
  const link = await new MagicLinksRepo(db).consume(c.req.param("token"));
  if (!link || link.email !== SSO_MASTER_EMAIL) return c.redirect("/admin/login");
  const eq = await import("./equipo");
  // TTL corto (no los 14 días normales): una sesión "master" nacida de SSO no
  // es revocable por session_version (uid "master" no es una fila real de
  // panel_users — el middleware la salta), así que el vencimiento es el único
  // freno si el cookie se filtra.
  setCookie(
    c,
    eq.SESSION_COOKIE,
    await eq.mintSession(c.env, "master", Date.now(), 1, eq.MASTER_SSO_SESSION_TTL_MS),
    COOKIE_OPTS,
  );
  await eq.audit(db, { id: null, label: "acceso app móvil" }, "login").catch(() => {});
  return c.redirect("/admin/overview");
});

// Mi perfil (cualquier rol con usuario): nombre, WhatsApp y cambio de contraseña.
adminApp.get("/perfil", async (c) => {
  const e = c.env as unknown as { PANEL_UID?: string };
  if (!e.PANEL_UID || e.PANEL_UID === "master") return c.redirect("/admin/overview");
  const { getPanelUser } = await import("./equipo");
  const { renderPerfil } = await import("./views/equipo");
  const u = await getPanelUser(new Db(c.env.DB), e.PANEL_UID);
  if (!u) return c.redirect("/admin/logout");
  return c.html(renderPerfil(c.env, u, {}));
});

adminApp.post("/perfil", async (c) => {
  const e = c.env as unknown as { PANEL_UID?: string };
  if (!e.PANEL_UID || e.PANEL_UID === "master") return c.redirect("/admin/overview");
  const body = await c.req.parseBody();
  const eq = await import("./equipo");
  const { renderPerfil } = await import("./views/equipo");
  const { traductor } = await import("./i18n");
  const db = new Db(c.env.DB);
  const t = traductor(c.env);
  const p1 = String(body.password ?? "");
  const p2 = String(body.password2 ?? "");
  if (p1 && p1 !== p2) {
    const u = await eq.getPanelUser(db, e.PANEL_UID);
    return c.html(renderPerfil(c.env, u!, { error: t("equipo.errorPasswords") }), 400);
  }
  const bodyAll = await c.req.parseBody({ all: true }).catch(() => body);
  const diasRaw = (bodyAll as any)["dias"];
  const r = await eq.updateProfile(db, e.PANEL_UID, {
    name: String(body.name ?? ""), phone: String(body.phone ?? ""), password: p1 || undefined,
    puesto: String(body.puesto ?? ""), horario: horarioDelBody(body),
    dias: Array.isArray(diasRaw) ? diasRaw.map(String).join(",") : String(diasRaw ?? ""),
    avisos: {
      canal: body.aviso_canal === "whatsapp" ? "whatsapp" : body.aviso_canal === "ninguno" ? "ninguno" : "email",
      escalamientos: body.av_escalamientos === "1", tickets: body.av_tickets === "1",
      resenas: body.av_resenas === "1", reporte: body.av_reporte === "1",
    },
  });
  if (r.ok) await eq.audit(db, { id: e.PANEL_UID, label: (c.env as any).PANEL_EMAIL ?? e.PANEL_UID }, "perfil_editado", p1 ? "con cambio de contraseña" : undefined);
  const u = await eq.getPanelUser(db, e.PANEL_UID);
  if (!r.ok) return c.html(renderPerfil(c.env, u!, { error: r.error }), 400);
  return c.html(renderPerfil(c.env, u!, { ok: true }));
});

// Visibilidad del rol Equipo (solo admin/master llegan aquí — "equipo" es tab
// bloqueada para staff). Guarda el JSON de tabs visibles en settings.
adminApp.post("/equipo/visibilidad", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const { HIDEABLE_TABS, STAFF_LOCKED_TABS } = await import("../config");
  const { SettingsRepo, SETTING_KEYS } = await import("../db/settings");
  const raw = body["tabs"];
  const pedidas = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => String(x).toLowerCase());
  const permitidas = (HIDEABLE_TABS as readonly string[]).filter(
    (id) => !(STAFF_LOCKED_TABS as readonly string[]).includes(id),
  );
  const visibles = pedidas.filter((id) => permitidas.includes(id));
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.staffTabs, JSON.stringify(visibles));
  { const eq = await import("./equipo"); await eq.audit(new Db(c.env.DB), actorDe(c.env), "visibilidad_equipo", visibles.join(",")); }
  return c.redirect("/admin/equipo?guardado=1");
});

adminApp.get("/invitacion/:token", async (c) => {
  const { renderInvitacion } = await import("./views/equipo");
  const { inviteInfo } = await import("./equipo");
  const { traductor } = await import("./i18n");
  const token = c.req.param("token");
  const info = await inviteInfo(new Db(c.env.DB), token).catch(() => null);
  if (!info) return c.html(renderInvitacion(c.env, token, { error: traductor(c.env)("equipo.errorInvite") }), 410);
  return c.html(renderInvitacion(c.env, token, info));
});

adminApp.post("/invitacion/:token", async (c) => {
  const token = c.req.param("token");
  const body = await c.req.parseBody();
  const p1 = String(body.password ?? "");
  const p2 = String(body.password2 ?? "");
  const eq = await import("./equipo");
  const { renderInvitacion } = await import("./views/equipo");
  const { traductor } = await import("./i18n");
  if (p1 !== p2) return c.html(renderInvitacion(c.env, token, { error: traductor(c.env)("equipo.errorPasswords") }), 400);
  const db = new Db(c.env.DB);
  const diasRaw = body["dias"];
  const r = await eq.acceptInvite(db, token, p1, {
    name: String(body.name ?? ""),
    phone: String(body.phone ?? ""),
    puesto: String(body.puesto ?? ""),
    horario: horarioDelBody(body),
    dias: Array.isArray(diasRaw) ? diasRaw.map(String) : diasRaw ? [String(diasRaw)] : [],
    avisoCanal: String(body.aviso_canal ?? ""),
  });
  if (!r.ok) return c.html(renderInvitacion(c.env, token, { error: r.error }), 400);
  const u = await eq.getPanelUser(db, r.userId);
  setCookie(c, eq.SESSION_COOKIE, await eq.mintSession(c.env, r.userId, Date.now(), (await eq.sessionVersion(db, r.userId)) ?? 1), COOKIE_OPTS);
  await eq.audit(db, { id: r.userId, label: u?.email ?? r.userId }, "invitacion_aceptada", u?.name ?? undefined);
  // Cierra el ciclo para quien invitó: ticket "ya entró" (sin depender de correo).
  try {
    const { createHandoffTicket } = await import("../tools/handoffHuman");
    await createHandoffTicket(c.env, {
      conversationId: null,
      reason: "equipo",
      summary: `${u?.name || u?.email} ya activó su acceso al panel (rol ${u?.role === "admin" ? "Administrador" : "Equipo"}).`,
      category: "other",
    });
  } catch (e) { console.warn("[equipo] aviso de invitación aceptada falló:", e); }
  return c.redirect("/admin/overview");
});

// Gestión (solo admin/master llegan: "equipo" está en STAFF_HIDDEN_TABS y el
// guard de hidden tabs redirige a staff antes de llegar aquí).
/** Quién está actuando (para la bitácora), a partir del env request-scoped. */
function actorDe(env: Env): { id: string | null; label: string } {
  const e = env as unknown as { PANEL_UID?: string; PANEL_EMAIL?: string; PANEL_NAME?: string; PANEL_ROLE?: string };
  if (!e.PANEL_UID || e.PANEL_UID === "master") return { id: null, label: e.PANEL_ROLE === "master" ? "acceso maestro" : "contraseña maestra" };
  return { id: e.PANEL_UID, label: e.PANEL_NAME ? `${e.PANEL_NAME} (${e.PANEL_EMAIL})` : (e.PANEL_EMAIL ?? e.PANEL_UID) };
}

/** Manda la invitación por correo si hay proveedor. true = salió. */
async function mandarInvitacionPorCorreo(env: Env, email: string, url: string): Promise<boolean> {
  const { mailerProvider, sendMail, plantillaCorreo } = await import("../mailer");
  if (!mailerProvider(env)) return false;
  const m = await sendMail(env, {
    to: email,
    subject: `Tu acceso al panel de ${env.BUSINESS_NAME}`,
    html: plantillaCorreo(env, {
      titulo: `Te invitaron al panel de ${env.BUSINESS_NAME}`,
      cuerpo: "Con este link creas tu contraseña y entras. Vale 7 días y se usa una sola vez.",
      cta: { url, label: "Crear mi acceso" },
      pie: "Si no esperabas esta invitación, puedes ignorar este correo.",
    }),
  });
  if (!m.ok) console.warn(`[equipo] invitación por correo no salió (${m.reason})`);
  return m.ok;
}

async function staffVisibles(env: Env): Promise<string[]> {
  const { HIDEABLE_TABS, STAFF_HIDDEN_TABS, STAFF_LOCKED_TABS } = await import("../config");
  const { SettingsRepo, SETTING_KEYS } = await import("../db/settings");
  const raw = await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.staffTabs).catch(() => null);
  let visibles: string[] | null = null;
  if (raw) { try { const a = JSON.parse(raw); if (Array.isArray(a)) visibles = a.map(String); } catch { /* default */ } }
  if (visibles === null) {
    visibles = (HIDEABLE_TABS as readonly string[]).filter((id) => !(STAFF_HIDDEN_TABS as readonly string[]).includes(id));
  }
  return visibles.filter((id) => !(STAFF_LOCKED_TABS as readonly string[]).includes(id));
}

adminApp.get("/equipo", async (c) => {
  const eq = await import("./equipo");
  const { renderEquipo } = await import("./views/equipo");
  const usuarios = await eq.listPanelUsers(new Db(c.env.DB));
  return c.html(renderEquipo(c.env, usuarios, {
    origin: new URL(c.req.url).origin,
    staffVisibles: await staffVisibles(c.env),
    guardado: new URL(c.req.url).searchParams.get("guardado") === "1",
  }));
});

adminApp.post("/equipo", async (c) => {
  const body = await c.req.parseBody();
  const eq = await import("./equipo");
  const { renderEquipo } = await import("./views/equipo");
  const db = new Db(c.env.DB);
  const r = await eq.createPanelUser(db, {
    email: String(body.email ?? ""),
    name: String(body.name ?? "") || undefined,
    role: body.role === "admin" ? "admin" : "staff",
  });
  const origin = new URL(c.req.url).origin;
  const usuarios = await eq.listPanelUsers(db);
  const sv = await staffVisibles(c.env);
  if (!r.ok) return c.html(renderEquipo(c.env, usuarios, { origin, error: r.error, staffVisibles: sv }), 400);
  const inviteUrl = `${origin}/admin/invitacion/${r.inviteToken}`;
  await eq.audit(db, actorDe(c.env), "invitacion_creada", `${String(body.email)} · rol ${body.role === "admin" ? "admin" : "staff"}`);
  // Correo opcional: si hay proveedor, se manda; el link se muestra SIEMPRE
  // (por si el correo no llega o el admin prefiere pasarlo por WhatsApp).
  const correo = await mandarInvitacionPorCorreo(c.env, String(body.email), inviteUrl);
  return c.html(renderEquipo(c.env, usuarios, { origin, inviteUrl, staffVisibles: sv, correoEnviado: correo }));
});

adminApp.post("/equipo/:id/reset", async (c) => {
  const eq = await import("./equipo");
  const { renderEquipo } = await import("./views/equipo");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const token = await eq.resetInvite(db, id);
  const u = await eq.getPanelUser(db, id);
  const origin = new URL(c.req.url).origin;
  const usuarios = await eq.listPanelUsers(db);
  await eq.audit(db, actorDe(c.env), "reinvitacion", u?.email);
  const inviteUrl = token ? `${origin}/admin/invitacion/${token}` : undefined;
  const correo = inviteUrl && u ? await mandarInvitacionPorCorreo(c.env, u.email, inviteUrl) : false;
  return c.html(renderEquipo(c.env, usuarios, {
    origin,
    staffVisibles: await staffVisibles(c.env),
    ...(inviteUrl ? { inviteUrl, correoEnviado: correo } : {}),
  }));
});

adminApp.post("/equipo/:id/borrar", async (c) => {
  const eq = await import("./equipo");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const u = await eq.getPanelUser(db, id);
  await eq.deletePanelUser(db, id);
  await eq.audit(db, actorDe(c.env), "usuario_quitado", u?.email);
  return c.redirect("/admin/equipo");
});

// El admin edita el rol / horario / puesto de alguien de su equipo.
adminApp.post("/equipo/:id/editar", async (c) => {
  const eq = await import("./equipo");
  const db = new Db(c.env.DB);
  const id = c.req.param("id");
  const body = await c.req.parseBody({ all: true });
  const diasRaw = body["dias"];
  await eq.updateProfile(db, id, {
    puesto: String(body.puesto ?? ""),
    horario: horarioDelBody(body),
    dias: Array.isArray(diasRaw) ? diasRaw.map(String).join(",") : String(diasRaw ?? ""),
  });
  const rol = body.role === "admin" ? "admin" : "staff";
  await db.run("UPDATE panel_users SET role = ? WHERE id = ?", [rol, id]);
  const u = await eq.getPanelUser(db, id);
  await eq.audit(db, actorDe(c.env), "usuario_editado", `${u?.email} · rol ${rol}`);
  return c.redirect("/admin/equipo");
});

// Bitácora (solo admin/master — misma protección que la tab).
adminApp.get("/equipo/bitacora", async (c) => {
  const eq = await import("./equipo");
  const { renderBitacora } = await import("./views/equipo");
  return c.html(renderBitacora(c.env, await eq.listAudit(new Db(c.env.DB), 120)));
});

// ── recuperación de contraseña ──────────────────────────────────────────────
adminApp.get("/recuperar", async (c) => {
  const { renderRecuperar } = await import("./views/equipo");
  return c.html(renderRecuperar(c.env, {}));
});

adminApp.post("/recuperar", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim().toLowerCase();
  // Botón "avisarle a mi administrador": fuerza la ruta del ticket aunque el bot
  // sí mande correos (para el caso "no me llegó / cayó en spam") — el admin
  // recibe el link y se lo pasa a mano.
  const viaAdmin = body.via === "admin";
  const eq = await import("./equipo");
  const { renderRecuperar } = await import("./views/equipo");
  const { mailerProvider, sendMail, plantillaCorreo } = await import("../mailer");
  const db = new Db(c.env.DB);
  const origin = new URL(c.req.url).origin;
  // Misma respuesta exista o no el correo (no revelar cuentas).
  const r = email ? await eq.issueResetToken(db, email).catch(() => null) : null;
  if (r) {
    const url = `${origin}/admin/restablecer/${r.token}`;
    if (!viaAdmin && mailerProvider(c.env)) {
      const m = await sendMail(c.env, {
        to: email,
        subject: `Restablece tu contraseña — ${c.env.BUSINESS_NAME}`,
        html: plantillaCorreo(c.env, {
          titulo: "Restablece tu contraseña",
          cuerpo: `Recibimos una solicitud para cambiar la contraseña de tu acceso al panel de ${c.env.BUSINESS_NAME}. El link vale 1 hora.`,
          cta: { url, label: "Elegir contraseña nueva" },
          pie: "Si no fuiste tú, ignora este correo — tu contraseña no cambia.",
        }),
      });
      if (!m.ok) console.warn(`[equipo] correo de reset no salió (${m.reason}) — cae a ticket para el admin`);
      if (m.ok) await eq.audit(db, { id: r.id, label: email }, "reset_solicitado", `correo vía ${m.provider}`);
    }
    // Sin proveedor (o si falló) o botón "avisar al admin": el admin recibe el
    // link como ticket y lo pasa a mano.
    if (viaAdmin || !mailerProvider(c.env)) {
      try {
        const { createHandoffTicket } = await import("../tools/handoffHuman");
        await createHandoffTicket(c.env, {
          conversationId: null,
          reason: "equipo",
          summary: `${r.name || email} olvidó su contraseña del panel. Pásale este link (vale 1 hora): ${url}`,
          category: "other",
        });
        await eq.audit(db, { id: r.id, label: email }, "reset_solicitado",
          viaAdmin ? "botón avisar al admin → ticket" : "sin correo → ticket al admin");
      } catch (e) { console.warn("[equipo] ticket de reset falló:", e); }
    }
  }
  const { mailerProvider: mp } = await import("../mailer");
  return c.html(renderRecuperar(c.env, {
    enviado: true,
    avisado: viaAdmin,
    conCorreo: !viaAdmin && Boolean(mp(c.env)),
  }));
});

adminApp.get("/restablecer/:token", async (c) => {
  const { renderRestablecer } = await import("./views/equipo");
  return c.html(renderRestablecer(c.env, c.req.param("token"), {}));
});

adminApp.post("/restablecer/:token", async (c) => {
  const token = c.req.param("token");
  const body = await c.req.parseBody();
  const p1 = String(body.password ?? "");
  const p2 = String(body.password2 ?? "");
  const eq = await import("./equipo");
  const { renderRestablecer } = await import("./views/equipo");
  const { traductor } = await import("./i18n");
  if (p1 !== p2) return c.html(renderRestablecer(c.env, token, { error: traductor(c.env)("equipo.errorPasswords") }), 400);
  const db = new Db(c.env.DB);
  const r = await eq.resetPassword(db, token, p1);
  if (!r.ok) return c.html(renderRestablecer(c.env, token, { error: r.error }), 400);
  const u = await eq.getPanelUser(db, r.userId);
  await eq.audit(db, { id: r.userId, label: u?.email ?? r.userId }, "password_restablecida");
  setCookie(c, eq.SESSION_COOKIE, await eq.mintSession(c.env, r.userId, Date.now(), (await eq.sessionVersion(db, r.userId)) ?? 1), COOKIE_OPTS);
  return c.redirect("/admin/overview");
});

// Cerrar sesión en TODOS los dispositivos (desde Mi perfil).
adminApp.post("/perfil/cerrar-todas", async (c) => {
  const e = c.env as unknown as { PANEL_UID?: string; PANEL_EMAIL?: string };
  if (!e.PANEL_UID || e.PANEL_UID === "master") return c.redirect("/admin/overview");
  const eq = await import("./equipo");
  const db = new Db(c.env.DB);
  await eq.bumpSessionVersion(db, e.PANEL_UID);
  await eq.audit(db, { id: e.PANEL_UID, label: e.PANEL_EMAIL ?? e.PANEL_UID }, "sesiones_cerradas");
  deleteCookie(c, eq.SESSION_COOKIE, { path: "/admin" });
  return c.redirect("/admin/login");
});

// ── asignación de conversaciones a personas del equipo ──────────────────────
adminApp.post("/conversations/:id/asignar", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.parseBody();
  const uid = String(body.user_id ?? "").trim() || null;
  const db = new Db(c.env.DB);
  await db.run("ALTER TABLE conversations ADD COLUMN assigned_to TEXT").catch(() => {});
  await db.run("UPDATE conversations SET assigned_to = ? WHERE id = ?", [uid, id]);
  const eq = await import("./equipo");
  const u = uid ? await eq.getPanelUser(db, uid) : null;
  await eq.audit(db, actorDe(c.env), "conversacion_asignada", `${id} → ${u?.name || u?.email || "nadie"}`);
  if (u) {
    const { avisarAsignacion } = await import("./avisos");
    await avisarAsignacion(c.env, u, id).catch((e) => console.warn("[equipo] aviso de asignación falló:", e));
  }
  return c.html(await renderThreadLive(c.env, id));
});

// Página de upgrade (item bloqueado del nav apunta aquí).
adminApp.get("/upgrade", (c) => c.html(renderUpgrade(c.env)));

// Reporte diseñado. Por default sirve el último generado por el cron; con
// ?preview=1 arma uno fresco al vuelo (para revisarlo sin esperar a las 3am —
// gasta una llamada de IA). Ver src/owner/report/.
adminApp.get("/report", async (c) => {
  const url = new URL(c.req.url);
  if (url.searchParams.get("preview") === "1") {
    const { buildReport } = await import("../owner/report/build");
    const report = await buildReport(c.env, Date.now());
    return c.html(report.html);
  }
  const { SettingsRepo, SETTING_KEYS } = await import("../db/settings");
  const { Db } = await import("../db/client");
  const html = await new SettingsRepo(new Db(c.env.DB)).get(SETTING_KEYS.reportLastHtml);
  if (html) return c.html(html);
  return c.html(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:520px;margin:12vh auto;padding:0 20px;color:#33373d;text-align:center">
    <h1 style="font-weight:800">Aún no hay reporte</h1>
    <p style="line-height:1.6">Tu primer reporte diseñado se genera automático cada mañana (si activaste <b>Reportes</b> en tu panel).
    ¿Quieres verlo ya? <a href="?preview=1" style="color:#0f766e;font-weight:600">Genera una vista previa →</a></p></body>`,
  );
});

// Root → default tab.
adminApp.get("/", (c) => c.redirect("/admin/overview"));

// Selector de proyectos (header): instancia actual + hermanas de PEER_BOTS.
adminApp.get("/projects", (c) =>
  c.json({ current: c.env.BOT_NAME ?? "Mi bot", peers: parsePeerBots(c.env) }),
);

// --- Read-only tabs ---------------------------------------------------------

adminApp.get("/overview", async (c) => c.html(await renderOverview(c.env)));

adminApp.get("/stats", async (c) => c.html(await renderStats(c.env)));

adminApp.get("/costs", async (c) => c.html(await renderCosts(c.env, c.req.query("saved") === "1")));

// Monthly AI budget (Costos tab). Empty value clears the cap.
adminApp.post("/costs/budget", async (c) => {
  const form = await c.req.formData();
  const raw = String(form.get("monthly_budget") ?? "").trim();
  const n = Number.parseFloat(raw);
  const value = raw !== "" && Number.isFinite(n) && n > 0 ? String(n) : "";
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.monthlyBudget, value);
  return c.redirect("/admin/costs?saved=1");
});

// --- Conocimiento (KB editable, F4) -------------------------------------------

adminApp.get("/kb", async (c) =>
  c.html(
    await renderKbList(c.env, {
      saved: c.req.query("saved") === "1",
      deleted: c.req.query("deleted") === "1",
      reindexed: c.req.query("reindexed") ?? undefined,
    }),
  ),
);

adminApp.get("/kb/new", (c) => c.html(renderKbEditor(null, c.env)));

adminApp.get("/kb/:id/edit", async (c) => {
  const doc = await new KbDocsRepo(new Db(c.env.DB)).getById(c.req.param("id"));
  if (!doc) return c.redirect("/admin/kb");
  return c.html(renderKbEditor(doc, c.env));
});

// Save = persist in D1 + index into Vectorize immediately (stale vectors for
// the doc are blanket-deleted first), so searchKb uses it on the next message.
adminApp.post("/kb/save", async (c) => {
  const form = await c.req.formData();
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  { const eq = await import("./equipo"); await eq.audit(new Db(c.env.DB), actorDe(c.env), "kb_editada", title); }
  const content = String(form.get("content") ?? "").trim().slice(0, MAX_DOC_CHARS);
  if (!title || !content) return c.redirect("/admin/kb");

  const id = String(form.get("id") ?? "").trim() || crypto.randomUUID();
  const repo = new KbDocsRepo(new Db(c.env.DB));
  await repo.upsert({ id, title, content });
  const doc = (await repo.getById(id))!;
  await indexDoc(c.env, doc);
  return c.redirect("/admin/kb?saved=1");
});

adminApp.post("/kb/:id/delete", async (c) => {
  const id = c.req.param("id");
  await new KbDocsRepo(new Db(c.env.DB)).delete(id);
  await removeDocVectors(c.env, id);
  return c.redirect("/admin/kb?deleted=1");
});

// Global reindex: repo fixtures + every dashboard doc.
adminApp.post("/kb/reindex", async (c) => {
  const r = await reindexAll(c.env);
  return c.redirect(`/admin/kb?reindexed=${r.indexed}`);
});

// --- Handoff: plantilla HSM del aviso al dueño ---------------------------------

// Setup one-shot: crea la plantilla en la Content API de Twilio, la somete a
// aprobación de WhatsApp (UTILITY) y guarda el ContentSid en settings —
// notifyOwner la usa como fallback del secret, sin pasos manuales.
adminApp.post("/handoff/template/setup", async (c) => {
  const r = await createHandoffTemplate(c.env);
  if ("error" in r) return c.json(r, 502);
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.twilioHandoffContentSid, r.sid);
  return c.json(r);
});

// Estado de aprobación de la plantilla del handoff (approved | pending | …).
adminApp.get("/handoff/template/status", async (c) => {
  const sid =
    c.env.TWILIO_HANDOFF_CONTENT_SID ||
    (await new SettingsRepo(new Db(c.env.DB)).get(SETTING_KEYS.twilioHandoffContentSid));
  if (!sid) return c.json({ error: "sin plantilla — corre el setup primero" }, 404);
  const r = await contentApprovalStatus(c.env, sid);
  return c.json({ sid, ...r });
});

// --- Mejoras (flywheel, F5) ----------------------------------------------------

adminApp.get("/mejoras", async (c) =>
  c.html(
    await renderMejoras(c.env, {
      found: c.req.query("found") ?? undefined,
      applied: c.req.query("applied") === "1",
      dismissed: c.req.query("dismissed") === "1",
    }),
  ),
);

// Run the detectors on demand (they also run nightly from scheduled()).
adminApp.post("/mejoras/run", async (c) => {
  const r = await runFlywheel(c.env);
  return c.redirect(`/admin/mejoras?found=${r.created}`);
});

adminApp.post("/mejoras/:id/apply", async (c) => {
  const ok = await applySuggestion(c.env, c.req.param("id"));
  return c.redirect(ok ? "/admin/mejoras?applied=1" : "/admin/mejoras");
});

adminApp.post("/mejoras/:id/dismiss", async (c) => {
  const ok = await dismissSuggestion(c.env, c.req.param("id"));
  return c.redirect(ok ? "/admin/mejoras?dismissed=1" : "/admin/mejoras");
});

// Autonomía del flywheel: manual (default) o copiloto (auto-aplica lo seguro
// en el cron nocturno — KB sin huecos y lecciones; lo delicado sigue en cola).
adminApp.post("/mejoras/autonomy", async (c) => {
  const form = await c.req.formData();
  const level = String(form.get("level") ?? "manual") === "copilot" ? "copilot" : "manual";
  await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.autonomyLevel, level);
  return c.redirect("/admin/mejoras");
});

// MODO BOOST: switch on/off desde el overview. Flip del setting y de vuelta.
adminApp.post("/boost", async (c) => {
  const repo = new SettingsRepo(new Db(c.env.DB));
  const cur = await repo.get(SETTING_KEYS.boostMode);
  await repo.set(SETTING_KEYS.boostMode, cur === "on" ? "off" : "on");
  return c.redirect("/admin");
});

// Remove one lesson from the prompt (the ✕ next to each active lesson).
adminApp.post("/mejoras/lessons/remove", async (c) => {
  const form = await c.req.formData();
  const lesson = String(form.get("lesson") ?? "");
  const lessons = (await getLessons(c.env)).filter((l) => l !== lesson);
  await saveLessons(c.env, lessons);
  return c.redirect("/admin/mejoras");
});

// Inbox (F1): two-pane view. ?c=<id> selects the thread; ?f/?q filter the list.
adminApp.get("/conversations", async (c) =>
  c.html(
    await renderInbox(c.env, {
      search: c.req.query("q"),
      filter: c.req.query("f"),
      selectedId: c.req.query("c"),
    }),
  ),
);

// HTMX fragments (polled): left list every 10s, thread every 5s. Registered
// before /conversations/:id so the static segments win the match.
adminApp.get("/conversations/list-fragment", async (c) =>
  c.html(
    await renderInboxList(c.env, {
      search: c.req.query("q"),
      filter: c.req.query("f"),
      selectedId: c.req.query("c"),
    }),
  ),
);

adminApp.get("/conversations/thread/:id", async (c) =>
  c.html(await renderThreadLive(c.env, c.req.param("id"))),
);

// Pane completo (poller del hilo + composer) — lo pide el CLICK en una fila de
// la lista: cambia solo el lado derecho, sin recargar la página (2026-08-29).
adminApp.get("/conversations/pane/:id", async (c) =>
  c.html(await renderConvPane(c.env, c.req.param("id"))),
);

// Old detail URLs (linked from Insights, notifications, etc.) → inbox selection.
adminApp.get("/conversations/:id", (c) =>
  c.redirect(`/admin/conversations?c=${encodeURIComponent(c.req.param("id"))}`),
);

// Insights tab. Visiting it opportunistically grades a few pending
// conversations in the background (waitUntil) so the tab catches up on its own
// even without pressing "Analizar ahora". TODO: move the main run to
// scheduled() in index.ts once the channels/meta work in flight there lands.
adminApp.get("/insights", async (c) => {
  try {
    c.executionCtx.waitUntil(
      analyzeConversations(c.env, { limit: 3 }).catch((e) =>
        console.error("[insights] background analysis failed:", e),
      ),
    );
  } catch {
    // no executionCtx (tests) — render without background catch-up
  }
  return c.html(await renderInsights(c.env, c.req.query("analyzed") ?? undefined));
});

// "Analizar ahora": grade up to 10 pending conversations inline, then redirect
// back with the count for the confirmation banner.
adminApp.post("/insights/analyze", async (c) => {
  const result = await analyzeConversations(c.env, { limit: 10 });
  return c.redirect(`/admin/insights?analyzed=${result.analyzed}`);
});

// "Mi Agente": n8n-style canvas of how the bot works. The canvas fragment is
// polled by HTMX every 15s (live activity pulse); node panels load on click.
// ?channel=<id> redraws the WHOLE radiography for that channel (its prompt
// override + its disabled-tools union). Empty/absent = General (global). The
// value is validated downstream against configuredChannels.
adminApp.get("/agente", async (c) =>
  c.html(await renderAgentePage(c.env, c.req.query("channel") || undefined)),
);

adminApp.get("/agente/canvas", async (c) =>
  c.html(await renderAgenteCanvas(c.env, c.req.query("channel") || undefined)),
);

adminApp.get("/agente/node/:id", async (c) =>
  c.html(await renderNodeModal(c.env, c.req.param("id"), false, c.req.query("channel") || undefined)),
);

// Save a node's config from its modal. Writes the relevant settings (with
// clamps), re-renders the modal with a saved banner + toast, and fires the
// `canvas-refresh` event so the diagram updates immediately.
adminApp.post("/agente/node/:id/save", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData();
  const repo = new SettingsRepo(new Db(c.env.DB));

  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  const num = (key: string): number | null => {
    const raw = form.get(key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  if (id === "buffer") {
    const s = num("buffer_seconds");
    if (s !== null) await repo.set(SETTING_KEYS.bufferSeconds, String(Math.round(clamp(s, 1, 60))));
  } else if (id === "reply") {
    const chunks = num("max_chunks");
    if (chunks !== null) await repo.set(SETTING_KEYS.maxChunks, String(Math.round(clamp(chunks, 1, 5))));
    const delayS = num("inter_chunk_delay_s");
    if (delayS !== null)
      await repo.set(SETTING_KEYS.interChunkDelayMs, String(Math.round(clamp(delayS, 0, 5) * 1000)));
  } else if (id === "model") {
    const m = String(form.get("model_override") ?? "");
    if (m === "auto" || m === "haiku" || m === "sonnet") await repo.set(SETTING_KEYS.modelOverride, m);
    const t = num("temperature");
    if (t !== null) await repo.set(SETTING_KEYS.temperature, String(clamp(t, 0, 1)));
  } else if (id === "brain") {
    // `channel` (empty/absent = General) scopes the prompt key to
    // system_prompt_override[:<canal>]. Four sub-actions share the brain
    // modal — reset, copy-general, pause toggle, and saving the prompt text —
    // checked in that priority order. bot_paused stays GLOBAL-only (no
    // per-channel pause).
    const channel = String(form.get("channel") ?? "").trim() || undefined;
    const promptKey = channel ? `${SETTING_KEYS.systemPromptOverride}:${channel}` : SETTING_KEYS.systemPromptOverride;
    const customKey = channel ? `${SETTING_KEYS.customInstructions}:${channel}` : SETTING_KEYS.customInstructions;
    const action = String(form.get("action") ?? "");

    if (action === "reset") {
      // "Delete" = empty string, same convention the General tab already used:
      // settings-loader treats an empty value as absent and falls back.
      await repo.set(promptKey, "");
    } else if (action === "reset-custom") {
      // Borra las Instrucciones (modo guiado, aditivas) — no toca el override.
      await repo.set(customKey, "");
    } else if (action === "copy-general") {
      await repo.set(promptKey, await currentGlobalSystemPrompt(c.env));
    } else if (form.get("bot_paused") !== null) {
      await repo.set(SETTING_KEYS.botPaused, String(form.get("bot_paused")) === "1" ? "1" : "0");
      // El toggle Estado del dueño SIEMPRE gana: limpia cualquier pausa temporal
      // puesta desde la nube — si el dueño dice "Activo", el bot contesta ya.
      await repo.set(SETTING_KEYS.botPausedUntil, "");
    } else if (form.get("custom_instructions") !== null) {
      // Instrucciones ADITIVAS (modo guiado): su propio form, se SUMAN al prompt
      // generado sin reemplazarlo. Vacío = ausente (mismo convenio que el override).
      await repo.set(customKey, String(form.get("custom_instructions")).trim());
    } else if (form.get("system_prompt_override") !== null) {
      await repo.set(promptKey, String(form.get("system_prompt_override")).trim());
    }
  } else {
    return c.text("Nodo desconocido", 404);
  }

  c.header("HX-Trigger", "canvas-refresh");
  const activeChannel = id === "brain" ? String(form.get("channel") ?? "").trim() || undefined : undefined;
  return c.html((await renderNodeModal(c.env, id, true, activeChannel)) + toastOob("✓ Guardado"));
});

// Toggle a tool on/off from its node modal. The `channel` form field (empty =
// General) scopes the write to disabled_tools[:<canal>] and re-renders the tool
// modal FOR that channel so the diagram + modal stay on the viewed channel.
adminApp.post("/agente/tools/:name/toggle", async (c) => {
  const name = c.req.param("name");
  // Tolerate a body-less POST (global toggle) — formData() throws on no body.
  const form = await c.req.formData().catch(() => null);
  const channel = (form && String(form.get("channel") ?? "").trim()) || undefined;
  const ok = await toggleTool(c.env, name, channel);
  if (!ok) return c.text("Tool no encontrada", 404);
  c.header("HX-Trigger", "canvas-refresh");
  return c.html((await renderNodeModal(c.env, `tool:${name}`, true, channel)) + toastOob("✓ Guardado"));
});

// Same toggle, but invoked from the tools LIST inside the Agente modal. Since a
// channel view hides its off tools from the canvas, this is where a hidden tool
// gets turned back on. Re-renders the WHOLE Agente modal (not the tool modal) so
// the list stays open on the viewed channel; the canvas redraws via the event.
adminApp.post("/agente/node/brain/tools/:name/toggle", async (c) => {
  const name = c.req.param("name");
  const form = await c.req.formData().catch(() => null);
  const channel = (form && String(form.get("channel") ?? "").trim()) || undefined;
  const ok = await toggleTool(c.env, name, channel);
  if (!ok) return c.text("Tool no encontrada", 404);
  c.header("HX-Trigger", "canvas-refresh");
  return c.html((await renderNodeModal(c.env, "brain", true, channel)) + toastOob("✓ Guardado"));
});

adminApp.get("/leads", async (c) => c.html(await renderLeads(c.env)));

adminApp.get("/tickets", async (c) => c.html(await renderTickets(c.env)));

adminApp.get("/cobros", async (c) => c.html(await renderCobros(c.env)));

// Conexiones: mapa de canales con estado verde/gris (paso 4 del onboarding).
adminApp.get("/conexiones", async (c) => c.html(await renderConexiones(c.env, c.req.url)));

adminApp.get("/campanas", async (c) => {
  const q: Record<string, string | undefined> = {
    ok: c.req.query("ok"),
    err: c.req.query("err"),
    ff: c.req.query("ff"),
    tp: c.req.query("tp"),
    dup: c.req.query("dup"),
    quota: c.req.query("quota"),
    fail: c.req.query("fail"),
  };
  return c.html(await renderCampanas(c.env, q));
});

adminApp.post("/campanas/send", async (c) => {
  const form = await c.req.formData();
  const segmentId = String(form.get("segment") ?? "");
  const campaignKey = String(form.get("campaign_key") ?? "").trim();
  const freeformText = String(form.get("freeform_text") ?? "").trim();
  const templateSid = String(form.get("template_sid") ?? "").trim();
  const varsRaw = String(form.get("template_vars") ?? "").trim();
  if (!segmentId || !campaignKey || (!freeformText && !templateSid)) {
    return c.redirect("/admin/campanas?err=" + encodeURIComponent("Falta el segmento, el nombre de campaña, o un mensaje/plantilla."));
  }
  let variables: Record<string, string> | undefined;
  if (varsRaw) {
    try {
      variables = JSON.parse(varsRaw);
    } catch {
      return c.redirect("/admin/campanas?err=" + encodeURIComponent("Las variables no son JSON válido."));
    }
  }
  // El body de la plantilla viaja al historial de cada conversación — sin él,
  // el agente no sabría qué se le preguntó al cliente cuando responda.
  let templateBody: string | undefined;
  if (templateSid) {
    const { listContentTemplates } = await import("../campaigns");
    const tpl = (await listContentTemplates(c.env).catch(() => [])).find((t) => t.sid === templateSid);
    templateBody = tpl?.body || undefined;
  }
  const result = await sendCampaign(c.env, {
    segmentId,
    campaignKey,
    freeformText: freeformText || undefined,
    template: templateSid ? { sid: templateSid, variables, body: templateBody } : undefined,
  });
  const q = new URLSearchParams({
    ok: "1",
    ff: String(result.sentFreeform),
    tp: String(result.sentTemplate),
    dup: String(result.skippedDuplicate),
    quota: String(result.skippedQuota),
    fail: String(result.failed),
  });
  return c.redirect("/admin/campanas?" + q.toString());
});

// Plantillas: read-only de las plantillas HSM del número y a qué rol del bot
// (reenganche / handoff) está asignada cada una. El POST asigna el SID de
// reenganche con un click (atajo del campo manual en Configuración).
adminApp.get("/plantillas", async (c) =>
  c.html(await renderPlantillas(c.env, { saved: c.req.query("saved") })),
);

// Reseñas: respuestas de la encuesta de satisfacción (rating + opinión abierta).
adminApp.get("/reviews", async (c) => c.html(await renderReviews(c.env)));

// Bóveda (superpoder Forja+): galería de imágenes/documentos del cliente.
adminApp.get("/boveda", async (c) => c.html(await renderBoveda(c.env)));

// Sirve un archivo de la Bóveda desde R2. Tras el Basic Auth del sub-app /admin
// (nunca público). 404 si no hay binding, no existe la fila, o falta en R2.
adminApp.get("/media/:id", async (c) => {
  if (!c.env.MEDIA) return c.notFound();
  const row = await new Db(c.env.DB)
    .first<{ r2_key: string; mime: string | null }>(
      "SELECT r2_key, mime FROM media WHERE id = ?",
      [c.req.param("id")],
    )
    .catch(() => null);
  if (!row) return c.notFound();
  const obj = await c.env.MEDIA.get(row.r2_key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": row.mime || "application/octet-stream",
      "cache-control": "private, max-age=3600",
    },
  });
});

adminApp.post("/plantillas/use", async (c) => {
  const form = await c.req.formData();
  const sid = String(form.get("sid") ?? "").trim();
  if (sid) await new SettingsRepo(new Db(c.env.DB)).set(SETTING_KEYS.reengageTemplateSid, sid);
  return c.redirect("/admin/plantillas?saved=1");
});

// Cloud API oficial: guarda el nombre + idioma de la plantilla de Meta para reenganche.
adminApp.post("/plantillas/wa-template", async (c) => {
  const form = await c.req.formData();
  const repo = new SettingsRepo(new Db(c.env.DB));
  await repo.set(SETTING_KEYS.reengageTemplateName, String(form.get("name") ?? "").trim());
  await repo.set(SETTING_KEYS.reengageTemplateLang, String(form.get("lang") ?? "").trim() || "es");
  return c.redirect("/admin/plantillas?saved=1");
});

adminApp.get("/config", async (c) => {
  const settings = await new SettingsRepo(new Db(c.env.DB)).all();
  const saved = c.req.query("saved") === "1";
  return c.html(renderConfig(c.env, settings, saved, c.req.query("llmtest")));
});

// Guarda proveedor/modelo/API key desde el form (allow-list de valores). El
// input de la key llega vacío cuando no la tocaron → solo se sobreescribe si
// escribieron algo; el checkbox la borra explícitamente.
async function saveLlmFields(repo: SettingsRepo, form: FormData): Promise<void> {
  const provRaw = form.get(SETTING_KEYS.llmProvider);
  if (provRaw !== null) {
    const v = String(provRaw).trim().toLowerCase();
    await repo.set(
      SETTING_KEYS.llmProvider,
      v === "anthropic" || v === "openai" || v === "xai" || v === "google" ? v : "",
    );
  }
  const modelRaw = form.get(SETTING_KEYS.llmModel);
  if (modelRaw !== null) {
    await repo.set(SETTING_KEYS.llmModel, String(modelRaw).trim().slice(0, 100));
  }
  if (form.get("llm_api_key_clear") === "1") {
    await repo.set(SETTING_KEYS.llmApiKey, "");
  } else {
    const keyRaw = form.get(SETTING_KEYS.llmApiKey);
    if (keyRaw !== null && String(keyRaw).trim() !== "") {
      await repo.set(SETTING_KEYS.llmApiKey, String(keyRaw).trim());
    }
  }
}

// Prueba de la config BYO-LLM: PRIMERO guarda lo que el dueño acaba de escribir
// (proveedor/modelo/key), LUEGO lo prueba con un generateText mínimo. Así "Probar"
// valida exactamente lo tecleado en un clic — antes era un link GET que descartaba
// el form y probaba el estado viejo de D1 (bug: "API key is invalid" con key buena).
//
// A PROPÓSITO usa createModel/generateText a secas y NO el failover de
// llm/work-model: este botón existe para decirle la VERDAD al dueño sobre la
// config que acaba de escribir. Con failover diría "ok" de una llave rota
// —porque contestó el respaldo— y el dueño se iría creyendo que quedó bien.
adminApp.post("/config/llm-test", async (c) => {
  const form = await c.req.formData();
  const repo = new SettingsRepo(new Db(c.env.DB));
  await saveLlmFields(repo, form);
  try {
    const ov = await loadLlmOverrides(c.env);
    const { model, modelId, provider } = createModel(c.env, "fast", ov);
    const r = await generateText({
      model,
      prompt: "Responde únicamente: ok",
      maxOutputTokens: 8,
    });
    const okText = r.text.trim().slice(0, 20) || "ok";
    return c.redirect(
      `/admin/config?llmtest=${encodeURIComponent(`ok:${provider}/${modelId} → "${okText}"`)}`,
    );
  } catch (err) {
    // El mensaje del SDK a veces es un "Bad Request" pelón; la causa real viene
    // en el CUERPO de la respuesta del proveedor (o del gateway intermedio,
    // p.ej. un ANTHROPIC_BASE_URL mal formado). Sin esto, el dueño ve el
    // banner y no tiene NADA accionable (reporte real de un miembro).
    let msg = err instanceof Error ? err.message : String(err);
    const body = (err as { responseBody?: unknown })?.responseBody;
    if (typeof body === "string" && body.trim() && !msg.includes(body.trim().slice(0, 40))) {
      msg += ` — ${body.trim().slice(0, 140)}`;
    }
    return c.redirect(`/admin/config?llmtest=${encodeURIComponent(`err:${msg.slice(0, 300)}`)}`);
  }
});

// Save the control panel. Card selections are mapped from the picked option
// (value or label) back to the value we persist via `levelToValue`; free-text
// fields are stored verbatim (trimmed). Empty/absent => default at load time.
adminApp.post("/config", async (c) => {
  const form = await c.req.formData();
  const repo = new SettingsRepo(new Db(c.env.DB));
  { const eq = await import("./equipo"); await eq.audit(new Db(c.env.DB), actorDe(c.env), "config_editada"); }

  // Card-based controls: tone, buffer_seconds, max_chunks, model_override, bot_paused.
  for (const key of Object.keys(CONTROLS)) {
    const picked = form.get(key);
    if (picked === null) continue; // control not submitted — leave as-is
    const value = levelToValue(key, String(picked));
    if (value !== null) await repo.set(key, value);
  }

  // Free-text controls (stored verbatim, trimmed).
  const textKeys: SettingKey[] = [
    SETTING_KEYS.botName,
    SETTING_KEYS.systemPromptOverride,
    SETTING_KEYS.escalationKeywords,
    SETTING_KEYS.loginTitulo,
    SETTING_KEYS.loginSub,
    SETTING_KEYS.loginFrase,
    SETTING_KEYS.loginPie,
    SETTING_KEYS.loginBoton,
  ];
  for (const key of textKeys) {
    const raw = form.get(key);
    if (raw === null) continue;
    await repo.set(key, String(raw).trim());
  }

  // business_context: MISMA regla que PUT /api/business (businessContextOk, una
  // sola fuente). El texto entra al system prompt dentro de <business_context>;
  // si no cumple (vacío, muy largo, o intenta cerrar el tag / abrir otra sección
  // / colar [[forja-app:*]]) NO se escribe y el valor anterior queda intacto —
  // rechazo silencioso, defensa en profundidad, sin tocar el resto del guardado.
  {
    const raw = form.get(SETTING_KEYS.businessContext);
    if (raw !== null) {
      const v = String(raw).trim();
      if (businessContextOk(v)) await repo.set(SETTING_KEYS.businessContext, v);
    }
  }

  // Idioma y moneda. Se validan contra la lista real: si alguien manda un valor
  // que no existe, se guarda vacío y el bot se queda con el de su instalación —
  // nunca con un idioma inventado que lo dejaría hablando raro.
  const idiomaPedido = form.get(SETTING_KEYS.botLanguage);
  if (idiomaPedido !== null) {
    const v = String(idiomaPedido).trim();
    const valido = v === "" || v === "espejo" || esCodigoValido(v);
    await repo.set(SETTING_KEYS.botLanguage, valido ? v : "");
    // El caché vive por isolate y dura 30s: sin esto el dueño guarda, prueba
    // enseguida y parece que no funcionó.
    bustIdiomaCache();
  }
  const panelPedido = form.get(SETTING_KEYS.panelLanguage);
  if (panelPedido !== null) {
    const v = String(panelPedido).trim();
    await repo.set(SETTING_KEYS.panelLanguage, v === "" || esLocalePanel(v) ? v : "");
  }
  const monedaPedida = form.get(SETTING_KEYS.botCurrency);
  if (monedaPedida !== null) {
    // Solo el símbolo: 8 caracteres alcanzan para "COP$" y cortan cualquier
    // intento de meter texto dentro del prompt.
    await repo.set(SETTING_KEYS.botCurrency, String(monedaPedida).trim().slice(0, 8));
  }

  // BYO-LLM: proveedor, modelo y API key (helper compartido con /config/llm-test).
  await saveLlmFields(repo, form);

  // Superpoderes Forja+ (toggles) — la sección solo se renderiza en Pro, así
  // que solo procesamos sus checkboxes en Pro (un checkbox no marcado no llega
  // en el form → lo guardamos como "0"). Los text fields se guardan trimmed.
  if (isPro(c.env)) {
    const toggleKeys: SettingKey[] = [
      SETTING_KEYS.dailyReport,
      SETTING_KEYS.multiLanguage,
      SETTING_KEYS.satisfactionSurvey,
      SETTING_KEYS.reengageColdLeads,
      SETTING_KEYS.salesHunter,
      SETTING_KEYS.reviewRequests,
      SETTING_KEYS.paymentsEnabled,
    ];
    for (const key of toggleKeys) {
      await repo.set(key, form.get(key) === "1" ? "1" : "0");
    }
    for (const key of [SETTING_KEYS.reviewUrl, SETTING_KEYS.reengageTemplateSid] as SettingKey[]) {
      const raw = form.get(key);
      if (raw !== null) await repo.set(key, String(raw).trim());
    }
    // Selects con allow-list: formato del reporte + modo de la encuesta.
    const selects: Array<[SettingKey, string[]]> = [
      [SETTING_KEYS.reportFormat, ["html", "docx", "pdf"]],
      [SETTING_KEYS.surveyMode, ["numerico", "abierto", "ambos"]],
    ];
    for (const [key, allowed] of selects) {
      const raw = form.get(key);
      if (raw !== null && allowed.includes(String(raw))) await repo.set(key, String(raw));
    }
  }

  return c.redirect("/admin/config?saved=1");
});

// --- CSV export -------------------------------------------------------------

adminApp.get("/leads/export.csv", async (c) => {
  const csv = await exportLeadsCsv(c.env);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${Date.now()}.csv"`,
    },
  });
});

// --- Mutating actions (HTMX / plain form posts) -----------------------------

// Mark a lead's status (nuevo / contactado / vendido / perdido).
adminApp.post("/leads/:id/status", async (c) => {
  const form = await c.req.formData();
  const raw = String(form.get("status") ?? "new");
  const status: Lead["status"] = (LEAD_STATUSES as readonly string[]).includes(raw)
    ? (raw as Lead["status"])
    : "new";
  const leads = new LeadsRepo(new Db(c.env.DB));
  await leads.setStatus(c.req.param("id"), status);
  return c.redirect("/admin/leads");
});

// Resolve a support ticket.
adminApp.post("/tickets/:id/resolve", async (c) => {
  const form = await c.req.formData();
  const resolvedBy = String(form.get("resolved_by") ?? c.env.OWNER_EMAIL ?? "admin").trim() || "admin";
  const tickets = new TicketsRepo(new Db(c.env.DB));
  await tickets.resolve(c.req.param("id"), resolvedBy);
  return c.redirect("/admin/tickets");
});

// --- Inbox actions (F1) -------------------------------------------------------

/** Owner takes over for this long after replying/pausing from the dashboard.
 * Configurable desde el panel (control "Cuando tomas el control"). Vacío = 60 min;
 * "0" = hasta que el dueño reanude (pausa efectivamente indefinida ≈ 1 año).
 * UNA sola fuente de verdad en db/settings (`resolveTakeoverMs`), compartida por
 * el panel Y la coexistencia de Kapso/YCloud — así el tiempo de pausa NUNCA
 * diverge entre "tomar el control desde el panel" y "responder desde tu app". */
async function takeoverMs(env: Env): Promise<number> {
  return resolveTakeoverMs(env);
}

// Duraciones que el dueño puede elegir AL pausar una conversación puntual (como
// ManyChat). "0" = hasta reactivar. Cualquier otro valor no listado cae al
// default global (takeoverMs). El selector vive en el header del hilo.
const PAUSE_CHOICES_MIN = new Set([30, 60, 180, 480, 0]);
async function pauseDurationMs(env: Env, raw: string | null): Promise<number> {
  if (raw == null || raw === "") return takeoverMs(env); // sin elección → config global
  const min = parseInt(raw, 10);
  if (!Number.isFinite(min) || !PAUSE_CHOICES_MIN.has(min)) return takeoverMs(env);
  return min <= 0 ? MANUAL_RESUME_MS : min * 60_000;
}

// Reply AS A HUMAN from the dashboard: sends through the conversation's channel
// adapter (Twilio/Telegram/Meta/ManyChat), persists the message as role=owner,
// and pauses the bot for takeoverMs() (real owner takeover). Esta es la ÚNICA
// vía de pausa por intervención — el flag isOwnerMessage del agente ya no pausa
// (solo marcaba al dueño probando por Telegram; ver nota en agent.ts).
// Returns a status line for #send-status plus an out-of-band swap that
// refreshes #thread-live instantly. X-Sent: 1 tells the composer to reset.
adminApp.post("/conversations/:id/reply", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.formData().catch(() => null);
  const text = String(form?.get("text") ?? "").trim();
  if (!text) return c.html(`<span class="text-stone-400">${traductor(c.env)("inbox.escribeMensajePrimero")}</span>`);

  const db = new Db(c.env.DB);
  const convs = new ConversationsRepo(db);
  const conv = await convs.getById(id);
  if (!conv) return c.html(`<span class="text-red-600">${traductor(c.env)("inbox.conversacionNoEncontrada")}</span>`);

  try {
    const adapter = pickAdapter(conv.channel as ChannelId);
    await adapter.sendReply(
      {
        channel: conv.channel as ChannelId,
        channelUserId: conv.channel_user_id,
        chunks: [text],
        interChunkDelayMs: 0,
      },
      c.env,
    );
  } catch (e) {
    // Nothing persisted on failure: the customer never got the message.
    const msg = e instanceof Error ? e.message : String(e);
    return c.html(`<span class="text-red-600">✗ No se pudo enviar: ${escapeHtml(msg)}</span>`);
  }

  const msgs = new MessagesRepo(db);
  await msgs.append(id, "owner", text);
  await convs.touchLastMessage(id);
  await convs.setPausedUntil(id, Date.now() + (await takeoverMs(c.env)));

  c.header("X-Sent", "1");
  return c.html(
    `<span class="text-emerald-600">✓ Enviado por ${escapeHtml(channelLabel(conv.channel))}</span>` +
      `<div id="thread-live" hx-swap-oob="innerHTML">${await renderThreadLive(c.env, id)}</div>`,
  );
});

// Pause the bot in this conversation without sending anything (owner wants the
// customer for themselves). Returns the refreshed thread fragment.
adminApp.post("/conversations/:id/pause", async (c) => {
  const id = c.req.param("id");
  const convs = new ConversationsRepo(new Db(c.env.DB));
  // El dueño elige cuánto pausar ESTA conversación (form "minutes"). Sin
  // elección, cae a su config global. Tolera body vacío (formData() throws).
  const form = await c.req.formData().catch(() => null);
  const ms = await pauseDurationMs(c.env, form ? String(form.get("minutes") ?? "") : null);
  await convs.setPausedUntil(id, Date.now() + ms);
  return c.html(await renderThreadLive(c.env, id));
});

// Return a paused conversation back to the bot. Clears paused_until AND appends
// a summary of the human handoff to the message history, so the bot resumes
// with context about what the owner already resolved.
adminApp.post("/conversations/:id/resume", async (c) => {
  const id = c.req.param("id");
  const convs = new ConversationsRepo(new Db(c.env.DB));
  await convs.setPausedUntil(id, null);
  // Insert a summary of the human handoff so the bot has context when it
  // picks the conversation back up. Role `note` (not `owner`): it never went
  // out to the customer, so it shouldn't look like a sent message in the
  // thread — but agent.ts's mapMessageToAiTurn still feeds it to the LLM as
  // internal context, same as before. The summary field is optional, so
  // tolerate a request with no form body (formData() throws on an
  // empty/no-content-type body).
  const form = await c.req.formData().catch(() => null);
  const summary =
    String(form?.get("summary") ?? "").trim() ||
    "(El dueño habló con el cliente y resolvió la consulta.)";
  const msgs = new MessagesRepo(new Db(c.env.DB));
  await msgs.append(id, "note", summary);
  return c.redirect(`/admin/conversations?c=${encodeURIComponent(id)}`);
});

// --- Co-pilot (HTMX-driven suggestion) --------------------------------------

/** Escape untrusted text (LLM output) before interpolating into an HTML fragment. */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!),
  );
}

// "Suggest Reply": UNA respuesta corta que el dueño puede copiar/pegar. NO le
// manda nada al cliente — solo devuelve el fragmento HTML que HTMX mete en el
// área de sugerencia. La cabeza vive en src/copilot.ts, compartida con el botón
// ✨ de la app (POST /api/conversations/:id/suggest): así el panel también usa
// el prompt EFECTIVO del bot (tono, instrucciones del dueño, lecciones), no el
// generado a secas desde el env.
//
// Auth: already enforced by the wildcard Basic Auth middleware above, so there
// is no per-route auth check here (no magic-link `requireAuth`).
adminApp.post("/conversations/:id/suggest", async (c) => {
  const conv = await new ConversationsRepo(new Db(c.env.DB)).getById(c.req.param("id"));
  if (!conv) return c.html(renderSuggestionBox("Esa conversación ya no existe."));
  try {
    const { suggestion } = await suggestReply(c.env, conv);
    return c.html(renderSuggestionBox(suggestion));
  } catch (e) {
    // El panel no tiene códigos de error: el motivo va en la misma cajita.
    return c.html(renderSuggestionBox(e instanceof Error ? e.message : String(e)));
  }
});

// --- Fallback ---------------------------------------------------------------

adminApp.notFound((c) =>
  c.html(
    layout({
      title: "No encontrado",
      activeTab: "overview",
      body: "<p class='text-stone-500'>Página no encontrada.</p>",
    }),
    404,
  ),
);
