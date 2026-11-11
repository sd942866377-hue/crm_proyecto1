/**
 * Estado de pausa EFECTIVO del bot (Contrato v3.2 §6). Vive aquí, y no dentro
 * de api.ts, porque lo leen dos sub-apps (/api/config, /api/pause y el Centro
 * de Mantenimiento) y una de ellas se monta desde api.ts: tenerlo en su propio
 * módulo evita el ciclo de imports.
 */

/** Cómo está apagado el bot: sin pausa, "hasta que lo prenda", o con hora de fin. */
export type PausedMode = "off" | "manual" | "until";

/**
 * El MISMO OR que settings-loader (switch manual o pausa temporal vigente),
 * pero además dice CUÁL de los dos manda para que la app pinte "Bot pausado
 * hasta las 18:00" vs "Bot apagado".
 * El switch manual gana: no tiene hora de término, así que `paused_until` va en
 * 0 aunque quede un bot_paused_until viejo tirado en settings.
 */
export function pauseState(
  paused: string | null | undefined,
  pausedUntilRaw: string | null | undefined,
  now = Date.now(),
): { paused: boolean; paused_until: number; paused_mode: PausedMode } {
  const untilMs = Number.parseInt(pausedUntilRaw ?? "", 10) || 0;
  if (paused === "1") return { paused: true, paused_until: 0, paused_mode: "manual" };
  if (untilMs > now) return { paused: true, paused_until: untilMs, paused_mode: "until" };
  return { paused: false, paused_until: 0, paused_mode: "off" };
}
