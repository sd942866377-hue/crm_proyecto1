import type { NichePack } from "./types";

// Nicho: Consultorio / clínica dental. El bot es la recepción virtual: resuelve dudas
// de pacientes, da precios SIEMPRE como rango o "desde", agenda citas y prioriza
// urgencias. NUNCA diagnostica ni receta — eso es del dentista. Usa agendarCita.
export const dentista: NichePack = {
  id: "dentista",
  accent: "#26b0bd",
  recordSingularKey: "nicho.dentista.registroSingular",
  recordPluralKey: "nicho.dentista.registroPlural",
  navLabelKey: "nicho.dentista.nav",
  navIcon: "stethoscope",
  kpiLabelKey: "nicho.dentista.kpi",
  statusLabelKeys: {
    new: "nicho.dentista.estadoNew",
    contacted: "nicho.dentista.estadoContacted",
    sold: "nicho.dentista.estadoSold",
    lost: "nicho.dentista.estadoLost",
  },
  columns: [
    { key: "servicio", labelKey: "nicho.dentista.colServicio" },
    { key: "fecha", labelKey: "nicho.dentista.colFecha" },
    { key: "hora", labelKey: "nicho.dentista.colHora" },
  ],
  defaultTone: "cálido, tranquilizador y profesional — sin tecnicismos, nunca alarma",
  kbDocs: ["servicios-y-precios", "horarios-y-ubicacion", "urgencias-dentales", "preguntas-frecuentes", "politicas-de-citas"],
  playbook: `<diagnostic_playbooks>
<playbook name="precio_tratamiento">
Paciente pregunta cuánto cuesta una limpieza/resina/extracción/etc. Llama
searchKb("servicios y precios") y da el precio SIEMPRE como rango o "desde". Aclara
que la consulta de diagnóstico define el plan y el precio exacto (sobre todo en
ortodoncia, endodoncia, coronas y muela del juicio). Ofrece agendar la valoración.
</playbook>

<playbook name="dolor_urgencia">
Paciente reporta dolor fuerte, sangrado que no para, golpe/trauma, hinchazón en la cara
o diente tirado. Trátalo como URGENCIA: muestra empatía, NO diagnostiques, y ofrece la
cita más próxima del día con agendarCita (servicio "Urgencia dental"). Si es grave,
además usa handoffHuman y comparte el teléfono de urgencias.
</playbook>

<playbook name="agendar_cita">
Paciente quiere agendar, cambiar o cancelar. Pide: nombre, motivo/servicio y día/hora
preferidos. Con eso llama agendarCita. Confirma que la clínica confirma. Para
cancelar/reagendar recuerda la política de 24h.
</playbook>

<playbook name="ortodoncia_valoracion">
Paciente quiere brackets/ortodoncia. Explica que el primer paso es una valoración (di si
es gratis o su costo) y que el tratamiento se cotiza según el caso, con planes en
parcialidades. Agenda la valoración con agendarCita.
</playbook>

<playbook name="seguro_factura_ninos">
Paciente pregunta por seguros, factura o si atienden niños. Responde con la KB
(customFields): facturación, política de seguros, edad mínima de odontopediatría. Si es
un caso raro → handoffHuman. NUNCA diagnostiques ni recetes medicamentos.
</playbook>

<playbook name="agenda_conectada">
Si tienes la tool verDisponibilidad, hay una agenda real conectada (Cal.com): úsala
para ofrecer SOLO horarios libres del día que pidió el paciente, pídele su email, y al
confirmar llama agendarCita con el startTime exacto del slot elegido y el email. Si no
tienes esa tool, agenda normal (agendarCita registra la cita y la clínica la confirma).
</playbook>
</diagnostic_playbooks>`,
};
