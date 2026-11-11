import { describe, it, expect } from "vitest";
import { renderConfig } from "../../src/admin/views/config";
import type { Env } from "../../src/env";

const env = (extra: Partial<Env> = {}) =>
  ({ BUSINESS_NAME: "Horizontes IA", BOT_LANGUAGE: "es-MX", BOT_TIER: "pro", ...extra }) as Env;

describe("Config — el selector de idioma se encuentra", () => {
  // Estuvo al 76% de una página de 62 KB, debajo de doce tarjetas y de los
  // toggles de Superpoderes. Nadie lo encontraba: "no veo dónde se cambia el
  // idioma" (29-jul-2026). Que exista no basta — tiene que verse.
  it("va ARRIBA de las tarjetas de control, no enterrado al final", () => {
    const html = renderConfig(env(), {}, false);
    const idioma = html.indexOf("Idioma y moneda");
    const tarjetas = html.indexOf("Card-based controls");

    expect(idioma).toBeGreaterThan(-1);
    expect(idioma).toBeLessThan(tarjetas);
  });

  it("trae los dos selectores: el del bot y el del panel", () => {
    const html = renderConfig(env(), {}, false);
    expect(html).toContain('name="bot_language"');
    expect(html).toContain('name="panel_language"');
  });

  // Un bot free igual debe poder cambiar idioma: solo "espeja al cliente" es Pro.
  it("también aparece en un bot free", () => {
    const html = renderConfig(env({ BOT_TIER: "free" } as Partial<Env>), {}, false);
    expect(html).toContain("Idioma y moneda");
    expect(html).toContain('name="panel_language"');
  });
});
