import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertQueuedRequest, markRunning, tryAdmitRequest, bindThoughtAttempt, getThoughtAttempt } from "./ledger.js";
import { createFakeClock } from "./types.js";

describe("Attention Thought attempt binding", () => {
  it("persists the trusted Thought context and actual attempt facts exactly once", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const clock = createFakeClock(1_000);
    const allocationId = insertQueuedRequest(db, {
      lane: "interactive", purpose: "thought", modelAlias: "openai/gpt-oss-20b", providerId: "nim",
      quotaBucket: "nim:openai/gpt-oss-20b", estimatedInputTokens: 1, estimatedOutputTokens: 1,
      deadlineAtMs: 20_000,
    }, clock);
    expect(tryAdmitRequest(db, allocationId, clock).admitted).toBe(true);
    markRunning(db, allocationId, clock);
    bindThoughtAttempt(db, {
      allocationId,
      thoughtInvocationId: "thought-1", thoughtCycleId: "cycle-1", thoughtGeneration: 1,
      thoughtSemanticPass: 1, thoughtStructuralAttempt: 0, thoughtAuthorityEpoch: 1,
      thoughtAuthorityVectorJson: '{"authority":1}', thoughtTriggerRef: "turn-1",
      semanticProjectionHash: "sha256:p", dispatchMessagesHash: "sha256:m", allowlistFingerprint: "sha256:a",
      mfInvocationId: "mf-1", mfAttemptId: "attempt-1", actualProvider: "nim", actualOccupantId: "nim-thought",
      actualWireBindingId: "wire-1", schemaEnforcementMode: "native_json_schema", resourcePolicyFingerprint: "sha256:r",
      absoluteDeadlineAtMs: 20_000,
    });
    expect(getThoughtAttempt(db, allocationId)).toMatchObject({
      thought_invocation_id: "thought-1", mf_attempt_id: "attempt-1", actual_provider: "nim",
    });
    expect(() => bindThoughtAttempt(db, {
      allocationId, thoughtInvocationId: "thought-2", thoughtCycleId: "cycle-1", thoughtGeneration: 1,
      thoughtSemanticPass: 1, thoughtStructuralAttempt: 0, thoughtAuthorityEpoch: 1,
      thoughtAuthorityVectorJson: '{}', thoughtTriggerRef: "turn-1", semanticProjectionHash: "p",
      dispatchMessagesHash: "m", allowlistFingerprint: "a", mfInvocationId: "mf-2", mfAttemptId: "attempt-2",
      actualProvider: "nim", actualOccupantId: "nim-thought", actualWireBindingId: "wire-2",
      schemaEnforcementMode: "native_json_schema", resourcePolicyFingerprint: "r", absoluteDeadlineAtMs: 20_000,
    })).toThrow("thought_attempt_already_bound");
    db.close();
  });
});
