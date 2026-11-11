import type { Env } from "../env";
import type { PanelUser } from "./equipo";
import { enTurno } from "./equipo";
import { selfOrigin } from "../lib/self-origin";

/**
 * Avisos a PERSONAS del equipo (no al OWNER_* global): cuando se le asigna una
 * conversación a alguien, se le avisa por el canal que eligió en su perfil.
 *
 *  - whatsapp → SOLO si el bot tiene Twilio + plantilla HSM de handoff (es un
 *    mensaje business-initiated fuera de ventana; texto libre lo rechaza Meta).
 *    Sin eso, cae a correo.
 *  - email → mailer (CF Email / Resend). Sin proveedor, no hay aviso: el
 *    asignado lo ve en el panel (badge) — y queda en la bitácora.
 *
 * Respeta el horario: fuera de turno NO se manda (para no despertar a nadie);
 * la asignación queda hecha y visible en el panel de todos modos.
 */
export async function avisarAsignacion(env: Env, u: PanelUser, conversationId: string): Promise<"whatsapp" | "email" | "fuera_de_turno" | "sin_canal"> {
  if (!u.avisos.escalamientos || u.avisos.canal === "ninguno") return "sin_canal";
  const tz = env.BOT_TIMEZONE || env.CALCOM_TIMEZONE || "America/Mexico_City";
  if (!enTurno(u, new Date(), tz)) {
    console.log(`[avisos] ${u.email} fuera de turno — asignación sin aviso (queda en el panel)`);
    return "fuera_de_turno";
  }
  const origin = await selfOrigin(env);
  const url = `${origin}/admin/conversations/${encodeURIComponent(conversationId)}`;

  if (u.avisos.canal === "whatsapp" && u.phone && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WA_FROM && env.TWILIO_HANDOFF_CONTENT_SID) {
    try {
      const body = new URLSearchParams({
        From: `whatsapp:${env.TWILIO_WA_FROM}`,
        To: `whatsapp:${u.phone}`,
        ContentSid: env.TWILIO_HANDOFF_CONTENT_SID,
        ContentVariables: JSON.stringify({ "1": "conversación asignada a ti", "2": url }),
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (res.ok) return "whatsapp";
      console.warn(`[avisos] twilio http_${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)} — cae a correo`);
    } catch (e) {
      console.warn("[avisos] twilio falló — cae a correo:", e);
    }
  }

  const { mailerProvider, sendMail, plantillaCorreo } = await import("../mailer");
  if (!mailerProvider(env)) return "sin_canal";
  const m = await sendMail(env, {
    to: u.email,
    subject: `Te asignaron una conversación — ${env.BUSINESS_NAME}`,
    html: plantillaCorreo(env, {
      titulo: "Te asignaron una conversación",
      cuerpo: `Hay un cliente esperando que lo atiendas en el panel de ${env.BUSINESS_NAME}.`,
      cta: { url, label: "Abrir la conversación" },
    }),
  });
  return m.ok ? "email" : "sin_canal";
}
