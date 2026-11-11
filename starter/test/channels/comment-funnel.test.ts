import { describe, it, expect } from "vitest";
import {
  parseMetaComments,
  parseMetaPostbacks,
  matchFunnel,
  funnelByPayload,
  payloadForId,
} from "../../src/channels/comment-funnel";
import type { FunnelRule } from "../../src/funnels/store";

const FUNNELS: FunnelRule[] = [
  { id: "m1:masterclass", keyword: "MASTERCLASS", dm: "d", buttonLabel: "Obtener", resource: "r" },
  { id: "media_1:curso", keyword: "curso", mediaId: "media_1", dm: "d2", buttonLabel: "b2", resource: "r2" },
  { id: "global:kw", keyword: "", dm: "catch-all", buttonLabel: "b3", resource: "r3" },
];

describe("parseMetaComments", () => {
  it("extrae comentarios de changes[] field=comments", () => {
    const body = {
      object: "instagram",
      entry: [
        {
          changes: [
            { field: "comments", value: { id: "c1", text: "quiero la MASTERCLASS", from: { id: "u1" }, media: { id: "m1" } } },
          ],
        },
      ],
    };
    const r = parseMetaComments(body);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ commentId: "c1", text: "quiero la MASTERCLASS", fromId: "u1", mediaId: "m1" });
  });

  it("ignora changes que no son comentarios", () => {
    expect(parseMetaComments({ entry: [{ changes: [{ field: "mentions", value: { id: "x" } }] }] })).toHaveLength(0);
  });

  it("ignora comentarios sin id/text/from", () => {
    expect(parseMetaComments({ entry: [{ changes: [{ field: "comments", value: { id: "c1" } }] }] })).toHaveLength(0);
  });
});

describe("parseMetaPostbacks", () => {
  it("extrae payload de postback", () => {
    const body = { entry: [{ messaging: [{ sender: { id: "u1" }, postback: { payload: "HZN_FUNNEL:m1:masterclass", title: "Obtener" } }] }] };
    expect(parseMetaPostbacks(body)).toEqual([{ senderId: "u1", payload: "HZN_FUNNEL:m1:masterclass" }]);
  });

  it("extrae payload de quick_reply", () => {
    const body = { entry: [{ messaging: [{ sender: { id: "u2" }, message: { text: "Obtener", quick_reply: { payload: "HZN_FUNNEL:global:kw" } } }] }] };
    expect(parseMetaPostbacks(body)).toEqual([{ senderId: "u2", payload: "HZN_FUNNEL:global:kw" }]);
  });

  it("ignora mensajes normales sin payload", () => {
    expect(parseMetaPostbacks({ entry: [{ messaging: [{ sender: { id: "u3" }, message: { text: "hola" } }] }] })).toHaveLength(0);
  });
});

describe("matchFunnel", () => {
  it("match por keyword (substring, case-insensitive)", () => {
    expect(matchFunnel("quiero la masterclass porfa", undefined, FUNNELS)?.funnel.id).toBe("m1:masterclass");
  });

  it("respeta mediaId cuando la regla lo especifica", () => {
    expect(matchFunnel("dame el curso", "media_1", FUNNELS)?.funnel.id).toBe("media_1:curso");
    // media distinto → la regla 1 no aplica; cae al catch-all
    expect(matchFunnel("dame el curso", "otro", FUNNELS)?.funnel.id).toBe("global:kw");
  });

  it("keyword vacío es catch-all", () => {
    expect(matchFunnel("cualquier cosa", undefined, FUNNELS)?.funnel.id).toBe("global:kw");
  });

  it("sin match devuelve undefined", () => {
    expect(matchFunnel("hola", undefined, [FUNNELS[0]])).toBeUndefined();
  });
});

describe("payload round-trip (por id estable)", () => {
  it("payloadForId ↔ funnelByPayload", () => {
    expect(funnelByPayload(payloadForId("media_1:curso"), FUNNELS)).toBe(FUNNELS[1]);
  });

  it("payload desconocido → undefined", () => {
    expect(funnelByPayload("OTRO:x", FUNNELS)).toBeUndefined();
    expect(funnelByPayload("HZN_FUNNEL:noexiste", FUNNELS)).toBeUndefined();
  });
});
