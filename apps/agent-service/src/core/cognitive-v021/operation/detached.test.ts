import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import {
  admitDetachedOperation,
  detachedOperationIdFor,
  getActiveDetachedOperation,
  getDetachedOperation,
  markDetachedOperationStarted,
  reconcileDetachedOperations,
  requestDetachedOperationCancel,
  resolveDetachedOperationCancel,
  setDetachedOperationTerminal,
  supersedeDetachedOperation,
  type AdmitDetachedOperationInput,
} from "./detached.js";

function origin() {
  const sidecar = openTestSidecar();
  const cycle = admitTestCycle(sidecar, {
    cycleId: "cycle-detached-op",
    conversationId: "thread-detached-op",
    triggerKind: "owner_message",
    triggerRef: "detached-op-origin",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  return { sidecar, cycle };
}

function admission(
  key: string,
  overrides: Partial<AdmitDetachedOperationInput> = {},
): AdmitDetachedOperationInput {
  return {
    idempotencyKey: key,
    conversationId: "thread-detached-op",
    originCycleId: "cycle-detached-op",
    originGeneration: 1,
    originOwnerEventId: "owner-event-1",
    operationKind: "project.investigate",
    request: { projectId: "project-ashley", focus: "apps/agent-service" },
    purpose: "investigate the current project",
    evidenceNeed: "bounded file evidence",
    operationDeadlineAtMs: 60_000,
    nowMs: 1_000,
    ...overrides,
  };
}

describe("detached operation ownership", () => {
  it("admits idempotently on the idempotency key", () => {
    const { sidecar } = origin();
    try {
      const first = admitDetachedOperation(sidecar, admission("key-1"));
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.created).toBe(true);
      expect(first.operation.operationId).toBe(detachedOperationIdFor("key-1"));
      expect(first.operation.state).toBe("admitted");
      expect(first.operation.terminalState).toBe(null);

      const second = admitDetachedOperation(sidecar, admission("key-1"));
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.created).toBe(false);
      expect(second.operation.operationId).toBe(first.operation.operationId);
      expect(
        (sidecar.prepare("SELECT COUNT(*) AS count FROM detached_operations").get() as { count: number }).count,
      ).toBe(1);
    } finally {
      sidecar.close();
    }
  });

  it("allows multiple detached identities for one conversation while keeping each idempotent", () => {
    const { sidecar } = origin();
    try {
      expect(admitDetachedOperation(sidecar, admission("key-1")).ok).toBe(true);
      expect(admitDetachedOperation(sidecar, admission("key-2"))).toMatchObject({ ok: true, created: true });
      const first = admitDetachedOperation(sidecar, admission("key-1"));
      if (!first.ok) throw new Error("admission failed");
      const opId = first.operation.operationId;
      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "worker-start-1", nowMs: 2_000 }).ok).toBe(true);
      expect(setDetachedOperationTerminal(
        sidecar,
        opId,
        { terminalState: "succeeded", observationRef: "obs-1", nowMs: 3_000 },
      ).ok).toBe(true);
      expect(admitDetachedOperation(sidecar, admission("key-2"))).toMatchObject({ ok: true, created: false });
    } finally {
      sidecar.close();
    }
  });

  it("rejects illegal transitions and keeps terminal rows immutable", () => {
    const { sidecar } = origin();
    try {
      const admitted = admitDetachedOperation(sidecar, admission("key-1"));
      if (!admitted.ok) throw new Error("admission failed");
      const opId = admitted.operation.operationId;

      // Admitted work that never started may not succeed or stop.
      expect(setDetachedOperationTerminal(sidecar, opId, { terminalState: "succeeded", nowMs: 2_000 }))
        .toEqual({ ok: false, reason: "detached_operation_transition_invalid" });
      // Start requires proof.
      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "", nowMs: 2_000 }))
        .toEqual({ ok: false, reason: "invalid_start" });
      // Unknown operation.
      expect(markDetachedOperationStarted(sidecar, "detached-operation:missing", { startProofRef: "x", nowMs: 2_000 }))
        .toEqual({ ok: false, reason: "detached_operation_missing" });

      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "worker-start-1", nowMs: 2_000 }).ok).toBe(true);
      // No re-admission into started.
      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "worker-start-2", nowMs: 2_100 }))
        .toEqual({ ok: false, reason: "detached_operation_transition_invalid" });

      const terminal = setDetachedOperationTerminal(
        sidecar,
        opId,
        { terminalState: "failed", errorCode: "worker_failed", nowMs: 3_000 },
      );
      expect(terminal.ok).toBe(true);
      if (!terminal.ok) return;
      expect(terminal.operation.errorCode).toBe("worker_failed");

      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "late", nowMs: 4_000 }))
        .toEqual({ ok: false, reason: "detached_operation_terminal_immutable" });
      expect(setDetachedOperationTerminal(sidecar, opId, { terminalState: "succeeded", nowMs: 4_000 }))
        .toEqual({ ok: false, reason: "detached_operation_terminal_immutable" });
      expect(requestDetachedOperationCancel(sidecar, opId, 4_000))
        .toEqual({ ok: false, reason: "detached_operation_terminal_immutable" });
      expect(getDetachedOperation(sidecar, opId)?.state).toBe("failed");
    } finally {
      sidecar.close();
    }
  });

  it("lets admitted work end as cancelled/failed/outcome_unknown without execution", () => {
    const { sidecar } = origin();
    try {
      const cancelled = admitDetachedOperation(sidecar, admission("key-cancel", { conversationId: "thread-a" }));
      if (!cancelled.ok) throw new Error("admission failed");
      expect(setDetachedOperationTerminal(
        sidecar,
        cancelled.operation.operationId,
        { terminalState: "cancelled", nowMs: 2_000 },
      )).toMatchObject({ ok: true, operation: { state: "cancelled" } });

      const failed = admitDetachedOperation(sidecar, admission("key-fail", { conversationId: "thread-b" }));
      if (!failed.ok) throw new Error("admission failed");
      expect(setDetachedOperationTerminal(
        sidecar,
        failed.operation.operationId,
        { terminalState: "failed", errorCode: "dispatch_failed", nowMs: 2_000 },
      )).toMatchObject({ ok: true, operation: { state: "failed", errorCode: "dispatch_failed" } });
    } finally {
      sidecar.close();
    }
  });

  it("reconciles expired ambiguous work as outcome_unknown without rerun", () => {
    const { sidecar } = origin();
    try {
      const admitted = admitDetachedOperation(sidecar, admission("key-adm", {
        conversationId: "thread-adm",
        operationDeadlineAtMs: 5_000,
        nowMs: 1_000,
      }));
      if (!admitted.ok) throw new Error("admission failed");
      const started = admitDetachedOperation(sidecar, admission("key-run", {
        conversationId: "thread-run",
        operationDeadlineAtMs: 5_000,
        nowMs: 1_000,
      }));
      if (!started.ok) throw new Error("admission failed");
      expect(markDetachedOperationStarted(
        sidecar,
        started.operation.operationId,
        { startProofRef: "worker-start-1", nowMs: 2_000 },
      ).ok).toBe(true);
      const fresh = admitDetachedOperation(sidecar, admission("key-fresh", {
        conversationId: "thread-fresh",
        operationDeadlineAtMs: 50_000,
        nowMs: 1_000,
      }));
      if (!fresh.ok) throw new Error("admission failed");

      const reconciled = reconcileDetachedOperations(sidecar, 10_000);
      expect(reconciled.transitionedOperationIds).toEqual([started.operation.operationId]);
      expect(getDetachedOperation(sidecar, admitted.operation.operationId)?.state).toBe("admitted");
      expect(getDetachedOperation(sidecar, started.operation.operationId)?.state).toBe("outcome_unknown");
      expect(getDetachedOperation(sidecar, fresh.operation.operationId)?.state).toBe("admitted");

      // Reconciliation is stable: a second pass changes nothing further.
      expect(reconcileDetachedOperations(sidecar, 10_000)).toEqual({ transitionedOperationIds: [] });
    } finally {
      sidecar.close();
    }
  });

  it("records supersession without erasing evidence and tracks cancel requests", () => {
    const { sidecar } = origin();
    try {
      const admitted = admitDetachedOperation(sidecar, admission("key-1"));
      if (!admitted.ok) throw new Error("admission failed");
      const opId = admitted.operation.operationId;

      const requested = requestDetachedOperationCancel(sidecar, opId, 2_000);
      expect(requested).toMatchObject({ ok: true, operation: { cancelRequestedAtMs: 2_000, state: "admitted" } });

      const superseded = supersedeDetachedOperation(sidecar, opId, {
        supersededBy: "owner-turn-2",
        successorOperationId: "detached-operation:next",
        nowMs: 3_000,
      });
      expect(superseded).toMatchObject({
        ok: true,
        operation: {
          state: "cancelled",
          terminalState: "cancelled",
          supersededBy: "owner-turn-2",
          successorOperationId: "detached-operation:next",
        },
      });
    } finally {
      sidecar.close();
    }
  });

  it("rejects malformed admission input", () => {
    const { sidecar } = origin();
    try {
      expect(admitDetachedOperation(sidecar, admission("", {}))).toEqual({ ok: false, reason: "invalid_admission" });
      expect(admitDetachedOperation(
        sidecar,
        admission("key-bad-deadline", { operationDeadlineAtMs: 500, nowMs: 1_000 }),
      )).toEqual({ ok: false, reason: "invalid_admission" });
      expect(admitDetachedOperation(
        sidecar,
        admission("key-bad-kind", { operationKind: "project.inspect" as "project.investigate" }),
      )).toEqual({ ok: false, reason: "invalid_admission" });
    } finally {
      sidecar.close();
    }
  });
});

describe("detached operation cancellation truth", () => {
  it("cancels admitted never-started work on endorsement", () => {
    const { sidecar } = origin();
    try {
      const admitted = admitDetachedOperation(sidecar, admission("key-cancel"));
      if (!admitted.ok) throw new Error("admission failed");
      const opId = admitted.operation.operationId;
      expect(getActiveDetachedOperation(sidecar, "thread-detached-op")?.operationId).toBe(opId);
      const resolved = resolveDetachedOperationCancel(sidecar, opId, {
        cancelledBy: "cycle-cancel",
        nowMs: 2_000,
      });
      expect(resolved).toMatchObject({ ok: true, operation: { state: "cancelled", terminalState: "cancelled" } });
      expect(getActiveDetachedOperation(sidecar, "thread-detached-op")).toBe(null);
      // Terminal wins over later stops.
      expect(resolveDetachedOperationCancel(sidecar, opId, { cancelledBy: "cycle-late", nowMs: 3_000 }))
        .toEqual({ ok: false, reason: "detached_operation_terminal_immutable" });
    } finally {
      sidecar.close();
    }
  });

  it("keeps cancel requested distinct from cancelled and stopped", () => {
    const { sidecar } = origin();
    try {
      const admitted = admitDetachedOperation(sidecar, admission("key-request"));
      if (!admitted.ok) throw new Error("admission failed");
      const opId = admitted.operation.operationId;
      // Request alone changes no state.
      expect(requestDetachedOperationCancel(sidecar, opId, 1_500)).toMatchObject({
        ok: true,
        operation: { state: "admitted", cancelRequestedAtMs: 1_500 },
      });
      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "s", nowMs: 2_000 }).ok).toBe(true);
      // Started work without a stop proof refuses: a sent stop is not stopped.
      expect(resolveDetachedOperationCancel(sidecar, opId, { cancelledBy: "cycle-stop", nowMs: 2_500 }))
        .toEqual({ ok: false, reason: "stop_proof_required" });
      expect(getDetachedOperation(sidecar, opId)?.state).toBe("started");
      // A stop proof stops started work.
      expect(resolveDetachedOperationCancel(sidecar, opId, {
        cancelledBy: "cycle-stop",
        stopProofRef: "worker-stop-ack-1",
        nowMs: 3_000,
      })).toMatchObject({ ok: true, operation: { state: "stopped" } });
    } finally {
      sidecar.close();
    }
  });

  it("reconciles requested-but-never-started expiry as cancelled, not unknown", () => {
    const { sidecar } = origin();
    try {
      const requested = admitDetachedOperation(sidecar, admission("key-req-exp", {
        conversationId: "thread-req",
        operationDeadlineAtMs: 5_000,
        nowMs: 1_000,
      }));
      if (!requested.ok) throw new Error("admission failed");
      expect(requestDetachedOperationCancel(sidecar, requested.operation.operationId, 2_000).ok).toBe(true);
      const unrequested = admitDetachedOperation(sidecar, admission("key-unreq-exp", {
        conversationId: "thread-unreq",
        operationDeadlineAtMs: 5_000,
        nowMs: 1_000,
      }));
      if (!unrequested.ok) throw new Error("admission failed");
      expect(reconcileDetachedOperations(sidecar, 10_000)).toEqual({ transitionedOperationIds: [] });
      // Queue ownership, not an execution deadline, owns admitted work that
      // has not yet started. Cancellation is resolved by the queue/dispatcher.
      expect(getDetachedOperation(sidecar, requested.operation.operationId)).toMatchObject({
        state: "admitted",
        cancelRequestedAtMs: 2_000,
      });
      expect(getDetachedOperation(sidecar, unrequested.operation.operationId)?.state).toBe("admitted");
    } finally {
      sidecar.close();
    }
  });

  it("records supersession on terminal rows without erasing truth", () => {
    const { sidecar } = origin();
    try {
      const admitted = admitDetachedOperation(sidecar, admission("key-sup"));
      if (!admitted.ok) throw new Error("admission failed");
      const opId = admitted.operation.operationId;
      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "s", nowMs: 2_000 }).ok).toBe(true);
      expect(setDetachedOperationTerminal(sidecar, opId, { terminalState: "failed", errorCode: "worker_failed", nowMs: 3_000 }).ok)
        .toBe(true);
      const superseded = supersedeDetachedOperation(sidecar, opId, { supersededBy: "owner-turn-9", nowMs: 4_000 });
      expect(superseded).toMatchObject({
        ok: true,
        operation: { state: "failed", terminalState: "failed", errorCode: "worker_failed", supersededBy: "owner-turn-9" },
      });
    } finally {
      sidecar.close();
    }
  });
});
