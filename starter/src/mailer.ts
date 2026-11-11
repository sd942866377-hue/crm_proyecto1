import type { Env } from "./env";

/**
 * Mailer del bot — CADENA de proveedores, todos opcionales:
 *
 *  1. Cloudflare Email Service (binding `send_email` → env.EMAIL). Nativo,
 *     sin llaves, en la cuenta del miembro. Requisitos (docs CF, ago-2026):
 *     dominio en Cloudflare DNS onboardeado a Email Service (DKIM/DMARC
 *     automáticos) y **Workers Paid** para mandar a cualquier destinatario
 *     (3,000/mes incluidos). En Workers Free solo llega a "direcciones de
 *     destino verificadas" de la cuenta. Ver skill/equipo.md.
 *  2. Resend (RESEND_API_KEY) — el proveedor que el bot ya usaba para tickets.
 *  3. Ninguno → `{ ok: false, reason: "sin_proveedor" }`. El caller DEGRADA
 *     (muestra el link al admin, deja ticket) — nunca rompe el flujo.
 *
 * FROM: EMAIL_FROM (ej. "bot@tunegocio.com") — con CF Email debe ser del
 * dominio onboardeado; con Resend, un dominio verificado ahí (o el sandbox).
 */

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type MailResult =
  | { ok: true; provider: "cloudflare" | "resend"; id?: string }
  | { ok: false; reason: "sin_proveedor" | "cloudflare_failed" | "resend_failed"; detail?: string };

export function mailerConfigured(env: Env): boolean {
  return Boolean((env.EMAIL && env.EMAIL_FROM) || (env.RESEND_API_KEY && env.EMAIL_FROM) || env.RESEND_API_KEY);
}

/** Proveedor que se usará (para mostrarlo en el panel), o null. */
export function mailerProvider(env: Env): "cloudflare" | "resend" | null {
  if (env.EMAIL && env.EMAIL_FROM) return "cloudflare";
  if (env.RESEND_API_KEY) return "resend";
  return null;
}

function fromAddress(env: Env): string {
  const name = env.BUSINESS_NAME || "Bot";
  if (env.EMAIL_FROM) return `${name} <${env.EMAIL_FROM}>`;
  // Resend sin dominio propio: su sandbox (solo llega al dueño de la cuenta).
  return `${name} <onboarding@resend.dev>`;
}

export async function sendMail(env: Env, mail: MailInput): Promise<MailResult> {
  const from = fromAddress(env);
  const text = mail.text ?? mail.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  if (env.EMAIL && env.EMAIL_FROM) {
    try {
      const r = await env.EMAIL.send({ from, to: mail.to, subject: mail.subject, html: mail.html, text });
      return { ok: true, provider: "cloudflare", id: r?.messageId };
    } catch (e: any) {
      // Motivo real en el log (regla: los fallos no son mudos). Caemos a Resend.
      console.error(`[mailer] cloudflare email falló → ${String(e?.message ?? e).slice(0, 300)}`);
      if (!env.RESEND_API_KEY) return { ok: false, reason: "cloudflare_failed", detail: String(e?.message ?? e).slice(0, 200) };
    }
  }

  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html, text }),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300);
        console.error(`[mailer] resend http_${res.status} → ${body}`);
        return { ok: false, reason: "resend_failed", detail: `http_${res.status}` };
      }
      const j = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, provider: "resend", id: j.id };
    } catch (e: any) {
      console.error("[mailer] resend falló:", e);
      return { ok: false, reason: "resend_failed", detail: String(e?.message ?? e).slice(0, 200) };
    }
  }

  return { ok: false, reason: "sin_proveedor" };
}

/** Plantilla mínima, legible en cualquier cliente, con la marca del bot. */
export function plantillaCorreo(env: Env, opts: { titulo: string; cuerpo: string; cta?: { url: string; label: string }; pie?: string }): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const negocio = esc(env.BUSINESS_NAME || "Tu negocio");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f1e7;font-family:-apple-system,Segoe UI,sans-serif;color:#23180d">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
  <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#b0653a;font-weight:700;margin-bottom:14px">${negocio}</div>
  <h1 style="font-size:22px;margin:0 0 12px;letter-spacing:-.02em">${esc(opts.titulo)}</h1>
  <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#4a3f30">${opts.cuerpo}</p>
  ${opts.cta ? `<p style="margin:0 0 20px"><a href="${esc(opts.cta.url)}" style="display:inline-block;background:#b0653a;color:#fff8ef;font-weight:700;padding:12px 22px;text-decoration:none;border-radius:8px">${esc(opts.cta.label)}</a></p>
  <p style="font-size:12px;color:#8a7a66;word-break:break-all;margin:0 0 20px">${esc(opts.cta.url)}</p>` : ""}
  ${opts.pie ? `<p style="font-size:12px;color:#8a7a66;line-height:1.5;margin:0">${esc(opts.pie)}</p>` : ""}
</div></body></html>`;
}
