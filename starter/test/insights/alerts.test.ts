/**
 * Tests de las Alertas de riesgo (Vigilante con IA, Pro):
 *  • cliente enojado → alerta UNA vez, con quién/qué/link al panel
 *  • re-análisis de la misma conversación → NO hay segunda alerta (claim de por vida)
 *  • venta abierta sin resolver → alerta "venta en riesgo"
 *  • venta resuelta / conversación tranquila → sin alerta
 *  • tier free → sin alerta (el análisis sí se guarda)
 *  • throttle global: máximo HOURLY_ALERT_CAP por hora, sin quemar el claim
 *  • el aviso truena → el análisis queda guardado igual (jamás rompe al Analista)
 *
 * LLM mockeado (patrón de analyzer.test.ts); notifyOwner espiado; D1 real vía miniflare.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
const notifyOwnerMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  tool: (def: unknown) => def,
}));

vi.mock("../../src/llm/provider", () => ({
  // llm/work-model arma con estas dos la cadena de respaldo (el failover que
  // ya tenía el agente). Aquí: un solo candidato, el de createModel.
  envKeyFor: () => undefined,
  fallbackModel: () => null,
  createModel: () => ({
    provider: "anthropic",
    modelId: "claude-haiku-test",
    model: { modelId: "claude-haiku-test" },
    supportsPromptCache: true,
  }),
}));

// Espía sobre la maquinaria EXISTENTE de aviso al dueño (handoff/watchdog).
vi.mock("../../src/tools/handoffHuman", () => ({
  notifyOwner: (...args: unknown[]) => notifyOwnerMock(...args),
}));

import { createTestMiniflare } from "../helpers/miniflareSetup";
import { Db } from "../../src/db/client";
import { ConversationsRepo } from "../../src/db/conversations";
import { MessagesRepo } from "../../src/db/messages";
import { InsightsRepo } from "../../src/db/insights";
import { analyzeConversations, IDLE_MS } from "../../src/insights/analyzer";
import {
  maybeAlertRisk,
  riskReason,
  HOURLY_ALERT_CAP,
  type RiskSignal,
} from "../../src/insights/alerts";
import type { Env } from "../../src/env";

let env: Env;
let db: Db;
let convs: ConversationsRepo;
let msgs: MessagesRepo;
let insights: InsightsRepo;

const ANGRY = {
  sentiment: "angry",
  resolution: "unresolved",
  bot_score: 2,
  topics: ["pedido"],
  summary: "María lleva dos mensajes molesta por su pedido y quedó sin resolver.",
  missed_kb: null,
  sale_opportunity: false,
};

const HOT_OPEN = {
  sentiment: "neutral",
  resolution: "abandoned",
  bot_score: 4,
  topics: ["paquetes"],
  summary: "Preguntó por el paquete de 6 clases y dejó de responder sin cerrar.",
  missed_kb: null,
  sale_opportunity: true,
};

const HOT_RESOLVED = { ...HOT_OPEN, sentiment: "positive", resolution: "resolved" };

const CALM = {
  sentiment: "positive",
  resolution: "resolved",
  bot_score: 5,
  topics: ["horarios"],
  summary: "Preguntó el horario y quedó conforme.",
  missed_kb: null,
  sale_opportunity: false,
};

const angrySignal: RiskSignal = {
  sentiment: "angry",
  resolution: "unresolved",
  saleOpportunity: false,
  summary: "Cliente molesto.",
};

/** Conversación con intercambio real cuyo último mensaje ya pasó IDLE_MS. */
async function seedIdleConversation(userId: string, displayName?: string): Promise<string> {
  const conv = await convs.getOrCreate("whatsapp", userId, displayName);
  const old = Date.now() - IDLE_MS - 60_000;
  await msgs.append(conv.id, "user", "Sigo esperando mi pedido", { createdAt: old - 2000 });
  await msgs.append(conv.id, "assistant", "Déjame revisarlo.", { createdAt: old - 1000 });
  await convs.touchLastMessage(conv.id, old);
  return conv.id;
}

async function riskAlertRows(): Promise<{ conversation_id: string; reason: string; sent_at: number }[]> {
  return db.all("SELECT * FROM risk_alerts ORDER BY conversation_id");
}

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = (await mf.getD1Database("DB")) as any;
  env = {
    DB: d1,
    BOT_TIER: "pro",
    BUSINESS_NAME: "Negocio Test",
    DASHBOARD_BASE_URL: "https://dash.test",
  } as unknown as Env;
  db = new Db(d1);
  convs = new ConversationsRepo(db);
  msgs = new MessagesRepo(db);
  insights = new InsightsRepo(db);
  generateTextMock.mockReset();
  notifyOwnerMock.mockReset();
  notifyOwnerMock.mockResolvedValue(undefined);
});

describe("riskReason", () => {
  it("mapea la calificación al motivo de alerta", () => {
    const base: RiskSignal = { sentiment: "neutral", resolution: "unresolved", saleOpportunity: false, summary: "x" };
    expect(riskReason({ ...base, sentiment: "angry" })).toBe("cliente molesto");
    expect(riskReason({ ...base, sentiment: "frustrated" })).toBe("cliente molesto");
    // Molesto gana aunque también haya venta abierta.
    expect(riskReason({ ...base, sentiment: "angry", saleOpportunity: true })).toBe("cliente molesto");
    expect(riskReason({ ...base, saleOpportunity: true })).toBe("venta en riesgo");
    expect(riskReason({ ...base, saleOpportunity: true, resolution: "abandoned" })).toBe("venta en riesgo");
    expect(riskReason({ ...base, saleOpportunity: true, resolution: "resolved" })).toBeNull();
    expect(riskReason(base)).toBeNull();
    expect(riskReason({ ...base, sentiment: "positive", resolution: "resolved" })).toBeNull();
  });
});

describe("alertas desde el Analista", () => {
  it("cliente enojado → alerta al dueño UNA vez con quién, qué y link al panel", async () => {
    generateTextMock.mockResolvedValue({ text: JSON.stringify(ANGRY) });
    const convId = await seedIdleConversation("521555000001", "María");

    const result = await analyzeConversations(env);
    expect(result.analyzed).toBe(1);
    expect(result.errors).toBe(0);

    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    const [, notice] = notifyOwnerMock.mock.calls[0] as [Env, { reason: string; summary: string; ticketId: string }];
    expect(notice.reason).toBe("cliente molesto");
    // Quién: nombre + canal.
    expect(notice.summary).toContain("María");
    expect(notice.summary).toContain("whatsapp");
    // Qué: el resumen de 1 línea del Analista.
    expect(notice.summary).toContain("molesta por su pedido");
    // Qué hacer: responder desde el panel, con la ruta de conversaciones.
    expect(notice.summary).toContain("panel");
    expect(notice.summary).toContain(
      `https://dash.test/admin/conversations?c=${encodeURIComponent(convId)}`,
    );

    const rows = await riskAlertRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].conversation_id).toBe(convId);
    expect(rows[0].reason).toBe("cliente molesto");
  });

  it("re-análisis de la misma conversación → NO hay segunda alerta", async () => {
    generateTextMock.mockResolvedValue({ text: JSON.stringify(ANGRY) });
    const convId = await seedIdleConversation("521555000002", "María");

    await analyzeConversations(env);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);

    // La clienta regresa (sigue idle después) → el Analista re-califica…
    const later = Date.now() - IDLE_MS - 1000;
    await msgs.append(convId, "user", "¿¡Sigue sin llegar!?", { createdAt: later });
    await convs.touchLastMessage(convId, later);
    await db.run("UPDATE conversation_insights SET analyzed_at = ? WHERE conversation_id = ?", [
      later - 5000,
      convId,
    ]);

    const second = await analyzeConversations(env);
    expect(second.analyzed).toBe(1); // sí se re-analizó
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1); // …pero no se re-alertó
    expect(await riskAlertRows()).toHaveLength(1);
  });

  it("venta abierta sin resolver → alerta 'venta en riesgo'", async () => {
    generateTextMock.mockResolvedValue({ text: JSON.stringify(HOT_OPEN) });
    await seedIdleConversation("521555000003", "Carlos");

    await analyzeConversations(env);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
    const [, notice] = notifyOwnerMock.mock.calls[0] as [Env, { reason: string }];
    expect(notice.reason).toBe("venta en riesgo");
  });

  it("venta resuelta o conversación tranquila → sin alerta", async () => {
    generateTextMock.mockResolvedValue({ text: JSON.stringify(HOT_RESOLVED) });
    await seedIdleConversation("521555000004");
    await analyzeConversations(env);

    generateTextMock.mockResolvedValue({ text: JSON.stringify(CALM) });
    await seedIdleConversation("521555000005");
    await analyzeConversations(env);

    expect(notifyOwnerMock).not.toHaveBeenCalled();
    expect(await riskAlertRows()).toHaveLength(0);
  });

  it("tier free → sin alerta, pero el análisis sí se guarda", async () => {
    env = { ...env, BOT_TIER: "free" } as Env;
    generateTextMock.mockResolvedValue({ text: JSON.stringify(ANGRY) });
    const convId = await seedIdleConversation("521555000006", "María");

    const result = await analyzeConversations(env);
    expect(result.analyzed).toBe(1);
    expect((await insights.getByConversation(convId))?.sentiment).toBe("angry");
    expect(notifyOwnerMock).not.toHaveBeenCalled();
    expect(await riskAlertRows()).toHaveLength(0);
  });

  it("el aviso truena → el análisis queda guardado y no cuenta como error", async () => {
    notifyOwnerMock.mockRejectedValue(new Error("telegram caído"));
    generateTextMock.mockResolvedValue({ text: JSON.stringify(ANGRY) });
    const convId = await seedIdleConversation("521555000007", "María");

    const result = await analyzeConversations(env);
    expect(result.analyzed).toBe(1);
    expect(result.errors).toBe(0);
    expect((await insights.getByConversation(convId))?.sentiment).toBe("angry");
    // El claim se queda (como en followup): mejor una alerta perdida que dos.
    expect(await riskAlertRows()).toHaveLength(1);
  });
});

describe("throttle global (maybeAlertRisk)", () => {
  async function seedConv(userId: string): Promise<string> {
    return (await convs.getOrCreate("telegram", userId, "Cliente")).id;
  }

  /** Pre-carga n alertas "ajenas" con sent_at dado. */
  async function seedAlerts(n: number, sentAt: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await db.run(
        "INSERT OR IGNORE INTO risk_alerts (conversation_id, reason, sent_at) VALUES (?, ?, ?)",
        [`seed:${sentAt}:${i}`, "cliente molesto", sentAt],
      );
    }
  }

  it("permite la alerta número CAP y frena la CAP+1 dentro de la misma hora", async () => {
    const now = Date.now();
    await seedAlerts(HOURLY_ALERT_CAP - 1, now - 60_000);

    const a = await seedConv("t-1");
    expect((await maybeAlertRisk(env, a, angrySignal, now)).alerted).toBe(true);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);

    // Ya hay CAP en la última hora → la siguiente se frena.
    const b = await seedConv("t-2");
    const res = await maybeAlertRisk(env, b, angrySignal, now);
    expect(res.alerted).toBe(false);
    expect(res.reason).toBe("cliente molesto");
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
  });

  it("el throttle NO quema el claim: la conversación puede alertar después", async () => {
    const now = Date.now();
    await seedAlerts(HOURLY_ALERT_CAP, now - 60_000);

    const convId = await seedConv("t-3");
    expect((await maybeAlertRisk(env, convId, angrySignal, now)).alerted).toBe(false);
    const claimed = await db.first("SELECT 1 FROM risk_alerts WHERE conversation_id = ?", [convId]);
    expect(claimed).toBeNull();

    // Una hora después la ventana se vació → ahora sí sale.
    const laterNow = now + 61 * 60 * 1000;
    expect((await maybeAlertRisk(env, convId, angrySignal, laterNow)).alerted).toBe(true);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
  });

  it("alertas viejas (fuera de la ventana de 1h) no cuentan para el throttle", async () => {
    const now = Date.now();
    await seedAlerts(HOURLY_ALERT_CAP, now - 2 * 60 * 60 * 1000);

    const convId = await seedConv("t-4");
    expect((await maybeAlertRisk(env, convId, angrySignal, now)).alerted).toBe(true);
  });

  it("doble llamada concurrente-ish para la misma conversación → una sola alerta", async () => {
    const now = Date.now();
    const convId = await seedConv("t-5");
    expect((await maybeAlertRisk(env, convId, angrySignal, now)).alerted).toBe(true);
    expect((await maybeAlertRisk(env, convId, angrySignal, now)).alerted).toBe(false);
    expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
  });
});
