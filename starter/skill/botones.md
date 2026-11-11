---
name: botones
description: Botones tocables en las respuestas del bot (opt-in) — el bot ofrece hasta 3 opciones que el cliente toca en vez de escribir (confirmar cita, elegir servicio, sí/no). Funcionan en WhatsApp, Instagram, Messenger, Telegram y Zernio; en canales sin soporte salen como lista numerada. Actívalo con "/botones", "quiero botones en mi bot", "que el bot mande opciones tocables", "botones de respuesta rápida", "quick replies", "apaga los botones".
---

# Botones tocables — opciones que el cliente toca, no escribe

Eres quien le configura los botones al bot del miembro. Él NO programa: **tú le
explicas qué son, le PREGUNTAS si los quiere (son opt-in, vienen apagados), los
prendes y lo ayudas a definir cuándo usarlos**. Habla en español de dueño de
negocio; el protagonista es cómo cambia la experiencia de SUS clientes.

## Qué son (explícaselo así)

Cuando el bot hace una pregunta cerrada ("¿confirmamos tu cita?", "¿qué servicio
te interesa?"), en vez de esperar a que el cliente escriba, le muestra **hasta 3
botones para tocar**. Menos fricción, respuestas más rápidas, menos abandono.
El bot decide solo CUÁNDO ofrecerlos (solo en elecciones simples, nunca en
preguntas abiertas) y el tap le llega como si el cliente hubiera escrito.

## Dónde funcionan (dilo según SUS canales conectados)

Lee el `wrangler.toml` y `member/config.local.ts` para ver qué canales tiene:

| Canal del bot | Cómo se ven |
|---|---|
| WhatsApp (API de Meta) | Botones nativos de respuesta (máx 3) |
| Instagram / Messenger | Quick replies (chips tocables) |
| Telegram | Teclado de opciones de una sola vez |
| Zernio | Botones nativos en WhatsApp/IG/FB/Telegram; lista numerada en X/SMS |
| Twilio, Kapso, YCloud, chat web | Lista numerada en texto (fallback automático — nada se rompe) |

## PASO 0 — Revisión

1. Confirma que estás en la carpeta del bot (`wrangler.toml` + `package.json`).
2. Lee el estado actual:
   ```bash
   wrangler d1 execute DB --remote --json --command "SELECT value FROM settings WHERE key='buttons_enabled';"
   ```
   Vacío o "0" = apagados (el default). "1" = ya están prendidos.
3. Cuéntale en 2 líneas qué son y en cuáles de SUS canales se verían nativos.

## PASO 1 — Pregunta (opt-in de verdad)

Pregúntale directo: **"¿Quieres que tu bot ofrezca botones tocables cuando haga
preguntas cerradas? Se puede apagar cuando quieras."** Espera su sí. Si dice que
no, no toques nada y dile que con `/botones` se prenden cuando guste.

## PASO 2 — Prende el switch (en caliente, sin redeploy)

```bash
wrangler d1 execute DB --remote --command "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('buttons_enabled', '1', $(( $(date +%s) * 1000 )));"
```

Con eso el prompt generado del bot aprende el formato y empieza a ofrecer
botones donde tenga sentido. **Efecto inmediato** en el siguiente mensaje.

> ⚠️ Si el bot usa un **prompt override** (modo experto, `system_prompt_override`),
> el switch no le enseña nada: el override reemplaza el prompt completo. En ese
> caso agrega al override (o a sus `custom_instructions`) la regla del marcador:
> terminar con `[[botones: Opción A | Opción B]]` (máx 3, títulos ≤20 caracteres)
> solo en elecciones cerradas.

## PASO 3 — Ayúdale a definir CUÁNDO (lo más valioso)

Los botones genéricos ya funcionan solos, pero brillan con reglas del negocio.
Pregúntale: **"¿En qué momentos de tu atención una elección corta ayudaría?"**
y sugiere según su giro:

- Citas/reservas: confirmar horario → `[[botones: Sí, confirmar | Otro horario]]`
- Restaurante: `[[botones: Ver menú | Hacer pedido | Ubicación]]` al saludar
- Servicios: elegir entre sus 2-3 servicios estrella al calificar al lead
- Cierre: `[[botones: Agendar visita | Hablar con alguien]]`

Lo que elija se escribe como reglas en sus **custom_instructions** (aditivas, no
tocan frenos — usa el flujo del skill `/prompt`, opción Instrucciones), por
ejemplo: *"Al confirmar una cita ofrece botones Sí, confirmar / Cambiar hora"*.

## PASO 4 — Pruébalo con él

Que le escriba al bot por su canal principal algo que dispare una elección
("quiero agendar"). Verifica que los botones aparecen y que al tocar uno el bot
avanza sin repetir opciones. Si su canal es de los de fallback, muéstrale la
lista numerada y explícale que ahí es lo máximo que permite la plataforma.

## Apagarlos

```bash
wrangler d1 execute DB --remote --command "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('buttons_enabled', '0', $(( $(date +%s) * 1000 )));"
```
Y si escribió reglas de botones en sus custom_instructions, quítalas también.

## Reglas duras

- **Opt-in siempre**: nunca los prendas sin su sí explícito.
- **Máx 3 opciones, títulos ≤20 caracteres** (límite de WhatsApp; el runtime
  recorta, pero mejor bien de una).
- No prometas botones nativos en canales de fallback (Twilio/Kapso/YCloud/web).
- Los botones no cambian frenos, tools ni escalación — es solo formato de salida.
