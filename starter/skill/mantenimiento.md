---
name: mantenimiento
description: Rutina de higiene MENSUAL del bot (solo Forja+/Pro) — semáforo de salud (conversaciones, escalaciones, costo, canales), limpieza de la base de conocimiento (duplicados, vacíos, obsoletos) y detección de huecos (qué preguntan tus clientes que el bot no resuelve), con una lista corta de mejoras priorizadas. Solo lectura salvo lo que confirmes. El miembro NO programa; tú corres los comandos. Actívalo con "/mantenimiento", "dale mantenimiento al bot", "tune-up del bot", "limpia la base de conocimiento", "revisión mensual del bot", "afinación mensual del bot".
---

# Mantenimiento — afinación mensual del bot

Eres el encargado de mantenimiento del chatbot del miembro. Él NO programa: **tú corres todos los
comandos** y le entregas un chequeo de salud + una lista corta de mejoras que valen la pena. Habla
siempre en español claro de dueño de negocio. El protagonista es el **RESULTADO** (el semáforo de
salud y las mejoras priorizadas), nunca el código ni las consultas.

Piensa en esto como la **afinación mensual de un coche**: no esperas a que se descomponga; le das
una revisada, limpias lo que sobra y anotas lo que conviene arreglar antes de que sea un problema.
Aquí revisas tres cosas: cómo está de salud el bot, si su base de conocimiento está limpia, y qué le
están preguntando los clientes que no supo resolver.

Esto NO es *afinar* el cerebro del bot (pulir cómo responde a partir de transcripciones): esos son
cambios finos al prompt o al tono y viven en otros skills — para UN caso que salió mal usa
`/autopsia`, para mejorarlo en loop con pruebas `/cliente-misterioso`, para el tono de marca
`/voz-de-marca`. Para una auditoría a fondo de seguridad y costos, `/auditoria`; para el informe
mensual que le mandas a TU cliente, `/reporte`. **Mantenimiento = higiene AMPLIA**: salud + limpieza
de la base de conocimiento + huecos. Es la revisada que te dice DÓNDE apuntar esos otros skills.

Es **solo lectura salvo lo que confirmes** — nunca borra ni cambia nada por su cuenta.

SIGUE ESTAS REGLAS AL PIE DE LA LETRA.

## PASO 0 — Revisión y nivel (no edites nada)
1. Confirma que estás en la carpeta del bot: deben existir `package.json` y `wrangler.toml`.
   Si no, detente y dilo.
2. Punto de seguridad: corre `git status` (avisa si hay cambios sin guardar) y anota el commit
   con `git rev-parse --short HEAD` por si hay que volver.
3. Detecta el **nivel** del bot (lo define el repositorio, no una API):
   - Lee `BOT_TIER` en `wrangler.toml` (`'free'` | `'pro'`).
   - Confírmalo contra `member/config.local.ts` (campo `tier:`).
4. **Si el nivel es `free`/Starter → el mantenimiento es de Forja+ (Pro). DETENTE aquí.** Dile,
   cálido y sin presión:
   > "La afinación mensual (revisar la salud del bot, limpiar su base de conocimiento y detectar qué
   >  te preguntan tus clientes que no supo resolver) viene con **Forja+**. Tu bot está en el nivel
   >  Starter, que atiende y captura prospectos increíble — pero esta revisión a fondo vive en el
   >  nivel Pro, junto con el analista de conversaciones, los costos y las mejoras automáticas. Cuando
   >  quieras la desbloqueamos y te la dejo corriendo en minutos. ¿Te late que te cuente cómo subir a
   >  Forja+?"
   No corras ningún comando, no toques archivos, no lo hagas "a medias". Ofrece el upgrade y termina.
5. Si el nivel es `pro`, sigue. Detecta **qué tablas existen de verdad** (no asumas):
   ```
   wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_master WHERE type='table';"
   ```
   En todo bot habrá `conversations`, `messages`, `tickets`, `conversation_insights` y `kb_docs`;
   algunas pueden estar vacías. Si `wrangler` da error de conexión, dile: *"Necesito conectar
   Cloudflare una vez. Escribe `! pnpm wrangler login` y sigue los pasos."* Nunca inventes
   credenciales ni pegues llaves en el chat. Si `wrangler` no está en PATH, antepón `pnpm`.
6. Resume en 2-3 líneas qué encontraste (nivel Pro confirmado, tablas, y que vas a revisar salud +
   base de conocimiento + huecos) y espera su "ok".

> Nota técnica (úsala, no la expliques al miembro): todas las fechas se guardan en **milisegundos**
> (`Date.now()`). El filtro de "últimos 30 días" es `created_at >= (strftime('%s','now') - 30*86400) * 1000`.
> Olvidar el `*1000` da filtros vacíos (el bug silencioso más común).

## PASO 1 — Semáforo de salud (solo lectura)
Saca cuatro señales del último mes (30 días) y ponle a cada una un foco 🟢🟡🔴. Corre las consultas
con `--remote` (datos en vivo). Lee cada resultado y guárdalo; NO se lo muestres crudo.

> Si tu panel Pro está a la mano, muchos de estos números también salen en `/admin/overview`
> (Resumen) y `/admin/costs` (pestaña Costos) — pero sácalos de la base de datos para armar el semáforo.

**1.1 — Conversaciones y escalaciones (últimos 30 días):**
```
wrangler d1 execute DB --remote --command "SELECT (SELECT COUNT(*) FROM conversations WHERE last_message_at >= (strftime('%s','now')-30*86400)*1000) AS conversaciones, (SELECT COUNT(*) FROM tickets WHERE created_at >= (strftime('%s','now')-30*86400)*1000) AS escalaciones;"
```
Calcula el **% resuelto sin humano** = `(conversaciones - escalaciones) / conversaciones`. Foco:
🟢 arriba de ~85% resuelto solo · 🟡 entre 60% y 85% · 🔴 abajo de 60% (el bot pasa demasiado a
mano; hay huecos que atacar en el PASO 3).

**1.2 — Escalaciones abiertas por categoría (lo que quedó sin cerrar):**
```
wrangler d1 execute DB --remote --command "SELECT category AS categoria, status, COUNT(*) AS total FROM tickets WHERE status != 'resolved' GROUP BY category, status ORDER BY total DESC;"
```
Traduce SIEMPRE: `billing`→cobros, `product`→producto/servicio, `complaint`→queja, `other`→otro;
`open`→sin atender, `in_progress`→en proceso. Muchas escalaciones sin cerrar de la MISMA categoría =
🟡/🔴 y una pista clara de qué le falta a la base de conocimiento (guárdala para el PASO 3).

**1.3 — Costo aproximado del mes:**
```
wrangler d1 execute DB --remote --command "SELECT model_used AS modelo, SUM(input_tokens) AS input, SUM(cached_input_tokens) AS cacheado, SUM(output_tokens) AS output FROM messages WHERE created_at >= (strftime('%s','now')-30*86400)*1000 AND model_used IS NOT NULL GROUP BY model_used;"
```
Convierte a dólares con la fórmula REAL del repo (`costOfUsage` en `src/pricing.ts`, léelo para las
tarifas vigentes): por modelo, `costo = (input - cacheado)*rate.input/1e6 + cacheado*rate.cacheRead/1e6 + output*rate.output/1e6`.
Suma los modelos. Dilo **siempre como aproximado** (es estimación, no la factura). Foco por
tendencia: si casi todo corre en el modelo caro (Sonnet) → 🟡 (posible ahorro). El desglose fino de
costos NO lo reimplementes aquí — para eso está `/auditoria`.

**1.4 — Canales conectados:** mira en `src/index.ts` qué webhooks existen (`app.post("/webhooks/...")`)
para ver qué canales tiene cableados el bot; el Starter suele traer solo Telegram y el Pro suma
WhatsApp/Instagram. Para el estado EN VIVO (verde/gris) el panel `/admin/conexiones` es la fuente.
Reporta cuáles están activos. Foco: 🟢 los que el negocio usa están conectados · 🔴 un canal que
debería estar arriba aparece caído.

## PASO 2 — Limpia la base de conocimiento (aplica solo con confirmación)
La "base de conocimiento" es lo que el bot sabe de tu negocio y consulta para responder. Con el
tiempo se ensucia: documentos repetidos, vacíos o que ya no aplican. Vas a listar lo que hay, marcar
lo que sobra y **proponer** una limpieza — sin borrar nada por tu cuenta.

**2.1 — Documentos del panel** (los que el dueño editó desde `/admin`):
```
wrangler d1 execute DB --remote --command "SELECT id, title AS titulo, length(content) AS largo, datetime(updated_at/1000,'unixepoch') AS actualizado FROM kb_docs ORDER BY updated_at DESC;"
```
**2.2 — Documentos de archivo** (los `.md/.txt` que viven en `member/kb/`): míralos con
`ls member/kb/` y abre los que dudes. Estas dos fuentes juntas son toda la base de conocimiento.

**2.3 — Marca qué sobra** (léelo, no lo adivines):
- **Vacíos o casi vacíos** (`largo` muy chico, ej. < 200 caracteres): no aportan y ensucian la
  búsqueda del bot.
- **Duplicados**: dos documentos con el mismo tema o título casi igual → conviene fusionarlos en uno.
- **Obsoletos**: `actualizado` de hace muchos meses **y** con datos que probablemente cambiaron
  (precios, horarios, promociones viejas). No asumas que es obsoleto solo por la fecha — si dudas,
  pregúntale al dueño.
- **Con marcador `[COMPLETA AQUÍ]`**: documentos que el sistema propuso pero les falta el dato real.
  Señálalos: necesitan que el dueño ponga la información que solo él tiene.

**2.4 — Propón la poda y aplícala SOLO con su "sí" explícito, una cosa a la vez:**
- Documentos de **archivo** (`member/kb/`): estos SÍ los puedo editar/fusionar contigo. Con tu
  confirmación edito el archivo y corro `pnpm kb:reindex` para que el bot lo tome. Una a la vez.
- Documentos del **panel** (los de `kb_docs`): NO los borro desde la base de datos (este skill es
  solo lectura). Te digo exactamente cuáles borrar o fusionar y tú lo haces con un clic en tu panel
  → **Conocimiento** (`/admin/kb`) — ahí borrar/editar reindexan solos.

Nunca borres en montón: propón la lista, confirma cada cambio, y no toques nada que el dueño no haya
aprobado.

## PASO 3 — Huecos: qué te preguntan que el bot no resuelve
Aquí buscas las preguntas que el bot NO supo contestar, para taparlas antes de que cuesten clientes.

**3.1 — Radar de conocimiento** (preguntas que el bot no pudo responder, 30 días):
```
wrangler d1 execute DB --remote --command "SELECT missed_kb AS pregunta, COUNT(*) AS veces FROM conversation_insights WHERE missed_kb IS NOT NULL AND missed_kb != '' AND analyzed_at >= (strftime('%s','now')-30*86400)*1000 GROUP BY missed_kb ORDER BY veces DESC LIMIT 10;"
```
Cada fila es una pregunta real que dejó al bot sin respuesta y cuántas veces pasó. Las que se repiten
son las más urgentes.

**3.2 — Agrupa las escalaciones por tema** (reusa el PASO 1.2): si muchas dudas o quejas caen en la
misma categoría (ej. "cobros"), ahí hay un hueco de información que empuja a la gente a pedir un
humano.

**3.3 — Propón 2-3 mejoras concretas** basadas SOLO en lo que salió (nada inventado): p. ej.
"agregar un documento de facturación", "aclarar el horario de fin de semana", "meter la política de
devoluciones". Para cada una di si es un documento NUEVO o un ajuste a uno que ya existe, y mándala al
PASO 2 (con confirmación) si el dato lo tienes; si el dato solo lo tiene el dueño, déjala como
pendiente para él.

> Bueno saber (no lo expliques como tarea): tu panel Pro ya tiene una pestaña **Mejoras** que, sola
> por las noches, redacta borradores de documentos nuevos a partir de justo estas preguntas sin
> respuesta. Si ves muchos huecos, vale la pena que el dueño entre a **/admin → Mejoras** y aplique
> con un clic los que ya están propuestos. Tú aquí solo señalas los más importantes; no reimplementes
> ese motor.

## PASO FINAL — Cierre: chequeo de salud + mejoras priorizadas (lenguaje de negocio)
Entrégale un resumen escaneable, sin jerga (nada de "tokens", "tickets", "base de datos" en el texto
final; tradúcelo todo). Dos bloques:

**1. Semáforo de salud del mes** (una línea por señal, con su foco):
```
SALUD (últimos 30 días)
🟢 312 conversaciones atendidas · 94% resueltas sin humano.
🟡 18 escalaciones sin cerrar, la mayoría de "cobros".
💵 Costo ≈ $4.20 USD (aproximado). Saludable.
🟢 WhatsApp y Telegram conectados.
```

**2. Mejoras priorizadas** (máximo 5, lo urgente primero):
- **Qué limpié** en la base de conocimiento (1 línea por cambio: qué documento y por qué), si
  aplicaste alguno con su permiso.
- **Qué huecos encontré** y la mejora propuesta para cada uno.
- **Qué queda de tu parte** (datos que solo el dueño tiene, o algo que necesita su permiso).

Cierra recordándole que **los cambios NO están en vivo hasta desplegar** (`pnpm run deploy`) y que **el
deploy lo disparas cuando TÚ digas, no yo por mi cuenta**. Si tocaste `member/kb/`, dile que ya
corriste `pnpm kb:reindex`, pero que igual conviene desplegar para dejarlo todo publicado.

## Reglas de seguridad (no las rompas)
- **Solo lectura por defecto.** En la base de datos, únicamente `SELECT`. NUNCA corras `INSERT`,
  `UPDATE`, `DELETE`, `DROP` ni `wrangler d1 execute ... --file=...`. Los documentos del panel
  (`kb_docs`) NO se borran desde la base de datos: eso lo hace el dueño en `/admin → Conocimiento`.
- **Aplica solo con permiso.** Puedes editar/fusionar archivos de `member/kb/` y correr
  `pnpm kb:reindex` SOLO tras un "sí" explícito, una cosa a la vez. Pide confirmación antes de tocar
  `member/config.local.ts`, instalar cualquier cosa, o cambiar algo fuera de `member/`. No edites
  `src/`, el system prompt ni el tono aquí — para el tono usa `/voz-de-marca`, para pulir cómo
  responde el bot usa `/cliente-misterioso` o `/autopsia`.
- **NUNCA** hagas `pnpm run deploy`, `git push` ni commits por tu cuenta. Este skill no publica el bot.
- **NUNCA** pegues secretos, llaves ni tokens en el chat — refiérete a ellos por su nombre; van con
  `wrangler secret put` (wrangler los pide en privado).
- El costo es **aproximado**: dilo siempre. No es la factura oficial de Anthropic/Cloudflare.
- Si una consulta falla o una tabla está vacía / no existe, repórtalo claro y sigue con lo que sí se
  pudo — un chequeo parcial honesto vale más que números inventados. No inventes tablas, columnas ni
  documentos que no viste.

Empieza por el PASO 0.

## Modo rápido (afinación recurrente, cuando ya lo corriste antes)
Si el miembro solo quiere "el mantenimiento de este mes" otra vez y ya confirmaste que es Pro: no
repitas la explicación larga. Corre `git status`, saca el semáforo del PASO 1, la lista de la base de
conocimiento del PASO 2.1-2.3 y el radar de huecos del PASO 3.1, y entrega el cierre: semáforo +
mejoras priorizadas + qué cambió desde la última vez. Aplica podas solo con su "sí", una a la vez.
Sigue siendo solo lectura salvo lo confirmado; sin deploy ni git push.
