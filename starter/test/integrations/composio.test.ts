import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  composioEnabled,
  listConnectedTools,
  executeComposioTool,
  __resetComposioCacheForTests,
} from "../../src/integrations/composio";
import type { Env } from "../../src/env";

const env = (over: Partial<Env> = {}) => ({ ...over }) as unknown as Env;

beforeEach(() => __resetComposioCacheForTests());
afterEach(() => vi.restoreAllMocks());

describe("composioEnabled", () => {
  it("false sin API key", () => {
    expect(composioEnabled(env())).toBe(false);
  });
  it("true con API key", () => {
    expect(composioEnabled(env({ COMPOSIO_API_KEY: "ck_test" }))).toBe(true);
  });
});

function stubComposioFetch() {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/connected_accounts")) {
      return new Response(
        JSON.stringify({
          items: [
            { id: "ca_gcal_1", status: "ACTIVE", toolkit: { slug: "googlecalendar" } },
            { id: "ca_slack_1", status: "ACTIVE", toolkit: { slug: "slack" } },
          ],
        }),
        { status: 200 },
      );
    }
    if (u.includes("/tools/execute/")) {
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    }
    if (u.includes("/tools?")) {
      const toolkit = new URL(u).searchParams.get("toolkit_slug");
      return new Response(
        JSON.stringify({
          items: [
            {
              slug: `${toolkit?.toUpperCase()}_DO_THING`,
              human_description: `Hace algo en ${toolkit}`,
              toolkit: { slug: toolkit },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  });
}

describe("listConnectedTools", () => {
  it("vacío sin API key (no llama a fetch)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tools = await listConnectedTools(env());
    expect(tools).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("descubre toolkits conectados y trae su catálogo curado", async () => {
    vi.stubGlobal("fetch", stubComposioFetch());
    const tools = await listConnectedTools(env({ COMPOSIO_API_KEY: "ck_test" }));
    expect(tools.map((t) => t.toolkitSlug).sort()).toEqual(["googlecalendar", "slack"]);
    expect(tools.find((t) => t.toolkitSlug === "googlecalendar")?.slug).toBe(
      "GOOGLECALENDAR_DO_THING",
    );
  });

  it("cachea: la segunda llamada no vuelve a pegarle a la API", async () => {
    const fetchMock = stubComposioFetch();
    vi.stubGlobal("fetch", fetchMock);
    const e = env({ COMPOSIO_API_KEY: "ck_test" });
    await listConnectedTools(e);
    const callsAfterFirst = fetchMock.mock.calls.length;
    await listConnectedTools(e);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("sin cuentas conectadas devuelve []", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
    );
    const tools = await listConnectedTools(env({ COMPOSIO_API_KEY: "ck_test" }));
    expect(tools).toEqual([]);
  });

  it("fail-open: si la API falla, no truena (devuelve [])", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const tools = await listConnectedTools(env({ COMPOSIO_API_KEY: "ck_test" }));
    expect(tools).toEqual([]);
  });
});

describe("executeComposioTool", () => {
  it("error si Composio no está configurado", async () => {
    const out = await executeComposioTool(env(), "GMAIL_SEND_EMAIL", {});
    expect(out).toEqual({ ok: false, error: "composio_not_configured" });
  });

  it("resuelve la connected_account_id del toolkit y ejecuta", async () => {
    const fetchMock = stubComposioFetch();
    vi.stubGlobal("fetch", fetchMock);
    const e = env({ COMPOSIO_API_KEY: "ck_test" });
    await listConnectedTools(e); // llena el cache
    const out = await executeComposioTool(e, "GOOGLECALENDAR_DO_THING", { title: "Llamada" });
    expect(out).toEqual({ ok: true, data: { ok: true } });

    const executeCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/tools/execute/"));
    expect(executeCall).toBeDefined();
    const init = executeCall?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.connected_account_id).toBe("ca_gcal_1");
    expect(body.arguments).toEqual({ title: "Llamada" });
  });

  it("propaga el mensaje de error si Composio responde con error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "invalid slug" } }), { status: 400 }),
      ),
    );
    const out = await executeComposioTool(
      env({ COMPOSIO_API_KEY: "ck_test" }),
      "NOPE_TOOL",
      {},
    );
    expect(out).toEqual({ ok: false, error: "invalid slug" });
  });
});
