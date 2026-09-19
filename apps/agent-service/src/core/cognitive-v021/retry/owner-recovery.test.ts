import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import {
  appendAshleyEvidence,
  appendOwnerUtterance,
} from "../evidence/conversation-log.js";
import {
  appendCycleLogIds,
  appendInboxEvent,
  getInboxEvent,
  updateCycleState,
} from "../cycle/inbox.js";
import { admitWake, getWake } from "../wake/ledger.js";
import {
  claimNextDurableWork,
  settleDurableAttempt,
  startDurableAttempt,
} from "./ledger.js";
import { DURABLE_RETRY_POLICY } from "./policy.js";
import { ownerCoverageHash } from "../owner-obligation.js";
import {
  OWNER_RECOVERY_AUTHORIZATION_REF,
  checkUnansweredOwnerEligibility,
  findEligibleUnansweredOwnerObligations,
  resolveRepairContinuityRecovery,
  serviceUnansweredOwnerRecovery,
} from "./owner-recovery.js";
import { buildThoughtInput } from "../thought/input.js";
import { runCognitiveCycle } from "../thought/run.js";
import { openNuclearDb } from "../../db.js";
import { enqueueWorkerUndertaking } from "../operation/worker-queue.js";
import { env } from "../../../env.js";
import type {
  CapabilityReality,
  IdentitySlice,
  InboxEvent,
  KernelDeps,
  Observation,
} from "../types.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: true, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function kernelDeps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null })),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false }, currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} }, capability: capabilityReality,
      operational: { sandboxAvailable: false }, relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
    ...overrides,
  };
}

function seedOwnerMessage(
  db: ReturnType<typeof openTestSidecar>,
  conversationId: string,
  text: string,
  atMs: number,
): { eventId: string; evidenceRowId: string } {
  const evidence = appendOwnerUtterance(db, {
    conversationId,
    text,
    discordMessageIds: [`discord:${conversationId}:${atMs}`],
    nowMs: atMs,
  });
  const event = appendInboxEvent(db, {
    id: `event:${conversationId}:${atMs}`,
    conversationId,
    kind: "owner_utterance",
    payload: { evidenceRowId: evidence.rowId },
    createdAtMs: atMs,
  });
  return { eventId: event.id, evidenceRowId: evidence.rowId };
}

function failTransient(db: ReturnType<typeof openTestSidecar>, eventId: string, atMs: number): void {
  const started = startDurableAttempt(db, { eventId, workerId: "seed-worker", nowMs: atMs });
  settleDurableAttempt(db, {
    eventId,
    attemptId: started.attemptId,
    claimToken: started.claimToken,
    result: {
      kind: "failed",
      failureClass: "transient_retryable",
      errorCode: "provider_unavailable",
      dispatchTruth: "not_started",
    },
    nowMs: atMs + 50,
  });
}

/** Drive an owner event to quarantined/age_exhausted through existing ledger truth. */
function quarantineByAge(db: ReturnType<typeof openTestSidecar>, eventId: string, atMs: number): void {
  failTransient(db, eventId, atMs);
  // Age past the durable retry horizon through the ordinary fair-claim path,
  // event-scoped so sibling rows are never claimed as a side effect. The
  // normalizers quarantine the aged row and the claim then finds nothing.
  claimNextDurableWork(db, {
    workerId: "seed-worker",
    eventId,
    nowMs: atMs + DURABLE_RETRY_POLICY.maxRetryAgeMs + 1_000,
  });
  expect(inboxState(db, eventId)).toBe("quarantined:failed_terminal:age_exhausted");
}

/** Drive an owner event to terminal/permanent_failure through existing ledger truth. */
function terminalizePermanent(
  db: ReturnType<typeof openTestSidecar>,
  eventId: string,
  atMs: number,
  errorCode = "provider_failed",
): void {
  const started = startDurableAttempt(db, { eventId, workerId: "seed-worker", nowMs: atMs });
  settleDurableAttempt(db, {
    eventId,
    attemptId: started.attemptId,
    claimToken: started.claimToken,
    result: {
      kind: "failed",
      failureClass: "permanent_terminal",
      errorCode,
      dispatchTruth: "provider_responded",
    },
    nowMs: atMs + 10,
  });
  expect(inboxState(db, eventId)).toBe("terminal:failed_terminal:permanent_failure");
}

function inboxState(db: ReturnType<typeof openTestSidecar>, eventId: string): string {
  const found = db.prepare("SELECT state, status, terminal_reason FROM inbox_events WHERE id = ?").get(eventId) as {
    state?: unknown; status?: unknown; terminal_reason?: unknown;
  } | undefined;
  return `${String(found?.state)}:${String(found?.status)}:${String(found?.terminal_reason)}`;
}

function repairCount(db: ReturnType<typeof openTestSidecar>): number {
  return Number((db.prepare("SELECT COUNT(*) AS count FROM durable_work_repairs").get() as { count: number }).count);
}

describe("R1 unanswered-owner recovery", () => {
  it("T2 creates exactly one repair undertaking for a quarantined unresolved Owner obligation", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t2";
      const seeded = seedOwnerMessage(db, conversationId, "Owner question never answered", 100);
      quarantineByAge(db, seeded.eventId, 1_000);

      const first = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(first.eligibleConversations).toBe(1);
      expect(first.createdRepairs).toHaveLength(1);
      expect(first.createdRepairs[0]).toMatchObject({
        conversationId,
        created: true,
        predecessorEventId: seeded.eventId,
      });
      expect(first.createdRepairs[0]!.outstandingOwnerEvidenceRefs).toEqual([seeded.evidenceRowId]);
      const stored = db.prepare("SELECT payload_json FROM inbox_events WHERE id = ?").get(
        first.createdRepairs[0]!.repair.eventId,
      ) as { payload_json?: unknown };
      expect(JSON.parse(String(stored.payload_json))).toMatchObject({
        referenceOnly: true,
        repairOfEventId: seeded.eventId,
        authorizationRef: OWNER_RECOVERY_AUTHORIZATION_REF,
        continuityRecovery: {
          primaryPredecessorEventId: seeded.eventId,
          outstandingOwnerEvidenceRefs: [seeded.evidenceRowId],
          reason: "unanswered_owner_obligation_recovery",
        },
      });

      const second = serviceUnansweredOwnerRecovery(db, { nowMs: 3_000 });
      expect(second.createdRepairs).toHaveLength(0);
      expect(repairCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("T4 keeps the predecessor terminal/quarantined and covers the legacy permanent_failure class", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t4";
      const seeded = seedOwnerMessage(db, conversationId, "Legacy-class Owner question", 100);
      terminalizePermanent(db, seeded.eventId, 1_000);

      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(result.createdRepairs).toHaveLength(1);
      expect(result.createdRepairs[0]!.predecessorEventId).toBe(seeded.eventId);
      expect(inboxState(db, seeded.eventId)).toBe("terminal:failed_terminal:permanent_failure");
    } finally {
      db.close();
    }
  });

  it("WQ-T29 does not create R1 repair work while a queued Owner undertaking owns the obligation", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-queue-owner";
      const seeded = seedOwnerMessage(db, conversationId, "Owner request retained by the worker queue", 100);
      terminalizePermanent(db, seeded.eventId, 1_000);
      const admitted = enqueueWorkerUndertaking(db, {
        semanticKind: "project.inspect",
        origin: {
          kind: "OWNER_REQUEST",
          ref: seeded.eventId,
          ownerEventId: seeded.eventId,
          evidenceRowId: seeded.evidenceRowId,
        },
        ownerId: "doc",
        conversationId,
        originCycleId: "cycle:r1-queue-owner",
        originGeneration: 1,
        request: { projectId: "project-ashley" },
        purpose: "inspect the project",
        evidenceNeed: "bounded source evidence",
        nowMs: 1_500,
      });
      expect(admitted.ok).toBe(true);
      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(result.createdRepairs).toHaveLength(0);
      expect(result.eligibleConversations).toBe(0);
    } finally {
      db.close();
    }
  });

  it("T5 restart idempotency mints no duplicate repair work across bounded retry lineages", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t5";
      const seeded = seedOwnerMessage(db, conversationId, "Owner question", 100);
      quarantineByAge(db, seeded.eventId, 1_000);

      const first = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(first.createdRepairs).toHaveLength(1);
      expect(first.finalFailureNoticeIds).toEqual([]);
      const repairId = first.createdRepairs[0]!.repair.eventId;

      // Simulate the repair undertaking failing terminally, then re-service.
      quarantineByAge(db, repairId, 3_000);
      const second = serviceUnansweredOwnerRecovery(db, { nowMs: 4_000 });
      expect(second.createdRepairs).toHaveLength(1);
      expect(second.finalFailureNoticeIds).toEqual([]);
      expect(second.createdRepairs[0]!.created).toBe(true);
      expect(second.createdRepairs[0]!.repair.eventId).not.toBe(repairId);
      expect(second.createdRepairs[0]!.repair.authorizationRef).toBe(
        `${OWNER_RECOVERY_AUTHORIZATION_REF}:retry2`,
      );

      quarantineByAge(db, second.createdRepairs[0]!.repair.eventId, 5_000);
      const third = serviceUnansweredOwnerRecovery(db, { nowMs: 6_000 });
      expect(third.createdRepairs).toHaveLength(1);
      expect(third.finalFailureNoticeIds).toEqual([]);
      expect(third.createdRepairs[0]!.repair.authorizationRef).toBe(
        `${OWNER_RECOVERY_AUTHORIZATION_REF}:retry3`,
      );

      quarantineByAge(db, third.createdRepairs[0]!.repair.eventId, 7_000);
      const fourth = serviceUnansweredOwnerRecovery(db, { nowMs: 8_000 });
      expect(fourth.createdRepairs).toHaveLength(0);
      expect(fourth.lineageExhaustedConversations).toEqual([conversationId]);
      expect(fourth.finalFailureNoticeIds).toHaveLength(1);
      expect(repairCount(db)).toBe(3);
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM system_notice_outbox WHERE notice_key LIKE ?",
      ).get(`thought_failure:${conversationId}:%:owner_recovery_exhausted`)).toMatchObject({ count: 1 });

      const fifth = serviceUnansweredOwnerRecovery(db, { nowMs: 9_000 });
      expect(fifth.finalFailureNoticeIds).toEqual([]);
      expect(fifth.eligibleConversations).toBe(0);
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM system_notice_outbox WHERE notice_key LIKE ?",
      ).get(`thought_failure:${conversationId}:%:owner_recovery_exhausted`)).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("T6 coalesces several outstanding Owner messages into one recovery undertaking", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t6";
      const first = seedOwnerMessage(db, conversationId, "Owner message one", 100);
      const second = seedOwnerMessage(db, conversationId, "Owner message two", 200);
      const third = seedOwnerMessage(db, conversationId, "Owner message three", 300);
      quarantineByAge(db, first.eventId, 1_000);
      quarantineByAge(db, second.eventId, 1_100);
      terminalizePermanent(db, third.eventId, 1_200);

      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(result.eligibleConversations).toBe(1);
      expect(result.createdRepairs).toHaveLength(1);
      expect(result.createdRepairs[0]!.predecessorEventId).toBe(first.eventId);
      expect(result.createdRepairs[0]!.outstandingOwnerEvidenceRefs).toEqual([
        first.evidenceRowId,
        second.evidenceRowId,
        third.evidenceRowId,
      ]);
      expect(repairCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("T7 a successfully delivered recovery prevents later rematerialization", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t7";
      const seeded = seedOwnerMessage(db, conversationId, "Owner question", 100);
      quarantineByAge(db, seeded.eventId, 1_000);

      const created = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(created.createdRepairs).toHaveLength(1);
      const repairId = created.createdRepairs[0]!.repair.eventId;

      const started = startDurableAttempt(db, { eventId: repairId, workerId: "recovery-worker", nowMs: 2_100 });
      expect(settleDurableAttempt(db, {
        eventId: repairId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: { kind: "completed" },
        nowMs: 2_200,
      })).toEqual({ kind: "completed" });
      appendAshleyEvidence(db, {
        conversationId,
        text: "Recovery reply",
        discordMessageIds: ["discord:r1-t7-r1"],
        delivered: true,
        nowMs: 2_300,
      });

      const again = serviceUnansweredOwnerRecovery(db, { nowMs: 3_000 });
      expect(again.eligibleConversations).toBe(0);
      expect(again.createdRepairs).toHaveLength(0);
      expect(repairCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("T8 valid supersession does not repair", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t8";
      const old = seedOwnerMessage(db, conversationId, "Old Owner message", 100);
      const fresh = seedOwnerMessage(db, conversationId, "New Owner message", 200);
      const freshEvent = getInboxEvent(db, fresh.eventId)!;

      const started = startDurableAttempt(db, { eventId: old.eventId, workerId: "seed-worker", nowMs: 300 });
      expect(settleDurableAttempt(db, {
        eventId: old.eventId,
        attemptId: started.attemptId,
        claimToken: started.claimToken,
        result: {
          kind: "superseded",
          successorIdentity: { wakeId: freshEvent.wakeId, eventId: fresh.eventId },
          coveredOwnerEventIds: [old.eventId],
          uncoveredOwnerEventIds: [],
          coverageHash: ownerCoverageHash({
            primaryEventId: old.eventId,
            coveredOwnerEventIds: [old.eventId],
            uncoveredOwnerEventIds: [],
          }),
        },
        nowMs: 400,
      })).toEqual({ kind: "terminal", reason: "superseded" });

      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 500 });
      expect(result.createdRepairs).toHaveLength(0);
      expect(repairCount(db)).toBe(0);
      expect(inboxState(db, fresh.eventId).startsWith("pending:")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("T9 a later settlement without Owner-visible dispatch does not extinguish the obligation", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t9";
      const seeded = seedOwnerMessage(db, conversationId, "Owner question", 100);
      quarantineByAge(db, seeded.eventId, 1_000);

      const laterCycle = admitTestCycle(db, {
        conversationId,
        triggerKind: "owner_message",
        triggerRef: "later-silence",
        occupantId: "doc",
        nowMs: 1_500,
      });
      appendCycleLogIds(db, laterCycle.cycleId, [seeded.evidenceRowId], 1_600);
      db.prepare(
        "INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)",
      ).run(`settlement:${laterCycle.cycleId}`, laterCycle.cycleId, laterCycle.generation, "{}");
      // The later cycle consumed its own trigger: no ordinary continuation
      // stays open, so eligibility reaches the covering-settlement check.
      db.prepare(
        `UPDATE inbox_events SET state = 'terminal', status = 'consumed',
            terminal_reason = 'completed', consumed_at_ms = ?
          WHERE id = ?`,
      ).run(1_550, "later-silence");

      // Internal success is not Owner fulfillment: a covering settlement with
      // no delivered speech leaves the obligation eligible.
      const verdict = checkUnansweredOwnerEligibility(db, {
        id: seeded.eventId,
        conversationId,
        kind: "owner_utterance",
        payloadJson: JSON.stringify({ evidenceRowId: seeded.evidenceRowId }),
        createdAtMs: 100,
        terminalReason: "age_exhausted",
        lastError: "age_exhausted",
        wakeId: getInboxEvent(db, seeded.eventId)!.wakeId,
      });
      expect(verdict).toEqual({ eligible: true, evidence: expect.objectContaining({ rowId: seeded.evidenceRowId }) });

      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(result.createdRepairs).toHaveLength(1);
      expect(repairCount(db)).toBe(1);
      expect(result.createdRepairs[0]!.outstandingOwnerEvidenceRefs).toEqual([seeded.evidenceRowId]);
    } finally {
      db.close();
    }
  });

  it("T9b a later settlement with delivered dispatch still closes the obligation", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t9b";
      const seeded = seedOwnerMessage(db, conversationId, "Owner question", 100);
      quarantineByAge(db, seeded.eventId, 1_000);

      const laterCycle = admitTestCycle(db, {
        conversationId,
        triggerKind: "owner_message",
        triggerRef: "later-delivered",
        occupantId: "doc",
        nowMs: 1_500,
      });
      appendCycleLogIds(db, laterCycle.cycleId, [seeded.evidenceRowId], 1_600);
      db.prepare(
        "INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)",
      ).run(`settlement:${laterCycle.cycleId}`, laterCycle.cycleId, laterCycle.generation, "{}");
      // The covering cycle produced receipt-backed Owner-visible dispatch.
      db.prepare(
        `INSERT INTO speech_outbox
           (settlement_id, projection_key, cycle_id, generation, conversation_id,
            licensed_text, send_status, origin, delivery_intent_json, discord_message_ids_json)
         VALUES (?, ?, ?, ?, ?, ?, 'delivered', 'live', '{}', '["discord-msg-1"]')`,
      ).run(
        `settlement:${laterCycle.cycleId}`,
        `speech:test:${laterCycle.cycleId}`,
        laterCycle.cycleId,
        laterCycle.generation,
        conversationId,
        "Delivered answer",
      );
      db.prepare(
        `UPDATE inbox_events SET state = 'terminal', status = 'consumed',
            terminal_reason = 'completed', consumed_at_ms = ?
          WHERE id = ?`,
      ).run(1_550, "later-delivered");

      const verdict = checkUnansweredOwnerEligibility(db, {
        id: seeded.eventId,
        conversationId,
        kind: "owner_utterance",
        payloadJson: JSON.stringify({ evidenceRowId: seeded.evidenceRowId }),
        createdAtMs: 100,
        terminalReason: "age_exhausted",
        lastError: "age_exhausted",
        wakeId: getInboxEvent(db, seeded.eventId)!.wakeId,
      });
      expect(verdict).toEqual({ eligible: false, reason: "later_settlement_covers" });

      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(result.createdRepairs).toHaveLength(0);
      expect(repairCount(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("T10 an ambiguous sending delivery blocks repair and stays unreplayed", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t10";
      const seeded = seedOwnerMessage(db, conversationId, "Owner question", 100);
      quarantineByAge(db, seeded.eventId, 1_000);
      const event = getInboxEvent(db, seeded.eventId)!;
      const wake = getWake(db, event.wakeId)!;

      db.prepare(
        `INSERT INTO speech_outbox
           (settlement_id, projection_key, cycle_id, generation, conversation_id,
            licensed_text, send_status, origin, delivery_intent_json)
         VALUES (?, ?, ?, ?, ?, ?, 'sending', 'live', ?)`,
      ).run(
        `settlement:${wake.cycleId}:1`,
        `speech:test:${wake.cycleId}`,
        wake.cycleId,
        1,
        conversationId,
        "possibly dispatched draft",
        "{}",
      );

      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(result.createdRepairs).toHaveLength(0);
      expect(repairCount(db)).toBe(0);
      expect(db.prepare("SELECT send_status FROM speech_outbox WHERE cycle_id = ?").get(wake.cycleId))
        .toMatchObject({ send_status: "sending" });
    } finally {
      db.close();
    }
  });

  it("T11 forgotten evidence and T12 external content do not enter Owner recovery", () => {
    const db = openTestSidecar();
    try {
      const orphan = appendInboxEvent(db, {
        id: "event:r1-t11",
        conversationId: "conversation:r1-t11",
        kind: "owner_utterance",
        payload: { evidenceRowId: "evidence:missing" },
        createdAtMs: 100,
      });
      quarantineByAge(db, orphan.id, 1_000);

      const externalConversation = "dm:external:1";
      const externalEvidence = appendOwnerUtterance(db, {
        conversationId: externalConversation,
        text: "external",
        nowMs: 100,
      });
      const externalEvent = appendInboxEvent(db, {
        id: "event:r1-t12",
        conversationId: externalConversation,
        kind: "owner_utterance",
        payload: { evidenceRowId: externalEvidence.rowId },
        createdAtMs: 100,
      });
      quarantineByAge(db, externalEvent.id, 1_000);

      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(result.createdRepairs).toHaveLength(0);
      expect(repairCount(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("T13 orphan pending wakes converge without inventing completion; T14 live wakes are untouched", () => {
    const db = openTestSidecar();
    try {
      const orphanAdmission = admitWake(db, {
        occurrenceId: "occurrence:r1-t13",
        triggerRef: "trigger:r1-t13",
        sourceKind: "inbox",
        conversationId: "conversation:r1-t13",
        capturedAuthorityRevision: 0,
        nowMs: 100,
      });
      if (orphanAdmission.kind === "cancelled" || orphanAdmission.kind === "stale") {
        throw new Error("test_wake_terminal");
      }
      updateCycleState(db, orphanAdmission.wake.cycleId, "silent", 150);

      const liveConversation = "conversation:r1-t14";
      const live = seedOwnerMessage(db, liveConversation, "Live Owner message", 100);
      const liveEvent = getInboxEvent(db, live.eventId)!;

      const reconcilingAdmission = admitWake(db, {
        occurrenceId: "occurrence:r1-reconciling",
        triggerRef: "trigger:r1-reconciling",
        sourceKind: "inbox",
        conversationId: "conversation:r1-reconciling",
        capturedAuthorityRevision: 0,
        nowMs: 100,
      });
      if (reconcilingAdmission.kind === "cancelled" || reconcilingAdmission.kind === "stale") {
        throw new Error("test_wake_terminal");
      }
      db.prepare("UPDATE wakes SET state = 'reconciling' WHERE wake_id = ?")
        .run(reconcilingAdmission.wake.wakeId);

      const result = serviceUnansweredOwnerRecovery(db, { nowMs: 200 });
      expect(result.wakesConverged).toEqual([orphanAdmission.wake.wakeId]);
      expect(getWake(db, orphanAdmission.wake.wakeId)).toMatchObject({
        state: "terminal",
        terminalReason: "no_action",
      });
      expect(getWake(db, liveEvent.wakeId)).toMatchObject({ state: "pending" });
      expect(getWake(db, reconcilingAdmission.wake.wakeId)).toMatchObject({ state: "reconciling" });
    } finally {
      db.close();
    }
  });

  it("T15 two servicing opportunities cannot create duplicate repair work", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t15";
      const seeded = seedOwnerMessage(db, conversationId, "Owner question", 100);
      quarantineByAge(db, seeded.eventId, 1_000);

      const first = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      const second = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(first.createdRepairs).toHaveLength(1);
      expect(second.createdRepairs).toHaveLength(0);
      expect(repairCount(db)).toBe(1);
      expect(findEligibleUnansweredOwnerObligations(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("T3 a recovery Thought receives the canonical outstanding Owner evidence with the recovery frame", async () => {
    const origDiscordOwnerId = env.discordOwnerId;
    env.discordOwnerId = "100000000000000001";
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const conversationId = "conversation:r1-t3";
      const seeded = seedOwnerMessage(sidecar, conversationId, "Owner question never answered", 100);
      quarantineByAge(sidecar, seeded.eventId, 1_000);

      const serviced = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 2_000 });
      expect(serviced.createdRepairs).toHaveLength(1);
      const repairId = serviced.createdRepairs[0]!.repair.eventId;

      const started = startDurableAttempt(sidecar, { eventId: repairId, workerId: "recovery-worker", nowMs: 2_100 });
      const repairEvent = getInboxEvent(sidecar, repairId)!;

      const completeChat = vi.fn(async () => ({
        text: JSON.stringify(makeSemanticSettlement({
          speech: { mode: "draft", surfaceDraft: "recovery reply" },
        })),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      }));
      const attentionDb = openTestSidecar();
      const result = await runCognitiveCycle(
        sidecar,
        nuclear,
        { ...repairEvent, durableAttemptId: started.attemptId, durableAttemptOrdinal: started.ordinal },
        kernelDeps({ attentionDb, completeChat, nowMs: () => 2_200 }),
      );
      expect(completeChat).toHaveBeenCalledTimes(1);

      const firstCall = completeChat.mock.calls[0] as unknown[] | undefined;
      const messages = firstCall?.[0] as unknown as Array<{ role: string; content: string }>;
      const userMessage = String(messages.find((message) => message.role === "user")?.content ?? "{}");
      const projected = JSON.parse(userMessage) as {
        trigger: { kind: string; continuityRecovery?: Record<string, unknown> };
        rawConversation: Array<{ rowId?: string; text?: string | null }>;
      };
      expect(projected.trigger.continuityRecovery).toMatchObject({
        repairEventId: repairId,
        primaryPredecessorEventId: seeded.eventId,
        outstandingOwnerEvidenceRefs: [seeded.evidenceRowId],
        reason: "unanswered_owner_obligation_recovery",
      });
      expect(projected.rawConversation.map((row) => row.text)).toContain("Owner question never answered");
      expect(result.published).toBe(true);

      const cycleId = serviced.createdRepairs[0]!.repair.cycleId;
      const cycle = sidecar.prepare("SELECT compose_log_ids_json FROM cycle_records WHERE cycle_id = ?").get(cycleId) as {
        compose_log_ids_json?: unknown;
      };
      expect(JSON.parse(String(cycle.compose_log_ids_json))).toContain(seeded.evidenceRowId);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements WHERE cycle_id = ?").get(cycleId))
        .toMatchObject({ count: 1 });
    } finally {
      env.discordOwnerId = origDiscordOwnerId;
      nuclear.close();
      sidecar.close();
    }
  });

  it("T16 repair Thought input changes no M6/capability exposure", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-t16";
      const cycle = admitTestCycle(db, {
        conversationId,
        triggerKind: "recovery",
        triggerRef: "repair:r1-t16",
        occupantId: "doc",
        nowMs: 1,
      });
      const evidence = appendOwnerUtterance(db, {
        conversationId,
        text: "Owner question",
        nowMs: 2,
      });
      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        triggerText: evidence.text ?? "",
        triggerEvidence: evidence,
        constitution,
        capabilityReality,
        workingContext: [],
        occupancy: [],
        learnedSelfSlice: { dispositions: [], interests: [] },
        continuityRecovery: {
          repairEventId: "repair:r1-t16",
          primaryPredecessorEventId: "event:r1-t16",
          outstandingOwnerEvidenceRefs: [evidence.rowId],
          reason: "unanswered_owner_obligation_recovery",
        },
      });
      expect(input.trigger.continuityRecovery).toMatchObject({
        reason: "unanswered_owner_obligation_recovery",
      });
      expect(input.capabilityReality.canOfferBoundedOperation).toBe(false);
      expect(input.capabilityReality).not.toHaveProperty("operationCapabilities");
    } finally {
      db.close();
    }
  });

  it("resolves edited evidence to its current lineage version instead of failing", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:r1-edited";
      const seeded = seedOwnerMessage(db, conversationId, "Original wording", 100);
      quarantineByAge(db, seeded.eventId, 1_000);
      const created = serviceUnansweredOwnerRecovery(db, { nowMs: 2_000 });
      expect(created.createdRepairs).toHaveLength(1);

      const repairEvent = getInboxEvent(db, created.createdRepairs[0]!.repair.eventId)!;
      const resolved = resolveRepairContinuityRecovery(db, repairEvent as InboxEvent);
      expect(resolved.frame.outstandingOwnerEvidenceRefs).toEqual([seeded.evidenceRowId]);
      expect(resolved.primary.rowId).toBe(seeded.evidenceRowId);
    } finally {
      db.close();
    }
  });
});
