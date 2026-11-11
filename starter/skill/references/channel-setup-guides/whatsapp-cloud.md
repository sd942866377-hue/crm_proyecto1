# Conectar tu bot a WhatsApp con la Cloud API oficial (directo con Meta)

Esta guía conecta tu chatbot a **WhatsApp** usando la **Cloud API oficial de Meta**, sin intermediarios como Twilio ni ManyChat. Está escrita para que la sigas aunque no sepas nada de programación. Claude Code hace el trabajo técnico; **estas credenciales solo las puedes conseguir tú** porque salen de tu cuenta de Meta.

> Esta guía sigue el **mismo orden, paso a paso, que el video tutorial**. No te saltes fases ni las hagas fuera de orden — cada una depende de que la anterior ya esté hecha.

> **¿Por qué esta opción?** Va directo a Meta, así que pagas **la tarifa más barata** (sin markup de un tercero) → mejor margen si revendes bots. La contra es que el setup es **más pesado** que Twilio: creas una cuenta de WhatsApp Business (WABA) y, para producción, haces verificación de negocio. Pero **puedes dejarlo funcionando gratis** con el **número de prueba** de Meta antes de meter tu número real.
>
> Si solo quieres ver WhatsApp vivo en 10 minutos, Twilio es más rápido de arrancar (ver `twilio-whatsapp.md`). Esta guía es para quien va en serio con volumen y margen.

---

## 🧭 Antes de tocar nada: quién es quién

**El error #1 que hace perder tiempo en este setup es confundir estos dos roles.** Léelo antes de seguir:

Piensa en un negocio real con un WhatsApp de atención a clientes. Ese número **es el negocio** — la línea desde la que se responde. Cuando tú le escribes para probar que el bot funciona, **eres un cliente más**: le escribes al negocio, el negocio no se escribe a sí mismo.

| Número | Rol | Es… |
|---|---|---|
| El número de la Cloud API (el de prueba `+1 555…` o tu número real) | **El bot / el negocio** | La línea desde la que el bot **RESPONDE** |
| Tu celular personal | **Un cliente** | El teléfono desde el que **TÚ le escribes** al bot, como cliente de prueba |

Tu celular **no reemplaza** al número del bot. Para probar, tu celular le escribe al número del bot — igual que un cliente le escribe al WhatsApp de un negocio. Esto vuelve a importar en la **Fase E (Probar)**: si el número del bot es tu **número real**, no puedes probarlo desde ese mismo celular — necesitas otro teléfono, o pedirle a alguien que te escriba.

## Qué vas a lograr

Que cuando un cliente le escriba a tu número de WhatsApp, tu bot le responda solo — incluyendo **notas de voz e imágenes** (el bot las procesa por un proxy de media firmado, no tienes que configurar nada extra). En modo prueba funciona con hasta ~5 números que tú verifiques; con número real y negocio verificado, con cualquiera.

## Antes de empezar

- Necesitas una cuenta de **Facebook** y acceso a **https://developers.facebook.com** (Meta for Developers). Es gratis.
- Un **Business Portfolio** (portafolio de negocio) en **https://business.facebook.com**. Si no tienes, el asistente te deja crear uno en el camino.
- Tu Worker ya desplegado (Claude Code te da la URL al terminar `pnpm run deploy`, algo como `https://TU-WORKER.workers.dev`).

---

## Elige tu ruta

Antes de crear nada en Meta, decide por cuál vas — cambia lo que pasa en un par de pasos más adelante:

### Ruta A · Número de prueba (recomendada para arrancar)
- Gratis e inmediata — Meta te la da lista, sin verificación de negocio.
- ⚠️ Restricción crítica: **SOLO responde a números que tú agregues y verifiques** en la lista "Para" (máximo ~5).
- Si alguien fuera de esa lista le escribe al bot, ves el error **131030**: "el número que escribió no está en esa lista".
- Ideal para: ver el bot vivo en 5 minutos, hacer una demo.

### Ruta B · Número real (producción)
- Registras el número de negocio del cliente → se crea (o cambia) una **WABA** nueva, y esto **cambia** tu `WHATSAPP_PHONE_NUMBER_ID`.
- Ya no hay lista blanca: responde a **cualquiera**, dentro de la ventana de servicio de 24h.
- ⚠️ Requiere una **SIM o número DEDICADO**. Conectar un número a la Cloud API lo **saca** de WhatsApp / WhatsApp Business normal — no uses el WhatsApp personal de diario del negocio.
- El nombre del perfil queda en `PENDING_REVIEW` tras registrarlo — **no bloquea la mensajería**, solo tarda en aprobarse.
- Si decides pasar a esta ruta **después** de haber guardado los secrets de la Ruta A, hay un paso extra que no te puedes saltar: la **Fase D**.

> No es una decisión para siempre: puedes arrancar por la Ruta A y subir a la Ruta B más adelante. Solo ten claro en cuál estás parado en cada momento — cambia cuál es tu Phone Number ID.

---

## FASE A — Base en Meta

> Meta está desplegando gradualmente una interfaz nueva llamada **"Casos de uso"** en developers.facebook.com. Esta guía usa los nombres de esa interfaz nueva. Si a ti te sale la interfaz vieja (con "Add Product" y una lista de productos), es el mismo flujo con otros nombres — usa este mapeo:

| Interfaz VIEJA | Interfaz NUEVA (la que usa esta guía) |
|---|---|
| Create App → Other → Business | Caso de uso **"Conectarte con los clientes a través de WhatsApp"** |
| Productos → WhatsApp → **Set up** | Fila **"Personalizar caso de uso…"** en el Panel |
| WhatsApp → **API Setup** | Menú lateral **"Configuración de la API"** |
| Webhook fields → `messages` | Dentro de "Configuración de la API → Paso 3", suscribir el campo **`messages`** |

Textos exactos que vas a ver (en español) y que debes reconocer en la interfaz nueva: **"Casos de uso"**, **"Personalizar caso de uso"**, **"Configuración de la API"**, botón **"Generar token de acceso"**, **"Enviar y recibir mensajes"**, **"Paso 1: Seleccionar números de teléfono"** (dropdowns **"De"** y **"Para"**), **"Identificador de número de teléfono"** (= Phone Number ID), **"Identificador de la cuenta de WhatsApp Business"** (= WABA ID), **"Administrar lista de números de teléfono"**.

### Paso 1 — Crea tu app con el caso de uso de WhatsApp

1. Entra a **https://developers.facebook.com/apps** e inicia sesión.
2. Dale **Crear app**. En la pantalla **Casos de uso**, elige **"Conectarte con los clientes a través de WhatsApp"**.
3. Asóciala a tu **Business Portfolio** (o crea uno ahí mismo) y confírmala.

> Si ya tienes una app de Meta para Instagram/Messenger (la de `meta-oficial.md`), **puedes usar la misma** y solo agregarle el caso de uso de WhatsApp. En ese caso, WhatsApp y Meta oficial pueden compartir el `App Secret` y el `Verify Token`.

### Paso 2 — Personaliza el caso de uso → Configuración de la API

1. En el Panel de tu app vas a ver la fila **"Personalizar caso de uso — Enviar y recibir mensajes"**. Dale click.
2. En el menú lateral aparece **"Configuración de la API"** (junto a Inicio rápido, Configuración, Plantillas). Ahí vive casi todo lo que necesitas: token de acceso, dropdowns "De"/"Para", Phone Number ID, WABA ID, y el Paso 3 de webhooks.

### Paso 3 — Copia tu Phone Number ID

1. En **"Configuración de la API → Paso 1: Seleccionar números de teléfono"**, el dropdown **"De"** trae por default el **número de prueba** de Meta.
2. Justo debajo del dropdown dice **"Identificador de número de teléfono"** — es un número largo (ej. `123456789012345`). **Ese ID es lo que usa el bot, NO el número de teléfono.** Cópialo:

```bash
pnpm wrangler secret put WHATSAPP_PHONE_NUMBER_ID
```

### Paso 4 — Genera tu token de acceso TEMPORAL

1. En la misma pantalla, botón **"Generar token de acceso"** — te da un token que dura **24 horas**.
2. Guárdalo:

```bash
pnpm wrangler secret put WHATSAPP_ACCESS_TOKEN
```

> ⚠️ **Es temporal.** Sirve para dejar el bot funcionando y probarlo HOY. Al final del setup (Fase F) lo cambiamos por uno permanente que no vence — por ahora no te frenes por esto, sigue avanzando con este mismo token.

### Paso 5 — (Solo Ruta A) agrega y verifica tu celular

1. En "Paso 1: Seleccionar números de teléfono", dropdown **"Para"** → **"Administrar lista de números de teléfono"** → agrega el celular que vas a usar para probar (recuerda: ahí actúas como **cliente**, no como el bot).
2. Te llega un código de WhatsApp a ese celular — captúralo para verificarlo.

> Si vas por **Ruta B** (número real), salta este paso — no hay lista blanca que llenar.

---

## FASE B — Credenciales restantes

### Paso 6 — App Secret

1. En tu app, ve a **Configuración de la app → Básica**.
2. Busca **Clave secreta de la app** y dale **Mostrar**. Cópiala:

```bash
pnpm wrangler secret put WHATSAPP_APP_SECRET
```

> Si compartes app con Meta oficial y ya tienes `META_APP_SECRET` configurado, puedes reutilizarlo — no hace falta duplicarlo.

### Paso 7 — Verify Token

El **Verify Token** es una palabra secreta que **tú inventas** — sirve para el "apretón de manos" entre Meta y tu bot cuando registres el webhook en la Fase C.

- Elige algo difícil de adivinar, ej. `mi-bot-wa-9f3k2` (letras y números, sin espacios).
- Anótalo — lo vuelves a pegar en Meta en el **Paso 9**, y **tienen que ser idénticos**.

```bash
pnpm wrangler secret put WHATSAPP_VERIFY_TOKEN
```

> Si ya usas la misma app para Meta oficial y tienes `META_VERIFY_TOKEN` configurado, puedes reutilizarlo (si no defines `WHATSAPP_VERIFY_TOKEN`, el bot cae a `META_VERIFY_TOKEN`).

Con los 4 secrets de las Fases A y B guardados, despliega para que el Worker los tome:

```bash
pnpm run deploy
```

---

## FASE C — Webhook

### Paso 8 — Prueba el handshake ANTES de tocarlo en Meta

Antes de pegar nada en Meta, confirma que tu Worker responde bien al apretón de manos — así "Verificar y guardar" no te va a fallar a ciegas. Corre:

```bash
npx forjabot doctor --whatsapp
```

O, si prefieres el chequeo manual con `curl`:

```bash
curl "https://TU-WORKER.workers.dev/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=TU_VERIFY_TOKEN&hub.challenge=ping"
```

Debe devolver `ping` con status `200`. Si no, tu Worker no está desplegado con el Verify Token correcto — revisa el Paso 7 y corre `pnpm run deploy` de nuevo antes de seguir.

### Paso 9 — Registra el webhook en Meta

1. En **"Configuración de la API → Paso 3: Configurar webhooks"**.
2. **Callback URL:** `https://TU-WORKER.workers.dev/webhooks/whatsapp` (cambia `TU-WORKER.workers.dev` por la dirección real de tu Worker).
3. **Verify token:** pega **exactamente** el mismo del Paso 7.
4. Dale **Verificar y guardar**. Como ya probaste el handshake en el Paso 8, esto debería pasar a la primera.

### Paso 10 — Suscribe el campo `messages`

Busca la fila **`messages`** y dale **Subscribe**. Sin suscribir `messages`, Meta no te manda los mensajes entrantes.

---

## FASE D — (Solo Ruta B) si registras tu número real DESPUÉS de la prueba

Salta esta fase si ya arrancaste directo por la Ruta B, o si te vas a quedar en la Ruta A.

### Paso 11 — Re-lee y regraba el Phone Number ID

1. Cuando registras tu número real en "Administrar lista de números de teléfono", Meta crea (o mueve el número a) una **WABA nueva** — esto **cambia** el identificador que ves debajo del dropdown "De", junto al nuevo **WABA ID**.
2. Vuelve a copiar el nuevo Phone Number ID y regrábalo:

```bash
pnpm wrangler secret put WHATSAPP_PHONE_NUMBER_ID
pnpm run deploy
```

3. Verifica que el token siga teniendo acceso a esta WABA nueva. `npx forjabot doctor --whatsapp` detecta este cambio de ID automáticamente si algo quedó desalineado.

---

## FASE E — Probar

### Paso 12 — Logs en vivo + mensaje real

1. Abre los logs en tiempo real (déjalo corriendo mientras pruebas):

```bash
pnpm wrangler tail --format pretty
```

> **Nota macOS:** el comando `timeout` no existe por default en macOS. Si quieres cortar el `tail` automáticamente, corre el comando en segundo plano y mátalo después con `kill`, o instala `gtimeout` (`brew install coreutils`).

2. Desde **otro teléfono** — recuerda el recuadro de roles del principio: tú eres el cliente, el número configurado es el bot — mándale un mensaje al número del bot.
   - Si el número del bot **es tu número real**, no puedes probar desde ese mismo celular: usa otra línea o pídele a alguien que te escriba.
3. Interpreta los logs:
   - `whatsapp in: {...}` → el mensaje entró correctamente.
   - `whatsapp sendReply <código>` → resultado del envío de la respuesta.
   - El bot **agrupa mensajes unos segundos antes de responder** (el buffer). Después de `whatsapp in` es normal ver varios POST de estado (`sent` / `delivered`) antes de que aparezca la respuesta — eso es envío exitoso, no un error.
4. Abre `/admin/conexiones`: la tarjeta **"WhatsApp (Oficial · Cloud API)"** debe estar **verde**.

> Si algo no cuadra en esta fase (no llegan mensajes, error al enviar, etc.), la tabla de errores está en `../troubleshooting.md`, sección **"WhatsApp Cloud API — errores de envío"**.

---

## FASE F — Blindaje final: token permanente (System User)

El bot ya está funcionando con el token temporal del Paso 4. Este último tramo lo cambia por uno de **System User** que **no vence** — hazlo siempre, aunque el bot ya esté respondiendo bien, para que no se caiga en 24h.

### Paso 13 — Crea el System User

Ve a **business.facebook.com/settings → Usuarios del sistema** → crea uno nuevo con rol **Admin** (o usa uno existente).

### Paso 14 — Asigna los DOS activos

⚠️ Aquí es donde más gente se atora: hay que asignar **dos cosas**, no una.

1. **Asignar activos** → la cuenta de **WhatsApp (WABA)** con control total.
2. **Asignar activos** de nuevo → la **app forjabot** con control total.

> Si solo asignas la WABA y te saltas la app, al generar el token te va a salir *"No hay permisos disponibles"*. La solución está en `../troubleshooting.md`.

### Paso 15 — Genera el token nuevo

**Generar nuevo token** → elige la app **forjabot** → caducidad **Nunca** → marca los permisos **`whatsapp_business_messaging`** y **`whatsapp_business_management`**.

### Paso 16 — Reemplázalo en el bot

```bash
pnpm wrangler secret put WHATSAPP_ACCESS_TOKEN
pnpm run deploy
```

### Paso 17 — Verifica que quedó permanente

```bash
npx forjabot doctor --whatsapp
```

(o revisa con `debug_token` en Graph API Explorer): debe mostrar `expires_at: 0` y `type: SYSTEM_USER`.

> ⚠️ **Higiene:** este token es la llave maestra de tu WhatsApp. Si en algún momento lo pegaste en un chat o se lo mandaste a alguien, revócalo en **Usuarios del sistema → Tokens de acceso → Revocar** y genera uno nuevo. Prefiere siempre el flujo por terminal (`wrangler secret put`) — nunca lo pegues en el chat.

---

## La regla de las 24 horas (plantillas)

WhatsApp deja que **respondas con texto libre** solo dentro de las **24 horas** desde el último mensaje del cliente (la "ventana de servicio"). Tu bot siempre contesta a un cliente que acaba de escribir, así que **para responder no necesitas plantillas**.

Solo necesitas una **plantilla aprobada** (Message Template) si quieres que el bot **inicie** una conversación o escriba **después** de esas 24 h (ej. recordatorios, promos). Se crean en **Plantillas** (dentro de tu app de WhatsApp) y Meta las aprueba. Para el uso normal del bot (responder), no hace falta.

---

## Resumen — qué secret es qué

| Secret | De dónde sale | Fase |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | "Configuración de la API", debajo del dropdown "De" | A (y D si cambias a número real después) |
| `WHATSAPP_ACCESS_TOKEN` | Temporal (Paso 4) → System User permanente (Fase F) | A → F |
| `WHATSAPP_VERIFY_TOKEN` | Lo inventas tú | B |
| `WHATSAPP_APP_SECRET` | Configuración de la app → Básica → Clave secreta de la app | B |

**Webhook:** `https://TU-WORKER.workers.dev/webhooks/whatsapp` — suscribe el campo **`messages`**.

---

## Si algo falla

La tabla completa de errores (códigos de Meta, el bache del System User, webhook que no verifica, etc.) vive en `../troubleshooting.md`, sección **"WhatsApp Cloud API — errores de envío"** — no aquí, para no duplicar contenido entre guías.
