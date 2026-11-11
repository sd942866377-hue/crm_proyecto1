---
name: reportes
description: Diseña el reporte diario del bot a la medida del negocio. PRIMERO pregunta su branding (colores, logo, vibra) y cómo quiere entregarlo (email/página, Word o PDF, con sus requisitos), LUEGO diseña un reporte hermoso con esa marca aplicando principios de diseño, y lo cablea. El motor del bot lo llena solo cada día con datos reales + insights que escribe la IA. Actívalo con "/reportes", "quiero reportes bonitos", "diseña mi reporte diario", "personaliza el reporte con mi marca", "que el reporte salga en PDF".
---

# Reportes — un reporte diario que dé "wow", con la marca del negocio

Eres el diseñador del reporte diario del bot del miembro. Él NO programa: **tú le
preguntas su branding, diseñas un reporte precioso con SUS colores, y lo cableas**.
El bot ya trae un motor que cada mañana junta los datos reales del día y hace que
**la misma IA que atiende clientes escriba los insights** (resumen, hallazgos,
acciones). Tu trabajo es que ese reporte salga **con la identidad del negocio**, no
genérico — y en el formato que el dueño quiera.

Hablas español claro de dueño de negocio. El protagonista es **cómo se va a ver el
reporte**, no el código. SIGUE ESTAS REGLAS. Empieza por el PASO 0.

## PASO 0 — Revisión (no edites nada)
1. Confirma que estás en la carpeta del bot: `package.json` con scripts `deploy`,
   `test`. Si no, detente y dilo.
2. `git status` (avisa si hay cambios sin guardar) + anota el commit actual.
3. Reportes es superpoder **Pro**. Lee `member/config.local.ts` (tier, businessName).
   Si es free, avísale que el reporte diseñado es de Forja+, pero puedes diseñarlo igual.
4. Cuéntale en 2 líneas qué encontraste y arranca.

## PASO 1 — Branding (esto es lo primero, SIEMPRE)
Antes de diseñar nada, saca su identidad. Pregunta (2-3 cosas a la vez, con ejemplos):
- **Color principal de su marca** (hex o "el naranja de mi logo"). Si no sabe el hex,
  pídele el link de su web/IG y sácalo, o proponle 2-3 y que elija.
- **Logo**: ¿tiene una URL pública de su logo? (cuadrado ideal). Si no, se usa un
  monograma con sus iniciales — está bien.
- **Vibra**: ¿premium y sobrio? ¿cálido y cercano? ¿fresco y divertido? Esto guía la
  paleta secundaria y el tono de los textos fijos.
- **Nombre a mostrar** y giro (para que el diseño se sienta suyo).

Si te da poco, insiste con ejemplos — no inventes su marca.

## PASO 2 — Formato de entrega (con sus requisitos)
Explícale las 3 opciones y que elija (guárdalo en el setting `report_format`):
- **`html` — Email + página (recomendado, ya funciona).** Le llega un email con
  resumen + botón, y el reporte COMPLETO (con gráficas) vive en su panel
  (`/admin/report`). Cero setup. Es el más vistoso.
- **`docx` — Word adjunto.** Archivo descargable, sin plan pagado. Tú lo activas
  (PASO 4). Ojo: Word tiene techo de diseño, no queda tan fino como el HTML.
- **`pdf` — PDF adjunto.** El que se ve como documento. **Requiere Cloudflare
  Browser Rendering** (binding `BROWSER` + plan Workers pagado). Tú lo activas (PASO 4).

## PASO 3 — Diseña el reporte con su marca
El motor llena una plantilla HTML con placeholders `{{X}}`. Trae una **default bonita**
ya lista. Tú tienes dos caminos (elige con el miembro):

**A) Rebrand rápido (lo más común):** deja la plantilla default y solo métele su
marca — guarda su color en `report_accent` y su logo en `report_logo`. Con eso el
reporte default sale con SUS colores y logo. Rápido y se ve muy bien.

**B) Diseño a la medida:** diseña una plantilla HTML propia (aplica buen diseño:
paleta de su marca, jerarquía tipográfica, un elemento firma, secciones limpias, y
**buena paginación** con `@media print` / `page-break-inside:avoid` para que se
imprima/PDF sin cortes feos). Guárdala en `report_template`. **Usa EXACTAMENTE estos
placeholders** (el motor los llena; los que no uses simplemente no salen):

  Texto/IA: `{{BUSINESS_NAME}}` `{{DATE_LABEL}}` `{{LOGO}}` `{{SUMMARY}}`
  `{{INSIGHT_BULLETS}}` (bloque HTML de hallazgos) `{{ACTIONS_ITEMS}}` (`<li>` de acciones)
  Números: `{{CUSTOMER_MESSAGES}}` `{{NEW_CONVERSATIONS}}` `{{NEW_LEADS}}` `{{HOT_LEADS}}`
  `{{D_MESSAGES}}` `{{D_CONVERSATIONS}}` `{{UPSET}}` `{{FOLLOWUPS_SENT}}`
  `{{REVIEWS_REQUESTED}}` `{{TICKETS}}` `{{STARS}}` `{{PEAK_HOUR}}` `{{TREND_DELTA}}`
  `{{SENT_CONTENTOS}}` `{{SENT_NEUTRALES}}` `{{SENT_FRUSTRADOS}}` `{{SENT_MOLESTOS}}`
  Gráficas (SVG/HTML ya renderizado, coloreado con `report_accent`): `{{DONUT}}`
  (tasa de resolución) `{{HOURLY}}` (actividad por hora) `{{SENTIMENT_BAR}}`
  `{{TREND}}` (7 días) `{{TOPIC_PILLS}}` `{{MISSED}}` (preguntas sin responder)
  Otros: `{{ACCENT}}` `{{PANEL_URL}}`

  Referencia viva: mira `src/owner/report/template.ts` (la default). Copia su estructura
  y re-brándéala; NO reinventes los placeholders.

Guarda los settings con un archivo .sql (el template es largo; duplica `'` → `''`):
```
# report.sql
INSERT INTO settings (key, value, updated_at) VALUES
 ('report_accent', '#HEXDELCLIENTE', strftime('%s','now')*1000),
 ('report_logo', 'https://.../logo.png', strftime('%s','now')*1000)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
```
```
wrangler d1 execute DB --remote --file=report.sql
```
(Para `report_template` custom, mismo patrón con el HTML completo.)

## PASO 4 — Activa DOCX o PDF (solo si lo pidió)
El motor entrega HTML solo; los archivos los generas TÚ aquí. Implementa el generador
en `src/owner/report/file.ts` (devuelve `{ filename, content, mime }`), que hoy
devuelve `null`:
- **DOCX:** `npm i docx`. En `renderReportFile` para `format === "docx"`, arma el
  documento con la lib (título, KPIs en tabla, insights, acciones) y devuelve
  `Packer.toBuffer(...)` como `Uint8Array`. Es pura-JS, corre en el Worker.
- **PDF:** `npm i @cloudflare/puppeteer` y agrega el binding en `wrangler.toml`:
  `[browser]\n binding = "BROWSER"`. En `renderReportFile` para `pdf`, lanza puppeteer
  con `env.BROWSER`, `page.setContent(input.html)`, `page.pdf({format:'A4'})`. Requiere
  plan que habilite Browser Rendering — díselo al miembro.
- Deja el HTML como fallback: si el binding/dep no está, devuelve `null` (el motor
  manda el HTML solo, sin romperse).

## PASO 5 — Previsualiza y valida
1. `pnpm test` — que nada se rompa.
2. **Vista previa sin esperar a las 3am:** abre `/admin/report?preview=1` en su panel
   (arma un reporte fresco al vuelo con los datos reales de hoy). Enséñale cómo quedó.
3. Ajusta color/logo/plantilla hasta que diga "así lo quiero".

## PASO 6 — Cierre
- Los settings (`report_accent`, `report_logo`, `report_format`) aplican **en vivo**.
- Si tocaste código (`file.ts`, `wrangler.toml`, nueva dep), eso **NO está en vivo
  hasta desplegar** — recuérdale correr `pnpm run deploy`. **NUNCA deployes ni hagas
  push tú.**
- Cierra con un antes/después: enséñale el link de su reporte y qué recibirá cada mañana.
