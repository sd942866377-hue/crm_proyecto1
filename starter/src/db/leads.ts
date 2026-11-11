import { Db } from "./client";
import type { Env } from "../env";
import { dispatchMobilePush } from "../mobile-push";
import { renderPush } from "../lib/push-templates";

// Única fuente de verdad del dominio de status de un lead — admin/routes.ts
// (mutación desde el panel) y api-inbox.ts (POST /conversations/:id/status,
// Forja Inbox móvil) importan esto en vez de duplicar el literal.
export const LEAD_STATUSES = ["new", "contacted", "sold", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface Lead {
  id: string;
  conversation_id: string | null;
  name: string | null;
  contact: string | null;
  channel_user_id: string | null;
  intent: string;
  notes: string | null;
  status: LeadStatus;
  exported_to: string | null;
  external_id: string | null;
  /** JSON con los campos propios del nicho (o null). Ver leadMetadata(). */
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateLeadInput {
  conversationId: string | null;
  channelUserId: string | null;
  name?: string;
  contact?: string;
  intent: string;
  notes?: string;
  /** Campos propios del nicho; se serializan a JSON en la columna metadata. */
  metadata?: Record<string, string | number | null>;
}

/** Parsea el JSON de metadata de un lead a un objeto plano (vacío si no hay/está roto). */
export function leadMetadata(lead: Pick<Lead, "metadata">): Record<string, string> {
  if (!lead.metadata) return {};
  try {
    const o = JSON.parse(lead.metadata);
    if (!o || typeof o !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v !== null && v !== undefined) out[k] = String(v);
    }
    return out;
  } catch {
    return {};
  }
}

// Señales de que el lead ya tomó una acción concreta (pidió, reservó, agendó,
// cotizó, va a pagar) y no solo preguntó — heurística simple sobre el texto
// libre de `intent` que arma cada tool (ver src/tools/*.ts: captureLead deja
// el intent tal como lo redacta el LLM; el resto lo prefija con su categoría,
// ej. "Pedido · …", "Cita · …"). Primera pasada; ajustable sin tocar el resto
// del flujo de push.
const HOT_INTENT_SIGNALS = [
  "pedido", "compr", "pagar", "pago", "cotiz", "reserv", "agend", "cita",
  "visita", "confirm", "hospedaje",
];
function looksHot(intent: string): boolean {
  const t = intent.toLowerCase();
  return HOT_INTENT_SIGNALS.some((k) => t.includes(k));
}

// Máx 1 push `lead_hot` por conversación por hora — evita ráfagas si el
// cliente genera varios leads seguidos (ej. cotiza dos veces).
const HOT_PUSH_THROTTLE_MS = 60 * 60 * 1000;

export class LeadsRepo {
  // `env` es OPCIONAL a propósito: sin él, create() sigue funcionando exacto
  // igual que antes (tests / callers que no necesitan el push), solo que sin
  // avisar al dueño. Los 8 tools que capturan leads SÍ lo pasan.
  constructor(private readonly db: Db, private readonly env?: Env) {}

  async create(input: CreateLeadInput): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const metadata =
      input.metadata && Object.keys(input.metadata).length > 0
        ? JSON.stringify(input.metadata)
        : null;
    await this.db.run(
      `INSERT INTO leads (id, conversation_id, name, contact, channel_user_id, intent, notes, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.conversationId,
        input.name ?? null,
        input.contact ?? null,
        input.channelUserId,
        input.intent,
        input.notes ?? null,
        metadata,
        now,
        now,
      ],
    );

    // Push best-effort a Forja Inbox móvil: "alguien quiere comprar". Se
    // AWAITEA (no fire-and-forget) porque el Worker puede matar una promesa
    // colgada apenas termina esta llamada — mismo patrón que agent.ts/
    // watchdog.ts/handoffHuman.ts. Nunca revienta create(): maybeDispatchHotPush
    // atrapa todo internamente y dispatchMobilePush ya es best-effort (nunca
    // lanza) — el lead YA está a salvo en D1 (lo de arriba) pase lo que pase.
    if (this.env && input.conversationId && looksHot(input.intent)) {
      await this.maybeDispatchHotPush(input.conversationId, input.name, input.intent);
    }

    return id;
  }

  private async maybeDispatchHotPush(
    conversationId: string,
    name: string | undefined,
    intent: string,
  ): Promise<void> {
    try {
      // El lead que se acaba de insertar YA cuenta en este SELECT: > 1 =
      // hubo otro en la última hora → se saltó el push (throttle).
      const recent = await this.db.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM leads WHERE conversation_id = ? AND created_at > ?",
        [conversationId, Date.now() - HOT_PUSH_THROTTLE_MS],
      );
      if ((recent?.n ?? 0) > 1) return;
      const push = renderPush("lead_hot", { cliente: name || "Cliente", motivo: intent });
      await dispatchMobilePush(this.env!, {
        type: "lead_hot",
        title: push.title,
        body: push.body,
        conversationId,
      });
    } catch {
      /* best-effort — el ping es un extra, nunca la ruta crítica */
    }
  }

  async list(limit: number, status?: string): Promise<Lead[]> {
    if (status) {
      return this.db.all<Lead>(
        "SELECT * FROM leads WHERE status = ? ORDER BY created_at DESC LIMIT ?",
        [status, limit],
      );
    }
    return this.db.all<Lead>(
      "SELECT * FROM leads ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
  }

  async setStatus(id: string, status: Lead["status"]): Promise<void> {
    await this.db.run(
      "UPDATE leads SET status = ?, updated_at = ? WHERE id = ?",
      [status, Date.now(), id],
    );
  }

  async setExported(id: string, target: string, externalId: string): Promise<void> {
    await this.db.run(
      "UPDATE leads SET exported_to = ?, external_id = ?, updated_at = ? WHERE id = ?",
      [target, externalId, Date.now(), id],
    );
  }
}
