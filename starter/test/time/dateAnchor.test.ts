import { describe, it, expect } from "vitest";
import { dateAnchorBlock, botTimezone } from "../../src/time/dateAnchor";
import type { Env } from "../../src/env";

const env = (over: Partial<Env> = {}): Env => ({ BOT_LANGUAGE: "es-MX", ...over }) as Env;

describe("dateAnchorBlock", () => {
  it("ancla el año y el día correctos (el bug: mandaba 2025 en vez de 2026)", () => {
    const now = new Date("2026-08-06T15:00:00Z"); // mediodía en CDMX
    const block = dateAnchorBlock(env(), now);
    expect(block).toContain("2026-08-06");
    expect(block).not.toContain("2025");
    expect(block).toContain("AAAA-MM-DD");
    expect(block).toMatch(/nunca agendes ni consultes una fecha en el pasado/i);
  });

  it("respeta la zona horaria en el cruce de medianoche", () => {
    // 04:00 UTC = 22:00 del día 6 en CDMX (UTC-6), pero ya día 7 en Madrid (UTC+2)
    const now = new Date("2026-08-07T04:00:00Z");
    expect(dateAnchorBlock(env({ BOT_TIMEZONE: "America/Mexico_City" }), now)).toContain("2026-08-06");
    expect(dateAnchorBlock(env({ BOT_TIMEZONE: "Europe/Madrid" }), now)).toContain("2026-08-07");
  });

  it("cae limpio al ISO si el locale es inválido", () => {
    const now = new Date("2026-08-06T15:00:00Z");
    expect(dateAnchorBlock(env({ BOT_LANGUAGE: "catalán" }), now)).toContain("2026-08-06");
  });
});

describe("botTimezone", () => {
  it("prioriza BOT_TIMEZONE > CALCOM_TIMEZONE > default CDMX", () => {
    expect(botTimezone(env())).toBe("America/Mexico_City");
    expect(botTimezone(env({ CALCOM_TIMEZONE: "America/Bogota" }))).toBe("America/Bogota");
    expect(
      botTimezone(env({ BOT_TIMEZONE: "Europe/Madrid", CALCOM_TIMEZONE: "America/Bogota" })),
    ).toBe("Europe/Madrid");
  });
});
