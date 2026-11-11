# Plantilla de nicho: CRM / Ventas B2B (agencia, consultor, freelancer, PYME)

> **Para Claude Code:** Úsala cuando el negocio del miembro **vende servicios a otros
> negocios/personas** y quiere que el bot **califique prospectos** y los ordene en un
> pipeline (agencias de marketing/automatización, consultores, freelancers, despachos,
> proveedores B2B). El dashboard se convierte en "Prospectos" (empresa · necesidad ·
> presupuesto). Pon `BOT_NICHE = "crm"` en `wrangler.toml`. Todo lo de abajo son
> ejemplos: confírmalos con el miembro.

Este nicho NO vende un producto de mostrador ni agenda citas de local: **califica leads
de venta** y agenda llamadas. El registro clave es el prospecto (tool `registrarProspecto`).

---

## (A) Pre-fill para `member/config.local.ts`

```ts
export const businessConfig = {
  // "Servicios" = tus paquetes/ofertas con su rango de inversión.
  services: [
    { name: "Diagnóstico / llamada de exploración", price: "Gratis" },
    { name: "Proyecto puntual (setup / automatización)", price: "desde $X" },
    { name: "Retainer mensual (servicio continuo)", price: "desde $X/mes" },
    { name: "Consultoría / capacitación", price: "desde $X" },
  ],
  hours: "Atención Lun-Vie 9am-6pm. Llamadas agendadas.",
  location: "Remoto / online. Presencial en {{ciudad}} bajo cita.",
  paymentMethods: ["transferencia", "tarjeta", "PayPal", "MSI (proyectos grandes)"],
  contactPhone: "{{teléfono}}",
  customFields: {
    "cliente ideal": "{{a quién SÍ le sirven — giro, tamaño, dolor}}",
    "no es para": "{{a quién NO — para descalificar rápido y no perder tiempo}}",
    "proceso": "1) llamada de diagnóstico, 2) propuesta, 3) arranque",
    "tiempo de arranque": "{{ej. 1-2 semanas}}",
    "diferenciador": "{{por qué contigo y no con otro}}",
  },
};

export const memberConfig = {
  tone: "profesional y consultivo — preguntas buenas, sin presión ni palabrería de vendedor",
  language: "es",
  greeting:
    "¡Hola! 👋 Soy el asistente de [Tu Agencia/Nombre]. " +
    "Te ayudo a ver si podemos resolver lo que necesitas y a agendar una llamada. ¿En qué proyecto andas?",
  handoffTriggers: [
    "prospecto listo para hablar con una persona",
    "negociación de precio o alcance a la medida",
    "cliente actual con un tema de su cuenta",
  ],
};
```

## (B) Playbook

Ya viene integrado en el pack (`BOT_NICHE = "crm"`): califica (necesidad, empresa,
presupuesto, timeline), agenda la llamada, registra con `registrarProspecto`, no cierra
por chat ni inventa precios. No lo inyectes a mano.

## (C) 5 KB docs sugeridos (`member/kb/`)

1. `servicios-y-paquetes.md` — qué ofreces, qué incluye cada paquete, para quién.
2. `precios-y-alcance.md` — rangos de inversión y qué queda dentro/fuera (para calificar).
3. `casos-y-resultados.md` — 3-5 casos reales con el antes/después (sin exagerar).
4. `proceso-de-trabajo.md` — cómo trabajas paso a paso y tiempos de arranque.
5. `preguntas-frecuentes.md` — objeciones típicas (precio, tiempos, garantías, soporte).

> El doc más importante es `precios-y-alcance.md`: es lo que deja al bot calificar bien
> y no traer prospectos que no encajan.
