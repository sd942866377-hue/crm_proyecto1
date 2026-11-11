import { describe, it, expect, vi } from "vitest";

// Mismo motivo que en index.test.ts: `src/index.ts` re-exporta SupportAgent y
// el SDK `agents` importa `cloudflare:workers`, que Node no resuelve fuera de
// workerd. Aquí solo ejercitamos el router de Hono.
vi.mock("agents", () => ({ Agent: class {} }));

import worker from "../src/index";
import { bustIdiomaCache } from "../src/idioma";
import { demoEnabled, demoOverLimit } from "../src/demo";

const baseEnv = {
  BOT_NAME: "Asistente de Barbería Atlas",
  BUSINESS_NAME: "Barbería Atlas",
  BOT_LANGUAGE: "es",
  BOT_TIER: "pro",
  BUFFER_SECONDS: "15",
  DASHBOARD_BASE_URL: "https://test.workers.dev",
} as any;

const on = { ...baseEnv, DEMO_MODE: "on" };

describe("modo demo — interruptor", () => {
  it("apagado por defecto (un bot de producción no expone chat público)", () => {
    expect(demoEnabled(baseEnv)).toBe(false);
    expect(demoEnabled({ ...baseEnv, DEMO_MODE: "off" } as any)).toBe(false);
  });

  it("se enciende con DEMO_MODE=on, sin importar mayúsculas", () => {
    expect(demoEnabled(on)).toBe(true);
    expect(demoEnabled({ ...baseEnv, DEMO_MODE: "ON" } as any)).toBe(true);
  });

  it("corta la sesión al llegar al tope de turnos", () => {
    expect(demoOverLimit(0)).toBe(false);
    expect(demoOverLimit(39)).toBe(false);
    expect(demoOverLimit(40)).toBe(true);
  });
});

describe("modo demo — rutas", () => {
  it("/demo da 404 cuando está apagado", async () => {
    const res = await worker.fetch(new Request("https://test/demo"), baseEnv, {} as any);
    expect(res.status).toBe(404);
  });

  it("/demo/send da 404 cuando está apagado", async () => {
    const res = await worker.fetch(
      new Request("https://test/demo/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", text: "hola" }),
      }),
      baseEnv,
      {} as any,
    );
    expect(res.status).toBe(404);
  });

  it("/demo sirve la página con la marca del prospecto", async () => {
    const res = await worker.fetch(new Request("https://test/demo"), on, {} as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Barbería Atlas");
    expect(html).toContain("/demo/send");
    expect(html).toContain("/demo/poll");
    // El chat NO debe ofrecer canales que el demo no usa.
    expect(html.toLowerCase()).not.toContain("telegram");
  });

  it("escapa el nombre del negocio (no se inyecta HTML por la marca)", async () => {
    const res = await worker.fetch(
      new Request("https://test/demo"),
      { ...on, BUSINESS_NAME: '<script>alert(1)</script>' } as any,
      {} as any,
    );
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  // El prospecto que abre la demo lee el idioma del BOT. Y ojo con el inglés:
  // "That's" lleva apóstrofo, que dentro del <script> inline rompería el JS si
  // el texto se pegara sin serializar.
  it("se pinta en el idioma con el que atiende el bot", async () => {
    // El idioma base se captura UNA vez por isolate (en producción, un isolate
    // = un bot). En el test hay que soltarlo para cambiar de idioma.
    bustIdiomaCache();
    const res = await worker.fetch(
      new Request("https://test/demo"),
      { ...on, BOT_LANGUAGE: "en" } as any,
      {} as any,
    );
    const html = await res.text();
    expect(html).toContain('lang="en"');
    expect(html).toContain("Ask me anything");
    expect(html).toContain("That's the end of the demo");
    expect(html).not.toContain("Pregúntame lo que quieras");

    bustIdiomaCache();
    const pt = await worker.fetch(
      new Request("https://test/demo"),
      { ...on, BOT_LANGUAGE: "pt-BR" } as any,
      {} as any,
    );
    const htmlPt = await pt.text();
    expect(htmlPt).toContain('lang="pt-BR"');
    expect(htmlPt).toContain("Pergunte o que quiser");

    bustIdiomaCache(); // no le dejes el idioma cambiado al siguiente test
  });

  it("/demo/poll exige sessionId", async () => {
    const res = await worker.fetch(new Request("https://test/demo/poll"), on, {} as any);
    expect(res.status).toBe(400);
  });

  it("/demo/poll devuelve lista vacía cuando la sesión aún no existe", async () => {
    const env = {
      ...on,
      DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }) }) }) },
    } as any;
    const res = await worker.fetch(
      new Request("https://test/demo/poll?session=nueva"),
      env,
      {} as any,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, messages: [] });
  });
});
