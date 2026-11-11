/**
 * Punto de extensión para reportes en ARCHIVO (DOCX / PDF).
 *
 * El bot base solo entrega HTML (email + página). Para DOCX o PDF, el dueño corre
 * el skill /reportes y Claude IMPLEMENTA el generador aquí (e instala la dep / activa
 * el binding de Browser Rendering para PDF). Filosofía Forja: el skill es la guía,
 * Claude hace lo técnico a la medida del negocio.
 *
 * Mientras no esté implementado, devolver null = "no hay archivo, manda el HTML".
 */
import type { Env } from "../../env";
import type { ReportModel } from "./template";

export interface ReportFile {
  filename: string;
  content: Uint8Array;
  mime: string;
}

export async function renderReportFile(
  _env: Env,
  _format: "docx" | "pdf",
  _input: { html: string; model: ReportModel },
): Promise<ReportFile | null> {
  // Placeholder: lo activa el skill /reportes.
  return null;
}
