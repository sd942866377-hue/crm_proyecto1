# GOAL — Canal WhatsApp por Kapso (extra a Twilio y Cloud API)

**Objetivo:** agregar **Kapso** como tercera opción de WhatsApp en Forja, junto a
Twilio y la Cloud API oficial. La razón de peso es la **coexistencia**: el negocio
conecta su MISMO número y sigue usando su app de WhatsApp Business, mientras el bot
también contesta. Twilio obliga a migrar el número (y perder la app); Kapso no.

> Estado: **IMPLEMENTADO en código + docs, sin desplegar ni publicar.** Typecheck del bot
> y de forja-cloud en verde; 10 tests nuevos del adapter + suite de canales/reengage en verde.
> Falta la **prueba end-to-end** (conectar un número real en coexistencia + webhook secret) y,
> tras eso, el release (artefacto → CLI → panel). Ver "Qué falta".

---

## Contrato técnico de Kapso (ya verificado en docs.kapso.ai)

Kapso es un **proxy sobre la Cloud API oficial de Meta** (`api.kapso.ai/meta/whatsapp/v24.0/…`,
mismos campos que la Cloud API). Eso hace el adapter casi un clon del canal Cloud API
(`src/channels/whatsapp.ts`), cambiando la base URL, el auth y el envoltorio del webhook.

**Enviar (outbound):**
```
POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages
Headers: X-API-Key: <KAPSO_API_KEY> · Content-Type: application/json
Body: { "messaging_product":"whatsapp", "recipient_type":"individual",
        "to":"<telefono>", "type":"text", "text": { "body":"<mensaje>" } }
```

**Recibir (webhook entrante):**
- Header `X-Webhook-Event: whatsapp.message.received`
- Payload: `message.from` (teléfono), `message.text.body` (texto), `message.id`,
  `message.username` (nombre), `message.kapso.media_url` (media ya resuelta),
  audio con `message.kapso.transcript.text` (¡ya transcrito!), `phone_number_id`.

**Firma del webhook (CONFIRMADO en agent-skills oficiales):** header
`X-Webhook-Signature` = `HMAC-SHA256(<KAPSO_WEBHOOK_SECRET>, raw_request_body)` en **hex**.
Se verifica contra los **bytes crudos** ANTES de parsear el JSON. Trivial con Web Crypto
(`crypto.subtle.importKey` + `sign`) en el Worker. Otros headers: `X-Webhook-Event`,
`X-Idempotency-Key` (SHA256 del payload, para dedupe), `X-Webhook-Payload-Version` (usar **v2**).
El endpoint debe responder **200 en <10 s** o Kapso reintenta (10 s / 40 s / 90 s).

**Coexistencia (CONFIRMADO):** es un `connection_type` explícito. En el onboarding se pide
`allowed_connection_types: ["coexistence"]` → el negocio conserva su app de WhatsApp Business
(límite 5 msg/s, "good for small businesses"). El otro tipo es `dedicated` (API-only, hasta
1000 msg/s, sin app). Para Forja: **coexistence** es el diferenciador; dedicated es el modo escala.

**Buffer:** Kapso tiene su propio buffer opcional (`--buffer-enabled` + `--buffer-window-seconds`).
**Lo dejamos OFF** — Forja ya bufferea en el Durable Object (`SupportAgent.ingest`), agnóstico al
canal. Doble buffer = latencia y mensajes partidos raros.

**Bases:** Platform API = `https://api.kapso.ai/platform/v1` (customers, setup_links, webhooks,
listar números). Proxy Meta = `https://api.kapso.ai/meta/whatsapp/v24.0` (enviar, media, templates).

**Sandbox listo (verificado con la key de Santi):** `phone_number_id = 597907523413541`
(`kind: sandbox`, `inbound_processing_enabled: true`). Sirve para probar send + webhook sin
conectar un número real. `is_coexistence` real se prueba conectando un número con `kapso setup`.

---

## Coexistencia — el manejo que la hace funcionar BIEN (crítico)

En coexistencia, el dueño puede responderle a un cliente **manualmente desde su app**
mientras el bot también atiende. Si el bot no lo maneja, el dueño y el bot responden
**encima uno del otro** al mismo cliente. Kapso da la señal para evitarlo:

- Cuando el dueño responde desde la app, Kapso emite `whatsapp.message.sent`. **El payload
  trae `message.kapso.origin`** que distingue el origen SIN que yo tenga que recordar nada:
  - `origin: "business_app"` = **"Echoed from WhatsApp Business App"** → el dueño respondió
    manualmente desde su app (coexistencia) → **es intervención real → pausar esa conversación**.
  - `origin: "cloud_api"` = enviado vía Kapso (el eco del propio bot / un flow) → **ignorar**.
  - `origin: "history_sync"` = backfill de import → ignorar.
- **El adapter:** en el evento `whatsapp.message.sent`, si `origin === "business_app"` →
  `convs.setPausedUntil(convId, now + takeoverMs)` sobre la conversación de
  `conversation.phone_number`, con el mismo mecanismo de takeover del panel. Nada de trackear
  IDs — el `origin` ya lo resuelve (hallazgo de `webhooks-event-types.md`).

> Nota de diseño: este ES el caso de uso REAL de "owner takeover" que en Telegram NO
> aplicaba (allí el mensaje del dueño era testing → lo quitamos). En WhatsApp coexistencia
> SÍ: el dueño escribe en el hilo del cliente y el bot debe hacerse a un lado. El mecanismo
> de pausa por conversación que ya arreglamos es justo lo que se reutiliza.

**Limitación honesta (de la propia doc de Kapso):** la coexistencia tiene "occasional
disconnects" y "some first inbound messages may not reach Kapso immediately"; Kapso
recomienda la **Cloud API dedicada** para "stable automation... production reliability".
→ Por eso Kapso-coexistencia es la opción de **onboarding fácil (no pierdes tu app)** con un
trade-off de fiabilidad, y va como **EXTRA** a Twilio/Cloud API, no como reemplazo. En la
guía de setup hay que decírselo al usuario: "tu WhatsApp de siempre, sin perder la app;
para volumen alto y máxima estabilidad, la Cloud API dedicada."

---

## Modelo elegido: cada usuario su propia cuenta Kapso

Igual que Twilio hoy (el usuario pega su SID/token), cada bot lleva **su** `KAPSO_API_KEY`
y `KAPSO_PHONE_NUMBER_ID`. Preserva el principio de Forja ("todo vive en tu nube, con tus
llaves"). NO se usa el modelo "Forja como plataforma" (connection links) en v1 — eso sería
una fase posterior para el Modo Agencia.

**Env vars nuevas:**
- `KAPSO_API_KEY` (secret) — la API key del proyecto Kapso del usuario.
- `KAPSO_PHONE_NUMBER_ID` — el phone number id que le da Kapso/Meta.
- `KAPSO_WEBHOOK_SECRET` (secret) — para verificar la firma del webhook.

---

## Los sitios que toca un canal (regla de forja-interno) + CLI — TODOS HECHOS

- [x] **1a. Código del adapter** — `src/channels/kapso.ts` (`parseKapsoEvents` + `kapsoAdapter`
  con `sendReply` por el proxy `X-API-Key`; audio usa el `transcript` de Kapso, imagen la
  `media_url` ya resuelta). **Coexistencia:** `kapsoOwnerTakeover` usa `message.kapso.origin`
  (`business_app` → pausa; `cloud_api`/`history_sync` → ignora) — sin recordar ids. + firma
  `verifyKapsoSignature` (HMAC hex) + `sendKapsoTemplate` (HSM por el proxy).
- [x] **1b. Ruta del webhook** — `app.post("/webhooks/kapso")` en `src/index.ts` (firma
  fail-closed; outbound → takeover, inbound → `ingestOne`) + `configuredChannels()` y
  `CHANNEL_LABELS.kapso` en `channels/labels.ts` + `pickAdapter` en `replies/sender.ts` +
  `"kapso"` en el tipo `ChannelId` + 3 env vars en `src/env.ts`.
- [x] **2. Tarjeta del panel** — `src/admin/views/conexiones.ts` (`kapsoMissing` + tarjeta) +
  3 claves i18n en ES419/EN/PT-BR (`src/admin/i18n.ts`).
- [x] **3. wrangler.toml + override** — 3 vars documentadas en `wrangler.toml` **y** en
  `horizontes-license-server/publish/overrides/wrangler.toml`.
- [x] **4. Guía de setup** — `skill/references/channel-setup-guides/kapso-whatsapp.md`.
- [x] **5. Comparador de canales** — Kapso como Opción D en `_elegir-canal-y-metodo.md`
  ("conserva tu app de WhatsApp Business").
- [x] **6. Flujo de instalación** — sub-flujo Kapso en `skill/configurar-mi-chatbot.md` (FASE 3).
- [x] **7. Catálogo del panel de agencia** — `forja-cloud/src/lib/catalog.ts` (`metodos: 3`) +
  método m2 en los 3 idiomas de `forja-cloud/src/lib/i18n.ts`. (Falta `pnpm run deploy` del panel.)
- [x] **8. Skill del CLI** — mención de Kapso en `AGENT_SKILL` de `forja-publico/cli/bin/cli.js`
  (editado con el método seguro; `node --check` OK; 1 solo shebang). (Falta republicar a npm.)

### Estandarización de handoff/pausa (lo que pidió Santi) — HECHO
- **pickAdapter** incluye kapso → responder desde el panel, campañas y follow-ups salen por Kapso.
- **Pausa/reanudar/handoff** operan por `channel_user_id` (conv id `kapso:<telefono>`) — agnósticos.
- **Takeover del dueño** reutiliza `resolveTakeoverMs` (helper nuevo en `db/settings.ts`,
  compartido con el panel) — la coexistencia usa exactamente el mismo mecanismo de pausa.
- **Reengage** (leads fríos): `kapso` añadido a `WINDOWED` (tiene ventana de 24h) + envío por
  `sendKapsoTemplate` fuera de ventana.
- **Inbox**: color de WhatsApp para kapso (`channelColor`).
- **human-in-the-loop.md**: documentada la vía extra de takeover por la app (coexistencia).

### Lo que se conecta SOLO (verificado)
- **Buffer + alarma:** el DO (`SupportAgent.ingest`) bufferea por `channel + channelUserId`;
  con `channel:"kapso"` el buffer, anti-spam, tier y LLM funcionan igual. **Diseño del buffer:**
  el de Kapso se deja **OFF** (opt-in, `buffer_enabled`) para no duplicar con el del DO —
  el del DO es mejor aquí (agrupa por conversación + ventana adaptativa + integrado con
  tier/anti-spam/LLM). Aun así, el handler es **robusto ante un batch** (`normalizeKapsoEvents`
  expande array/`{events:[]}` y decide por evento) y **fail-loud** (warn si llega
  `X-Webhook-Batch`) → nunca pierde mensajes en silencio si alguien activa el buffering.

---

## Plan de pruebas

- [x] `pnpm typecheck` (bot + forja-cloud) + tests de canales/reengage en verde
  (10 tests nuevos del adapter: parseo, firma, y la decisión de coexistencia por `origin`).
- [x] La `KAPSO_API_KEY` de Santi funciona: la Platform API responde y hay un número
  **sandbox** (`phone_number_id 597907523413541`).
- [ ] **End-to-end (falta, requiere desplegar el bot demo con las 3 vars):**
  1. **Send:** el bot responde por el proxy de Kapso a un WhatsApp de prueba.
  2. **Webhook entrante:** un mensaje al número → `/webhooks/kapso` lo parsea → el bot responde.
  3. **Coexistencia:** responder a mano desde la app → el bot pausa ese chat (evento
     `message.sent` origin `business_app`).
  4. **Media/audio:** nota de voz → llega el `transcript`. Imagen → **verificar que la
     `media_url` de Kapso es fetchable** por el pipeline de vision (si pide auth, meter un
     proxy como el de `whatsapp.ts`). ← único punto no confirmado del contrato.
  5. **Firma:** webhook con firma inválida → 403.

---

## Orden de release (regla de forja-interno) — cuando la prueba e2e pase

1. Artefacto del bot (adapter + panel + skills) — `node scripts/publish.mjs <v> --release`.
2. CLI a npm (se tocó `AGENT_SKILL`) — `gh workflow run publish-cli.yml`.
3. Panel de agencia (`forja-cloud`) — `pnpm run deploy` (se tocó el catálogo).

---

## Qué falta / decisiones de Santi

1. **Prueba end-to-end** con un número real: correr `kapso setup` eligiendo **coexistencia**,
   crear el webhook a `/webhooks/kapso` (kind=kapso, v2, eventos received+sent), y meter las 3
   vars con `wrangler secret put` en el bot demo. (El sandbox sirve para send + firma; la
   coexistencia real necesita un número conectado.)
2. **Modelo de onboarding:** v1 = "cada usuario su cuenta Kapso" (implementado, como Twilio).
   Descubierto: Kapso también soporta **setup_links** (el cliente conecta sin crear cuenta,
   con una cuenta central de la agencia) → encaja perfecto con el **Modo Agencia**; NO cambia
   el adapter (solo de dónde salen la key y el phone_number_id). Confirmar si v1 va con cuenta
   propia y dejamos setup_links para el Modo Agencia.
3. **Pricing de Kapso** — RESUELTO (ya en la guía): Free $0 (2k msg/mes, 1 número) · Pro
   $25/mes (100k msg, 3 números, +$10 extra) · Platform $299/mes (1M msg, 50 números, +$5
   extra). "Mensaje" = entrantes + salientes. Los cargos de Meta van **aparte** (plantillas;
   texto en ventana de 24 h gratis con Meta). Coexistencia y dedicada = mismo precio, todos los
   planes. → Para revender/agencia, el modelo de **cuenta central + setup_links** cabe en el
   plan Platform (50 números).
