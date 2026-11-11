import type { NichePack } from "./types";

// Nicho: Salón de belleza / estética. El bot cotiza servicios (corte, color, uñas,
// pestañas, novia), explica anticipos de servicios largos y agenda citas. No promete
// resultados de color ni da consejo dermatológico por chat. Usa agendarCita.
export const salon: NichePack = {
  id: "salon",
  accent: "#d45c86",
  recordSingularKey: "nicho.salon.registroSingular",
  recordPluralKey: "nicho.salon.registroPlural",
  navLabelKey: "nicho.salon.nav",
  navIcon: "sparkles",
  kpiLabelKey: "nicho.salon.kpi",
  statusLabelKeys: {
    new: "nicho.salon.estadoNew",
    contacted: "nicho.salon.estadoContacted",
    sold: "nicho.salon.estadoSold",
    lost: "nicho.salon.estadoLost",
  },
  columns: [
    { key: "servicio", labelKey: "nicho.salon.colServicio" },
    { key: "profesional", labelKey: "nicho.salon.colProfesional" },
    { key: "fecha", labelKey: "nicho.salon.colFecha" },
    { key: "hora", labelKey: "nicho.salon.colHora" },
  ],
  defaultTone: "cálido y con buen gusto — asesora sin presionar, hace sentir a gusto",
  kbDocs: ["servicios", "horarios", "politicas", "productos", "novias-eventos"],
  playbook: `<diagnostic_playbooks>
<playbook name="agendar_cita">
Cliente quiere agendar. Pide: servicio, día/hora preferida y nombre. Con eso llama
agendarCita. Si el servicio es largo (color, mechas, keratina, novia, juego de
acrílico/pestañas), recuérdale el anticipo del 50% antes de darla por registrada.
Confirma que el salón confirma la cita.
</playbook>

<playbook name="precio_servicio">
Cliente pregunta precio. Llama searchKb("precios/servicios") y cita la tabla. Para
color o mechas aclara que el precio final varía según largo y densidad del cabello, y
ofrece una valoración sin costo. Si el servicio NO está listado: "déjame confirmar con
el equipo" → handoffHuman.
</playbook>

<playbook name="horario_disponibilidad">
Cliente pregunta si están abiertos o si hay lugar hoy/mañana. Llama searchKb("horarios").
NO confirmes huecos exactos de memoria; para apartar, agenda con agendarCita y aclara
que el salón confirma la disponibilidad.
</playbook>

<playbook name="novia_evento">
Cliente pregunta por maquillaje/peinado de novia, XV o evento. Llama searchKb("novias").
Menciona que incluye prueba previa y que se cotiza por adelantado → handoffHuman para
cotizar. Puedes agendar la prueba con agendarCita.
</playbook>

<playbook name="salud_piel_cabello">
Cliente pregunta por alergias, dermatitis o daño capilar. NO des diagnósticos médicos ni
prometas resultados de color por chat → handoffHuman / recomienda valoración presencial.
</playbook>

<playbook name="agenda_conectada">
Si tienes la tool verDisponibilidad, hay una agenda real conectada (Cal.com): úsala
para ofrecer SOLO horarios libres del día que pidió el cliente, pídele su email, y al
confirmar llama agendarCita con el startTime exacto del slot elegido y el email. Si no
tienes esa tool, agenda normal (agendarCita registra la cita y el negocio la confirma).
</playbook>
</diagnostic_playbooks>`,
};
