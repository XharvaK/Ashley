import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  readAuthorityBarrier,
  type CanonicalOwner,
} from "./barrier.js";
import {
  advanceCanonicalOwnerVersionInTransaction,
  readCanonicalOwnerVersion,
} from "./version-vector.js";

export type DerivedInvalidationKind = "forget" | "redaction" | "source_change";
export type DerivedJournalState = "pending" | "leased" | "applied" | "quarantined";

export type DerivedInvalidationJournalEntry = Readonly<{
  changeId: string;
  ownerId: string;
  conversationId: string | null;
  sourceRefs: readonly string[];
  invalidationKind: DerivedInvalidationKind;
  canonicalOwner: CanonicalOwner;
  canonicalVersion: number;
  targetGeneration: number;
  state: DerivedJournalState;
}>;

type Row = Record<string, unknown>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseRefs(value: unknown): string[] {
  try {
    const parsed = JSON.parse(text(value, "[]"));
    if (!Array.isArray(parsed)) throw new Error("not_array");
    return [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0))];
  } catch {
    throw new Error("derived_journal_source_refs_invalid");
  }
}

function mapEntry(value: unknown): DerivedInvalidationJournalEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Row;
  const kind = text(row.invalidation_kind) as DerivedInvalidationKind;
  const state = text(row.state) as DerivedJournalState;
  if (!(["forget", "redaction", "source_change"] as string[]).includes(kind)) return null;
  if (!(["pending", "leased", "applied", "quarantined"] as string[]).includes(state)) return null;
  const owner = text(row.canonical_owner) as CanonicalOwner;
  if (!(["nuclear", "continuity", "cognitive_sidecar"] as string[]).includes(owner)) return null;
  return {
    changeId: text(row.change_id),
    ownerId: text(row.owner_id),
    conversationId: row.conversation_id == null ? null : text(row.conversation_id),
    sourceRefs: parseRefs(row.source_refs_json),
    invalidationKind: kind,
    canonicalOwner: owner,
    canonicalVersion: number(row.canonical_version),
    targetGeneration: number(row.target_generation),
    state,
  };
}

function validateInput(input: {
  changeId?: string;
  ownerId: string;
  conversationId?: string | null;
  sourceRefs: readonly string[];
  invalidationKind: DerivedInvalidationKind;
  canonicalOwner: CanonicalOwner;
  targetGeneration: number;
}): void {
  if (!input.ownerId.trim()) throw new Error("derived_journal_owner_required");
  if (input.changeId !== undefined && !input.changeId.trim()) throw new Error("derived_journal_change_required");
  if (!Number.isInteger(input.targetGeneration) || input.targetGeneration < 0) {
    throw new Error("derived_journal_generation_invalid");
  }
  if (input.sourceRefs.some((ref) => !ref.trim())) throw new Error("derived_journal_source_ref_invalid");
}

/**
 * Append a canonical invalidation entry while the nuclear coordinator is in
 * its transition transaction. The owner-version advance and journal insert
 * are one SQLite commit.
 */
export function recordDerivedInvalidationInTransaction(input: {
  db: DatabaseSync;
  changeId?: string;
  ownerId: string;
  conversationId?: string | null;
  sourceRefs: readonly string[];
  invalidationKind: DerivedInvalidationKind;
  canonicalOwner: CanonicalOwner;
  targetGeneration: number;
  nowMs: number;
}): DerivedInvalidationJournalEntry {
  validateInput(input);
  const barrier = readAuthorityBarrier(input.db);
  if (barrier.state !== "transitioning" && barrier.state !== "reconciling") {
    throw new Error("authority_transition_required");
  }
  const changeId = input.changeId ?? `derived-change:${randomUUID()}`;
  const existing = input.db.prepare(
    "SELECT * FROM derived_invalidation_journal WHERE change_id = ?",
  ).get(changeId);
  if (existing) {
    const mapped = mapEntry(existing);
    if (!mapped) throw new Error("derived_journal_existing_invalid");
    if (mapped.ownerId !== input.ownerId || mapped.invalidationKind !== input.invalidationKind) {
      throw new Error("derived_journal_change_collision");
    }
    return mapped;
  }

  const canonicalVersion = advanceCanonicalOwnerVersionInTransaction(
    input.db,
    input.canonicalOwner,
    changeId,
    input.nowMs,
  );
  input.db.prepare(
    `INSERT INTO derived_invalidation_journal
       (change_id, owner_id, conversation_id, source_refs_json,
        invalidation_kind, canonical_owner, canonical_version, target_generation,
        state, attempts, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  ).run(
    changeId,
    input.ownerId,
    input.conversationId ?? null,
    JSON.stringify([...new Set(input.sourceRefs)]),
    input.invalidationKind,
    input.canonicalOwner,
    canonicalVersion,
    input.targetGeneration,
    input.nowMs,
    input.nowMs,
  );
  const result = mapEntry(input.db.prepare(
    "SELECT * FROM derived_invalidation_journal WHERE change_id = ?",
  ).get(changeId));
  if (!result) throw new Error("derived_journal_insert_lost");
  return result;
}

export function listPendingDerivedInvalidations(
  db: DatabaseSync,
): DerivedInvalidationJournalEntry[] {
  return (db.prepare(
    `SELECT * FROM derived_invalidation_journal
      WHERE state IN ('pending', 'leased')
      ORDER BY created_at_ms ASC, change_id ASC`,
  ).all() as unknown[]).flatMap((value) => {
    const mapped = mapEntry(value);
    return mapped ? [mapped] : [];
  });
}

export function hasPendingDerivedInvalidation(
  db: DatabaseSync,
  sourceRef?: string,
  conversationId?: string | null,
  ignoredChangeId?: string,
): boolean {
  const rows = listPendingDerivedInvalidations(db);
  return rows.some((entry) => {
    if (ignoredChangeId && entry.changeId === ignoredChangeId) return false;
    if (conversationId != null && entry.conversationId != null && entry.conversationId !== conversationId) return false;
    return sourceRef == null || entry.sourceRefs.includes(sourceRef);
  });
}

export function markDerivedInvalidationApplied(
  db: DatabaseSync,
  changeId: string,
  nowMs: number,
): boolean {
  const result = db.prepare(
    `UPDATE derived_invalidation_journal
        SET state = 'applied', lease_owner = NULL, lease_expires_at_ms = NULL,
            updated_at_ms = ?
      WHERE change_id = ? AND state IN ('pending', 'leased')`,
  ).run(nowMs, changeId);
  return Number(result.changes) === 1;
}

export function markDerivedInvalidationQuarantined(
  db: DatabaseSync,
  changeId: string,
  errorCode: string,
  nowMs: number,
): boolean {
  const result = db.prepare(
    `UPDATE derived_invalidation_journal
        SET state = 'quarantined', last_error_code = ?,
            lease_owner = NULL, lease_expires_at_ms = NULL, updated_at_ms = ?
      WHERE change_id = ? AND state IN ('pending', 'leased')`,
  ).run(errorCode, nowMs, changeId);
  return Number(result.changes) === 1;
}

export function readDerivedInvalidation(
  db: DatabaseSync,
  changeId: string,
): DerivedInvalidationJournalEntry | null {
  return mapEntry(db.prepare(
    "SELECT * FROM derived_invalidation_journal WHERE change_id = ?",
  ).get(changeId));
}

export { readCanonicalOwnerVersion };
