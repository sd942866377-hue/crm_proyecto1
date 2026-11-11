import type { Env } from "./env";

export function getBufferMs(env: Env): number {
  return Math.max(1000, parseInt(env.BUFFER_SECONDS, 10) * 1000);
}

export function isPro(env: Env): boolean {
  return env.BOT_TIER === "pro";
}

// Tools reservadas al tier Pro. captureLead NO está aquí a propósito: el bot
// Starter (free) captura leads — es su valor central. Lo Pro son las tools más
// avanzadas por nicho (agendar citas, consultar catálogo/inventario).
export const PRO_ONLY_TOOLS = [
  "scheduleAppointment",
  "catalogQuery",
] as const;

// Tabs del dashboard reservadas al tier Pro (Análisis + growth). El tier free
// ve un panel funcional (Resumen, Conversaciones, Leads, Tickets, Flujo, KB,
// Conexiones, Config) pero sin el Analista IA, métricas, costos, mejoras ni
// campañas — esos desbloquean con la comunidad.
export const PRO_ONLY_TABS = ["cobros", "insights", "stats", "costs", "mejoras", "campanas", "plantillas", "reviews", "boveda"] as const;

export function isToolAvailable(env: Env, toolName: string): boolean {
  if (!PRO_ONLY_TOOLS.includes(toolName as (typeof PRO_ONLY_TOOLS)[number])) return true;
  return isPro(env);
}

// Tabs que una agencia puede OCULTAR del panel de su cliente (env HIDDEN_TABS,
// CSV de ids del NAV de admin/views/layout.ts). "overview" no está a propósito:
// siempre debe quedar una tab de aterrizaje (el guard de rutas redirige ahí).
export const HIDEABLE_TABS = [
  "conversations", "boveda", "leads", "cobros", "tickets", "reviews", "campanas",
  "plantillas", "agente", "kb", "mejoras", "conexiones", "config",
  "insights", "stats", "costs", "equipo",
] as const;

/**
 * Ids de tabs ocultas por HIDDEN_TABS, ya validados (solo HIDEABLE_TABS; un id
 * mal escrito se ignora en silencio — el panel nunca se rompe por la var).
 * Gate técnico igual que el white-label: un bot free la ignora por completo.
 */
// Tabs que un usuario del panel con rol `staff` (Equipo) NO ve: solo opera —
// nada de configuración, conexiones, cerebro del agente ni costos. "equipo"
// también: solo el jefe (admin) administra accesos.
export const STAFF_HIDDEN_TABS = [
  "config", "conexiones", "agente", "kb", "mejoras", "costs", "campanas", "plantillas", "equipo",
] as const;

// Tabs que un staff NUNCA puede ver aunque el admin se las quiera dar: son
// las que cambian el bot, sus llaves o su dinero. Solo admin/master.
export const STAFF_LOCKED_TABS = ["config", "conexiones", "costs", "equipo"] as const;

/** Tabs ocultas para staff: el default (STAFF_HIDDEN_TABS) o lo que el admin
 *  configuró en la tab Equipo (setting `staff_tabs`, estampado en el env por
 *  el middleware de auth). Las STAFF_LOCKED_TABS se ocultan siempre. */
export function staffHiddenTabs(env: Env): string[] {
  const raw = (env as unknown as { PANEL_STAFF_TABS?: string }).PANEL_STAFF_TABS;
  let visibles: string[] | null = null;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) visibles = arr.map((x) => String(x).toLowerCase());
    } catch { /* setting corrupto: default */ }
  }
  const base = visibles === null
    ? [...STAFF_HIDDEN_TABS]
    : (HIDEABLE_TABS as readonly string[]).filter((id) => !visibles!.includes(id));
  return [...new Set([...base, ...STAFF_LOCKED_TABS])];
}

export function hiddenTabs(env: Env): string[] {
  // El rol de la sesión lo estampa el middleware de auth en el env request-scoped
  // (mismo patrón que applyPanelLanguage). Merge: staff se suma a lo que la
  // agencia ya ocultó — así UN solo punto gobierna nav Y guard de rutas.
  const rol = (env as unknown as { PANEL_ROLE?: string }).PANEL_ROLE;
  const porRol = rol === "staff" ? staffHiddenTabs(env) : [];
  if (!isPro(env) || !env.HIDDEN_TABS) return porRol;
  const agencia = env.HIDDEN_TABS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => (HIDEABLE_TABS as readonly string[]).includes(s));
  return [...new Set([...agencia, ...porRol])];
}
