import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getMemoryContractState } from "../memory/contract-state.js";
import { ensureBootstrapContract } from "../attention/ledger.js";
import {
  currentBuildIdentity,
  currentContractId,
  type CapabilityState,
} from "./capabilities.js";

export const C1_EVALUATION_DEFINITION_ID = "c1-memory-evidence-v1" as const;
export const C1_EVALUATION_DEFINITION_VERSION = 1 as const;
export const C1_REQUIRED_EVAL_SEEDS = [
  "owner_self_description_precedence",
  "recorded_event_scope_only",
  "ashley_history_scope_only",
  "confidence_not_authority",
  "proof_carrying_or_uncertain_disagreement",
  "non_revival_identity_nonmutation",
] as const;

const C1_EVALUATION_DEFINITION_CANONICAL = JSON.stringify({
  definitionId: C1_EVALUATION_DEFINITION_ID,
  definitionVersion: C1_EVALUATION_DEFINITION_VERSION,
  requiredSeeds: C1_REQUIRED_EVAL_SEEDS,
});

export const C1_EVALUATION_DEFINITION_HASH = createHash("sha256")
  .update(C1_EVALUATION_DEFINITION_CANONICAL, "utf8")
  .digest("hex");

export const C1_DECISION_CLASSES = [
  "no_c1_material",
  "same_current",
  "would_relabel",
  "would_filter",
  "would_narrow",
  "mixed_change",
  "unmapped_fail_closed",
  "evaluation_error",
] as const;

export type C1DecisionClass = typeof C1_DECISION_CLASSES[number];
export type C1EvaluationSeedId = typeof C1_REQUIRED_EVAL_SEEDS[number];

export type MemoryEvidenceQualificationEpoch = {
  epochId: string;
  status: "current" | "retired";
  startRequestKey: string;
  predecessorEpochId: string | null;
  ownerId: string;
  contractId: string;
  startedBuildIdentity: string;
  createdBy: string;
  startedAt: string;
  retiredAt: string | null;
  evalSeedCount: number;
  qualifiedAt: string | null;
  sealedAt: string | null;
  sealedReleaseId: string | null;
  blockedAt: string | null;
  blockCode: string | null;
  blockSourceKey: string | null;
};

export type StartC1EpochInput = {
  ownerId: string;
  startRequestKey: string;
  predecessorEpochId: string | null;
};

export type StartC1EpochResult =
  | {
      ok: true;
      created: boolean;
      epochId: string;
      predecessorEpochId: string | null;
      startedAt: string;
    }
  | {
      ok: false;
      reason:
        | "owner_required"
        | "request_key_required"
        | "currentness_not_mem_facts"
        | "memory_evidence_not_observe"
        | "recall_not_active"
        | "recall_cutoff_missing"
        | "contract_identity_mismatch"
        | "build_identity_mismatch"
        | "epoch_owner_mismatch"
        | "epoch_changed";
      currentEpochId: string | null;
    };

export type RecordC1EvaluationInput = {
  ownerId: string;
  sourceKey: string;
  definitionId: string;
  definitionVersion: number;
  definitionHash: string;
  seeds: Array<{ id: string; passed: boolean }>;
  occurredAt?: string;
};

export type RecordC1LiveShadowInput = {
  ownerId: string;
  sourceKey: string;
  decisionClass: C1DecisionClass;
  qualifies: boolean;
  trigger: "reactive" | "proactive";
  sourceCount: number;
  detail?: Record<string, unknown>;
  occurredAt?: string;
};

export type C1EventReason =
  | "no_current_epoch"
  | "epoch_owner_mismatch"
  | "build_identity_mismatch"
  | "contract_identity_mismatch"
  | "currentness_not_mem_facts"
  | "memory_evidence_not_observe"
  | "recall_not_active"
  | "recall_cutoff_missing"
  | "source_key_collision"
  | "idempotent"
  | "epoch_sealed"
  | "evaluation_definition_mismatch"
  | "required_eval_seeds_incomplete"
  | "invalid_source_key"
  | "invalid_receipt";

export type C1EventResult =
  | { recorded: true }
  | { recorded: false; reason: C1EventReason };

export type C1ReadinessBlocker =
  | "no_current_epoch"
  | "epoch_owner_mismatch"
  | "build_identity_mismatch"
  | "contract_identity_mismatch"
  | "currentness_not_mem_facts"
  | "memory_evidence_not_observe"
  | "recall_not_active"
  | "recall_cutoff_missing"
  | "required_eval_seeds_incomplete"
  | "live_shadow_count_insufficient"
  | "live_shadow_span_insufficient"
  | "reactive_witness_missing"
  | "proactive_witness_missing"
  | "blocking_witness_present"
  | "source_key_collision";

export type MemoryEvidenceQualificationReadiness = {
  eligible: boolean;
  blockerCodes: C1ReadinessBlocker[];
  ownerId: string;
  epochId: string | null;
  predecessorEpochId: string | null;
  epochStatus: "current" | "retired" | null;
  epochBuildIdentity: string | null;
  epochContractId: string | null;
  buildIdentity: string;
  contractId: string;
  evalSeedCount: number;
  qualifiedAt: string | null;
  observedCount: number;
  qualifyingCount: number;
  nonQualifyingCount: number;
  earliestQualifyingAt: string | null;
  latestQualifyingAt: string | null;
  spanDays: number;
  countsByTrigger: { reactive: number; proactive: number };
  countsByDecisionClass: Record<C1DecisionClass, number>;
  blockingEventCount: number;
  currentnessAuthority: "mem_facts" | "memory_assertions" | null;
  memoryEvidenceState: CapabilityState | "missing";
  recallState: CapabilityState | "missing";
  recallCutoffPresent: boolean;
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function normalized(value: string): string {
  return value.trim();
}

function currentEpochRow(db: DatabaseSync): Row | null {
  const row = db.prepare(
    `SELECT * FROM memory_evidence_qualification_epochs
     WHERE status = 'current' ORDER BY epoch_id ASC LIMIT 1`,
  ).get();
  return isRow(row) ? row : null;
}

function epochFromRow(row: Row): MemoryEvidenceQualificationEpoch {
  return {
    epochId: text(row.epoch_id),
    status: row.status === "retired" ? "retired" : "current",
    startRequestKey: text(row.start_request_key),
    predecessorEpochId: nullableText(row.predecessor_epoch_id),
    ownerId: text(row.owner_id),
    contractId: text(row.contract_id),
    startedBuildIdentity: text(row.started_build_identity),
    createdBy: text(row.created_by),
    startedAt: text(row.started_at),
    retiredAt: nullableText(row.retired_at),
    evalSeedCount: numberValue(row.eval_seed_count),
    qualifiedAt: nullableText(row.qualified_at),
    sealedAt: nullableText(row.sealed_at),
    sealedReleaseId: nullableText(row.sealed_release_id),
    blockedAt: nullableText(row.blocked_at),
    blockCode: nullableText(row.block_code),
    blockSourceKey: nullableText(row.block_source_key),
  };
}

function withImmediateTransaction<T>(db: DatabaseSync, callback: () => T): T {
  const ownsTransaction = db.isTransaction === false;
  if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    if (ownsTransaction) db.exec("COMMIT");
    return result;
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

function capabilityState(
  db: DatabaseSync,
  capability: string,
): CapabilityState | "missing" {
  const row = db.prepare(
    `SELECT state FROM capability_releases
     WHERE capability = ? AND release_id = ?`,
  ).get(capability, currentContractId());
  if (!isRow(row)) return capability === "memory_evidence" ? "observe" : "missing";
  switch (row.state) {
    case "observe":
    case "active":
    case "rolled_back":
    case "disabled":
      return row.state;
    default:
      return "missing";
  }
}

function recallCutoffExists(db: DatabaseSync, ownerId: string): boolean {
  try {
    return db.prepare(
      `SELECT 1 FROM recall_live_cutovers
       WHERE owner_id = ? AND capability = 'recall' AND release_id = ? LIMIT 1`,
    ).get(ownerId, currentContractId()) !== undefined;
  } catch {
    return false;
  }
}

function currentnessAuthority(
  db: DatabaseSync,
): "mem_facts" | "memory_assertions" | null {
  return getMemoryContractState(db)?.currentnessAuthority ?? null;
}

function sourceKeyWithinBounds(sourceKey: string): boolean {
  return sourceKey.length > 0 && sourceKey.length <= 300 && !/[\r\n]/.test(sourceKey);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function boundedDetail(value: Record<string, unknown>): string | null {
  const serialized = stableJson(value);
  return Buffer.byteLength(serialized, "utf8") <= 4000 ? serialized : null;
}

function liveSourceKeyValid(sourceKey: string): boolean {
  return /^c1-shadow:v1:decision:[1-9][0-9]*$/.test(sourceKey);
}

function evaluationSourceKeyValid(sourceKey: string): boolean {
  return sourceKey.startsWith(
    `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:`,
  ) && sourceKey.length > `c1-eval:v1:${C1_EVALUATION_DEFINITION_HASH}:`.length;
}

function addBlock(
  db: DatabaseSync,
  epochId: string,
  code: C1ReadinessBlocker | string,
  sourceKey: string,
  occurredAt: string,
): void {
  db.prepare(
    `UPDATE memory_evidence_qualification_epochs
     SET blocked_at = COALESCE(blocked_at, ?),
         block_code = COALESCE(block_code, ?),
         block_source_key = COALESCE(block_source_key, ?)
     WHERE epoch_id = ? AND status = 'current'`,
  ).run(occurredAt, code, sourceKey.slice(0, 300), epochId);
}

type EventValues = {
  epochId: string;
  kind: "isolated_eval" | "live_shadow";
  sourceKey: string;
  decisionClass: C1DecisionClass | null;
  qualifies: boolean;
  trigger: "reactive" | "proactive" | null;
  sourceCount: number;
  detailJson: string;
  occurredAt: string;
};

function existingEvent(
  db: DatabaseSync,
  values: EventValues,
): Row | null {
  const row = db.prepare(
    `SELECT kind, source_key, decision_class, qualifies, trigger,
            source_count, detail_json
     FROM memory_evidence_qualification_events
     WHERE epoch_id = ? AND kind = ? AND source_key = ?`,
  ).get(values.epochId, values.kind, values.sourceKey);
  return isRow(row) ? row : null;
}

function sameReceipt(row: Row, values: EventValues): boolean {
  return text(row.kind) === values.kind &&
    text(row.source_key) === values.sourceKey &&
    (row.decision_class == null ? null : text(row.decision_class)) === values.decisionClass &&
    numberValue(row.qualifies) === (values.qualifies ? 1 : 0) &&
    (row.trigger == null ? null : text(row.trigger)) === values.trigger &&
    numberValue(row.source_count) === values.sourceCount &&
    text(row.detail_json) === values.detailJson;
}

function writeEvent(db: DatabaseSync, values: EventValues): C1EventResult {
  const existing = existingEvent(db, values);
  if (existing) {
    return sameReceipt(existing, values)
      ? { recorded: false, reason: "idempotent" }
      : { recorded: false, reason: "source_key_collision" };
  }
  db.prepare(
    `INSERT INTO memory_evidence_qualification_events
       (epoch_id, kind, source_key, decision_class, qualifies, trigger,
        source_count, detail_json, occurred_at, contract_id, build_identity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    values.epochId,
    values.kind,
    values.sourceKey,
    values.decisionClass,
    values.qualifies ? 1 : 0,
    values.trigger,
    values.sourceCount,
    values.detailJson,
    values.occurredAt,
    currentContractId(),
    currentBuildIdentity(),
  );
  return { recorded: true };
}

function currentEpochForOwner(
  db: DatabaseSync,
  ownerId: string,
): MemoryEvidenceQualificationEpoch | null {
  const row = currentEpochRow(db);
  if (!row || text(row.owner_id) !== ownerId) return null;
  return epochFromRow(row);
}

function bindingFailure(
  db: DatabaseSync,
  epoch: MemoryEvidenceQualificationEpoch,
  ownerId: string,
): C1EventReason | null {
  if (epoch.ownerId !== ownerId) return "epoch_owner_mismatch";
  if (epoch.startedBuildIdentity !== currentBuildIdentity()) {
    return "build_identity_mismatch";
  }
  if (epoch.contractId !== currentContractId()) {
    return "contract_identity_mismatch";
  }
  if (currentnessAuthority(db) !== "mem_facts") {
    return "currentness_not_mem_facts";
  }
  if (capabilityState(db, "memory_evidence") !== "observe") {
    return "memory_evidence_not_observe";
  }
  if (capabilityState(db, "recall") !== "active") {
    return "recall_not_active";
  }
  if (!recallCutoffExists(db, ownerId)) return "recall_cutoff_missing";
  return null;
}

function recordBindingFailure(
  db: DatabaseSync,
  epoch: MemoryEvidenceQualificationEpoch,
  ownerId: string,
  sourceKey: string,
  trigger: "reactive" | "proactive" | null,
  sourceCount: number,
  occurredAt: string,
  reason: Exclude<C1EventReason, "epoch_owner_mismatch">,
): C1EventResult {
  addBlock(db, epoch.epochId, reason, sourceKey, occurredAt);
  if (sourceKeyWithinBounds(sourceKey)) {
    const detail = boundedDetail({
      schema: "c1-campaign-error/v1",
      reason,
    });
    if (detail) {
      const eventResult = writeEvent(db, {
        epochId: epoch.epochId,
        kind: "live_shadow",
        sourceKey,
        decisionClass: "evaluation_error",
        qualifies: false,
        trigger,
        sourceCount,
        detailJson: detail,
        occurredAt,
      });
      if (!eventResult.recorded && eventResult.reason === "source_key_collision") {
        addBlock(db, epoch.epochId, "source_key_collision", sourceKey, occurredAt);
        return eventResult;
      }
    }
  }
  return { recorded: false, reason };
}

function evaluationValidation(
  input: RecordC1EvaluationInput,
): C1EventReason | null {
  if (!sourceKeyWithinBounds(input.sourceKey) || !evaluationSourceKeyValid(input.sourceKey)) {
    return "invalid_source_key";
  }
  if (
    input.definitionId !== C1_EVALUATION_DEFINITION_ID ||
    input.definitionVersion !== C1_EVALUATION_DEFINITION_VERSION ||
    input.definitionHash !== C1_EVALUATION_DEFINITION_HASH
  ) {
    return "evaluation_definition_mismatch";
  }
  if (!Array.isArray(input.seeds) || input.seeds.length !== C1_REQUIRED_EVAL_SEEDS.length) {
    return "required_eval_seeds_incomplete";
  }
  const seen = new Set<string>();
  for (const seed of input.seeds) {
    if (!seed || typeof seed.id !== "string" || typeof seed.passed !== "boolean") {
      return "evaluation_definition_mismatch";
    }
    if (seen.has(seed.id) || !(C1_REQUIRED_EVAL_SEEDS as readonly string[]).includes(seed.id)) {
      return "evaluation_definition_mismatch";
    }
    seen.add(seed.id);
  }
  if (seen.size !== C1_REQUIRED_EVAL_SEEDS.length ||
      C1_REQUIRED_EVAL_SEEDS.some((seed) => !seen.has(seed))) {
    return "required_eval_seeds_incomplete";
  }
  return null;
}

function eventClassValid(input: RecordC1LiveShadowInput): boolean {
  if (!(C1_DECISION_CLASSES as readonly string[]).includes(input.decisionClass)) return false;
  if (input.trigger !== "reactive" && input.trigger !== "proactive") return false;
  if (!Number.isInteger(input.sourceCount) || input.sourceCount < 0 || input.sourceCount > 32) return false;
  const expectedQualifies = input.decisionClass !== "no_c1_material" &&
    input.decisionClass !== "unmapped_fail_closed" &&
    input.decisionClass !== "evaluation_error";
  return input.qualifies === expectedQualifies &&
    (expectedQualifies ? input.sourceCount > 0 : input.sourceCount === 0 || input.decisionClass !== "no_c1_material");
}

export function getCurrentMemoryEvidenceQualificationEpoch(
  db: DatabaseSync,
  ownerId?: string,
): MemoryEvidenceQualificationEpoch | null {
  const row = currentEpochRow(db);
  if (!row) return null;
  if (ownerId !== undefined && text(row.owner_id) !== normalized(ownerId)) return null;
  return epochFromRow(row);
}

export function listMemoryEvidenceQualificationEpochs(
  db: DatabaseSync,
  ownerId: string,
): MemoryEvidenceQualificationEpoch[] {
  const owner = normalized(ownerId);
  if (!owner) return [];
  return db.prepare(
    `SELECT * FROM memory_evidence_qualification_epochs
     WHERE owner_id = ? ORDER BY started_at ASC, epoch_id ASC`,
  ).all(owner).filter(isRow).map(epochFromRow);
}

export function startMemoryEvidenceQualificationEpoch(
  db: DatabaseSync,
  input: StartC1EpochInput,
  now = new Date(),
): StartC1EpochResult {
  const ownerId = normalized(input.ownerId);
  const requestKey = normalized(input.startRequestKey);
  if (!ownerId) return { ok: false, reason: "owner_required", currentEpochId: null };
  if (!requestKey) return { ok: false, reason: "request_key_required", currentEpochId: null };
  const predecessor = input.predecessorEpochId === null
    ? null
    : normalized(input.predecessorEpochId);
  const startedAt = now.toISOString();

  return withImmediateTransaction(db, () => {
    ensureBootstrapContract(db);
    const replay = db.prepare(
      `SELECT * FROM memory_evidence_qualification_epochs
       WHERE start_request_key = ?`,
    ).get(requestKey);
    if (isRow(replay)) {
      if (text(replay.owner_id) !== ownerId) {
        return {
          ok: false,
          reason: "epoch_owner_mismatch",
          currentEpochId: nullableText(replay.epoch_id),
        };
      }
      return {
        ok: true,
        created: false,
        epochId: text(replay.epoch_id),
        predecessorEpochId: nullableText(replay.predecessor_epoch_id),
        startedAt: text(replay.started_at),
      };
    }

    const current = currentEpochRow(db);
    const currentEpochId = current ? text(current.epoch_id) : null;
    if (current && text(current.owner_id) !== ownerId) {
      return { ok: false, reason: "epoch_owner_mismatch", currentEpochId };
    }
    const state = getMemoryContractState(db);
    if (state?.currentnessAuthority !== "mem_facts") {
      return { ok: false, reason: "currentness_not_mem_facts", currentEpochId };
    }
    if (capabilityState(db, "memory_evidence") !== "observe") {
      return { ok: false, reason: "memory_evidence_not_observe", currentEpochId };
    }
    if (capabilityState(db, "recall") !== "active") {
      return { ok: false, reason: "recall_not_active", currentEpochId };
    }
    if (!recallCutoffExists(db, ownerId)) {
      return { ok: false, reason: "recall_cutoff_missing", currentEpochId };
    }
    const contract = db.prepare(
      `SELECT contract_id FROM capability_contracts WHERE active = 1`,
    ).get();
    if (!isRow(contract) || text(contract.contract_id) !== currentContractId()) {
      return { ok: false, reason: "contract_identity_mismatch", currentEpochId };
    }
    const buildIdentity = currentBuildIdentity();
    if (!buildIdentity) {
      return { ok: false, reason: "build_identity_mismatch", currentEpochId };
    }
    if (currentEpochId !== predecessor) {
      return { ok: false, reason: "epoch_changed", currentEpochId };
    }

    if (currentEpochId) {
      const retired = db.prepare(
        `UPDATE memory_evidence_qualification_epochs
         SET status = 'retired', retired_at = ?
         WHERE epoch_id = ? AND status = 'current'`,
      ).run(startedAt, currentEpochId);
      if (Number(retired.changes) !== 1) throw new Error("c1_epoch_current_transition_lost");
    }

    const epochId = randomUUID();
    db.prepare(
      `INSERT INTO memory_evidence_qualification_epochs
         (epoch_id, status, start_request_key, predecessor_epoch_id, owner_id,
          contract_id, started_build_identity, created_by, started_at)
       VALUES (?, 'current', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      epochId,
      requestKey,
      currentEpochId,
      ownerId,
      currentContractId(),
      buildIdentity,
      ownerId,
      startedAt,
    );
    return {
      ok: true,
      created: true,
      epochId,
      predecessorEpochId: currentEpochId,
      startedAt,
    };
  });
}

export function recordMemoryEvidenceIsolatedEvaluation(
  db: DatabaseSync,
  input: RecordC1EvaluationInput,
  now = new Date(),
): C1EventResult {
  const epoch = currentEpochForOwner(db, normalized(input.ownerId));
  if (!epoch) {
    const current = currentEpochRow(db);
    return current && text(current.owner_id) !== normalized(input.ownerId)
      ? { recorded: false, reason: "epoch_owner_mismatch" }
      : { recorded: false, reason: "no_current_epoch" };
  }
  if (epoch.sealedAt !== null) return { recorded: false, reason: "epoch_sealed" };
  const invalid = evaluationValidation(input);
  if (invalid) return { recorded: false, reason: invalid };
  const occurredAt = input.occurredAt ?? now.toISOString();
  return withImmediateTransaction(db, () => {
    const binding = bindingFailure(db, epoch, normalized(input.ownerId));
    if (binding) {
      if (binding === "epoch_owner_mismatch") return { recorded: false, reason: binding };
      return recordBindingFailure(
        db,
        epoch,
        normalized(input.ownerId),
        input.sourceKey,
        null,
        0,
        occurredAt,
        binding,
      );
    }
    const passed = input.seeds.every((seed) => seed.passed);
    const detail = boundedDetail({
      schema: "c1-evaluation-receipt/v1",
      definitionId: C1_EVALUATION_DEFINITION_ID,
      definitionVersion: C1_EVALUATION_DEFINITION_VERSION,
      definitionHash: C1_EVALUATION_DEFINITION_HASH,
      seeds: [...input.seeds].sort((left, right) => left.id.localeCompare(right.id)),
    });
    if (!detail) return { recorded: false, reason: "invalid_receipt" };
    const result = writeEvent(db, {
      epochId: epoch.epochId,
      kind: "isolated_eval",
      sourceKey: input.sourceKey,
      decisionClass: null,
      qualifies: passed,
      trigger: null,
      sourceCount: 0,
      detailJson: detail,
      occurredAt,
    });
    if (!result.recorded && result.reason === "source_key_collision") {
      addBlock(db, epoch.epochId, "source_key_collision", input.sourceKey, occurredAt);
      return result;
    }
    if (result.recorded) {
      db.prepare(
        `UPDATE memory_evidence_qualification_epochs
         SET eval_seed_count = MAX(eval_seed_count, ?),
             qualified_at = CASE WHEN ? = 1 THEN COALESCE(qualified_at, ?) ELSE qualified_at END
         WHERE epoch_id = ? AND status = 'current'`,
      ).run(input.seeds.length, passed ? 1 : 0, occurredAt, epoch.epochId);
    }
    return result;
  });
}

export function recordMemoryEvidenceLiveShadow(
  db: DatabaseSync,
  input: RecordC1LiveShadowInput,
  now = new Date(),
): C1EventResult {
  const ownerId = normalized(input.ownerId);
  const epoch = currentEpochForOwner(db, ownerId);
  if (!epoch) {
    const current = currentEpochRow(db);
    return current && text(current.owner_id) !== ownerId
      ? { recorded: false, reason: "epoch_owner_mismatch" }
      : { recorded: false, reason: "no_current_epoch" };
  }
  if (epoch.sealedAt !== null) return { recorded: false, reason: "epoch_sealed" };
  if (!sourceKeyWithinBounds(input.sourceKey) || !liveSourceKeyValid(input.sourceKey)) {
    return { recorded: false, reason: "invalid_source_key" };
  }
  if (!eventClassValid(input)) return { recorded: false, reason: "invalid_receipt" };
  const detail = boundedDetail(input.detail ?? {});
  if (!detail) return { recorded: false, reason: "invalid_receipt" };
  const occurredAt = input.occurredAt ?? now.toISOString();
  return withImmediateTransaction(db, () => {
    const binding = bindingFailure(db, epoch, ownerId);
    if (binding) {
      if (binding === "epoch_owner_mismatch") return { recorded: false, reason: binding };
      return recordBindingFailure(
        db,
        epoch,
        ownerId,
        input.sourceKey,
        input.trigger,
        input.sourceCount,
        occurredAt,
        binding,
      );
    }
    const result = writeEvent(db, {
      epochId: epoch.epochId,
      kind: "live_shadow",
      sourceKey: input.sourceKey,
      decisionClass: input.decisionClass,
      qualifies: input.qualifies,
      trigger: input.trigger,
      sourceCount: input.sourceCount,
      detailJson: detail,
      occurredAt,
    });
    if (!result.recorded && result.reason === "source_key_collision") {
      addBlock(db, epoch.epochId, "source_key_collision", input.sourceKey, occurredAt);
    } else if (
      result.recorded &&
      (input.decisionClass === "unmapped_fail_closed" || input.decisionClass === "evaluation_error")
    ) {
      addBlock(db, epoch.epochId, input.decisionClass, input.sourceKey, occurredAt);
    }
    return result;
  });
}

function emptyDecisionCounts(): Record<C1DecisionClass, number> {
  return Object.fromEntries(C1_DECISION_CLASSES.map((name) => [name, 0])) as Record<C1DecisionClass, number>;
}

function readinessBlockerFromEpoch(code: string | null): C1ReadinessBlocker | null {
  if (!code) return null;
  if (([
    "build_identity_mismatch",
    "contract_identity_mismatch",
    "currentness_not_mem_facts",
    "memory_evidence_not_observe",
    "recall_not_active",
    "recall_cutoff_missing",
    "source_key_collision",
    "unmapped_fail_closed",
    "evaluation_error",
  ] as string[]).includes(code)) {
    return code === "unmapped_fail_closed" || code === "evaluation_error"
      ? "blocking_witness_present"
      : code as C1ReadinessBlocker;
  }
  return "blocking_witness_present";
}

export function getMemoryEvidenceQualificationReadiness(
  db: DatabaseSync,
  ownerId: string,
  now = new Date(),
): MemoryEvidenceQualificationReadiness {
  const normalizedOwnerId = normalized(ownerId);
  const epochRow = currentEpochRow(db);
  const epoch = epochRow ? epochFromRow(epochRow) : null;
  const memoryState = capabilityState(db, "memory_evidence");
  const recallState = capabilityState(db, "recall");
  const marker = currentnessAuthority(db);
  const countsByTrigger = { reactive: 0, proactive: 0 };
  const countsByDecisionClass = emptyDecisionCounts();
  let observedCount = 0;
  let qualifyingCount = 0;
  let earliestQualifyingAt: string | null = null;
  let latestQualifyingAt: string | null = null;
  let blockingEventCount = 0;

  const blockers: C1ReadinessBlocker[] = [];
  const add = (code: C1ReadinessBlocker) => {
    if (!blockers.includes(code)) blockers.push(code);
  };

  if (!epoch) {
    add("no_current_epoch");
  } else if (epoch.ownerId !== normalizedOwnerId) {
    add("epoch_owner_mismatch");
  } else {
    const events = db.prepare(
      `SELECT kind, decision_class, qualifies, trigger, occurred_at
       FROM memory_evidence_qualification_events
       WHERE epoch_id = ? AND kind = 'live_shadow'
       ORDER BY occurred_at ASC, source_key ASC`,
    ).all(epoch.epochId).filter(isRow);
    observedCount = events.length;
    for (const event of events) {
      const decisionClass = text(event.decision_class) as C1DecisionClass;
      if (decisionClass in countsByDecisionClass) countsByDecisionClass[decisionClass] += 1;
      const trigger = text(event.trigger) as "reactive" | "proactive";
      if (trigger === "reactive" || trigger === "proactive") countsByTrigger[trigger] += 1;
      if (numberValue(event.qualifies) === 1) {
        qualifyingCount += 1;
        const at = text(event.occurred_at);
        if (!earliestQualifyingAt || at < earliestQualifyingAt) earliestQualifyingAt = at;
        if (!latestQualifyingAt || at > latestQualifyingAt) latestQualifyingAt = at;
      }
      if (decisionClass === "unmapped_fail_closed" || decisionClass === "evaluation_error") {
        blockingEventCount += 1;
      }
    }
    const epochBlock = readinessBlockerFromEpoch(epoch.blockCode);
    if (epochBlock) add(epochBlock);
    if (blockingEventCount > 0) add("blocking_witness_present");
  }

  const spanDays = earliestQualifyingAt && latestQualifyingAt
    ? Math.max(0, (Date.parse(latestQualifyingAt) - Date.parse(earliestQualifyingAt)) / 86_400_000)
    : 0;
  if (epoch && epoch.ownerId === normalizedOwnerId) {
    if (epoch.startedBuildIdentity !== currentBuildIdentity()) add("build_identity_mismatch");
    if (epoch.contractId !== currentContractId()) add("contract_identity_mismatch");
  }
  if (marker !== "mem_facts") add("currentness_not_mem_facts");
  if (memoryState !== "observe") add("memory_evidence_not_observe");
  if (recallState !== "active") add("recall_not_active");
  if (!recallCutoffExists(db, normalizedOwnerId)) add("recall_cutoff_missing");
  if (!epoch || epoch.ownerId !== normalizedOwnerId || epoch.evalSeedCount < C1_REQUIRED_EVAL_SEEDS.length || !epoch.qualifiedAt) {
    add("required_eval_seeds_incomplete");
  }
  if (qualifyingCount < 25) add("live_shadow_count_insufficient");
  if (spanDays < 7) add("live_shadow_span_insufficient");
  if (countsByTrigger.reactive < 1) add("reactive_witness_missing");
  if (countsByTrigger.proactive < 1) add("proactive_witness_missing");

  const orderedBlockers = ([
    "no_current_epoch",
    "epoch_owner_mismatch",
    "build_identity_mismatch",
    "contract_identity_mismatch",
    "currentness_not_mem_facts",
    "memory_evidence_not_observe",
    "recall_not_active",
    "recall_cutoff_missing",
    "required_eval_seeds_incomplete",
    "live_shadow_count_insufficient",
    "live_shadow_span_insufficient",
    "reactive_witness_missing",
    "proactive_witness_missing",
    "blocking_witness_present",
    "source_key_collision",
  ] as C1ReadinessBlocker[]).filter(
    (code): code is C1ReadinessBlocker => blockers.includes(code),
  );

  return {
    eligible: orderedBlockers.length === 0,
    blockerCodes: orderedBlockers,
    ownerId: normalizedOwnerId,
    epochId: epoch?.epochId ?? null,
    predecessorEpochId: epoch?.predecessorEpochId ?? null,
    epochStatus: epoch?.status ?? null,
    epochBuildIdentity: epoch?.startedBuildIdentity ?? null,
    epochContractId: epoch?.contractId ?? null,
    buildIdentity: currentBuildIdentity(),
    contractId: currentContractId(),
    evalSeedCount: epoch?.ownerId === normalizedOwnerId ? epoch.evalSeedCount : 0,
    qualifiedAt: epoch?.ownerId === normalizedOwnerId ? epoch.qualifiedAt : null,
    observedCount,
    qualifyingCount,
    nonQualifyingCount: observedCount - qualifyingCount,
    earliestQualifyingAt,
    latestQualifyingAt,
    spanDays,
    countsByTrigger,
    countsByDecisionClass,
    blockingEventCount,
    currentnessAuthority: marker,
    memoryEvidenceState: memoryState,
    recallState,
    recallCutoffPresent: recallCutoffExists(db, normalizedOwnerId),
  };
}

export function sealMemoryEvidenceQualificationEpoch(
  db: DatabaseSync,
  input: { ownerId: string; epochId: string; releaseId: string; sealedAt?: string },
): boolean {
  const epoch = getCurrentMemoryEvidenceQualificationEpoch(db, input.ownerId);
  if (!epoch || epoch.epochId !== input.epochId || epoch.sealedAt !== null) return false;
  const result = db.prepare(
    `UPDATE memory_evidence_qualification_epochs
     SET sealed_at = ?, sealed_release_id = ?
     WHERE epoch_id = ? AND status = 'current' AND sealed_at IS NULL`,
  ).run(input.sealedAt ?? new Date().toISOString(), input.releaseId, input.epochId);
  return Number(result.changes) === 1;
}
