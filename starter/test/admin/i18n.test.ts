import { describe, it, expect } from "vitest";
import {
  DICCIONARIOS,
  LOCALES_PANEL,
  esLocalePanel,
  localePanel,
  traductor,
} from "../../src/admin/i18n";
import type { Env } from "../../src/env";

const env = (extra: Record<string, unknown> = {}) => ({ BOT_LANGUAGE: "es-MX", ...extra }) as Env;

describe("los diccionarios no se pueden quedar a medias", () => {
  // ESTE es el test que mantiene vivo el i18n. Sin él, cada feature nueva
  // agrega textos solo en español y en dos meses el panel está medio traducido.
  const base = Object.keys(DICCIONARIOS["es-419"]).sort();

  for (const locale of Object.keys(DICCIONARIOS) as (keyof typeof DICCIONARIOS)[]) {
    it(`${locale} tiene exactamente las mismas claves que es-419`, () => {
      const claves = Object.keys(DICCIONARIOS[locale]).sort();
      const faltan = base.filter((k) => !claves.includes(k));
      const sobran = claves.filter((k) => !base.includes(k));
      expect(faltan, `faltan en ${locale}`).toEqual([]);
      expect(sobran, `sobran en ${locale} (¿typo en la clave?)`).toEqual([]);
    });

    it(`${locale} no deja ningún texto vacío`, () => {
      const vacias = Object.entries(DICCIONARIOS[locale])
        .filter(([, v]) => !v || !v.trim())
        .map(([k]) => k);
      expect(vacias, `vacías en ${locale}`).toEqual([]);
    });
  }

  it("cada idioma del selector tiene su diccionario", () => {
    expect(Object.keys(DICCIONARIOS).sort()).toEqual(Object.keys(LOCALES_PANEL).sort());
  });

  it("de verdad están traducidos, no copiados del español", () => {
    // Si alguien agrega un idioma pegando el español, esto lo caza.
    const es = DICCIONARIOS["es-419"];
    for (const locale of ["en", "pt-BR"] as const) {
      const iguales = Object.keys(es).filter((k) => DICCIONARIOS[locale][k] === es[k]);
      // "Leads", "Tickets", "Insights" y "Cancelar" son iguales a propósito.
      expect(iguales.length, `${locale}: ${iguales.length} textos sin traducir`).toBeLessThan(
        Object.keys(es).length * 0.25,
      );
    }
  });
});

describe("qué idioma ve el dueño en su panel", () => {
  it("usa el que eligió", () => {
    expect(localePanel(env({ PANEL_LANGUAGE: "en" }))).toBe("en");
    expect(localePanel(env({ PANEL_LANGUAGE: "pt-BR" }))).toBe("pt-BR");
  });

  it("si no eligió, hereda del idioma del BOT", () => {
    // Quien puso su bot en portugués casi seguro quiere el panel en portugués.
    expect(localePanel(env({ BOT_LANGUAGE: "pt-BR" }))).toBe("pt-BR");
    expect(localePanel(env({ BOT_LANGUAGE: "en" }))).toBe("en");
    expect(localePanel(env({ BOT_LANGUAGE: "es-ES" }))).toBe("es-ES");
  });

  it("pero el del panel MANDA sobre el del bot", () => {
    // El caso que pidió Santi: bot en inglés, panel en español.
    expect(localePanel(env({ BOT_LANGUAGE: "en", PANEL_LANGUAGE: "es-419" }))).toBe("es-419");
  });

  it("un bot con es-MX (lo que traen los instalados) cae en LATAM", () => {
    expect(localePanel(env({ BOT_LANGUAGE: "es-MX" }))).toBe("es-419");
  });

  it("basura no rompe nada", () => {
    expect(localePanel(env({ PANEL_LANGUAGE: "klingon" }))).toBe("es-419");
    expect(esLocalePanel("klingon")).toBe(false);
  });
});

describe("traducir", () => {
  it("devuelve el texto del idioma pedido", () => {
    expect(traductor(env({ PANEL_LANGUAGE: "en" }))("nav.conversations")).toBe("Conversations");
    expect(traductor(env({ PANEL_LANGUAGE: "pt-BR" }))("nav.costs")).toBe("Custos");
    expect(traductor(env({ PANEL_LANGUAGE: "es-419" }))("nav.costs")).toBe("Costos");
  });

  it("España hereda de LATAM lo que no cambia", () => {
    const es = traductor(env({ PANEL_LANGUAGE: "es-419" }));
    const esp = traductor(env({ PANEL_LANGUAGE: "es-ES" }));
    expect(esp("nav.conversations")).toBe(es("nav.conversations")); // igual
    expect(esp("config.idiomaPanelAyuda")).not.toBe(es("config.idiomaPanelAyuda")); // distinto
  });

  it("una clave que no existe devuelve la clave, nunca vacío", () => {
    // Un botón en el idioma equivocado se puede vivir; uno en blanco no.
    const t = traductor(env({ PANEL_LANGUAGE: "en" }));
    expect(t("no.existe" as never)).toBe("no.existe");
  });
});
