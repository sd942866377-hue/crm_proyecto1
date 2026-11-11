import type { NichePack } from "./types";

// Nicho: Panadería / pastelería / repostería. El bot atiende pan del día y toma pedidos,
// incluidos los pasteles de evento (que piden fecha, porciones, sabor y anticipo). Habla
// antojable ("recién horneado", "esponjosito") pero nunca inventa precios ni disponibilidad.
// Usa registrarPedido; para eventos grandes pasa al dueño (handoffHuman).
export const panaderia: NichePack = {
  id: "panaderia",
  accent: "#e2a52c",
  recordSingularKey: "nicho.panaderia.registroSingular",
  recordPluralKey: "nicho.panaderia.registroPlural",
  navLabelKey: "nicho.panaderia.nav",
  navIcon: "cake",
  kpiLabelKey: "nicho.panaderia.kpi",
  // nuevo → confirmado → entregado → cancelado
  statusLabelKeys: {
    new: "nicho.panaderia.estadoNew",
    contacted: "nicho.panaderia.estadoContacted",
    sold: "nicho.panaderia.estadoSold",
    lost: "nicho.panaderia.estadoLost",
  },
  columns: [
    { key: "productos", labelKey: "nicho.panaderia.colProductos" },
    { key: "fecha", labelKey: "nicho.panaderia.colFecha" },
    { key: "entrega", labelKey: "nicho.panaderia.colEntrega" },
  ],
  defaultTone: "cálido y antojable, como el panadero del barrio — 'recién horneado', 'esponjosito'",
  kbDocs: ["productos-y-precios", "pedidos-de-pasteles-y-eventos", "horarios-y-ubicacion", "entregas-y-pagos", "opciones-especiales-y-temporada"],
  playbook: `<diagnostic_playbooks>
<playbook name="pan_del_dia">
Cliente pregunta si hay pan fresco o a qué hora sale. Confirma los horarios en que sale
pan recién horneado (KB / customFields). Si pregunta por un producto específico, usa
searchKb / catalogQuery para decir si hay hoy. Descríbelo antojable pero sin inventar.
</playbook>

<playbook name="pastel_evento">
Cliente quiere un pastel o pide para una fiesta. Antes de cotizar recoge SIEMPRE: fecha y
hora de entrega/recolección, número de porciones/personas, sabor de pan y relleno, y si
quiere algo escrito o decoración especial. Recuérdale la anticipación mínima (ej. 48h) y
el anticipo (ej. 50%). Con los datos llama registrarPedido (poniendo la fecha). Si es un
pedido grande o muy personalizado → handoffHuman para que el dueño lo cotice.
</playbook>

<playbook name="pedido_mismo_dia">
Cliente quiere pedir para hoy o mañana. Si es para el mismo día, verifica que sea antes de
la hora de cierre de pedidos del día (KB). Junta productos, si recoge o es a domicilio
(dirección) y forma de pago; con eso llama registrarPedido con la fecha de entrega.
</playbook>

<playbook name="entregas_pagos">
Cliente pregunta si hacen entregas a domicilio o cómo puede pagar. Confirma cobertura,
radio y costo de envío (KB). Si está fuera del radio, ofrece recolección en tienda. Lista
las formas de pago.
</playbook>

<playbook name="opciones_especiales">
Cliente pregunta por opciones sin azúcar, integrales o veganas, o productos de temporada
(rosca, pan de muerto). Responde según la KB (opciones especiales / temporada). Si es bajo
pedido, indícale la anticipación necesaria y ofrece registrar el pedido.
</playbook>
</diagnostic_playbooks>`,
};
