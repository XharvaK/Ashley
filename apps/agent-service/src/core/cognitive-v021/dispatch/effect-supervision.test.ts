import { afterEach, describe, expect, it, vi } from "vitest";
import { claimConversationCognition } from "../cycle/cognition-claim.js";
import { acceptEffectContinuation, isEffectContinuationCurrent } from "../effect/continuation.js";
import { putInFlight } from "../effect/in-flight.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { startDurableAttempt } from "../retry/ledger.js";
import { superviseEffectExecution } from "./effect-supervision.js";
import { LONG_OPERATION_HORIZON_MS } from "../../sandbox/worker/contracts.js";

const BASE = 1_800_000_000_000;

function setup() {
  const db = openTestSidecar();
  const cycle = admitTestCycle(db, {
    cycleId: "cycle-long-effect",
    conversationId: "conversation-long-effect",
    triggerKind: "owner_message",
    triggerRef: "event-long-effect",
    nowMs: BASE,
  });
  const attempt = startDurableAttempt(db, {
    eventId: "event-long-effect",
    workerId: "worker-long-effect",
    nowMs: BASE,
  });
  const wakeId = cycle.wakeId ?? attempt.wakeId;
  if (!wakeId) throw new Error("wake_missing");
  const cognition = claimConversationCognition(db, {
    conversationId: cycle.conversationId,
    eventId: "event-long-effect",
    wakeId,
    cycleId: cycle.cycleId,
    generation: cycle.generation,
    nowMs: BASE,
  });
  if (!cognition.ok) throw new Error("cognition_claim_failed");
  return {
    db,
    cycle,
    attempt,
    cognition,
    ownership: {
      eventId: attempt.eventId,
      conversationId: cycle.conversationId,
      wakeId,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      workerId: attempt.workerId,
      claimToken: attempt.claimToken,
      attemptId: attempt.attemptId,
      cognitionClaimToken: cognition.claimToken,
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("long effect ownership supervision", () => {
  it("renews the same wake, inbox, and cognition owners through a quiet 16-minute await", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = setup();
    try {
      let finish!: (value: string) => void;
      const execution = new Promise<string>((resolve) => { finish = resolve; });
      const controller = new AbortController();
      const initialTokens = {
        wake: fixture.db.prepare("SELECT lease_token FROM wakes WHERE wake_id = ?").get(fixture.attempt.wakeId),
        inbox: fixture.db.prepare("SELECT claim_token FROM inbox_events WHERE id = ?").get(fixture.attempt.eventId),
        cognition: fixture.db.prepare("SELECT claim_token FROM cognition_claims WHERE conversation_id = ?").get(fixture.cycle.conversationId),
      };
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 45 * 60_000,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute: () => execution,
      });

      await vi.advanceTimersByTimeAsync(16 * 60_000);
      expect(fixture.db.prepare("SELECT lease_token, lease_expires_at_ms FROM wakes WHERE wake_id = ?").get(fixture.attempt.wakeId)).toMatchObject({
        lease_token: (initialTokens.wake as { lease_token: string }).lease_token,
      });
      expect(fixture.db.prepare("SELECT claim_token, lease_expires_at_ms FROM inbox_events WHERE id = ?").get(fixture.attempt.eventId)).toMatchObject({
        claim_token: (initialTokens.inbox as { claim_token: string }).claim_token,
      });
      expect(fixture.db.prepare("SELECT claim_token, lease_expires_at_ms FROM cognition_claims WHERE conversation_id = ?").get(fixture.cycle.conversationId)).toMatchObject({
        claim_token: (initialTokens.cognition as { claim_token: string }).claim_token,
      });
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM wakes WHERE wake_id = ?").get(fixture.attempt.wakeId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBeGreaterThan(Date.now());
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM inbox_events WHERE id = ?").get(fixture.attempt.eventId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBeGreaterThan(Date.now());
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM cognition_claims WHERE conversation_id = ?").get(fixture.cycle.conversationId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBeGreaterThan(Date.now());
      expect(controller.signal.aborted).toBe(false);

      finish("resolved receipt");
      await expect(supervised).resolves.toBe("resolved receipt");
    } finally {
      fixture.db.close();
    }
  });

  it("reports one six-hour renewal summary instead of persisting heartbeat rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = setup();
    try {
      let finish!: (value: string) => void;
      const execution = new Promise<string>((resolve) => { finish = resolve; });
      const summaries: unknown[] = [];
      const controller = new AbortController();
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 6 * 60 * 60_000 + 60_000,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute: () => execution,
        onSummary: (summary) => { summaries.push(summary); },
      });

      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
      finish("completed");
      await expect(supervised).resolves.toBe("completed");

      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        initialDeadlineAtMs: BASE + 6 * 60 * 60_000 + 60_000,
        renewalCount: 720,
        firstSuccessfulRenewalAtMs: BASE + 30_000,
        lastSuccessfulRenewalAtMs: BASE + 6 * 60 * 60_000,
        maxObservedGapMs: 30_000,
        fenceOrAbortReason: null,
      });
    } finally {
      fixture.db.close();
    }
  });

  it("releases the Thought claim while a six-hour worker fixture remains running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = setup();
    try {
      const proposal = {
        effectId: "effect-continuation-supervision",
        cycleId: fixture.cycle.cycleId,
        generation: fixture.cycle.generation,
        idempotencyKey: "idem-continuation-supervision",
        kind: "candidate.develop",
        purpose: "complete the bounded change",
        request: { projectId: "project-1", workspaceId: "workspace-1", audienceScope: { kind: "owner_private" } },
        authorityEpoch: 1,
      };
      putInFlight(fixture.db, {
        effectId: proposal.effectId,
        cycleId: proposal.cycleId,
        generation: proposal.generation,
        wakeId: fixture.ownership.wakeId,
        correlationId: proposal.effectId,
        idempotencyKey: proposal.idempotencyKey,
        payload: proposal.request,
        operationKind: proposal.kind,
        originEventId: fixture.ownership.eventId,
        originAttemptId: fixture.ownership.attemptId,
      });
      const accepted = acceptEffectContinuation(fixture.db, {
        proposal,
        conversationId: fixture.cycle.conversationId,
        deadlineAtMs: BASE + 6 * 60 * 60_000 + 60_000,
        remainingEffectRounds: 3,
        cognitionClaimToken: fixture.cognition.claimToken,
        runtimeId: "runtime-supervision-test",
        nowMs: BASE,
      });
      expect(fixture.db.prepare("SELECT 1 FROM cognition_claims WHERE conversation_id = ?")
        .get(fixture.cycle.conversationId)).toBeUndefined();

      const nextThought = claimConversationCognition(fixture.db, {
        conversationId: fixture.cycle.conversationId,
        eventId: "next-thought-event",
        wakeId: fixture.ownership.wakeId,
        cycleId: fixture.cycle.cycleId,
        generation: fixture.cycle.generation,
        nowMs: BASE,
      });
      expect(nextThought.ok).toBe(true);

      let finish!: (value: string) => void;
      const execution = new Promise<string>((resolve) => { finish = resolve; });
      const summaries: unknown[] = [];
      const controller = new AbortController();
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        continuationLease: { effectId: proposal.effectId, leaseToken: accepted.continuation.leaseToken },
        controller,
        deadlineAtMs: accepted.continuation.deadlineAtMs,
        nowMs: () => Date.now(),
        isCurrent: () => isEffectContinuationCurrent(fixture.db, {
          effectId: proposal.effectId,
          leaseToken: accepted.continuation.leaseToken,
          nowMs: Date.now(),
        }),
        isAuthorized: () => true,
        execute: () => execution,
        onSummary: (summary) => { summaries.push(summary); },
      });

      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
      expect(controller.signal.aborted).toBe(false);
      expect(fixture.db.prepare("SELECT claim_token FROM cognition_claims WHERE conversation_id = ?")
        .get(fixture.cycle.conversationId)).toMatchObject({ claim_token: nextThought.ok ? nextThought.claimToken : null });
      finish("completed");
      await expect(supervised).resolves.toBe("completed");
      expect(summaries).toMatchObject([{
        initialDeadlineAtMs: BASE + 6 * 60 * 60_000 + 60_000,
        renewalCount: 720,
        lastSuccessfulRenewalAtMs: BASE + 6 * 60 * 60_000,
      }]);
      expect(accepted.continuation.deadlineAtMs).toBe(BASE + 6 * 60 * 60_000 + 60_000);
    } finally {
      fixture.db.close();
    }
  });

  it.each(["wake", "inbox", "cognition"] as const)("rolls back the whole renewal set when the %s lease expires", async (lostMember) => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = setup();
    try {
      let finish!: (value: string) => void;
      const execution = new Promise<string>((resolve) => { finish = resolve; });
      const controller = new AbortController();
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 20 * 60_000,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute: () => execution,
      });
      const outcome = supervised.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      if (lostMember === "wake") {
        fixture.db.prepare("UPDATE wakes SET lease_expires_at_ms = ? WHERE wake_id = ?")
          .run(BASE + 30_000, fixture.ownership.wakeId);
      } else if (lostMember === "inbox") {
        fixture.db.prepare("UPDATE inbox_events SET lease_expires_at_ms = ? WHERE id = ?")
          .run(BASE + 30_000, fixture.ownership.eventId);
      } else {
        fixture.db.prepare("UPDATE cognition_claims SET lease_expires_at_ms = ? WHERE conversation_id = ?")
          .run(BASE + 30_000, fixture.ownership.conversationId);
      }
      const beforeHeartbeat = {
        wake: (fixture.db.prepare("SELECT lease_expires_at_ms FROM wakes WHERE wake_id = ?").get(fixture.ownership.wakeId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
        inbox: (fixture.db.prepare("SELECT lease_expires_at_ms FROM inbox_events WHERE id = ?").get(fixture.ownership.eventId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
        cognition: (fixture.db.prepare("SELECT lease_expires_at_ms FROM cognition_claims WHERE conversation_id = ?").get(fixture.ownership.conversationId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
      };

      await vi.advanceTimersByTimeAsync(30_000);
      await expect(outcome).resolves.toMatchObject({
        ok: false,
        error: { name: "EffectOwnershipLostError" },
      });
      expect(controller.signal.aborted).toBe(true);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM wakes WHERE wake_id = ?").get(fixture.ownership.wakeId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(beforeHeartbeat.wake);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM inbox_events WHERE id = ?").get(fixture.ownership.eventId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(beforeHeartbeat.inbox);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM cognition_claims WHERE conversation_id = ?").get(fixture.ownership.conversationId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(beforeHeartbeat.cognition);
      finish("late result");
    } finally {
      fixture.db.close();
    }
  });

  it("stops at the fixed deadline plus only the publication margin", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = setup();
    try {
      const controller = new AbortController();
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 60_000,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute: () => new Promise<string>(() => undefined),
      });
      let settled = false;
      void supervised.catch(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(controller.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(supervised).rejects.toMatchObject({ name: "EffectOwnershipLostError" });
    } finally {
      fixture.db.close();
    }
  });

  it.each(["currentness", "authority"] as const)("does not start execution when %s is lost at admission", async (lostGate) => {
    const fixture = setup();
    try {
      const controller = new AbortController();
      const execute = vi.fn(async () => "should not start");
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 60_000,
        nowMs: () => BASE,
        isCurrent: () => lostGate !== "currentness",
        isAuthorized: () => lostGate !== "authority",
        execute,
      });

      await expect(supervised).rejects.toMatchObject({ name: "EffectOwnershipLostError" });
      expect(controller.signal.aborted).toBe(true);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      fixture.db.close();
    }
  });

  it("keeps the six-hour absolute horizon through renewal and rejects work after it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = setup();
    try {
      const controller = new AbortController();
      const deadlineAtMs = BASE + LONG_OPERATION_HORIZON_MS;
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute: () => new Promise<string>(() => undefined),
      });
      let settled = false;
      void supervised.catch(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(61 * 60_000);
      expect(controller.signal.aborted).toBe(false);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(LONG_OPERATION_HORIZON_MS - 61 * 60_000);
      expect(controller.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(supervised).rejects.toMatchObject({ name: "EffectOwnershipLostError" });
    } finally {
      fixture.db.close();
    }
  });

  it("does not dispatch after cancellation and stops the heartbeat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = setup();
    try {
      const controller = new AbortController();
      const execute = vi.fn(async () => "late result");
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 60_000,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute,
      });
      const outcome = supervised.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const beforeAbort = {
        wake: (fixture.db.prepare("SELECT lease_expires_at_ms FROM wakes WHERE wake_id = ?").get(fixture.ownership.wakeId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
        inbox: (fixture.db.prepare("SELECT lease_expires_at_ms FROM inbox_events WHERE id = ?").get(fixture.ownership.eventId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
        cognition: (fixture.db.prepare("SELECT lease_expires_at_ms FROM cognition_claims WHERE conversation_id = ?").get(fixture.ownership.conversationId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
      };

      controller.abort("preempt");
      await expect(outcome).resolves.toMatchObject({ ok: false, error: { name: "EffectOwnershipLostError" } });
      expect(execute).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(30_000);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM wakes WHERE wake_id = ?").get(fixture.ownership.wakeId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(beforeAbort.wake);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM inbox_events WHERE id = ?").get(fixture.ownership.eventId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(beforeAbort.inbox);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM cognition_claims WHERE conversation_id = ?").get(fixture.ownership.conversationId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(beforeAbort.cognition);
    } finally {
      fixture.db.close();
    }
  });
});
