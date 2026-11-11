# Cómo darle una AGENDA a tu bot (nichos de cita)

> **Para Claude Code:** Lee esto cuando el negocio del miembro sea de **citas**
> (barbería, salón, dentista, gimnasio, coach) y él quiera que el bot maneje su
> agenda. Explícale los métodos, sus pros y contras, y deja que el miembro elija.
> Empieza por el método que menos fricción tenga; el bot funciona sin agenda externa.

Un bot de cita puede agendar de dos formas. Las dos **siempre** dejan el registro en
el dashboard del bot (pestaña "Citas"). La diferencia es si además se sincroniza con
un calendario real.

---

## Método 1 — Registro simple (por defecto, cero configuración)

El bot toma los datos de la cita (servicio, día, hora, nombre) con la tool
`agendarCita` y la deja **REGISTRADA** en el dashboard. El dueño la confirma a mano
(o desde su propio calendario). No requiere ninguna cuenta ni llave.

- ✅ **Ventaja:** funciona desde el minuto uno, sin nada que conectar.
- ✅ **Ventaja:** el dueño mantiene el control (confirma cada cita).
- ⚠️ **Contra:** no valida disponibilidad real — el bot no sabe si esa hora ya está
  ocupada; el dueño revisa y confirma.
- 👉 **Ideal para:** negocios chicos, quien apenas arranca, o quien ya tiene su propia
  forma de organizar la agenda.

**No hay que hacer nada** para tener este método: viene activo en los nichos de cita.

---

## Método 2 — Cal.com (agenda real, opt-in)

Conectando **Cal.com** (gratis para uso básico), el bot consulta **horarios libres
reales** (tool `verDisponibilidad`) y **reserva la cita en el calendario** del dueño
(la misma `agendarCita` hace la reserva). El cliente recibe la confirmación de Cal.com.

- ✅ **Ventaja:** ofrece solo horas que de verdad están libres; evita empalmes.
- ✅ **Ventaja:** la cita cae directo en el calendario (Google/Outlook vía Cal.com),
  con recordatorios automáticos.
- ⚠️ **Contra:** requiere crear cuenta en Cal.com, configurar el/los "event types" y
  pegar una API key (una sola vez).
- ⚠️ **Contra:** para reservar, Cal.com pide el **email** del cliente (el bot lo pide).
- 👉 **Ideal para:** consultorios, coaches, salones con agenda apretada, o quien ya usa
  Cal.com / quiere recordatorios automáticos.

**Cómo conectarlo:** sigue `cal-com.md` en esta misma carpeta.

---

## Cómo decidir (guion para el miembro)

Pregúntale:

1. **"¿Ya usas alguna agenda digital (Google Calendar, Calendly, Cal.com)?"**
   - Si usa Cal.com o quiere recordatorios/sincronía → **Método 2**.
   - Si no, o quiere lo más simple → **Método 1** (y puede subir a Cal.com después).
2. **"¿Tu problema es que se te empalman las citas?"**
   - Sí → **Método 2** (valida disponibilidad).
   - No, solo quiero juntar las solicitudes → **Método 1**.

> Regla: si dudas, arranca con el **Método 1**. Migrar a Cal.com después es solo
> agregar la API key y el event type — nada del bot cambia.

---

## Próximamente (otros métodos de agenda)

La idea es ir sumando más formas de conectar la agenda. Cuando existan, se documentan
aquí como archivos hermanos de `cal-com.md`:

- ⏳ Google Calendar directo (sin Cal.com).
- ⏳ Calendly.

Si el miembro necesita uno que aún no existe, dilo y pásalo como feedback — se puede
priorizar.
