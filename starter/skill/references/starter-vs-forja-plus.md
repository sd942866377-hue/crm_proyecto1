# Starter (free) vs Forja+ (Pro) — la matriz canónica

> **Fuente de verdad de la división de planes.** Si un skill, la landing o el panel
> dicen otra cosa, **manda esta tabla** (y su columna "dónde se decide"). Léela cuando
> el usuario pregunte "¿qué me da Forja+?", cuando active su membresía, o cuando algo
> Pro "no funcione" (casi siempre es tier free).
>
> Para entender CÓMO encaja todo (canales, settings, panel, deploy), ver
> [`mapa-forja.md`](./mapa-forja.md).

## Cómo se decide el tier (una sola función)

Todo el gating pasa por **`isPro(env)`** (`src/config.ts:7-9`):

```ts
export function isPro(env: Env): boolean { return env.BOT_TIER === "pro"; }
```

El `BOT_TIER` efectivo lo resuelve `applyTier()` en cada request/cron: primero
`settings.tier_override` (lo empuja el control plane vía `POST /api/tier` al activar
Forja+, **sin redeploy**), y si está vacío, el `BOT_TIER` del `wrangler.toml`. No hay
ningún otro lugar donde se decida el plan — si algo quiere ser Pro, se pregunta
`isPro(env)`; nada de heurísticas ni banderas sueltas.

## La matriz

Leyenda: ✅ disponible · 🔒 solo Forja+ · ⚙️ requiere que el dueño conecte una llave.

### Atención y tools del bot

| Capacidad | Free | Forja+ | Dónde se decide (código) |
|---|:--:|:--:|---|
| Atender por texto, buscar en KB (`searchKb`) | ✅ | ✅ | `src/tools/index.ts:42` (set base) |
| **Capturar leads** (`captureLead`) — el valor central del Starter | ✅ | ✅ | `src/tools/index.ts:46` + comentario `config.ts:11-13` |
| Pausar bot / snooze (`pauseBot`, `snoozeUser`) | ✅ | ✅ | `src/tools/index.ts:44-45` |
| **Handoff a humano** (crear ticket + aviso Telegram/email) (`handoffHuman`) | ✅ | ✅ | `src/tools/index.ts:43` (set base) |
| **Toma de control** desde el panel (responder como humano / pausar / reanudar un chat) | ✅ | ✅ | `src/admin/routes.ts` (`/conversations/:id/reply\|pause\|resume`) |
| **Duración de la pausa configurable** ("Cuando tomas el control": 1h / 3h / hasta reanudar) | ✅ | ✅ | `takeover_minutes`; `control-levels.ts` (`TAKEOVER_CONTROL`) → skill `/human-in-the-loop` |
| **Notas de voz** (transcripción de audio) | ✅ | ✅ | `src/agent.ts` (transcribeAudio, sin gate) |
| Tools por giro (`agendarCita`, `registrarPedido`, `crearReservacion`…) | ✅ | ✅ | `src/tools/index.ts:75-110` (por `BOT_NICHE`, no por tier) |
| **Agendar citas** (`scheduleAppointment`) / **consultar catálogo** (`catalogQuery`) | 🔒 | ✅ | `PRO_ONLY_TOOLS` en `config.ts:14-17`; registro en `index.ts:55-57` |
| Aviso de handoff por **WhatsApp** (plantilla Twilio) | 🔒 | ✅ | `src/tools/handoffHuman.ts:106,250` (`isPro`) |
| **Vista** — el bot LEE imágenes (producto, comprobante) | 🔒 | ✅ | `src/agent.ts:161-166` (`if (!isPro) …`) |
| **Cobros por WhatsApp** (`sendPaymentLink`) | 🔒 ⚙️ | ✅ ⚙️ | `index.ts:59-60` (`isPro` + `stripeConfigured`) |
| **Composio** — conectar cualquier app (`composio`) | 🔒 ⚙️ | ✅ ⚙️ | `index.ts:65-66` (`isPro` + `composioEnabled`) |
| **White-label del panel** (logo, colores, tipografía + ocultar Forja) — Modo Agencia | 🔒 | ✅ | `src/admin/branding.ts` (`resolveBranding` → `if (!isPro) return FORJA_THEME`); skill `/whitelabel` |
| **Tu propia IA** (BYO-LLM: tu key de Claude/OpenAI) | ✅ | ✅ | `src/settings-loader.ts` (sin gate — ver `/conectar-mi-ia`) |

### Superpoderes automáticos (motores que corren solos)

| Superpoder | Free | Forja+ | Dónde se decide (código) |
|---|:--:|:--:|---|
| **Cazador de ventas** (follow-up 3-20h, 1 toque, cap 30/día) | 🔒 | ✅ | `src/followup/run.ts` (`if (!isPro) return`) |
| **Blindaje anti-invento** (verificador pre-envío) | 🔒 | ✅ | `src/settings-loader.ts:129-134`; `src/blindaje/verify.ts` |
| **Vigilante** (alerta de cliente enojado / venta en riesgo) | 🔒 | ✅ | `src/insights/alerts.ts` (`isPro`) |
| **Reporte diario** al dueño (cron 3am) | 🔒 | ✅ | toggle `daily_report`; `src/settings-loader.ts` (`isPro`) |
| **Multi-idioma** (espeja el idioma del cliente) | 🔒 | ✅ | toggle `multi_language`; `settings-loader.ts:129-134` |
| **Encuesta de satisfacción** (rating tras resolver) | 🔒 | ✅ | toggle `satisfaction_survey`; `src/followup/outreach.ts:90` (`isPro`) |
| **Reactivación de leads fríos** (2-7 días) | 🔒 | ✅ | toggle `reengage_cold_leads`; `src/followup/reengage.ts:56` (`isPro`) |
| **Solicitud de reseñas** (pide reseña tras venta) | 🔒 | ✅ | toggle `review_requests`; `src/followup/outreach.ts` (`isPro`) |

> Los 6 toggles del panel "⚡ Superpoderes" (`src/admin/views/config.ts`, sección
> gateada por `isPro`) son: `daily_report`, `multi_language`, `satisfaction_survey`,
> `reengage_cold_leads`, `review_requests`, `payments_enabled`. Cada uno es un setting
> de D1 — se prende/apaga sin redeploy. En free la sección entera no se renderiza.

### Panel de administración (`/admin`, Basic Auth en TODOS los tiers)

| Tab | Free | Forja+ | Dónde se decide (código) |
|---|:--:|:--:|---|
| Resumen, Bandeja/Conversaciones, Leads, Tickets, Flujo, KB, Conexiones, Config, Modelo de IA | ✅ | ✅ | fuera de `PRO_ONLY_TABS` |
| **Analista IA** (insights), **Estadísticas**, **Costos**, **Mejoras**, **Campañas**, **Cobros** | 🔒 | ✅ | `PRO_ONLY_TABS` en `config.ts:23` |

> ⚠️ **El panel `/admin` está protegido por Basic Auth en AMBOS tiers** (`src/admin/routes.ts:63-68`).
> El tier free también tiene panel con datos reales (leads, conversaciones, KB) — su
> contraseña (`DASHBOARD_PASSWORD`) importa igual. Y `DASHBOARD_PUBLIC="1"` apaga esa
> protección por completo (ver `mapa-forja.md` → Seguridad).

### Skills y catálogo

| | Free | Forja+ | Nota |
|---|:--:|:--:|---|
| **Todos los skills ya vienen instalados** desde el día 1 | ✅ | ✅ | No se "descarga" nada al subir |
| Skills que se **desbloquean** con Pro (verifican tier en su PASO 0) | 🔒 | ✅ | Cada skill declara su gate en su propio PASO 0 |
| Los **14 giros** en `forjabot install <slug>` | 🔒 | ✅ | `src/niches/` (14 + genérico) |

**Los 14 giros:** `barberia`, `cafeteria`, `clinica`, `coach`, `crm`, `dentista`,
`gimnasio`, `hoteleria`, `inmobiliaria`, `panaderia`, `restaurante`, `salon`, `spa`,
`tienda` (+ `generico` por default). Confirma contra `src/niches/` — es la lista real.

## Qué pasa EXACTAMENTE cuando el usuario activa Forja+

1. **Al instante (sin que nadie haga nada)**: el control plane (app.forjabots.com) le
   empuja `tier=pro` al Worker vía `POST /api/tier` → el bot lo persiste en
   `settings.tier_override` → superpoderes, Vista, Blindaje, Vigilante y las tabs Pro
   quedan prendidas en caliente, **sin redeploy**. Si el bot estaba offline, se
   auto-corrige la próxima vez que el usuario abra su vista en app.forjabots.com.
2. **Su licencia HZN** llega en la pantalla de bienvenida + correo + su panel.
3. **Lo que sí requiere un paso** (díselo tú): correr `npx forjabot update --key HZN-…`
   — valida la licencia, **estampa `BOT_TIER = "pro"` en el wrangler.toml** (persistente)
   y desbloquea los 14 giros. Después `pnpm install && pnpm run deploy` si bajó código.

## Diagnóstico rápido ("soy Forja+ pero algo sale como free")

1. `npx forjabot whoami` — ¿sesión correcta?
2. En el panel del bot (`/admin`), ¿las tabs Pro se ven o salen con candado?
3. Pídele al usuario abrir su bot en app.forjabots.com — esa visita auto-corrige el
   tier si está desfasado (empuja `POST /api/tier`).
4. Persistente: revisa `BOT_TIER` en `wrangler.toml` y corre
   `npx forjabot update --key <su HZN>` + `pnpm run deploy`.
5. Si nada: `npx forjabot doctor` y soporte (IG @sanmunoz.ia).

---

*Mantener esta tabla al día es lo que evita que los skills vuelvan a driftar. Si cambias
el tier de una capacidad, cámbialo en el CÓDIGO (la columna "dónde se decide") y aquí — en
ese orden. Los skills apuntan aquí, no re-declaran la división.*
