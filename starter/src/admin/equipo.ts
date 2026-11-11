import type { Env } from "../env";
import { Db } from "../db/client";

/**
 * Equipo del panel (Modo Agencia / entrega a cliente): usuarios con login
 * propio para el dashboard del bot — el JEFE del negocio entra con su correo,
 * y él mismo invita a sus empleados con roles.
 *
 *  - `admin`: ve TODO el panel y administra el equipo (crear/borrar/reinvitar).
 *  - `staff`: opera (conversaciones, leads, tickets, bóveda, reseñas, stats)
 *    pero NO ve configuración, conexiones, agente, KB ni costos.
 *
 * La contraseña maestra (DASHBOARD_PASSWORD) SIGUE funcionando siempre — es el
 * acceso de la agencia/dueño y el rescate si el cliente se bloquea. Un bot sin
 * usuarios de panel se comporta EXACTO como antes (Basic Auth), cero cambios.
 *
 * Sin migración: tabla auto-creada (mismo patrón que la Bóveda). Sesión =
 * cookie firmada HMAC con llave derivada de DASHBOARD_PASSWORD — rotar la
 * contraseña maestra invalida todas las sesiones (a propósito).
 */

export type PanelRole = "master" | "admin" | "staff";

export interface PanelUser {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "staff";
  /** WhatsApp/teléfono de la persona — para avisarle escalamientos y tickets. */
  phone: string | null;
  /** Puesto/área (ej. "recepción", "ventas") — el bot lo usa al asignar. */
  puesto: string | null;
  /** Horario de atención "HH:MM-HH:MM" y días (1=lun…7=dom, CSV). Vacío = siempre. */
  horario: string | null;
  dias: string | null;
  /** Preferencias de aviso: JSON {escalamientos, tickets, reporte, resenas} + canal. */
  avisos: AvisoPrefs;
  created_at: number;
  last_login_at: number | null;
  /** true si aún no acepta la invitación (sin contraseña). */
  pendiente: boolean;
}

export interface AvisoPrefs {
  /** Por dónde avisar: whatsapp (si hay phone) | email | ninguno. */
  canal: "whatsapp" | "email" | "ninguno";
  escalamientos: boolean; // conversaciones escaladas / asignadas a mí
  tickets: boolean;       // tickets nuevos
  resenas: boolean;       // reseñas bajas
  reporte: boolean;       // reporte diario
}
export const AVISOS_DEFAULT: AvisoPrefs = { canal: "email", escalamientos: true, tickets: true, resenas: false, reporte: false };

export function parseAvisos(raw: string | null | undefined): AvisoPrefs {
  if (!raw) return { ...AVISOS_DEFAULT };
  try {
    const j = JSON.parse(raw);
    return {
      canal: j.canal === "whatsapp" || j.canal === "ninguno" ? j.canal : "email",
      escalamientos: j.escalamientos !== false,
      tickets: j.tickets !== false,
      resenas: j.resenas === true,
      reporte: j.reporte === true,
    };
  } catch { return { ...AVISOS_DEFAULT }; }
}

export const SESSION_COOKIE = "hz_panel";
const SESSION_TTL_MS = 14 * 24 * 3600_000;
// Sesión "master" nacida de un SSO de un solo uso (admin-link, app móvil /
// Modo Agencia): NO puede revocarse por session_version (uid "master" no es
// una fila real de panel_users — el middleware la salta, ver routes.ts), así
// que el único freno contra un cookie robado/filtrado es la fecha de
// vencimiento. TTL corto en vez de los 14 días normales de una sesión con
// password (esa SÍ es revocable con "cerrar sesión en todos lados").
export const MASTER_SSO_SESSION_TTL_MS = 8 * 3600_000;
const INVITE_TTL_MS = 7 * 24 * 3600_000;
const PBKDF2_ITERS = 100_000;

let ensured = false;
export async function ensurePanelUsersTable(db: Db): Promise<void> {
  if (ensured) return;
  await db.run(
    `CREATE TABLE IF NOT EXISTS panel_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
      role TEXT NOT NULL DEFAULT 'staff', phone TEXT, pass_hash TEXT, salt TEXT,
      invite_token TEXT, invite_expires INTEGER,
      created_at INTEGER NOT NULL, last_login_at INTEGER)`,
  );
  // Bots que crearon la tabla antes de estas columnas: ALTERs idempotentes
  // (SQLite no tiene ADD COLUMN IF NOT EXISTS — se traga el "duplicate column").
  for (const col of ["phone TEXT", "puesto TEXT", "horario TEXT", "dias TEXT", "avisos TEXT",
                     "reset_token TEXT", "reset_expires INTEGER", "session_version INTEGER NOT NULL DEFAULT 1",
                     "failed_logins INTEGER NOT NULL DEFAULT 0", "locked_until INTEGER"]) {
    await db.run(`ALTER TABLE panel_users ADD COLUMN ${col}`).catch(() => {});
  }
  // Bitácora: quién hizo qué en el panel (config, equipo, KB, conexiones…).
  await db.run(
    `CREATE TABLE IF NOT EXISTS panel_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
      actor_id TEXT, actor_label TEXT NOT NULL, accion TEXT NOT NULL, detalle TEXT)`,
  );
  await db.run("CREATE INDEX IF NOT EXISTS idx_panel_audit_at ON panel_audit(at)").catch(() => {});
  ensured = true;
}
/** Solo para tests: resetea el memo del CREATE TABLE. */
export function __resetEnsured(): void { ensured = false; }

// ── crypto (WebCrypto, sin dependencias) ─────────────────────────────────────

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERS },
    key, 256,
  );
  return hex(bits);
}

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
}

function timingSafeEq(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function randomToken(chars = 32): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(chars));
  let s = "";
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

const sessionKey = (env: Env) => `panel-session|${env.DASHBOARD_PASSWORD ?? ""}`;

/** Crea el valor de la cookie de sesión: `<uid>.<exp>.<ver>.<firma>`. `ver` es
 *  el session_version del usuario: "cerrar sesión en todos lados" lo incrementa
 *  y todas sus cookies previas dejan de validar. `ttlMs` default = sesión
 *  normal (14 días); los callers de SSO (admin-link) pasan
 *  MASTER_SSO_SESSION_TTL_MS porque esas sesiones no son revocables por
 *  session_version. */
export async function mintSession(
  env: Env,
  userId: string,
  now = Date.now(),
  version = 1,
  ttlMs = SESSION_TTL_MS,
): Promise<string> {
  const exp = now + ttlMs;
  const sig = await hmacHex(sessionKey(env), `${userId}.${exp}.${version}`);
  return `${userId}.${exp}.${version}.${sig}`;
}

/** Valida la cookie → {uid, version} ("master" para la contraseña maestra) o null.
 *  El caller compara `version` contra el session_version actual del usuario. */
export async function verifySession(
  env: Env,
  cookieValue: string | undefined,
  now = Date.now(),
): Promise<{ uid: string; version: number } | null> {
  if (!cookieValue || !env.DASHBOARD_PASSWORD) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 4) return null;
  const [uid, expRaw, verRaw, sig] = parts;
  const exp = Number(expRaw);
  const version = Number(verRaw);
  if (!Number.isFinite(exp) || exp < now || !Number.isFinite(version)) return null;
  const esperado = await hmacHex(sessionKey(env), `${uid}.${exp}.${version}`);
  return timingSafeEq(sig, esperado) ? { uid, version } : null;
}

/** session_version actual del usuario (1 si no existe la columna/usuario). */
export async function sessionVersion(db: Db, id: string): Promise<number | null> {
  await ensurePanelUsersTable(db);
  const r = await db.first<{ v: number }>("SELECT session_version AS v FROM panel_users WHERE id = ?", [id]);
  return r ? Number(r.v ?? 1) : null;
}

/** "Cerrar sesión en todos los dispositivos": invalida todas las cookies del usuario. */
export async function bumpSessionVersion(db: Db, id: string): Promise<void> {
  await ensurePanelUsersTable(db);
  await db.run("UPDATE panel_users SET session_version = COALESCE(session_version, 1) + 1 WHERE id = ?", [id]);
}

// ── usuarios ─────────────────────────────────────────────────────────────────

const rowToUser = (r: any): PanelUser => ({
  id: r.id, email: r.email, name: r.name ?? null, role: r.role === "admin" ? "admin" : "staff",
  phone: r.phone ?? null, puesto: r.puesto ?? null, horario: r.horario ?? null, dias: r.dias ?? null,
  avisos: parseAvisos(r.avisos), created_at: r.created_at, last_login_at: r.last_login_at ?? null, pendiente: !r.pass_hash,
});

export async function listPanelUsers(db: Db): Promise<PanelUser[]> {
  await ensurePanelUsersTable(db);
  const rows = await db.all<any>("SELECT * FROM panel_users ORDER BY created_at ASC");
  return rows.map(rowToUser);
}

/** ¿Hay al menos un usuario? (cache 60s por isolate — decide login-form vs Basic). */
let hayCache: { at: number; val: boolean } | null = null;
export async function hayPanelUsers(db: Db, now = Date.now()): Promise<boolean> {
  if (hayCache && now - hayCache.at < 60_000) return hayCache.val;
  await ensurePanelUsersTable(db);
  const row = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM panel_users");
  hayCache = { at: now, val: (row?.n ?? 0) > 0 };
  return hayCache.val;
}
export function __resetHayCache(): void { hayCache = null; }

export async function getPanelUser(db: Db, id: string): Promise<PanelUser | null> {
  await ensurePanelUsersTable(db);
  const r = await db.first<any>("SELECT * FROM panel_users WHERE id = ?", [id]);
  return r ? rowToUser(r) : null;
}

/** Alta: crea el usuario SIN contraseña + token de invitación (7 días). */
export async function createPanelUser(
  db: Db,
  input: { email: string; name?: string; role: "admin" | "staff" },
): Promise<{ ok: true; id: string; inviteToken: string } | { ok: false; error: string }> {
  await ensurePanelUsersTable(db);
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return { ok: false, error: "email inválido" };
  const existe = await db.first("SELECT id FROM panel_users WHERE email = ?", [email]);
  if (existe) return { ok: false, error: "ese correo ya tiene acceso" };
  const id = randomToken(12);
  const inviteToken = randomToken(32);
  await db.run(
    `INSERT INTO panel_users (id, email, name, role, invite_token, invite_expires, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, email, input.name?.trim() || null, input.role === "admin" ? "admin" : "staff",
     inviteToken, Date.now() + INVITE_TTL_MS, Date.now()],
  );
  __resetHayCache();
  return { ok: true, id, inviteToken };
}

/** Nueva invitación (resetea la contraseña: el usuario la define de nuevo). */
export async function resetInvite(db: Db, id: string): Promise<string | null> {
  await ensurePanelUsersTable(db);
  const inviteToken = randomToken(32);
  const r = await db.run(
    `UPDATE panel_users SET invite_token = ?, invite_expires = ?, pass_hash = NULL, salt = NULL WHERE id = ?`,
    [inviteToken, Date.now() + INVITE_TTL_MS, id],
  );
  return (r as any)?.meta?.changes === 0 ? null : inviteToken;
}

export async function deletePanelUser(db: Db, id: string): Promise<void> {
  await ensurePanelUsersTable(db);
  await db.run("DELETE FROM panel_users WHERE id = ?", [id]);
  __resetHayCache();
}

/** El invitado define su contraseña con el token (una sola vez, con vigencia). */
export async function acceptInvite(
  db: Db,
  token: string,
  password: string,
  perfil: { name?: string; phone?: string; puesto?: string; horario?: string; dias?: string | string[]; avisoCanal?: string } = {},
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  await ensurePanelUsersTable(db);
  if (password.length < 8) return { ok: false, error: "la contraseña necesita al menos 8 caracteres" };
  const r = await db.first<any>(
    "SELECT id, name, phone, invite_expires FROM panel_users WHERE invite_token = ?",
    [token],
  );
  if (!r) return { ok: false, error: "invitación inválida o ya usada" };
  if ((r.invite_expires ?? 0) < Date.now()) return { ok: false, error: "la invitación expiró — pide una nueva" };
  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  // El invitado puede completar/corregir su nombre y teléfono; si deja vacío,
  // se conserva lo que puso quien lo invitó.
  const name = perfil.name?.trim() || r.name || null;
  const phone = perfil.phone?.trim().replace(/[^\d+]/g, "") || r.phone || null;
  const puesto = perfil.puesto?.trim().slice(0, 60) || null;
  const horario = normalizaHorario(perfil.horario);
  const dias = normalizaDias(perfil.dias);
  const canal = perfil.avisoCanal === "whatsapp" && phone ? "whatsapp" : perfil.avisoCanal === "ninguno" ? "ninguno" : "email";
  const avisos = JSON.stringify({ ...AVISOS_DEFAULT, canal });
  await db.run(
    `UPDATE panel_users SET pass_hash = ?, salt = ?, name = ?, phone = ?, puesto = ?, horario = ?, dias = ?, avisos = ?,
       invite_token = NULL, invite_expires = NULL WHERE id = ?`,
    [hash, salt, name, phone, puesto, horario, dias, avisos, r.id],
  );
  return { ok: true, userId: r.id };
}

/** Datos previos de una invitación (para prellenar la página). null si no vale. */
export async function inviteInfo(db: Db, token: string): Promise<{ email: string; name: string | null; phone: string | null; role: "admin" | "staff" } | null> {
  await ensurePanelUsersTable(db);
  const r = await db.first<any>("SELECT email, name, phone, role, invite_expires FROM panel_users WHERE invite_token = ?", [token]);
  if (!r || (r.invite_expires ?? 0) < Date.now()) return null;
  return { email: r.email, name: r.name ?? null, phone: r.phone ?? null, role: r.role === "admin" ? "admin" : "staff" };
}

const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60_000;

/** Login por correo+contraseña → userId, "bloqueado" (5 fallos → 15 min) o null. */
export async function loginPanelUser(db: Db, email: string, password: string, now = Date.now()): Promise<string | "bloqueado" | null> {
  await ensurePanelUsersTable(db);
  const r = await db.first<any>(
    "SELECT id, pass_hash, salt, failed_logins, locked_until FROM panel_users WHERE email = ?",
    [email.trim().toLowerCase()],
  );
  if (!r?.pass_hash || !r?.salt) return null;
  if ((r.locked_until ?? 0) > now) return "bloqueado";
  const hash = await hashPassword(password, r.salt);
  if (!timingSafeEq(hash, r.pass_hash)) {
    const fallos = Number(r.failed_logins ?? 0) + 1;
    const lock = fallos >= MAX_FALLOS ? now + BLOQUEO_MS : null;
    await db.run("UPDATE panel_users SET failed_logins = ?, locked_until = ? WHERE id = ?", [lock ? 0 : fallos, lock, r.id]);
    return lock ? "bloqueado" : null;
  }
  await db.run("UPDATE panel_users SET last_login_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?", [now, r.id]);
  return r.id;
}

// ── recuperación de contraseña ───────────────────────────────────────────────
const RESET_TTL_MS = 60 * 60_000;

/** Emite un token de reset (1h) para el correo dado. Devuelve null si el correo
 *  no existe — el caller NUNCA revela eso al visitante (misma respuesta siempre). */
export async function issueResetToken(db: Db, email: string, now = Date.now()): Promise<{ id: string; token: string; name: string | null } | null> {
  await ensurePanelUsersTable(db);
  const r = await db.first<any>("SELECT id, name, pass_hash FROM panel_users WHERE email = ?", [email.trim().toLowerCase()]);
  if (!r?.pass_hash) return null; // inexistente o aún invitado sin contraseña
  const token = randomToken(32);
  await db.run("UPDATE panel_users SET reset_token = ?, reset_expires = ? WHERE id = ?", [token, now + RESET_TTL_MS, r.id]);
  return { id: r.id, token, name: r.name ?? null };
}

/** Consume el token de reset: nueva contraseña + invalida sesiones previas. */
export async function resetPassword(db: Db, token: string, password: string, now = Date.now()): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  await ensurePanelUsersTable(db);
  if (password.length < 8) return { ok: false, error: "la contraseña necesita al menos 8 caracteres" };
  const r = await db.first<any>("SELECT id, reset_expires FROM panel_users WHERE reset_token = ?", [token]);
  if (!r) return { ok: false, error: "link inválido o ya usado" };
  if ((r.reset_expires ?? 0) < now) return { ok: false, error: "el link expiró — pide uno nuevo" };
  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  await db.run(
    `UPDATE panel_users SET pass_hash = ?, salt = ?, reset_token = NULL, reset_expires = NULL,
       failed_logins = 0, locked_until = NULL, session_version = COALESCE(session_version, 1) + 1 WHERE id = ?`,
    [hash, salt, r.id],
  );
  return { ok: true, userId: r.id };
}

// ── bitácora ─────────────────────────────────────────────────────────────────
export interface AuditRow { id: number; at: number; actor_id: string | null; actor_label: string; accion: string; detalle: string | null }

/** Registra quién hizo qué. Best-effort: jamás tumba la acción que audita. */
export async function audit(db: Db, actor: { id?: string | null; label: string }, accion: string, detalle?: string): Promise<void> {
  try {
    await ensurePanelUsersTable(db);
    await db.run(
      "INSERT INTO panel_audit (at, actor_id, actor_label, accion, detalle) VALUES (?, ?, ?, ?, ?)",
      [Date.now(), actor.id ?? null, actor.label.slice(0, 120), accion.slice(0, 60), (detalle ?? "").slice(0, 500) || null],
    );
  } catch (e) {
    console.warn("[audit] no se pudo registrar:", e);
  }
}

export async function listAudit(db: Db, limit = 60): Promise<AuditRow[]> {
  await ensurePanelUsersTable(db);
  return db.all<AuditRow>("SELECT * FROM panel_audit ORDER BY at DESC LIMIT ?", [limit]);
}

/** El propio usuario edita su nombre/WhatsApp y, opcionalmente, su contraseña. */
export interface PerfilInput {
  name?: string; phone?: string; puesto?: string; horario?: string; dias?: string;
  avisos?: Partial<AvisoPrefs>; password?: string;
}

/** Valida "HH:MM-HH:MM"; vacío = sin horario (siempre disponible). */
export function normalizaHorario(h: string | undefined): string | null {
  const t = (h ?? "").trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [h1, m1, h2, m2] = [m[1], m[2], m[3], m[4]].map(Number);
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  return `${String(h1).padStart(2, "0")}:${m[2]}-${String(h2).padStart(2, "0")}:${m[4]}`;
}

/** Días como CSV de 1..7 (lun=1 … dom=7), ordenados y únicos. Vacío = todos. */
export function normalizaDias(d: string | string[] | undefined): string | null {
  const arr = Array.isArray(d) ? d : (d ?? "").split(",");
  const nums = [...new Set(arr.map((x) => parseInt(String(x), 10)).filter((n) => n >= 1 && n <= 7))].sort();
  return nums.length ? nums.join(",") : null;
}

/** El propio usuario (o el admin) edita perfil, horario, avisos y, opcionalmente, contraseña. */
export async function updateProfile(
  db: Db,
  id: string,
  input: PerfilInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePanelUsersTable(db);
  const actual = await db.first<any>("SELECT * FROM panel_users WHERE id = ?", [id]);
  if (!actual) return { ok: false, error: "usuario no encontrado" };
  const name = input.name !== undefined ? (input.name.trim() || null) : actual.name;
  const phone = input.phone !== undefined ? (input.phone.trim().replace(/[^\d+]/g, "") || null) : actual.phone;
  const puesto = input.puesto !== undefined ? (input.puesto.trim().slice(0, 60) || null) : actual.puesto;
  const horario = input.horario !== undefined ? normalizaHorario(input.horario) : actual.horario;
  const dias = input.dias !== undefined ? normalizaDias(input.dias) : actual.dias;
  const avisos = JSON.stringify({ ...parseAvisos(actual.avisos), ...(input.avisos ?? {}) });
  if (input.password !== undefined) {
    if (input.password.length < 8) return { ok: false, error: "la contraseña necesita al menos 8 caracteres" };
    const salt = randomToken(16);
    const hash = await hashPassword(input.password, salt);
    await db.run(
      "UPDATE panel_users SET name = ?, phone = ?, puesto = ?, horario = ?, dias = ?, avisos = ?, pass_hash = ?, salt = ? WHERE id = ?",
      [name, phone, puesto, horario, dias, avisos, hash, salt, id],
    );
  } else {
    await db.run(
      "UPDATE panel_users SET name = ?, phone = ?, puesto = ?, horario = ?, dias = ?, avisos = ? WHERE id = ?",
      [name, phone, puesto, horario, dias, avisos, id],
    );
  }
  return { ok: true };
}

/** ¿La persona está "en turno" ahora? Sin horario/días = siempre. */
export function enTurno(u: Pick<PanelUser, "horario" | "dias">, now: Date, tz: string): boolean {
  let hora = now.getHours() * 60 + now.getMinutes();
  let dia = now.getDay() === 0 ? 7 : now.getDay();
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? NaN);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const idx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd) + 1;
    if (Number.isFinite(h) && Number.isFinite(m)) hora = (h % 24) * 60 + m;
    if (idx >= 1) dia = idx;
  } catch { /* tz inválida: hora local del worker */ }
  if (u.dias && !u.dias.split(",").map(Number).includes(dia)) return false;
  if (!u.horario) return true;
  const [a, b] = u.horario.split("-");
  const toMin = (s: string) => { const [hh, mm] = s.split(":").map(Number); return hh * 60 + mm; };
  const ini = toMin(a), fin = toMin(b);
  return ini <= fin ? hora >= ini && hora < fin : hora >= ini || hora < fin; // cruza medianoche
}

/** Login con la contraseña MAESTRA desde el form (email vacío). Timing-safe. */
export function loginMaster(env: Env, password: string): boolean {
  const maestra = env.DASHBOARD_PASSWORD ?? "";
  if (!maestra) return false;
  return timingSafeEq(password, maestra);
}

/** Rol efectivo de una sesión: master (contraseña maestra) o el rol del usuario. */
export async function roleForSession(db: Db, uid: string): Promise<PanelRole | null> {
  if (uid === "master") return "master";
  const u = await getPanelUser(db, uid);
  return u ? u.role : null;
}
