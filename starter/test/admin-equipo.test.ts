import { describe, it, expect, beforeEach } from "vitest";
import {
  hashPassword, mintSession, verifySession, loginMaster,
  createPanelUser, acceptInvite, loginPanelUser, listPanelUsers,
  deletePanelUser, resetInvite, hayPanelUsers, roleForSession, inviteInfo,
  issueResetToken, resetPassword, bumpSessionVersion, sessionVersion, audit, listAudit,
  normalizaHorario, normalizaDias, enTurno, parseAvisos, updateProfile,
  __resetEnsured, __resetHayCache,
} from "../src/admin/equipo";
import { hiddenTabs, STAFF_HIDDEN_TABS, STAFF_LOCKED_TABS } from "../src/config";
import { Db } from "../src/db/client";
import type { Env } from "../src/env";

// D1 falso en memoria que honra las queries exactas del módulo equipo.
function fakeD1() {
  const rows: any[] = [];
  const audits: any[] = [];
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            run: async () => {
              if (/^CREATE/i.test(sql)) return { meta: { changes: 0 } };
              if (/^INSERT INTO panel_users/i.test(sql)) {
                rows.push({
                  id: params[0], email: params[1], name: params[2], role: params[3],
                  phone: null, pass_hash: null, salt: null, invite_token: params[4], invite_expires: params[5],
                  created_at: params[6], last_login_at: null,
                });
                return { meta: { changes: 1 } };
              }
              if (/SET invite_token = \?/i.test(sql)) {
                const r = rows.find((x) => x.id === params[2]);
                if (!r) return { meta: { changes: 0 } };
                Object.assign(r, { invite_token: params[0], invite_expires: params[1], pass_hash: null, salt: null });
                return { meta: { changes: 1 } };
              }
              if (/SET pass_hash = \?, salt = \?, name = \?, phone = \?, puesto = \?/i.test(sql)) {
                const r = rows.find((x) => x.id === params[8]);
                Object.assign(r, { pass_hash: params[0], salt: params[1], name: params[2], phone: params[3], puesto: params[4], horario: params[5], dias: params[6], avisos: params[7], invite_token: null, invite_expires: null });
                return { meta: { changes: 1 } };
              }
              if (/SET failed_logins = \?, locked_until = \?/i.test(sql)) {
                const r = rows.find((x) => x.id === params[2]);
                if (r) Object.assign(r, { failed_logins: params[0], locked_until: params[1] });
                return { meta: { changes: 1 } };
              }
              if (/SET last_login_at = \?, failed_logins = 0/i.test(sql)) {
                const r = rows.find((x) => x.id === params[1]);
                if (r) Object.assign(r, { last_login_at: params[0], failed_logins: 0, locked_until: null });
                return { meta: { changes: 1 } };
              }
              if (/SET reset_token = \?, reset_expires = \?/i.test(sql)) {
                const r = rows.find((x) => x.id === params[2]);
                if (r) Object.assign(r, { reset_token: params[0], reset_expires: params[1] });
                return { meta: { changes: 1 } };
              }
              if (/reset_token = NULL, reset_expires = NULL/i.test(sql)) {
                const r = rows.find((x) => x.id === params[2]);
                if (r) Object.assign(r, { pass_hash: params[0], salt: params[1], reset_token: null, reset_expires: null, failed_logins: 0, locked_until: null, session_version: (r.session_version ?? 1) + 1 });
                return { meta: { changes: 1 } };
              }
              if (/session_version = COALESCE\(session_version, 1\) \+ 1 WHERE id = \?$/i.test(sql.trim())) {
                const r = rows.find((x) => x.id === params[0]);
                if (r) r.session_version = (r.session_version ?? 1) + 1;
                return { meta: { changes: 1 } };
              }
              if (/SET name = \?, phone = \?, puesto = \?, horario = \?, dias = \?, avisos = \?, pass_hash/i.test(sql)) {
                const r = rows.find((x) => x.id === params[8]);
                if (r) Object.assign(r, { name: params[0], phone: params[1], puesto: params[2], horario: params[3], dias: params[4], avisos: params[5], pass_hash: params[6], salt: params[7] });
                return { meta: { changes: 1 } };
              }
              if (/SET name = \?, phone = \?, puesto = \?, horario = \?, dias = \?, avisos = \? WHERE/i.test(sql)) {
                const r = rows.find((x) => x.id === params[6]);
                if (r) Object.assign(r, { name: params[0], phone: params[1], puesto: params[2], horario: params[3], dias: params[4], avisos: params[5] });
                return { meta: { changes: 1 } };
              }
              if (/INSERT INTO panel_audit/i.test(sql)) {
                audits.push({ at: params[0], actor_id: params[1], actor_label: params[2], accion: params[3], detalle: params[4] });
                return { meta: { changes: 1 } };
              }
              if (/SET last_login_at/i.test(sql)) {
                const r = rows.find((x) => x.id === params[1]);
                if (r) r.last_login_at = params[0];
                return { meta: { changes: 1 } };
              }
              if (/^DELETE FROM panel_users/i.test(sql)) {
                const i = rows.findIndex((x) => x.id === params[0]);
                if (i >= 0) rows.splice(i, 1);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            first: async () => {
              if (/COUNT\(\*\)/i.test(sql)) return { n: rows.length };
              if (/WHERE email = \?/i.test(sql)) return rows.find((x) => x.email === params[0]) ?? null;
              if (/WHERE invite_token = \?/i.test(sql)) return rows.find((x) => x.invite_token === params[0]) ?? null;
              if (/WHERE reset_token = \?/i.test(sql)) return rows.find((x) => x.reset_token === params[0]) ?? null;
              if (/SELECT session_version AS v/i.test(sql)) { const r = rows.find((x) => x.id === params[0]); return r ? { v: r.session_version ?? 1 } : null; }
              if (/WHERE id = \?/i.test(sql)) return rows.find((x) => x.id === params[0]) ?? null;
              return null;
            },
            all: async () => (/FROM panel_audit/i.test(sql) ? { results: [...audits].reverse() } : { results: [...rows] }),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { d1, rows, audits };
}

const env = { DASHBOARD_PASSWORD: "maestra-123" } as unknown as Env;

beforeEach(() => { __resetEnsured(); __resetHayCache(); });

describe("hash y sesión", () => {
  it("hashPassword: determinista por (password, salt); cambia con la sal", async () => {
    const a = await hashPassword("secreta88", "s1");
    expect(a).toBe(await hashPassword("secreta88", "s1"));
    expect(a).not.toBe(await hashPassword("secreta88", "s2"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mintSession/verifySession: ida y vuelta, expiración y firma alterada", async () => {
    const cookie = await mintSession(env, "u123", Date.now(), 3);
    expect(await verifySession(env, cookie)).toEqual({ uid: "u123", version: 3 });
    // expirada
    const vieja = await mintSession(env, "u123", Date.now() - 15 * 24 * 3600_000);
    expect(await verifySession(env, vieja)).toBe(null);
    // firma alterada
    expect(await verifySession(env, cookie.slice(0, -2) + "aa")).toBe(null);
    // versión alterada sin refirmar → inválida
    const [uid, exp, , sig] = cookie.split(".");
    expect(await verifySession(env, `${uid}.${exp}.9.${sig}`)).toBe(null);
    // otra contraseña maestra = otra llave → sesión inválida (rotación)
    expect(await verifySession({ DASHBOARD_PASSWORD: "otra" } as any, cookie)).toBe(null);
  });

  it("loginMaster: timing-safe contra DASHBOARD_PASSWORD", () => {
    expect(loginMaster(env, "maestra-123")).toBe(true);
    expect(loginMaster(env, "maestra-12")).toBe(false);
    expect(loginMaster({} as any, "")).toBe(false);
  });
});

describe("flujo completo: invitar → aceptar → entrar", () => {
  it("el jefe crea el acceso, el empleado define contraseña y entra", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);

    expect(await hayPanelUsers(db)).toBe(false);
    const alta = await createPanelUser(db, { email: "Jefe@Negocio.com", name: "Don Jefe", role: "admin" });
    expect(alta.ok).toBe(true);
    if (!alta.ok) return;

    __resetHayCache();
    expect(await hayPanelUsers(db)).toBe(true);

    // aún pendiente: no puede entrar sin aceptar la invitación
    expect(await loginPanelUser(db, "jefe@negocio.com", "loquesea88")).toBe(null);

    const acepta = await acceptInvite(db, alta.inviteToken, "superclave88");
    expect(acepta.ok).toBe(true);

    // el token ya no sirve dos veces
    const otra = await acceptInvite(db, alta.inviteToken, "hackearla88");
    expect(otra.ok).toBe(false);

    // login por correo (case-insensitive) y rol
    const uid = await loginPanelUser(db, "JEFE@negocio.com", "superclave88");
    expect(uid).toBe(alta.id);
    expect(await roleForSession(db, alta.id)).toBe("admin");
    expect(await roleForSession(db, "master")).toBe("master");

    // contraseña equivocada no entra
    expect(await loginPanelUser(db, "jefe@negocio.com", "superclave89")).toBe(null);
  });

  it("al aceptar, el invitado completa nombre y WhatsApp; vacío conserva lo que puso quien invitó", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    const a = await createPanelUser(db, { email: "jefe@y.com", name: "Jefe Provisional", role: "admin" });
    if (!a.ok) return;
    const info = await inviteInfo(db, a.inviteToken);
    expect(info).toEqual({ email: "jefe@y.com", name: "Jefe Provisional", phone: null, role: "admin" });
    await acceptInvite(db, a.inviteToken, "clavefuerte8", { name: "Carlos Mena", phone: "+52 1 55 1234-5678" });
    const u = (await listPanelUsers(db))[0];
    expect(u.name).toBe("Carlos Mena");
    expect(u.phone).toBe("+5215512345678"); // normalizado: solo dígitos y +
    // token consumido → inviteInfo ya no lo reconoce
    expect(await inviteInfo(db, a.inviteToken)).toBe(null);

    const b = await createPanelUser(db, { email: "emp@y.com", name: "Empleada", role: "staff" });
    if (!b.ok) return;
    await acceptInvite(db, b.inviteToken, "clavefuerte8", { name: "", phone: "" });
    expect((await listPanelUsers(db))[1].name).toBe("Empleada");
  });

  it("correo duplicado se rechaza; contraseña corta se rechaza; borrar borra", async () => {
    const { d1, rows } = fakeD1();
    const db = new Db(d1);
    const a = await createPanelUser(db, { email: "x@y.com", role: "staff" });
    expect(a.ok).toBe(true);
    expect((await createPanelUser(db, { email: "x@y.com", role: "staff" })).ok).toBe(false);
    if (!a.ok) return;
    expect((await acceptInvite(db, a.inviteToken, "corta")).ok).toBe(false);
    await deletePanelUser(db, a.id);
    expect(rows).toHaveLength(0);
  });

  it("reinvitar resetea la contraseña y emite token nuevo", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    const a = await createPanelUser(db, { email: "emp@y.com", role: "staff" });
    if (!a.ok) return;
    await acceptInvite(db, a.inviteToken, "clavevieja8");
    const token2 = await resetInvite(db, a.id);
    expect(token2).toBeTruthy();
    expect(token2).not.toBe(a.inviteToken);
    // tras el reset, la clave vieja ya no entra (queda pendiente otra vez)
    expect(await loginPanelUser(db, "emp@y.com", "clavevieja8")).toBe(null);
    const u = (await listPanelUsers(db))[0];
    expect(u.pendiente).toBe(true);
  });
});

describe("rol staff — tabs ocultas", () => {
  it("staff no ve config/conexiones/agente/kb/costs/equipo; admin y master sí", () => {
    const base = { BOT_TIER: "pro" } as unknown as Env;
    expect(hiddenTabs({ ...base, PANEL_ROLE: "staff" } as any)).toEqual(
      expect.arrayContaining([...STAFF_HIDDEN_TABS]),
    );
    expect(hiddenTabs({ ...base, PANEL_ROLE: "admin" } as any)).toEqual([]);
    expect(hiddenTabs({ ...base, PANEL_ROLE: "master" } as any)).toEqual([]);
  });

  it("staff se SUMA a las tabs que la agencia ya ocultó (HIDDEN_TABS)", () => {
    const env2 = { BOT_TIER: "pro", HIDDEN_TABS: "costs,stats", PANEL_ROLE: "staff" } as unknown as Env;
    const hidden = hiddenTabs(env2);
    expect(hidden).toEqual(expect.arrayContaining(["stats", "config", "equipo"]));
    expect(new Set(hidden).size).toBe(hidden.length); // sin duplicados
  });
});

// Compatibilidad: un bot EXISTENTE (sin usuarios de panel) se comporta EXACTO
// como antes — Basic Auth del navegador, sin redirect al login.
vi.mock("agents", () => ({ Agent: class {} }));
import { vi } from "vitest";
import worker from "../src/index";

describe("bots existentes sin usuarios de panel — nada cambia", () => {
  const envBot = (rows: any[]) => {
    const d1 = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              run: async () => ({ meta: { changes: 0 } }),
              first: async () => (/COUNT\(\*\)/i.test(sql) ? { n: rows.length } : null),
              all: async () => ({ results: rows }),
            };
          },
        };
      },
    };
    return {
      BOT_NAME: "Testi", BUSINESS_NAME: "Test", BOT_LANGUAGE: "es", BOT_TIER: "pro",
      BUFFER_SECONDS: "15", DASHBOARD_BASE_URL: "https://test.workers.dev",
      DASHBOARD_PASSWORD: "maestra-123", DB: d1,
    } as any;
  };
  const get = (env: any, path: string, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://test${path}`, { headers }), env, {} as any);

  it("navegador sin credenciales → login bonito SIEMPRE (aun con 0 usuarios); curl → 401 Basic", async () => {
    __resetHayCache();
    const res = await get(envBot([]), "/admin/overview", { Accept: "text/html" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    // scripts/curl (sin Accept text/html) conservan el Basic de siempre
    __resetHayCache();
    const res2 = await get(envBot([]), "/admin/overview");
    expect(res2.status).toBe(401);
    expect(res2.headers.get("www-authenticate") ?? "").toMatch(/Basic/i);
  });

  it("con la contraseña maestra por Basic → entra igual que antes", async () => {
    __resetHayCache();
    const basic = "Basic " + Buffer.from("admin:maestra-123").toString("base64");
    const res = await get(envBot([]), "/admin/overview", { Accept: "text/html", Authorization: basic });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(302);
  });

  it("con usuarios de panel, igual: navegador → login bonito; la maestra por Basic sigue entrando", async () => {
    __resetHayCache();
    const conUsuario = envBot([{ id: "u1", email: "jefe@x.com", role: "admin" }]);
    const res = await get(conUsuario, "/admin/overview", { Accept: "text/html" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/login");
    // …y aun así, la maestra por Basic sigue entrando (scripts/agencia/rescate)
    __resetHayCache();
    const basic = "Basic " + Buffer.from("admin:maestra-123").toString("base64");
    const res2 = await get(conUsuario, "/admin/overview", { Accept: "text/html", Authorization: basic });
    expect(res2.status).not.toBe(401);
    expect(res2.status).not.toBe(302);
  });
});

describe("visibilidad del rol Equipo configurada por el admin — se APLICA de verdad", () => {
  const pro = { BOT_TIER: "pro" } as unknown as Env;

  it("sin configuración → default (STAFF_HIDDEN_TABS) + bloqueadas", () => {
    const h = hiddenTabs({ ...pro, PANEL_ROLE: "staff" } as any);
    expect(h).toEqual(expect.arrayContaining(["config", "conexiones", "costs", "equipo", "agente", "kb"]));
    expect(h).not.toContain("conversations");
  });

  it("el admin le da agente y kb al staff → dejan de estar ocultas; lo demás no listado se oculta", () => {
    const env2 = { ...pro, PANEL_ROLE: "staff", PANEL_STAFF_TABS: JSON.stringify(["conversations", "leads", "agente", "kb"]) } as any;
    const h = hiddenTabs(env2);
    expect(h).not.toContain("agente");
    expect(h).not.toContain("kb");
    expect(h).not.toContain("conversations");
    expect(h).toContain("tickets"); // no marcado → oculto
    expect(h).toContain("stats");
  });

  it("las tabs BLOQUEADAS (config/conexiones/costs/equipo) se ocultan aunque el admin las marque", () => {
    const env2 = { ...pro, PANEL_ROLE: "staff", PANEL_STAFF_TABS: JSON.stringify(["config", "conexiones", "costs", "equipo", "conversations"]) } as any;
    const h = hiddenTabs(env2);
    for (const id of STAFF_LOCKED_TABS) expect(h).toContain(id);
    expect(h).not.toContain("conversations");
  });

  it("JSON corrupto → cae al default, nunca abre de más", () => {
    const h = hiddenTabs({ ...pro, PANEL_ROLE: "staff", PANEL_STAFF_TABS: "{no es json" } as any);
    expect(h).toEqual(expect.arrayContaining([...STAFF_HIDDEN_TABS]));
  });

  it("la configuración de staff NO afecta a admin ni master", () => {
    const cfg = JSON.stringify(["conversations"]);
    expect(hiddenTabs({ ...pro, PANEL_ROLE: "admin", PANEL_STAFF_TABS: cfg } as any)).toEqual([]);
    expect(hiddenTabs({ ...pro, PANEL_ROLE: "master", PANEL_STAFF_TABS: cfg } as any)).toEqual([]);
  });

  it("guard de RUTAS: staff con visibilidad limitada recibe redirect en una tab oculta (no solo se esconde del nav)", async () => {
    __resetHayCache();
    const rows = [{ id: "u1", email: "emp@x.com", role: "staff", pass_hash: "h", salt: "s" }];
    const d1 = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              run: async () => ({ meta: { changes: 0 } }),
              first: async () => {
                if (/COUNT\(\*\)/i.test(sql)) return { n: rows.length };
                if (/SELECT session_version AS v/i.test(sql)) return { v: 1 };
                if (/FROM panel_users WHERE id = \?/i.test(sql)) return rows[0];
                if (/FROM settings WHERE key = \?/i.test(sql)) return { value: JSON.stringify(["conversations"]) };
                return null;
              },
              all: async () => ({ results: rows }),
            };
          },
        };
      },
    };
    const envS = {
      BOT_NAME: "Testi", BUSINESS_NAME: "Test", BOT_LANGUAGE: "es", BOT_TIER: "pro", BUFFER_SECONDS: "15",
      DASHBOARD_BASE_URL: "https://test.workers.dev", DASHBOARD_PASSWORD: "maestra-123", DB: d1,
    } as any;
    const cookie = await mintSession(envS, "u1");
    const res = await worker.fetch(
      new Request("https://test/admin/tickets", { headers: { Accept: "text/html", Cookie: `hz_panel=${cookie}` } }),
      envS, {} as any,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/overview");
    // …y la tab que SÍ le dieron entra (no redirige)
    const res2 = await worker.fetch(
      new Request("https://test/admin/conversations", { headers: { Accept: "text/html", Cookie: `hz_panel=${cookie}` } }),
      envS, {} as any,
    );
    expect(res2.status).not.toBe(302);
  });
});

describe("seguridad de login: bloqueo por fallos", () => {
  it("5 contraseñas malas → 'bloqueado' 15 min; la correcta también rebota mientras dure", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    const a = await createPanelUser(db, { email: "b@y.com", role: "staff" });
    if (!a.ok) return;
    await acceptInvite(db, a.inviteToken, "correcta88");
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect(await loginPanelUser(db, "b@y.com", "mala", t0)).toBe(null);
    expect(await loginPanelUser(db, "b@y.com", "mala", t0)).toBe("bloqueado");
    expect(await loginPanelUser(db, "b@y.com", "correcta88", t0 + 60_000)).toBe("bloqueado");
    // pasados 15 min entra y el contador se limpia
    expect(await loginPanelUser(db, "b@y.com", "correcta88", t0 + 16 * 60_000)).toBe(a.id);
  });
});

describe("recuperación de contraseña", () => {
  it("emite token (1h), lo consume UNA vez, invalida sesiones previas; correo inexistente → null silencioso", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    const a = await createPanelUser(db, { email: "r@y.com", name: "Rosa", role: "staff" });
    if (!a.ok) return;
    await acceptInvite(db, a.inviteToken, "vieja1234");
    const v0 = await sessionVersion(db, a.id);
    expect(await issueResetToken(db, "nadie@y.com")).toBe(null);
    const t = await issueResetToken(db, "R@y.com", 5_000_000);
    expect(t?.name).toBe("Rosa");
    // expirado
    expect((await resetPassword(db, t!.token, "nueva12345", 5_000_000 + 61 * 60_000)).ok).toBe(false);
    // vigente
    const r = await resetPassword(db, t!.token, "nueva12345", 5_000_000 + 10 * 60_000);
    expect(r.ok).toBe(true);
    expect(await loginPanelUser(db, "r@y.com", "vieja1234")).toBe(null);
    expect(await loginPanelUser(db, "r@y.com", "nueva12345")).toBe(a.id);
    expect(await sessionVersion(db, a.id)).toBe((v0 ?? 1) + 1); // sesiones viejas fuera
    // token consumido
    expect((await resetPassword(db, t!.token, "otra12345", 5_000_000 + 11 * 60_000)).ok).toBe(false);
  });

  it("invitado que aún no tiene contraseña NO puede pedir reset (no hay qué recuperar)", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    await createPanelUser(db, { email: "p@y.com", role: "staff" });
    expect(await issueResetToken(db, "p@y.com")).toBe(null);
  });
});

describe("cerrar sesión en todos los dispositivos", () => {
  it("bumpSessionVersion deja fuera la cookie vieja aunque esté bien firmada", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    const a = await createPanelUser(db, { email: "s@y.com", role: "admin" });
    if (!a.ok) return;
    await acceptInvite(db, a.inviteToken, "clave1234");
    const v = (await sessionVersion(db, a.id)) ?? 1;
    const cookie = await mintSession(env, a.id, Date.now(), v);
    const ses = await verifySession(env, cookie);
    expect(ses?.version).toBe(v);
    await bumpSessionVersion(db, a.id);
    expect(await sessionVersion(db, a.id)).toBe(v + 1); // el middleware compara y rechaza
  });
});

describe("horario y avisos", () => {
  it("normalizaHorario / normalizaDias", () => {
    expect(normalizaHorario("9:00 - 18:00")).toBe("09:00-18:00");
    expect(normalizaHorario("")).toBe(null);
    expect(normalizaHorario("25:00-18:00")).toBe(null);
    expect(normalizaDias(["1", "1", "5", "9"])).toBe("1,5");
    expect(normalizaDias("")).toBe(null);
  });

  it("enTurno respeta horario, días y zona horaria; sin horario = siempre", () => {
    // Lunes 2026-08-24 15:00 CDMX = 21:00Z
    const lunes15 = new Date("2026-08-24T21:00:00Z");
    expect(enTurno({ horario: "09:00-18:00", dias: "1,2,3,4,5" }, lunes15, "America/Mexico_City")).toBe(true);
    expect(enTurno({ horario: "09:00-14:00", dias: "1,2,3,4,5" }, lunes15, "America/Mexico_City")).toBe(false);
    expect(enTurno({ horario: "09:00-18:00", dias: "6,7" }, lunes15, "America/Mexico_City")).toBe(false);
    expect(enTurno({ horario: null, dias: null }, lunes15, "America/Mexico_City")).toBe(true);
    // turno nocturno que cruza medianoche: 22:00-06:00, a las 23:30 CDMX (05:30Z del día siguiente)
    expect(enTurno({ horario: "22:00-06:00", dias: null }, new Date("2026-08-25T05:30:00Z"), "America/Mexico_City")).toBe(true);
  });

  it("parseAvisos: defaults sanos y tolerancia a basura", () => {
    expect(parseAvisos(null)).toEqual({ canal: "email", escalamientos: true, tickets: true, resenas: false, reporte: false });
    expect(parseAvisos('{"canal":"whatsapp","resenas":true}').canal).toBe("whatsapp");
    expect(parseAvisos("{rompido").canal).toBe("email");
  });

  it("la invitación guarda puesto/horario/días/canal y updateProfile los edita", async () => {
    const { d1 } = fakeD1();
    const db = new Db(d1);
    const a = await createPanelUser(db, { email: "h@y.com", role: "staff" });
    if (!a.ok) return;
    await acceptInvite(db, a.inviteToken, "clave1234", { name: "Hugo", phone: "+52 55 1111 2222", puesto: "recepción", horario: "9:00-18:00", dias: ["1", "2", "3"], avisoCanal: "whatsapp" });
    let u = (await listPanelUsers(db))[0];
    expect(u.puesto).toBe("recepción");
    expect(u.horario).toBe("09:00-18:00");
    expect(u.dias).toBe("1,2,3");
    expect(u.avisos.canal).toBe("whatsapp");
    await updateProfile(db, a.id, { horario: "", avisos: { reporte: true } });
    u = (await listPanelUsers(db))[0];
    expect(u.horario).toBe(null);
    expect(u.avisos.reporte).toBe(true);
    expect(u.avisos.canal).toBe("whatsapp"); // lo no tocado se conserva
  });
});

describe("bitácora", () => {
  it("registra actor/acción/detalle y lista lo más reciente primero", async () => {
    const { d1, audits } = fakeD1();
    const db = new Db(d1);
    await audit(db, { id: "u1", label: "Ana (ana@x.com)" }, "config_editada", "tono");
    await audit(db, { id: null, label: "acceso maestro" }, "usuario_quitado", "b@x.com");
    expect(audits).toHaveLength(2);
    const lista = await listAudit(db);
    expect(lista[0].accion).toBe("usuario_quitado");
    expect(lista[1].actor_label).toBe("Ana (ana@x.com)");
  });
});

describe("compatibilidad con la costumbre: usuario 'admin' + contraseña maestra en el login nuevo", () => {
  it("email 'admin' (o vacío) + contraseña maestra → sesión master; contraseña mala → 401", async () => {
    __resetHayCache();
    const rows = [{ id: "u1", email: "jefe@x.com", role: "admin", pass_hash: "h", salt: "s" }];
    const d1 = {
      prepare(sql: string) {
        return { bind() { return {
          run: async () => ({ meta: { changes: 0 } }),
          first: async () => (/COUNT\(\*\)/i.test(sql) ? { n: rows.length } : null),
          all: async () => ({ results: rows }),
        }; } };
      },
    };
    const envS = { BOT_NAME: "T", BUSINESS_NAME: "T", BOT_LANGUAGE: "es", BOT_TIER: "pro", BUFFER_SECONDS: "15",
      DASHBOARD_BASE_URL: "https://test.workers.dev", DASHBOARD_PASSWORD: "maestra-123", DB: d1 } as any;
    const post = (email: string, password: string) => worker.fetch(
      new Request("https://test/admin/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, password }).toString() }), envS, {} as any);
    const okAdmin = await post("admin", "maestra-123");
    expect(okAdmin.status).toBe(302);
    expect(okAdmin.headers.get("set-cookie") ?? "").toContain("hz_panel=master.");
    const okVacio = await post("", "maestra-123");
    expect(okVacio.status).toBe(302);
    const mal = await post("admin", "otra");
    expect(mal.status).toBe(401);
  });
});
