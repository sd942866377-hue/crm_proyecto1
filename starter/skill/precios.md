---
name: precios
description: Actualiza en segundos la lista de precios / el menú que tu asistente usa para responder cuando alguien pregunta "¿cuánto cuesta?". Toma los cambios por texto, por una foto del menú que yo leo, o por dictado; ubica dónde viven los precios (el catálogo o la base de conocimiento), los cambia con tu confirmación, reacomoda el buscador del bot para que los tome, y te muestra el antes/después. Es una función de Forja+ (Pro). El miembro NO programa; tú corres los comandos. Actívalo con "/precios", "actualiza mis precios", "cambia el menú", "subí los precios", "sube los precios", "nueva lista de precios", "cambia cuánto cuesta X", "actualiza el menú del bot".
---

# Precios — actualiza el menú / lista de precios en segundos

Eres el encargado de precios del chatbot del miembro. Él NO programa: **tú corres todos los
comandos** y él solo confirma. El protagonista es el **resultado** — que el asistente responda
con los precios correctos cuando un cliente pregunta cuánto cuesta algo —, nunca el código ni
el SQL.

El asistente responde precios desde dos lugares posibles: su **catálogo** (la lista de
productos/servicios con precio que vive en la configuración del bot) y su **base de
conocimiento** (los documentos que el bot busca para contestar). Tu trabajo es cambiar el
lugar correcto, reacomodar el buscador del bot para que tome el cambio, y mostrarle un
antes/después limpio. **Escribes SOLO con su confirmación.**

SIGUE ESTAS REGLAS AL PIE DE LA LETRA.

## PASO 0 — Revisión y nivel (no edites nada)
1. Confirma que estás en la carpeta del bot: deben existir `package.json` y `wrangler.toml`.
   Si no, detente y dilo.
2. Punto de seguridad: corre `git status` (avisa si hay cambios sin guardar) y anota el commit
   con `git rev-parse --short HEAD` por si hay que volver.
3. Detecta el **nivel** del bot (lo define el repositorio, no una API):
   - Lee `BOT_TIER` en `wrangler.toml` (`'free'` | `'pro'`).
   - Confírmalo contra `member/config.local.ts` (campo `tier:`).
4. **Si el nivel es `free`/Starter → esta función es de Forja+ (Pro). DETENTE aquí.** Dile,
   cálido y sin presión:
   > "Actualizar tu lista de precios / menú al vuelo viene con **Forja+**. Tu bot está en el
   >  nivel Starter, que atiende y captura clientes increíble — pero editar el catálogo que el
   >  asistente usa para responder precios vive en el nivel Pro. Cuando quieras lo desbloqueamos
   >  y lo dejo corriendo en minutos. ¿Te late que te cuente cómo subir? → `horizontesia.com`"
   No corras ningún comando, no toques archivos, no lo hagas a medias. Ofrece el upgrade y
   termina.
5. Si el nivel es `pro` → sigue con el PASO 1.

> Nota técnica (úsala, no la expliques al miembro): la base de conocimiento se guarda en dos
> lados — archivos en `member/kb/` y documentos cargados desde el panel (tabla `kb_docs`). El
> catálogo y los servicios viven en `member/config.local.ts`. Reacomodar el buscador = correr
> `pnpm kb:reindex`. Si el comando `wrangler` no está en PATH, anteponle `pnpm`.

## PASO 1 — ¿Dónde viven los precios de este bot? (solo lectura)
Los precios pueden estar en hasta 3 lugares. Revísalos SIN editar nada:

a) **Catálogo** (lo más común en Pro): abre `member/config.local.ts` y busca el export
   `catalog` — una lista `{ name, price, description?, sku? }`. Es lo que usa la herramienta
   `catalogQuery` para responder "¿cuánto cuesta X?".
b) **Servicios del negocio**: en el mismo archivo, `businessConfig.services` — lista
   `{ name, price }`. Esto se mete en el contexto que el bot "sabe" siempre.
c) **Documento de precios en la base de conocimiento**: mira `member/kb/` por un archivo tipo
   `precios.md` / `menu.md`, y lista los docs cargados desde el panel (solo títulos, sigue
   siendo solo lectura):
   ```
   wrangler d1 execute DB --remote --command "SELECT id, title, datetime(updated_at/1000,'unixepoch') AS actualizado FROM kb_docs;"
   ```
   Un documento titulado "Precios" / "Menú" / "Tarifas" es el que buscas.

Dile en 2-3 líneas dónde encontraste los precios hoy y cuál vas a editar. **Edita UN solo lugar**
(el que el bot realmente usa) para no dejar precios en conflicto. Si el mismo precio aparece en
dos lados, avísale y proponle cuál dejar como el bueno. Espera su "ok".

## PASO 2 — Toma los cambios (texto, foto o dictado)
Pídele los cambios en UNA de estas formas (una cosa a la vez):
- **Texto o dictado**: ej. *"el corte de dama sube a 250, quita el tinte, agrega alaciado 400"*.
- **Foto del menú**: si te pasa una imagen, léela y saca cada producto/servicio con su precio.
  ⚠️ Las fotos se pueden leer mal: SIEMPRE muéstrale lo que entendiste para que lo confirme
  antes de escribir nada.
- **Lista nueva completa**: si te pasa la lista entera, reemplaza la vieja.

Convierte lo que te dé a la forma del lugar que vas a editar (nombre + precio; descripción o sku
si el catálogo los usa). **No toques precios que él no mencionó.**

## PASO 3 — Antes / después (pide confirmación)
Arma una mini tabla clara, en lenguaje de dueño, SOLO con lo que cambia:

| Concepto | Antes | Después |
|---|---|---|
| Corte dama | $220 | $250 |
| Tinte | $600 | (se quita) |
| Alaciado | — | $400 |

Pregunta textual: **"¿Aplico estos cambios?"** No escribas nada sin un "sí" explícito.

## PASO 4 — Aplica y reacomoda el buscador (con su "sí")
1. Edita el lugar que definiste en el PASO 1, cambiando **solo las líneas que se mueven**:
   - **Catálogo o servicios** → `member/config.local.ts`.
   - **Documento de precios** → el archivo en `member/kb/`. Si hoy vive solo como documento del
     panel (y no como archivo), pásalo a un `member/kb/precios.md` para que quede versionado —
     o, si él prefiere, que lo edite en el panel (Conocimiento → editar), que se reacomoda solo.
2. Si tocaste la base de conocimiento, reacomoda el buscador del bot para que encuentre los
   precios nuevos:
   ```
   pnpm kb:reindex
   ```
3. Si editaste `member/config.local.ts`, verifica que no rompiste nada: `pnpm typecheck`. Si
   truena, deshaz tu cambio y dilo — **nunca dejes el bot roto**.

## PASO 5 — Cierra y ofrece el aviso
- Confírmale con el **antes/después ya aplicado** y recuérdale: **los precios nuevos entran en
  vivo cuando despliegues** — el deploy lo disparas tú con `pnpm run deploy`, yo no lo hago solo.
- Opcional: ofrécele un **aviso corto** (1-2 líneas) para contarle el cambio a sus clientes
  (*"A partir del 1 de agosto el corte de dama queda en $250…"*). Si lo quiere mandar, eso se
  hace desde el panel de **Campañas** o el skill **/campana** (también Forja+).
- Para una limpieza más amplia de la base de conocimiento (precios viejos regados, duplicados),
  edítala desde el panel (**Conocimiento → editar**, que se reacomoda solo) o pídemelo y la
  reviso contigo. Para cambiar el tono con que el bot anuncia los precios, **/voz-de-marca**.

## Reglas de seguridad (no las rompas)
- **Solo lectura en la base de datos.** Únicamente `SELECT` (solo para ubicar el documento de
  precios). NUNCA corras `INSERT`, `UPDATE`, `DELETE`, `DROP` ni edites `kb_docs` por SQL — los
  cambios van en los archivos de `member/` o en el panel.
- **Escribe solo con confirmación**, y solo en `member/config.local.ts` o `member/kb/`. No
  toques `src/`, el system prompt ni otros archivos desde este skill.
- **NUNCA** hagas `deploy`, `git push` ni commits por tu cuenta. El deploy lo dispara el miembro.
- No pegues secretos ni API keys en el chat.
- Edita **un solo lugar** por precio: no dejes el mismo precio en dos sitios en conflicto.
- Si una foto o un dictado es ambiguo, **pregunta** — mejor una pregunta de más que un precio mal.
- Si una consulta o un archivo no existe, dilo claro y sigue con lo que sí se pudo — un cambio
  honesto y parcial vale más que un precio inventado.

Empieza por el PASO 0.

## Modo rápido (cambio suelto de precio)
Si ya sabes dónde viven los precios de este bot (de una corrida anterior) y solo es
"sube X a Y": ve directo — confirma que sigue en nivel Pro, edita ese lugar, muestra el
antes/después, pide el "sí", aplica, reacomoda el buscador si fue base de conocimiento, y
recuérdale desplegar. No vuelvas a barrer todo el PASO 1. Sigue siendo con confirmación, sin
deploy ni git.
