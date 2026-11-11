# Equipo del panel — guía para bots que YA existían (actualizar a >= 1.0.67)

Léela cuando un miembro con bot instalado pregunte "¿qué cambia en mi panel?",
"¿qué correo pongo?", "¿tengo que hacer algo al actualizar?". Respuesta corta:
**nada cambia hasta que él quiera**. Explícaselo con este guion.

## Qué le pasa a su panel al actualizar

- Al abrir `/admin` en el navegador ya NO ve el diálogo gris de usuario/contraseña:
  ve una **pantalla de login con su marca**. Entra igual que siempre: en "Correo"
  escribe `admin` (o lo deja vacío) y abajo su contraseña de siempre
  (`DASHBOARD_PASSWORD`). Esa contraseña maestra **siempre funciona**.
- Scripts y `curl` siguen entrando por Basic Auth con el header — nada se rompe.
- Lo demás nuevo que ve: una tab **Equipo** en el menú, bajo Configuración.
- Sus datos, sus conexiones, su prompt, su KB: intactos. El update no toca nada de eso.

## Las dos puertas (>= 1.0.72)

- **`/admin`** — la puerta del dueño/administrador. Si su bot está vinculado a
  app.forjabots.com, ve un botón **"Entrar con Forja Cloud"**: se autentica con su
  cuenta de Forja y cae adentro sin teclear contraseña. El form de correo/contraseña
  queda plegado abajo ("Entrar con correo y contraseña") — es el rescate de la
  maestra y siempre está.
- **`/equipo`** — el link que comparte con su gente (y con el jefe del cliente):
  solo correo + contraseña, sin menciones de Forja. Con dominio propio queda
  `tunegocio.com/equipo`. La tab Equipo del panel se lo muestra listo para copiar.
- En bots white-label (`BRAND_HIDE_FORJA=on`) ninguna puerta menciona Forja.

## Cuándo le conviene usar Equipo

- Va a **entregar el bot a un cliente** (Modo Agencia): le crea un acceso al jefe
  con su correo, rol Administrador, y deja de compartir la contraseña maestra.
- Tiene **empleados** que atienden el panel: cada uno con su correo, rol Equipo,
  y él decide qué secciones ven.
- Quiere saber **quién hizo qué** en el panel (bitácora).

Si nada de eso aplica, no tiene que tocar la tab. Punto.

## Cómo crear el primer acceso (5 minutos)

1. Panel → **Equipo** → "Invitar a alguien": nombre, correo, rol → **Crear invitación**.
2. El panel muestra un **link** (vale 7 días, un solo uso). Se lo manda por WhatsApp.
   (Si el bot tiene correo configurado, también se lo mandamos por correo — opcional.)
3. La persona abre el link y elige su contraseña; ahí también pone su WhatsApp,
   puesto, horario y por dónde quiere que le avisen. Entra directo.
4. Desde ese momento, ese acceso entra con **su correo + su contraseña**; el dueño
   sigue entrando con `admin` + la maestra.

## Preguntas que van a hacer

- **"¿Tengo que pagar algo?"** No. Todo Equipo funciona en Workers Free. Lo único
  opcional que puede costar es el envío automático de correos (ver abajo).
- **"¿Se me olvidó la contraseña maestra?"** Camino fácil: entra a
  app.forjabots.com → su bot → **"Abrir panel"** (su sesión de Forja es la
  credencial; no necesita la maestra para entrar). Para CAMBIARLA:
  `npx wrangler secret put DASHBOARD_PASSWORD` desde la carpeta del bot (eso
  además cierra las sesiones de todo el equipo — avísale).
- **"¿Un empleado olvidó la suya?"** Él pulsa "¿Olvidaste tu contraseña?" en el
  login. Con correo configurado le llega un link (1 h). Sin correo, el dueño
  recibe un ticket en el panel con el link y se lo pasa. O desde Equipo: "Nuevo link".
- **"¿Quiero quitarle acceso a alguien ya?"** Equipo → Quitar. Su sesión muere al
  instante (el panel valida el usuario en cada página).
- **"¿Puedo darle solo la bandeja a mi recepcionista?"** Sí: Equipo → "Qué ve el rol
  Equipo" → marca solo Conversaciones. Aplica al menú Y a las URLs directas.

## Correo del panel — opcional; cuéntale los downsides ANTES de configurar

| Opción | Necesita | Costo real | Downside |
|---|---|---|---|
| Cloudflare Email Service | Dominio en Cloudflare DNS onboardeado + `[[send_email]] name="EMAIL"` + `EMAIL_FROM` | **Workers Paid ($5/mes)**; 3,000 correos/mes incluidos | En Workers Free solo entrega a correos verificados de la cuenta — NO sirve para el equipo de un cliente |
| Resend | Cuenta gratis + dominio verificado en Resend + `RESEND_API_KEY` | Gratis (3,000/mes) | Tercero más; sin dominio propio el sandbox solo entrega al dueño de la cuenta |
| Sin correo (default) | Nada | Gratis | Los links se mandan a mano; los avisos de asignación solo por WhatsApp (si hay Twilio+plantilla) o se ven en el panel |

**Seguridad si activa Cloudflare Email**: en el toml, restringe el binding al
remitente del negocio para que nada pueda mandar desde otra dirección:

```toml
[[send_email]]
name = "EMAIL"
allowed_sender_addresses = ["bot@sunegocio.com"]
```

y `EMAIL_FROM = "bot@sunegocio.com"` como var. Sin `allowed_sender_addresses`
el binding acepta cualquier remitente del dominio — mejor acotarlo.

## Texto listo para que el miembro lo mande a SU cliente

> Ya tienes tu propio acceso al panel. Abre este link, elige tu contraseña y listo:
> [LINK]. Vale 7 días. Desde ahí mismo puedes dar acceso a tu equipo en la
> sección Equipo. Si algún día olvidas la contraseña, en el login hay un
> "¿Olvidaste tu contraseña?".
