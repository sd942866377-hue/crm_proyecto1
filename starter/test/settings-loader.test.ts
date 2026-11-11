import { describe, it, expect, beforeEach } from "vitest";
import { createTestMiniflare } from "./helpers/miniflareSetup";
import { Db } from "../src/db/client";
import { SettingsRepo, SETTING_KEYS } from "../src/db/settings";
import { resolveAgentConfig } from "../src/settings-loader";

const TOOLS = ["searchKb", "handoffHuman"];

let env: any;
let repo: SettingsRepo;

beforeEach(async () => {
  const mf = await createTestMiniflare();
  const d1 = await mf.getD1Database("DB");
  env = {
    DB: d1,
    BOT_NAME: "Asistente",
    BUSINESS_NAME: "Test Business",
    BOT_LANGUAGE: "es",
    BOT_TIER: "pro",
    BUFFER_SECONDS: "12",
  };
  repo = new SettingsRepo(new Db(d1 as any));
});

describe("resolveAgentConfig", () => {
  it("uses env/defaults when settings are empty", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.bufferMs).toBe(12_000); // from BUFFER_SECONDS
    expect(cfg.maxChunks).toBe(3);
    expect(cfg.interChunkDelayMs).toBe(1000);
    expect(cfg.modelOverride).toBe("auto");
    expect(cfg.botPaused).toBe(false);
    expect(cfg.systemPrompt).toContain("Asistente"); // env BOT_NAME
    expect(cfg.systemPrompt).toContain("<role>");
    expect(cfg.systemPrompt).not.toContain("{{");
  });

  it("system_prompt_override wins over the generated prompt", async () => {
    await repo.set(SETTING_KEYS.systemPromptOverride, "MI PROMPT CUSTOM");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toBe("MI PROMPT CUSTOM");
  });

  it("applies bot_name, tone and escalation_keywords into the generated prompt", async () => {
    await repo.set(SETTING_KEYS.botName, "Pelusa");
    await repo.set(SETTING_KEYS.tone, "divertido y relajado");
    await repo.set(SETTING_KEYS.escalationKeywords, "reembolso, gerente");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("Pelusa");
    expect(cfg.systemPrompt).toContain("divertido y relajado");
    expect(cfg.systemPrompt).toContain("reembolso, gerente");
  });

  it("custom_instructions se inyecta en el prompt generado (aditivo) sin borrar los frenos", async () => {
    await repo.set(SETTING_KEYS.customInstructions, "No agendes domingos.");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("<custom_instructions>");
    expect(cfg.systemPrompt).toContain("No agendes domingos.");
    expect(cfg.systemPrompt).toContain("<core_principles>"); // los frenos siguen
  });

  it("custom_instructions:<canal> gana sobre el global; un canal sin regla usa la global", async () => {
    await repo.set(SETTING_KEYS.customInstructions, "REGLA GLOBAL");
    await repo.set(`${SETTING_KEYS.customInstructions}:whatsapp`, "REGLA WHATSAPP");
    const wa = await resolveAgentConfig(env, TOOLS, "whatsapp");
    expect(wa.systemPrompt).toContain("REGLA WHATSAPP");
    expect(wa.systemPrompt).not.toContain("REGLA GLOBAL");
    const tg = await resolveAgentConfig(env, TOOLS, "telegram");
    expect(tg.systemPrompt).toContain("REGLA GLOBAL");
  });

  it("un system_prompt_override manual reemplaza TODO — custom_instructions no aparece", async () => {
    await repo.set(SETTING_KEYS.customInstructions, "REGLA CUSTOM");
    await repo.set(SETTING_KEYS.systemPromptOverride, "PROMPT MANUAL COMPLETO");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toBe("PROMPT MANUAL COMPLETO");
    expect(cfg.systemPrompt).not.toContain("REGLA CUSTOM");
  });

  it("business_hours estructurado se AGREGA al texto viejo (nunca lo borra) y manda al renderizar (Wiring v2 §3)", async () => {
    await repo.set(
      SETTING_KEYS.businessHours,
      JSON.stringify({
        days: {
          lun: { from: "10:00", to: "20:00" },
          mar: { from: "10:00", to: "20:00" },
          mie: { from: "10:00", to: "20:00" },
          jue: { from: "10:00", to: "20:00" },
          vie: { from: "10:00", to: "20:00" },
          sab: { from: "09:00", to: "18:00" },
          dom: null,
        },
        awayMessage: "Te contestamos en cuanto abramos.",
      }),
    );
    const cfg = await resolveAgentConfig(env, TOOLS);
    // El texto libre viejo (member/config.local businessConfig.hours) SIGUE ahí.
    expect(cfg.businessContext).toContain("Horarios:");
    // El bloque estructurado se agregó, agrupado, con precedencia explícita.
    expect(cfg.businessContext).toContain("Lun–Vie 10:00–20:00");
    expect(cfg.businessContext).toContain("Sáb 09:00–18:00");
    expect(cfg.businessContext).toContain("Dom cerrado");
    expect(cfg.businessContext).toContain("fuente de verdad");
    expect(cfg.businessContext).toContain("Te contestamos en cuanto abramos.");
    // Y el prompt renderizado lo trae también (mismo businessContext).
    expect(cfg.systemPrompt).toContain("Lun–Vie 10:00–20:00");
  });

  it("business_hours malformado se ignora en silencio — el texto de siempre no se rompe", async () => {
    await repo.set(SETTING_KEYS.businessHours, "{ esto no es json válido");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.businessContext).toContain("Horarios:");
    expect(cfg.systemPrompt).not.toContain("{{");
  });

  it("datos universales (promo/ubicación/pago/servicios) se AGREGAN al prompt como fuente de verdad", async () => {
    await repo.set(
      SETTING_KEYS.promo,
      JSON.stringify({ active: true, text: "2x1 en cortes este finde", endsAt: "2099-12-31" }),
    );
    await repo.set(
      SETTING_KEYS.location,
      JSON.stringify({ address: "Av. Reforma 100", serviceModes: ["domicilio"], areas: ["Roma"] }),
    );
    await repo.set(
      SETTING_KEYS.paymentMethods,
      JSON.stringify({ methods: ["Efectivo", "Tarjeta", "Transferencia"] }),
    );
    await repo.set(
      SETTING_KEYS.catalog,
      JSON.stringify([{ name: "Corte de cabello", price: "$200" }]),
    );
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.businessContext).toContain("2x1 en cortes este finde");
    expect(cfg.businessContext).toContain("Av. Reforma 100");
    expect(cfg.businessContext).toContain("Efectivo, Tarjeta, Transferencia");
    expect(cfg.businessContext).toContain("Corte de cabello: $200");
    // Y llega al prompt renderizado (mismo businessContext).
    expect(cfg.systemPrompt).toContain("2x1 en cortes este finde");
    expect(cfg.systemPrompt).toContain("Corte de cabello: $200");
  });

  it("GARANTÍA: promo inactiva / campos vacíos = cero cambio para bots existentes", async () => {
    const before = (await resolveAgentConfig(env, TOOLS)).systemPrompt;
    await repo.set(SETTING_KEYS.promo, JSON.stringify({ active: false, text: "no mostrar" }));
    await repo.set(SETTING_KEYS.location, JSON.stringify({ serviceModes: [], areas: [] }));
    await repo.set(SETTING_KEYS.paymentMethods, JSON.stringify({ methods: [] }));
    await repo.set(SETTING_KEYS.catalog, JSON.stringify([]));
    const after = (await resolveAgentConfig(env, TOOLS)).systemPrompt;
    expect(after).toBe(before);
    expect(after).not.toContain("no mostrar");
  });

  it("GARANTÍA: custom_instructions vacío no cambia el prompt generado (cero cambio para bots existentes)", async () => {
    const before = (await resolveAgentConfig(env, TOOLS)).systemPrompt;
    await repo.set(SETTING_KEYS.customInstructions, ""); // vacío = ausente
    const after = (await resolveAgentConfig(env, TOOLS)).systemPrompt;
    expect(after).toBe(before);
  });

  it("uses business_context override when present", async () => {
    await repo.set(SETTING_KEYS.businessContext, "MI CONTEXTO DE NEGOCIO");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("MI CONTEXTO DE NEGOCIO");
  });

  it("buffer_seconds overrides env and enforces a 1000ms floor", async () => {
    await repo.set(SETTING_KEYS.bufferSeconds, "5");
    let cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.bufferMs).toBe(5000);

    await repo.set(SETTING_KEYS.bufferSeconds, "0");
    cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.bufferMs).toBe(1000);
  });

  it("clamps max_chunks to 1..5", async () => {
    await repo.set(SETTING_KEYS.maxChunks, "99");
    expect((await resolveAgentConfig(env, TOOLS)).maxChunks).toBe(5);
    await repo.set(SETTING_KEYS.maxChunks, "0");
    expect((await resolveAgentConfig(env, TOOLS)).maxChunks).toBe(1);
    await repo.set(SETTING_KEYS.maxChunks, "2");
    expect((await resolveAgentConfig(env, TOOLS)).maxChunks).toBe(2);
  });

  it("clamps inter_chunk_delay_ms to 0..5000", async () => {
    await repo.set(SETTING_KEYS.interChunkDelayMs, "999999");
    expect((await resolveAgentConfig(env, TOOLS)).interChunkDelayMs).toBe(5000);
    await repo.set(SETTING_KEYS.interChunkDelayMs, "-50");
    expect((await resolveAgentConfig(env, TOOLS)).interChunkDelayMs).toBe(0);
  });

  it("parses model_override and falls back to auto for garbage", async () => {
    await repo.set(SETTING_KEYS.modelOverride, "haiku");
    expect((await resolveAgentConfig(env, TOOLS)).modelOverride).toBe("haiku");
    await repo.set(SETTING_KEYS.modelOverride, "sonnet");
    expect((await resolveAgentConfig(env, TOOLS)).modelOverride).toBe("sonnet");
    await repo.set(SETTING_KEYS.modelOverride, "nonsense");
    expect((await resolveAgentConfig(env, TOOLS)).modelOverride).toBe("auto");
  });

  it("reads bot_paused as a boolean (1 => true, anything else => false)", async () => {
    await repo.set(SETTING_KEYS.botPaused, "1");
    expect((await resolveAgentConfig(env, TOOLS)).botPaused).toBe(true);
    await repo.set(SETTING_KEYS.botPaused, "0");
    expect((await resolveAgentConfig(env, TOOLS)).botPaused).toBe(false);
  });
});

describe("resolveAgentConfig — disabled_tools", () => {
  it("filters enabledToolNames and the prompt's tool list", async () => {
    await repo.set(SETTING_KEYS.disabledTools, "handoffHuman");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(["searchKb"]);
    expect(cfg.systemPrompt).toContain("- searchKb");
    expect(cfg.systemPrompt).not.toContain("- handoffHuman");
  });

  it("keeps everything enabled when the setting is absent or empty", async () => {
    let cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(TOOLS);

    await repo.set(SETTING_KEYS.disabledTools, "  ");
    cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(TOOLS);
  });

  it("ignores unknown names in the setting", async () => {
    await repo.set(SETTING_KEYS.disabledTools, "noExiste, searchKb");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(["handoffHuman"]);
  });
});

describe("resolveAgentConfig — per-channel disabled_tools (union with global)", () => {
  it("a tool disabled only for a channel stays enabled on other channels", async () => {
    await repo.set(`${SETTING_KEYS.disabledTools}:instagram`, "handoffHuman");
    const twilioCfg = await resolveAgentConfig(env, TOOLS, "twilio");
    expect(twilioCfg.enabledToolNames).toEqual(TOOLS);
    const igCfg = await resolveAgentConfig(env, TOOLS, "instagram");
    expect(igCfg.enabledToolNames).toEqual(["searchKb"]);
  });

  it("without a channel argument, only the global setting applies", async () => {
    await repo.set(`${SETTING_KEYS.disabledTools}:instagram`, "handoffHuman");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.enabledToolNames).toEqual(TOOLS);
  });

  it("a tool disabled globally stays off even on a channel that doesn't disable it", async () => {
    await repo.set(SETTING_KEYS.disabledTools, "handoffHuman");
    const cfg = await resolveAgentConfig(env, TOOLS, "twilio");
    expect(cfg.enabledToolNames).toEqual(["searchKb"]);
  });

  it("dedupes when a tool is disabled both globally and per-channel", async () => {
    await repo.set(SETTING_KEYS.disabledTools, "handoffHuman");
    await repo.set(`${SETTING_KEYS.disabledTools}:twilio`, "handoffHuman, searchKb");
    const cfg = await resolveAgentConfig(env, TOOLS, "twilio");
    expect(cfg.enabledToolNames).toEqual([]);
  });
});

describe("resolveAgentConfig — per-channel system_prompt_override", () => {
  it("falls back to the global override when the channel has none", async () => {
    await repo.set(SETTING_KEYS.systemPromptOverride, "PROMPT GLOBAL");
    const cfg = await resolveAgentConfig(env, TOOLS, "instagram");
    expect(cfg.systemPrompt).toBe("PROMPT GLOBAL");
  });

  it("a channel override wins over the global override", async () => {
    await repo.set(SETTING_KEYS.systemPromptOverride, "PROMPT GLOBAL");
    await repo.set(`${SETTING_KEYS.systemPromptOverride}:twilio`, "PROMPT SOLO WHATSAPP");
    const twilioCfg = await resolveAgentConfig(env, TOOLS, "twilio");
    expect(twilioCfg.systemPrompt).toBe("PROMPT SOLO WHATSAPP");
    const igCfg = await resolveAgentConfig(env, TOOLS, "instagram");
    expect(igCfg.systemPrompt).toBe("PROMPT GLOBAL");
    // Global itself is untouched by the channel override existing.
    expect(await repo.get(SETTING_KEYS.systemPromptOverride)).toBe("PROMPT GLOBAL");
  });

  it("an empty channel override is treated as absent (inherits)", async () => {
    await repo.set(SETTING_KEYS.systemPromptOverride, "PROMPT GLOBAL");
    await repo.set(`${SETTING_KEYS.systemPromptOverride}:twilio`, "");
    const cfg = await resolveAgentConfig(env, TOOLS, "twilio");
    expect(cfg.systemPrompt).toBe("PROMPT GLOBAL");
  });
});

describe("resolveAgentConfig — temperature", () => {
  it("is undefined when unset (provider default)", async () => {
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.temperature).toBeUndefined();
  });

  it("parses and clamps the stored value to [0, 1]", async () => {
    await repo.set(SETTING_KEYS.temperature, "0.3");
    expect((await resolveAgentConfig(env, TOOLS)).temperature).toBe(0.3);

    await repo.set(SETTING_KEYS.temperature, "7");
    expect((await resolveAgentConfig(env, TOOLS)).temperature).toBe(1);
  });

  it("ignores garbage values", async () => {
    await repo.set(SETTING_KEYS.temperature, "caliente");
    expect((await resolveAgentConfig(env, TOOLS)).temperature).toBeUndefined();
  });
});

describe("resolveAgentConfig — learned lessons (flywheel)", () => {
  it("injects lessons into the generated prompt", async () => {
    await repo.set(SETTING_KEYS.learnedLessons, JSON.stringify(["Confirma el pago antes de prometer acceso."]));
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).toContain("<lecciones_aprendidas>");
    expect(cfg.systemPrompt).toContain("Confirma el pago antes de prometer acceso.");
  });

  it("omits the block without lessons and tolerates malformed JSON", async () => {
    let cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<lecciones_aprendidas>");

    await repo.set(SETTING_KEYS.learnedLessons, "{no es json");
    cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.systemPrompt).not.toContain("<lecciones_aprendidas>");
  });
});

describe("boost mode", () => {
  it("con boost_mode=on, la persona :boost manda sobre canal y global", async () => {
    await repo.set("boost_mode", "on");
    await repo.set("system_prompt_override:boost", "PERSONA BOOST");
    await repo.set("system_prompt_override:twilio", "PERSONA WHATSAPP");
    await repo.set(SETTING_KEYS.systemPromptOverride, "PERSONA GLOBAL");
    const cfg = await resolveAgentConfig(env, TOOLS, "twilio");
    expect(cfg.systemPrompt).toContain("PERSONA BOOST");
  });
  it("con boost_mode=off, cada canal usa su override normal", async () => {
    await repo.set("boost_mode", "off");
    await repo.set("system_prompt_override:boost", "PERSONA BOOST");
    await repo.set("system_prompt_override:twilio", "PERSONA WHATSAPP");
    const cfg = await resolveAgentConfig(env, TOOLS, "twilio");
    expect(cfg.systemPrompt).toContain("PERSONA WHATSAPP");
    expect(cfg.systemPrompt).not.toContain("PERSONA BOOST");
  });
});

// Pausa temporal (bot_paused_until, epoch ms) — Modo Agencia, panel de la nube.
describe("bot_paused_until (pausa temporal)", () => {
  it("con fecha futura el bot queda pausado aunque bot_paused sea 0", async () => {
    await repo.set(SETTING_KEYS.botPaused, "0");
    await repo.set(SETTING_KEYS.botPausedUntil, String(Date.now() + 60 * 60 * 1000));
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.botPaused).toBe(true);
  });

  it("con fecha pasada NO pausa (expiró sola, sin cron)", async () => {
    await repo.set(SETTING_KEYS.botPaused, "0");
    await repo.set(SETTING_KEYS.botPausedUntil, String(Date.now() - 1000));
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.botPaused).toBe(false);
  });

  it("bot_paused=1 manda aunque no haya pausa temporal", async () => {
    await repo.set(SETTING_KEYS.botPaused, "1");
    await repo.set(SETTING_KEYS.botPausedUntil, "");
    const cfg = await resolveAgentConfig(env, TOOLS);
    expect(cfg.botPaused).toBe(true);
  });
});
