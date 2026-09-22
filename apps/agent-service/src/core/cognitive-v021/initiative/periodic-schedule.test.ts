import { describe, expect, it, vi } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { admitWake, getWake } from "../wake/ledger.js";
import { occurrenceIdFor } from "../wake/identity.js";
import { getCycle } from "../cycle/inbox.js";
import { insertDeferredFrontierRecord, getActiveDeferredFrontier } from "../frontier/ledger.js";
import {
  reservePrivateThought,
  bindPrivateReservationInvocation,
  commitPrivateDispatch,
  releasePrivateReservation,
  markPrivateReservationUnknown,
  getPrivateReservation,
  PRIVATE_THOUGHT_POLICY_ID,
} from "../private-budget/ledger.js";
import { reconcilePolicyClock } from "../private-budget/policy-time-ledger.js";
import {
  PERIODIC_SCHEDULE_ID,
  PERIODIC_CADENCE_MS,
  PERIODIC_DUE_WINDOW_MS,
  PERIODIC_CURIOSITY_MAX_ITEMS,
  periodicScheduleOccurrenceId,
  periodicTriggerRef,
  periodicEventId,
  readSchedule,
  createSchedule,
  readReceipt,
  listReceipts,
  mintPendingOccurrence,
  freezeBinding,
  clearPendingAndAdvance,
  evaluateAuthorityEpochTransition,
  evaluatePeriodicPoll,
} from "./periodic-schedule.js";
import type { IdleObservationDraft } from "./idle.js";
import { createObservationSubscription, MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS } from "../observation/subscriptions.js";

const BASE = 10_000_000;
const CADENCE = 14_400_000;
const POLICY = PRIVATE_THOUGHT_POLICY_ID;

function seedOccupancy(db: ReturnType<typeof openTestSidecar>, conversationId: string): void {
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, cognitive_status, snapshot_hash, updated_cycle)
     VALUES (?, ?, 'revisit periodic concern', '[]', '{}', NULL, 'active', 'snapshot-periodic', NULL)`,
  ).run(`concern-${conversationId}`, conversationId);
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES (?, ?, 'active', 20, 'cycle-periodic', 1)`,
  ).run(conversationId, `concern-${conversationId}`);
}

function baseInput(overrides: Partial<Parameters<typeof evaluatePeriodicPoll>[1]> = {}) {
  return {
    authorityEpoch: 1,
    nowMs: BASE,
    enabled: true,
    policyId: POLICY,
    ...overrides,
  };
}

describe("P1 periodic schedule ledger (R7 §§5–14)", () => {
  it("pins the frozen periodic constants", () => {
    expect(PERIODIC_SCHEDULE_ID).toBe("ashley-periodic-v1");
    expect(PERIODIC_CADENCE_MS).toBe(14_400_000);
    expect(PERIODIC_DUE_WINDOW_MS).toBe(14_400_000);
    expect(PERIODIC_CURIOSITY_MAX_ITEMS).toBe(12);
  });

  it("P1_PACKET_INCLUDES_S1_AND_S1B", () => {
    const db = openTestSidecar();
    try {
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'periodic_%' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
      expect(tables).toEqual(["periodic_cognition_occurrence_receipts", "periodic_cognition_schedule"]);
      expect(readSchedule(db)).toBeNull();
      expect(listReceipts(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("singleton schedule enforcement", () => {
    const db = openTestSidecar();
    try {
      const first = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const second = createSchedule(db, { authorityEpoch: 2, nowMs: BASE + 1 });
      expect(second.nextEligibleAtMs).toBe(first.nextEligibleAtMs);
      expect(second.authorityEpoch).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM periodic_cognition_schedule").get() as { count: number }).count).toBe(1);
      expect(() => db.prepare("INSERT INTO periodic_cognition_schedule (id, authority_epoch, next_eligible_at_ms, updated_at_ms) VALUES ('other', 1, 1, 1)").run()).toThrow();
    } finally {
      db.close();
    }
  });

  it("EPOCH_IDENTITY_DIFFERS_WITH_SAME_ELIGIBLE_TIME", () => {
    const a = periodicScheduleOccurrenceId({ authorityEpoch: 1, effectiveEligibleAtMs: BASE });
    const b = periodicScheduleOccurrenceId({ authorityEpoch: 2, effectiveEligibleAtMs: BASE });
    expect(a).not.toBe(b);
    expect(a).toBe(periodicScheduleOccurrenceId({ authorityEpoch: 1, effectiveEligibleAtMs: BASE }));
    expect(periodicTriggerRef(a, BASE)).toBe(`periodic:${a}:${BASE}`);
    expect(periodicEventId(a)).toBe(`periodic:${a}`);
  });

  it("FIRST_OWNER_AUTHORIZED_ACTIVATION_CREATES_SCHEDULE_ONLY", async () => {
    const db = openTestSidecar();
    try {
      const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: BASE }));
      expect(decision.kind).toBe("schedule_created");
      const schedule = readSchedule(db)!;
      expect(schedule.nextEligibleAtMs).toBe(BASE + CADENCE);
      expect(schedule.pendingOccurrenceId).toBeNull();
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count: number }).count).toBe(0);
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("no_schedule_disabled creates nothing while disabled", async () => {
    const db = openTestSidecar();
    try {
      expect((await evaluatePeriodicPoll(db, baseInput({ enabled: false }))).kind).toBe("no_schedule_disabled");
      expect(readSchedule(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("not_due performs zero curiosity network", async () => {
    const db = openTestSidecar();
    try {
      createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: BASE + 1, acquireObservations: acquire }));
      expect(decision.kind).toBe("not_due");
      expect(acquire).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("T1 mint: LATE_BUT_STILL_IN_WINDOW keeps the eligible time", () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const minted = mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs + 3_600_000 });
      expect(minted.reused).toBe(false);
      expect(minted.effectiveEligibleAtMs).toBe(schedule.nextEligibleAtMs);
      expect(minted.expiresAtMs).toBe(schedule.nextEligibleAtMs + PERIODIC_DUE_WINDOW_MS);
    } finally {
      db.close();
    }
  });

  it("T1 mint: 20H_DOWNTIME_COALESCES_CURRENT with no debt", () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const nowMs = schedule.nextEligibleAtMs + 20 * 3_600_000;
      const minted = mintPendingOccurrence(db, { nowMs });
      expect(minted.effectiveEligibleAtMs).toBe(nowMs);
      expect(listReceipts(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("T1 mint: LARGE_FORWARD_JUMP_COALESCES_CURRENT", () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const nowMs = schedule.nextEligibleAtMs + 10 * PERIODIC_DUE_WINDOW_MS;
      const minted = mintPendingOccurrence(db, { nowMs });
      expect(minted.effectiveEligibleAtMs).toBe(nowMs);
      expect(listReceipts(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("persists a claimed external-watch observation before advancing its frontier", async () => {
    const db = openTestSidecar();
    try {
      createObservationSubscription(db, {
        subscriptionId: "periodic-watch-claim",
        conversationId: "thread-periodic-watch",
        concernId: null,
        source: "external_watch",
        scope: "owner-thread",
        topicKeys: ["HY3"],
        match: "substring",
        expiresAtMs: BASE + CADENCE + 100_000,
        externalSource: { kind: "url", urlPattern: "https://public.test/periodic" },
        pollIntervalMs: MIN_EXTERNAL_WATCH_POLL_INTERVAL_MS,
      });
      createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: BASE + CADENCE,
        scopeConversationId: "thread-periodic-watch",
        externalWatchPoll: {
          fetcher: async () => new Response("<html><body>HY3 changed</body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
          resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        },
      }));
      expect(decision.kind).toBe("admit_runnable");
      expect(db.prepare("SELECT poll_claim_token, poll_generation, ingested_frontier_at_ms FROM observation_subscriptions WHERE subscription_id = ?").get("periodic-watch-claim"))
        .toMatchObject({ poll_claim_token: null, poll_generation: 1, ingested_frontier_at_ms: BASE + CADENCE });
    } finally {
      db.close();
    }
  });

  it("missedWindowsDoNotMultiply", () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const nowMs = schedule.nextEligibleAtMs + 10 * PERIODIC_DUE_WINDOW_MS;
      const first = mintPendingOccurrence(db, { nowMs });
      const duplicate = mintPendingOccurrence(db, { nowMs: nowMs + PERIODIC_DUE_WINDOW_MS });

      expect(first.effectiveEligibleAtMs).toBe(nowMs);
      expect(duplicate.reused).toBe(true);
      expect(duplicate.occurrenceId).toBe(first.occurrenceId);
      expect(listReceipts(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("T1 mint: COALESCED_RESTART_IDEMPOTENT and duplicate-poll reuse", () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      expect(() => mintPendingOccurrence(db, { nowMs: BASE })).toThrow("periodic_not_due");
      const first = mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      const second = mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs + 999 });
      expect(second.reused).toBe(true);
      expect(second.occurrenceId).toBe(first.occurrenceId);
    } finally {
      db.close();
    }
  });

  it("T6 skipped_empty: due + empty acquisition advances with a receipt", async () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const due = schedule.nextEligibleAtMs;
      const acquire = vi.fn(async () => []);
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: due,
        scopeConversationId: "thread-empty",
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("skipped_empty");
      const receipt = (decision as { receipt: ReturnType<typeof readReceipt> }).receipt!;
      expect(receipt.disposition).toBe("skipped_empty");
      expect(receipt.wakeId).toBeNull();
      expect(receipt.authorityEpoch).toBe(1);
      expect(receipt.eligibleAtMs).toBe(due);
      expect(receipt.closedAtMs).toBe(due);
      const after = readSchedule(db)!;
      expect(after.pendingOccurrenceId).toBeNull();
      expect(after.nextEligibleAtMs).toBe(due + CADENCE);
      // History is reconstructable after the schedule advances.
      expect(listReceipts(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("T6 skipped_empty with zero candidates performs zero network", async () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs, acquireObservations: acquire }));
      expect(decision.kind).toBe("skipped_empty");
      expect(acquire).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("FRESH_SIDECAR_PERIODIC_FIRST_RESERVE: due + fruitful acquisition admits", async () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => [{ observationId: "obs:1", derived: false, replaySafe: true, modality: "text", payload: {}, provenance: "test", dataClassification: "never_public", secretOmitted: true }] as IdleObservationDraft[]);
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-fresh",
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("admit_runnable");
      expect(acquire).toHaveBeenCalledTimes(1);
      const runnable = (decision as { runnable: { occurrenceId: string; wakeId: string; conversationId: string; reservationId: string; triggerRef: string; observations: IdleObservationDraft[] } }).runnable;
      expect(runnable.conversationId).toBe("thread-fresh");
      expect(runnable.observations).toHaveLength(1);
      expect(db.prepare(
        "SELECT observation_id, cycle_id, generation FROM observations",
      ).all()).toEqual([{
        observation_id: "obs:1",
        cycle_id: getWake(db, runnable.wakeId)?.cycleId,
        generation: 1,
      }]);
      // Same-transaction freeze: admitted wake ⟹ binding frozen.
      const after = readSchedule(db)!;
      expect(after.pendingWakeId).toBe(runnable.wakeId);
      const wake = getWake(db, runnable.wakeId)!;
      expect(wake.triggerRef).toBe(runnable.triggerRef);
      expect(getPrivateReservation(db, runnable.reservationId)).toMatchObject({ state: "held" });
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE trigger_ref = ?").get(runnable.triggerRef) as { count: number }).count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("candidate selection prefers occupied conversations (selectable-until-bound)", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-occupied");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-scope-empty",
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("admit_runnable");
      const runnable = (decision as { runnable: { conversationId: string } }).runnable;
      expect(runnable.conversationId).toBe("thread-occupied");
    } finally {
      db.close();
    }
  });

  it("acquisition error degrades to best-effort empty (never forces admission)", async () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => { throw new Error("provider_down"); });
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-empty",
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("skipped_empty");
    } finally {
      db.close();
    }
  });

  it("T7 unbound expiry advances; BOUND_WINDOW_EXPIRY_NO_ORPHAN", async () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      const pending = readSchedule(db)!;
      const expiredAt = (pending.pendingExpiresAtMs ?? 0) + 1;
      const acquire = vi.fn(async () => []);
      const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: expiredAt, scopeConversationId: "thread-x", acquireObservations: acquire }));
      expect(decision.kind).toBe("expired");
      const receipt = (decision as { receipt: NonNullable<ReturnType<typeof readReceipt>> }).receipt;
      expect(receipt.disposition).toBe("expired");
      expect(acquire).not.toHaveBeenCalled();
      expect(readSchedule(db)!.pendingOccurrenceId).toBeNull();
    } finally {
      db.close();
    }
  });

  it("BOUND_WINDOW_EXPIRY_NO_ORPHAN: bound occurrences never expire through T7", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-bound");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-bound",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const after = readSchedule(db)!;
      const expiredAt = (after.pendingExpiresAtMs ?? 0) + 1_000;
      const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: expiredAt, acquireObservations: acquire }));
      expect(decision.kind).not.toBe("expired");
      expect(listReceipts(db).filter((receipt) => receipt.disposition === "expired")).toEqual([]);
      expect(readSchedule(db)!.pendingWakeId).toBe(after.pendingWakeId);
    } finally {
      db.close();
    }
  });

  it("NULL_BINDING_EXISTING_WAKE_STILL_ADOPTS (S2 pre-commit twin, no B wake)", async () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const minted = mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      const triggerRef = periodicTriggerRef(minted.occurrenceId, minted.dueAtMs);
      // Crash between wake admission and binding freeze: the wake exists (with
      // the exact T2a occurrence identity) but the schedule is still unbound.
      const orphan = admitWake(db, {
        occurrenceId: occurrenceIdFor({ sourceKind: "idle", triggerRef, conversationId: "thread-s2" }),
        triggerRef,
        sourceKind: "idle",
        conversationId: "thread-s2",
        capturedAuthorityRevision: 0,
        nowMs: BASE,
      });
      expect(orphan.kind).toBe("created");
      seedOccupancy(db, "thread-s2");
      const acquire = vi.fn(async () => []);
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-s2",
        acquireObservations: acquire,
      }));
      // Adopted (bound or runnable on the same wake) — never a second wake.
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE trigger_ref = ?").get(triggerRef) as { count: number }).count).toBe(1);
      expect(readSchedule(db)!.pendingWakeId).toBe(orphan.wake.wakeId);
      expect(["bound_runnable", "pending_retained"]).toContain(decision.kind);
      expect(acquire).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("post-commit-crash twin adopts the same lineage (no second wake/unit)", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-twin");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const first = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-twin",
        acquireObservations: acquire,
      }));
      expect(first.kind).toBe("admit_runnable");
      const wakeId = (first as { runnable: { wakeId: string } }).runnable.wakeId;
      const reservationsBefore = (db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count;
      // Crash after freeze+reserve, before Thought: re-poll adopts.
      const second = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs + 1_000,
        scopeConversationId: "thread-twin",
        acquireObservations: acquire,
      }));
      expect(second.kind).toBe("pending_retained");
      expect((second as { reason: string }).reason).toBe("periodic_observation_binding_conflict");
      expect(readSchedule(db)?.pendingWakeId).toBe(wakeId);
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count).toBe(reservationsBefore);
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("reconstructs the exact non-empty observation binding after a pre-event crash", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-observation-crash");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquired = {
        observationId: "obs:crash-original",
        derived: false,
        replaySafe: true,
        modality: "text" as const,
        payload: { content: "original durable observation" },
        provenance: "test:crash",
        dataClassification: "ordinary" as const,
        secretOmitted: false,
      };
      const acquire = vi.fn(async () => [acquired] as IdleObservationDraft[]);
      const first = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-observation-crash",
        acquireObservations: acquire,
      }));
      expect(first.kind).toBe("admit_runnable");
      expect((first as { runnable: { observations: IdleObservationDraft[] } }).runnable.observations).toEqual([acquired]);
      expect(db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id LIKE 'periodic:%'").get()).toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM observations WHERE observation_id = 'obs:crash-original'").get()).toEqual({ count: 1 });

      // Simulate process stop before idle.ts appends the periodic event.
      const recovered = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs + 1_000,
        scopeConversationId: "different-thread-after-restart",
        acquireObservations: acquire,
      }));
      expect(recovered.kind).toBe("bound_runnable");
      expect((recovered as { runnable: { observations: IdleObservationDraft[] } }).runnable.observations).toEqual([acquired]);
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("retains a pre-event crash as UNKNOWN when multiple observation order is unproven", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-observation-order-crash");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquired = [
        {
          observationId: "obs:order-z",
          derived: false,
          replaySafe: true,
          modality: "text" as const,
          payload: { content: "first" },
          provenance: "test:order",
          dataClassification: "ordinary" as const,
          secretOmitted: false,
        },
        {
          observationId: "obs:order-a",
          derived: false,
          replaySafe: true,
          modality: "text" as const,
          payload: { content: "second" },
          provenance: "test:order",
          dataClassification: "ordinary" as const,
          secretOmitted: false,
        },
      ];
      const acquire = vi.fn(async () => acquired as IdleObservationDraft[]);
      const first = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-observation-order-crash",
        acquireObservations: acquire,
      }));
      expect(first.kind).toBe("admit_runnable");

      const recovered = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs + 1_000,
        scopeConversationId: "thread-observation-order-crash",
        acquireObservations: acquire,
      }));
      expect(recovered.kind).toBe("pending_retained");
      expect((recovered as { reason: string }).reason).toBe("periodic_observation_binding_conflict");
      expect(acquire).toHaveBeenCalledTimes(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id LIKE 'periodic:%'").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("fails closed instead of fabricating an empty binding after a pre-event empty crash", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-empty-crash");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const first = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-empty-crash",
        acquireObservations: async () => [],
      }));
      expect(first.kind).toBe("admit_runnable");

      const recovered = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs + 1_000,
        scopeConversationId: "thread-empty-crash",
      }));
      expect(recovered.kind).toBe("pending_retained");
      expect((recovered as { reason: string }).reason).toBe("periodic_observation_binding_conflict");
      expect(db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id LIKE 'periodic:%'").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("BOUND_WAKE_ID_MISSING_FAILS_CLOSED and BOUND_WAKE_MISSING_NEVER_T2A", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-missing");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      db.prepare("UPDATE periodic_cognition_schedule SET pending_wake_id = ? WHERE id = ?").run("wake:missing", PERIODIC_SCHEDULE_ID);
      const wakesBefore = (db.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count: number }).count;
      const acquire = vi.fn(async () => []);
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-missing",
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("pending_retained");
      expect((decision as { reason: string }).reason).toBe("bound_wake_missing");
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count: number }).count).toBe(wakesBefore);
      expect(listReceipts(db)).toEqual([]);
      expect(acquire).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("BOUND_WAKE_CONVERSATION_MISMATCH_FAILS_CLOSED", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-mismatch");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-mismatch",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const wakeId = (admitted as { runnable: { wakeId: string } }).runnable.wakeId;
      const wake = getWake(db, wakeId)!;
      db.prepare("UPDATE cycle_records SET conversation_id = ? WHERE cycle_id = ?").run("thread-diverged", wake.cycleId);
      const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs + 1, acquireObservations: acquire }));
      expect(decision.kind).toBe("pending_retained");
      expect((decision as { reason: string }).reason).toBe("bound_wake_conversation_mismatch");
      expect(listReceipts(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("pending_wake_id adoption ignores thread change", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-home");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-home",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      // Owner switched threads: the bound occurrence still evaluates on its
      // frozen conversation.
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs + 1_000,
        scopeConversationId: "thread-elsewhere",
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("pending_retained");
      expect((decision as { reason: string }).reason).toBe("periodic_observation_binding_conflict");
    } finally {
      db.close();
    }
  });

  it("T4 terminal_observed closes admitted/admitted_failure (unblockable)", async () => {
    for (const [terminalReason, disposition] of [["completed", "admitted"], ["refused", "admitted_failure"]] as const) {
      const db = openTestSidecar();
      try {
        seedOccupancy(db, "thread-t4");
        const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
        const acquire = vi.fn(async () => []);
        const admitted = await evaluatePeriodicPoll(db, baseInput({
          nowMs: schedule.nextEligibleAtMs,
          scopeConversationId: "thread-t4",
          acquireObservations: acquire,
        }));
        expect(admitted.kind).toBe("admit_runnable");
        const wakeId = (admitted as { runnable: { wakeId: string } }).runnable.wakeId;
        db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = ? WHERE wake_id = ?").run(terminalReason, wakeId);
        const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs + 5_000, acquireObservations: acquire }));
        expect(decision.kind).toBe("terminal_observed");
        const receipt = (decision as { receipt: NonNullable<ReturnType<typeof readReceipt>> }).receipt;
        expect(receipt.disposition).toBe(disposition);
        expect(receipt.wakeId).toBe(wakeId);
        // Disposition-relative advancement + receipt/write-once history.
        expect(readSchedule(db)!.nextEligibleAtMs).toBe(schedule.nextEligibleAtMs + 5_000 + CADENCE);
        expect(listReceipts(db)).toHaveLength(1);
        expect((db.prepare("SELECT COUNT(*) AS count FROM settlements").get() as { count: number }).count).toBe(0);
      } finally {
        db.close();
      }
    }
  });

  it("BOUND_TERMINAL_CLOSES_WHILE_GLOBAL_BUDGET_EXHAUSTED", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-exhausted");
      reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: "owner:exhaust" });
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-exhausted",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const wakeId = (admitted as { runnable: { wakeId: string } }).runnable.wakeId;
      // Exhaust the global 4/hour budget on unrelated wakes (the periodic
      // occurrence already holds one of the four units). Wall clock matches
      // the periodic reserve so the policy clock stays stable.
      for (let index = 0; index < 3; index += 1) {
        const other = admitWake(db, {
          occurrenceId: `occurrence:exhaust:${index}`,
          triggerRef: `trigger:exhaust:${index}`,
          sourceKind: "idle",
          conversationId: `thread-exhaust:${index}`,
          capturedAuthorityRevision: 0,
          nowMs: BASE,
        });
        const reserved = reservePrivateThought(db, {
          admissionId: `adm:exhaust:${index}`,
          wakeId: other.wake.wakeId,
          conversationId: `thread-exhaust:${index}`,
          policyId: POLICY,
          wallClockNowMs: schedule.nextEligibleAtMs,
        });
        expect(reserved.kind).toBe("reserved");
      }
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?").run(wakeId);
      const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs + 5_000, acquireObservations: acquire }));
      expect(decision.kind).toBe("terminal_observed");
    } finally {
      db.close();
    }
  });

  it("BOUND_TERMINAL_CLOSES_WITH_NEWER_ACTIVE_FRONTIER", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-frontier");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-frontier",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const runnable = (admitted as { runnable: { wakeId: string } }).runnable;
      insertDeferredFrontierRecord(db, {
        conversationId: "thread-frontier",
        cycleId: "cycle:frontier:newer",
        generation: 2,
        nextEligibleAtMs: BASE + 60_000,
        latestEvidenceRowId: "evidence:frontier:newer",
        nowMs: BASE,
      });
      expect(getActiveDeferredFrontier(db, "thread-frontier")).not.toBeNull();
      const wake = getWake(db, runnable.wakeId)!;
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?").run(wake.wakeId);
      const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs + 5_000, acquireObservations: acquire }));
      expect(decision.kind).toBe("terminal_observed");
      void wake;
    } finally {
      db.close();
    }
  });

  it("T11 stale_closed on durable no-dispatch proof (enabled and disabled)", async () => {
    for (const enabled of [true, false]) {
      const db = openTestSidecar();
      try {
        seedOccupancy(db, "thread-t11");
        const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
        const acquire = vi.fn(async () => []);
        const admitted = await evaluatePeriodicPoll(db, baseInput({
          nowMs: schedule.nextEligibleAtMs,
          scopeConversationId: "thread-t11",
          acquireObservations: acquire,
        }));
        expect(admitted.kind).toBe("admit_runnable");
        const runnable = (admitted as { runnable: { wakeId: string; reservationId: string } }).runnable;
        releasePrivateReservation(db, {
          reservationId: runnable.reservationId,
          proofRef: "proof:t11:no-dispatch",
          dispatchTruth: "not_started",
          nowMs: BASE,
        });
        const decision = await evaluatePeriodicPoll(db, baseInput({
          nowMs: schedule.nextEligibleAtMs + 5_000,
          enabled,
          acquireObservations: acquire,
        }));
        expect(decision.kind).toBe("stale_closed");
        const receipt = (decision as { receipt: NonNullable<ReturnType<typeof readReceipt>> }).receipt;
        expect(receipt.disposition).toBe("admitted_stale_suppressed");
        expect(receipt.wakeId).toBe(runnable.wakeId);
      } finally {
        db.close();
      }
    }
  });

  it("BOUND_HELD_RESERVATION_DOES_NOT_SELF_REFUSE and BOUND_RECOVERY_ZERO_NETWORK", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-held");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-held",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      acquire.mockClear();
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs + 1_000,
        scopeConversationId: "thread-held",
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("pending_retained");
      expect((decision as { reason: string }).reason).toBe("periodic_observation_binding_conflict");
      expect(acquire).not.toHaveBeenCalled();
      expect(listReceipts(db).filter((receipt) => receipt.disposition === "skipped_empty")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("BOUND_COMMITTED_RECOVERY_NEVER_REENTERS_BUDGET_ADMISSION", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-committed");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-committed",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const runnable = (admitted as { runnable: { reservationId: string } }).runnable;
      bindPrivateReservationInvocation(db, {
        reservationId: runnable.reservationId,
        invocationId: "inv:committed:1",
        attemptId: "att:committed:1",
        nowMs: BASE,
      });
      commitPrivateDispatch(db, {
        reservationId: runnable.reservationId,
        invocationId: "inv:committed:1",
        attemptId: "att:committed:1",
        nowMs: BASE,
      });
      const reservationsBefore = (db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count;
      const bindingsBefore = (db.prepare("SELECT COUNT(*) AS count FROM private_budget_attempt_bindings").get() as { count: number }).count;
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs + 1_000,
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("pending_retained");
      expect((decision as { reason: string }).reason).toBe("committed_recovery");
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_reservations").get() as { count: number }).count).toBe(reservationsBefore);
      expect((db.prepare("SELECT COUNT(*) AS count FROM private_budget_attempt_bindings").get() as { count: number }).count).toBe(bindingsBefore);
      expect(acquire).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it("KILL_SWITCH_UNBOUND_PENDING_NO_ADMISSION and no T7 while disabled", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-retained");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const minted = mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      const acquire = vi.fn(async () => [{ observationId: "obs:1", derived: false, replaySafe: true, modality: "text", payload: {}, provenance: "test", dataClassification: "never_public", secretOmitted: true }] as IdleObservationDraft[]);
      // Far past expiry, but disabled: kept durable, no admission, no expiry.
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: minted.expiresAtMs + 1_000_000,
        enabled: false,
        scopeConversationId: "thread-retained",
        acquireObservations: acquire,
      }));
      expect(decision.kind).toBe("disabled_retained");
      expect(acquire).not.toHaveBeenCalled();
      expect(readSchedule(db)!.pendingOccurrenceId).toBe(minted.occurrenceId);
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes WHERE trigger_ref LIKE 'periodic:%'").get() as { count: number }).count).toBe(0);
      expect(listReceipts(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("OCCURRENCE_HISTORY_SURVIVES_MULTIPLE_LATER_PERIODS", async () => {
    const db = openTestSidecar();
    try {
      let schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      for (let period = 0; period < 3; period += 1) {
        const decision = await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs, acquireObservations: acquire }));
        expect(decision.kind).toBe("skipped_empty");
        schedule = readSchedule(db)!;
      }
      const receipts = listReceipts(db);
      expect(receipts).toHaveLength(3);
      expect(new Set(receipts.map((receipt) => receipt.scheduleOccurrenceId)).size).toBe(3);
      expect(receipts.every((receipt) => receipt.disposition === "skipped_empty")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("CURIOSITY_RETRY_COST_BOUND_TRUTHFUL: at most one acquisition per unbound poll, zero on bound", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-cost");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-cost",
        acquireObservations: acquire,
      }));
      expect(acquire).toHaveBeenCalledTimes(1);
      acquire.mockClear();
      await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs + 1, acquireObservations: acquire }));
      expect(acquire).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("NO_CLOCK_WITH_EXISTING_ROWS_PERIODIC_FAILS_CLOSED", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-noclock");
      reconcilePolicyClock(db, { policyId: POLICY, wallClockNowMs: BASE, authorizationRef: "owner:noclock" });
      const other = admitWake(db, {
        occurrenceId: "occurrence:noclock:other",
        triggerRef: "trigger:noclock:other",
        sourceKind: "idle",
        conversationId: "thread-noclock",
        capturedAuthorityRevision: 0,
        nowMs: BASE,
      });
      const reserved = reservePrivateThought(db, {
        admissionId: "adm:noclock",
        wakeId: other.wake.wakeId,
        conversationId: "thread-noclock",
        policyId: POLICY,
        wallClockNowMs: BASE,
      });
      expect(reserved.kind).toBe("reserved");
      db.exec("DELETE FROM private_budget_policy_clock");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => [{ observationId: "obs:1", derived: false, replaySafe: true, modality: "text", payload: {}, provenance: "test", dataClassification: "never_public", secretOmitted: true }] as IdleObservationDraft[]);
      const decision = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-noclock",
        acquireObservations: acquire,
      }));
      // Rows without a clock are an anomaly: retain, never admit.
      expect(decision.kind).toBe("pending_retained");
      expect((decision as { reason: string }).reason).toBe("clock_reconciliation");
      expect(readSchedule(db)!.pendingWakeId).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("P1 authority-epoch transitions T10 (C1–C5)", () => {
  it("C1 current epoch proceeds; C5 adopts with no receipt", async () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      expect(evaluateAuthorityEpochTransition(db, { schedule, currentEpoch: 1, nowMs: BASE }).kind).toBe("current");
      const adopted = evaluateAuthorityEpochTransition(db, { schedule, currentEpoch: 2, nowMs: BASE });
      expect(adopted.kind).toBe("adopted");
      expect(adopted.schedule.authorityEpoch).toBe(2);
      expect(adopted.schedule.nextEligibleAtMs).toBe(schedule.nextEligibleAtMs);
      expect(listReceipts(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("C4 unbound abandonment writes authority_epoch_abandoned and stays reconstructable", async () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const minted = mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      const transition = evaluateAuthorityEpochTransition(db, { schedule: readSchedule(db)!, currentEpoch: 2, nowMs: BASE + 1 });
      expect(transition.kind).toBe("unbound_abandoned");
      const receipt = (transition as { receipt: NonNullable<ReturnType<typeof readReceipt>> }).receipt;
      expect(receipt.disposition).toBe("authority_epoch_abandoned");
      expect(receipt.scheduleOccurrenceId).toBe(minted.occurrenceId);
      expect(receipt.wakeId).toBeNull();
      expect(receipt.authorityEpoch).toBe(1);
      expect(receipt.eligibleAtMs).toBe(minted.dueAtMs);
      expect(transition.schedule.authorityEpoch).toBe(2);
      expect(transition.schedule.pendingOccurrenceId).toBeNull();
    } finally {
      db.close();
    }
  });

  it("C2 committed terminal closes under the old epoch, then adopts", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-c2");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-c2",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const runnable = (admitted as { runnable: { wakeId: string; reservationId: string } }).runnable;
      bindPrivateReservationInvocation(db, {
        reservationId: runnable.reservationId,
        invocationId: "inv:c2",
        attemptId: "att:c2",
        nowMs: BASE,
      });
      commitPrivateDispatch(db, {
        reservationId: runnable.reservationId,
        invocationId: "inv:c2",
        attemptId: "att:c2",
        nowMs: BASE,
      });
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?").run(runnable.wakeId);
      const transition = evaluateAuthorityEpochTransition(db, { schedule: readSchedule(db)!, currentEpoch: 2, nowMs: BASE + 1 });
      expect(transition.kind).toBe("committed_terminal_closed");
      const receipt = (transition as { receipt: NonNullable<ReturnType<typeof readReceipt>> }).receipt;
      expect(receipt.disposition).toBe("admitted");
      expect(receipt.authorityEpoch).toBe(1);
      expect(transition.schedule.authorityEpoch).toBe(2);
    } finally {
      db.close();
    }
  });

  it("C3a committed non-terminal retains binding, defers epoch, replaces nothing", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-c3a");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-c3a",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const runnable = (admitted as { runnable: { wakeId: string; reservationId: string; occurrenceId: string } }).runnable;
      bindPrivateReservationInvocation(db, {
        reservationId: runnable.reservationId,
        invocationId: "inv:c3a",
        attemptId: "att:c3a",
        nowMs: BASE,
      });
      commitPrivateDispatch(db, {
        reservationId: runnable.reservationId,
        invocationId: "inv:c3a",
        attemptId: "att:c3a",
        nowMs: BASE,
      });
      const wakesBefore = (db.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count: number }).count;
      const transition = evaluateAuthorityEpochTransition(db, { schedule: readSchedule(db)!, currentEpoch: 2, nowMs: BASE + 1 });
      expect(transition.kind).toBe("bound_retained");
      expect((transition as { epochCase: string }).epochCase).toBe("c3a");
      expect(transition.schedule.authorityEpoch).toBe(1);
      expect(transition.schedule.pendingWakeId).toBe(runnable.wakeId);
      expect((db.prepare("SELECT COUNT(*) AS count FROM wakes").get() as { count: number }).count).toBe(wakesBefore);
      expect(listReceipts(db)).toEqual([]);
      // Full poll under mismatch also blocks T1/T2a.
      const poll = await evaluatePeriodicPoll(db, baseInput({ authorityEpoch: 2, nowMs: BASE + 2, acquireObservations: acquire }));
      expect(poll.kind).toBe("epoch_blocked");
    } finally {
      db.close();
    }
  });

  it("C3b bound pre-dispatch retains; EPOCH_BOUND_UNKNOWN_NO_SECOND_DISPATCH", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-c3b");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-c3b",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const runnable = (admitted as { runnable: { reservationId: string } }).runnable;
      markPrivateReservationUnknown(db, runnable.reservationId, { nowMs: BASE });
      const transition = evaluateAuthorityEpochTransition(db, { schedule: readSchedule(db)!, currentEpoch: 2, nowMs: BASE + 1 });
      expect(transition.kind).toBe("bound_retained");
      expect((transition as { epochCase: string }).epochCase).toBe("c3b");
      expect(transition.schedule.authorityEpoch).toBe(1);
      expect(listReceipts(db)).toEqual([]);
      expect((db.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE id LIKE 'periodic:%'").get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("C3b safe close on durable no-dispatch proof (EPOCH_BOUND_NO_DISPATCH_SAFE_CLOSE)", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-c3b-close");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-c3b-close",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const runnable = (admitted as { runnable: { reservationId: string } }).runnable;
      releasePrivateReservation(db, {
        reservationId: runnable.reservationId,
        proofRef: "proof:c3b-close",
        dispatchTruth: "not_started",
        nowMs: BASE,
      });
      const transition = evaluateAuthorityEpochTransition(db, { schedule: readSchedule(db)!, currentEpoch: 2, nowMs: BASE + 1 });
      expect(transition.kind).toBe("bound_safe_closed");
      const receipt = (transition as { receipt: NonNullable<ReturnType<typeof readReceipt>> }).receipt;
      expect(receipt.disposition).toBe("admitted_stale_suppressed");
      expect(transition.schedule.authorityEpoch).toBe(2);
    } finally {
      db.close();
    }
  });

  it("T10_C4_RECEIPT_IS_AUTHORITY_EPOCH_ABANDONED vs T11_RECEIPT_REMAINS_ADMITTED_STALE_SUPPRESSED", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-c4t11");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      const c4 = evaluateAuthorityEpochTransition(db, { schedule: readSchedule(db)!, currentEpoch: 2, nowMs: BASE + 1 });
      expect(c4.kind).toBe("unbound_abandoned");
      // New epoch mints and binds a fresh occurrence; its no-dispatch proof
      // closes it as stale-suppressed (T11), never as epoch-abandoned.
      const acquire = vi.fn(async () => []);
      const due = readSchedule(db)!.nextEligibleAtMs;
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        authorityEpoch: 2,
        nowMs: due,
        scopeConversationId: "thread-c4t11",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const runnable = (admitted as { runnable: { reservationId: string } }).runnable;
      releasePrivateReservation(db, {
        reservationId: runnable.reservationId,
        proofRef: "proof:c4t11",
        dispatchTruth: "not_started",
        nowMs: BASE,
      });
      const closed = await evaluatePeriodicPoll(db, baseInput({ authorityEpoch: 2, nowMs: due + 1, acquireObservations: acquire }));
      expect(closed.kind).toBe("stale_closed");
      const dispositions = listReceipts(db).map((receipt) => receipt.disposition).sort();
      expect(dispositions).toEqual(["admitted_stale_suppressed", "authority_epoch_abandoned"]);
    } finally {
      db.close();
    }
  });
});

describe("P1 same-transaction freeze + terminal advancement", () => {
  it("freezeBinding admits and freezes atomically (no admitted-but-unbound state)", () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const minted = mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      const triggerRef = periodicTriggerRef(minted.occurrenceId, minted.dueAtMs);
      const frozen = freezeBinding(db, {
        occurrenceId: minted.occurrenceId,
        triggerRef,
        conversationId: "thread-freeze",
        nowMs: BASE,
      });
      expect(frozen.kind).toBe("bound");
      if (frozen.kind !== "bound") throw new Error("freeze_failed");
      expect(frozen.alreadyBound).toBe(false);
      // Re-freeze resolves to the same wake (post-commit twin).
      const again = freezeBinding(db, {
        occurrenceId: minted.occurrenceId,
        triggerRef,
        conversationId: "thread-freeze",
        nowMs: BASE,
      });
      expect(again.kind).toBe("bound");
      if (again.kind !== "bound") throw new Error("refreeze_failed");
      expect(again.wake.wakeId).toBe(frozen.wake.wakeId);
      expect(again.alreadyBound).toBe(true);
      expect(readSchedule(db)!.pendingWakeId).toBe(frozen.wake.wakeId);
      // The admitted wake owns the occurrence's cycle lineage.
      expect(getCycle(db, frozen.wake.cycleId)?.wakeId).toBe(frozen.wake.wakeId);
    } finally {
      db.close();
    }
  });

  it("clearPendingAndAdvance is receipt-idempotent and disposition-relative", () => {
    const db = openTestSidecar();
    try {
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const minted = mintPendingOccurrence(db, { nowMs: schedule.nextEligibleAtMs });
      const first = clearPendingAndAdvance(db, {
        occurrenceId: minted.occurrenceId,
        disposition: "skipped_empty",
        wakeId: null,
        eventMs: BASE,
        nowMs: BASE + 10,
        detail: "empty",
      });
      // eventMs < prevNext: advancement is relative to prevNext.
      expect(readSchedule(db)!.nextEligibleAtMs).toBe(schedule.nextEligibleAtMs + CADENCE);
      // PK replay: same receipt, no double advance.
      const replay = clearPendingAndAdvance(db, {
        occurrenceId: minted.occurrenceId,
        disposition: "expired",
        wakeId: "wake:other",
        eventMs: BASE + 1_000_000,
        nowMs: BASE + 20,
      });
      expect(replay).toEqual(first);
      expect(readSchedule(db)!.nextEligibleAtMs).toBe(schedule.nextEligibleAtMs + CADENCE);
      // Mismatched occurrence throws (fail closed, never a torn write).
      expect(() => clearPendingAndAdvance(db, {
        occurrenceId: "periodic-occurrence:stale",
        disposition: "expired",
        wakeId: null,
        eventMs: BASE,
        nowMs: BASE + 30,
      })).toThrow("periodic_occurrence_mismatch");
    } finally {
      db.close();
    }
  });

  it("receipt PK replay after a post-commit crash never double-advances", async () => {
    const db = openTestSidecar();
    try {
      seedOccupancy(db, "thread-replay");
      const schedule = createSchedule(db, { authorityEpoch: 1, nowMs: BASE });
      const acquire = vi.fn(async () => []);
      const admitted = await evaluatePeriodicPoll(db, baseInput({
        nowMs: schedule.nextEligibleAtMs,
        scopeConversationId: "thread-replay",
        acquireObservations: acquire,
      }));
      expect(admitted.kind).toBe("admit_runnable");
      const wakeId = (admitted as { runnable: { wakeId: string } }).runnable.wakeId;
      db.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?").run(wakeId);
      const closed = await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs + 5_000, acquireObservations: acquire }));
      expect(closed.kind).toBe("terminal_observed");
      const nextAfter = readSchedule(db)!.nextEligibleAtMs;
      // Duplicate close call replays the receipt without advancing again.
      const again = await evaluatePeriodicPoll(db, baseInput({ nowMs: schedule.nextEligibleAtMs + 6_000, acquireObservations: acquire }));
      expect(again.kind).toBe("not_due");
      expect(readSchedule(db)!.nextEligibleAtMs).toBe(nextAfter);
      expect(listReceipts(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
