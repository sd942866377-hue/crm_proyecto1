// Preguntas frecuentes (Forja Inbox móvil, setting `faqs`). El dueño las edita
// desde la app; el bot las responde adaptando el tono. Se agregan AL FINAL del
// business_context, como el horario (regla: no destruir config del dueño).

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

/** Sanea/valida la lista que manda la app. Silencioso: descarta inválidas,
 *  cap 50, pregunta ≤300, respuesta ≤1500. */
export function sanitizeFaqs(v: unknown): FaqItem[] {
  if (!Array.isArray(v)) return [];
  const out: FaqItem[] = [];
  for (const raw of v.slice(0, 50)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const question = typeof r.question === "string" ? r.question.trim().slice(0, 300) : "";
    const answer = typeof r.answer === "string" ? r.answer.trim().slice(0, 1500) : "";
    const id =
      typeof r.id === "string" && r.id.trim() ? r.id.trim().slice(0, 40) : question.slice(0, 40);
    if (!question || !answer) continue;
    out.push({ id, question, answer });
  }
  return out;
}

/** Bloque para el prompt. Vacío si no hay FAQs. */
export function renderFaqsBlock(faqs: FaqItem[]): string {
  if (!faqs.length) return "";
  const lines = faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join("\n\n");
  return (
    "Preguntas frecuentes del negocio (úsalas como fuente de verdad; adapta el tono, " +
    `no las cites literal si no ayuda):\n${lines}`
  );
}
