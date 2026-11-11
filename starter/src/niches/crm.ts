import type { NichePack } from "./types";

// Nicho: CRM / ventas B2B (agencias, consultores, freelancers, PYMEs que venden
// servicios). El bot es un SDR: atiende prospectos entrantes, los califica (necesidad,
// presupuesto, para cuándo, quién decide), agenda la llamada y los mete al pipeline con
// registrarProspecto. No cierra la venta ni cotiza en firme — eso lo hace el dueño.
export const crm: NichePack = {
  id: "crm",
  accent: "#6260e0",
  recordSingularKey: "nicho.crm.registroSingular",
  recordPluralKey: "nicho.crm.registroPlural",
  navLabelKey: "nicho.crm.nav",
  navIcon: "trending-up",
  kpiLabelKey: "nicho.crm.kpi",
  // nuevo → calificado → ganado(cerró) → perdido
  statusLabelKeys: {
    new: "nicho.crm.estadoNew",
    contacted: "nicho.crm.estadoContacted",
    sold: "nicho.crm.estadoSold",
    lost: "nicho.crm.estadoLost",
  },
  columns: [
    { key: "empresa", labelKey: "nicho.crm.colEmpresa" },
    { key: "necesidad", labelKey: "nicho.crm.colNecesidad" },
    { key: "presupuesto", labelKey: "nicho.crm.colPresupuesto" },
  ],
  defaultTone: "profesional y consultivo — hace buenas preguntas, agenda la llamada, no presiona ni suena a robot de ventas",
  kbDocs: ["servicios-y-paquetes", "precios-y-alcance", "casos-y-resultados", "proceso-de-trabajo", "preguntas-frecuentes"],
  playbook: `<diagnostic_playbooks>
<playbook name="calificar_prospecto">
Alguien pregunta por los servicios o dice que necesita ayuda. Tu meta es CALIFICAR y
agendar, no cerrar por chat. Averigua en pocos turnos, una cosa a la vez: 1) qué
necesita/qué problema quiere resolver, 2) de qué empresa o proyecto, 3) presupuesto o
rango de inversión (si lo comparte), 4) para cuándo lo necesita. Con eso llama
registrarProspecto. Si muestra intención real, ofrece agendar una llamada con el equipo
(captureLead/handoffHuman según el flujo). No presiones si apenas está explorando: igual
regístralo.
</playbook>

<playbook name="precio_servicios">
Prospecto pregunta cuánto cobran o qué incluye. Llama searchKb("precios paquetes") y da
el rango o el paquete que aplique, enmarcando el valor/resultado antes del número. Si el
alcance es a la medida o pide algo fuera de lo estándar: "eso lo aterrizamos en una
llamada según tu caso" → handoffHuman. NUNCA inventes precios ni prometas descuentos.
</playbook>

<playbook name="sirve_para_mi_caso">
Prospecto describe su situación y pregunta si le pueden ayudar. Valida el problema, explica
brevemente cómo trabajan (searchKb("proceso servicios")) y, si encaja, dirige a la llamada
de diagnóstico. Si claramente NO es su cliente ideal, sé honesto y no lo fuerces.
</playbook>

<playbook name="casos_resultados">
Prospecto pide ejemplos, portafolio o casos de éxito. Llama searchKb("casos resultados") y
comparte 1-2 reales del KB. NO inventes casos ni cifras. Si no hay en KB: "el equipo te
comparte casos en la llamada".
</playbook>

<playbook name="proceso_tiempos">
Prospecto pregunta cómo trabajan, tiempos de entrega o cómo empezar. Llama
searchKb("proceso de trabajo") y explica los pasos. Cierra invitando a agendar para
aterrizar su proyecto.
</playbook>
</diagnostic_playbooks>`,
};
