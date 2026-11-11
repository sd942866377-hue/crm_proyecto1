// Un "niche pack" personaliza el bot para un giro (restaurante, inmobiliaria…)
// sin forkear el código: BOT_NICHE elige el pack y éste re-etiqueta el dashboard,
// define columnas propias (que viven en lead.metadata JSON), aporta el playbook
// del giro para el prompt y un tono por defecto. Agregar un nicho = un archivo.
//
// ────────────────────────────────────────────────────────────────────────────
// TEXTO DE INTERFAZ = CLAVE DEL DICCIONARIO, NO TEXTO
// ────────────────────────────────────────────────────────────────────────────
// El panel se ve en 4 idiomas (src/admin/i18n.ts). Si un pack trae "Citas" a
// pelo, el dueño con el panel en inglés ve todo traducido MENOS su nicho. Por
// eso todo campo que se PINTA en el panel se declara como `ClaveI18n` (los
// campos terminan en `Key`) y se resuelve con `t()` donde se pinta:
//
//     const tr = traductor(env);
//     tr(niche.navLabelKey)              // "Appointments" / "Citas" / "Agendamentos"
//     tr(niche.statusLabelKeys[l.status])
//
// Convención de claves: `nicho.<id>.<campo>` — un namespace por pack, así el
// giro puede divergir en cada idioma sin arrastrar a los demás:
//
//     "nicho.barberia.registroSingular"  "nicho.barberia.registroPlural"
//     "nicho.barberia.nav"               "nicho.barberia.kpi"
//     "nicho.barberia.estadoNew"         "nicho.barberia.estadoContacted"
//     "nicho.barberia.estadoSold"        "nicho.barberia.estadoLost"
//     "nicho.barberia.colServicio"       // una por columna: col + su `key`
//
// Toda clave nueva va en ES419, EN y PT_BR (es-ES solo si España difiere de
// verdad). `test/admin/i18n.test.ts` falla si un diccionario se queda corto, y
// como el tipo es `ClaveI18n`, `pnpm typecheck` truena si la clave no existe.
//
// Lo que NO se traduce: `id` (se compara con BOT_NICHE), las llaves de
// `statusLabelKeys` (new/contacted/sold/lost viven en D1), `NicheColumn.key`
// (llave de lead.metadata), `navIcon`, `accent`, `playbook` (instrucciones para
// el modelo) y `kbDocs` (contenido de ejemplo del negocio).
import type { ClaveI18n } from "../admin/i18n";

export interface NicheColumn {
  /** Llave dentro de lead.metadata (JSON) de donde sale el valor. Es DATO
   *  persistido, no interfaz: no se traduce nunca. */
  key: string;
  /** Encabezado visible en la tabla → clave del diccionario. */
  labelKey: ClaveI18n;
}

export interface NichePack {
  /** id estable = valor de BOT_NICHE (ej. "restaurante"). NO se traduce. */
  id: string;
  /** Color de acento del dashboard (hex), el "toque único" de cada giro. El
   *  layout deriva accent-2 (más claro) y accent-soft (rgba) y los inyecta como
   *  CSS vars, así todo el panel se tiñe sin tocar cada vista. */
  accent: string;
  /** Cómo se llama UN registro capturado (singular/plural) — re-etiqueta "Lead". */
  recordSingularKey: ClaveI18n;
  recordPluralKey: ClaveI18n;
  /** Item del nav lateral (reemplaza "Leads"). */
  navLabelKey: ClaveI18n;
  /** Ícono lucide del nav. No es texto. */
  navIcon: string;
  /** KPI del Resumen (reemplaza "Leads captados"). */
  kpiLabelKey: ClaveI18n;
  /**
   * Re-etiqueta los 4 estados canónicos del lead para el pipeline del giro.
   * El enum de la columna `status` NO cambia (new|contacted|sold|lost) — solo
   * su presentación, así no hay migración ni se rompe el handler de estados.
   * Las LLAVES de este objeto son el enum de D1; solo el texto que apuntan
   * (vía diccionario) cambia por giro e idioma.
   */
  statusLabelKeys: { new: ClaveI18n; contacted: ClaveI18n; sold: ClaveI18n; lost: ClaveI18n };
  /** Columnas extra que se leen de lead.metadata (JSON), en orden. */
  columns: NicheColumn[];
  /** Playbook del giro que rellena {{NICHO_PLAYBOOK}} en el system prompt.
   *  Son instrucciones para el MODELO, no interfaz: se quedan en español. */
  playbook: string;
  /** Tono por defecto si el dueño no eligió uno en el panel. */
  defaultTone: string;
  /** Docs de KB sugeridos para el setup del giro (contenido de ejemplo). */
  kbDocs: string[];
}
