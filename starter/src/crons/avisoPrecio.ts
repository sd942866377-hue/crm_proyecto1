/**
 * Aviso one-shot: la comunidad sube de precio y le avisamos a quien preguntó.
 *
 * Se manda GRADUAL, no de golpe: el cron dedicado cae cada 15 minutos dentro de
 * la ventana y cada corrida despacha un lote (`batchSize`), con una pausa entre
 * mensaje y mensaje. Así 184 avisos se reparten en ~45 minutos en vez de salir
 * todos en el mismo segundo — se siente escrito a mano y no como broadcast.
 *
 * Corre UNA sola vez por persona: `template_sends` tiene
 * UNIQUE (campaign_key, conversation_id) y el claim ocurre ANTES de mandar, así
 * que el siguiente lote nunca repite a quien ya recibió.
 *
 * Solo free-form a quien está dentro de la ventana de 24h de su canal (lo
 * resuelve `sendCampaign`): nadie recibe plantilla ni mensaje fuera de ventana.
 */
import type { Env } from "../env";
import { sendCampaign } from "../campaigns";

export interface AvisoProgramado {
  /** Candado anti-duplicados. Cambiarlo re-manda a todos: NO reciclar. */
  key: string;
  segmentId: string;
  /** Ventana de disparo en epoch ms (inicio inclusivo, fin exclusivo). */
  from: number;
  to: number;
  /** Cuántos avisos como máximo por corrida del cron. */
  batchSize: number;
  /** Pausa entre un envío y el siguiente, dentro del lote. */
  delayMs: number;
  /** `{nombre}` se sustituye por el primer nombre del contacto. */
  text: string;
}

/**
 * Los avisos que hay agendados ahora mismo. Vacío = el cron es un no-op, que es
 * el estado normal: se llena solo cuando hay una campaña que mandar y se vuelve
 * a vaciar al terminar.
 *
 * (Hubo uno para la subida de precio del 26-jul; se canceló por orden de Santi.)
 */
const AVISOS: AvisoProgramado[] = []

/**
 * `avisos` es parámetro para poder probar el MECANISMO —ventana, lotes,
 * candado, resistencia a errores— sin depender de qué campaña esté agendada
 * hoy. En producción siempre corre con la lista de arriba.
 */
export async function runAvisosProgramados(
  env: Env,
  now: number = Date.now(),
  avisos: AvisoProgramado[] = AVISOS,
): Promise<void> {
  for (const aviso of avisos) {
    if (now < aviso.from || now >= aviso.to) continue;
    try {
      const r = await sendCampaign(env, {
        segmentId: aviso.segmentId,
        campaignKey: aviso.key,
        freeformText: aviso.text,
        limit: aviso.batchSize,
        delayMs: aviso.delayMs,
        now,
      });
      console.log(
        `[aviso] ${aviso.key} audiencia=${r.audience} enviados=${r.sentFreeform} ` +
          `dup=${r.skippedDuplicate} fail=${r.failed}`,
      );
    } catch (e) {
      console.error(`[aviso] ${aviso.key} falló:`, e);
    }
  }
}
