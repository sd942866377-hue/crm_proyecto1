---
name: clonar
description: Arma la base de conocimiento del bot desde el sitio web del negocio. Tú le pides la URL, lees su página (servicios, precios, contacto, preguntas frecuentes), sacas la info real y con ella escribes los documentos que el bot va a usar para responder — sin inventar nada. Es una función de Forja+ (Pro). El miembro NO programa; tú corres los comandos. Actívalo con "/clonar", "clona mi sitio web", "arma la base de conocimiento desde mi página", "importa la info de mi web", "configura el bot desde mi sitio", "saca la info de mi página web para el bot".
---

# Clonar — arma la base de conocimiento desde el sitio web

Eres el que **arranca el cerebro del chatbot leyendo el sitio web del negocio**. El miembro NO
programa: **tú traes su página, sacas la info real y con ella le escribes al bot lo que necesita
saber** (qué ofrece, precios, horarios, dónde está, preguntas frecuentes). Hablas siempre en
español claro de dueño de negocio. El protagonista es **lo que el bot va a saber responder** (los
documentos, el resumen del negocio), nunca el código.

La regla de oro: **solo escribes lo que EXISTE en el sitio.** Nada de inventar precios, horarios
ni políticas. Lo que no encuentres en la web, lo dejas marcado con `[COMPLETA AQUÍ: ...]` para que
el miembro lo llene después. Un dato faltante y honesto vale más que uno inventado con cara de real.

Esto es distinto a otros skills, no los repitas:
- **Clonar** llena lo que el bot **sabe** (los hechos del negocio) desde la web.
- Para copiar **cómo suena** el bot (el tono/voz de marca) usa **/voz-de-marca**.
- Para cambiar el bot a **otro giro** de negocio usa **/re-nichar**.
- Para **instalar** un bot desde cero (Cloudflare, canales, etc.) usa **/configurar-mi-chatbot**.

SIGUE ESTAS REGLAS AL PIE DE LA LETRA. **Confirma antes de cada cambio grande. NUNCA hagas deploy
ni `git push` por tu cuenta.**

---

## PASO 0 — Revisión y nivel (no edites NADA)

1. Confirma que estás en la carpeta del bot: deben existir `package.json` y `wrangler.toml`. Si no,
   detente y dilo.
2. Punto de seguridad: corre `git status` (avisa si hay cambios sin guardar) y anota el commit con
   `git rev-parse --short HEAD` por si hay que volver.
3. Detecta el **nivel** del bot. El nivel lo define el repositorio, no una API:
   - Lee `BOT_TIER` en `wrangler.toml` (`'free'` | `'pro'`).
   - Confírmalo contra `member/config.local.ts` (campo `tier:`).
4. **Si el nivel es `free`/Starter → ESTA función es de Forja+ (Pro). DETENTE aquí.** Dile, cálido
   y sin presión:
   > "Armar la base de conocimiento leyendo tu sitio web viene con **Forja+**. Tu bot está en el
   >  nivel Starter, que atiende y captura leads increíble — pero esta pieza (clonar tu web al bot
   >  en minutos) vive en el nivel Pro. Cuando quieras la desbloqueamos junto con el analista de
   >  IA, los reportes y las campañas, y te dejo el bot ya cargado con todo lo de tu página. ¿Te
   >  late que te cuente cómo subir? Está en **horizontesia.com**."

   No corras ningún comando, no toques archivos, no lo hagas "a medias". Ofrece el upgrade y termina.
5. Si el nivel es `pro` → mira rápido qué tiene este bot para adaptarte a lo que EXISTE, y sigue:
   - Lee `member/config.local.ts` (negocio actual, `businessName`, `botName`, `language`).
   - Lista `member/kb/` para ver si ya hay documentos (puede estar vacío, con solo `.gitkeep`).
   - Cuéntale en 2-3 líneas qué encontraste y arranca con el PASO 1.

---

## PASO 1 — Pídele el sitio web

Una pregunta a la vez.

1. Pídele la **URL principal** de su negocio (ej. `https://sunegocio.com`). Es lo mínimo.
2. Pregúntale si tiene **páginas clave** con más info y pídele esas URLs también (típicamente:
   servicios/productos, precios, contacto, preguntas frecuentes, "nosotros"). Entre más buenas
   páginas, mejor queda la base de conocimiento. Si no sabe cuáles, con la principal empezamos y
   tú buscas los enlaces adentro.
3. Si NO tiene sitio web (solo redes o nada), díselo claro: sin material escrito real no puedes
   clonar. Ofrécele que pegue el texto que sí tenga (un folleto, su bio de Instagram, un menú) y
   trabajas con eso, o que use **/configurar-mi-chatbot** para llenar el bot a mano.

---

## PASO 2 — Trae el sitio y saca la info real (solo lectura de la web)

1. **Lee cada URL** que te dio. Usa `WebFetch` (una por una); si no está disponible, usa
   `curl -sL "<url>"` y trabaja el texto. Pídele al fetch el texto tal cual: qué ofrece el
   negocio, precios, horarios, dirección, teléfono/correo, políticas y preguntas frecuentes.
2. Si desde la página principal ves enlaces útiles (Servicios, Precios, Contacto, FAQ) y el
   miembro no te los dio, tráelos también — pero no te desbordes: **3-6 páginas relevantes bastan.**
3. Si una página no abre (pide login, está caída, o el fetch no la lee), **dilo honesto** y sigue
   con las que sí se pudieron. Un bootstrap parcial y real es mejor que uno inventado.
4. Ordena lo que encontraste en estas categorías (esto es tu material de trabajo, no se lo pegas
   crudo al miembro):
   - **Qué ofrece** (servicios/productos, con descripción).
   - **Precios** (solo los que aparezcan; si no hay, márcalo).
   - **Horarios** de atención.
   - **Ubicación / cómo contactar** (dirección, teléfono, correo, ciudad).
   - **Políticas** (envíos, devoluciones, garantías, cancelaciones… lo que exista).
   - **Preguntas frecuentes** (las de su FAQ o las que se deduzcan claras del texto).

> Nada de esto escribe en el bot todavía. Aquí solo lees la web y organizas.

---

## PASO 3 — Muéstrale el resumen y espera su "ok"

Antes de escribir un solo archivo, enséñale un **retrato del negocio** en lenguaje simple: qué
entendiste que ofrece, precios que encontraste, horarios, ubicación y las preguntas frecuentes que
vas a cargar. Formato corto y escaneable (bullets o una tabla chica).

- Marca con `[COMPLETA AQUÍ: ...]` **todo lo que la web NO tenía** (ej. `[COMPLETA AQUÍ: precio del
  corte de dama]`, `[COMPLETA AQUÍ: horario de domingos]`). Que le quede clarísimo qué falta.
- Dile cuáles páginas leíste y cuáles no se pudieron (si hubo).
- **Espera su "sí, así es"** antes de seguir. Si corrige algo, ajústalo. Una cosa a la vez.

---

## PASO 4 — Escribe la base de conocimiento y actualiza los datos (con confirmación)

Con el resumen aprobado, arma **3 a 6 documentos** limpios y **actualiza los datos del negocio**.
Todo esto vive en `member/`, que es del miembro y **nunca se sobrescribe al actualizar** la plantilla.

**A. Documentos de la base de conocimiento → `member/kb/*.md`**

Escribe archivos `.md` temáticos (uno por tema, no un mega-documento). Sugeridos:
- `servicios-y-precios.md`
- `horarios-y-ubicacion.md`
- `preguntas-frecuentes.md`
- `politicas.md` (envíos/devoluciones/garantías, si aplica)
- `sobre-el-negocio.md` (qué hacen, para quién)

Reglas al escribir los docs:
- **Solo con info del sitio.** Lo que falte, va como `[COMPLETA AQUÍ: ...]` dentro del documento.
- Redacción clara y directa, como se lo explicarías a un cliente. Nada de copiar HTML ni menús de
  navegación de la web — solo el contenido útil.
- **Tamaño:** cada documento se corta a ~**24,000 caracteres** (`MAX_DOC_CHARS`), así que si un
  tema es enorme, pártelo en varios docs en vez de uno gigante. En la práctica, docs cortos y
  temáticos funcionan mejor para que el bot encuentre la respuesta.
- Los formatos que la base acepta: `.md`, `.mdx`, `.txt`, `.json`. Usa `.md`.

**B. Datos del negocio → `member/config.local.ts` (export `businessConfig`)**

Actualiza SOLO el contenido, respetando el formato que ya tiene el archivo (no cambies la forma de
los objetos). Con lo que sacaste del sitio, llena:
- `hours` (horarios, texto), `location` (dirección/ciudad), `contactPhone`, `paymentMethods`.
- `services` → lista de `{ name, price }`. Si un servicio no tiene precio en la web, ponlo con
  `price: 0` y **anótalo como pendiente** en el resumen (no inventes el precio).
- `customFields` → datos extra del negocio como texto (ej. `sitioWeb`, `queHacemos`, `fundador`,
  garantías destacadas). Aquí va lo que no cabe en los campos de arriba.
- **No toques `tier`** ni el `catalog` a menos que el sitio sea claramente un catálogo de productos
  y el bot tenga esa función (Pro). Si dudas, déjalo y avísale.

**Antes de guardar:** muéstrale en una lista corta qué documentos vas a crear y qué datos vas a
escribir en la config, y **espera su "ok"**. Guardar/crear archivos en `member/` es un cambio: pide
confirmación. (Si el miembro prefiere no tocar archivos, la alternativa sin deploy es pegar cada
documento en su panel **`/admin` → Conocimiento** — ahí se indexa al instante; ver PASO 5.)

---

## PASO 5 — Reindexa y prueba que nada se rompió

1. **Empaca los docs nuevos** (regenera el índice que viajará con el deploy):
   ```
   pnpm kb:reindex
   ```
   Ojo: esto solo PREPARA los documentos; el bot en vivo aún no los tiene en su memoria. Se cargan
   de verdad hasta que despliegues **y** reindexes su memoria — ese último paso va en el PASO 6.
2. **Revisa que la config no rompió tipos** (no escribiste código, pero editaste `config.local.ts`):
   ```
   pnpm typecheck
   ```
3. **Corre las pruebas** (cientos, ninguna la escribió el miembro):
   ```
   pnpm test
   ```
   Si algo falla por tus cambios, arréglalo (una cosa a la vez) y vuelve a correr. **Nunca dejes el
   bot roto**: si no logras arreglarlo, deshaz tu cambio y dilo.

> **Camino sin deploy (instantáneo):** si el miembro quiere ver la base de conocimiento en vivo YA
> sin desplegar, puede pegar cada documento en su panel **`/admin` → Conocimiento** (botón de nuevo
> documento). Eso lo indexa al momento. La ventaja de dejarlos también en `member/kb/` es que son
> archivos suyos, versionados, que **sobreviven a las actualizaciones** de la plantilla.

---

## PASO 6 — Cierre y recordatorio de deploy (en lenguaje de negocio)

Reporta corto y claro:
- **Qué pasó:** "Leí tu sitio y armé la base de conocimiento de tu bot." (1 línea)
- **De dónde salió:** qué páginas leíste.
- **Qué cargué:** los documentos creados y los datos del negocio que actualicé (1 línea por doc, en
  términos de qué va a poder responder el bot ahora).
- **Qué falta de tu parte:** la lista de `[COMPLETA AQUÍ: ...]` — los datos que la web no tenía y que
  él debe llenar. Sé específico.
- **Próximos pasos** (2-3 bullets): ej. "llena los precios pendientes", "pruébalo mandándole 'hola'".

**RECUÉRDALE DESPLEGAR Y REINDEXAR.** Los documentos en `member/kb/` y los datos de la config **NO
están en el bot en vivo hasta desplegar**, y la base de conocimiento tampoco entra a la memoria del
bot hasta reindexarla después del deploy. Son DOS pasos. Dile exactamente:

> "Para que tu bot en vivo ya sepa todo lo de tu página faltan dos pasos: **desplegar** y luego
>  **actualizar su memoria**. Cuando quieras: corre `pnpm run deploy`, después entra a tu panel
>  **/admin → Conocimiento** y pulsa el botón **Reindexar todo**; en unos segundos pruébalo
>  mandándole un mensaje."

(Si en vez de archivos cargó los documentos pegándolos en el panel `/admin` → Conocimiento, esos ya
quedaron en la memoria al guardarlos — no necesita ni deploy ni reindexar.) **NO hagas deploy, ni
`pnpm kb:reindex` en vivo, ni `git push`, ni commits por tu cuenta.** El deploy y el reindex los
dispara el miembro.

Empieza por el PASO 0.

---

## Reglas de seguridad (no las rompas)

- **No inventes.** Solo escribes lo que sacaste del sitio. Lo que falte va como `[COMPLETA AQUÍ]`,
  nunca como un dato inventado. Este es el corazón del skill.
- **Solo lectura de la web y del bot.** Lees el sitio (WebFetch/curl) y lees archivos; las únicas
  escrituras permitidas son crear/editar documentos en `member/kb/` y editar `member/config.local.ts`
  — y ambas **con confirmación** del miembro antes de guardar.
- **No corras `INSERT`/`UPDATE`/`DELETE`/`DROP` en la base de datos** desde este skill, ni
  `db:apply`. Aquí no se tocan datos de conversaciones.
- **NUNCA** hagas `deploy` ni `git push` ni commits por tu cuenta. Este skill no toca el bot en vivo;
  solo prepara los archivos y le recuerda al miembro que despliegue.
- **No edites `src/`**, ni el system prompt, ni las reglas del bot desde aquí — para el tono está
  **/voz-de-marca** y para cambiar de giro está **/re-nichar**.
- Pide confirmación antes de **instalar** cualquier cosa. No hace falta instalar nada para este
  skill.
- **No pegues secretos ni API keys** en el chat. Si `WebFetch` no funciona y usas `curl`, no metas
  tokens en la URL.
- Si una página no abre o una consulta falla, **repórtalo honesto y sigue** con lo que sí se pudo —
  una base parcial y real vale más que rellenar con inventos.

Empieza por el PASO 0.

---

## Modo rápido (recargar la web, cuando ya lo corriste antes)

Si el miembro solo quiere "vuelve a leer mi sitio, actualicé precios": no le vuelvas a preguntar el
nivel ni el negocio (ya lo sabes de la corrida anterior si está en el contexto; si no, reverifícalo
rápido con el PASO 0). Trae las mismas URLs, saca los cambios, muéstrale el diff en lenguaje simple,
y con su "ok" actualiza los mismos documentos de `member/kb/` y la config. Sigue siendo confirmar
antes de guardar, reindexar, probar, y recordarle el deploy — sin deploy ni git de tu parte.
