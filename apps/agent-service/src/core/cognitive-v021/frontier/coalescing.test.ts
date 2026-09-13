import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { openNuclearDb } from "../../db.js";
import { admitCognitiveIngress } from "../ingress/http.js";
import { claimNextInboxEvent, consumeInboxEvent, consumeNextInboxEvent } from "../cycle/inbox-consumer.js";
import { appendInboxEvent, getCycle, getCurrentCycle, getInboxEvent } from "../cycle/inbox.js";
import { tickIdleOpportunity } from "../initiative/idle.js";
import { scheduleFutureTrigger, getFutureTrigger, fireDueTriggers } from "../initiative/future-triggers.js";
import { settleDurableAttempt } from "../retry/ledger.js";
import { listConversationEvidence } from "../evidence/conversation-log.js";
import {
  claimDueDeferredFrontier,
  getActiveDeferredFrontier,
  getDeferredFrontier,
  insertDeferredFrontierRecord,
  rescheduleDeferredFrontier,
} from "./ledger.js";
import { startFrontierCoordinator } from "./coordinator.js";
import { runLiveCognitiveTurn, createLiveCognitiveDispatcher } from "../dispatch/live.js";
import { admitTestCycle, makeSemanticSettlement } from "../test-support.js";
import type {
  CapabilityReality,
  IdentitySlice,
  KernelDeps,
  Observation,
} from "../types.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
const capabilityReality: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: false,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};

function createNuclearDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function createSidecarDb(): DatabaseSync {
  return openCognitiveSidecarDb(new DatabaseSync(":memory:"), {
    dataPlane: { kind: "isolated" },
  });
}

function mockDeps(nowRef: { nowMs: number }, completeChatImpl: any): KernelDeps {
  return {
    nowMs: () => nowRef.nowMs,
    attentionDb: openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } }),
    completeChat: vi.fn(completeChatImpl),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false },
      currentness: { requireObservationForLatest: false },
      receipt: { receiptsByEffectId: {} },
      capability: capabilityReality,
      operational: { sandboxAvailable: false },
      relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
  };
}

describe("Wave 1C: Deferred Reactive Frontier Coalescing & V021 Integration", () => {
  it("executes full Campaign 1 sequence: initial deferral A -> follower arrival B, C -> wake re-admission at T1 -> single dispatch", async () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const clock = { nowMs: 1_000_000 };

    let thoughtCallCount = 0;
    const completeChatMock = async (messages: any[]) => {
      thoughtCallCount += 1;
      if (thoughtCallCount === 1) {
        // Initial call for A: simulate attention_deadline with advisory scheduling hint T1
        const err = Object.assign(new Error("attention_deadline"), {
          code: "attention_deadline",
          nextEligibleAtMs: clock.nowMs + 35_000,
        });
        throw err;
      }
      // Second call at T1: simulate successful admission and response
      return {
        text: JSON.stringify(makeSemanticSettlement()),
        model: "mistral-small-2603",
        modelAlias: "mistral-small-2603",
        resolvedModelId: "mistral-small-2603",
      };
    };

    const deps = mockDeps(clock, completeChatMock);
    const projectorMock = {
      project: vi.fn(async () => undefined),
      projectSystem: vi.fn(async () => undefined),
    };

    // 1. Initial utterance A arrives
    const ingressA = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message A from owner" },
      { nowMs: clock.nowMs },
    );
    expect(ingressA.accepted).toBe(true);

    // 2. Dispatcher processes inbox event A
    const inboxA = getInboxEvent(sidecar, ingressA.inboxEventId);
    expect(inboxA).not.toBeNull();

    const tickResult = await consumeNextInboxEvent(sidecar, {
      workerId: "worker:test",
      handler: createLiveCognitiveDispatcher({ sidecar, nuclear, deps, projector: projectorMock }),
      nowMs: () => clock.nowMs,
    });

    expect(tickResult.outcome).toBe("consumed");

    // Verify inbox event A was settled with deferred_to_frontier
    const settledA = getInboxEvent(sidecar, ingressA.inboxEventId);
    expect(settledA?.status).toBe("consumed");
    expect(settledA?.terminalReason).toBe("deferred_to_frontier");

    // Verify cycle is in capacity_wait state
    const cycleA = getCycle(sidecar, ingressA.cycleId);
    expect(cycleA?.state).toBe("capacity_wait");

    // Verify frontier was created in waiting state
    const frontier = getActiveDeferredFrontier(sidecar, ingressA.conversationId);
    expect(frontier).not.toBeNull();
    expect(frontier?.state).toBe("waiting");
    expect(frontier?.nextEligibleAtMs).toBe(1_035_000);
    expect(frontier?.capacityDeadlineAtMs).toBe(1_120_000);
    expect(frontier?.latestEvidenceRowId).toBe(ingressA.evidenceRowId);

    // Verify NO infrastructure error notice was emitted to Discord
    expect(projectorMock.project).not.toHaveBeenCalled();
    expect(projectorMock.projectSystem).not.toHaveBeenCalled();

    // 3. Follower message B arrives at +5s
    clock.nowMs = 1_005_000;
    const ingressB = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message B from owner" },
      { nowMs: clock.nowMs },
    );
    expect(ingressB.accepted).toBe(true);

    // Verify B's inbox event was subsumed
    const settledB = getInboxEvent(sidecar, ingressB.inboxEventId);
    expect(settledB?.status).toBe("consumed");
    expect(settledB?.terminalReason).toBe("subsumed_by_frontier");

    // Verify frontier advanced with B's row id and nextEligibleAtMs is unchanged (zero re-metering!)
    const frontierAfterB = getActiveDeferredFrontier(sidecar, ingressA.conversationId);
    expect(frontierAfterB?.latestEvidenceRowId).toBe(ingressB.evidenceRowId);
    expect(frontierAfterB?.nextEligibleAtMs).toBe(1_035_000); // Unchanged!

    // 4. Follower message C arrives at +10s
    clock.nowMs = 1_010_000;
    const ingressC = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message C from owner" },
      { nowMs: clock.nowMs },
    );
    expect(ingressC.accepted).toBe(true);

    const frontierAfterC = getActiveDeferredFrontier(sidecar, ingressA.conversationId);
    expect(frontierAfterC?.latestEvidenceRowId).toBe(ingressC.evidenceRowId);
    expect(frontierAfterC?.nextEligibleAtMs).toBe(1_035_000); // Still unchanged!

    // 5. Check distinct evidence persistence
    const evidenceList = listConversationEvidence(sidecar, ingressA.conversationId, { limit: 10 });
    expect(evidenceList.map((e) => e.text)).toEqual([
      "Message A from owner",
      "Message B from owner",
      "Message C from owner",
    ]);

    // 6. Advance clock to T1 (1_035_000) and start frontier coordinator
    clock.nowMs = 1_035_000;
    const coordinator = startFrontierCoordinator(sidecar, nuclear, deps, {
      projector: projectorMock,
      nowMs: () => clock.nowMs,
      pollMs: 100,
    });

    // Run coordinator poll
    const processed = await coordinator.pollNow();
    expect(processed).toBe(1);
    coordinator.stop();

    // Verify Thought pass was called with the coalesced evidence
    expect(thoughtCallCount).toBe(2);

    // Verify speech outbox was published
    expect(projectorMock.project).toHaveBeenCalledTimes(1);

    // Verify frontier is now resolved
    const resolvedFrontier = getDeferredFrontier(sidecar, frontier!.frontierId);
    expect(resolvedFrontier?.state).toBe("resolved");

    // Verify active frontier no longer exists for conversation
    expect(getActiveDeferredFrontier(sidecar, ingressA.conversationId)).toBeNull();

    // Verify cycle is sending/completed
    const finalCycle = getCycle(sidecar, ingressA.cycleId);
    expect(["sending", "completed"]).toContain(finalCycle?.state);

    sidecar.close();
    nuclear.close();
  });

  it("handles re-deferral: stays waiting if blocked at T1 and now < 120s deadline", async () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const clock = { nowMs: 1_000_000 };

    let callCount = 0;
    const completeChatMock = async () => {
      callCount += 1;
      // Both call 1 and call 2 fail with attention_deadline
      const nextTime = callCount === 1 ? clock.nowMs + 30_000 : clock.nowMs + 25_000;
      const err = Object.assign(new Error("attention_deadline"), {
        code: "attention_deadline",
        nextEligibleAtMs: nextTime,
      });
      throw err;
    };

    const deps = mockDeps(clock, completeChatMock);
    const ingress = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Initial message" },
      { nowMs: clock.nowMs },
    );

    // First attempt at t=0s -> deferred to t=30s
    await consumeNextInboxEvent(sidecar, {
      workerId: "worker:test",
      handler: createLiveCognitiveDispatcher({ sidecar, nuclear, deps }),
      nowMs: () => clock.nowMs,
    });

    const f1 = getActiveDeferredFrontier(sidecar, ingress.conversationId);
    expect(f1?.nextEligibleAtMs).toBe(1_030_000);
    expect(f1?.state).toBe("waiting");

    // Advance clock to t=30s and poll coordinator -> re-deferred to t=55s
    clock.nowMs = 1_030_000;
    const coordinator = startFrontierCoordinator(sidecar, nuclear, deps, {
      nowMs: () => clock.nowMs,
    });
    await coordinator.pollNow();
    coordinator.stop();

    const f2 = getActiveDeferredFrontier(sidecar, ingress.conversationId);
    expect(f2?.state).toBe("waiting");
    expect(f2?.nextEligibleAtMs).toBe(1_055_000);
    expect(f2?.attemptCount).toBe(1);

    // Advance clock to t=55s and poll coordinator again
    clock.nowMs = 1_055_000;
    const coordinator2 = startFrontierCoordinator(sidecar, nuclear, deps, {
      nowMs: () => clock.nowMs,
    });
    await coordinator2.pollNow();
    coordinator2.stop();

    const f3 = getActiveDeferredFrontier(sidecar, ingress.conversationId);
    expect(f3?.state).toBe("waiting");
    expect(f3?.attemptCount).toBe(2);

    sidecar.close();
    nuclear.close();
  });

  it("enforces 120s absolute ceiling: exhausts frontier and emits terminal notice when exceeded", async () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const clock = { nowMs: 1_000_000 };

    const completeChatMock = async () => {
      const err = Object.assign(new Error("attention_deadline"), {
        code: "attention_deadline",
        nextEligibleAtMs: clock.nowMs + 30_000,
      });
      throw err;
    };

    const deps = mockDeps(clock, completeChatMock);
    const ingress = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message to exhaust" },
      { nowMs: clock.nowMs },
    );

    await consumeNextInboxEvent(sidecar, {
      workerId: "worker:test",
      handler: createLiveCognitiveDispatcher({ sidecar, nuclear, deps }),
      nowMs: () => clock.nowMs,
    });

    const frontier = getActiveDeferredFrontier(sidecar, ingress.conversationId);
    expect(frontier).not.toBeNull();
    // Frontier deadline is 1_000_000 + 120_000 = 1_120_000

    // Advance past 120s deadline to 1_121_000
    clock.nowMs = 1_121_000;
    const coordinator = startFrontierCoordinator(sidecar, nuclear, deps, {
      nowMs: () => clock.nowMs,
    });
    await coordinator.pollNow();
    coordinator.stop();

    // Verify frontier is now exhausted
    const check = getDeferredFrontier(sidecar, frontier!.frontierId);
    expect(check?.state).toBe("exhausted");
    expect(getActiveDeferredFrontier(sidecar, ingress.conversationId)).toBeNull();

    // Verify cycle is silent
    const cycle = getCycle(sidecar, ingress.cycleId);
    expect(cycle?.state).toBe("silent");

    sidecar.close();
    nuclear.close();
  });

  it("B4: allows more than 12 legitimate strictly-forward reschedules before 120s deadline without exhaustion", () => {
    const sidecar = createSidecarDb();
    let nowMs = 1_000_000;

    sidecar.prepare(
      `INSERT INTO deferred_reactive_frontiers
         (frontier_id, conversation_id, cycle_id, generation, state,
          next_eligible_at_ms, capacity_deadline_at_ms, latest_evidence_row_id,
          claim_token, lease_expires_at_ms, attempt_count, created_at_ms, updated_at_ms)
       VALUES ('f-multi', 'conv:1', 'c:1', 1, 'waiting', 1000500, 1120000, 'ev:1', NULL, NULL, 0, 1000000, 1000000)`,
    ).run();

    // Perform 15 legitimate strictly-forward claims and reschedules in small increments
    for (let i = 1; i <= 15; i++) {
      nowMs += 2_000;
      // Claim
      expect(claimDueDeferredFrontier(sidecar, "f-multi", `tok:${i}`, 5_000, nowMs).claimed).toBe(true);
      // Reschedule 1 second forward from nowMs
      const resched = rescheduleDeferredFrontier(sidecar, "f-multi", nowMs + 1_000, nowMs);
      expect(resched.outcome).toBe("rescheduled");
      expect(resched.frontier?.attemptCount).toBe(i);
      expect(resched.frontier?.state).toBe("waiting");
    }

    const check = getDeferredFrontier(sidecar, "f-multi");
    expect(check?.state).toBe("waiting");
    expect(check?.attemptCount).toBe(15);

    // Now attempt to reschedule past the 120s deadline (deadline is 1_120_000)
    nowMs = 1_121_000;
    expect(claimDueDeferredFrontier(sidecar, "f-multi", "tok:final", 5_000, nowMs).claimed).toBe(true);
    const exhausted = rescheduleDeferredFrontier(sidecar, "f-multi", nowMs + 5_000, nowMs);
    expect(exhausted.outcome).toBe("exhausted");
    expect(exhausted.reason).toBe("capacity_wait_max_duration_exceeded");
    sidecar.close();
  });

  it("B2: proves initial inbox -> frontier authority transfer atomicity and crash semantics", async () => {
    const sidecar = createSidecarDb();
    const nowMs = 1_000_000;

    // Set up an admitted cycle and an inbox event leased by a worker
    const inbox = appendInboxEvent(sidecar, {
      conversationId: "thread-b2",
      kind: "owner_utterance",
      payload: { evidenceRowId: "ev-b2" },
      createdAtMs: nowMs,
    });
    const cycle = getCycle(sidecar, (inbox.payload as any).cycleId)!;
    expect(cycle).toBeDefined();

    // Lease the inbox event for durable processing
    const leased = claimNextInboxEvent(sidecar, { workerId: "worker-b2", leaseMs: 30_000, nowMs });
    expect(leased).toBeDefined();
    expect(leased?.id).toBe(inbox.id);
    expect(leased?.durableAttemptId).toBeDefined();

    // 1. BEFORE commit: simulate failure during atomic handoff (e.g. invalid non-forward hint throws error)
    expect(() => {
      settleDurableAttempt(sidecar, {
        eventId: inbox.id,
        attemptId: leased!.durableAttemptId!,
        claimToken: leased!.claimToken!,
        result: {
          kind: "deferred_to_frontier",
          conversationId: cycle.conversationId,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          nextEligibleAtMs: nowMs - 1000, // Invalid: non-forward! Throws error!
          latestEvidenceRowId: "ev-b2",
        },
        nowMs: nowMs + 100,
      });
    }).toThrow();

    // Verify rollback: NO active frontier survives, original inbox event remains leased, cycle state unchanged
    expect(getActiveDeferredFrontier(sidecar, cycle.conversationId)).toBeNull();
    const recheckInbox = getInboxEvent(sidecar, inbox.id);
    expect(recheckInbox?.status).toBe("claimed");
    expect(recheckInbox?.claimToken).toBe(leased!.claimToken);

    // 2. AFTER commit: execute valid atomic handoff
    const settled = settleDurableAttempt(sidecar, {
      eventId: inbox.id,
      attemptId: leased!.durableAttemptId!,
      claimToken: leased!.claimToken!,
      result: {
        kind: "deferred_to_frontier",
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        nextEligibleAtMs: nowMs + 30_000, // Valid forward hint
        latestEvidenceRowId: "ev-b2",
      },
      nowMs: nowMs + 200,
    });
    expect(settled.kind).toBe("completed");

    // Verify post-commit state:
    // Active frontier exists with sole future work authority
    const activeFrontier = getActiveDeferredFrontier(sidecar, cycle.conversationId);
    expect(activeFrontier).toBeDefined();
    expect(activeFrontier?.state).toBe("waiting");
    expect(activeFrontier?.nextEligibleAtMs).toBe(nowMs + 30_000);

    // Original inbox event is terminal with deferred_to_frontier
    const finalInbox = getInboxEvent(sidecar, inbox.id);
    expect(finalInbox?.status).toBe("consumed");
    expect(finalInbox?.terminalReason).toBe("deferred_to_frontier");

    // Cycle record is in capacity_wait
    const finalCycle = getCycle(sidecar, cycle.cycleId);
    expect(finalCycle?.state).toBe("capacity_wait");

    // No ordinary inbox claim can independently run A
    const secondClaim = claimNextInboxEvent(sidecar, { workerId: "worker-b2", leaseMs: 30_000, nowMs: nowMs + 300 });
    expect(secondClaim).toBeNull();

    sidecar.close();
  });

  it("B3: proves follower subsumption transactionality under rollback and commit", () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const nowMs = 1_000_000;

    // 1. Establish conversation and active deferred frontier for A
    const ingressA = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message A" },
      { nowMs },
    );
    const conversationId = ingressA.conversationId;
    const cycleId = ingressA.cycleId;
    const generation = ingressA.generation;

    insertDeferredFrontierRecord(sidecar, {
      frontierId: "f-b3-trigger",
      conversationId,
      cycleId,
      generation,
      nextEligibleAtMs: nowMs + 30_000,
      latestEvidenceRowId: ingressA.evidenceRowId,
      nowMs,
    });

    // 2. Inject failure inside follower ingress transaction:
    // Fail when active frontier evidence is updated
    sidecar.exec(`
      CREATE TRIGGER fail_frontier_advance
      BEFORE UPDATE ON deferred_reactive_frontiers
      FOR EACH ROW
      WHEN NEW.frontier_id = 'f-b3-trigger' AND NEW.latest_evidence_row_id != '${ingressA.evidenceRowId}'
      BEGIN
        SELECT RAISE(FAIL, 'simulated_subsumption_failure');
      END;
    `);

    expect(() => {
      admitCognitiveIngress(
        sidecar,
        nuclear,
        {
          userId: "user:owner",
          message: "fail_test",
          finalFragmentReceivedAtMs: nowMs + 5_000,
        },
        { nowMs: nowMs + 5_000 },
      );
    }).toThrow("simulated_subsumption_failure");

    // Verify rollback:
    // - evidence B does not exist in conversation_evidence_log
    const rolledBackEvidence = sidecar.prepare("SELECT * FROM conversation_evidence_log WHERE text = 'fail_test'").all();
    expect(rolledBackEvidence).toHaveLength(0);
    // - frontier not advanced to fail_test
    const frontierAfterRollback = getActiveDeferredFrontier(sidecar, conversationId);
    expect(frontierAfterRollback?.latestEvidenceRowId).toBe(ingressA.evidenceRowId);
    // - cycle compose log not updated
    const cycleAfterRollback = getCycle(sidecar, cycleId);
    expect(cycleAfterRollback?.composeLogIds).not.toContain("fail_test");
    // - only original pending inbox event for A exists (no B inbox row exists)
    const pendingInbox = sidecar.prepare("SELECT * FROM inbox_events WHERE status = 'pending'").all();
    expect(pendingInbox).toHaveLength(1);
    const failInbox = sidecar.prepare("SELECT * FROM inbox_events WHERE conversation_id = ?").all(conversationId);
    expect(failInbox).toHaveLength(1);

    // Remove simulated failure trigger
    sidecar.exec("DROP TRIGGER fail_frontier_advance");

    // 3. Normal follower subsumption commit:
    const ingressB = admitCognitiveIngress(
      sidecar,
      nuclear,
      {
        userId: "user:owner",
        message: "Message B",
        discordMessageIds: ["msg-b-id"],
        finalFragmentReceivedAtMs: nowMs + 10_000,
      },
      { nowMs: nowMs + 10_000 },
    );
    expect(ingressB.accepted).toBe(true);

    // Verify successful commit facts:
    // - B has independent evidence identity
    expect(ingressB.evidenceRowId).toBeDefined();
    // - B has independent inbox/audit identity
    const inboxB = getInboxEvent(sidecar, ingressB.inboxEventId);
    expect(inboxB).toBeDefined();
    // - B is terminal subsumed_by_frontier (NOT pending/runnable)
    expect(inboxB?.status).toBe("consumed");
    expect(inboxB?.terminalReason).toBe("subsumed_by_frontier");
    // - B cannot be claimed by ordinary inbox worker
    const claimAttempt = claimNextInboxEvent(sidecar, { workerId: "worker-test", nowMs: nowMs + 10_000, leaseMs: 30_000 });
    expect(claimAttempt?.id).not.toBe(ingressB.inboxEventId);
    // - frontier advanced to B
    const frontierAfterB = getActiveDeferredFrontier(sidecar, conversationId);
    expect(frontierAfterB?.latestEvidenceRowId).toBe(ingressB.evidenceRowId);
    // - cycle compose log records B
    const cycleAfterB = getCycle(sidecar, cycleId);
    expect(cycleAfterB?.composeLogIds).toContain(ingressB.evidenceRowId);
    // - T1 remains unchanged
    expect(frontierAfterB?.nextEligibleAtMs).toBe(nowMs + 30_000);

    sidecar.close();
    nuclear.close();
  });

  it("non-forward scheduling hint guard: exhausts frontier if governor returns past or non-forward timestamp", () => {
    const sidecar = createSidecarDb();
    const nowMs = 1_000_000;

    sidecar.prepare(
      `INSERT INTO deferred_reactive_frontiers
         (frontier_id, conversation_id, cycle_id, generation, state,
          next_eligible_at_ms, capacity_deadline_at_ms, latest_evidence_row_id,
          claim_token, lease_expires_at_ms, attempt_count, created_at_ms, updated_at_ms)
       VALUES ('f-nonfwd', 'conv:1', 'c:1', 1, 'running', 1010000, 1120000, 'ev:1', 'tok', 1020000, 1, 1000000, 1000000)`,
    ).run();

    // Reschedule with non-forward hint (equal to nowMs)
    const resched = rescheduleDeferredFrontier(sidecar, "f-nonfwd", nowMs, nowMs);
    expect(resched.outcome).toBe("exhausted");
    expect(resched.reason).toBe("non_forward_scheduling_hint");

    const check = getDeferredFrontier(sidecar, "f-nonfwd");
    expect(check?.state).toBe("exhausted");
    sidecar.close();
  });

  it("B5: private/idle/subscription triggers cannot supersede active deferred frontier and preserve durable triggers", async () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const nowMs = 1_000_000;

    // 1. Establish conversation and active deferred frontier for Generation 10
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-b5-active",
      conversationId: "thread-b5",
      triggerKind: "owner_message",
      triggerRef: "ev-b5-1",
      occupantId: "doc",
      authorityEpoch: 1,
      generation: 10,
      nowMs,
    });

    const frontier = insertDeferredFrontierRecord(sidecar, {
      frontierId: "f-b5-waiting",
      conversationId: cycle.conversationId,
      cycleId: cycle.cycleId,
      generation: 10,
      nextEligibleAtMs: nowMs + 30_000,
      latestEvidenceRowId: "ev-b5-1",
      nowMs,
    });
    expect(frontier.state).toBe("waiting");

    // Seed active concern in mind_occupancy and concerns table
    sidecar.prepare(
      `INSERT INTO concerns
         (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
          assertion_key, status, snapshot_hash, updated_cycle)
       VALUES ('concern-b5', 'thread-b5', 'active topic', '[]', '{}', NULL, 'active', 'snap-b5', 'cycle-b5-active')`,
    ).run();
    sidecar.prepare(
      `INSERT INTO mind_occupancy
         (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
       VALUES ('thread-b5', 'concern-b5', 'active', 20, 'cycle-b5-active', 10)`,
    ).run();

    // Schedule a durable future trigger due at +10s
    scheduleFutureTrigger(sidecar, {
      triggerId: "trig-b5-durable",
      conversationId: "thread-b5",
      concernId: "concern-b5",
      snapshotHash: "snap-b5",
      dueAtMs: nowMs + 10_000,
      payload: {},
    });

    // 2. Invoke idle tick at +15s (when future trigger is due and idle opportunity exists)
    let idleThoughtCalled = false;
    const idleResult = await tickIdleOpportunity(sidecar, {
      conversationId: "thread-b5",
      nowMs: nowMs + 15_000,
      runThought: async () => {
        idleThoughtCalled = true;
        return { published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const };
      },
    });

    // Verify:
    // - Idle thought was NOT called (ephemeral opportunity skipped cleanly)
    expect(idleThoughtCalled).toBe(false);
    expect(idleResult.eligible).toBe(false);

    // - Current generation in cycle_records remains 10 (Generation 11 was NOT admitted!)
    const current = getCurrentCycle(sidecar, "thread-b5", { includeIdle: true });
    expect(current?.generation).toBe(10);
    expect(current?.cycleId).toBe("cycle-b5-active");

    // - Frontier remains active in waiting state
    const frontierCheck = getActiveDeferredFrontier(sidecar, "thread-b5");
    expect(frontierCheck?.state).toBe("waiting");
    expect(frontierCheck?.generation).toBe(10);

    // - Durable future trigger was NOT lost and remains scheduled
    const triggerCheck = getFutureTrigger(sidecar, "trig-b5-durable");
    expect(triggerCheck?.status).toBe("scheduled");

    sidecar.close();
    nuclear.close();
  });

  it("B5: frontier coordinator resumes normally and publishes at T1 without generation staleness", async () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const clock = { nowMs: 1_000_000 };

    // 1. Establish conversation and active deferred frontier
    const ingressA = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message A from owner" },
      { nowMs: clock.nowMs },
    );

    // Mark cycle in capacity_wait
    sidecar.prepare("UPDATE cycle_records SET state = 'capacity_wait' WHERE cycle_id = ?").run(ingressA.cycleId);

    const frontier = insertDeferredFrontierRecord(sidecar, {
      frontierId: "f-b5-resumes",
      conversationId: ingressA.conversationId,
      cycleId: ingressA.cycleId,
      generation: ingressA.generation,
      nextEligibleAtMs: clock.nowMs + 30_000,
      latestEvidenceRowId: ingressA.evidenceRowId,
      nowMs: clock.nowMs,
    });

    const projectorMock = {
      project: vi.fn(async () => undefined),
      projectSystem: vi.fn(async () => undefined),
    };

    // 2. Mock kernel dependencies where Thought publishes a response
    const deps = mockDeps(clock, async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "mistral-small-2603",
      modelAlias: "mistral-small-2603",
      resolvedModelId: "mistral-small-2603",
    }));

    // 3. Competing idle trigger attempted while waiting -> suppressed
    clock.nowMs = 1_015_000;
    await tickIdleOpportunity(sidecar, {
      conversationId: ingressA.conversationId,
      nowMs: clock.nowMs,
      runThought: async () => ({ published: true, outboxId: null, thoughtModelAttempts: 1 }),
    });
    expect(getCurrentCycle(sidecar, ingressA.conversationId, { includeIdle: true })?.generation).toBe(ingressA.generation);

    // 4. Advance clock to T1 (+30s)
    clock.nowMs = 1_030_000;
    const coordinator = startFrontierCoordinator(sidecar, nuclear, deps, {
      projector: projectorMock,
      workerId: "test-b5-worker",
      pollMs: 100,
      nowMs: () => clock.nowMs,
    });

    const processed = await coordinator.pollNow();
    expect(processed).toBe(1);

    // Verify frontier was resolved (not exhausted due to stale generation!)
    const resolvedFrontier = getDeferredFrontier(sidecar, frontier.frontierId);
    expect(resolvedFrontier?.state).toBe("resolved");

    // Verify outbox was published
    expect(projectorMock.project).toHaveBeenCalledTimes(1);
    const outbox = sidecar.prepare("SELECT * FROM speech_outbox WHERE conversation_id = ?").all(ingressA.conversationId);
    expect(outbox).toHaveLength(1);
    expect((outbox[0] as any).generation).toBe(ingressA.generation);

    coordinator.stop();
    sidecar.close();
    nuclear.close();
  });

  it("B7: duplicate follower replay while frontier is active preserves high-water mark and does not duplicate work", () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const nowMs = 1_000_000;

    // 1. Admit A (leader)
    const ingressA = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message A", discordMessageIds: ["msg-b7-a"] },
      { nowMs },
    );
    const conversationId = ingressA.conversationId;
    const cycleId = ingressA.cycleId;
    const generation = ingressA.generation;

    // Mark cycle in capacity_wait and create active deferred frontier
    sidecar.prepare("UPDATE cycle_records SET state = 'capacity_wait' WHERE cycle_id = ?").run(cycleId);
    insertDeferredFrontierRecord(sidecar, {
      frontierId: "f-b7-active",
      conversationId,
      cycleId,
      generation,
      nextEligibleAtMs: nowMs + 30_000,
      latestEvidenceRowId: ingressA.evidenceRowId,
      nowMs,
    });

    // 2. Admit B (follower)
    const ingressB = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message B", discordMessageIds: ["msg-b7-b"] },
      { nowMs: nowMs + 5_000 },
    );
    expect(ingressB.accepted).toBe(true);

    // 3. Admit C (follower)
    const ingressC = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message C", discordMessageIds: ["msg-b7-c"] },
      { nowMs: nowMs + 10_000 },
    );
    expect(ingressC.accepted).toBe(true);

    // Capture state before replay of B
    const frontierBefore = getActiveDeferredFrontier(sidecar, conversationId);
    expect(frontierBefore?.latestEvidenceRowId).toBe(ingressC.evidenceRowId);
    const cycleBefore = getCycle(sidecar, cycleId);
    const inboxCountBefore = (sidecar.prepare(
      "SELECT COUNT(*) AS count FROM inbox_events WHERE conversation_id = ? AND json_extract(payload_json, '$.evidenceRowId') = ?",
    ).get(conversationId, ingressB.evidenceRowId) as { count: number }).count;
    expect(inboxCountBefore).toBe(1);

    // 4. Replay exact duplicate Discord identity for B
    const replayB = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message B (redelivered)", discordMessageIds: ["msg-b7-b"] },
      { nowMs: nowMs + 15_000 },
    );

    // Verify duplicate resolution facts:
    expect(replayB.accepted).toBe(true);
    expect(replayB.duplicate).toBe(true);
    expect(replayB.evidenceRowId).toBe(ingressB.evidenceRowId);
    expect(replayB.inboxEventId).toBe(ingressB.inboxEventId);
    expect(replayB.cycleId).toBe(cycleId);
    expect(replayB.generation).toBe(generation);

    // Frontier high-water mark remains C (did NOT regress to B)
    const frontierAfter = getActiveDeferredFrontier(sidecar, conversationId);
    expect(frontierAfter?.latestEvidenceRowId).toBe(ingressC.evidenceRowId);

    // Compose log unchanged
    const cycleAfter = getCycle(sidecar, cycleId);
    expect(cycleAfter?.composeLogIds).toEqual(cycleBefore?.composeLogIds);
    expect(cycleAfter?.generation).toBe(generation);

    // Inbox count for B unchanged
    const inboxCountAfter = (sidecar.prepare(
      "SELECT COUNT(*) AS count FROM inbox_events WHERE conversation_id = ? AND json_extract(payload_json, '$.evidenceRowId') = ?",
    ).get(conversationId, ingressB.evidenceRowId) as { count: number }).count;
    expect(inboxCountAfter).toBe(1);

    sidecar.close();
    nuclear.close();
  });

  it("B7: duplicate follower replay after frontier resolution reuses durable disposition and does not create new cycle", async () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const clock = { nowMs: 1_000_000 };

    // 1. Admit A (leader)
    const ingressA = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message A", discordMessageIds: ["msg-b7-res-a"] },
      { nowMs: clock.nowMs },
    );
    const conversationId = ingressA.conversationId;
    const cycleId = ingressA.cycleId;

    sidecar.prepare("UPDATE cycle_records SET state = 'capacity_wait' WHERE cycle_id = ?").run(cycleId);
    const frontier = insertDeferredFrontierRecord(sidecar, {
      frontierId: "f-b7-res",
      conversationId,
      cycleId,
      generation: ingressA.generation,
      nextEligibleAtMs: clock.nowMs + 30_000,
      latestEvidenceRowId: ingressA.evidenceRowId,
      nowMs: clock.nowMs,
    });

    // 2. Admit B (follower)
    clock.nowMs = 1_005_000;
    const ingressB = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message B", discordMessageIds: ["msg-b7-res-b"] },
      { nowMs: clock.nowMs },
    );

    // 3. Resolve frontier at T1
    clock.nowMs = 1_030_000;
    const projectorMock = {
      project: vi.fn(async () => undefined),
      projectSystem: vi.fn(async () => undefined),
    };
    const deps = mockDeps(clock, async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "mistral-small-2603",
      modelAlias: "mistral-small-2603",
      resolvedModelId: "mistral-small-2603",
    }));
    const coordinator = startFrontierCoordinator(sidecar, nuclear, deps, {
      projector: projectorMock,
      nowMs: () => clock.nowMs,
      pollMs: 100,
    });
    const processed = await coordinator.pollNow();
    expect(processed).toBe(1);
    coordinator.stop();

    const resolved = getDeferredFrontier(sidecar, frontier.frontierId);
    expect(resolved?.state).toBe("resolved");

    const cyclesCountBefore = (sidecar.prepare("SELECT COUNT(*) AS count FROM cycle_records").get() as { count: number }).count;
    const pendingInboxBefore = (sidecar.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE status = 'pending'").get() as { count: number }).count;

    // 4. Later Discord redelivers B
    clock.nowMs = 1_060_000;
    const replayB = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message B redelivery", discordMessageIds: ["msg-b7-res-b"] },
      { nowMs: clock.nowMs },
    );

    // Expected:
    expect(replayB.duplicate).toBe(true);
    expect(replayB.evidenceRowId).toBe(ingressB.evidenceRowId);
    expect(replayB.inboxEventId).toBe(ingressB.inboxEventId);
    expect(replayB.cycleId).toBe(cycleId);
    expect(replayB.generation).toBe(ingressA.generation);

    // No new cycle created
    const cyclesCountAfter = (sidecar.prepare("SELECT COUNT(*) AS count FROM cycle_records").get() as { count: number }).count;
    expect(cyclesCountAfter).toBe(cyclesCountBefore);

    // No new pending inbox event
    const pendingInboxAfter = (sidecar.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE status = 'pending'").get() as { count: number }).count;
    expect(pendingInboxAfter).toBe(pendingInboxBefore);

    sidecar.close();
    nuclear.close();
  });

  it("B7: corrupt duplicate disposition fails closed without creating new cycle or pending work", () => {
    const sidecar = createSidecarDb();
    const nuclear = createNuclearDb();
    const nowMs = 1_000_000;

    const ingressA = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "user:owner", message: "Message A", discordMessageIds: ["msg-a-corrupt"] },
      { nowMs },
    );

    // Simulate corruption: delete the referenced cycle record
    sidecar.prepare("DELETE FROM cycle_records WHERE cycle_id = ?").run(ingressA.cycleId);

    // Attempt replay of A
    expect(() => {
      admitCognitiveIngress(
        sidecar,
        nuclear,
        { userId: "user:owner", message: "Message A replay", discordMessageIds: ["msg-a-corrupt"] },
        { nowMs: nowMs + 10_000 },
      );
    }).toThrow(/corrupt_duplicate_work_disposition/);

    // Verify no new cycle was manufactured
    const cycles = sidecar.prepare("SELECT * FROM cycle_records").all();
    expect(cycles).toHaveLength(0);

    sidecar.close();
    nuclear.close();
  });
});
