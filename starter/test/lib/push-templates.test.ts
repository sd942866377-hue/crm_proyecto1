/**
 * Tests del helper de plantillas de push (src/lib/push-templates.ts).
 *
 * Lo crítico: los tipos EXISTENTES (handoff/message/lead_hot/report/watchdog)
 * migraron al helper SIN cambiar su salida observable — aquí se fija letra por
 * letra lo que cada uno mandaba antes. Los tipos NUEVOS (upset/cancel) usan el
 * molde del contrato y bajan la cola ` — "…"` cuando no hay preview.
 */
import { describe, it, expect } from "vitest";
import { renderPush } from "../../src/lib/push-templates";

describe("renderPush — tipos existentes (salida idéntica a la de antes)", () => {
  it("handoff: 'Handoff — <cliente>' / <summary>", () => {
    expect(renderPush("handoff", { cliente: "María", motivo: "Quiere hablar con una persona" })).toEqual({
      title: "Handoff — María",
      body: "Quiere hablar con una persona",
    });
  });

  it("message: 'Mensaje — <cliente>' / <preview>", () => {
    expect(renderPush("message", { cliente: "***1234", preview: "hola sigo esperando" })).toEqual({
      title: "Mensaje — ***1234",
      body: "hola sigo esperando",
    });
  });

  it("lead_hot: 'Alguien quiere comprar — <cliente>' / <intent>", () => {
    expect(renderPush("lead_hot", { cliente: "Carlos", motivo: "quiere el paquete de 6" })).toEqual({
      title: "Alguien quiere comprar — Carlos",
      body: "quiere el paquete de 6",
    });
  });

  it("watchdog: título fijo 'Salud del bot' / <motivo>", () => {
    expect(renderPush("watchdog", { motivo: "3 respuestas fallidas en 30 min" })).toEqual({
      title: "Salud del bot",
      body: "3 respuestas fallidas en 30 min",
    });
  });

  it("report: <subject> / <summary>", () => {
    expect(renderPush("report", { titulo: "📊 Reporte de hoy", motivo: "Día tranquilo, 4 chats." })).toEqual({
      title: "📊 Reporte de hoy",
      body: "Día tranquilo, 4 chats.",
    });
  });

  it("cliente ausente en handoff cae a cadena vacía (no rompe la plantilla)", () => {
    // El caller ya garantiza 'Cliente' como fallback; aquí solo verificamos que
    // un var faltante no deja un '{{cliente}}' crudo.
    expect(renderPush("handoff", { motivo: "x" }).title).toBe("Handoff — ");
  });
});

describe("renderPush — tipos nuevos (molde del contrato)", () => {
  it("upset: '😠 <cliente> está molesto' / '<motivo> — \"<preview>\"'", () => {
    expect(
      renderPush("upset", {
        emoji: "😠",
        cliente: "María",
        accion: "está molesto",
        motivo: "Lleva dos mensajes molesta por su pedido",
        preview: "esto no sirve",
      }),
    ).toEqual({
      title: "😠 María está molesto",
      body: 'Lleva dos mensajes molesta por su pedido — "esto no sirve"',
    });
  });

  it("cancel: '🚫 <cliente> quiere darse de baja' / '<motivo> — \"<preview>\"'", () => {
    expect(
      renderPush("cancel", {
        emoji: "🚫",
        cliente: "***5678",
        accion: "quiere darse de baja",
        motivo: "Pidió cancelar su membresía",
        preview: "quiero cancelar",
      }),
    ).toEqual({
      title: "🚫 ***5678 quiere darse de baja",
      body: 'Pidió cancelar su membresía — "quiero cancelar"',
    });
  });

  it("sin preview: se cae la cola ' — \"…\"', queda solo el motivo", () => {
    const r = renderPush("upset", {
      emoji: "😠",
      cliente: "Ana",
      accion: "está molesto",
      motivo: "Sentiment enojado sin último mensaje capturable",
      preview: "",
    });
    expect(r.title).toBe("😠 Ana está molesto");
    expect(r.body).toBe("Sentiment enojado sin último mensaje capturable");
  });
});
