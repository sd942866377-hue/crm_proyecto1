/**
 * Tests de dispatchMobilePush (src/mobile-push.ts): auth con el token del bot,
 * truncado a los límites del contrato, y best-effort de verdad (nunca lanza).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dispatchMobilePush } from "../src/mobile-push";
import type { Env } from "../src/env";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const env = (extra: Record<string, string> = {}): Env =>
  ({ CONTROL_PLANE_TOKEN: "fcp-token", ...extra }) as unknown as Env;

describe("dispatchMobilePush", () => {
  it("no-op sin CONTROL_PLANE_TOKEN (bot sin pairing)", async () => {
    await dispatchMobilePush({} as unknown as Env, { type: "handoff", title: "t", body: "b" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pega al dispatch del control plane con el Bearer del bot y solo metadata", async () => {
    await dispatchMobilePush(env(), {
      type: "handoff",
      title: "Handoff — María G.",
      body: "Quiere hablar con una persona",
      conversationId: "whatsapp:521",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.forjabots.com/api/internal/push/dispatch");
    expect(init.headers.Authorization).toBe("Bearer fcp-token");
    expect(JSON.parse(init.body)).toEqual({
      type: "handoff",
      title: "Handoff — María G.",
      body: "Quiere hablar con una persona",
      conversation_id: "whatsapp:521",
    });
  });

  it("respeta CONTROL_PLANE_URL y trunca título/cuerpo a 120/240", async () => {
    await dispatchMobilePush(env({ CONTROL_PLANE_URL: "https://staging.forjabots.com/" }), {
      type: "message",
      title: "x".repeat(500),
      body: "y".repeat(500),
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://staging.forjabots.com/api/internal/push/dispatch");
    const body = JSON.parse(init.body);
    expect(body.title).toHaveLength(120);
    expect(body.body).toHaveLength(240);
  });

  it("nunca lanza aunque la red falle", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(
      dispatchMobilePush(env(), { type: "watchdog", title: "t", body: "b" }),
    ).resolves.toBeUndefined();
  });
});
