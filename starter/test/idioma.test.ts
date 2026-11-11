import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "./helpers/miniflareSetup";
import { Db } from "../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../src/db/settings";
import {
  IDIOMAS,
  applyLanguage,
  bustIdiomaCache,
  descripcionIdioma,
  esCodigoValido,
  espejaAlCliente,
  idiomaEfectivo,
} from "../src/idioma";
import { safeConfirmReply } from "../src/blindaje/verify";

describe("qué se le dice al modelo en {{LANGUAGE}}", () => {
  it("los dos españoles NO dicen lo mismo — es el punto de separarlos", () => {
    const latam = descripcionIdioma("es-419");
    const espana = descripcionIdioma("es-ES");
    expect(latam).not.toBe(espana);
    expect(espana).toMatch(/vosotros/i);
    expect(latam).toMatch(/NUNCA uses 'vosotros'/i);
  });

  it("entiende lo que ya traen los bots instalados", () => {
    // Nadie va a editar su wrangler.toml: "es-MX" tiene que seguir funcionando.
    expect(descripcionIdioma("es-MX")).toBe(IDIOMAS["es-419"].prompt);
    expect(descripcionIdioma("es")).toBe(IDIOMAS["es-419"].prompt);
    expect(descripcionIdioma("en-US")).toBe(IDIOMAS.en.prompt);
    expect(descripcionIdioma("pt")).toBe(IDIOMAS["pt-BR"].prompt);
    expect(descripcionIdioma("ES-es")).toBe(IDIOMAS["es-ES"].prompt);
  });

  it("un idioma que no conocemos se respeta tal cual", () => {
    // Si alguien puso "catalán" a mano, no se lo cambiamos por debajo.
    expect(descripcionIdioma("catalán")).toBe("catalán");
  });

  it("vacío cae a español latino, no a un string vacío", () => {
    expect(descripcionIdioma("")).toBe(IDIOMAS["es-419"].prompt);
  });

  it("solo acepta los códigos del selector", () => {
    expect(esCodigoValido("es-ES")).toBe(true);
    expect(esCodigoValido("es-MX")).toBe(false); // válido de entrada, no del selector
    expect(esCodigoValido("klingon")).toBe(false);
    expect(esCodigoValido(undefined)).toBe(false);
  });
});

describe("el idioma se cambia sin redesplegar", () => {
  let env: any;
  let repo: SettingsRepo;

  beforeEach(async () => {
    const mf = await createTestMiniflare();
    const d1 = await mf.getD1Database("DB");
    env = { DB: d1, BOT_LANGUAGE: "es-MX", BOT_TIER: "pro" };
    repo = new SettingsRepo(new Db(d1 as any));
    bustIdiomaCache();
  });

  it("sin ajuste, manda el wrangler.toml", async () => {
    expect(await idiomaEfectivo(env)).toBe("es-MX");
  });

  it("con ajuste, manda el panel", async () => {
    await repo.set(SETTING_KEYS.botLanguage, "en");
    bustIdiomaCache();
    expect(await idiomaEfectivo(env)).toBe("en");
  });

  it("applyLanguage muta env para que los 5 lectores no se enteren", async () => {
    await repo.set(SETTING_KEYS.botLanguage, "pt-BR");
    bustIdiomaCache();
    await applyLanguage(env);
    expect(env.BOT_LANGUAGE).toBe("pt-BR");
  });

  it("un valor basura no deja al bot mudo: cae al del wrangler.toml", async () => {
    await repo.set(SETTING_KEYS.botLanguage, "klingon");
    bustIdiomaCache();
    expect(await idiomaEfectivo(env)).toBe("es-MX");
  });

  it("'espejo' no es un idioma: no se escribe en BOT_LANGUAGE", async () => {
    await repo.set(SETTING_KEYS.botLanguage, "espejo");
    bustIdiomaCache();
    // Si se colara, {{LANGUAGE}} diría "espejo" y el bot hablaría en nada.
    expect(await idiomaEfectivo(env)).toBe("es-MX");
    expect(await espejaAlCliente(env)).toBe(true);
  });

  it("respeta a quien ya tenía encendido el Multi-idioma viejo", async () => {
    await repo.set(SETTING_KEYS.multiLanguage, "1");
    expect(await espejaAlCliente(env)).toBe(true);
  });

  it("sin nada configurado, no espeja", async () => {
    expect(await espejaAlCliente(env)).toBe(false);
  });
});

describe("el blindaje responde en el idioma del bot", () => {
  it("cada idioma tiene su frase", () => {
    expect(safeConfirmReply("en")).toMatch(/team/i);
    expect(safeConfirmReply("pt-BR")).toMatch(/equipe/i);
    expect(safeConfirmReply("es-419")).toMatch(/equipo/i);
  });

  it("los bots viejos con 'en-US' ya NO reciben español", () => {
    // Era el bug: las claves eran es/en/pt y BOT_LANGUAGE trae "en-US",
    // así que todos caían al español — justo cuando el blindaje frena un dato.
    expect(safeConfirmReply("en-US")).toBe(safeConfirmReply("en"));
    expect(safeConfirmReply("en-US")).not.toBe(safeConfirmReply("es-419"));
  });

  it("España y LATAM se saludan distinto", () => {
    expect(safeConfirmReply("es-ES")).not.toBe(safeConfirmReply("es-419"));
  });

  it("cualquier cosa rara cae a español, nunca a vacío", () => {
    for (const v of [undefined, "", "klingon"]) {
      expect(safeConfirmReply(v as any)).toBe(safeConfirmReply("es-419"));
    }
  });

  it("en el canal WEB pide contacto (visitante anónimo); en los demás, no", () => {
    // Web = sesión anónima: sin pedir correo/WhatsApp el ticket queda sin forma
    // de contestarse (reportado por José).
    for (const lang of ["es-419", "es-ES", "en", "pt-BR"]) {
      const web = safeConfirmReply(lang, "web");
      expect(web).not.toBe(safeConfirmReply(lang)); // distinto al normal
      expect(web).toMatch(/correo|whatsapp|email/i); // pide un medio de contacto
    }
    // WhatsApp/Telegram/etc.: el canal ES el contacto → mensaje normal, sin pedir nada.
    expect(safeConfirmReply("es-419", "whatsapp")).toBe(safeConfirmReply("es-419"));
    expect(safeConfirmReply("es-419", "telegram")).toBe(safeConfirmReply("es-419"));
  });
});

describe("el idioma y la moneda llegan a la prompt de verdad", () => {
  it("España y LATAM producen prompts distintos", async () => {
    const { renderSystemPrompt } = await import("../src/system-prompt");
    const base = {
      botName: "Asistente", businessName: "Clínica Hermosilla",
      businessContext: "Consultas 50", toolList: ["searchKb"],
    };
    const es419 = renderSystemPrompt({ ...base, language: descripcionIdioma("es-419") });
    const esES = renderSystemPrompt({ ...base, language: descripcionIdioma("es-ES") });
    expect(es419).not.toBe(esES);
    expect(esES).toMatch(/vosotros/i);
  });

  it("la moneda entra como bloque y dice que NO convierta", async () => {
    const { renderSystemPrompt } = await import("../src/system-prompt");
    const p = renderSystemPrompt({
      botName: "A", businessName: "B", businessContext: "C",
      toolList: [], language: "español", currency: "€",
    });
    expect(p).toContain("<moneda>");
    expect(p).toContain("€");
    expect(p).toMatch(/No conviertas/i);
  });

  it("sin moneda no queda un bloque vacío ni un placeholder suelto", async () => {
    const { renderSystemPrompt } = await import("../src/system-prompt");
    const p = renderSystemPrompt({
      botName: "A", businessName: "B", businessContext: "C",
      toolList: [], language: "español",
    });
    expect(p).not.toContain("<moneda>");
    expect(p).not.toContain("{{CURRENCY_BLOCK}}");
    expect(p).not.toContain("{{LANGUAGE}}");
  });
});
