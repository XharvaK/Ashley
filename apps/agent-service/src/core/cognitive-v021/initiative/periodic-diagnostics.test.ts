import { describe, expect, it, vi } from "vitest";
import { openTestSidecar } from "../test-support.js";
import {
  bindPrivateRepairAttempt,
  bindPrivateReservationInvocation,
  commitPrivateDispatch,
  commitPrivateRepairDispatch,
  recordPrivateProviderResponse,
  recordPrivateRepairResponse,
  reservePrivateThought,
  PRIVATE_THOUGHT_POLICY_ID,
} from "../private-budget/ledger.js";
import { reconcilePolicyClock } from "../private-budget/policy-time-ledger.js";
import {
  clearPendingAndAdvance,
  createSchedule,
  freezeBinding,
  mintPendingOccurrence,
  periodicTriggerRef,
} from "./periodic-schedule.js";
import { openObservabilityStore } from "../thought/diagnostics.js";
import { listPeriodicDiagnostics } from "./periodic-diagnostics.js";

const BASE = 10_000_000;

function seedCompletedPeriodicOccurrence() {
  const sidecar = openTestSidecar();
  const observability = openObservabilityStore(":memory:");
  const schedule = createSchedule(sidecar, { authorityEpoch: 3, nowMs: BASE });
  const minted = mintPendingOccurrence(sidecar, { nowMs: schedule.nextEligibleAtMs });
  const triggerRef = periodicTriggerRef(minted.occurrenceId, minted.dueAtMs);
  const binding = freezeBinding(sidecar, {
    occurrenceId: minted.occurrenceId,
    triggerRef,
    conversationId: "conversation:periodic-diagnostics",
    authorityEpoch: 3,
    nowMs: minted.dueAtMs,
  });
  if (binding.kind !== "bound") throw new Error("periodic_binding_failed");
  const wakeId = binding.wake.wakeId;
  reconcilePolicyClock(sidecar, {
    policyId: PRIVATE_THOUGHT_POLICY_ID,
    wallClockNowMs: minted.dueAtMs,
    authorizationRef: "test:periodic-diagnostics",
  });
  const reserved = reservePrivateThought(sidecar, {
    admissionId: `admission:${minted.occurrenceId}`,
    wakeId,
    conversationId: "conversation:periodic-diagnostics",
    policyId: PRIVATE_THOUGHT_POLICY_ID,
    wallClockNowMs: minted.dueAtMs,
  });
  if (reserved.kind !== "reserved") throw new Error("periodic_reservation_failed");
  const reservationId = reserved.reservation.reservationId;
  bindPrivateReservationInvocation(sidecar, {
    reservationId,
    invocationId: "invocation:periodic:1",
    attemptId: "attempt:periodic:1",
    nowMs: minted.dueAtMs + 1,
  });
  commitPrivateDispatch(sidecar, {
    reservationId,
    invocationId: "invocation:periodic:1",
    attemptId: "attempt:periodic:1",
    nowMs: minted.dueAtMs + 2,
  });
  recordPrivateProviderResponse(sidecar, {
    reservationId,
    invocationId: "invocation:periodic:1",
    attemptId: "attempt:periodic:1",
    nowMs: minted.dueAtMs + 3,
  });
  const child = bindPrivateRepairAttempt(sidecar, {
    reservationId,
    invocationId: "invocation:periodic:2",
    attemptId: "attempt:periodic:2",
    wakeId,
    conversationId: "conversation:periodic-diagnostics",
    ordinal: 2,
    reason: "structural_repair",
    nowMs: minted.dueAtMs + 4,
  });
  commitPrivateRepairDispatch(sidecar, {
    reservationId,
    invocationId: child.invocationId,
    attemptId: child.attemptId,
    nowMs: minted.dueAtMs + 5,
  });
  recordPrivateRepairResponse(sidecar, {
    reservationId,
    invocationId: child.invocationId,
    attemptId: child.attemptId,
    providerRequestId: "provider-request:child",
    nowMs: minted.dueAtMs + 6,
  });

  sidecar.prepare(
    `INSERT INTO inbox_events
       (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
     VALUES (?, ?, 'idle_opportunity', '{}', ?, 'consumed', ?)`,
  ).run(`event:${minted.occurrenceId}`, "conversation:periodic-diagnostics", minted.dueAtMs + 7, wakeId);
  sidecar.prepare(
    `UPDATE inbox_events
        SET state = 'terminal', terminal_reason = 'completed', consumed_at_ms = ?
      WHERE id = ?`,
  ).run(minted.dueAtMs + 7, `event:${minted.occurrenceId}`);
  sidecar.prepare(
    "UPDATE wakes SET state = 'terminal', terminal_reason = 'completed', updated_at_ms = ? WHERE wake_id = ?",
  ).run(minted.dueAtMs + 8, wakeId);
  sidecar.prepare(
    "UPDATE cycle_records SET state = 'silent', updated_at_ms = ? WHERE wake_id = ?",
  ).run(minted.dueAtMs + 8, wakeId);
  clearPendingAndAdvance(sidecar, {
    occurrenceId: minted.occurrenceId,
    disposition: "admitted",
    wakeId,
    eventMs: minted.dueAtMs + 8,
    nowMs: minted.dueAtMs + 8,
  });

  const cycle = sidecar.prepare("SELECT cycle_id, generation FROM cycle_records WHERE wake_id = ?").get(wakeId) as { cycle_id: string; generation: number };
  observability.recordDiagnostic({
    cycleId: cycle.cycle_id,
    generation: cycle.generation,
    requestId: "invocation:periodic:1",
    pass: 1,
    code: "provider_returned",
    stage: "provider_dispatch",
    dispatchTruth: "sent",
    providerFailure: {
      dispatchTruth: "sent",
      parserStatus: "passed",
      validatorStatus: "passed",
      structuralRetryStatus: "not_applicable",
      attemptOrdinal: 1,
      model: "model:periodic",
    },
    providerDiagnostics: {
      providerRequestId: "provider-request:parent",
      attemptOrdinal: 1,
      totalTokens: 12,
    },
  }, minted.dueAtMs + 9);
  observability.recordDiagnostic({
    cycleId: cycle.cycle_id,
    generation: cycle.generation,
    requestId: "invocation:periodic:2",
    pass: 2,
    code: "parser_malformed",
    stage: "parser",
    dispatchTruth: "sent",
    providerFailure: {
      dispatchTruth: "sent",
      parserStatus: "failed",
      validatorStatus: "not_run",
      structuralRetryStatus: "exhausted",
      attemptOrdinal: 2,
      failureClass: "parser_malformed",
    },
    providerDiagnostics: {
      providerRequestId: "provider-request:child",
      attemptOrdinal: 2,
      errorCode: "parser_malformed",
    },
  }, minted.dueAtMs + 10);
  sidecar.prepare(
    `INSERT INTO settlements
       (settlement_id, cycle_id, generation, wake_id, semantic_pass, payload_json)
     VALUES ('settlement:periodic', ?, ?, ?, 2, '{}')`,
  ).run(cycle.cycle_id, cycle.generation, wakeId);
  sidecar.prepare(
    `INSERT INTO speech_outbox
       (settlement_id, projection_key, cycle_id, generation, conversation_id,
        licensed_text, send_status, origin, delivery_intent_json)
     VALUES ('settlement:periodic', 'projection:periodic', ?, ?,
        'conversation:periodic-diagnostics', 'redacted test text', 'sent', 'live', '{}')`,
  ).run(cycle.cycle_id, cycle.generation);
  return { sidecar, observability, occurrenceId: minted.occurrenceId, wakeId, cycleId: cycle.cycle_id };
}

describe("P3 periodic diagnostic projection", () => {
  it("reconstructs the terminated occurrence through the parent-plus-child UNION without double-counting spend", () => {
    vi.stubEnv("ASHLEY_OBSERVABILITY_MODE", "rich");
    const fixture = seedCompletedPeriodicOccurrence();
    try {
      const [record] = listPeriodicDiagnostics(fixture.sidecar, fixture.observability.db, { nowMs: BASE + 2 * 21_600_000 });
      expect(record).toBeDefined();
      expect(record?.occurrence.scheduleOccurrenceId).toBe(fixture.occurrenceId);
      expect(record?.wake?.wakeId).toBe(fixture.wakeId);
      expect(record?.cycle?.cycleId).toBe(fixture.cycleId);
      expect(record?.attempts.map((attempt) => attempt.ordinal)).toEqual([1, 2]);
      expect(record?.attempts[0]?.providerRequestId).toBe("provider-request:parent");
      expect(record?.attempts[1]?.providerRequestId).toBe("provider-request:child");
      expect(record?.spend).toMatchObject({
        parentReservationCount: 1,
        childAttemptCount: 1,
        countedAttemptOrdinals: [1],
      });
      expect(record?.settlement?.settlementId).toBe("settlement:periodic");
      expect(record?.publication.speechOutbox?.sendStatus).toBe("sent");
      expect(record?.diagnostics).toHaveLength(2);
      expect(record?.diagnostics.some((diagnostic) => diagnostic.providerDiagnostics?.attemptOrdinal === 2)).toBe(true);
    } finally {
      fixture.observability.close();
      fixture.sidecar.close();
      vi.unstubAllEnvs();
    }
  });

  it("keeps a NULL-wake terminal receipt as a first-class record", () => {
    const sidecar = openTestSidecar();
    const observability = openObservabilityStore(":memory:");
    try {
      const schedule = createSchedule(sidecar, { authorityEpoch: 1, nowMs: BASE });
      const minted = mintPendingOccurrence(sidecar, { nowMs: schedule.nextEligibleAtMs });
      clearPendingAndAdvance(sidecar, {
        occurrenceId: minted.occurrenceId,
        disposition: "skipped_empty",
        wakeId: null,
        eventMs: minted.dueAtMs,
        nowMs: minted.dueAtMs,
      });
      const [record] = listPeriodicDiagnostics(sidecar, observability.db, { nowMs: minted.dueAtMs + 1 });
      expect(record).toMatchObject({
        occurrence: { scheduleOccurrenceId: minted.occurrenceId, wakeId: null, disposition: "skipped_empty" },
        wake: null,
        cycle: null,
        reservation: null,
        attempts: [],
        spend: { parentReservationCount: 0, childAttemptCount: 0, countedAttemptOrdinals: [] },
      });
    } finally {
      observability.close();
      sidecar.close();
    }
  });
});
