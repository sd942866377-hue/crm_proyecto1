# Conectar el bot al SITIO WEB (chat en su página)

> Guía para TI, el agente que instala el bot. **No le sueltes al miembro la
> lista de plataformas.** Pregúntale primero dónde vive su página y guíalo solo
> por ese camino — los otros no le importan y lo confunden.

El canal más fácil de todos: **sin proveedor, sin tokens, sin verificación**. Y
el único donde el visitante ya está mirando el negocio cuando escribe.

El orden es: **dónde vive su página → encender el canal → cómo se va a ver →
pegarlo → probarlo.** No te saltes el tercero: si armas el `<script>` antes de
preguntarle el estilo, se lo vas a hacer pegar dos veces.

---

## PASO 1 · ¿Dónde vive su página?

Pregúntale así, en una sola pregunta:

> "¿Cuál es la dirección de tu página? Y si lo sabes, ¿con qué está hecha —
> WordPress, Shopify, Wix, o alguien te la programó?"

**Si no sabe con qué está hecha (lo más común), averígualo tú.** Abre su URL y
mira el HTML:

| Qué encuentras en el código | Plataforma |
|---|---|
| `/wp-content/` o `/wp-includes/` | **WordPress** |
| `cdn.shopify.com` o `Shopify.theme` | **Shopify** |
| `static.parastorage.com` o `wix.com` | **Wix** |
| `static1.squarespace.com` | **Squarespace** |
| `assets.website-files.com` o `webflow.js` | **Webflow** |
| `/_next/static/` | **Next.js** (código) |
| `framerusercontent.com` | **Framer** |
| Nada de lo anterior, HTML plano | **Código propio** |

Guarda dos cosas de este paso: **el dominio** (para el PASO 2) y **la
plataforma** (decide el PASO 4). Si te da varias direcciones (dominio con y sin
`www`, o una tienda aparte), anótalas todas.

> **Si te dice que no tiene página**, este canal no aplica. Ofrécele Telegram o
> WhatsApp y sigue con esos.

---

## PASO 2 · Encender el canal

En `[vars]` del `wrangler.toml`, sus dominios sin `https://` ni barra final:

```toml
WEB_SITES = "minegocio.com, www.minegocio.com"
```

Los subdominios entran solos: con `minegocio.com` también vale
`tienda.minegocio.com`. Luego:

```bash
pnpm run deploy
```

**Explícale por qué existe esta línea**, en sus palabras: *"esto hace que tu
chat solo funcione en TU página. Si alguien copia el código y lo pega en otro
sitio, no le responde — así nadie usa tu bot por su cuenta."* No es
configuración de relleno: sin esa var el canal no existe (404), y con ella nadie
puede gastar su llave de IA desde otra web.

---

## PASO 3 · ¿Cómo se va a ver?

Cuatro preguntas. Hazlas de una en una y con opciones concretas — la mayoría no
sabe describir lo que quiere hasta que ve alternativas.

### 3.1 · Formato

> "¿Cómo lo quieres: una **burbuja** que flota en la esquina y se abre cuando le
> dan clic, o un chat **incrustado** dentro de una sección de tu página, siempre
> abierto?"

- **Burbuja** → funciona en cualquier plataforma. Es el default y lo que quiere
  casi todo el mundo.
- **Ventana** (incrustado) → **solo si TÚ vas a editar el HTML del sitio**, o
  sea si es código propio, Next.js, o si el miembro está dispuesto a meter un
  bloque HTML a mano en su editor. Hay que colocar un `<div>` con altura en el
  lugar correcto del diseño; eso no es pega-y-listo.

  **Si está en WordPress/Shopify/Wix/Squarespace y pide ventana**, no le digas
  que no: dile que se puede, pero que hay que tocar la página por dentro y que
  la burbuja queda lista en dos minutos. Casi siempre acepta la burbuja.

### 3.2 · Estilo

> "Tengo cuatro estilos. ¿Cuál le queda a tu página?"

| Estilo | Cómo se ve | Cuándo |
|---|---|---|
| `suave` | Redondeado, con sombras, cabecera de color | El default; casi cualquier negocio |
| `minimal` | Plano, líneas finas, sin sombras | Sitios sobrios o corporativos |
| `oscuro` | Panel negro | Sitios de fondo oscuro |
| `vidrio` | Traslúcido con desenfoque | Sobre fotos o degradados |

**Si no sabe, decide tú y propónselo:** ya tienes su URL abierta del PASO 1.
Mira el fondo de la página donde va a ir el chat — fondo claro → `suave`;
corporativo o mucha línea fina → `minimal`; fondo negro → `oscuro`; foto o
degradado de fondo → `vidrio`. Dile *"por tu página yo le pondría X"* y deja que
confirme.

⚠️ **`vidrio` sobre blanco liso no se ve**: es traslúcido, necesita algo detrás.

### 3.3 · Color

> "¿Cuál es el color de tu marca? Si tienes el código de color (algo como
> `#c2410c`) pásamelo; si no, yo lo saco de tu página."

**Sácalo tú si no lo sabe.** Abre su sitio y busca en el CSS el color de los
botones o el encabezado; propónle dos o tres en hexadecimal y que elija. Es el
detalle que hace que el chat se vea parte del sitio y no un parche.

Solo acepta hexadecimal (`#c2410c`, `#fff`). Cualquier otra cosa se ignora y
queda el naranja de Forja — es a propósito, para que nadie inyecte CSS.

### 3.4 · Saludo y nombre

> "¿Con qué frase quieres que salude? Por ejemplo: *¡Hola! ¿Te agendo un
> corte?*"

Que sea **una pregunta concreta de su negocio**, no "¿en qué puedo ayudarte?".
La pregunta concreta arranca conversaciones; la genérica no.

El nombre de la cabecera sale solo del negocio, pero si quiere otro
(`data-nombre`), se lo pones.

### 3.5 · Armar su `<script>`

Con las cuatro respuestas, arma **su** snippet, ya personalizado. Solo pon los
atributos que se salgan del default — un snippet corto se pega sin miedo:

```html
<script src="https://TU-BOT.workers.dev/widget.js"
        data-tema="oscuro"
        data-color="#c2410c"
        data-saludo="¡Hola! ¿Te agendo un corte?"></script>
```

Nada de esto necesita redeploy: **todo se cambia editando el atributo**. Díselo,
para que no sienta que la decisión es para siempre. La tarjeta **Sitio web** de
`/admin/conexiones` también le muestra su snippet listo para copiar.

Referencia completa de atributos: al final de esta guía.

---

## PASO 4 · Pegarlo — solo la sección de SU plataforma

> En todas las plataformas con panel (WordPress, Shopify, Wix…) **el que pega es
> el miembro, no tú**. Dale el snippet ya armado, las instrucciones exactas, y
> pídele que te avise cuando guarde. No des el paso por hecho: pídele que
> refresque su página y te diga si ve la burbuja.

### Código propio / hecho con Claude Code

Aquí **lo haces tú**. Localiza el archivo que comparten todas las páginas —
`index.html` si es una sola, o el layout/footer si son varias — y pega el
`<script>` justo antes de `</body>`. Si es un solo HTML, ahí mismo.

Este es el caso donde **sí puedes ofrecer el formato ventana**:

```html
<div id="forja-chat" style="height:520px;max-width:520px;margin:0 auto"></div>

<script src="https://TU-BOT.workers.dev/widget.js"
        data-modo="ventana" data-destino="#forja-chat"></script>
```

El chat llena el contenedor: **el alto y el ancho los decide el sitio**, no el
widget (mínimo 420px de alto). Ponlo en la sección que tenga sentido —
"Contacto", "Agenda tu cita"— no en medio del hero.

Después despliega el sitio como sea que lo despliegue él (Vercel, Netlify,
Cloudflare Pages, FTP) y verifica en la URL pública, no en local.

### Next.js / React

En `app/layout.tsx`, dentro del `<body>`:

```tsx
import Script from "next/script";
// …
<Script src="https://TU-BOT.workers.dev/widget.js" strategy="afterInteractive" />
```

`afterInteractive` para que no bloquee la carga. En pages router es igual, en
`_app.tsx`. Para el formato ventana, el `<div>` va en la página que toque y el
`<Script>` en esa misma página, no en el layout.

### WordPress

El camino bueno para alguien no técnico es un plugin, **no** tocar el tema: el
código sobrevive a los cambios y actualizaciones de tema porque se guarda en la
base de datos.

1. En su WordPress: **Plugins → Añadir nuevo**, buscar **WPCode** (antes se
   llamaba "Insert Headers and Footers"), **Instalar** y **Activar**. La versión
   gratuita basta.
2. En el menú lateral: **Code Snippets → Header & Footer**.
3. Pegar el snippet en el campo **Footer** (no en Header).
4. **Save Changes**.

> Si insiste en no instalar plugins, la alternativa es `footer.php` **de un tema
> hijo** — pero adviértele: en el tema padre se pierde en la siguiente
> actualización. Si no tiene tema hijo, no vale la pena; mejor el plugin.

### Shopify

1. **Online Store → Themes**.
2. En su tema, el menú de tres puntos (⋯) → **Edit code**.
3. En la lista de archivos, abrir **`theme.liquid`** (sección Layout).
4. Pegar el snippet justo antes de `</body>` y **Save**.

> Dile que **duplique el tema antes** si le da nervio (Themes → ⋯ → Duplicate).
> Es un respaldo de un clic.

### Wix

1. En el panel del sitio: **Settings → Custom Code** (sección *Development &
   integrations*).
2. **+ Add Custom Code**, arriba a la derecha.
3. Pegar el snippet y ponerle un nombre reconocible (ej. "Chat Forja").
4. En **Place Code in**, elegir **Body – end**.
5. Aplicarlo a **todas las páginas**, y en frecuencia **Load code once**.
6. **Apply**.

### Squarespace

⚠️ **Requiere plan de pago** (Core, Plus, Advanced o algunos planes antiguos).
Si está en el plan Personal más básico, la inyección de código no aparece —
avísale antes de que se frustre buscándola.

1. **Website → Website Tools → Code Injection**.
2. Pegar el snippet en el campo **Footer** (se inserta antes de `</body>` en
   todas las páginas).
3. **Save**.

### Webflow

⚠️ **Requiere un Site plan de pago**; con el plan gratis no se puede.

1. **Site settings → Custom code**.
2. Pegar el snippet en **Footer code** (va antes de `</body>` en todo el sitio).
3. **Save changes** y — esto se olvida siempre — **Publish**. En Webflow el
   código no existe hasta que publicas.

### Google Tag Manager (cuando no hay acceso al sitio)

Útil si su página la maneja un tercero pero él sí tiene GTM.

1. **Etiquetas → Nueva → HTML personalizado**.
2. Pegar el snippet.
3. Activador: **All Pages**.
4. **Guardar** y **Enviar** (publicar el contenedor).

### Otra plataforma (Framer, GoDaddy, Jimdo, Tilda…)

El patrón es siempre el mismo: buscar en los ajustes del sitio algo que diga
**"código personalizado"**, **"custom code"**, **"embed"** o **"footer"**, y
pegar el snippet ahí, en la opción que sea **antes de `</body>`** o **body-end**.
Si no encuentras la sección, búscala en la ayuda oficial de esa plataforma antes
de improvisar — no inventes rutas de menú.

---

## PASO 5 · Comprobar (no lo saltes)

1. "Abre tu página y recárgala. ¿Ves la burbuja abajo a la derecha?" *(o el chat
   dentro de su sección, si es ventana)*
2. "Mándale un mensaje como si fueras un cliente." La respuesta llega en unos
   segundos.
3. "Recarga tu panel → **Conexiones**. La tarjeta **Sitio web** debe estar en
   **verde**, con tus dominios."
4. Verifica tú en **Conversaciones**: debe aparecer la conversación con canal
   `web`, igual que las de WhatsApp o Instagram.

---

## Referencia de atributos

```html
<script src="https://TU-BOT.workers.dev/widget.js"
        data-nombre="Barbería Pérez"
        data-saludo="¡Hola! ¿Te agendo un corte?"
        data-tema="oscuro"
        data-color="#c2410c"
        data-posicion="izquierda"></script>
```

| Atributo | Para qué | Por defecto |
|---|---|---|
| `data-nombre` | título del chat | el nombre del negocio |
| `data-saludo` | primer mensaje del bot | "¡Hola! ¿En qué te puedo ayudar?" |
| `data-tema` | `suave` · `minimal` · `oscuro` · `vidrio` | suave |
| `data-modo` | `burbuja` · `ventana` | burbuja |
| `data-destino` | selector del contenedor (solo en `ventana`) | `#forja-chat` |
| `data-color` | burbuja y mensajes del visitante (hex) | `#ff6a1f` |
| `data-posicion` | `derecha` o `izquierda` (solo en `burbuja`) | derecha |

Los mismos valores se pueden dejar fijos desde `/admin/config` con los ajustes
`web_widget_nombre`, `web_widget_saludo`, `web_widget_tema`, `web_widget_modo`,
`web_widget_destino`, `web_widget_color` y `web_widget_posicion`. **Lo que venga
en el `<script>` gana sobre el panel** — si cambia algo en el panel y no lo ve,
es porque tiene el atributo puesto en su sitio.

---

## Topes contra el spam

Este canal queda expuesto a internet 24/7 y detrás está la **llave de IA del
miembro** — cada mensaje que responde, él lo paga. Por eso hay tres topes, y
cada uno tapa lo que el anterior deja pasar:

| Tope | Por defecto | Qué frena |
|---|---|---|
| Por conversación | 30 mensajes | El que se aburre y sigue escribiendo |
| Por visitante al día | 60 mensajes | El que borra su historial y vuelve |
| **Del bot entero al día** | **500 mensajes** | **Muchas IPs a la vez — es el que protege su cuenta de IA** |

Los dos primeros son por visitante, así que quien llega con muchas IPs los suma
y los esquiva. El tercero es el techo real: sin él, 100 IPs × 60 = 6,000
llamadas al modelo en un día, pagadas por el miembro.

**Cuando pega el tope del día, el dueño recibe un aviso** (por donde tenga
configurado el handoff) explicándole si subirlo o revisar si es spam. Se avisa
máximo una vez cada 6 horas. Un tope alcanzado en silencio sería lo peor: o le
están haciendo spam y no se entera, o su chat lleva horas rechazando clientes
reales y tampoco.

**El visitante nunca ve un mensaje técnico.** Con el tope del día ve *"estamos
recibiendo muchos mensajes en este momento"* — no se le regaña, se le da salida.

### Subirlos o bajarlos

Desde `/admin/config`, sin redeploy:

| Ajuste | Por defecto |
|---|---|
| `web_limite_sesion` | 30 |
| `web_limite_ip_dia` | 60 |
| `web_limite_dia` | 500 |

Solo aceptan números enteros; cualquier otra cosa vuelve al valor por defecto.
Para un negocio local, 500 al día sobra (la mayoría no pasa de 20). Súbelo solo
si el sitio tiene tráfico real, y avísale al miembro que eso también sube lo que
puede gastar en un mal día.

> **Detalle que sí importa:** en IPv6 el tope por visitante cuenta el **/64**, no
> la dirección exacta. A un cliente doméstico le dan un /64 entero y puede
> estrenar dirección en cada petición — contando la dirección completa, el tope
> por visitante no frenaría nada.

## Si algo no funciona

| Qué pasa | Por qué suele ser |
|---|---|
| No aparece nada | El script no cargó. Revisa la URL del bot y que haya quedado guardado/publicado (en Webflow falta **Publish**; en Wix, **Apply**). |
| "Este chat no está habilitado en este sitio" | El dominio no está en `WEB_SITES`. Ojo con `www.`, con el dominio de staging y con tiendas en subdominio. |
| En formato ventana sale como burbuja | No encontró el contenedor. Abre la consola del navegador: el widget dice exactamente qué selector buscó. |
| "Has enviado muchos mensajes hoy" | Tope por visitante (60/día). Es contra abuso, no contra clientes. |
| "Estamos recibiendo muchos mensajes en este momento" | Tope del bot entero (500/día). El dueño ya recibió el aviso; revisa Conversaciones para ver si es tráfico real o spam antes de subirlo. |
| Cambió el tema en el panel y no pasó nada | Tiene `data-tema` en el `<script>`; el atributo gana. |
| Se ve raro dentro del sitio | No debería: el chat vive en su propio Shadow DOM y el CSS del sitio no lo toca. Si pasa, pide la URL. |
| En Squarespace/Webflow no encuentra dónde pegarlo | Plan gratuito. Ambas plataformas cobran por la inyección de código. |

## Lo que este canal NO hace

- **No manda mensajes primero.** Solo responde a quien escribe.
- **No guarda datos del visitante** más allá de la conversación: sin cookies de
  rastreo ni identificación entre sitios.
- **No sustituye WhatsApp.** Quien quiere seguir la conversación en su teléfono
  necesita ese canal; lo normal es tener los dos.

---

### Fuentes de las rutas de menú

Verificadas en la documentación oficial (julio 2026). Si una ruta no coincide
con lo que ve el miembro, la plataforma cambió su panel — consulta la fuente
antes de adivinar.

- WordPress / WPCode — <https://wpcode.com/docs/using-the-global-header-footer-settings/>
- Shopify — <https://help.shopify.com/en/manual/online-store/themes/theme-structure/extend/edit-theme-code>
- Wix — <https://support.wix.com/en/article/wix-editor-embedding-custom-code-on-your-site>
- Squarespace — <https://support.squarespace.com/hc/en-us/articles/205815908-Adding-custom-code-to-your-site>
- Webflow — <https://help.webflow.com/hc/en-us/articles/33961357265299-Custom-code-in-head-and-body-tags>
