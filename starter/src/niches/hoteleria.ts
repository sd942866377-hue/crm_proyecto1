import type { NichePack } from "./types";

// Nicho: Hotelería / hospedaje (hoteles boutique, cabañas, hostales, Airbnb-style,
// bodas destino, eventos VIP). El bot atiende consultas de disponibilidad, toma
// solicitudes de reserva (reservarHospedaje) y de eventos de alto ticket
// (cotizarEvento → asesor). No confirma disponibilidad ni tarifa final: registra para
// que el hotel responda. Nunca inventa precios ni disponibilidad.
export const hoteleria: NichePack = {
  id: "hoteleria",
  accent: "#c39a4e",
  recordSingularKey: "nicho.hoteleria.registroSingular",
  recordPluralKey: "nicho.hoteleria.registroPlural",
  navLabelKey: "nicho.hoteleria.nav",
  navIcon: "bed-double",
  kpiLabelKey: "nicho.hoteleria.kpi",
  // solicitada → confirmada → completada(estancia cumplida) → cancelada
  statusLabelKeys: {
    new: "nicho.hoteleria.estadoNew",
    contacted: "nicho.hoteleria.estadoContacted",
    sold: "nicho.hoteleria.estadoSold",
    lost: "nicho.hoteleria.estadoLost",
  },
  columns: [
    { key: "tipo", labelKey: "nicho.hoteleria.colTipo" },
    { key: "fecha", labelKey: "nicho.hoteleria.colFecha" },
    { key: "salida", labelKey: "nicho.hoteleria.colSalida" },
    { key: "huespedes", labelKey: "nicho.hoteleria.colHuespedes" },
  ],
  defaultTone: "cálido y hospitalario, atento al detalle — hace sentir bienvenido y cuida la experiencia",
  kbDocs: ["habitaciones-y-tarifas", "amenidades-y-servicios", "politicas-checkin-cancelacion", "eventos-y-bodas", "ubicacion-y-como-llegar"],
  playbook: `<diagnostic_playbooks>
<playbook name="disponibilidad_fechas">
Cliente pregunta si hay lugar para ciertas fechas. NO confirmes disponibilidad de memoria
(el bot no lleva el calendario en vivo). Pide fechas de entrada y salida y número de
personas, y toma la solicitud con reservarHospedaje aclarando que el hotel confirma
disponibilidad y tarifa. Si preguntan tarifas, usa searchKb("habitaciones tarifas") y da
el rango; el precio final depende de fechas/temporada.
</playbook>

<playbook name="reservar_hospedaje">
Cliente quiere reservar. Junta: fecha de entrada, fecha de salida, número de personas
(adultos/niños) y tipo de habitación si lo pide. Con eso llama reservarHospedaje. Confirma
que quedó SOLICITADA y que el hotel confirma disponibilidad y tarifa. Menciona la política
de check-in/out y anticipo si está en la KB.
</playbook>

<playbook name="eventos_bodas">
Cliente pregunta por bodas, XV, eventos corporativos o grupos grandes. Son de alto valor:
recoge tipo de evento, fecha tentativa y número aproximado de invitados, y llama
cotizarEvento. Avisa que un asesor lo cotiza personalmente (searchKb("eventos bodas") para
lo que sí puedas responder: espacios, capacidad, si incluye hospedaje). NO cotices el
evento tú.
</playbook>

<playbook name="amenidades_servicios">
Cliente pregunta por alberca, wifi, estacionamiento, desayuno, mascotas, spa, etc. Llama
searchKb("amenidades servicios") y responde con lo que SÍ hay. Si no está en la KB, no lo
inventes; ofrece confirmarlo → handoffHuman.
</playbook>

<playbook name="politicas_ubicacion">
Cliente pregunta por check-in/out, cancelaciones, mascotas, o cómo llegar. Responde con la
KB (políticas / ubicación) y comparte el link de Maps cuando convenga. Para casos especiales
(reembolso, queja, tarifa de grupo) → handoffHuman.
</playbook>
</diagnostic_playbooks>`,
};
