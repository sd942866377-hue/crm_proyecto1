/**
 * Tests de la tool genérica `composio`: envuelve executeComposioTool y traduce
 * su resultado a { data } / { error } para el LLM.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { composioTool } from "../../src/tools/composio";
import { __resetComposioCacheForTests } from "../../src/integrations/composio";
import type { Env } from "../../src/env";

beforeEach(() => __resetComposioCacheForTests());
afterEach(() => vi.restoreAllMocks());

function buildTool(env: Partial<Env>) {
  return composioTool(env as Env) as any;
}

it("error si Composio no está configurado", async () => {
  const tool = buildTool({});
  const out = await tool.execute({ tool_slug: "GMAIL_SEND_EMAIL", arguments: {} });
  expect(out).toEqual({ error: "composio_not_configured" });
});

it("happy path: ejecuta y devuelve { data }", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/connected_accounts")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (String(url).includes("/tools/execute/")) {
        return new Response(JSON.stringify({ data: { sent: true } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  const tool = buildTool({ COMPOSIO_API_KEY: "ck_test" });
  const out = await tool.execute({ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to: "a@b.com" } });
  expect(out).toEqual({ data: { sent: true } });
});
