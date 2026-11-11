---
name: equipo
description: Accesos y autenticación del PANEL del bot (Equipo, bot >= 1.0.67) — configurar, revisar, explicar y corregir. Da acceso con correo al jefe de un cliente o a empleados (roles Administrador/Equipo), invitaciones por link, recuperar contraseña, bitácora, visibilidad por rol, asignación de conversaciones y correo opcional (Cloudflare Email / Resend). Actívalo con "/equipo", "/autenticacion", "dale acceso a mi cliente", "crear usuarios del panel", "login para el jefe / mis empleados", "olvidé la contraseña del panel", "quién cambió X en el panel", "¿qué correo pongo?", "configura el correo del panel", "no puedo entrar al panel".
---

# Equipo — accesos y autenticación del panel

Eres el ingeniero del chatbot del miembro; él NO programa. Este skill tiene **cuatro modos**.
Detecta cuál pide y síguelo. Si duda, empieza por **EXPLICAR** (2 párrafos) y pregunta qué
quiere hacer. Regla de oro de auth: **jamás pidas ni pegues contraseñas en el chat** — la
maestra se cambia con `wrangler secret put`, las del equipo se eligen en el navegador.

## Antes que nada: ¿qué versión tiene?

```bash
cat .bot-version
```

Si es < 1.0.67, la tab Equipo no existe: corre el update (skill `forja`, "actualiza forja")
y despliega antes de seguir. Con >= 1.0.67, todo lo de abajo ya está en su panel — **no hay
nada que instalar**.

## Cómo funciona (dilo en corto cuando lo pidan)

- El panel siempre ha tenido UNA llave: la **contraseña maestra** (`DASHBOARD_PASSWORD`),
  usuario `admin`. **Sigue funcionando siempre** y es el rescate.
- Ahora además hay **accesos personales**: correo + contraseña propia, con rol
  **Administrador** (ve todo, administra Equipo) o **Equipo** (solo opera; el admin decide
  qué secciones ve).
- Se crean desde la tab **Equipo** del panel con un **link de invitación** (7 días, un solo
  uso) que se comparte por WhatsApp o se manda por correo si el bot tiene correo.
- **Dos puertas** (bot >= 1.0.72): **`/admin`** es la del dueño/administrador — si el bot
  está vinculado a app.forjabots.com trae el botón **"Entrar con Forja Cloud"** (entra con
  su cuenta de Forja, sin contraseña; el form queda plegado abajo como rescate).
  **`/equipo`** es el link que se comparte con el equipo y el jefe del cliente: solo
  correo + contraseña, sin menciones de Forja (la tab Equipo lo muestra listo para copiar).
- Los navegadores ya no ven el diálogo gris de Basic Auth: siempre cae la pantalla de
  login con la marca. Scripts y `curl` siguen entrando por Basic con el header.
- Miembro con bot viejo preguntando "¿qué cambia / qué correo pongo?": lee y sigue
  `skill/references/equipo-migracion.md`.

---

## MODO 1 · CONFIGURAR (entrega a un cliente / dar acceso a empleados)

Entrevista corta (una pregunta por mensaje):

1. "¿A quién le das acceso: al **jefe de un cliente** (te entrega el panel) o a **tu propia
   gente**?" — decide el rol: jefe = Administrador; empleado = Equipo.
2. "¿Nombre y correo?" (uno por persona; no le pidas contraseña — la elige él).
3. Si es Equipo: "¿Qué debe poder ver? (conversaciones / clientes / tickets / stats…)".

Luego **guíalo por el panel** (tú no puedes clickear por él, pero dile exactamente dónde):

> Panel → **Equipo** → "Invitar a alguien": nombre, correo, rol → **Crear invitación**.
> Copia el link que aparece y mándaselo por WhatsApp. Él lo abre, pone su contraseña,
> WhatsApp, puesto, horario y por dónde quiere que le avisen, y entra.

Si dio de alta gente con rol Equipo: Panel → Equipo → **"Qué ve el rol Equipo"** → marca
las secciones → Guardar. Verifica con él que aplique: que entre alguien del equipo (o
incógnito con ese acceso) y confirme que el menú y las URLs directas de lo no marcado
redirigen a Resumen.

Cierra con: "Comparte con tu gente el link **`tudominio.com/equipo`** (la tab Equipo lo
muestra listo para copiar) — esa es su puerta diaria. La tuya es `/admin`: ahí entras con
el botón de Forja Cloud, o con admin + tu contraseña. Si un día olvidas la maestra, entra
por app.forjabots.com → tu bot → Abrir panel; para cambiarla:
`npx wrangler secret put DASHBOARD_PASSWORD` en la carpeta del bot."

### Correo del panel (opcional) — SOLO si lo pide o si entrega a un cliente que lo va a
### necesitar. Preséntale las opciones con sus downsides ANTES de tocar nada:

| Opción | Necesita | Costo | Downside |
|---|---|---|---|
| **Cloudflare Email Service** | Dominio en Cloudflare DNS onboardeado en Email Service + binding + `EMAIL_FROM` | **Workers Paid ($5/mes)**, 3,000 correos/mes incluidos | En Workers Free solo entrega a correos verificados de la cuenta (NO sirve para el equipo de un cliente) |
| **Resend** | Cuenta gratis + dominio verificado en Resend + secret `RESEND_API_KEY` | Gratis (3,000/mes) | Sin dominio propio, el sandbox solo entrega al dueño de la cuenta Resend |
| **Ninguno** (default) | Nada | Gratis | Links a mano; reset de contraseña llega al admin como ticket; avisos de asignación solo por WhatsApp (si hay Twilio+plantilla) o en el panel |

Si elige **Cloudflare Email**:
1. Verifica el plan: `npx wrangler whoami` no lo muestra — pregúntale si su cuenta tiene
   Workers Paid; si no está seguro, que lo vea en dash.cloudflare.com → Workers & Pages →
   Plans. Si es Free, **no sigas**: ofrécele Resend o "sin correo".
2. Que onboardee el dominio: dash → Email → Email Service → **Onboard Domain** (Cloudflare
   agrega DKIM/DMARC solo; 5–15 min).
3. En `wrangler.toml` (el bloque ya viene comentado — descoméntalo y acótalo):
   ```toml
   [[send_email]]
   name = "EMAIL"
   allowed_sender_addresses = ["bot@sunegocio.com"]
   ```
   y en `[vars]`: `EMAIL_FROM = "bot@sunegocio.com"`. `pnpm run deploy`.
4. Prueba: Panel → Equipo → "Nuevo link" a un usuario con correo real → debe decir
   "También se lo mandamos por correo". Si no: MODO 4.

Si elige **Resend**: cuenta en resend.com → Domains → agrega y verifica su dominio (DNS)
→ API key → `npx wrangler secret put RESEND_API_KEY` (él la pega) → `EMAIL_FROM` con ese
dominio → deploy → misma prueba.

---

## MODO 2 · REVISAR (auditoría rápida del estado de auth)

Corre y reporta en una tabla corta:

```bash
cat .bot-version
grep -nE "^\s*\[\[send_email\]\]|^\s*name = \"EMAIL\"|^EMAIL_FROM|^DASHBOARD_PUBLIC" wrangler.toml
npx wrangler secret list 2>/dev/null | grep -E "DASHBOARD_PASSWORD|RESEND_API_KEY|TWILIO_HANDOFF_CONTENT_SID"
npx wrangler d1 execute <DB> --remote --command "SELECT email, role, CASE WHEN pass_hash IS NULL THEN 'pendiente' ELSE 'activo' END AS estado, horario, last_login_at FROM panel_users ORDER BY created_at;"
npx wrangler d1 execute <DB> --remote --command "SELECT value FROM settings WHERE key='staff_tabs';"
npx wrangler d1 execute <DB> --remote --command "SELECT datetime(at/1000,'unixepoch') AS cuando, actor_label, accion, detalle FROM panel_audit ORDER BY at DESC LIMIT 15;"
```

(`<DB>` = `database_name` del `[[d1_databases]]` del toml.) Señales de alerta que debes
levantar: `DASHBOARD_PUBLIC = "1"` (panel sin candado — solo Santi lo usa a propósito);
falta `DASHBOARD_PASSWORD` como secret; invitaciones pendientes con más de 7 días
(expiraron — "Nuevo link"); usuarios que nunca entraron; `staff_tabs` con secciones
sensibles (config/conexiones/costs/equipo no pueden estar — el bot las bloquea igual).

---

## MODO 3 · EXPLICAR (preguntas)

Contesta con lo de "Cómo funciona" y esta FAQ:

- **¿Qué correo pongo si siempre entré con admin?** Ninguno: `admin` (o vacío) + tu
  contraseña de siempre. Nada cambió para ti.
- **Un empleado olvidó su contraseña.** Que pulse "¿Olvidaste tu contraseña?" en el login.
  Con correo, le llega un link (1 h). Sin correo, TÚ recibes un ticket con el link y se lo
  pasas. O desde Equipo → "Nuevo link".
- **Olvidé la maestra.** `npx wrangler secret put DASHBOARD_PASSWORD` (cierra las
  sesiones de todo el equipo — avísales).
- **¿Le puedo dar solo la bandeja a alguien?** Sí: rol Equipo + "Qué ve el rol Equipo" →
  solo Conversaciones. Aplica a menú y URLs.
- **¿Quién cambió X?** Panel → Equipo → **Bitácora**.
- **¿Cómo asigno una conversación?** En el hilo, "Asignado a" → la persona; le avisamos
  por su canal (WhatsApp solo con Twilio+plantilla; si no, correo) y solo en su horario.
- **Metí 5 veces mal la contraseña.** Bloqueo de 15 min. O pide link de recuperación.
- **¿Es seguro?** PBKDF2 para contraseñas, sesiones firmadas que caducan a 14 días y se
  invalidan al cambiar contraseña / "cerrar sesión en todos los dispositivos" / rotar la
  maestra; bloqueo por intentos; bitácora.

---

## MODO 4 · CORREGIR (síntoma → causa → fix)

| Síntoma | Causa probable | Fix |
|---|---|---|
| "No puedo entrar" con la maestra en el login nuevo | puso su correo en vez de `admin`/vacío | correo vacío (o `admin`) + maestra |
| Todo el equipo quedó fuera de golpe | alguien rotó `DASHBOARD_PASSWORD` (invalida sesiones a propósito) | que vuelvan a entrar; es esperado |
| El link de invitación dice "ya no es válida" | expiró (7 días) o ya se usó | Equipo → "Nuevo link" |
| Un Equipo ve tabs que no debería (o al revés) | `staff_tabs` viejo / no guardado | Equipo → "Qué ve el rol Equipo" → Guardar; confirma en `settings.staff_tabs` |
| "También se lo mandamos por correo" NO aparece | sin proveedor: falta binding+`EMAIL_FROM` o `RESEND_API_KEY` | MODO 1 · correo |
| Correo configurado pero no llega | CF: dominio no onboardeado / plan Free / `EMAIL_FROM` fuera del dominio o de `allowed_sender_addresses`. Resend: dominio sin verificar / sandbox | `npx wrangler tail` y busca `[mailer]` — trae el motivo exacto (status + cuerpo) |
| Asignan una conversación y nadie recibe aviso | fuera de horario (esperado), canal "ninguno", o WhatsApp sin Twilio+`TWILIO_HANDOFF_CONTENT_SID` | `wrangler tail` busca `[avisos]`; ajusta horario/canal en Mi perfil |
| "Demasiados intentos" | 5 fallos | esperar 15 min o link de recuperación |
| Panel entra SIN pedir nada | `DASHBOARD_PUBLIC = "1"` | quítalo del toml y deploy (salvo que sea intencional) |
| Reset de contraseña sin correo "no pasa nada" | es esperado: el admin recibe un TICKET con el link | Panel → Tickets |

Después de cualquier cambio: `pnpm typecheck` no aplica (no tocaste código); solo
`pnpm run deploy` si tocaste `wrangler.toml`, y repite la prueba con el miembro.

## Reglas

- Contraseñas: nunca por el chat. Secrets con `wrangler secret put` (él pega).
- No inventes que Cloudflare Email es gratis: exige Workers Paid para destinatarios
  arbitrarios. Dilo antes.
- No borres usuarios ni rotes la maestra sin confirmación explícita.
- Si el miembro es Starter (free): Equipo funciona igual; lo Pro-gated es el white-label,
  no los accesos.
