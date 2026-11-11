/**
 * Friendly channel names for the dashboard + detection of which channels are
 * actually configured (env credentials present). Kept separate from shared.ts
 * so dashboard concerns don't touch the adapter contract.
 */
import type { Env } from "../env";

/** channel id (as stored in conversations.channel) → label the owner reads. */
export const CHANNEL_LABELS: Record<string, string> = {
  twilio: "WhatsApp",
  whatsapp: "WhatsApp", // legacy rows
  kapso: "WhatsApp", // WhatsApp vía Kapso (coexistencia)
  ycloud: "WhatsApp", // WhatsApp vía YCloud (coexistencia, zero-markup)
  telegram: "Telegram",
  instagram: "Instagram",
  messenger: "Messenger",
  manychat: "ManyChat",
  zernio: "Zernio", // proveedor unificado (IG/Messenger/WhatsApp/Telegram/X/…)
  test: "Chat de prueba", // canal interno de la app — filtrado de bandeja/métricas
};

export function channelLabel(channel: string | null | undefined): string {
  if (!channel) return "—";
  return CHANNEL_LABELS[channel] ?? channel;
}

export interface ConfiguredChannel {
  id: string;
  label: string;
  detail: string;
}

/** Channels with credentials configured — shown in Mi Agente even at 0 traffic. */
export function configuredChannels(env: Env): ConfiguredChannel[] {
  const out: ConfiguredChannel[] = [];
  if (env.TWILIO_ACCOUNT_SID) {
    out.push({ id: "twilio", label: "WhatsApp", detail: "Twilio" });
  }
  if (env.KAPSO_API_KEY) {
    out.push({ id: "kapso", label: "WhatsApp", detail: "Kapso · coexistencia" });
  }
  if (env.YCLOUD_API_KEY) {
    out.push({ id: "ycloud", label: "WhatsApp", detail: "YCloud · coexistencia" });
  }
  if (env.ZERNIO_API_KEY) {
    out.push({ id: "zernio", label: "Zernio", detail: "unificado · IG/DM/WhatsApp/…" });
  }
  if (env.TELEGRAM_BOT_TOKEN) {
    out.push({ id: "telegram", label: "Telegram", detail: "bot oficial" });
  }
  if (env.INSTAGRAM_ACCESS_TOKEN) {
    out.push({ id: "instagram", label: "Instagram", detail: "Meta oficial" });
  }
  if (env.META_PAGE_ACCESS_TOKEN) {
    out.push({ id: "messenger", label: "Messenger", detail: "Meta oficial" });
  }
  if (env.MANYCHAT_API_KEY) {
    out.push({ id: "manychat", label: "ManyChat", detail: "IG/FB vía ManyChat" });
  }
  return out;
}
