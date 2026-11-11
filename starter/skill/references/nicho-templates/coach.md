# Nicho: Coach (coaching de vida, fitness, negocios, carrera)

Plantilla de arranque para un coach que vende sesiones 1:1, programas
grupales y mentorías. El bot atiende a personas que están "investigando"
antes de comprar: preguntan precios, cómo funciona, si sirve para su caso,
y quieren agendar una llamada de diagnóstico. La venta casi nunca se cierra
en el chat — el objetivo del bot es **calificar el lead y agendar la sesión
de descubrimiento**.

> Edita todo lo que diga `{{...}}` con los datos reales del miembro.
> Los precios, planes y horarios de abajo son EJEMPLOS para que el coach
> los ajuste — no los dejes tal cual.

---

## Pre-fill suggestions for member/config.local.ts

```ts
export const businessConfig = {
  hours: "Sesiones Lun-Vie 9am-7pm. Sáb 9am-1pm (solo agendadas). Domingo cerrado.",
  services: [
    { name: "Llamada de descubrimiento (15 min)", price: 0 },     // gancho gratis
    { name: "Sesión individual 1:1 (60 min)", price: 800 },
    { name: "Paquete 4 sesiones 1:1", price: 2800 },              // ahorro vs suelta
    { name: "Programa transformación 3 meses (12 sesiones + soporte)", price: 9500 },
    { name: "Mentoría grupal mensual (grupo reducido)", price: 1500 },
    { name: "Masterclass / taller en vivo", price: 500 },
  ],
  location: "Sesiones online por Zoom/Google Meet. Presencial solo {{ciudad}} bajo cita.",
  paymentMethods: ["transferencia", "tarjeta", "PayPal", "MSI 3 meses (programas)"],
  contactPhone: "{{teléfono del coach}}",
  customFields: {
    "modalidad": "online (default) y presencial en {{ciudad}}",
    "nicho de coaching": "{{vida / fitness / negocios / carrera / pareja}}",
    "duración sesión": "60 min individuales, 90 min grupales",
    "política de reagenda": "avisar 24h antes, sin costo. No-show pierde la sesión.",
    "garantía": "{{ej: si no ves valor en la 1ra sesión, te devuelvo el pago}}",
    "idioma": "español",
  },
};
```

**Notas para el coach:**
- La **llamada de descubrimiento gratis** es tu mejor herramienta de venta. Que el
  bot siempre la ofrezca como siguiente paso cuando el cliente duda o pregunta "¿me sirve?".
- Si NO quieres dar el precio del programa caro por chat, déjalo fuera de `services`
  y pon en KB: "El programa de 3 meses se cotiza en la llamada de descubrimiento según tus metas."

---

## Diagnostic playbook to inject in system prompt

```xml
<diagnostic_playbooks>
<playbook name="agendar_descubrimiento">
Cliente muestra interés ("me interesa", "cómo empiezo", "quiero info").
Objetivo PRINCIPAL del bot: agendar la llamada de descubrimiento gratis.
Pide: nombre, qué quiere mejorar/lograr, y disponibilidad (día/franja).
Si tiene scheduleAppointment tool: agéndala (servicio "Llamada de descubrimiento").
Si no: captura como lead con captureLead e indica que el coach lo contactará.
</playbook>

<playbook name="precio_planes">
Cliente pregunta precios. Llama searchKb("precios planes"); cita los planes.
Enmarca el valor antes del precio: qué incluye, resultado esperado.
Si pregunta por el programa largo y NO está en KB con precio:
"El programa se cotiza en la llamada de descubrimiento según tus metas. ¿Agendamos?"
NUNCA inventes descuentos ni promociones que no estén en KB.
</playbook>

<playbook name="me_sirve_a_mi">
Cliente describe su situación ("estoy estancado", "no bajo de peso",
"quiero cambiar de carrera") y pregunta si el coaching le sirve.
NO diagnostiques ni prometas resultados específicos. Valida el problema,
explica brevemente cómo trabaja el coach (searchKb("metodología")) y dirige
SIEMPRE a la llamada de descubrimiento gratis para evaluar su caso.
</playbook>

<playbook name="individual_vs_grupal">
Cliente no sabe si tomar 1:1 o grupal. Llama searchKb("planes modalidades").
Resume diferencias: 1:1 = personalizado, más caro; grupal = comunidad, más accesible.
Recomienda según lo que el cliente dijo necesitar. Cierra ofreciendo la llamada
de descubrimiento para definirlo juntos.
</playbook>

<playbook name="resultados_testimonios">
Cliente pregunta "¿funciona?" o "¿tienes casos de éxito?".
Llama searchKb("testimonios resultados"); comparte 1-2 casos reales del KB.
NO inventes testimonios. Si no hay en KB: "El coach te comparte casos reales
en la llamada de descubrimiento." Evita garantizar resultados.
</playbook>

<playbook name="logistica_sesion">
Cliente pregunta cómo es la sesión (online/presencial, duración, plataforma).
Llama searchKb("modalidad logística"); responde directo.
Default: online por Zoom/Meet, 60 min. NO inventes que hay presencial si el KB no lo dice.
</playbook>

<playbook name="reagenda_cancelacion">
Cliente quiere mover o cancelar una sesión. Llama searchKb("políticas reagenda").
Cita la política (ej: avisar 24h antes sin costo, no-show pierde la sesión).
Si tiene scheduleAppointment: ayúdalo a reagendar. Si es caso especial
(emergencia, reembolso, queja): handoffHuman para que lo vea el coach.
</playbook>
</diagnostic_playbooks>
```

---

## Suggested first 5 KB docs (member fills + edits)

1. `precios.md` — planes y paquetes con precios, qué incluye cada uno, qué se cotiza en llamada.
2. `metodologia.md` — cómo trabaja el coach, en qué se especializa, para quién SÍ y para quién NO es.
3. `modalidad.md` — online vs presencial, plataforma (Zoom/Meet), duración, qué necesita el cliente.
4. `testimonios.md` — 3-5 casos reales con resultados (con permiso del cliente), sin exagerar.
5. `politicas.md` — reagenda, cancelaciones, no-show, reembolsos, garantía, formas de pago.

> Consejo: el doc más importante es `metodologia.md`. Es lo que diferencia al coach
> de la competencia y lo que el bot usa para responder "¿me sirve a mí?". Dedícale tiempo.
