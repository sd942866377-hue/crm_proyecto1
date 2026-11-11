import { describe, it, expect } from "vitest";
import { extraeBotones } from "../src/replies/sender";
import { renderSystemPrompt } from "../src/system-prompt";

// Botones tocables (opt-in): el modelo emite [[botones: A | B | C]] y sender.ts
// lo convierte en OutgoingReply.buttons o en lista numerada según el canal.

describe("extraeBotones (marcador → buttons)", () => {
  it("extrae hasta 3 botones y limpia el marcador del texto", () => {
    const r = extraeBotones(["¿Confirmamos tu cita?\n[[botones: Sí, confirmar | Cambiar hora | Cancelar]]"]);
    expect(r.chunks).toEqual(["¿Confirmamos tu cita?"]);
    expect(r.buttons?.map((b) => b.title)).toEqual(["Sí, confirmar", "Cambiar hora", "Cancelar"]);
    expect(r.buttons?.[0].payload).toBe("btn:Sí, confirmar");
  });

  it("recorta a 3 opciones y títulos a 20 caracteres (límite WhatsApp)", () => {
    const r = extraeBotones(["Elige:\n[[botones: Una opción larguísima que no cabe | b | c | d | e]]"]);
    expect(r.buttons).toHaveLength(3);
    expect(r.buttons![0].title).toHaveLength(20);
  });

  it("acepta el alias en inglés y espacios raros", () => {
    const r = extraeBotones(["Ok\n[[ buttons : Yes | No ]]"]);
    expect(r.buttons?.map((b) => b.title)).toEqual(["Yes", "No"]);
  });

  it("sin marcador no toca nada", () => {
    const r = extraeBotones(["hola", "¿en qué te ayudo?"]);
    expect(r.chunks).toEqual(["hola", "¿en qué te ayudo?"]);
    expect(r.buttons).toBeUndefined();
  });

  it("un chunk que era SOLO el marcador desaparece del texto", () => {
    const r = extraeBotones(["Te leo 👀", "[[botones: Sí | No]]"]);
    expect(r.chunks).toEqual(["Te leo 👀"]);
    expect(r.buttons).toHaveLength(2);
  });

  it("opciones vacías entre pipes se ignoran", () => {
    const r = extraeBotones(["x\n[[botones: A || B | ]]"]);
    expect(r.buttons?.map((b) => b.title)).toEqual(["A", "B"]);
  });
});

describe("bloque <botones> del prompt (opt-in)", () => {
  const base = {
    botName: "Bot",
    businessName: "Negocio",
    language: "español",
    businessContext: "ctx",
    toolList: ["searchKb"],
  };

  it("apagado (default): el prompt NO menciona el marcador — byte-idéntico a hoy", () => {
    const p = renderSystemPrompt(base);
    expect(p).not.toContain("<botones>");
    expect(p).not.toContain("[[botones:");
  });

  it("prendido: enseña el marcador y sus reglas", () => {
    const p = renderSystemPrompt({ ...base, buttonsEnabled: true });
    expect(p).toContain("<botones>");
    expect(p).toContain("[[botones: Opción uno | Opción dos | Opción tres]]");
    expect(p).toContain("Máximo 3 opciones");
  });
});
