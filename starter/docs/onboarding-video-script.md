# Guion video de onboarding (5 min) — Horizontes Bot Template (Pro)

> Guion para el video de bienvenida del template. Tono Horizontes IA: directo, cero
> relleno, hablándole a una persona que NO necesita ser dev pero sí sabe abrir una
> terminal. Idioma: español. Términos técnicos en inglés (deploy, key, dashboard).
>
> **Tier de este repo:** Pro (`BOT_TIER=pro`). El template Free es otro repo.
> **Tiempo objetivo:** ~5 min. Cada escena trae el texto a cámara + qué se ve en pantalla.

---

## Escena 1 — Hook (15s)

**A cámara:**

"Hola, soy Santi. Esto es el chatbot que armé para mi negocio y que ahora te entrego
como template listo para producción. En los próximos 5 minutos te muestro cómo dejarlo
funcionando para TU negocio en una sola sesión. Sin escribir código."

**En pantalla:** logo Horizontes IA → corte rápido a una conversación real del bot en
Telegram respondiendo a un cliente. Dark mode, acento cyan.

---

## Escena 2 — Demo del resultado final (45s)

**En pantalla (split screen):**
- **Izquierda:** un cliente manda un DM por Telegram → el bot responde al instante con
  info del negocio (horarios, precios) sacada de la base de conocimiento.
- **Derecha:** el dashboard web abierto, mostrando la conversación en vivo y una tarjeta
  "Lead capturado: María — quiere agendar".

**A cámara (voz en off):**

"Esto es lo que vas a tener al final: un bot que contesta solo 24/7, sabe de tu negocio,
captura leads y, cuando algo se pone serio, te avisa A TI por Telegram para que tomes la
conversación. Todo corriendo en Cloudflare, prácticamente gratis."

**Tip de edición:** mostrar el handoff — cuando el bot detecta que no puede resolver,
te llega un mensaje de aviso a tu Telegram (el del dueño). Eso engancha.

---

## Escena 3 — Pre-requisitos (30s)

**A cámara:**

"Antes de empezar, necesitas cuatro cosas, todas gratis o casi:"

**En pantalla (checklist animado, dark + cyan):**
- ✅ **Node 20** y **pnpm** instalados (`pnpm -v` para verificar).
- ✅ Cuenta de **Cloudflare** (gratis) — aquí vive el bot.
- ✅ **Anthropic API key** (~$5 de crédito alcanzan de sobra para empezar).
- ✅ Un **bot de Telegram** (lo creas en 1 minuto con @BotFather).

**A cámara:**

"Si tienes esto, en 30 minutos quedas. Y no te preocupes, el asistente que viene dentro
del template te va pidiendo cada cosa cuando toca."

---

## Escena 4 — Walkthrough del skill (3 min)

**A cámara:**

"La magia está en un solo comando. Abres el proyecto en Claude Code y escribes
`/configurar-mi-chatbot`. A partir de ahí, te entrevista y configura todo por ti."

**En pantalla:** terminal corriendo `/configurar-mi-chatbot`. Ir comprimiendo cada paso
a 20-30s con cortes secos.

**Paso a paso (lo que se muestra):**

1. **Nicho del negocio (25s).** El skill pregunta a qué te dedicas y elige una de las
   plantillas de nicho incluidas (restaurante, clínica, inmobiliaria, etc.). Eso define
   la personalidad y el tono del bot.

2. **Base de conocimiento (30s).** Le das la info de tu negocio — horarios, precios,
   servicios, FAQs. El skill la guarda y la indexa para que el bot pueda buscarla.
   *Mostrar:* el comando `pnpm kb:reindex` generando el índice.

3. **Llaves y secrets (30s).** El skill te guía para pegar tu Anthropic key, el token de
   tu bot de Telegram y tu Telegram chat ID como dueño (`OWNER_TELEGRAM_CHAT_ID`) —
   ahí es donde te llegarán los avisos de handoff.

4. **Dashboard (25s).** Defines la contraseña del panel (`DASHBOARD_PASSWORD`). El acceso
   es con usuario `admin` y esa contraseña — Basic Auth, nada de magic links ni correos.

5. **Extras Pro opcionales (20s).** Si quieres avisos por email o por WhatsApp además de
   Telegram, el skill te deja conectar Resend (email) o Twilio (WhatsApp). Es opcional,
   te lo puedes saltar y seguir solo con Telegram.

6. **Deploy (30s).** El skill corre `pnpm deploy` y sube todo a Cloudflare Workers.
   *Mostrar:* la URL final del bot y del dashboard apareciendo en la terminal. Aplausos.

**A cámara (cierre del paso):**

"Listo. Tu bot ya vive en internet. Nada de servidores, nada de configuración manual."

---

## Escena 5 — Primer mensaje en vivo (30s)

**En pantalla:** abrir Telegram en el celular, buscar tu bot y mandarle "hola".

**A cámara:**

"Momento de la verdad. Le escribo 'hola' a mi bot…"

**En pantalla:** el bot responde al instante presentándose con el tono de tu nicho.
Hacer una segunda pregunta real ("¿a qué hora abren?") y mostrar que responde con la info
que cargaste en la base de conocimiento.

**A cámara:**

"Ahí está. Está usando exactamente la info de mi negocio."

---

## Escena 6 — CTA (15s)

**A cámara:**

"Si te atoras en algo, déjalo en el canal **#bot-help** dentro de tu Skool — ahí te
ayudamos. Y recuerda: en cualquier momento corres `/actualizar-mi-bot` para traer las
últimas mejoras del template sin perder tu configuración."

**En pantalla:** logo Horizontes IA + texto "Nos vemos en la comunidad" + el comando
`/actualizar-mi-bot` resaltado.

**A cámara (último beat):**

"Nos vemos adentro. A construir."

---

## Notas de producción

- **Duración total estimada:** 15s + 45s + 30s + 3m + 30s + 15s ≈ **5:15**. Recortar la
  Escena 4 si te pasas.
- **Identidad visual:** dark mode con acentos cyan (marca Horizontes IA) en todos los
  lower-thirds y screen recordings.
- **No prometer Skool API:** el comando `/actualizar-mi-bot` es `git pull` + `pnpm install`
  + deploy. NO valida nivel de Skool ni desbloquea features por API. No lo menciones como
  "verifica tu nivel automáticamente".
- **Handoff:** el canal por default es Telegram DM al dueño. Email (Resend) y WhatsApp
  (Twilio Content Template) son opcionales — preséntalos como "extras", no como obligatorios.
- **No mostrar secrets reales** en pantalla: usar valores de ejemplo o difuminar las keys.
