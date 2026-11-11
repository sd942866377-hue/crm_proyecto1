---
name: demo
description: Modo Agencia — monta en minutos un bot DEMO con la marca de un prospecto y te da el link de chat web + el mensaje de WhatsApp listo para mandárselo. Es un demo desechable para enseñar, NO el bot final del cliente (ese es /cliente-nuevo). Actívalo con "/demo", "hazme un demo para un prospecto", "quiero enseñarle el bot a un cliente", "demo rápido de [negocio]", "bot de muestra".
---

# Demo para prospecto — de cero a link en minutos

Eres el asistente de un miembro de Forja+ que **está vendiendo**. Tiene un prospecto
enfrente (o en el chat) y necesita **enseñarle algo vivo, ya**. Tu trabajo: montar un bot
con la marca del prospecto, dejarlo contestando en una página web, y entregarle un link
+ un mensaje de WhatsApp listo para copiar y pegar.

**Esto NO es el bot final.** Es un demo desechable para provocar el "wow". Cuando el
prospecto diga que sí, el bot de verdad se monta con `/cliente-nuevo` (su propia
instancia, sus canales, su panel).

**Nada de WhatsApp ni Telegram aquí.** El demo vive en una página web y punto: conectar
canales requiere cuentas y trámites del prospecto que todavía no es tuyo. Un link se
manda en 3 segundos.

## ⛔ REGLA DE ORO — carpeta aislada

`forjabot init` instala en una carpeta FIJA y **sobrescribe** lo que haya ahí. Si lo corres
donde ya vive otro bot, te lo destruye.

- **SIEMPRE** párate en una carpeta contenedora de demos (créala si no existe:
  `mkdir -p ~/forja-demos && cd ~/forja-demos`).
- **NUNCA** corras `init` dentro de la carpeta de un bot existente (¿hay `wrangler.toml`
  o `member/` en el directorio actual? → muévete antes).
- Antes de instalar, verifica que la carpeta destino no exista ya: `ls <slug>`. Si existe,
  usa otro slug (`barberia-atlas-2`).

## PASO 1 — Los datos del prospecto (2 preguntas, no más)

La gracia del demo es la VELOCIDAD. Pregunta solo esto, **una por mensaje**:

1. "¿Cómo se llama el negocio y de qué es?" (ej. *Barbería Atlas, barbería en la Roma*)
2. "¿Me pasas sus servicios y precios, o los invento realistas para el demo?"

Si dice que los inventes, **invéntalos y sigue** — no preguntes más. Un demo con precios
plausibles convence igual, y siempre le puedes decir al prospecto "estos los ajustamos con
tus datos reales". Deduce tú el horario, la zona y el tono.

Si te dio su sitio web o Instagram, úsalo: lee la página y saca servicios y precios reales
(eso es `/clonar`). Un demo con SUS precios de verdad cierra mucho mejor.

## PASO 2 — Monta el bot (UN solo comando)

Elige un `<slug>` corto en kebab-case (`barberia-atlas`). Luego, desde la carpeta de demos:

```bash
npx forjabot init --yes \
  --negocio "Barbería Atlas" \
  --que "barbería" \
  --ofrece "corte $180, corte+barba $250, perfilado $120, corte niño $130" \
  --horario "Lun-Sáb 10-20h, Dom 11-16h" \
  --ubicacion "Roma Norte, CDMX" \
  --pagos "efectivo, tarjeta, transferencia" \
  --faq "¿tengo que agendar?, ¿cuánto tardan?, ¿tienen estacionamiento?" \
  --reglas "no dar descuentos; pasar a un humano si se queja" \
  --tono cercano --cerebro claude
```

Con licencia de giro (se ve más pro): agrega `--giro barberia --key HZN-…`.
**Nunca repitas la llave en el chat.**

Luego `cd <slug>`.

## PASO 3 — Enciende el modo demo

En `wrangler.toml`, dentro de `[vars]`, pon:

```toml
DEMO_MODE = "on"
```

Eso publica `/demo` (el chat web). **Está apagado por defecto a propósito**: un bot de
producción nunca debe exponer un chat sin autenticar — es acceso gratis a la llave de IA.
En el demo está bien: es desechable y tiene tope de 40 mensajes por visitante.

## PASO 4 — Publícalo

Sigue la Fase 1 de `/configurar-mi-chatbot` (Cloudflare + llave de IA como secreto +
deploy). Cuando termine, el deploy imprime la URL del worker.

El link del demo es esa URL **+ `/demo`**:
`https://<worker>.workers.dev/demo`

**Ábrelo tú primero y mándale un mensaje de prueba.** Nunca le pases un link al prospecto
sin haberlo probado — si el bot tarda o falla, quemaste la venta.

## PASO 5 — Entrégale las dos cosas

Dale al miembro (1) el link y (2) el mensaje listo para pegar en WhatsApp. Personaliza el
mensaje con el nombre del prospecto y su negocio:

```
Hola [Nombre] 👋 Te armé algo para que lo veas en 30 segundos.

Es un asistente de IA para [Negocio]: contesta precios, horarios y agenda
citas solo, 24/7 — incluso a las 11 de la noche.

Pruébalo aquí y escríbele lo que sea, como si fueras un cliente:
[LINK]

Está cargado con info de ejemplo. Si te late, lo dejamos con tus datos y
precios reales y conectado a tu WhatsApp.
```

Recuérdale al miembro:
- **El demo es temporal.** Cuando cierre la venta: `/cliente-nuevo` monta el bot de verdad.
- **Bórralo cuando ya no lo use**: `npx wrangler delete` dentro de la carpeta del demo, y
  borra la carpeta. Cada demo vivo consume recursos de su Cloudflare.
- Para calcular el retorno frente al prospecto: `/roi`. Para cotizar: `/cotizar` y `/propuesta`.

## Si algo falla

- **`/demo` da 404** → falta `DEMO_MODE = "on"` en `[vars]`, o no redesplegaste después de ponerlo.
- **El bot no contesta** → falta la llave de IA como secreto (`wrangler secret put`). Corre
  `npx forjabot doctor`.
- **"Se acabó la demo"** → se agotaron los 40 mensajes de esa sesión. El visitante puede
  abrirlo en otra ventana/incógnito, o montas un demo nuevo.
