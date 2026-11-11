import { describe, it, expect } from "vitest";
import { reelShortcode } from "../../src/funnels/reel";
import { funnelId } from "../../src/funnels/store";

describe("reelShortcode", () => {
  it("extrae el shortcode ignorando query/slash/host", () => {
    expect(reelShortcode("https://www.instagram.com/reel/DaWEY5jElmw/")).toBe("DaWEY5jElmw");
    expect(reelShortcode("https://www.instagram.com/reel/DaWEY5jElmw/?igsh=abc")).toBe("DaWEY5jElmw");
    expect(reelShortcode("https://instagram.com/reel/DaWEY5jElmw")).toBe("DaWEY5jElmw");
  });

  it("iguala la URL del usuario (sin www, /p, con query) con el permalink", () => {
    const userUrl = "https://instagram.com/p/DaWEY5jElmw/?utm=x"; // sin www, /p, con query
    const permalink = "https://www.instagram.com/reel/DaWEY5jElmw/"; // como lo da /me/media
    expect(reelShortcode(userUrl)).toBe(reelShortcode(permalink));
  });

  it("URL sin shortcode → cadena vacía", () => {
    expect(reelShortcode("https://instagram.com/automatizaloia")).toBe("");
  });
});

describe("funnelId", () => {
  it("id estable y legible por mediaId+keyword", () => {
    expect(funnelId("178414", "MASTERCLASS")).toBe("178414:masterclass");
    expect(funnelId(undefined, "Quiero El Curso!")).toBe("global:quiero-el-curso");
  });

  it("mismo input → mismo id (idempotente)", () => {
    expect(funnelId("1", "QUIERO")).toBe(funnelId("1", "QUIERO"));
  });
});
