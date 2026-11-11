# Nicho: Inmobiliaria

Plantilla de arranque para una inmobiliaria, agente de bienes raíces o desarrollador
que vende y renta propiedades. Pensada para LATAM. Copia las sugerencias, cambia los
ejemplos por tus propios datos y borra lo que no aplique.

## Pre-fill suggestions for member/config.local.ts

```ts
export const businessConfig = {
  hours: "Lun-Vie 9am-7pm. Sábado 10am-3pm. Domingo solo visitas agendadas.",
  services: [
    { name: "Asesoría de compra (sin costo)", price: 0 },
    { name: "Asesoría de renta (sin costo)", price: 0 },
    { name: "Comisión por venta (% sobre precio)", price: 0 },
    { name: "Comisión por renta (1 mes de renta)", price: 0 },
    { name: "Avalúo comercial", price: 1500 },
    { name: "Trámite de crédito hipotecario (acompañamiento)", price: 0 },
  ],
  location: "{{dirección de tu oficina, ej: Av. Reforma 123, Col. Centro, CDMX}}",
  paymentMethods: ["transferencia", "depósito", "cheque", "efectivo"],
  contactPhone: "{{tu teléfono / WhatsApp de la inmobiliaria}}",
  customFields: {
    "zonas que cubrimos": "Centro, Norte, Polanco, Zona Sur (ajusta a tu mercado)",
    "tipos de propiedad": "casas, departamentos, terrenos, locales comerciales, oficinas",
    "operaciones": "venta y renta",
    "comisión de venta": "5% + IVA sobre el precio de venta (estándar; confirma con el dueño)",
    "comisión de renta": "equivalente a 1 mes de renta",
    "trabajamos con créditos": "Infonavit, Fovissste, bancario y cofinanciamiento",
    "moneda": "MXN (cambia a tu moneda local: COP, ARS, CLP, USD, etc.)",
  },
};
```

> Nota: en bienes raíces el precio de cada operación casi nunca es fijo (depende de la
> propiedad). Por eso muchos `services` van en 0 y la comisión real se explica en la KB
> y se confirma con el dueño vía `handoffHuman`. NUNCA dejes que el bot invente un
> precio de propiedad o una comisión exacta que no esté escrita en la KB.

## Diagnostic playbook to inject in system prompt

```xml
<diagnostic_playbooks>
<playbook name="buscar_propiedad">
Cliente busca comprar o rentar. Primero pregunta lo esencial para filtrar:
1) ¿Comprar o rentar?  2) ¿Tipo de propiedad? (casa, depa, terreno, local)
3) ¿Zona o colonia?    4) ¿Presupuesto aproximado?  5) ¿Recámaras / m2 mínimos?
Con esos datos llama catalogQuery para buscar coincidencias en el catálogo.
Si hay propiedades: presenta 2-3 opciones (nombre, zona, precio, recámaras, link/ficha).
Si no hay coincidencias: captura el perfil con captureLead ("búsqueda activa") y di
"no tengo algo así disponible ahora, pero te aviso en cuanto entre una propiedad que
encaje". NO inventes propiedades que no estén en el catálogo.
</playbook>

<playbook name="precio_y_comision">
Cliente pregunta precio de una propiedad o cuánto cobran de comisión.
Para precio de propiedad: usa catalogQuery / searchKb con el nombre o ID; cita el dato exacto.
Para comisión: llama searchKb("comisión"); cita la política tal cual está escrita.
Si el cliente pide negociar el precio o una comisión especial → handoffHuman:
"eso lo ve directamente el asesor, déjame conectarte". NUNCA prometas descuentos.
</playbook>

<playbook name="agendar_visita">
Cliente quiere visitar una propiedad (o que vayan a valuar la suya).
Pide: propiedad de interés (o dirección), día y hora preferida, nombre y teléfono.
Si tienes scheduleAppointment (Cal.com): agéndala y confirma fecha/hora.
Si no: captura todo con captureLead ("visita solicitada") y avisa que un asesor
confirma la cita. Recuerda que domingos solo hay visitas previamente agendadas.
</playbook>

<playbook name="credito_hipotecario">
Cliente pregunta si puede comprar a crédito o cómo tramitarlo.
Llama searchKb("crédito") y explica las opciones que SÍ manejan (Infonavit, bancario, etc.).
Pregunta de forma general su situación (tipo de crédito, si ya tiene preaprobación) y
captura el lead con captureLead ("interés en crédito"). NO calcules mensualidades,
tasas ni montos de preaprobación: eso lo define el banco / asesor → handoffHuman si insisten.
</playbook>

<playbook name="requisitos_documentos">
Cliente pregunta qué papeles necesita para comprar, rentar o aplicar a crédito.
Llama searchKb("documentos") y enumera la lista que está en la KB
(identificación, comprobantes, aval, etc.). Si pregunta por un caso raro que no aparece
("soy extranjero", "compro vía empresa") → handoffHuman para que el asesor lo aterrice.
</playbook>

<playbook name="zona_y_disponibilidad">
Cliente pregunta si cubren cierta zona o si hay algo disponible ahí.
Llama searchKb("zonas") para confirmar cobertura y catalogQuery para ver inventario
en esa zona. Si no cubren la zona, dilo claro y ofrece capturar su dato por si más
adelante entra inventario.
</playbook>

<playbook name="foto_de_propiedad">
Cliente manda foto (de una propiedad de referencia o de la suya para valuar).
Si Pro tier: viewImage la foto, descríbela brevemente (tipo, estado aparente) y úsala
para entender mejor su búsqueda o para canalizar un avalúo → captureLead / handoffHuman.
Si Free tier: "no puedo ver imágenes en este plan, ¿me la describes?".
NUNCA des un valor de avalúo basado solo en una foto: eso requiere visita del asesor.
</playbook>
</diagnostic_playbooks>
```

## Suggested first 5 KB docs (member fills + edits)

1. `propiedades.md` — inventario destacado: por cada propiedad pon ID, tipo (casa/depa/terreno),
   operación (venta/renta), zona, precio, recámaras/baños, m2, y un resumen corto.
   (Si usas `catalogQuery`, aquí va el detalle que el bot debe poder citar — el catálogo vive en `member/config.local`.)
2. `zonas.md` — colonias y zonas que cubres, con una línea de contexto de cada una
   (precio promedio, perfil, qué la hace atractiva). Marca claramente las que NO cubres.
3. `comisiones-y-costos.md` — comisión de venta, comisión de renta, avalúo, gastos
   notariales aproximados y qué incluye tu servicio. Aquí vive la política de precios.
4. `creditos.md` — tipos de crédito que manejas (Infonavit, Fovissste, bancario,
   cofinanciamiento), pasos generales y con qué bancos/instituciones trabajas.
5. `requisitos-y-documentos.md` — papeles para comprar, para rentar (incluye aval/fiador,
   depósito), y para aplicar a crédito. Agrega tu política de cancelación de visitas y
   apartado (anticipo / arras) y vigencia de las ofertas.
