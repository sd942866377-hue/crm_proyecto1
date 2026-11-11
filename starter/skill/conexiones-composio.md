---
name: conexiones-composio
description: Conecta el bot a CUALQUIER app externa vía Composio (Google Calendar, Gmail, Slack, Notion, CRMs, y 100+ más) sin escribir código por app. El miembro NO programa; tú corres los comandos y guardas su API key como secret. Actívalo con "/conexiones-composio", "quiero conectar Google Calendar/Gmail/Slack/Notion a mi bot", "conecta mi bot a [app]", "que mi bot use Composio", "integra mi bot con [servicio externo]".
---

# Conexiones Composio — conecta tu bot a cualquier app externa

Eres el ingeniero del chatbot del miembro. Él NO programa: **tú corres todos los comandos**.
Composio (composio.dev) es un puente que ya conecta 100+ apps (Google Calendar, Gmail, Slack,
Notion, CRMs, Sheets…) — una vez que el miembro conecta SUS cuentas ahí, el bot puede usarlas
sin que nadie escriba código nuevo por cada app.

Este es un superpoder **Forja+ (Pro)**. Si el bot es Starter, no aplica (ver PASO 0).

SIGUE ESTAS REGLAS AL PIE DE LA LETRA.

## PASO 0 — Revisión y nivel (no edites nada todavía)
1. Confirma que estás en la carpeta del bot: debe existir `package.json` y `wrangler.toml`.
   Si no, detente y dilo.
2. Detecta el nivel: lee `BOT_TIER` en `wrangler.toml` (`'free'` | `'pro'`).
3. **Si el nivel es `free`/Starter → DETENTE.** Dile, cálido y sin presión:
   > "Conectar tu bot a Google Calendar, Gmail, Slack, Notion y demás vía Composio es un
   > superpoder de **Forja+**. Tu bot Starter sigue increíble sin esto, pero cuando subas a
   > Pro te dejo esta conexión lista en minutos. ¿Te cuento cómo subir?"
   No corras comandos ni escribas nada más. Termina aquí.
4. Si ya existe `COMPOSIO_API_KEY` (revisa con
   `wrangler secret list` o pregúntale si ya la conectó antes), dile que Composio ya está
   activo y pregúntale si quiere conectar una app NUEVA (salta al PASO 2) o revisar qué tiene
   conectado (PASO 4).

## PASO 1 — Explica qué es Composio (una vez, corto)
Dile en 3-4 líneas, sin tecnicismos:
> "Composio es un puente que ya sabe hablar con Google Calendar, Gmail, Slack, Notion, y muchas
> otras apps. Tú conectas TUS cuentas una sola vez en su sitio (composio.dev) — como cuando le
> das permiso a una app con tu cuenta de Google — y luego tu bot puede usarlas: crear eventos,
> mandar mensajes, leer/escribir en tus documentos, etc. Yo conecto el bot a Composio; tú solo
> autorizas tus apps ahí."

## PASO 2 — Crear cuenta y conectar apps (lo hace el miembro, tú lo guías)
1. Dile que entre a **https://composio.dev** y cree su cuenta (o inicie sesión).
2. Conecta la app. La forma MÁS FÁCIL para el miembro (recomendada): **tú le generas un link y
   él solo le da un clic para autorizar.** Corre:
   ```bash
   composio link <app> --no-wait      # ej: composio link airtable --no-wait
   ```
   Imprime un link `https://connect.composio.dev/link/...`. **Pásaselo al miembro**; lo abre,
   autoriza la app por OAuth (un clic) y listo. (Verificado en vivo: así se conectaron Gmail y
   Airtable.)
   - Si NO tienes el CLI de Composio, instálalo (`pip install composio` o `npm i -g composio`,
     luego `composio login`), **o** mándalo al **dashboard de composio.dev** → busca la app →
     "Connect" (mismo OAuth, sin terminal).
3. Pregúntale **qué apps quiere conectar primero** (una pregunta, puede dar varias a la vez).
   No hay límite técnico, pero recomiéndale empezar con 1-3 que de verdad vaya a usar el bot
   (agenda, correo, o su CRM) — el bot solo anuncia al modelo un catálogo curado por app, así
   que menos apps = capacidades más claras para el bot.
4. Espera a que confirme que ya conectó al menos una app (verá un check/estado "Active" en su
   dashboard de Composio).

## PASO 3 — Sacar la API key y guardarla como secret
1. En el dashboard de Composio: busca **API Keys** (settings del proyecto) y copia su key.
   **Dile que NO la pegue en el chat.**
2. Tú la guardas como secret del bot:
   ```bash
   wrangler secret put COMPOSIO_API_KEY
   # el miembro pega la key en SU terminal (campo oculto) cuando se lo pida
   ```
   Avísale ANTES de correr el comando que va a ver un campo para pegar algo, para que no se
   confunda ni te la mande por el chat.
3. (Opcional, casi nunca hace falta) Si el miembro conectó sus apps bajo un `user_id`
   específico en Composio (no el default de su proyecto), guarda también:
   ```bash
   wrangler secret put COMPOSIO_ENTITY_ID
   ```
   Si no sabe qué es esto, sáltalo — sin esta variable el bot usa TODAS las cuentas conectadas
   del proyecto, que es lo normal para un miembro con una sola cuenta de Composio.

## PASO 4 — Desplegar, VERIFICAR y confirmar
1. **La primera vez** (cuando acabas de poner `COMPOSIO_API_KEY`), despliega para que el bot
   tome el secret y quede activo:
   ```bash
   pnpm run deploy
   ```
   (Para conectar apps NUEVAS después, NO hace falta redeploy: el bot las auto-descubre solo en
   ~2 minutos.)
2. **VERIFICA que de verdad quedó — no lo des por hecho.** Pídele al bot una acción de
   solo-lectura de la app recién conectada y confirma que responde con datos REALES:
   - Airtable / CRM → *"lista mis bases de Airtable"*
   - Google Calendar → *"¿qué tengo agendado hoy?"*
   - Gmail → *"¿cuántos correos sin leer tengo?"*
   El bot debe reconocer la app (la ve en el catálogo que Composio le anuncia), llamar la tool
   `composio` con el slug correcto, y responder con datos reales. **Si responde bien → quedó.**
3. Recién entonces dile al miembro que ya puede usar esa capacidad, con un ejemplo de su negocio
   (*"ahora ya puedo agendarte citas directo en tu Google Calendar"*).

Si el bot dice que no tiene esa capacidad, revisa PASO 3 (secret guardado) y que la app aparezca
"Active" en el dashboard de Composio — el catálogo se refresca en ~2 minutos (cache interno del bot).

## PASO 5 — Deja la tool BIEN configurada (no solo conectada)

Que el dashboard de Composio diga "Active" no basta. Muchas apps necesitan saber A QUÉ RECURSO
apuntar dentro de esa cuenta (¿cuál calendario? ¿cuál base? ¿cuál tabla?) — sin eso el bot puede
usar el recurso equivocado (agendar en el calendario personal en vez del del negocio, guardar
leads en la tabla incorrecta) o simplemente fallar. Este paso deja cada tool CONFIGURADA, no
solo conectada. Hazlo justo después de que el miembro conecta una app nueva (PASO 2), antes de
darla por lista.

> **Antes de la receta: entiende el mapa, no lo sigas a ciegas.** Eres Claude — usa tu criterio.
> Lo de abajo es la RUTA GENERAL y unos ejemplos, no un guion rígido. Cada app es distinta;
> adáptalo a la que tengas enfrente.

### El mapa — cómo fluye una conexión en Forja

Así encaja todo (para que sepas dónde vive cada cosa):
1. **Composio** = el puente. El miembro autoriza SUS cuentas ahí por OAuth (PASO 2). Eso da el
   "el bot ya puede hablar con la app", pero no el "a cuál recurso dentro de la cuenta".
2. **`composio_context`** (setting en D1) = la libreta donde TÚ anotas a qué recurso apunta cada
   app (cuál calendario, cuál base, cuál tabla). Es lo único que configuras a mano.
3. **El bot** lee esa libreta en vivo y la inyecta en su system prompt, junto con las tools que
   Composio le anuncia → así usa el recurso correcto sin adivinar. (Código: `src/agent.ts` +
   `src/integrations/composio.ts`.)
4. **El dashboard del bot** (en `app.forjabots.com` → tu bot → tarjeta "Integraciones · vía
   Composio") refleja qué apps quedaron conectadas y a qué recurso apuntan — lo lee del
   `/api/config` del bot. Si dejaste bien el `composio_context`, ahí se ve.

Tu único trabajo manual es el punto 2. El resto Forja lo hace solo.

### Cómo se anota (el contrato)

La configuración de cada app vive en UN solo setting de D1, `composio_context`. Su valor es un
JSON string que mapea el **slug del toolkit** → un objeto con su config, ej.:
```json
{"airtable":{"base_id":"appXXXXXXXXXXXXXX","table":"Leads"},"googlecalendar":{"calendar_id":"primary"},"cal":{"event_type_id":"123","username":"santiago"}}
```
El bot lee este setting en tiempo real y usa el recurso correcto según la app que esté usando.
Tú (Claude, el ingeniero) eres quien lo ESCRIBE la primera vez que configuras cada app.

**Para escribirlo, sigue SIEMPRE estos 3 pasos** (nunca pises la config de otras apps ya
configuradas):
1. **Lee el valor actual**:
   ```bash
   wrangler d1 execute DB --remote --command "SELECT value FROM settings WHERE key = 'composio_context'"
   ```
2. **Mergea** en tu cabeza (o con un script rápido): toma el JSON existente (o `{}` si está vacío
   o la fila no existe todavía), y agrega/actualiza SOLO la clave del toolkit que estás
   configurando ahora — deja las demás intactas.
3. **Escribe** el JSON mergeado completo:
   ```bash
   wrangler d1 execute DB --remote --command "INSERT INTO settings (key, value, updated_at) VALUES ('composio_context', '<JSON_MERGEADO>', strftime('%s','now')*1000) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
   ```
   Usa el binding `DB` (mismo de siempre). El JSON completo va entre comillas simples en el
   shell; como el JSON en sí usa comillas dobles no hay conflicto, pero si algún VALOR dentro
   lleva un apóstrofe, escápalo doblándolo (`''`) como cualquier string de SQLite.

Este mismo patrón — **conectar → configurar su context → verificar apuntando al recurso
correcto** — aplica a CUALQUIER app que conectes, no solo a las de la lista de abajo. Para una
app que no esté aquí: revisa su doc oficial en `https://docs.composio.dev/toolkits/<slug>` (ahí
está la lista completa de sus acciones y parámetros — algunas apps incluso tienen guías propias)
y pregúntate: ¿esta app necesita saber A CUÁL recurso específico apuntar? Si sí, pregúntale al
dueño, descúbrelo con una tool de listar/leer de solo-lectura de esa misma app, y guárdalo en
`composio_context`.

### Ejemplos del patrón (no es receta — adáptalo)

Estos son los casos más comunes, para que veas el patrón en acción — **¿esta app necesita saber a
cuál recurso apuntar? → pregúntale al dueño → descúbrelo con una tool de solo-lectura → anótalo en
`composio_context`.** No es una checklist obligatoria: si una app no necesita context (como Gmail),
sáltatela; si es una que no está aquí, aplica el mismo criterio con su doc de Composio. Los slugs y
campos de abajo son de referencia — si Composio cambió algo, confía en lo que devuelva la tool, no
en esta lista.

#### Cal.com (`cal`)
- **Pregúntale al dueño**: qué tipo de cita (event type) debe agendar el bot. Si solo tiene uno,
  confírmaselo; si tiene varios (ej. "Consulta 30 min" vs. "Demo 1 hora"), que te diga cuál.
- **Descúbrelo con** `CAL_LIST_EVENT_TYPES` (necesita el `username` del dueño en Cal.com — si no
  lo sabe, pregúntaselo o revísalo en su perfil `cal.com/<username>`). Ojo: la respuesta viene
  anidada en `data.eventTypeGroups[].eventTypes[]` — aplánala para ver todos los tipos con su
  `id` y `title`.
- **Guarda**: `cal.event_type_id` (el `id` del event type elegido) + `cal.username`.
- Doc oficial: https://docs.composio.dev/toolkits/cal

#### Airtable (`airtable`)
- **Pregúntale al dueño**: a qué base y tabla debe guardar los leads/registros que capture el bot.
- **Descúbrelo con** `AIRTABLE_LIST_BASES` (lista sus bases: `id` tipo `appXXXXXXXXXXXXXX` +
  `name`) y luego `AIRTABLE_GET_BASE_SCHEMA` sobre la base elegida (lista sus tablas: `id` tipo
  `tblXXXXXXXXXXXXXX` + `name`, y los campos de cada una — útil para que el bot sepa qué columnas
  llenar).
- **Guarda**: `airtable.base_id` + `airtable.table` (nombre o ID de la tabla, ambos sirven).
- Doc oficial: https://docs.composio.dev/toolkits/airtable

#### Google Calendar (`googlecalendar`)
- **Pregúntale al dueño**: en cuál de sus calendarios debe agendar el bot (su calendario personal
  — `primary` — o uno dedicado del negocio si maneja varios).
- **Descúbrelo con** `GOOGLECALENDAR_LIST_CALENDARS` (lista todos sus calendarios con `id`; el
  principal siempre aparece como `primary`).
- **Guarda**: `googlecalendar.calendar_id`.
- Doc oficial: https://docs.composio.dev/toolkits/googlecalendar

#### Google Sheets (`googlesheets`)
- **Pregúntale al dueño**: a qué spreadsheet y a qué pestaña (hoja) debe escribir. Lo más fácil:
  pídele el LINK del spreadsheet — el ID va en la URL entre `/d/` y `/edit`
  (`https://docs.google.com/spreadsheets/d/<ESTE_ES_EL_ID>/edit`).
- **Confírmalo con** `GOOGLESHEETS_GET_SPREADSHEET_INFO` (valida que el ID existe y que hay
  acceso) y `GOOGLESHEETS_GET_SHEET_NAMES` (lista las pestañas para que el dueño elija cuál).
- **Guarda**: `googlesheets.spreadsheet_id` + `googlesheets.sheet` (nombre de la pestaña).
- Doc oficial: https://docs.composio.dev/toolkits/googlesheets

#### Gmail (`gmail`)
- Normalmente NO necesita configuración extra — usa directo la cuenta que se conectó en el
  PASO 2 (no hay "cuál bandeja" que elegir). Sáltate este paso salvo que el dueño tenga un caso
  raro (ej. varios alias) que quiera aclarar.
- Doc oficial: https://docs.composio.dev/toolkits/gmail

#### HubSpot / CRM (`hubspot`)
- **Pregúntale al dueño**: en qué pipeline debe caer lo que capture el bot (ej. deals nuevos vs.
  tickets de soporte) — solo si maneja más de uno.
- **Descúbrelo con** `HUBSPOT_RETRIEVE_ALL_PIPELINES_FOR_SPECIFIED_OBJECT_TYPE` (pásale
  `objectType: "deals"` o `"tickets"` según el caso) para listar sus pipelines con `id`.
- **Guarda**: `hubspot.pipeline_id` — solo si maneja más de un pipeline; si solo tiene el
  default, sáltate este paso.
- Doc oficial: https://docs.composio.dev/toolkits/hubspot

Para cualquier otra app: mismo patrón. Su doc en `https://docs.composio.dev/toolkits/<slug>`
tiene la tool de "listar/leer" de solo-lectura que necesitas para descubrir el ID correcto.

### Verifica que quedó BIEN configurada (no solo conectada)

Esto es además de la verificación genérica del PASO 4 — ahora prueba una acción real que
DEPENDA del `composio_context` que acabas de guardar, y confirma que aterrizó en el recurso
correcto (no en cualquiera):
- Cal.com → *"agenda una cita de prueba mañana a las 10am"* → confirma que cayó en el event type
  correcto (no en otro que el dueño tenga).
- Airtable → *"agrega un registro de prueba a mi tabla de leads"* → confirma en Airtable que
  apareció en la BASE y TABLA correctas.
- Google Calendar → *"crea un evento de prueba mañana a las 3pm"* → confirma que cayó en el
  calendario correcto (no en otro que el dueño tenga conectado).
- Google Sheets → *"agrega una fila de prueba"* → confirma que se escribió en la pestaña correcta.
- HubSpot → *"crea un deal de prueba"* → confirma que cayó en el pipeline correcto.

Si aterriza en el lugar equivocado: revisa que `composio_context` tenga el ID correcto (no el de
un recurso parecido) y que no haya quedado pisado por un merge mal hecho al configurar otra app
después.

## Si algo falla
- **Tu Gmail / Google Calendar / Slack / Notion (apps OAuth) dejó de funcionar (~julio 2026):**
  Composio **retiró el flujo viejo de OAuth el 3-jul-2026** (para todas las cuentas), así que las
  conexiones OAuth hechas antes quedaron inválidas y el bot ya no las ve como "Active". El fix es
  **reconectar la app**: vuelve a correr `composio link <app> --no-wait` (genera el link nuevo,
  un clic para re-autorizar), o en el dashboard de composio.dev → la app → **Reconnect**. Tras
  reconectar vuelve a `ACTIVE` y el bot la retoma en ~2 min. **Las apps de API key (Cal.com) NO
  se afectan** — no las toques. Para ver qué conexiones quedaron rotas: `wrangler tail` y busca
  `[composio] conexiones NO activas`.
- **El bot no menciona ninguna app nueva:** falta `COMPOSIO_API_KEY` (secret) o el bot no es
  Pro. La tool `composio` solo se registra si ambas cosas se cumplen.
- **"no tengo esa app conectada" / error de Composio al ejecutar:** la app no quedó "Active"
  en Composio, o se conectaron DOS cuentas de la misma app (el bot usa la primera que
  encuentra — no hay selección explícita entre varias cuentas del mismo toolkit todavía).
  Pídele al miembro que revise su dashboard de Composio.
- **El bot inventa un tool_slug que no existe:** dile que te copie el error exacto — el modelo
  solo debería usar los slugs que aparecen en el catálogo anunciado; si insiste, puede ser que
  esa acción específica no esté en el catálogo curado (limitado a ~20 tools totales, ~6 por
  app) — dile que puede pedirte agregar esa tool específica al catálogo si la necesita seguido.
- **El bot usa el recurso equivocado** (calendario, base, tabla o pipeline que no es): la app
  está conectada pero su `composio_context` quedó mal — revisa PASO 5, léelo de vuelta
  (`wrangler d1 execute DB --remote --command "SELECT value FROM settings WHERE key = 'composio_context'"`)
  y confirma que el ID guardado corresponde al recurso que el dueño realmente quiere, no a otro
  parecido. Un merge mal hecho al configurar una app nueva puede haber pisado la clave de otra.

## Variables que usa esta integración (resumen)

| Variable | Dónde | Obligatoria | Qué es |
|---|---|---|---|
| `COMPOSIO_API_KEY` | secret | Sí | API key del proyecto de Composio del miembro |
| `COMPOSIO_ENTITY_ID` | secret | No | Filtra por `user_id` específico (casi nunca hace falta) |
| `composio_context` | setting (D1, tabla `settings`) | No | JSON toolkit→config con los IDs de recurso de cada app (calendario, base, tabla…) — ver PASO 5 |

Código relevante (por si necesitas revisar o extender): `src/integrations/composio.ts`
(cliente REST — auto-descubre apps conectadas + ejecuta tools por slug),
`src/tools/composio.ts` (la tool genérica que usa el LLM), `src/tools/index.ts` (registro,
Pro-only), `src/agent.ts` (anuncio del catálogo en el system prompt), `src/db/settings.ts`
(repo de settings — mismo patrón `get`/`set` que usa `composio_context`).
