import { describe, it, expect } from "vitest";
import { selectModel, type ModelSelectionContext } from "../../src/upgrade/modelSelector";

const base: ModelSelectionContext = {
  toolCallsInLast2Turns: 0,
  lastUserText: "hola",
  lastUserLang: "es",
  hasImage: false,
  imageRetryCount: 0,
  lastSearchKbScore: 0.9,
  transactional: false,
};

describe("selectModel", () => {
  it("defaults to haiku", () => {
    expect(selectModel(base)).toBe("fast");
  });

  it("upgrades to sonnet on multi-tool turns", () => {
    expect(selectModel({ ...base, toolCallsInLast2Turns: 4 })).toBe("smart");
  });

  it("upgrades on frustration keywords ES", () => {
    expect(selectModel({ ...base, lastUserText: "esto no sirve para nada" })).toBe("smart");
  });

  it("upgrades on KB miss (low score)", () => {
    expect(selectModel({ ...base, lastUserLang: "en", lastSearchKbScore: 0.4 })).toBe("smart");
  });

  it("upgrades on image retry", () => {
    expect(selectModel({ ...base, hasImage: true, imageRetryCount: 1 })).toBe("smart");
  });

  it("upgrades for transactional bots (pedidos/citas/reservas), aun en un turno simple", () => {
    // "Un hot dog y combo Royal" corría en haiku y aplastaba el flujo de varios
    // pasos en un solo mensaje. Con tools de intake activas, arranca en smart.
    expect(selectModel({ ...base, transactional: true })).toBe("smart");
  });
});
