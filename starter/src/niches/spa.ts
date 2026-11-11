import type { NichePack } from "./types";

// Nicho: Spa / centro de bienestar. El bot recomienda el ritual adecuado, agenda
// masajes, faciales y rituales en pareja con la terapeuta y suite disponibles, y
// recuerda con suavidad. Tono tranquilo. Usa agendarCita.
export const spa: NichePack = {
  id: "spa",
  accent: "#35a98a",
  recordSingularKey: "nicho.spa.registroSingular",
  recordPluralKey: "nicho.spa.registroPlural",
  navLabelKey: "nicho.spa.nav",
  navIcon: "flower-2",
  kpiLabelKey: "nicho.spa.kpi",
  statusLabelKeys: {
    new: "nicho.spa.estadoNew",
    contacted: "nicho.spa.estadoContacted",
    sold: "nicho.spa.estadoSold",
    lost: "nicho.spa.estadoLost",
  },
  columns: [
    { key: "ritual", labelKey: "nicho.spa.colRitual" },
    { key: "profesional", labelKey: "nicho.spa.colProfesional" },
    { key: "fecha", labelKey: "nicho.spa.colFecha" },
    { key: "hora", labelKey: "nicho.spa.colHora" },
  ],
  defaultTone: "sereno y cálido — invita a la calma, sin prisa y sin presionar",
  kbDocs: ["tratamientos-y-precios", "rituales-y-paquetes", "horarios-y-ubicacion", "politicas-y-recomendaciones", "membresias-y-eventos"],
  playbook: `<diagnostic_playbooks>
<playbook name="recomendar_ritual">
Cliente describe qué busca (relajarse, dolor muscular, desconectar, algo en pareja). Según
eso, recomienda el ritual/tratamiento del menú (searchKb) y su duración, y ofrece agendarlo.
No prometas resultados médicos.
</playbook>

<playbook name="agendar_sesion">
Cliente quiere reservar. Pide el tratamiento, día/hora y nombre; con eso llama agendarCita
con la terapeuta/suite si aplica. Recuérdale llegar unos minutos antes para empezar con
calma. Confirma que el spa confirma la reserva.
</playbook>

<playbook name="precio_duracion">
Cliente pregunta precio o cuánto dura. Cita la tabla de la KB (por tratamiento y duración).
Si el servicio no está listado o es a la medida (día de spa, evento), ofrece cotización →
handoffHuman.
</playbook>

<playbook name="paquetes_membresias">
Cliente pregunta por día de spa, rituales en pareja, paquetes o membresías. Explica lo que
incluye desde la KB; para armar un paquete a la medida, toma los datos y pasa a cotización
(handoffHuman) o agenda una valoración.
</playbook>

<playbook name="salud_contraindicaciones">
Cliente menciona embarazo, lesión, presión, alergias o alguna condición. NO des consejo
médico; recomienda avisar a la terapeuta al llegar y, si hay duda, valoración presencial →
handoffHuman.
</playbook>

<playbook name="agenda_conectada">
Si tienes la tool verDisponibilidad (Cal.com conectado), ofrece SOLO horarios libres del
día pedido, toma el email y al confirmar llama agendarCita con el startTime del slot. Si
no, agenda normal (el spa confirma).
</playbook>
</diagnostic_playbooks>`,
};
