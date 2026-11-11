# Troubleshooting — Horizontes Bot (Pro)

Guía de problemas comunes y cómo resolverlos. Está ordenada por etapa:
**Setup** (preparación e instalación), **Deploy** (subir el bot a producción),
**Runtime** (el bot ya está vivo pero algo falla) y **KB / Vectorize** (la base
de conocimiento del negocio).

Antes de buscar tu error abajo, lo más rápido casi siempre es correr el chequeo
automático, que detecta secrets faltantes, bindings sin crear y configuración
incompleta:

```bash
pnpm run deploy
```

Si algo falta, el comando te lo dice por nombre antes de intentar subir nada.

> Todos los comandos `pnpm` y `wrangler` se corren **dentro de la carpeta del
> proyecto** (donde está `package.json`). Si ves `command not found` para
> `wrangler`, usa `pnpm wrangler ...` en lugar de `wrangler ...`.

---

## Setup

| Error | Causa | Cómo arreglarlo |
|---|---|---|
| `pnpm: command not found` | pnpm no está instalado | `npm install -g pnpm` (este proyecto usa **pnpm**, no npm) |
| `wrangler: command not found` | wrangler no está en el PATH | usa `pnpm wrangler ...`, o instala global con `npm install -g wrangler` |
| `wrangler login` no abre el navegador | terminal sin entorno gráfico | corre `WRANGLER_LOG=debug pnpm wrangler login` y copia/pega el URL en tu navegador a mano |
| Dependencias no instalan / `node_modules` corrupto | instalación a medias | borra `node_modules` y corre `pnpm install` de nuevo |
| `D1 create ... already exists` | ya existe una base con ese `database_name` (namespaceado por bot en `wrangler.toml`) | **Si es TU mismo bot re-instalándose** (mismo slug): corre `pnpm wrangler d1 list`, copia el `database_id` real y pégalo en `wrangler.toml` (binding **DB**). **Si el `database_name` es de OTRO bot**: NO lo reuses (heredarías su `settings`/persona) — cambia el slug de este bot y crea uno nuevo |
| `Vectorize ... already exists` | ya existe un índice con ese `index_name` | **Si es TU mismo bot**: reutiliza el `index_name` que ya está en `wrangler.toml` (no lo vuelvas a crear). **Si es de OTRO bot**: cambia el slug de este bot |
| `pnpm typecheck` marca errores tras editar `member/config.local.ts` | falta un campo o hay una coma/llave mal | revisa que `businessConfig` tenga `hours`, `services`, `location`, `paymentMethods`, `contactPhone` y `customFields`, y que `memberConfig` esté completo |

**Crear la base de datos y el índice (primera vez):**

```bash
# Usa los nombres namespaceados por bot que ya están en wrangler.toml
# (míralos con: grep -E 'database_name|index_name' wrangler.toml)
pnpm wrangler d1 create <database_name-de-wrangler.toml>
pnpm wrangler vectorize create <index_name-de-wrangler.toml> --dimensions=1024 --metric=cosine
```

Después aplica el esquema de la base de datos:

```bash
pnpm db:apply           # aplica el esquema en local
pnpm db:apply:remote    # aplica el esquema en producción
```

> El índice de Vectorize usa **1024 dimensiones** porque la KB se indexa con
> embeddings BGE de Workers AI. No cambies ese número.

---

## Deploy

El comando de despliegue es `pnpm run deploy`. Antes de subir nada corre un
chequeo (deploy-check) que valida que tengas los secrets requeridos y los
bindings creados. Si falta algo, se detiene y te dice qué.

| Error | Causa | Cómo arreglarlo |
|---|---|---|
| `Authentication error` al desplegar | wrangler perdió la sesión | corre `pnpm wrangler login` otra vez |
| deploy-check: `Missing secret ANTHROPIC_API_KEY` | falta la llave de Claude (obligatoria) | `pnpm wrangler secret put ANTHROPIC_API_KEY` |
| deploy-check: `Missing secret DASHBOARD_PASSWORD` | falta la contraseña del dashboard (obligatoria en Pro) | `pnpm wrangler secret put DASHBOARD_PASSWORD` |
| deploy-check: `Missing binding DB / KB` | la base de datos o el índice no existen | crea el faltante con el nombre namespaceado que ya está en `wrangler.toml` (`grep -E 'database_name|index_name' wrangler.toml`): `wrangler d1 create <database_name>` o `wrangler vectorize create <index_name> --dimensions=1024 --metric=cosine`, y verifica el binding en `wrangler.toml`. El binding `CATALOG`/R2 viene comentado y es OPCIONAL (solo lead magnets) — no da este error salvo que lo hayas activado. |
| `binding AGENT not found` / Durable Object error | el Durable Object `SupportAgent` no está declarado | revisa el bloque `[[durable_objects.bindings]]` en `wrangler.toml` (binding **AGENT**) y la migración; corre `pnpm typecheck` |
| Despliega pero `/health` da 404 | router mal montado | revisa `src/index.ts` y corre `pnpm typecheck` antes de volver a desplegar |
| Despliega pero `/admin` da 500 | falta `ANTHROPIC_API_KEY` u otro secret en runtime | corre `pnpm wrangler secret list` y agrega el que falte con `secret put` |
| Cambios en `member/` no se reflejan tras deploy | confusión de carpetas | `member/` es tu config y se respeta siempre; lo que se redeploya es `src/`. Si tocaste la KB, además corre el reindex (sección KB) |

**Secrets disponibles** (agrégalos con `pnpm wrangler secret put NOMBRE`):

- **Obligatorios:** `ANTHROPIC_API_KEY`, `DASHBOARD_PASSWORD`
- **Canales:** `TELEGRAM_BOT_TOKEN`, `MANYCHAT_API_KEY`
- **WhatsApp (Twilio):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WA_FROM`, `TWILIO_HANDOFF_CONTENT_SID`
- **Agenda:** `CALCOM_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`
- **Avisos al dueño:** `OWNER_TELEGRAM_CHAT_ID` (Telegram DM), `RESEND_API_KEY` + `OWNER_EMAIL` (email), `OWNER_WA_NUMBER` (WhatsApp)

> Las **variables** (no secrets) como `BOT_NAME`, `BUSINESS_NAME`,
> `BOT_LANGUAGE`, `BOT_TIER`, `BUFFER_SECONDS` y `DASHBOARD_BASE_URL` se editan
> directamente en `wrangler.toml`, no con `secret put`.

---

## Runtime (el bot ya está vivo)

### Dashboard / acceso de administrador

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| Al entrar al dashboard pide usuario y contraseña | es lo normal: el dashboard usa **Basic Auth** | usuario: **`admin`** (siempre), contraseña: la que pusiste en `DASHBOARD_PASSWORD` |
| `401 Unauthorized` al entrar al dashboard | la contraseña no coincide con `DASHBOARD_PASSWORD`, o el secret no está seteado | confirma que el usuario sea exactamente `admin`; vuelve a setear con `pnpm wrangler secret put DASHBOARD_PASSWORD` y redeploya con `pnpm run deploy` |
| Olvidaste la contraseña del dashboard | no se puede "recuperar", solo reemplazar | corre `pnpm wrangler secret put DASHBOARD_PASSWORD` con una nueva, luego `pnpm run deploy` |
| El navegador recuerda una contraseña vieja y da 401 | credenciales cacheadas de Basic Auth | abre en ventana privada/incógnito o limpia las credenciales guardadas del sitio |

> El dashboard **no tiene** login por email ni "magic link". No existe `/login`
> ni `/logout`. El único acceso es Basic Auth con usuario `admin`. Si una guía
> menciona magic link o Resend para iniciar sesión, está desactualizada — Resend
> aquí solo sirve para los **avisos por email al dueño**.

### Mensajes y canales

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| El bot no responde en Telegram | el webhook no está configurado o apunta mal | corre el `setWebhook` de la guía de Telegram apuntando a `https://<tu-worker>.workers.dev/webhooks/telegram` |
| El bot deja de responder en Telegram tras configurar el secreto | el `setWebhook` se corrió sin `secret_token` (o con otro valor) y el worker responde 403 | vuelve a correr el `setWebhook` de la guía agregando `&secret_token=<el valor que guardaste en TELEGRAM_WEBHOOK_SECRET>` |
| Telegram: el webhook responde error | token mal o URL incorrecta | verifica con `getWebhookInfo`; revisa `TELEGRAM_BOT_TOKEN` y que la URL termine en `/webhooks/telegram` |
| El bot tarda mucho en responder (>10s) | el buffer de mensajes está alto | baja `BUFFER_SECONDS` en `wrangler.toml` (ej. `5`) y redeploya |
| El bot agrupa varios mensajes en una sola respuesta | comportamiento esperado del buffer | si lo quieres más reactivo baja `BUFFER_SECONDS`; si quieres que junte más, súbelo |
| El bot responde en el idioma equivocado | `BOT_LANGUAGE` mal configurado | edita `BOT_LANGUAGE` en `wrangler.toml` y redeploya |
| `streamText failed: 401` / `invalid x-api-key` | la llave de Claude es inválida o expiró | renueva en console.anthropic.com y vuelve a poner `pnpm wrangler secret put ANTHROPIC_API_KEY` |
| El bot ignora notas de voz | falta transcripción o canal sin audio | la transcripción usa Whisper de Workers AI; confirma que el binding **AI** exista en `wrangler.toml` |
| El bot no "ve" imágenes | función Pro de visión no activa | la lectura de imágenes usa Haiku (solo Pro); confirma `BOT_TIER=pro` y que llegue la imagen del canal |

### WhatsApp Cloud API — errores de envío

> Setup completo (orden Fase A→F, token temporal vs permanente, ruta prueba vs
> número real) en `channel-setup-guides/whatsapp-cloud.md`.

| Error | Causa | Cómo arreglarlo |
|---|---|---|
| **131030** | El número que te escribió no está en la lista **"Para"** (modo prueba) | agrega y verifica ese número en la lista (`whatsapp-cloud.md`, Fase A Paso 5), o pasa a número real (Ruta B) |
| **190 / OAuthException / token expired** | El access token venció — era el temporal de 24h | genera el token permanente de System User (`whatsapp-cloud.md`, Fase F) |
| **100 (#131009) / recipient** | El número del destinatario está mal formateado | revisa el formato internacional (ej. `+52...`, sin espacios ni guiones) |
| Sin `sendReply` y sin `whatsapp in` en los logs (`wrangler tail`) | El webhook no está suscrito al campo `messages`, o el Verify Token guardado no coincide con el pegado en Meta | revisa `whatsapp-cloud.md` Fase C: suscribe `messages` (Paso 10) y confirma que `WHATSAPP_VERIFY_TOKEN` sea idéntico al que está en Meta |

**El bache del System User (Fase F):** al asignar los permisos del token te sale
*"No hay permisos disponibles — Asigna un rol de app al usuario del sistema o
selecciona otra app"*. Causa: asignaste la **WABA** como activo pero **no la
app** forjabot. Fix: vuelve a **"Asignar activos"** en el System User → tipo
**Apps** → selecciona **forjabot** → control total → reintenta generar el token.

### WhatsApp por Kapso — errores (coexistencia)

> Setup completo en `channel-setup-guides/kapso-whatsapp.md`. Para investigar a fondo, Kapso
> trae su propio buscador de logs (CLI de Kapso):
> `kapso logs search --query "<id-o-texto>" --period 24h --source all --output json`.

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| `403 bad signature` en `wrangler tail` | `KAPSO_WEBHOOK_SECRET` no coincide con el signing secret del webhook | vuelve a copiarlo de Kapso y `pnpm wrangler secret put KAPSO_WEBHOOK_SECRET`; redeploya |
| El bot no responde a entrantes | el webhook no apunta a `/webhooks/kapso`, no es **kind=Kapso** / **v2**, o falta el evento `whatsapp.message.received` | revísalo en Kapso; sus **Logs** muestran cada entrega del webhook |
| El bot responde ENCIMA del dueño cuando contesta desde su app | falta el evento `whatsapp.message.sent` en el webhook | márcalo — sin él el bot no se entera de la intervención (coexistencia) y no cede el chat |
| El bot manda texto pero el cliente no lo recibe (fuera de 24h) | fuera de la ventana de 24h Meta exige **plantilla** | configura la plantilla de reenganche en **Plantillas** (nombre+idioma); dentro de 24h no aplica |
| Desconexiones ocasionales / el primer mensaje tarda | limitación conocida de la **coexistencia** | ver `docs.kapso.ai` → Troubleshooting → Coexistence; para volumen alto, conexión **dedicada** |

### WhatsApp por YCloud — errores (coexistencia)

> Setup completo en `channel-setup-guides/ycloud-whatsapp.md`. Docs oficiales (para LLMs):
> `docs.ycloud.com/llms.txt`. YCloud firma el webhook tipo Stripe con **timestamp**.

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| `403 bad signature` en `wrangler tail` | `YCLOUD_WEBHOOK_SECRET` no coincide **o** el reloj está desfasado (la firma valida el timestamp, ±5 min) | vuelve a copiar el secret (`wrangler secret put YCLOUD_WEBHOOK_SECRET`); si el reloj del server/origen está mal, la firma se rechaza como replay |
| El bot no responde a entrantes | el webhook no apunta a `/webhooks/ycloud` o falta el evento `whatsapp.inbound_message.received` | revísalo en YCloud; su log de entregas muestra cada webhook |
| El bot pisa al dueño cuando contesta desde su app | falta el evento `whatsapp.smb.message.echoes` en el webhook | márcalo — es lo que habilita la coexistencia (que el bot ceda el chat) |
| No llega imagen/nota de voz | el media de YCloud se descarga con `X-API-Key` por un proxy firmado | confirma que `YCLOUD_API_KEY` esté seteada; el media caduca a los ~30 días / la sync de la app a los 14 |
| El bot manda texto pero el cliente no lo recibe (fuera de 24h) | Meta exige **plantilla** fuera de la ventana | configura la plantilla de reenganche en **Plantillas** (nombre+idioma) |

### Zernio — proveedor unificado (IG/Messenger/WhatsApp/Telegram/X/…)

> Setup completo en `channel-setup-guides/zernio.md`. **Doc oficial (para LLMs):**
> `docs.zernio.com/llms-full.txt` (~98K líneas — toda la API/schemas; `curl -sL` + grep).
> Firma HMAC-SHA256 directa (`X-Zernio-Signature`). Webhook → `/webhooks/zernio`.

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| El bot no ve apps conectadas | la API key no tiene el resource `messages` habilitado, o el webhook se auto-deshabilitó (10 fallos seguidos) | genera la key con `messages` en el dashboard; revisa el estado del webhook |
| `403 bad signature` | `ZERNIO_WEBHOOK_SECRET` no coincide | recópialo del webhook y `wrangler secret put ZERNIO_WEBHOOK_SECRET` |
| No responde a una conversación | Forja guarda el `conversationId`+`accountId` cuando el cliente ESCRIBE (`zernio_ctx`); es inbound-driven | normal — el bot responde a conversaciones iniciadas por el cliente |
| WhatsApp fuera de 24h: `TEMPLATE_REQUIRED` | Meta exige plantilla para reabrir | configura la plantilla en **Plantillas** (aparece como método "Zernio") |

### Handoff / avisos al dueño

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| No llega el aviso cuando un cliente pide hablar con una persona | falta el canal de aviso configurado | configura al menos uno: Telegram DM (`OWNER_TELEGRAM_CHAT_ID`), email (`RESEND_API_KEY` + `OWNER_EMAIL`) o WhatsApp Pro (Twilio) |
| No sabes tu `OWNER_TELEGRAM_CHAT_ID` | nunca le diste `/start` a tu propio bot | abre tu bot en Telegram, mándale `/start`, y obtén tu `chat_id` (ej. con `getUpdates`); guárdalo con `pnpm wrangler secret put OWNER_TELEGRAM_CHAT_ID` |
| El aviso por WhatsApp no llega | falta la plantilla aprobada de Twilio | WhatsApp **solo** envía con una plantilla aprobada: setea `TWILIO_HANDOFF_CONTENT_SID` (Content Template SID) y `OWNER_WA_NUMBER`; **no** se manda texto libre |
| Twilio devuelve error al avisar por WhatsApp | credenciales o número mal | revisa `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WA_FROM` y `OWNER_WA_NUMBER` (formato internacional, ej. `+52...`) |
| El email de aviso no llega | falta o es inválida la llave de Resend | setea `RESEND_API_KEY` y `OWNER_EMAIL`; revisa spam la primera vez |
| El bot se quedó "pausado" en una conversación | alguien usó la pausa (handoff) | el bot pausa una conversación cuando entra un humano; se reactiva según la lógica de la herramienta `pauseBot` |

### Herramientas (tools) y agenda

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| `scheduleAppointment` no agenda | falta config de Cal.com / Google | setea `CALCOM_API_KEY` y, si usas Google, `GOOGLE_SERVICE_ACCOUNT_JSON` |
| `catalogQuery` no encuentra productos | el arreglo `catalog` en `member/config.local` está vacío | llena los productos/servicios en `member/config.local.ts` — **catalogQuery NO usa R2**, los datos viven en ese archivo |
| `captureLead` no guarda nada | la base de datos no responde | confirma el binding **DB** y que el esquema esté aplicado (`pnpm db:apply:remote`) |

### Mantenimiento automático

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| Los mensajes viejos no se borran | el cron de limpieza no corre | el cron diario `0 3 * * *` purga mensajes con más de 90 días; verifica el bloque `[triggers]`/`crons` en `wrangler.toml` |

---

## KB / Vectorize (base de conocimiento del negocio)

La KB son tus archivos `member/kb/*.md`. Cuando los editas, hay que volver a
indexarlos en Vectorize para que el bot use la info nueva.

| Síntoma | Causa | Cómo arreglarlo |
|---|---|---|
| El bot no conoce info del negocio (horarios, servicios, precios) | la KB no está indexada o cambió y no se reindexó | vuelve a indexar (ver abajo) |
| El bot responde con info vieja | editaste `member/kb/*.md` pero no reindexaste | reindexa después de cada cambio en la KB |
| `Vectorize: index not found` | el índice no existe | `pnpm wrangler vectorize create <index_name-de-wrangler.toml> --dimensions=1024 --metric=cosine` (mira el `index_name` con `grep index_name wrangler.toml`) |
| `dimension mismatch` al indexar | el índice se creó con dimensiones distintas | borra y recrea el índice con `--dimensions=1024` (embeddings BGE) |
| La búsqueda (`searchKb`) devuelve resultados raros o vacíos | poca info o documentos muy largos | divide los `.md` en secciones claras por tema y reindexa |
| `member/config.local.ts` cambió pero el bot no lo refleja | esa config se lee en runtime, no es KB | no requiere reindex; basta redeploy con `pnpm run deploy` (no toca tu carpeta `member/`) |

**Reindexar la KB** (corre esto cada vez que edites `member/kb/*.md`):

```bash
pnpm kb:reindex
```

> Si la KB también dependía de cambios en el esquema de la base de datos, aplica
> primero `pnpm db:apply:remote` y luego `pnpm kb:reindex`.

> La carpeta `member/` (tu config y tu KB) **nunca se sobrescribe** al
> actualizar el bot. Solo `src/` se reemplaza. Si actualizas con
> `/actualizar-mi-bot` y algo de tu negocio "desaparece", revisa que tus cambios
> estén dentro de `member/` y no en `src/`.

---

## 📚 Documentación oficial de cada plataforma (para resolver lo que no está aquí)

Cuando el problema venga de una **plataforma externa** (WhatsApp, Meta, Kapso, Cloudflare…) y no
esté en las tablas de arriba, ve directo a **su documentación oficial**. Y si eres **Claude
resolviendo el problema, ábrela con WebFetch y léela en el momento** — varias publican recursos
pensados justo para esto (índices `llms.txt`, skills de agente). No adivines endpoints ni
códigos de error: verifícalos en la fuente.

| Plataforma | Documentación oficial | Debug / logs |
|---|---|---|
| **Kapso** (WhatsApp coexistencia) | `https://docs.kapso.ai` · índice para LLMs: `https://docs.kapso.ai/llms.txt` · Troubleshooting → **Coexistence** · **skills de agente oficiales** (integrar / observar / troubleshoot): `https://github.com/gokapso/agent-skills` — instálalas con `npx skills add gokapso/agent-skills` | `kapso logs search --query "<id>" --period 24h --source all --output json` |
| **YCloud** (WhatsApp coexistencia, zero-markup) | `https://docs.ycloud.com` · índice para LLMs: `https://docs.ycloud.com/llms.txt` (léelo con WebFetch) · help center: `https://helpdocs.ycloud.com` · API + OpenAPI en la misma doc | `pnpm wrangler tail` + el log de entregas de webhooks en el panel de YCloud |
| **WhatsApp Cloud API** (Meta directo) | `https://developers.facebook.com/docs/whatsapp/cloud-api` · códigos de error: `https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes` | `pnpm wrangler tail` |
| **Twilio** (WhatsApp) | `https://www.twilio.com/docs/whatsapp` · códigos de error: `https://www.twilio.com/docs/api/errors` | Console → Monitor → Logs → Errors |
| **Meta** (Messenger + Instagram) | `https://developers.facebook.com/docs/messenger-platform` · `https://developers.facebook.com/docs/instagram-platform` | `pnpm wrangler tail` |
| **Telegram** (Bot API) | `https://core.telegram.org/bots/api` · estado del webhook: `getWebhookInfo` | `pnpm wrangler tail` |
| **ManyChat** | `https://help.manychat.com` · API / External Request: `https://api.manychat.com` | `pnpm wrangler tail` → filtra `[manychat sendContent]` |
| **Cloudflare** (Workers · D1 · wrangler) | `https://developers.cloudflare.com/workers` · `https://developers.cloudflare.com/workers/wrangler` | `pnpm wrangler tail` (logs en vivo) |
| **Claude API** (Anthropic) | `https://docs.anthropic.com` | — |

> **Regla para Claude:** ante un fallo de canal que no viste, **abre la doc oficial de esa
> plataforma antes de improvisar**. Para **Kapso**, sus `agent-skills` traen el flujo de
> diagnóstico paso a paso (`observe-whatsapp` = logs, delivery, webhooks) — úsalas en vez de
> adivinar. La meta es que un problema que a nosotros se nos pasó, tú lo resuelvas leyendo la
> fuente, sin frenar al dueño.

---

## Si nada de esto funciona

1. Corre `pnpm typecheck` — atrapa errores antes de desplegar.
2. Corre `pnpm test` — confirma que la lógica base sigue sana.
3. Revisa los logs en vivo: `pnpm wrangler tail`.
4. Confirma tus secrets: `pnpm wrangler secret list`.
5. Vuelve a desplegar: `pnpm run deploy` (el deploy-check te dirá qué falta).

Si sigues atorado, copia el mensaje de error completo y el comando exacto que
corriste — eso es lo que se necesita para ayudarte rápido.
