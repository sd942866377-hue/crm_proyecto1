# Tu Chatbot de Soporte con IA — Horizontes IA (Edición PRO)

Este es tu **chatbot de soporte para Telegram**, listo para personalizar y publicar.
Responde las preguntas de tus clientes 24/7, busca respuestas en tu propia base de
conocimiento y, cuando algo lo amerita, te avisa a ti directamente para que tomes el control.

> **Esta es la variante PRO.** Incluye dashboard de administración, escalamiento (handoff)
> por varios canales, soporte de WhatsApp Pro y notas de voz. Si tienes la versión Free,
> está en otro repositorio aparte.

---

## ¿Qué es esto?

Un asistente de soporte que:

- **Responde en Telegram** con la voz e información de tu negocio.
- **Aprende de tus documentos**: subes tu base de conocimiento (preguntas frecuentes,
  políticas, guías) y el bot busca ahí antes de responder.
- **Entiende notas de voz**: tus clientes pueden mandar audios y el bot los transcribe
  automáticamente.
- **Sabe cuándo pedir ayuda**: si una pregunta es delicada o el bot no está seguro,
  te avisa a ti (handoff) para que respondas tú.
- **Vive en la nube de Cloudflare**: rápido, económico y sin servidores que mantener.

No necesitas saber programar. Todo se configura con un asistente paso a paso.

---

## Setup rápido (3 pasos)

### 1) Clona este repositorio

Descarga el código a tu computadora:

```bash
git clone <URL-DE-TU-REPO> mi-chatbot
cd mi-chatbot
```

### 2) Copia la skill de configuración a Claude Code

Copia la carpeta de skills para que Claude Code pueda guiarte:

```bash
cp -r skill/* ~/.claude/skills/
```

> Si no tienes la carpeta `~/.claude/skills/`, créala primero con `mkdir -p ~/.claude/skills`.

### 3) Corre el asistente de configuración

Abre Claude Code dentro de la carpeta del proyecto y ejecuta:

```
/configurar-mi-chatbot
```

El asistente te va a llevar de la mano para:

- Conectar tu **bot de Telegram** (token).
- Cargar tu **base de conocimiento** (tus FAQs y documentos).
- Elegir tu **nicho** (hay plantillas listas para varios tipos de negocio).
- Configurar el **handoff** (a dónde quieres que te lleguen los avisos).
- Poner contraseña al **dashboard**.
- Publicar tu bot en Cloudflare.

Al terminar, tu chatbot ya está vivo y respondiendo.

---

## ¿Cómo funciona?

```
Cliente en Telegram
        │
        ▼
   Tu Chatbot  ──►  busca en tu base de conocimiento
        │           (encuentra la mejor respuesta)
        │
        ├──►  responde con IA (claro y en tu tono)
        │
        └──►  si la pregunta es delicada o no hay respuesta segura
                     │
                     ▼
              te avisa a ti (handoff)
```

Por dentro usa tecnología de primer nivel, todo gestionado por ti sin complicaciones:

- **Cloudflare Workers** para correr el bot en la nube.
- **IA de Anthropic (Claude)** para entender y redactar respuestas. Usa el modelo
  económico (Haiku) por defecto y sube automáticamente a uno más potente (Sonnet)
  cuando la pregunta lo necesita.
- **Búsqueda inteligente** en tus documentos (no inventa: responde con tu información).
- **Transcripción de notas de voz** automática.

### Dashboard de administración (PRO)

Tu bot incluye un panel web donde puedes ver las conversaciones y la actividad.
Se protege con **usuario y contraseña** (autenticación básica):

- Usuario: `admin`
- Contraseña: la que defines durante la configuración (`DASHBOARD_PASSWORD`).

### Handoff: cuándo y cómo te avisa (PRO)

Cuando el bot decide escalar una conversación contigo, puede notificarte por:

1. **Telegram (por defecto)** — te llega un mensaje directo a tu chat de dueño.
2. **Email (opcional)** — si configuras tu correo, también recibes aviso ahí.
3. **WhatsApp (PRO, opcional)** — vía mensaje de plantilla aprobada (Twilio Content
   Template). Para esto se usa una plantilla pre-aprobada, no texto libre.

Tú eliges qué canales activar durante la configuración.

---

## Costos típicos

Este bot está diseñado para ser **muy económico**. Pagas solo por lo que usas:

- **Cloudflare**: el plan gratuito cubre la mayoría de los negocios pequeños y medianos.
  Si creces mucho, el plan de pago arranca en unos pocos dólares al mes.
- **IA de Anthropic (Claude)**: pagas por mensaje procesado. Como el bot usa el modelo
  económico por defecto, una conversación normal cuesta **fracciones de centavo**. Un
  negocio con cientos de conversaciones al mes suele gastar **unos pocos dólares**.
- **Transcripción de voz, búsqueda y almacenamiento**: incluidos en el plan de Cloudflare,
  prácticamente sin costo adicional en volúmenes normales.
- **WhatsApp / Twilio (solo si lo activas)**: tiene su propio costo por mensaje de plantilla.

> **En resumen:** para la mayoría de los negocios, el costo total ronda **unos pocos dólares
> al mes**. Los costos exactos dependen de tu volumen de conversaciones y de los servicios
> que actives.

---

## ¿Cómo actualizar tu bot?

Cuando salgan mejoras, actualizar es un solo comando. En Claude Code, dentro de la
carpeta del proyecto, ejecuta:

```
/actualizar-mi-bot
```

Esto se encarga de:

1. Descargar la última versión del código (`git pull`).
2. Reinstalar las dependencias (`pnpm install`).
3. Volver a publicar tu bot en Cloudflare (deploy).

Tu configuración y tu base de conocimiento se conservan: solo se actualiza el motor del bot.

---

## Soporte

¿Te atoraste o tienes dudas?

- Pregunta en la **comunidad de Horizontes IA** (Skool), donde otros miembros y el
  equipo te ayudan.
- Revisa las **guías de configuración** incluidas en la carpeta `skill/` (conexión de
  canales, plantillas por nicho y solución de problemas comunes).
- Si algo falla durante la configuración, el asistente `/configurar-mi-chatbot` también
  incluye ayuda para diagnosticar y resolver los errores más comunes.

---

## Licencia

Uso exclusivo de los miembros de **Horizontes IA**. No está permitido redistribuir,
revender ni publicar este código. Es para que tú lo uses en tu propio negocio.

---

Hecho con cariño por **Horizontes IA** 🚀
