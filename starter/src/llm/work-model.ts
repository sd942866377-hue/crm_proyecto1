/**
 * El modelo de trabajo de todo lo que NO es la conversación con el cliente:
 * el co-pilot (✨ sugiere qué contestarle), "que el bot aprenda esto", el
 * Analista, las Objeciones, los follow-ups, el re-enganche, el reporte del
 * dueño, el flywheel nocturno y el Blindaje.
 *
 * POR QUÉ EXISTE
 * --------------
 * El agente principal, cuando el proveedor le falla, reintenta con backoff y
 * si hace falta se pasa a OTRO proveedor con llave en el env (`fallbackModel`,
 * ver agent.ts). Por eso el bot sigue contestando aunque la llave BYO que el
 * dueño guardó en el panel esté vencida, sea de otro proveedor o tenga un
 * typo.
 *
 * Todo lo demás llamaba a `generateText` contra el modelo primario A SECAS.
 * Resultado real en el bot demo: el agente contestaba perfecto y al mismo
 * tiempo ✨ sugerir y "aprender esto" devolvían 502 `llm_failed` con "API key
 * is invalid.", el reporte salía sin insights y los follow-ups no se
 * redactaban. El bot se veía sano con la mitad de sus superpoderes muertos, y
 * el dueño no tenía cómo saber por qué.
 *
 * Aquí vive esa misma resiliencia UNA sola vez. Orden de candidatos:
 *   1. lo que configuró el dueño (settings de D1: proveedor / llave / modelo),
 *   2. si eso traía llave BYO: el MISMO proveedor con la llave del env,
 *   3. el primer proveedor DISTINTO con llave en el env (`fallbackModel`).
 *
 * Ojo con lo que este módulo NO hace:
 *   · No cubre "no hay ninguna llave" — eso ya lo resuelve `createModel`
 *     cayendo al default del env, y sin llaves no hay nada que reintentar.
 *   · No lo usa el botón "probar modelo" del panel (admin/routes.ts): ese
 *     existe justo para decirle al dueño la verdad sobre la config que acaba
 *     de escribir. Si hiciera failover, diría "funciona" de una llave rota.
 */
// SOLO tipo: `generateText` se resuelve con import dinámico dentro de
// `generate()`. Los tests del agente mockean "ai" sin ese export y un import
// estático los reventaría al cargar el módulo (ver blindaje/verify.ts, que ya
// tenía este mismo cuidado).
import type { generateText } from "ai";
import type { Env } from "../env";
import type { Tier } from "../upgrade/modelSelector";
import { loadLlmOverrides } from "../settings-loader";
import { Db } from "../db/client";
import { recordIaUsage, usageFromResult, type IaFn } from "../db/ia-usage";
import {
  createModel,
  envKeyFor,
  fallbackModel,
  type LlmOverrides,
  type LlmProvider,
  type ResolvedModel,
} from "./provider";

type GenerateArgs = Omit<Parameters<typeof generateText>[0], "model">;
type GenerateResult = Awaited<ReturnType<typeof generateText>>;

export interface WorkModel {
  /** El modelo que respondió DE VERDAD — cambia si hubo failover. Los callers
   *  que anotan costo o lo muestran en la app tienen que leerlo DESPUÉS de
   *  generar, no antes. */
  readonly modelId: string;
  readonly provider: LlmProvider;
  /** `generateText` con failover pegajoso. Relanza el error del PRIMER
   *  candidato si ninguno pudo. */
  generate(args: GenerateArgs): Promise<GenerateResult>;
}

/** Los candidatos, en orden de preferencia. Siempre hay al menos uno. */
function candidatos(env: Env, tier: Tier, ov: LlmOverrides): ResolvedModel[] {
  const primary = createModel(env, tier, ov);
  const list = [primary];
  // El dueño puso su propia llave: antes de cambiarle de proveedor —que le
  // cambia el tono y el costo— vale la pena la MISMA casa con la llave del
  // sistema. Sin su modelo elegido: si su llave era de otro plan, el id
  // también puede no aplicar; el default del tier siempre existe.
  if ((ov.apiKey ?? "").trim() && envKeyFor(env, primary.provider)) {
    list.push(createModel(env, tier, { provider: primary.provider }));
  }
  const fb = fallbackModel(env, tier, primary.provider);
  if (fb) list.push(fb);
  return list;
}

/** Igual que `workModel` pero con overrides ya cargados (el agente los tiene
 *  en `cfg.llm` y no necesita releer settings). */
export function workModelFrom(
  env: Env,
  tier: Tier,
  ov: LlmOverrides,
  fn: IaFn = "trabajo",
): WorkModel {
  const list = candidatos(env, tier, ov);
  // Pegajoso: una vez que uno funciona, un bucle de 30 conversaciones no
  // vuelve a tocar la llave muerta 30 veces.
  let actual = 0;

  return {
    get modelId() {
      return list[actual].modelId;
    },
    get provider() {
      return list[actual].provider;
    },
    async generate(args: GenerateArgs): Promise<GenerateResult> {
      const { generateText } = await import("ai");
      let primerError: unknown;
      for (let i = actual; i < list.length; i++) {
        try {
          const res = await generateText({
            ...args,
            model: list[i].model,
          } as Parameters<typeof generateText>[0]);
          actual = i;
          // Anota el gasto en la libreta (Gap 2: todo el work-model era
          // invisible en el conteo). Await barato + fail-safe adentro; el
          // logging NUNCA tumba el trabajo. `list[i].modelId` es el que
          // respondió de verdad (importa si hubo failover).
          try {
            const usage = await usageFromResult(
              res as { usage: unknown; providerMetadata?: unknown },
            );
            await recordIaUsage(new Db(env.DB), { fn, model: list[i].modelId, usage });
          } catch {
            /* el logging nunca rompe la generación */
          }
          return res;
        } catch (e) {
          if (primerError === undefined) primerError = e;
          const quedan = i + 1 < list.length;
          console.warn(
            `[llm] ${list[i].provider}/${list[i].modelId} falló${quedan ? " — voy al respaldo" : " y no hay respaldo"}:`,
            e instanceof Error ? e.message : e,
          );
        }
      }
      // El error que importa es el del PRIMER candidato: es la config del
      // dueño la que hay que arreglar, no la del respaldo.
      throw primerError;
    },
  };
}

/** El modelo de trabajo para este bot, con los overrides del panel aplicados. */
export async function workModel(env: Env, tier: Tier, fn: IaFn = "trabajo"): Promise<WorkModel> {
  return workModelFrom(env, tier, await loadLlmOverrides(env), fn);
}
