import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { getInboxEvent } from "../cycle/inbox.js";
import { resolveObservationBinding } from "../observation/persistence.js";
import type { DetachedOperationTerminalState } from "./detached.js";
import {
  admitDetachedOperation,
  markDetachedOperationStarted,
  setDetachedOperationTerminal,
} from "./detached.js";
import {
  completionEventIdFor,
  produceOperationCompletion,
  reconcileMissingCompletions,
} from "./completion.js";
import { authorizeInterimSpeech } from "./interim.js";
import type { DeliveryIntent } from "../types.js";

const INTENT: DeliveryIntent = {
  ownerId: "doc",
  channel: "discord",
  threadId: "thread-completion",
  conversationId: "thread-completion",
  trigger: "owner_message_reactive",
  deliveryLane: "reactive",
  purpose: "licensed_speech",
};

function origin(conversationId = "thread-completion") {
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

function admitStarted(conversationId: string, key: string, nowMs = 1_000) {
  const { sidecar } = origin(conversationId);
  const admitted = admitDetachedOperation(sidecar, {
    idempotencyKey: key,
    conversationId,
    originCycleId: `cycle-${conversationId}`,
    originGeneration: 1,
    originOwnerEventId: "owner-1",
    operationKind: "project.investigate",
    request: { projectId: "project-ashley" },
    purpose: "investigate the service",
    evidenceNeed: "bounded file evidence",
    operationDeadlineAtMs: 600_000,
    nowMs,
  });
  if (!admitted.ok) throw new Error("admission failed");
  return { sidecar, operationId: admitted.operation.operationId };
}

function toTerminal(
  sidecar: ReturnType<typeof openTestSidecar>,
  operationId: string,
  terminalState: DetachedOperationTerminalState,
  nowMs = 2_000,
) {
  expect(markDetachedOperationStarted(sidecar, operationId, { startProofRef: "s", nowMs }).ok).toBe(true);
  const terminal = setDetachedOperationTerminal(sidecar, operationId, {
    terminalState,
    ...(terminalState === "failed" ? { errorCode: "worker_failed" } : {}),
    ...(terminalState === "outcome_unknown" ? { errorCode: "worker_dispatch_failed" } : {}),
    nowMs: nowMs + 1_000,
  });
  if (!terminal.ok) throw new Error("terminal failed");
}

describe("operation completion producer", () => {
  const terminals: DetachedOperationTerminalState[] = [
    "succeeded",
    "failed",
    "outcome_unknown",
    "cancelled",
    "stopped",
  ];
  for (const terminalState of terminals) {
    it(`creates exactly one completion for terminal ${terminalState}`, () => {
      const { sidecar, operationId } = admitStarted(`thread-${terminalState}`, `key-${terminalState}`);
      try {
        if (terminalState === "cancelled") {
          const terminal = setDetachedOperationTerminal(sidecar, operationId, {
            terminalState: "cancelled",
            nowMs: 3_000,
          });
          if (!terminal.ok) throw new Error("terminal failed");
        } else if (terminalState === "stopped") {
          expect(markDetachedOperationStarted(sidecar, operationId, { startProofRef: "s", nowMs: 2_000 }).ok).toBe(true);
          const terminal = setDetachedOperationTerminal(sidecar, operationId, {
            terminalState: "stopped",
            nowMs: 3_000,
          });
          if (!terminal.ok) throw new Error("terminal failed");
        } else {
          toTerminal(sidecar, operationId, terminalState);
        }
        const produced = produceOperationCompletion(sidecar, operationId, { nowMs: 4_000 });
        expect(produced).toMatchObject({ ok: true, created: true });
        if (!produced.ok) return;
        expect(produced.eventId).toBe(completionEventIdFor(operationId));
        const event = getInboxEvent(sidecar, produced.eventId);
        expect(event?.kind).toBe("observation_or_receipt");
        expect(event?.conversationId).toBe(`thread-${terminalState}`);
      } finally {
        sidecar.close();
      }
    });
  }

  it("gives outcome_unknown completions no success evidence to claim from", () => {
    const { sidecar, operationId } = admitStarted("thread-unknown", "key-unknown");
    try {
      toTerminal(sidecar, operationId, "outcome_unknown");
      const produced = produceOperationCompletion(sidecar, operationId, { nowMs: 4_000 });
      if (!produced.ok) throw new Error("produce failed");
      const payload = (getInboxEvent(sidecar, produced.eventId)?.payload ?? {}) as Record<string, unknown>;
      expect(payload).toMatchObject({
        terminalState: "outcome_unknown",
        errorCode: "worker_dispatch_failed",
        observationsCapture: "none",
        observationCount: 0,
      });
      expect(payload.observationIds).toEqual([]);
      expect(payload.observationRef).toBe(null);
    } finally {
      sidecar.close();
    }
  });

  it("is idempotent: duplicate production converges on one wake", () => {
    const { sidecar, operationId } = admitStarted("thread-idem", "key-idem");
    try {
      toTerminal(sidecar, operationId, "failed");
      const first = produceOperationCompletion(sidecar, operationId, { nowMs: 4_000 });
      const second = produceOperationCompletion(sidecar, operationId, { nowMs: 5_000 });
      expect(first).toMatchObject({ ok: true, created: true });
      expect(second).toMatchObject({ ok: true, created: false });
      if (!first.ok || !second.ok) return;
      expect(second.eventId).toBe(first.eventId);
      expect(
        (sidecar.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id = ?").get(first.eventId) as { count: number }).count,
      ).toBe(1);
    } finally {
      sidecar.close();
    }
  });

  it("refuses non-terminal and missing operations", () => {
    const { sidecar, operationId } = admitStarted("thread-refuse", "key-refuse");
    try {
      expect(produceOperationCompletion(sidecar, operationId)).toEqual({
        ok: false,
        reason: "detached_operation_not_terminal",
      });
      expect(produceOperationCompletion(sidecar, "detached-operation:missing")).toEqual({
        ok: false,
        reason: "detached_operation_missing",
      });
    } finally {
      sidecar.close();
    }
  });

  it("carries Thought-B context: purpose, interim text, terminal truth, and origin refs", () => {
    const { sidecar, operationId } = admitStarted("thread-context", "key-context");
    try {
      expect(authorizeInterimSpeech(sidecar, {
        operationId,
        surfaceDraft: "Yeah, give me a bit.",
        deliveryIntent: { ...INTENT, threadId: "thread-context", conversationId: "thread-context" },
        nowMs: 1_500,
      }).ok).toBe(true);
      toTerminal(sidecar, operationId, "failed");
      const produced = produceOperationCompletion(sidecar, operationId, { nowMs: 4_000 });
      if (!produced.ok) throw new Error("produce failed");
      const event = getInboxEvent(sidecar, produced.eventId);
      const payload = event?.payload as Record<string, unknown>;
      expect(payload).toMatchObject({
        detachedOperationId: operationId,
        terminalState: "failed",
        errorCode: "worker_failed",
        originOwnerEventId: "owner-1",
        purpose: "investigate the service",
        evidenceNeed: "bounded file evidence",
        interimText: "Yeah, give me a bit.",
        observationsCapture: "none",
        observationCount: 0,
      });
      // outcome_unknown can never arrive with success evidence attached.
      expect(payload.observationIds).toEqual([]);
      // The bounded Host summary joins conversation evidence for Thought B.
      const evidence = sidecar.prepare(
        "SELECT text FROM conversation_evidence_log WHERE conversation_id = ? AND role = 'system' ORDER BY created_at_ms DESC LIMIT 1",
      ).get("thread-context") as { text: string };
      expect(evidence.text).toContain("Detached investigation failed");
      expect(evidence.text).toContain("investigate the service");
      expect(evidence.text).toContain("Yeah, give me a bit.");
      expect(evidence.text).toContain("worker_failed");
    } finally {
      sidecar.close();
    }
  });

  it("backfills completions lost between terminal commit and production", () => {
    const first = admitStarted("thread-crash-a", "key-crash-a");
    const second = admitStarted("thread-crash-b", "key-crash-b");
    try {
      // Crash path: terminal truth stands with no completion reference.
      toTerminal(first.sidecar, first.operationId, "succeeded");
      toTerminal(second.sidecar, second.operationId, "outcome_unknown");
      expect(first.sidecar.prepare("SELECT completion_event_ref FROM detached_operations WHERE operation_id = ?").get(first.operationId))
        .toMatchObject({ completion_event_ref: null });
      // Reconcile per sidecar (each admitStarted owns its sidecar here).
      for (const fixture of [first, second]) {
        const reconciled = reconcileMissingCompletions(fixture.sidecar, { nowMs: 9_000 });
        expect(reconciled.failures).toEqual([]);
        expect(reconciled.produced).toEqual([completionEventIdFor(fixture.operationId)]);
        // Stable: a second pass produces nothing further.
        expect(reconcileMissingCompletions(fixture.sidecar, { nowMs: 9_001 })).toEqual({ produced: [], failures: [] });
      }
    } finally {
      first.sidecar.close();
      second.sidecar.close();
    }
  });
});
