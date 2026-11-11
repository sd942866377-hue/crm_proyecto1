import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "../src/env";
import type { OutgoingReply } from "../src/channels/shared";
import { telegramAdapter } from "../src/channels/telegram";
import { whatsappAdapter } from "../src/channels/whatsapp";
import { twilioAdapter } from "../src/channels/twilio";
import { kapsoAdapter } from "../src/channels/kapso";
import { ycloudAdapter } from "../src/channels/ycloud";
import { zernioAdapter } from "../src/channels/zernio";
import { metaAdapter } from "../src/channels/meta";

// PRUEBA POR CANAL: con `media` en el OutgoingReply, cada adapter debe armar el
// payload EXACTO que su proveedor documenta. Se mockea fetch global y se
// inspeccionan las llamadas — es la prueba de que "mandar foto" no es teoría.

const calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const jsonBodies = () =>
  calls.map((c) => {
    try { return { url: c.url, body: JSON.parse(String(c.init.body)) }; }
    catch { return { url: c.url, body: String(c.init.body) }; }
  });

function reply(channel: OutgoingReply["channel"], over: Partial<OutgoingReply> = {}): OutgoingReply {
  return {
    channel,
    channelUserId: "5215512345678",
    chunks: ["La casa de Polanco: 3 recámaras, $4.2M, disponible ya."],
    media: [
      { kind: "image", url: "https://bot.example.com/media/img_abc12345xx" },
      { kind: "audio", url: "https://cdn.negocio.com/tour.ogg", voice: true },
    ],
    ...over,
  };
}

describe("telegram — sendPhoto / sendVoice / sendAudio", () => {
  const env = { TELEGRAM_BOT_TOKEN: "TOK" } as unknown as Env;

  it("texto primero y luego cada media con su método", async () => {
    await telegramAdapter.sendReply(reply("telegram", {
      media: [
        { kind: "image", url: "https://x/img" },
        { kind: "audio", url: "https://x/nota.ogg", voice: true },
        { kind: "audio", url: "https://x/cancion.mp3" },
      ],
    }), env);
    const b = jsonBodies().filter((c) => !c.url.includes("sendChatAction"));
    expect(b[0].url).toContain("/sendMessage");
    expect(b[0].body.text).toContain("Polanco");
    expect(b[1].url).toContain("/sendPhoto");
    expect(b[1].body.photo).toBe("https://x/img");
    expect(b[2].url).toContain("/sendVoice");
    expect(b[2].body.voice).toBe("https://x/nota.ogg");
    expect(b[3].url).toContain("/sendAudio");
    expect(b[3].body.audio).toBe("https://x/cancion.mp3");
  });

  it("respuesta SOLO media (sin texto) también envía", async () => {
    await telegramAdapter.sendReply(reply("telegram", { chunks: [] }), env);
    const b = jsonBodies().filter((c) => !c.url.includes("sendChatAction"));
    expect(b).toHaveLength(2);
    expect(b[0].url).toContain("/sendPhoto");
  });
});

describe("whatsapp cloud — type image/audio con link", () => {
  const env = { WHATSAPP_PHONE_NUMBER_ID: "PN", WHATSAPP_ACCESS_TOKEN: "TOK" } as unknown as Env;

  it("shape exacto de la Cloud API", async () => {
    await whatsappAdapter.sendReply(reply("whatsapp"), env);
    const b = jsonBodies();
    expect(b[0].body.type).toBe("text");
    expect(b[1].body).toMatchObject({
      messaging_product: "whatsapp",
      to: "5215512345678",
      type: "image",
      image: { link: "https://bot.example.com/media/img_abc12345xx" },
    });
    expect(b[2].body).toMatchObject({ type: "audio", audio: { link: "https://cdn.negocio.com/tour.ogg" } });
  });
});

describe("twilio — MediaUrl", () => {
  const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_WA_FROM: "+521999" } as unknown as Env;

  it("mensaje extra por media con MediaUrl", async () => {
    await twilioAdapter.sendReply(reply("twilio"), env);
    expect(calls).toHaveLength(3);
    const p1 = new URLSearchParams(String(calls[1].init.body));
    expect(p1.get("MediaUrl")).toBe("https://bot.example.com/media/img_abc12345xx");
    expect(p1.get("To")).toBe("whatsapp:5215512345678");
    const p2 = new URLSearchParams(String(calls[2].init.body));
    expect(p2.get("MediaUrl")).toBe("https://cdn.negocio.com/tour.ogg");
  });
});

describe("kapso — espejo Cloud API con X-API-Key", () => {
  const env = { KAPSO_PHONE_NUMBER_ID: "PN", KAPSO_API_KEY: "K" } as unknown as Env;

  it("image/audio por link", async () => {
    await kapsoAdapter.sendReply(reply("kapso"), env);
    const b = jsonBodies();
    expect(b[1].body).toMatchObject({ type: "image", image: { link: "https://bot.example.com/media/img_abc12345xx" } });
    expect((calls[1].init.headers as Record<string, string>)["X-API-Key"]).toBe("K");
    expect(b[2].body).toMatchObject({ type: "audio" });
  });
});

describe("ycloud — sendDirectly con from/to E.164", () => {
  const env = { YCLOUD_WA_FROM: "+521999", YCLOUD_API_KEY: "Y" } as unknown as Env;

  it("image/audio por link", async () => {
    await ycloudAdapter.sendReply(reply("ycloud"), env);
    const b = jsonBodies();
    expect(b[1].body).toMatchObject({
      from: "+521999",
      to: "+5215512345678",
      type: "image",
      image: { link: "https://bot.example.com/media/img_abc12345xx" },
    });
    expect(b[2].body).toMatchObject({ type: "audio", audio: { link: "https://cdn.negocio.com/tour.ogg" } });
  });
});

describe("zernio — attachmentUrl/attachmentType (+voiceNote solo whatsapp+ogg)", () => {
  function zernioEnv(platform: string): Env {
    // fake D1 que regresa el contexto de conversación de zernio_ctx
    const d1 = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              run: async () => ({ success: true }),
              first: async () =>
                /FROM zernio_ctx/.test(sql)
                  ? { conversation_id: "conv1", account_id: "acc1", platform }
                  : null,
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    } as unknown as D1Database;
    return { ZERNIO_API_KEY: "Z", DB: d1 } as unknown as Env;
  }

  it("whatsapp: audio ogg va con voiceNote=true", async () => {
    await zernioAdapter.sendReply(reply("zernio"), zernioEnv("whatsapp"));
    const b = jsonBodies();
    expect(b[1].body).toMatchObject({ accountId: "acc1", attachmentUrl: "https://bot.example.com/media/img_abc12345xx", attachmentType: "image" });
    expect(b[1].body.voiceNote).toBeUndefined();
    expect(b[2].body).toMatchObject({ attachmentType: "audio", voiceNote: true });
  });

  it("instagram: mismo audio SIN voiceNote (solo aplica en whatsapp)", async () => {
    await zernioAdapter.sendReply(reply("zernio"), zernioEnv("instagram"));
    const b = jsonBodies();
    expect(b[2].body.voiceNote).toBeUndefined();
  });
});

describe("meta (messenger) — attachment url en mensaje aparte", () => {
  const env = { META_PAGE_ACCESS_TOKEN: "P" } as unknown as Env;

  it("attachment XOR text: la media va en su propio send", async () => {
    await metaAdapter.sendReply(reply("messenger"), env);
    const b = jsonBodies();
    expect(b[0].body.message.text).toContain("Polanco");
    expect(b[1].body.message).toEqual({
      attachment: { type: "image", payload: { url: "https://bot.example.com/media/img_abc12345xx", is_reusable: true } },
    });
    expect(b[1].body.message.text).toBeUndefined();
    expect(b[2].body.message.attachment.type).toBe("audio");
  });
});

describe("manychat — imagen y audio nativos por sendContent (audio con fallback a link)", () => {
  const env = { MANYCHAT_API_KEY: "MC" } as unknown as Env;

  it("imagen {type:image,url}; audio ogg(voice) → link (guard IG); m4a → nativo", async () => {
    const { manychatAdapter } = await import("../src/channels/manychat");
    await manychatAdapter.sendReply(reply("manychat", {
      media: [
        { kind: "image", url: "https://bot.example.com/media/img_abc12345xx" },
        { kind: "audio", url: "https://cdn.negocio.com/tour.ogg", voice: true },
        { kind: "audio", url: "https://bot.example.com/media/aud_m4a999999x" },
      ],
    }), env);
    const b = jsonBodies();
    expect(b[1].body.data.content.messages[0]).toEqual({ type: "image", url: "https://bot.example.com/media/img_abc12345xx" });
    expect(b[1].body.data.content.type).toBe("instagram");
    expect(b[2].body.data.content.messages[0]).toEqual({ type: "text", text: "https://cdn.negocio.com/tour.ogg" });
    expect(b[3].body.data.content.messages[0]).toEqual({ type: "audio", url: "https://bot.example.com/media/aud_m4a999999x" });
  });
});

describe("guard ogg-en-Instagram (IG tira el ogg en silencio)", () => {
  it("manychat/instagram: audio voice(ogg) va como LINK, no como attachment", async () => {
    const { manychatAdapter } = await import("../src/channels/manychat");
    await manychatAdapter.sendReply(reply("manychat", {
      media: [{ kind: "audio", url: "https://bot.example.com/media/aud_abc12345xx", voice: true }],
    }), { MANYCHAT_API_KEY: "MC" } as unknown as Env);
    const b = jsonBodies();
    expect(b[1].body.data.content.messages[0]).toEqual({ type: "text", text: "https://bot.example.com/media/aud_abc12345xx" });
  });

  it("meta/instagram: audio voice(ogg) va como texto; m4a (sin voice) va nativo", async () => {
    const { metaAdapter } = await import("../src/channels/meta");
    const env = { INSTAGRAM_ACCESS_TOKEN: "IGAA", META_PAGE_ACCESS_TOKEN: "P" } as unknown as Env;
    await metaAdapter.sendReply(reply("instagram", {
      media: [
        { kind: "audio", url: "https://x/nota.ogg", voice: true },
        { kind: "audio", url: "https://bot.example.com/media/aud_m4a999999x" },
      ],
    }), env);
    const b = jsonBodies().filter((c) => c.url.includes("/messages"));
    expect(b[1].body.message).toEqual({ text: "https://x/nota.ogg" });
    expect(b[2].body.message.attachment).toEqual({ type: "audio", payload: { url: "https://bot.example.com/media/aud_m4a999999x", is_reusable: true } });
  });
});

describe("video — payload nativo por canal (documentación oficial de cada proveedor)", () => {
  const vid = { kind: "video" as const, url: "https://cdn.negocio.com/tour.mp4", caption: "Tour de la casa" };

  it("telegram: sendVideo con video=URL y caption (MPEG4 ≤50MB)", async () => {
    await telegramAdapter.sendReply(reply("telegram", { media: [vid] }), { TELEGRAM_BOT_TOKEN: "TOK" } as unknown as Env);
    const call = jsonBodies().find((c) => c.url.includes("sendVideo"));
    expect(call).toBeTruthy();
    expect(call!.body).toEqual({ chat_id: "5215512345678", video: "https://cdn.negocio.com/tour.mp4", caption: "Tour de la casa" });
  });

  it("whatsapp cloud: type video + link + caption (mp4/3gpp ≤16MB)", async () => {
    await whatsappAdapter.sendReply(reply("whatsapp", { media: [vid] }), { WHATSAPP_PHONE_NUMBER_ID: "PN", WHATSAPP_ACCESS_TOKEN: "TOK" } as unknown as Env);
    const call = jsonBodies().find((c) => c.body?.type === "video");
    expect(call!.body.video).toEqual({ link: "https://cdn.negocio.com/tour.mp4", caption: "Tour de la casa" });
  });

  it("kapso (proxy Cloud API): mismo shape type video", async () => {
    await kapsoAdapter.sendReply(reply("kapso", { media: [vid] }), { KAPSO_PHONE_NUMBER_ID: "PN", KAPSO_API_KEY: "K" } as unknown as Env);
    const call = jsonBodies().find((c) => c.body?.type === "video");
    expect(call!.body.video).toEqual({ link: "https://cdn.negocio.com/tour.mp4", caption: "Tour de la casa" });
  });

  it("ycloud: type video + link + caption", async () => {
    await ycloudAdapter.sendReply(reply("ycloud", { media: [vid] }), { YCLOUD_WA_FROM: "+521999", YCLOUD_API_KEY: "Y" } as unknown as Env);
    const call = jsonBodies().find((c) => c.body?.type === "video");
    expect(call!.body.video).toEqual({ link: "https://cdn.negocio.com/tour.mp4", caption: "Tour de la casa" });
  });

  it("twilio: MediaUrl genérico con Body como caption (≤20MB)", async () => {
    await twilioAdapter.sendReply(reply("twilio", { media: [vid] }), { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_WA_FROM: "+521999" } as unknown as Env);
    const form = calls.map((c) => new URLSearchParams(String(c.init.body))).find((f) => f.get("MediaUrl") === "https://cdn.negocio.com/tour.mp4");
    expect(form).toBeTruthy();
    expect(form!.get("Body")).toBe("Tour de la casa");
  });

  it("zernio: attachmentType video + caption como message, sin voiceNote", async () => {
    const d1 = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              run: async () => ({ success: true }),
              first: async () => (/FROM zernio_ctx/.test(sql) ? { conversation_id: "conv1", account_id: "acc1", platform: "whatsapp" } : null),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    } as unknown as D1Database;
    await zernioAdapter.sendReply(reply("zernio", { media: [vid] }), { ZERNIO_API_KEY: "Z", DB: d1 } as unknown as Env);
    const call = jsonBodies().find((c) => c.body?.attachmentType === "video");
    expect(call!.body.attachmentUrl).toBe("https://cdn.negocio.com/tour.mp4");
    expect(call!.body.message).toBe("Tour de la casa");
    expect(call!.body.voiceNote).toBeUndefined();
  });

  it("manychat: {type:'video', url} nativo (formato dynamic blocks), caption como texto previo", async () => {
    const { manychatAdapter } = await import("../src/channels/manychat");
    await manychatAdapter.sendReply(reply("manychat", { media: [vid] }), { MANYCHAT_API_KEY: "MC" } as unknown as Env);
    const b = jsonBodies();
    expect(b[1].body.data.content.messages[0]).toEqual({ type: "text", text: "Tour de la casa" });
    expect(b[1].body.data.content.messages[1]).toEqual({ type: "video", url: "https://cdn.negocio.com/tour.mp4" });
  });

  it("meta/instagram: attachment type video (mp4 ≤25MB por docs de IG)", async () => {
    await metaAdapter.sendReply(reply("instagram", { media: [vid] }), { INSTAGRAM_ACCESS_TOKEN: "IGAA", META_PAGE_ACCESS_TOKEN: "P" } as unknown as Env);
    const msgs = jsonBodies().filter((c) => c.url.includes("/messages"));
    const conCaption = msgs.find((c) => c.body?.message?.text === "Tour de la casa");
    const conVideo = msgs.find((c) => c.body?.message?.attachment?.type === "video");
    expect(conCaption).toBeTruthy();
    expect(conVideo!.body.message.attachment.payload).toEqual({ url: "https://cdn.negocio.com/tour.mp4", is_reusable: true });
  });
});

// ── Adjuntos del inbox móvil (Contrato v3 §A3) ──────────────────────────────
// La app manda el archivo SIN texto (chunks: []) y, para documentos, con
// filename. Cada adapter tiene que tolerar el array vacío y usar el tipo nativo
// de su proveedor.

describe("kind 'file' + chunks vacíos (adjuntos desde la app)", () => {
  const doc = (over: Partial<OutgoingReply> = {}): OutgoingReply => ({
    channel: "whatsapp",
    channelUserId: "5215512345678",
    chunks: [],
    media: [
      { kind: "file", url: "https://bot.example.com/media-out/abc?exp=1&sig=x", filename: "cotizacion.pdf" },
    ],
    ...over,
  });

  it("whatsapp manda type document con filename y sin texto previo", async () => {
    await whatsappAdapter.sendReply(doc(), {
      WHATSAPP_PHONE_NUMBER_ID: "PN",
      WHATSAPP_ACCESS_TOKEN: "TOK",
    } as unknown as Env);
    const bodies = jsonBodies();
    expect(bodies).toHaveLength(1); // chunks vacíos → cero mensajes de texto
    expect(bodies[0].body).toMatchObject({
      type: "document",
      document: { link: "https://bot.example.com/media-out/abc?exp=1&sig=x", filename: "cotizacion.pdf" },
    });
  });

  it("kapso y ycloud espejan la Cloud API con type document", async () => {
    await kapsoAdapter.sendReply(doc({ channel: "kapso" }), {
      KAPSO_API_KEY: "K",
      KAPSO_PHONE_NUMBER_ID: "PN",
    } as unknown as Env);
    expect(jsonBodies()[0].body).toMatchObject({ type: "document", document: { filename: "cotizacion.pdf" } });

    calls.length = 0;
    await ycloudAdapter.sendReply(doc({ channel: "ycloud" }), {
      YCLOUD_API_KEY: "Y",
      YCLOUD_WA_FROM: "+5215500000000",
    } as unknown as Env);
    expect(jsonBodies()[0].body).toMatchObject({ type: "document", document: { filename: "cotizacion.pdf" } });
  });

  it("telegram usa sendDocument", async () => {
    await telegramAdapter.sendReply(doc({ channel: "telegram" }), {
      TELEGRAM_BOT_TOKEN: "TOK",
    } as unknown as Env);
    expect(calls[0].url).toContain("/sendDocument");
    expect(jsonBodies()[0].body).toMatchObject({ document: "https://bot.example.com/media-out/abc?exp=1&sig=x" });
  });

  it("twilio manda MediaUrl genérico (sirve para cualquier tipo)", async () => {
    await twilioAdapter.sendReply(doc({ channel: "twilio" }), {
      TWILIO_ACCOUNT_SID: "AC",
      TWILIO_AUTH_TOKEN: "T",
      TWILIO_WA_FROM: "+15550000000",
    } as unknown as Env);
    expect(calls).toHaveLength(1);
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get("MediaUrl")).toBe("https://bot.example.com/media-out/abc?exp=1&sig=x");
  });

  it("messenger manda attachment type file; instagram cae al link en texto", async () => {
    await metaAdapter.sendReply(doc({ channel: "messenger" }), {
      META_PAGE_ACCESS_TOKEN: "P",
    } as unknown as Env);
    expect(jsonBodies()[0].body.message).toMatchObject({
      attachment: { type: "file", payload: { url: "https://bot.example.com/media-out/abc?exp=1&sig=x" } },
    });

    calls.length = 0;
    await metaAdapter.sendReply(doc({ channel: "instagram" }), {
      META_PAGE_ACCESS_TOKEN: "P",
    } as unknown as Env);
    const igMsg = jsonBodies()[0].body.message;
    expect(igMsg.attachment).toBeUndefined();
    expect(igMsg.text).toContain("cotizacion.pdf");
    expect(igMsg.text).toContain("/media-out/abc");
  });
});
