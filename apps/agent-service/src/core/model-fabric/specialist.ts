import {
  loadFabricCatalog,
  loadTargetPortfolio,
  type FabricSeat,
  type TargetPortfolio,
} from "./catalog.js";
import {
  walkApprovedChain,
  type ApprovedChainEntry,
  type HealthRegistry,
} from "./health.js";
import type {
  ModelFabricOccupant,
  ModelFabricPolicyRow,
} from "./portfolio.js";
import type { SpecialistRequirement, SpecialistSessionId } from "./types.js";

export function isEvaluationSeat(seat: FabricSeat): boolean {
  return seat.ownedBy === "Evaluation" || seat.seat.startsWith("evaluation_");
}

export function assertEvaluationSeatNotUserVisible(seat: FabricSeat): void {
  if (isEvaluationSeat(seat) && seat.userVisibleProductionRole) {
    throw new Error("evaluation_seat_user_visible");
  }
}

export type SpecialistResolution = Readonly<{
  requirement: SpecialistRequirement;
  seat: FabricSeat;
  policyRow: ModelFabricPolicyRow;
  occupant: ModelFabricOccupant;
  executedSpecialistSessionId: SpecialistSessionId | null;
}>;

export function resolveSpecialistSeat(input: {
  requirement: SpecialistRequirement;
  targetPortfolio?: TargetPortfolio;
  approvedChain?: readonly ApprovedChainEntry[];
  registry?: HealthRegistry;
  nowMs?: number;
}): SpecialistResolution {
  const targetPortfolio = input.targetPortfolio ?? loadTargetPortfolio();
  const seat = loadFabricCatalog().seats.find(
    (candidate) => candidate.seat === input.requirement.seat,
  );
  if (!seat) throw new Error("specialist_seat_catalog_missing");
  assertEvaluationSeatNotUserVisible(seat);
  if (!seat.candidateOnly) throw new Error("specialist_seat_not_candidate_only");

  const policyRow = targetPortfolio.rows.find(
    (row) => row.seat === input.requirement.seat,
  );
  if (!policyRow) throw new Error("specialist_seat_policy_row_missing");
  if (!input.approvedChain || !input.registry) {
    throw new Error("specialist_seat_not_active");
  }

  let walked;
  try {
    walked = walkApprovedChain({
      policyRowId: policyRow.policyRowId,
      candidates: input.approvedChain,
      registry: input.registry,
      nowMs: input.nowMs,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "no_approved_occupant_ready" ||
        error.message === "approved_chain_not_ordered")
    ) {
      throw new Error("specialist_seat_not_active");
    }
    throw error;
  }
  const selected = walked.selected.occupant;
  if (!policyRow.occupants.some((candidate) => candidate.occupantId === selected.occupantId)) {
    throw new Error("specialist_occupant_not_on_policy_row");
  }
  if (
    input.requirement.requiredIndependenceGroup &&
    selected.independenceGroup !== input.requirement.requiredIndependenceGroup
  ) {
    throw new Error("specialist_independence_group_mismatch");
  }
  return Object.freeze({
    requirement: input.requirement,
    seat,
    policyRow,
    occupant: selected,
    executedSpecialistSessionId: null,
  });
}

export type SpecialistExecutionWitness = Readonly<{
  schema: "ashley.model_fabric.specialist_execution_witness.v1";
  specialistSessionId: string;
  invocationId: string;
  dispatchTruth: "response_received" | "sent_outcome_unknown";
  providerRequestCount: 0 | 1;
  policyRowId: string;
  occupantId: string;
}>;

export function markSpecialistExecuted(
  resolution: SpecialistResolution,
  witness: SpecialistExecutionWitness,
): SpecialistResolution {
  if (resolution.executedSpecialistSessionId !== null) {
    throw new Error("specialist_session_already_recorded");
  }
  if (
    witness.schema !== "ashley.model_fabric.specialist_execution_witness.v1" ||
    witness.dispatchTruth !== "response_received" ||
    witness.providerRequestCount !== 1
  ) {
    throw new Error("specialist_execution_not_response_backed");
  }
  if (!witness.specialistSessionId.trim() || !witness.invocationId.trim()) {
    throw new Error("specialist_execution_witness_incomplete");
  }
  if (
    witness.policyRowId !== resolution.policyRow.policyRowId ||
    witness.occupantId !== resolution.occupant.occupantId
  ) {
    throw new Error("specialist_execution_witness_mismatch");
  }
  return Object.freeze({
    ...resolution,
    executedSpecialistSessionId: witness.specialistSessionId as SpecialistSessionId,
  });
}
