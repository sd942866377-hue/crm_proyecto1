/**
 * Tests del push de riesgo del Analista (src/insights/pushAlerts.ts):
 *  • insightPushType: cancel gana sobre molesto; angry o frustrado REPETIDO → upset
 *  • dispatch con el shape correcto (título PII-safe, motivo + preview)
 *  • throttle por (tipo + conversación) en la ventana, separado por tipo
 *
 * dispatchMobilePush espiado; D1 real vía miniflare para el throttle (settings)
 * y el nombre del cliente (conversations).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dispatchMock = vi.fn();

vi.mock("../../src/mobile-push", () => ({
  dispatchMobilePush: (...args: unknown[]) => dispatchMock(...args),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import {
  maybeDispatchInsightPush,
  insightPushType,
  INSIGHT_PUSH_THROTTLE_MS,
  type InsightPushSignal,
} from "../../src/insights/pushAlerts";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;

const base: InsightPushSignal = {
  sentiment: "neutral",
  cancelIntent: false,
  summary: "resumen",
};

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = { DB: d1, BOT_TIER: "pro", CONTROL_PLANE_TOKEN: "fcp" } as unknown as Env;
  db = new Db(d1);
  convs = new ConversationsRepo(db);
  dispatchMock.mockReset();
  dispatchMock.mockResolvedValue(undefined);
});

describe("insightPushType", () => {
  it("cancelIntent → 'cancel' (gana sobre cualquier sentiment)", () => {
    expect(insightPushType({ ...base, cancelIntent: true })).toBe("cancel");
    expect(insightPushType({ ...base, sentiment: "angry", cancelIntent: true })).toBe("cancel");
  });

  it("angry → 'upset'", () => {
    expect(insightPushType({ ...base, sentiment: "angry" })).toBe("upset");
  });

  it("frustrated REPETIDO (prior frustrado/enojado) → 'upset'", () => {
    expect(insightPushType({ ...base, sentiment: "frustrated", priorSentiment: "frustrated" })).toBe("upset");
    expect(insightPushType({ ...base, sentiment: "frustrated", priorSentiment: "angry" })).toBe("upset");
  });

  it("frustrated AISLADO (sin prior, o prior tranquilo) → null", () => {
    expect(insightPushType({ ...base, sentiment: "frustrated" })).toBeNull();
    expect(insightPushType({ ...base, sentiment: "frustrated", priorSentiment: null })).toBeNull();
    expect(insightPushType({ ...base, sentiment: "frustrated", priorSentiment: "neutral" })).toBeNull();
    expect(insightPushType({ ...base, sentiment: "frustrated", priorSentiment: "positive" })).toBeNull();
  });

  it("tranquilo → null", () => {
    expect(insightPushType({ ...base, sentiment: "neutral" })).toBeNull();
    expect(insightPushType({ ...base, sentiment: "positive" })).toBeNull();
  });
});

describe("maybeDispatchInsightPush — dispatch + shape", () => {
  it("angry → push 'upset' con título PII-safe + motivo y preview en el cuerpo", async () => {
    const conv = await convs.getOrCreate("whatsapp", "521555000001", "María");
    const res = await maybeDispatchInsightPush(env, conv.id, {
      sentiment: "angry",
      cancelIntent: false,
      summary: "Lleva dos mensajes molesta por su pedido",
      lastUserText: "esto no sirve para nada",
    });
    expect(res).toEqual({ pushed: true, type: "upset" });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const [, ev] = dispatchMock.mock.calls[0] as [Env, { type: string; title: string; body: string; conversationId: string }];
    expect(ev.type).toBe("upset");
    expect(ev.title).toBe("😠 María está molesto");
    expect(ev.body).toContain("Lleva dos mensajes molesta por su pedido");
    expect(ev.body).toContain('"esto no sirve para nada"');
    expect(ev.conversationId).toBe(conv.id);
  });

  it("cancel → push 'cancel'; sin display_name el título enmascara el contacto", async () => {
    const conv = await convs.getOrCreate("whatsapp", "521555000002");
    const res = await maybeDispatchInsightPush(env, conv.id, {
      sentiment: "frustrated",
      cancelIntent: true,
      summary: "Pidió cancelar su membresía",
      lastUserText: "quiero cancelar",
    });
    expect(res.type).toBe("cancel");
    const [, ev] = dispatchMock.mock.calls[0] as [Env, { title: string }];
    expect(ev.title).toBe("🚫 ***0002 quiere darse de baja");
    // Nunca el contacto crudo en el título.
    expect(ev.title).not.toContain("521555000002");
  });

  it("frustrado aislado o tranquilo → no dispatch", async () => {
    const c1 = await convs.getOrCreate("telegram", "t1");
    expect((await maybeDispatchInsightPush(env, c1.id, { ...base, sentiment: "frustrated" })).pushed).toBe(false);
    const c2 = await convs.getOrCreate("telegram", "t2");
    expect((await maybeDispatchInsightPush(env, c2.id, { ...base, sentiment: "positive" })).pushed).toBe(false);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe("maybeDispatchInsightPush — throttle por (tipo + conversación)", () => {
  const angry: InsightPushSignal = { sentiment: "angry", cancelIntent: false, summary: "molesta" };

  it("segundo aviso del mismo tipo dentro de la ventana → frenado; pasada la ventana → sale", async () => {
    const conv = await convs.getOrCreate("whatsapp", "521555000010", "Ana");
    const now = Date.now();
    expect((await maybeDispatchInsightPush(env, conv.id, angry, now)).pushed).toBe(true);
    // Sigue enojada al ratito → NO metralla el teléfono.
    expect((await maybeDispatchInsightPush(env, conv.id, angry, now + 60_000)).pushed).toBe(false);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    // Pasada la ventana → vuelve a avisar.
    const later = now + INSIGHT_PUSH_THROTTLE_MS + 1000;
    expect((await maybeDispatchInsightPush(env, conv.id, angry, later)).pushed).toBe(true);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it("el throttle es POR TIPO: un 'cancel' no lo frena un 'upset' previo", async () => {
    const conv = await convs.getOrCreate("whatsapp", "521555000011", "Ana");
    const now = Date.now();
    await maybeDispatchInsightPush(env, conv.id, angry, now);
    // Mismo instante, misma conversación, pero es OTRO tipo → sí sale.
    const res = await maybeDispatchInsightPush(
      env,
      conv.id,
      { sentiment: "angry", cancelIntent: true, summary: "quiere cancelar" },
      now,
    );
    expect(res.type).toBe("cancel");
    expect(res.pushed).toBe(true);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });
});
