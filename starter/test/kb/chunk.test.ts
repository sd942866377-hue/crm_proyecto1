import { describe, it, expect } from "vitest";
import { chunkContent, CHUNK_CHARS, MAX_CHUNKS } from "../../src/kb/chunk";

describe("chunkContent (F1: chunker compartido member/kb/ + panel)", () => {
  it("un texto corto queda como un solo chunk", () => {
    expect(chunkContent("Hola. Un párrafo corto.")).toEqual(["Hola. Un párrafo corto."]);
  });

  it("un párrafo largo se parte en varios chunks acotados a CHUNK_CHARS", () => {
    const chunks = chunkContent("a".repeat(CHUNK_CHARS + 500));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CHUNK_CHARS)).toBe(true);
  });

  it("respeta el tope de MAX_CHUNKS aunque el doc sea enorme", () => {
    const enorme = Array.from({ length: MAX_CHUNKS + 20 }, (_, i) =>
      `Párrafo ${i} `.repeat(200),
    ).join("\n\n");
    expect(chunkContent(enorme).length).toBeLessThanOrEqual(MAX_CHUNKS);
  });

  it("agrupa por fronteras de párrafo sin perder contenido", () => {
    const joined = chunkContent("Uno.\n\nDos.\n\nTres.").join(" ");
    expect(joined).toContain("Uno.");
    expect(joined).toContain("Tres.");
  });
});
