import type { DatabaseSync } from "node:sqlite";
import { resolveEvidenceRefs } from "../agency/resolve-evidence.js";
import { getAssertion, type TerminationReason } from "./assertions.js";
import {
  getCorrection,
  getCorrectionReceipt,
  listCorrectionTargets,
  type CorrectionReceipt,
  type CorrectionTarget,
  type MemoryCorrection,
} from "./corrections.js";
import { getDenyBarrier } from "./barriers.js";
import { factInfluenceEligibleAt, listActiveFacts } from "./facts.js";
import {
  episodeInfluenceEligibleAt,
  influenceEligibleAt,
  mindStateItemInfluenceEligibleAt,
} from "./eligibility.js";
import { getMemoryContractState } from "./contract-state.js";
import { recomputeSharedCulture } from "../relationship/projections.js";

export type CorrectionOutcomeErrorKind =
  | "stale_persistence"
  | "original_inference_error"
  | "provenance_error"
  | "overgeneralization"
  | "unknown";

export type CorrectionOutcome = {
  correctionId: number;
  class: MemoryCorrection["class"];
  ashleyErrorKind: CorrectionOutcomeErrorKind;
  createdAt: string;
};

export type CorrectionReadback = {
  ok: boolean;
  checkedAssertionIds: number[];
  blockedAssertionIds: number[];
  failedAssertionIds: number[];
  failedConsumerRefs: string[];
};

export type CorrectionFanoutOptions = {
  now?: string;
  /** Test-only crash injection after a durable per-target fan-out commit. */
  testFailAfterTargets?: number;
};

export type CorrectionFanoutResult = {
  correction: MemoryCorrection;
  receipt: CorrectionReceipt;
  outcome: CorrectionOutcome | null;
  readback: CorrectionReadback;
  processedTargetCount: number;
  reconciliationRequestCount: number;
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

function withTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* preserve the original fan-out error */
    }
    throw error;
  }
}

function terminationForClass(
  correctionClass: MemoryCorrection["class"],
): TerminationReason | null {
  switch (correctionClass) {
    case "TEMPORAL_SUPERSESSION":
      return "superseded";
    case "INTERPRETATION_INVALIDATION":
      return "invalidated";
    case "PROVENANCE_CORRECTION":
      return "source_disputed";
    case "SCOPE_REFINEMENT":
      return "scope_refined";
    case "unclassified":
      return null;
  }
}

function outcomeKind(
  correctionClass: MemoryCorrection["class"],
): CorrectionOutcomeErrorKind {
  switch (correctionClass) {
    case "TEMPORAL_SUPERSESSION":
      return "stale_persistence";
    case "INTERPRETATION_INVALIDATION":
      return "original_inference_error";
    case "PROVENANCE_CORRECTION":
      return "provenance_error";
    case "SCOPE_REFINEMENT":
      return "overgeneralization";
    case "unclassified":
      return "unknown";
  }
}

function requestedAction(consumerKind: string): string {
  switch (consumerKind) {
    case "motivation":
      return "consider_drop";
    case "episode_claim":
    case "fts_episode":
      return "consider_rebuild";
    case "mind_state_item":
    case "open_cognitive_item":
    case "learning_revision":
    case "relationship_target":
    case "cur_take":
      return "consider_review";
    default:
      return "consider_reconcile";
  }
}

function markReceiptFailed(db: DatabaseSync, correctionId: number): void {
  withTransaction(db, () => {
    db.prepare(
      `UPDATE memory_correction_receipts
       SET fanout_state = 'failed', readback_ok = 0, completed_at = NULL
       WHERE correction_id = ?`,
    ).run(correctionId);
  });
}

function ensurePendingReceipt(
  db: DatabaseSync,
  correction: MemoryCorrection,
  sequenceHigh: number,
): CorrectionReceipt {
  const existing = getCorrectionReceipt(db, correction.id);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO memory_correction_receipts
       (correction_id, barrier_committed, fanout_state, readback_ok,
        barrier_membership_seq_high, completed_at)
     VALUES (?, ?, 'pending', 0, ?, NULL)`,
  ).run(correction.id, correction.barrierId == null ? 0 : 1, sequenceHigh);
  const receipt = getCorrectionReceipt(db, correction.id);
  if (!receipt) throw new Error("memory_correction_receipt_unavailable");
  return receipt;
}

function reconciliationRequestsFor(
  db: DatabaseSync,
  correctionId: number,
  assertionId: number,
): number {
  const links = db.prepare(
    `SELECT consumer_kind, consumer_id
     FROM memory_derivation_links WHERE assertion_id = ?`,
  ).all(assertionId)
    .map(asRow)
    .filter((row): row is Row => row !== null);
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO memory_reconciliation_requests
       (correction_id, consumer_kind, consumer_id, requested_action,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  );
  let count = 0;
  for (const link of links) {
    const result = insert.run(
      correctionId,
      stringValue(link.consumer_kind),
      numberValue(link.consumer_id),
      requestedAction(stringValue(link.consumer_kind)),
      now,
      now,
    );
    count += Number(result.changes);
  }
  return count;
}

function applyTarget(
  db: DatabaseSync,
  correction: MemoryCorrection,
  target: CorrectionTarget,
): { applied: boolean; reconciliationRequestCount: number } {
  const assertion = getAssertion(db, target.assertionId);
  if (!assertion) throw new Error(`memory_assertion_missing:${target.assertionId}`);
  if (target.applicationState === "applied" || target.applicationState === "skipped") {
    return { applied: false, reconciliationRequestCount: 0 };
  }
  const reason = terminationForClass(correction.class);
  if (reason === null) throw new Error("memory_correction_adjudication_required");

  // C1 must not rewrite independent external facts or Ashley-side identity.
  // The correction remains inspectable and its target is recorded as skipped.
  if (assertion.subjectFacet === "external_verifiable" || assertion.subjectFacet === "ashley_side") {
    db.prepare(
      `UPDATE memory_correction_targets
       SET application_state = 'skipped'
       WHERE correction_id = ? AND assertion_id = ?`,
    ).run(correction.id, target.assertionId);
    return { applied: false, reconciliationRequestCount: 0 };
  }

  if (assertion.terminationReason !== null) {
    db.prepare(
      `UPDATE memory_correction_targets
       SET application_state = 'applied'
       WHERE correction_id = ? AND assertion_id = ?`,
    ).run(correction.id, target.assertionId);
    return {
      applied: true,
      reconciliationRequestCount: reconciliationRequestsFor(db, correction.id, target.assertionId),
    };
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE memory_assertions
     SET termination_reason = ?,
         authority_to = CASE
           WHEN authority_to IS NULL OR authority_to > ? THEN ?
           ELSE authority_to END,
         updated_at = ?
     WHERE id = ? AND termination_reason IS NULL`,
  ).run(reason, now, now, now, target.assertionId);
  db.prepare(
    `UPDATE memory_correction_targets
     SET application_state = 'applied'
     WHERE correction_id = ? AND assertion_id = ?`,
  ).run(correction.id, target.assertionId);
  return {
    applied: true,
    reconciliationRequestCount: reconciliationRequestsFor(db, correction.id, target.assertionId),
  };
}

function readBack(
  db: DatabaseSync,
  correction: MemoryCorrection,
  targets: CorrectionTarget[],
): CorrectionReadback {
  const checkedAssertionIds: number[] = [];
  const blockedAssertionIds: number[] = [];
  const failedAssertionIds: number[] = [];
  const failedConsumerRefs: string[] = [];
  for (const target of targets) {
    if (target.applicationState === "skipped") continue;
    checkedAssertionIds.push(target.assertionId);
    if (!influenceEligibleAt(db, target.assertionId)) {
      blockedAssertionIds.push(target.assertionId);
    } else {
      failedAssertionIds.push(target.assertionId);
    }
    const assertion = getAssertion(db, target.assertionId);
    if (!assertion) {
      failedAssertionIds.push(target.assertionId);
      continue;
    }
    if (assertion.legacyFactId != null) {
      if (factInfluenceEligibleAt(db, correction.ownerId, assertion.legacyFactId) ||
          listActiveFacts(db, correction.ownerId).some((fact) => fact.id === assertion.legacyFactId) ||
          resolveEvidenceRefs(db, correction.ownerId, [{ type: "fact", id: assertion.legacyFactId }]).length > 0) {
        failedConsumerRefs.push(`fact:${assertion.legacyFactId}`);
      }
    }
    if (assertion.legacyEpisodeId != null) {
      if (episodeInfluenceEligibleAt(db, correction.ownerId, assertion.legacyEpisodeId) ||
          resolveEvidenceRefs(db, correction.ownerId, [{ type: "episode", id: assertion.legacyEpisodeId }])
            .some((line) => line.memory_assertion_ids?.includes(assertion.id))) {
        failedConsumerRefs.push(`episode:${assertion.legacyEpisodeId}`);
      }
    }
    const links = db.prepare(
      `SELECT consumer_kind, consumer_id
       FROM memory_derivation_links WHERE assertion_id = ?`,
    ).all(assertion.id).map(asRow).filter((row): row is Row => row !== null);
    for (const link of links) {
      const kind = stringValue(link.consumer_kind);
      const id = numberValue(link.consumer_id);
      if (kind === "mind_state_item" && mindStateItemInfluenceEligibleAt(db, correction.ownerId, id)) {
        failedConsumerRefs.push(`${kind}:${id}`);
      }
      if (kind === "episode_claim" && resolveEvidenceRefs(db, correction.ownerId, [{
        type: "episode",
        id,
      }]).some((line) => line.memory_assertion_ids?.includes(assertion.id))) {
        failedConsumerRefs.push(`${kind}:${id}`);
      }
    }
  }
  return {
    ok: failedAssertionIds.length === 0 && failedConsumerRefs.length === 0,
    checkedAssertionIds,
    blockedAssertionIds,
    failedAssertionIds: [...new Set(failedAssertionIds)],
    failedConsumerRefs: [...new Set(failedConsumerRefs)],
  };
}

function updatePendingReceipt(
  db: DatabaseSync,
  correctionId: number,
  fanoutState: "pending" | "failed",
): void {
  db.prepare(
    `UPDATE memory_correction_receipts
     SET fanout_state = ?, readback_ok = 0, completed_at = NULL
     WHERE correction_id = ? AND completed_at IS NULL`,
  ).run(fanoutState, correctionId);
}

function persistCompletion(
  db: DatabaseSync,
  correction: MemoryCorrection,
  now: string,
): { receipt: CorrectionReceipt; outcome: CorrectionOutcome } {
  return withTransaction(db, () => {
    db.prepare(
      `UPDATE memory_correction_receipts
       SET fanout_state = 'complete', readback_ok = 1, completed_at = ?
       WHERE correction_id = ?`,
    ).run(now, correction.id);
    db.prepare(
      `UPDATE memory_corrections
       SET lifecycle_status = 'applied', adjudicated_at = COALESCE(adjudicated_at, ?)
       WHERE id = ? AND lifecycle_status <> 'rejected'`,
    ).run(now, correction.id);
    const kind = outcomeKind(correction.class);
    db.prepare(
      `INSERT OR IGNORE INTO memory_correction_outcomes
         (correction_id, class, ashley_error_kind, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(correction.id, correction.class, kind, now);
    const updatedReceipt = getCorrectionReceipt(db, correction.id);
    if (!updatedReceipt) throw new Error("memory_correction_receipt_unavailable");
    const outcomeRow = asRow(db.prepare(
      `SELECT correction_id, class, ashley_error_kind, created_at
       FROM memory_correction_outcomes WHERE correction_id = ?`,
    ).get(correction.id));
    if (!outcomeRow) throw new Error("memory_correction_outcome_unavailable");
    return {
      receipt: updatedReceipt,
      outcome: {
        correctionId: numberValue(outcomeRow.correction_id),
        class: stringValue(outcomeRow.class) as MemoryCorrection["class"],
        ashleyErrorKind: stringValue(outcomeRow.ashley_error_kind) as CorrectionOutcomeErrorKind,
        createdAt: stringValue(outcomeRow.created_at),
      },
    };
  });
}

export function fanoutCorrection(
  db: DatabaseSync,
  correctionId: number,
  options: CorrectionFanoutOptions = {},
): CorrectionFanoutResult {
  const correction = getCorrection(db, correctionId);
  if (!correction) throw new Error("memory_correction_unavailable");
  if (correction.class === "unclassified") {
    throw new Error("memory_correction_adjudication_required");
  }
  if (correction.barrierId == null) {
    throw new Error("memory_correction_barrier_required");
  }
  const barrier = getDenyBarrier(db, correction.barrierId);
  if (!barrier) throw new Error("memory_correction_barrier_unavailable");
  const members = db.prepare(
    `SELECT membership_seq FROM memory_deny_barrier_members
     WHERE barrier_id = ? ORDER BY membership_seq ASC`,
  ).all(barrier.id) as Array<{ membership_seq?: number }>;
  const sequenceHigh = members.reduce(
    (high, member) => Math.max(high, numberValue(member.membership_seq)),
    0,
  );
  let receipt = ensurePendingReceipt(db, correction, sequenceHigh);
  if (receipt.fanoutState === "complete" && receipt.readbackOk && receipt.completedAt) {
    const readback = readBack(db, correction, listCorrectionTargets(db, correction.id));
    const outcomeRow = asRow(db.prepare(
      `SELECT correction_id, class, ashley_error_kind, created_at
       FROM memory_correction_outcomes WHERE correction_id = ?`,
    ).get(correction.id));
    return {
      correction: getCorrection(db, correction.id) ?? correction,
      receipt,
      outcome: outcomeRow ? {
        correctionId: numberValue(outcomeRow.correction_id),
        class: stringValue(outcomeRow.class) as MemoryCorrection["class"],
        ashleyErrorKind: stringValue(outcomeRow.ashley_error_kind) as CorrectionOutcomeErrorKind,
        createdAt: stringValue(outcomeRow.created_at),
      } : null,
      readback,
      processedTargetCount: 0,
      reconciliationRequestCount: 0,
    };
  }
  updatePendingReceipt(db, correction.id, "pending");
  const targets = listCorrectionTargets(db, correction.id);
  if (targets.length === 0) throw new Error("memory_correction_target_required");
  let processedTargetCount = 0;
  let reconciliationRequestCount = 0;
  for (const target of targets) {
    if (target.applicationState === "applied" || target.applicationState === "skipped") continue;
    const result = withTransaction(db, () => applyTarget(db, correction, target));
    if (result.applied || result.reconciliationRequestCount > 0) processedTargetCount += 1;
    reconciliationRequestCount += result.reconciliationRequestCount;
    if (options.testFailAfterTargets != null &&
        processedTargetCount >= options.testFailAfterTargets) {
      markReceiptFailed(db, correction.id);
      throw new Error("memory_fanout_interrupted");
    }
  }
  const updatedTargets = listCorrectionTargets(db, correction.id);
  if (updatedTargets.some((target) => {
    const assertion = getAssertion(db, target.assertionId);
    return assertion?.subjectFacet === "owner_model" && target.applicationState === "applied";
  })) {
    recomputeSharedCulture(db, correction.ownerId);
  }
  const readback = readBack(db, correction, updatedTargets);
  if (!readback.ok) {
    markReceiptFailed(db, correction.id);
    throw new Error("memory_correction_readback_failed");
  }
  const completed = persistCompletion(
    db,
    correction,
    options.now ?? new Date().toISOString(),
  );
  receipt = completed.receipt;
  return {
    correction: getCorrection(db, correction.id) ?? correction,
    receipt,
    outcome: completed.outcome,
    readback,
    processedTargetCount,
    reconciliationRequestCount,
  };
}

/** Owner-scoped operational projection; it does not authorize or apply work. */
export function correctionDiagnostics(
  db: DatabaseSync,
  ownerId: string,
): Array<Record<string, unknown>> {
  const rows = db.prepare(
    `SELECT c.id, c.entity_uuid, c.source_message_id, c.correction_ordinal,
            c.class, c.scope_text, c.proposal_json, c.lifecycle_status,
            c.stop_required, c.barrier_id, c.adjudicated_at,
            c.capability_mode_at_write, r.barrier_committed, r.fanout_state,
            r.readback_ok, r.barrier_membership_seq_high, r.completed_at,
            CASE WHEN EXISTS (
              SELECT 1 FROM memory_deny_barrier_members m
              WHERE m.barrier_id = c.barrier_id AND m.held_to IS NULL
            ) THEN 1 ELSE 0 END AS stop_committed
     FROM memory_corrections c
     LEFT JOIN memory_correction_receipts r ON r.correction_id = c.id
     WHERE c.owner_id = ?
     ORDER BY c.source_message_id ASC, c.correction_ordinal ASC`,
  ).all(ownerId)
    .map(asRow)
    .filter((row): row is Row => row !== null)
    .map((row) => ({
      id: numberValue(row.id),
      entity_uuid: stringValue(row.entity_uuid),
      source_message_id: numberValue(row.source_message_id),
      correction_ordinal: numberValue(row.correction_ordinal),
      class: stringValue(row.class),
      scope_text: stringValue(row.scope_text),
      proposal_json: stringValue(row.proposal_json),
      lifecycle_status: stringValue(row.lifecycle_status),
      stop_required: numberValue(row.stop_required) === 1,
      stop_committed: numberValue(row.stop_committed) === 1,
      barrier_id: row.barrier_id == null ? null : numberValue(row.barrier_id),
      adjudicated_at: typeof row.adjudicated_at === "string" ? row.adjudicated_at : null,
      capability_mode_at_write: stringValue(row.capability_mode_at_write),
      receipt: row.fanout_state == null ? null : {
        barrierCommitted: numberValue(row.barrier_committed) === 1,
        fanoutState: stringValue(row.fanout_state),
        readbackOk: numberValue(row.readback_ok) === 1,
        barrierMembershipSeqHigh: numberValue(row.barrier_membership_seq_high),
        completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
      },
    }));
  return rows;
}

export function correctionHighWater(db: DatabaseSync): number {
  return getMemoryContractState(db)?.correctionSeq ?? 0;
}
