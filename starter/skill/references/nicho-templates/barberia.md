# Nicho template: Barbería

> **Para Claude Code:** Esta es una referencia que usas durante `/configurar-mi-chatbot`
> cuando el miembro dice que su negocio es una **barbería** (o peluquería masculina,
> grooming, salón de corte de caballero). NO copies esto tal cual. Úsalo como
> punto de partida: pre-llena `member/config.local.ts` con estos valores de ejemplo,
> **pregúntale al miembro qué cambiar** (precios, horarios, ubicación, nombre), y
> ajusta a su realidad. Los números y servicios de aquí son ejemplos típicos de
> una barbería en LATAM — el miembro tiene la última palabra.

---

## Cómo usar este template (orden recomendado)

1. Confirma con el miembro que su negocio es una barbería.
2. Toma la sección **(A) Pre-fill de `config.local.ts`** y pégala como base.
   Recorre campo por campo con el miembro y ajusta valores.
3. Inyecta el **(B) Diagnostic playbook** en el system prompt del bot (sección
   de "consultas típicas de tu negocio"). Esto le enseña al bot cómo responder
   las preguntas más comunes de una barbería.
4. Crea los **(C) 5 documentos de KB iniciales** dentro de `member/kb/`.
   Dáselos pre-redactados y dile al miembro que los edite con su info real.
5. Recuérdale que después de editar la KB hay que **reindexar** (el bot lo
   explica en `/actualizar-mi-bot` o tú lo corres con la KB reindex).

---

## (A) Pre-fill para `member/config.local.ts`

Pega esto como punto de partida. **Cambia con el miembro** todo lo que esté
marcado con `// 👈 ajustar`. Los precios están en pesos mexicanos como ejemplo;
si el miembro está en otro país, cambia la moneda y los montos.

```ts
// member/config.local.ts
// Configuración de tu negocio. El bot usa esto para responder con datos reales.
// Edita los valores. NO borres las llaves (las que están a la izquierda del ":").

import type { BusinessConfig, MemberConfig } from "../src/types";

export const businessConfig: BusinessConfig = {
  // Servicios que ofreces. El bot usa esto para cotizar y agendar.
  // Pon el nombre tal cual lo dices tú, la duración real y el precio actual.
  services: [
    { name: "Corte de cabello", durationMin: 30, price: 150, currency: "MXN" }, // 👈 ajustar
    { name: "Corte + barba", durationMin: 45, price: 220, currency: "MXN" },     // 👈 ajustar
    { name: "Arreglo de barba", durationMin: 20, price: 100, currency: "MXN" },  // 👈 ajustar
    { name: "Afeitado clásico (navaja)", durationMin: 30, price: 180, currency: "MXN" },
    { name: "Corte infantil (niños)", durationMin: 25, price: 120, currency: "MXN" },
    { name: "Diseño / líneas", durationMin: 15, price: 60, currency: "MXN" },
    { name: "Mascarilla / facial express", durationMin: 15, price: 90, currency: "MXN" },
    { name: "Tinte / decoloración", durationMin: 60, price: 350, currency: "MXN" },
  ],

  // Horario de atención. Usa formato 24h ("HH:MM").
  // Si un día cierras, pon "closed: true".
  hours: {
    monday:    { open: "10:00", close: "20:00" },
    tuesday:   { open: "10:00", close: "20:00" },
    wednesday: { open: "10:00", close: "20:00" },
    thursday:  { open: "10:00", close: "20:00" },
    friday:    { open: "10:00", close: "21:00" }, // viernes suele cerrar más tarde
    saturday:  { open: "09:00", close: "21:00" }, // sábado es el día fuerte
    sunday:    { closed: true },                  // 👈 ajustar si abres domingo
  },

  // Dónde estás. El bot lo manda cuando preguntan "¿dónde quedan?".
  location: {
    address: "Av. Ejemplo 123, Local 4, Col. Centro", // 👈 ajustar
    city: "Ciudad de México",                          // 👈 ajustar
    country: "México",                                 // 👈 ajustar
    mapsUrl: "https://maps.app.goo.gl/tu-link-aqui",   // 👈 pega tu link de Google Maps
    landmark: "Frente a la farmacia, entrando por la calle lateral", // referencia útil
  },

  // Formas de pago que aceptas. El bot las menciona cuando preguntan.
  paymentMethods: ["Efectivo", "Tarjeta", "Transferencia"], // 👈 ajustar

  // Teléfono de contacto directo (para urgencias o si quieren hablar con humano).
  contactPhone: "+52 55 1234 5678", // 👈 ajustar

  // Campos extra propios del nicho barbería. El bot los lee para responder mejor.
  customFields: {
    walkInsAllowed: true,            // ¿aceptas sin cita? (true/false)
    appointmentRequired: false,      // ¿es obligatorio agendar? (true/false)
    barbersCount: 3,                 // cuántos barberos hay
    barbers: ["Carlos", "Memo", "Andrés"], // nombres (los clientes piden por barbero)
    cancellationPolicy: "Avisa con 2 horas de anticipación si no puedes venir.",
    loyaltyProgram: "Al 10º corte, el siguiente es gratis.", // déjalo vacío si no aplicas
    parking: "Hay estacionamiento en la calle, no contamos con valet.",
    waitTimeTypical: "15-25 min en hora pico (sábados por la tarde)",
    instagram: "@tu_barberia", // 👈 ajustar
  },
};

export const memberConfig: MemberConfig = {
  // Tono del bot. Para barbería suele funcionar cercano, relajado, "carnal".
  tone: "cercano y relajado, como hablarle a un cliente de confianza",

  // Idioma principal de las respuestas.
  language: "es",

  // Saludo de bienvenida. El bot lo usa al iniciar conversación.
  greeting:
    "¡Qué onda! 💈 Soy el asistente de [Nombre de tu Barbería]. " +
    "Te ayudo a agendar tu corte, ver precios o checar horarios. ¿En qué te apoyo?", // 👈 ajustar nombre

  // Cuándo pasar a un humano (handoff). Para barbería suele ser:
  // quejas, cambios de cita complicados, o cuando el cliente lo pide directo.
  handoffTriggers: [
    "cliente molesto o con queja",
    "pide hablar con una persona / con el dueño",
    "problema con un cobro o un servicio mal hecho",
    "algo fuera de lo que el bot sabe responder",
  ],
};
```

---

## (B) Diagnostic playbook (inyectar en el system prompt)

> **Para Claude Code:** Mete este bloque en la sección del system prompt donde van
> las "consultas típicas de tu negocio". Esto le da al bot un guion mental para las
> preguntas más comunes de una barbería. Mantén el español natural; el bot debe
> sonar como recepcionista de barbería, no como robot.

```
CONSULTAS TÍPICAS DE UNA BARBERÍA — cómo responder:

1) "¿Cuánto cuesta el corte?" / "¿Qué precios manejan?"
   → Da el precio del servicio que pidan desde businessConfig.services.
   → Si no especifican, ofrece los 2-3 más populares (corte, corte+barba, barba).
   → Nunca inventes precios: si un servicio no está en la lista, dilo y ofrece
     pasar a un humano para cotizar.

2) "¿Tienen lugar hoy?" / "¿Aceptan sin cita?"
   → Revisa customFields.walkInsAllowed.
     - Si es true: di que sí aceptan walk-in, pero recomienda agendar para
       no esperar (menciona waitTimeTypical en hora pico).
     - Si appointmentRequired es true: di que solo con cita y ofrece agendar.
   → Si quieren agendar, usa la herramienta de agendamiento (scheduleAppointment).

3) "¿Atiende [nombre del barbero]?" / "Quiero con [barbero]"
   → Revisa customFields.barbers. Si el barbero existe, confírmalo y ofrece
     agendar con esa persona. Si no, di los barberos disponibles.

4) "¿A qué hora abren / cierran?" / "¿Abren los domingos?"
   → Responde con el horario exacto del día que pregunten (businessConfig.hours).
   → Si ese día está cerrado, dilo claro y ofrece el siguiente día disponible.

5) "¿Dónde están?" / "¿Cómo llego?"
   → Da la dirección, la referencia (landmark) y el link de Google Maps.
   → Si preguntan por estacionamiento, usa customFields.parking.

6) "¿Cómo puedo pagar?" / "¿Aceptan tarjeta?"
   → Responde con businessConfig.paymentMethods.

7) "Quiero cancelar / cambiar mi cita"
   → Recuerda la política (customFields.cancellationPolicy).
   → Si es un cambio simple, ayúdalo. Si se complica o está molesto, haz handoff.

8) "¿Cuánto se tardan?" / "¿Hay mucha espera?"
   → Usa la duración del servicio (durationMin) + waitTimeTypical en hora pico.
   → Sé honesto: sábado por la tarde es lo más lleno.

9) "¿Tienen promo / descuento?" / "¿Hay tarjeta de cliente?"
   → Usa customFields.loyaltyProgram si existe. Si no hay promo, dilo sin inventar.

10) "¿Hacen [servicio raro / no listado]?"
    → Si no está en services, di que no lo tienes confirmado y ofrece pasar a
      un humano para preguntarlo. Nunca prometas un servicio que no está cargado.

REGLAS DE ORO:
- Nunca inventes precios, horarios ni servicios: si no está en la config, no existe.
- Para agendar, captura: servicio, día/hora preferida, barbero (si pide uno), nombre.
- Si el cliente está molesto o pide humano → handoff de inmediato.
- Habla corto y claro. La gente que escribe a una barbería quiere rapidez.
```

---

## (C) 5 documentos de KB sugeridos (iniciales)

> **Para Claude Code:** Crea estos 5 archivos `.md` dentro de `member/kb/`.
> Dáselos pre-redactados con contenido de ejemplo y dile al miembro:
> *"Edita estos 5 documentos con tu info real. Cuando termines, reindexamos
> para que el bot los use."* Recuerda que tras editarlos hay que reindexar la KB.

### 1. `servicios-y-precios.md`
Lista completa de servicios con precio, duración y una breve descripción de cada
uno. Es el documento más consultado. Ejemplo de contenido inicial:

```md
# Servicios y precios

## Corte de cabello — $150 MXN (30 min)
Corte a tijera o máquina, lavado incluido, peinado final.

## Corte + barba — $220 MXN (45 min)
El combo más pedido. Corte completo + perfilado y arreglo de barba.

## Arreglo de barba — $100 MXN (20 min)
Perfilado, recorte y aceite.

## Afeitado clásico con navaja — $180 MXN (30 min)
Toalla caliente, navaja, after shave.

## Corte infantil — $120 MXN (25 min)
Para niños hasta 12 años.

> Precios sujetos a cambio. Confirma al agendar.
```

### 2. `horarios-y-ubicacion.md`
Horario por día, dirección exacta, referencia para llegar, link de Maps,
estacionamiento. Ejemplo:

```md
# Horarios y ubicación

## Horario
- Lunes a jueves: 10:00 – 20:00
- Viernes: 10:00 – 21:00
- Sábado: 09:00 – 21:00
- Domingo: Cerrado

## Dónde estamos
Av. Ejemplo 123, Local 4, Col. Centro, CDMX.
Referencia: frente a la farmacia, entrando por la calle lateral.
Google Maps: https://maps.app.goo.gl/tu-link-aqui
Estacionamiento: en la calle (sin valet).
```

### 3. `como-agendar-y-cancelar.md`
Cómo se reserva, si aceptan walk-in, política de cancelación, tiempos de espera.
Ejemplo:

```md
# Cómo agendar y cancelar

## Agendar
Puedes agendar por WhatsApp o llegar directo (aceptamos sin cita).
En sábado por la tarde recomendamos agendar para no esperar.

## Walk-in
Sí aceptamos clientes sin cita. La espera típica en hora pico es de 15 a 25 min.

## Cancelar o cambiar
Avísanos con al menos 2 horas de anticipación si no puedes venir.
Así liberamos el espacio para otro cliente.
```

### 4. `nuestros-barberos.md`
Quiénes son los barberos, especialidad de cada uno (fades, barba, diseño, etc.).
Los clientes piden por barbero, así el bot responde mejor. Ejemplo:

```md
# Nuestros barberos

## Carlos
Especialista en fades y degradados. 8 años de experiencia.

## Memo
El crack de la barba y el afeitado clásico con navaja.

## Andrés
Diseños, líneas y cortes para niños.

> Puedes pedir tu corte con el barbero que prefieras al agendar.
```

### 5. `pagos-promos-y-preguntas-frecuentes.md`
Formas de pago, programa de lealtad/promos, y un FAQ corto con dudas comunes
(productos que venden, si atienden mujeres/niños, si hay baño, wifi, etc.).
Ejemplo:

```md
# Pagos, promos y preguntas frecuentes

## Formas de pago
Efectivo, tarjeta y transferencia.

## Programa de lealtad
Al 10º corte, el siguiente es gratis. Pregunta por tu tarjeta de cliente.

## Preguntas frecuentes
- **¿Atienden niños?** Sí, tenemos corte infantil.
- **¿Venden productos?** Sí: ceras, pomadas y aceites para barba.
- **¿Aceptan tarjeta?** Sí, y también transferencia.
- **¿Hay que agendar?** No es obligatorio, pero ayuda en horas pico.
```

---

## Checklist final (antes de cerrar la configuración)

- [ ] `services` con precios y duraciones reales del miembro
- [ ] `hours` con el horario real (ojo con domingos y viernes)
- [ ] `location` con dirección, ciudad y link de Maps reales
- [ ] `paymentMethods` y `contactPhone` correctos
- [ ] `customFields.barbers` con los nombres reales
- [ ] Diagnostic playbook inyectado en el system prompt
- [ ] Los 5 docs de KB creados y editados con info real
- [ ] KB reindexada después de editar
```
