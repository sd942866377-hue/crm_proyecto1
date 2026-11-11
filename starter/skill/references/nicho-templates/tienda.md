# Plantilla de nicho: Tienda / Comercio minorista

> Esta plantilla es para negocios que **venden productos** al público: tiendas de ropa, tiendas de regalos, papelerías, ferreterías, tiendas de abarrotes, tiendas de mascotas, tiendas naturistas, jugueterías, boutiques, mueblerías, etc.
>
> No es para servicios (barbería, spa, consultorio). Si el negocio agenda citas en vez de vender productos, usa otra plantilla.
>
> **Cómo se usa esta plantilla:** durante `/configurar-mi-chatbot`, Claude lee este archivo, te hace las preguntas de abajo y rellena `member/config.local.ts` y `member/kb/` con valores realistas que tú confirmas o corriges. **Nada de esto es definitivo** — son sugerencias iniciales que el miembro edita con sus datos reales.

---

## Parte A — Sugerencias para `member/config.local.ts`

Esto es lo que Claude propone como punto de partida en el `businessConfig`. El miembro reemplaza nombres, precios, horarios y dirección con los suyos.

```ts
// member/config.local.ts
import type { BusinessConfig, MemberConfig } from "../src/config/types";

export const businessConfig: BusinessConfig = {
  // ── Servicios = en tienda, los "servicios" son las CATEGORÍAS o productos estrella ──
  // Pon aquí los productos/categorías que más te preguntan, con su rango de precio.
  // El bot los usa para responder "¿qué venden?" y "¿cuánto cuesta X?".
  services: [
    { name: "Ejemplo: Playeras básicas", price: "Desde $149 MXN", description: "Algodón, tallas CH a XXL, varios colores" },
    { name: "Ejemplo: Mochilas", price: "$399 - $899 MXN", description: "Escolares y de viaje, garantía de costuras" },
    { name: "Ejemplo: Artículos de regalo", price: "$99 - $1,200 MXN", description: "Para cumpleaños, aniversarios y día festivos" },
    { name: "Ejemplo: Producto estrella / más vendido", price: "$XXX MXN", description: "Descríbelo en una línea" },
  ],

  // ── Horarios de atención de la TIENDA FÍSICA (cuándo pueden ir o llamar) ──
  // Usa formato 24h. Deja el día vacío ("") si cierras ese día.
  hours: {
    monday: "10:00 - 20:00",
    tuesday: "10:00 - 20:00",
    wednesday: "10:00 - 20:00",
    thursday: "10:00 - 20:00",
    friday: "10:00 - 21:00",
    saturday: "10:00 - 21:00",
    sunday: "11:00 - 18:00", // muchas plazas abren domingo; ajusta o pon "" si cierras
  },

  // ── Ubicación física ──
  location: {
    address: "Av. Ejemplo #123, Local 4, Col. Centro",
    city: "Tu Ciudad, Estado",
    reference: "Frente a la plaza principal / dentro de Plaza XYZ, planta baja",
    googleMapsUrl: "https://maps.google.com/?q=PEGA_AQUI_TU_LINK", // saca tu link de Google Maps
  },

  // ── Métodos de pago que aceptas ──
  paymentMethods: [
    "Efectivo",
    "Tarjeta de débito y crédito",
    "Transferencia (SPEI)",
    "Mercado Pago / código QR",
    // "Meses sin intereses (3, 6 MSI con tarjetas participantes)", // descomenta si aplica
  ],

  // ── Teléfono de contacto directo (para llamadas o WhatsApp) ──
  contactPhone: "+52 55 0000 0000",

  // ── Campos personalizados específicos de tienda ──
  // El bot puede usar estos valores en sus respuestas.
  customFields: {
    entrega: "Sí hacemos envíos a domicilio dentro de la ciudad (costo según zona) y por paquetería al resto del país.",
    tiempoEnvioLocal: "Mismo día o siguiente día hábil dentro de la ciudad",
    tiempoEnvioNacional: "2 a 5 días hábiles por paquetería",
    envioGratisDesde: "Envío gratis en compras mayores a $799 MXN", // pon tu mínimo o "No aplica"
    apartado: "Sí apartamos productos hasta por 7 días con el 30% de anticipo",
    cambiosDevoluciones: "Cambios dentro de los primeros 15 días con ticket de compra y etiquetas intactas",
    facturacion: "Sí facturamos. Pide tus datos fiscales al momento de pagar.",
    mayoreo: "Manejamos precio especial a partir de 12 piezas / $3,000 de compra", // o "No manejamos mayoreo"
    estacionamiento: "Estacionamiento gratis para clientes / pensión en la plaza",
  },
};

// ── Configuración del miembro (identidad del negocio + tono del bot) ──
export const memberConfig: MemberConfig = {
  businessType: "tienda", // no cambiar: identifica el nicho
  greeting:
    "¡Hola! 👋 Bienvenido a [NOMBRE DE TU TIENDA]. " +
    "Puedo ayudarte con precios, disponibilidad, horarios, envíos y apartados. ¿Qué andas buscando?",
  tone: "amable, cercano y servicial — como un buen vendedor de mostrador que conoce su mercancía",
  // Cosas que el bot NO debe hacer:
  guardrails:
    "No inventes precios ni existencias exactas que no estén en la base de conocimiento. " +
    "Si no estás seguro de si hay stock de un artículo, ofrece verificar con una persona o invita a llamar. " +
    "Nunca prometas descuentos o promociones que no estén confirmados.",
};
```

> **Nota para Claude durante la configuración:** los `services` en tienda NO son servicios agendables. Son las categorías/productos que el bot menciona cuando preguntan "¿qué venden?" o "¿cuánto cuesta?". El agendado de citas (`scheduleAppointment`) **no aplica** a la mayoría de tiendas — déjalo desactivado salvo que la tienda haga algo como "asesoría de imagen" o "instalación a domicilio". El `catalogQuery` (Pro) sí es muy útil aquí si el miembro llena su catálogo de productos en `member/config.local`.

---

## Parte B — Diagnostic playbook (inyectar en el system prompt)

Esto se agrega al system prompt del bot para que sepa **cómo razonar ante las consultas típicas de una tienda**. No son respuestas fijas; son guías de comportamiento.

```
CONTEXTO DE NICHO: Atiendes a clientes de una TIENDA que vende productos al público.
La mayoría de las conversaciones son cortas y buscan resolver una de estas intenciones:

1) DISPONIBILIDAD / "¿Tienen X?"
   - Primero busca en la base de conocimiento (searchKb) y, si está habilitado, en el catálogo (catalogQuery).
   - Si encuentras el producto, confirma existencia, precio y variantes (talla/color/modelo).
   - Si NO lo encuentras o no estás seguro del stock real, NO inventes. Di que vas a verificar
     disponibilidad y ofrece pasar la consulta a una persona (handoffHuman) o invita a llamar/visitar.

2) PRECIO / "¿Cuánto cuesta X?"
   - Da el precio o rango que esté en la base de conocimiento. Si hay variantes, aclara el rango.
   - Si te preguntan por descuento o regateo, no prometas nada que no esté confirmado.
     Menciona promociones vigentes SOLO si están en la KB.

3) ENVÍOS Y ENTREGAS / "¿Hacen envíos? ¿Cuánto tarda? ¿Llega a mi ciudad?"
   - Responde con la política de envíos de la KB (local, nacional, costo, envío gratis desde X).
   - Si preguntan por una zona específica que no conoces, pide el código postal y ofrece confirmar el costo.

4) HORARIOS Y UBICACIÓN / "¿A qué hora abren? ¿Dónde están?"
   - Usa hours, location y referencias. Comparte el link de Google Maps cuando lo pidan o convenga.
   - Si preguntan "¿están abiertos ahorita?", razona con el horario del día actual.

5) PAGOS / "¿Aceptan tarjeta? ¿Meses sin intereses? ¿Facturan?"
   - Responde con paymentMethods y los customFields (facturación, MSI si aplica).

6) APARTADO / RESERVA / "¿Me lo pueden apartar?"
   - Explica la política de apartado de la KB (anticipo, días que lo guardan).
   - Si quieren apartar en firme, captura sus datos (captureLead): nombre, teléfono, producto y variante.

7) CAMBIOS Y DEVOLUCIONES / "Compré algo y quiero cambiarlo"
   - Explica la política (plazo, ticket, condiciones). Si es un caso especial o reclamo,
     escala a una persona (handoffHuman).

8) MAYOREO / COMPRA GRANDE
   - Si hay política de mayoreo, compártela y captura el lead (captureLead) para que un humano cotice.

REGLAS DE ORO PARA TIENDA:
- Nunca inventes existencias ni precios. La fuente de verdad es la base de conocimiento y el catálogo.
- Cuando detectes intención de COMPRA (quiere apartar, pide cotización de varias piezas,
  pregunta cómo pagar/recoger), captura el lead y, si hace falta atención humana, haz handoff.
- Sé breve y concreto. La gente que pregunta en una tienda quiere respuestas rápidas.
- Cierra cada respuesta útil con una invitación suave a comprar o visitar
  ("¿Te lo aparto?", "¿Quieres que te diga cómo llegar?", "¿Te paso el costo de envío a tu zona?").
```

---

## Parte C — 5 KB docs sugeridos iniciales (`member/kb/*.md`)

Claude crea estos 5 archivos como borrador en `member/kb/`. El miembro los edita con sus datos reales y luego corre el reindexado a Vectorize. **Entre más específicos, mejor responde el bot.**

### 1. `member/kb/catalogo-y-precios.md`
El documento más importante. Lista de productos/categorías con precio, variantes y existencia general.

```markdown
# Catálogo y precios

## Categoría: [Ej. Ropa de dama]
- **Blusas casuales** — $199 a $349 MXN. Tallas CH, M, G, XG. Varios estampados.
- **Jeans** — $399 a $599 MXN. Tallas 26 a 34. Corte recto y skinny.
- **Vestidos** — $449 a $799 MXN. Tallas CH a XG.

## Categoría: [Ej. Calzado]
- **Tenis casuales** — $599 a $999 MXN. Del 22 al 28.
- **Sandalias** — $299 a $499 MXN.

## Productos estrella / más vendidos
- [Producto] — [precio] — [por qué es popular]

> Actualiza este documento cuando cambien precios o llegue mercancía nueva.
> Si dejas de manejar un producto, bórralo de aquí para que el bot no lo ofrezca.
```

### 2. `member/kb/envios-y-entregas.md`
Todo lo de logística: zonas, costos, tiempos, envío gratis, recolección en tienda.

```markdown
# Envíos y entregas

## Recoger en tienda
Sin costo. Te avisamos cuando esté listo tu pedido.

## Envío local (misma ciudad)
- Costo: $XX MXN (o gratis desde $799 de compra).
- Tiempo: mismo día / siguiente día hábil.
- Zonas que cubrimos: [lista de colonias o "toda la ciudad"].

## Envío nacional (paquetería)
- Costo: calculado por peso y destino (aprox. $99 a $199 MXN).
- Tiempo: 2 a 5 días hábiles.
- Paqueterías: [Estafeta / FedEx / etc.].

## Envío gratis
Aplica en compras mayores a $799 MXN dentro de la ciudad. [Ajusta tu mínimo o pon "No aplica".]
```

### 3. `member/kb/pagos-apartado-facturacion.md`
Cómo se puede pagar, política de apartado y facturación.

```markdown
# Pagos, apartado y facturación

## Métodos de pago
Efectivo, tarjeta de débito/crédito, transferencia (SPEI), Mercado Pago / QR.
[Meses sin intereses: 3 y 6 MSI con tarjetas participantes — si aplica.]

## Apartado
- Apartamos hasta por 7 días con el 30% de anticipo.
- Si no se liquida en el plazo, el anticipo [se conserva como saldo / se pierde — define tu política].

## Facturación
- Sí facturamos. Proporciona tus datos fiscales (RFC, razón social, uso de CFDI) al pagar.
- Tienes hasta [fin del mes / 72 horas] para solicitar tu factura.
```

### 4. `member/kb/cambios-devoluciones-garantia.md`
Políticas que generan más dudas y reclamos.

```markdown
# Cambios, devoluciones y garantía

## Cambios
- Plazo: 15 días naturales desde la compra.
- Requisitos: ticket de compra, producto sin uso, etiquetas intactas.
- No se aceptan cambios en: ropa interior, artículos de oferta/liquidación, productos perecederos.

## Devoluciones (reembolso)
- [Aplican solo por defecto de fábrica / no se hacen reembolsos en efectivo, solo cambio o nota de crédito.]

## Garantía
- [Producto X] tiene garantía de [tiempo] por defectos de fabricación.
- La garantía no cubre mal uso ni daño accidental.
```

### 5. `member/kb/promociones-y-preguntas-frecuentes.md`
Promos vigentes + dudas comunes que no caben en los otros docs.

```markdown
# Promociones y preguntas frecuentes

## Promociones vigentes
- [Ej. 2x1 en playeras seleccionadas hasta fin de mes.]
- [Ej. 10% de descuento pagando en efectivo.]
> Borra o actualiza las promos cuando terminen para que el bot no las siga ofreciendo.

## Preguntas frecuentes
**¿Manejan mayoreo?**
Sí, a partir de 12 piezas o $3,000 de compra tenemos precio especial. [O "No manejamos mayoreo."]

**¿Tienen estacionamiento?**
[Estacionamiento gratis para clientes / pensión en la plaza.]

**¿Puedo apartar por WhatsApp y recoger después?**
Sí, mándanos el producto que quieres, te confirmamos disponibilidad y precio, y lo apartamos con tu anticipo.

**¿Hacen pedidos especiales o sobre encargo?**
[Sí, sobre [productos] con [anticipo] y [tiempo de entrega] / No, solo vendemos lo que está en existencia.]

**¿Atienden por WhatsApp fuera de horario?**
Respondemos lo antes posible dentro del horario de la tienda. Tus mensajes no se pierden.
```

---

## Checklist post-configuración (para el miembro)

- [ ] Cambié todos los precios y nombres de ejemplo por los reales de mi tienda.
- [ ] Puse mi dirección real y el link de Google Maps que funciona.
- [ ] Confirmé mis horarios día por día (y cerré los días que no abro).
- [ ] Revisé que los métodos de pago coincidan con lo que de verdad acepto.
- [ ] Edité los 5 documentos de la base de conocimiento con mi información real.
- [ ] Borré las promociones de ejemplo o las reemplacé por las mías vigentes.
- [ ] Reindexé la base de conocimiento después de editar los archivos de `member/kb/`.
- [ ] Le probé al bot 3 preguntas reales de mis clientes (precio, envío, horario) y respondió bien.
