/**
 * Dashboard-editable KB documents (D1 `kb_docs`) + their Vectorize lifecycle.
 *
 * Two KB sources coexist:
 *  • Repo fixtures (scripts/kb-fixtures.json) — packaged with the template.
 *  • Dashboard docs (this module) — the owner writes them from /admin/kb.
 *
 * Dashboard docs are indexed IMMEDIATELY on save: previous vectors for the doc
 * are deleted (blanket id range) and fresh chunks are embedded and upserted,
 * so searchKb picks the change up on the next customer message. The global
 * "reindex all" combines both sources.
 */
import type { Env } from "../env";
import { Db } from "../db/client";
import { reindexKb, reindexFixtures, type KbChunk } from "./reindex";
import { chunkContent, MAX_CHUNKS, MAX_DOC_CHARS } from "./chunk";
import kbFixtures from "../../scripts/kb-fixtures.json";

export interface KbDoc {
  id: string;
  title: string;
  content: string;
  updated_at: number;
}

// Chunking + límites viven en ./chunk (compartidos con generate-fixtures, para
// que member/kb/ y los docs del panel troceen IGUAL). Re-exportados para no
// romper imports existentes (p.ej. admin/routes usa MAX_DOC_CHARS).
export { chunkContent, MAX_CHUNKS, MAX_DOC_CHARS };

export const FIXTURE_CHUNKS = kbFixtures as KbChunk[];

export class KbDocsRepo {
  constructor(private readonly db: Db) {}

  async list(): Promise<KbDoc[]> {
    return this.db.all<KbDoc>("SELECT * FROM kb_docs ORDER BY updated_at DESC");
  }

  async getById(id: string): Promise<KbDoc | null> {
    return this.db.first<KbDoc>("SELECT * FROM kb_docs WHERE id = ?", [id]);
  }

  async upsert(doc: { id: string; title: string; content: string }): Promise<void> {
    await this.db.run(
      `INSERT INTO kb_docs (id, title, content, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, content = excluded.content, updated_at = excluded.updated_at`,
      [doc.id, doc.title, doc.content, Date.now()],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.run("DELETE FROM kb_docs WHERE id = ?", [id]);
  }
}

// chunkContent vive en ./chunk (compartido con scripts/generate-fixtures.ts).

function vectorIds(docId: string): string[] {
  return Array.from({ length: MAX_CHUNKS }, (_, i) => `dash:${docId}#${i}`);
}

/** Chunks for one dashboard doc, title-prefixed so matches carry context. */
export function docChunks(doc: KbDoc): KbChunk[] {
  return chunkContent(doc.content).map((content, i) => ({
    id: `dash:${doc.id}#${i}`,
    title: doc.title,
    content,
    source: "dashboard",
  }));
}

/** Re-embed one doc: blanket-delete its old vectors, then upsert fresh ones. */
export async function indexDoc(env: Env, doc: KbDoc): Promise<{ indexed: number }> {
  await env.KB.deleteByIds(vectorIds(doc.id));
  return reindexKb(env, docChunks(doc));
}

/** Remove a deleted doc's vectors from the index. */
export async function removeDocVectors(env: Env, docId: string): Promise<void> {
  await env.KB.deleteByIds(vectorIds(docId));
}

/** All dashboard docs as chunks (for the global reindex). */
export async function dashboardChunks(env: Env): Promise<KbChunk[]> {
  const docs = await new KbDocsRepo(new Db(env.DB)).list();
  return docs.flatMap(docChunks);
}

/** Global reindex: fixtures (con limpieza de huérfanos) + todos los docs del panel. */
export async function reindexAll(env: Env): Promise<{ indexed: number }> {
  const fx = await reindexFixtures(env);
  const dash = await reindexKb(env, await dashboardChunks(env));
  return { indexed: fx.indexed + dash.indexed };
}
