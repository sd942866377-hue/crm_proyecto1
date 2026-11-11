# Conectar Cal.com (agenda real para el bot de citas)

> **Para Claude Code:** Guía paso a paso para conectar Cal.com a un bot de nicho de
> cita (barbería, salón, dentista, gimnasio, coach). Corre esto TÚ por el miembro; él
> casi no sabe programar. La API key va como secreto de Cloudflare, no en el chat — pero si el usuario te la pega en el chat, no la rechaces: dale una advertencia corta y tú mismo la guardas con
> `wrangler secret put`. Al terminar, el bot consultará disponibilidad real y reservará
> en el calendario del dueño.

## Qué vas a lograr

- El bot podrá llamar `verDisponibilidad` → ofrece horas libres reales de Cal.com.
- El bot podrá llamar `agendarCita` con el horario elegido → **reserva** en Cal.com y
  guarda el registro en el dashboard.
- El cliente recibe la confirmación/recordatorios de Cal.com.

## Requisitos

- Una cuenta de **Cal.com** (el plan gratis alcanza para empezar).
- Uno o más **event types** creados (ej. "Corte", "Consulta", "Llamada de descubrimiento").

---

## Paso 1 — Crear la cuenta y los event types

1. El miembro entra a **https://cal.com** y crea su cuenta (o inicia sesión).
2. Conecta su calendario (Google/Outlook) en **Settings → Calendars** para que Cal.com
   sepa cuándo está ocupado. (Opcional pero recomendado.)
3. Crea un **Event Type** por cada tipo de cita que ofrece:
   - **Event Types → + New**.
   - Ponle nombre (ej. "Corte + barba"), duración (ej. 45 min) y disponibilidad.
   - Repite para cada servicio si quiere separarlos. Si no, con **uno solo** basta
     (ej. "Cita").

## Paso 2 — Obtener el ID de cada event type

El `eventTypeId` es un número. La forma más fácil de verlo:

- Abre el event type en Cal.com y míralo en la URL del editor, o
- En **Settings → Developer → API Keys** algunas cuentas muestran los IDs; si no, usa
  el endpoint de event types con la API key (Paso 3) — pero para la mayoría, el número
  que aparece al editar el event type es suficiente.

> Si el miembro solo tiene **un** event type, guarda ese número como el default.
> Si tiene **varios** (uno por servicio), anota el número de cada uno con una palabra
> clave del servicio (ej. `corte → 101`, `barba → 102`, `tinte → 103`).

## Paso 3 — Generar la API key

1. En Cal.com: **Settings → Developer → API Keys → + Add**.
2. Ponle nombre (ej. "Bot Horizontes") y **sin expiración** (o larga).
3. Copia la key (empieza con `cal_...`). **NO la pegues en el chat.**

## Paso 4 — Guardar la API key como secret

En la terminal del proyecto del bot:

```bash
wrangler secret put CALCOM_API_KEY
# pega la key cal_... cuando lo pida (no queda en el código ni en el chat)
```

## Paso 5 — Configurar el/los event type(s) en `wrangler.toml`

Abre `wrangler.toml` y, en el bloque `[vars]`, agrega según el caso:

**Caso A — un solo event type (lo más común):**
```toml
CALCOM_EVENT_TYPE_ID = "101"       # el número de tu event type
CALCOM_TIMEZONE = "America/Mexico_City"   # ajusta a tu zona
```

**Caso B — varios servicios, cada uno con su event type:**
```toml
# mapa servicio→eventTypeId (JSON en una línea). La llave es una palabra
# que aparezca en lo que pide el cliente; el bot hace match por esa palabra.
CALCOM_EVENT_TYPES = '{"corte":101,"barba":102,"tinte":103}'
CALCOM_TIMEZONE = "America/Mexico_City"
```

> Zonas comunes: `America/Mexico_City`, `America/Bogota`, `America/Lima`,
> `America/Argentina/Buenos_Aires`, `America/Santiago`. Si no pones `CALCOM_TIMEZONE`,
> usa `America/Mexico_City` por defecto.

## Paso 6 — Desplegar

```bash
pnpm run deploy
```

## Paso 7 — Probar

Escríbele al bot algo como *"quiero agendar un corte para el sábado"*. El bot debe:

1. Usar `verDisponibilidad` y ofrecer horas reales de ese día.
2. Pedir el **email** del cliente.
3. Al confirmar, reservar en Cal.com (aparece en el calendario) y mostrarla en el
   dashboard → pestaña **Citas** con estado "Reservada (Cal.com)".

---

## Si algo falla

- **El bot no ofrece horarios y solo "registra" la cita:** falta `CALCOM_API_KEY`
  (secret) o el event type en `wrangler.toml`. Revisa que ambos estén y vuelve a
  desplegar. La tool `verDisponibilidad` solo aparece si Cal.com está configurado.
- **"No pude reservar ese horario":** el slot se ocupó entre que se ofreció y se
  confirmó, o el `eventTypeId` no existe. El bot ofrecerá otro horario. Verifica el ID.
- **`http_401`:** la API key es inválida o expiró. Genera otra (Paso 3-4).
- **`http_404` al reservar:** el `eventTypeId` no corresponde a la cuenta de la key.

## Variables que usa esta integración (resumen)

| Variable | Dónde | Obligatoria | Qué es |
|---|---|---|---|
| `CALCOM_API_KEY` | secret | Sí | API key `cal_...` de Cal.com |
| `CALCOM_EVENT_TYPE_ID` | `wrangler.toml` [vars] | Sí (Caso A) | ID del event type por defecto |
| `CALCOM_EVENT_TYPES` | `wrangler.toml` [vars] | Sí (Caso B) | Mapa JSON servicio→eventTypeId |
| `CALCOM_TIMEZONE` | `wrangler.toml` [vars] | No | Zona horaria (default America/Mexico_City) |
