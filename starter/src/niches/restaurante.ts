import type { NichePack } from "./types";

// Nicho: Restaurante / fonda / cocina con servicio en mesa, para llevar y delivery.
// El bot atiende menú y alérgenos desde la KB, toma reservaciones y pedidos, y
// registra todo para que el dueño lo procese (nunca confirma como "listo").
export const restaurante: NichePack = {
  id: "restaurante",
  accent: "#e0524e",
  recordSingularKey: "nicho.restaurante.registroSingular",
  recordPluralKey: "nicho.restaurante.registroPlural",
  navLabelKey: "nicho.restaurante.nav",
  navIcon: "calendar-check",
  kpiLabelKey: "nicho.restaurante.kpi",
  // solicitada → confirmada → cumplida → cancelada (mapeadas a los 4 canónicos)
  statusLabelKeys: {
    new: "nicho.restaurante.estadoNew",
    contacted: "nicho.restaurante.estadoContacted",
    sold: "nicho.restaurante.estadoSold",
    lost: "nicho.restaurante.estadoLost",
  },
  columns: [
    { key: "fecha", labelKey: "nicho.restaurante.colFecha" },
    { key: "hora", labelKey: "nicho.restaurante.colHora" },
    { key: "personas", labelKey: "nicho.restaurante.colPersonas" },
    { key: "tipo", labelKey: "nicho.restaurante.colTipo" },
  ],
  defaultTone: "cálido y cercano, con antojo — invita a venir sin sonar a vendedor",
  kbDocs: ["menu", "horarios", "delivery", "reservaciones", "alergias"],
  playbook: `<diagnostic_playbooks>
<playbook name="ver_menu">
Cliente pide el menú o pregunta "qué tienen". Llama searchKb("menu") y comparte
las categorías principales con 2-3 ejemplos y precios. NO inventes platillos.
Si pregunta por algo que NO está en KB: "ese platillo no lo tenemos en el menú,
¿te muestro lo que sí manejamos?".
</playbook>

<playbook name="precio_platillo">
Cliente pregunta el precio de un platillo. Llama searchKb con el nombre del
platillo; cita el precio exacto. Si no aparece, ofrece el más parecido y aclara
que el precio puede variar → handoffHuman si insiste.
</playbook>

<playbook name="horario_apertura_cocina">
Cliente pregunta si están abiertos o hasta qué hora sirven. Llama searchKb("horarios").
Distingue horario del local vs. last call de cocina (la cocina cierra antes).
NO inventes excepciones (feriados, eventos privados) que no estén en KB.
</playbook>

<playbook name="reservacion">
Cliente quiere reservar mesa. Pide en pocos turnos: día, hora, número de personas
y nombre. Cuando tengas los cuatro, llama crearReservacion con esos datos.
Recuérdale la política de reservaciones (mínimo de personas / anticipación) del KB.
Confirma que quedó REGISTRADA y que el restaurante la confirma; no la des por
confirmada tú.
</playbook>

<playbook name="pedido_delivery">
Cliente quiere pedir a domicilio o para llevar. Confirma dirección, platillos y
método de pago. Verifica que la dirección esté dentro de la zona de reparto (KB /
business_context). Si está fuera de zona: ofrece para llevar. Cuando tengas los
datos, llama tomarPedido. Avisa el tiempo de entrega aproximado. NO confirmes la
orden como "lista", solo la registras para que el dueño la procese.
</playbook>

<playbook name="alergias_dieta">
Cliente pregunta por ingredientes, alergias, opciones veganas/vegetarianas/sin gluten.
Llama searchKb("alergias" o "ingredientes"). Si no hay info clara del ingrediente
exacto: NO adivines (es riesgo de salud) → "déjame confirmar con cocina" → handoffHuman.
</playbook>
</diagnostic_playbooks>`,
};
