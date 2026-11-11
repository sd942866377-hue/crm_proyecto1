# Launch Checklist — Horizontes IA Bot Template (PRO)

Lista de verificación para lanzar el template a la comunidad de Horizontes IA.

Este repo es el tier **PRO** (`BOT_TIER=pro`). El tier Free vive en un **repo separado**.
Cada vez que esta checklist menciona "ambos repos", se refiere a Free + Pro como
proyectos de Git independientes (no monorepo, no submódulos). Las features Pro-only
(handoff por Email/WhatsApp, Sonnet auto-upgrade, dashboard analytics extendido,
`/actualizar-mi-bot`) viven SOLO aquí.

Stack de referencia: Cloudflare Workers + Hono + Durable Objects (agents SDK,
`SupportAgent`), D1, Vectorize (1024-dim BGE), R2, Workers AI (Whisper),
Anthropic Haiku 4.5 (`claude-haiku-4-5-20251001`) con auto-upgrade a Sonnet,
AI SDK v6 (`ai` + `@ai-sdk/anthropic`). Gestor de paquetes: **pnpm**.

---

## Fase 0 — Pre-launch (interno, antes de invitar a nadie)

### Calidad de código

- [ ] `pnpm typecheck` → 0 errores.
- [ ] `pnpm test` → todos los tests en verde (suite actual: 122 tests, 35 archivos).
- [ ] Ningún archivo `.test.ts` bajo `src/` (los tests viven solo en `test/**/*.test.ts`).
- [ ] `pnpm deploy-check` pasa (predeploy + validaciones previas al deploy).
- [ ] No hay secrets hardcodeados en el repo (revisar `git grep -i "api_key\|secret\|token"` contra valores literales).
- [ ] `.dev.vars` y `.env*` están en `.gitignore` y NO trackeados.

### Documentación

- [ ] `README.md` describe el setup del tier PRO y enlaza al repo Free.
- [ ] `LICENSE` es Apache 2.0 + cláusula no-reventa (ver Task 14.5).
- [ ] `docs/` cubre: setup inicial, variables de entorno, deploy, y troubleshooting.
- [ ] Skills documentadas: `configurar-mi-chatbot`, `actualizar-mi-bot`, y references
      (`nicho-templates/*` ×9, `channel-setup-guides/*` ×3, `troubleshooting`).
- [ ] La guía de `/configurar-mi-chatbot` está probada end-to-end por alguien que NO escribió el código.

### Infraestructura Cloudflare

- [ ] `wrangler.toml` (o `wrangler.jsonc`) con bindings correctos: D1, Vectorize, R2, Workers AI, DO.
- [ ] D1: `pnpm db:apply` (local) y `pnpm db:apply:remote` (prod) aplican el schema sin error.
- [ ] Vectorize index creado con dimensión **1024** (BGE). Verificar que `kb:reindex` (→ `scripts/generate-fixtures.ts`) puebla embeddings.
- [ ] R2 bucket creado y accesible.
- [ ] Durable Object `SupportAgent` migrado/registrado en `wrangler`.

### Variables de entorno / secrets (PRO)

- [ ] `ANTHROPIC_API_KEY` configurado como secret.
- [ ] `DASHBOARD_PASSWORD` configurado (auth dashboard = HTTP Basic Auth, usuario `admin`).
- [ ] `OWNER_TELEGRAM_CHAT_ID` (handoff por Telegram DM — canal default).
- [ ] Opcional Email: `RESEND_API_KEY` + `OWNER_EMAIL`.
- [ ] Opcional WhatsApp Pro: `TWILIO_HANDOFF_CONTENT_SID` (Content Template, NO texto libre) + credenciales Twilio.
- [ ] `BOT_TIER=pro` seteado.
- [ ] `version:write` corre en `predeploy` para estampar la versión.

### Smoke test funcional

- [ ] `pnpm dev` arranca local sin error.
- [ ] Conversación básica funciona (mensaje → respuesta del bot con RAG sobre KB).
- [ ] Handoff a humano dispara notificación a Telegram DM.
- [ ] Dashboard accesible con HTTP Basic Auth (`admin` / `DASHBOARD_PASSWORD`).
- [ ] Mensaje de voz (audio) se transcribe vía Whisper y se responde.
- [ ] `pnpm eval` (→ `scripts/eval-bot-live.ts`) corre contra un deploy real y reporta métricas aceptables.

---

## Fase 1 — Alpha (3–5 usuarios de confianza)

Objetivo: validar que alguien externo puede clonar, configurar y desplegar el PRO sin tu ayuda.

- [ ] Seleccionar 3–5 miembros de Horizontes IA con perfil técnico (saben usar terminal).
- [ ] Darles acceso al repo PRO (privado) y al repo Free como referencia.
- [ ] Cada alpha tester completa `/configurar-mi-chatbot` desde cero y reporta fricciones.
- [ ] Validar el setup en al menos 2 sistemas operativos (macOS + Windows/WSL o Linux).
- [ ] Probar al menos 3 de los 9 `nicho-templates` con datos reales del tester.
- [ ] Probar los 3 `channel-setup-guides` (canales de mensajería soportados).
- [ ] Verificar `/actualizar-mi-bot`: hace `git pull` + `pnpm install` + deploy (SIN API de nivel Skool).
- [ ] Recolectar bugs en un tracker y clasificarlos (blocker / mayor / menor).
- [ ] Cerrar todos los blockers antes de pasar a Beta.

### Criterios de salida de Alpha

- [ ] ≥80% de alpha testers logran un deploy funcional sin intervención directa.
- [ ] 0 blockers abiertos.
- [ ] Tiempo medio de setup documentado (meta: < 60 min para un usuario técnico).

---

## Fase 2 — Beta (cohorte ampliada de la comunidad)

Objetivo: estresar la documentación, los nichos y los canales con una audiencia más amplia y menos técnica.

- [ ] Abrir beta a una cohorte mayor (p. ej. 20–50 miembros) vía Skool.
- [ ] Publicar guía de onboarding en Skool con video walkthrough de `/configurar-mi-chatbot`.
- [ ] Habilitar un canal de soporte beta (thread en Skool o canal dedicado).
- [ ] Monitorear costos de Anthropic/Workers AI por usuario para validar el modelo de costos.
- [ ] Confirmar que el auto-upgrade Haiku → Sonnet se dispara solo cuando corresponde (no en cada turno).
- [ ] Validar handoff por los 3 canales: Telegram (default), Email (Resend), WhatsApp (Twilio Content Template).
- [ ] Probar `/actualizar-mi-bot` end-to-end con beta testers que ya tienen un bot viejo desplegado.
- [ ] Recolectar feedback de los 9 nichos; ajustar templates que generen más confusión.
- [ ] Iterar `docs/troubleshooting` con los errores reales reportados.
- [ ] Confirmar que el flujo de actualización Free → Pro está claro (qué gana quien migra de repo).

### Criterios de salida de Beta

- [ ] NPS / satisfacción de beta ≥ umbral acordado.
- [ ] Documentación de troubleshooting cubre el top 10 de problemas reportados.
- [ ] Costos por bot dentro del rango esperado (sin sorpresas de facturación).
- [ ] 0 blockers; bugs mayores con workaround documentado.

---

## Fase 3 — GA (General Availability)

Objetivo: lanzar públicamente a toda la comunidad de Horizontes IA.

### Pre-GA

- [ ] Tag de versión **v0.1.0** creado (lo hace Santi manualmente — NO automatizado en esta checklist).
- [ ] `CHANGELOG` / notas de release listas, con diferencias claras entre Free y Pro.
- [ ] `LICENSE` final revisada (Apache 2.0 + cláusula no-reventa) en ambos repos, con la cláusula
      adicional aplicando SOLO al repo PRO.
- [ ] README de ambos repos enlaza al otro y deja claro qué tier es cada uno.
- [ ] Página de venta / acceso del PRO lista (cómo se obtiene el acceso al repo PRO).

### Lanzamiento

- [ ] Anuncio en Skool + YouTube + short-form.
- [ ] Video tutorial de instalación publicado.
- [ ] Soporte de lanzamiento activo (primeras 48–72 h con respuesta rápida).
- [ ] Monitoreo de errores en producción de los primeros bots desplegados.

### Post-GA

- [ ] Revisar métricas de adopción (cuántos bots desplegados, cuántos activos).
- [ ] Recopilar testimonios para marketing.
- [ ] Backlog priorizado para la siguiente versión.
- [ ] Proceso de actualización (`/actualizar-mi-bot`) validado en producción con usuarios reales de GA.

---

## Notas sobre repos separados Free / Pro

- **No es monorepo.** Free y Pro son repos Git independientes. Los cambios comunes (core del agente,
  RAG, schema base) deben portarse manualmente o vía cherry-pick entre ambos.
- **Features Pro-only** que NO deben filtrarse al repo Free: handoff por Email/WhatsApp,
  Sonnet auto-upgrade, dashboard analytics extendido, `/actualizar-mi-bot`.
- **`/actualizar-mi-bot`** (Pro) = `git pull` + `pnpm install` + deploy. NO usa la API de nivel de Skool;
  cualquiera con acceso al repo PRO puede actualizar.
- **Licencia:** ambos repos llevan Apache 2.0; el repo PRO añade la cláusula no-reventa (Task 14.5).
- Al sincronizar fixes de seguridad, aplicar primero al repo con más exposición y luego portar.
