# Nicho: Salón de Belleza / Estética

## Pre-fill suggestions for member/config.local.ts

```ts
export const businessConfig = {
  hours: "Mar-Sáb 10am-8pm. Domingo y lunes cerrado.",
  services: [
    { name: "Corte de dama", price: 280 },
    { name: "Lavado, secado y peinado", price: 220 },
    { name: "Tinte / color completo", price: 650 },
    { name: "Mechas / balayage", price: 1200 },
    { name: "Tratamiento de keratina / alaciado", price: 1500 },
    { name: "Manicure con gel", price: 280 },
    { name: "Uñas acrílicas (juego nuevo)", price: 450 },
    { name: "Pedicure spa", price: 320 },
    { name: "Diseño de cejas", price: 120 },
    { name: "Lifting de pestañas", price: 400 },
    { name: "Extensiones de pestañas (juego nuevo)", price: 650 },
    { name: "Maquillaje social", price: 500 },
  ],
  location: "{{member's address}}",
  paymentMethods: ["efectivo", "transferencia", "tarjeta"],
  contactPhone: "{{member's phone}}",
  customFields: {
    "anticipo servicios largos": "color, mechas, keratina, novia y juego de acrílico/pestañas piden 50% para apartar",
    "cancelaciones": "avisar con 24 hrs; no-show puede pedir anticipo en la próxima cita",
    "atienden sin cita": "sí según disponibilidad; fines de semana se recomienda agendar",
    "paquetes novia": "sí, incluyen prueba previa; cotizar por handoff",
  },
};
```

## Diagnostic playbook to inject in system prompt

```xml
<diagnostic_playbooks>
<playbook name="agendar_cita">
Cliente quiere agendar. Pide: servicio, día/hora preferida, nombre.
Si tiene scheduleAppointment tool: úsalo. Si no: captura como lead.
Si el servicio es largo (color, mechas, keratina, novia, juego de acrílico/pestañas):
recuérdale el anticipo del 50% antes de confirmar.
</playbook>

<playbook name="precio_servicio">
Cliente pregunta precio. Llama searchKb("precios"); cita la tabla.
Para color o mechas aclara que el precio final varía según largo y densidad del
cabello, y ofrece valoración sin costo.
Si pregunta por servicio NO listado: "déjame confirmar con el equipo" → handoffHuman.
</playbook>

<playbook name="horario_disponibilidad">
Cliente pregunta si está abierto o si hay lugar hoy/mañana. Llama searchKb("horarios").
NO confirmes disponibilidad de slots de memoria; para huecos reales usa scheduleAppointment.
</playbook>

<playbook name="cancelar_reagendar">
Cliente quiere cancelar o cambiar su cita. Explica la política (searchKb("politicas"))
y usa handoffHuman para reprogramar.
</playbook>

<playbook name="novia_evento">
Cliente pregunta por maquillaje/peinado de novia, XV o evento. Llama searchKb("novias").
Menciona que incluye prueba previa y que se cotiza por adelantado → handoffHuman para cotizar.
</playbook>

<playbook name="salud_piel_cabello">
Cliente pregunta por alergias, dermatitis o daño capilar. NO des diagnósticos médicos
ni prometas resultados de color por chat → handoffHuman / recomienda valoración presencial.
</playbook>
</diagnostic_playbooks>
```

## Suggested first 5 KB docs (member fills + edits)

1. `servicios.md` — catálogo por categoría (cabello, uñas, cejas/pestañas, maquillaje) + precios + duración + qué incluye
2. `horarios.md` — días + horas, días festivos, si atienden sin cita
3. `politicas.md` — cancelaciones (24 hrs), anticipos servicios largos, no-show, cortes para niñas
4. `productos.md` — marcas que usan/venden, opciones sin amoniaco/veganas, alergias, productos para llevar
5. `novias-eventos.md` — paquetes novia/XV/eventos, qué incluyen, prueba previa, anticipo y tiempos de reserva
