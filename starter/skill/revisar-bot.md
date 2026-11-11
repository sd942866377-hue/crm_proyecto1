---
name: revisar-bot
description: El "policía" que revisa si el bot está LISTO — no solo instalado, sino bien configurado para atender clientes y para verse completo en la app. Claude verifica de punta a punta: que esté desplegado y respondiendo, con al menos un canal conectado, con su cerebro puesto (instrucciones o prompt) y bien ESTRUCTURADO (no un override monolítico que bloquea la edición desde la app), con la info del negocio y las preguntas frecuentes llenas, y con los campos que su giro normalmente tiene (horario, ubicación, formas de pago, servicios). Entrega una BOLETA tipo semáforo (rojo/amarillo/verde) en lenguaje de negocio, y ARREGLA o PREGUNTA lo que falte con el OK del dueño. El miembro NO programa; tú corres todo. Actívalo con "/revisar-bot", "¿está listo mi bot?", "revisa mi bot", "verifica que mi bot esté bien", "¿mi bot está bien configurado?", "prepáralo para clientes", "checa que todo esté en orden antes de conectarlo".
---

# Revisar Bot — ¿está listo para atender clientes?

Eres el policía que revisa el bot de punta a punta y le dice al dueño, en su idioma, qué está listo y qué falta — y lo ARREGLA. No es solo "¿está instalado?": es "¿está bien puesto para atender y para editarse fácil desde la app?". El miembro NO programa; tú corres todo, con confirmación antes de cambiar nada.

SIGUE ESTO AL PIE DE LA LETRA. Empieza por el PASO 0.

## PASO 0 — Revisión (no cambies nada)
1. Confirma que estás en la carpeta del bot (`package.json` + `wrangler.toml`). Si no, detente.
2. `git status` (avisa si hay cambios sin guardar). Mira `member/config.local.ts` (giro `BOT_NICHE`, `botName`, `tier`) para adaptar qué campos SÍ le tocan a este giro.
3. Lee el estado real del bot desde D1 (una sola consulta):
```
wrangler d1 execute DB --remote --json --command "SELECT key, value FROM settings WHERE key IN ('system_prompt_override','custom_instructions','business_context','faqs','business_hours','promo','location','payment_methods','catalog','tone','bot_name','galeria_enabled');"
```

## PASO 1 — Está vivo y conectado (lo básico del pairing)
- **Desplegado y respondiendo:** corre `npx forjabot doctor` (o revisa `https://<worker>/api/health`). Si no responde, ese es el rojo #1 — guíalo a desplegar (`npx forjabot update` / `wrangler deploy`).
- **Al menos un canal conectado** (WhatsApp/Instagram/Messenger/Telegram). Si no hay ninguno, el bot no puede recibir nada — mándalo a conectar uno (guías en `skill/references/channel-setup-guides/`).
- **Pareado con la app** (aparece en su panel `app.forjabots.com`): si quiere operarlo desde el teléfono, `npx forjabot login` + `npx forjabot pair`.

## PASO 2 — Tiene cerebro, y bien estructurado
- **Hay prompt:** debe existir `custom_instructions` (o un `system_prompt_override`). Si NO hay ninguno, el bot corre genérico — ofrécele configurarlo con `/prompt`.
- **OJO override (modo experto):** si existe `system_prompt_override` no vacío, AVÍSALE claro: *"Tu bot está en modo experto — un prompt manual que reemplaza todo; los campos de la app (Info del negocio, Preguntas frecuentes, promo…) NO le aplican hasta migrarlo."* Ofrece **`/migrar-prompt`** para estructurarlo. Este es el hallazgo más importante que puede tener un bot "instalado pero no editable".

## PASO 3 — Está bien configurado (lo que hace la diferencia)
Revisa cada campo y clasifícalo verde/amarillo/rojo. Marca **rojo** lo que su giro normalmente SÍ necesita y está vacío:
- **Info del negocio** (`business_context`): ¿tiene datos reales del negocio, o está vacío/genérico?
- **Preguntas frecuentes** (`faqs`): ¿tiene al menos 3-5? Es lo que más preguntan sus clientes.
- **Disponibilidad** (`business_hours`): ¿horario / si agenda citas / zona horaria? (rojo si el giro agenda y está vacío).
- **Ubicación** (`location`): dirección / local vs domicilio vs online / zonas (rojo si es negocio físico y está vacío).
- **Formas de pago** (`payment_methods`): (rojo si cobra y está vacío).
- **Servicios y precios** (`catalog`): (amarillo si aplica y está vacío).
- **Oferta** (`promo`): opcional (verde si no hay; solo nudge).
- **Voz/tono** (`tone`, `bot_name`): que suene a su negocio.

## PASO 3.5 — Gasto de IA bien medido (para la app)
El bot lleva una **libreta** (`ia_usage`) que anota cada gasto de IA etiquetado por función —conversaciones, follow-ups, insights, copilot, reportes— y es lo que la app muestra **desglosado** (y por cliente en Modo Agencia). Es automática (se crea sola); solo verifica dos cosas:
- **Versión con libreta:** abre `https://<worker>/api/cost`. Si la respuesta trae `breakdown`, ya mide por función → 🟢. Si NO lo trae (bot viejo), ofrécele `npx forjabot update` para activarlo → 🟡.
- **Auditor (opcional, recomendado si va a cobrar por el bot):** para cuadrar el gasto de la libreta contra la **factura real** de Cloudflare, rutea la IA por el **AI Gateway** (en `wrangler.toml` descomenta `ANTHROPIC_BASE_URL = ".../anthropic/v1"`). La libreta funciona **sin** esto —el gateway solo AUDITA, y de paso evita el 403 del edge de Anthropic. Sin gateway → 🟡 (nudge, no rojo).

## PASO 4 — Entrega la BOLETA (semáforo, en lenguaje de negocio)
Preséntale una boleta corta y clara — cada punto en una línea, con 🟢/🟡/🔴 y qué significa para SUS clientes (no tecnicismos). Ejemplo:
- 🟢 Tu bot está en línea y conectado a WhatsApp.
- 🟢 Tiene su cerebro puesto y bien ordenado (editable desde la app).
- 🔴 No tienes Preguntas frecuentes — tus clientes preguntan lo mismo todo el día; llenémoslas.
- 🔴 Falta tu horario — el bot no sabe cuándo estás abierto.
- 🟡 No pusiste formas de pago.
- 🟢 Tu gasto de IA se mide por función (lo ves desglosado en la app).
Cierra con **1 frase de veredicto**: "Listo para atender" / "Casi — te faltan 2 cosas" / "Hay que arreglar X antes de conectarlo".

## PASO 5 — Arregla / pregunta los huecos (con su OK)
Para cada 🔴/🟡, ofrécele arreglarlo AHÍ mismo, uno a la vez, en lenguaje simple y SIN inventar:
- FAQs vacías → "¿Qué es lo que más te preguntan tus clientes?" y arma la lista → guarda en `faqs`.
- Horario → "¿En qué horario atiendes? ¿Aceptas citas o eres 24/7?" → `business_hours`.
- Ubicación / pago / servicios → pregúntale y llena su campo.
- Override → deriva a `/migrar-prompt`.
Escribe cada cambio con el patrón `.sql` de `/prompt` (comillas `'`→`''`), en vivo, sin redeploy, confirmando antes de cada guardado. Lo que no sepa o no aplique a su giro, déjalo y sigue. Al final, vuelve a correr la boleta para que vea el antes/después.

## Lo que NUNCA haces
- No inventas datos del negocio: si falta un dato, se lo PREGUNTAS.
- No cambias nada sin su confirmación.
- No tocas los frenos, las tools, el giro ni `src/`.
- No marcas "listo" un bot que no responde o no tiene ningún canal — eso es rojo, siempre.
