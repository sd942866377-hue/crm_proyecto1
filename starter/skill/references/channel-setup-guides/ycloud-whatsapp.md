# Conectar tu bot a WhatsApp con YCloud (BSP oficial, COEXISTENCIA, cero comisión)

Esta guía conecta tu chatbot a **WhatsApp** usando **YCloud**, un proveedor oficial (BSP) de la
API de WhatsApp. Dos ventajas para tu negocio:

1. **Coexistencia**: conectas tu **MISMO número** y **sigues usando tu app de WhatsApp Business**
   — el bot atiende y tú puedes responder a mano desde la app cuando quieras (igual que Kapso).
2. **Cero comisión**: YCloud no cobra markup sobre los mensajes; pagas **exactamente la tarifa de
   Meta**. Si ya usas YCloud en tu comunidad, este es tu camino natural.

Claude Code hace lo técnico; **estas credenciales solo las consigues tú**, salen de tu cuenta de
YCloud.

> **¿Cuándo YCloud y cuándo otra opción?** YCloud = **el markup más bajo + coexistencia**, ideal
> si ya lo usas o quieres el mejor precio sin perder tu app. Kapso = coexistencia también, otra
> plataforma. Cloud API directa = tú administras la app de Meta. Twilio = el más rápido para una
> prueba en 10 min. (Comparador completo en `_elegir-canal-y-metodo.md`.)

---

## 🧭 Antes de nada: quién es quién

| Número | Rol | Es… |
|---|---|---|
| Tu número conectado en YCloud | **El bot / el negocio** | La línea desde la que el bot **RESPONDE** (y desde la que TÚ también respondes por tu app, en coexistencia) |
| El celular de un cliente | **Un cliente** | El teléfono desde el que **le escriben** al bot |

En coexistencia el número lo comparten el bot y tú: si tomas un chat desde tu app, el bot **se
hace a un lado solo** en esa conversación (ver "Cómo funciona la coexistencia" abajo).

## Qué vas a lograr

Que cuando un cliente le escriba a tu número, el bot responda solo — texto, **notas de voz**
(las transcribe el bot) e **imágenes**. Y que cuando **tú** contestes a mano desde tu app, el bot
te ceda ese chat.

## Antes de empezar

- Una cuenta en **https://www.ycloud.com**. Tiene plan **Free ($0)**.
- Tu Worker ya desplegado (Claude Code te da la URL al terminar `pnpm run deploy`).
- La **app de WhatsApp Business 2.24.17 o superior** en el teléfono del número (requisito de la
  coexistencia).

## Cuánto cuesta (planes de YCloud, a jul 2026)

| Plan | Precio |
|---|---|
| **Free** | $0 |
| **Growth** | $39/mes |
| **Pro** | $89/mes |
| **Enterprise** | $399/mes |

- **Cero markup**: los cargos de WhatsApp (Meta) van **aparte** y **directos** — cargas saldo
  (wallet) y YCloud descuenta la **tarifa oficial de Meta sin comisión**. Una conversación de 24 h
  cuesta ~$0.008–$0.069+ según país/tipo. Los mensajes que mandas **desde la app** siguen gratis.
- Coexistencia límite: **5 mensajes/segundo** (suficiente para atención). Para volumen masivo,
  una conexión dedicada.

---

## FASE A — Crear cuenta y API key

1. Entra a **https://www.ycloud.com** y crea tu cuenta.
2. En el panel de YCloud → **API Keys** → crea una key. Guárdala — es tu `YCLOUD_API_KEY`.

## FASE B — Conectar tu número en COEXISTENCIA (con tu app)

En YCloud: **Create channels → WhatsApp Business App Coexistence**:
1. Elige **WhatsApp Business App Number** y autoriza tu cuenta.
2. Ingresa tu número y continúa.
3. **Escanea el QR** que aparece con tu app de WhatsApp Business.
4. Completa la autorización (nombre del negocio + sitio web).
5. Confirma el binding y permite la sincronización del historial si quieres.

Al terminar, tu número queda conectado y **tu app de WhatsApp Business sigue viva**. Copia tu
**número en formato E.164** (ej. `+528145803756`) — es tu `YCLOUD_WA_FROM`.

## FASE C — Crear el webhook

En YCloud: **Webhooks → New**, con:
- **URL**: `https://TU-WORKER.workers.dev/webhooks/ycloud`
- **Eventos**: marca **`whatsapp.inbound_message.received`** (mensajes que te escriben) **y
  `whatsapp.smb.message.echoes`** (necesario para la coexistencia — así el bot sabe cuándo TÚ
  respondiste desde tu app).
- Al crear el webhook, YCloud te da un **signing secret**. Cópialo — es tu `YCLOUD_WEBHOOK_SECRET`
  (sirve para verificar que el webhook viene de YCloud).

## FASE D — Claude guarda las credenciales

```bash
wrangler secret put YCLOUD_API_KEY          # la API key de la Fase A
wrangler secret put YCLOUD_WEBHOOK_SECRET    # el signing secret del webhook (Fase C)
```
El número (`YCLOUD_WA_FROM`) puede ir como variable en `wrangler.toml` (no es secreto). Si tu bot
ya estaba desplegado, estas vars son **nuevas**: se **agregan**. Luego Claude corre `pnpm run deploy`.

## FASE E — Probar

1. Desde **otro** teléfono, escríbele a tu número. El bot debe responder. En el panel del bot, la
   conversación aparece como **WhatsApp** (detalle "YCloud · coexistencia").
2. Manda una **nota de voz** → el bot la entiende (la descarga por un proxy firmado y la transcribe).
3. **Coexistencia**: desde **tu app de WhatsApp Business**, responde a ese cliente. El bot debe
   **quedarse callado** en esa conversación. Para que retome, usa **Reactivar** en el panel.

---

## Cómo funciona la coexistencia (qué esperar)

- Un cliente te escribe → el bot responde (salvo que la conversación esté pausada).
- **Tú** respondes desde tu app → YCloud emite el evento `whatsapp.smb.message.echoes`, y el bot
  **pausa esa conversación** por el tiempo configurado en **Configuración → cuánto se queda callado
  el bot tras tu intervención** (igual que un takeover del panel). El bot no te pisa.
- Los mensajes que manda el propio bot (por la API) NO pausan nada — YCloud sabe distinguir el eco
  del business app de los envíos del bot.
- Para devolverle un chat al bot antes de tiempo: **Reactivar** en el panel.

Pausar / reanudar / handoff funcionan idénticos a cualquier otro canal.

## Reenganche fuera de la ventana de 24 h (opcional)

Fuera de las 24 h desde el último mensaje del cliente, WhatsApp exige **plantilla (HSM)** aprobada.
En YCloud creas la plantilla (por nombre + idioma) y la configuras en el panel del bot →
**Plantillas**. El bot la usa para el reenganche automático de leads fríos por YCloud. Dentro de
la ventana de 24 h no necesitas nada de esto.

## Si algo falla

- **`403 bad signature` en `wrangler tail`**: el `YCLOUD_WEBHOOK_SECRET` no coincide, o el reloj
  está muy desfasado (la firma valida el timestamp, ±5 min). Vuelve a copiar el secret y
  `wrangler secret put YCLOUD_WEBHOOK_SECRET`.
- **El bot no responde a entrantes**: revisa que el webhook apunte a `…/webhooks/ycloud` y que el
  evento `whatsapp.inbound_message.received` esté marcado. YCloud tiene un log de entregas.
- **El bot pisa al dueño cuando contesta desde su app**: confirma que el evento
  `whatsapp.smb.message.echoes` esté marcado en el webhook.
- **No llega una imagen/nota de voz**: el media de YCloud se descarga con tu API key por un proxy
  firmado; confirma que `YCLOUD_API_KEY` esté seteada.

**📚 Documentación oficial (para Claude):** `https://docs.ycloud.com` (con índice para LLMs en
`https://docs.ycloud.com/llms.txt` — léelo con WebFetch) y el help center `https://helpdocs.ycloud.com`.
El mapa de docs de TODAS las plataformas está en `references/troubleshooting.md`.
