import { describe, it, expect } from "vitest";
import {
  renderSystemPrompt,
  systemPromptFromEnv,
  type SystemPromptInput,
} from "../src/system-prompt";

const input: SystemPromptInput = {
  botName: "Asistente",
  businessName: "Barbería Centro",
  language: "es",
  businessContext: "Horarios: Lun-Sáb 10am-8pm\nUbicación: Monterrey",
  toolList: ["searchKb", "handoffHuman", "pauseBot"],
};

describe("renderSystemPrompt", () => {
  it("contains all 10 sections", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("<output_language>");
    expect(prompt).toContain("<role>");
    expect(prompt).toContain("<business_context>");
    expect(prompt).toContain("<identity_and_voice>");
    expect(prompt).toContain("<core_principles>");
    expect(prompt).toContain("<tools>");
    expect(prompt).toContain("<escalation_rules>");
    expect(prompt).toContain("<style_guide>");
    expect(prompt).toContain("<anti_patterns>");
  });

  it("replaces every placeholder (none left)", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).not.toContain("{{");
    expect(prompt).not.toContain("}}");
  });

  it("interpolates language, bot name and business name", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("es");
    expect(prompt).toContain("Asistente");
    expect(prompt).toContain("Barbería Centro");
  });

  it("renders tool list as bullet lines", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("- searchKb");
    expect(prompt).toContain("- handoffHuman");
    expect(prompt).toContain("- pauseBot");
  });

  it("injects business context", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("Horarios: Lun-Sáb 10am-8pm");
  });

  it("prohíbe negar existencia y enmarca el conocimiento como incompleto (regresión del herraje)", () => {
    const prompt = renderSystemPrompt(input);
    // El bot NO puede afirmar que el negocio no vende/ofrece algo…
    expect(prompt).toContain("NUNCA niegues que el negocio vende/ofrece/maneja algo");
    // …y su default ante duda es confirmar, no negar.
    expect(prompt).toContain("déjame confirmarlo");
    // El conocimiento se declara explícitamente incompleto (para que no razone "no está → no existe").
    expect(prompt.toLowerCase()).toContain("incompleto");
    // El anti-patrón de inventar YA no licencia negar por estar "fuera de business_context".
    expect(prompt).not.toContain("Inventar precios/horarios/servicios fuera de business_context");
  });

  it("inserts nichoPlaybook when provided and empty string when omitted", () => {
    const withPlaybook = renderSystemPrompt({
      ...input,
      nichoPlaybook: "<diagnostic_playbooks>X</diagnostic_playbooks>",
    });
    expect(withPlaybook).toContain("<diagnostic_playbooks>X</diagnostic_playbooks>");
    // omitted -> the placeholder is gone, replaced by ""
    const withoutPlaybook = renderSystemPrompt(input);
    expect(withoutPlaybook).not.toContain("{{NICHO_PLAYBOOK}}");
  });

  // Superpoder Multi-idioma: espeja el idioma del cliente cuando está activo.
  it("multi-idioma OFF (default): fuerza el idioma fijo", () => {
    const prompt = renderSystemPrompt(input);
    expect(prompt).toContain("reply in {{LANGUAGE}} anyway".replace("{{LANGUAGE}}", "es"));
    expect(prompt).not.toContain("MIRROR THE CUSTOMER'S LANGUAGE");
  });

  it("multi-idioma ON: espeja el idioma del cliente (ES/EN/PT)", () => {
    const prompt = renderSystemPrompt({ ...input, multiLanguage: true });
    expect(prompt).toContain("MIRROR THE CUSTOMER'S LANGUAGE");
    expect(prompt).toContain("Portuguese");
    expect(prompt).not.toContain("{{");
  });

  // Voz de marca (Pro): guía de estilo completa como bloque propio.
  it("inyecta <brand_voice> cuando se provee, sin él cuando se omite", () => {
    const withVoice = renderSystemPrompt({
      ...input,
      brandVoice: "Tuteas, frases cortas, cero emojis. Muletilla: 'con gusto'.",
    });
    expect(withVoice).toContain("<brand_voice>");
    expect(withVoice).toContain("con gusto");
    expect(withVoice).not.toContain("{{");

    const withoutVoice = renderSystemPrompt(input);
    expect(withoutVoice).not.toContain("<brand_voice>");
    expect(withoutVoice).not.toContain("{{BRAND_VOICE}}");
  });

  it("la voz de marca NO borra los frenos (idioma/escalación/anti-patrones siguen)", () => {
    const prompt = renderSystemPrompt({ ...input, brandVoice: "Suena divertido y suelto." });
    expect(prompt).toContain("<output_language>");
    expect(prompt).toContain("<escalation_rules>");
    expect(prompt).toContain("<anti_patterns>");
  });

  // Instrucciones custom (modo guiado, ADITIVAS): bloque propio, subordinado a los frenos.
  it("inyecta <custom_instructions> cuando se provee, sin él cuando se omite", () => {
    const withCustom = renderSystemPrompt({
      ...input,
      customInstructions: "No agendes los domingos. Ofrece siempre el envío exprés.",
    });
    expect(withCustom).toContain("<custom_instructions>");
    expect(withCustom).toContain("No agendes los domingos");
    expect(withCustom).not.toContain("{{");

    const withoutCustom = renderSystemPrompt(input);
    expect(withoutCustom).not.toContain("<custom_instructions>");
    expect(withoutCustom).not.toContain("{{CUSTOM_INSTRUCTIONS}}");
  });

  it("GARANTÍA: con custom_instructions vacío/omitido el prompt es BYTE-IDÉNTICO al de hoy", () => {
    const base = renderSystemPrompt(input);
    expect(renderSystemPrompt({ ...input, customInstructions: "" })).toBe(base);
    expect(renderSystemPrompt({ ...input, customInstructions: undefined })).toBe(base);
    expect(renderSystemPrompt({ ...input, customInstructions: "   " })).toBe(base); // trim → vacío
    // y también CON voz de marca presente: agregar custom vacío no cambia un byte
    const withVoice = renderSystemPrompt({ ...input, brandVoice: "Suena suelto." });
    expect(renderSystemPrompt({ ...input, brandVoice: "Suena suelto.", customInstructions: "" })).toBe(withVoice);
  });

  it("las instrucciones custom NO borran los frenos (idioma/escalación/anti-patrones siguen)", () => {
    const prompt = renderSystemPrompt({ ...input, customInstructions: "Prioriza el paquete premium." });
    expect(prompt).toContain("<output_language>");
    expect(prompt).toContain("<escalation_rules>");
    expect(prompt).toContain("<anti_patterns>");
    expect(prompt).toContain("<core_principles>");
  });
});

describe("systemPromptFromEnv", () => {
  it("pulls botName/businessName/language from env", () => {
    const env = {
      BOT_NAME: "Bot",
      BUSINESS_NAME: "Acme",
      BOT_LANGUAGE: "en",
    } as any;
    const prompt = systemPromptFromEnv(env, ["searchKb"], "ctx here");
    expect(prompt).toContain("Bot");
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("en");
    expect(prompt).toContain("- searchKb");
    expect(prompt).toContain("ctx here");
  });
});

describe("posición de las palabras de escalación (regresión del bug)", () => {
  it("las palabras configuradas caen en 'Llama handoffHuman cuando', NO en 'NO escales cuando'", () => {
    const prompt = renderSystemPrompt({ ...input, extraEscalationKeywords: ["reembolso", "cancelar"] });
    const line = "- El cliente escribe alguna de estas palabras: reembolso, cancelar.";
    const yes = prompt.indexOf("Llama handoffHuman cuando:");
    const no = prompt.indexOf("NO escales cuando:");
    const at = prompt.indexOf(line);
    expect(at).toBeGreaterThanOrEqual(0); // la línea se renderizó
    expect(no).toBeGreaterThan(yes); // el bloque tiene ambas secciones, en orden
    expect(at).toBeGreaterThan(yes); // después del header "SÍ escala"…
    expect(at).toBeLessThan(no); // …y ANTES de "NO escales cuando"
  });

  it("no agrega la línea de palabras cuando la lista está vacía (por eso el bug era invisible)", () => {
    expect(renderSystemPrompt(input)).not.toContain("El cliente escribe alguna de estas palabras");
  });
});
