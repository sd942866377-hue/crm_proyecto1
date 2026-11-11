# Mapa de Forja — cómo funciona todo y dónde vive cada cosa

> **El mapa maestro del bot.** Léelo cuando no estés seguro de DÓNDE se cambia algo o
> CÓMO fluye. Es la base sobre la que están escritos los demás skills — si un skill y
> este mapa se contradicen, gana el código (cada afirmación aquí cita `archivo:línea`).
>
> Para la división de planes, ver [`starter-vs-forja-plus.md`](./starter-vs-forja-plus.md).

## 1. El viaje de un mensaje

```
Cliente → canal (WhatsApp/Telegram/IG/Messenger/ManyChat)
  → webhook  /webhooks/<canal>            (src/index.ts:253-379)
  → adapter del canal normaliza el mensaje  (src/channels/*)
  → Durable Object del chat (uno por usuario)   (src/agent.ts — SupportAgent)
      · aplica el tier efectivo (applyTier)
      · arma el system prompt + el contexto del negocio
      · arma las tools disponibles (buildTools)
      · llama al LLM (createModel) con prompt caching
      · el modelo responde y/o llama tools
  → se parte la respuesta en chunks y sale por el adapter del canal
```

Fuera del chat en vivo, **crons** (`scheduled()` en `src/index.ts`) corren los motores
automáticos: Cazador de ventas, Analista/insights, alertas, reporte diario, reactivación,
encuestas, purga de mensajes viejos.

## 2. Dónde vive CADA config (la tabla que evita errores)

Hay **cuatro** lugares. Usar el equivocado es la causa #1 de "lo cambié y no pasó nada".

| Lugar | Qué guarda | Cambia sin redeploy | Cómo se edita |
|---|---|:--:|---|
| **`wrangler.toml [vars]`** | Identidad fija del bot: `BOT_NAME`, `BUSINESS_NAME`, `BOT_LANGUAGE`, `BOT_TIER`, `BOT_NICHE`, `BUFFER_SECONDS`, `DASHBOARD_BASE_URL`, `DASHBOARD_PUBLIC` | ❌ (requiere `pnpm run deploy`) | Editar el archivo + deploy |
| **Secrets** (`wrangler secret put`) | Llaves y datos sensibles: `ANTHROPIC/OPENAI_API_KEY`, `DASHBOARD_PASSWORD`, `TWILIO_*`, `OWNER_EMAIL/TELEGRAM_CHAT_ID/WA_NUMBER`, `COMPOSIO_API_KEY`, `STRIPE_SECRET_KEY`, `CALCOM_API_KEY`, `KB_REINDEX_TOKEN`, `CONTROL_PLANE_TOKEN`, `*_APP_SECRET` | ❌ | `wrangler secret put <NOMBRE>` (nunca en el chat) |
| **Tabla `settings` en D1** | Todo lo ajustable en caliente: `tone`, `system_prompt_override`, `business_context`, `model_override`, `temperature`, `monthly_budget`, `autonomy_level`, `llm_provider/llm_api_key/llm_model`, `blindaje_enabled`, los 6 toggles de superpoderes, `tier_override`, `self_origin`, `composio_context` | ✅ (lo lee cada mensaje) | `wrangler d1 execute DB --remote --command "INSERT ... ON CONFLICT..."` o el panel `/admin` |
| **`member/`** (archivos) | Contenido del negocio: `config.local.ts` (datos + catálogo), `kb/` (base de conocimiento) | ❌ (deploy; la KB además reindexa) | Editar archivos + deploy (+ `pnpm kb:reindex` para la KB) |

### Detalles que NO son obvios (léelos antes de "afinar")

- **El override del system prompt NO se hace en un archivo.** `member/system-prompt.local.ts`
  **no lo importa nadie** (verificado: 0 consumidores en `src/`). El único mecanismo real
  es el setting D1 **`system_prompt_override`** (`src/settings-loader.ts:105-107,137`), que
  además soporta override **por canal** (`system_prompt_override:<canal>`). Editar el
  archivo y desplegar no cambia nada.
- **`businessConfig` (en `member/config.local.ts`)** tiene una forma EXACTA — solo estos
  campos llegan al prompt (`src/businessContext.ts:9-18`): `hours`, `services` (`{name,
  price}[]`), `location`, `paymentMethods` (`string[]`), `contactPhone`, `customFields`
  (`Record<string,string>`). **No existen** `name`, `city`, `website` ni `description` —
  escribirlos ahí se ignora en silencio. El nombre del negocio vive en `businessName`
  (objeto `memberConfig`); "qué hace" / sitio web van a `customFields`.
- **El tono, el prompt y los toggles** se leen en CADA mensaje desde D1 → cámbialos por
  el panel o por SQL y aplican al instante, sin deploy.

## 3. El panel de administración (`/admin`)

- **Autenticación: HTTP Basic Auth** — usuario fijo `admin` + secret `DASHBOARD_PASSWORD`
  (`src/admin/auth.ts`, `src/admin/routes.ts:63-68`). No hay `/login` ni magic-link (el
  correo del dueño es solo para avisos de handoff, `OWNER_EMAIL`).
- **Protegido en AMBOS tiers.** El free también tiene panel con datos reales.
- Tabs libres vs Pro: ver la matriz. Las Pro son `PRO_ONLY_TABS` (`config.ts:23`).

## 4. El plano de control (control plane — app.forjabots.com ↔ bot)

- `GET /api/health`, `GET /api/metrics` — el control plane monitorea el bot (guard:
  `CONTROL_PLANE_TOKEN`).
- `POST /api/tier` — empuja el tier (Forja+ ↔ free) a `settings.tier_override` **sin
  redeploy**. Es como se prende Pro al instante.
- **Pairing**: el `forjabot install` enlaza el bot con la cuenta del dueño.
- **Self-origin**: si `DASHBOARD_BASE_URL` viene vacío, el bot aprende su propia URL de
  las requests entrantes (`src/lib/self-origin.ts`) para que los crons tengan un origin.

## 5. El sistema de tools (cómo se activan de verdad)

`buildTools(ctx)` (`src/tools/index.ts`) arma el set en 3 capas:

1. **Base (free)** — siempre: `searchKb`, `handoffHuman`, `pauseBot`, `snoozeUser`,
   `captureLead` (línea 41-47).
2. **Pro** — dentro de `if (isPro(ctx.env))`: `scheduleAppointment`, `catalogQuery`, y
   (si hay llave) `sendPaymentLink`, `composio` (línea 55-68).
3. **Por giro** (`BOT_NICHE`, no por tier) — `switch` línea 75-110: cada giro suma sus
   tools (`agendarCita`, `registrarPedido`, `crearReservacion`…). `agendarCita` reemplaza
   a `scheduleAppointment` (línea 114).

> **El gate REAL de una tool es dónde se coloca en `buildTools`** (dentro o fuera del
> `if (isPro)`), NO el arreglo `PRO_ONLY_TOOLS` de `config.ts` — ese arreglo no tiene
> consumidores en runtime hoy (`isToolAvailable` no se llama desde ningún lado). Sirve
> como documentación, no como interruptor. Si agregas una tool Pro, lo que la hace Pro es
> ponerla dentro del `if (isPro)`.

## 6. Seguridad (lo que un audit NO puede saltarse)

- **`DASHBOARD_PUBLIC="1"`** apaga TODO el Basic Auth del panel (`src/admin/routes.ts:63-65`),
  sin importar si `DASHBOARD_PASSWORD` está puesto. Este toggle ya causó una fuga de PII
  real (15-jul-2026, documentada en el `wrangler.toml`). **Debe estar en `"0"`.**
- Webhooks entrantes: Telegram/Twilio/ManyChat **no** validan firma por default; Meta/
  WhatsApp oficiales sí (`*_APP_SECRET`). El control plane (`/api/*`) se protege con
  `CONTROL_PLANE_TOKEN` (comparación timing-safe, `src/http-auth.ts`).
- Purga de mensajes a los 90 días (`src/crons/purgeOldMessages.ts`).

## 7. Deploy y comandos (package.json)

| Comando | Qué hace |
|---|---|
| **`pnpm run deploy`** | El correcto. Corre `predeploy` (deploy-check + escribe `.bot-version`) y luego `wrangler deploy`. **Usa siempre este, no `wrangler deploy` a secas** (se salta el check y el versionado). |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `vitest run` |
| `pnpm kb:reindex` | Regenera los embeddings de la KB tras editar `member/kb/` |
| `pnpm db:apply:remote` | Aplica el esquema D1 en prod |

## 8. Índice de skills (qué hace cada uno)

Todos viven en `skill/` desde el día 1; los Pro se detienen en su PASO 0 si el bot es free.
El gate de cada uno es `isPro(env)` (ver su PASO 0). Para el detalle de qué desbloquea Pro,
ver [`starter-vs-forja-plus.md`](./starter-vs-forja-plus.md).

| Skill | Para qué |
|---|---|
| `configurar-mi-chatbot` | Setup inicial completo (negocio, canales, secrets, deploy) |
| `actualizar-mi-bot` | Bajar la última versión del template sin perder lo del miembro |
| `afinar` | Ajustar comportamiento/KB a partir de fallos detectados |
| `voz-de-marca` | Ajustar el tono del bot |
| `re-nichar` | Cambiar el giro del bot (`BOT_NICHE` + KB + tono) |
| `agregar-tool` | Escribir/registrar una tool nueva |
| `conexiones-composio` | Conectar cualquier app externa vía Composio |
| `conectar-mi-ia` | Enchufar tu propio proveedor de IA (Claude/OpenAI) |
| `superpoderes` | Prender/apagar los superpoderes Forja+ |
| `auditoria` | Revisión de seguridad/costos del bot |
| `autopsia` | Diagnóstico de por qué el bot falló en algo |
| `mantenimiento` | Salud rutinaria (tickets, costos, KB) |
| `reporte` / `exportar` | Informe de valor / portabilidad de datos |
| `cliente-misterioso` | Prueba + automejora del bot en loop (evals) |
| `cliente-nuevo`, `cotizar`, `propuesta`, `cobrar`, `precios`, `clonar`, `campana`, `demo`, `whitelabel` | Modo Agencia (revender bots) |
| `contribuir` | Abrir issues/PRs al repo desde Claude Code |

---

*Regla de oro para no volver a driftar: la división de planes se declara UNA vez en el
código (los `isPro`) y se refleja en `starter-vs-forja-plus.md`. Este mapa describe la
arquitectura. Los skills OPERAN — apuntan aquí y a la matriz, no re-declaran la verdad.*
