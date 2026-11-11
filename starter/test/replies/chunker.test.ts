import { describe, it, expect } from "vitest";
import { chunkReply, dedupeRepeatedSentences } from "../../src/replies/chunker";

describe("chunkReply", () => {
  it("returns single chunk for short text", () => {
    expect(chunkReply("Hola María, qué tal")).toEqual(["Hola María, qué tal"]);
  });

  it("splits by paragraph breaks first", () => {
    const text = "Hola María.\n\n¿Te agendo hoy?\n\nTengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("Hola María.");
    expect(chunks[1]).toBe("¿Te agendo hoy?");
    expect(chunks[2]).toBe("Tengo 5pm o 7pm.");
  });

  it("falls back to sentence split when no paragraphs", () => {
    const text = "Hola María. ¿Te agendo hoy? Tengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it("caps at 3 chunks even for long content", () => {
    const text = Array.from({ length: 20 }, (_, i) => `Oración ${i}.`).join(" ");
    const chunks = chunkReply(text);
    expect(chunks.length).toBeLessThanOrEqual(3);
  });

  it("preserves total content (no characters lost)", () => {
    const text = "Hola María.\n\n¿Te agendo hoy?\n\nTengo 5pm o 7pm.";
    const chunks = chunkReply(text);
    const joined = chunks.join(" ").replace(/\s+/g, " ");
    const original = text.replace(/\s+/g, " ");
    expect(joined).toBe(original);
  });
});

import { fixStuckSentences } from "../../src/replies/chunker";

describe("fixStuckSentences (anti-linkificación)", () => {
  it("separa 'Cobra.Es' (el bug real de Instagram → preview de cobra.es)", () => {
    expect(fixStuckSentences("Audita, Automatiza, Cobra.Es el domingo 26.")).toBe(
      "Audita, Automatiza, Cobra. Es el domingo 26.",
    );
  });
  it("no toca URLs legítimos (minúsculas)", () => {
    const s = "Regístrate en masterclass.horizontesia.com y forjabots.com/docs hoy.";
    expect(fixStuckSentences(s)).toBe(s);
  });
  it("repara también tras número pegado a mayúscula", () => {
    expect(fixStuckSentences("Dura 90 minutos.Faltan 9 días.")).toBe(
      "Dura 90 minutos. Faltan 9 días.",
    );
  });
  it("chunkReply sanea de una vez", () => {
    expect(chunkReply("Hola.Empezamos ya.", 1)[0]).toBe("Hola. Empezamos ya.");
  });
});

describe("dedupeRepeatedSentences", () => {
  it("colapsa oraciones duplicadas consecutivas", () => {
    expect(dedupeRepeatedSentences("¿En qué te dedicas? Cuéntame de tu negocio.¿En qué te dedicas? Cuéntame de tu negocio."))
      .toBe("¿En qué te dedicas? Cuéntame de tu negocio.");
  });
  it("no toca frases distintas ni repeticiones cortas", () => {
    expect(dedupeRepeatedSentences("Sí. Sí. ¿Cuál es tu nombre?")).toBe("Sí. Sí. ¿Cuál es tu nombre?");
  });
  it("NO rompe URLs en los puntos (bug del link de registro partido)", () => {
    const url = "https://horizontes-bot-demo.innovandohorizontes.workers.dev/l/ygyprb4";
    const out = dedupeRepeatedSentences(`Aquí está tu link: ${url} Toma menos de 30 segundos.`);
    expect(out).toContain(url); // intacta, sin espacios metidos en el dominio
    expect(out).toContain("30 segundos"); // el token [[URL#]] no choca con dígitos del texto
  });
  it("PRESERVA los saltos de línea cuando no hay repetición (comandas/confirmaciones)", () => {
    // Reportado por Adrián: el join/collapse aplastaba TODO mensaje multilínea.
    const comanda = "Tu pedido:\n🍔 1x La Classic — $99\n🌭 2x Hot Dog — $220\nSubtotal: $319";
    expect(dedupeRepeatedSentences(comanda)).toBe(comanda);
    const domicilio = "Para tu envío necesito:\n1. Colonia\n2. Calle\n3. Teléfono";
    expect(dedupeRepeatedSentences(domicilio)).toBe(domicilio);
  });
});

describe("chunkReply — URLs", () => {
  it("mantiene la URL entera en un solo chunk, sin partirla", () => {
    const url = "https://horizontes-bot-demo.innovandohorizontes.workers.dev/l/ygyprb4";
    const chunks = chunkReply(
      `¡Órale! Aquí tienes tu link directo: ${url} Toma menos de 30 segundos y ya quedas registrado.`,
      3,
    );
    expect(chunks.some((c) => c.includes(url))).toBe(true);
    expect(chunks.join(" ")).toContain(url);
  });
});
