import { describe, expect, it } from "vitest";
import {
  createTurnDeadlinePlan,
  selectTurnDeadlineBranch,
  type TurnDeadlinePolicy,
} from "./turn-deadline-plan.js";

const admittedAtMs = 1_000_000;

const testPolicy: TurnDeadlinePolicy = {
  version: "phase-budget-test-v1",
  qualification: "test_only",
  softResponsivenessTargetMs: 50,
  initialThoughtMs: 100,
  externalTransportMs: 1_000,
  firstBubbleReceiptReserveMs: 100,
  finalDeliveryReserveMs: 900,
  ordinary: {
    perceptionMs: 100,
    expressionMs: 100,
    generationSettlementMs: 20,
  },
  sandboxM1: {
    childExecutionMs: 200,
    acquisitionSettlementMs: 50,
    cleanupReserveMs: 20,
    perceptionMs: 100,
    expressionMs: 100,
    generationSettlementMs: 20,
  },
  projectInspection: {
    projectInspectionPreparationMs: 80,
    childExecutionMs: {
      "project.read_file": 200,
      "project.list_directory": 220,
      "project.search_text": 240,
    },
    acquisitionSettlementMs: 50,
    cleanupReserveMs: 20,
    continuationMs: 100,
    perceptionMs: 100,
    expressionMs: 100,
    generationSettlementMs: 20,
  },
  candidateWorkspaceExperiment: {
    available: false,
    unavailableReason: "candidate_workspace_closed",
  },
};

describe("TurnDeadlinePlan", () => {
  it("precomputes and freezes one common prefix and every branch suffix", () => {
    const plan = createTurnDeadlinePlan(admittedAtMs, testPolicy);

    expect(plan.version).toBe("phase-budget-test-v1");
    expect(plan.qualification).toBe("test_only");
    expect(plan.common).toEqual({
      softResponsivenessTargetAtMs: admittedAtMs + 50,
      initialThoughtDeadlineAtMs: admittedAtMs + 100,
      externalTransportHardDeadlineAtMs: admittedAtMs + 1_000,
      firstBubbleReceiptDeadlineAtMs: admittedAtMs + 1_100,
      reservationHardDeadlineAtMs: admittedAtMs + 2_000,
    });
    expect(plan.branches.project_inspection.available).toBe(true);
    expect(plan.branches.candidate_workspace_experiment).toEqual({
      kind: "candidate_workspace_experiment",
      available: false,
      unavailableReason: "candidate_workspace_closed",
    });
    expect(plan.branches.candidate_verification).toEqual({
      kind: "candidate_verification",
      available: false,
      unavailableReason: "candidate_verification_unqualified",
    });
    expect(plan.branches.candidate_authorship).toEqual({
      kind: "candidate_authorship",
      available: false,
      unavailableReason: "candidate_authorship_unqualified",
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.common)).toBe(true);
    expect(Object.isFrozen(plan.branches)).toBe(true);
    expect(Object.isFrozen(plan.branches.project_inspection)).toBe(true);
    expect(Object.isFrozen(plan.branches.project_inspection.childExecutionDeadlineAtMs)).toBe(true);
    expect(plan.branches.sandbox_m1.childTerminationDeadlineAtMs).toBe(
      admittedAtMs + 330,
    );
    expect(plan.branches.project_inspection.projectInspectionPreparationDeadlineAtMs).toBe(
      admittedAtMs + 180,
    );
    expect(plan.branches.project_inspection.childTerminationDeadlineAtMs).toBe(
      admittedAtMs + 450,
    );
  });

  it("keeps branch deadlines unchanged when Pass 1 selects by reference", () => {
    const plan = createTurnDeadlinePlan(admittedAtMs, testPolicy);
    const before = JSON.stringify(plan);
    const selected = selectTurnDeadlineBranch(plan, "project_inspection");

    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error("expected selected branch");
    expect(selected.branch).toBe(plan.branches.project_inspection);
    expect(selected.branch.continuationDeadlineAtMs).toBe(admittedAtMs + 570);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("rejects unavailable and unknown branch selection without recomputing deadlines", () => {
    const plan = createTurnDeadlinePlan(admittedAtMs, testPolicy);

    expect(selectTurnDeadlineBranch(plan, "candidate_workspace_experiment")).toEqual({
      ok: false,
      reason: "candidate_workspace_closed",
    });
    expect(selectTurnDeadlineBranch(plan, "candidate_verification")).toEqual({
      ok: false,
      reason: "candidate_verification_unqualified",
    });
    expect(selectTurnDeadlineBranch(plan, "candidate_authorship")).toEqual({
      ok: false,
      reason: "candidate_authorship_unqualified",
    });
    expect(selectTurnDeadlineBranch(plan, "not-a-branch" as never)).toEqual({
      ok: false,
      reason: "deadline_branch_unknown",
    });
  });

  it("orders M2 preparation, child execution, termination, settlement, continuation, expression, generation, transport, receipt, and final delivery", () => {
    const plan = createTurnDeadlinePlan(admittedAtMs, testPolicy);
    const branch = plan.branches.project_inspection;
    if (!branch.available) throw new Error("project inspection unavailable");

    expect(plan.common.initialThoughtDeadlineAtMs).toBeLessThan(
      branch.projectInspectionPreparationDeadlineAtMs,
    );
    for (const childDeadline of Object.values(branch.childExecutionDeadlineAtMs)) {
      expect(branch.projectInspectionPreparationDeadlineAtMs).toBeLessThan(childDeadline);
      expect(childDeadline).toBeLessThan(branch.childTerminationDeadlineAtMs);
    }
    expect(branch.childTerminationDeadlineAtMs).toBeLessThan(
      branch.acquisitionSettlementDeadlineAtMs,
    );
    expect(branch.acquisitionSettlementDeadlineAtMs).toBeLessThan(
      branch.continuationDeadlineAtMs,
    );
    expect(branch.continuationDeadlineAtMs).toBeLessThan(branch.perceptionDeadlineAtMs);
    expect(branch.perceptionDeadlineAtMs).toBeLessThan(branch.expressionDeadlineAtMs);
    expect(branch.expressionDeadlineAtMs).toBeLessThan(branch.generationDeadlineAtMs);
    expect(branch.generationDeadlineAtMs).toBeLessThan(
      plan.common.externalTransportHardDeadlineAtMs,
    );
    expect(plan.common.externalTransportHardDeadlineAtMs).toBeLessThan(
      plan.common.firstBubbleReceiptDeadlineAtMs,
    );
    expect(plan.common.firstBubbleReceiptDeadlineAtMs).toBeLessThan(
      plan.common.reservationHardDeadlineAtMs,
    );
  });

  it.each([0, -1])("rejects cleanupReserveMs=%s", (cleanupReserveMs) => {
    expect(() =>
      createTurnDeadlinePlan(admittedAtMs, {
        ...testPolicy,
        projectInspection: {
          ...testPolicy.projectInspection,
          cleanupReserveMs,
        },
      }),
    ).toThrow("turn_deadline_policy_invalid:projectInspection.cleanupReserveMs");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects projectInspectionPreparationMs=%s",
    (projectInspectionPreparationMs) => {
      expect(() =>
        createTurnDeadlinePlan(admittedAtMs, {
          ...testPolicy,
          projectInspection: {
            ...testPolicy.projectInspection,
            projectInspectionPreparationMs,
          },
        }),
      ).toThrow(
        "turn_deadline_policy_invalid:projectInspection.projectInspectionPreparationMs",
      );
    },
  );

  it("anchors every M2 child deadline strictly after the preparation boundary", () => {
    const plan = createTurnDeadlinePlan(admittedAtMs, testPolicy);
    const branch = plan.branches.project_inspection;
    if (!branch.available) throw new Error("project inspection unavailable");
    for (const childDeadline of Object.values(branch.childExecutionDeadlineAtMs)) {
      expect(childDeadline).toBeGreaterThan(
        branch.projectInspectionPreparationDeadlineAtMs,
      );
    }
  });

  it("rejects a cleanup reserve that leaves no termination grace after the maximum child deadline", () => {
    expect(() =>
      createTurnDeadlinePlan(admittedAtMs, {
        ...testPolicy,
        projectInspection: {
          ...testPolicy.projectInspection,
          cleanupReserveMs: 50,
        },
      }),
    ).toThrow("turn_deadline_policy_invalid:projectInspection.termination_order");
  });

  it("uses the inbound transport cutoff as the real Discord authority while keeping receipt and final delivery distinct", () => {
    const externalTransportHardDeadlineAtMs = admittedAtMs + 1_500;
    const plan = createTurnDeadlinePlan(admittedAtMs, testPolicy, {
      externalTransportHardDeadlineAtMs,
    });

    expect(plan.common.externalTransportHardDeadlineAtMs).toBe(
      externalTransportHardDeadlineAtMs,
    );
    expect(plan.common.firstBubbleReceiptDeadlineAtMs).toBe(
      externalTransportHardDeadlineAtMs + 100,
    );
    expect(plan.common.reservationHardDeadlineAtMs).toBe(
      externalTransportHardDeadlineAtMs + 1_000,
    );
    expect(plan.branches.ordinary.generationDeadlineAtMs).toBe(
      admittedAtMs + 320,
    );
  });

  describe("PROVISIONAL_UNQUALIFIED_TURN_DEADLINE_POLICY (Production Default)", () => {
    it("accepts candidate_workspace_experiment with all 8 supported workspace operations", () => {
      const plan = createTurnDeadlinePlan(admittedAtMs);

      expect(plan.branches.ordinary.available).toBe(true);
      expect(plan.branches.sandbox_m1.available).toBe(true);
      expect(plan.branches.project_inspection.available).toBe(true);
      expect(plan.branches.candidate_workspace_experiment.available).toBe(true);
      expect(plan.branches.candidate_verification.available).toBe(true);
      if (!plan.branches.candidate_verification.available) {
        throw new Error("m4 deadline branch must default available after G2 promotion");
      }
      const m4 = selectTurnDeadlineBranch(plan, "candidate_verification");
      expect(m4.ok).toBe(true);
      if (!m4.ok) throw new Error("expected candidate verification branch to be available");
      expect(m4.branch.kind).toBe("candidate_verification");
      expect(m4.branch.childExecutionDeadlineAtMs).toBe(
        plan.common.initialThoughtDeadlineAtMs + 6_000,
      );
      expect(plan.branches.candidate_authorship.available).toBe(true);
      if (!plan.branches.candidate_authorship.available) {
        throw new Error("m5 deadline branch must default available after promotion");
      }
      const m5 = selectTurnDeadlineBranch(plan, "candidate_authorship");
      expect(m5.ok).toBe(true);
      if (!m5.ok) throw new Error("expected candidate authorship branch to be available");
      expect(m5.branch.kind).toBe("candidate_authorship");
      expect(m5.branch.childExecutionDeadlineAtMs).toBe(
        plan.common.initialThoughtDeadlineAtMs + 6_000,
      );

      const selected = selectTurnDeadlineBranch(plan, "candidate_workspace_experiment");
      expect(selected.ok).toBe(true);
      if (!selected.ok) throw new Error("expected candidate workspace branch to be available");

      const branch = selected.branch;
      expect(branch.kind).toBe("candidate_workspace_experiment");
      expect(branch.available).toBe(true);

      const expectedOperations = [
        "workspace.read_file",
        "workspace.list_directory",
        "workspace.search_text",
        "workspace.write_file",
        "workspace.replace_file",
        "workspace.edit_text",
        "workspace.delete_file",
        "workspace.create_directory",
      ] as const;

      for (const op of expectedOperations) {
        const childDeadline = branch.childExecutionDeadlineAtMs[op];
        expect(typeof childDeadline).toBe("number");
        expect(childDeadline).toBe(plan.common.initialThoughtDeadlineAtMs + 6_000);
        expect(plan.common.initialThoughtDeadlineAtMs).toBeLessThan(childDeadline);
        expect(childDeadline).toBeLessThan(branch.childTerminationDeadlineAtMs);
      }

      expect(branch.childTerminationDeadlineAtMs).toBeLessThan(
        branch.acquisitionSettlementDeadlineAtMs,
      );
      expect(branch.acquisitionSettlementDeadlineAtMs).toBeLessThan(
        branch.continuationDeadlineAtMs,
      );
      expect(branch.continuationDeadlineAtMs).toBeLessThan(
        branch.perceptionDeadlineAtMs,
      );
      expect(branch.perceptionDeadlineAtMs).toBeLessThan(
        branch.expressionDeadlineAtMs,
      );
      expect(branch.expressionDeadlineAtMs).toBeLessThan(
        branch.generationDeadlineAtMs,
      );
      expect(branch.generationDeadlineAtMs).toBeLessThan(
        plan.common.externalTransportHardDeadlineAtMs,
      );
    });

    it("preserves existing M1 and M2 deadline behavior in production default policy", () => {
      const plan = createTurnDeadlinePlan(admittedAtMs);

      const m1Selected = selectTurnDeadlineBranch(plan, "sandbox_m1");
      expect(m1Selected.ok).toBe(true);
      if (!m1Selected.ok) throw new Error("expected sandbox_m1 to be available");
      expect(m1Selected.branch.childExecutionDeadlineAtMs).toBe(
        plan.common.initialThoughtDeadlineAtMs + 30_000,
      );

      const m2Selected = selectTurnDeadlineBranch(plan, "project_inspection");
      expect(m2Selected.ok).toBe(true);
      if (!m2Selected.ok) throw new Error("expected project_inspection to be available");
      expect(m2Selected.branch.projectInspectionPreparationDeadlineAtMs).toBe(
        plan.common.initialThoughtDeadlineAtMs + 39_447,
      );
      expect(m2Selected.branch.childExecutionDeadlineAtMs["project.read_file"]).toBe(
        m2Selected.branch.projectInspectionPreparationDeadlineAtMs + 6_000,
      );
    });
  });
});
