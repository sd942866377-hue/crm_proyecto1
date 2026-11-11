# Canal ZERNIO — proveedor unificado (setup)

Zernio (zernio.com) es **un solo puente** para Instagram, Messenger, WhatsApp,
Telegram, X (DMs), Discord y más — con **una cuenta, una API key y un webhook**.
En Forja es un **canal adicional** (no reemplaza los directos). Ideal para
conectar muchas redes rápido, y para quien no quiere pelear con el setup de Meta.

## 📚 Documentación oficial (léela si algo falla o cambia)
- **Doc completa (para Claude):** `https://docs.zernio.com/llms-full.txt` (~98K líneas — toda la API, schemas de webhooks, matriz por plataforma). Bájala con `curl -sL` y busca lo que necesites.
- General: `https://docs.zernio.com`
- Inbox (recibir/responder DMs): `https://docs.zernio.com/inbox`
- Webhooks: `https://docs.zernio.com/webhooks` · payload de mensajes: `.../webhooks/inbox`
- WhatsApp: `https://docs.zernio.com/platforms/whatsapp` · rates: `.../pricing/whatsapp`
- Números (comprar/portar): `https://docs.zernio.com/platforms/phone-numbers`

## Setup (tú corres los comandos; el miembro autoriza sus redes)
1. Crea la cuenta en **zernio.com** (plan Usage de pago; el inbox viene incluido, no es addon aparte).
2. **Conecta las redes** (OAuth de un clic por cada una): `GET /v1/connect/{platform}?profileId=…` desde el dashboard, o el flujo del dashboard. Cada perfil conecta UNA cuenta por plataforma.
3. **API key — la pega el MIEMBRO (es su credencial):** dashboard → API Keys. **Debe tener habilitado el resource group `messages`** (si no, `GET /inbox/conversations` devuelve 403 "resource group disabled"). El miembro pega el valor en el prompt de la terminal, **no en el chat**:
   ```bash
   wrangler secret put ZERNIO_API_KEY
   ```
4. **Webhook secret — LO GENERAS TÚ (Claude), el miembro NO inventa ninguno.** Es un secreto compartido entre el Worker y Zernio; créalo aleatorio y ponlo (guarda el valor: lo necesitas en el paso 6):
   ```bash
   SECRET=$(openssl rand -hex 32)
   echo -n "$SECRET" | wrangler secret put ZERNIO_WEBHOOK_SECRET
   echo "ZERNIO_WEBHOOK_SECRET = $SECRET"
   ```
   La firma es **fail-closed**: si este secret no está, o no coincide con el que registres en Zernio (paso 6), el bot rechaza **todo** con 403.
5. **Despliega** (para que exista la URL pública del Worker): `wrangler deploy`. El bot recibe en `<worker>/webhooks/zernio` (firma `X-Zernio-Signature` = HMAC-SHA256) y responde por el inbox.
6. **Registra el webhook en Zernio** con `POST /api/v1/webhooks/settings` (NO `/v1/webhooks` — esa devuelve HTML), usando la API key del paso 3, la URL del paso 5, `events:["message.received"]`, y el **mismo** `secret` del paso 4:
   ```bash
   curl -X POST https://zernio.com/api/v1/webhooks/settings \
     -H "Authorization: Bearer <ZERNIO_API_KEY>" -H "Content-Type: application/json" \
     -d "{\"name\":\"forja\",\"url\":\"https://<worker>/webhooks/zernio\",\"events\":[\"message.received\"],\"secret\":\"$SECRET\"}"
   ```
   Puedes registrarlo tú (ya tienes la key del miembro del paso 3) o dejárselo listo para el dashboard de Zernio. Prueba con `POST /v1/webhooks/test` `{webhookId, event}`. Entrega at-least-once, reintentos exponenciales hasta 7, y **se auto-deshabilita tras 10 fallos seguidos** — vale monitorearlo.

## WhatsApp por Zernio (incluye comprar número)
Zernio **puede conectar WhatsApp** de dos formas:
- **Conectar tu número existente** a tu WABA de Meta, o
- **Comprar/provisionar un número en Zernio** y usarlo para WhatsApp: `POST /platforms/phone-numbers`. En países regulados pide **verificación de identidad una sola vez** (1–3 días hábiles); en no regulados es instantáneo. Ese número **conecta a tu WABA de Meta** — Meta cobra la entrega de plantillas y las llamadas **directo a tu WABA**, nunca a través de Zernio.

**Ventana de 24h y plantillas** (esto ya está cableado en Forja):
- Dentro de la ventana de 24h (el cliente escribió hace <24h): el bot responde **texto libre** por `POST /v1/inbox/conversations/{id}/messages` (campo `message`).
- **Fuera de la ventana** (re-enganchar un lead frío): WhatsApp exige **plantilla aprobada**. Forja la manda por el **mismo** endpoint de mensajes del inbox (`POST /v1/inbox/conversations/{conversationId}/messages`) pero con el campo `template` en vez de `message`: `{accountId, template:{elements:[{name, language, components}]}}` (los `components` llenan las variables {{1}},{{2}}… del body). El miembro configura su plantilla en **Plantillas** del panel (aparece como método "Zernio"). Sin plantilla → `TEMPLATE_REQUIRED`. (Para abrir hilo con un número **sin** conversación previa, Zernio usa `POST /v1/inbox/conversations`; en reengage siempre hay hilo previo.)
- El **reengage de Forja ya distingue la plataforma**: solo las conversaciones de Zernio cuyo `platform` sea `whatsapp` usan plantilla fuera de 24h; IG/Telegram/etc. mandan texto libre.

## Pricing (para decirle al miembro)
Por **cuenta conectada**: $6/cuenta (baja por volumen hasta ~$1 con muchas). Las primeras 2 gratis. El inbox (DMs, comentarios, reseñas) **viene incluido** en cualquier cuenta de pago del plan Usage. Las tarifas de WhatsApp (conversaciones/plantillas de Meta) se cobran **directo a tu WABA**.

## Si algo falla
- **El bot no ve las apps conectadas:** revisa que la API key tenga el resource `messages` habilitado, y que el webhook esté activo (no auto-deshabilitado por fallos). En `wrangler tail` busca `[zernio]`.
- **No responde a una conversación:** Forja guarda el `conversationId`+`accountId` cuando el cliente ESCRIBE (tabla `zernio_ctx`). Solo puede responder a conversaciones **iniciadas por el cliente** — es inbound-driven (el flujo normal del chatbot).
- **WhatsApp fuera de 24h:** `TEMPLATE_REQUIRED` = falta configurar la plantilla en el panel. Alternativa: WABAs elegibles para Meta Direct Send pueden abrir con `category:"utility"` + `message` sin plantilla.
- **Media:** el texto está 100%; el mapeo de `attachments` (imagen/audio) por confirmar con un payload de media real.
- Para cualquier otra cosa, lee `llms-full.txt` (arriba) — trae toda la API.


## Botones tocables (opt-in de Forja)

Si el miembro prendió los botones (`/botones`, setting `buttons_enabled`), las
respuestas del bot que terminan con el marcador `[[botones: …]]` salen por Zernio
con el campo `buttons` (type `postback`, máx 3): botones nativos en WhatsApp
(reply buttons), Instagram/Facebook (button_template — visibles incluso en la
carpeta Message Requests de IG, mejor que los chips para leads fríos) y Telegram.
En plataformas de Zernio sin soporte (X, SMS, Slack) el bot los convierte solo en
lista numerada. El tap regresa por el webhook `message.received` como texto (o
`metadata.interactiveId` / `metadata.callbackData`, que el adapter usa como texto
si el mensaje llega vacío) — el cerebro del bot lo procesa como mensaje normal.
