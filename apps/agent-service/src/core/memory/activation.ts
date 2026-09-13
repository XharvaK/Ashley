import type { DatabaseSync } from "node:sqlite";
import type { CognitionMode } from "../types.js";
import { currentBuildIdentity, currentContractId, type CapabilityState } from "../rollout/capabilities.js";
import {
  getCurrentMemoryEvidenceQualificationEpoch,
  getMemoryEvidenceQualificationReadiness,
  type C1ReadinessBlocker,
  type MemoryEvidenceQualificationEpoch,
  type MemoryEvidenceQualificationReadiness,
} from "../rollout/memory-evidence-qualification-epoch.js";
import { getMemoryContractState } from "./contract-state.js";
import {
  C1_WRITER_INVENTORY,
  cutoverMemoryAssertions,
  verifyC1Consistency,
  type C1ConsistencyReport,
  type C1WriterInventoryEntry,
  type LegacyImpactInventory,
} from "./cutover.js";

export const C1_ACTIVATION_BLOCKERS = [
  "master_mode_not_observe",
  "expression_plane_not_paused",
  "owner_expression_active",
  "memory_evidence_not_active",
  "epoch_not_sealed",
  "epoch_sealed_to_other_release",
  "pre_cutover_consistency_failed",
] as const;

export type C1ActivationBlocker = typeof C1_ACTIVATION_BLOCKERS[number];
export type MemoryEvidenceCutoverBlocker = C1ReadinessBlocker | C1ActivationBlocker;

export type StickyCutoverDiagnostics = {
  currentnessAuthority: "mem_facts" | "memory_assertions" | null;
  reverseCutoverAvailable: false;
  rollbackRevertsCurrentness: false;
  barriersRemainEnforced: true;
  semanticSafetyFiltering: "assertions_barriers_and_terminations";
  releaseInfluence: "independent_capability_release_state";
};

export type MemoryEvidenceCutoverReadiness = Omit<
  MemoryEvidenceQualificationReadiness,
  "eligible" | "blockerCodes"
> & {
  eligible: boolean;
  qualification: MemoryEvidenceQualificationReadiness;
  qualificationBlockerCodes: C1ReadinessBlocker[];
  activationBlockerCodes: C1ActivationBlocker[];
  blockerCodes: MemoryEvidenceCutoverBlocker[];
  masterMode: CognitionMode;
  expressionPlanePaused: boolean;
  ownerExpressionActive: boolean;
  activeReleaseId: string;
  activeReleaseState: CapabilityState | "missing";
  epochSealedAt: string | null;
  epochSealedReleaseId: string | null;
  requestedEpochIdMatches: boolean;
  alreadyCutOver: boolean;
  preCutoverConsistency: C1ConsistencyReport;
  writerInventory: readonly C1WriterInventoryEntry[];
  stickyRollbackDiagnostics: StickyCutoverDiagnostics;
};

export type MemoryEvidenceCutoverResult =
  | {
      ok: false;
      reason: MemoryEvidenceCutoverBlocker;
      blockerCodes: MemoryEvidenceCutoverBlocker[];
      readiness: MemoryEvidenceCutoverReadiness;
    }
  | {
      ok: true;
      alreadyCutOver: boolean;
      epochId: string;
      releaseId: string;
      buildIdentity: string;
      contractId: string;
      markerBefore: NonNullable<ReturnType<typeof getMemoryContractState>>;
      markerAfter: NonNullable<ReturnType<typeof getMemoryContractState>>;
      consistencyBefore: C1ConsistencyReport;
      consistencyAfter: C1ConsistencyReport;
      impact: LegacyImpactInventory;
      stickyRollbackDiagnostics: StickyCutoverDiagnostics;
    };

export type MemoryEvidenceCutoverInput = {
  ownerId: string;
  epochId: string;
  masterMode: CognitionMode;
  expressionPlanePaused: boolean;
  ownerExpressionActive: boolean;
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function releaseStateReadOnly(
  db: DatabaseSync,
): CapabilityState | "missing" {
  const row = db.prepare(
    `SELECT state FROM capability_releases
     WHERE capability = 'memory_evidence' AND release_id = ?`,
  ).get(currentContractId());
  if (!isRow(row)) return "missing";
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

function failedConsistencyReport(
  db: DatabaseSync,
  error: unknown,
): C1ConsistencyReport {
  const state = getMemoryContractState(db);
  return {
    ok: false,
    currentnessAuthority: state?.currentnessAuthority ?? null,
    totalFacts: 0,
    totalAssertions: 0,
    mappedFacts: 0,
    unmappedFactIds: [],
    mismatchedFactIds: [],
    missingProjectionAssertionIds: [],
    independentWriterNames: [],
    errors: [`consistency_check_error:${error instanceof Error ? error.message : String(error)}`.slice(0, 500)],
  };
}

function readConsistency(
  db: DatabaseSync,
  at: string,
): C1ConsistencyReport {
  try {
    return verifyC1Consistency(db, {
      at,
      writerInventory: C1_WRITER_INVENTORY,
    });
  } catch (error) {
    return failedConsistencyReport(db, error);
  }
}

function orderedBlockers(
  qualificationBlockers: Iterable<C1ReadinessBlocker>,
  activationBlockers: Iterable<C1ActivationBlocker>,
): MemoryEvidenceCutoverBlocker[] {
  const found = new Set<MemoryEvidenceCutoverBlocker>([
    ...qualificationBlockers,
    ...activationBlockers,
  ]);
  const order: MemoryEvidenceCutoverBlocker[] = [
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
    ...C1_ACTIVATION_BLOCKERS,
  ];
  return order.filter((code) => found.has(code));
}

function activationQualificationBlockers(
  qualification: MemoryEvidenceQualificationReadiness,
  epoch: MemoryEvidenceQualificationEpoch | null,
  input: MemoryEvidenceCutoverInput,
  activeReleaseState: CapabilityState | "missing",
  marker: "mem_facts" | "memory_assertions" | null,
  consistency: C1ConsistencyReport,
): {
  qualificationBlockers: C1ReadinessBlocker[];
  activationBlockers: C1ActivationBlocker[];
  requestedEpochIdMatches: boolean;
} {
  const qualificationBlockers = new Set<C1ReadinessBlocker>(qualification.blockerCodes);
  const requestedEpochIdMatches = epoch?.ownerId === input.ownerId &&
    epoch.epochId === input.epochId;
  const exactSealedActiveEpoch = requestedEpochIdMatches &&
    epoch?.sealedAt !== null &&
    epoch?.sealedReleaseId === currentContractId() &&
    activeReleaseState === "active";

  // Qualification collection correctly requires observe. After the exact
  // epoch is sealed to the active release, that state transition is expected
  // and must not make activation readiness self-contradictory.
  if (exactSealedActiveEpoch) qualificationBlockers.delete("memory_evidence_not_observe");
  if (marker === "memory_assertions") qualificationBlockers.delete("currentness_not_mem_facts");

  const activationBlockers = new Set<C1ActivationBlocker>();
  if (input.masterMode !== "observe") activationBlockers.add("master_mode_not_observe");
  if (!input.expressionPlanePaused) activationBlockers.add("expression_plane_not_paused");
  if (input.ownerExpressionActive) activationBlockers.add("owner_expression_active");
  if (activeReleaseState !== "active") activationBlockers.add("memory_evidence_not_active");
  if (!requestedEpochIdMatches || epoch?.sealedAt === null) activationBlockers.add("epoch_not_sealed");
  if (epoch && epoch.sealedAt !== null && epoch.sealedReleaseId !== currentContractId()) {
    activationBlockers.add("epoch_sealed_to_other_release");
  }
  if (!consistency.ok) activationBlockers.add("pre_cutover_consistency_failed");
  return {
    qualificationBlockers: [...qualificationBlockers],
    activationBlockers: [...activationBlockers],
    requestedEpochIdMatches,
  };
}

function stickyDiagnostics(
  currentnessAuthority: "mem_facts" | "memory_assertions" | null,
): StickyCutoverDiagnostics {
  return {
    currentnessAuthority,
    reverseCutoverAvailable: false,
    rollbackRevertsCurrentness: false,
    barriersRemainEnforced: true,
    semanticSafetyFiltering: "assertions_barriers_and_terminations",
    releaseInfluence: "independent_capability_release_state",
  };
}

export function getMemoryEvidenceCutoverReadiness(
  db: DatabaseSync,
  input: MemoryEvidenceCutoverInput,
  now = new Date(),
): MemoryEvidenceCutoverReadiness {
  const ownerId = input.ownerId.trim();
  const epoch = getCurrentMemoryEvidenceQualificationEpoch(db);
  const qualification = getMemoryEvidenceQualificationReadiness(db, ownerId, now);
  const marker = getMemoryContractState(db)?.currentnessAuthority ?? null;
  const activeReleaseState = releaseStateReadOnly(db);
  const preCutoverConsistency = readConsistency(db, now.toISOString());
  const {
    qualificationBlockers,
    activationBlockers,
    requestedEpochIdMatches,
  } = activationQualificationBlockers(
    qualification,
    epoch,
    { ...input, ownerId },
    activeReleaseState,
    marker,
    preCutoverConsistency,
  );
  const blockers = orderedBlockers(qualificationBlockers, activationBlockers);
  const exactEpoch = epoch?.ownerId === ownerId ? epoch : null;
  return {
    ...qualification,
    qualification,
    qualificationBlockerCodes: qualificationBlockers,
    activationBlockerCodes: activationBlockers,
    blockerCodes: blockers,
    eligible: blockers.length === 0,
    masterMode: input.masterMode,
    expressionPlanePaused: input.expressionPlanePaused,
    ownerExpressionActive: input.ownerExpressionActive,
    activeReleaseId: currentContractId(),
    activeReleaseState,
    epochSealedAt: exactEpoch?.sealedAt ?? null,
    epochSealedReleaseId: exactEpoch?.sealedReleaseId ?? null,
    requestedEpochIdMatches,
    alreadyCutOver: marker === "memory_assertions",
    preCutoverConsistency,
    writerInventory: C1_WRITER_INVENTORY,
    stickyRollbackDiagnostics: stickyDiagnostics(marker),
  };
}

export function executeMemoryEvidenceCutover(
  db: DatabaseSync,
  input: MemoryEvidenceCutoverInput,
  now = new Date(),
): MemoryEvidenceCutoverResult {
  const readiness = getMemoryEvidenceCutoverReadiness(db, input, now);
  if (!readiness.eligible) {
    return {
      ok: false,
      reason: readiness.blockerCodes[0] ?? "pre_cutover_consistency_failed",
      blockerCodes: readiness.blockerCodes,
      readiness,
    };
  }

  const epoch = getCurrentMemoryEvidenceQualificationEpoch(db, input.ownerId);
  const markerBefore = getMemoryContractState(db);
  if (!epoch || !markerBefore) {
    // This is unreachable after readiness passed, but keeping the failure
    // typed prevents an accidental unguarded migration if a future caller
    // bypasses the readiness object.
    return {
      ok: false,
      reason: "no_current_epoch",
      blockerCodes: ["no_current_epoch"],
      readiness,
    };
  }
  const cutover = cutoverMemoryAssertions(db, {
    now: now.toISOString(),
    writerInventory: C1_WRITER_INVENTORY,
  });
  const markerAfter = cutover.marker;
  return {
    ok: true,
    alreadyCutOver: markerBefore.currentnessAuthority === "memory_assertions",
    epochId: epoch.epochId,
    releaseId: currentContractId(),
    buildIdentity: currentBuildIdentity(),
    contractId: currentContractId(),
    markerBefore,
    markerAfter,
    consistencyBefore: readiness.preCutoverConsistency,
    consistencyAfter: cutover.consistency,
    impact: cutover.impact,
    stickyRollbackDiagnostics: stickyDiagnostics(markerAfter.currentnessAuthority),
  };
}
