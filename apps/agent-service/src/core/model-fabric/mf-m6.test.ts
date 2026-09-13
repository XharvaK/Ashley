import { describe, expect, it } from "vitest";
import {
  loadFabricCatalog,
  loadTargetPortfolio,
} from "./catalog.js";
import { createHealthRegistry, type ApprovedChainEntry } from "./health.js";
import {
  assertEvaluationSeatNotUserVisible,
  isEvaluationSeat,
  markSpecialistExecuted,
  resolveSpecialistSeat,
} from "./specialist.js";

const target = loadTargetPortfolio();
const validationRow = target.rows.find(
  (row) => row.seat === "routine_validation",
)!;
const validationOccupant = validationRow.occupants[0]!;

function approvedValidationEntry(): ApprovedChainEntry {
  return {
    occupant: validationOccupant,
    qualification: {
      schema: "ashley.evaluation.qualification_result.v1",
      qualificationResultId: "qres_lightning_validation",
      status: "PASS",
      policyRowId: validationRow.policyRowId,
      occupantId: validationOccupant.occupantId,
      invalidated: false,
    },
    ownerApproval: {
      ownerApprovalRefId: "approval_lightning_validation",
      decision: "approve",
      revoked: false,
      policyRowId: validationRow.policyRowId,
      occupantId: validationOccupant.occupantId,
      qualificationResultId: "qres_lightning_validation",
    },
    catalogLifecycle: "owner_approved",
  };
}

describe("MF-M6 specialist seats", () => {
  it("resolves a generic requirement only through an approved target chain", () => {
    const resolution = resolveSpecialistSeat({
      requirement: { seat: "routine_validation" },
      targetPortfolio: target,
      approvedChain: [approvedValidationEntry()],
      registry: createHealthRegistry(() => 1000),
      nowMs: 1000,
    });

    expect(resolution.seat.seat).toBe("routine_validation");
    expect(resolution.policyRow.policyRowId).toBe(validationRow.policyRowId);
    expect(resolution.occupant.occupantId).toBe(validationOccupant.occupantId);
    expect(resolution.executedSpecialistSessionId).toBeNull();
  });

  it("keeps routine_validation dark when owner-backed records are absent", () => {
    expect(() =>
      resolveSpecialistSeat({
        requirement: { seat: "routine_validation" },
        targetPortfolio: target,
      }),
    ).toThrow("specialist_seat_not_active");
  });

  it("rejects an occupant from the wrong independence group", () => {
    expect(() =>
      resolveSpecialistSeat({
        requirement: {
          seat: "routine_validation",
          requiredIndependenceGroup: "openai_gpt_oss",
        },
        targetPortfolio: target,
        approvedChain: [approvedValidationEntry()],
        registry: createHealthRegistry(() => 1000),
        nowMs: 1000,
      }),
    ).toThrow("specialist_independence_group_mismatch");
  });

  it("does not use the routine-validation row for current engineering cognition", () => {
    const engineeringRows = target.rows.filter(
      (row) => row.logicalRole === "engineering",
    );
    expect(engineeringRows.some((row) => row.seat === "routine_validation")).toBe(
      true,
    );
    expect(validationRow.purposes).toEqual(["execution.verify"]);
    expect(validationRow.seat).toBe("routine_validation");
  });

  it("keeps Evaluation seats non-user-visible and independently owned", () => {
    const catalog = loadFabricCatalog();
    const independentJudge = catalog.seats.find(
      (seat) => seat.seat === "evaluation_independent_judge",
    )!;
    expect(isEvaluationSeat(independentJudge)).toBe(true);
    expect(independentJudge.userVisibleProductionRole).toBe(false);
    expect(() => assertEvaluationSeatNotUserVisible(independentJudge)).not.toThrow();
  });

  it("does not fabricate a SpecialistSession before execution", () => {
    const resolution = resolveSpecialistSeat({
      requirement: { seat: "routine_validation" },
      targetPortfolio: target,
      approvedChain: [approvedValidationEntry()],
      registry: createHealthRegistry(() => 1000),
      nowMs: 1000,
    });
    expect(resolution.executedSpecialistSessionId).toBeNull();
    expect("specialistSessionId" in resolution).toBe(false);
  });

  it("records a specialist session only from a matching response-backed witness", () => {
    const resolution = resolveSpecialistSeat({
      requirement: { seat: "routine_validation" },
      targetPortfolio: target,
      approvedChain: [approvedValidationEntry()],
      registry: createHealthRegistry(() => 1000),
      nowMs: 1000,
    });
    expect(() =>
      markSpecialistExecuted(resolution, {
        schema: "ashley.model_fabric.specialist_execution_witness.v1",
        specialistSessionId: "sess_lightning_1",
        invocationId: "inv_lightning_1",
        dispatchTruth: "sent_outcome_unknown",
        providerRequestCount: 1,
        policyRowId: validationRow.policyRowId,
        occupantId: validationOccupant.occupantId,
      }),
    ).toThrow("specialist_execution_not_response_backed");

    const completed = markSpecialistExecuted(resolution, {
      schema: "ashley.model_fabric.specialist_execution_witness.v1",
      specialistSessionId: "sess_lightning_1",
      invocationId: "inv_lightning_1",
      dispatchTruth: "response_received",
      providerRequestCount: 1,
      policyRowId: validationRow.policyRowId,
      occupantId: validationOccupant.occupantId,
    });
    expect(completed.executedSpecialistSessionId).toBe("sess_lightning_1");
  });
});
