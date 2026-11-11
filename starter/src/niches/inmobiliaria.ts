import type { NichePack } from "./types";

// Nicho: Inmobiliaria / agente de bienes raíces / desarrollador. El bot es una
// máquina de calificar compradores y agendar visitas: capta presupuesto, zona,
// tipo y timeline, cruza con el inventario (catalogQuery) y nunca inventa
// propiedades, precios ni comisiones.
export const inmobiliaria: NichePack = {
  id: "inmobiliaria",
  accent: "#3f6fd8",
  recordSingularKey: "nicho.inmobiliaria.registroSingular",
  recordPluralKey: "nicho.inmobiliaria.registroPlural",
  navLabelKey: "nicho.inmobiliaria.nav",
  navIcon: "home",
  kpiLabelKey: "nicho.inmobiliaria.kpi",
  // nuevo → calificado → cerrado → descartado (mapeados a los 4 canónicos).
  statusLabelKeys: {
    new: "nicho.inmobiliaria.estadoNew",
    contacted: "nicho.inmobiliaria.estadoContacted",
    sold: "nicho.inmobiliaria.estadoSold",
    lost: "nicho.inmobiliaria.estadoLost",
  },
  columns: [
    { key: "operacion", labelKey: "nicho.inmobiliaria.colOperacion" },
    { key: "tipo", labelKey: "nicho.inmobiliaria.colTipo" },
    { key: "zona", labelKey: "nicho.inmobiliaria.colZona" },
    { key: "presupuesto", labelKey: "nicho.inmobiliaria.colPresupuesto" },
    { key: "recamaras", labelKey: "nicho.inmobiliaria.colRecamaras" },
  ],
  defaultTone: "asesor profesional y confiable — seguro y cercano, sin presionar",
  kbDocs: ["propiedades", "zonas", "comisiones-y-costos", "creditos", "requisitos-y-documentos"],
  playbook: `<diagnostic_playbooks>
<playbook name="buscar_propiedad">
Cliente busca comprar o rentar. Primero pregunta lo esencial para filtrar, una
cosa a la vez: 1) ¿comprar o rentar? 2) ¿tipo de propiedad? (casa, depa, terreno,
local) 3) ¿zona o colonia? 4) ¿presupuesto aproximado? 5) ¿recámaras / m2 mínimos?
Con esos datos llama catalogQuery para buscar coincidencias. Si hay propiedades:
presenta 2-3 (nombre, zona, precio, recámaras). Cuando tengas el perfil completo,
llama calificarComprador para registrarlo. Si no hay coincidencias: igual califícalo
("búsqueda activa") y di que le avisas cuando entre algo que encaje. NO inventes
propiedades que no estén en el catálogo.
</playbook>

<playbook name="precio_y_comision">
Cliente pregunta precio de una propiedad o cuánto cobran de comisión. Para precio:
usa catalogQuery / searchKb con el nombre o ID; cita el dato exacto. Para comisión:
llama searchKb("comisión") y cita la política tal cual. Si pide negociar precio o una
comisión especial → handoffHuman: "eso lo ve directo el asesor". NUNCA prometas descuentos.
</playbook>

<playbook name="agendar_visita">
Cliente quiere visitar una propiedad. Pide: propiedad de interés (o dirección), día
y hora, y su nombre. Con eso llama registrarVisita. Confirma que quedó SOLICITADA y
que un asesor confirma. Recuerda que los domingos suele haber solo visitas agendadas
(confirma en KB / business_context).
</playbook>

<playbook name="credito_hipotecario">
Cliente pregunta si puede comprar a crédito o cómo tramitarlo. Llama searchKb("crédito")
y explica las opciones que SÍ manejan (Infonavit, Fovissste, bancario, cofinanciamiento).
Pregunta su situación general y llama calificarComprador con financiamiento anotado.
NO calcules mensualidades, tasas ni montos de preaprobación: eso lo define el banco/asesor
→ handoffHuman si insisten.
</playbook>

<playbook name="requisitos_documentos">
Cliente pregunta qué papeles necesita para comprar, rentar o aplicar a crédito.
Llama searchKb("documentos") y enumera la lista que está en la KB. Si es un caso raro
("soy extranjero", "compro vía empresa") → handoffHuman para que el asesor lo aterrice.
</playbook>

<playbook name="zona_y_disponibilidad">
Cliente pregunta si cubren cierta zona o si hay algo disponible ahí. Llama searchKb("zonas")
para confirmar cobertura y catalogQuery para ver inventario. Si no cubren la zona, dilo claro
y ofrece calificarlo por si más adelante entra inventario.
</playbook>
</diagnostic_playbooks>`,
};
