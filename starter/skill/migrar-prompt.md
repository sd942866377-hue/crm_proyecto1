---
name: migrar-prompt
description: Migra un bot que está en "modo experto" (un system_prompt_override monolítico que reemplaza TODO) al formato ESTRUCTURADO por secciones — datos del negocio en business_context, comportamiento en custom_instructions, conocimiento largo en la KB, y los frenos/tools/idioma los pone el motor solo. El resultado es un cerebro más ordenado, editable por secciones desde la app, con frenos que se actualizan solos, y (moviendo datos a la KB) más barato por mensaje. El miembro NO programa; tú corres todo con respaldo, prueba A/B y confirmación, y NUNCA cambias lo que el bot hace sin probarlo. Actívalo con "/migrar-prompt", "estructura mi prompt", "saca mi bot del modo experto", "migra mi override a secciones", "quiero editar mi prompt más fácil", "ordena mi prompt bien", o cuando /prompt detecte un system_prompt_override y el miembro quiera pasarlo a secciones.
---

# Migrar Prompt — del override monolítico al formato estructurado

Sacas un bot del "modo experto" (`system_prompt_override`, un bloque gigante que reemplaza el prompt entero) y lo pasas al modelo por SECCIONES, para que el dueño lo edite fácil desde la app y los frenos se actualicen solos. El miembro NO programa: tú lees su override, lo clasificas, lo partes, lo PRUEBAS y solo aplicas con su "sí". La regla sagrada: **el comportamiento no debe cambiar** — por eso se prueba antes de aplicar.

Por qué migrar: un override viaja COMPLETO en cada mensaje (caro, lento, "lost in the middle"), congela los frenos a mano, y no deja editar por secciones ni usar los campos de la app. El formato estructurado separa: **datos → business_context**, **comportamiento → custom_instructions**, **conocimiento largo → KB (searchKb, se jala solo)**, y **frenos/tools/idioma/estilo → los genera el motor**.

SIGUE ESTO AL PIE DE LA LETRA. Empieza por el PASO 0.

## PASO 0 — Revisión y respaldo (OBLIGATORIO)
1. Confirma que estás en la carpeta del bot (`package.json` + `wrangler.toml`). Si no, detente.
2. `git status` y anota el commit (`git rev-parse --short HEAD`).
3. **Respalda TODO el D1 antes de tocar nada:**
   ```
   wrangler d1 execute DB --remote --json --command "SELECT key, value FROM settings" > member/backup-settings-<fecha>-pre-migracion.json
   ```
   Sin respaldo NO sigas. Es la reversa (restaurar el override = re-insertar esa fila).
4. Lee el override: `SELECT value FROM settings WHERE key='system_prompt_override'`. Si está **vacío/no existe**, el bot YA está seccionado → dile que no hay nada que migrar y usa `/prompt` normal. Si existe, sigue.

## PASO 1 — Diagnóstico: clasifica cada sección del override
Lee el override completo y clasifica cada bloque/párrafo en una de cuatro:
- **REGLA → `custom_instructions`** (tope 16000): comportamiento, persona, tono, flujos (cómo califica leads, cómo explica el producto, soporte, etc.), reglas propias del dueño.
- **DATO → primero a su CAMPO ESTRUCTURADO** (así el dueño lo edita desde la app y queda ACOMODADO, no en un bloque de prosa). Antes de mandar nada a `business_context`, revisa si el dato encaja en un campo:
  - Pares **pregunta→respuesta** cortos ("¿hacen envíos?", "¿cuánto cuesta X?", "¿aceptan tarjeta?") → **`faqs`** (la app los pinta como lista editable; el bot los inyecta).
  - **Horario / 24-7 / si agenda citas / zona horaria / servicios agendables** → **`business_hours`** (pantalla Disponibilidad).
  - **Ubicación / dirección / local vs domicilio vs online / zonas de cobertura** → **`location`**.
  - **Formas de pago** (efectivo, tarjeta, transferencia, MSI…) → **`payment_methods`**.
  - **Servicios con precio** (lista corta) → **`catalog`**.
  - **Oferta/promo vigente** → **`promo`** (con on/off + vencimiento).
  - El **resto** de datos canon que no encaja en un campo → **`business_context`** (≤12000, siempre en el prompt).
  - Lo **largo o volátil** (temarios, catálogos extensos, FAQ largas, tablas de links) → **KB** (`member/kb/*.md`, searchKb lo jala cuando aplica).
- **MEDIA (`[[media: id]]`)**: los assets ya viven en `settings` (`media_meta:*`). En modo generado la sección `<galeria>` se **auto-puebla** de ahí si `galeria_enabled=1` y el bot es Pro. NO la recopies al texto.
- **RUIDO / lo cubre el motor → se quita**: los frenos genéricos (no inventar, escalación, idioma, estilo "no headers/tablas/emojis", anti-patrones, lista de tools) los GENERA el motor. NO los recopies — recopiarlos los congela y estorba.

Estima tamaños. Si las REGLAS pasan de 16000 o los DATOS canon de 12000: mueve MÁS datos a la KB, o aprieta la redacción (`/limpiar-prompt` sirve de apoyo). **Si aun así no cabe sin recortar lo que el bot HACE, dilo honesto:** ese bot es tan rico que el override es su mejor contenedor; ofrece dejarlo en override + los campos estructurados de la app (promo/horario/faqs/ubicación/pago/servicios), que sí aplican encima. No fuerces una migración que gutea el bot.

## PASO 2 — Construye las secciones (en ARCHIVOS, muéstraselas)
- **`business_context`**: los datos canon, en texto plano con etiquetas simples (MAYÚSCULAS). NUNCA metas tags de sistema (`<business_context>`, `<role>`, `<core_principles>`, `<galeria>`, etc.): el validador los rechaza. ≤12000.
- **`custom_instructions`**: el comportamiento/persona/flujos. NO recopies los frenos genéricos (el motor los pone). ≤16000. Tip: si el bot habla en primera persona como una persona (ej. el dueño), pon `bot_name` con ese nombre (el rol generado dirá "Eres <nombre>, el asistente de <negocio>") y aclara en custom_instructions el "primera persona / soy la IA de <nombre>".
- **Campos estructurados** (`faqs`, `business_hours`, `location`, `payment_methods`, `catalog`, `promo`): arma el JSON de cada uno con lo que clasificaste en el PASO 1. Formas exactas en `/prompt` y `/limpiar-prompt`. Estos se guardan como settings y la app los pinta editables.
- **KB (`member/kb/*.md`)**: lo largo/volátil. En el prompt deja un puntero: "si preguntan por X, searchKb; resumen: …".
- **`custom_instructions`** (comportamiento) y **`business_context`** (el resto de datos): ver arriba.
- Escribe todo a archivos primero (ej. `member/migracion-<fecha>/`). NO toques D1 todavía.

## PASO 2.5 — Huecos: pregunta lo que falta (esto hace la diferencia)
Después de acomodar el contenido en sus campos, revisa qué campos estructurados quedaron **vacíos o incompletos que un negocio de este giro normalmente SÍ tendría** (una barbería sin horario, sin formas de pago, sin ubicación; una tienda sin servicios/precios; nadie con una promo puesta). Para cada hueco relevante, **PREGÚNTALE al dueño en lenguaje simple**, una cosa a la vez:
- "¿En qué horario atiendes?" · "¿Aceptas citas o eres 24/7?"
- "¿Dónde estás? ¿Atiendes en local, a domicilio, o en línea? ¿Qué zonas cubres?"
- "¿Qué formas de pago aceptas?"
- "¿Cuáles son tus servicios y precios principales?"
- "¿Tienes alguna oferta o promoción activa ahora?"
Llena el campo con SU respuesta. **NUNCA inventes** un dato; si no lo sabe o no aplica a su giro (ej. un negocio 100% online no tiene ubicación física), déjalo vacío y sigue. La meta: que el bot quede COMPLETO y que el dueño lo edite fácil desde la app, no un prompt a medias.

## PASO 3 — Ensambla y valida (sin aplicar)
- Reconstruye el prompt GENERADO como lo armaría el motor (el `TEMPLATE` de `src/system-prompt.ts` + las secciones nuevas: role, business_context, identity, galería, custom_instructions, core_principles, escalation, style, anti_patterns, tools) y **muéstraselo** al miembro para que vea su cerebro final.
- **Valida que NADA crítico se perdió**: todos los media IDs, links, nombres de tools y datos canon del override deben estar en la unión (secciones + KB). Reporta el chequeo.

## PASO 4 — Prueba que se comporta IGUAL (sin llave — TÚ simulas el A/B)
El prompt nuevo es estructuralmente distinto (frenos generados), así que el output no será byte-idéntico — hay que probar que **se comporta bien**. **No necesitas la llave del proveedor:** TÚ (Claude) simulas el A/B, igual que `/lab-prompt`.
- Escribe **5-7 preguntas/escenarios clave** del bot: los que tocan sus flujos (precio/producto, un lead típico, un caso de soporte) y sus frenos ("¿cuánto gano?" → no prometer, "¿eres un bot?" → admitir IA, algo fuera de tema → redirigir).
- Para cada uno, **actúa la respuesta del bot DOS veces**: una usando el **override VIEJO** como system prompt, otra usando el **prompt NUEVO ensamblado** (PASO 3). Cuando el bot llamaría una tool (searchKb, etc.), **mockéala** con un resultado plausible y CONSISTENTE entre las dos versiones (o el A/B no es justo).
- **Compara lado a lado** (arma un artefacto o una tabla). Los frenos deben sostenerse y los flujos dar el mismo resultado. Si algo cambió a peor, ajústalo en las secciones (PASO 2) y re-simula.
- Si el miembro quiere, ofrécele un A/B más fuerte con conversaciones multi-turno vía `/lab-prompt`, y la validación final contra el bot REAL (ya aplicado) con `/cliente-misterioso`.

## PASO 5 — Aplica solo con su "sí"
Con su OK explícito, en vivo y sin redeploy:
```
# apply-migracion.sql (duplica cada comilla simple ' → '' dentro de los textos)
INSERT INTO settings (key,value,updated_at) VALUES ('business_context','…',strftime('%s','now')*1000)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
INSERT INTO settings (key,value,updated_at) VALUES ('custom_instructions','…',strftime('%s','now')*1000)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
-- (tone, bot_name si aplica, mismo patrón)
-- Y los CAMPOS ESTRUCTURADOS que armaste/preguntaste (mismo patrón, value = su JSON):
-- faqs, business_hours, location, payment_methods, catalog, promo
DELETE FROM settings WHERE key='system_prompt_override';   -- EL SWITCH a modo generado
```
```
wrangler d1 execute DB --remote --file=apply-migracion.sql
```
- Los **overrides por CANAL** (`system_prompt_override:twilio`, etc.) son migración APARTE: avísale que WhatsApp/otros canales siguen en su override hasta que los migres igual. Borra keys de override muertas si detectas alguna que ningún canal lee.

## PASO 6 — KB y verificación final
- Si moviste datos a la KB: `pnpm kb:reindex` + `wrangler deploy` + `POST /kb/reindex` (header `X-Reindex-Token: $KB_REINDEX_TOKEN`) para que searchKb los sirva. Mientras no reindexes, lo que mandaste a la KB responde con el resumen del prompt (degrada suave, no rompe).
- Dile que chatee sus casos clave y confirme. Si algo se ve mal, restaura el override del backup del PASO 0.

## Lo que NUNCA haces
- No aplicas sin **backup** (PASO 0) ni sin su **"sí"**.
- No **recopias los frenos** a mano — el motor los genera; recopiarlos los congela.
- No borras el `system_prompt_override` **antes** de haber construido, ensamblado y **probado** las secciones.
- No metes **tags de sistema** en `business_context` (el validador lo rechaza).
- No **fuerzas** la migración si no cabe en los topes sin recortar lo que el bot hace: mejor déjalo en override + los campos estructurados de la app.
- No tocas `src/`, los frenos, ni las tools.
