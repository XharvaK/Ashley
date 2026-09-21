import { describe, expect, it } from "vitest";
import { bindEffectIntent, bindObservationIntent } from "./operation-binding.js";

describe("Thought operation binding", () => {
  it("binds concern.inspect only with a Host-authored inspection expectation", () => {
    const intent = {
      kind: "observation_intent" as const,
      operationKind: "concern.inspect",
      request: { concernRef: "concern-dormant" },
      purpose: "read the dormant meaning",
      evidenceNeed: "the canonical statement",
      existingRefs: [],
    };
    expect(() => bindObservationIntent({
      intent,
      cycleId: "cycle-1",
      generation: 1,
      parentDeadlineAtMs: 10_000,
      nowMs: 2_000,
    })).toThrow("concern_inspection_binding_missing");
    const bound = bindObservationIntent({
      intent,
      cycleId: "cycle-1",
      generation: 1,
      parentDeadlineAtMs: 10_000,
      nowMs: 2_000,
      concernInspectExpectation: { snapshotHash: "snapshot-1", status: "dormant_but_revisitable" },
    });
    expect(bound.concernInspectionBinding).toEqual({
      concernId: "concern-dormant",
      expectedSnapshotHash: "snapshot-1",
      expectedStatus: "dormant_but_revisitable",
    });
    expect(bound.kind).toBe("concern.inspect");
  });

  it("creates kernel-owned observation identity and bounded deadline", () => {
    const result = bindObservationIntent({
      intent: {
        kind: "observation_intent",
        operationKind: "project.inspect",
        request: { projectId: "project-ashley", locator: { kind: "file", path: "README.md" } },
        purpose: "read evidence",
        evidenceNeed: "current contents",
        existingRefs: [],
      },
      cycleId: "cycle-1",
      generation: 1,
      parentDeadlineAtMs: 10_000,
      nowMs: 2_000,
    });
    expect(result.requestId).toMatch(/^observation:/);
    expect(result.correlationId).toBe(result.requestId);
    expect(result.deadlineAtMs).toBe(122_000);
    expect(result.replaySafe).toBe(true);
    expect(result.request).toEqual({ projectId: "project-ashley", locator: { kind: "file", path: "README.md" } });
  });

  it("creates kernel-owned effect identity with an operation-owned deadline", () => {
    const result = bindEffectIntent({
      intent: {
        kind: "effect_intent",
        operationKind: "workspace.write_file",
        request: { path: "candidate.txt", content: "x" },
        purpose: "prepare candidate",
        expectedOutcome: "file exists",
        existingRefs: [],
      },
      cycleId: "cycle-1",
      generation: 1,
      authorityEpoch: 2,
      parentDeadlineAtMs: 10_000,
      nowMs: 2_000,
    });
    expect(result.effectId).toMatch(/^effect:/);
    expect(result.idempotencyKey).toMatch(/^thought-effect:/);
    expect(result.authorityEpoch).toBe(2);
    expect(result.deadlineAtMs).toBe(122_000);
    expect(bindEffectIntent({
      intent: result.intent,
      cycleId: "cycle-1",
      generation: 1,
      authorityEpoch: 2,
      parentDeadlineAtMs: 2_000,
      nowMs: 2_000,
    }).deadlineAtMs).toBe(122_000);
  });
});
