import type { NichePack } from "./types";

// Nicho: Clínica / consultorio (medicina general, especialidades). El bot agenda
// consultas con el área correcta, detecta urgencias para priorizarlas, contesta
// requisitos y convenios, y recuerda la cita. NO da diagnóstico. Usa agendarCita.
export const clinica: NichePack = {
  id: "clinica",
  accent: "#2f9bd6",
  recordSingularKey: "nicho.clinica.registroSingular",
  recordPluralKey: "nicho.clinica.registroPlural",
  navLabelKey: "nicho.clinica.nav",
  navIcon: "stethoscope",
  kpiLabelKey: "nicho.clinica.kpi",
  statusLabelKeys: {
    new: "nicho.clinica.estadoNew",
    contacted: "nicho.clinica.estadoContacted",
    sold: "nicho.clinica.estadoSold",
    lost: "nicho.clinica.estadoLost",
  },
  columns: [
    { key: "motivo", labelKey: "nicho.clinica.colMotivo" },
    { key: "area", labelKey: "nicho.clinica.colArea" },
    { key: "fecha", labelKey: "nicho.clinica.colFecha" },
    { key: "hora", labelKey: "nicho.clinica.colHora" },
  ],
  defaultTone: "cálido y profesional — transmite calma y confianza, sin tecnicismos ni alarmismo",
  kbDocs: ["especialidades-y-medicos", "precios-de-consulta", "requisitos-y-que-llevar", "convenios-y-aseguradoras", "horarios-y-ubicacion"],
  playbook: `<diagnostic_playbooks>
<playbook name="detectar_urgencia">
Si el paciente reporta algo que NO puede esperar (dolor intenso, fiebre alta, dificultad
para respirar, sangrado, accidente), trátalo como URGENCIA: ofrece el hueco prioritario
del día y agenda con agendarCita marcando el motivo como urgencia. NO minimices ni
diagnostiques; si suena grave, sugiere acudir a urgencias.
</playbook>

<playbook name="agendar_consulta">
Cliente quiere consulta. Pregunta el motivo para canalizar al área correcta (general o
especialidad), y el día/hora preferido. Con eso llama agendarCita con el área/médico.
Confirma que la clínica confirma la cita.
</playbook>

<playbook name="canalizar_especialidad">
Cliente pide un especialista (dermatología, pediatría, ginecología, etc.). Verifica en la
KB que esa especialidad exista y con qué médico, y agenda con ese médico. Si no la manejan,
dilo con honestidad y ofrece lo más cercano.
</playbook>

<playbook name="requisitos_convenios">
Cliente pregunta qué llevar, precios de consulta o si aceptan su aseguradora/convenio.
Responde desde la KB (requisitos, precios, convenios). Para trámites de aseguradora
complejos, pasa a una persona (handoffHuman).
</playbook>

<playbook name="estudios_seguimiento">
Cliente pregunta por estudios (laboratorio, imagen) o control. Explica que se indican en
consulta; agenda la valoración o el control con agendarCita. NO interpretes resultados por
chat → handoffHuman / valoración presencial.
</playbook>

<playbook name="agenda_conectada">
Si tienes la tool verDisponibilidad (Cal.com conectado), ofrece SOLO horarios libres del
día pedido, toma el email y al confirmar llama agendarCita con el startTime del slot. Si
no, agenda normal (la clínica confirma).
</playbook>
</diagnostic_playbooks>`,
};
