/**
 * Plantillas de push móvil (Forja Inbox) — la copy de CADA aviso vive en UN
 * solo lugar, editable y localizable, en vez de estar regada por agent.ts /
 * watchdog.ts / handoffHuman.ts / dailyReport.ts / leads.ts.
 *
 * Formato reusable del contrato (CONTRACT-NOTIF-TEMPLATES §1):
 *   título:  {{emoji}} {{cliente}} {{accion}}
 *   cuerpo:  {{motivo}} — "{{preview}}"
 * Los tipos EXISTENTES (handoff/message/lead_hot/report/watchdog) no calzan con
 * ese molde palabra por palabra — cada uno declara su propia plantilla aquí y
 * `renderPush` reproduce su salida ACTUAL sin cambiarla (los callers migran a
 * este helper sin tocar lo que llega al teléfono). Los tipos NUEVOS
 * (upset/cancel) sí usan el molde de arriba.
 *
 * Reglas de privacidad (ver mobile-push.ts): `{{cliente}}` SIEMPRE enmascarado
 * (display_name o maskContact — nunca el teléfono/usuario crudo); `{{preview}}`
 * es una vista corta y recortada del último mensaje del cliente, permitida en el
 * cuerpo. El truncado a 120/240 lo hace dispatchMobilePush; aquí solo se arma el
 * texto.
 */
import type { MobilePushType } from "../mobile-push";

/** Variables interpolables. Todas opcionales: cada plantilla usa las suyas. */
export interface PushVars {
  /** Ícono al inicio del título (solo tipos nuevos). */
  emoji?: string;
  /** Nombre/handle del cliente, YA enmascarado por el caller. */
  cliente?: string;
  /** Situación corta para el título (ej. "está molesto"). */
  accion?: string;
  /** Razón/resumen corto para el cuerpo (del Analista, sin llamada extra). */
  motivo?: string;
  /** Vista previa recortada del último mensaje del cliente. */
  preview?: string;
  /** Título ya armado por el caller (reporte diario: es el subject del reporte). */
  titulo?: string;
}

interface Template {
  title: string;
  body: string;
}

/**
 * La copy de cada tipo. Placeholders `{{var}}`. Editar aquí cambia el aviso en
 * todos los call sites a la vez.
 */
const TEMPLATES: Record<MobilePushType, Template> = {
  // — Existentes: reproducen EXACTO lo que ya mandaban (no tocar la salida). —
  handoff: { title: "Handoff — {{cliente}}", body: "{{motivo}}" },
  message: { title: "Mensaje — {{cliente}}", body: "{{preview}}" },
  lead_hot: { title: "Alguien quiere comprar — {{cliente}}", body: "{{motivo}}" },
  watchdog: { title: "Salud del bot", body: "{{motivo}}" },
  report: { title: "{{titulo}}", body: "{{motivo}}" },
  // — Nuevos (v3.4): molde reusable del contrato. —
  upset: { title: "{{emoji}} {{cliente}} {{accion}}", body: '{{motivo}} — "{{preview}}"' },
  cancel: { title: "{{emoji}} {{cliente}} {{accion}}", body: '{{motivo}} — "{{preview}}"' },
};

/** Sustituye `{{var}}` por su valor (o "" si no vino). */
function fill(tpl: string, vars: PushVars): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = (vars as Record<string, string | undefined>)[key];
    return v ?? "";
  });
}

/**
 * Arma { title, body } para un tipo de push. Para upset/cancel, si no hay
 * preview se cae la cola ` — "…"` (queda solo el motivo); esa limpieza NO se
 * aplica a los tipos existentes, así que su salida es idéntica a la de antes.
 */
export function renderPush(type: MobilePushType, vars: PushVars): { title: string; body: string } {
  const tpl = TEMPLATES[type];
  const title = fill(tpl.title, vars);
  let body = fill(tpl.body, vars);
  if (type === "upset" || type === "cancel") {
    body = body.replace(/\s*—\s*""\s*$/, "").trim();
  }
  return { title, body };
}
