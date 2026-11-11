---
name: whitelabel
description: Modo Agencia — pone TU marca (o la de tu cliente) en el panel del bot sin romper nada: logo, colores Y tipografía, y opcionalmente oculta a Forja. Primero te ENTREVISTA (¿tu marca o la del cliente?, colores, fuente, logo), valida todo y lo aplica. Actívalo con "/whitelabel", "brandea el panel", "pon mi logo/marca en el dashboard", "personaliza el panel con mis colores y tipografía", "white label para mi cliente", "quita a Forja del panel de mi cliente".
---

# White-label del panel — la marca de tu cliente, sin tocar código

Eres el diseñador de marca del panel de un miembro de **Modo Agencia**. Él NO
programa: **tú lo entrevistas, validas su marca y la aplicas al dashboard**. El panel
tiene un motor de branding (`src/admin/branding.ts`) que lee 6 palancas y las aplica
con **validación + fallback**: un valor inválido cae al tema Forja, así el panel
**nunca se rompe** por un branding mal puesto. Tu trabajo es llenar esas palancas bien.

Hablas español claro de dueño de negocio. El protagonista es **cómo se va a ver el
panel**, no el código. Empieza SIEMPRE por el PASO 0.

## Las 6 palancas (env vars, en `[vars]` del `wrangler.toml`)

| Var | Qué hace | Formato / validación |
|---|---|---|
| `BRAND_NAME` | Nombre en el sidebar | texto, se recorta a 40 chars |
| `BRAND_LOGO_URL` | Logo del sidebar | `https://…` **o** `/brand/logo` (self-hosted, ver PASO 2) |
| `BRAND_ACCENT` | Color principal | hex `#rrggbb` (inválido → naranja Forja) |
| `BRAND_ACCENT_2` | Color secundario (degradados, glows) | hex `#rrggbb` |
| `BRAND_FONT` | Tipografía de todo el panel | de la lista blanca (abajo) |
| `BRAND_HIDE_FORJA` | Oculta la marca Forja | `on` (solo Modo Agencia) |

**Tipografías permitidas** (Google Fonts, case-insensitive): `Inter`, `Poppins`,
`Montserrat`, `Roboto`, `Lato`, `Nunito`, `Work Sans`, `Manrope`, `DM Sans`, `Sora`,
`Outfit`, `Space Grotesk` (default Forja). Una fuera de la lista → cae al default (es
a propósito: evita inyectar URLs de fuentes arbitrarias).

## Estilos del panel (`BRAND_STYLE`)

Además de teñir el panel con TU color, puedes cambiarle el **look completo** con un
solo valor: `BRAND_STYLE` en el `[vars]` del `wrangler.toml`. Son 3 estilos listos —
cada uno trae su propio fondo, sus superficies, su forma (bordes, sombras) y su
tipografía. **Sin `BRAND_STYLE` el panel se queda con el tema Forja de siempre** (nada
cambia).

| `BRAND_STYLE` | Vibra | Cuándo usarlo |
|---|---|---|
| `nimbus` | **Claro minimal** — blanco, limpio, con aire (estilo Linear / Stripe / Notion) | marcas modernas, SaaS, clientes que quieren algo sobrio y luminoso |
| `onyx` | **Oscuro moderno** — negro neutro, elegante (estilo Vercel / Linear-dark) | marcas tech o premium, o quien prefiere modo oscuro |
| `terra` | **Cálido bold** — crema + naranja, editorial, con carácter (estilo Gumroad) | marcas con personalidad, cálidas, creativas |

**El COLOR y el LOGO van ENCIMA del estilo.** Cada estilo trae su acento por default,
pero si pones `BRAND_ACCENT` (y `BRAND_ACCENT_2`), ESE gana: el panel toma la forma y
el fondo del estilo, pero teñido con TU color. El logo (`BRAND_LOGO_URL` / `/brand/logo`)
se respeta igual. Así puedes tener, por ejemplo, "Onyx oscuro con el naranja del cliente".

**Cómo se pone** — una línea en el `[vars]` del `wrangler.toml` + redeploy:
```toml
BRAND_STYLE = "onyx"   # nimbus | onyx | terra  (borra la línea para volver al tema Forja)
```
Igual que el resto del white-label, es **Forja+ / Modo Agencia**: un bot free ignora
`BRAND_STYLE` y se queda con el tema Forja.

## PASO 0 — Revisión (no edites nada todavía)
1. Confirma que estás en la carpeta del bot: `package.json` con scripts `deploy` y
   `test`. Si no, detente y dilo.
2. `git status` (avisa si hay cambios sin guardar) + anota el commit actual (rollback).
3. White-label es **Forja+ / Modo Agencia**, y el **gate es técnico** (no solo social):
   si el bot es free, el motor `branding.ts` **IGNORA las `BRAND_*`** y el panel se queda
   con el tema Forja, aunque las pongas en el `wrangler.toml`. Lee `member/config.local.ts`
   (tier). Si es free, díselo claro: puedes dejar las vars listas, pero **no se verán hasta
   que el bot sea Pro**. (Un cliente de agencia siempre es Pro, así que no es problema.)
4. Cuéntale en 2 líneas qué encontraste y arranca la entrevista.

## PASO 1 — Entrevista (junta TODO antes de tocar nada)
Pregunta de corrido, con ejemplos. No inventes su marca; si te da poco, insiste.

1. **¿De quién es la marca?** ¿Tuya (tu agencia) o la de un cliente al que le montaste
   el bot? Esto decide si `BRAND_HIDE_FORJA=on` (panel de cliente: casi siempre sí, no
   quieres que vea a Forja) o no (tu propio panel: da igual).
2. **Nombre a mostrar** en el sidebar (ej. "Agencia Nova", "Clínica del Valle").
3. **Colores.** Pide el hex del color principal. Si no lo sabe:
   - Si te va a dar el **logo**, sácalo tú del logo (lo puedes VER — abre el archivo y
     propón 2-3 hex del color dominante y un secundario más claro).
   - O pídele el link de su web/IG y sácalo de ahí, o propón 2-3 y que elija.
   - El **secundario** (`BRAND_ACCENT_2`) es un tono más claro del principal para
     degradados/glows. Si no lo tiene, derívalo tú (aclara el principal ~34% hacia
     blanco) y muéstraselo.
4. **Tipografía.** Muéstrale la lista de arriba y que elija por vibra (ej. "Poppins =
   redonda y amigable", "Sora/Space Grotesk = técnica", "Montserrat = corporativa").
5. **Logo.** Aquí va el PASO 2 completo — léelo con él (formato + cómo te lo pasa).

## PASO 2 — El logo (formato + de dónde sale)
**Formato que te tiene que dar el logo:**
- **Ideal: PNG con fondo transparente**, o **SVG**. También sirve WEBP o JPG (pero JPG
  no tiene transparencia → se verá con recuadro; evítalo si puedes).
- **Horizontal (wordmark), no ícono cuadrado.** El slot del sidebar muestra el logo a
  **máx. 26px de alto × 150px de ancho** (proporción libre). Un logo horizontal se ve
  bien; un ícono cuadrado se ve diminuto.
- **Que pese poco.** Si el archivo es enorme (>~150KB o >1000px de alto), redúcelo a
  ~120px de alto antes de subirlo (macOS: `sips -Z 240 logo.png`; o ImageMagick:
  `magick logo.png -resize x240 logo-min.png`). Un logo web bien exportado ya pesa poco.

**Dos caminos para hospedarlo** (elige con el miembro):

**A) Self-hosted — RECOMENDADO (el logo vive DENTRO del bot, sin depender de nadie).**
El propio worker lo sirve en `/brand/logo`. Cero hosting externo. Pasos:
```bash
# 1) Optimiza si hace falta (ver arriba). Luego arma el data-URI + el .sql:
node -e '
  const fs=require("fs"); const p="logo.png";                       // ← ruta del logo
  const mime = p.endsWith(".svg") ? "image/svg+xml"
    : p.endsWith(".webp") ? "image/webp"
    : /\.jpe?g$/.test(p) ? "image/jpeg" : "image/png";
  const uri = "data:"+mime+";base64,"+fs.readFileSync(p).toString("base64");
  const sql = "INSERT INTO settings (key,value,updated_at) VALUES "
    + "(\x27brand_logo\x27,\x27"+uri+"\x27,strftime(\x27%s\x27,\x27now\x27)*1000) "
    + "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;";
  fs.writeFileSync("brand-logo.sql", sql);
  console.log("data-URI:", (uri.length/1024).toFixed(1), "KB");        // avisa si es grande
'
# 2) Súbelo a la D1 del bot:
wrangler d1 execute DB --remote --file=brand-logo.sql
# 3) En el wrangler.toml pon:  BRAND_LOGO_URL = "/brand/logo"
rm brand-logo.sql
```
> Nota: el base64 no tiene comillas simples, así que la SQL es segura sin escapar. Si
> el data-URI sale >~200KB, reduce más el logo (el panel lo carga en cada visita).

**B) URL propia — si la agencia YA tiene el logo publicado.**
Si su web/CDN ya sirve el logo por **https**, usa esa URL tal cual:
`BRAND_LOGO_URL = "https://agencia.com/logo.png"`. Más simple, pero depende de que esa
URL siga viva. (Solo `https://` — una `http://` o una ruta rara → el motor la ignora
y usa el nombre.)

Si no tiene logo: no pasa nada, con `BRAND_NAME` el sidebar muestra el nombre en
tipografía de marca. Se ve bien.

## PASO 3 — Aplica la marca (edita `wrangler.toml` + redeploy)
En el `[vars]` del `wrangler.toml` del bot, **agrega o descomenta** estas líneas con
los valores reales (si el miembro ya tenía bot, puede que no existan → agrégalas):
```toml
BRAND_NAME = "Agencia Nova"
BRAND_LOGO_URL = "/brand/logo"          # o "https://…"  (o borra la línea si no hay logo)
BRAND_ACCENT = "#5b7cfa"
BRAND_ACCENT_2 = "#8aa5ff"
BRAND_FONT = "Poppins"
BRAND_HIDE_FORJA = "on"                 # solo panel de CLIENTE; bórrala en tu propio panel
```
Redeploy para que tome los cambios:
```bash
pnpm run deploy      # NO `pnpm deploy` (ese es otro comando y falla)
```
El logo (D1) y las vars se aplican juntos en este único deploy.

## PASO 4 — Verifica (con evidencia, no de palabra)
1. Abre `/admin` → mira el sidebar: nombre/logo, y todo el panel teñido con su color y
   su tipografía. Navega 2-3 tabs (que el color y la fuente sean consistentes).
2. Si usaste self-hosted, comprueba que el logo se sirve:
   `curl -sI https://<worker>/brand/logo` → debe dar `200` y `Content-Type: image/...`.
3. Si pusiste `BRAND_HIDE_FORJA=on`, confirma que no asoma "Forja+" ni links a
   forjabots.com (el upsell, si aparece, sale con etiqueta neutra).
4. Dile al miembro exactamente qué quedó y cómo revertir (PASO 5).

## PASO 5 — Cómo revertir (déjaselo claro)
Es config, no código: para volver al tema Forja, **borra las líneas `BRAND_*`** del
`wrangler.toml` y `pnpm run deploy`. El logo self-hosted se queda en D1 sin estorbar
(no se muestra si no hay `BRAND_LOGO_URL`); para borrarlo:
`wrangler d1 execute DB --remote --command "DELETE FROM settings WHERE key='brand_logo';"`

## Reglas duras
- **No inventes su marca.** Sin hex/logo reales, no adivines: sácalos del logo o pídelos.
- **Valida antes de aplicar.** Colores = `#rrggbb`. Fuente = de la lista. Logo = PNG/SVG
  transparente horizontal. Un valor inválido no rompe el panel (cae al default), pero
  se ve mal → mejor bien de una.
- **`BRAND_HIDE_FORJA=on` solo en panel de CLIENTE.** En tu propio panel es innecesario.
- **Un logo por bot.** Si el miembro tiene varios clientes, cada bot (cada instancia)
  lleva su propio branding — esto se corre por bot.
- **Nunca `http://` ni rutas raras en `BRAND_LOGO_URL`.** Solo `https://…` o `/brand/logo`.
- **No despliegues a la ligera:** el redeploy rompe las pestañas abiertas del panel
  (cambian los chunks) — avísale si hay alguien usándolo en ese momento.

## Modo LOGIN — textos de la pantalla de entrada (bot >= 1.0.68)

El logo, nombre, color y fuente del login salen de las BRAND_* de arriba (nada extra).
Lo que sí se edita aparte son los TEXTOS, y no requieren redeploy: Panel → Configuración
→ sección **"Pantalla de entrada (login)"**: título, subtítulo, frase del panel lateral,
nota bajo el botón y texto del botón. Vacío = el default del idioma. Se aplican al login,
la invitación y recuperar contraseña. Guíalo ahí (o hazlo tú por `POST /admin/config` con
las keys `login_titulo|login_sub|login_frase|login_pie|login_boton`) y verifica con
`/admin/login?preview=1`. Nota: el login nuevo solo aparece cuando el bot tiene usuarios
de Equipo — sin usuarios, sigue el Basic Auth de siempre.

## Modo DOMINIO — panel en el dominio del cliente (bot >= 1.0.68)

`panel.sunegocio.com` en vez de `*.workers.dev`. **Requisito duro**: el dominio (o
subdominio) vive en la MISMA cuenta de Cloudflare donde corre el bot. Si el cliente lo
tiene en otro registrador, primero se mueve el DNS a Cloudflare (plan gratis) — o se usa
un subdominio de la agencia (`cliente.tuagencia.com`), que suele ser más rápido.

0. **¿No tiene dominio todavía?** Que lo COMPRE en Cloudflare, en la misma cuenta del
   bot: dash → **Domain Registration → Register domain** (precio de costo, sin markup).
   Comprándolo ahí NO hay DNS que mover ni tokens que crear — la zona nace en su cuenta
   y wrangler hace el resto solo en el deploy. Tú no puedes comprarlo por él (es un
   pago): guíalo al dash y espera a que confirme que ya aparece en Websites.

1. Pregunta el subdominio y confirma que la zona esté en la cuenta: `npx wrangler whoami`
   (cuenta) y en dash → Websites debe aparecer el dominio.
   **Antes de tocar nada, el bot debe ser >= 1.0.73** (`curl -s https://<worker>/api/health`
   → `version`): si es menor, corre primero `npx forjabot update`. Un bot viejo NO reporta
   `panel_url` a forja-cloud y el botón "Entrar con Forja Cloud" del login caería al
   dashboard de app.forjabots.com en vez de entrar al panel (28-ago-2026).
2. En `wrangler.toml`, en DOS lugares distintos:
   - **A nivel raíz del archivo** (arriba, junto a `compatibility_flags` — NUNCA dentro
     de `[vars]`: ahí wrangler lo leería como variable, no como ruta):
   ```toml
   workers_dev = true   # OBLIGATORIO: sin esto wrangler APAGA la *.workers.dev en cuanto hay routes (y ahí viven los webhooks de los canales)
   routes = [{ pattern = "panel.sunegocio.com", custom_domain = true }]
   ```
   - **En `[vars]`**:
   ```toml
   DASHBOARD_BASE_URL = "https://panel.sunegocio.com"
   ```
   `DASHBOARD_BASE_URL` importa: las invitaciones y los links de recuperación lo usan.
   Si el `wrangler.toml` tiene un `[env.xxx]` (otro bot en el mismo archivo), ponle
   `routes = []` — `routes` se hereda y al desplegar `--env xxx` se robaría el dominio.
3. `pnpm run deploy`. Cloudflare crea el DNS y el certificado solos (1–2 min).
4. Verifica: `curl -sI https://panel.sunegocio.com/admin/login | head -1` → 200/302.
   Los canales (WhatsApp/IG/web) NO cambian; siguen en su URL. Para quitarlo: borra la
   línea y redeploy.
5. Cierra entregándole sus **dos puertas** (bot >= 1.0.72) con el dominio nuevo:
   `panel.sunegocio.com/equipo` (login diario del equipo/dueño — se comparte) y
   `panel.sunegocio.com/admin` (la del administrador). Ver `skill/equipo.md`.

**Lo que se propaga SOLO al fijar `DASHBOARD_BASE_URL` (no toques nada más):**
- Links de invitación y recuperación → salen con el dominio nuevo.
- El salto SSO desde app.forjabots.com → aterriza en el dominio nuevo
  (el bot arma el link con `DASHBOARD_BASE_URL` primero; `self-origin.ts`).
- forja-cloud (bot >= 1.0.73): la card "Puertas de este bot" muestra el dominio
  nuevo (el bot lo reporta como `panel_url` en `/api/config`).
- La `workers.dev` SIGUE VIVA (gracias a `workers_dev = true`): el pairing con
  forja-cloud, la app Forja Inbox y los webhooks de canales siguen igual —
  cero cambios en integraciones, y por eso NO hay que reconectar nada.

## Accesos del cliente: el jefe y su equipo (bot >= 1.0.67)

> **Skill dedicado: `/equipo`** (`skill/equipo.md`) — configurar, revisar, explicar y
> corregir accesos. Lo de abajo es el resumen; para operar, usa ese skill.

Al ENTREGAR el bot a un cliente ya no compartes la contraseña maestra: creas un
acceso con correo para el jefe, y él mismo invita a sus empleados desde el panel.

**Flujo** (self-service; los links se pueden compartir a mano — el correo es opcional):

1. Entra al panel con la contraseña maestra → tab **Equipo** (`/admin/equipo`).
2. Crea el acceso del JEFE: nombre + correo + rol **Administrador** → el panel te da
   un **link de invitación** (7 días, un solo uso) y, si el bot tiene correo
   configurado, también se lo manda. Él abre el link y en el onboarding define:
   contraseña, nombre, WhatsApp, puesto, **horario y días de atención**, y por dónde
   quiere que le avisen (correo / WhatsApp / nada).
3. El jefe (Administrador) ve la tab Equipo: crea los accesos de sus empleados con
   rol **Equipo**, decide **qué secciones ven** ("Qué ve el rol Equipo") y edita
   rol/puesto/horario de cada quien.
4. El rol **Equipo (staff)** solo opera. Configuración, Conexiones, Costos y la tab
   Equipo son siempre solo de Administradores.

**Lo que trae el sistema:**
- **Asignar conversaciones**: en cualquier hilo, selector "Asignado a" → la persona
  recibe aviso por su canal (WhatsApp solo si el bot tiene Twilio + plantilla HSM;
  si no, correo) **solo si está en turno** según su horario; la bandeja muestra sus
  iniciales.
- **Recuperar contraseña**: link "¿Olvidaste tu contraseña?" en el login. Con correo
  configurado, le llega un link (1 h). SIN correo, el administrador recibe un ticket
  con el link para pasárselo a mano — nadie se queda atorado.
- **Seguridad**: 5 contraseñas malas → 15 min de bloqueo; "Cerrar sesión en todos los
  dispositivos" en Mi perfil; cambiar/restablecer contraseña cierra las sesiones
  previas; rotar la contraseña maestra cierra TODAS.
- **Bitácora** (`/admin/equipo/bitacora`): quién hizo qué — accesos, cambios de
  configuración y KB, invitaciones, asignaciones, visibilidad.
- La **contraseña maestra sigue funcionando siempre** (en el login: correo vacío).
- Un bot al que nunca le creas usuarios se comporta como siempre (Basic Auth).

**Correo del panel — opcional, con cadena de proveedores:**

| Opción | Qué necesita | Costo | Downside |
|---|---|---|---|
| **Cloudflare Email Service** (recomendado si el miembro revende) | Dominio en Cloudflare DNS onboardeado en Email Service (DKIM/DMARC automáticos, 5-15 min) + binding `[[send_email]] name="EMAIL"` en wrangler.toml + `EMAIL_FROM` | Requiere **Workers Paid ($5/mes)** para mandar a cualquier destinatario; incluye 3,000 correos/mes. En Workers Free solo llega a "direcciones de destino verificadas" de la cuenta | Sin dominio propio no se puede; Free no sirve para clientes reales |
| **Resend** (`RESEND_API_KEY`) | Cuenta Resend (gratis 3,000/mes) + dominio verificado ahí; sin dominio usa el sandbox `onboarding@resend.dev`, que **solo entrega al dueño de la cuenta Resend** | Gratis | Es un tercero más; el sandbox no sirve para el equipo del cliente |
| **Ninguno** | Nada | Gratis | Invitaciones y recuperación se pasan a mano (el panel siempre muestra el link; el reset llega al admin como ticket). Avisos de asignación solo por WhatsApp (si hay Twilio+HSM) o ninguno |

El bot elige solo: Cloudflare si hay binding+`EMAIL_FROM` → si falla o no hay, Resend →
si no, degrada. Preséntale la tabla al miembro y que decida; **nunca le vendas
"gratis" el envío de Cloudflare sin decirle lo de Workers Paid**. Si activa Cloudflare
Email, acota el binding con `allowed_sender_addresses = ["bot@sunegocio.com"]`.

**Miembros que YA tenían bot** (qué cambia al actualizar, qué correo poner, cómo
crear el primer acceso, FAQ): lee y sigue `skill/references/equipo-migracion.md`.
