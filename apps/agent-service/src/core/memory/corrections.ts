import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import {
  commitDenyBarrier,
  getDenyBarrier,
  type BarrierHoldReason,
  type DenyBarrier,
} from "./barriers.js";
import {
  incrementCorrectionSequence,
} from "./contract-state.js";

export type CorrectionClass =
  | "TEMPORAL_SUPERSESSION"
  | "INTERPRETATION_INVALIDATION"
  | "PROVENANCE_CORRECTION"
  | "SCOPE_REFINEMENT"
  | "unclassified";
export type AdmissionPath =
  | "typed_control"
  | "typed_slash"
  | "conversational_deterministic"
  | "conversational_owner_confirmed";
export type CorrectionLifecycleStatus =
  | "received"
  | "proposed"
  | "clarification_required"
  | "admitted"
  | "applying"
  | "applied"
  | "observe_recorded"
  | "rejected";
export type CorrectionCapabilityMode = "observe" | "apply";
export type InclusionReason =
  | "exact_key"
  | "unique_value"
  | "claim_overlap"
  | "derivation_link"
  | "conservative_lexical"
  | "owner_confirmed";
export type ResolutionBasis =
  | "deterministic"
  | "owner_confirmed"
  | "conservative_hold"
  | "proposed"
  | "rejected";
export type TargetApplicationState = "pending" | "held" | "applied" | "skipped";

export type CorrectionTargetInput = {
  assertionId: number;
  inclusionReason: InclusionReason;
  resolutionBasis: ResolutionBasis;
};

export type CorrectionTarget = CorrectionTargetInput & {
  correctionId: number;
  applicationState: TargetApplicationState;
};

export type MemoryCorrection = {
  id: number;
  entityUuid: string;
  ownerId: string;
  sourceMessageId: number;
  correctionOrdinal: number;
  admissionPath: AdmissionPath;
  class: CorrectionClass;
  scopeText: string;
  proposalJson: string;
  lifecycleStatus: CorrectionLifecycleStatus;
  stopRequired: boolean;
  barrierId: number | null;
  adjudicatedAt: string | null;
  idempotencyKey: string;
  capabilityModeAtWrite: CorrectionCapabilityMode;
};

export type CorrectionReceipt = {
  correctionId: number;
  barrierCommitted: boolean;
  fanoutState: "not_started" | "pending" | "complete" | "failed";
  readbackOk: boolean;
  barrierMembershipSeqHigh: number;
  completedAt: string | null;
};

export type AdmitOwnerCorrectionInput = {
  ownerId: string;
  sourceMessageId: number;
  correctionOrdinal: number;
  admissionPath: AdmissionPath;
  class?: Exclude<CorrectionClass, "unclassified"> | CorrectionClass;
  scopeText: string;
  proposal?: unknown;
  targets?: CorrectionTargetInput[];
  capabilityMode: CorrectionCapabilityMode;
  now?: string;
  inTransaction?: boolean;
};

export type CorrectionAdmissionResult = {
  correction: MemoryCorrection;
  targets: CorrectionTarget[];
  barrier: DenyBarrier | null;
  receipt: CorrectionReceipt | null;
};

type Row = Record<string, unknown>;

const CLASSES = new Set<CorrectionClass>([
  "TEMPORAL_SUPERSESSION",
  "INTERPRETATION_INVALIDATION",
  "PROVENANCE_CORRECTION",
  "SCOPE_REFINEMENT",
  "unclassified",
]);
const ADMISSION_PATHS = new Set<AdmissionPath>([
  "typed_control",
  "typed_slash",
  "conversational_deterministic",
  "conversational_owner_confirmed",
]);
const INCLUSION_REASONS = new Set<InclusionReason>([
  "exact_key",
  "unique_value",
  "claim_overlap",
  "derivation_link",
  "conservative_lexical",
  "owner_confirmed",
]);
const RESOLUTION_BASES = new Set<ResolutionBasis>([
  "deterministic",
  "owner_confirmed",
  "conservative_hold",
  "proposed",
  "rejected",
]);

function asRow(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? value as Row : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value);
}

function mapCorrection(value: unknown): MemoryCorrection | null {
  const source = asRow(value);
  if (!source) return null;
  const admissionPath = stringValue(source.admission_path);
  const correctionClass = stringValue(source.class);
  const lifecycleStatus = stringValue(source.lifecycle_status);
  const capabilityMode = stringValue(source.capability_mode_at_write);
  if (
    !ADMISSION_PATHS.has(admissionPath as AdmissionPath) ||
    !CLASSES.has(correctionClass as CorrectionClass) ||
    ![
      "received", "proposed", "clarification_required", "admitted",
      "applying", "applied", "observe_recorded", "rejected",
    ].includes(lifecycleStatus) ||
    (capabilityMode !== "observe" && capabilityMode !== "apply")
  ) return null;
  return {
    id: numberValue(source.id),
    entityUuid: stringValue(source.entity_uuid),
    ownerId: stringValue(source.owner_id),
    sourceMessageId: numberValue(source.source_message_id),
    correctionOrdinal: numberValue(source.correction_ordinal),
    admissionPath: admissionPath as AdmissionPath,
    class: correctionClass as CorrectionClass,
    scopeText: stringValue(source.scope_text),
    proposalJson: stringValue(source.proposal_json),
    lifecycleStatus: lifecycleStatus as CorrectionLifecycleStatus,
    stopRequired: numberValue(source.stop_required) === 1,
    barrierId: nullableNumber(source.barrier_id),
    adjudicatedAt: typeof source.adjudicated_at === "string" ? source.adjudicated_at : null,
    idempotencyKey: stringValue(source.idempotency_key),
    capabilityModeAtWrite: capabilityMode as CorrectionCapabilityMode,
  };
}

function mapTarget(value: unknown): CorrectionTarget | null {
  const source = asRow(value);
  if (!source) return null;
  const inclusionReason = stringValue(source.inclusion_reason);
  const resolutionBasis = stringValue(source.resolution_basis);
  const applicationState = stringValue(source.application_state);
  if (
    !INCLUSION_REASONS.has(inclusionReason as InclusionReason) ||
    !RESOLUTION_BASES.has(resolutionBasis as ResolutionBasis) ||
    !["pending", "held", "applied", "skipped"].includes(applicationState)
  ) return null;
  return {
    correctionId: numberValue(source.correction_id),
    assertionId: numberValue(source.assertion_id),
    inclusionReason: inclusionReason as InclusionReason,
    resolutionBasis: resolutionBasis as ResolutionBasis,
    applicationState: applicationState as TargetApplicationState,
  };
}

function mapReceipt(value: unknown): CorrectionReceipt | null {
  const source = asRow(value);
  if (!source) return null;
  const fanoutState = stringValue(source.fanout_state);
  if (!["not_started", "pending", "complete", "failed"].includes(fanoutState)) return null;
  return {
    correctionId: numberValue(source.correction_id),
    barrierCommitted: numberValue(source.barrier_committed) === 1,
    fanoutState: fanoutState as CorrectionReceipt["fanoutState"],
    readbackOk: numberValue(source.readback_ok) === 1,
    barrierMembershipSeqHigh: numberValue(source.barrier_membership_seq_high),
    completedAt: typeof source.completed_at === "string" ? source.completed_at : null,
  };
}

function jsonValue(value: unknown): string {
  if (value === undefined) return "{}";
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "{}" : encoded;
  } catch {
    throw new Error("memory_correction_proposal_invalid");
  }
}

function withTransaction<T>(
  db: DatabaseSync,
  inTransaction: boolean,
  callback: () => T,
): T {
  if (inTransaction) return callback();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* preserve the original correction error */
    }
    throw error;
  }
}

function validateInput(input: AdmitOwnerCorrectionInput): void {
  if (!input.ownerId.trim()) throw new Error("memory_correction_owner_required");
  if (!Number.isInteger(input.sourceMessageId) || input.sourceMessageId <= 0) {
    throw new Error("memory_correction_source_message_invalid");
  }
  if (!Number.isInteger(input.correctionOrdinal) || input.correctionOrdinal <= 0) {
    throw new Error("memory_correction_ordinal_invalid");
  }
  if (!ADMISSION_PATHS.has(input.admissionPath)) throw new Error("memory_correction_admission_path_invalid");
  if (input.class !== undefined && !CLASSES.has(input.class)) throw new Error("memory_correction_class_invalid");
  if (!input.scopeText.trim()) throw new Error("memory_correction_scope_required");
  for (const target of input.targets ?? []) {
    if (!Number.isInteger(target.assertionId) || target.assertionId <= 0) {
      throw new Error("memory_correction_assertion_id_invalid");
    }
    if (!INCLUSION_REASONS.has(target.inclusionReason)) throw new Error("memory_correction_inclusion_reason_invalid");
    if (!RESOLUTION_BASES.has(target.resolutionBasis)) throw new Error("memory_correction_resolution_basis_invalid");
  }
}

function normalizedTargets(targets: CorrectionTargetInput[]): CorrectionTargetInput[] {
  const seen = new Set<number>();
  const result: CorrectionTargetInput[] = [];
  for (const target of targets) {
    if (seen.has(target.assertionId)) throw new Error("memory_correction_duplicate_target");
    seen.add(target.assertionId);
    result.push(target);
  }
  return result;
}

export function getCorrection(
  db: DatabaseSync,
  correctionId: number,
): MemoryCorrection | null {
  return mapCorrection(db.prepare(
    "SELECT * FROM memory_corrections WHERE id = ?",
  ).get(correctionId));
}

export function listCorrections(
  db: DatabaseSync,
  ownerId: string,
): MemoryCorrection[] {
  return db.prepare(
    `SELECT * FROM memory_corrections
     WHERE owner_id = ? ORDER BY source_message_id ASC, correction_ordinal ASC`,
  ).all(ownerId)
    .map(mapCorrection)
    .filter((correction): correction is MemoryCorrection => correction !== null);
}

export function listCorrectionTargets(
  db: DatabaseSync,
  correctionId: number,
): CorrectionTarget[] {
  return db.prepare(
    `SELECT * FROM memory_correction_targets
     WHERE correction_id = ? ORDER BY assertion_id ASC`,
  ).all(correctionId)
    .map(mapTarget)
    .filter((target): target is CorrectionTarget => target !== null);
}

export function getCorrectionReceipt(
  db: DatabaseSync,
  correctionId: number,
): CorrectionReceipt | null {
  return mapReceipt(db.prepare(
    "SELECT * FROM memory_correction_receipts WHERE correction_id = ?",
  ).get(correctionId));
}

function upsertTargets(
  db: DatabaseSync,
  correctionId: number,
  targets: CorrectionTargetInput[],
  held: boolean,
): void {
  const upsert = db.prepare(
    `INSERT INTO memory_correction_targets
       (correction_id, assertion_id, inclusion_reason, resolution_basis, application_state)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(correction_id, assertion_id) DO UPDATE SET
       inclusion_reason = excluded.inclusion_reason,
       resolution_basis = excluded.resolution_basis,
         application_state = CASE
           WHEN memory_correction_targets.application_state = 'applied' THEN 'applied'
           WHEN memory_correction_targets.application_state = 'held' THEN 'held'
           WHEN excluded.application_state = 'held' THEN 'held'
           ELSE excluded.application_state
         END`,
  );
  for (const target of targets) {
    upsert.run(
      correctionId,
      target.assertionId,
      target.inclusionReason,
      target.resolutionBasis,
      held && target.resolutionBasis !== "proposed" && target.resolutionBasis !== "rejected"
        ? "held"
        : "pending",
    );
  }
}

function storeReceipt(
  db: DatabaseSync,
  correctionId: number,
  input: {
    barrierCommitted: boolean;
    fanoutState: CorrectionReceipt["fanoutState"];
    readbackOk: boolean;
    barrierMembershipSeqHigh: number;
  },
): void {
  db.prepare(
    `INSERT INTO memory_correction_receipts
       (correction_id, barrier_committed, fanout_state, readback_ok,
        barrier_membership_seq_high, completed_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(correction_id) DO UPDATE SET
       barrier_committed = excluded.barrier_committed,
       fanout_state = CASE
         WHEN memory_correction_receipts.fanout_state = 'complete'
           THEN memory_correction_receipts.fanout_state
         ELSE excluded.fanout_state
       END,
       readback_ok = CASE
         WHEN memory_correction_receipts.fanout_state = 'complete'
           THEN memory_correction_receipts.readback_ok
         ELSE excluded.readback_ok
       END,
       barrier_membership_seq_high = MAX(
         memory_correction_receipts.barrier_membership_seq_high,
         excluded.barrier_membership_seq_high
       )`,
  ).run(
    correctionId,
    input.barrierCommitted ? 1 : 0,
    input.fanoutState,
    input.readbackOk ? 1 : 0,
    input.barrierMembershipSeqHigh,
  );
}

function validateTargetOwners(
  db: DatabaseSync,
  ownerId: string,
  targets: CorrectionTargetInput[],
): void {
  for (const target of targets) {
    const row = asRow(db.prepare(
      "SELECT owner_id FROM memory_assertions WHERE id = ?",
    ).get(target.assertionId));
    if (!row) throw new Error(`memory_assertion_missing:${target.assertionId}`);
    if (row.owner_id !== ownerId) throw new Error("memory_assertion_owner_mismatch");
  }
}

function resultFor(
  db: DatabaseSync,
  correctionId: number,
  barrier: DenyBarrier | null,
): CorrectionAdmissionResult {
  const correction = getCorrection(db, correctionId);
  if (!correction) throw new Error("memory_correction_unavailable");
  return {
    correction,
    targets: listCorrectionTargets(db, correctionId),
    barrier,
    receipt: getCorrectionReceipt(db, correctionId),
  };
}

export function admitOwnerCorrection(
  db: DatabaseSync,
  input: AdmitOwnerCorrectionInput,
): CorrectionAdmissionResult {
  validateInput(input);
  const now = input.now ?? new Date().toISOString();
  const idempotencyKey = `${input.ownerId}:${input.sourceMessageId}:${input.correctionOrdinal}`;
  const targets = normalizedTargets(input.targets ?? []);
  const correctionClass = input.class ?? "unclassified";
  const proposalJson = jsonValue(input.proposal);
  return withTransaction(db, input.inTransaction === true, () => {
    const source = asRow(db.prepare(
      "SELECT owner_id FROM mem_messages WHERE id = ?",
    ).get(input.sourceMessageId));
    if (!source) throw new Error("memory_correction_source_message_missing");
    if (source.owner_id !== input.ownerId) throw new Error("memory_correction_source_owner_mismatch");
    validateTargetOwners(db, input.ownerId, targets);

    let correction = mapCorrection(db.prepare(
      "SELECT * FROM memory_corrections WHERE idempotency_key = ?",
    ).get(idempotencyKey));
    if (correction && correction.ownerId !== input.ownerId) {
      throw new Error("memory_correction_owner_mismatch");
    }
    if (correction && correction.lifecycleStatus === "applied") {
      return resultFor(db, correction.id, correction.barrierId == null ? null : getDenyBarrier(db, correction.barrierId));
    }

    if (!correction) {
      const result = db.prepare(
        `INSERT INTO memory_corrections
           (entity_uuid, owner_id, source_message_id, correction_ordinal,
            admission_path, class, scope_text, proposal_json, lifecycle_status,
            stop_required, barrier_id, adjudicated_at, idempotency_key,
            capability_mode_at_write)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, NULL, NULL, ?, ?)`,
      ).run(
        newEntityUuid(),
        input.ownerId,
        input.sourceMessageId,
        input.correctionOrdinal,
        input.admissionPath,
        correctionClass,
        input.scopeText.trim(),
        proposalJson,
        targets.length > 0 ? 1 : 0,
        idempotencyKey,
        input.capabilityMode,
      );
      const correctionId = Number(result.lastInsertRowid);
      incrementCorrectionSequence(db);
      correction = getCorrection(db, correctionId);
    } else {
      const mergedProposal = input.proposal === undefined
        ? correction.proposalJson
        : proposalJson;
      const nextClass = correction.class === "unclassified"
        ? correctionClass
        : correction.class;
      if (correction.class !== "unclassified" && correctionClass !== "unclassified" && correction.class !== correctionClass) {
        throw new Error("memory_correction_class_conflict");
      }
      db.prepare(
        `UPDATE memory_corrections
         SET class = ?, proposal_json = ?, stop_required = CASE WHEN ? > 0 THEN 1 ELSE stop_required END,
             adjudicated_at = CASE WHEN ? <> 'unclassified' THEN COALESCE(adjudicated_at, ?) ELSE adjudicated_at END
         WHERE id = ?`,
      ).run(
        nextClass,
        mergedProposal,
        targets.length,
        nextClass,
        nextClass === "unclassified" ? null : now,
        correction.id,
      );
      correction = getCorrection(db, correction.id);
    }
    if (!correction) throw new Error("memory_correction_unavailable");

    const resolvedTargets = targets.filter((target) =>
      target.resolutionBasis !== "proposed" && target.resolutionBasis !== "rejected"
    );
    const fullyAdjudicated = correction.class !== "unclassified" &&
      targets.length > 0 && targets.every((target) =>
        target.resolutionBasis === "deterministic" || target.resolutionBasis === "owner_confirmed"
      );
    const shouldCommitBarrier = input.capabilityMode === "apply" && resolvedTargets.length > 0;
    const hasCommittedBarrier = correction.barrierId != null || shouldCommitBarrier;
    upsertTargets(db, correction.id, targets, hasCommittedBarrier);

    let barrier: DenyBarrier | null = correction.barrierId == null
      ? null
      : getDenyBarrier(db, correction.barrierId);
    if (shouldCommitBarrier) {
      const committed = commitDenyBarrier(db, {
        ownerId: input.ownerId,
        correctionId: correction.id,
        members: resolvedTargets.map((target) => ({
          assertionId: target.assertionId,
          holdReason: target.resolutionBasis === "conservative_hold"
            ? "conservative_hold"
            : target.resolutionBasis === "owner_confirmed"
              ? "owner_confirmed"
              : "deterministic",
        })),
        committedAt: now,
        scopeNote: input.scopeText.trim(),
        inTransaction: true,
      });
      barrier = committed.barrier;
      storeReceipt(db, correction.id, {
        barrierCommitted: true,
        fanoutState: "pending",
        readbackOk: false,
        barrierMembershipSeqHigh: committed.sequenceHigh,
      });
      db.prepare(
        `UPDATE memory_contract_state SET applied_c1_authority_exists = 1 WHERE id = 1`,
      ).run();
    } else if (!getCorrectionReceipt(db, correction.id)) {
      storeReceipt(db, correction.id, {
        barrierCommitted: false,
        fanoutState: "not_started",
        readbackOk: false,
        barrierMembershipSeqHigh: 0,
      });
    }

    const computedLifecycle: CorrectionLifecycleStatus = input.capabilityMode === "observe"
      ? "observe_recorded"
      : shouldCommitBarrier
        ? fullyAdjudicated ? "applying" : "clarification_required"
        : targets.length === 0 ? "proposed" : "clarification_required";
    const lifecycle: CorrectionLifecycleStatus =
      input.capabilityMode === "observe" && correction.barrierId != null
        ? correction.lifecycleStatus
        : computedLifecycle;
    db.prepare(
      `UPDATE memory_corrections
       SET lifecycle_status = ?, adjudicated_at = CASE
         WHEN ? IN ('applying', 'clarification_required') AND class <> 'unclassified'
           THEN COALESCE(adjudicated_at, ?)
         ELSE adjudicated_at END
       WHERE id = ?`,
    ).run(lifecycle, lifecycle, now, correction.id);
    return resultFor(db, correction.id, barrier);
  });
}
