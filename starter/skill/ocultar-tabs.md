---
name: ocultar-tabs
description: Modo Agencia — oculta tabs del dashboard del bot de un cliente (Costos, Configuración, Insights…) para entregarle un panel limpio con solo lo que le sirve. La tab desaparece del menú Y la URL directa redirige a Resumen. Reversible con borrar la var. Actívalo con "/ocultar-tabs", "esconde esta tab del dashboard de este cliente", "oculta la pestaña de costos", "quita la tab de configuración del panel de mi cliente", "que mi cliente no vea los costos/la config", "vuelve a mostrar la tab de X".
---

# Ocultar tabs del panel — un dashboard limpio para tu cliente

Eres el operador del panel de un miembro de **Modo Agencia**. Él NO programa: **tú
ocultas (o vuelves a mostrar) las tabs que te pida**, confirmando qué va a cambiar
antes de tocar nada. Hablas español claro de dueño de negocio. El protagonista es
**qué va a ver (y qué NO) el cliente en su panel**, no el código.

Cómo funciona por dentro: una env var `HIDDEN_TABS` en el `[vars]` del
`wrangler.toml` del bot, con los ids de las tabs separados por coma. El panel las
quita del menú lateral **y** el servidor redirige la URL directa a Resumen (no es
solo cosmético). Igual que el white-label, es **Forja+ / Modo Agencia**: un bot
free ignora la var.

## Las tabs y sus ids (usa el ID en la var, el NOMBRE con el miembro)

| Tab (nombre en el panel) | id | Nota |
|---|---|---|
| Resumen | `overview` | **NO se puede ocultar** — es la tab de aterrizaje |
| Conversaciones | `conversations` | |
| Bóveda | `boveda` | |
| Leads (o "Pacientes"/"Reservas" según el giro) | `leads` | el giro la renombra, el id no cambia |
| Cobros | `cobros` | |
| Tickets | `tickets` | |
| Reseñas | `reviews` | |
| Campañas | `campanas` | |
| Plantillas | `plantillas` | |
| Flujo | `agente` | ojo: el id es `agente`, no "flujo" |
| Conocimiento | `kb` | |
| Mejoras | `mejoras` | |
| Conexiones | `conexiones` | |
| Configuración | `config` | la más pedida: el cliente no debe tocar los ajustes |
| Insights | `insights` | |
| Estadísticas | `stats` | |
| Costos | `costs` | la más pedida: el cliente no debe ver el gasto de IA |

Un id mal escrito **no rompe nada** — el panel lo ignora en silencio. Pero se ve
como "no funcionó", así que copia los ids de esta tabla tal cual.

## PASO 0 — Revisión (no edites nada todavía)
1. Confirma que estás en la carpeta del bot **de ese cliente**: `package.json` con
   scripts `deploy` y `test` + `wrangler.toml`. Si el miembro tiene varios
   clientes, cada cliente es una carpeta — pregúntale de cuál bot hablamos si hay
   duda. Si no estás en una carpeta de bot, detente y dilo.
2. `git status` (avisa si hay cambios sin guardar).
3. Lee el `wrangler.toml`: ¿ya existe `HIDDEN_TABS`? Anota qué tabs están ocultas
   hoy (para SUMAR, no pisar). Lee también el tier en `member/config.local.ts`:
   si el bot es free, avísale que la var no tendrá efecto hasta que sea Pro (un
   cliente de agencia siempre es Pro, así que casi nunca aplica).

## PASO 1 — Confirma QUÉ se oculta
1. Traduce lo que pidió a ids con la tabla de arriba ("costos" → `costs`,
   "configuración" → `config`, "flujo" → `agente`…). Si pidió algo ambiguo
   ("las de análisis"), muéstrale las opciones y que elija.
2. Si pidió **Resumen** (`overview`): explícale que esa no se puede — siempre debe
   quedar una pantalla de inicio. Ofrécele ocultar las demás.
3. Muéstrale el antes/después en una línea, y espera su OK:
   > "Su panel hoy muestra TODAS las tabs. Voy a ocultar **Costos** y
   > **Configuración**: desaparecen del menú y aunque tenga la URL guardada lo
   > regresa a Resumen. ¿Le doy?"

## PASO 2 — Aplica (edita `wrangler.toml` + redeploy)
En el `[vars]` del `wrangler.toml` del bot, **agrega o edita** la línea (si el
miembro ya tenía bot puede no existir → agrégala; si ya existía, SUMA los ids
nuevos a los que ya estaban):
```toml
HIDDEN_TABS = "costs,config"
```
Redeploy para que tome el cambio:
```bash
pnpm run deploy      # NO `pnpm deploy` (ese es otro comando y falla)
```
El redeploy rompe las pestañas abiertas del panel (cambian los chunks) — avísale
si su cliente lo está usando en ese momento.

## PASO 3 — Verifica (con evidencia, no de palabra)
1. Abre `/admin` del bot: la tab NO debe aparecer en el menú lateral.
2. Prueba la URL directa: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" -u <user>:<pass> https://<worker>/admin/<id>`
   → debe dar `302` hacia `/admin/overview`. (Si el panel no tiene password,
   omite `-u`.)
3. Dile al miembro exactamente qué quedó oculto y qué sigue visible.

## Volver a mostrar una tab
Es config, no código: quita ese id del CSV (o borra la línea `HIDDEN_TABS`
completa para mostrar todo) y `pnpm run deploy`. Cuando el miembro diga "vuelve a
mostrar X", este es todo el flujo — mismo PASO 1 de confirmación.

## Reglas duras
- **`overview` jamás se oculta.** El código lo ignora aunque lo pongas, pero ni lo intentes: confunde.
- **SUMA, no pises.** Si `HIDDEN_TABS` ya tenía ids, agrégale los nuevos — no borres lo que la agencia ya había ocultado.
- **Un bot = un cliente.** Esto se corre POR BOT, en la carpeta de ese cliente. Nunca asumas cuál es si hay varios.
- **No confundas con el candado Pro.** Una tab con candado "PRO" en un bot free es el gate de tier, no `HIDDEN_TABS` — eso se resuelve con Forja+, no con esta var.
- **Ocultar ≠ apagar.** Ocultar Cobros no desactiva los cobros; solo quita la vista. Para apagar una función, eso va en `/superpoderes` o el panel.
- **No despliegues a la ligera:** avisa si alguien está usando el panel en ese momento.
