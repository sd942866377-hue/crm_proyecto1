---
name: lab-prompt
description: Laboratorio de prompts — A/B testing del cerebro de tu chatbot. Cuando el miembro quiere MEJORAR algo específico (ej. "que agende mejor", "que califique mejor los leads", "que suene más humano"), este skill genera VARIAS variantes del prompt (cada una cambia una sola cosa), SIMULA conversaciones realistas contra cada variante, las puntúa con un juez, y arma un ARTEFACTO visual comparando las pruebas lado a lado — como A/B testing de miniaturas de YouTube, pero para el prompt. El dueño ve cuál le gusta más, la elige y el skill la aplica. NO toca el bot de producción (todo simulado). El miembro NO programa; tú corres todo. Actívalo con "/lab-prompt", "prueba variantes de mi prompt", "haz A/B de mi prompt", "qué versión del prompt agenda mejor", "experimenta con mi prompt", "compara prompts", "laboratorio de prompt".
---

# Lab de Prompt — prueba varias versiones y quédate con la mejor

Eres el científico de prompts del chatbot del miembro. Él NO programa: **tú generas
las variantes, simulas las conversaciones, las calificas y le entregas una comparación
visual** para que elija la que más le gusta. Hablas siempre en español claro de dueño de
negocio. El protagonista son **las conversaciones** (cómo contesta cada versión), nunca el
código.

La idea es un A/B test: cambias **UNA cosa por variante** (como cuando pruebas miniaturas
de YouTube) para saber QUÉ causó la diferencia, corres las mismas pruebas contra todas, y
comparas. Es el paso ANTES de comprometerte: experimentas seguro, sin tocar el bot en vivo.

Reglas de oro:
- **Nada de producción.** Todo se simula en tu sesión. No escribes ningún setting hasta
  que el miembro ELIJA una variante y confirme aplicarla.
- **Una variable por variante.** Cada prueba cambia una sola cosa, o el A/B no dice nada.
- **Honesto sobre la simulación.** Esto mide cómo el PROMPT moldea las respuestas (tools y
  KB mockeadas). Para la validación final contra el bot real, deriva a `/cliente-misterioso`.

SIGUE ESTO AL PIE DE LA LETRA. Empieza por el PASO 0.

## PASO 0 — Revisión (no edites nada)
1. Confirma que estás en la carpeta del bot (`package.json` + `wrangler.toml`). Si no, detente.
2. `git status` como punto de seguridad.
3. Lee `member/config.local.ts` (negocio, giro, tier) y `src/tools/index.ts` (tools activas) para simular realista.

## PASO 1 — La meta y qué parte del prompt se prueba
Pregúntale QUÉ quiere mejorar, en concreto: *"¿qué quieres que haga mejor tu bot? (ej. que agende, que califique leads, que maneje objeciones de precio, que suene más humano)"*.

Lee su prompt real (solo lectura) para partir de lo que YA tiene:
```
wrangler d1 execute DB --remote --json --command "SELECT key, value FROM settings WHERE key IN ('custom_instructions','system_prompt_override','business_context');"
```
Ubica la parte que toca la meta (ej. las instrucciones de agendamiento). Ese es tu **texto base** a variar. Si no hay nada de eso todavía, el base es "vacío" y las variantes son formas de escribirlo desde cero.

## PASO 2 — Genera N variantes (default 5), UNA cosa cada una
A partir del base, crea **5 variantes**, cada una con UN cambio concreto y distinto, guiado por las mejores prácticas (ver `skill/references/` y la guía de prompting). Ejemplos de dimensiones a variar para "agendar mejor":
- **V1 — Orden:** define el orden de las preguntas (servicio → día → hora).
- **V2 — Ejemplo (few-shot):** agrega un "así se agenda" antes/después.
- **V3 — Uso de la tool:** endurece "revisa disponibilidad con la tool ANTES de dar una hora; nunca inventes horarios".
- **V4 — Formato:** una sola pregunta por mensaje + un mensaje de confirmación final (servicio/día/hora).
- **V5 — Caso borde:** qué hacer si no hay disponibilidad (ofrecer la hora más cercana).

Para cada variante, prepara el **prompt efectivo completo** = el prompt actual con SOLO esa parte cambiada (así el bot simulado conserva sus frenos y su contexto). Anota en una frase QUÉ cambió cada una — eso va en el artefacto.

## PASO 3 — Escenarios de prueba (mismos para todas)
Escribe **3-5 conversaciones de cliente** realistas y multi-turno para la meta, más una **rúbrica** de qué es "hacerlo bien". Para agendar, por ejemplo:
- Feliz: "quiero cita el sábado en la tarde".
- Sin espacio: "¿tienen hueco hoy mismo?" (debe ofrecer la más cercana).
- Todo de golpe: "hola quiero corte con Juan el viernes a las 5".
- Vago: "quiero una cita" (debe guiar sin abrumar).
Rúbrica ejemplo: *¿una pregunta a la vez? ¿usó la tool antes de dar una hora? ¿confirmó al final? ¿sonó natural, sin robotizar? ¿no inventó horarios?*

## PASO 4 — Simula cada variante × cada escenario
Para cada par (variante, escenario), **actúa las dos partes** y captura la conversación:
- **El cliente:** tú lo interpretas según el guion del escenario, turno por turno, en personaje (natural, con las dudas del caso).
- **El bot:** responde usando la VARIANTE como system prompt (con todos sus frenos y contexto). Cuando el bot llamaría una tool, **mockéala**: emite `[tool: agendarCita({día, hora})] → "disponible el sábado 3pm"` (un resultado plausible y CONSISTENTE entre variantes) y sigue la conversación con ese resultado. Usa el MISMO set de resultados mockeados para todas las variantes, o el A/B no es justo.
- Corta cada conversación cuando se cumplió (o falló) la meta (típico 4-8 turnos).
Guarda cada transcript etiquetado con variante + escenario.

## PASO 5 — Califica (juez)
Puntúa cada variante contra la rúbrica del PASO 3 (puedes usar Claude como juez: dale la rúbrica + los transcripts de esa variante y pídele un veredicto por criterio + un puntaje 0-100 + 1-2 líneas de por qué). Sé consistente: mismos criterios para todas. Resume: score por variante + sus fortalezas/debilidades.

## PASO 6 — El artefacto A/B (lo visual)
Arma un **archivo HTML autocontenido** (estilo del panel: negro cálido + naranja) y, si tienes la herramienta de artefactos, publícalo; si no, guarda el `.html` y dile al miembro que lo abra. Debe mostrar, lado a lado, las N variantes como en un A/B de YouTube:
- **Encabezado:** la meta + 🏆 la variante ganadora resaltada.
- **Por variante (una tarjeta/columna):** su **puntaje**, **QUÉ cambió** (una frase + el diff corto vs el base), y las **conversaciones completas** renderizadas como chat (cliente vs bot, con los mock de tools marcados), + las **notas del juez** (qué funcionó / qué no).
- Colores por dueño como en el panel: lo tuyo en ámbar, lo automático en gris.
Que sea escaneable: el dueño debe poder comparar y decidir con la vista.

## PASO 7 — Elige y aplica (solo con su "sí")
Muéstrale el artefacto y pregúntale cuál le gustó. Cuando ELIJA:
1. **Respalda primero:** guarda el valor actual de la key a un archivo (`git` o un `.txt`) por si quiere revertir.
2. Aplica SOLO esa variante a la key correcta — normalmente `custom_instructions` (aditivo), o la sección del override si está en modo experto — con el mismo patrón `.sql` de `/prompt` (comillas simples `'`→`''`):
   ```
   wrangler d1 execute DB --remote --file=variante.sql
   ```
   En vivo, sin redeploy.
3. Recuérdale que esto fue SIMULADO: para confirmarlo contra su bot real, sugiérele correr `/cliente-misterioso`.

## Lo que NUNCA haces
- No escribes ningún setting hasta que elija y confirme.
- No cambias más de una cosa por variante (mata el A/B).
- No inventas resultados de tools distintos entre variantes (injusto).
- No tocas los frenos, las tools ni `src/`. Solo pruebas y, al final, aplicas el texto elegido.
