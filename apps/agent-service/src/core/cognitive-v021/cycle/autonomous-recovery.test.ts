import { describe, expect, it } from "vitest";
import { appendAshleyEvidence, appendOwnerUtterance, listConversationEvidence } from "../evidence/conversation-log.js";
import { admitWake } from "../wake/ledger.js";
import { appendCycleLogIds, appendInboxEvent, updateCycleState } from "./inbox.js";
import { consumeNextInboxEvent, startInboxConsumer } from "./inbox-consumer.js";
import { startDurableAttempt, settleDurableAttempt } from "../retry/ledger.js";
import { frontierAwareEvidenceSelection } from "../thought/input.js";
import { openTestSidecar } from "../test-support.js";
import type { InboxEvent, KernelRunResult } from "../types.js";

const RETRY_AGE_MS = 15 * 60 * 1_000;

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("autonomous_recovery_timeout"));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
}

function seedSharedWakeBacklog(options: { includeC?: boolean } = {}): {
  db: ReturnType<typeof openTestSidecar>;
  conversationId: string;
  cycleId: string;
  wakeId: string;
  eventA: string;
  eventB: string;
  eventC: string;
  ownerAEvidenceId: string;
  ownerBEvidenceId: string;
  ownerCEvidenceId: string;
  ownerA: string;
  ownerB: string;
  ownerC: string;
} {
  const db = openTestSidecar();
  const includeC = options.includeC ?? true;
  const conversationId = "conversation:autonomous-recovery";
  const cycleId = "cycle:autonomous-recovery";
  const admitted = admitWake(db, {
    occurrenceId: "occurrence:autonomous-recovery",
    triggerRef: "trigger:autonomous-recovery",
    sourceKind: "inbox",
    conversationId,
    cycleId,
    capturedAuthorityRevision: 1,
    nowMs: 1,
  });
  const wakeId = admitted.wake.wakeId;
  updateCycleState(db, cycleId, "thinking", 2);

  appendAshleyEvidence(db, {
    conversationId,
    text: "R0",
    discordMessageIds: ["discord:autonomous-r0"],
    delivered: true,
    nowMs: 50,
  });
  const ownerA = appendOwnerUtterance(db, {
    conversationId,
    text: "Owner A substantive question",
    discordMessageIds: ["discord:autonomous-a"],
    nowMs: 100,
  });
  const ownerB = appendOwnerUtterance(db, {
    conversationId,
    text: "ash you there?",
    discordMessageIds: ["discord:autonomous-b"],
    nowMs: 200,
  });
  const ownerC = includeC
    ? appendOwnerUtterance(db, {
        conversationId,
        text: "Hello?",
        discordMessageIds: ["discord:autonomous-c"],
        nowMs: 300,
      })
    : null;

  const appendEvent = (id: string, evidenceRowId: string, createdAtMs: number): void => {
    appendInboxEvent(db, {
      id,
      conversationId,
      kind: "owner_utterance",
      payload: { cycleId, wakeId, evidenceRowId },
      createdAtMs,
      wakeId,
    });
  };
  const eventA = "event:autonomous-a";
  const eventB = "event:autonomous-b";
  const eventC = "event:autonomous-c";
  appendEvent(eventA, ownerA.rowId, 100);
  appendEvent(eventB, ownerB.rowId, 200);
  if (ownerC) appendEvent(eventC, ownerC.rowId, 300);
  appendCycleLogIds(db, cycleId, [ownerA.rowId, ownerB.rowId, ...(ownerC ? [ownerC.rowId] : [])], 350);

  const started = startDurableAttempt(db, { eventId: eventA, workerId: "seed-worker", nowMs: 1_000 });
  settleDurableAttempt(db, {
    eventId: eventA,
    attemptId: started.attemptId,
    claimToken: started.claimToken,
    result: {
      kind: "failed",
      failureClass: "transient_retryable",
      errorCode: "provider_unavailable",
      dispatchTruth: "not_started",
    },
    nowMs: 1_100,
  });

  return {
    db,
    conversationId,
    cycleId,
    wakeId,
    eventA,
    eventB,
    eventC,
    ownerAEvidenceId: ownerA.rowId,
    ownerBEvidenceId: ownerB.rowId,
    ownerCEvidenceId: ownerC?.rowId ?? "",
    ownerA: ownerA.text ?? "",
    ownerB: ownerB.text ?? "",
    ownerC: ownerC?.text ?? "",
  };
}

function successfulCognitiveDispatch(
  fixture: ReturnType<typeof seedSharedWakeBacklog>,
  event: InboxEvent,
): KernelRunResult {
  const coverage = event.dispatchCoverage;
  if (!coverage) throw new Error("test_dispatch_coverage_missing");
  return {
    cycleId: fixture.cycleId,
    generation: 1,
    published: true,
    outboxId: 1,
    infrastructureNotice: null,
    thoughtModelAttempts: 1,
    acceptedThoughtPasses: 1,
    composeCancelledAttempts: 0,
    acceptedSettlements: 1,
    ownerObligationResolution: {
      attemptOutcome: "published",
      ownerObligationOutcome: "transferred",
      primaryEventId: coverage.primaryEventId,
      coveredOwnerEventIds: coverage.coveredOwnerEventIds,
      uncoveredOwnerEventIds: coverage.uncoveredOwnerEventIds,
      coverageHash: coverage.coverageHash,
      semanticCommitment: "answer",
      settlementId: `settlement:${event.id}`,
      successorIdentity: "speech_outbox:1",
      remainingResponsibility: "delivery_confirmation",
      deliveryDisposition: "handed_to_delivery",
    },
  };
}

describe("autonomous unanswered conversation recovery", () => {
  it("AUTONOMOUS_UNANSWERED_CONVERSATION_RECOVERY resumes one shared-wake backlog without new Owner input", async () => {
    const fixture = seedSharedWakeBacklog();
    const beforeEventCount = Number((fixture.db.prepare("SELECT COUNT(*) AS count FROM inbox_events").get() as { count: number }).count);
    const claimedEventIds: string[] = [];
    const contextSnapshots: string[][] = [];
    const loop = startInboxConsumer(fixture.db, {
      workerId: "autonomous-recovery-worker",
      pollMs: 1,
      nowMs: () => 1_000 + RETRY_AGE_MS + 1,
      handler: async (event) => {
        claimedEventIds.push(event.id);
        contextSnapshots.push(
          frontierAwareEvidenceSelection(fixture.db, fixture.conversationId, { lastNTurns: 12 })
            .selectedEvidence
            .map((row) => row.text ?? ""),
        );
        return successfulCognitiveDispatch(fixture, event);
      },
    });
    const duplicateRecoveryLoop = startInboxConsumer(fixture.db, {
      workerId: "duplicate-recovery-worker",
      pollMs: 1,
      nowMs: () => 1_000 + RETRY_AGE_MS + 1,
      handler: async (event) => {
        claimedEventIds.push(event.id);
        contextSnapshots.push(
          frontierAwareEvidenceSelection(fixture.db, fixture.conversationId, { lastNTurns: 12 })
            .selectedEvidence
            .map((row) => row.text ?? ""),
        );
        return successfulCognitiveDispatch(fixture, event);
      },
    });

    try {
      await waitFor(() => {
        const row = fixture.db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(fixture.eventB) as { state?: string } | undefined;
        return row?.state === "terminal";
      });

      expect(claimedEventIds).toEqual([fixture.eventB]);
      expect(contextSnapshots).toEqual([["R0", fixture.ownerA, fixture.ownerB, fixture.ownerC]]);
      expect(Number((fixture.db.prepare("SELECT COUNT(*) AS count FROM inbox_events").get() as { count: number }).count)).toBe(beforeEventCount);
      expect(fixture.db.prepare("SELECT state, terminal_reason, quarantine_reason FROM inbox_events WHERE id = ?").get(fixture.eventA)).toMatchObject({
        state: "quarantined",
        terminal_reason: "age_exhausted",
        quarantine_reason: "age_exhausted",
      });
      expect(fixture.db.prepare("SELECT state, status, attempt_count FROM inbox_events WHERE id = ?").get(fixture.eventB)).toMatchObject({
        state: "terminal",
        status: "consumed",
        attempt_count: 1,
      });
      expect(fixture.db.prepare("SELECT state, status, attempt_count, terminal_reason FROM inbox_events WHERE id = ?").get(fixture.eventC)).toMatchObject({
        state: "terminal",
        status: "consumed",
        attempt_count: 0,
        terminal_reason: "completed",
      });
      expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM durable_work_attempts").get()).toMatchObject({ count: 2 });
      expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(claimedEventIds).toEqual([fixture.eventB]);
      expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM durable_work_attempts").get()).toMatchObject({ count: 2 });
    } finally {
      loop.stop();
      duplicateRecoveryLoop.stop();
      await loop.done;
      await duplicateRecoveryLoop.done;
      fixture.db.close();
    }
  });

  it("converges covered sibling residue and does not let it block a fresh Owner message", async () => {
    const fixture = seedSharedWakeBacklog();
    const handledEventIds: string[] = [];
    const loop = startInboxConsumer(fixture.db, {
      workerId: "covered-sibling-worker",
      pollMs: 1,
      nowMs: () => 1_000 + RETRY_AGE_MS + 1,
      handler: async (event) => {
        handledEventIds.push(event.id);
        if (event.id === fixture.eventB) {
          return successfulCognitiveDispatch(fixture, event);
        }
        return { kind: "completed" as const };
      },
    });

    try {
      await waitFor(() => {
        const row = fixture.db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(fixture.eventB) as { state?: string } | undefined;
        return row?.state === "terminal";
      });
      loop.stop();
      await loop.done;

      const residueBeforeContinuation = fixture.db.prepare(
        "SELECT state, status, attempt_count FROM inbox_events WHERE id = ?",
      ).get(fixture.eventC) as { state?: string; status?: string; attempt_count?: number };
      const wakeBeforeContinuation = fixture.db.prepare(
        "SELECT state, terminal_reason FROM wakes WHERE wake_id = ?",
      ).get(fixture.wakeId) as { state?: string; terminal_reason?: string | null };
      const firstIdle = await consumeNextInboxEvent(fixture.db, {
        workerId: "covered-sibling-worker",
        nowMs: () => 1_000 + RETRY_AGE_MS + 1,
        handler: async (event) => {
          handledEventIds.push(event.id);
          return { kind: "completed" as const };
        },
      });
      const secondIdle = await consumeNextInboxEvent(fixture.db, {
        workerId: "covered-sibling-worker",
        nowMs: () => 1_000 + RETRY_AGE_MS + 1,
        handler: async (event) => {
          handledEventIds.push(event.id);
          return { kind: "completed" as const };
        },
      });
      const ownerD = appendOwnerUtterance(fixture.db, {
        conversationId: fixture.conversationId,
        text: "A fresh Owner message after the recovery turn",
        discordMessageIds: ["discord:autonomous-d"],
        nowMs: 400,
      });
      const eventD = appendInboxEvent(fixture.db, {
        conversationId: fixture.conversationId,
        kind: "owner_utterance",
        payload: { evidenceRowId: ownerD.rowId },
        createdAtMs: 400,
      });
      const dTick = await consumeNextInboxEvent(fixture.db, {
        workerId: "covered-sibling-worker",
        nowMs: () => 401,
        handler: async (event) => {
          handledEventIds.push(event.id);
          return { kind: "completed" as const };
        },
      });

      expect({
        DOES_C_CONVERGE_WITHOUT_NEW_INPUT: residueBeforeContinuation.state !== "pending",
        DOES_CONSUMER_REPEAT_IDLE_ON_C: residueBeforeContinuation.state === "pending"
          && firstIdle.outcome === "idle"
          && secondIdle.outcome === "idle",
        CAN_NEW_OWNER_MESSAGE_D_PROGRESS: dTick.outcome === "consumed" && handledEventIds.includes(eventD.id),
      }).toEqual({
        DOES_C_CONVERGE_WITHOUT_NEW_INPUT: true,
        DOES_CONSUMER_REPEAT_IDLE_ON_C: false,
        CAN_NEW_OWNER_MESSAGE_D_PROGRESS: true,
      });
      expect(residueBeforeContinuation).toMatchObject({ state: "terminal", status: "consumed", attempt_count: 0 });
      expect(wakeBeforeContinuation).toMatchObject({ state: "terminal", terminal_reason: "completed" });
      expect(fixture.db.prepare("SELECT state, status, attempt_count FROM inbox_events WHERE id = ?").get(eventD.id)).toMatchObject({
        state: "terminal",
        status: "consumed",
        attempt_count: 1,
      });
      expect(handledEventIds).toEqual([fixture.eventB, eventD.id]);
    } finally {
      loop.stop();
      await loop.done;
      fixture.db.close();
    }
  });

  it("keeps a same-wake sibling that arrives after the cognition snapshot claimable", async () => {
    const fixture = seedSharedWakeBacklog({ includeC: false });
    const lateEventId = "event:autonomous-late-c";
    const handledEventIds: string[] = [];
    let snapshot: string[] = [];
    const loop = startInboxConsumer(fixture.db, {
      workerId: "late-sibling-worker",
      pollMs: 1,
      nowMs: () => 1_000 + RETRY_AGE_MS + 1,
      handler: async (event) => {
        handledEventIds.push(event.id);
        if (event.id === fixture.eventB) {
          snapshot = frontierAwareEvidenceSelection(fixture.db, fixture.conversationId, { lastNTurns: 12 })
            .selectedEvidence
            .map((row) => row.text ?? "");
          const ownerC = appendOwnerUtterance(fixture.db, {
            conversationId: fixture.conversationId,
            text: "Hello after the cognition snapshot",
            discordMessageIds: ["discord:autonomous-late-c"],
            nowMs: 300,
          });
          appendInboxEvent(fixture.db, {
            id: lateEventId,
            wakeId: fixture.wakeId,
            conversationId: fixture.conversationId,
            kind: "owner_utterance",
            payload: { cycleId: fixture.cycleId, wakeId: fixture.wakeId, evidenceRowId: ownerC.rowId },
            createdAtMs: 300,
          });
          return successfulCognitiveDispatch(fixture, event);
        }
        return { kind: "completed" as const };
      },
    });

    try {
      await waitFor(() => {
        const row = fixture.db.prepare("SELECT state FROM inbox_events WHERE id = ?").get(lateEventId) as { state?: string } | undefined;
        return row?.state === "terminal";
      });
      expect(snapshot).toEqual(["R0", fixture.ownerA, fixture.ownerB]);
      expect(handledEventIds).toEqual([fixture.eventB, lateEventId]);
      expect(fixture.db.prepare("SELECT state, status, attempt_count, terminal_reason FROM inbox_events WHERE id = ?").get(lateEventId)).toMatchObject({
        state: "terminal",
        status: "consumed",
        attempt_count: 1,
        terminal_reason: "completed",
      });
    } finally {
      loop.stop();
      await loop.done;
      fixture.db.close();
    }
  });

  it("does not autonomously recover a conversation with no unanswered Owner backlog", async () => {
    const db = openTestSidecar();
    let handlerCalls = 0;
    appendAshleyEvidence(db, {
      conversationId: "conversation:no-backlog",
      text: "R0",
      delivered: true,
      nowMs: 1,
    });
    const loop = startInboxConsumer(db, {
      workerId: "no-backlog-worker",
      pollMs: 1,
      handler: async () => {
        handlerCalls += 1;
        return { kind: "completed" as const };
      },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(handlerCalls).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM durable_work_attempts").get()).toMatchObject({ count: 0 });
    } finally {
      loop.stop();
      await loop.done;
      db.close();
    }
  });

  it("does not autonomously recover an Owner message already followed by a delivered Ashley response", async () => {
    const db = openTestSidecar();
    const conversationId = "conversation:already-answered";
    const event = appendInboxEvent(db, {
      id: "event:already-answered",
      conversationId,
      kind: "owner_utterance",
      payload: { ownerMessage: "Owner A" },
      createdAtMs: 1,
    });
    appendOwnerUtterance(db, {
      conversationId,
      text: "Owner A",
      discordMessageIds: ["discord:already-answered-a"],
      nowMs: 1,
    });
    appendAshleyEvidence(db, {
      conversationId,
      text: "R1",
      discordMessageIds: ["discord:already-answered-r1"],
      delivered: true,
      nowMs: 2,
    });
    const started = startDurableAttempt(db, { eventId: event.id, workerId: "answer-worker", nowMs: 10 });
    expect(settleDurableAttempt(db, {
      eventId: event.id,
      attemptId: started.attemptId,
      claimToken: started.claimToken,
      result: { kind: "completed" },
      nowMs: 20,
    })).toEqual({ kind: "completed" });

    let handlerCalls = 0;
    const loop = startInboxConsumer(db, {
      workerId: "already-answered-worker",
      pollMs: 1,
      handler: async () => {
        handlerCalls += 1;
        return { kind: "completed" as const };
      },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(handlerCalls).toBe(0);
      expect(db.prepare("SELECT state, status FROM inbox_events WHERE id = ?").get(event.id)).toMatchObject({ state: "terminal", status: "consumed" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM durable_work_attempts WHERE event_id = ?").get(event.id)).toMatchObject({ count: 1 });
    } finally {
      loop.stop();
      await loop.done;
      db.close();
    }
  });

  it("does not resurrect a legitimately terminal or refused obligation", async () => {
    const db = openTestSidecar();
    const conversationId = "conversation:terminal-obligation";
    const owner = appendOwnerUtterance(db, {
      conversationId,
      text: "Owner A",
      discordMessageIds: ["discord:terminal-owner"],
      nowMs: 1,
    });
    const event = appendInboxEvent(db, {
      id: "event:terminal-obligation",
      conversationId,
      kind: "owner_utterance",
      payload: { evidenceRowId: owner.rowId },
      createdAtMs: 1,
    });
    const started = startDurableAttempt(db, { eventId: event.id, workerId: "refusal-worker", nowMs: 10 });
    expect(settleDurableAttempt(db, {
      eventId: event.id,
      attemptId: started.attemptId,
      claimToken: started.claimToken,
      result: {
        kind: "failed",
        failureClass: "permanent_terminal",
        errorCode: "authority_refused",
        dispatchTruth: "provider_responded",
      },
      nowMs: 20,
    })).toEqual({ kind: "terminal", reason: "permanent_failure" });

    let handlerCalls = 0;
    const loop = startInboxConsumer(db, {
      workerId: "terminal-recovery-worker",
      pollMs: 1,
      handler: async () => {
        handlerCalls += 1;
        return { kind: "completed" as const };
      },
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(handlerCalls).toBe(0);
      expect(db.prepare("SELECT state, status, terminal_reason FROM inbox_events WHERE id = ?").get(event.id)).toMatchObject({
        state: "terminal",
        status: "failed_terminal",
        terminal_reason: "permanent_failure",
      });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes WHERE wake_id = ?").get(event.wakeId)).toMatchObject({
        state: "terminal",
        terminal_reason: "quarantined",
      });
    } finally {
      loop.stop();
      await loop.done;
      db.close();
    }
  });

  it("limits a newer unresolved backlog to Owner messages after the last delivered Ashley turn", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "conversation:newer-backlog";
      appendOwnerUtterance(db, { conversationId, text: "Owner A", nowMs: 1 });
      appendAshleyEvidence(db, { conversationId, text: "R1", delivered: true, nowMs: 2 });
      const ownerB = appendOwnerUtterance(db, { conversationId, text: "Owner B", nowMs: 3 });
      const ownerC = appendOwnerUtterance(db, { conversationId, text: "Owner C", nowMs: 4 });
      const evidence = listConversationEvidence(db, conversationId);
      const lastDeliveredAshleyIndex = evidence.reduce(
        (latest, row, index) => row.role === "ashley" && row.delivered ? index : latest,
        -1,
      );
      const unresolvedOwnerText = evidence
        .slice(lastDeliveredAshleyIndex + 1)
        .filter((row) => row.role === "owner")
        .map((row) => row.text);
      expect(unresolvedOwnerText).toEqual([ownerB.text, ownerC.text]);
      expect(frontierAwareEvidenceSelection(db, conversationId, { lastNTurns: 12 }).selectedEvidence.map((row) => row.text)).toEqual([
        "Owner A",
        "R1",
        ownerB.text,
        ownerC.text,
      ]);
    } finally {
      db.close();
    }
  });
});
