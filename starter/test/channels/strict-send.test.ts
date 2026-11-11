/**
 * MODO STRICT por canal (Contrato v3 §A3/B3).
 *
 * La regla dura: con `strict: true` un rechazo del proveedor LANZA con el
 * detalle legible (lo que la app pinta en el `detail` del 409 `send_failed`);
 * SIN strict el comportamiento es el de siempre — se logea y el turno del bot
 * sigue vivo (una foto de la Galería que rebote no debe tumbar la respuesta).
 *
 * Aquí se prueba adapter por adapter contra un fetch que siempre responde 4xx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Env } from "../../src/env";
import type { OutgoingReply } from "../../src/channels/shared";
import { telegramAdapter } from "../../src/channels/telegram";
import { whatsappAdapter } from "../../src/channels/whatsapp";
import { twilioAdapter } from "../../src/channels/twilio";
import { kapsoAdapter } from "../../src/channels/kapso";
import { ycloudAdapter } from "../../src/channels/ycloud";
import { zernioAdapter } from "../../src/channels/zernio";
import { metaAdapter } from "../../src/channels/meta";
import { manychatAdapter } from "../../src/channels/manychat";
import { webAdapter } from "../../src/channels/web";

/** Cuerpo de error realista: el motivo tiene que sobrevivir hasta el mensaje. */
const ERROR_BODY = JSON.stringify({
  error: { message: "Message failed to send because more than 24 hours have passed", code: 131047 },
});

let status = 400;

beforeEach(() => {
  status = 400;
  // Silencia el console.error del camino no-strict (es ruido esperado aquí).
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(ERROR_BODY, { status })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reply(channel: OutgoingReply["channel"], over: Partial<OutgoingReply> = {}): OutgoingReply {
  return {
    channel,
    channelUserId: "5215512345678",
    chunks: ["Te confirmo tu cita del jueves."],
    interChunkDelayMs: 0,
    ...over,
  };
}

/** fake D1 con el contexto de envío que zernio necesita para responder. */
function zernioDb(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            run: async () => ({ success: true }),
            first: async () =>
              /FROM zernio_ctx/.test(sql)
                ? { conversation_id: "conv1", account_id: "acc1", platform: "whatsapp" }
                : null,
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

const CANALES: {
  nombre: string;
  send: (r: OutgoingReply, env: Env, opts?: { strict?: boolean }) => Promise<void>;
  env: () => Env;
  canal: OutgoingReply["channel"];
}[] = [
  {
    nombre: "telegram",
    send: (r, e, o) => telegramAdapter.sendReply(r, e, o),
    env: () => ({ TELEGRAM_BOT_TOKEN: "TOK" }) as unknown as Env,
    canal: "telegram",
  },
  {
    nombre: "whatsapp",
    send: (r, e, o) => whatsappAdapter.sendReply(r, e, o),
    env: () =>
      ({ WHATSAPP_PHONE_NUMBER_ID: "PID", WHATSAPP_ACCESS_TOKEN: "TOK" }) as unknown as Env,
    canal: "whatsapp",
  },
  {
    nombre: "twilio",
    send: (r, e, o) => twilioAdapter.sendReply(r, e, o),
    env: () =>
      ({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_WA_FROM: "+15550000000" }) as unknown as Env,
    canal: "twilio",
  },
  {
    nombre: "kapso",
    send: (r, e, o) => kapsoAdapter.sendReply(r, e, o),
    env: () => ({ KAPSO_PHONE_NUMBER_ID: "PID", KAPSO_API_KEY: "K" }) as unknown as Env,
    canal: "kapso",
  },
  {
    nombre: "ycloud",
    send: (r, e, o) => ycloudAdapter.sendReply(r, e, o),
    env: () => ({ YCLOUD_WA_FROM: "+15550000000", YCLOUD_API_KEY: "Y" }) as unknown as Env,
    canal: "ycloud",
  },
  {
    nombre: "zernio",
    send: (r, e, o) => zernioAdapter.sendReply(r, e, o),
    env: () => ({ ZERNIO_API_KEY: "Z", DB: zernioDb() }) as unknown as Env,
    canal: "zernio",
  },
  {
    nombre: "messenger",
    send: (r, e, o) => metaAdapter.sendReply(r, e, o),
    env: () => ({ META_PAGE_ACCESS_TOKEN: "PAGE" }) as unknown as Env,
    canal: "messenger",
  },
  {
    nombre: "instagram",
    send: (r, e, o) => metaAdapter.sendReply(r, e, o),
    env: () => ({ META_PAGE_ACCESS_TOKEN: "PAGE" }) as unknown as Env,
    canal: "instagram",
  },
  {
    nombre: "manychat",
    send: (r, e, o) => manychatAdapter.sendReply(r, e, o),
    env: () => ({ MANYCHAT_API_KEY: "MC" }) as unknown as Env,
    canal: "manychat",
  },
];

describe.each(CANALES)("$nombre — texto", ({ nombre, send, env, canal }) => {
  it("strict: el rechazo del proveedor LANZA con status y motivo", async () => {
    await expect(send(reply(canal), env(), { strict: true })).rejects.toThrow(/400/);
    await expect(send(reply(canal), env(), { strict: true })).rejects.toThrow(/24 hours/);
  });

  it("sin strict: NO lanza (el turno del bot sigue) y lo deja en el log", async () => {
    await expect(send(reply(canal), env())).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    expect(nombre).toBeTruthy();
  });
});

describe.each(CANALES.filter((c) => c.nombre !== "manychat"))("$nombre — media", ({ send, env, canal }) => {
  const conMedia = (c: OutgoingReply["channel"]) =>
    reply(c, { chunks: [], media: [{ kind: "image", url: "https://bot.example.com/media/x.jpg" }] });

  it("strict: una imagen rechazada también LANZA", async () => {
    await expect(send(conMedia(canal), env(), { strict: true })).rejects.toThrow(/400/);
  });

  it("sin strict: la imagen rechazada solo se logea", async () => {
    await expect(send(conMedia(canal), env())).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("manychat — media con fallback de audio", () => {
  const env = { MANYCHAT_API_KEY: "MC" } as unknown as Env;
  const audio = (): OutgoingReply =>
    reply("manychat", { chunks: [], media: [{ kind: "audio", url: "https://x/nota.ogg" }] });

  it("strict: si el audio nativo Y el link fallan, lanza", async () => {
    await expect(manychatAdapter.sendReply(audio(), env, { strict: true })).rejects.toThrow(/400/);
  });

  it("strict: si el fallback a link SÍ entrega, NO lanza (el cliente ya lo recibió)", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n += 1;
        // 1ª llamada = audio nativo (rechazado) · 2ª = el link en texto (ok).
        return n === 1
          ? new Response(ERROR_BODY, { status: 400 })
          : new Response(JSON.stringify({ status: "success" }), { status: 200 });
      }),
    );
    await expect(manychatAdapter.sendReply(audio(), env, { strict: true })).resolves.toBeUndefined();
    expect(n).toBe(2);
  });

  it("strict: una IMAGEN rechazada sí lanza (no hay fallback que la salve)", async () => {
    const img = reply("manychat", {
      chunks: [],
      media: [{ kind: "image", url: "https://x/foto.jpg" }],
    });
    await expect(manychatAdapter.sendReply(img, env, { strict: true })).rejects.toThrow(/400/);
  });
});

describe("zernio — sin llave ni contexto", () => {
  it("strict: sin ZERNIO_API_KEY lanza en vez de rendirse en silencio", async () => {
    const env = { DB: zernioDb() } as unknown as Env;
    await expect(zernioAdapter.sendReply(reply("zernio"), env, { strict: true })).rejects.toThrow(
      /ZERNIO_API_KEY/,
    );
  });

  it("strict: sin contexto de conversación lanza", async () => {
    const sinCtx = {
      prepare() {
        return {
          bind() {
            return { run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) };
          },
        };
      },
    } as unknown as D1Database;
    const env = { ZERNIO_API_KEY: "Z", DB: sinCtx } as unknown as Env;
    await expect(zernioAdapter.sendReply(reply("zernio"), env, { strict: true })).rejects.toThrow(
      /sin contexto/,
    );
  });

  it("sin strict: sin llave sigue siendo un no-op silencioso", async () => {
    const env = { DB: zernioDb() } as unknown as Env;
    await expect(zernioAdapter.sendReply(reply("zernio"), env)).resolves.toBeUndefined();
  });
});

describe("web / test — no-op", () => {
  it("no lanza ni con strict: no hay proveedor que pueda rechazar", async () => {
    const env = {} as unknown as Env;
    await expect(webAdapter.sendReply(reply("web"), env, { strict: true })).resolves.toBeUndefined();
    await expect(webAdapter.sendReply(reply("test"), env, { strict: true })).resolves.toBeUndefined();
  });
});
