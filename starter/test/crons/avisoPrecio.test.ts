import { describe, it, expect, vi, beforeEach } from "vitest";
import { personalize } from "../../src/campaigns";
import type { AvisoProgramado } from "../../src/crons/avisoPrecio";

// El módulo del aviso importa sendCampaign; lo mockeamos para no tocar red ni DB.
const sendCampaign = vi.hoisted(() => vi.fn(async (_env: any, _opts: any) => ({
  segment: "interesados", audience: 3, sentFreeform: 3, sentTemplate: 0,
  skippedDuplicate: 0, skippedQuota: 0, failed: 0,
})));
vi.mock("../../src/campaigns", async (orig) => ({
  ...(await orig<typeof import("../../src/campaigns")>()),
  sendCampaign,
}));

const { runAvisosProgramados } = await import("../../src/crons/avisoPrecio");

const env = {} as any;

// Campaña de prueba PROPIA. Antes estos tests asertaban sobre el aviso de
// precio real; cuando esa campaña se canceló y la lista quedó vacía, los tests
// se cayeron sin que nada estuviera roto. Con su propia campaña prueban lo que
// importa —el mecanismo— y sobreviven a que se agende o cancele lo que sea.
const ABRE = Date.UTC(2026, 6, 27, 5, 5, 0);
const CIERRA = Date.UTC(2026, 6, 27, 5, 50, 0);
const aviso = (extra: Partial<AvisoProgramado> = {}): AvisoProgramado => ({
  key: "prueba-2026-07-27",
  segmentId: "interesados",
  from: ABRE,
  to: CIERRA,
  batchSize: 70,
  delayMs: 2500,
  text: "Hola {nombre}, en unos minutos sube el precio.",
  ...extra,
});

const DENTRO = Date.UTC(2026, 6, 27, 5, 9, 0);
const AL_FINAL = Date.UTC(2026, 6, 27, 5, 49, 0);

describe("avisos programados — cuándo dispara", () => {
  beforeEach(() => sendCampaign.mockClear());

  it("no manda nada antes de que abra la ventana", async () => {
    await runAvisosProgramados(env, ABRE - 1, [aviso()]);
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  it("no manda nada después de que cierra", async () => {
    // El fin es exclusivo: justo en `to` ya no debe salir nada.
    await runAvisosProgramados(env, CIERRA, [aviso()]);
    await runAvisosProgramados(env, CIERRA + 3600_000, [aviso()]);
    expect(sendCampaign).not.toHaveBeenCalled();
  });

  it("manda en el instante en que abre y hasta el último tick", async () => {
    await runAvisosProgramados(env, ABRE, [aviso()]);
    await runAvisosProgramados(env, AL_FINAL, [aviso()]);
    expect(sendCampaign).toHaveBeenCalledTimes(2);
  });

  it("sin nada agendado, el cron no hace nada", async () => {
    // Es el estado normal del template: la lista viene vacía.
    await runAvisosProgramados(env, DENTRO, []);
    await runAvisosProgramados(env, DENTRO); // usa la lista real del módulo
    expect(sendCampaign).not.toHaveBeenCalled();
  });
});

describe("avisos programados — cómo manda", () => {
  beforeEach(() => sendCampaign.mockClear());

  it("va por lotes y espaciado, no todos de golpe", async () => {
    await runAvisosProgramados(env, DENTRO, [aviso()]);
    const opts = sendCampaign.mock.calls[0]![1] as any;
    expect(opts.limit).toBe(70);
    expect(opts.delayMs).toBe(2500);
  });

  it("pasa el segmento, el candado y el texto tal cual", async () => {
    await runAvisosProgramados(env, DENTRO, [aviso()]);
    const opts = sendCampaign.mock.calls[0]![1] as any;
    expect(opts.segmentId).toBe("interesados");
    expect(opts.campaignKey).toBe("prueba-2026-07-27"); // el anti-duplicados
    expect(opts.freeformText).toContain("en unos minutos");
    expect(opts.template).toBeUndefined(); // nunca plantilla: solo free-form en ventana
  });

  it("despacha cada campaña agendada, no solo la primera", async () => {
    await runAvisosProgramados(env, DENTRO, [
      aviso({ key: "una" }),
      aviso({ key: "otra", segmentId: "vip" }),
    ]);
    expect(sendCampaign).toHaveBeenCalledTimes(2);
    expect((sendCampaign.mock.calls[1]![1] as any).segmentId).toBe("vip");
  });

  it("si una falla, las demás igual salen", async () => {
    // Un error de envío no puede dejar sin aviso a la campaña que sigue.
    sendCampaign.mockRejectedValueOnce(new Error("boom"));
    await expect(
      runAvisosProgramados(env, DENTRO, [aviso({ key: "rota" }), aviso({ key: "buena" })]),
    ).resolves.toBeUndefined();
    expect(sendCampaign).toHaveBeenCalledTimes(2);
  });
});

describe("personalize", () => {
  it("usa solo el primer nombre", () => {
    expect(personalize("Oye {nombre}, te aviso", "Ana María Pérez")).toBe("Oye Ana, te aviso");
  });

  it("sin nombre, la frase queda natural", () => {
    expect(personalize("Oye {nombre}, te aviso", null)).toBe("Oye, te aviso");
    expect(personalize("Oye {nombre}, te aviso", "   ")).toBe("Oye, te aviso");
  });
});
