---
name: conectar-mi-ia
description: Conecta el bot a la API key PROPIA del miembro (BYO-LLM) — su cuenta de Claude (Anthropic), ChatGPT (OpenAI), Gemini (Google) o Grok (xAI) como cerebro del bot, en vez del modelo incluido. El miembro NO programa; tú (Claude, el ingeniero) lo guías. Actívalo con "/conectar-mi-ia", "conectar mi IA", "usar mi propia API key de Claude/OpenAI/Gemini/Grok", "quiero que mi bot use mi cuenta de GPT/Claude/Gemini/Grok", "cambiar el modelo/cerebro del bot", "quiero pagar yo el consumo del bot".
---

# Conectar mi IA — usa tu propia API key como cerebro del bot

Eres el ingeniero del chatbot del miembro. Él NO programa: **tú corres los comandos si hacen
falta**, pero para esto casi todo se hace desde su propio panel — sin terminal.

Por default, **el bot YA trae cerebro incluido** (la key del sistema, en el env del bot) —
esto es 100% opcional. Sirve si el miembro quiere:
- **Controlar su propio costo** (paga él directo a Anthropic/OpenAI, ve su gasto real).
- **Sus propios límites/rate limits**, sin compartir cupo con otros bots.
- **Un modelo específico** que no sea el default automático (rápido⇄inteligente).

Déjaselo clarísimo desde el inicio, sin presionar: *"Tu bot funciona perfecto sin esto — esto
es solo si quieres pagar tú el consumo directo o usar un modelo en particular."*

SIGUE ESTAS REGLAS AL PIE DE LA LETRA.

## PASO 0 — Revisión (no edites nada todavía)

1. Confirma que estás en la carpeta del bot: debe existir `package.json` y `wrangler.toml`.
   Si no, detente y dilo.
2. Esta capacidad **NO tiene gating de nivel** — está disponible en Starter y en Pro por igual
   (la sección "Modelo de IA" del panel admin se renderiza siempre, sin checar tier). No le
   digas al miembro que necesita subir de plan para esto.
3. Revisa si ya tiene algo configurado: lee el setting `llm_provider` en D1 —
   ```bash
   wrangler d1 execute DB --remote --command "SELECT key, value FROM settings WHERE key IN ('llm_provider','llm_model')"
   ```
   Si `llm_provider` ya trae `anthropic` u `openai`, dile que ya tiene una IA propia conectada y
   pregúntale si quiere **cambiarla** (ir directo a elegir proveedor/modelo) o **quitarla**
   (saltar a "Quitar mi configuración" al final). Si viene vacío, sigue normal.

## PASO 1 — Elige proveedor (con criterio, no le hagas memorizar nada)

Cuatro opciones reales para que el miembro traiga su propia cuenta:

- **Claude (Anthropic)** — si ya usa o prefiere Claude, o quiere el modelo más equilibrado en
  costo/calidad para conversación.
- **ChatGPT (OpenAI)** — si ya tiene cuenta de OpenAI o prefiere esa familia de modelos.
- **Gemini (Google)** — si quiere la opción más barata con ventana de contexto enorme (1M
  tokens) y buen tool-calling; buena opción por default si el miembro no tiene cuenta previa en
  ninguna de las otras y solo quiere ahorrar.
- **Grok (xAI)** — si ya tiene cuenta de xAI/X Premium o prefiere esa familia de modelos.

No hay una respuesta "correcta" — las cuatro funcionan como cerebro del bot. Si el
miembro no tiene preferencia, pregúntale si ya paga alguna por separado (para no
duplicar cuentas) y sugiere esa; si no paga ninguna, Gemini suele ser la más barata para
empezar.

## PASO 2 — Sacar la API key (lo hace el miembro, en su cuenta)

Dile que la key es de SU cuenta — el consumo se cobra a él directo, no a Horizontes IA ni a Forja.

- **Claude**: entra a **console.anthropic.com** → API Keys → crea una nueva.
- **OpenAI**: entra a **platform.openai.com/api-keys** → crea una nueva.
- **Gemini**: entra a **aistudio.google.com/apikey** (Google AI Studio) → crea una nueva.
- **Grok**: entra a **console.x.ai** → API Keys → crea una nueva.

Avísale que necesita tener saldo/método de pago cargado en esa cuenta del proveedor, o la key
va a fallar al primer uso.

**NUNCA le pidas que te pegue la key en el chat.** Sigue al PASO 3 para dársela de forma segura.

## PASO 3 — Configurarlo (dos caminos — ofrece el que le quede más cómodo)

### Camino A — Panel admin del bot (recomendado, sin terminal)

El bot ya tiene una sección **"🧠 Modelo de IA"** lista en su panel de administración.

1. Dile que entre a `https://<su-worker>.workers.dev/admin/config` (usuario `admin` + la
   contraseña que ya configuró para su panel).
2. Ahí ve tres campos:
   - **Proveedor** — selecciona "Claude (Anthropic)", "ChatGPT (OpenAI)", "Gemini (Google)" o
     "Grok (xAI)".
   - **Modelo** — elige uno de la lista curada (ver PASO 4), o deja "Automático" si no está
     seguro.
   - **Tu API key** — la pega en ese campo (tipo password, oculto). Vacío = sigue usando la key
     del sistema.
3. Guarda el formulario.
4. Ahí mismo hay un botón **"⚡ Probar mi configuración"** — dile que le dé clic DESPUÉS de
   guardar. Verifica solo (PASO 5 abajo lo explica).

Este es el camino donde su key NUNCA pasa por ti ni por el chat — va directo del navegador del
miembro al bot.

### Camino B — Vía terminal (tú lo corres, si el miembro prefiere que tú lo hagas)

Si el miembro SÍ te da su key para que tú la guardes (adviértele antes que así queda en su base
D1, y que el camino A evita eso), corre esto por cada valor — usa el binding `DB` de siempre:

```bash
wrangler d1 execute DB --remote --command "INSERT INTO settings (key, value, updated_at) VALUES ('llm_provider', 'openai', strftime('%s','now')*1000) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
```

(cambia `'openai'` por `'anthropic'`, `'google'` o `'xai'` según lo que eligió). Repite el mismo patrón para
`llm_api_key` (el valor es la key completa) y, si aplica, `llm_model` (ver PASO 4 para el id
exacto). Las claves exactas de settings están en `src/db/settings.ts` (`SETTING_KEYS.llmProvider`
/ `llmApiKey` / `llmModel`).

## PASO 4 — Elegir modelo (opcional — recomiéndalo, no lo compliques)

Si el miembro no sabe cuál elegir, la recomendación por default es dejar el campo **Modelo**
vacío ("Automático") — el bot ya balancea rápido/inteligente solo según la conversación. Si
quiere fijar uno específico, estos son los curados (`CURATED_MODELS` en `src/llm/provider.ts`):

| Modelo | Cuándo recomendarlo |
|---|---|
| `claude-haiku-4-5-20251001` | Claude rápido y barato — volumen alto, respuestas simples |
| `claude-sonnet-5` | Claude — el mejor equilibrio calidad/costo (recomendado) |
| `claude-sonnet-4-6` | Claude equilibrado (generación anterior) |
| `claude-sonnet-4-5-20250929` | Claude equilibrado (generación anterior) |
| `claude-opus-5` | Claude máxima inteligencia — casos complejos, poco volumen |
| `claude-opus-4-6` | Claude muy capaz (generación anterior, mismo precio que Opus 5) |
| `gpt-4o-mini` | OpenAI rápido y barato |
| `gpt-4o` | OpenAI equilibrado |
| `gpt-4.1-mini` | OpenAI rápido |
| `gpt-4.1` | OpenAI más capaz |
| `gemini-2.5-flash-lite` | Gemini el más rápido y barato — volumen alto |
| `gemini-2.5-flash` | Gemini equilibrado y económico — 1M de contexto, buen tool-calling |
| `gemini-2.5-pro` | Gemini máxima inteligencia |
| `grok-4-fast-non-reasoning` | Grok rápido y barato |
| `grok-3-mini` | Grok económico |
| `grok-4` | Grok más capaz |

Si el miembro quiere barato sin pensarlo: `claude-haiku-4-5-20251001`, `gpt-4o-mini` o
`gemini-2.5-flash-lite` según el proveedor que eligió (Gemini suele ser el más barato de los
cuatro).

## PASO 5 — VERIFICAR que de verdad quedó (no lo des por hecho)

No basta con guardar el formulario — confirma que el bot REALMENTE está respondiendo con la
key/modelo del miembro:

1. **Camino más fácil**: en el panel admin, botón **"⚡ Probar mi configuración"** (después de
   guardar). Hace una llamada mínima real al modelo resuelto y muestra el resultado justo ahí:
   - ✓ verde con `proveedor/modelo → "ok"` = quedó conectado.
   - ✕ rojo con el error real (key inválida, sin saldo, modelo no existe, etc.) = algo falló —
     lee el mensaje, es literal el error del proveedor.
2. **Alternativa**: mándale al bot un mensaje de prueba por su canal normal (WhatsApp/Telegram/
   web) y confirma que responde con normalidad. Si el bot no responde o tira error, la key/modelo
   quedó mal.

Si falla, dile a qué se debe según el mensaje del error:
- `invalid api key` / `401` → la key está mal copiada o no es de ese proveedor.
- `insufficient balance` / `429` / cuota → falta saldo o cupo en SU cuenta del proveedor.
- error de modelo no encontrado → el id del modelo está mal (revisa que coincida exacto con la
  tabla del PASO 4) — si lo escribió a mano por terminal, un typo ahí rompe todo.
- `403 {"type":"forbidden","message":"Request not allowed"}` hacia api.anthropic.com →
  **NO es la key ni el modelo** (ese cuerpo no es un error del API de Anthropic — es su edge
  de Cloudflare rechazando la petición antes de llegar). Ver la sección siguiente.

## Error 403 "Request not allowed" (Anthropic) — diagnóstico y cura

**Síntoma:** TODAS las llamadas del Worker a `https://api.anthropic.com/v1/messages` regresan
`HTTP 403` con cuerpo `{"error":{"type":"forbidden","message":"Request not allowed"}}`, sin
importar la API key ni el modelo, y el bot contesta siempre con el mensaje de respaldo.

**Causa real:** el agente del bot (Durable Object) nace en el datacenter de Cloudflare más
cercano a quien manda los webhooks. Si el proveedor del canal tiene sus servidores en Asia
(pasa con algunos BSP, p.ej. YCloud), el agente queda corriendo allá — y el edge que protege
api.anthropic.com veta el tráfico con ese origen (Anthropic no da servicio en esas regiones).
La key nunca llega a evaluarse — por eso cambiar de key o de modelo no arregla nada. No
depende de dónde esté el miembro, sino de dónde están los servidores de su proveedor de canal.

**Cura (1 línea + redeploy — sigue usando SU misma API key y cuenta de Anthropic):**

1. Requiere bot **>= 1.0.59** — si es más viejo, primero `forjabot update` y deploy.
2. En el `wrangler.toml` del bot, sección `[vars]`, AGREGA:
   ```toml
   AGENT_LOCATION_HINT = "enam"
   ```
   (este de Norteamérica; también vale `wnam`. Valores posibles:
   `wnam|enam|sam|weur|eeur|apac|oc|afr|me`.)
3. `npx wrangler deploy` y prueba con un mensaje real por el canal.

Con la var, el agente corre en la región indicada sin importar de dónde lleguen los webhooks,
y las llamadas a Anthropic salen de EE.UU. → pasan. Nota: al activarla (o cambiarla) los
agentes renacen en la región nueva — el historial está en D1 y no se pierde; solo se pierde
el buffer de mensajes en vuelo de ese instante (segundos).

**Plan B (si el hint no bastara, o para cubrir también los toques del cron):** rutear
Anthropic por un **AI Gateway** gratuito de la cuenta de Cloudflare del miembro
(dashboard → AI → AI Gateway → *Create Gateway*) y agregar en `[vars]` (termina en
`/anthropic/v1` — el bot le anexa `/messages` solo; requiere bot >= 1.0.58):
```toml
ANTHROPIC_BASE_URL = "https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway>/anthropic/v1"
```
El gateway hace la llamada desde infra de Cloudflare como petición nueva y el edge la deja
pasar; misma key, misma cuenta, y de bonus da logs de cada llamada al LLM.

**Plan C:** conectar otro proveedor como cerebro (PASO 1 con OpenAI / Google / xAI) — sus
APIs no están detrás del mismo edge y no les afecta este bloqueo.

Recién cuando la prueba sale ✓, confírmale al miembro que su bot ya corre con SU cuenta.

## Quitar mi configuración (volver al cerebro incluido)

- **Camino A (panel)**: si ya hay una key guardada, el campo de API key muestra una casilla
  "Quitar mi API key y volver a la del sistema" — la marca y guarda.
- **Camino B (terminal)**: pon `llm_provider` y `llm_api_key` en cadena vacía (`''`) con el
  mismo `INSERT ... ON CONFLICT` del PASO 3B.

El bot vuelve a usar la key del sistema y los tiers automáticos de inmediato — no hace falta
redeploy.

## Variables que usa esta integración (resumen)

| Variable | Dónde | Obligatoria | Qué es |
|---|---|---|---|
| `llm_provider` | setting (D1, tabla `settings`) | No | `"anthropic"` \| `"openai"` \| `"google"` \| `"xai"` \| vacío = automático (usa la key del sistema) |
| `llm_api_key` | setting (D1, tabla `settings`) | No | La API key del miembro; vacío = usa la key incluida del sistema |
| `llm_model` | setting (D1, tabla `settings`) | No | Id concreto del modelo (tabla PASO 4); vacío = tiers automáticos rápido⇄inteligente |

Código relevante (por si necesitas revisar o extender): `src/llm/provider.ts` (`createModel`,
`CURATED_MODELS`, tiers fast/smart por proveedor), `src/db/settings.ts` (`SETTING_KEYS.llmProvider`
/ `llmApiKey` / `llmModel`), `src/admin/views/config.ts` (sección "🧠 Modelo de IA", ~línea 105),
`src/admin/routes.ts` (guardado del form ~línea 456, endpoint de prueba `GET /admin/config/llm-test`
~línea 434).
