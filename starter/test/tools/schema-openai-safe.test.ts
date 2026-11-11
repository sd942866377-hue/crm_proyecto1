import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Guarda contra un bug CRÍTICO y silencioso (reportado por Pedro/PeeterDigital):
// z.string().email() de Zod compila a un pattern de JSON Schema con lookaround,
// que OpenAI RECHAZA en su validación estricta de esquemas de tools. Como los
// esquemas de TODAS las tools viajan juntos en cada llamada, uno malo tumba la
// conversación ENTERA (el bot se queda mudo en cualquier tema, no solo al usar
// esa tool). Usa una regex sin lookaround en su lugar: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.
describe("esquemas de tools compatibles con OpenAI (sin lookaround)", () => {
  it("ningún tool usa validadores de Zod que generan lookaround (.email/.url/.emoji)", () => {
    const dir = join(process.cwd(), "src/tools");
    const offenders: string[] = [];
    const scan = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, f.name);
        if (f.isDirectory()) scan(p);
        else if (f.name.endsWith(".ts")) {
          // Quita comentarios: solo nos importa el CÓDIGO real, no menciones en texto.
          const src = readFileSync(p, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "");
          if (/\.(email|emoji)\s*\(/.test(src)) offenders.push(p.replace(process.cwd() + "/", ""));
        }
      }
    };
    scan(dir);
    expect(offenders, `estos rompen OpenAI, cámbialos por .regex(...): ${offenders.join(", ")}`).toEqual([]);
  });
});
