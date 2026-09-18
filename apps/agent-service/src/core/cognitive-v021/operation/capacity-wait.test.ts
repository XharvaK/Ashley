import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import {
  admitDetachedOperation,
  getDetachedOperation,
  detachedOperationIdFor,
  markDetachedOperationStarted,
  setDetachedOperationTerminal,
} from "./detached.js";
import { getInboxEvent } from "../cycle/inbox.js";
import { completionEventIdFor, reconcileMissingCompletions, produceOperationCompletion } from "./completion.js";
import {
  CURIOSITY_TTL_MS,
  MAX_NONTERMINAL_WORKER_UNDERTAKINGS,
  MAX_PENDING_CURIOSITY,
  WORKER_SERVICE_CALENDAR,
  bindWorkerUndertakingToOperation,
  detachedIdempotencyKeyForWorkerUndertaking,
  enqueueWorkerUndertaking,
  expireQueuedCuriosity,
  getWorkerExecutionSlot,
  getWorkerUndertaking,
  getWorkerSchedulerCursor,
  markWorkerUndertakingRunning,
  recoverExpiredDispatchClaims,
  projectWorkerUndertakingTerminal,
  releaseWorkerExecutionSlot,
  requestWorkerUndertakingCancel,
  selectNextWorkerUndertaking,
  supersedeWorkerUndertaking,
  type EnqueueWorkerUndertakingInput,
} from "./worker-queue.js";
import {
  authorizeUndertakingAcknowledgement,
  getInterimOutboxByUndertaking,
} from "./interim.js";
import { serviceWorkerUndertakings } from "./dispatch.js";

function input(overrides: Partial<EnqueueWorkerUndertakingInput> = {}): EnqueueWorkerUndertakingInput {
  const origin = overrides.origin ?? {
    kind: "OWNER_REQUEST" as const,
    ref: "owner:1",
    ownerEventId: "owner:1",
    evidenceRowId: "evidence:1",
  };
  return {
    semanticKind: "project.inspect",
    origin,
    ownerId: "doc",
    conversationId: "thread:queue",
    originCycleId: "cycle:queue",
    originGeneration: 1,
    request: { projectId: "project-ashley", focus: "apps/agent-service", maxSteps: 6 },
    purpose: "understand the current project behavior",
    evidenceNeed: "bounded worker-owned source evidence",
    nowMs: 1_000,
    ...overrides,
  };
}

describe("global worker undertaking queue", () => {
  it("deduplicates one logical admission without enforcing per-conversation uniqueness", () => {
    const db = openTestSidecar();
    try {
      const first = enqueueWorkerUndertaking(db, input());
      expect(first).toMatchObject({ ok: true, created: true });
      if (!first.ok) return;

      const duplicate = enqueueWorkerUndertaking(db, input());
      expect(duplicate).toMatchObject({
        ok: true,
        created: false,
        undertaking: { undertakingId: first.undertaking.undertakingId },
      });

      const second = enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "owner:2", ownerEventId: "owner:2" },
      }));
      expect(second).toMatchObject({ ok: true, created: true });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM worker_undertakings WHERE conversation_id = ?",
      ).get("thread:queue")).toMatchObject({ count: 2 });
    } finally {
      db.close();
    }
  });

  it("enforces the global nonterminal cap and the fourth-curiosity reject-newest rule", () => {
    const db = openTestSidecar();
    try {
      for (let index = 0; index < MAX_NONTERMINAL_WORKER_UNDERTAKINGS; index += 1) {
        const admitted = enqueueWorkerUndertaking(db, input({
          origin: { kind: "OWNER_REQUEST", ref: `owner:${index}`, ownerEventId: `owner:${index}` },
        }));
        expect(admitted.ok).toBe(true);
      }
      expect(enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "owner:overflow", ownerEventId: "owner:overflow" },
      }))).toEqual({ ok: false, reason: "queue_capacity_exhausted" });

      const curiosityDb = openTestSidecar();
      try {
        for (let index = 0; index < MAX_PENDING_CURIOSITY; index += 1) {
          const admitted = enqueueWorkerUndertaking(curiosityDb, input({
            origin: { kind: "ASHLEY_CURIOSITY", ref: `curiosity:${index}` },
            nowMs: 2_000,
          }));
          expect(admitted.ok).toBe(true);
        }
        expect(enqueueWorkerUndertaking(curiosityDb, input({
          origin: { kind: "ASHLEY_CURIOSITY", ref: "curiosity:fourth" },
          nowMs: 2_000,
        }))).toEqual({ ok: false, reason: "curiosity_pending_capacity" });
        const row = curiosityDb.prepare(
          "SELECT curiosity_expires_at_ms FROM worker_undertakings WHERE origin_ref = ?",
        ).get("curiosity:0") as { curiosity_expires_at_ms: number };
        expect(row.curiosity_expires_at_ms).toBe(2_000 + CURIOSITY_TTL_MS);
      } finally {
        curiosityDb.close();
      }
    } finally {
      db.close();
    }
  });

  it("persists and advances the exact weighted service calendar", () => {
    const db = openTestSidecar();
    try {
      const admitted = enqueueWorkerUndertaking(db, input());
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;
      const selection = selectNextWorkerUndertaking(db, 1_000);
      expect(selection).toMatchObject({
        selectedClass: WORKER_SERVICE_CALENDAR[0],
        undertaking: { undertakingId: admitted.undertaking.undertakingId },
      });
      if (!selection) return;
      const queueOperationId = detachedOperationIdFor("queue-calendar-operation");
      const binding = bindWorkerUndertakingToOperation(db, {
        undertakingId: admitted.undertaking.undertakingId,
        operationId: queueOperationId,
        calendarIndex: selection.calendarIndex,
        nowMs: 1_000,
        admitOperation: () => {
          const admittedOperation = admitDetachedOperation(db, {
            idempotencyKey: "queue-calendar-operation",
            conversationId: "thread:queue",
            originCycleId: "cycle:queue",
            originGeneration: 1,
            originKind: "OWNER_REQUEST",
            originRef: "owner:1",
            originOwnerEventId: "owner:1",
            workerUndertakingId: admitted.undertaking.undertakingId,
            operationKind: "project.investigate",
            request: { projectId: "project-ashley", focus: "apps/agent-service" },
            purpose: "understand the current project behavior",
            evidenceNeed: "bounded worker-owned source evidence",
            operationDeadlineAtMs: 301_000,
            nowMs: 1_000,
          });
          return admittedOperation.ok
            ? { ok: true as const, operationId: admittedOperation.operation.operationId, created: admittedOperation.created }
            : { ok: false as const, reason: admittedOperation.reason };
        },
      });
      expect(binding.ok).toBe(true);
      expect(getWorkerSchedulerCursor(db)).toBe(0);
      expect(getWorkerExecutionSlot(db)).toMatchObject({
        undertakingId: admitted.undertaking.undertakingId,
        operationId: queueOperationId,
      });
      expect(markWorkerUndertakingRunning(
        db,
        admitted.undertaking.undertakingId,
        queueOperationId,
        1_001,
      )).toMatchObject({ state: "running" });
      expect(markDetachedOperationStarted(db, queueOperationId, {
        startProofRef: "queue-calendar-start",
        nowMs: 1_001,
      }).ok).toBe(true);
      expect(setDetachedOperationTerminal(db, queueOperationId, {
        terminalState: "succeeded",
        nowMs: 1_001,
      }).ok).toBe(true);
      expect(getWorkerSchedulerCursor(db)).toBe(1);
      expect(projectWorkerUndertakingTerminal(
        db,
        admitted.undertaking.undertakingId,
        "succeeded",
        null,
        1_002,
      )).toMatchObject({ state: "succeeded" });
      expect(getWorkerExecutionSlot(db).undertakingId).toBeNull();
    } finally {
      db.close();
    }
  });

  it("services continuous Owner, commitment, and curiosity backlog in the frozen 4:2:1 order", () => {
    const db = openTestSidecar();
    try {
      const classes = [
        ...Array.from({ length: 4 }, (_, index) => ({ kind: "OWNER_REQUEST" as const, ref: `fair-owner:${index}`, ownerEventId: `fair-owner:${index}` })),
        ...Array.from({ length: 2 }, (_, index) => ({ kind: "ASHLEY_COMMITMENT" as const, ref: `fair-commitment:${index}` })),
        { kind: "ASHLEY_CURIOSITY" as const, ref: "fair-curiosity:0" },
      ];
      for (const [index, origin] of classes.entries()) {
        expect(enqueueWorkerUndertaking(db, input({ origin, nowMs: 1_000 + index }))).toMatchObject({ ok: true });
      }
      const selected: string[] = [];
      for (let index = 0; index < WORKER_SERVICE_CALENDAR.length; index += 1) {
        const next = selectNextWorkerUndertaking(db, 2_000 + index);
        expect(next).not.toBeNull();
        if (!next) return;
        selected.push(next.selectedClass);
        const operationId = `detached-operation:fair:${index}`;
        expect(bindWorkerUndertakingToOperation(db, {
          undertakingId: next.undertaking.undertakingId,
          operationId,
          calendarIndex: next.calendarIndex,
          nowMs: 2_000 + index,
          admitOperation: () => ({ ok: true as const, operationId, created: true }),
        }).ok).toBe(true);
        expect(markWorkerUndertakingRunning(db, next.undertaking.undertakingId, operationId, 2_000 + index))
          .toMatchObject({ state: "running" });
        expect(projectWorkerUndertakingTerminal(db, next.undertaking.undertakingId, "cancelled", "fairness_test", 2_000 + index))
          .toMatchObject({ state: "cancelled" });
      }
      expect(selected).toEqual([
        "OWNER_REQUEST",
        "ASHLEY_COMMITMENT",
        "OWNER_REQUEST",
        "ASHLEY_CURIOSITY",
        "OWNER_REQUEST",
        "ASHLEY_COMMITMENT",
        "OWNER_REQUEST",
      ]);
      expect(getWorkerSchedulerCursor(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("borrows empty classes without accumulating fairness credit and preserves FIFO within a class", () => {
    const db = openTestSidecar();
    try {
      const later = enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "fifo:later", ownerEventId: "fifo:later" },
        nowMs: 20,
      }));
      const earlier = enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "fifo:earlier", ownerEventId: "fifo:earlier" },
        nowMs: 10,
      }));
      expect(later.ok && earlier.ok).toBe(true);
      if (!later.ok || !earlier.ok) return;
      expect(selectNextWorkerUndertaking(db, 30)?.undertaking.undertakingId).toBe(earlier.undertaking.undertakingId);
      expect(getWorkerSchedulerCursor(db)).toBe(0);
      const first = selectNextWorkerUndertaking(db, 30);
      if (!first) return;
      expect(bindWorkerUndertakingToOperation(db, {
        undertakingId: first.undertaking.undertakingId,
        operationId: "detached-operation:fifo:1",
        calendarIndex: first.calendarIndex,
        nowMs: 30,
        admitOperation: () => ({ ok: true as const, operationId: "detached-operation:fifo:1", created: true }),
      }).ok).toBe(true);
      projectWorkerUndertakingTerminal(db, first.undertaking.undertakingId, "cancelled", "fifo_test", 31);
      const borrowed = selectNextWorkerUndertaking(db, 31);
      expect(borrowed?.undertaking.undertakingId).toBe(later.undertaking.undertakingId);
      expect(borrowed?.skippedEmptyClasses).toBe(0);
    } finally {
      db.close();
    }
  });

  it("keeps the singleton worker slot globally occupied across conversations", () => {
    const db = openTestSidecar();
    try {
      const first = enqueueWorkerUndertaking(db, input({
        conversationId: "conversation:a",
        origin: { kind: "OWNER_REQUEST", ref: "slot:a", ownerEventId: "slot:a" },
      }));
      const second = enqueueWorkerUndertaking(db, input({
        conversationId: "conversation:b",
        origin: { kind: "ASHLEY_COMMITMENT", ref: "slot:b" },
      }));
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      const firstSelection = selectNextWorkerUndertaking(db, 1_000);
      if (!firstSelection) return;
      expect(bindWorkerUndertakingToOperation(db, {
        undertakingId: first.undertaking.undertakingId,
        operationId: "detached-operation:slot:a",
        calendarIndex: firstSelection.calendarIndex,
        nowMs: 1_000,
        admitOperation: () => ({ ok: true as const, operationId: "detached-operation:slot:a", created: true }),
      }).ok).toBe(true);
      const secondSelection = selectNextWorkerUndertaking(db, 1_001);
      if (!secondSelection) return;
      expect(bindWorkerUndertakingToOperation(db, {
        undertakingId: second.undertaking.undertakingId,
        operationId: "detached-operation:slot:b",
        calendarIndex: secondSelection.calendarIndex,
        nowMs: 1_001,
        admitOperation: () => ({ ok: true as const, operationId: "detached-operation:slot:b", created: true }),
      })).toEqual({ ok: false, reason: "worker_busy" });
      expect(db.prepare("UPDATE worker_undertakings SET blocked_reason = 'worker_busy' WHERE undertaking_id = ?").run(second.undertaking.undertakingId)).toMatchObject({ changes: 1 });
      expect(getWorkerUndertaking(db, second.undertaking.undertakingId)?.blockedReason).toBe("worker_busy");
      expect(getWorkerExecutionSlot(db).undertakingId).toBe(first.undertaking.undertakingId);
    } finally {
      db.close();
    }
  });

  it("expires curiosity without dispatch and supports queued cancellation/supersession", () => {
    const db = openTestSidecar();
    try {
      const curiosity = enqueueWorkerUndertaking(db, input({
        origin: { kind: "ASHLEY_CURIOSITY", ref: "expiry:curiosity" },
        nowMs: 100,
      }));
      expect(curiosity.ok).toBe(true);
      if (!curiosity.ok) return;
      expect(expireQueuedCuriosity(db, 100 + CURIOSITY_TTL_MS)).toEqual([curiosity.undertaking.undertakingId]);
      expect(getWorkerUndertaking(db, curiosity.undertaking.undertakingId)?.state).toBe("expired");
      expect(selectNextWorkerUndertaking(db, 100 + CURIOSITY_TTL_MS + 1)).toBeNull();

      const cancelled = enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "cancel:owner", ownerEventId: "cancel:owner" },
      }));
      const superseded = enqueueWorkerUndertaking(db, input({
        origin: { kind: "ASHLEY_COMMITMENT", ref: "supersede:commitment" },
      }));
      expect(cancelled.ok && superseded.ok).toBe(true);
      if (!cancelled.ok || !superseded.ok) return;
      expect(requestWorkerUndertakingCancel(db, cancelled.undertaking.undertakingId, 200))
        .toMatchObject({ ok: true, undertaking: { state: "cancelled" } });
      expect(supersedeWorkerUndertaking(db, superseded.undertaking.undertakingId, { supersededBy: "owner:successor", nowMs: 201 }))
        .toMatchObject({ ok: true, undertaking: { state: "superseded", supersededBy: "owner:successor" } });
      expect(db.prepare("SELECT COUNT(*) AS count FROM detached_operations").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("recovers an unbound dispatch claim and rolls back a failed atomic binding", () => {
    const db = openTestSidecar();
    try {
      const admitted = enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "crash:claim", ownerEventId: "crash:claim" },
      }));
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;
      db.prepare(
        `UPDATE worker_undertakings
            SET state = 'dispatching', selected_operation_id = 'detached-operation:missing',
                dispatch_claim_expires_at_ms = 5000 WHERE undertaking_id = ?`,
      ).run(admitted.undertaking.undertakingId);
      expect(recoverExpiredDispatchClaims(db, 5_000)).toEqual([admitted.undertaking.undertakingId]);
      expect(getWorkerUndertaking(db, admitted.undertaking.undertakingId)?.state).toBe("queued");
      const selection = selectNextWorkerUndertaking(db, 5_001);
      if (!selection) return;
      expect(bindWorkerUndertakingToOperation(db, {
        undertakingId: admitted.undertaking.undertakingId,
        operationId: "detached-operation:crash:bind",
        calendarIndex: selection.calendarIndex,
        nowMs: 5_001,
        admitOperation: () => ({ ok: false as const, reason: "simulated_crash_before_bind" }),
      })).toEqual({ ok: false, reason: "binding_failed" });
      expect(getWorkerUndertaking(db, admitted.undertaking.undertakingId)?.state).toBe("queued");
      expect(getWorkerExecutionSlot(db).undertakingId).toBeNull();
      expect(getDetachedOperation(db, "detached-operation:crash:bind")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("authorizes exactly one Owner acknowledgement without creating a detached operation", () => {
    const db = openTestSidecar();
    try {
      const admitted = enqueueWorkerUndertaking(db, input());
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;
      const acknowledgement = {
        undertakingId: admitted.undertaking.undertakingId,
        conversationId: "thread:queue",
        cycleId: "cycle:queue",
        generation: 1,
        surfaceDraft: "I’ll let you know when I’ve finished checking that.",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread:queue",
          conversationId: "thread:queue",
          trigger: "owner_message_reactive" as const,
          deliveryLane: "reactive" as const,
          purpose: "licensed_speech" as const,
        },
        nowMs: 1_000,
      };
      const first = authorizeUndertakingAcknowledgement(db, acknowledgement);
      const second = authorizeUndertakingAcknowledgement(db, { ...acknowledgement, nowMs: 1_001 });
      expect(first).toMatchObject({ ok: true, created: true });
      expect(second).toMatchObject({ ok: true, created: false });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM operation_interim_outbox WHERE undertaking_id = ? AND operation_id IS NULL",
      ).get(admitted.undertaking.undertakingId)).toMatchObject({ count: 1 });
      expect(getInterimOutboxByUndertaking(db, admitted.undertaking.undertakingId)?.operationId).toBeNull();
    } finally {
      db.close();
    }
  });

  it("keeps a capacity wait queued, then binds and executes once when the probe becomes available", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle:service",
        conversationId: "thread:service",
        triggerKind: "owner_message",
        triggerRef: "owner:service",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const admitted = enqueueWorkerUndertaking(db, input({
        conversationId: "thread:service",
        originCycleId: "cycle:service",
        origin: { kind: "OWNER_REQUEST", ref: "owner:service", ownerEventId: "owner:service" },
      }));
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;

      let workerCalls = 0;
      const unavailable = await serviceWorkerUndertakings(db, {
        nowMs: 2_000,
        worker: async () => {
          workerCalls += 1;
          return { ok: true as const, payload: { summary: "worker evidence" } };
        },
        capacityProbe: () => ({ available: false as const, reason: "worker_capacity_exhausted", nextProbeAtMs: 5_000 }),
      });
      expect(unavailable).toMatchObject({ serviced: [], failures: [], selectedClass: "OWNER_REQUEST" });
      expect(getWorkerUndertaking(db, admitted.undertaking.undertakingId)).toMatchObject({
        state: "queued",
        blockedReason: "capacity",
        capacityNextProbeAtMs: 5_000,
      });
      expect(workerCalls).toBe(0);

      const beforeDue = await serviceWorkerUndertakings(db, {
        nowMs: 4_999,
        worker: async () => {
          workerCalls += 1;
          return { ok: true as const, payload: {} };
        },
        capacityProbe: () => ({ available: true as const }),
      });
      expect(beforeDue.serviced).toEqual([]);
      expect(workerCalls).toBe(0);

      const due = await serviceWorkerUndertakings(db, {
        nowMs: 5_000,
        worker: async ({ request }) => {
          workerCalls += 1;
          expect(request).toMatchObject({ projectId: "project-ashley" });
          return { ok: true as const, payload: { summary: "worker evidence" } };
        },
        capacityProbe: () => ({ available: true as const }),
      });
      expect(due.serviced).toEqual([admitted.undertaking.undertakingId]);
      expect(workerCalls).toBe(1);
      expect(getWorkerUndertaking(db, admitted.undertaking.undertakingId)?.state).toBe("succeeded");
      const operationId = getWorkerUndertaking(db, admitted.undertaking.undertakingId)?.selectedOperationId;
      expect(operationId).toBeTruthy();
      expect(getDetachedOperation(db, operationId ?? "")?.terminalState).toBe("succeeded");
    } finally {
      db.close();
    }
  });

  it("coalesces overlapping service calls into one worker flight", async () => {
    const db = openTestSidecar();
    try {
      const admitted = enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "flight:owner", ownerEventId: "flight:owner" },
      }));
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;

      let workerCalls = 0;
      let workerStarted!: () => void;
      const started = new Promise<void>((resolve) => { workerStarted = resolve; });
      let releaseWorker!: () => void;
      const workerGate = new Promise<void>((resolve) => { releaseWorker = resolve; });
      const options = {
        nowMs: 2_000,
        worker: async () => {
          workerCalls += 1;
          workerStarted();
          await workerGate;
          return { ok: true as const, payload: {} };
        },
        capacityProbe: () => ({ available: true as const }),
      };
      const first = serviceWorkerUndertakings(db, options);
      await started;
      const second = serviceWorkerUndertakings(db, options);
      expect(second).toBe(first);
      expect(workerCalls).toBe(1);
      releaseWorker();
      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(secondResult).toBe(firstResult);
      expect(firstResult.serviced).toEqual([admitted.undertaking.undertakingId]);
    } finally {
      db.close();
    }
  });

  it("returns a typed retryable admission result for a SQLite transaction collision", () => {
    const db = openTestSidecar();
    try {
      db.exec("BEGIN IMMEDIATE");
      expect(enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "retryable:owner", ownerEventId: "retryable:owner" },
      }))).toEqual({ ok: false, reason: "queue_admission_retryable" });
    } finally {
      try { db.exec("ROLLBACK"); } catch { /* enqueue may already have rolled back the collision */ }
      db.close();
    }
  });

  it("reconciles completion-before-queue-projection and queue-projection-before-completion exactly once", async () => {
    const db = openTestSidecar();
    try {
      const firstCycle = admitTestCycle(db, {
        cycleId: "cycle:completion-before-queue",
        conversationId: "thread:completion-before-queue",
        triggerKind: "owner_message",
        triggerRef: "owner:completion-before-queue",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const first = enqueueWorkerUndertaking(db, input({
        conversationId: firstCycle.conversationId,
        originCycleId: firstCycle.cycleId,
        origin: {
          kind: "OWNER_REQUEST",
          ref: "owner:completion-before-queue",
          ownerEventId: "owner:completion-before-queue",
        },
      }));
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const firstSelection = selectNextWorkerUndertaking(db, 1_000);
      expect(firstSelection).not.toBeNull();
      if (!firstSelection) return;
      const firstIdempotencyKey = detachedIdempotencyKeyForWorkerUndertaking(first.undertaking.undertakingId);
      const firstOperationId = detachedOperationIdFor(firstIdempotencyKey);
      expect(bindWorkerUndertakingToOperation(db, {
        undertakingId: first.undertaking.undertakingId,
        operationId: firstOperationId,
        calendarIndex: firstSelection.calendarIndex,
        nowMs: 1_000,
        admitOperation: () => {
          const admitted = admitDetachedOperation(db, {
            idempotencyKey: firstIdempotencyKey,
            conversationId: firstCycle.conversationId,
            originCycleId: firstCycle.cycleId,
            originGeneration: firstCycle.generation,
            originKind: "OWNER_REQUEST",
            originRef: "owner:completion-before-queue",
            originOwnerEventId: "owner:completion-before-queue",
            workerUndertakingId: first.undertaking.undertakingId,
            operationKind: "project.investigate",
            request: { projectId: "project-ashley" },
            purpose: "reconcile completion ordering",
            evidenceNeed: "terminal worker evidence",
            operationDeadlineAtMs: 301_000,
            nowMs: 1_000,
          });
          return admitted.ok
            ? { ok: true as const, operationId: admitted.operation.operationId, created: admitted.created }
            : { ok: false as const, reason: admitted.reason };
        },
      }).ok).toBe(true);
      expect(setDetachedOperationTerminal(db, firstOperationId, {
        terminalState: "failed",
        errorCode: "worker_failed",
        nowMs: 2_000,
      }).ok).toBe(true);
      expect(produceOperationCompletion(db, firstOperationId, { nowMs: 2_001 }))
        .toMatchObject({ ok: true, created: true });

      await serviceWorkerUndertakings(db, {
        nowMs: 2_002,
        worker: async () => ({ ok: true as const, payload: {} }),
        capacityProbe: () => ({ available: true as const }),
      });
      expect(getWorkerUndertaking(db, first.undertaking.undertakingId)?.state).toBe("failed");
      expect(db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id = ?").get(completionEventIdFor(firstOperationId)))
        .toMatchObject({ count: 1 });

      const secondCycle = admitTestCycle(db, {
        cycleId: "cycle:queue-before-completion",
        conversationId: "thread:queue-before-completion",
        triggerKind: "owner_message",
        triggerRef: "owner:queue-before-completion",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 3,
      });
      const second = enqueueWorkerUndertaking(db, input({
        conversationId: secondCycle.conversationId,
        originCycleId: secondCycle.cycleId,
        origin: {
          kind: "OWNER_REQUEST",
          ref: "owner:queue-before-completion",
          ownerEventId: "owner:queue-before-completion",
        },
      }));
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      const secondSelection = selectNextWorkerUndertaking(db, 3_000);
      expect(secondSelection).not.toBeNull();
      if (!secondSelection) return;
      const secondIdempotencyKey = detachedIdempotencyKeyForWorkerUndertaking(second.undertaking.undertakingId);
      const secondOperationId = detachedOperationIdFor(secondIdempotencyKey);
      expect(bindWorkerUndertakingToOperation(db, {
        undertakingId: second.undertaking.undertakingId,
        operationId: secondOperationId,
        calendarIndex: secondSelection.calendarIndex,
        nowMs: 3_000,
        admitOperation: () => {
          const admitted = admitDetachedOperation(db, {
            idempotencyKey: secondIdempotencyKey,
            conversationId: secondCycle.conversationId,
            originCycleId: secondCycle.cycleId,
            originGeneration: secondCycle.generation,
            originKind: "OWNER_REQUEST",
            originRef: "owner:queue-before-completion",
            originOwnerEventId: "owner:queue-before-completion",
            workerUndertakingId: second.undertaking.undertakingId,
            operationKind: "project.investigate",
            request: { projectId: "project-ashley" },
            purpose: "reconcile queue ordering",
            evidenceNeed: "terminal worker evidence",
            operationDeadlineAtMs: 303_000,
            nowMs: 3_000,
          });
          return admitted.ok
            ? { ok: true as const, operationId: admitted.operation.operationId, created: admitted.created }
            : { ok: false as const, reason: admitted.reason };
        },
      }).ok).toBe(true);
      expect(setDetachedOperationTerminal(db, secondOperationId, {
        terminalState: "failed",
        errorCode: "worker_failed",
        nowMs: 4_000,
      }).ok).toBe(true);
      expect(projectWorkerUndertakingTerminal(
        db,
        second.undertaking.undertakingId,
        "failed",
        "worker_failed",
        4_001,
      )?.state).toBe("failed");

      expect(reconcileMissingCompletions(db, { nowMs: 4_002 }))
        .toEqual({ produced: [completionEventIdFor(secondOperationId)], failures: [] });
      expect(reconcileMissingCompletions(db, { nowMs: 4_003 }))
        .toEqual({ produced: [], failures: [] });
      expect(getInboxEvent(db, completionEventIdFor(secondOperationId))).toMatchObject({
        id: completionEventIdFor(secondOperationId),
        kind: "observation_or_receipt",
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id = ?").get(completionEventIdFor(secondOperationId)))
        .toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("does not consume fairness or the singleton slot when capacity disappears after bind", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle:post-bind-race",
        conversationId: "thread:post-bind-race",
        triggerKind: "owner_message",
        triggerRef: "owner:post-bind-race",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const admitted = enqueueWorkerUndertaking(db, input({
        conversationId: "thread:post-bind-race",
        originCycleId: "cycle:post-bind-race",
        origin: { kind: "OWNER_REQUEST", ref: "owner:post-bind-race", ownerEventId: "owner:post-bind-race" },
      }));
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;

      let probeCalls = 0;
      let workerCalls = 0;
      const raced = await serviceWorkerUndertakings(db, {
        nowMs: 2_000,
        worker: async () => {
          workerCalls += 1;
          return { ok: true as const, payload: {} };
        },
        capacityProbe: () => {
          probeCalls += 1;
          return probeCalls === 1
            ? { available: true as const }
            : { available: false as const, reason: "worker_capacity_exhausted", nextProbeAtMs: 5_000 };
        },
      });
      expect(raced.failures).toEqual([]);
      expect(workerCalls).toBe(0);
      const afterRace = getWorkerUndertaking(db, admitted.undertaking.undertakingId);
      expect(afterRace).toMatchObject({
        state: "queued",
        blockedReason: "capacity",
        capacityNextProbeAtMs: 5_000,
      });
      expect(afterRace?.selectedOperationId).toBeTruthy();
      expect(getWorkerExecutionSlot(db)).toMatchObject({ undertakingId: null, operationId: null });
      expect(getWorkerSchedulerCursor(db)).toBe(0);
      const operationId = afterRace?.selectedOperationId ?? "";
      expect(getDetachedOperation(db, operationId)).toMatchObject({ state: "waiting_capacity" });

      const retried = await serviceWorkerUndertakings(db, {
        nowMs: 5_000,
        worker: async ({ operation }) => {
          workerCalls += 1;
          expect(operation.operationId).toBe(operationId);
          return { ok: true as const, payload: {} };
        },
        capacityProbe: () => ({ available: true as const }),
      });
      expect(retried.serviced).toEqual([admitted.undertaking.undertakingId]);
      expect(workerCalls).toBe(1);
      expect(getWorkerUndertaking(db, admitted.undertaking.undertakingId)?.state).toBe("succeeded");
    } finally {
      db.close();
    }
  });

  it("expires a bound curiosity before start without invoking the worker", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle:curiosity-bound-expiry",
        conversationId: "thread:curiosity-bound-expiry",
        triggerKind: "idle_opportunity",
        triggerRef: "curiosity:bound-expiry",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const admitted = enqueueWorkerUndertaking(db, input({
        conversationId: "thread:curiosity-bound-expiry",
        originCycleId: "cycle:curiosity-bound-expiry",
        origin: { kind: "ASHLEY_CURIOSITY", ref: "curiosity:bound-expiry" },
        nowMs: 100,
      }));
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;
      const selection = selectNextWorkerUndertaking(db, 100);
      expect(selection).not.toBeNull();
      if (!selection) return;
      const idempotencyKey = detachedIdempotencyKeyForWorkerUndertaking(admitted.undertaking.undertakingId);
      const operationId = detachedOperationIdFor(idempotencyKey);
      expect(bindWorkerUndertakingToOperation(db, {
        undertakingId: admitted.undertaking.undertakingId,
        operationId,
        calendarIndex: selection.calendarIndex,
        nowMs: 100,
        admitOperation: () => {
          const operation = admitDetachedOperation(db, {
            idempotencyKey,
            conversationId: "thread:curiosity-bound-expiry",
            originCycleId: "cycle:curiosity-bound-expiry",
            originGeneration: 1,
            originKind: "ASHLEY_CURIOSITY",
            originRef: "curiosity:bound-expiry",
            operationKind: "project.investigate",
            request: { projectId: "project-ashley" },
            purpose: "bounded curiosity",
            evidenceNeed: "bounded evidence",
            operationDeadlineAtMs: 100 + 300_000,
            nowMs: 100,
          });
          return operation.ok
            ? { ok: true as const, operationId: operation.operation.operationId, created: operation.created }
            : { ok: false as const, reason: operation.reason };
        },
      }).ok).toBe(true);
      db.prepare(
        "UPDATE worker_undertakings SET curiosity_expires_at_ms = ? WHERE undertaking_id = ?",
      ).run(100 + CURIOSITY_TTL_MS, admitted.undertaking.undertakingId);

      let workerCalls = 0;
      const result = await serviceWorkerUndertakings(db, {
        nowMs: 100 + CURIOSITY_TTL_MS,
        worker: async () => {
          workerCalls += 1;
          return { ok: true as const, payload: {} };
        },
        capacityProbe: () => ({ available: true as const }),
      });
      expect(result.expired).toContain(admitted.undertaking.undertakingId);
      expect(workerCalls).toBe(0);
      expect(getWorkerUndertaking(db, admitted.undertaking.undertakingId)?.state).toBe("expired");
      expect(getDetachedOperation(db, operationId)).toMatchObject({ state: "cancelled", terminalState: "cancelled" });
      expect(getWorkerExecutionSlot(db).undertakingId).toBeNull();
    } finally {
      db.close();
    }
  });

  it("allows three pending curiosity rows plus one running curiosity row", () => {
    const db = openTestSidecar();
    try {
      const admitted: string[] = [];
      for (let index = 0; index < MAX_PENDING_CURIOSITY; index += 1) {
        const row = enqueueWorkerUndertaking(db, input({
          origin: { kind: "ASHLEY_CURIOSITY", ref: `curiosity:pending:${index}` },
          nowMs: 1_000 + index,
        }));
        expect(row.ok).toBe(true);
        if (row.ok) admitted.push(row.undertaking.undertakingId);
      }
      const selection = selectNextWorkerUndertaking(db, 2_000);
      expect(selection).not.toBeNull();
      if (!selection) return;
      expect(bindWorkerUndertakingToOperation(db, {
        undertakingId: selection.undertaking.undertakingId,
        operationId: "detached-operation:curiosity-running",
        calendarIndex: selection.calendarIndex,
        nowMs: 2_000,
        admitOperation: () => ({ ok: true as const, operationId: "detached-operation:curiosity-running", created: true }),
      }).ok).toBe(true);
      expect(markWorkerUndertakingRunning(db, selection.undertaking.undertakingId, "detached-operation:curiosity-running", 2_001))
        .toMatchObject({ state: "running" });
      const fourth = enqueueWorkerUndertaking(db, input({
        origin: { kind: "ASHLEY_CURIOSITY", ref: "curiosity:pending:fourth" },
        nowMs: 2_002,
      }));
      expect(fourth).toMatchObject({ ok: true });
      expect(admitted).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it("supersedes stale commitment work before binding", async () => {
    const db = openTestSidecar();
    try {
      const admitted = enqueueWorkerUndertaking(db, input({
        origin: { kind: "ASHLEY_COMMITMENT", ref: "commitment:stale" },
        nowMs: 1_000,
      }));
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;
      let workerCalls = 0;
      const result = await serviceWorkerUndertakings(db, {
        nowMs: 2_000,
        worker: async () => {
          workerCalls += 1;
          return { ok: true as const, payload: {} };
        },
        capacityProbe: () => ({ available: true as const }),
        commitmentCurrent: () => false,
      });
      expect(result.failures).toEqual([]);
      expect(workerCalls).toBe(0);
      expect(getWorkerUndertaking(db, admitted.undertaking.undertakingId)).toMatchObject({
        state: "superseded",
        supersededBy: "commitment_currentness:commitment:stale",
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM detached_operations").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("repairs a stale terminal slot after reopening the sidecar", () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-wq-recovery-"));
    const databasePath = join(root, "cognitive.db");
    let db: DatabaseSync | null = null;
    try {
      db = openCognitiveSidecarDb(new DatabaseSync(databasePath), { dataPlane: { kind: "isolated" } });
      const admitted = enqueueWorkerUndertaking(db, input({
        origin: { kind: "OWNER_REQUEST", ref: "recovery:terminal-slot", ownerEventId: "recovery:terminal-slot" },
        nowMs: 1_000,
      }));
      expect(admitted.ok).toBe(true);
      if (!admitted.ok) return;
      db.prepare(
        `UPDATE worker_undertakings
            SET state = 'succeeded', terminal_reason = 'recovered_test', terminal_at_ms = 2_000
          WHERE undertaking_id = ?`,
      ).run(admitted.undertaking.undertakingId);
      db.prepare(
        `UPDATE worker_execution_slot
            SET undertaking_id = ?, operation_id = 'detached-operation:recovery',
                claim_token = 'stale', updated_at_ms = 2_000
          WHERE slot_id = 1`,
      ).run(admitted.undertaking.undertakingId);
      db.close();
      db = null;

      db = openCognitiveSidecarDb(new DatabaseSync(databasePath), { dataPlane: { kind: "isolated" } });
      expect(getWorkerExecutionSlot(db)).toMatchObject({ undertakingId: null, operationId: null });
    } finally {
      db?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
