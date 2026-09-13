import type { DatabaseSync } from "node:sqlite";
import {
  listPendingDerivedInvalidations,
  markDerivedInvalidationApplied,
  markDerivedInvalidationQuarantined,
  type DerivedInvalidationJournalEntry,
} from "../authority/journal.js";
import { DerivedStore } from "./derived-store.js";

export type DerivedRetractionResult = Readonly<{
  processed: number;
  applied: number;
  quarantined: number;
  failed: number;
  changes: Array<{
    changeId: string;
    state: "applied" | "quarantined" | "failed";
    errorCode?: string;
  }>;
}>;

function claim(
  db: DatabaseSync,
  entry: DerivedInvalidationJournalEntry,
  workerId: string,
  nowMs: number,
  leaseMs: number,
): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(
      `UPDATE derived_invalidation_journal
          SET state = 'leased', lease_owner = ?,
              lease_expires_at_ms = ?, attempts = attempts + 1,
              updated_at_ms = ?
        WHERE change_id = ? AND state IN ('pending', 'leased')
          AND (state = 'pending' OR lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)`,
    ).run(workerId, nowMs + leaseMs, nowMs, entry.changeId, nowMs);
    db.exec("COMMIT");
    return Number(result.changes) === 1;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve claim error */ }
    throw error;
  }
}
/**
 * Consume canonical invalidation entries after the source mutation has
 * committed. The derived store is rebuilt into a new generation before the
 * journal entry is marked applied. Physical stale rows are never used as
 * semantic evidence while the entry is pending.
 */
export function reconcileDerivedInvalidationJournal(
  authorityDb: DatabaseSync,
  sidecarDb: DatabaseSync,
  derivedStore: DerivedStore,
  options: { workerId?: string; nowMs?: number; leaseMs?: number } = {},
): DerivedRetractionResult {
  const nowMs = options.nowMs ?? Date.now();
  const workerId = options.workerId ?? `derived-reconciler:${process.pid}`;
  const leaseMs = Math.max(1_000, options.leaseMs ?? 60_000);
  const result = {
    processed: 0,
    applied: 0,
    quarantined: 0,
    failed: 0,
    changes: [] as DerivedRetractionResult["changes"],
  };

  for (const entry of listPendingDerivedInvalidations(authorityDb)) {
    if (!claim(authorityDb, entry, workerId, nowMs, leaseMs)) continue;
    result.processed += 1;
    try {
      const rebuilt = derivedStore.reconcile(sidecarDb, {
        authorityDb,
        conversationId: entry.conversationId,
        ignoreJournalChangeId: entry.changeId,
      });
      if (!rebuilt) throw new Error("derived_rebuild_failed");
      const applied = markDerivedInvalidationApplied(authorityDb, entry.changeId, nowMs);
      if (!applied) throw new Error("derived_journal_apply_race");
      result.applied += 1;
      result.changes.push({ changeId: entry.changeId, state: "applied" });
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "derived_reconcile_failed";
      const quarantined = errorCode === "derived_source_poison";
      if (quarantined) {
        markDerivedInvalidationQuarantined(authorityDb, entry.changeId, errorCode, nowMs);
        result.quarantined += 1;
        result.changes.push({ changeId: entry.changeId, state: "quarantined", errorCode });
      } else {
        result.failed += 1;
        result.changes.push({ changeId: entry.changeId, state: "failed", errorCode });
      }
    }
  }
  return result;
}
