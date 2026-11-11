import { describe, it, expect } from "vitest";
import {
  MODOS,
  TEMAS,
  cssTema,
  normalizaColor,
  normalizaModo,
  normalizaTema,
  todosLosTemas,
} from "../../src/web/temas";
import { widgetScript, type Opciones } from "../../src/web/script";
import { textosWidget } from "../../src/web/textos";

const opciones = (extra: Partial<Opciones> = {}): Opciones => ({
  origen: "https://bot.workers.dev",
  nombre: "Barbería Pérez",
  saludo: "¡Hola! ¿Te agendo un corte?",
  color: "#c2410c",
  posicion: "derecha",
  tema: "suave",
  modo: "burbuja",
  destino: "#forja-chat",
  textos: textosWidget("es-419"),
  ...extra,
});

describe("widget.js — que el navegador lo pueda leer", () => {
  // El script se arma concatenando strings, así que un "+" olvidado no lo
  // detecta el compilador: lo detecta el visitante, con el chat muerto.
  // new Function() compila sin ejecutar — es el mismo parser del navegador.
  it("compila con cualquier combinación de estilo y formato", () => {
    for (const tema of TEMAS) {
      for (const modo of MODOS) {
        const js = widgetScript(opciones({ tema, modo }));
        expect(() => new Function(js), `${tema}/${modo}`).not.toThrow();
      }
    }
  });

  it("compila aunque el negocio tenga comillas o acentos en el nombre", () => {
    const js = widgetScript(opciones({ nombre: 'Café "El Ñandú" <Centro>', saludo: "Hola\\adiós" }));
    expect(() => new Function(js)).not.toThrow();
  });

  it("lleva dentro los 8 estilos, para cambiarlos sin desplegar", () => {
    const js = widgetScript(opciones());
    for (const tema of TEMAS) {
      for (const modo of MODOS) expect(js).toContain(`${tema}:${modo}`);
    }
  });

  // El visitante lee el idioma del BOT. Si esto se rompe, un bot en inglés
  // saluda en inglés pero su ventana dice "Escribe tu mensaje…" en español.
  it("se pinta en el idioma con el que atiende el bot", () => {
    const en = widgetScript(opciones({ textos: textosWidget("en") }));
    expect(en).toContain("Type your message…");
    expect(en).toContain("Close chat");
    expect(en).not.toContain("Escribe tu mensaje");

    const pt = widgetScript(opciones({ textos: textosWidget("pt-BR") }));
    expect(pt).toContain("Escreva sua mensagem…");
    expect(pt).toContain("Responde na hora");
  });

  it("compila en los cuatro idiomas", () => {
    for (const idioma of ["es-419", "es-ES", "en", "pt-BR"]) {
      const js = widgetScript(opciones({ textos: textosWidget(idioma) }));
      expect(() => new Function(js), idioma).not.toThrow();
    }
  });

  // Un hueco sin sustituir sale en la cara del visitante como "__ESCRIBE__".
  it("no deja huecos del markup sin rellenar", () => {
    const js = widgetScript(opciones({ textos: textosWidget("en") }));
    expect(js).not.toMatch(/__(INSTANTE|CERRAR|ESCRIBE|TUMSJ|ENVIAR)__/);
  });
});

describe("estilos", () => {
  it("hay uno por cada combinación", () => {
    expect(Object.keys(todosLosTemas())).toHaveLength(TEMAS.length * MODOS.length);
  });

  it("ningún estilo hornea el color: entra por variable", () => {
    // Si un tema escribiera el color literal, data-color dejaría de funcionar.
    for (const tema of TEMAS) {
      const css = cssTema(tema, "burbuja");
      expect(css, tema).toContain("var(--fc)");
      expect(css, tema).not.toContain("#ff6a1f");
    }
  });

  it("el formato ventana no deja nada flotando sobre el sitio", () => {
    for (const tema of TEMAS) {
      const css = cssTema(tema, "ventana");
      expect(css, tema).not.toContain("position:fixed");
      expect(css, tema).toContain(".burbuja,.cerrar{display:none}");
    }
  });

  it("el formato burbuja sí flota y se puede cerrar", () => {
    const css = cssTema("suave", "burbuja");
    expect(css).toContain("position:fixed");
    expect(css).toContain(".panel.abierto");
  });

  it("todos respetan a quien pidió menos animación", () => {
    for (const tema of TEMAS) {
      for (const modo of MODOS) {
        expect(cssTema(tema, modo), `${tema}/${modo}`).toContain("prefers-reduced-motion");
      }
    }
  });

  it("oscuro y suave no comparten fondo (son estilos distintos de verdad)", () => {
    expect(cssTema("oscuro", "burbuja")).not.toBe(cssTema("suave", "burbuja"));
    expect(cssTema("oscuro", "burbuja")).toContain("#16161b");
  });
});

describe("lo que escriba el dueño no puede romper el widget", () => {
  it("un estilo inventado cae en el de siempre", () => {
    expect(normalizaTema("neon")).toBe("suave");
    expect(normalizaTema(undefined)).toBe("suave");
    expect(normalizaTema("oscuro")).toBe("oscuro");
  });

  it("un formato inventado cae en burbuja", () => {
    expect(normalizaModo("popup")).toBe("burbuja");
    expect(normalizaModo("ventana")).toBe("ventana");
  });

  it("un color inválido no se inyecta en el CSS", () => {
    expect(normalizaColor("rojo")).toBe("#ff6a1f");
    expect(normalizaColor("red;}body{display:none")).toBe("#ff6a1f");
    expect(normalizaColor("#c2410c")).toBe("#c2410c");
    expect(normalizaColor("#fff")).toBe("#fff");
  });
});

describe("widget flotante en móvil — el compositor nunca queda fuera de pantalla", () => {
  // Reporte de un miembro (sep-2026): con 100vh el panel no descontaba la barra
  // del navegador ni el teclado y el botón de enviar quedaba oculto. dvh sí.
  it("los 4 temas en modo burbuja usan dvh con fallback vh y safe-area en el pie", () => {
    for (const tema of TEMAS) {
      const css = cssTema(tema, "burbuja");
      expect(css).toContain("max-height:calc(100vh - 120px);max-height:calc(100dvh - 120px)");
      expect(css).toContain("height:100vh;height:100dvh;max-height:100vh;max-height:100dvh");
      expect(css).toContain("padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))");
    }
  });
  it("el modo ventana (incrustado) no hereda el safe-area del pie", () => {
    for (const tema of TEMAS) expect(cssTema(tema, "ventana")).not.toContain("safe-area-inset-bottom");
  });
});
