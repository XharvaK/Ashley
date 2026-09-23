import { describe, expect, it } from "vitest";
import { applyV021Forget } from "../memory/forget.js";
import { listInFlightForThoughtCycle, putInFlight, recordEffectReceipt } from "../effect/in-flight.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import type { EffectReceipt, InFlightRecord } from "../types.js";
import { mintEffectRef } from "../effect/effect-ref.js";
import { projectInFlightConsequence } from "./consequence-projection.js";

const verificationClaim = {
  verified: true as const,
  projectId: "project-ashley",
  workspaceId: "workspace-candidate",
  snapshotId: "snapshot-42",
  candidateTreeHash: "a".repeat(64),
  recipeId: "focused-tests",
  recipeVersion: "3",
  recipeDefinitionHash: "b".repeat(64),
  protocolState: "admitted" as const,
  verificationOutcome: "verified_failure" as const,
  completedAtMs: 1_740_000_000_123,
};

function effect(overrides: Partial<InFlightRecord> = {}): InFlightRecord {
  return {
    effectId: "durable-effect-id",
    cycleId: "cycle-1",
    generation: 2,
    wakeId: "wake-1",
    correlationId: "correlation-1",
    idempotencyKey: "idempotency-1",
    status: "receipted",
    dispatchedAtMs: 100,
    originJobId: null,
    originEventId: "event-1",
    originAttemptId: null,
    operationKind: "workspace.verify",
    request: { projectId: "project-ashley", workspaceId: "workspace-candidate", recipeId: "focused-tests" },
    ...overrides,
  };
}

function receipt(claims: Record<string, unknown>, overrides: Partial<EffectReceipt> = {}): EffectReceipt {
  return {
    receiptId: "durable-receipt-id",
    effectId: "durable-effect-id",
    idempotencyKey: "idempotency-1",
    outcome: "succeeded",
    claims,
    atMs: 1_740_000_000_456,
    dataClassification: "never_public",
    secretOmitted: false,
    ...overrides,
  };
}

describe("Thought consequence projection", () => {
  it("projects an admitted verification success as material distinct from receipt truth", () => {
    const projected = projectInFlightConsequence(effect({
      receipt: receipt({
        state: "succeeded",
        profile: "candidate_verification",
        verificationClaimEffect: { ...verificationClaim, verificationOutcome: "verified_success" },
      }),
    }), "cycle-success", 2);

    expect(projected).toMatchObject({
      operationKind: "workspace.verify",
      receipt: { outcome: "succeeded" },
      licensedProfile: "candidate_verification",
      material: {
        snapshotId: "snapshot-42",
        candidateTreeHash: "a".repeat(64),
        recipeId: "focused-tests",
        recipeVersion: "3",
        recipeDefinitionHash: "b".repeat(64),
        verificationOutcome: "verified_success",
        completedAtMs: 1_740_000_000_123,
      },
    });
    expect(projected.material?.verificationOutcome).not.toBe(projected.receipt?.outcome);
    expect(projected).not.toHaveProperty("route");
    expect(projected).not.toHaveProperty("executor");
  });

  it("preserves receipt truth separately from licensed candidate verification", () => {
    const projected = projectInFlightConsequence(effect({
      receipt: receipt({ state: "succeeded", profile: "candidate_verification", verificationClaimEffect: verificationClaim }),
    }), "cycle-successor", 3);

    expect(projected).toMatchObject({
      effectRef: mintEffectRef("cycle-successor", 3, "durable-effect-id"),
      operationKind: "workspace.verify",
      status: "receipted",
      receipt: { outcome: "succeeded", atMs: 1_740_000_000_456 },
      licensedProfile: "candidate_verification",
      target: { projectId: "project-ashley", workspaceId: "workspace-candidate" },
      provenance: {
        receiptRef: "durable-receipt-id",
        snapshotId: "snapshot-42",
        recipeId: "focused-tests",
        recipeVersion: "3",
        recipeDefinitionHash: "b".repeat(64),
      },
      material: {
        snapshotId: "snapshot-42",
        candidateTreeHash: "a".repeat(64),
        recipeId: "focused-tests",
        recipeVersion: "3",
        recipeDefinitionHash: "b".repeat(64),
        verificationOutcome: "verified_failure",
        completedAtMs: 1_740_000_000_123,
      },
    });
    expect(JSON.stringify(projected)).not.toContain("durable-effect-id");
    expect(JSON.stringify(projected)).not.toContain("idempotency-1");
    expect(projected.material?.verificationOutcome).not.toBe(projected.receipt?.outcome);
  });

  it("reports a known operation with no licensed result without inventing verification", () => {
    const projected = projectInFlightConsequence(effect({
      status: "unknown",
      receipt: receipt({ state: "outcome_unknown", profile: "candidate_verification" }, { outcome: "outcome_unknown" }),
    }), "cycle-1", 2);

    expect(projected.receipt?.outcome).toBe("outcome_unknown");
    expect(projected.materialAvailability).toBe("NOT_PRODUCED");
    expect(projected).not.toHaveProperty("material");
    expect(projected).not.toHaveProperty("licensedProfile");
  });

  it("does not invent legacy operation identity and marks forgotten material restricted", () => {
    const legacy = projectInFlightConsequence(effect({
      operationKind: undefined,
      receipt: receipt({ redacted: true }),
      request: { redacted: true },
      payloadRedacted: true,
    }), "cycle-successor", 3);

    expect(legacy.operationKind).toBeUndefined();
    expect(legacy.operationKindAvailability).toBe("RESTRICTED");
    expect(legacy.targetAvailability).toBe("RESTRICTED");
    expect(legacy.materialAvailability).toBe("RESTRICTED");
    expect(legacy).not.toHaveProperty("licensedProfile");
    expect(legacy).not.toHaveProperty("material");
  });

  it("marks a historical row without retained kind as NOT_RETAINED and keeps pending shapes compact", () => {
    const legacy = projectInFlightConsequence(effect({ operationKind: undefined, receipt: null }), "cycle-1", 2);
    expect(legacy).toMatchObject({
      effectRef: mintEffectRef("cycle-1", 2, "durable-effect-id"),
      status: "receipted",
      operationKindAvailability: "NOT_RETAINED",
    });
    expect(legacy).not.toHaveProperty("receipt");
    expect(legacy).not.toHaveProperty("material");
    expect(legacy).not.toHaveProperty("materialAvailability");
  });

  it("does not invent receipt or verification material for a pending effect", () => {
    const pending = projectInFlightConsequence(effect({ status: "in_flight", receipt: null }), "cycle-1", 2);
    expect(pending).toMatchObject({
      effectRef: mintEffectRef("cycle-1", 2, "durable-effect-id"),
      operationKind: "workspace.verify",
      status: "in_flight",
    });
    expect(pending).not.toHaveProperty("receipt");
    expect(pending).not.toHaveProperty("material");
    expect(pending).not.toHaveProperty("materialAvailability");
  });

  it("restricts private receipt claims in a non-owner audience", () => {
    const projected = projectInFlightConsequence(effect({
      receipt: receipt({ state: "succeeded", profile: "candidate_verification", verificationClaimEffect: verificationClaim }),
    }), "cycle-1", 2, { kind: "room", roomId: "room-1" });

    expect(projected.receipt?.outcome).toBe("succeeded");
    expect(projected.materialAvailability).toBe("RESTRICTED");
    expect(projected).not.toHaveProperty("material");
  });

  it("keeps forgotten effect details restricted through persisted mapping and projection", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-forget-consequence",
        conversationId: "thread-forget-consequence",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "event-forget-consequence",
        occupantId: "owner",
        nowMs: 1,
      });
      const retained = putInFlight(db, {
        effectId: "effect-forget-consequence",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        correlationId: "corr-forget-consequence",
        idempotencyKey: "idem-forget-consequence",
        payload: { topic: "private-candidate-path", path: "private-candidate-path/file.ts" },
        operationKind: "workspace.verify",
        originEventId: "event-forget-consequence",
      });
      recordEffectReceipt(db, receipt({
        state: "succeeded",
        profile: "candidate_verification",
        verificationClaimEffect: verificationClaim,
      }, {
        effectId: retained.effectId,
        idempotencyKey: "idem-forget-consequence",
      }));

      const forgotten = applyV021Forget(db, { topic: "private-candidate-path", nowMs: 2 });
      expect(forgotten.targets).toContainEqual({
        entityType: "v021_in_flight",
        entityUuid: retained.effectId,
        action: "cancel",
      });
      const mapped = listInFlightForThoughtCycle(db, cycle.cycleId)[0];
      const projected = projectInFlightConsequence(mapped!, cycle.cycleId, cycle.generation);

      expect(mapped).toMatchObject({ status: "unknown", request: { redacted: true }, payloadRedacted: true });
      expect(projected).toMatchObject({
        status: "unknown",
        operationKindAvailability: "RESTRICTED",
        targetAvailability: "RESTRICTED",
        receipt: { outcome: "succeeded" },
        materialAvailability: "RESTRICTED",
      });
      expect(projected).not.toHaveProperty("operationKind");
      expect(projected).not.toHaveProperty("target");
      expect(projected).not.toHaveProperty("material");
    } finally {
      db.close();
    }
  });

  it("does not expose a verification claim with missing minimum fields", () => {
    const incomplete = { ...verificationClaim };
    delete (incomplete as { candidateTreeHash?: string }).candidateTreeHash;
    const projected = projectInFlightConsequence(effect({
      receipt: receipt({ state: "succeeded", profile: "candidate_verification", verificationClaimEffect: incomplete }),
    }), "cycle-1", 2);

    expect(projected.materialAvailability).toBe("NOT_PRODUCED");
    expect(projected).not.toHaveProperty("material");
  });
});
