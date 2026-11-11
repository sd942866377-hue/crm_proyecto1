import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks de DB/settings para probar la lógica de coexistencia sin tocar D1.
const { setPausedUntil, getOrCreate, resolveTakeoverMs } = vi.hoisted(() => ({
  setPausedUntil: vi.fn(async () => {}),
  getOrCreate: vi.fn(async () => ({ id: "kapso:5215512345678" })),
  resolveTakeoverMs: vi.fn(async () => 3_600_000),
}));
vi.mock("../../src/db/client", () => ({ Db: class {} }));
vi.mock("../../src/db/conversations", () => ({
  ConversationsRepo: class {
    getOrCreate = getOrCreate;
    setPausedUntil = setPausedUntil;
  },
}));
vi.mock("../../src/db/settings", () => ({ resolveTakeoverMs }));

import {
  parseKapsoEvents,
  verifyKapsoSignature,
  kapsoOwnerTakeover,
  normalizeKapsoEvents,
} from "../../src/channels/kapso";

const env = {} as any;

/** Firma un cuerpo con el mismo HMAC-SHA256 hex que espera Kapso. */
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function received(message: any, phone = "+52 1 55 1234 5678", name = "María") {
  return {
    message,
    conversation: { id: "conv_1", phone_number: phone, kapso: { contact_name: name } },
    phone_number_id: "PHONE_ID",
    is_new_conversation: true,
  };
}

function sent(origin: string) {
  return {
    message: { id: "wamid.out", type: "text", text: { body: "yo respondo" }, kapso: { direction: "outbound", origin } },
    conversation: { id: "conv_1", phone_number: "+5215512345678", kapso: { contact_name: "María" } },
    phone_number_id: "PHONE_ID",
  };
}

describe("parseKapsoEvents", () => {
  it("parsea texto entrante y normaliza el número a dígitos", async () => {
    const out = await parseKapsoEvents(
      received({ id: "wamid.1", type: "text", text: { body: "hola" }, kapso: { direction: "inbound" } }) as any,
      env,
    );
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("kapso");
    expect(out[0].channelUserId).toBe("5215512345678");
    expect(out[0].text).toBe("hola");
    expect(out[0].displayName).toBe("María");
    expect(out[0].providerMessageId).toBe("wamid.1");
  });

  it("usa el transcript de Kapso para audio (no re-transcribe)", async () => {
    const out = await parseKapsoEvents(
      received({
        id: "wamid.2",
        type: "audio",
        audio: { id: "a1" },
        kapso: { direction: "inbound", transcript: { text: "quiero info del curso" }, media_url: "https://api.kapso.ai/media/x" },
      }) as any,
      env,
    );
    expect(out[0].text).toBe("quiero info del curso");
    expect(out[0].audioUrl).toBeUndefined();
  });

  it("cae al audioUrl si el transcript vino vacío", async () => {
    const out = await parseKapsoEvents(
      received({
        id: "wamid.3",
        type: "audio",
        audio: { id: "a2" },
        kapso: { direction: "inbound", transcript: { text: "" }, media_url: "https://api.kapso.ai/media/y" },
      }) as any,
      env,
    );
    expect(out[0].text).toBeUndefined();
    expect(out[0].audioUrl).toBe("https://api.kapso.ai/media/y");
  });

  it("parsea imagen con caption y media_url ya resuelta por Kapso", async () => {
    const out = await parseKapsoEvents(
      received({
        id: "wamid.4",
        type: "image",
        image: { caption: "ese corte" },
        kapso: { direction: "inbound", media_url: "https://api.kapso.ai/media/img" },
      }) as any,
      env,
    );
    expect(out[0].text).toBe("ese corte");
    expect(out[0].imageUrl).toBe("https://api.kapso.ai/media/img");
  });

  it("ignora mensajes salientes (direction outbound)", async () => {
    const out = await parseKapsoEvents(sent("cloud_api") as any, env);
    expect(out).toHaveLength(0);
  });
});

describe("normalizeKapsoEvents (buffer OFF por defecto, robusto ante batch)", () => {
  it("caso normal: un evento por POST → lista de 1", () => {
    const ev = received({ id: "wamid.1", type: "text", text: { body: "hola" }, kapso: { direction: "inbound" } });
    expect(normalizeKapsoEvents(ev)).toHaveLength(1);
  });

  it("batch como array → cada evento por separado (no pierde ninguno)", () => {
    const a = received({ id: "wamid.a", type: "text", text: { body: "1" }, kapso: { direction: "inbound" } });
    const b = received({ id: "wamid.b", type: "text", text: { body: "2" }, kapso: { direction: "inbound" } });
    const out = normalizeKapsoEvents([a, b]);
    expect(out).toHaveLength(2);
    expect(out[0].message!.id).toBe("wamid.a");
    expect(out[1].message!.id).toBe("wamid.b");
  });

  it("batch como { events: [...] } → expande", () => {
    const a = received({ id: "wamid.a", type: "text", text: { body: "1" }, kapso: { direction: "inbound" } });
    expect(normalizeKapsoEvents({ events: [a] })).toHaveLength(1);
  });
});

describe("verifyKapsoSignature", () => {
  it("acepta la firma correcta y rechaza la incorrecta", async () => {
    const raw = JSON.stringify({ hello: "world" });
    const good = await sign("whsec", raw);
    expect(await verifyKapsoSignature(raw, good, "whsec")).toBe(true);
    expect(await verifyKapsoSignature(raw, good, "otro")).toBe(false);
    expect(await verifyKapsoSignature(raw, "deadbeef", "whsec")).toBe(false);
  });

  it("fail-closed sin secret o sin firma", async () => {
    expect(await verifyKapsoSignature("{}", "x", undefined)).toBe(false);
    expect(await verifyKapsoSignature("{}", null, "whsec")).toBe(false);
  });
});

describe("kapsoOwnerTakeover (coexistencia)", () => {
  beforeEach(() => {
    setPausedUntil.mockClear();
    getOrCreate.mockClear();
  });

  it("el dueño respondió desde su app (business_app) → pausa el chat", async () => {
    const paused = await kapsoOwnerTakeover(sent("business_app") as any, env);
    expect(paused).toBe(true);
    expect(getOrCreate).toHaveBeenCalledWith("kapso", "5215512345678", "María");
    expect(setPausedUntil).toHaveBeenCalledWith("kapso:5215512345678", expect.any(Number));
  });

  it("eco del propio bot (cloud_api) → NO pausa", async () => {
    const paused = await kapsoOwnerTakeover(sent("cloud_api") as any, env);
    expect(paused).toBe(false);
    expect(setPausedUntil).not.toHaveBeenCalled();
  });

  it("backfill de import (history_sync) → NO pausa", async () => {
    const paused = await kapsoOwnerTakeover(sent("history_sync") as any, env);
    expect(paused).toBe(false);
    expect(setPausedUntil).not.toHaveBeenCalled();
  });
});
