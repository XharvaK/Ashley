import type { DatabaseSync } from "node:sqlite";
import { getMemoryContractState } from "./contract-state.js";
import { influenceEligibleUnderAssertionsAt } from "./eligibility.js";
import type { MemoryMessage } from "./threads.js";

export type MemoryContextRole =
  | "current_source_evidence"
  | "historical_source_evidence"
  | "corrected_source_evidence";

export type MemoryContextAnnotation = {
  memory_context_role: MemoryContextRole;
  memory_assertion_ids: number[];
  memory_correction_ids: number[];
};

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? value as Row : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function c1CurrentnessAuthority(db: DatabaseSync): boolean {
  return getMemoryContractState(db)?.currentnessAuthority === "memory_assertions";
}

function correctionIdsForAssertions(
  db: DatabaseSync,
  assertionIds: number[],
): number[] {
  if (assertionIds.length === 0) return [];
  const placeholders = assertionIds.map(() => "?").join(", ");
  return db.prepare(
    `SELECT DISTINCT c.id
     FROM memory_corrections AS c
     JOIN memory_correction_targets AS t ON t.correction_id = c.id
     WHERE t.assertion_id IN (${placeholders})
     ORDER BY c.id ASC`,
  ).all(...assertionIds)
    .map(asRow)
    .filter((row): row is Row => row !== null)
    .map((row) => numberValue(row.id));
}

function correctionIdsForMessage(
  db: DatabaseSync,
  ownerId: string,
  messageId: number,
): number[] {
  return db.prepare(
    `SELECT id FROM memory_corrections
     WHERE owner_id = ? AND source_message_id = ?
     ORDER BY id ASC`,
  ).all(ownerId, messageId)
    .map(asRow)
    .filter((row): row is Row => row !== null)
    .map((row) => numberValue(row.id));
}

function correctionHasCommittedEffect(
  db: DatabaseSync,
  correctionIds: number[],
): boolean {
  if (correctionIds.length === 0) return false;
  const placeholders = correctionIds.map(() => "?").join(", ");
  return db.prepare(
    `SELECT 1 FROM memory_corrections
     WHERE id IN (${placeholders})
       AND (barrier_id IS NOT NULL OR lifecycle_status IN ('applying', 'applied'))
     LIMIT 1`,
  ).get(...correctionIds) !== undefined;
}

export function annotationForAssertionUnderAssertions(
  db: DatabaseSync,
  ownerId: string,
  assertionId: number,
): MemoryContextAnnotation | null {
  const row = asRow(db.prepare(
    `SELECT id, termination_reason
     FROM memory_assertions
     WHERE owner_id = ? AND id = ? LIMIT 1`,
  ).get(ownerId, assertionId));
  if (!row) return null;
  const id = numberValue(row.id);
  const correctionIds = correctionIdsForAssertions(db, [id]);
  const corrected = row.termination_reason != null ||
    correctionHasCommittedEffect(db, correctionIds);
  return {
    memory_context_role: corrected
      ? "corrected_source_evidence"
      : influenceEligibleUnderAssertionsAt(db, id)
        ? "current_source_evidence"
        : "historical_source_evidence",
    memory_assertion_ids: [id],
    memory_correction_ids: corrected ? correctionIds : [],
  };
}

export function annotationForAssertion(
  db: DatabaseSync,
  ownerId: string,
  assertionId: number,
): MemoryContextAnnotation | null {
  if (!c1CurrentnessAuthority(db)) return null;
  return annotationForAssertionUnderAssertions(db, ownerId, assertionId);
}

export function annotationForMessageUnderAssertions(
  db: DatabaseSync,
  ownerId: string,
  messageId: number,
): MemoryContextAnnotation {
  const assertionRows = db.prepare(
    `SELECT id, termination_reason
     FROM memory_assertions
     WHERE owner_id = ? AND source_message_id = ?
     ORDER BY id ASC`,
  ).all(ownerId, messageId)
    .map(asRow)
    .filter((row): row is Row => row !== null);
  const assertionIds = assertionRows.map((row) => numberValue(row.id));
  const correctionIds = [
    ...correctionIdsForAssertions(db, assertionIds),
    ...correctionIdsForMessage(db, ownerId, messageId),
  ].filter((id, index, all) => all.indexOf(id) === index);
  const terminated = assertionRows.some((row) => row.termination_reason != null);
  const corrected = terminated || correctionHasCommittedEffect(db, correctionIds);
  const eligible = assertionIds.some((id) => influenceEligibleUnderAssertionsAt(db, id));
  return {
    memory_context_role: corrected
      ? "corrected_source_evidence"
      : eligible ? "current_source_evidence" : "historical_source_evidence",
    memory_assertion_ids: assertionIds,
    memory_correction_ids: corrected ? correctionIds : [],
  };
}

export function annotationForMessage(
  db: DatabaseSync,
  ownerId: string,
  messageId: number,
): MemoryContextAnnotation | null {
  if (!c1CurrentnessAuthority(db)) return null;
  return annotationForMessageUnderAssertions(db, ownerId, messageId);
}

export function annotationForFactUnderAssertions(
  db: DatabaseSync,
  ownerId: string,
  factId: number,
): MemoryContextAnnotation {
  const rows = db.prepare(
    `SELECT id, termination_reason
     FROM memory_assertions
     WHERE owner_id = ? AND legacy_fact_id = ?
     ORDER BY id ASC`,
  ).all(ownerId, factId)
    .map(asRow)
    .filter((row): row is Row => row !== null);
  if (rows.length === 0) return {
    memory_context_role: "historical_source_evidence",
    memory_assertion_ids: [],
    memory_correction_ids: [],
  };
  const assertionIds = rows.map((row) => numberValue(row.id));
  const correctionIds = correctionIdsForAssertions(db, assertionIds);
  const corrected = rows.some((row) => row.termination_reason != null) ||
    correctionHasCommittedEffect(db, correctionIds);
  const eligible = assertionIds.some((id) => influenceEligibleUnderAssertionsAt(db, id));
  return {
    memory_context_role: corrected
      ? "corrected_source_evidence"
      : eligible ? "current_source_evidence" : "historical_source_evidence",
    memory_assertion_ids: assertionIds,
    memory_correction_ids: corrected ? correctionIds : [],
  };
}

export function annotationForFact(
  db: DatabaseSync,
  ownerId: string,
  factId: number,
): MemoryContextAnnotation | null {
  if (!c1CurrentnessAuthority(db)) return null;
  return annotationForFactUnderAssertions(db, ownerId, factId);
}

export function annotateHotMessage(
  db: DatabaseSync,
  message: MemoryMessage,
): MemoryMessage {
  const annotation = annotationForMessage(db, message.ownerId, message.id);
  if (!annotation) return message;
  return { ...message, ...annotation };
}

export function renderMemoryContextMessage(
  message: Pick<MemoryMessage, "role" | "text" | "memory_context_role" | "memory_assertion_ids" | "memory_correction_ids">,
): string {
  if (!message.memory_context_role) return `${message.role}: ${message.text}`;
  const assertions = message.memory_assertion_ids?.join(",") || "none";
  const corrections = message.memory_correction_ids?.join(",") || "none";
  return `${message.role}: [memory_context_role=${message.memory_context_role}; assertion_ids=${assertions}; correction_ids=${corrections}] ${message.text}`;
}
