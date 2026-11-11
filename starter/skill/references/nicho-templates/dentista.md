# Plantilla de nicho: Consultorio / Clínica Dental

> **Para qué sirve esto:** es una "receta" lista para arrancar la configuración de tu
> bot cuando tu negocio es un **consultorio o clínica dental**. Trae sugerencias de
> servicios con precios, horarios, ubicación de ejemplo, un guion de cómo el bot debe
> responder las dudas más comunes de pacientes, y 5 documentos de conocimiento (KB)
> que ya te dejamos casi escritos para que solo los edites con tus datos reales.
>
> **Nada de esto es obligatorio ni definitivo.** Son valores de ejemplo realistas para
> que no arranques de cero. Cambia precios, horarios y servicios por los TUYOS antes de
> publicar el bot.

---

## 1. Pre-fill para `member/config.local.ts`

Pega esto dentro de `businessConfig` en tu archivo `member/config.local.ts` y luego
**reemplaza cada valor con la información real de tu clínica**. Los precios son rangos
de referencia de mercado LATAM (en moneda local; cámbialos a la tuya).

```ts
export const businessConfig = {
  // ── Servicios que ofreces ──────────────────────────────────────────────
  // name = como lo verá el paciente | price = precio o "desde" | durationMin = duración típica
  services: [
    {
      name: "Consulta y diagnóstico",
      price: "$300 - $500",
      durationMin: 30,
      description:
        "Revisión general, diagnóstico y plan de tratamiento. Incluye orientación sobre costos.",
    },
    {
      name: "Limpieza dental (profilaxis)",
      price: "$600 - $900",
      durationMin: 45,
      description: "Eliminación de sarro y placa. Recomendada cada 6 meses.",
    },
    {
      name: "Resina / empaste (por pieza)",
      price: "$700 - $1,200",
      durationMin: 45,
      description: "Reparación de caries con resina del color del diente.",
    },
    {
      name: "Extracción simple",
      price: "$800 - $1,500",
      durationMin: 40,
      description: "Extracción de pieza dental no complicada.",
    },
    {
      name: "Extracción de muela del juicio",
      price: "$2,500 - $5,000",
      durationMin: 60,
      description: "Cirugía de tercer molar. El precio varía según complejidad y radiografía.",
    },
    {
      name: "Endodoncia (tratamiento de conducto)",
      price: "$2,500 - $4,500",
      durationMin: 90,
      description: "Tratamiento de nervio. El precio depende del número de conductos.",
    },
    {
      name: "Corona dental",
      price: "$3,500 - $7,000",
      durationMin: 60,
      description: "Corona de porcelana o zirconia. Requiere 2 citas.",
    },
    {
      name: "Blanqueamiento dental",
      price: "$2,000 - $4,000",
      durationMin: 60,
      description: "Blanqueamiento en consultorio. Resultados en una sola sesión.",
    },
    {
      name: "Ortodoncia (brackets) - valoración",
      price: "Valoración gratis / Tratamiento desde $12,000",
      durationMin: 45,
      description: "Estudio de ortodoncia. El costo total depende del caso y tipo de brackets.",
    },
    {
      name: "Urgencia dental (dolor)",
      price: "$400 - $800 (consulta de urgencia)",
      durationMin: 30,
      description: "Atención prioritaria para dolor agudo, golpe o pieza rota.",
    },
  ],

  // ── Horarios de atención ───────────────────────────────────────────────
  // Usa formato 24h. Si cierras un día, ponlo como "Cerrado".
  hours: {
    monday: "9:00 - 19:00",
    tuesday: "9:00 - 19:00",
    wednesday: "9:00 - 19:00",
    thursday: "9:00 - 19:00",
    friday: "9:00 - 19:00",
    saturday: "9:00 - 14:00",
    sunday: "Cerrado",
  },

  // ── Ubicación ──────────────────────────────────────────────────────────
  location: {
    address: "Av. Reforma 123, Local 4, Col. Centro",
    city: "Ciudad de México",
    reference: "A media cuadra del metro Insurgentes, edificio con fachada azul.",
    mapsUrl: "https://maps.google.com/?q=tu+clinica+dental",
    parking: "Estacionamiento disponible para pacientes (validamos boleto).",
  },

  // ── Métodos de pago ────────────────────────────────────────────────────
  paymentMethods: [
    "Efectivo",
    "Tarjeta de débito/crédito",
    "Transferencia",
    "Meses sin intereses (a partir de $3,000 con tarjetas participantes)",
    "Pago en parcialidades para tratamientos largos (ortodoncia, endodoncia)",
  ],

  // ── Teléfono de contacto (para urgencias o cuando el bot pasa a humano) ─
  contactPhone: "+52 55 1234 5678",

  // ── Campos personalizados del nicho dental ─────────────────────────────
  // Info extra que el bot puede usar para responder mejor.
  customFields: {
    seguros:
      "Trabajamos con facturación; no aplicamos seguros de gastos médicos directamente, " +
      "pero entregamos factura para que el paciente la tramite con su aseguradora.",
    primeraVisita:
      "La primera visita es de diagnóstico. Pedimos llegar 10 min antes y traer " +
      "radiografías previas si las tienen.",
    politicaCancelacion:
      "Pedimos avisar con al menos 24 horas de anticipación para reagendar sin costo.",
    odontopediatria: "Sí atendemos niños desde los 3 años.",
    radiografias:
      "Contamos con radiografía digital en consultorio; algunos tratamientos requieren " +
      "tomografía que se toma en un centro externo.",
  },
};
```

> **Tip:** El bot SOLO debe dar precios como **rangos o "desde"**. Un precio exacto de
> ortodoncia o endodoncia depende del caso clínico, así que deja que esos siempre
> terminen en una valoración con el dentista.

---

## 2. Diagnostic playbook (para inyectar en el system prompt)

Esto le dice a tu bot **cómo comportarse como recepcionista de una clínica dental**.
El skill de configuración lo agrega automáticamente a las instrucciones del bot. No
necesitas tocar código: solo revisa que tenga sentido para tu clínica y ajústalo.

```text
ERES LA RECEPCIÓN VIRTUAL DE UNA CLÍNICA DENTAL.

Tu trabajo es atender pacientes con calidez, resolver dudas frecuentes y agendar
citas. Hablas claro, en español, sin tecnicismos médicos innecesarios. Nunca das
diagnósticos ni recetas: para eso está el dentista.

REGLAS DE ORO:
- NUNCA diagnostiques ("eso es una caries", "tienes infección"). En su lugar di:
  "Por la descripción puede ser varias cosas; lo mejor es una valoración con el
  dentista para revisarlo bien."
- NUNCA recetes medicamentos ni antibióticos.
- Si el paciente reporta DOLOR FUERTE, sangrado que no para, golpe/trauma, hinchazón
  en la cara, o un diente tirado por un accidente → trátalo como URGENCIA: ofrece la
  cita más próxima del día y, si es algo grave, usa la herramienta para avisar al
  dueño/dentista (handoffHuman) y comparte el teléfono de urgencias.
- Da precios SIEMPRE como rango o "desde". Para tratamientos que dependen del caso
  (ortodoncia, endodoncia, coronas, muelas del juicio) explica que el precio final se
  define en la valoración.

CONSULTAS TÍPICAS Y CÓMO RESPONDER:

1. "¿Cuánto cuesta una limpieza / resina / extracción?"
   → Da el rango del servicio (busca en el catálogo/KB). Aclara que la consulta de
     diagnóstico define el plan exacto. Ofrece agendar.

2. "Me duele una muela / tengo dolor"
   → Muestra empatía. Pregunta: ¿desde cuándo?, ¿es constante o al masticar?, ¿hay
     hinchazón? NO diagnostiques. Ofrece cita de urgencia el mismo día si hay dolor
     fuerte. Si es muy grave, escala a humano.

3. "Quiero ponerme brackets / ortodoncia"
   → Explica que el primer paso es una valoración (di si es gratis o su costo).
     Menciona que el tratamiento se cotiza según el caso y que hay planes en
     parcialidades. Agenda la valoración.

4. "¿Aceptan mi seguro?" / "¿Dan factura?"
   → Responde según customFields.seguros. Si manejas facturación, dilo. Si no aplicas
     seguros directos, explícalo con claridad.

5. "¿Atienden niños?"
   → Responde según customFields.odontopediatria (edad mínima, etc.).

6. "¿Dónde están / cómo llego / tienen estacionamiento?"
   → Da dirección, referencia, link de mapa y nota de estacionamiento del config.

7. "¿Qué horario tienen?" / "¿Abren el sábado?"
   → Responde con los horarios reales del config. Si está cerrado ese día, dilo.

8. "Quiero agendar / cambiar / cancelar una cita"
   → Usa la herramienta de agenda (scheduleAppointment). Pide: nombre, servicio que
     busca, y día/hora preferidos. Confirma con el paciente antes de cerrar la cita.
     Para cancelar/reagendar recuerda la política de 24h.

9. "Tengo miedo al dentista / me da nervios"
   → Tranquiliza con calidez. Menciona que el equipo trabaja con pacientes nerviosos
     y que la primera cita es solo revisión, sin procedimientos sorpresa.

10. Pregunta que no sabes responder
    → No inventes. Di que confirmas con el equipo y, si conviene, captura el dato del
      paciente (captureLead) o escala a humano (handoffHuman).

OBJETIVO FINAL: que el paciente termine con una cita agendada o sus datos capturados
para que el consultorio le dé seguimiento.
```

---

## 3. Cinco documentos de KB sugeridos (edítalos con tus datos)

Estos son los 5 archivos de conocimiento que te recomendamos crear primero en
`member/kb/`. Vienen pre-escritos como ejemplo: **cámbialos por la realidad de tu
clínica** y luego reindexa (el skill te dice cómo). Crea cada uno como un `.md`.

### KB 1 — `servicios-y-precios.md`
```markdown
# Servicios y precios

> Todos los precios son aproximados. El precio final se confirma en la consulta de
> diagnóstico según cada caso.

- Consulta y diagnóstico: $300 - $500
- Limpieza dental (profilaxis): $600 - $900
- Resina / empaste por pieza: $700 - $1,200
- Extracción simple: $800 - $1,500
- Muela del juicio: $2,500 - $5,000 (depende de complejidad)
- Endodoncia (conducto): $2,500 - $4,500 (depende de conductos)
- Corona (porcelana/zirconia): $3,500 - $7,000
- Blanqueamiento: $2,000 - $4,000
- Ortodoncia: valoración + tratamiento desde $12,000
- Urgencia dental: $400 - $800

Aceptamos: efectivo, tarjeta, transferencia, meses sin intereses desde $3,000 y
parcialidades en tratamientos largos.
```

### KB 2 — `horarios-y-ubicacion.md`
```markdown
# Horarios y ubicación

Horarios:
- Lunes a viernes: 9:00 - 19:00
- Sábado: 9:00 - 14:00
- Domingo: cerrado

Dirección: Av. Reforma 123, Local 4, Col. Centro, CDMX.
Referencia: a media cuadra del metro Insurgentes, fachada azul.
Mapa: https://maps.google.com/?q=tu+clinica+dental
Estacionamiento: disponible para pacientes, validamos boleto.
Teléfono / WhatsApp: +52 55 1234 5678
```

### KB 3 — `urgencias-dentales.md`
```markdown
# Urgencias dentales

Atendemos urgencias el mismo día dentro del horario. Considera urgencia:
- Dolor de muela fuerte que no cede.
- Golpe o accidente con diente roto o tirado.
- Hinchazón en la cara o encía.
- Sangrado que no para.

Qué hacer mientras llegas:
- Diente tirado por golpe: guárdalo en leche o suero, NO lo limpies frotando, y ven
  cuanto antes (las primeras horas son clave).
- Dolor: puedes usar un analgésico de venta libre si no eres alérgico. NO pongas
  aspirina directo sobre la encía.

Fuera de horario, escríbenos por WhatsApp y te orientamos.
```

### KB 4 — `preguntas-frecuentes.md`
```markdown
# Preguntas frecuentes

**¿Necesito cita o atienden por orden de llegada?**
Trabajamos con cita para darte atención puntual. Las urgencias tienen prioridad.

**¿La primera visita ya incluye limpieza o tratamiento?**
La primera visita es de diagnóstico: revisamos, explicamos qué necesitas y cuánto
cuesta. Si hay tiempo y lo autorizas, podemos avanzar el mismo día.

**¿Atienden niños?**
Sí, desde los 3 años.

**¿Dan factura? ¿Aceptan seguro?**
Entregamos factura para que la tramites con tu aseguradora. No aplicamos seguros de
gastos médicos de forma directa.

**¿Duele el tratamiento?**
Usamos anestesia local; la mayoría de los procedimientos son indoloros. Si te da
nervio, dilo y vamos a tu ritmo.

**¿Tienen planes de pago?**
Sí, meses sin intereses y parcialidades en tratamientos largos como ortodoncia.
```

### KB 5 — `politicas-de-citas.md`
```markdown
# Políticas de citas

**Para agendar** necesitamos: tu nombre, el servicio que buscas y tu día/hora
preferidos. Te confirmamos disponibilidad.

**Cancelar o reagendar:** avísanos con al menos 24 horas de anticipación y lo movemos
sin costo. Las cancelaciones de último momento repetidas pueden requerir un anticipo
para futuras citas.

**Llegada:** te pedimos llegar 10 minutos antes, sobre todo en tu primera visita.

**Trae contigo:** identificación y, si tienes, radiografías o estudios previos.

**Acompañantes:** los menores deben venir con un adulto responsable.
```

---

## Checklist antes de publicar tu bot dental

- [ ] Cambié los **precios** por los reales de mi clínica.
- [ ] Puse mis **horarios** verdaderos (incluyendo si cierro algún día).
- [ ] Actualicé **dirección, referencia y link de mapa**.
- [ ] Puse mi **teléfono/WhatsApp** real en `contactPhone`.
- [ ] Revisé los **métodos de pago** que de verdad acepto.
- [ ] Edité los **5 documentos de KB** con mi información.
- [ ] Reindexé la KB (sigue las instrucciones del skill de configuración).
- [ ] Le di `/start` a mi propio bot de Telegram para tener el aviso de pacientes
      cuando el bot pase un caso a humano (handoff).
