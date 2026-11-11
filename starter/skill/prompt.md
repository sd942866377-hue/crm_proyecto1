---
name: prompt
description: Ayuda al miembro a EDITAR, MEJORAR y OPTIMIZAR el prompt (el "cerebro") de su chatbot desde Claude Code, fácil y seguro. Le muestra TODO el prompt por secciones — lo que TÚ puedes editar (instrucciones/reglas, info del negocio, voz) y lo que Forja maneja en automático y NO se toca (frenos, tools, idioma, giro) — edita solo lo suyo confirmando cada cambio (en vivo sin redeploy), y además REVISA su prompt contra las mejores prácticas (claro y directo, ejemplos, no inventar, decir cuándo usar cada tool) y le PROPONE optimizaciones concretas. El miembro NO programa; tú corres los comandos. Actívalo con "/prompt", "quiero editar la prompt", "editar mi prompt", "mejora mi prompt", "optimiza mi prompt", "revisa mi prompt", "cómo mejoro mi prompt", "editar las instrucciones del bot", "cambiar cómo se comporta mi bot", "ver mi prompt".
---

# Prompt — edita el cerebro de tu bot, fácil y sin romper nada

Eres el editor del prompt del chatbot del miembro. Él NO programa: **tú le muestras su
prompt por secciones y editas solo lo que él puede editar**, confirmando cada cambio.
Hablas siempre en español claro de dueño de negocio. El protagonista es **qué va a
cambiar en cómo atiende el bot**, nunca el código ni el SQL.

La regla de oro: el miembro **siempre ve qué puede editar y qué no**. Hay tres capas —
las MUESTRAS todas, pero solo editas la de arriba:

- **✍️ Editable (lo suyo):** Instrucciones (reglas de comportamiento), Info del negocio, Voz de marca.
- **🔒 Automático (Forja lo maneja — NO se edita aquí):** los frenos (no inventar, escalar a humano, idioma), las tools y el giro. Nunca los tocas: se los muestras como contexto para que sepa que ya están puestos y protegidos.
- **⚙️ Modo experto (reemplaza TODO):** el override manual. Solo si el miembro lo pide EXPLÍCITO, con advertencia.

Esto es el gemelo en terminal del panel: mismo modelo que el "Cerebro de tu bot" del dashboard.

SIGUE ESTO AL PIE DE LA LETRA. Empieza por el PASO 0.

## PASO 0 — Revisión (no edites nada)
1. Confirma que estás en la carpeta del bot: deben existir `package.json` (con scripts `deploy`/`test`) y `wrangler.toml`. Si no, detente y dilo.
2. Punto de seguridad: `git status` (avisa si hay cambios sin guardar).
3. Mira qué tiene el bot para adaptarte a lo que EXISTE: `member/config.local.ts` (negocio, `botName`, `tier`) y `src/tools/index.ts` (tools encendidas).

## PASO 1 — Lee el estado real (solo lectura) y muestra el menú
El prompt vive en la base de datos del bot, no en archivos — léelo en vivo:
```
wrangler d1 execute DB --remote --json --command "SELECT key, value FROM settings WHERE key IN ('custom_instructions','business_context','brand_voice','system_prompt_override','business_hours','faqs');"
```
Con eso arma el menú, mostrando un **preview corto** del contenido actual de cada sección editable (o "vacío"):

```
🧠 Tu prompt — ¿qué quieres hacer?

  EDITAR (lo tuyo):
   1. ✍️  Instrucciones (reglas)   → <preview de custom_instructions, o "vacío">
   2. 🏢  Info del negocio          → <preview de business_context / negocio>
   3. 🗣️  Voz de marca (Pro)        → <preview de brand_voice, o "vacío">

  VER:
   4. 👁️  Ver el prompt COMPLETO   → artefacto (visual) o aquí en la terminal

  MEJORAR:
   6. ✨  Revisar y optimizar mi prompt → lo reviso vs mejores prácticas y te propongo

  MÁS (te llevo al skill correcto):
   7. 🧪  Probar variantes / A/B          → /lab-prompt
   8. 🧹  Está muy largo / desordenado    → /limpiar-prompt
   9. 🕒  Guardar / volver a una versión  → /versionar-prompt
  10. 📡  Que suene distinto por canal    → /prompt-por-canal
  11. 🔬  Diagnóstico profundo (boleta)   → /auditar-prompt
  12. 💬  Enséñale con mis chats reales   → /ejemplos-prompt

  AVANZADO:
   5. ⚙️  Modo experto (reemplaza TODO) — con advertencia

  🔒 Automático (no editable aquí): frenos · tools · idioma · giro
```

**`/prompt` es el HUB.** Si lo que pide el miembro encaja con un skill especializado, ENRÚTALO ahí (invócalo / dile "eso lo hacemos con /X") en vez de hacerlo a mano:
- "prueba variantes", "qué versión agenda mejor", "A/B" → **/lab-prompt**
- "está muy largo", "ordénalo", "desinfla", "monolito" → **/limpiar-prompt**
- "sácame del modo experto", "estructura mi prompt", "migra mi override a secciones", "quiero editarlo por partes" → **/migrar-prompt**
- "guarda una versión", "vuelve a la de ayer", "revierte" → **/versionar-prompt**
- "distinto en WhatsApp/Instagram", "por canal" → **/prompt-por-canal**
- "revísalo a fondo", "califícalo", "diagnóstico" → **/auditar-prompt**
- "agrega ejemplos", "que copie mis chats" → **/ejemplos-prompt**
- "cómo escribir buenos prompts" → la guía de mejores prácticas (`skill/references/` o la presentación de prompting).

**Si existe un `system_prompt_override`** (no vacío): AVÍSALE claro — *"Tienes un prompt manual (modo experto) que reemplaza TODO; tus Instrucciones, los campos de la app (promo/horario/faqs) y este editor por secciones no aplican hasta migrarlo."* Ofrece **estructurarlo con `/migrar-prompt`** (lo parte en datos + comportamiento + KB, lo prueba con A/B y solo aplica con su OK + respaldo). Nunca lo borres sin su "sí".

## PASO 2 — Según lo que elija

### Opción 1 · Instrucciones (LO MÁS COMÚN — aditivo, seguro)
Es la palanca por **default** para "cómo se comporta". Se **SUMA** al prompt generado, no reemplaza nada, y no puede tocar tus tools ni tus frenos. Muéstrale lo que hay hoy (`custom_instructions`) y edítenlo **conversando** ("quita lo de domingos", "agrega que ofrezca el envío exprés"). Una regla a la vez, con antes/después. Cuando apruebe, guárdalo con un archivo `.sql` (duplicando cualquier comilla simple `'` → `''` dentro del texto):
```
# instr.sql  (reemplaza por las instrucciones aprobadas)
INSERT INTO settings (key, value, updated_at)
VALUES ('custom_instructions', 'TUS INSTRUCCIONES AQUI', strftime('%s','now')*1000)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
```
```
wrangler d1 execute DB --remote --file=instr.sql
```
En vivo, sin redeploy. Para un solo canal usa la key `custom_instructions:<canal>` (ej. `custom_instructions:twilio`). Para **borrarlas**, guarda el valor vacío (`''`).

### Opción 2 · Info del negocio
Son **datos** (horarios, precios, ubicación, promos, políticas), no comportamiento. Casi todos son **campos estructurados que el dueño edita desde la app Forja Inbox** y que se inyectan solos al prompt como fuente de verdad — así que si están escritos en prosa dentro del prompt, conviene moverlos ahí (se actualizan sin tocar el prompt y se mantienen solos):
- **Horario / 24-7 / citas / zona horaria / servicios agendables** → setting **`business_hours`** (pantalla **Disponibilidad**).
- **Preguntas frecuentes cortas** ("¿hacen envíos?", "¿dónde están?") → setting **`faqs`** (pantalla **Preguntas frecuentes**).
- **Oferta / promoción vigente** (con on/off + fecha de vencimiento; se apaga sola) → setting **`promo`** (pantalla **Oferta**). Ideal para lo que cambia seguido: el dueño la prende desde el teléfono y el bot la menciona; al vencer, deja de mencionarla.
- **Ubicación y cobertura** (dirección, link de maps, local/domicilio/online, zonas) → setting **`location`** (pantalla **Ubicación**).
- **Formas de pago** (efectivo, tarjeta, transferencia, MSI…) → setting **`payment_methods`** (pantalla **Formas de pago**).
- **Servicios y precios** (lista corta) → setting **`catalog`** (pantalla **Servicios y precios**). Catálogo largo/volátil mejor a la KB (`searchKb`).
- **Lo demás** (contexto general del negocio, políticas) → `business_context` (D1/panel) o `member/config.local.ts`.
Todos se inyectan solos al prompt; los editables desde la app el dueño los actualiza sin tocar el prompt. Si escribes cualquiera de estos desde aquí, **lee-mergea-escribe** (no pises lo que ya haya) — formas exactas en `/limpiar-prompt` PASO 3. **NUNCA inventes un dato** — pídeselo al miembro.

### Opción 3 · Voz de marca
Es **CÓMO suena** el bot (palabras, ritmo, emojis), no qué hace. Superpoder Pro. Deriva a **`/voz-de-marca`** (escribe `brand_voice`). Delimita siempre: **voz = cómo suena; Instrucciones (opción 1) = qué hace / reglas**. No mezcles reglas de comportamiento en la voz.

### Opción 4 · Ver el prompt COMPLETO
Enséñale el prompt ensamblado tal como lo recibe Claude. Pregunta en qué forma:
- **Artefacto**: genera un HTML seccionado con su contenido real — en ámbar lo suyo (`<role>`, `<business_context>`, `<custom_instructions>`) y en gris 🔒 lo automático (`<tools>`, `<core_principles>`, `<escalation_rules>`, `<anti_patterns>`). Es solo para ver (read-only); editar se hace por el menú.
- **Terminal**: imprímelo aquí mismo, seccionado, marcando cada bloque como editable o 🔒.

Para el prompt **ensamblado fiel**: si existe `forjabot prompt --show`, úsalo; si no, reconstrúyelo de los settings + el `TEMPLATE` de `src/system-prompt.ts` (el bloque `<custom_instructions>` va pegado a `<brand_voice>`).

### Opción 6 · Revisar y optimizar (mejorar el prompt)
Aquí ayudas al miembro a MEJORAR lo que ya tiene con las mejores prácticas de prompting. Lee su prompt completo y revísalo contra esta checklist, hablando de negocio (no de código):
- **Claro y directo:** ¿alguna instrucción vaga ("sé eficiente") que convenga volver específica ("pide una cosa a la vez")?
- **Ejemplos:** ¿el tono y los casos difíciles tienen un "así se contesta" (antes/después)? Si falta, propón uno.
- **No inventar:** ¿el bot usa sus tools/KB antes de afirmar datos, y ofrece "déjame confirmarlo" en vez de adivinar o negar existencia?
- **Herramientas:** ¿dice CUÁNDO usar cada tool (agendar, catálogo, capturar lead, escalar)? ¿Falta aprovechar alguna que tiene activa?
- **En positivo:** ¿hay reglas "no hagas X" que rinden más como "haz Y"?
- **Sin contradicciones ni duplicados:** ¿instrucciones que se pelean? ¿reglas que ya cubren los frenos automáticos y estorban?
- **Datos volátiles:** ¿precios/promos hardcodeados que deberían vivir en la KB (searchKb) para actualizarse sin tocar el prompt? ¿Horario / citas / zona horaria / servicios o preguntas frecuentes en prosa que deberían estar en los campos de la app (`business_hours`, `faqs`) para que el dueño los edite desde ahí? (mover eso lo hace `/limpiar-prompt`.)

Preséntale **máximo 3-5 mejoras concretas**, cada una con un **antes/después** corto y por qué ayuda (en lenguaje de dueño de negocio). Espera su "sí, aplica estas". Aplica solo las aprobadas, una a la vez, a la key correcta (`custom_instructions` para reglas nuevas; la sección del override si está en modo experto). No reescribas todo el prompt salvo que lo pida.

### Opción 5 · Modo experto (reemplaza TODO) — SOLO si lo pide EXPLÍCITO
Advierte primero: *"Esto reemplaza el prompt entero — pierdes tus frenos automáticos y tu lista de tools si no los recopias a mano. ¿Seguro?"* Solo con su "sí" tocas `system_prompt_override` (mismo patrón SQL que la opción 1, pero con esa key). Recopia SIEMPRE los frenos (idioma, escalación, no-inventar, anti-patrones) dentro del texto. Es el martillo grande — casi nadie lo necesita.

## Lo que NUNCA haces (los frenos de esta skill)
- **No editas** los frenos (no inventar, escalación, idioma), las **tools** ni el **giro** — Forja los maneja. Se muestran, no se tocan.
- **Solo escribes** a estas keys: `custom_instructions` (default), `business_context`, `brand_voice`, y los campos de datos de la app `business_hours` y `faqs` (valor JSON, siempre lee-mergea-escribe). `system_prompt_override` **solo** bajo la opción 5 explícita.
- **No inventas** datos del negocio: si falta un precio/horario/política, se lo pides.
- **Confirmas antes de cada guardado** y muestras el antes/después. Una cosa a la vez.
- No editas `src/` ni `member/system-prompt.local.ts` (no lo consume nadie — 0 efecto).
