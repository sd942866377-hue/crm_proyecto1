/**
 * Reporte de Calidad — convierte la última corrida de `pnpm eval` en un
 * documento white-label, listo para que el miembro (o su agencia) se lo entregue
 * a SU cliente. Lenguaje de negocio, NO técnico: score, boleta legible y
 * recomendaciones, con la marca del bot (BRAND_*), imprimible a PDF.
 *
 * Uso:
 *   pnpm eval           # genera test/eval/last-run.json
 *   pnpm eval:report    # produce reporte-calidad.html en la carpeta del bot
 *
 * Fuente: test/eval/last-run.json (lo escribe eval-bot-live.ts). Marca: se lee
 * del wrangler.toml del bot (BRAND_NAME/BUSINESS_NAME/BRAND_ACCENT/…). Todo el
 * rendering es una función PURA (renderQualityReport) para poder testearlo.
 */
import process from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { LAST_RUN_PATH, type EvalFixture, type EvalSummary } from "./eval-bot-live";

export interface Brand {
  name: string; // marca que ve el cliente (BRAND_NAME → BUSINESS_NAME)
  business: string; // nombre del negocio
  botName: string; // nombre del asistente
  accent: string; // color primario de la marca
  accent2: string; // color secundario
  hideForja: boolean; // Modo Agencia: no mencionar "Forja" en el reporte
}

export interface QualityReportInput {
  summary: EvalSummary;
  fixtures: EvalFixture[];
  brand: Brand;
  generatedAt: string; // ISO
}

const DEFAULT_BRAND: Brand = {
  name: "Tu negocio",
  business: "Tu negocio",
  botName: "el asistente",
  accent: "#f07a3f",
  accent2: "#f5a623",
  hideForja: false,
};

/** Veredicto de negocio según el % aprobado. */
export function verdict(passRate: number): { label: string; tone: "great" | "good" | "ok" | "bad" } {
  if (passRate >= 0.95) return { label: "Excelente", tone: "great" };
  if (passRate >= 0.85) return { label: "Muy bueno", tone: "good" };
  if (passRate >= 0.7) return { label: "Aceptable — con áreas de mejora", tone: "ok" };
  return { label: "Requiere atención", tone: "bad" };
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string): string {
  // Formato legible es-MX sin depender de Intl-timezone (día de mes de año).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${d.getUTCDate()} de ${meses[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/**
 * Renderiza el reporte a un HTML autocontenido (imprimible a PDF). PURA: mismos
 * inputs → mismo output. No toca disco ni red.
 */
export function renderQualityReport(input: QualityReportInput): string {
  const { summary, fixtures, brand, generatedAt } = input;
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const pct = Math.round(summary.passRate * 100);
  const v = verdict(summary.passRate);
  const failed = summary.results.filter((r) => !r.passed);

  const rows = summary.results
    .map((r) => {
      const fx = byId.get(r.id);
      const que = esc(fx?.rubric || r.id);
      const ok = r.passed;
      return `<tr class="${ok ? "ok" : "bad"}">
        <td class="mark">${ok ? "✓" : "✗"}</td>
        <td class="what">${que}</td>
        <td class="note">${esc(r.reason)}</td>
      </tr>`;
    })
    .join("\n");

  const reco = failed.length === 0
    ? `El asistente superó <b>todas</b> las pruebas. Recomendamos re-evaluar cada mes para mantener este nivel de calidad.`
    : `Se identificaron <b>${failed.length}</b> ${failed.length === 1 ? "punto" : "puntos"} a reforzar (marcados con ✗). Se pueden ajustar sin afectar lo que ya funciona; una nueva evaluación confirmará la mejora.`;

  const firma = brand.hideForja
    ? `Reporte generado por ${esc(brand.name)}`
    : `Reporte generado por ${esc(brand.name)} · Calidad medida con Forja`;

  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reporte de Calidad — ${esc(brand.business)}</title>
<style>
  :root{ --accent:${esc(brand.accent)}; --accent2:${esc(brand.accent2)};
    --ink:#241c14; --muted:#6b5d4b; --soft:#96866f; --paper:#fbf7f0; --card:#fffdf9;
    --line:#e8dcc9; --ok:#3e8e5b; --bad:#c25a3a; }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--paper);color:var(--ink);font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;font-size:14px}
  .wrap{max-width:760px;margin:0 auto;padding:44px 30px 70px}
  .brandrow{display:flex;align-items:center;gap:12px;border-bottom:3px solid var(--ink);padding-bottom:16px}
  .wordmark{font-weight:800;font-size:22px;letter-spacing:-.02em;color:var(--ink)}
  .wordmark .dot{color:var(--accent)}
  .kicker{margin-left:auto;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--soft);text-align:right}
  h1{font-size:30px;letter-spacing:-.02em;margin:22px 0 4px;line-height:1.1}
  .sub{color:var(--muted);font-size:15px}
  .scorecard{display:flex;gap:20px;align-items:center;background:var(--card);border:1px solid var(--line);
    border-left:5px solid var(--accent);border-radius:8px;padding:22px 24px;margin:24px 0}
  .score{font-size:52px;font-weight:800;line-height:1;color:var(--accent)}
  .score small{font-size:22px;color:var(--soft);font-weight:700}
  .scoremeta .verdict{font-weight:700;font-size:18px}
  .scoremeta .verdict.great,.scoremeta .verdict.good{color:var(--ok)}
  .scoremeta .verdict.ok{color:#b7791f}
  .scoremeta .verdict.bad{color:var(--bad)}
  .scoremeta .count{color:var(--muted);font-size:14px;margin-top:2px}
  .intro{color:var(--muted);font-size:14px;margin:6px 0 22px}
  h2{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--soft);margin:26px 0 12px;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  th{text-align:left;color:var(--soft);font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:0 10px 8px;font-weight:700}
  td{padding:11px 10px;border-top:1px solid var(--line);vertical-align:top}
  td.mark{width:26px;font-weight:800;font-size:16px}
  tr.ok td.mark{color:var(--ok)} tr.bad td.mark{color:var(--bad)}
  td.what{font-weight:600;color:var(--ink);width:42%}
  td.note{color:var(--muted)}
  tr.bad td.what,tr.bad td.note{background:rgba(194,90,58,.05)}
  .reco{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px 20px;margin-top:16px;color:var(--muted)}
  .reco b{color:var(--ink)}
  footer{margin-top:34px;border-top:1px solid var(--line);padding-top:16px;color:var(--soft);font-size:12px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
  @page{margin:14mm}
  @media print{ body{background:#fff} .wrap{padding:0;max-width:none} .scorecard,.reco,tr{break-inside:avoid} }
</style></head>
<body><div class="wrap">
  <div class="brandrow">
    <span class="wordmark">${esc(brand.name)}<span class="dot">.</span></span>
    <span class="kicker">Reporte de Calidad<br>${fmtDate(generatedAt)}</span>
  </div>

  <h1>Calidad del asistente</h1>
  <p class="sub">Evaluación automatizada de la atención de <b>${esc(brand.botName)}</b>${brand.business ? ` · ${esc(brand.business)}` : ""}</p>

  <div class="scorecard">
    <div class="score">${pct}<small>%</small></div>
    <div class="scoremeta">
      <div class="verdict ${v.tone}">${v.label}</div>
      <div class="count">${summary.passed} de ${summary.total} pruebas superadas</div>
    </div>
  </div>

  <p class="intro">Simulamos <b>${summary.total}</b> conversaciones de clientes reales cubriendo situaciones clave —dudas frecuentes, captura de datos, escalar a una persona y temas fuera de alcance— y un evaluador de IA independiente calificó cada respuesta del asistente contra un criterio de aprobación.</p>

  <h2>Boleta de resultados</h2>
  <table>
    <thead><tr><th></th><th>Qué se probó</th><th>Observación</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="reco"><b>Recomendación:</b> ${reco}</div>

  <footer><span>${firma}</span><span>${fmtDate(generatedAt)}</span></footer>
</div></body></html>`;
}

// ── main (efectos: disco) ─────────────────────────────────────────────────

function readVar(toml: string, key: string): string {
  const m = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : "";
}

/** Lee la marca del wrangler.toml del bot (cae a defaults si algo falta). */
export function loadBrand(tomlPath = "wrangler.toml"): Brand {
  let toml = "";
  try {
    toml = readFileSync(tomlPath, "utf8");
  } catch {
    return { ...DEFAULT_BRAND };
  }
  const business = readVar(toml, "BUSINESS_NAME");
  const brandName = readVar(toml, "BRAND_NAME");
  return {
    name: brandName || business || DEFAULT_BRAND.name,
    business: business || brandName || "",
    botName: readVar(toml, "BOT_NAME") || DEFAULT_BRAND.botName,
    accent: readVar(toml, "BRAND_ACCENT") || DEFAULT_BRAND.accent,
    accent2: readVar(toml, "BRAND_ACCENT_2") || readVar(toml, "BRAND_ACCENT") || DEFAULT_BRAND.accent2,
    hideForja: readVar(toml, "BRAND_HIDE_FORJA") === "on",
  };
}

async function main(): Promise<void> {
  const runPath = process.argv[2] || process.env.EVAL_OUT || LAST_RUN_PATH;
  let run: { summary: EvalSummary; fixtures: EvalFixture[]; generatedAt?: string };
  try {
    run = JSON.parse(readFileSync(runPath, "utf8"));
  } catch {
    console.error(`No encontré la corrida en ${runPath}. Corre \`pnpm eval\` primero.`);
    process.exit(1);
    return;
  }
  const brand = loadBrand();
  const html = renderQualityReport({
    summary: run.summary,
    fixtures: run.fixtures ?? [],
    brand,
    generatedAt: run.generatedAt || new Date().toISOString(),
  });
  const out = "reporte-calidad.html";
  writeFileSync(out, html);
  const pct = Math.round(run.summary.passRate * 100);
  console.log(`✓ Reporte de Calidad generado: ${out} (${pct}% — ${run.summary.passed}/${run.summary.total})`);
  console.log(`  Ábrelo e imprímelo a PDF (o compártelo tal cual) con tu cliente.`);
}

const isEntrypoint =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;

if (isEntrypoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
