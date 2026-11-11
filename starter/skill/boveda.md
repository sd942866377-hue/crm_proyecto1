---
name: boveda
description: Activa la Bóveda — guarda las imágenes y documentos que los clientes le mandan al bot (fotos para cotizar, comprobantes, PDFs) en el R2 del miembro, para verlos en el panel. El miembro NO programa; tú creas el bucket, conectas el binding, prendes el superpoder y despliegas. Actívalo con "/boveda", "activa la Bóveda", "quiero ver las imágenes que me mandan", "dónde veo las fotos de mis clientes", "guarda los documentos que me mandan", "que se guarden las imágenes del chat".
---

# Bóveda — guarda y muestra las imágenes/documentos del cliente

Eres el ingeniero del chatbot del miembro. Él NO programa: **tú corres todos los comandos**.
La Bóveda archiva las imágenes y documentos que los clientes le mandan al bot (que hoy se
pierden: las URLs de WhatsApp/Telegram expiran) en el **R2 del propio miembro**, y las muestra
en el panel — dentro de cada conversación y en una pestaña "Bóveda". Caso estrella: cotizar por
foto.

Es un superpoder **Forja+ (Pro)**. Si el bot es Starter, no aplica (ver PASO 0).

SIGUE ESTAS REGLAS AL PIE DE LA LETRA. **Fail-safe:** nada de esto puede borrar datos del
miembro — solo AGREGA un bucket, un binding y una tabla nueva.

## PASO 0 — Revisión y nivel (no toques nada todavía)
1. Confirma que estás en la carpeta del bot: deben existir `package.json` y `wrangler.toml`.
   Si no, detente y dilo.
2. Lee `BOT_TIER` en `wrangler.toml` (`'free'` | `'pro'`).
3. **Si es `free`/Starter → DETENTE.** Dile, cálido y sin presión:
   > "Guardar y ver las imágenes/documentos que te mandan tus clientes es un superpoder de
   > **Forja+**. Tu bot Starter sigue increíble sin esto, pero cuando subas a Pro te lo dejo
   > listo en un par de minutos. ¿Te cuento cómo subir?"
   No corras comandos. Termina aquí.
4. Si ya existe el binding `MEDIA` en `wrangler.toml` (sin `#`), la Bóveda ya está montada:
   salta al PASO 4 (solo verifica que el superpoder esté ON) y confírmaselo.

## PASO 1 — Explica qué es (una vez, corto)
> "La Bóveda guarda en TU nube las fotos y documentos que te mandan tus clientes por el chat, y
> te los muestra en el panel — junto a cada conversación y en su propia pestaña. Así, cuando te
> manden fotos para cotizar, las ves ordenadas y no se te pierden. Yo lo dejo listo; tú no
> tocas nada. El costo es de centavos y corre en tu propia cuenta."

## PASO 2 — Crear el bucket R2 (lo corres tú)
Elige un nombre en minúsculas con guiones, derivado de su negocio + `-media` (ej.
`royalburger-media`). Debe ser único en su cuenta.
```bash
npx wrangler r2 bucket create <negocio>-media
```
- Si dice que ya existe, reúsa ese nombre (no es error).
- Si R2 no está habilitado en su cuenta, Cloudflare te da un link para activarlo (gratis, con
  una franja gratuita amplia). Pásaselo, que lo active, y reintenta.

## PASO 3 — Conectar el binding + prender + desplegar
1. **En `wrangler.toml`**, deja el binding `MEDIA` activo. Busca el bloque comentado:
   ```toml
   # [[r2_buckets]]
   # binding = "MEDIA"
   # bucket_name = "horizontes-bot-media"
   ```
   Quítale los `#` y pon el `bucket_name` que creaste. **Si el bloque NO existe** (bots
   actualizados desde una versión vieja), agrégalo tú con esos 3 renglones (sin `#`):
   ```toml
   [[r2_buckets]]
   binding = "MEDIA"
   bucket_name = "<negocio>-media"
   ```
2. **Prende el superpoder** (setting `boveda_enabled = "1"`). `<DB>` = el `database_name` de la
   sección `[[d1_databases]]` de su `wrangler.toml`. `<ahora_ms>` = `$(( $(date +%s) * 1000 ))`.
   ```bash
   npx wrangler d1 execute <DB> --remote --command "INSERT OR REPLACE INTO settings (key,value,updated_at) VALUES ('boveda_enabled','1',<ahora_ms>)"
   ```
   (La tabla `media` se crea sola la primera vez que llegue una imagen — no hace falta tocarla.)
3. **Despliega** para que el binding entre en vigor:
   ```bash
   npx wrangler deploy
   ```

## PASO 4 — Verifica y explícale al miembro
- Confirma que el deploy terminó sin error y que el binding `MEDIA` está en el `wrangler.toml`.
- Dile, en corto:
  > "¡Listo! ✅ Ya está activa la Bóveda. A partir de ahora, cada imagen o documento que te
  > manden tus clientes se guarda en tu nube. Lo ves en el panel de dos formas: **dentro de cada
  > conversación** (la foto aparece junto al mensaje) y en la pestaña **Bóveda** (todo junto,
  > con link a cada chat). Mándate una foto de prueba al bot y en unos segundos aparece."
- Si quiere apagarlo después: panel → **Configuración** → superpoder **Bóveda** → off (o tú
  pones `boveda_enabled='0'`). El bucket y lo ya guardado se quedan; solo deja de archivar.

## Notas
- **Privacidad:** las imágenes se sirven SOLO tras el login del panel (`/admin/media/:id`),
  nunca públicas. Viven en el R2 del miembro; son suyas.
- **Tamaño:** se archiva hasta 20 MB por archivo (cubre fotos y PDFs de cotización de sobra).
- **Solo imágenes por ahora:** documentos (PDF) se archivan en cuanto el canal los entregue; en
  algunos canales el soporte de documentos entrantes va llegando — las imágenes funcionan en
  todos.
