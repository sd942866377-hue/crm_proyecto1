// member/config.local.ts — generado por `forja init`. Edítalo cuando quieras.
// NUNCA se sobrescribe al actualizar el bot.

export const memberConfig = {
  businessName: "",
  botName: "Asistente",
  language: "es" as "es" | "en" | "pt",
  tier: "free" as "free" | "pro",
  timezone: "America/Mexico_City",
  // Moneda con la que el bot habla de precios ($ | € | R$). El bot la lee de
  // aquí si no la cambiaste en el panel (setting bot_currency manda si existe).
  currency: "$",
  contactEmail: "",
};
export type MemberConfig = typeof memberConfig;

export const businessConfig = {
  hours: "",
  services: [] as { name: string; price: number }[],
  location: "",
  paymentMethods: [] as string[],
  contactPhone: "",
  customFields: {
  "tono": "cercano y amigable, como hablarle a un conocido"
} as Record<string, string>,
};

import type { CommentFunnel } from "../src/channels/comment-funnel";
export const commentFunnels: CommentFunnel[] = [];

export const catalog: { name: string; price: number; description?: string; sku?: string }[] = [];
