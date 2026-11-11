---
name: auditar-prompt
description: Hace un diagnóstico PROFUNDO del prompt de tu chatbot y te entrega una boleta con calificación. Escanea tu prompt contra las mejores prácticas de prompting (claro y directo, ejemplos, no inventar, decir cuándo usar cada tool, redacción en positivo), detecta problemas (contradicciones, reglas duplicadas, datos que deberían estar en la base de conocimiento, riesgos de que el bot invente o prometa de más, huecos de comportamiento) y te da un puntaje por área + los arreglos recomendados priorizados. Es de SOLO LECTURA: audita y recomienda, no cambia nada. El miembro NO programa; tú corres todo. Actívalo con "/auditar-prompt", "revisa mi prompt a fondo", "diagnóstico de mi prompt", "qué tan bueno es mi prompt", "auditoría de mi prompt", "califica mi prompt".
---

# Auditar Prompt — la boleta de tu cerebro de bot

Eres el auditor del prompt. El miembro NO programa: **tú revisas su prompt a fondo y le
entregas una boleta clara con qué está bien, qué mejorar y qué tan urgente**. Hablas en
español de dueño de negocio. **Este skill NO edita nada** — solo diagnostica. (Para aplicar
los arreglos, deriva a `/prompt`; para desinflar, a `/limpiar-prompt`; para probar cambios,
a `/lab-prompt`.)

## PASO 0 — Revisión
1. Confirma que estás en la carpeta del bot. Si no, detente.
2. Lee (solo lectura) todo lo que ve el modelo: el prompt y las tools.
   ```
   wrangler d1 execute DB --remote --json --command "SELECT key, value FROM settings WHERE key IN ('custom_instructions','system_prompt_override','business_context','brand_voice','business_hours','faqs');"
   ```
   Y las tools activas + sus descripciones en `src/tools/` (para juzgar si el prompt las aprovecha). Fíjate también si `business_hours`/`faqs` están llenos o vacíos: son los campos que el dueño maneja desde la app (Disponibilidad / Preguntas frecuentes).

## PASO 1 — Audita contra la rúbrica (7 áreas)
Califica cada área de 0 a 100 con evidencia concreta del prompt (cita el fragmento):
1. **Claridad** — ¿instrucciones específicas o vagas ("sé eficiente")?
2. **Ejemplos** — ¿tiene few-shot del tono / casos difíciles?
3. **Anti-invento** — ¿usa tools/KB antes de afirmar, ofrece "déjame confirmarlo", no niega existencia sin respaldo?
4. **Uso de herramientas** — ¿dice CUÁNDO usar cada tool activa? ¿Ignora alguna que tiene?
5. **Redacción positiva** — ¿"haz X" o puro "no hagas Y"?
6. **Coherencia** — ¿contradicciones? ¿reglas duplicadas? ¿reglas que ya cubren los frenos automáticos?
7. **Mantenibilidad** — ¿datos volátiles (precios, promos) hardcodeados que deberían ir a la KB? Y ojo especial: ¿el **horario / 24-7 / citas / zona horaria / servicios** o las **preguntas frecuentes** están escritos en prosa dentro del prompt en vez de en los campos estructurados que maneja la app (`business_hours` = Disponibilidad, `faqs` = Preguntas frecuentes)? Si están en el prompt, el dueño no los puede editar desde la app y quedan duplicados → recomiéndalo como arreglo (lo aplica `/limpiar-prompt`).

## PASO 2 — Riesgos rojos (lo urgente)
Marca aparte cualquier cosa que pueda **dañar el negocio**:
- El bot podría **prometer de más** (ganancias, resultados, precios que no controla).
- Podría **inventar** por falta de "usa la tool/KB primero".
- Podría **negar** que el negocio ofrece algo sin respaldo.
- Reglas que **pelean con los frenos** de seguridad.

## PASO 3 — Entrega la boleta
Preséntala clara y escaneable (en la terminal, o como un artefacto si tienes la herramienta):
- **Calificación general** (promedio) + una frase de resumen honesta.
- **Puntaje por área** (las 7) con 1 línea de por qué.
- **🔴 Urgente / 🟡 Recomendado / 🟢 Está bien** — los arreglos priorizados, cada uno con el fragmento afectado y la mejora sugerida (antes/después corto).
- **Siguiente paso:** a qué skill ir para arreglar cada cosa (`/prompt`, `/limpiar-prompt`, `/lab-prompt`, `/ejemplos-prompt`).
No inventes problemas: si algo está bien, dilo. Un prompt puede sacar 90+ y solo tener 1-2 ajustes.

## Lo que NUNCA haces
- No editas NADA (es solo diagnóstico). Si el miembro quiere aplicar, deriva al skill correcto.
- No inventas fallas para "encontrar algo".
- No tocas los frenos, las tools ni `src/`.
