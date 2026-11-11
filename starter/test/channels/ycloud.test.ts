import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks de DB/settings para probar la coexistencia sin tocar D1.
const { setPausedUntil, getOrCreate, resolveTakeoverMs } = vi.hoisted(() => ({
  setPausedUntil: vi.fn(async () => {}),
  getOrCreate: vi.fn(async () => ({ id: "ycloud:5218145803756" })),
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
  parseYCloudEvents,
  verifyYCloudSignature,
  ycloudOwnerTakeover,
  normalizeYCloudEvents,
} from "../../src/channels/ycloud";

const ORIGIN = "https://bot.example.workers.dev";
const env = { YCLOUD_WEBHOOK_SECRET: "whsec", YCLOUD_API_KEY: "k", DASHBOARD_BASE_URL: ORIGIN } as any;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function inbound(message: any) {
  return { id: "evt_1", type: "whatsapp.inbound_message.received", apiVersion: "v2", whatsappInboundMessage: message };
}

function echo(to = "+52 81 4580 3756") {
  return {
    id: "evt_e",
    type: "whatsapp.smb.message.echoes",
    whatsappMessage: { wamid: "wamid.x", status: "sent", from: "+528100000000", to, type: "text", customerProfile: { name: "Joe" } },
  };
}

describe("parseYCloudEvents", () => {
  it("parsea texto entrante y normaliza el número; dedup por wamid", async () => {
    const out = await parseYCloudEvents(
      inbound({ id: "id1", wamid: "wamid.1", from: "+52 1 55 1234 5678", type: "text", text: { body: "hola" }, customerProfile: { name: "Joe" } }) as any,
      env,
      ORIGIN,
    );
    expect(out).toHaveLength(1);
    expect(out[0].channel).toBe("ycloud");
    expect(out[0].channelUserId).toBe("5215512345678");
    expect(out[0].text).toBe("hola");
    expect(out[0].displayName).toBe("Joe");
    expect(out[0].providerMessageId).toBe("wamid.1");
  });

  it("imagen → imageUrl firmada por el proxy + caption como texto", async () => {
    const out = await parseYCloudEvents(
      inbound({ wamid: "wamid.2", from: "5215512345678", type: "image", image: { id: "IMG1", caption: "mira" } }) as any,
      env,
      ORIGIN,
    );
    expect(out[0].text).toBe("mira");
    expect(out[0].imageUrl).toContain(`${ORIGIN}/webhooks/ycloud/media/IMG1`);
    expect(out[0].imageUrl).toMatch(/[?&]sig=/);
    expect(out[0].imageUrl).toMatch(/[?&]exp=/);
  });

  it("audio → audioUrl firmada (Forja transcribe; YCloud no transcribe)", async () => {
    const out = await parseYCloudEvents(
      inbound({ wamid: "wamid.3", from: "5215512345678", type: "audio", audio: { id: "AUD1" } }) as any,
      env,
      ORIGIN,
    );
    expect(out[0].text).toBeUndefined();
    expect(out[0].audioUrl).toContain(`${ORIGIN}/webhooks/ycloud/media/AUD1`);
  });

  it("ignora eventos que no son inbound (echoes/status)", async () => {
    expect(await parseYCloudEvents(echo() as any, env, ORIGIN)).toHaveLength(0);
  });
});

describe("verifyYCloudSignature (tipo Stripe, anti-replay)", () => {
  it("acepta firma válida con timestamp reciente", async () => {
    const t = "1762224357";
    const raw = JSON.stringify({ a: 1 });
    const s = await hmacHex("whsec", `${t}.${raw}`);
    const nowMs = Number(t) * 1000 + 1000;
    expect(await verifyYCloudSignature(raw, `t=${t},s=${s}`, "whsec", nowMs)).toBe(true);
  });

  it("rechaza timestamp viejo (replay)", async () => {
    const t = "1000000000"; // muy viejo
    const raw = "{}";
    const s = await hmacHex("whsec", `${t}.${raw}`);
    const nowMs = 1762224357000;
    expect(await verifyYCloudSignature(raw, `t=${t},s=${s}`, "whsec", nowMs)).toBe(false);
  });

  it("rechaza firma incorrecta y fail-closed sin secret/header", async () => {
    const t = "1762224357";
    const nowMs = Number(t) * 1000;
    expect(await verifyYCloudSignature("{}", `t=${t},s=deadbeef`, "whsec", nowMs)).toBe(false);
    expect(await verifyYCloudSignature("{}", `t=${t},s=x`, undefined, nowMs)).toBe(false);
    expect(await verifyYCloudSignature("{}", null, "whsec", nowMs)).toBe(false);
  });
});

describe("ycloudOwnerTakeover (coexistencia)", () => {
  beforeEach(() => {
    setPausedUntil.mockClear();
    getOrCreate.mockClear();
  });

  it("echo del business app → pausa la conversación del cliente (to)", async () => {
    const paused = await ycloudOwnerTakeover(echo("+52 81 4580 3756") as any, env);
    expect(paused).toBe(true);
    expect(getOrCreate).toHaveBeenCalledWith("ycloud", "528145803756", "Joe");
    expect(setPausedUntil).toHaveBeenCalledWith("ycloud:5218145803756", expect.any(Number));
  });

  it("un evento que no es echo → NO pausa", async () => {
    const paused = await ycloudOwnerTakeover(inbound({ from: "1", type: "text", text: { body: "x" } }) as any, env);
    expect(paused).toBe(false);
    expect(setPausedUntil).not.toHaveBeenCalled();
  });
});

describe("normalizeYCloudEvents", () => {
  it("evento único → lista de 1", () => {
    expect(normalizeYCloudEvents(inbound({ from: "1", type: "text", text: { body: "a" } }))).toHaveLength(1);
  });
  it("array o { items: [...] } → expande", () => {
    expect(normalizeYCloudEvents([{}, {}])).toHaveLength(2);
    expect(normalizeYCloudEvents({ items: [{}] })).toHaveLength(1);
  });
});
