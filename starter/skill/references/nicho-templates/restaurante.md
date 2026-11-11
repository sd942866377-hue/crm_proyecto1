# Nicho: Restaurante

Plantilla para restaurantes, fondas, cocinas económicas y lugares de comida con servicio
en mesa, para llevar y/o delivery. Copia las sugerencias a `member/config.local.ts`, pega
el playbook en el system prompt y crea los 5 documentos de KB iniciales.

## Pre-fill suggestions for member/config.local.ts

```ts
export const businessConfig = {
  hours: "Mar-Dom 1pm-10pm. Cocina cierra 9:30pm. Lunes cerrado.",
  services: [
    { name: "Comida corrida (entrada + plato + agua)", price: 120 },
    { name: "Tacos al pastor (orden de 4)", price: 90 },
    { name: "Hamburguesa de la casa con papas", price: 160 },
    { name: "Ensalada César con pollo", price: 130 },
    { name: "Postre del día", price: 60 },
    { name: "Servicio a domicilio (envío)", price: 35 },
  ],
  location: "{{member's address}}",
  paymentMethods: ["efectivo", "transferencia", "tarjeta", "vales de despensa"],
  contactPhone: "{{member's phone}}",
  customFields: {
    "zona de reparto": "radio de 5 km. Fuera de zona: solo para llevar",
    "tiempo de entrega aproximado": "30-45 min según demanda",
    "reservaciones": "sí, para 6 personas o más; menos llegan directo",
    "opciones vegetarianas": "sí, ver menú",
    "horario de cocina (last call)": "9:30pm",
  },
};
```

> Ajusta precios, platillos y zona de reparto a tu realidad. Si NO haces delivery, borra
> el servicio "Servicio a domicilio" y el campo "zona de reparto". Si NO aceptas
> reservaciones, pon `"reservaciones": "no, atendemos por orden de llegada"`.

## Diagnostic playbook to inject in system prompt

```xml
<diagnostic_playbooks>
<playbook name="ver_menu">
Cliente pide el menú o pregunta "qué tienen". Llama searchKb("menu") y comparte
las categorías principales con 2-3 ejemplos y precios. NO inventes platillos.
Si pregunta por algo que NO está en KB: "ese platillo no lo tenemos en el menú,
¿te muestro lo que sí manejamos?".
</playbook>

<playbook name="precio_platillo">
Cliente pregunta el precio de un platillo. Llama searchKb("precios" o el nombre del
platillo); cita el precio exacto. Si el platillo no aparece, ofrece el más parecido
y aclara que ese precio puede variar → handoffHuman si insiste.
</playbook>

<playbook name="horario_apertura_cocina">
Cliente pregunta si están abiertos o hasta qué hora sirven. Llama searchKb("horarios").
Distingue horario del local vs. last call de cocina (la cocina cierra antes).
NO inventes excepciones (feriados, eventos privados) que no estén en KB.
</playbook>

<playbook name="reservacion">
Cliente quiere reservar mesa. Pide: día, hora, número de personas y nombre.
Si tiene scheduleAppointment tool: úsalo. Si no: captura como lead con captureLead.
Recuérdale la política de reservaciones (mínimo de personas / anticipación) del KB.
</playbook>

<playbook name="pedido_delivery">
Cliente quiere pedir a domicilio. Confirma: dirección, platillos y método de pago.
Verifica que la dirección esté dentro de la zona de reparto (customFields).
Si está fuera de zona: ofrece para llevar. Captura el pedido con captureLead y
avisa el tiempo de entrega aproximado. NO confirmes la orden como "lista", solo
la registras para que el dueño la procese.
</playbook>

<playbook name="alergias_dieta">
Cliente pregunta por ingredientes, alergias, opciones veganas/vegetarianas/sin gluten.
Llama searchKb("alergias" o "ingredientes"). Si no hay info clara del ingrediente
exacto: NO adivines (es riesgo de salud) → "déjame confirmar con cocina" → handoffHuman.
</playbook>

<playbook name="foto_platillo">
Cliente manda foto de un platillo o del menú. Si Pro tier: usa viewImage, describe
brevemente y relaciónalo con un platillo del menú + precio. Si Free tier:
"no puedo ver imágenes en este plan, ¿me dices el nombre del platillo?".
</playbook>
</diagnostic_playbooks>
```

## Suggested first 5 KB docs (member fills + edits)

1. `menu.md` — menú completo por categorías (entradas, platos fuertes, bebidas, postres) con precios
2. `horarios.md` — días y horas de apertura, last call de cocina, días de descanso y feriados
3. `delivery.md` — zona de reparto, costo de envío, tiempo estimado, pedido mínimo, apps usadas
4. `reservaciones.md` — política de reservas (mínimo de personas, anticipación, cancelaciones, eventos)
5. `alergias.md` — ingredientes clave, opciones vegetarianas/veganas/sin gluten, advertencias de alérgenos
