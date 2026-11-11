import { describe, it, expect } from "vitest";
import { mergeMemberTools, loadMemberTools } from "../../src/tools/member";
import type { Env } from "../../src/env";

describe("mergeMemberTools", () => {
  it("agrega las tools del miembro que NO existen en el core", () => {
    const base = { searchKb: "core-search" };
    const out = mergeMemberTools(base, { estatusPedido: "member-x" });
    expect(out.searchKb).toBe("core-search");
    expect(out.estatusPedido).toBe("member-x");
  });

  it("el core GANA ante choque de nombre (el miembro no pisa una tool base)", () => {
    const base = { searchKb: "core-search" };
    mergeMemberTools(base, { searchKb: "member-hijack", nueva: "ok" });
    expect(base.searchKb).toBe("core-search"); // intacta
    expect((base as Record<string, unknown>).nueva).toBe("ok");
  });

  it("no falla con un objeto vacío del miembro", () => {
    const base = { a: 1 };
    expect(mergeMemberTools(base, {})).toEqual({ a: 1 });
  });
});

describe("loadMemberTools", () => {
  const ctx = { env: {} as Env, getConversationId: () => null };

  it("devuelve un objeto (default vacío = ninguna tool custom)", () => {
    const t = loadMemberTools(ctx);
    expect(typeof t).toBe("object");
    expect(t).not.toBeNull();
  });

  it("NO se cae aunque el ctx sea mínimo (fail-soft)", () => {
    expect(() => loadMemberTools(ctx)).not.toThrow();
  });
});
