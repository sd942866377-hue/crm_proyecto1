# Lead magnets (opcional · requiere R2)

> **R2 NO viene en el bot por default.** Tu bot corre perfecto sin él: chat de WhatsApp,
> agenda, cobros y la base de conocimiento (RAG con **Vectorize**) NO usan R2. R2 es
> **solo** para la función de **lead magnets** (generar y hostear páginas web de recursos
> que el bot le manda a tus leads). Actívalo únicamente si vas a usar esa función.

## ⚠️ Antes de empezar: el aviso de la tarjeta

Para activar **R2** en Cloudflare, te va a pedir una **tarjeta en archivo** — aunque **NO te
cobran** dentro del nivel gratuito (10 GB, $0/mes). Verás "$0 due today". Es política de
Cloudflare (igual que Vectorize). Si no tienes tarjeta o no quieres darla, **sáltate los lead
magnets** — tu bot funciona sin esto.

## Cómo activarlo (4 pasos)

1. **Crea el bucket** (elige un nombre corto único, ej. `mi-bot-catalog`):
   ```bash
   npx wrangler r2 bucket create mi-bot-catalog
   ```
   (Si es la primera vez, Cloudflare te pedirá activar R2 + la tarjeta.)

2. **Descomenta el binding** en `wrangler.toml` — busca el bloque comentado y quítale los `#`,
   y pon el nombre de tu bucket:
   ```toml
   [[r2_buckets]]
   binding = "CATALOG"
   bucket_name = "mi-bot-catalog"
   ```

3. **Vuelve a desplegar:**
   ```bash
   npx wrangler deploy
   ```

4. **Listo.** El tool `publish_lead_magnet` del agente-dueño ya funciona: el bot puede generar
   un lead magnet y hostearlo en `<tu-worker>/lm/<id>`.

## ¿Cómo se usa después?

Desde el panel del dueño (o pidiéndole al agente-dueño), generas un lead magnet: le das un
título + el contenido en markdown, y el bot te devuelve una URL pública lista para meter en un
embudo. Sin R2, ese tool responde que la función no está activada y te manda a esta guía.
