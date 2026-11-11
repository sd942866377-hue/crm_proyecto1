import { businessConfig } from "../member/config.local";

export type BusinessConfig = typeof businessConfig;

export function renderBusinessContext(cfg: BusinessConfig = businessConfig): string {
  // Cada línea es opcional: si el miembro saltó ese dato en el onboarding, no la
  // metemos (evita "Servicios y precios:" o "Métodos de pago:" vacíos en el prompt).
  const lines: string[] = [];
  if (cfg.hours) lines.push(`Horarios: ${cfg.hours}`);
  if (cfg.services?.length) {
    lines.push(`Servicios y precios:\n${cfg.services.map((s) => `${s.name}: $${s.price}`).join("\n")}`);
  }
  if (cfg.location) lines.push(`Ubicación: ${cfg.location}`);
  if (cfg.paymentMethods?.length) lines.push(`Métodos de pago: ${cfg.paymentMethods.join(", ")}`);
  if (cfg.contactPhone) lines.push(`Teléfono: ${cfg.contactPhone}`);
  for (const [k, v] of Object.entries(cfg.customFields ?? {})) {
    if (v) lines.push(`${k}: ${v}`);
  }
  return lines.join("\n");
}

/** Texto libre de horarios que trae `member/config.local` (pre-Wiring v2). Solo
 *  lectura — GET /api/hours lo expone como `legacy_hours` de referencia; NUNCA
 *  se borra cuando el dueño configura el horario estructurado desde la app. */
export function legacyHours(cfg: BusinessConfig = businessConfig): string | null {
  return cfg.hours || null;
}

/** Ubicación/dirección del negocio tal como la dejó el onboarding en
 *  `member/config.local` — la MISMA fuente que la línea "Ubicación:" del
 *  business context (arriba), no un campo paralelo. Solo lectura: GET
 *  /api/config la expone como `address` para la pantalla "¿Este es tu
 *  negocio?" del onboarding del dueño. */
export function businessLocation(cfg: BusinessConfig = businessConfig): string | null {
  return cfg.location?.trim() || null;
}

// ── Horario estructurado (Forja Inbox móvil, setting `business_hours`) ──────
export const BUSINESS_HOURS_DAY_KEYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;
export type BusinessHoursDayKey = (typeof BUSINESS_HOURS_DAY_KEYS)[number];
export interface BusinessHoursSlot {
  from: string; // "HH:MM"
  to: string; // "HH:MM"
}
// Cómo trabaja el negocio (lo elige el dueño en "Disponibilidad" de la app).
// `hours` es el default histórico (había horario y ya). always_on = SaaS/24-7;
// appointments = agenda citas.
export type BusinessHoursMode = "always_on" | "hours" | "appointments";
export const BUSINESS_HOURS_MODES: readonly BusinessHoursMode[] = [
  "always_on",
  "hours",
  "appointments",
];

/** Un servicio agendable (modo citas): el dueño lo edita desde la app. */
export interface AppointmentService {
  id: string;
  name: string;
  durationMin: number;
}

export interface BusinessHours {
  days: Record<BusinessHoursDayKey, BusinessHoursSlot | null>;
  awayMessage?: string;
  mode?: BusinessHoursMode;
  /** IANA tz (ej. "America/Mexico_City"). Vacío = cae al env del bot. La usan el
   *  "hoy" del bot y las citas para no equivocarse de hora. */
  timezone?: string;
  /** Servicios agendables (modo citas). Máx razonable; el bot los menciona. */
  services?: AppointmentService[];
}

/** Sanea/valida una lista de servicios que manda la app. Silencioso: descarta
 *  los inválidos, cap 30, nombre ≤80, duración 5..600 min. */
export function sanitizeServices(v: unknown): AppointmentService[] {
  if (!Array.isArray(v)) return [];
  const out: AppointmentService[] = [];
  for (const raw of v.slice(0, 30)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
    const dur = Number(r.durationMin ?? r.duration_min);
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 40) : name;
    if (!name || !Number.isFinite(dur) || dur < 5 || dur > 600) continue;
    out.push({ id, name, durationMin: Math.round(dur) });
  }
  return out;
}

/** Valida un IANA tz de forma barata (sin lista dura, para no re-subir la app al
 *  agregar zonas): que Intl la acepte. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DAY_LABELS: Record<BusinessHoursDayKey, string> = {
  lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom",
};

function sameSlot(a: BusinessHoursSlot | null, b: BusinessHoursSlot | null): boolean {
  if (a === null && b === null) return true;
  if (!a || !b) return false;
  return a.from === b.from && a.to === b.to;
}

/**
 * Renderiza el horario estructurado en una línea legible para el prompt,
 * agrupando días consecutivos con el mismo horario (ej. "Lun–Vie 10:00–20:00,
 * Sáb 9:00–18:00, Dom cerrado"). Se usa en settings-loader.ts, agregado AL
 * FINAL del business_context existente (nunca lo reemplaza — regla: no
 * destruir config del dueño) con precedencia explícita de lectura.
 */
export function renderBusinessHoursBlock(hours: BusinessHours): string {
  const groups: { label: string; range: string }[] = [];
  let i = 0;
  while (i < BUSINESS_HOURS_DAY_KEYS.length) {
    const day = BUSINESS_HOURS_DAY_KEYS[i];
    const slot = hours.days[day] ?? null;
    const range = slot ? `${slot.from}–${slot.to}` : "cerrado";
    let j = i;
    while (
      j + 1 < BUSINESS_HOURS_DAY_KEYS.length &&
      sameSlot(hours.days[BUSINESS_HOURS_DAY_KEYS[j + 1]] ?? null, slot)
    ) {
      j++;
    }
    const label = i === j ? DAY_LABELS[day] : `${DAY_LABELS[day]}–${DAY_LABELS[BUSINESS_HOURS_DAY_KEYS[j]]}`;
    groups.push({ label, range });
    i = j + 1;
  }
  const hasOpen = groups.some((g) => g.range !== "cerrado");
  let block: string;
  if (hours.mode === "always_on") {
    // 24/7: el negocio no cierra; que el bot no invente horarios de cierre.
    block = "El negocio atiende de forma continua (24/7); no menciones horarios de cierre.";
  } else if (hasOpen || hours.mode === "hours") {
    block = `Horario estructurado (fuente de verdad para horarios si contradice el texto de arriba): ${groups
      .map((g) => `${g.label} ${g.range}`)
      .join(", ")}.`;
    const away = hours.awayMessage?.trim();
    if (away) block += ` Fuera de este horario di algo como: "${away}"`;
  } else {
    // Modo citas sin horario abierto declarado: no inventes "todo cerrado".
    block = "";
  }
  // Servicios agendables (modo citas): que el bot los conozca y los ofrezca.
  const services = hours.services ?? [];
  if (services.length) {
    block += ` Servicios que se pueden agendar: ${services
      .map((s) => `${s.name} (${s.durationMin} min)`)
      .join(", ")}.`;
  }
  return block.trim();
}
