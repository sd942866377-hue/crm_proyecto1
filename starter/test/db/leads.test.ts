import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { LeadsRepo } from "../../src/db/leads";
import { ConversationsRepo } from "../../src/db/conversations";

const { dispatchMock } = vi.hoisted(() => ({ dispatchMock: vi.fn() }));
vi.mock("../../src/mobile-push", () => ({ dispatchMobilePush: dispatchMock }));

let repo: LeadsRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  repo = new LeadsRepo(new Db(d1 as any));
  dispatchMock.mockReset();
  dispatchMock.mockResolvedValue(undefined);
});

describe("LeadsRepo", () => {
  it("creates a lead and lists it", async () => {
    const id = await repo.create({
      name: "María",
      contact: "+5215512345",
      intent: "Corte+barba 5pm",
      conversationId: null,
      channelUserId: "5512345",
    });
    expect(id).toBeTruthy();
    const list = await repo.list(10);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("María");
    expect(list[0].status).toBe("new");
  });

  it("setStatus updates the row", async () => {
    const id = await repo.create({
      name: "Pedro",
      contact: "pedro@x.com",
      intent: "tinte",
      conversationId: null,
      channelUserId: null,
    });
    await repo.setStatus(id, "sold");
    const list = await repo.list(10);
    expect(list[0].status).toBe("sold");
  });
});

describe("LeadsRepo — push lead_hot (stretch v2)", () => {
  let d1: any;
  let db: Db;
  let convId: string;

  beforeEach(async () => {
    const mf = await createTestMiniflare();
    d1 = await mf.getD1Database("DB");
    db = new Db(d1 as any);
    const conv = await new ConversationsRepo(db).getOrCreate("telegram", "u1");
    convId = conv.id;
  });

  it("dispara push cuando el intent suena a compra Y hay env", async () => {
    const withEnv = new LeadsRepo(db, { DB: d1 } as any);
    await withEnv.create({
      name: "María",
      intent: "Pedido · 2 tacos",
      conversationId: convId,
      channelUserId: "u1",
    });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][1]).toMatchObject({
      type: "lead_hot",
      title: "Alguien quiere comprar — María",
      body: "Pedido · 2 tacos",
      conversationId: convId,
    });
  });

  it("NO dispara si el intent no tiene señal de compra", async () => {
    const withEnv = new LeadsRepo(db, { DB: d1 } as any);
    await withEnv.create({
      intent: "Preguntó por el horario de mañana",
      conversationId: convId,
      channelUserId: "u1",
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("NO dispara sin env (compat: create() sigue funcionando igual que antes)", async () => {
    const withoutEnv = new LeadsRepo(db);
    await withoutEnv.create({
      intent: "Pedido · pizza",
      conversationId: convId,
      channelUserId: "u1",
    });
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("throttle: máx 1 push por conversación por hora", async () => {
    const withEnv = new LeadsRepo(db, { DB: d1 } as any);
    await withEnv.create({ intent: "Pedido · tacos", conversationId: convId, channelUserId: "u1" });
    await withEnv.create({ intent: "Pedido · refresco", conversationId: convId, channelUserId: "u1" });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });
});
