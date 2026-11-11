import { describe, it, expect } from "vitest";
import { mergeLibrary } from "../../src/owner/library";
import { OWNER_TOOLS } from "../../src/owner/tools";
import { isOwner } from "../../src/owner/handler";
import { renderMarkdown } from "../../src/owner/leadmagnet";

describe("mergeLibrary", () => {
  it("trae los defaults (comunidad, masterclass)", () => {
    const lib = mergeLibrary(null);
    expect(lib.comunidad).toContain("horizontesia.com");
    expect(lib.masterclass).toContain("masterclass.horizontesia.com");
  });

  it("mezcla lo guardado sobre los defaults", () => {
    const lib = mergeLibrary(JSON.stringify({ ebook: "https://x.com/ebook", masterclass: "https://nuevo" }));
    expect(lib.ebook).toBe("https://x.com/ebook");
    expect(lib.masterclass).toBe("https://nuevo"); // override
    expect(lib.comunidad).toContain("horizontesia.com"); // default intacto
  });

  it("JSON inválido → solo defaults", () => {
    expect(mergeLibrary("{no json")).toHaveProperty("comunidad");
  });
});

describe("OWNER_TOOLS", () => {
  it("expone las tools esperadas", () => {
    const names = OWNER_TOOLS.map((t) => t.function.name);
    expect(names).toEqual([
      "list_resources",
      "resolve_reel",
      "transcribe_reel",
      "publish_lead_magnet",
      "create_funnel",
    ]);
  });

  it("create_funnel requiere reel_url + keyword", () => {
    const cf = OWNER_TOOLS.find((t) => t.function.name === "create_funnel")!;
    expect((cf.function.parameters as { required?: string[] }).required).toEqual(["reel_url", "keyword"]);
  });
});

describe("isOwner", () => {
  it("match exacto", () => {
    expect(isOwner("+5215518292608", "+5215518292608")).toBe(true);
  });
  it("tolera el 1 móvil de México (+52 vs +521)", () => {
    expect(isOwner("+5215518292608", "+525518292608")).toBe(true);
    expect(isOwner("whatsapp:+5215518292608", "525518292608")).toBe(true);
  });
  it("rechaza números distintos y vacíos", () => {
    expect(isOwner("+5215518292608", "+5219999999999")).toBe(false);
    expect(isOwner("+5215518292608", undefined)).toBe(false);
  });
});

describe("renderMarkdown", () => {
  it("títulos, negritas, listas y links", () => {
    const html = renderMarkdown("# Título\n\nHola **mundo**\n\n- uno\n- dos\n\n[link](https://x.com)");
    expect(html).toContain("<h1>Título</h1>");
    expect(html).toContain("<strong>mundo</strong>");
    expect(html).toContain("<li>uno</li>");
    expect(html).toContain('<a href="https://x.com"');
  });
  it("escapa HTML del contenido", () => {
    expect(renderMarkdown("hola <script>")).toContain("&lt;script&gt;");
  });
});
