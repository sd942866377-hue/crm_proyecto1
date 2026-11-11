---
name: galeria
description: Superpoder Galería (Forja+) — el bot MANDA fotos y audios del negocio en sus respuestas (el cliente pide "¿me mandas foto del menú?" o "fotos de la casa de Polanco" y el bot las manda de verdad, con texto coherente; o audios pregrabados del dueño). Soporta archivos self-hosted (D1) o por URL externa (R2, Supabase, Drive, el sitio del negocio). Actívala cuando el miembro diga "que el bot mande fotos", "enviar imágenes", "fotos de propiedades/productos", "audios pregrabados", "/galeria".
---

# Galería — el bot manda fotos y audios reales del negocio

Superpoder **Forja+ (Pro)**, **opt-in** (viene apagado). El dueño registra archivos con un
nombre y una descripción de CUÁNDO usarlos; el modelo decide en la conversación y los manda
con el marcador `[[media: id]]` (el cliente jamás ve el marcador — le llega la foto, el
video o el audio de verdad, DESPUÉS del texto). Requiere bot **>= 1.0.60** (modo URL
externa: **>= 1.0.61**; **video: >= 1.0.66**).

**Canales con envío nativo**: WhatsApp (oficial, Twilio, Kapso, YCloud), Telegram,
Instagram/Messenger (directo o vía ManyChat) y Zernio. En web el cliente recibe el **link**
(no se rompe nada); en ManyChat el audio también va como link (IG no acepta audio saliente).
Un audio **.ogg (opus)** llega como **nota de voz** en Telegram y en WhatsApp vía Zernio;
en los demás, como audio normal.

**Video** (ids `vid_…`, bot >= 1.0.66): nativo en TODOS los canales de arriba —
verificado contra la documentación oficial de cada uno. Formato universal: **mp4 con
H.264 + AAC** (WhatsApp NO acepta el perfil High con B-frames; recomienda Main/Baseline
y `-movflags +faststart`). Límites por canal: WhatsApp/Kapso/YCloud **16MB** ·
Twilio **20MB** · Instagram/Messenger **25MB** · Telegram **50MB**. Conversión segura:
`ffmpeg -i video.cualquiera -c:v libx264 -profile:v main -c:a aac -movflags +faststart video.mp4`.
⚠️ Para video usa **casi siempre MODO A (URL externa)**: el self-hosted solo admite
1.2MB (un clip de ~5s a baja resolución). El caption funciona igual que en fotos.

## Cómo GUIAR al miembro (flujo amigable — síguelo en orden)

La persona probablemente **no programa**. Tú corres todo; ella solo responde preguntas y te
pasa archivos. REGLA DE ORO: **una pregunta por mensaje**. Nada de SQL ni tecnicismos en lo
que le digas — eso es tuyo.

**1 · Explica QUÉ es, en corto, ANTES de tocar nada (y espera su "sí"):**

> "Te activo la **Galería**: tu bot va a poder **mandar fotos y audios de verdad** en la
> conversación — el cliente dice '¿me mandas foto del menú?' y le llega la foto, con su
> texto. También sirve para audios tuyos pregrabados (ej. una nota de voz explicando tus
> planes). Tú solo me pasas los archivos y me dices cuándo debe usar cada uno; yo configuro
> todo. ¿Le entramos?"

**2 · Pregunta QUÉ quiere que el bot pueda mandar.** Ejemplos por giro para inspirarlo:
restaurante → fotos del menú y platillos estrella; inmobiliaria → fotos por propiedad;
salón/spa → antes-y-después, lista de precios; cualquier giro → una nota de voz suya para
la pregunta que más le hacen. Anota la lista.

**3 · Por CADA archivo pide tres cosas** (una por mensaje si hace falta):
- **El archivo o su ubicación**: "¿me lo pasas aquí, o ya lo tienes subido en algún lado
  (tu página, Google Drive, etc.)?" → eso decide el modo (PASO 0 de abajo).
- **Un nombre corto**: "menú", "polanco-fachada".
- **Cuándo usarlo**: "¿en qué momento de la conversación quieres que el bot lo mande?" —
  esa respuesta se vuelve la descripción del asset (afínala tú para que sea accionable).

**4 · Dile los formatos en simple** (solo si aplica — no lo abrumes de entrada):

> "Fotos: JPG o PNG normales sirven tal cual (si pesa mucho yo la comprimo). Audios: lo
> ideal es una **nota de voz** — grábala en WhatsApp/Telegram y reenvíamela, o pásame
> cualquier mp3/m4a y yo lo convierto para que llegue como nota de voz de verdad."

Las conversiones son TUYAS (sips/ffmpeg, ver MODO B) — jamás le pidas al miembro convertir nada.

**5 · Configura en silencio** (PASO 0 → MODO A/B → encender), y **prueba CON él**:

> "Listo. Mándale a tu bot por WhatsApp: '¿me mandas la foto del menú?' — te debe llegar
> la foto de verdad, con un mensaje coherente. Prueba también algo que NO tiene foto, para
> que veas que responde honesto."

**6 · Cierra explicando cómo crece:** "cuando quieras agregar, cambiar o quitar archivos,
solo dime '/galeria' y me pasas los nuevos — todo se actualiza sin redeploy."

Si el miembro es **Starter (free)**: explícale amable que la Galería es de Forja+ y qué
desbloquea (horizontesia.com); no intentes prenderla a la fuerza.

## Cómo funciona por dentro (para ti)

Cada archivo es un registro en la tabla `settings` del D1 del bot (sin migraciones):

- `media_meta:<id>` → JSON chico: `{"n":"<nombre>","d":"<cuándo usarlo>","mime":"<mime>","size":<bytes>,"at":<epoch_ms>}` — y en modo URL, además `"url":"https://..."`.
- `media_blob:<id>` → SOLO en modo self-hosted: el archivo como data-URI `data:<mime>;base64,...`.

El `<id>` lo generas TÚ: prefijo por tipo + 10 chars `[a-z0-9]` — `img_x7k2m9q4fp` (foto) o
`aud_b3n8w1z5rt` (audio). El prompt lista los assets automáticamente cuando
`galeria_enabled=1` (solo Pro). El bot manda **máx 3 archivos por respuesta**.

## PASO 0 — Elige el modo de almacenamiento (pregúntale al miembro)

| Modo | Cuándo | Límites |
|---|---|---|
| **URL externa** (recomendado para catálogos) | Muchas fotos (inmobiliaria, tienda, hotel), o las fotos YA viven en algún lado (su sitio, Supabase, Drive, R2) | Sin límite de tamaño/cantidad en el bot; la URL debe ser pública y directa |
| **Self-hosted** (D1 del bot) | Pocos archivos (menú, fachada, 2-3 audios), cero dependencias externas | ≤ **1.2 MB** por archivo, recomienda ≤ ~10 archivos |

Pregunta: *"¿Dónde están tus fotos hoy? ¿En tu página, en Google Drive, en algún servicio,
o me las pasas como archivo?"* — y elige el camino con la tabla. Puedes MEZCLAR modos.

## MODO A — URL externa (R2 / Supabase / Drive / sitio propio / Sheets)

La única regla dura: la URL debe ser **https, pública y DIRECTA al archivo** (que al abrirla
descargue/muestre la imagen o el audio, NO una página HTML con preview).

**Dónde puede tenerlas el miembro (guíalo según su caso):**

- **Su sitio web / CDN**: usa la URL directa de la imagen ya publicada (click derecho →
  "copiar dirección de la imagen"). El camino más corto si ya tiene página.
- **Cloudflare R2** (misma cuenta del bot, gratis 10GB): crea bucket → habilita acceso
  público (Settings → Public access → r2.dev o dominio propio) → sube:
  `npx wrangler r2 object put <bucket>/props/casa1.jpg --file casa1.jpg --remote` →
  URL: `https://pub-<hash>.r2.dev/props/casa1.jpg`.
- **Supabase Storage**: bucket marcado **Public** → subir por dashboard o CLI → URL:
  `https://<proyecto>.supabase.co/storage/v1/object/public/<bucket>/<archivo>`.
- **Google Drive**: compartir "cualquiera con el enlace" → la URL directa es
  `https://drive.google.com/uc?export=download&id=<FILE_ID>` (el FILE_ID sale del link de
  compartir). ⚠️ Drive sirve para pocas fotos con poco tráfico; para un catálogo serio
  recomienda R2 o Supabase (Drive puede limitar descargas y algunos providers lo rechazan).
- **Catálogo en Google Sheets**: Sheets NO hospeda imágenes, pero si el miembro tiene su
  inventario ahí con una columna de URLs de fotos, léelas de ahí (expórtalo o pídeselo) y
  da de alta cada URL con este modo — nombre y descripción salen de las otras columnas.
  Para leer el Sheet sin pelearse con OAuth ni service accounts, la ruta fácil es
  **Composio** (skill `/conexiones-composio`, viene en esta misma carpeta): el miembro
  conecta su Google con un click y tú lees el inventario por esa conexión. Es también la
  ruta recomendada si después quiere el catálogo siempre sincronizado con el Sheet.

**VALIDA CADA URL antes del alta (obligatorio — aquí es donde se rompe todo si no):**

```bash
curl -sIL "<URL>" | grep -iE "^HTTP|content-type|content-length"
```

Debe dar: `HTTP/2 200`, `content-type: image/...` o `audio/...` (si dice `text/html` es una
página, NO el archivo — corrige el link), y para WhatsApp imagen ≤5MB / audio ≤16MB. Si
puedes, ábrela también en el navegador en incógnito.

**Alta por URL** (solo meta, sin blob — nota el campo `url`):

```bash
ID="img_$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 10)"   # aud_ para audio
NOW=$(( $(date +%s) * 1000 ))
npx wrangler d1 execute <DB> --remote --command "INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('media_meta:$ID', '{\"n\":\"polanco-fachada\",\"d\":\"fachada de la casa de Polanco (ID P-102)\",\"mime\":\"image/jpeg\",\"size\":0,\"at\":$NOW,\"url\":\"https://pub-abc.r2.dev/props/polanco-1.jpg\"}', $NOW)"
```

(Escapa comillas simples del nombre/desc duplicándolas. Para muchas altas, arma UN archivo
SQL con todas las filas y `--file /tmp/galeria.sql`.)

## MODO B — Self-hosted (archivo en el D1 del bot)

1. **Prepara el archivo** (≤1.2MB): foto pesada → `sips -Z 1600 foto.jpg --out foto-web.jpg`
   (macOS) o `ffmpeg -i foto.jpg -vf "scale='min(1600,iw)':-2" -q:v 5 foto-web.jpg`.
   Audio — el formato DEPENDE del canal principal del bot:
   - WhatsApp/Telegram → ogg/opus (llega como NOTA DE VOZ):
     `ffmpeg -i audio.m4a -c:a libopus -b:a 32k -ac 1 audio.ogg` (1 min ≈ 250 KB).
   - **Instagram/Messenger (directo o ManyChat) → m4a/aac** — ⚠️ IG NO reproduce
     ogg (lo descarga y lo tira EN SILENCIO, visto en prueba real):
     `ffmpeg -i audio.cualquiera -c:a aac -b:a 48k -ac 1 audio.m4a`.
   - Bot multicanal: usa m4a (suena en todos; solo pierdes el look de nota de voz).
   Formatos: `image/jpeg|png|webp`, `audio/ogg|mpeg|mp4`, `video/mp4|3gpp` (video self-hosted solo si <1.2MB; si no, MODO A).
2. **Alta EN TROZOS** — ⚠️ REGLA DURA: D1 rechaza statements de más de ~100KB y el
   fallo es SILENCIOSO (parece que funcionó y no insertó nada). Un archivo de más de
   ~70KB en base64 ya no cabe en un solo INSERT. SIEMPRE sube el blob en trozos de
   90,000 caracteres (INSERT del primero + UPDATEs concatenando el resto). Genera el
   SQL con un script, no a mano:
   ```bash
   ID="img_$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 10)"   # aud_ para audio
   python3 - "$ID" foto-web.jpg image/jpeg "menú" "cuando pidan ver el menú" <<'PY'
   import base64, json, sys, time
   aid, path, mime, nombre, desc = sys.argv[1:6]
   data = open(path, "rb").read()
   b64 = base64.b64encode(data).decode()
   now = int(time.time() * 1000)
   meta = json.dumps({"n": nombre, "d": desc, "mime": mime, "size": len(data), "at": now}, ensure_ascii=False).replace("'", "''")
   CH = 90_000
   first, rest = b64[:CH], b64[CH:]
   out = [f"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('media_blob:{aid}', 'data:{mime};base64,{first}', {now});"]
   while rest:
       c, rest = rest[:CH], rest[CH:]
       out.append(f"UPDATE settings SET value = value || '{c}' WHERE key = 'media_blob:{aid}';")
   out.append(f"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('media_meta:{aid}', '{meta}', {now});")
   open("/tmp/galeria.sql", "w").write("\n".join(out) + "\n")
   print("statements:", len(out))
   PY
   npx wrangler d1 execute <DB> --remote --file /tmp/galeria.sql && rm /tmp/galeria.sql
   ```
3. **Verifica SIEMPRE, en dos pasos** (por el fallo silencioso de D1):
   - El blob completo en D1:
     `npx wrangler d1 execute <DB> --remote --command "SELECT length(value) FROM settings WHERE key='media_blob:$ID'"`
     → debe dar ≈ (bytes del archivo × 4/3) + 23. Si da 0 filas, el insert NO entró.
   - `https://<worker>/media/$ID` en el navegador muestra el archivo completo.

## Encender y probar (los dos modos)

```bash
npx wrangler d1 execute <DB> --remote --command "INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('galeria_enabled','1',$(( $(date +%s) * 1000 )))"
```

**Prueba de coherencia (hazla SIEMPRE, con mensajes reales por su canal):**

1. *"¿me mandas foto del menú?"* (o la que aplique) → debe llegar **la foto de verdad** (no
   un link ni el marcador `[[media:` crudo).
2. Caso catálogo: *"¿tienes fotos de la casa de Polanco?"* → deben llegar las fotos de ESA
   propiedad + **UN** texto con la info (precio, m², ubicación). Señales de que algo anda mal:
   el texto dice "aquí está la foto/te la mando" (redundante), repite la info por cada foto,
   o manda fotos de otra propiedad → afina las DESCRIPCIONES de los assets (son la
   instrucción con la que el modelo elige).
3. Pide algo que NO tiene foto → debe decirlo con naturalidad y ofrecer lo que sí hay,
   nunca fingir que mandó algo.

## Nombrar bien los assets (el 80% de la calidad)

- **Catálogos (inmobiliaria/tienda/hotel)**: nombra `<item>-<vista>` y amarra el item en la
  descripción: `n:"polanco-fachada"`, `d:"fachada de la casa de Polanco, ID P-102 — cuando
  pidan fotos de ESA propiedad"`. Así el modelo nunca cruza fotos entre propiedades.
- **Audios pregrabados**: la desc dice la PREGUNTA que contesta: `d:"cuando pregunten cómo
  funciona el financiamiento, manda esta nota del asesor"`.
- Cada asset agrega una línea al prompt: razonable hasta ~30-40 por URL; depura los que ya
  no apliquen (propiedad vendida = borrar su meta).

## Listar y borrar

```bash
# listar (solo metas — jamás SELECT * : los blobs pesan megas)
npx wrangler d1 execute <DB> --remote --command "SELECT key, value FROM settings WHERE key LIKE 'media_meta:%'"
# borrar un asset (las dos keys; en modo URL la de blob simplemente no existe)
npx wrangler d1 execute <DB> --remote --command "DELETE FROM settings WHERE key IN ('media_meta:<id>','media_blob:<id>')"
# apagar la Galería sin borrar nada → galeria_enabled = '0'
```

## Troubleshooting

- **Llega el texto pero no el archivo** → valida la URL con el `curl -sIL` de arriba (¿200?
  ¿content-type correcto?). Self-hosted: checa `https://<worker>/media/<id>`. Y que
  `galeria_enabled=1` y el bot sea Pro.
- **La URL de Drive manda una página, no la foto** → no usaste el formato
  `uc?export=download&id=` o el archivo no es público.
- **El bot describe la foto pero no la manda** → desc vaga; reescríbela accionable
  ("cuando pidan VER el menú, manda esto").
- **Manda fotos de otra propiedad/producto** → las desc no amarran el item; usa la
  convención `<item>-<vista>` + ID en la desc.
- **WhatsApp rechaza el archivo** → formato/tamaño (imagen jpg/png ≤5MB; audio
  aac/mp3/ogg-opus ≤16MB); convierte con ffmpeg.
- **El audio no llega en Instagram (todo lo demás sí)** → estaba en ogg: IG lo
  descarta en silencio. Re-súbelo como m4a/aac y llega.
- **El link sale como texto en un canal nativo** → bot < 1.0.60 (o < 1.0.61 para modo URL):
  corre `/actualizar-forja`.
- **Error al subir el SQL** → comillas sin escapar en nombre/desc, o blob > 1.2MB.

## Reglas

- NUNCA registres archivos con datos sensibles (INE, contratos) — las URLs son públicas.
- No borres assets que el dueño no pidió borrar; propiedad vendida/producto agotado = ofrécele depurarlo.
- Miembro Starter (free): explícale que la Galería es de Forja+ y ofrécele el upgrade — no
  intentes prenderla a la fuerza (el prompt la ignora en free).
