import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderQualityReport, verdict, loadBrand, type Brand } from "../../scripts/quality-report";
import type { EvalSummary, EvalFixture } from "../../scripts/eval-bot-live";

const BRAND: Brand = {
  name: "Café Aurora",
  business: "Café Aurora",
  botName: "Aura",
  accent: "#D8734E",
  accent2: "#EAA982",
  hideForja: false,
};

const FIXTURES: EvalFixture[] = [
  { id: "faq-precio", userMessage: "¿precio?", rubric: "Da el precio real sin inventar" },
  { id: "handoff", userMessage: "quiero un humano", rubric: "Escala a una persona" },
];

function summaryOf(passRate: number): EvalSummary {
  const results = [
    { id: "faq-precio", passed: true, reason: "Dio el precio correcto." },
    { id: "handoff", passed: passRate >= 1, reason: passRate >= 1 ? "Escaló bien." : "No escaló." },
  ];
  const passed = results.filter((r) => r.passed).length;
  return { total: results.length, passed, failed: results.length - passed, passRate, threshold: 0.85, meetsThreshold: passRate >= 0.85, results };
}

describe("verdict", () => {
  it("mapea el pass-rate a un veredicto de negocio", () => {
    expect(verdict(1).tone).toBe("great");
    expect(verdict(0.9).tone).toBe("good");
    expect(verdict(0.75).tone).toBe("ok");
    expect(verdict(0.4).tone).toBe("bad");
  });
});

describe("renderQualityReport", () => {
  const html = renderQualityReport({ summary: summaryOf(0.5), fixtures: FIXTURES, brand: BRAND, generatedAt: "2026-08-03T10:00:00Z" });

  it("es un documento HTML autocontenido", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).not.toContain("http://"); // sin recursos externos inseguros
  });

  it("muestra el score, la marca y el nombre del bot", () => {
    expect(html).toContain("50<small>%</small>");
    expect(html).toContain("Café Aurora");
    expect(html).toContain("Aura");
    expect(html).toContain("1 de 2 pruebas superadas");
  });

  it("pinta la boleta con la rúbrica y ambas marcas ✓/✗", () => {
    expect(html).toContain("Da el precio real sin inventar");
    expect(html).toContain("Escala a una persona");
    expect(html).toContain("✓");
    expect(html).toContain("✗");
  });

  it("aplica el color de la marca como acento", () => {
    expect(html).toContain("#D8734E");
  });

  it("escapa HTML del contenido (no inyección)", () => {
    const evil = renderQualityReport({
      summary: { total: 1, passed: 1, failed: 0, passRate: 1, threshold: 0.85, meetsThreshold: true, results: [{ id: "x", passed: true, reason: "<script>alert(1)</script>" }] },
      fixtures: [{ id: "x", userMessage: "u", rubric: "<b>malo</b>" }],
      brand: BRAND,
      generatedAt: "2026-08-03T10:00:00Z",
    });
    expect(evil).not.toContain("<script>alert(1)</script>");
    expect(evil).toContain("&lt;script&gt;");
  });

  it("respeta BRAND_HIDE_FORJA: oculta Forja cuando está en on", () => {
    const hidden = renderQualityReport({ summary: summaryOf(1), fixtures: FIXTURES, brand: { ...BRAND, hideForja: true }, generatedAt: "2026-08-03T10:00:00Z" });
    expect(hidden).not.toContain("Forja");
    const shown = renderQualityReport({ summary: summaryOf(1), fixtures: FIXTURES, brand: { ...BRAND, hideForja: false }, generatedAt: "2026-08-03T10:00:00Z" });
    expect(shown).toContain("Forja");
  });
});

describe("loadBrand", () => {
  it("lee la marca del wrangler.toml (BRAND_* → fallback BUSINESS_NAME)", () => {
    const dir = mkdtempSync(join(tmpdir(), "brand-"));
    const toml = join(dir, "wrangler.toml");
    writeFileSync(toml, [
      'BUSINESS_NAME = "Café Aurora"',
      'BOT_NAME = "Aura"',
      'BRAND_NAME = "Barra Norte"',
      'BRAND_ACCENT = "#123456"',
      'BRAND_HIDE_FORJA = "on"',
    ].join("\n"));
    const b = loadBrand(toml);
    expect(b.name).toBe("Barra Norte"); // BRAND_NAME gana
    expect(b.business).toBe("Café Aurora");
    expect(b.botName).toBe("Aura");
    expect(b.accent).toBe("#123456");
    expect(b.hideForja).toBe(true);
  });

  it("cae a defaults si no hay wrangler.toml", () => {
    const b = loadBrand(join(tmpdir(), "no-existe-xyz.toml"));
    expect(b.name).toBe("Tu negocio");
    expect(b.hideForja).toBe(false);
  });
});
