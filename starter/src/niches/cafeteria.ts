import type { NichePack } from "./types";

// Nicho: Cafetería / café de especialidad. El bot toma pedidos para llevar con
// anticipación, aparta mesa, contesta el menú de temporada y recuerda a los
// clientes frecuentes. Vende consumo rápido; usa registrarPedido (comercio).
export const cafeteria: NichePack = {
  id: "cafeteria",
  accent: "#a9743f",
  recordSingularKey: "nicho.cafeteria.registroSingular",
  recordPluralKey: "nicho.cafeteria.registroPlural",
  navLabelKey: "nicho.cafeteria.nav",
  navIcon: "coffee",
  kpiLabelKey: "nicho.cafeteria.kpi",
  // nuevo → preparando → entregado → cancelado
  statusLabelKeys: {
    new: "nicho.cafeteria.estadoNew",
    contacted: "nicho.cafeteria.estadoContacted",
    sold: "nicho.cafeteria.estadoSold",
    lost: "nicho.cafeteria.estadoLost",
  },
  columns: [
    { key: "productos", labelKey: "nicho.cafeteria.colProductos" },
    { key: "entrega", labelKey: "nicho.cafeteria.colEntrega" },
    { key: "hora", labelKey: "nicho.cafeteria.colHora" },
  ],
  defaultTone: "cálido y con buena vibra — como el barista que ya conoce tu pedido de siempre",
  kbDocs: ["menu-y-precios", "cafe-de-especialidad", "horarios-y-ubicacion", "para-llevar-y-mesas", "promociones-y-faq"],
  playbook: `<diagnostic_playbooks>
<playbook name="menu_bebidas">
Cliente pregunta qué tienen o por una bebida/alimento. Llama searchKb("menu") y comparte
opciones con precios. Para café de especialidad, menciona el grano/método si está en KB.
NO inventes productos que no estén en el menú.
</playbook>

<playbook name="pedido_para_llevar">
Cliente quiere dejar un pedido listo para recoger. Junta: qué quiere, tamaño/variantes,
y a qué hora pasa. Con eso llama registrarPedido (entrega = "para llevar · HH:MM"). Avisa
que se lo dejan listo en barra a esa hora.
</playbook>

<playbook name="apartar_mesa">
Cliente quiere apartar mesa o un rincón (para trabajar, reunión). Pide personas y hora, y
si aplica alguna preferencia (enchufe, terraza). Registra con registrarPedido (entrega =
"mesa · N pers · HH:MM") o captureLead según el flujo. Confirma que el café lo aparta.
</playbook>

<playbook name="encargo_pastel_evento">
Cliente pide un pastel, charola o pedido grande para un evento. Toma producto, cantidad y
fecha; para algo a la medida o de alto volumen, captura el lead (captureLead) o pasa a una
persona (handoffHuman) para cotizar y confirmar disponibilidad.
</playbook>

<playbook name="horario_ubicacion">
Cliente pregunta a qué hora abren, dónde están o si hay wifi/estacionamiento. Usa la KB
(horarios, ubicación, amenidades). Comparte el link de Maps cuando convenga.
</playbook>
</diagnostic_playbooks>`,
};
