/**
 * Watchdog nocturno — lo ÚNICO que debe despertar al dueño.
 *
 * En cada tick del cron frecuente cuenta las respuestas fallidas ("Algo
 * falló…") de los últimos 30 minutos. Si hay 3 o más, algo está roto de
 * verdad (proveedor caído, keys agotadas) y avisa vía notifyOwner (WhatsApp
 * template / Telegram / email, lo que esté configurado). Throttle de 6 h
 * entre alertas para no metrallar el teléfono con el mismo incidente.
 */
import type { Env } from "./env";
import { Db } from "./db/client";
import { SettingsRepo } from "./db/settings";
import { notifyOwner } from "./tools/handoffHuman";
import { dispatchMobilePush } from "./mobile-push";
import { renderPush } from "./lib/push-templates";

const WINDOW_MS = 30 * 60 * 1000;
export const ALERT_THRESHOLD = 3;
const THROTTLE_MS = 6 * 60 * 60 * 1000;
/** Cuándo se disparó la última alerta de salud (throttle + la lee
 *  GET /api/maintenance para pintarla en "Alertas recientes"). */
export const LAST_ALERT_KEY = "last_health_alert_at";

export interface WatchdogResult {
  failures: number;
  alerted: boolean;
}

export async function checkBotHealth(env: Env, now = Date.now()): Promise<WatchdogResult> {
  const db = new Db(env.DB);
  const failures =
    (
      await db.first<{ n: number }>(
        "SELECT COUNT(*) as n FROM messages WHERE role = 'assistant' AND content LIKE 'Algo falló%' AND created_at > ?",
        [now - WINDOW_MS],
      )
    )?.n ?? 0;

  if (failures < ALERT_THRESHOLD) return { failures, alerted: false };

  const settings = new SettingsRepo(db);
  const lastRaw = await settings.get(LAST_ALERT_KEY);
  const last = lastRaw ? Number.parseInt(lastRaw, 10) : 0;
  if (Number.isFinite(last) && now - last < THROTTLE_MS) {
    return { failures, alerted: false };
  }

  await settings.set(LAST_ALERT_KEY, String(now));
  await notifyOwner(env, {
    reason: "salud del bot",
    summary: `⚠ ${failures} respuestas fallidas en los últimos 30 min — revisa el proveedor de IA (rate limits/keys) o pausa el bot desde el panel.`,
    ticketId: "watchdog",
  });
  // Ping a la app móvil (Forja Inbox) — hereda el throttle de 6 h de arriba.
  const push = renderPush("watchdog", {
    motivo: `${failures} respuestas fallidas en los últimos 30 min — revisa tu proveedor de IA o pausa el bot.`,
  });
  await dispatchMobilePush(env, { type: "watchdog", title: push.title, body: push.body });
  console.error(`[watchdog] ALERTA: ${failures} fallos en 30 min — dueño notificado`);
  return { failures, alerted: true };
}
