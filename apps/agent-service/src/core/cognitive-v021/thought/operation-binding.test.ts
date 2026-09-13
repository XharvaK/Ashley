import { describe, expect, it } from "vitest";
import { bindEffectIntent, bindObservationIntent } from "./operation-binding.js";

describe("Thought operation binding", () => {
  it("creates kernel-owned observation identity and bounded deadline", () => {
    const result = bindObservationIntent({
      intent: {
        kind: "observation_intent",
        operationKind: "project.read_file",
        request: { path: "README.md" },
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
    expect(result.deadlineAtMs).toBe(10_000);
    expect(result.replaySafe).toBe(true);
    expect(result.request).toEqual({ path: "README.md" });
  });

  it("creates kernel-owned effect identity and rejects an expired parent", () => {
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
    expect(() => bindEffectIntent({
      intent: result.intent,
      cycleId: "cycle-1",
      generation: 1,
      authorityEpoch: 2,
      parentDeadlineAtMs: 2_000,
      nowMs: 2_000,
    })).toThrow("deadline_exhausted");
  });
});
