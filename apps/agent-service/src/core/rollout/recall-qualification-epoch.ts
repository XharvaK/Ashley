import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { currentBuildIdentity, currentContractId } from "./capabilities.js";

/**
 * Recall qualification epochs — schema v26.
 *
 * The epoch registry owns ONLY which Recall isolated_eval/live_shadow campaign
 * is current. It is not capability authority: capability state, contract
 * cohort, safety events (behavioral_breach / critical_failure /
 * operator_*), and live-cutover watermarks stay on the authoritative
 * ashley-capability-v3 release and `capability_events`.
 *
 * Fail-closed rules:
 *  - No current epoch is a legitimate state: promotion eligibility is FALSE.
 *  - A qualification campaign is created ONLY by the explicit owner-authorized
 *    epoch-start operation. Ordinary evidence recording NEVER creates an epoch
 *    (no implicit seeding).
 *  - Recording evidence while no epoch exists is provenance-only: the
 *    `capability_events` ledger write still occurs (it is the historical
 *    provenance record, unchanged from v3) but nothing is mirrored into the
 *    epoch registry and nothing qualifies. A typed non-qualification result
 *    is returned; no exception is thrown for the missing-epoch condition.
 *  - Historical v3 qualification evidence in `capability_events` is never
 *    consulted by eligibility and never falls back into a new campaign.
 *  - Retired epochs are immutable; their evidence cannot qualify current
 *    promotion.
 */

export type RecallQualificationEpoch = {
  epochId: string;
  status: "current" | "retired";
  startRequestKey: string;
  predecessorEpochId: string | null;
  contractId: string;
  startedBuildIdentity: string;
  createdBy: string;
  startedAt: string;
  retiredAt: string | null;
  evalSeedCount: number;
  qualifiedAt: string | null;
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function inTransaction(db: DatabaseSync): boolean {
  return db.isTransaction;
}

/**
 * Begin an immediate transaction unless the caller already owns one (e.g. the
 * cognitive materializer or the capability ledger dual-write). Returns whether
 * THIS call opened the transaction; when false, the caller must not commit or
 * roll back.
 */
export function beginImmediateIfNeeded(db: DatabaseSync): boolean {
  if (inTransaction(db)) return false;
  db.exec("BEGIN IMMEDIATE");
  return true;
}

function toEpoch(row: Row): RecallQualificationEpoch {
  return {
    epochId: String(row.epoch_id ?? ""),
    status: row.status === "retired" ? "retired" : "current",
    startRequestKey: String(row.start_request_key ?? ""),
    predecessorEpochId:
      typeof row.predecessor_epoch_id === "string" &&
      row.predecessor_epoch_id.trim().length > 0
        ? row.predecessor_epoch_id
        : null,
    contractId: String(row.contract_id ?? ""),
    startedBuildIdentity: String(row.started_build_identity ?? ""),
    createdBy: String(row.created_by ?? ""),
    startedAt: String(row.started_at ?? ""),
    retiredAt: typeof row.retired_at === "string" ? row.retired_at : null,
    evalSeedCount: Number(row.eval_seed_count ?? 0),
    qualifiedAt: typeof row.qualified_at === "string" ? row.qualified_at : null,
  };
}

export type StartRecallQualificationEpochResult =
  | {
      ok: true;
      created: boolean;
      epochId: string;
      predecessorEpochId: string | null;
      startedAt: string;
    }
  | {
      ok: false;
      reason: "authorization_required" | "request_key_required" | "epoch_changed";
      currentEpochId: string | null;
    };

/**
 * Owner-authorized epoch transition with a host-owned atomic compare-and-swap.
 *
 * The start_request_key makes retries idempotent: the same logical request
 * converges on the epoch it created. Two distinct requests expecting the same
 * predecessor: at most one succeeds; the loser fails with `epoch_changed`.
 *
 * The transition never retires the winning request's own epoch, never touches
 * capability state, masterMode, or the authority `capability_releases` row.
 */
export function startRecallQualificationEpoch(
  db: DatabaseSync,
  input: {
    authorizedBy: string;
    startRequestKey: string;
    expectedCurrentEpochId: string | null;
  },
): StartRecallQualificationEpochResult {
  const authorizedBy = input.authorizedBy.trim();
  if (!authorizedBy) {
    return { ok: false, reason: "authorization_required", currentEpochId: null };
  }
  const requestKey = input.startRequestKey.trim();
  if (!requestKey) {
    return { ok: false, reason: "request_key_required", currentEpochId: null };
  }
  const expected =
    input.expectedCurrentEpochId === null
      ? null
      : input.expectedCurrentEpochId.trim() || null;
  const now = new Date().toISOString();

  const ownsTransaction = beginImmediateIfNeeded(db);
  try {
    const existing = db
      .prepare(
        `SELECT epoch_id, predecessor_epoch_id, started_at
         FROM recall_qualification_epochs WHERE start_request_key = ?`,
      )
      .get(requestKey) as Row | undefined;
    if (existing) {
      if (ownsTransaction) db.exec("COMMIT");
      return {
        ok: true,
        created: false,
        epochId: String(existing.epoch_id ?? ""),
        predecessorEpochId:
          typeof existing.predecessor_epoch_id === "string" &&
          existing.predecessor_epoch_id.trim().length > 0
            ? existing.predecessor_epoch_id
            : null,
        startedAt: String(existing.started_at ?? now),
      };
    }

    const current = db
      .prepare(
        `SELECT epoch_id FROM recall_qualification_epochs WHERE status = 'current'`,
      )
      .get() as Row | undefined;
    const currentEpochId =
      current && typeof current.epoch_id === "string" ? current.epoch_id : null;
    if (expected === null) {
      if (currentEpochId !== null) {
        if (ownsTransaction) db.exec("COMMIT");
        return { ok: false, reason: "epoch_changed", currentEpochId };
      }
    } else if (currentEpochId !== expected) {
      if (ownsTransaction) db.exec("COMMIT");
      return { ok: false, reason: "epoch_changed", currentEpochId };
    }

    if (currentEpochId !== null) {
      const retired = db.prepare(
        `UPDATE recall_qualification_epochs
         SET status = 'retired', retired_at = ?
         WHERE epoch_id = ? AND status = 'current'`,
      ).run(now, currentEpochId);
      if (retired.changes !== 1) {
        throw new Error("recall_epoch_current_transition_lost");
      }
    }

    const epochId = randomUUID();
    db.prepare(
      `INSERT INTO recall_qualification_epochs
         (epoch_id, status, start_request_key, predecessor_epoch_id,
          contract_id, started_build_identity, created_by, started_at,
          eval_seed_count, qualified_at, model_epoch)
       VALUES (?, 'current', ?, ?, ?, ?, ?, ?, 0, NULL, 0)`,
    ).run(
      epochId,
      requestKey,
      currentEpochId,
      currentContractId(),
      currentBuildIdentity(),
      authorizedBy,
      now,
    );
    if (ownsTransaction) db.exec("COMMIT");
    return {
      ok: true,
      created: true,
      epochId,
      predecessorEpochId: currentEpochId,
      startedAt: now,
    };
  } catch (error) {
    if (ownsTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original failure */
      }
    }
    throw error;
  }
}

export function getCurrentRecallQualificationEpoch(
  db: DatabaseSync,
): RecallQualificationEpoch | null {
  const row = db
    .prepare(
      `SELECT * FROM recall_qualification_epochs WHERE status = 'current'`,
    )
    .get() as Row | undefined;
  return isRow(row) ? toEpoch(row) : null;
}

export function getRecallQualificationEpoch(
  db: DatabaseSync,
  epochId: string,
): RecallQualificationEpoch | null {
  const row = db
    .prepare(`SELECT * FROM recall_qualification_epochs WHERE epoch_id = ?`)
    .get(epochId) as Row | undefined;
  return isRow(row) ? toEpoch(row) : null;
}

export function listRecallQualificationEpochs(
  db: DatabaseSync,
): RecallQualificationEpoch[] {
  const rows = db
    .prepare(
      `SELECT * FROM recall_qualification_epochs
       ORDER BY started_at ASC, epoch_id ASC`,
    )
    .all() as Row[];
  return rows.filter(isRow).map(toEpoch);
}

export type RecallQualificationCounts = {
  liveShadowEvents: number;
  liveShadowSpanDays: number;
  firstLiveShadowAt: string | null;
  lastLiveShadowAt: string | null;
};

export function recallQualificationCounts(
  db: DatabaseSync,
  epochId: string,
): RecallQualificationCounts {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c, MIN(occurred_at) AS first,
              MAX(occurred_at) AS last
       FROM recall_qualification_events
       WHERE epoch_id = ? AND kind = 'live_shadow'`,
    )
    .get(epochId) as Row | undefined;
  const count = isRow(row) ? Number(row.c ?? 0) : 0;
  const first = isRow(row) && typeof row.first === "string" ? row.first : null;
  const last = isRow(row) && typeof row.last === "string" ? row.last : null;
  const spanDays =
    first && last
      ? Math.max(0, (Date.parse(last) - Date.parse(first)) / 86_400_000)
      : 0;
  return {
    liveShadowEvents: count,
    liveShadowSpanDays: spanDays,
    firstLiveShadowAt: first,
    lastLiveShadowAt: last,
  };
}

export type RecallPromotionQualification = {
  epochId: string;
  evalSeedCount: number;
  qualifiedAt: string | null;
  liveShadowEvents: number;
  liveShadowSpanDays: number;
};

/**
 * Current-epoch qualification evidence for Recall promotion.
 * Returns null (fail closed) when no current qualification epoch exists.
 */
export function recallPromotionQualification(
  db: DatabaseSync,
): RecallPromotionQualification | null {
  const epoch = getCurrentRecallQualificationEpoch(db);
  if (!epoch) return null;
  const counts = recallQualificationCounts(db, epoch.epochId);
  return {
    epochId: epoch.epochId,
    evalSeedCount: epoch.evalSeedCount,
    qualifiedAt: epoch.qualifiedAt,
    liveShadowEvents: counts.liveShadowEvents,
    liveShadowSpanDays: counts.liveShadowSpanDays,
  };
}

/** Immutable/idempotent qualification event write. Returns false on duplicate. */
export function recordRecallQualificationEvent(
  db: DatabaseSync,
  epochId: string,
  kind: "isolated_eval" | "live_shadow",
  sourceKey: string,
  detail: Record<string, unknown>,
  occurredAt: string,
): boolean {
  const result = db.prepare(
    `INSERT OR IGNORE INTO recall_qualification_events
       (epoch_id, kind, source_key, detail_json, occurred_at,
        build_identity, model_epoch)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    epochId,
    kind,
    sourceKey.slice(0, 300),
    JSON.stringify(detail ?? {}).slice(0, 4000),
    occurredAt,
    currentBuildIdentity(),
  );
  return result.changes > 0;
}

export type RecallEvalRecordResult = {
  recorded: boolean;
  reason?: "recall_qualification_epoch_unavailable";
};

/**
 * Recall isolated_eval recording.
 *
 * With a current epoch: mirrors the qualification event and applies the epoch
 * aggregate (eval_seed_count / qualified_at) atomically with the caller's
 * provenance write. With no current epoch: returns a typed
 * `recall_qualification_epoch_unavailable` result, writes nothing to the
 * epoch registry, and never throws — the caller's `capability_events`
 * provenance write is still the historical record. The epoch is created only
 * by the explicit owner-authorized start operation.
 */
export function recordRecallIsolatedEvaluation(
  db: DatabaseSync,
  input: {
    seeds: number;
    passed: boolean;
    sourceKey: string;
    occurredAt?: string;
  },
): RecallEvalRecordResult {
  const epoch = getCurrentRecallQualificationEpoch(db);
  if (!epoch) {
    return { recorded: false, reason: "recall_qualification_epoch_unavailable" };
  }
  const now = input.occurredAt ?? new Date().toISOString();
  const seeds = Math.max(0, Math.trunc(input.seeds));
  const ownsTransaction = beginImmediateIfNeeded(db);
  try {
    recordRecallQualificationEvent(db, epoch.epochId, "isolated_eval", input.sourceKey, {
      seeds,
      passed: input.passed,
    }, now);
    db.prepare(
      `UPDATE recall_qualification_epochs
       SET eval_seed_count = MAX(eval_seed_count, ?)
       WHERE epoch_id = ? AND status = 'current'`,
    ).run(seeds, epoch.epochId);
    if (input.passed && seeds >= 3) {
      db.prepare(
        `UPDATE recall_qualification_epochs SET qualified_at = ?
         WHERE epoch_id = ? AND status = 'current'`,
      ).run(now, epoch.epochId);
    }
    if (ownsTransaction) db.exec("COMMIT");
    return { recorded: true };
  } catch (error) {
    if (ownsTransaction) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original failure */
      }
    }
    throw error;
  }
}

export type LiveShadowRecordResult = {
  recorded: boolean;
  reason?: "recall_qualification_epoch_unavailable";
};

/**
 * Recall live_shadow recording.
 *
 * With a current epoch: mirrors the qualification event idempotently. With no
 * current epoch: returns a typed `recall_qualification_epoch_unavailable`
 * result, writes nothing to the epoch registry, and never throws — the
 * caller's `capability_events` provenance write is still the historical
 * record. The epoch is created only by the explicit owner-authorized start
 * operation.
 */
export function recordRecallLiveShadowEvent(
  db: DatabaseSync,
  sourceKey: string,
  input: { occurredAt?: string; detail?: Record<string, unknown> },
): LiveShadowRecordResult {
  const epoch = getCurrentRecallQualificationEpoch(db);
  if (!epoch) {
    return { recorded: false, reason: "recall_qualification_epoch_unavailable" };
  }
  const recorded = recordRecallQualificationEvent(
    db,
    epoch.epochId,
    "live_shadow",
    sourceKey,
    input.detail ?? {},
    input.occurredAt ?? new Date().toISOString(),
  );
  return { recorded };
}
