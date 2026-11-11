import { describe, it, expect } from "vitest";
import { mapMessageToAiTurn } from "../src/history";
import { markersToPrompt, stripMediaMarkers } from "../src/lib/media-markers";

describe("mapMessageToAiTurn", () => {
  it("pasa user/assistant tal cual", () => {
    expect(mapMessageToAiTurn({ role: "user", content: "hola" })).toEqual({
      role: "user",
      content: "hola",
    });
    expect(mapMessageToAiTurn({ role: "assistant", content: "buenas" })).toEqual({
      role: "assistant",
      content: "buenas",
    });
  });

  it("tool → user (contexto, no turno real)", () => {
    expect(mapMessageToAiTurn({ role: "tool", content: '{"tool":"searchKb"}' })).toEqual({
      role: "user",
      content: '{"tool":"searchKb"}',
    });
  });

  it("owner → assistant (lo que mandó el dueño, como si el bot lo hubiera dicho)", () => {
    expect(mapMessageToAiTurn({ role: "owner", content: "te lo aparto" })).toEqual({
      role: "assistant",
      content: "te lo aparto",
    });
  });

  it("note → user, envuelta como contexto interno — NUNCA pasa el rol crudo al AI SDK", () => {
    const out = mapMessageToAiTurn({ role: "note", content: "cliente frecuente, no cobrar cambio" });
    expect(out.role).toBe("user");
    expect(out.content).toContain("Nota interna del dueño");
    expect(out.content).toContain("cliente frecuente, no cobrar cambio");
    expect(out.content).toContain("el cliente NO ve esto");
  });
});

// Los marcadores son contabilidad interna del hilo. Antes viajaban CRUDOS al
// prompt (una URL firmada de WhatsApp, un uuid): tokens tirados y el modelo
// llegaba a repetírselos al cliente.
describe("mapMessageToAiTurn — marcadores fuera del prompt", () => {
  it("quita [MEDIA:] y deja la transcripción del audio", () => {
    const out = mapMessageToAiTurn({
      role: "user",
      content: "quiero una cita el jueves\n[MEDIA: 8f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f]",
    });
    expect(out.content).toBe("quiero una cita el jueves");
  });

  it("[IMAGE_URL:] → frase corta, sin la URL (que además ya expiró)", () => {
    const out = mapMessageToAiTurn({
      role: "user",
      content: "así lo quiero\n[IMAGE_URL: https://bot.example.com/webhooks/whatsapp/media/X?exp=1&sig=abc]\n[MEDIA: 8f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f]",
    });
    expect(out.content).not.toContain("http");
    expect(out.content).not.toContain("MEDIA");
    expect(out.content).toContain("así lo quiero");
    expect(out.content).toContain("una foto");
  });

  it("[FILE:] conserva el nombre y avisa que el bot no puede leerlo", () => {
    const out = mapMessageToAiTurn({
      role: "user",
      content: "[FILE: cotización.pdf] [MEDIA: 8f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f]",
    });
    expect(out.content).toContain("cotización.pdf");
    expect(out.content).toContain("no puede leerlo");
    expect(out.content).not.toContain("[");
  });

  it("mensaje del dueño con solo [MEDIA:] no queda vacío (un turno vacío revienta al proveedor)", () => {
    const out = mapMessageToAiTurn({
      role: "owner",
      content: "[MEDIA: 8f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f]",
    });
    expect(out.role).toBe("assistant");
    expect(out.content).toBe("(le mandaste un archivo)");
  });

  it("la plantilla llega como su texto renderizado, sin el [TPL:]", () => {
    const out = mapMessageToAiTurn({
      role: "owner",
      content: "[TPL:HX9f8e] Hola Luis, te recordamos tu cita del jueves.",
    });
    expect(out.content).toBe("Hola Luis, te recordamos tu cita del jueves.");
  });
});

describe("markersToPrompt", () => {
  const IMG = "mira esto\n[IMAGE_URL: https://x/y?sig=1]";

  it("redacta según quién mandó el mensaje", () => {
    expect(markersToPrompt(IMG, "cliente")).toContain("el cliente mandó una foto");
    expect(markersToPrompt(IMG, "negocio")).toContain("le mandaste una foto");
  });

  it("un texto sin marcadores sale idéntico", () => {
    expect(markersToPrompt("¿a qué hora abren?", "cliente")).toBe("¿a qué hora abren?");
  });

  it("un texto vacío sigue vacío (no inventa que hubo un archivo)", () => {
    expect(markersToPrompt("", "cliente")).toBe("");
  });

  it("stripMediaMarkers (lo que ve la app) los sigue borrando a secas", () => {
    expect(stripMediaMarkers(IMG)).toBe("mira esto");
  });
});
