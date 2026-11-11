import { describe, it, expect } from "vitest";
import { salesVariantFor, salesStrategyBlock, VARIANT_BRIEFS } from "../../src/tools/masterclass";

describe("salesVariantFor", () => {
  it("misma conversación → mismo vendedor siempre", () => {
    for (const id of ["twilio:+5215512345678", "telegram:99887", "x"]) {
      expect(salesVariantFor(id)).toBe(salesVariantFor(id));
    }
  });

  it("reparte ambas variantes de forma razonable", () => {
    const counts = { consultivo: 0, directo: 0 };
    for (let i = 0; i < 200; i++) counts[salesVariantFor(`twilio:+52155${i}`)]++;
    expect(counts.consultivo).toBeGreaterThan(50);
    expect(counts.directo).toBeGreaterThan(50);
  });
});

describe("salesStrategyBlock", () => {
  it("incluye el brief de la variante asignada y la regla de no revelarse", () => {
    const id = "twilio:+5215500000001";
    const block = salesStrategyBlock(id);
    expect(block).toContain(VARIANT_BRIEFS[salesVariantFor(id)]);
    expect(block).toContain("NUNCA menciones");
  });
});
