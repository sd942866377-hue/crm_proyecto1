---
name: human-in-the-loop
description: Configura y explica el "human in the loop" del bot — cómo el bot escala a un humano, POR DÓNDE le llega el aviso al dueño (Telegram, email o WhatsApp), cuánto se pausa el bot cuando el dueño toma el control, y cómo intervenir un chat desde el panel. Tú (Claude) haces la configuración por el miembro: eliges el canal de avisos con él, guardas las variables, redespliegas y lo pruebas. Actívalo con "configurar human in the loop", "configura el human in the loop", "que me avise cuando el bot necesite un humano", "avisos de handoff", "quiero recibir avisos cuando el bot no pueda", "cómo me entero cuando el bot escala", "configurar el canal de avisos", "tomar el control de un chat".
---

# Human in the loop — avisos + toma de control

El "human in the loop" es cómo el bot **te pasa la batuta cuando te necesita**: el bot
detecta que hace falta una persona (el cliente lo pide, se queja, o algo está fuera de
alcance) → crea un **ticket**, **te avisa**, y espera. Tú entras al panel, **tomas el
control** del chat (respondes como humano o lo pausas), y cuando terminas **reanudas** y
el bot retoma con un resumen de lo que resolviste.

Tú (Claude) configuras esto POR el miembro: él casi nunca ve la terminal. **Una pregunta
por mensaje.** No expongas tokens ni los pegues en el chat. Confirma antes de redesplegar.

## Cómo funciona (explícaselo así, en corto)
1. **El bot escala** cuando toca (con el superpoder Handoff) → crea un ticket.
2. **Te llega el aviso** por el canal que configures (abajo).
3. **Abres el panel → Conversaciones**, ves el chat marcado (⏸ / ticket abierto).
4. **Tomas el control**: le respondes al cliente COMO HUMANO desde el panel (sale por su
   canal real) o pausas el bot en ese chat. El bot deja de responder AHÍ.
5. **Reanudas** cuando terminas → el bot vuelve, con contexto de lo que hiciste.

## PASO 1 — El canal de avisos (elige UNO con el dueño)
Pregúntale: **"¿por dónde quieres que te avise cuando el bot necesite un humano?"**
Si no está configurado ninguno, el panel muestra "⚠ HANDOFF SIN AVISO" en el Overview.

Las variables van en el bot (dentro de su carpeta). Guárdalas como secret
(`wrangler secret put NOMBRE`, pásalo por stdin) o como `[vars]` en `wrangler.toml` si no
es sensible, y al final **redespliega** (`pnpm run deploy`).

- **Telegram — lo más fácil y GRATIS (recomendado).** El dueño le manda `/start` a un bot
  de Telegram (el mismo del canal si ya lo usa, o uno nuevo con @BotFather). Tú lees su
  `chat_id` con `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates` y lo guardas
  en **`OWNER_TELEGRAM_CHAT_ID`**.
- **Email — GRATIS.** Guarda **`OWNER_EMAIL`** (a dónde llega) y **`RESEND_API_KEY`** (para
  poder enviar). Avísale que revise spam la primera vez.
- **WhatsApp — Forja+ (Pro).** Requiere una plantilla HSM aprobada (fuera de la ventana de
  24h). Guarda **`OWNER_WA_NUMBER`** y corre el setup de la plantilla (endpoint
  `/handoff/template/setup` del bot, `TWILIO_HANDOFF_CONTENT_SID`). Si el bot es Starter,
  ofrécele Telegram/email y menciona que el aviso por WhatsApp viene con la comunidad
  (Forja+).

Puedes configurar más de uno. Telegram + email juntos es lo más robusto.

## PASO 2 — Cuánto se pausa el bot cuando tomas el control
Cuando le respondes a un cliente desde el panel (o pausas ese chat), el bot se queda
callado AHÍ por un rato para que tú lo atiendas sin que el bot te pise.

- **Al pausar un chat puntual** (panel → Conversaciones → **«Pausar bot aquí»**) eliges la
  duración SOLO para ese chat, como en ManyChat: **30 min · 1 hora · 3 horas · 8 horas ·
  Hasta que reactive**. Reanudas antes cuando quieras con **«Devolver al bot»**.
- **El default global** (cuando respondes sin elegir duración) se configura en
  Configuración → tarjeta **"Cuando tomas el control"**, o con el setting `takeover_minutes`
  en D1: minutos (`30`, `60`, `180`) o **`0` = no vuelve hasta que reanudes**. Vacío = 60.

Pregúntale al dueño cómo lo prefiere y déjalo puesto.

## Pausar o reanudar un chat TÚ MISMO (paridad con el panel)
Todo lo que el dueño hace con los botones del panel, TÚ lo puedes hacer por su D1 — si te
pide *"pausa el chat con Juan una hora"* o *"reactiva a ese cliente"*, no lo mandes al panel:
hazlo. La conversación se identifica por el número/usuario del cliente (`channel_user_id`).
El nombre de la D1 está en el `wrangler.toml` del bot (`<DB>` abajo).

- **Pausar N minutos** — timestamp en ms = ahora + N·60000. En bash: `AHORA=$(( $(date +%s) * 1000 ))`.
  ```
  wrangler d1 execute <DB> --remote --command \
    "UPDATE conversations SET paused_until = <ahora_ms + N*60000> WHERE channel_user_id = '<id_cliente>'"
  ```
- **Pausar hasta reactivar** — usa un `paused_until` lejano (ahora + 1 año en ms).
- **Reanudar** — `... SET paused_until = NULL WHERE channel_user_id = '<id_cliente>'`.

Es exactamente lo que hace el botón: el bot deja de responder ESE chat hasta que venza el
tiempo o lo reanudes. Confírmale al dueño qué chat y por cuánto antes de ejecutar.

> **Coexistencia (canal Kapso):** si el bot está conectado por **Kapso en modo
> coexistencia**, hay una vía extra de toma de control, sin panel ni comandos: cuando el
> dueño le responde a un cliente **desde su propia app de WhatsApp Business** (el mismo
> número que atiende el bot), el bot detecta esa intervención y **pausa ese chat solo**, por
> el mismo `takeover_minutes` de arriba. Reanuda igual que siempre (panel → «Devolver al
> bot», o `paused_until = NULL`). Es la misma mecánica de takeover, disparada desde el
> teléfono del dueño en vez del panel — explícale al dueño de un bot Kapso que puede tomar
> un chat simplemente contestándolo desde su WhatsApp.

## PASO 3 — Pruébalo (no lo des por hecho)
1. Manda al bot un mensaje que dispare handoff (ej. *"quiero hablar con una persona"*).
2. Verifica que **te llegó el aviso** por el canal que configuraste.
3. En el panel → **Conversaciones**, abre ese chat, **responde como humano** (o púlsalo
   Pausar). Confirma que el cliente recibió tu mensaje por su canal.
4. Dale **Reanudar** y confirma que el bot vuelve a responder ese chat.

## Reglas
- **No** pegues tokens/keys en el chat. Guárdalos como secret y no los imprimas de vuelta.
- **No** redespliegues sin el "sí" del dueño.
- Solo lectura para diagnosticar; nunca borres conversaciones ni tickets.
- Si el aviso no llega: revisa que la variable esté puesta (Overview deja de mostrar el ⚠),
  que redesplegaste, y (Telegram) que el dueño le dio `/start` al bot.

Matriz de qué es free vs Pro: `skill/references/starter-vs-forja-plus.md` (handoff + aviso
Telegram/email = free; aviso por WhatsApp = Pro).
