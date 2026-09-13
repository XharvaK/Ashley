import { describe, expect, it, vi } from "vitest";
import { appendInboxEvent, getCycle, updateCycleState } from "./inbox.js";
import { admitWake } from "../wake/ledger.js";
import { putInFlight } from "../effect/in-flight.js";
import { appendAshleyEvidence, appendOwnerUtterance } from "../evidence/conversation-log.js";
import { frontierAwareEvidenceSelection } from "../thought/input.js";
import {
  claimNextInboxEvent,
  consumeNextInboxEvent,
  startInboxConsumer,
  STEADY_STATE_RECONCILIATION_MAX_INVOCATION_GAP_MS,
  STEADY_STATE_RECONCILIATION_OPPORTUNISTIC_FLOOR_MS,
  STEADY_STATE_RECONCILIATION_BATCH_LIMIT,
} from "./inbox-consumer.js";
import { PERIODIC_RECOVERY_DISPATCH_BLOCKED } from "../dispatch/live.js";
import { startDurableAttempt, settleDurableAttempt } from "../retry/ledger.js";
import { reconcileStrandedOutcomeUnknownAtStartup } from "../retry/startup-outcome-recovery.js";
import { reservePrivateThought, releasePrivateReservation } from "../private-budget/ledger.js";
import { reconcilePolicyClock } from "../private-budget/policy-time-ledger.js";
import { openObservabilityStore, purgeThoughtDebugCaptures, RAW_DEBUG_RETENTION_MAX_MS } from "../thought/diagnostics.js";
import { openTestSidecar } from "../test-support.js";
import type { KernelRunResult, OwnerObligationResolution } from "../types.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function publishedResult(ownerObligationResolution: OwnerObligationResolution): KernelRunResult {
  return {
    cycleId: "cycle:owner-resolution",
    generation: 1,
    published: true,
    outboxId: null,
    infrastructureNotice: null,
    thoughtModelAttempts: 1,
    acceptedThoughtPasses: 1,
    composeCancelledAttempts: 0,
    acceptedSettlements: 1,
    ownerObligationResolution,
  };
}

function seedStranded(
  db: ReturnType<typeof openTestSidecar>,
  tag: string,
  createdAtMs: number,
  nowMs = 1_000,
): { eventId: string; wakeId: string; cycleId: string; conversationId: string } {
  const conversationId = `conversation:ss:${tag}`;
  const cycleId = `cycle:ss:${tag}`;
  const admitted = admitWake(db, {
    occurrenceId: `occurrence:ss:${tag}`,
    triggerRef: `trigger:ss:${tag}`,
    sourceKind: "inbox",
    conversationId,
    cycleId,
    capturedAuthorityRevision: 1,
    nowMs: 1,
  });
  const wakeId = admitted.wake.wakeId;
  const eventId = `event:ss:${tag}`;
  db.prepare(
    `INSERT INTO inbox_events
       (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
     VALUES (?, ?, 'test', '{}', ?, 'pending', ?)`,
  ).run(eventId, conversationId, createdAtMs, wakeId);
  updateCycleState(db, cycleId, "thinking", 2);
  const started = startDurableAttempt(db, { eventId, workerId: "worker", nowMs });
  settleDurableAttempt(db, {
    eventId,
    attemptId: started.attemptId,
    claimToken: started.claimToken,
    result: { kind: "outcome_unknown", operationId: `operation:ss:${tag}`, errorCode: "worker_crash" },
    nowMs: nowMs + 100,
  });
  return { eventId, wakeId, cycleId, conversationId };
}

async function waitForState(
  db: ReturnType<typeof openTestSidecar>,
  eventId: string,
  state: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(eventId) as { state?: unknown } | undefined;
    if (row?.state === state) return true;
    if (Date.now() >= deadline) return false;
    await sleep(25);
  }
}

/**
 * Convergence under a live loop means the row leaves `reconciling` through
 * the proof-gated pass. With realistic timestamps the loop may then
 * legitimately claim and consume it (terminal/consumed) — both prove the
 * steady-state opportunity occurred. Quarantine proves it did not converge.
 */
async function waitForConvergence(
  db: ReturnType<typeof openTestSidecar>,
  eventId: string,
  timeoutMs = 5_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(eventId) as { state?: unknown } | undefined;
    if (row?.state === "pending" || row?.state === "terminal") return row.state as string;
    if (row?.state === "quarantined") return row.state as string;
    if (Date.now() >= deadline) return typeof row?.state === "string" ? (row.state as string) : null;
    await sleep(25);
  }
}

describe("durable cognitive inbox consumer", () => {
  it("does not ordinary-complete an Owner event when the cognitive envelope is missing", async () => {
    const db = openTestSidecar();
    try {
      appendInboxEvent(db, {
        id: "event:owner-missing-envelope",
        conversationId: "conversation:owner-missing-envelope",
        kind: "owner_message",
        payload: {},
        createdAtMs: 1,
      });
      const result = await consumeNextInboxEvent(db, {
        workerId: "owner-missing-envelope-worker",
        nowMs: () => 1_000,
        handler: async () => ({
          cycleId: "cycle:owner-missing-envelope",
          generation: 1,
          published: true,
          outboxId: null,
          infrastructureNotice: null,
          thoughtModelAttempts: 1,
          acceptedThoughtPasses: 1,
          composeCancelledAttempts: 0,
          acceptedSettlements: 1,
        }),
      });

      expect(result).toMatchObject({ outcome: "failed" });
      expect(db.prepare("SELECT state, status, last_failure_class FROM inbox_events WHERE id = 'event:owner-missing-envelope'").get()).toMatchObject({
        state: "retry_wait",
        status: "failed_retryable",
        last_failure_class: "transient_retryable",
      });
    } finally {
      db.close();
    }
  });

  it("keeps publication rejection retry-owned instead of entering outcome_unknown reconciliation", async () => {
    const db = openTestSidecar();
    try {
      appendInboxEvent(db, {
        id: "event:publication-rejected",
        conversationId: "conversation:publication-rejected",
        kind: "owner_message",
        payload: {},
        createdAtMs: 1,
      });
      const result = await consumeNextInboxEvent(db, {
        workerId: "publication-rejected-worker",
        nowMs: () => 1_000,
        handler: async () => ({
          cycleId: "cycle:publication-rejected",
          generation: 1,
          published: false,
          outboxId: null,
          infrastructureNotice: null,
          thoughtModelAttempts: 1,
          acceptedThoughtPasses: 1,
          composeCancelledAttempts: 0,
          acceptedSettlements: 0,
          publicationReason: "stale_generation" as const,
          thoughtExecutionProvenance: { dispatchTruth: "sent" as const, providerAttempts: 1 },
          ownerObligationResolution: {
            attemptOutcome: "rejected",
            ownerObligationOutcome: "unresolved",
            primaryEventId: "event:publication-rejected",
            coveredOwnerEventIds: ["event:publication-rejected"],
            uncoveredOwnerEventIds: [],
            coverageHash: "coverage-hash",
            semanticCommitment: null,
            settlementId: null,
            successorIdentity: null,
            remainingResponsibility: "publication_rejected",
            deliveryDisposition: "not_applicable",
          },
        }),
      });

      expect(result).toMatchObject({ outcome: "failed" });
      expect(db.prepare("SELECT state, status, last_failure_class, last_error FROM inbox_events WHERE id = 'event:publication-rejected'").get()).toMatchObject({
        state: "retry_wait",
        status: "failed_retryable",
        last_failure_class: "transient_retryable",
        last_error: "publication_rejected:stale_generation",
      });
    } finally {
      db.close();
    }
  });

  it("treats an undefined handler result as a bounded dispatch failure", async () => {
    const db = openTestSidecar();
    try {
      appendInboxEvent(db, {
        id: "event:undefined-result",
        conversationId: "conversation:undefined-result",
        kind: "owner_message",
        payload: {},
        createdAtMs: 1,
      });
      const result = await consumeNextInboxEvent(db, {
        workerId: "undefined-result-worker",
        nowMs: () => 1_000,
        handler: async () => undefined,
      });

      expect(result).toMatchObject({ outcome: "failed" });
      expect(db.prepare("SELECT state, status, last_failure_class, last_error FROM inbox_events WHERE id = 'event:undefined-result'").get()).toMatchObject({
        state: "retry_wait",
        status: "failed_retryable",
        last_failure_class: "unclassified_internal",
        last_error: "cognitive_dispatch_result_missing",
      });
    } finally {
      db.close();
    }
  });

  it("keeps a published Owner event retryable when the result envelope is unresolved", async () => {
    const db = openTestSidecar();
    try {
      appendInboxEvent(db, {
        id: "event:owner-unresolved-publication",
        conversationId: "conversation:owner-unresolved-publication",
        kind: "owner_message",
        payload: {},
        createdAtMs: 1,
      });
      const result = await consumeNextInboxEvent(db, {
        workerId: "owner-resolution-worker",
        nowMs: () => 1_000,
        handler: async () => publishedResult({
          attemptOutcome: "published",
          ownerObligationOutcome: "unresolved",
          primaryEventId: "event:owner-unresolved-publication",
          coveredOwnerEventIds: ["event:owner-unresolved-publication"],
          uncoveredOwnerEventIds: [],
          coverageHash: "coverage-hash",
          semanticCommitment: null,
          settlementId: "settlement:owner-unresolved-publication",
          successorIdentity: null,
          remainingResponsibility: "owner_conversational_obligation",
          deliveryDisposition: "delivery_unknown",
        }),
      });

      expect(result).toMatchObject({ outcome: "failed" });
      expect(db.prepare("SELECT state, status, last_failure_class FROM inbox_events WHERE id = 'event:owner-unresolved-publication'").get()).toMatchObject({
        state: "retry_wait",
        status: "failed_retryable",
        last_failure_class: "transient_retryable",
      });
    } finally {
      db.close();
    }
  });

  it("recovers a shared-wake backlog without losing pre-provider Owner context", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:shared-wake-backlog";
      const cycleId = "cycle:shared-wake-backlog";
      const admitted = admitWake(db, {
        occurrenceId: "occurrence:shared-wake-backlog",
        triggerRef: "trigger:shared-wake-backlog",
        sourceKind: "inbox",
        conversationId,
        cycleId,
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      const wakeId = admitted.wake.wakeId;
      updateCycleState(db, cycleId, "thinking", 2);

      const response = appendAshleyEvidence(db, {
        conversationId,
        text: "R0",
        discordMessageIds: ["discord:r0"],
        delivered: true,
        nowMs: 50,
      });
      const ownerA = appendOwnerUtterance(db, {
        conversationId,
        text: "Owner A substantive question",
        discordMessageIds: ["discord:a"],
        nowMs: 100,
      });
      const ownerB = appendOwnerUtterance(db, {
        conversationId,
        text: "ash you there?",
        discordMessageIds: ["discord:b"],
        nowMs: 200,
      });
      const ownerC = appendOwnerUtterance(db, {
        conversationId,
        text: "Hello?",
        discordMessageIds: ["discord:c"],
        nowMs: 300,
      });

      const appendEvent = (id: string, evidenceRowId: string, createdAtMs: number) => appendInboxEvent(db, {
        id,
        conversationId,
        kind: "owner_utterance",
        payload: { cycleId, wakeId, evidenceRowId },
        createdAtMs,
        wakeId,
      });
      appendEvent("event:shared-wake-a", ownerA.rowId, 100);
      appendEvent("event:shared-wake-b", ownerB.rowId, 200);
      appendEvent("event:shared-wake-c", ownerC.rowId, 300);

      const started = startDurableAttempt(db, {
        eventId: "event:shared-wake-a",
        workerId: "seed-worker",
        nowMs: 1_000,
      });
      expect(settleDurableAttempt(db, {
        eventId: "event:shared-wake-a",
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: {
          kind: "failed",
          failureClass: "transient_retryable",
          errorCode: "provider_unavailable",
          dispatchTruth: "not_started",
        },
        nowMs: 1_100,
      }).kind).toBe("retry_wait");

      const claimed = claimNextInboxEvent(db, {
        workerId: "recovery-worker",
        nowMs: 1_000 + (15 * 60 * 1_000) + 1,
      });
      expect(claimed?.id).toBe("event:shared-wake-b");

      expect(db.prepare(
        "SELECT state, status, attempt_count, terminal_reason, quarantine_reason FROM inbox_events WHERE id = ?",
      ).get("event:shared-wake-a")).toMatchObject({
        state: "quarantined",
        status: "failed_terminal",
        attempt_count: 1,
        terminal_reason: "age_exhausted",
        quarantine_reason: "age_exhausted",
      });
      expect(db.prepare(
        "SELECT state, status, attempt_count FROM inbox_events WHERE id = ?",
      ).get("event:shared-wake-b")).toMatchObject({ state: "leased", status: "claimed", attempt_count: 1 });
      expect(db.prepare(
        "SELECT state, status, attempt_count FROM inbox_events WHERE id = ?",
      ).get("event:shared-wake-c")).toMatchObject({ state: "pending", status: "pending", attempt_count: 0 });
      expect(db.prepare("SELECT state FROM wakes WHERE wake_id = ?").get(wakeId)).toMatchObject({ state: "authorized" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM durable_work_attempts").get()).toMatchObject({ count: 2 });

      const selected = frontierAwareEvidenceSelection(db, conversationId, { lastNTurns: 12 }).selectedEvidence;
      expect(selected.map((row) => row.text)).toEqual(["R0", ownerA.text, ownerB.text, ownerC.text]);
      expect(selected.map((row) => row.rowId)).toEqual([response.rowId, ownerA.rowId, ownerB.rowId, ownerC.rowId]);
      expect(selected.filter((row) => row.role === "ashley").map((row) => row.text)).toEqual(["R0"]);
      expect(selected.filter((row) => row.role === "owner").every((row) => row.delivered === false)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("reclaims a 202-admitted event after a worker lease expires", async () => {
    const db = openTestSidecar();
    appendInboxEvent(db, { conversationId: "thread-restart", kind: "owner_message", payload: {}, createdAtMs: 1 });
    const claimed = claimNextInboxEvent(db, { workerId: "crashed-worker", nowMs: 10, leaseMs: 5 });
    expect(claimed?.status).toBe("claimed");
    const seen: string[] = [];
    const result = await consumeNextInboxEvent(db, {
      workerId: "restarted-worker",
      nowMs: () => 20,
      handler: async (event) => {
        seen.push(event.id);
        return { kind: "completed" };
      },
    });
    expect(result).toMatchObject({ outcome: "consumed" });
    expect(seen).toHaveLength(1);
    expect(db.prepare("SELECT status, attempt_count FROM inbox_events").get()).toMatchObject({ status: "consumed", attempt_count: 2 });
    db.close();
  });

  it("holds publication work for reconciliation after a crash instead of replaying it", async () => {
    const db = openTestSidecar();
    appendInboxEvent(db, { id: "event-replay", conversationId: "thread-replay", kind: "owner_message", payload: {}, createdAtMs: 1 });
    let calls = 0;
    const first = await consumeNextInboxEvent(db, {
      workerId: "worker-a",
      handler: async () => {
        calls += 1;
        db.prepare("INSERT OR IGNORE INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)").run("settlement-replay", "cycle-replay", 1, "{}");
        if (calls === 1) throw new Error("crash_after_publication_commit");
        return { kind: "completed" };
      },
    });
    const second = await consumeNextInboxEvent(db, {
      workerId: "worker-b",
      handler: async () => {
        db.prepare("INSERT OR IGNORE INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)").run("settlement-replay", "cycle-replay", 1, "{}");
        return { kind: "completed" };
      },
    });
    expect(first).toMatchObject({ outcome: "failed" });
    expect(second).toMatchObject({ outcome: "idle" });
    expect(calls).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT status, state FROM inbox_events WHERE id = 'event-replay'").get()).toMatchObject({ status: "claimed", state: "reconciling" });
    db.close();
  });

  it("stops the polling loop without leaving a timer behind", async () => {
    const db = openTestSidecar();
    const handler = vi.fn(async () => ({ kind: "completed" as const }));
    const loop = startInboxConsumer(db, { workerId: "worker-loop", handler, pollMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    loop.stop();
    await loop.done;
    expect(handler).not.toHaveBeenCalled();
    db.close();
  });
});

describe("P0 steady-state reconciliation (R7 §22.2)", () => {
  it("pins the frozen steady-state reconciliation bounds", () => {
    expect(STEADY_STATE_RECONCILIATION_MAX_INVOCATION_GAP_MS).toBe(60_000);
    expect(STEADY_STATE_RECONCILIATION_OPPORTUNISTIC_FLOOR_MS).toBe(1_000);
    expect(STEADY_STATE_RECONCILIATION_BATCH_LIMIT).toBe(5);
  });

  it("STEADY_STATE_RECONCILIATION_INVOCATION_BOUND under continuous-consumed traffic", async () => {
    const db = openTestSidecar();
    try {
      // Saturating traffic: the loop never idles. Under the old
      // outcome-based design no reconciliation opportunity would ever occur.
      for (let i = 0; i < 200; i += 1) {
        appendInboxEvent(db, { conversationId: "thread-busy", kind: "owner_message", payload: {}, createdAtMs: i });
      }
      let handlerCalls = 0;
      const loop = startInboxConsumer(db, {
        workerId: "worker-busy",
        handler: async () => {
          handlerCalls += 1;
          return { kind: "completed" as const };
        },
        pollMs: 1,
        reconciliationGapMs: 40,
        reconciliationOpportunisticFloorMs: 5,
        reconciliationBatchLimit: 5,
      });
      try {
        // A row strands mid-run (after the cadence clock has advanced past
        // its init): it must still converge without restart. Realistic
        // timestamps: ancient first_attempt values would age-quarantine under
        // the live loop's real clock (existing lifecycle, unrelated to P0).
        await sleep(120);
        const seedNow = Date.now();
        const stranded = seedStranded(db, "busy", seedNow, seedNow);
        expect(await waitForConvergence(db, stranded.eventId)).toMatch(/^(pending|terminal)$/);
        expect(handlerCalls).toBeGreaterThan(20);
      } finally {
        loop.stop();
        await loop.done;
      }
    } finally {
      db.close();
    }
  });

  it("STEADY_STATE_RECONCILIATION_INVOCATION_BOUND while idle", async () => {
    const db = openTestSidecar();
    try {
      const seedNow = Date.now();
      const stranded = seedStranded(db, "idle", seedNow, seedNow);
      const loop = startInboxConsumer(db, {
        workerId: "worker-idle",
        handler: async () => ({ kind: "completed" as const }),
        pollMs: 5,
        reconciliationGapMs: 40,
        reconciliationOpportunisticFloorMs: 5,
        reconciliationBatchLimit: 5,
      });
      try {
        // Idle service reconciles without restart.
        expect(await waitForConvergence(db, stranded.eventId)).toMatch(/^(pending|terminal)$/);
      } finally {
        loop.stop();
        await loop.done;
      }
    } finally {
      db.close();
    }
  });

  it("LONG_HANDLER_RECONCILIATION_OPPORTUNITY", async () => {
    const db = openTestSidecar();
    const observability = openObservabilityStore(":memory:");
    try {
      const stranded = seedStranded(db, "long-handler", 1);
      const expiredDebugNowMs = Date.now() - 120_000;
      for (let i = 0; i < 60; i += 1) {
        observability.enableThoughtDebugCapture({
          occurrenceId: `debug-expired-${i}`,
          ttlMs: 0,
          enabledBy: "owner",
          captureMode: "rich",
          nowMs: expiredDebugNowMs,
        });
      }
      observability.enableThoughtDebugCapture({
        occurrenceId: "debug-leased-row",
        ttlMs: RAW_DEBUG_RETENTION_MAX_MS,
        enabledBy: "owner",
        captureMode: "rich",
        nowMs: Date.now(),
      });
      appendInboxEvent(db, {
        id: "event:long-handler",
        conversationId: "thread-long",
        kind: "owner_message",
        payload: {},
        createdAtMs: 2,
      });
      let releaseHandler!: () => void;
      const handlerGate = new Promise<void>((resolve) => {
        releaseHandler = resolve;
      });
      let handlerSettled = false;
      const maintenanceCalls: number[] = [];
      const loop = startInboxConsumer(db, {
        workerId: "worker-long",
        handler: async (event) => {
          if (event.id !== "event:long-handler") return { kind: "completed" as const };
          await handlerGate;
          handlerSettled = true;
          return { kind: "completed" as const };
        },
        pollMs: 5,
        reconciliationGapMs: 40,
        reconciliationOpportunisticFloorMs: 5,
        reconciliationBatchLimit: 5,
        onReconciliationMaintenance: (nowMs) => {
          maintenanceCalls.push(nowMs);
          purgeThoughtDebugCaptures(observability.db, nowMs);
        },
      });
      try {
        // The in-flight deadline converges the proof-resolvable row BEFORE
        // the held handler is released, with zero provider calls.
        expect(await waitForState(db, stranded.eventId, "pending")).toBe(true);
        expect(handlerSettled).toBe(false);
        expect(maintenanceCalls.length).toBeGreaterThan(0);
        expect(db.prepare("SELECT state FROM inbox_events WHERE id = 'event:long-handler'").get()).toMatchObject({ state: "leased" });
        expect(observability.db.prepare("SELECT COUNT(*) AS count FROM thought_debug_captures WHERE occurrence_id LIKE 'debug-expired-%'").get()).toMatchObject({ count: 0 });
        expect(observability.db.prepare("SELECT COUNT(*) AS count FROM thought_debug_captures WHERE occurrence_id = 'debug-leased-row'").get()).toMatchObject({ count: 1 });
      } finally {
        releaseHandler();
        await waitForState(db, "event:long-handler", "terminal");
        loop.stop();
        await loop.done;
      }
      // The actively leased handler row settles normally after release.
      expect(db.prepare("SELECT state, status FROM inbox_events WHERE id = 'event:long-handler'").get()).toMatchObject({
        state: "terminal",
        status: "consumed",
      });
      expect(handlerSettled).toBe(true);
    } finally {
      db.close();
      observability.close();
    }
  });

  it("runs observability maintenance after an idle post-tick opportunity", async () => {
    const db = openTestSidecar();
    try {
      const maintenanceCalls: number[] = [];
      const loop = startInboxConsumer(db, {
        workerId: "worker-maintenance-idle",
        handler: async () => ({ kind: "completed" as const }),
        pollMs: 5,
        reconciliationGapMs: 40,
        reconciliationOpportunisticFloorMs: 5,
        reconciliationBatchLimit: 5,
        onReconciliationMaintenance: (nowMs) => maintenanceCalls.push(nowMs),
      });
      try {
        await sleep(100);
        expect(maintenanceCalls.length).toBeGreaterThan(0);
      } finally {
        loop.stop();
        await loop.done;
      }
    } finally {
      db.close();
    }
  });

  it("isolates maintenance failure from reconciliation and cognition truth", async () => {
    const db = openTestSidecar();
    try {
      const seedNow = Date.now();
      const stranded = seedStranded(db, "maintenance-throw", seedNow, seedNow);
      const errors: unknown[] = [];
      const handler = vi.fn(async () => ({ kind: "completed" as const }));
      const loop = startInboxConsumer(db, {
        workerId: "worker-maintenance-throw",
        handler,
        pollMs: 5,
        reconciliationGapMs: 40,
        reconciliationOpportunisticFloorMs: 5,
        reconciliationBatchLimit: 5,
        onReconciliationMaintenance: () => {
          throw new Error("observability_purge_failed");
        },
        onError: (error) => errors.push(error),
      });
      try {
        expect(await waitForState(db, stranded.eventId, "terminal")).toBe(true);
        expect(db.prepare("SELECT state, status FROM inbox_events WHERE id = ?").get(stranded.eventId)).toMatchObject({
          state: "terminal",
          status: "consumed",
        });
        expect(handler).toHaveBeenCalled();
        expect(errors.some((error) => error instanceof Error && error.message === "observability_purge_failed")).toBe(true);
      } finally {
        loop.stop();
        await loop.done;
      }
    } finally {
      db.close();
    }
  });

  it("HISTORICAL_RECONCILING_ROW_DOES_NOT_BLOCK_UNRELATED_NEW_COGNITION", async () => {
    const db = openTestSidecar();
    try {
      const old = seedStranded(db, "historical", 1);
      putInFlight(db, {
        effectId: "effect:historical",
        cycleId: old.cycleId,
        generation: 1,
        wakeId: old.wakeId,
        correlationId: "corr:historical",
        idempotencyKey: "idem:historical",
        dispatchedAtMs: 1_050,
        originEventId: old.eventId,
      });
      appendInboxEvent(db, {
        id: "event:new-work",
        conversationId: "thread-new",
        kind: "owner_message",
        payload: {},
        createdAtMs: 2,
      });
      const seen: string[] = [];
      const tick = await consumeNextInboxEvent(db, {
        workerId: "worker-new",
        handler: async (event) => {
          seen.push(event.id);
          return { kind: "completed" as const };
        },
      });
      expect(tick).toMatchObject({ outcome: "consumed", eventId: "event:new-work" });
      expect(seen).toEqual(["event:new-work"]);
      expect(db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(old.eventId)).toMatchObject({ state: "reconciling" });
      expect(getCycle(db, old.cycleId)?.state).toBe("thinking");
    } finally {
      db.close();
    }
  });

  it("PERIODIC_RECOVERED_PENDING_KILL_SWITCH_OFF_NO_GENERIC_DISPATCH", async () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "0");
    const db = openTestSidecar();
    try {
      const nowMs = 3_000_000;
      reconcilePolicyClock(db, { policyId: "private-v1", wallClockNowMs: nowMs, authorizationRef: "owner:defer" });
      const admitted = admitWake(db, {
        occurrenceId: "occurrence:defer",
        triggerRef: "periodic:occurrence:defer:3000000",
        sourceKind: "inbox",
        conversationId: "conversation:defer",
        cycleId: "cycle:defer",
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      const reserved = reservePrivateThought(db, {
        admissionId: "adm:defer",
        wakeId: admitted.wake.wakeId,
        conversationId: "conversation:defer",
        policyId: "private-v1",
        wallClockNowMs: nowMs,
      });
      if (reserved.kind !== "reserved") throw new Error("reserve_failed");
      appendInboxEvent(db, {
        id: "event:defer",
        wakeId: admitted.wake.wakeId,
        conversationId: "conversation:defer",
        kind: "idle_opportunity",
        payload: { privateBudgetReservationId: reserved.reservation.reservationId },
        createdAtMs: 2,
      });
      const handler = vi.fn(async () => ({ kind: "completed" as const }));
      const tick = await consumeNextInboxEvent(db, {
        workerId: "worker-defer",
        nowMs: () => nowMs,
        handler,
      });
      // Zero new periodic provider dispatch: the handler is never invoked.
      expect(tick).toMatchObject({ outcome: "failed", eventId: "event:defer", error: PERIODIC_RECOVERY_DISPATCH_BLOCKED });
      expect(handler).not.toHaveBeenCalled();
      // Retain/defer via existing retry_wait truth: binding retained, never
      // unbound, no replacement lineage, no terminal fabrication.
      expect(db.prepare("SELECT state, status, last_error, next_eligible_at_ms FROM inbox_events WHERE id = 'event:defer'").get()).toMatchObject({
        state: "retry_wait",
        status: "failed_retryable",
        last_error: PERIODIC_RECOVERY_DISPATCH_BLOCKED,
        next_eligible_at_ms: nowMs + 900_000,
      });
      expect(db.prepare("SELECT state FROM private_budget_reservations WHERE reservation_id = ?").get(reserved.reservation.reservationId)).toMatchObject({
        state: "held",
      });
      expect(db.prepare("SELECT state FROM wakes WHERE wake_id = ?").get(admitted.wake.wakeId)).toMatchObject({ state: "pending" });
      expect((db.prepare("SELECT COUNT(*) AS count FROM settlements").get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
      vi.unstubAllEnvs();
    }
  });

  it("KILL_SWITCH_PERIODIC_RECONCILIATION_STILL_RUNS", () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "");
    const db = openTestSidecar();
    try {
      const nowMs = 4_000_000;
      reconcilePolicyClock(db, { policyId: "private-v1", wallClockNowMs: nowMs, authorizationRef: "owner:still-runs" });
      // Periodic row with uncertain spend truth: stays fenced.
      const admitted = admitWake(db, {
        occurrenceId: "occurrence:fenced",
        triggerRef: "periodic:occurrence:fenced:4000000",
        sourceKind: "inbox",
        conversationId: "conversation:fenced",
        cycleId: "cycle:fenced",
        capturedAuthorityRevision: 1,
        nowMs: 1,
      });
      const reserved = reservePrivateThought(db, {
        admissionId: "adm:fenced",
        wakeId: admitted.wake.wakeId,
        conversationId: "conversation:fenced",
        policyId: "private-v1",
        wallClockNowMs: nowMs,
      });
      if (reserved.kind !== "reserved") throw new Error("reserve_failed");
      releasePrivateReservation(db, {
        reservationId: reserved.reservation.reservationId,
        proofRef: "proof:fenced",
        dispatchTruth: "not_started",
        nowMs,
      });
      const periodicEventId = "event:fenced";
      db.prepare(
        `INSERT INTO inbox_events
           (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
         VALUES (?, 'conversation:fenced', 'test', ?, 1, 'pending', ?)`,
      ).run(
        periodicEventId,
        JSON.stringify({ privateBudgetReservationId: reserved.reservation.reservationId }),
        admitted.wake.wakeId,
      );
      const started = startDurableAttempt(db, { eventId: periodicEventId, workerId: "worker", nowMs });
      settleDurableAttempt(db, {
        eventId: periodicEventId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "outcome_unknown", operationId: "operation:fenced", errorCode: "worker_crash" },
        nowMs: nowMs + 100,
      });
      // Unrelated owner row, proof-resolvable: reconciliation still runs
      // while the kill switch is off.
      const owner = seedStranded(db, "still-runs-owner", 2);
      const recovery = reconcileStrandedOutcomeUnknownAtStartup(db, { nowMs: nowMs + 300, limit: 5 });
      expect(recovery.recoveredEventIds).toContain(owner.eventId);
      expect(db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(owner.eventId)).toMatchObject({ state: "pending" });
      expect(db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(periodicEventId)).toMatchObject({ state: "reconciling" });
    } finally {
      db.close();
      vi.unstubAllEnvs();
    }
  });
});
