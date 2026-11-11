import type { NichePack } from "./types";

// Nicho: Gimnasio / box de CrossFit / estudio de spinning, yoga o fitness. La mayoría
// escribe para inscribirse, ver planes o probar una clase. El bot resuelve rápido y,
// cuando hay intención, captura el lead (captureLead) o agenda la clase de prueba/visita
// (agendarCita). No da consejo médico ni nutricional. Motivador pero breve.
export const gimnasio: NichePack = {
  id: "gimnasio",
  accent: "#64bd3c",
  recordSingularKey: "nicho.gimnasio.registroSingular",
  recordPluralKey: "nicho.gimnasio.registroPlural",
  navLabelKey: "nicho.gimnasio.nav",
  navIcon: "dumbbell",
  kpiLabelKey: "nicho.gimnasio.kpi",
  // solicitada → confirmada → inscrito(convertido) → cancelada
  statusLabelKeys: {
    new: "nicho.gimnasio.estadoNew",
    contacted: "nicho.gimnasio.estadoContacted",
    sold: "nicho.gimnasio.estadoSold",
    lost: "nicho.gimnasio.estadoLost",
  },
  columns: [
    { key: "servicio", labelKey: "nicho.gimnasio.colServicio" },
    { key: "fecha", labelKey: "nicho.gimnasio.colFecha" },
    { key: "hora", labelKey: "nicho.gimnasio.colHora" },
  ],
  defaultTone: "motivador y cercano, pero breve — la gente del gym quiere respuestas rápidas",
  kbDocs: ["planes-y-precios", "horario-de-clases", "horarios-y-ubicacion", "como-inscribirse", "politicas-membresia"],
  playbook: `<diagnostic_playbooks>
<playbook name="planes_precios">
Cliente pregunta cuánto cuesta la mensualidad o qué planes hay. Llama
searchKb("planes y precios"). Da primero el plan mensual, luego menciona que el
trimestral y anual salen más baratos por mes. Cierra ofreciendo la clase de prueba
gratis: "¿te aparto una clase de prueba?".
</playbook>

<playbook name="clase_prueba">
Cliente pregunta por clase de prueba / pase gratis, o dice que quiere probar. Ofrece la
primera clase grupal gratis. Pide nombre, día y hora, y llama agendarCita (servicio
"Clase de prueba"). Confirma que el gym la confirma.
</playbook>

<playbook name="inscripcion">
Cliente quiere inscribirse o pregunta cómo apuntarse. Si ya sabe el plan y quiere pasar,
captura sus datos con captureLead (nombre, teléfono, plan de interés) para que el equipo
lo dé de alta; o agenda su visita con agendarCita. Explica qué traer (identificación,
ropa deportiva) y la cuota de inscripción.
</playbook>

<playbook name="horarios_clases_ubicacion">
Cliente pregunta horarios del gym, de una clase específica (spinning, zumba, funcional) o
dónde están. Llama searchKb("horario de clases" / "horarios y ubicación") y responde con
el dato exacto, más referencia y Maps si conviene.
</playbook>

<playbook name="congelar_cancelar">
Cliente pregunta por congelar o cancelar su membresía. Responde con la política del KB
(freeze/cancelación). Si el caso es delicado (reembolso, reclamo, lesión, baja médica) →
handoffHuman.
</playbook>

<playbook name="lesion_salud">
Cliente menciona una lesión o condición de salud. NO des consejo médico. Recomienda hablar
con un profesional de salud y con el coach. Si insisten en algo médico delicado → handoffHuman.
</playbook>

<playbook name="agenda_conectada">
Si tienes la tool verDisponibilidad, hay una agenda real conectada (Cal.com): úsala
para ofrecer SOLO horarios libres del día para la clase de prueba/visita, pídele su
email, y al confirmar llama agendarCita con el startTime exacto del slot elegido y el
email. Si no tienes esa tool, agenda normal (agendarCita registra la cita y el gym la confirma).
</playbook>
</diagnostic_playbooks>`,
};
