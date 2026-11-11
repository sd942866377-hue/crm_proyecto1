# Conectar tu bot a WhatsApp con Kapso (COEXISTENCIA — sin perder tu app)

Esta guía conecta tu chatbot a **WhatsApp** usando **Kapso**. Kapso es un puente sobre la
API oficial de WhatsApp (la Cloud API de Meta), y su gran ventaja es la **COEXISTENCIA**:
conectas tu **MISMO número** y **sigues usando tu app de WhatsApp Business** con normalidad,
mientras el bot también contesta. Claude Code hace lo técnico; **estas credenciales solo las
consigues tú**, porque salen de tu cuenta de Kapso.

> **¿Por qué Kapso y no Twilio o la Cloud API directa?**
> - **Twilio** te obliga a **migrar el número** a Twilio → pierdes la app de WhatsApp Business
>   en ese número. Rápido de arrancar, pero el número queda "secuestrado" por el bot.
> - **Cloud API directa** (con Meta): el número también queda dedicado al API, sin app.
> - **Kapso con coexistencia**: conservas tu número **y** tu app. Tú puedes seguir
>   respondiendo a mano desde WhatsApp cuando quieras, y el bot atiende el resto. Es la opción
>   más natural para un negocio pequeño que ya usa su WhatsApp Business todos los días.
>
> **La contra honesta** (de la propia doc de Kapso): la coexistencia tiene *desconexiones
> ocasionales* y a veces *el primer mensaje entrante tarda en llegar*. Para volumen alto y
> máxima estabilidad, Kapso recomienda una conexión **dedicada** (o la Cloud API directa). O
> sea: coexistencia = comodidad (no pierdes tu app); dedicada = escala. Puedes empezar en
> coexistencia y cambiar después.

---

## 🧭 Antes de nada: quién es quién

Igual que con cualquier canal de WhatsApp, no confundas los dos roles:

| Número | Rol | Es… |
|---|---|---|
| Tu número de negocio conectado en Kapso | **El bot / el negocio** | La línea desde la que el bot **RESPONDE** (y desde la que TÚ también respondes por tu app, en coexistencia) |
| El celular de un cliente | **Un cliente** | El teléfono desde el que **le escriben** al bot |

Lo especial de la coexistencia: **el mismo número lo comparten el bot y tú**. Si tú tomas un
chat desde tu app de WhatsApp Business, el bot lo detecta y **se hace a un lado solo** en esa
conversación (ver "Cómo funciona la coexistencia" abajo). No se pisan.

## Qué vas a lograr

Que cuando un cliente le escriba a tu número, el bot le responda solo — texto, **notas de voz**
(Kapso ya te las entrega **transcritas**) e **imágenes**. Y que cuando **tú** contestes a mano
desde tu app, el bot te ceda ese chat automáticamente.

## Antes de empezar

- Una cuenta en **https://kapso.ai** (o **https://kapso.com**). Es gratis crearla.
- Tu Worker ya desplegado (Claude Code te da la URL al terminar `pnpm run deploy`, algo como
  `https://TU-WORKER.workers.dev`). La necesitas para el webhook.
- Tu número de WhatsApp Business a la mano (el que quieres que atienda el bot).

## Cuánto cuesta (planes de Kapso, a jul 2026)

| Plan | Precio | Mensajes/mes | Números |
|---|---|---|---|
| **Free** | $0 | 2,000 | 1 |
| **Pro** | $25/mes | 100,000 | 3 (+$10 c/u extra) |
| **Platform** | $299/mes | 1,000,000 | 50 (+$5 c/u extra) |

- "Mensaje" = **todos** los mensajes, entrantes **y** salientes (texto, media, plantillas,
  interactivos). Los *read receipts* NO cuentan.
- **Los cargos de Meta van APARTE** de la suscripción de Kapso (es normal en toda la API de
  WhatsApp): Meta cobra por **plantilla entregada** (varía por país/categoría); los mensajes de
  texto normales **dentro de la ventana de 24 h son gratis** con Meta. Con créditos de Kapso, te
  deduce el precio de Meta **sin markup**.
- El **Free** (2,000 msg, 1 número) alcanza para probar o un negocio muy chico; para un negocio
  real, **Pro** ($25/mes). Coexistencia y dedicada están en todos los planes (mismo precio).

---

## FASE A — Crear cuenta y conseguir tu API key

1. Entra a **https://kapso.ai** y crea tu cuenta / proyecto.
2. En el panel de Kapso, ve a **API keys** (o Settings → API) y crea una **API key del proyecto**.
   Guárdala — es tu `KAPSO_API_KEY`.

> **Atajo con el CLI de Kapso** (opcional, para quien se siente cómodo en terminal):
> ```bash
> npm install -g @kapso/cli
> kapso login          # autentica esta terminal con tu cuenta
> kapso setup          # te guía para conectar el número (elige COEXISTENCIA)
> ```
> Con el dashboard web es igual de válido; usa lo que prefieras.

## FASE B — Conectar tu número en modo COEXISTENCIA

1. En Kapso: **Connect WhatsApp / Conectar número**.
2. Cuando te pregunte el **tipo de conexión**, elige **Coexistence / Coexistencia** (NO
   "Dedicated"). Esto es lo que te deja conservar tu app de WhatsApp Business.
3. Sigue el flujo de Meta (login con Facebook + elegir tu número). Al terminar, tu número queda
   conectado y **tu app de WhatsApp Business sigue funcionando**.
4. Copia el **`phone_number_id`** de tu número (en Kapso: WhatsApp → Numbers → tu número). Es tu
   `KAPSO_PHONE_NUMBER_ID`. Con el CLI: `kapso whatsapp numbers list`.

## FASE C — Crear el webhook (para que Kapso le avise a tu bot)

En Kapso: **Webhooks → New webhook** (a nivel del número / phone number), con:

- **URL**: `https://TU-WORKER.workers.dev/webhooks/kapso`  ← la URL de tu Worker + `/webhooks/kapso`
- **Kind / tipo**: **Kapso** (eventos, NO "Meta raw").
- **Payload version**: **v2**.
- **Eventos**: marca **`whatsapp.message.received`** (mensajes que te escriben) **y
  `whatsapp.message.sent`** (necesario para la coexistencia — así el bot sabe cuándo TÚ
  respondiste desde tu app).
- **Buffering**: **desactivado** (OFF). Tu bot ya agrupa los mensajes por su cuenta; no
  queremos doble buffer.
- Al crear el webhook, Kapso te da un **signing secret / webhook secret**. Cópialo — es tu
  `KAPSO_WEBHOOK_SECRET`. (Sirve para que tu bot verifique que el webhook viene de Kapso.)

## FASE D — Claude guarda las credenciales

Pásale a Claude Code las 3 credenciales y él las guarda como secrets (nunca en el chat, nunca
en archivos):

```bash
wrangler secret put KAPSO_API_KEY          # la API key del proyecto (Fase A)
wrangler secret put KAPSO_PHONE_NUMBER_ID  # el phone_number_id de tu número (Fase B)
wrangler secret put KAPSO_WEBHOOK_SECRET   # el signing secret del webhook (Fase C)
```

> Si tu bot ya estaba desplegado, estas vars son **nuevas**: se **agregan**, no se descomenta
> nada. Tras guardarlas, Claude corre `pnpm run deploy` para que el canal quede vivo.

## FASE E — Probar

1. Desde **otro** teléfono (un cliente de prueba), escríbele a tu número de WhatsApp.
2. El bot debe responder. En el panel del bot, la conversación aparece con el canal **WhatsApp**
   (detalle "Kapso · coexistencia").
3. Manda una **nota de voz** → el bot la entiende (Kapso la transcribe).
4. **Prueba la coexistencia**: desde **tu app de WhatsApp Business**, responde a mano a ese
   cliente. El bot debe **quedarse callado** en esa conversación (te la cedió). Cuando quieras
   que el bot retome, usa **Reactivar** en el panel (pestaña Conversaciones).

---

## Cómo funciona la coexistencia (para que sepas qué esperar)

- Cuando **un cliente** te escribe → el bot responde (a menos que la conversación esté pausada).
- Cuando **tú** respondes a ese cliente **desde tu app** → Kapso le avisa a tu bot con un evento
  `whatsapp.message.sent` de origen `business_app`, y el bot **pausa esa conversación** por el
  tiempo que tengas configurado en **Configuración → cuánto se queda callado el bot tras tu
  intervención** (igual que cuando tomas un chat desde el panel). Así el bot no responde encima
  de ti.
- El eco de los mensajes que manda **el propio bot** (origen `cloud_api`) NO pausa nada — el
  bot sabe distinguir sus propios mensajes de los tuyos.
- Para devolverle un chat al bot antes de tiempo: **Reactivar** en el panel.

Esto es exactamente el mismo comportamiento de "tomar el control" que ya conoces del panel y de
Twilio: pausar / reanudar / handoff funcionan idénticos en Kapso.

---

## Reenganche fuera de la ventana de 24 h (opcional, avanzado)

WhatsApp solo deja mandar **texto libre** dentro de las 24 h desde el último mensaje del cliente.
Para reenganchar leads fríos fuera de esa ventana necesitas una **plantilla (HSM)** aprobada por
Meta. En Kapso creas la plantilla igual que en la Cloud API (por **nombre + idioma**), y en el
panel del bot la configuras en **Plantillas** (nombre e idioma). Tu bot ya sabe usarla para el
reenganche automático de leads fríos por Kapso. Dentro de la ventana de 24 h no necesitas nada
de esto.

## Si algo falla

- **El bot no responde a un mensaje entrante**: revisa que el webhook de Kapso apunte a
  `…/webhooks/kapso`, que sea **kind=Kapso** y **v2**, y que el evento `whatsapp.message.received`
  esté marcado. En Kapso, **Logs** te muestra cada entrega.
- **403 bad signature en los logs del Worker**: el `KAPSO_WEBHOOK_SECRET` no coincide con el del
  webhook. Vuelve a copiarlo de Kapso y `wrangler secret put KAPSO_WEBHOOK_SECRET` otra vez.
- **El bot responde encima de ti cuando contestas por tu app**: confirma que el evento
  `whatsapp.message.sent` esté marcado en el webhook (sin él, el bot no se entera de tu
  intervención).
- **Desconexiones ocasionales / el primer mensaje tarda**: es una limitación conocida de la
  coexistencia. Si te pega el volumen, considera pasar a una conexión **dedicada** en Kapso (o
  la Cloud API directa, ver `whatsapp-cloud.md`).

**📚 Si necesitas resolver algo más a fondo (para Claude):** la documentación oficial de Kapso
está en `https://docs.kapso.ai` (con un índice para LLMs en `https://docs.kapso.ai/llms.txt` —
puedes leerlo con WebFetch). Kapso también publica **skills de agente** para integrar y
**diagnosticar** (`https://github.com/gokapso/agent-skills`, `npx skills add gokapso/agent-skills`)
y un buscador de logs en su CLI: `kapso logs search --query "<id-o-texto>" --period 24h --source all`.
Úsalos antes de adivinar. El mapa de docs de TODAS las plataformas está en `references/troubleshooting.md`.
