import { describe, it, expect } from "vitest";
import { buildTools, type ToolContext } from "../../src/tools/index";

function makeCtx(tier: "free" | "pro", niche?: string): ToolContext {
  const env = {
    BOT_TIER: tier,
    BOT_NICHE: niche,
    DB: {} as any,
    AI: {} as any,
    BUSINESS_NAME: "Test",
    OWNER_EMAIL: "owner@test.com",
    DASHBOARD_BASE_URL: "https://example.com",
  } as any;
  return { env, getConversationId: () => "conv-1" };
}

describe("buildTools", () => {
  it("registers the 7 free-tier tools (incluye captureLead + scheduleAppointment)", () => {
    const tools = buildTools(makeCtx("free"));
    expect(Object.keys(tools).sort()).toEqual([
      "captureLead",
      "handoffHuman",
      "pauseBot",
      "pauseSuspectedBot",
      "scheduleAppointment",
      "searchKb",
      "snoozeUser",
    ]);
  });

  it("free tier captura leads y agenda citas, pero excluye las Pro-only (catálogo)", () => {
    const tools = buildTools(makeCtx("free"));
    expect(tools.captureLead).toBeDefined();
    expect(tools.scheduleAppointment).toBeDefined();
    expect(tools.catalogQuery).toBeUndefined();
  });

  it("pro tier has the 7 base tools plus catalogQuery (Pro)", () => {
    const tools = buildTools(makeCtx("pro"));
    expect(Object.keys(tools).sort()).toEqual([
      "captureLead",
      "catalogQuery",
      "handoffHuman",
      "pauseBot",
      "pauseSuspectedBot",
      "scheduleAppointment",
      "searchKb",
      "snoozeUser",
    ]);
    expect(tools.scheduleAppointment).toBeDefined();
    expect(tools.catalogQuery).toBeDefined();
  });

  it("nicho restaurante agrega crearReservacion + tomarPedido", () => {
    const tools = buildTools(makeCtx("pro", "restaurante"));
    expect(tools.crearReservacion).toBeDefined();
    expect(tools.tomarPedido).toBeDefined();
    expect(tools.calificarComprador).toBeUndefined();
  });

  it("nicho inmobiliaria agrega calificarComprador + registrarVisita", () => {
    const tools = buildTools(makeCtx("pro", "inmobiliaria"));
    expect(tools.calificarComprador).toBeDefined();
    expect(tools.registrarVisita).toBeDefined();
    expect(tools.crearReservacion).toBeUndefined();
  });

  it("los giros de cita (barberia/salon/dentista/gimnasio/coach) agregan agendarCita", () => {
    for (const id of ["barberia", "salon", "dentista", "gimnasio", "coach"]) {
      const tools = buildTools(makeCtx("pro", id));
      expect(tools.agendarCita, `${id} debería tener agendarCita`).toBeDefined();
      expect(tools.registrarPedido).toBeUndefined();
      expect(tools.crearReservacion).toBeUndefined();
      // agendarCita es el método canónico de cita → reemplaza al scheduleAppointment genérico.
      expect(tools.scheduleAppointment, `${id} no debería exponer scheduleAppointment`).toBeUndefined();
      // Sin Cal.com configurado, no se expone verDisponibilidad.
      expect(tools.verDisponibilidad).toBeUndefined();
    }
  });

  it("con Cal.com configurado, los giros de cita exponen verDisponibilidad", () => {
    const ctx = makeCtx("pro", "barberia");
    (ctx.env as any).CALCOM_API_KEY = "cal_test";
    (ctx.env as any).CALCOM_EVENT_TYPE_ID = "123";
    const tools = buildTools(ctx);
    expect(tools.agendarCita).toBeDefined();
    expect(tools.verDisponibilidad).toBeDefined();
  });

  it("los giros de comercio (tienda/panaderia) agregan registrarPedido", () => {
    for (const id of ["tienda", "panaderia"]) {
      const tools = buildTools(makeCtx("pro", id));
      expect(tools.registrarPedido, `${id} debería tener registrarPedido`).toBeDefined();
      expect(tools.agendarCita).toBeUndefined();
    }
  });

  it("los giros de cita también capturan leads en free (captureLead + agendarCita)", () => {
    const tools = buildTools(makeCtx("free", "barberia"));
    expect(tools.captureLead).toBeDefined();
    expect(tools.agendarCita).toBeDefined();
    expect(tools.scheduleAppointment).toBeUndefined(); // lo borra agendarCita (método del giro), no por tier
  });

  it("el nicho crm agrega registrarProspecto", () => {
    const tools = buildTools(makeCtx("pro", "crm"));
    expect(tools.registrarProspecto).toBeDefined();
    expect(tools.agendarCita).toBeUndefined();
    expect(tools.reservarHospedaje).toBeUndefined();
  });

  it("el nicho hoteleria agrega reservarHospedaje + cotizarEvento", () => {
    const tools = buildTools(makeCtx("pro", "hoteleria"));
    expect(tools.reservarHospedaje).toBeDefined();
    expect(tools.cotizarEvento).toBeDefined();
    expect(tools.registrarProspecto).toBeUndefined();
  });

  it("sin nicho (genérico) no agrega tools de nicho", () => {
    const tools = buildTools(makeCtx("pro"));
    expect(tools.crearReservacion).toBeUndefined();
    expect(tools.calificarComprador).toBeUndefined();
    expect(tools.agendarCita).toBeUndefined();
    expect(tools.registrarPedido).toBeUndefined();
    expect(tools.registrarProspecto).toBeUndefined();
    expect(tools.reservarHospedaje).toBeUndefined();
  });

  it("composio (Pro + COMPOSIO_API_KEY) agrega la tool genérica", () => {
    const ctx = makeCtx("pro");
    (ctx.env as any).COMPOSIO_API_KEY = "ck_test";
    const tools = buildTools(ctx);
    expect(tools.composio).toBeDefined();
  });

  it("composio no aparece sin COMPOSIO_API_KEY", () => {
    const tools = buildTools(makeCtx("pro"));
    expect(tools.composio).toBeUndefined();
  });

  it("composio no aparece en free aunque haya COMPOSIO_API_KEY (sigue siendo Pro)", () => {
    const ctx = makeCtx("free");
    (ctx.env as any).COMPOSIO_API_KEY = "ck_test";
    const tools = buildTools(ctx);
    expect(tools.composio).toBeUndefined();
  });
});
