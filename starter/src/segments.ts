/**
 * Segmentación de audiencias (modo evento) — la moneda de las campañas.
 *
 * Cada segmento es una consulta sobre datos que el bot YA captura: keywords,
 * clicks en links trackeados, etiquetas de la minería (interés/objeción) y
 * actividad. Cada miembro sale con `inWindow`: si su último mensaje fue hace
 * <24h, WhatsApp permite responderle free-form (gratis, sin plantilla); si no,
 * hay que usar plantilla HSM aprobada (cuenta contra el límite diario del
 * número — p.ej. 250 conversaciones iniciadas por el negocio cada 24h).
 */
import { Db } from "./db/client";
import type { Traductor } from "./admin/i18n";

export interface SegmentMember {
  conversationId: string;
  channel: string;
  channelUserId: string;
  name: string | null;
  lastUserAt: number;
  inWindow: boolean;
}

export interface SegmentDef {
  id: string;
  label: string;
  desc: string;
}

/**
 * Los ids son datos: viajan en el formulario de campañas y se guardan con el
 * envío. NUNCA se traducen — solo el texto de pantalla (label/desc).
 */
const SEGMENT_IDS = [
  "quiero_sin_click",
  "click_oferta",
  "calientes",
  "tibios",
  "objecion_precio",
  "objecion_tiempo",
  "interes_forja",
  "todos",
] as const;

/** Los segmentos con su texto en el idioma del panel (para pintarlos). */
export function segments(tr: Traductor): SegmentDef[] {
  return [
    {
      id: "quiero_sin_click",
      label: tr("campanas.segQuieroSinClickLabel"),
      desc: tr("campanas.segQuieroSinClickDesc"),
    },
    {
      id: "click_oferta",
      label: tr("campanas.segClickOfertaLabel"),
      desc: tr("campanas.segClickOfertaDesc"),
    },
    {
      id: "calientes",
      label: tr("campanas.segCalientesLabel"),
      desc: tr("campanas.segCalientesDesc"),
    },
    {
      id: "tibios",
      label: tr("campanas.segTibiosLabel"),
      desc: tr("campanas.segTibiosDesc"),
    },
    {
      id: "objecion_precio",
      label: tr("campanas.segObjecionPrecioLabel"),
      desc: tr("campanas.segObjecionPrecioDesc"),
    },
    {
      id: "objecion_tiempo",
      label: tr("campanas.segObjecionTiempoLabel"),
      desc: tr("campanas.segObjecionTiempoDesc"),
    },
    {
      id: "interes_forja",
      label: tr("campanas.segInteresForjaLabel"),
      desc: tr("campanas.segInteresForjaDesc"),
    },
    {
      id: "todos",
      label: tr("campanas.segTodosLabel"),
      desc: tr("campanas.segTodosDesc"),
    },
  ];
}

const WINDOW_MS = 24 * 3600_000;
// Margen: no mandamos free-form si la ventana cierra en <1h (riesgo de rebote).
const WINDOW_SAFE_MS = 23 * 3600_000;

const MEMBER_SELECT = `
  SELECT c.id AS conversationId, c.channel AS channel, c.channel_user_id AS channelUserId,
         c.display_name AS name, MAX(m.created_at) AS lastUserAt
  FROM conversations c
  JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
  -- El chat de prueba de la app nunca es audiencia (ver db/testFilter.ts). Va en
  -- el ON del JOIN porque cada segmento aporta su propio WHERE.
  AND c.channel != 'test'`;

function whereFor(segmentId: string): { joins: string; where: string } {
  switch (segmentId) {
    case "quiero_sin_click":
      return {
        joins: "",
        where: `WHERE c.id IN (SELECT conversation_id FROM keyword_hits WHERE keyword = 'QUIERO')
          AND c.id NOT IN (SELECT conversation_id FROM tracked_links WHERE target = 'oferta' AND clicks > 0)`,
      };
    case "click_oferta":
      return {
        joins: "",
        where: `WHERE c.id IN (SELECT conversation_id FROM tracked_links WHERE target = 'oferta' AND clicks > 0)`,
      };
    case "calientes":
      return {
        joins: "JOIN conv_labels l ON l.conversation_id = c.id",
        where: "WHERE l.interest = 'caliente'",
      };
    case "tibios":
      return {
        joins: "JOIN conv_labels l ON l.conversation_id = c.id",
        where: "WHERE l.interest = 'tibio'",
      };
    case "objecion_precio":
      return {
        joins: "JOIN conv_labels l ON l.conversation_id = c.id",
        where: "WHERE l.objection = 'precio'",
      };
    case "objecion_tiempo":
      return {
        joins: "JOIN conv_labels l ON l.conversation_id = c.id",
        where: "WHERE l.objection = 'tiempo'",
      };
    case "interes_forja":
      return {
        joins: "",
        where: `WHERE c.id IN (
            SELECT conversation_id FROM messages
            WHERE role = 'user' AND created_at > (strftime('%s','now') - 24*3600) * 1000
              AND (lower(content) LIKE '%forja%'
                OR lower(content) LIKE '%membres%'
                OR lower(content) LIKE '%precio%'
                OR lower(content) LIKE '%cuesta%'
                OR lower(content) LIKE '%comunidad%')
          )
          AND c.id NOT IN (
            SELECT conversation_id FROM messages
            WHERE role = 'user'
              AND (lower(content) LIKE '%ya me un%'
                OR lower(content) LIKE '%ya entr%'
                OR lower(content) LIKE '%ya pagu%'
                OR lower(content) LIKE '%ya compr%'
                OR lower(content) LIKE '%ya soy miembro%')
          )
          AND (c.paused_until IS NULL OR c.paused_until < strftime('%s','now') * 1000)`,
      };
    case "todos":
      return { joins: "", where: "" };
    default:
      throw new Error(`segmento desconocido: ${segmentId}`);
  }
}

/** Miembros de un segmento, cada uno con su estado de ventana de 24h. */
export async function segmentMembers(
  db: Db,
  segmentId: string,
  now = Date.now(),
): Promise<SegmentMember[]> {
  const { joins, where } = whereFor(segmentId);
  const rows = await db.all<Omit<SegmentMember, "inWindow">>(
    `${MEMBER_SELECT}
     ${joins}
     ${where}
     GROUP BY c.id
     ORDER BY lastUserAt DESC`,
  );
  return rows.map((r) => ({
    ...r,
    inWindow: now - r.lastUserAt < WINDOW_SAFE_MS,
  }));
}

export interface SegmentCount {
  id: string;
  total: number;
  inWindow: number;
  outWindow: number;
}

/**
 * Conteos de todos los segmentos (para pintar la página de campañas).
 * Solo números: el texto lo pone la vista con `segments(tr)`.
 */
export async function segmentCounts(db: Db, now = Date.now()): Promise<SegmentCount[]> {
  const out: SegmentCount[] = [];
  for (const id of SEGMENT_IDS) {
    const members = await segmentMembers(db, id, now);
    const inW = members.filter((m) => m.inWindow).length;
    out.push({
      id,
      total: members.length,
      inWindow: inW,
      outWindow: members.length - inW,
    });
  }
  return out;
}

export { WINDOW_MS, WINDOW_SAFE_MS };
