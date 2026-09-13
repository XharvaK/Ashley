import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  appendInboxEvent,
  type AppendInboxEventInput,
} from "../cycle/inbox.js";
import {
  appendOwnerUtterance,
  type AppendEvidenceInput,
} from "../evidence/conversation-log.js";
import {
  defaultUnclassifiedConversational,
  type DataClassification,
} from "../../privacy/classification.js";
import {
  detectCredentialShape,
} from "../../privacy/secrets.js";
import type {
  ConversationEvidenceRecord,
  DurableNomination,
  MemoryKind,
  EpistemicDimensions,
  RememberDirective,
} from "../types.js";
import { isMemoryKind } from "./kinds.js";

type DbRow = Record<string, unknown>;

export type DurableNominationRecord = DurableNomination & {
  admitted: boolean;
};

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

function json(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Canonical 11-member set lives in ./kinds.ts. This module keeps the final
// publication fence but must not duplicate or alias the value set.

function dimensions(value: unknown): EpistemicDimensions {
  const parsed = typeof value === "string" ? json(value, null) : value;
  if (!isRow(parsed)) throw new Error("nomination_dimensions_invalid");
  return parsed as EpistemicDimensions;
}

function classification(value: unknown): DataClassification {
  if (value === "ordinary" || value === "sensitive" || value === "never_public" || value === "secret") {
    return value;
  }
  return defaultUnclassifiedConversational();
}

function mapNomination(value: unknown): DurableNominationRecord | null {
  if (!isRow(value)) return null;
  const memoryKind = text(value.memory_kind) as MemoryKind;
  if (!isMemoryKind(memoryKind)) return null;
  let parsedDimensions: EpistemicDimensions;
  try {
    parsedDimensions = dimensions(value.dimensions_json);
  } catch {
    return null;
  }
  let sourceRefs: string[] | undefined;
  if (typeof (value as DbRow).source_refs_json === "string") {
    try {
      const parsed = JSON.parse(text((value as DbRow).source_refs_json));
      if (Array.isArray(parsed)) sourceRefs = parsed.filter((item): item is string => typeof item === "string");
    } catch {}
  }
  return {
    nominationId: text(value.nomination_id),
    cycleId: text(value.cycle_id),
    generation: number(value.generation),
    assertionKey: text(value.assertion_key),
    statement: text(value.statement),
    memoryKind,
    dimensions: parsedDimensions,
    dataClassification: classification(value.data_classification),
    supersedesAssertionKey: value.supersedes_assertion_key == null ? null : text(value.supersedes_assertion_key),
    concernId: value.concern_id == null ? null : text(value.concern_id),
    admitted: number(value.admitted) === 1,
    sourceRefs,
  };
}

function assertSafeNomination(nomination: DurableNomination): void {
  if (!nomination.nominationId.trim()) throw new Error("nomination_id_required");
  if (!nomination.cycleId.trim()) throw new Error("nomination_cycle_id_required");
  if (!nomination.assertionKey.trim()) throw new Error("nomination_assertion_key_required");
  if (!nomination.statement.trim()) throw new Error("nomination_statement_required");
  if (!isMemoryKind(nomination.memoryKind)) throw new Error("nomination_memory_kind_invalid");
  if (nomination.dataClassification === "secret" || detectCredentialShape(nomination.statement).hit) {
    throw new Error("secret_nomination_forbidden");
  }
}

/** Insert only the executive queue record. This function never creates Memory. */
export function enqueueDurableNomination(
  db: DatabaseSync,
  nomination: DurableNomination,
): DurableNominationRecord {
  assertSafeNomination(nomination);
  const sourceRefsJson = nomination.sourceRefs ? JSON.stringify(nomination.sourceRefs) : null;
  try {
    db.prepare(
      `INSERT OR IGNORE INTO durable_nominations
         (nomination_id, cycle_id, generation, assertion_key, statement, memory_kind,
          dimensions_json, data_classification, supersedes_assertion_key, concern_id, admitted, source_refs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      nomination.nominationId,
      nomination.cycleId,
      nomination.generation,
      nomination.assertionKey,
      nomination.statement,
      nomination.memoryKind,
      JSON.stringify(nomination.dimensions),
      nomination.dataClassification,
      nomination.supersedesAssertionKey,
      nomination.concernId,
      sourceRefsJson,
    );
  } catch {
    db.prepare(
      `INSERT OR IGNORE INTO durable_nominations
         (nomination_id, cycle_id, generation, assertion_key, statement, memory_kind,
          dimensions_json, data_classification, supersedes_assertion_key, concern_id, admitted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      nomination.nominationId,
      nomination.cycleId,
      nomination.generation,
      nomination.assertionKey,
      nomination.statement,
      nomination.memoryKind,
      JSON.stringify(nomination.dimensions),
      nomination.dataClassification,
      nomination.supersedesAssertionKey,
      nomination.concernId,
    );
  }
  const result = getDurableNomination(db, nomination.nominationId);
  if (!result) throw new Error("nomination_insert_lost");
  if (nomination.sourceRefs && !result.sourceRefs) {
    result.sourceRefs = nomination.sourceRefs;
  }
  return result;
}

export function enqueueDurableNominations(
  db: DatabaseSync,
  nominations: DurableNomination[],
): DurableNominationRecord[] {
  return nominations.map((nomination) => enqueueDurableNomination(db, nomination));
}

export function getDurableNomination(
  db: DatabaseSync,
  nominationId: string,
): DurableNominationRecord | null {
  return mapNomination(
    db.prepare("SELECT * FROM durable_nominations WHERE nomination_id = ?").get(nominationId),
  );
}

export function listDurableNominations(
  db: DatabaseSync,
  options: {
    admitted?: boolean;
    limit?: number;
    allowedKinds?: readonly MemoryKind[];
    /** Alias for callers that use the retrieval vocabulary. */
    memoryKinds?: readonly MemoryKind[];
  } = {},
): DurableNominationRecord[] {
  const limit = Math.max(1, Math.min(10_000, options.limit ?? 10_000));
  const allowedKinds = options.allowedKinds ?? options.memoryKinds;
  const conditions: string[] = [];
  const args: Array<string | number> = [];
  if (options.admitted != null) {
    conditions.push("admitted = ?");
    args.push(options.admitted ? 1 : 0);
  }
  if (allowedKinds !== undefined) {
    if (allowedKinds.length === 0) return [];
    conditions.push(`memory_kind IN (${allowedKinds.map(() => "?").join(",")})`);
    args.push(...allowedKinds);
  }
  args.push(limit);
  const rows = db.prepare(
    `SELECT * FROM durable_nominations
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY generation ASC, nomination_id ASC LIMIT ?`,
  ).all(...args);
  return rows.map(mapNomination).filter((row): row is DurableNominationRecord => row !== null);
}

/** `/remember` carries only durable evidence references into the inbox. */
export function createRememberDirective(
  evidence: ConversationEvidenceRecord,
): RememberDirective {
  return {
    rememberRequested: true,
    evidenceLineageId: evidence.lineageId,
    evidenceRowId: evidence.rowId,
    dataClassification: evidence.dataClassification,
  };
}

export type AppendRememberRequestInput = Omit<AppendEvidenceInput, "text"> & {
  text: string;
  inboxId?: string;
  inboxKind?: string;
};

export type AppendRememberRequestResult = {
  evidence: ConversationEvidenceRecord;
  directive: RememberDirective;
  inbox: ReturnType<typeof appendInboxEvent>;
};

/** Append evidence and a reference-only owner intent event. */
export function appendRememberRequest(
  db: DatabaseSync,
  input: AppendRememberRequestInput,
): AppendRememberRequestResult {
  const evidence = appendOwnerUtterance(db, input);
  const directive = createRememberDirective(evidence);
  const inboxInput: AppendInboxEventInput = {
    id: input.inboxId,
    conversationId: input.conversationId,
    kind: input.inboxKind ?? "owner_message",
    payload: directive,
    createdAtMs: input.nowMs,
  };
  return { evidence, directive, inbox: appendInboxEvent(db, inboxInput) };
}

export const appendRememberDirective = appendRememberRequest;

export function memoryKindIsLearnedSelf(kind: MemoryKind): boolean {
  return kind === "learned_self_evidence";
}

export function newNominationId(): string {
  return randomUUID();
}
