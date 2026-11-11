import { describe, it, expect, vi } from "vitest";
import { agentStub } from "../src/agent-stub";
import type { Env } from "../src/env";

// Env falso que captura el nombre derivado y las opciones del .get().
function fakeEnv(over: Partial<Env> = {}) {
  const calls: { name?: string; options?: unknown } = {};
  const env = {
    AGENT: {
      idFromName: (name: string) => {
        calls.name = name;
        return { name } as unknown as DurableObjectId;
      },
      get: (_id: DurableObjectId, options?: unknown) => {
        calls.options = options;
        return { stub: true } as never;
      },
    },
    ...over,
  } as unknown as Env;
  return { env, calls };
}

describe("agentStub", () => {
  it("sin AGENT_LOCATION_HINT: nombre y opciones IDÉNTICOS a siempre", () => {
    const { env, calls } = fakeEnv();
    agentStub(env, "ycloud", "5215512345678");
    expect(calls.name).toBe("ycloud:5215512345678");
    expect(calls.options).toBeUndefined();
  });

  it("con hint válido: sala el nombre y pasa locationHint", () => {
    const { env, calls } = fakeEnv({ AGENT_LOCATION_HINT: "enam" } as Partial<Env>);
    agentStub(env, "ycloud", "5215512345678");
    expect(calls.name).toBe("enam:ycloud:5215512345678");
    expect(calls.options).toEqual({ locationHint: "enam" });
  });

  it("normaliza mayúsculas/espacios", () => {
    const { env, calls } = fakeEnv({ AGENT_LOCATION_HINT: "  WNAM " } as Partial<Env>);
    agentStub(env, "telegram", "u1");
    expect(calls.name).toBe("wnam:telegram:u1");
    expect(calls.options).toEqual({ locationHint: "wnam" });
  });

  it("hint inválido: se ignora con warn — comportamiento de siempre", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { env, calls } = fakeEnv({ AGENT_LOCATION_HINT: "marte" } as Partial<Env>);
    agentStub(env, "twilio", "u2");
    expect(calls.name).toBe("twilio:u2");
    expect(calls.options).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("var vacía: comportamiento de siempre", () => {
    const { env, calls } = fakeEnv({ AGENT_LOCATION_HINT: "" } as Partial<Env>);
    agentStub(env, "whatsapp", "u3");
    expect(calls.name).toBe("whatsapp:u3");
    expect(calls.options).toBeUndefined();
  });
});
