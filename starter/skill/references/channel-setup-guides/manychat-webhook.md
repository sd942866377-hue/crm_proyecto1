# Conectar tu bot a ManyChat (External Request)

ManyChat es un puente. Tú conectas ManyChat a Instagram, Messenger, WhatsApp o Telegram (todo se hace del lado de ManyChat), y ManyChat le pasa cada mensaje a tu bot. Esto te deja **atender varios canales con un solo bot**.

> Si solo quieres Telegram y nada más, es más fácil conectarlo directo (ver la guía `telegram-direct.md`). ManyChat conviene cuando quieres Instagram/Messenger o varios canales juntos.

---

## Lo que vas a lograr

Al terminar esta guía, cuando un cliente te escriba por Instagram (o Messenger, WhatsApp, Telegram conectado en ManyChat), tu bot va a contestarle solo, en ese mismo canal.

---

## Cómo funciona (en simple)

1. El cliente escribe en Instagram/Messenger/etc.
2. ManyChat recibe el mensaje.
3. ManyChat se lo manda a tu bot (a la URL de tu Worker).
4. Tu bot piensa la respuesta y se la regresa a ManyChat.
5. ManyChat le contesta al cliente en su canal.

---

## Paso 1: Consigue tu llave de ManyChat (API Key)

1. Entra a tu cuenta de **ManyChat** (manychat.com).
2. Ve a **Settings** (Configuración) → **API**.
3. Copia tu **API Key**. Es la llave que conecta ManyChat con tu bot.
4. Guárdala como secreto. En tu compu, dentro de la carpeta del proyecto, corre:
   ```bash
   pnpm wrangler secret put MANYCHAT_API_KEY
   ```
   Cuando te lo pida, pega la API Key y dale Enter.

> Esta misma llave la vas a usar más abajo como un encabezado (`X-Api-Key`) para que tu bot confirme que el mensaje viene de TU ManyChat y no de un desconocido.

---

## Paso 2: Conecta tus canales dentro de ManyChat

Esto se hace **del lado de ManyChat**, no en tu bot:

1. En ManyChat, conecta el canal que quieras: **Instagram**, **Messenger**, **WhatsApp** o **Telegram**.
2. ManyChat te guía con su propio asistente para enlazar cada cuenta.
3. Puedes conectar varios canales a la vez. Tu bot atiende todos por el mismo puente.

---

## Paso 3: Crea el flujo que llama a tu bot (External Request)

Aquí le dices a ManyChat: "cuando llegue un mensaje, pregúntale a mi bot qué responder".

1. En ManyChat, ve a **Automation → Flows** (Automatización → Flujos).
2. Agrega una acción → **"External Request"** (Petición externa).
3. Configura así:
   - **Método (Method):** `POST`
   - **URL:** `<worker-url>/webhooks/manychat`
     (la URL de tu Worker la ves cuando corres `pnpm run deploy`, algo como `https://horizontes-bot.TU-CUENTA.workers.dev`)
4. En el **Body** (cuerpo), pega este JSON **exactamente con estos nombres de campo** (el bot lee `last_input_text`, no `text` — si lo cambias, el mensaje llega vacío y el bot no responde):
   ```json
   {
     "id": "{{user_id}}",
     "last_input_text": "{{last_input_text}}",
     "first_name": "{{first_name}}"
   }
   ```
   > Los `{{...}}` son etiquetas de ManyChat: las rellena solas con el ID del cliente, su mensaje y su nombre.
5. Agrega un **header** (encabezado):
   - Nombre: `X-Api-Key`
   - Valor: tu `MANYCHAT_API_KEY` (la misma llave del Paso 1)
6. Guarda y **publica** el flujo.

> **Eso es todo del lado de ManyChat.** NO agregues una acción "Send Message" con un campo `reply`: **el bot entrega la respuesta él solo** (te llama de vuelta por la API de ManyChat, de forma asíncrona). El "External Request" solo dispara al bot; el webhook responde `ok` y el bot manda el mensaje por su cuenta.

---

## Paso 3.5: Dile a tu agente QUÉ canal conectaste (clave — si no, no llega la respuesta)

El bot manda la respuesta a ManyChat marcando el **tipo de contenido** del canal, y por defecto asume **Instagram**. Si conectaste **Messenger, WhatsApp o Telegram** vía ManyChat y no lo ajustas, ManyChat rechaza el envío **en silencio** y el cliente no recibe nada.

Dile a tu agente cuál conectaste para que configure `MANYCHAT_CONTENT_TYPE` en tu `wrangler.toml` antes del deploy:

- Instagram → `MANYCHAT_CONTENT_TYPE = "instagram"` (default)
- Facebook Messenger → `"messenger"`
- WhatsApp → `"whatsapp"`
- Telegram → `"telegram"`

(Tu agente lo pone en la sección `[vars]` del `wrangler.toml` y vuelve a desplegar.)

---

## El aviso al dueño (handoff) NO pasa por ManyChat

Cuando el bot necesita pasarte un cliente a ti (handoff), **no** te avisa por ManyChat. El aviso te llega por:

- **Telegram a ti (recomendado, gratis):** escríbele `/start` a tu propio bot de Telegram para obtener tu chat_id y guárdalo:
  ```bash
  pnpm wrangler secret put OWNER_TELEGRAM_CHAT_ID
  ```
  (Los pasos completos para sacar tu chat_id están en `telegram-direct.md`.)
- **WhatsApp por Twilio (opcional, Pro):** WhatsApp **no deja** mandar texto libre, así que el aviso al dueño por WhatsApp **requiere una plantilla aprobada** (Content Template). Necesitas el `TWILIO_HANDOFF_CONTENT_SID` y el `OWNER_WA_NUMBER`. Ver `whatsapp-twilio.md`.

> Importante: que conectes WhatsApp dentro de ManyChat para hablar con tus clientes es una cosa; el aviso de handoff hacia TI es otra. El handoff sale por Telegram (o por Twilio con plantilla aprobada), no por ManyChat.

---

## Si algo falla

- **El bot no contesta en el canal:** revisa que la URL del External Request termine en `/webhooks/manychat` y que el método sea `POST`.
- **El bot recibe pero responde vacío / no entiende:** el Body debe usar el campo **`last_input_text`** (no `text`). Revisa el Paso 3.
- **El cliente no ve la respuesta (pero el bot sí procesó):** casi siempre es el **canal equivocado** — revisa `MANYCHAT_CONTENT_TYPE` (Paso 3.5). Si conectaste Messenger/WhatsApp/Telegram y quedó en `instagram`, ManyChat rechaza el envío. Los logs del Worker (`pnpm wrangler tail`) muestran `[manychat sendContent]` con el error exacto.
- **Error de autorización / rechaza el mensaje:** confirma que agregaste el header `X-Api-Key` con tu `MANYCHAT_API_KEY` exacta, y que corriste `pnpm run deploy` después de guardar el secreto.
- **No llega ningún mensaje a tu bot:** revisa que el canal (Instagram/Messenger/etc.) esté bien conectado en ManyChat y que el flujo esté activo (publicado).

---

## Resumen

| Qué | Valor |
|---|---|
| Secreto | `MANYCHAT_API_KEY` (y `OWNER_TELEGRAM_CHAT_ID` o `TWILIO_HANDOFF_CONTENT_SID` + `OWNER_WA_NUMBER` para los avisos al dueño) |
| Webhook | `<worker-url>/webhooks/manychat` (método `POST`) |
| Header | `X-Api-Key: <MANYCHAT_API_KEY>` |
| Body (campos exactos) | `id`, `last_input_text`, `first_name` |
| Tipo de canal | `MANYCHAT_CONTENT_TYPE` = instagram \| messenger \| whatsapp \| telegram (default instagram) |
| Respuesta | El bot la manda solo (NO necesitas acción "Send Message") |
| Canales | Instagram, Messenger, WhatsApp, Telegram (conectados en ManyChat) |
| Costo | Plan de ManyChat (tiene capa gratis limitada) |
| Dificultad | Media |

Listo. Con ManyChat tu bot atiende varios canales desde un solo lugar.
