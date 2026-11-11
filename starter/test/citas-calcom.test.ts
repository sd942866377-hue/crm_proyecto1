import { describe, it, expect, vi, afterEach } from "vitest";
import { aHora24, buscarSlot, cancelarCitaTool } from "../src/tools/servicios";
import { cancelBooking } from "../src/integrations/calcom";
import { shouldVerify } from "../src/blindaje/verify";
import type { Env } from "../src/env";

// Paquete de citas (reportes de Eduardo Cume, 24-ago-2026): el startTime que el
// modelo no arrastra, la cancelación que no existía, y el vocabulario del
// verificador que no vigilaba "cancelar".

afterEach(() => vi.unstubAllGlobals());

describe("aHora24 — ida y vuelta de las horas que dice un cliente", () => {
  it("convierte las 48 medias horas del día desde formato 12h", () => {
    for (let h24 = 0; h24 < 24; h24++) {
      for (const min of ["00", "30"]) {
        const suf = h24 < 12 ? "am" : "pm";
        let h12 = h24 % 12;
        if (h12 === 0) h12 = 12;
        const esperado = `${String(h24).padStart(2, "0")}:${min}`;
        expect(aHora24(`${h12}:${min}${suf}`)).toBe(esperado);
        expect(aHora24(esperado)).toBe(esperado); // 24h pasa intacto
      }
    }
  });

  it("las 12 son donde estas conversiones siempre se equivocan", () => {
    expect(aHora24("12am")).toBe("00:00"); // medianoche
    expect(aHora24("12pm")).toBe("12:00"); // mediodía
    expect(aHora24("12:30am")).toBe("00:30");
    expect(aHora24("12:30 p.m.")).toBe("12:30");
  });

  it("variantes con espacios y puntos", () => {
    expect(aHora24("2:30 pm")).toBe("14:30");
    expect(aHora24("5 pm")).toBe("17:00");
    expect(aHora24(" 9 a.m. ")).toBe("09:00");
  });

  it("lo que no entiende devuelve null — jamás aproximar", () => {
    expect(aHora24("por la tarde")).toBe(null);
    expect(aHora24("25:00")).toBe(null);
    expect(aHora24("2:75pm")).toBe(null);
    expect(aHora24("")).toBe(null);
  });
});

const envCal = {
  CALCOM_API_KEY: "cal_x",
  CALCOM_EVENT_TYPE_ID: "77",
} as unknown as Env;

function stubFetchSlots(slots: string[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { dia: slots.map((s) => ({ start: s })) } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("buscarSlot — el código casa la hora, no el modelo", () => {
  it("encuentra el startTime exacto para la hora dicha en 12h", async () => {
    stubFetchSlots(["2026-09-01T13:30:00-06:00", "2026-09-01T14:30:00-06:00"]);
    const slot = await buscarSlot(envCal, "limpieza", "2026-09-01", "2:30pm");
    expect(slot).toBe("2026-09-01T14:30:00-06:00");
  });

  it("si la hora no casa EXACTO con ningún hueco → undefined (sin aproximar)", async () => {
    stubFetchSlots(["2026-09-01T14:00:00-06:00"]);
    const slot = await buscarSlot(envCal, "limpieza", "2026-09-01", "2:30pm");
    expect(slot).toBeUndefined();
  });

  it("hora incomprensible → undefined sin llamar a la API", async () => {
    const fetchMock = stubFetchSlots([]);
    const slot = await buscarSlot(envCal, "limpieza", "2026-09-01", "en la tarde");
    expect(slot).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cancelBooking — payload contra Cal.com v2", () => {
  it("POST /v2/bookings/{uid}/cancel con la versión y el motivo", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await cancelBooking(envCal, "uid_abc123", "cambio de planes");
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toBe("https://api.cal.com/v2/bookings/uid_abc123/cancel");
    expect(init.method).toBe("POST");
    expect(init.headers["cal-api-version"]).toBe("2026-02-25");
    expect(JSON.parse(init.body)).toEqual({ cancellationReason: "cambio de planes" });
  });

  it("error HTTP → ok:false con el status (y no lanza)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "{}" })));
    const r = await cancelBooking(envCal, "uid_x");
    expect(r).toEqual({ ok: false, reason: "http_401" });
  });
});

// D1 falso: suficiente para leads de cancelarCita.
function fakeDb(rows: { id: string; intent: string; metadata: string | null }[]) {
  const runs: { sql: string; params: unknown[] }[] = [];
  const d1 = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        all: async () => ({ results: rows }),
        run: async () => (runs.push({ sql, params }), {}),
        first: async () => rows[0] ?? null,
      }),
    }),
  };
  return { d1, runs };
}

describe("cancelarCita — los cuatro casos que no debe resolver adivinando", () => {
  const ejecutar = async (env: Env, rows: any[], input: any = {}) => {
    const t = cancelarCitaTool(env, () => "conv1") as any;
    return t.execute(input, {} as any);
  };

  it("sin citas → error sin_citas y orden de NO afirmar", async () => {
    const { d1 } = fakeDb([]);
    const out = await ejecutar({ ...envCal, DB: d1 } as any, []);
    expect(out.cancelada).toBe(false);
    expect(out.error).toBe("sin_citas");
  });

  it("varias citas vivas sin pista → pregunta cuál, no toca la agenda", async () => {
    const rows = [
      { id: "l1", intent: "Cita · corte · lunes 10am", metadata: JSON.stringify({ estado: "Reservada (Cal.com)", calBookingUid: "u1" }) },
      { id: "l2", intent: "Cita · barba · viernes 4pm", metadata: JSON.stringify({ estado: "Reservada (Cal.com)", calBookingUid: "u2" }) },
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { d1 } = fakeDb(rows);
    const out = await ejecutar({ ...envCal, DB: d1 } as any, rows);
    expect(out.error).toBe("varias_citas");
    expect(out.citas).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reservada sin uid (pre-migración) → dilo y escala, no finjas", async () => {
    const rows = [{ id: "l1", intent: "Cita · corte · lunes 10am", metadata: JSON.stringify({ estado: "Reservada (Cal.com)" }) }];
    const { d1 } = fakeDb(rows);
    const out = await ejecutar({ ...envCal, DB: d1 } as any, rows);
    expect(out.cancelada).toBe(false);
    expect(out.error).toBe("sin_uid");
  });

  it("la API rechaza → NO cancelada y la instrucción de no agendar otra", async () => {
    const rows = [{ id: "l1", intent: "Cita · corte · lunes 10am", metadata: JSON.stringify({ estado: "Reservada (Cal.com)", calBookingUid: "u1" }) }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "err" })));
    const { d1 } = fakeDb(rows);
    const out = await ejecutar({ ...envCal, DB: d1 } as any, rows);
    expect(out.cancelada).toBe(false);
    expect(out.error).toBe("calcom_failed");
    expect(out.message).toMatch(/NO agendes/i);
  });

  it("cancela bien → libera en la agenda y marca el lead local", async () => {
    const rows = [{ id: "l1", intent: "Cita · corte · lunes 10am", metadata: JSON.stringify({ estado: "Reservada (Cal.com)", calBookingUid: "u1" }) }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const { d1, runs } = fakeDb(rows);
    const out = await ejecutar({ ...envCal, DB: d1 } as any, rows);
    expect(out.cancelada).toBe(true);
    expect(out.enAgenda).toBe(true);
    expect(runs.some((r) => r.sql.includes("UPDATE leads") && String(r.params[0]).includes("Cancelada"))).toBe(true);
  });
});

describe("shouldVerify — el vocabulario aprende 'cancelar'", () => {
  it("una cancelación afirmada SIN dígitos ahora sí se verifica", () => {
    expect(shouldVerify("Listo, tu cita queda cancelada. ¿Algo más?", false)).toBe(true);
    expect(shouldVerify("Ya quedó reagendada tu visita.", false)).toBe(true);
  });
  it("saludos sin datos siguen sin verificarse", () => {
    expect(shouldVerify("¡Hola! ¿En qué te ayudo hoy?", false)).toBe(false);
  });
});
