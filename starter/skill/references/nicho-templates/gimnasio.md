# Plantilla de nicho: Gimnasio

Esta plantilla es para Claude Code. Cuando el miembro dice que su negocio es un **gimnasio, box de CrossFit, estudio de spinning, estudio de yoga/pilates o centro fitness**, usa esta plantilla para pre-llenar la configuración, ajustar el comportamiento del bot y crear los documentos iniciales de su base de conocimiento (KB).

**Cómo usarla (3 pasos):**
1. Copia las sugerencias de `businessConfig` a `member/config.local.ts` y dile al miembro que cambie los datos de ejemplo por los reales (precios, horarios, dirección).
2. Inyecta el "Playbook de diagnóstico" en el system prompt del bot (sección de comportamiento por nicho).
3. Crea los 5 documentos KB iniciales en `member/kb/` con el contenido sugerido y avísale al miembro que los edite con su información real antes de reindexar.

> Recuerda: todo lo que está en `member/` lo controla el miembro. Estos son **valores de ejemplo del nicho**, no datos reales. Siempre dile que los revise y corrija.

---

## (a) Pre-fill para `member/config.local.ts`

Pega esto dentro de `businessConfig` y pídele al miembro que ajuste cada campo. Los precios están en formato genérico (sin moneda fija) — pregúntale en qué moneda cobra (MXN, COP, ARS, USD, etc.) y ajústalos.

```ts
export const businessConfig = {
  // Identidad del negocio
  name: "Gimnasio Iron House", // <- cambiar por el nombre real

  // Servicios / planes con precios (el miembro DEBE ajustar precios y moneda)
  services: [
    {
      name: "Membresía mensual",
      price: "$650 MXN/mes",
      description: "Acceso ilimitado al área de pesas y cardio, lunes a domingo.",
    },
    {
      name: "Membresía trimestral",
      price: "$1,650 MXN (3 meses)",
      description: "Equivale a $550/mes. Pago único, ahorras 15%.",
    },
    {
      name: "Membresía anual",
      price: "$5,400 MXN (12 meses)",
      description: "Equivale a $450/mes. El mejor precio, pago único.",
    },
    {
      name: "Pase del día (visita)",
      price: "$80 MXN",
      description: "Acceso por un día, ideal para probar antes de inscribirte.",
    },
    {
      name: "Clases grupales (incluidas)",
      price: "Incluidas en la membresía",
      description: "Spinning, funcional, zumba y body pump según horario.",
    },
    {
      name: "Entrenamiento personalizado",
      price: "$300 MXN/sesión · $2,400 MXN (paquete 10)",
      description: "Sesión 1 a 1 con coach certificado, plan a tu medida.",
    },
    {
      name: "Inscripción (única vez)",
      price: "$200 MXN",
      description: "Cuota de alta. A veces gratis en promoción.",
    },
  ],

  // Horarios (el miembro ajusta a su realidad)
  hours: {
    monday: "05:00 - 23:00",
    tuesday: "05:00 - 23:00",
    wednesday: "05:00 - 23:00",
    thursday: "05:00 - 23:00",
    friday: "05:00 - 23:00",
    saturday: "07:00 - 20:00",
    sunday: "08:00 - 14:00",
  },

  // Ubicación (cambiar por dirección real)
  location: {
    address: "Av. Reforma 1234, Col. Centro, CDMX",
    reference: "Frente al parque, junto a la farmacia. Estacionamiento propio.",
    mapsUrl: "https://maps.google.com/?q=tu-direccion", // <- link real de Google Maps
  },

  // Métodos de pago aceptados
  paymentMethods: [
    "Efectivo",
    "Tarjeta de débito/crédito",
    "Transferencia bancaria",
    "Pago en app / domiciliación (si aplica)",
  ],

  // Teléfono de contacto / WhatsApp del gym
  contactPhone: "+52 55 1234 5678",

  // Campos personalizados del nicho gimnasio
  customFields: {
    freeTrialOffer: "Primera clase grupal gratis para nuevos visitantes.",
    amenities: "Regaderas, lockers, área de funcional, cardio, peso libre, máquinas.",
    parking: "Estacionamiento gratuito para miembros.",
    dressCode: "Ropa deportiva y toalla obligatoria. Calzado limpio de cambio.",
    minAge: "Edad mínima 15 años (menores con responsable y carta firmada).",
    freezePolicy: "Puedes congelar tu membresía hasta 15 días por mes (con aviso).",
    cancelPolicy: "Membresías mensuales sin permanencia. Avisa 5 días antes de tu corte.",
  },
};
```

---

## (b) Playbook de diagnóstico (inyectar en el system prompt)

Agrega este bloque a la sección de comportamiento por nicho del system prompt del bot. Le enseña a Claude cómo responder las consultas típicas de un gimnasio y cuándo usar cada herramienta.

```
COMPORTAMIENTO PARA GIMNASIO / CENTRO FITNESS:

Eres el asistente de un gimnasio. La mayoría de las personas que escriben quieren
inscribirse, conocer precios, horarios o probar una clase. Tu meta es resolver su
duda rápido y, cuando muestren interés, capturar sus datos o agendar su visita.

Consultas típicas y cómo manejarlas:

1. "¿Cuánto cuesta la mensualidad?" / "¿Qué planes tienen?"
   -> Usa searchKb / businessConfig.services. Da el precio del plan mensual primero,
      luego menciona que hay planes trimestral y anual más baratos por mes.
      Cierra preguntando: "¿Quieres que te aparte una clase de prueba gratis?"

2. "¿Tienen clase de prueba / pase gratis?"
   -> Sí: ofrece la primera clase grupal gratis (customFields.freeTrialOffer).
      Captura nombre + teléfono con captureLead y propón día/hora para que venga.

3. "¿Qué horarios tienen?" / "¿Abren los domingos?"
   -> Responde con businessConfig.hours. Si preguntan por una clase específica
      (spinning, zumba, funcional), revisa el KB de horario de clases.

4. "¿Dónde están?" / "¿Tienen estacionamiento?"
   -> Da la dirección, la referencia y el link de Maps (businessConfig.location).
      Menciona estacionamiento y amenities si preguntan.

5. "Quiero inscribirme" / "¿Cómo me apunto?"
   -> Captura sus datos con captureLead (nombre, teléfono, plan de interés).
      Si el gym usa agenda, ofrece agendar una visita con scheduleAppointment.
      Explica qué traer (identificación, ropa deportiva) y la cuota de inscripción.

6. "Quiero entrenador personal" / "¿Hacen rutinas?"
   -> Explica el servicio de entrenamiento personalizado y precios.
      Captura el lead y deja que el coach lo contacte para evaluar objetivos.

7. "¿Puedo congelar / cancelar mi membresía?"
   -> Responde con customFields.freezePolicy / cancelPolicy. Si el caso es
      delicado (reembolso, reclamo, lesión, baja médica) -> handoffHuman.

8. "Tengo una lesión / problema de salud, ¿puedo entrenar?"
   -> NO des consejo médico. Recomienda hablar con un profesional de salud y con el
      coach. Si insisten en algo médico delicado -> handoffHuman.

REGLAS:
- Nunca inventes precios, horarios de clases ni promociones: si no está en el KB ni
  en businessConfig, dilo y ofrece pasar al equipo (handoffHuman).
- No des asesoría médica ni nutricional específica. Eso siempre es para un humano/coach.
- Cuando alguien muestre intención de inscribirse o probar, SIEMPRE captura el lead.
- Sé motivador y cercano, pero breve. La gente del gym quiere respuestas rápidas.
```

---

## (c) 5 documentos KB iniciales (crear en `member/kb/`)

Crea estos 5 archivos con el contenido sugerido. Son ejemplos del nicho — dile al miembro que los **edite con su información real** y luego reindexe la KB.

### 1. `member/kb/planes-y-precios.md`
```md
# Planes y precios

> Edita con tus precios y moneda reales.

## Membresías
- **Mensual**: $650 MXN/mes — acceso ilimitado, lunes a domingo.
- **Trimestral**: $1,650 MXN (equivale a $550/mes) — ahorras 15%.
- **Anual**: $5,400 MXN (equivale a $450/mes) — nuestro mejor precio.

## Visitas y extras
- **Pase del día**: $80 MXN.
- **Inscripción (alta)**: $200 MXN, única vez (a veces gratis en promo).
- **Entrenamiento personalizado**: $300 MXN/sesión · paquete de 10 a $2,400 MXN.

## ¿Qué incluye la membresía?
Área de pesas, cardio, peso libre, máquinas y clases grupales (spinning, funcional,
zumba, body pump) según el horario vigente.

## Promociones vigentes
- Primera clase grupal **gratis** para nuevos visitantes.
- (Agrega aquí tus promos de temporada.)
```

### 2. `member/kb/horario-de-clases.md`
```md
# Horario de clases grupales

> Ajusta días, horas y nombres de instructores a tu programación real.

## Lunes a viernes
- 06:00 — Funcional
- 07:00 — Spinning
- 09:00 — Zumba
- 18:00 — Body Pump
- 19:00 — Spinning
- 20:00 — Funcional

## Sábado
- 09:00 — Zumba
- 10:00 — Funcional

## Notas
- Las clases están **incluidas** en cualquier membresía.
- Cupo limitado: llega 10 minutos antes para apartar lugar.
- Spinning requiere reservar (cupo por bicicletas).
```

### 3. `member/kb/horarios-y-ubicacion.md`
```md
# Horarios del gimnasio y ubicación

> Edita con tus horarios y dirección reales.

## Horario de apertura
- Lunes a viernes: 05:00 – 23:00
- Sábado: 07:00 – 20:00
- Domingo: 08:00 – 14:00
- Días festivos: horario reducido (avisamos por redes).

## Dónde estamos
Av. Reforma 1234, Col. Centro, CDMX.
Referencia: frente al parque, junto a la farmacia.
Mapa: https://maps.google.com/?q=tu-direccion

## Instalaciones
Regaderas, lockers, estacionamiento gratuito para miembros, área de funcional,
cardio, peso libre y máquinas.
```

### 4. `member/kb/como-inscribirse.md`
```md
# Cómo inscribirte

> Ajusta los pasos a tu proceso real.

## Pasos
1. Ven al gym o escríbenos por WhatsApp para apartar tu lugar.
2. Trae una identificación oficial.
3. Elige tu plan (mensual, trimestral o anual).
4. Cubre la inscripción ($200 MXN, a veces gratis en promo) y tu primer pago.
5. Te damos un recorrido y tu primera rutina de orientación.

## Qué traer el primer día
- Ropa deportiva y calzado limpio de cambio.
- Toalla (obligatoria) y botella de agua.
- Candado para el locker.

## Edad mínima
15 años. Menores de edad necesitan venir con un responsable y carta firmada.

## Métodos de pago
Efectivo, tarjeta de débito/crédito, transferencia y domiciliación (si aplica).
```

### 5. `member/kb/politicas-membresia.md`
```md
# Políticas de membresía

> Edita con tus políticas reales.

## Congelar membresía
Puedes congelar tu membresía hasta 15 días por mes avisando con anticipación.
Tu fecha de corte se recorre esos días.

## Cancelación
Las membresías mensuales NO tienen permanencia. Avisa al menos 5 días antes de tu
corte para que no se genere el siguiente cobro. Trimestrales y anuales no son
reembolsables, pero puedes transferirlas (consulta condiciones).

## Reglas de convivencia
- Usa toalla en todas las máquinas.
- Regresa el equipo a su lugar.
- No se permite apartar máquinas por tiempo prolongado.
- Calzado deportivo limpio dentro del área de entrenamiento.

## Invitados
Cada invitado paga pase del día ($80 MXN) salvo promoción vigente.

## Salud
No damos asesoría médica. Si tienes una lesión o condición, consulta a tu médico y
avisa a tu coach antes de entrenar.
```

---

## Recordatorio final para Claude

Después de aplicar esta plantilla:
- Dile al miembro que **revise y corrija** precios, moneda, horarios, dirección y políticas (son ejemplos).
- Recuérdale **reindexar la KB** después de editar los archivos `member/kb/*.md`.
- Confirma qué herramientas Pro quiere activar para este gym: `captureLead` (recomendado), `scheduleAppointment` con Cal.com (si agenda visitas o clases), `handoffHuman` (siempre), `catalogQuery` (si vende suplementos/mercancía — el catálogo va en `member/config.local`).
