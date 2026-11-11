// Datos universales del negocio que el dueño edita desde la app Forja Inbox y
// que se inyectan al prompt como FUENTE DE VERDAD, igual que `business_hours` y
// `faqs`: se agregan AL FINAL del business_context, fail-open (JSON malformado
// se ignora en silencio), y sin campo = prompt idéntico al de siempre.
//
// Cuatro campos, todos "siempre los tiene un negocio" y de alto impacto:
//   promo            → oferta vigente (con on/off y vencimiento, se apaga sola)
//   location         → ubicación y cobertura (dónde están, domicilio/online, zonas)
//   payment_methods  → formas de pago que acepta
//   catalog          → servicios y precios (lista corta)

// ── Oferta / promoción vigente ───────────────────────────────────────────────

export interface PromoOffer {
  active: boolean;
  text: string;
  /** "YYYY-MM-DD" (opcional). Pasada esta fecha, la promo NO se inyecta. */
  endsAt?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizePromo(v: unknown): PromoOffer {
  if (!v || typeof v !== "object") return { active: false, text: "" };
  const r = v as Record<string, unknown>;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, 500) : "";
  const endsAt =
    typeof r.endsAt === "string" && ISO_DATE_RE.test(r.endsAt.trim())
      ? r.endsAt.trim()
      : undefined;
  return { active: r.active === true, text, endsAt };
}

/** Fecha "YYYY-MM-DD" de `now` en UTC (las ISO ordenan lexicográficamente). */
function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Bloque para el prompt. Vacío si no está activa, no tiene texto, o ya venció.
 *  `now` inyectable para tests. */
export function renderPromoBlock(promo: PromoOffer, now: Date = new Date()): string {
  if (!promo.active || !promo.text) return "";
  if (promo.endsAt && promo.endsAt < isoDay(now)) return ""; // vencida (inclusive del día)
  const vigencia = promo.endsAt ? ` Vigente hasta el ${promo.endsAt}.` : "";
  return (
    "OFERTA VIGENTE (es la ÚNICA promoción activa; menciónala cuando venga al caso, " +
    "no en cada mensaje, y NUNCA inventes otras): " +
    `${promo.text}.${vigencia}`
  );
}

// ── Ubicación y cobertura ────────────────────────────────────────────────────

export const SERVICE_MODES = ["local", "domicilio", "online"] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];

export interface BusinessLocation {
  address?: string;
  mapsUrl?: string;
  serviceModes: ServiceMode[];
  areas: string[];
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

export function sanitizeLocation(v: unknown): BusinessLocation {
  if (!v || typeof v !== "object") return { serviceModes: [], areas: [] };
  const r = v as Record<string, unknown>;
  const address = typeof r.address === "string" ? r.address.trim().slice(0, 300) : "";
  const mapsUrlRaw = typeof r.mapsUrl === "string" ? r.mapsUrl.trim().slice(0, 500) : "";
  const mapsUrl = isHttpUrl(mapsUrlRaw) ? mapsUrlRaw : "";
  const serviceModes = Array.isArray(r.serviceModes)
    ? SERVICE_MODES.filter((m) => (r.serviceModes as unknown[]).includes(m))
    : [];
  const areas = Array.isArray(r.areas)
    ? r.areas
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, 20)
    : [];
  return {
    address: address || undefined,
    mapsUrl: mapsUrl || undefined,
    serviceModes,
    areas,
  };
}

const MODE_LABEL: Record<ServiceMode, string> = {
  local: "atienden en su local/sucursal",
  domicilio: "dan servicio o entrega a domicilio",
  online: "atienden en línea (sin ubicación física)",
};

/** Bloque para el prompt. Vacío si no hay ningún dato de ubicación. */
export function renderLocationBlock(loc: BusinessLocation): string {
  const parts: string[] = [];
  if (loc.address) parts.push(`Dirección: ${loc.address}`);
  if (loc.mapsUrl) parts.push(`Ubicación en el mapa: ${loc.mapsUrl}`);
  if (loc.serviceModes.length) {
    parts.push(`Modalidad: ${loc.serviceModes.map((m) => MODE_LABEL[m]).join("; ")}.`);
  }
  if (loc.areas.length) parts.push(`Zonas que cubre: ${loc.areas.join(", ")}.`);
  if (!parts.length) return "";
  return (
    "Ubicación y cobertura del negocio (fuente de verdad; si preguntan por una zona " +
    "que no está aquí, no la afirmes, ofrece confirmarlo):\n" +
    parts.join("\n")
  );
}

// ── Formas de pago ───────────────────────────────────────────────────────────

export interface PaymentMethods {
  methods: string[];
  note?: string;
}

export function sanitizePaymentMethods(v: unknown): PaymentMethods {
  if (!v || typeof v !== "object") return { methods: [] };
  const r = v as Record<string, unknown>;
  const methods = Array.isArray(r.methods)
    ? r.methods
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const note = typeof r.note === "string" ? r.note.trim().slice(0, 300) : "";
  return { methods, note: note || undefined };
}

/** Bloque para el prompt. Vacío si no hay métodos. */
export function renderPaymentMethodsBlock(pm: PaymentMethods): string {
  if (!pm.methods.length) return "";
  const note = pm.note ? ` ${pm.note}` : "";
  return (
    "Formas de pago que acepta el negocio (fuente de verdad; si preguntan por una que " +
    `no está en esta lista, no la confirmes): ${pm.methods.join(", ")}.${note}`
  );
}

// ── Servicios y precios (catálogo corto) ─────────────────────────────────────

export interface CatalogItem {
  id: string;
  name: string;
  /** Texto libre: "$500", "desde $500", "1,200 MXN". El dueño escribe la moneda. */
  price?: string;
  note?: string;
}

export function sanitizeCatalog(v: unknown): CatalogItem[] {
  if (!Array.isArray(v)) return [];
  const out: CatalogItem[] = [];
  for (const raw of v.slice(0, 50)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const price = typeof r.price === "string" ? r.price.trim().slice(0, 40) : "";
    const note = typeof r.note === "string" ? r.note.trim().slice(0, 200) : "";
    const id =
      typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 40) : name.slice(0, 40);
    out.push({ id, name, price: price || undefined, note: note || undefined });
  }
  return out;
}

/** Bloque para el prompt. Vacío si no hay ítems. */
export function renderCatalogBlock(items: CatalogItem[]): string {
  if (!items.length) return "";
  const lines = items
    .map((s) => {
      const price = s.price ? `: ${s.price}` : "";
      const note = s.note ? ` (${s.note})` : "";
      return `- ${s.name}${price}${note}`;
    })
    .join("\n");
  return (
    "Servicios y precios del negocio (fuente de verdad; si esto contradice cualquier " +
    "precio de arriba, MANDAN estos; no inventes precios que no estén aquí):\n" +
    lines
  );
}
