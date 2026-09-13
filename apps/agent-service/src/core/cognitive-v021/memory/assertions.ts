import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  canEnterModelContext,
  maxClassification,
  defaultUnclassifiedConversational,
  type DataClassification,
} from "../../privacy/classification.js";
import type {
  AssertionKey,
  EpistemicDimensions,
  MemoryAssertion,
  MemoryKind,
} from "../types.js";
import { isMemoryKind } from "./kinds.js";
import { CREDENTIAL_OMITTED_PLACEHOLDER } from "../../privacy/secrets.js";
import { notifySidecarPostCommit } from "../retrieval/derived-store.js";

type DbRow = Record<string, unknown>;

export const REDACTED_MEMORY_STATEMENT = "[redacted]" as const;

// Canonical 11-member set lives in ./kinds.ts. This module keeps the
// assertion fence but must not duplicate or alias the value set.

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function json(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function classification(value: unknown): DataClassification {
  return value === "ordinary" || value === "sensitive" || value === "never_public" || value === "secret"
    ? value
    : defaultUnclassifiedConversational();
}

function mapAssertion(value: unknown): MemoryAssertion | null {
  if (!isRow(value)) return null;
  const kind = text(value.memory_kind) as MemoryKind;
  const dimensions = json(value.dimensions_json);
  if (!isMemoryKind(kind) || !dimensions || typeof value.assertion_key !== "string") return null;
  return {
    assertionKey: text(value.assertion_key),
    statement: text(value.statement),
    memoryKind: kind,
    dimensions: dimensions as EpistemicDimensions,
    dataClassification: classification(value.data_classification),
    lineageParentKey: value.lineage_parent_key == null ? null : text(value.lineage_parent_key),
    admittedGeneration: value.admitted_generation == null ? null : number(value.admitted_generation),
    live: number(value.live) === 1,
  };
}

export function hashMemoryAssertion(input: Pick<MemoryAssertion, "assertionKey" | "statement" | "memoryKind" | "dimensions" | "dataClassification" | "lineageParentKey" | "admittedGeneration" | "live">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      assertionKey: input.assertionKey,
      statement: input.statement,
      memoryKind: input.memoryKind,
      dimensions: input.dimensions,
      dataClassification: input.dataClassification,
      lineageParentKey: input.lineageParentKey,
      admittedGeneration: input.admittedGeneration,
      live: input.live,
    }), "utf8")
    .digest("hex");
}

export type UpsertMemoryAssertionInput = {
  assertionKey: AssertionKey;
  statement: string;
  memoryKind: MemoryKind;
  dimensions: EpistemicDimensions;
  dataClassification: DataClassification;
  lineageParentKey: AssertionKey | null;
  admittedGeneration: number | null;
  live: boolean;
};

function assertWritable(input: UpsertMemoryAssertionInput): void {
  if (!input.assertionKey.trim()) throw new Error("memory_assertion_key_required");
  if (!input.statement.trim()) throw new Error("memory_assertion_statement_required");
  if (!isMemoryKind(input.memoryKind)) throw new Error("memory_assertion_kind_invalid");
  if (input.dataClassification === "secret" &&
      input.statement !== CREDENTIAL_OMITTED_PLACEHOLDER &&
      input.statement !== REDACTED_MEMORY_STATEMENT) {
    throw new Error("secret_memory_assertion_forbidden");
  }
  if (input.live && input.admittedGeneration == null) throw new Error("live_memory_assertion_generation_required");
}

/** Internal v021 admission writer. It is intentionally not connected to legacy mem_facts. */
export function upsertMemoryAssertion(
  db: DatabaseSync,
  input: UpsertMemoryAssertionInput,
): MemoryAssertion {
  assertWritable(input);
  const existing = getMemoryAssertion(db, input.assertionKey);
  const effectiveClassification = maxClassification(existing?.dataClassification, input.dataClassification);
  const effective: UpsertMemoryAssertionInput = existing
    ? {
        ...input,
        statement: input.statement,
        dataClassification: effectiveClassification,
        lineageParentKey: input.lineageParentKey ?? existing.lineageParentKey,
        admittedGeneration: input.live ? input.admittedGeneration ?? existing.admittedGeneration : null,
        live: input.live,
      }
    : { ...input, dataClassification: effectiveClassification };
  const contentHash = hashMemoryAssertion({ ...effective });
  db.prepare(
    `INSERT INTO sidecar_memory_assertions
       (assertion_key, statement, memory_kind, dimensions_json, data_classification,
        lineage_parent_key, admitted_generation, live, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(assertion_key) DO UPDATE SET
       statement=excluded.statement,
       memory_kind=excluded.memory_kind,
       dimensions_json=excluded.dimensions_json,
       data_classification=excluded.data_classification,
       lineage_parent_key=excluded.lineage_parent_key,
       admitted_generation=excluded.admitted_generation,
       live=excluded.live,
       content_hash=excluded.content_hash`,
  ).run(
    effective.assertionKey,
    effective.statement,
    effective.memoryKind,
    JSON.stringify(effective.dimensions),
    effective.dataClassification,
    effective.lineageParentKey,
    effective.admittedGeneration,
    effective.live ? 1 : 0,
    contentHash,
  );
  const result = getMemoryAssertion(db, effective.assertionKey);
  if (!result) throw new Error("memory_assertion_upsert_lost");
  return result;
}

export function getMemoryAssertion(db: DatabaseSync, assertionKey: AssertionKey): MemoryAssertion | null {
  return mapAssertion(db.prepare("SELECT * FROM sidecar_memory_assertions WHERE assertion_key = ?").get(assertionKey));
}

export function listMemoryAssertions(
  db: DatabaseSync,
  options: { live?: boolean; memoryKinds?: MemoryKind[]; modelContext?: boolean; limit?: number } = {},
): MemoryAssertion[] {
  const conditions: string[] = [];
  const args: Array<string | number> = [];
  if (options.live != null) { conditions.push("live = ?"); args.push(options.live ? 1 : 0); }
  if (options.memoryKinds && options.memoryKinds.length > 0) {
    conditions.push(`memory_kind IN (${options.memoryKinds.map(() => "?").join(",")})`);
    args.push(...options.memoryKinds);
  }
  const limit = Math.max(1, Math.min(10_000, options.limit ?? 10_000));
  args.push(limit);
  const rows = db.prepare(
    `SELECT * FROM sidecar_memory_assertions
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY assertion_key ASC LIMIT ?`,
  ).all(...args);
  return rows.map(mapAssertion)
    .filter((row): row is MemoryAssertion => row !== null)
    .filter((row) => options.modelContext !== true || canEnterModelContext(row.dataClassification, "private"));
}

export function listLiveMemoryAssertions(db: DatabaseSync): MemoryAssertion[] {
  return listMemoryAssertions(db, { live: true, modelContext: true });
}

export function retractMemoryAssertion(db: DatabaseSync, assertionKey: AssertionKey): boolean {
  const result = db.prepare(
    `UPDATE sidecar_memory_assertions
        SET live = 0, admitted_generation = NULL, statement = ?,
            content_hash = ?
      WHERE assertion_key = ?`,
  ).run(REDACTED_MEMORY_STATEMENT, hashMemoryAssertion({
    assertionKey,
    statement: REDACTED_MEMORY_STATEMENT,
    memoryKind: "open_question",
    dimensions: {
      source: "prior_settlement",
      status: "superseded",
      time: "unknown_freshness",
      reliability: "unavailable_source",
    },
    dataClassification: "never_public",
    lineageParentKey: null,
    admittedGeneration: null,
    live: false,
  }), assertionKey);
  const changed = Number(result.changes) === 1;
  if (changed) {
    try {
      notifySidecarPostCommit(db, { changedAssertionKeys: [assertionKey] });
    } catch {
      // Derived sync failures must never disturb authoritative sidecar commit
    }
  }
  return changed;
}

export const listAssertions = listMemoryAssertions;
