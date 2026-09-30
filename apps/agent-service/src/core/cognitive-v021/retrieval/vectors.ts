import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DerivedStore } from "./derived-store.js";

/**
 * A5 hybrid recall (decision 17): a local embedding tier beside BM25, so
 * "my sister" finds the memory that names her. Vectors are derived data in
 * the rebuildable derived index; the model runs on the host, so her memories
 * never leave the machine. Only live, non-secret memory statements are
 * embedded, and every hit still passes the audience fence in discover.ts.
 */

export type Embedder = {
  readonly model: string;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
};

export type QueryVector = { model: string; vector: Float32Array };

export const VECTOR_REFRESH_BATCH = 16;
export const VECTOR_CANDIDATES_MAX = 8;
/**
 * Cosine similarity below this is not a neighbour worth offering. Small
 * sentence models score real paraphrases around 0.25 against about 0.15 for
 * unrelated text; the candidate cap and the allocator bound the rest.
 */
export const VECTOR_MIN_SIMILARITY = 0.2;

type Row = Record<string, unknown>;

function ensureVectorSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors (
      assertion_key TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      vector BLOB NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
}

function contentHash(statement: string): string {
  return createHash("sha256").update(statement).digest("hex").slice(0, 32);
}

function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function fromBlob(value: unknown): Float32Array | null {
  if (!(value instanceof Uint8Array) || value.byteLength % 4 !== 0) return null;
  const copy = new Uint8Array(value);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

export function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    a += left[index]! * left[index]!;
    b += right[index]! * right[index]!;
  }
  return a === 0 || b === 0 ? 0 : dot / Math.sqrt(a * b);
}

/**
 * Bring the vector index up to date with live memory: embed what is new or
 * changed (bounded per call), drop what is no longer live or was forgotten.
 */
export async function refreshMemoryVectors(
  derived: DerivedStore,
  sidecar: DatabaseSync,
  embedder: Embedder,
  options: { nowMs: number; batch?: number },
): Promise<{ embedded: number; removed: number }> {
  ensureVectorSchema(derived.db);
  const live = new Map<string, string>();
  for (const row of sidecar.prepare(
    `SELECT assertion_key, statement FROM sidecar_memory_assertions
      WHERE live = 1 AND data_classification != 'secret'`,
  ).all() as Row[]) {
    if (typeof row.statement === "string" && row.statement.trim()) live.set(String(row.assertion_key), row.statement);
  }
  let removed = 0;
  for (const row of derived.db.prepare("SELECT assertion_key FROM memory_vectors").all() as Row[]) {
    const key = String(row.assertion_key);
    if (!live.has(key)) removed += Number(derived.db.prepare("DELETE FROM memory_vectors WHERE assertion_key = ?").run(key).changes);
  }
  const stored = new Map((derived.db.prepare("SELECT assertion_key, model, content_hash FROM memory_vectors").all() as Row[])
    .map((row) => [String(row.assertion_key), `${String(row.model)}:${String(row.content_hash)}`]));
  const pending = [...live.entries()]
    .filter(([key, statement]) => stored.get(key) !== `${embedder.model}:${contentHash(statement)}`)
    .slice(0, Math.max(1, options.batch ?? VECTOR_REFRESH_BATCH));
  if (pending.length === 0) return { embedded: 0, removed };
  const vectors = await embedder.embed(pending.map(([, statement]) => statement));
  const upsert = derived.db.prepare(
    `INSERT INTO memory_vectors (assertion_key, model, content_hash, vector, updated_at_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(assertion_key) DO UPDATE SET model = excluded.model, content_hash = excluded.content_hash,
       vector = excluded.vector, updated_at_ms = excluded.updated_at_ms`,
  );
  let embedded = 0;
  pending.forEach(([key, statement], index) => {
    const vector = vectors[index];
    if (!vector || vector.length === 0) return;
    upsert.run(key, embedder.model, contentHash(statement), toBlob(vector), options.nowMs);
    embedded += 1;
  });
  return { embedded, removed };
}

/** Nearest live memories to the query by cosine similarity, best first. */
export function vectorNeighbors(
  derived: DerivedStore,
  query: QueryVector,
  options: { limit?: number; minSimilarity?: number } = {},
): Array<{ assertionKey: string; similarity: number }> {
  ensureVectorSchema(derived.db);
  const minSimilarity = options.minSimilarity ?? VECTOR_MIN_SIMILARITY;
  const neighbors: Array<{ assertionKey: string; similarity: number }> = [];
  for (const row of derived.db.prepare("SELECT assertion_key, vector FROM memory_vectors WHERE model = ?").all(query.model) as Row[]) {
    const vector = fromBlob(row.vector);
    if (!vector) continue;
    const similarity = cosine(query.vector, vector);
    if (similarity >= minSimilarity) neighbors.push({ assertionKey: String(row.assertion_key), similarity });
  }
  return neighbors
    .sort((left, right) => right.similarity - left.similarity || left.assertionKey.localeCompare(right.assertionKey))
    .slice(0, Math.max(1, options.limit ?? VECTOR_CANDIDATES_MAX));
}

/**
 * The local embedder: a small sentence-embedding model run in-process
 * through transformers.js, loaded on first use from the local model cache.
 * Returns null when the runtime is not installed, so recall degrades to
 * lexical instead of failing.
 */
export async function loadLocalEmbedder(options: { model: string; cacheDir: string }): Promise<Embedder | null> {
  type PipelineFactory = (task: string, model: string, config: Record<string, unknown>) => Promise<unknown>;
  let pipelineFactory: PipelineFactory | null = null;
  try {
    const moduleName = "@huggingface/transformers";
    const transformers = await import(moduleName) as { pipeline: PipelineFactory; env: Record<string, unknown> };
    transformers.env.cacheDir = options.cacheDir;
    pipelineFactory = transformers.pipeline;
  } catch {
    return null;
  }
  if (!pipelineFactory) return null;
  const extractor = await pipelineFactory("feature-extraction", options.model, { dtype: "q8" }) as
    (texts: string[], config: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
  return {
    model: options.model,
    async embed(texts) {
      if (texts.length === 0) return [];
      const output = await extractor([...texts], { pooling: "mean", normalize: true });
      return output.tolist().map((values) => Float32Array.from(values));
    },
  };
}
