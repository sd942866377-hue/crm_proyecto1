import { describe, it, expect, vi } from "vitest";
import { searchKbTool } from "../../src/tools/searchKb";

describe("searchKbTool", () => {
  it("returns top-k chunks with scores", async () => {
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })) },
      KB: { query: vi.fn(async () => ({ matches: [
        { id: "c1", score: 0.91, metadata: { title: "Embebar wall", content: "Pega <div data-tv-wall>...</div>" } },
        { id: "c2", score: 0.78, metadata: { title: "Generar carrusel", content: "Ir a Distribuir..." } },
      ] })) },
    } as any;
    const tool = searchKbTool(fakeEnv);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "como embebo wall" });
    expect(result.results).toHaveLength(2);
    expect(result.results[0].title).toBe("Embebar wall");
    expect(result.results[0].score).toBe(0.91);
  });

  it("requests returnMetadata — without it Vectorize returns a real score but empty title/content", async () => {
    const query = vi.fn(async () => ({ matches: [] }));
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })) },
      KB: { query },
    } as any;
    const tool = searchKbTool(fakeEnv);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    await execute({ query: "como embebo wall" });
    expect(query).toHaveBeenCalledWith([0.1, 0.2, 0.3], { topK: 5, returnMetadata: "all" });
  });

  it("returns empty results when KB throws", async () => {
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2]] })) },
      KB: { query: vi.fn(async () => { throw new Error("boom"); }) },
    } as any;
    const tool = searchKbTool(fakeEnv);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "x" });
    expect(result.error).toBe("transient");
  });

  it("stashea los resultados en el callback onResults (blindaje)", async () => {
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2]] })) },
      KB: { query: vi.fn(async () => ({ matches: [
        { id: "c1", score: 0.88, metadata: { title: "Precios", content: "Corte: $150" } },
      ] })) },
    } as any;
    const onResults = vi.fn();
    const tool = searchKbTool(fakeEnv, onResults);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    await execute({ query: "precio corte" });
    expect(onResults).toHaveBeenCalledTimes(1);
    expect(onResults.mock.calls[0][0]).toEqual([
      { title: "Precios", content: "Corte: $150", score: 0.88 },
    ]);
  });

  it("un callback roto NO tumba la búsqueda; en error transitorio no se llama", async () => {
    const okEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1]] })) },
      KB: { query: vi.fn(async () => ({ matches: [
        { id: "c1", score: 0.7, metadata: { title: "t", content: "c" } },
      ] })) },
    } as any;
    const broken = vi.fn(() => { throw new Error("callback roto"); });
    const tool = searchKbTool(okEnv, broken);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "x" });
    expect(result.results).toHaveLength(1); // la búsqueda sobrevivió

    const errEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1]] })) },
      KB: { query: vi.fn(async () => { throw new Error("boom"); }) },
    } as any;
    const onResults = vi.fn();
    const errTool = searchKbTool(errEnv, onResults);
    const errExecute = errTool.execute as (input: { query: string }) => Promise<any>;
    await errExecute({ query: "x" });
    expect(onResults).not.toHaveBeenCalled();
  });

  it("F2: descarta los matches por debajo del piso de score (ruido)", async () => {
    const fakeEnv = {
      AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2]] })) },
      KB: { query: vi.fn(async () => ({ matches: [
        { id: "c1", score: 0.82, metadata: { title: "Relevante", content: "sí" } },
        { id: "c2", score: 0.20, metadata: { title: "Ruido", content: "no relacionado" } },
      ] })) },
    } as any;
    const onResults = vi.fn();
    const tool = searchKbTool(fakeEnv, onResults);
    const execute = tool.execute as (input: { query: string }) => Promise<any>;
    const result = await execute({ query: "algo" });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].title).toBe("Relevante");
    // el callback (blindaje / selector de modelo) también ve solo lo relevante.
    expect(onResults.mock.calls[0][0]).toHaveLength(1);
  });
});
