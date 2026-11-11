# GOAL — Canal WhatsApp por YCloud (BSP oficial, zero-markup)

**Objetivo:** agregar **YCloud** como opción de WhatsApp en Forja, junto a Twilio, la Cloud
API oficial y Kapso. La razón: **varios miembros de la comunidad ya usan YCloud** — es un BSP
oficial de WhatsApp con **cero markup** (los precios de Meta pasan directo, sin comisión) **y
con COEXISTENCIA** (conserva tu app de WhatsApp Business en el mismo número, igual que Kapso).
Es "lo mejor de los dos mundos": el markup más bajo + no pierdes tu app. (Confirmado: el
número de Santi `+528145803756` ya está en coexistencia — `isOnBizApp: true`.)

> Estado: **plan, sin implementar.** Réplica del trabajo de Kapso, adaptada al contrato de
> YCloud. Pendiente: credenciales de una cuenta YCloud + número conectado para probar el flujo
> real (ver "Qué necesito de Santi").

> Referencia: patrón completo probado en `docs/GOAL-canal-kapso.md`. Este GOAL sigue la misma
> estructura y los mismos sitios; abajo se marcan **solo las diferencias** con Kapso.

---

## Contrato técnico de YCloud (verificado en docs.ycloud.com)

Base API: `https://api.ycloud.com/v2` · Auth: header **`X-API-Key`**. Docs para LLMs en
`https://docs.ycloud.com/llms.txt` (índice markdown + OpenAPI).

**Enviar (outbound):**
```
POST https://api.ycloud.com/v2/whatsapp/messages/sendDirectly
Headers: X-API-Key: <YCLOUD_API_KEY> · Content-Type: application/json
Body: { "from": "<NUMERO_NEGOCIO_E164>", "to": "<cliente_E164>",
        "type": "text", "text": { "body": "<mensaje>" } }
```
⚠️ **Diferencia clave con Kapso:** el emisor es el **número en E.164** (`from`, ej.
`+16315551111`), **no** un `phone_number_id`. → env var `YCLOUD_WA_FROM` = el número del negocio.

**Recibir (webhook entrante):**
```
type: "whatsapp.inbound_message.received"
{ id, type, apiVersion, createTime, whatsappInboundMessage: {
    id, wamid, wabaId, from (cliente E164), to (negocio E164), sendTime, type,
    text: { body },                         // texto
    image: { link, id, mime_type },         // imagen (link requiere X-API-Key)
    audio: { link, id, mime_type },          // audio  (link requiere X-API-Key)
    customerProfile: { name, username }      // nombre del contacto
} }
```
- **Dedup** por `whatsappInboundMessage.wamid` (o `.id`).
- **Nombre** del contacto: `customerProfile.name`.
- ⚠️ **Media NO es público:** `audio.link`/`image.link` son URLs de `api.ycloud.com` que
  **exigen `X-API-Key` para descargar** (válidas 30 días). El audio **NO viene transcrito**.
  → hay que servirlo por un **proxy FIRMADO** como el canal Cloud API (`whatsapp.ts` /
  `serveWhatsAppMedia`), NO como Kapso (que daba URL pública + transcript). Reutilizar ese patrón.

**Firma del webhook (tipo Stripe, anti-replay):**
- Header `YCloud-Signature: t=<unix_ts>,s=<sig>` (+ `X-Webhook-Endpoint-ID`).
- `sig = HMAC-SHA256(<YCLOUD_WEBHOOK_SECRET>, "<t>.<raw_body>")` en hex.
- Verificar contra los bytes crudos ANTES de parsear + **validar la tolerancia del timestamp**
  (ej. |ahora − t| ≤ 5 min) para rechazar replays. Comparación constant-time. Fail-closed.
  ⚠️ Diferencia con Kapso: Kapso firma `HMAC(secret, body)`; YCloud firma `HMAC(secret, "t.body")`.

**Coexistencia (SÍ — CONFIRMADO):** YCloud soporta la coexistencia de Meta (mayo 2025). Cuando
el dueño responde a un cliente **desde su app**, YCloud emite el evento **`whatsapp.smb.message.echoes`**:
```
type: "whatsapp.smb.message.echoes"
{ ..., whatsappMessage: { wamid, status:"sent", from (negocio), to (CLIENTE),
    customerProfile, bizType:"whatsapp", type } }
```
→ **takeover**: el adapter pausa la conversación de `whatsappMessage.to` (el cliente), igual que
Kapso. **Más limpio que Kapso**: el *tipo de evento en sí* ya identifica el mensaje del dueño (no
hay que filtrar por `origin` — el bot manda por la API, que NO genera `smb.message.echoes`, sino
`whatsapp.message.updated` de status). Límites de coexistencia: **5 mps**, media sync ≤14 días,
app WhatsApp Business **2.24.17+**. Setup: QR desde la app (embedded signup).

**Buffer:** YCloud manda un mensaje por webhook (sin buffering propio documentado). Usamos el
buffer del DO de Forja, igual que todos. El handler es robusto igual (normaliza array por si acaso).

---

## Pricing de YCloud (para la guía)

Planes (anual): **Free $0** · **Growth $39/mes** · **Pro $89/mes** · **Enterprise $399/mes**.
**Zero markup:** los cargos de Meta pasan **directos** (sin comisión de YCloud) — cargas saldo
(wallet) y YCloud descuenta la tarifa de Meta. Una **conversación** (24 h) = **$0.008–$0.069+**
según país/tipo. → posicionamiento: "**cero comisión**, precio oficial de Meta; ideal si ya
usas YCloud o quieres el markup más bajo". (Fuente: ycloud.com/pricing.)

---

## Los sitios que toca el canal (idénticos a Kapso) + diferencias

- [ ] **1a. Adapter** — `src/channels/ycloud.ts`:
  - `parseYCloudEvents(body)` → `IncomingMessage[]` desde `whatsappInboundMessage` (texto,
    imagen, audio). `channelUserId` = `from` normalizado a dígitos. `displayName` =
    `customerProfile.name`. Dedup por `wamid`.
  - `ycloudAdapter.sendReply` → POST `sendDirectly` con `from: env.YCLOUD_WA_FROM`,
    `to: reply.channelUserId`, `X-API-Key`.
  - `serveYCloudMedia(id, exp, sig, env)` → **proxy firmado** (clona `serveWhatsAppMedia`):
    descarga el `link` de YCloud con `X-API-Key` y devuelve los bytes; el token nunca sale del
    server. Audio → `audioUrl` (Forja transcribe); imagen → `imageUrl`.
  - `verifyYCloudSignature(rawBody, header, secret)` → parsea `t`,`s`; `HMAC(secret,"t.body")`;
    compara constant-time + tolerancia de timestamp.
  - `ycloudOwnerTakeover(body, env)` → **COEXISTENCIA**: si `type === "whatsapp.smb.message.echoes"`
    (dueño respondió desde su app), pausa la conversación de `whatsappMessage.to` (el cliente) con
    `resolveTakeoverMs` — igual que `kapsoOwnerTakeover`.
  - `sendYCloudTemplate(...)` → plantilla HSM por `sendDirectly` (`type:"template"`) para reengage.
- [ ] **1b. Rutas** — `app.post("/webhooks/ycloud")` + `app.get("/webhooks/ycloud/media/:id")`
  en `src/index.ts` (firma fail-closed → parse → `ingestOne`) + `configuredChannels()` (
  `if (env.YCLOUD_API_KEY) …`) + `CHANNEL_LABELS.ycloud = "WhatsApp"` en `channels/labels.ts` +
  `pickAdapter` en `replies/sender.ts` + `"ycloud"` en el tipo `ChannelId` + 3 env vars en `env.ts`.
- [ ] **2. Tarjeta del panel** — `src/admin/views/conexiones.ts` (`ycloudMissing` + tarjeta) +
  3 claves i18n en ES419/EN/PT-BR (`src/admin/i18n.ts`).
- [ ] **3. wrangler.toml + override** — 3 vars en `wrangler.toml` **y** en
  `horizontes-license-server/publish/overrides/wrangler.toml`.
- [ ] **4. Guía de setup** — `skill/references/channel-setup-guides/ycloud-whatsapp.md`
  (crear cuenta YCloud → conectar número/WABA → copiar API key + número + webhook secret →
  Claude configura el webhook a `<worker>/webhooks/ycloud`).
- [ ] **5. Comparador** — Opción E en `_elegir-canal-y-metodo.md` ("BSP oficial zero-markup;
  ya lo usan en la comunidad"). Aclarar: número dedicado (sin app), a diferencia de Kapso.
- [ ] **6. Flujo FASE 3** — sub-flujo YCloud en `skill/configurar-mi-chatbot.md`.
- [ ] **7. Catálogo forja-cloud** — `catalog.ts` (whatsapp `metodos: 3 → 4`) + método m3 en los
  3 idiomas de `forja-cloud/src/lib/i18n.ts`.
- [ ] **8. Skill del CLI** — mención de YCloud en `AGENT_SKILL` de `forja-publico/cli/bin/cli.js`
  (método seguro: extraer md → split/join → verificar → reinyectar por índices → `node --check`).

### Estandarización de handoff/pausa (como pidió Santi)
- [ ] **pickAdapter** incluye `ycloud` → responder desde el panel, campañas y follow-ups.
- [ ] **Pausa/reanudar/handoff** por `channel_user_id` (`ycloud:<telefono>`) — ya agnósticos.
- [ ] **Reengage**: `ycloud` a `WINDOWED` (ventana de 24 h) + envío por `sendYCloudTemplate`.
- [ ] **Inbox**: color de WhatsApp para `ycloud` (`channelColor`).
- [ ] **Coexistencia** → takeover del dueño por `whatsapp.smb.message.echoes` (como Kapso).
  `human-in-the-loop.md` ya documenta la vía de takeover por la app (vale para Kapso Y YCloud).
- [ ] **Troubleshooting**: tabla de errores YCloud en `troubleshooting.md` + fila en el **mapa
  de docs oficiales** (YCloud: `docs.ycloud.com`, `docs.ycloud.com/llms.txt`, help center).

### Env vars nuevas
- `YCLOUD_API_KEY` (secret) — header `X-API-Key`.
- `YCLOUD_WA_FROM` — el número del negocio en **E.164** (el `from` del envío).
- `YCLOUD_WEBHOOK_SECRET` (secret) — firma `YCloud-Signature`.

---

## Sin leaks (checklist de seguridad — como el fix del panel)
- **Firma del webhook fail-closed**: sin `YCLOUD_WEBHOOK_SECRET` o firma inválida → 403. Además
  **validar el timestamp** (anti-replay), que Kapso no exigía.
- **Media por proxy firmado**: el `X-API-Key` de YCloud **nunca** sale del server; el `link` se
  descarga del lado del Worker (HMAC + expiración en la URL pública, patrón `serveWhatsAppMedia`).
- **Secrets solo por `wrangler secret put`** (API key + webhook secret): nunca en el chat, nunca
  en archivos del repo, nunca en logs. El número (`YCLOUD_WA_FROM`) puede ir en `[vars]`.
- **Nada de PII en URLs**: el proxy de media usa el `id` + firma, no el número ni datos del cliente.

---

## Plan de pruebas
1. `pnpm typecheck` + tests del área de canales (clonar `kapso.test.ts` → `ycloud.test.ts`:
   parseo texto/imagen/audio, firma con timestamp válido/vencido, dedup por wamid).
2. **Auth:** `GET` read-only a la API de YCloud con la key → 200.
3. **Send:** `POST /whatsapp/messages/sendDirectly` (from=número, to=prueba) → llega un WhatsApp.
4. **Webhook entrante:** mensaje al número → `/webhooks/ycloud` lo parsea → el bot responde.
5. **Media/audio:** nota de voz → el proxy firmado la descarga (X-API-Key) → Forja transcribe.
6. **Firma:** header con `t` viejo (replay) o `s` inválida → 403.

---

## Orden de release (regla de forja-interno)
1. Artefacto del bot (`publish.mjs <v> --release`). 2. CLI a npm (se toca `AGENT_SKILL`).
3. Panel de agencia (`forja-cloud` `pnpm run deploy`, se toca el catálogo).

---

## Qué necesito de Santi para ejecutar
1. **Credenciales de una cuenta YCloud** (de prueba o de un miembro dispuesto): `YCLOUD_API_KEY`
   + un **número conectado** (`YCLOUD_WA_FROM`), para probar send + webhook de verdad (por tu
   terminal / `wrangler secret put`, no por el chat). Si YCloud tiene número/entorno de prueba,
   con eso basta.
2. Coexistencia **CONFIRMADA** (Santi + doc + `isOnBizApp:true`) — el adapter maneja el echo
   `whatsapp.smb.message.echoes` para el takeover del dueño.
3. **Pricing** — ya está (Free/Growth $39/Pro $89/Enterprise $399, zero-markup).
