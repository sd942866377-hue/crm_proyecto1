import { tool } from "ai";
import { z } from "zod";
import { Resend } from "resend";
import type { Env } from "../env";
import { Db } from "../db/client";
import { TicketsRepo } from "../db/tickets";
import { ConversationsRepo } from "../db/conversations";
import { selfOrigin } from "../lib/self-origin";
import { isPro } from "../config";
import { dispatchMobilePush } from "../mobile-push";
import { renderPush } from "../lib/push-templates";

export interface HandoffTicketInput {
  conversationId: string | null;
  reason: string;
  summary: string;
  category?: "billing" | "product" | "complaint" | "other";
  transcript?: string;
}

/**
 * Núcleo del handoff: crea el ticket, lo cuelga de la conversación y avisa al
 * dueño (email + Telegram/WhatsApp). Lo comparten la tool handoffHuman (el LLM
 * escala) y el Blindaje anti-invento (verificador pre-envío) — misma
 * maquinaria, cero duplicación.
 */
export async function createHandoffTicket(
  env: Env,
  input: HandoffTicketInput,
): Promise<{ ticketId: string }> {
  const { conversationId, reason, summary } = input;
  const category = input.category ?? "other";
  const db = new Db(env.DB);
  const tickets = new TicketsRepo(db);
  const ticketId = await tickets.create({
    conversationId,
    category,
    summary: `[${reason}] ${summary}`,
    transcript: input.transcript ?? "", // populated by caller if it has access
  });
  if (conversationId) {
    const convs = new ConversationsRepo(db);
    await convs.setOpenTicket(conversationId, ticketId);
  }

  // Send email if Resend configured
  if (env.RESEND_API_KEY && env.OWNER_EMAIL) {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      await resend.emails.send({
        from: `${env.BUSINESS_NAME} Bot <onboarding@resend.dev>`,
        to: env.OWNER_EMAIL,
        subject: `[Bot] Ticket ${reason}: ${summary.slice(0, 60)}`,
        html: `<p><strong>Categoría:</strong> ${category}</p>
               <p><strong>Resumen:</strong> ${summary}</p>
               <p><a href="${await selfOrigin(env)}/admin/tickets/${ticketId}">Ver ticket</a></p>`,
      });
    } catch (e) {
      console.error("[handoffHuman] resend failed:", e);
    }
  }

  // Notify the owner. The ticket is already saved in D1 + dashboard; these
  // are just the "ping" so the owner sees it fast. Default channel is
  // Telegram DM (free, reuses the bot token). Twilio WhatsApp is optional
  // and, because this is a business-INITIATED message outside any 24h
  // session window, MUST use a pre-approved Content Template (HSM) — free
  // text would be rejected by WhatsApp. Both are best-effort.
  await notifyOwner(env, { reason, summary, ticketId });

  // Ping a la app móvil (Forja Inbox) — mismo espíritu que notifyOwner: aviso
  // best-effort; el ticket ya está a salvo en D1 + panel.
  let cliente = "Cliente";
  if (conversationId) {
    const conv = await new ConversationsRepo(db).getById(conversationId).catch(() => null);
    if (conv?.display_name) cliente = conv.display_name;
  }
  const push = renderPush("handoff", { cliente, motivo: summary });
  await dispatchMobilePush(env, {
    type: "handoff",
    title: push.title,
    body: push.body,
    conversationId: conversationId ?? undefined,
  });

  return { ticketId };
}

export function handoffHumanTool(env: Env, getConversationId: () => string | null) {
  return tool({
    description:
      "Crea un ticket para el dueño + le manda email. Usalo cuando el bot no puede resolver o el cliente pide humano explícitamente.",
    inputSchema: z.object({
      reason: z.string().describe("Categoría corta del problema"),
      summary: z.string().max(300).describe("Resumen en 1 frase del contexto"),
      category: z.enum(["billing", "product", "complaint", "other"]).default("other"),
    }),
    execute: async ({ reason, summary, category }) =>
      createHandoffTicket(env, {
        conversationId: getConversationId(),
        reason,
        summary,
        category,
      }),
  });
}

interface HandoffNotice {
  reason: string;
  summary: string;
  ticketId: string;
}

/**
 * Qué canales de aviso al dueño están configurados. Lo usa el dashboard
 * (Salud del bot) para hacer VISIBLE cuando un handoff no le avisaría a nadie
 * — antes fallaba en silencio y el ticket se quedaba huérfano.
 */
export function handoffNotifyStatus(env: Env): { ok: boolean; channels: string[] } {
  const channels: string[] = [];
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID) channels.push("Telegram");
  if (
    isPro(env) &&
    env.OWNER_WA_NUMBER &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_WA_FROM &&
    env.TWILIO_HANDOFF_CONTENT_SID
  )
    channels.push("WhatsApp");
  if (env.RESEND_API_KEY && env.OWNER_EMAIL) channels.push("Email");
  return { ok: channels.length > 0, channels };
}

/**
 * Best-effort owner notification on handoff. Default = Telegram DM (free,
 * reuses the bot token). Optional = Twilio WhatsApp via an approved Content
 * Template. Each channel is independent and never throws into the tool.
 */
// Aviso de corte por presupuesto (2× el tope): el bot dejó de responder para
// proteger la llave del miembro. Throttle 1/día (settings) para no spamear.
export async function notifyBudgetHardStop(
  env: Env,
  db: Db,
  spent: number,
  budget: number,
): Promise<void> {
  const KEY = "budget_hardstop_alert_at";
  const { SettingsRepo } = await import("../db/settings");
  const settings = new SettingsRepo(db);
  const last = Number.parseInt((await settings.get(KEY)) ?? "0", 10) || 0;
  if (Date.now() - last < 24 * 3600_000) return; // ya avisado hoy
  await settings.set(KEY, String(Date.now()));
  await notifyOwner(env, {
    reason: "presupuesto de IA",
    summary: `🚨 Tu bot llegó a $${spent.toFixed(2)} de gasto (2× tu tope de $${budget}) y se PAUSÓ para proteger tu llave de IA. Revisa si hay un loop o abuso, sube tu tope en la tab Costos, o reactívalo desde el panel.`,
    ticketId: "budget",
  });
}

/**
 * Mensaje libre al dueño (sin marco de "ticket") — lo usan superpoderes como
 * el Reporte diario. Telegram DM + email (si hay Resend). NO usa la plantilla
 * de WhatsApp: un mensaje de negocio fuera de la ventana 24h necesita HSM y el
 * reporte no cabe ahí; Telegram/email son free-form y suficientes.
 * Best-effort: cada canal es independiente y nunca lanza.
 */
export async function messageOwner(
  env: Env,
  msg: { heading: string; body: string; url?: string },
): Promise<void> {
  const line = env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID;
  const mail = env.RESEND_API_KEY && env.OWNER_EMAIL;
  if (!line && !mail) {
    console.error(
      `[messageOwner] "${msg.heading}" sin canal (falta Telegram o Resend+OWNER_EMAIL) — el dueño no lo verá`,
    );
    return;
  }

  if (line) {
    try {
      const text = `${msg.heading}\n${msg.body}${msg.url ? `\n\n${msg.url}` : ""}`;
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.OWNER_TELEGRAM_CHAT_ID, text }),
      });
    } catch (e) {
      console.error("[messageOwner] telegram failed:", e);
    }
  }

  if (mail) {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      const htmlBody = msg.body.replace(/\n/g, "<br>");
      await resend.emails.send({
        from: `${env.BUSINESS_NAME} Bot <onboarding@resend.dev>`,
        to: env.OWNER_EMAIL,
        subject: msg.heading,
        html: `<p>${htmlBody}</p>${msg.url ? `<p><a href="${msg.url}">Abrir panel</a></p>` : ""}`,
      });
    } catch (e) {
      console.error("[messageOwner] resend failed:", e);
    }
  }
}

export async function notifyOwner(env: Env, notice: HandoffNotice): Promise<void> {
  const ticketUrl = `${await selfOrigin(env)}/admin/tickets`;

  // El SID de la plantilla puede venir del secret O del setting que escribe el
  // setup del panel. Se resuelve ANTES del guard: si vive solo en settings, el
  // guard sync (env-only) diría "sin canal" y saldríamos sin avisar a nadie.
  let handoffContentSid = env.TWILIO_HANDOFF_CONTENT_SID ?? "";
  if (!handoffContentSid) {
    try {
      const { SettingsRepo, SETTING_KEYS } = await import("../db/settings");
      handoffContentSid =
        (await new SettingsRepo(new Db(env.DB)).get(SETTING_KEYS.twilioHandoffContentSid)) ?? "";
    } catch {
      // settings no disponible — se comporta como no configurado
    }
  }
  const waViaSetting = Boolean(
    handoffContentSid && env.OWNER_WA_NUMBER && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WA_FROM,
  );

  // Fail-LOUD (en logs) cuando no hay ningún canal de aviso configurado: el
  // ticket existe en el dashboard pero nadie se entera. El dashboard también
  // lo muestra en "Salud del bot" (handoffNotifyStatus).
  if (!handoffNotifyStatus(env).ok && !waViaSetting) {
    console.error(
      `[notifyOwner] ticket ${notice.ticketId} creado pero SIN canal de aviso configurado ` +
        "(faltan OWNER_TELEGRAM_CHAT_ID, OWNER_WA_NUMBER+template o RESEND_API_KEY+OWNER_EMAIL) — el dueño no será notificado",
    );
    return;
  }

  // --- Telegram DM (default) ------------------------------------------------
  if (env.TELEGRAM_BOT_TOKEN && env.OWNER_TELEGRAM_CHAT_ID) {
    try {
      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: env.OWNER_TELEGRAM_CHAT_ID,
            text:
              `🚨 Nuevo ticket [${notice.reason}]\n${notice.summary}\n\nVer: ${ticketUrl}`,
          }),
        },
      );
    } catch (e) {
      console.error("[notifyOwner] telegram failed:", e);
    }
  }

  // --- Twilio WhatsApp via approved Content Template (optional) --------------
  // A business-initiated WhatsApp message outside a 24h session window REQUIRES
  // an approved template — Twilio rejects free-form Body. We send ContentSid +
  // ContentVariables (the template's {{1}}, {{2}}, {{3}} placeholders), not Body.
  // El SID (secret o setting) ya se resolvió arriba, antes del guard.
  if (
    isPro(env) &&
    env.OWNER_WA_NUMBER &&
    env.TWILIO_ACCOUNT_SID &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_WA_FROM &&
    handoffContentSid
  ) {
    try {
      const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
      const body = new URLSearchParams({
        From: `whatsapp:${env.TWILIO_WA_FROM}`,
        To: `whatsapp:${env.OWNER_WA_NUMBER}`,
        ContentSid: handoffContentSid,
        // Template placeholders: {{1}}=reason, {{2}}=summary, {{3}}=ticket URL.
        // The member authors the template in Twilio to match this ordering.
        ContentVariables: JSON.stringify({
          "1": notice.reason,
          "2": notice.summary,
          "3": ticketUrl,
        }),
      });
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );
    } catch (e) {
      console.error("[notifyOwner] twilio template failed:", e);
    }
  }
}
