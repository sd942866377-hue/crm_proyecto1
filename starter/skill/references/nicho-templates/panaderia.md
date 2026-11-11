# Template de nicho: Panadería / Pastelería

> Úsalo cuando el negocio del miembro sea una panadería, pastelería, repostería o
> negocio de pan artesanal. Este archivo te da valores **sugeridos** para
> pre-llenar la configuración del bot. **Todo es editable**: pregúntale al miembro
> sus datos reales y reemplaza los ejemplos. Nunca dejes datos inventados en
> producción.

Cómo usar este template (para Claude Code durante `/configurar-mi-chatbot`):

1. Pre-llena `member/config.local.ts` con la sección (a) de abajo, pero confirma
   cada dato con el miembro (servicios, precios, horarios, dirección, teléfono).
2. Inyecta el **diagnostic playbook** de la sección (b) en el system prompt del
   bot para que sepa responder las consultas típicas de una panadería.
3. Crea los 5 documentos de la base de conocimiento (KB) de la sección (c) en
   `member/kb/` como punto de partida. El miembro los edita con su info real y
   luego corre el reindexado a Vectorize.

---

## (a) Pre-fill sugerido para `member/config.local.ts`

Valores de ejemplo realistas para una panadería de barrio en LATAM. Cambia los
precios a la moneda local del miembro (el ejemplo usa MXN; ajusta a COP, ARS,
PEN, CLP, etc. según el país).

```ts
export const businessConfig = {
  // Servicios / productos con precio. Para panadería, lista categorías y
  // productos estrella, no el catálogo completo (eso vive en `member/config.local`).
  services: [
    { name: "Pan dulce (concha, oreja, cuernito)", price: "$18 c/u" },
    { name: "Bolillo / telera", price: "$5 c/u" },
    { name: "Baguette artesanal", price: "$45" },
    { name: "Pan de caja integral", price: "$60" },
    { name: "Pastel personalizado (sabor a elegir)", price: "desde $450" },
    { name: "Pastel de evento (por persona)", price: "desde $35 por porción" },
    { name: "Cupcakes (caja de 6)", price: "$180" },
    { name: "Galletas decoradas (docena)", price: "$240" },
    { name: "Rosca de Reyes (temporada)", price: "desde $320" },
    { name: "Café americano / latte", price: "$35 / $45" },
  ],

  // Horarios reales del negocio. Una panadería suele abrir muy temprano.
  hours: {
    monday: "6:00 - 21:00",
    tuesday: "6:00 - 21:00",
    wednesday: "6:00 - 21:00",
    thursday: "6:00 - 21:00",
    friday: "6:00 - 21:00",
    saturday: "6:00 - 22:00",
    sunday: "7:00 - 14:00",
  },

  // Dirección y referencias para que el cliente llegue fácil.
  location: {
    address: "Av. Reforma 1234, Local 5, Col. Centro",
    city: "Ciudad de México",
    reference: "Frente al parque, junto a la farmacia",
    mapsUrl: "https://maps.google.com/?q=...", // pega el link real de Google Maps
  },

  // Formas de pago aceptadas.
  paymentMethods: [
    "Efectivo",
    "Tarjeta (débito/crédito)",
    "Transferencia",
    "CoDi / pago con QR",
  ],

  // Teléfono / WhatsApp de contacto directo.
  contactPhone: "+52 55 1234 5678",

  // Campos extra propios del nicho panadería.
  customFields: {
    pedidosPersonalizadosAnticipacion: "48 horas mínimo para pasteles de evento",
    anticipoPasteles: "50% de anticipo para confirmar el pedido",
    entregaDomicilio: "Sí, dentro de un radio de 5 km. Costo desde $40",
    productosDelDia: "El pan sale fresco a las 7:00 am y a las 5:00 pm",
    opcionesEspeciales: "Manejamos opciones sin azúcar, integrales y veganas bajo pedido",
    horaCierrePedidosMismoDia: "Pedidos para entrega el mismo día antes de las 14:00",
  },
};

export const memberConfig = {
  // Tono sugerido para el nicho. Cálido, cercano, antojable.
  toneNotes:
    "Habla cálido y cercano, como el panadero del barrio. Usa lenguaje " +
    "antojable al describir productos ('recién horneado', 'esponjosito', " +
    "'crujiente por fuera'). Si preguntan por pasteles de evento, recoge " +
    "siempre fecha, número de porciones y sabor.",

  // Cuándo pasar la conversación a un humano.
  handoffTriggers: [
    "pedido grande o de evento (más de 20 porciones)",
    "queja o producto en mal estado",
    "cotización de pastel muy personalizado con foto de referencia",
    "facturación / temas fiscales",
  ],
};
```

> Recuerda: el catálogo completo de productos con fotos y precios vive en el
> catálogo en `member/config.local` y se consulta con la herramienta `catalogQuery` (Pro).
> En `services` solo van los productos estrella y rangos de precio.

---

## (b) Diagnostic playbook para inyectar en el system prompt

Pega este bloque dentro del system prompt del bot (sección "Cómo atiendes las
consultas típicas de este negocio"). Le enseña al bot a manejar las preguntas que
más se repiten en una panadería.

```
Atiendes a clientes de una panadería/pastelería. Estas son las consultas más
comunes y cómo debes responderlas:

1. "¿Tienen pan fresco / a qué hora sale el pan?"
   - Confírmales los horarios en que sale pan recién horneado (ver customFields).
   - Si preguntan por un producto específico, usa searchKb / catalogQuery para
     decir si está disponible hoy.

2. "¿Cuánto cuesta un pastel / quiero un pastel para una fiesta?"
   - Recoge SIEMPRE estos datos antes de cotizar:
     • Fecha y hora de entrega o recolección
     • Número de porciones o personas
     • Sabor del pan y del relleno
     • Si quiere algo escrito o decoración especial
   - Recuérdales la anticipación mínima y el anticipo (ver customFields).
   - Si es un pedido grande o muy personalizado, usa handoffHuman para pasar al
     dueño y captureLead para guardar los datos del cliente.

3. "¿Hacen entregas a domicilio?"
   - Confirma cobertura, radio y costo de envío (ver customFields).
   - Si está fuera del radio, ofrece recolección en tienda.

4. "¿Tienen opciones sin azúcar / integrales / veganas?"
   - Responde según opcionesEspeciales. Si es bajo pedido, indícales la
     anticipación necesaria.

5. "¿Aceptan tarjeta / transferencia?"
   - Lista las formas de pago de paymentMethods.

6. "Quiero hacer un pedido para mañana / hoy"
   - Si es para el mismo día, verifica que sea antes de la hora de cierre de
     pedidos del mismo día (ver customFields).
   - Toma el detalle del pedido y, si manejas agenda, usa scheduleAppointment
     para reservar la hora de recolección.

7. "¿Dónde están ubicados / cómo llego?"
   - Da la dirección, la referencia y el link de Google Maps de location.

8. "¿Tienen pedidos de temporada (rosca, pan de muerto, etc.)?"
   - Confirma disponibilidad según la temporada y la anticipación para apartar.

Reglas generales:
- Nunca inventes precios ni disponibilidad. Si no lo sabes, ofrece pasar con una
  persona (handoffHuman) o pedir el dato.
- Para cualquier cotización de evento, captura siempre nombre y teléfono del
  cliente con captureLead.
- Sé antojable pero honesto: no prometas productos que no están en el catálogo.
```

---

## (c) 5 documentos de KB sugeridos para `member/kb/`

Crea estos 5 archivos como punto de partida. El miembro los edita con su info
real y luego corre el reindexado para subirlos a la base de conocimiento
(Vectorize). Son solo el arranque: el miembro puede agregar más.

### 1. `member/kb/productos-y-precios.md`
Listado de productos por categoría con precios y descripción antojable.
```md
# Productos y precios

## Pan dulce
- Concha (vainilla/chocolate) — $18
- Oreja — $20
- Cuernito — $18
- Dona glaseada — $22

## Pan salado
- Bolillo / telera — $5
- Baguette artesanal — $45
- Pan de caja integral — $60

## Pastelería
- Pastel personalizado — desde $450 (mínimo 48h de anticipación)
- Cupcakes (caja de 6) — $180
- Galletas decoradas (docena) — $240

## Bebidas
- Café americano — $35
- Latte — $45

> Edita esta lista con TUS productos y precios reales.
```

### 2. `member/kb/pedidos-de-pasteles-y-eventos.md`
Cómo funciona un pedido personalizado: anticipación, anticipo, sabores, entrega.
```md
# Pedidos de pasteles y eventos

- Anticipación mínima: 48 horas (eventos grandes, 5 días).
- Anticipo: 50% para confirmar el pedido. El resto al recoger/entregar.
- Sabores de pan: vainilla, chocolate, red velvet, tres leches, zanahoria.
- Rellenos: cajeta, chocolate, fresas con crema, nuez.
- Para cotizar necesitamos: fecha, número de porciones, sabor y decoración.
- Cancelaciones: el anticipo no es reembolsable con menos de 24h de aviso.

> Ajusta sabores, anticipación y políticas a tu negocio.
```

### 3. `member/kb/horarios-y-ubicacion.md`
Horarios de atención, a qué hora sale el pan, dirección y referencias.
```md
# Horarios y ubicación

## Horario
- Lunes a viernes: 6:00 - 21:00
- Sábado: 6:00 - 22:00
- Domingo: 7:00 - 14:00

## Pan recién horneado
- Primera tanda: 7:00 am
- Segunda tanda: 5:00 pm

## Dónde estamos
Av. Reforma 1234, Local 5, Col. Centro, CDMX.
Referencia: frente al parque, junto a la farmacia.
Google Maps: (pega tu link)

> Pon tus horarios y dirección reales.
```

### 4. `member/kb/entregas-y-pagos.md`
Cobertura de entrega a domicilio, costo de envío y formas de pago.
```md
# Entregas y formas de pago

## Entrega a domicilio
- Cobertura: radio de 5 km desde la sucursal.
- Costo de envío: desde $40 (según distancia).
- Pedidos para entrega el mismo día: ordenar antes de las 14:00.
- Fuera del radio: ofrecemos recolección en tienda.

## Formas de pago
- Efectivo
- Tarjeta (débito/crédito)
- Transferencia
- CoDi / pago con QR

> Edita cobertura, costos y métodos de pago según tu operación.
```

### 5. `member/kb/opciones-especiales-y-temporada.md`
Productos especiales (sin azúcar, integrales, veganos) y temporadas.
```md
# Opciones especiales y de temporada

## Opciones especiales (bajo pedido)
- Sin azúcar (endulzado con stevia/eritritol)
- Integral
- Vegano (sin lácteos ni huevo)
- Anticipación: 48 horas.

## Temporada
- Rosca de Reyes (enero) — desde $320, apartar con anticipación.
- Pan de muerto (octubre-noviembre).
- Pasteles navideños y de fin de año.

> Agrega tus productos especiales y de temporada.
```

---

## Notas finales para Claude Code

- Confirma TODOS los datos con el miembro antes de dejar el bot en producción.
  Los precios, horarios y dirección de este template son ejemplos.
- Ajusta la moneda y el lenguaje al país del miembro (este ejemplo es MXN/CDMX).
- Después de crear/editar los KB en `member/kb/`, corre el reindexado para que
  los documentos lleguen a la base de conocimiento (Vectorize).
- La carpeta `member/` nunca se sobrescribe en una actualización del bot, así que
  los cambios del miembro a su config y KB se conservan al correr
  `/actualizar-mi-bot`.
```
