# Elegir canal y método — el rompecabezas de conexiones

> Esta guía es para TI, el agente que instala el bot (Claude Code / Codex). Úsala
> al inicio de la FASE 3 para ayudar al miembro a **decidir cómo conectar cada
> red**. Presenta las opciones con sus pros y contras, deja que el miembro elija,
> y recién entonces abres la guía específica del método. No decidas por él sin
> explicarle el trade-off — la decisión es del dueño del negocio.

El bot recibe mensajes por **ocho puertas** ya desplegadas en su Worker: los
webhooks `/webhooks/telegram`, `/webhooks/twilio`, `/webhooks/meta`,
`/webhooks/manychat`, `/webhooks/whatsapp` (WhatsApp Cloud API oficial),
`/webhooks/kapso` y `/webhooks/ycloud` (WhatsApp por Kapso y por YCloud, ambos con
coexistencia), y `/webhooks/zernio` (**proveedor unificado**: IG/Messenger/
WhatsApp/Telegram/X/… con una sola cuenta — ver `zernio.md`), más el **sitio web
del negocio**, que no usa webhook porque no hay proveedor de por medio: el
navegador del visitante habla directo con el Worker.

> **Zernio** es la opción cuando el miembro quiere conectar **varias redes de una**
> o no quiere pelear con el setup de Meta: una cuenta, un webhook, OAuth de un clic
> por red. Puede incluso comprar un número para WhatsApp. Es un canal ADICIONAL.

Cada red se puede conectar por una de estas puertas. Un mismo canal (ej.
Instagram) tiene **más de un método**; tu trabajo es que el miembro elija el que
le conviene.

---

## Mapa rápido: qué red → qué métodos

| Red del cliente | Métodos posibles | Puerta (webhook) | Llaves que pide |
|---|---|---|---|
| **WhatsApp** | Cloud API oficial · Twilio · **Kapso (coexistencia)** · **YCloud (coexistencia)** · ManyChat | `/webhooks/whatsapp` · `/webhooks/twilio` · `/webhooks/kapso` · `/webhooks/ycloud` · `/webhooks/manychat` | Cloud API: `WHATSAPP_PHONE_NUMBER_ID`+`WHATSAPP_ACCESS_TOKEN`+`WHATSAPP_VERIFY_TOKEN`+`WHATSAPP_APP_SECRET` — Twilio: `TWILIO_ACCOUNT_SID`+`TWILIO_AUTH_TOKEN`+`TWILIO_WA_FROM` — Kapso: `KAPSO_API_KEY`+`KAPSO_PHONE_NUMBER_ID`+`KAPSO_WEBHOOK_SECRET` — YCloud: `YCLOUD_API_KEY`+`YCLOUD_WA_FROM`+`YCLOUD_WEBHOOK_SECRET` — ManyChat: `MANYCHAT_API_KEY` |
| **Instagram DMs** | Meta oficial · ManyChat | `/webhooks/meta` · `/webhooks/manychat` | Meta: `META_PAGE_ACCESS_TOKEN`+`META_VERIFY_TOKEN`+`META_APP_SECRET` — ManyChat: `MANYCHAT_API_KEY` |
| **Facebook Messenger** | Meta oficial · ManyChat | `/webhooks/meta` · `/webhooks/manychat` | igual que Instagram Meta oficial |
| **Telegram** | BotFather (único) | `/webhooks/telegram` | `TELEGRAM_BOT_TOKEN` |
| **Sitio web** | Chat en su propia página (único) | `/widget.js` + `/web/send` | ninguna: solo la var `WEB_SITES` con sus dominios |

> **Recomendación de arranque para no técnicos:** empezar por **Telegram** (5 min,
> gratis, sin verificaciones) para ver el bot vivo de inmediato, y en paralelo
> conectar la red donde de verdad están sus clientes (casi siempre WhatsApp o
> Instagram). **Si el negocio ya tiene página web, el sitio web es igual de
> rápido que Telegram y le sirve al cliente de verdad** — pregúntale si tiene
> página antes de dar por hecho que no.

> **Antes de explicarle las opciones al miembro**, ten clara esta distinción para
> no confundirlo tú mismo: el **número de prueba o real de la Cloud API es el
> bot** (el negocio, quien responde); el **celular del miembro (o el tuyo) que se
> usa para probar es un cliente** (quien le escribe al bot). Nunca son el mismo
> rol — si el miembro usa su propio número personal como número del bot, no va a
> poder probarlo desde ese mismo teléfono (necesita otra línea, o pedirle a
> alguien más que le escriba).

---

## WhatsApp — Cloud API oficial vs Twilio vs ManyChat

### Opción A · Twilio (la más rápida para arrancar y probar)
- **Pros:** arranca en minutos con el **sandbox** de Twilio (pruebas sin
  verificación de negocio); API estable y bien documentada; el bot ya trae el
  adaptador nativo (`/webhooks/twilio`); soporta plantillas HSM para el aviso de
  handoff al dueño.
- **Contras:** cobra **por mensaje** (precio de Meta + margen de Twilio); para
  producción necesitas un **sender aprobado** (tu número propio o uno de Twilio),
  y esa aprobación de WhatsApp puede tardar horas/días; requiere tarjeta.
- **¿Instalar el Twilio CLI?** *Opcional.* 
  - *Con CLI* (`brew install twilio/brew/twilio` o `npm i -g twilio-cli`): automatizas
    crear el sender y registrar el webhook desde la terminal — útil si el miembro
    quiere que TÚ hagas todo. Pro: menos clicks. Contra: una instalación más.
  - *Sin CLI* (solo dashboard de Twilio, `console.twilio.com`): pegas la URL del
    webhook a mano en la config del sender. Pro: nada que instalar, más visual
    para no técnicos. **Default recomendado: sin CLI** salvo que el miembro pida
    automatizar.
- Guía detallada: `twilio-whatsapp.md`.

### Opción B · ManyChat (WhatsApp visual, sin código)
- **Pros:** todo se arma con clicks en ManyChat; maneja el opt-in y las
  automatizaciones de marketing; un solo `MANYCHAT_API_KEY` para IG/FB/WA.
- **Contras:** **costo mensual** de ManyChat encima del de WhatsApp; dependes de
  su plataforma y de sus límites de plan; menos control fino.
- Requiere `MANYCHAT_CONTENT_TYPE = "whatsapp"`. Guía: `manychat-webhook.md`.

### Opción C · WhatsApp Cloud API oficial (directo con Meta, sin intermediario) — mejor margen
- **Pros:** va **directo a Meta**, sin BSP ni markup de Twilio → **la tarifa más
  barata** (mejor margen para revender). Mismo ecosistema Graph que Messenger/IG.
  El bot ya trae el adaptador nativo (`/webhooks/whatsapp`), maneja notas de voz
  e imágenes (proxy de media firmado), y **no cobramos por conversación**.
- **Contras:** el setup es **más pesado** que Twilio: creas una **WABA** + número,
  haces **verificación de negocio** de Meta (tarda días) y necesitas **plantillas
  aprobadas** para iniciar conversación fuera de la ventana de 24h. Dentro de esa
  ventana, texto libre.
- **Se puede PROBAR gratis, sin nada de eso:** Meta te da un **número de prueba**
  y hasta ~5 destinatarios verificados. Perfecto para dejar el canal funcionando
  antes de meter número real. → **recomienda esta opción para quien va en serio /
  quiere volumen y margen; usa Twilio para arrancar rápido.**
- **Si eliges tu número real, necesitas una SIM dedicada** (no tu WhatsApp
  personal) y esto **cambia el Phone Number ID** — el bot se reconfigura solo con
  `doctor` (`npx forjabot doctor --whatsapp`).
- Guía detallada: `whatsapp-cloud.md`.

### Opción D · Kapso (COEXISTENCIA — conserva tu app de WhatsApp Business) ⭐ para quien ya usa su WhatsApp
- **Pros:** la única opción donde el negocio **NO pierde su app**. Conectas tu
  **MISMO número** en modo coexistencia y **sigues usando WhatsApp Business a
  mano** mientras el bot también atiende. Si tú tomas un chat desde tu app, el bot
  **se pausa solo** en esa conversación (mismo takeover que el panel — pausa,
  reanudar y handoff funcionan idénticos). El bot ya trae el adaptador nativo
  (`/webhooks/kapso`) y Kapso te entrega las **notas de voz ya transcritas**.
  Setup ligero: cuenta en kapso.ai, conectas el número, creas un webhook.
- **Contras:** dependes de Kapso como intermediario (**costo** según su plan) y la
  coexistencia tiene **desconexiones ocasionales** y a veces el **primer mensaje
  tarda** (limitación que la propia Kapso reconoce). Para **volumen alto** conviene
  una conexión **dedicada** (sin app) o la Cloud API directa.
- **Cuándo recomendarla:** el negocio ya vive en su WhatsApp Business y **no quiere
  perder la app** ni migrar el número → Kapso es la opción natural. Para máxima
  escala/margen sin app → Cloud API (Opción C). Para arrancar en 10 min de prueba →
  Twilio (Opción A).
- Requiere `KAPSO_API_KEY` + `KAPSO_PHONE_NUMBER_ID` + `KAPSO_WEBHOOK_SECRET`.
  Guía detallada: `kapso-whatsapp.md`.

### Opción E · YCloud (COEXISTENCIA + cero comisión) ⭐ el markup más bajo, y ya lo usan en la comunidad
- **Pros:** BSP **oficial** de WhatsApp que también da **coexistencia** (conservas tu app en el
  mismo número, como Kapso) **y** cobra **cero markup** — pagas la tarifa de Meta exacta, sin
  comisión sobre los mensajes. Es "lo mejor de los dos mundos": no pierdes tu app **y** el mejor
  precio. Si tú o gente de tu comunidad **ya usan YCloud**, este es el camino natural. El bot trae
  el adaptador nativo (`/webhooks/ycloud`), maneja notas de voz (proxy de media firmado) e imágenes,
  y el takeover del dueño desde su app funciona igual que el panel.
- **Contras:** dependes de YCloud como intermediario (planes: Free $0 · Growth $39 · Pro $89 ·
  Enterprise $399/mes); la coexistencia limita a **5 msg/s** (fino para atención, no para envíos
  masivos). Requiere la app de WhatsApp Business 2.24.17+.
- **Cuándo recomendarla:** el negocio quiere **no perder su app** + el **markup más bajo**, o ya
  usa YCloud. Para máxima escala sin app → Cloud API. Para una prueba rápida → Twilio.
- Requiere `YCLOUD_API_KEY` + `YCLOUD_WA_FROM` (tu número en E.164) + `YCLOUD_WEBHOOK_SECRET`.
  Guía detallada: `ycloud-whatsapp.md`.

---

## Instagram DMs — Meta oficial vs ManyChat

### Opción A · Meta oficial (recomendada si ya maneja su IG)
- **Pros:** **sin costo de terceros** (solo la API de Meta, gratis para DMs);
  control total; un mismo webhook `/webhooks/meta` te sirve para Instagram **y**
  Messenger a la vez.
- **Contras:** setup más largo: necesitas **cuenta de Instagram Business**, una
  **app en developers.facebook.com**, y aceptar permisos; algunos permisos
  avanzados requieren revisión de Meta.
- Guía detallada: `meta-oficial.md`.

### Opción B · ManyChat (Instagram visual)
- **Pros:** setup guiado sin código; ideal si el miembro ya usa ManyChat para
  embudos; maneja historias/comentarios→DM con su UI.
- **Contras:** costo mensual; dependes de ManyChat.
- Guía: `manychat-webhook.md`. (Si el miembro quiere IG **solo** por ManyChat y
  además tiene Meta oficial encendido, se pone `IG_DM_SOURCE = "manychat"` para
  que el webhook oficial no procese los DMs doble.)

---

## Facebook Messenger — Meta oficial vs ManyChat
Mismo trade-off que Instagram. **Meta oficial** (gratis, `/webhooks/meta`, pide
`META_PAGE_ACCESS_TOKEN`) vs **ManyChat** (visual, de pago). Con Meta oficial,
Messenger e Instagram entran por la **misma app y el mismo webhook** — si el
miembro quiere las dos, se configuran juntas en `meta-oficial.md`.

---

## Telegram — método único
BotFather. Gratis, sin verificaciones, ~5 min. Es el mejor "primer canal" para
que el miembro vea el bot funcionando antes de pelear con WhatsApp/Meta. Guía en
el sub-flujo de `configurar-mi-chatbot.md` (Paso 3.1).

---

## Sitio web — método único
El chat en la página del negocio. **Sin proveedor, sin tokens, sin
verificación**: pones sus dominios en `WEB_SITES` y él pega un `<script>` antes
de `</body>`. Es el canal más barato de conectar y el único donde el visitante
ya está mirando el negocio cuando escribe.

**No es un método único de un solo camino: es una entrevista.** Lo primero que
preguntas es **con qué está hecha su página**, porque de eso depende TODO lo que
le digas después — y si no sabe, lo averiguas tú mirando su HTML (`/wp-content/`
→ WordPress, `cdn.shopify.com` → Shopify, `/_next/static/` → Next.js…). Luego le
preguntas **formato** (burbuja flotante vs ventana incrustada), **estilo** (uno
de cuatro), **color** y **saludo**, y recién entonces le armas su `<script>` ya
personalizado y le enseñas **solo** la ruta de menú de su plataforma.

Dos cosas que decides tú, no él:
- **Ventana solo si el HTML es tocable** (código propio, Next.js). En un
  WordPress o Shopify ajeno, burbuja.
- **Si no sabe qué estilo o color quiere**, ya tienes su sitio abierto: míralo y
  propónle. Fondo claro → `suave`; corporativo → `minimal`; negro → `oscuro`;
  foto o degradado → `vidrio`.

Nada de esto necesita redeploy: son atributos del `<script>`.
Guía detallada, con las rutas de menú verificadas de cada plataforma:
`sitio-web.md`.

---

## CLIs que pueden hacer falta (resumen de instalaciones)
- **Cloudflare `wrangler` (obligatorio):** ya lo instalaste/usaste en la FASE 1
  (crea D1/Vectorize, guarda secrets, despliega). Es EL CLI del proyecto.
- **Twilio CLI (opcional):** solo si eligen WhatsApp por Twilio y quieren
  automatizar sender/webhook. Si no, el dashboard basta.
- **Meta:** no usa CLI — todo se hace en `developers.facebook.com` y
  `business.facebook.com` (dashboard). Las llaves resultantes se guardan con
  `wrangler secret put`.

## Regla de oro para guardar llaves
**Nunca** pegues tokens/keys en el chat. Cada llave se guarda con
`wrangler secret put NOMBRE` (entrada oculta). Después de guardar los secrets de
un canal, corre `wrangler deploy` y pídele al miembro que **recargue
`/admin/conexiones`**: la tarjeta del canal se pone **verde** = quedó.
