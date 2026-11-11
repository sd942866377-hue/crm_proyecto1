import type { ChannelAdapter, IncomingMessage, OutgoingReply, SendOptions } from "./shared";
import { reportSendFailure } from "./shared";
import type { Env } from "../env";

export const twilioAdapter: ChannelAdapter = {
  async parseIncoming(request: Request, _env: Env): Promise<IncomingMessage> {
    const form = await request.formData();
    const from = String(form.get("From") ?? "");
    const channelUserId = from.replace(/^whatsapp:/, "");
    const profileName = form.get("ProfileName");
    const body = form.get("Body");
    const numMedia = parseInt(String(form.get("NumMedia") ?? "0"), 10);

    let audioUrl: string | undefined;
    let imageUrl: string | undefined;
    let fileUrl: string | undefined;
    let fileMime: string | undefined;
    if (numMedia > 0) {
      const url = String(form.get("MediaUrl0") ?? "");
      const type = String(form.get("MediaContentType0") ?? "");
      if (type.startsWith("image/")) imageUrl = url;
      else if (type.startsWith("audio/")) audioUrl = url;
      else if (url) {
        // PDF/doc: el bot no lo lee, pero se archiva y escala a una persona.
        fileUrl = url;
        fileMime = type || undefined;
      }
    }

    return {
      channel: "twilio",
      channelUserId,
      displayName: profileName ? String(profileName) : undefined,
      text: body ? String(body) : undefined,
      audioUrl,
      imageUrl,
      fileUrl,
      fileMime,
      isOwnerMessage: false, // Twilio webhooks fire only for inbound messages
      receivedAt: Date.now(),
      rawPayload: Object.fromEntries(form.entries()),
    };
  },

  async sendReply(reply: OutgoingReply, env: Env, opts?: SendOptions): Promise<void> {
    const sid = env.TWILIO_ACCOUNT_SID;
    const tok = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_WA_FROM;
    if (!sid || !tok || !from) throw new Error("Twilio credentials missing");
    const auth = btoa(`${sid}:${tok}`);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    for (let i = 0; i < reply.chunks.length; i++) {
      const delay = i === 0 ? 0 : reply.interChunkDelayMs ?? 1000;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      const body = new URLSearchParams({
        From: `whatsapp:${from}`,
        To: `whatsapp:${reply.channelUserId}`,
        Body: reply.chunks[i],
      });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      // Twilio rechaza con 4xx + JSON {code, message} (ventana de 24h, número no
      // registrado en el sandbox…). Antes se tragaba: ahora se logea, y en strict
      // lanza con el motivo para que la app lo pinte.
      if (!res.ok) await reportSendFailure("twilio sendReply", res, opts);
    }
    // Galería: cada archivo va como mensaje propio DESPUÉS del texto — Twilio
    // manda media freeform con MediaUrl (el Body es opcional).
    for (const m of reply.media ?? []) {
      const body = new URLSearchParams({
        From: `whatsapp:${from}`,
        To: `whatsapp:${reply.channelUserId}`,
        MediaUrl: m.url,
        ...(m.caption ? { Body: m.caption } : {}),
      });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) await reportSendFailure("twilio media send", res, opts);
    }
  },
};
