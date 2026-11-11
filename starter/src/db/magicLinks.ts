import { Db } from "./client";

const TOKEN_TTL_MS = 15 * 60 * 1000;

/** Marker en `email` para tokens de SSO al panel (POST /api/admin-link → GET
 *  /admin/entrar/:token). No es un correo real: distingue esos tokens de
 *  cualquier uso futuro de magic links con email de verdad. */
export const SSO_MASTER_EMAIL = "sso@panel";

// La tabla se asegura LAZY (memoizada por isolate): `forjabot update` no
// re-ejecuta schema.sql y magic_links nunca se había usado en runtime — un bot
// viejo puede no tenerla. Mismo patrón que ensurePanelUsersTable (equipo.ts).
let ensured = false;
async function ensureTable(db: Db): Promise<void> {
  if (ensured) return;
  await db.run(
    `CREATE TABLE IF NOT EXISTS magic_links (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER)`,
  );
  ensured = true;
}

/** Solo para tests: resetea el memo del CREATE TABLE. */
export function __resetMagicLinksEnsured(): void {
  ensured = false;
}

export interface MagicLink {
  token: string;
  email: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class MagicLinksRepo {
  constructor(private readonly db: Db) {}

  async create(email: string, ttlMs = TOKEN_TTL_MS): Promise<string> {
    await ensureTable(this.db);
    const token = newToken();
    const now = Date.now();
    await this.db.run(
      "INSERT INTO magic_links (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
      [token, email.toLowerCase(), now, now + ttlMs],
    );
    return token;
  }

  /**
   * Canjea el token de un solo uso. ATÓMICO a propósito: la condición
   * "no usado todavía" vive en el WHERE del UPDATE (no en un SELECT previo)
   * — dos canjes concurrentes del MISMO token (dos pestañas, doble tap del
   * link de admin-link) antes hacían SELECT→check-en-JS→UPDATE, y los dos
   * podían leer `used_at IS NULL` antes de que cualquiera escribiera (TOCTOU):
   * ambos pasaban. Con el UPDATE condicionado, SQLite serializa las dos
   * escrituras — solo UNA cambia la fila, `meta.changes` lo confirma.
   */
  async consume(token: string): Promise<MagicLink | null> {
    await ensureTable(this.db);
    const now = Date.now();
    const res = await this.db.run(
      "UPDATE magic_links SET used_at = ? WHERE token = ? AND used_at IS NULL AND expires_at >= ?",
      [now, token, now],
    );
    if (res.meta.changes !== 1) return null;
    return this.db.first<MagicLink>("SELECT * FROM magic_links WHERE token = ?", [token]);
  }

  async purgeExpired(): Promise<number> {
    const res = await this.db.run(
      "DELETE FROM magic_links WHERE expires_at < ? OR used_at IS NOT NULL",
      [Date.now()],
    );
    return res.meta.changes ?? 0;
  }
}
