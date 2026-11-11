/**
 * Minería de objeciones + score de interés (modo evento/masterclass).
 *
 * Cada 10 min (cron), etiqueta conversaciones que llevan ≥30 min sin actividad
 * y que no tienen etiqueta fresca: interés (caliente/tibio/frio), objeción
 * principal (precio/tiempo/confianza/no_claro/ninguna) y resumen de 1 línea.
 * Si la persona vuelve a escribir, la etiqueta se recalcula en el siguiente
 * tick (labeled_at < último mensaje). Corre con el tier fast — barato.
 *
 * El resultado alimenta /funnel-stats → panel del admin: segmentación en vivo,
 * reporte de objeciones para la siguiente masterclass y la lista de leads
 * calientes para el follow-up manual de Santi.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { MessagesRepo } from "../db/messages";
import { workModel } from "../llm/work-model";
import { hasMasterclassMode, salesVariantFor } from "../tools/masterclass";

const IDLE_MS = 30 * 60_000;
const MAX_MSG_CHARS = 300;

export const INTEREST_VALUES = ["caliente", "tibio", "frio"] as const;
export const OBJECTION_VALUES = [
  "precio",
  "tiempo",
  "confianza",
  "no_claro",
  "ninguna",
] as const;

interface LabelResult {
  interest: string;
  objection: string;
  summary: string;
}

function extractJson<T>(raw: string): T | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function labelPrompt(env: Env, transcript: string): string {
  return `Analiza esta conversación de WhatsApp entre un asistente vendedor y un prospecto de "${env.EVENT_NAME ?? "la masterclass"}" (evento gratuito que vende una membresía al final).

<conversacion>
${transcript}
</conversacion>

Clasifica al PROSPECTO y responde SOLO con JSON (sin explicación):
{"interest":"caliente|tibio|frio","objection":"precio|tiempo|confianza|no_claro|ninguna","summary":"una línea en español"}

- interest caliente: mostró intención clara de comprar/registrarse, pidió el link o dio sus datos
- interest tibio: interesado pero con dudas sin resolver o dejó de responder a media decisión
- interest frio: solo preguntó algo puntual, respondió con desgano o se despidió sin interés
- objection: la razón PRINCIPAL por la que no ha comprado — precio (caro/no le alcanza), tiempo (no puede ahora/luego lo ve), confianza (duda de que funcione/del vendedor), no_claro (no entendió qué se ofrece), ninguna (ya compró/se registró o no expresó objeción)
- summary: qué quiere y en qué quedó, en máx 15 palabras`;
}

export interface LabelRunResult {
  labeled: number;
  errors: number;
}

export async function labelConversations(
  env: Env,
  opts: { limit?: number; now?: number } = {},
): Promise<LabelRunResult> {
  if (!hasMasterclassMode(env)) return { labeled: 0, errors: 0 };
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 20;

  const db = new Db(env.DB);
  const pending = await db.all<{ id: string; last_user_at: number }>(
    `SELECT c.id AS id, MAX(m.created_at) AS last_user_at
     FROM conversations c
     JOIN messages m ON m.conversation_id = c.id AND m.role = 'user'
     LEFT JOIN conv_labels l ON l.conversation_id = c.id
     WHERE c.channel != 'test'
     GROUP BY c.id
     HAVING MAX(m.created_at) <= ?
        AND (MAX(l.labeled_at) IS NULL OR MAX(l.labeled_at) < MAX(m.created_at))
     ORDER BY last_user_at DESC
     LIMIT ?`,
    [now - IDLE_MS, limit],
  );
  if (pending.length === 0) return { labeled: 0, errors: 0 };

  const msgs = new MessagesRepo(db);
  const llm = await workModel(env, "fast", "insights");

  let labeled = 0;
  let errors = 0;
  for (const conv of pending) {
    try {
      const history = await msgs.lastN(conv.id, 30);
      const transcript = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          const text =
            m.content.length > MAX_MSG_CHARS ? `${m.content.slice(0, MAX_MSG_CHARS)}…` : m.content;
          return `${m.role === "user" ? "PROSPECTO" : "BOT"}: ${text}`;
        })
        .join("\n");
      if (!transcript.trim()) continue;

      const result = await llm.generate({ prompt: labelPrompt(env, transcript) });
      const parsed = extractJson<LabelResult>(result.text);
      if (!parsed) {
        errors++;
        continue;
      }
      const interest = (INTEREST_VALUES as readonly string[]).includes(parsed.interest)
        ? parsed.interest
        : "tibio";
      const objection = (OBJECTION_VALUES as readonly string[]).includes(parsed.objection)
        ? parsed.objection
        : "no_claro";

      await db.run(
        `INSERT INTO conv_labels (conversation_id, variant, interest, objection, summary, labeled_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           variant = excluded.variant, interest = excluded.interest,
           objection = excluded.objection, summary = excluded.summary,
           labeled_at = excluded.labeled_at`,
        [
          conv.id,
          salesVariantFor(conv.id),
          interest,
          objection,
          (parsed.summary ?? "").slice(0, 200),
          now,
        ],
      );
      labeled++;
    } catch (e) {
      errors++;
      console.error(`[objections] labeling ${conv.id} failed:`, e);
    }
  }
  console.log(`[objections] labeled=${labeled} errors=${errors} pending=${pending.length}`);
  return { labeled, errors };
}
