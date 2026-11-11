# Plantilla de nicho: Hotelería / Hospedaje

> **Para Claude Code:** Úsala cuando el negocio sea de **hospedaje**: hotel boutique,
> cabañas, hostal, casa de renta vacacional, o venue de **bodas destino / eventos**. El
> bot toma solicitudes de reserva y de eventos; el dashboard se vuelve "Reservas". Pon
> `BOT_NICHE = "hoteleria"`. Los valores de abajo son ejemplos: confírmalos con el miembro.

El bot **no** confirma disponibilidad ni tarifa final (no lleva el calendario en vivo):
recoge la solicitud (`reservarHospedaje`) o el evento (`cotizarEvento`) para que el hotel
responda. Eventos = alto ticket → siempre a un asesor.

---

## (A) Pre-fill para `member/config.local.ts`

```ts
export const businessConfig = {
  // Tipos de habitación/unidad con tarifa de referencia (la real varía por temporada).
  services: [
    { name: "Habitación sencilla", price: "desde $X/noche" },
    { name: "Habitación doble", price: "desde $X/noche" },
    { name: "Suite / cabaña", price: "desde $X/noche" },
    { name: "Renta de espacio para evento", price: "cotización" },
  ],
  hours: "Recepción 24/7. Check-in 3pm · Check-out 12pm.",
  location: {
    address: "{{dirección}}",
    city: "{{ciudad}}",
    reference: "{{referencia para llegar}}",
    mapsUrl: "{{link de Google Maps}}",
  },
  paymentMethods: ["efectivo", "tarjeta", "transferencia", "anticipo para apartar"],
  contactPhone: "{{teléfono / WhatsApp}}",
  customFields: {
    checkin: "3:00 pm",
    checkout: "12:00 pm",
    mascotas: "{{sí/no; con qué condiciones}}",
    amenidades: "wifi, alberca, estacionamiento, desayuno, {{...}}",
    anticipo: "{{% para apartar la reserva}}",
    cancelacion: "{{política — ej. sin costo hasta 48h antes}}",
    eventos: "{{capacidad del salón, si incluye hospedaje para invitados}}",
    temporadaAlta: "{{fechas donde suben tarifas / hay mínimo de noches}}",
  },
};

export const memberConfig = {
  tone: "cálido y hospitalario, atento al detalle — hace sentir bienvenido",
  language: "es",
  greeting:
    "¡Hola! 🏨 Bienvenido a [Nombre del Hotel]. " +
    "Te ayudo con disponibilidad, tarifas, reservas y eventos. ¿Para qué fechas buscas?",
  handoffTriggers: [
    "cotización de boda/evento",
    "tarifa de grupo o estancia larga",
    "reembolso, queja o cambio de una reserva existente",
  ],
};
```

## (B) Playbook

Integrado en el pack (`BOT_NICHE = "hoteleria"`): pide fechas + personas y toma la
solicitud con `reservarHospedaje` (aclarando que el hotel confirma disponibilidad/tarifa);
para bodas/eventos usa `cotizarEvento` y pasa a un asesor; responde amenidades y políticas
desde la KB sin inventar. No lo inyectes a mano.

## (C) 5 KB docs sugeridos (`member/kb/`)

1. `habitaciones-y-tarifas.md` — tipos de habitación/unidad, capacidad, qué incluye, rangos.
2. `amenidades-y-servicios.md` — wifi, alberca, desayuno, spa, estacionamiento, mascotas.
3. `politicas-checkin-cancelacion.md` — horarios, anticipo, cancelaciones, identificación.
4. `eventos-y-bodas.md` — espacios, capacidad, paquetes, si incluye hospedaje, cómo se cotiza.
5. `ubicacion-y-como-llegar.md` — dirección, referencias, atracciones cercanas, transporte.

> Ojo con la **disponibilidad**: el bot NO debe afirmar que hay lugar en x fecha. Solo
> toma la solicitud; el hotel confirma. Si conectas un motor de reservas más adelante,
> se documenta como método adicional (igual que Cal.com para citas).
