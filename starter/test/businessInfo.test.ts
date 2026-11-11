import { describe, it, expect } from "vitest";
import {
  sanitizePromo,
  renderPromoBlock,
  sanitizeLocation,
  renderLocationBlock,
  sanitizePaymentMethods,
  renderPaymentMethodsBlock,
  sanitizeCatalog,
  renderCatalogBlock,
} from "../src/businessInfo";

const NOW = new Date("2026-08-28T12:00:00Z");

describe("promo / oferta vigente", () => {
  it("saneada: active + texto + fecha válida", () => {
    const p = sanitizePromo({ active: true, text: "  2x1 en cortes  ", endsAt: "2026-09-01" });
    expect(p).toEqual({ active: true, text: "2x1 en cortes", endsAt: "2026-09-01" });
  });

  it("fecha inválida se descarta; active no-booleano = false", () => {
    const p = sanitizePromo({ active: "yes", text: "x", endsAt: "01/09/2026" });
    expect(p.active).toBe(false);
    expect(p.endsAt).toBeUndefined();
  });

  it("render: activa y sin vencer → aparece con vigencia", () => {
    const out = renderPromoBlock({ active: true, text: "2x1 este finde", endsAt: "2026-09-01" }, NOW);
    expect(out).toContain("2x1 este finde");
    expect(out).toContain("2026-09-01");
    expect(out).toContain("ÚNICA promoción");
  });

  it("render: inactiva → vacío", () => {
    expect(renderPromoBlock({ active: false, text: "algo" }, NOW)).toBe("");
  });

  it("render: sin texto → vacío", () => {
    expect(renderPromoBlock({ active: true, text: "" }, NOW)).toBe("");
  });

  it("render: vencida (endsAt < hoy) → vacío", () => {
    expect(renderPromoBlock({ active: true, text: "vieja", endsAt: "2026-08-27" }, NOW)).toBe("");
  });

  it("render: vence HOY (inclusive) → todavía aparece", () => {
    expect(renderPromoBlock({ active: true, text: "hoy", endsAt: "2026-08-28" }, NOW)).toContain("hoy");
  });
});

describe("ubicación y cobertura", () => {
  it("saneada: mapsUrl no-http se descarta, modos inválidos se filtran, areas cap 20", () => {
    const loc = sanitizeLocation({
      address: "Av. Reforma 123",
      mapsUrl: "javascript:alert(1)",
      serviceModes: ["local", "teletransporte", "domicilio"],
      areas: ["Roma", "Condesa", 42, ""],
    });
    expect(loc.address).toBe("Av. Reforma 123");
    expect(loc.mapsUrl).toBeUndefined();
    expect(loc.serviceModes).toEqual(["local", "domicilio"]);
    expect(loc.areas).toEqual(["Roma", "Condesa"]);
  });

  it("render incluye dirección, modo y zonas; vacío si no hay nada", () => {
    const out = renderLocationBlock({
      address: "Calle 1",
      mapsUrl: "https://maps.google.com/x",
      serviceModes: ["domicilio"],
      areas: ["Norte"],
    });
    expect(out).toContain("Calle 1");
    expect(out).toContain("https://maps.google.com/x");
    expect(out).toContain("domicilio");
    expect(out).toContain("Norte");
    expect(renderLocationBlock({ serviceModes: [], areas: [] })).toBe("");
  });
});

describe("formas de pago", () => {
  it("saneada: cap 12, trim, descarta no-string", () => {
    const pm = sanitizePaymentMethods({ methods: ["Efectivo", " Tarjeta ", 7, ""], note: "MSI a 3 meses" });
    expect(pm.methods).toEqual(["Efectivo", "Tarjeta"]);
    expect(pm.note).toBe("MSI a 3 meses");
  });

  it("render lista métodos; vacío si no hay", () => {
    expect(renderPaymentMethodsBlock({ methods: ["Efectivo", "Tarjeta"] })).toContain("Efectivo, Tarjeta");
    expect(renderPaymentMethodsBlock({ methods: [] })).toBe("");
  });
});

describe("servicios y precios (catalog)", () => {
  it("saneado: descarta sin nombre, cap 50, precio/nota opcionales", () => {
    const cat = sanitizeCatalog([
      { name: "Corte", price: "$200" },
      { price: "$999" }, // sin nombre → fuera
      { name: "Tinte", note: "incluye lavado" },
    ]);
    expect(cat).toHaveLength(2);
    expect(cat[0]).toMatchObject({ name: "Corte", price: "$200" });
    expect(cat[1]).toMatchObject({ name: "Tinte", note: "incluye lavado" });
  });

  it("render con precio y nota; vacío si no hay", () => {
    const out = renderCatalogBlock([{ id: "c", name: "Corte", price: "$200", note: "30 min" }]);
    expect(out).toContain("- Corte: $200 (30 min)");
    expect(renderCatalogBlock([])).toBe("");
  });
});
