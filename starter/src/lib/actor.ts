/**
 * Quién está usando la app (Contrato v3.2 §2). La nube manda en cada llamada
 * el header `X-Forja-Actor` con la identidad del sujeto; el bot NO depende de
 * ella para nada — solo la anota, para que la bandeja pueda decir "Beto la está
 * atendiendo" en vez de un "modo humano" anónimo, y para que la bitácora del
 * panel muestre quién tocó qué desde el teléfono.
 *
 * Lo comparten el inbox móvil (api-inbox.ts) y el Centro de Mantenimiento
 * (api-maintenance.ts): una sola forma de leer el header y una sola etiqueta
 * "<actor> (app)" en la bitácora.
 */
import type { Context } from "hono";
import type { Env } from "../env";
import type { Db } from "../db/client";
import { fromBase64Unicode } from "./cursor";

export interface Actor {
  id: string;
  name: string;
}

export const ACTOR_HEADER = "X-Forja-Actor";

/** `X-Forja-Actor: <base64url(JSON {id,name})>` → Actor. null si falta o viene mal. */
export function readActor(c: Context<{ Bindings: Env }>): Actor | null {
  const raw = c.req.header(ACTOR_HEADER);
  if (!raw) return null;
  try {
    // base64url → base64 (y el padding que el estándar se ahorra).
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(fromBase64Unicode(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
    const id = String(parsed?.id ?? "").trim().slice(0, 120);
    const name = String(parsed?.name ?? "").trim().slice(0, 60);
    return id && name ? { id, name } : null;
  } catch {
    return null;
  }
}

/** Deja constancia en la bitácora del panel. Best-effort: nunca tumba la acción. */
export async function auditApp(
  db: Db,
  actor: Actor | null,
  accion: string,
  detalle: string,
): Promise<void> {
  if (!actor) return;
  try {
    const { audit } = await import("../admin/equipo");
    // El id es el del sujeto de la nube, NO un panel_users.id: va como null
    // para no ensuciar la relación, y el "(app)" en la etiqueta dice de dónde vino.
    await audit(db, { id: null, label: `${actor.name} (app)` }, accion, detalle);
  } catch {
    /* la bitácora es un extra, no la ruta crítica */
  }
}
