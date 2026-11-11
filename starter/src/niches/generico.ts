import type { NichePack } from "./types";

// Pack por defecto = comportamiento actual del bot (soporte & ventas genérico).
// Es lo que ve un bot sin BOT_NICHE o con un nicho desconocido. No fuerza
// tono/playbook: el dashboard sigue diciendo "Leads" (en el idioma del panel).
//
// Este pack es la REFERENCIA del patrón: todo texto que se pinta en el panel es
// una clave del diccionario (`nicho.<id>.<campo>`, ver src/niches/types.ts) y se
// resuelve con `t()` en la vista. Sus claves viven en ES419/EN/PT_BR de
// src/admin/i18n.ts.
export const generico: NichePack = {
  id: "generico",
  accent: "#f07a3f",
  recordSingularKey: "nicho.generico.registroSingular",
  recordPluralKey: "nicho.generico.registroPlural",
  navLabelKey: "nicho.generico.nav",
  navIcon: "user-plus",
  kpiLabelKey: "nicho.generico.kpi",
  statusLabelKeys: {
    new: "nicho.generico.estadoNew",
    contacted: "nicho.generico.estadoContacted",
    sold: "nicho.generico.estadoSold",
    lost: "nicho.generico.estadoLost",
  },
  // Sin columnas propias: el genérico muestra el "Resumen" de la IA. Un pack con
  // columnas las declara así (la `key` es dato de lead.metadata, no se traduce):
  //   columns: [{ key: "servicio", labelKey: "nicho.barberia.colServicio" }],
  columns: [],
  playbook: "",
  defaultTone: "",
  kbDocs: [],
};
