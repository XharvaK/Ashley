import { describe, expect, it } from "vitest";
import { M6_MAX_STEPS } from "./limits.js";
import { admitBoundedOperationSequence, runBoundedOperation } from "./controller.js";
import type { M6StepSpec } from "./types.js";

const WRITE: M6StepSpec = {
  kind: "candidate_workspace_experiment",
  operation: "workspace.write_file",
};
const VERIFY: M6StepSpec = {
  kind: "candidate_verification",
  operation: "workspace.verify",
};
const AUTHOR: M6StepSpec = {
  kind: "candidate_authorship",
  operation: "changeset.author",
};

describe("M6 bounded operation controller", () => {
  it("refuses continue-until-solved", () => {
    expect(
      admitBoundedOperationSequence({
        steps: [WRITE, VERIFY],
        maxSteps: 2,
        continueUntilSolved: true,
      }),
    ).toEqual({ ok: false, reason: "unbounded_continue_forbidden" });
  });

  it("refuses a ceiling above the hard bound or a longer sequence than admitted", () => {
    expect(
      admitBoundedOperationSequence({
        steps: [WRITE, VERIFY],
        maxSteps: M6_MAX_STEPS + 1,
      }),
    ).toEqual({ ok: false, reason: "operation_ceiling_exceeded" });
    expect(
      admitBoundedOperationSequence({
        steps: [WRITE, VERIFY],
        maxSteps: 8,
      }),
    ).toEqual({ ok: false, reason: "operation_ceiling_exceeded" });
  });

  it("refuses empty sequences", () => {
    expect(admitBoundedOperationSequence({ steps: [], maxSteps: 0 })).toEqual({
      ok: false,
      reason: "empty_sequence",
    });
  });

  it("refuses M7 effect names at admission", () => {
    expect(
      admitBoundedOperationSequence({
        steps: [{ kind: "patch_export", operation: "patch_export" }, VERIFY],
        maxSteps: 2,
      }),
    ).toEqual({ ok: false, reason: "m7_effect_forbidden" });
    expect(
      admitBoundedOperationSequence({
        steps: [{ kind: "candidate_authorship", operation: "changeset.apply" }],
        maxSteps: 1,
      }),
    ).toEqual({ ok: false, reason: "m7_effect_forbidden" });
  });

  it("refuses M1/M2 operations as unpermitted", () => {
    expect(
      admitBoundedOperationSequence({
        steps: [{ kind: "project_inspection", operation: "project.read_file" }],
        maxSteps: 1,
      }),
    ).toEqual({ ok: false, reason: "unpermitted_operation" });
  });

  it("executes an admitted M3→M4→M5 sequence once each and stops", async () => {
    const seen: string[] = [];
    const result = await runBoundedOperation({
      steps: [WRITE, VERIFY, AUTHOR],
      maxSteps: 3,
      deadlineAtMs: Date.now() + 60_000,
      executeStep: async (step) => {
        seen.push(`${step.kind}:${step.operation}`);
        return { ok: true };
      },
    });
    expect(result.stopReason).toBe("succeeded");
    expect(result.stepsExecuted).toBe(3);
    expect(result.borderState).toBe("none");
    expect(seen).toEqual([
      "candidate_workspace_experiment:workspace.write_file",
      "candidate_verification:workspace.verify",
      "candidate_authorship:changeset.author",
    ]);
  });

  it("stops on the first failure and does not continue", async () => {
    const seen: string[] = [];
    const result = await runBoundedOperation({
      steps: [WRITE, VERIFY, AUTHOR],
      maxSteps: 3,
      deadlineAtMs: Date.now() + 60_000,
      executeStep: async (step) => {
        seen.push(step.kind);
        if (step.kind === "candidate_verification") {
          return { ok: false, error: "recipe_not_allowed" };
        }
        return { ok: true };
      },
    });
    expect(result.stopReason).toBe("step_failed");
    expect(result.stepsExecuted).toBe(2);
    expect(seen).toEqual(["candidate_workspace_experiment", "candidate_verification"]);
    expect(result.stepRecords[1]?.error).toBe("recipe_not_allowed");
  });

  it("stops on deadline before the next step", async () => {
    let now = 1000;
    const result = await runBoundedOperation({
      steps: [WRITE, VERIFY],
      maxSteps: 2,
      deadlineAtMs: 1500,
      clock: { nowMs: () => now },
      executeStep: async () => {
        now = 2000;
        return { ok: true };
      },
    });
    expect(result.stopReason).toBe("deadline_exceeded");
    expect(result.stepsExecuted).toBe(1);
  });

  it("stops on cancel before the next step", async () => {
    let cancel = false;
    const result = await runBoundedOperation({
      steps: [WRITE, VERIFY],
      maxSteps: 2,
      deadlineAtMs: Date.now() + 60_000,
      cancelled: () => cancel,
      executeStep: async () => {
        cancel = true;
        return { ok: true };
      },
    });
    expect(result.stopReason).toBe("cancelled");
    expect(result.stepsExecuted).toBe(1);
  });

  it("maps child cleanup failure to cleanup_failure and stops", async () => {
    const result = await runBoundedOperation({
      steps: [WRITE, VERIFY],
      maxSteps: 2,
      deadlineAtMs: Date.now() + 60_000,
      executeStep: async () => ({ ok: false, error: "cleanup_failure" }),
    });
    expect(result.stopReason).toBe("cleanup_failure");
    expect(result.stepsExecuted).toBe(1);
    expect(result.borderState).toBe("none");
  });

  it("never sets a border other than none", async () => {
    const result = await runBoundedOperation({
      steps: [WRITE],
      maxSteps: 1,
      deadlineAtMs: Date.now() + 60_000,
      executeStep: async () => ({ ok: true }),
    });
    expect(result.borderState).toBe("none");
  });
});
