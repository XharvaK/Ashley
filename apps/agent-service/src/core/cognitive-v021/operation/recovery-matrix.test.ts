import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { getInboxEvent } from "../cycle/inbox.js";
import {
  admitDetachedOperation,
  getActiveDetachedOperation,
  getDetachedOperation,
  markDetachedOperationStarted,
  reconcileDetachedOperations,
  requestDetachedOperationCancel,
  setDetachedOperationTerminal,
} from "./detached.js";
import { authorizeInterimSpeech, getInterimOutboxByOperation } from "./interim.js";
import { completionEventIdFor, reconcileMissingCompletions } from "./completion.js";
import type { ObservationIntentSemanticOutput } from "../types.js";

const HOLD_INTENT: ObservationIntentSemanticOutput = {
  kind: "observation_intent",
  operationKind: "project.investigate",
  request: { projectId: "project-ashley" },
  purpose: "investigate the service",
  evidenceNeed: "bounded file evidence",
  existingRefs: [],
  interimSpeech: { mode: "hold", surfaceDraft: "Yeah, give me a bit." },
};

function stage(conversationId: string) {
  const sidecar = openTestSidecar();
  const cycle = admitTestCycle(sidecar, {
    cycleId: `cycle-${conversationId}`,
    conversationId,
    triggerKind: "owner_message",
    triggerRef: "owner-1",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  return { sidecar, cycle };
}

function admitTestDetached(
  sidecar: ReturnType<typeof openTestSidecar>,
  cycle: ReturnType<typeof admitTestCycle>,
  intent: ObservationIntentSemanticOutput,
) {
  const nowMs = 1_000;
  const admitted = admitDetachedOperation(sidecar, {
    idempotencyKey: `detached:${cycle.conversationId}:${cycle.cycleId}:project.investigate`,
    conversationId: cycle.conversationId,
    originCycleId: cycle.cycleId,
    originGeneration: cycle.generation,
    originKind: "OWNER_REQUEST",
    originRef: "owner-1",
    originOwnerEventId: "owner-1",
    operationKind: "project.investigate",
    request: intent.request,
    purpose: intent.purpose,
    evidenceNeed: intent.evidenceNeed,
    operationDeadlineAtMs: nowMs + 300_000,
    nowMs,
  });
  if (!admitted.ok) return { detached: false as const, reason: admitted.reason };
  if (intent.interimSpeech?.mode !== "hold") {
    return { detached: true as const, operation: admitted.operation, interimId: null, interimAuthored: false };
  }
  const authorized = authorizeInterimSpeech(sidecar, {
    operationId: admitted.operation.operationId,
    surfaceDraft: intent.interimSpeech.surfaceDraft,
    deliveryIntent: {
      ownerId: "doc", channel: "discord", threadId: cycle.conversationId,
      conversationId: cycle.conversationId, trigger: "owner_message_reactive",
      deliveryLane: "reactive", purpose: "licensed_speech",
    },
    origin: "live",
    nowMs,
  });
  return authorized.ok
    ? { detached: true as const, operation: admitted.operation, interimId: authorized.interim.interimId, interimAuthored: true }
    : { detached: true as const, operation: admitted.operation, interimId: null, interimAuthored: false };
}

/**
 * Crash-boundary walk: every durable stage of a detached operation names
 * its recovery owner. No boundary is silent and none reruns work.
 */
describe("detached operation crash boundaries", () => {
  it("admission before interim leaves admitted work with no promissory text", () => {
    const { sidecar, cycle } = stage("thread-boundary-admit");
    try {
      const detached = admitTestDetached(sidecar, cycle, { ...HOLD_INTENT, interimSpeech: { mode: "none" } });
      if (!detached.detached) throw new Error("detach failed");
      expect(detached.interimAuthored).toBe(false);
      expect(getInterimOutboxByOperation(sidecar, detached.operation.operationId)).toBe(null);
      expect(getActiveDetachedOperation(sidecar, cycle.conversationId)?.state).toBe("admitted");
    } finally {
      sidecar.close();
    }
  });

  it("persisted interim binds the hold to admitted work", () => {
    const { sidecar, cycle } = stage("thread-boundary-interim");
    try {
      const detached = admitTestDetached(sidecar, cycle, HOLD_INTENT);
      if (!detached.detached || detached.interimId == null) throw new Error("detach failed");
      const interim = getInterimOutboxByOperation(sidecar, detached.operation.operationId);
      expect(interim?.sendStatus).toBe("pending");
      expect(getDetachedOperation(sidecar, detached.operation.operationId)?.interimOutboxRef)
        .toBe(`interim:${detached.interimId}`);
    } finally {
      sidecar.close();
    }
  });

  it("started work without terminal truth reconciles by expiry and request", () => {
    const { sidecar, cycle } = stage("thread-boundary-started");
    try {
      const admitted = admitDetachedOperation(sidecar, {
        idempotencyKey: "key-boundary-started",
        conversationId: cycle.conversationId,
        originCycleId: cycle.cycleId,
        originGeneration: 1,
        originOwnerEventId: "owner-1",
        operationKind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "investigate",
        evidenceNeed: "evidence",
        operationDeadlineAtMs: 50_000,
        nowMs: 1_000,
      });
      if (!admitted.ok) throw new Error("admission failed");
      const opId = admitted.operation.operationId;
      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "s", nowMs: 2_000 }).ok).toBe(true);
      // Unexpired: startup recovery leaves started work alone.
      expect(reconcileDetachedOperations(sidecar, 10_000).transitionedOperationIds).toEqual([]);
      expect(getDetachedOperation(sidecar, opId)?.state).toBe("started");
      // Expired started work may have executed: outcome_unknown, never rerun.
      expect(reconcileDetachedOperations(sidecar, 60_000).transitionedOperationIds).toEqual([opId]);
      expect(getDetachedOperation(sidecar, opId)?.state).toBe("outcome_unknown");
    } finally {
      sidecar.close();
    }
  });

  it("terminal truth without completion backfills exactly one pending wake", () => {
    const { sidecar, cycle } = stage("thread-boundary-terminal");
    try {
      const admitted = admitDetachedOperation(sidecar, {
        idempotencyKey: "key-boundary-terminal",
        conversationId: cycle.conversationId,
        originCycleId: cycle.cycleId,
        originGeneration: 1,
        originOwnerEventId: "owner-1",
        operationKind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "investigate",
        evidenceNeed: "evidence",
        operationDeadlineAtMs: 600_000,
        nowMs: 1_000,
      });
      if (!admitted.ok) throw new Error("admission failed");
      const opId = admitted.operation.operationId;
      expect(requestDetachedOperationCancel(sidecar, opId, 1_500).ok).toBe(true);
      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "s", nowMs: 2_000 }).ok).toBe(true);
      expect(setDetachedOperationTerminal(sidecar, opId, {
        terminalState: "failed",
        errorCode: "worker_failed",
        nowMs: 3_000,
      }).ok).toBe(true);
      // Crash between terminal commit and completion: no reference yet.
      expect(getDetachedOperation(sidecar, opId)?.completionEventRef).toBe(null);
      const reconciled = reconcileMissingCompletions(sidecar, { nowMs: 4_000 });
      expect(reconciled).toEqual({ produced: [completionEventIdFor(opId)], failures: [] });
      // Thought B pending: the wake waits, claimed by nobody, exactly once.
      const event = getInboxEvent(sidecar, completionEventIdFor(opId));
      expect(event).toMatchObject({ kind: "observation_or_receipt", status: "pending" });
      expect(getDetachedOperation(sidecar, opId)?.completionEventRef).toBe(completionEventIdFor(opId));
    } finally {
      sidecar.close();
    }
  });
});
