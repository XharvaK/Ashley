import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle, makeSemanticSettlement } from "../test-support.js";
import {
  admitCycle,
  appendInboxEvent,
  claimInboxEvent,
  getCurrentCycle,
  getCycle,
  getInboxEvent,
  isComposableWake,
  nextConversationGeneration,
  updateCycleState,
} from "../cycle/inbox.js";
import { composeOrPreemptInTransaction } from "../cycle/fence.js";
import {
  admitWakeInTransaction,
  getWake,
  reconcileWakeInTransaction,
} from "../wake/ledger.js";
import { occurrenceIdFor } from "../wake/identity.js";
import { resolveCanonicalOwnerPrincipal } from "../owner-principal.js";
import {
  claimNextDurableWork,
  createRepairEvent,
  settleDurableAttempt,
} from "../retry/ledger.js";
import { reconcileStrandedOutcomeUnknownAtStartup } from "../retry/startup-outcome-recovery.js";
import { enqueueWorkerUndertaking } from "../operation/worker-queue.js";
import { appendOwnerUtterance, getEvidenceByRowId } from "../evidence/conversation-log.js";
import { runCognitiveCycle } from "../thought/run.js";
import type { KernelDeps, WakeState } from "../types.js";
import { env } from "../../../env.js";
import { insertOutboxPending, registerCognitiveDeliveryDatabases } from "../speech/outbox.js";
import { recheckOwnerDmPublicationReservation, speechSupersessionReason } from "../settlement/publish.js";
import {
  claimPendingCognitiveDeliveries,
  reconcileUnfulfilledFailedSpeechReservations,
} from "../delivery/pending.js";

function mockKernelDeps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => 1_000,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null })),
    runPerception: vi.fn(async () => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false },
      currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} },
      capability: {
        vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
        canOfferProjectInspection: true, canOfferWorkspace: false, canOfferVerification: false,
        canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
        approvedProjectIds: ["project-ashley"],
      },
      operational: { sandboxAvailable: false },
      relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution: { constitutional: ["truth first"], stableSelf: ["curious"] },
    capabilityReality: {
      vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
      canOfferProjectInspection: true, canOfferWorkspace: false, canOfferVerification: false,
      canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
      approvedProjectIds: ["project-ashley"],
    },
    ...overrides,
  };
}

describe("2026-09-19 Owner Responsiveness Incident Regression Suite", () => {
  const TEST_OWNER_ID = "100000000000000001";
  let originalDiscordOwnerId = "";

  beforeEach(() => {
    originalDiscordOwnerId = env.discordOwnerId;
    env.discordOwnerId = TEST_OWNER_ID;
  });

  afterEach(() => {
    env.discordOwnerId = originalDiscordOwnerId;
  });

  describe("Invariant A: Worker Undertaking Admission Releases Occupancy Immediately", () => {
    it("A1: transitions originating Thought cycle to silent upon worker undertaking queue admission", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-inv-a";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-inv-a-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-inv-a-1",
          generation: 156,
          occupantId: TEST_OWNER_ID,
          nowMs: 1_000,
        });

        const event = appendInboxEvent(sidecar, {
          id: "event-inv-a-1",
          conversationId,
          kind: "owner_message",
          payload: {
            cycleId: cycle.cycleId,
            ownerId: TEST_OWNER_ID,
            channel: "discord",
            threadId: conversationId,
            text: "investigate the worker queue",
          },
          createdAtMs: 1_000,
        });

        const completeChat = vi.fn(async () => ({
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.inspect",
            request: { projectId: "project-ashley" },
            purpose: "investigate",
            evidenceNeed: "code",
            existingRefs: [],
          }),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        }));

        const result = await runCognitiveCycle(
          sidecar,
          nuclear,
          event,
          mockKernelDeps({
            completeChat,
            canOfferDirectProjectInspection: () => false,
            enqueueWorkerUndertaking: (req) => {
              const res = enqueueWorkerUndertaking(sidecar, req);
              if (res.ok) {
                return { queued: true, undertaking: res.undertaking, created: true, acknowledgementId: null, acknowledgementAuthored: false };
              }
              return { queued: false, reason: "queue_rejected" };
            },
          }),
        );

        expect(result.workerUndertakingId).toBeDefined();

        // INVARIANT A: originating cycle MUST be silent now, NOT left in thinking state!
        const cycleRecord = getCycle(sidecar, cycle.cycleId);
        expect(cycleRecord?.state).toBe("silent");

        // And getCurrentCycle for active cycles MUST return null
        const currentActive = getCurrentCycle(sidecar, conversationId, { includeIdle: false });
        expect(currentActive).toBeNull();
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Invariant B: Strictly Monotonic Generation Allocation Precludes Stale Preflight Collision", () => {
    it("B1: nextConversationGeneration returns strictly max(generation) + 1", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-inv-b";
        expect(nextConversationGeneration(sidecar, conversationId)).toBe(1);

        admitTestCycle(sidecar, {
          cycleId: "cycle-b1-156",
          conversationId,
          generation: 156,
          triggerKind: "owner_message",
          nowMs: 1_000,
        });
        expect(nextConversationGeneration(sidecar, conversationId)).toBe(157);

        admitTestCycle(sidecar, {
          cycleId: "cycle-b1-158",
          conversationId,
          generation: 158,
          triggerKind: "owner_message",
          nowMs: 2_000,
        });
        expect(nextConversationGeneration(sidecar, conversationId)).toBe(159);
      } finally {
        sidecar.close();
      }
    });

    it("B2: composeOrPreemptInTransaction allocates max(generation)+1 even when older non-silent cycle exists", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-inv-b-preempt";

        // Create older non-silent cycle (e.g. zombie 156 with terminal wake)
        const cycle156 = admitTestCycle(sidecar, {
          cycleId: "cycle-156",
          conversationId,
          generation: 156,
          triggerKind: "owner_message",
          nowMs: 1_000,
        });
        updateCycleState(sidecar, cycle156.cycleId, "thinking", 1_000);
        // Terminate its wake so hasValidDurableContinuationOwner returns false (isZombie = true)
        sidecar.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?").run(cycle156.wakeId);

        // Later generations 157 and 158 were already created and are now silent
        const cycle157 = admitTestCycle(sidecar, {
          cycleId: "cycle-157",
          conversationId,
          generation: 157,
          triggerKind: "idle_opportunity",
          nowMs: 2_000,
        });
        updateCycleState(sidecar, cycle157.cycleId, "silent", 2_000);

        const cycle158 = admitTestCycle(sidecar, {
          cycleId: "cycle-158",
          conversationId,
          generation: 158,
          triggerKind: "owner_message",
          nowMs: 3_000,
        });
        updateCycleState(sidecar, cycle158.cycleId, "silent", 3_000);

        // Now a fresh owner message arrives. composeOrPreemptInTransaction should preempt
        // the zombie 156 and allocate generation 159 (NOT 156 + 1 = 157 which already exists!)
        const result = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-fresh-159",
          occupantId: TEST_OWNER_ID,
          nowMs: 4_000,
        });

        expect(result.action).toBe("preempt");
        expect(result.generation).toBe(159);
        expect(result.generation).toBeGreaterThan(158);
      } finally {
        sidecar.close();
      }
    });
  });

  describe("Invariant C: Proven Canonical Owner Principal Across Autonomous Recovery and Continuity", () => {
    it("C1: resolveCanonicalOwnerPrincipal resolves across payload, occupant, trigger, and predecessor lineage", () => {
      const sidecar = openTestSidecar();
      try {
        // 1. Explicit payload ownerId
        expect(
          resolveCanonicalOwnerPrincipal(sidecar, { payload: { ownerId: TEST_OWNER_ID } }),
        ).toBe(TEST_OWNER_ID);

        // 2. Cycle occupant
        expect(
          resolveCanonicalOwnerPrincipal(sidecar, { cycle: { occupantId: TEST_OWNER_ID } }),
        ).toBe(TEST_OWNER_ID);

        // 3. Direct trigger evidence
        expect(
          resolveCanonicalOwnerPrincipal(sidecar, {
            triggerEvidence: {
              rowId: "ev-1",
              conversationId: "c1",
              speakerPrincipalId: TEST_OWNER_ID,
              role: "owner",
              timestampMs: 1_000,
              text: "hi",
            } as any,
          }),
        ).toBe(TEST_OWNER_ID);

        // 4. Predecessor event lineage
        const predEvent = appendInboxEvent(sidecar, {
          id: "event-pred-owner",
          conversationId: "thread-c1",
          kind: "owner_message",
          payload: { ownerId: TEST_OWNER_ID },
          createdAtMs: 1_000,
        });

        expect(
          resolveCanonicalOwnerPrincipal(sidecar, {
            predecessorEventId: predEvent.id,
          }),
        ).toBe(TEST_OWNER_ID);

        // 5. Strictly forbids UUID fallback when unproven
        expect(
          resolveCanonicalOwnerPrincipal(sidecar, {
            payload: { ownerId: "unauthorized-uuid-principal" },
            cycle: { conversationId: "unauthorized-uuid-principal" },
          }),
        ).toBeNull();
      } finally {
        sidecar.close();
      }
    });

    it("C2: createRepairEvent propagates proven ownerId to cycle occupant and payload", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-c2";
        const predecessorEvent = appendInboxEvent(sidecar, {
          id: "event-predecessor-c2",
          conversationId,
          kind: "owner_message",
          payload: { ownerId: TEST_OWNER_ID, text: "what is the status?" },
          createdAtMs: 1_000,
        });

        // Transition predecessor to reconciling so repair can be created
        sidecar.prepare("UPDATE inbox_events SET state = 'reconciling' WHERE id = ?").run(predecessorEvent.id);

        const repair = createRepairEvent(sidecar, {
          predecessorEventId: predecessorEvent.id,
          authorizationRef: "auth-ref-c2",
          nowMs: 2_000,
        });

        expect(repair).toBeDefined();

        // Check the created repair event payload
        const repEvent = getInboxEvent(sidecar, repair.eventId);
        expect(repEvent).toBeDefined();
        const payload = repEvent?.payload as Record<string, unknown>;
        expect(payload.ownerId).toBe(TEST_OWNER_ID);
        expect(payload.repairOfEventId).toBe(predecessorEvent.id);

        // Check the cycle occupant associated with the recovery wake
        const cycle = getCycle(sidecar, repair.cycleId);
        expect(cycle?.occupantId).toBe(TEST_OWNER_ID);
      } finally {
        sidecar.close();
      }
    });

    it("C3: repair turn with continuity recovery executes thought and delivers speech without unproven error", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-c3";
        const evLog = appendOwnerUtterance(sidecar, {
          conversationId,
          speakerPrincipalId: TEST_OWNER_ID,
          text: "do you see this?",
          nowMs: 1_000,
        });

        const predEvent = appendInboxEvent(sidecar, {
          id: "event-c3-failed",
          conversationId,
          kind: "owner_message",
          payload: { ownerId: TEST_OWNER_ID, evidenceRowId: evLog.rowId },
          createdAtMs: 1_000,
        });
        sidecar.prepare("UPDATE inbox_events SET state = 'reconciling' WHERE id = ?").run(predEvent.id);

        const repair = createRepairEvent(sidecar, {
          predecessorEventId: predEvent.id,
          authorizationRef: "auth-ref-c3",
          continuityRecovery: {
            primaryPredecessorEventId: predEvent.id,
            outstandingOwnerEvidenceRefs: [evLog.rowId],
            reason: "unanswered_owner_obligation_recovery",
          },
          nowMs: 2_000,
        });

        const repairEvent = getInboxEvent(sidecar, repair.eventId);
        expect(repairEvent).toBeDefined();

        const completeChat = vi.fn(async () => ({
          text: JSON.stringify(makeSemanticSettlement({
            speech: { mode: "draft", surfaceDraft: "I apologize for the delay. Yes, I see your message." },
          })),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        }));

        // The cognitive turn for the repair event must succeed and publish speech!
        const result = await runCognitiveCycle(
          sidecar,
          nuclear,
          repairEvent!,
          mockKernelDeps({ completeChat }),
        );

        expect(result.published).toBe(true);
        expect(result.outboxId).toBeDefined();
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("C-A: env.discordOwnerId absent + owner evidence speakerPrincipalId absent + conversationId UUID -> resolver returns null", () => {
      const sidecar = openTestSidecar();
      try {
        env.discordOwnerId = "";
        const result = resolveCanonicalOwnerPrincipal(sidecar, {
          cycle: { conversationId: "2d445d64-ca17-4fd7-91e3-9f3578062a16" },
          triggerEvidence: {
            role: "owner",
            speakerPrincipalId: null,
          } as any,
        });
        expect(result).toBeNull();
      } finally {
        sidecar.close();
      }
    });

    it("C-B: createRepairEvent with unprovable owner does NOT propagate fake ownerId or occupantId", () => {
      const sidecar = openTestSidecar();
      try {
        env.discordOwnerId = "";
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";
        const predEvent = appendInboxEvent(sidecar, {
          id: "event-c-b-unproven",
          conversationId,
          kind: "owner_message",
          payload: { text: "unproven owner message" },
          createdAtMs: 1_000,
        });
        sidecar.prepare("UPDATE inbox_events SET state = 'reconciling' WHERE id = ?").run(predEvent.id);

        const repair = createRepairEvent(sidecar, {
          predecessorEventId: predEvent.id,
          authorizationRef: "auth-ref-c-b",
          nowMs: 2_000,
        });

        const repEvent = getInboxEvent(sidecar, repair.eventId);
        expect(repEvent).toBeDefined();
        const payload = repEvent?.payload as Record<string, unknown>;
        expect(payload.ownerId).toBeUndefined();

        const cycle = getCycle(sidecar, repair.cycleId);
        expect(!cycle?.occupantId).toBe(true);
        const cycleRow = sidecar.prepare("SELECT occupant_id FROM cycle_records WHERE cycle_id = ?").get(repair.cycleId) as any;
        expect(cycleRow?.occupant_id).toBeNull();
      } finally {
        sidecar.close();
      }
    });

    it("C-C: deliveryIntentFor Owner-private speech with genuinely unprovable Owner fails closed with canonical_owner_principal_unproven", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      const orig = env.discordOwnerId;
      try {
        env.discordOwnerId = "";
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";
        const unprovenEvent = appendInboxEvent(sidecar, {
          id: "event-c-c-unproven",
          conversationId,
          kind: "owner_message",
          payload: { text: "who is speaking?" },
          createdAtMs: 1_000,
        });

        const completeChat = vi.fn(async () => ({
          text: JSON.stringify(makeSemanticSettlement({
            speech: { mode: "draft", surfaceDraft: "I cannot know who you are." },
          })),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        }));

        await expect(
          runCognitiveCycle(
            sidecar,
            nuclear,
            unprovenEvent,
            mockKernelDeps({ completeChat }),
          ),
        ).rejects.toThrow("canonical_owner_principal_unproven");
      } finally {
        env.discordOwnerId = orig;
        sidecar.close();
        nuclear.close();
      }
    });

    it("C-D: configured authorized env.discordOwnerId + mechanically Owner-role evidence resolves correctly", () => {
      const sidecar = openTestSidecar();
      try {
        env.discordOwnerId = TEST_OWNER_ID;
        const result = resolveCanonicalOwnerPrincipal(sidecar, {
          cycle: { conversationId: "2d445d64-ca17-4fd7-91e3-9f3578062a16" },
          triggerEvidence: {
            role: "owner",
            speakerPrincipalId: null,
          } as any,
        });
        expect(result).toBe(TEST_OWNER_ID);
      } finally {
        sidecar.close();
      }
    });

    it("C-Matrix-A: Host Config Root - configured authorized Owner + autonomous/non-Owner origin resolves canonical Owner", () => {
      const sidecar = openTestSidecar();
      try {
        env.discordOwnerId = TEST_OWNER_ID;
        // Autonomous cycle (idle_opportunity, no trigger evidence, no predecessor)
        const result = resolveCanonicalOwnerPrincipal(sidecar, {
          cycle: { conversationId: "thread-curiosity-autonomous" },
          payload: { triggerRef: "curiosity:idle" },
        });
        expect(result).toBe(TEST_OWNER_ID);
      } finally {
        sidecar.close();
      }
    });

    it("C-Matrix-B: Origin Separation - canonical Owner resolves while originKind remains ASHLEY_CURIOSITY", () => {
      const sidecar = openTestSidecar();
      try {
        env.discordOwnerId = TEST_OWNER_ID;
        const payload: Record<string, unknown> = {
          originKind: "ASHLEY_CURIOSITY",
          triggerRef: "curiosity:inspect",
        };
        const resolved = resolveCanonicalOwnerPrincipal(sidecar, {
          payload,
          cycle: { conversationId: "thread-curiosity-origin-sep", triggerKind: "idle_opportunity" },
        });
        expect(resolved).toBe(TEST_OWNER_ID);
        // Important safety law (Section 4): Configured Owner root establishes identity, NEVER origin
        expect(payload.originKind).toBe("ASHLEY_CURIOSITY");
      } finally {
        sidecar.close();
      }
    });

    it("C-Matrix-F: Forbidden Fallbacks - conversation UUID alone and literal 'owner' are rejected", () => {
      const sidecar = openTestSidecar();
      const orig = env.discordOwnerId;
      try {
        env.discordOwnerId = "";
        // 1. Conversation UUID alone
        const resUuid = resolveCanonicalOwnerPrincipal(sidecar, {
          cycle: { conversationId: "2d445d64-ca17-4fd7-91e3-9f3578062a16" },
        });
        expect(resUuid).toBeNull();

        // 2. Literal "owner" in payload
        const resLiteralPayload = resolveCanonicalOwnerPrincipal(sidecar, {
          payload: { ownerId: "owner" },
          cycle: { conversationId: "thread-1" },
        });
        expect(resLiteralPayload).toBeNull();

        // 3. Literal "owner" in cycle occupant
        const resLiteralOccupant = resolveCanonicalOwnerPrincipal(sidecar, {
          cycle: { occupantId: "owner", conversationId: "thread-1" },
        });
        expect(resLiteralOccupant).toBeNull();
      } finally {
        env.discordOwnerId = orig;
        sidecar.close();
      }
    });
  });

  describe("Invariant D: Non-Composable Wake States Force Fresh Cycle Preemption", () => {
    it("D1: isComposableWake accurately classifies the complete WakeState enum", () => {
      const completeStates: WakeState[] = [
        "pending",
        "claimed",
        "authorized",
        "consequence_pending",
        "reconciling",
        "terminal",
      ];
      const composableStates = completeStates.filter((st) => isComposableWake({ state: st } as any));
      const nonComposableStates = completeStates.filter((st) => !isComposableWake({ state: st } as any));

      expect(composableStates).toEqual(["pending", "claimed", "authorized"]);
      expect(nonComposableStates).toEqual(["consequence_pending", "reconciling", "terminal"]);

      expect(isComposableWake(null)).toBe(false);
      expect(isComposableWake(undefined)).toBe(false);
    });

    it("D-enum-claim: proves no wake state is composable that claimant cannot service", () => {
      const completeStates: WakeState[] = [
        "pending",
        "claimed",
        "authorized",
        "consequence_pending",
        "reconciling",
        "terminal",
      ];

      for (const st of completeStates) {
        const sidecar = openTestSidecar();
        try {
          const conversationId = `conv-${st}`;
          const wakeAdm = admitWakeInTransaction(sidecar, {
            occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef: `ref-${st}`, conversationId }),
            triggerRef: `ref-${st}`,
            sourceKind: "inbox",
            conversationId,
            capturedAuthorityRevision: 0,
            triggerKind: "owner_message",
            nowMs: 1_000,
          });
          const wakeId = wakeAdm.wake.wakeId;

          const event = appendInboxEvent(sidecar, {
            id: `event-${st}`,
            wakeId,
            conversationId,
            kind: "owner_message",
            payload: { ownerId: TEST_OWNER_ID, text: "test" },
            createdAtMs: 1_000,
          });

          // Set wake to the specific state
          const termReason = st === "terminal" ? "completed" : null;
          sidecar.prepare("UPDATE wakes SET state = ?, terminal_reason = ? WHERE wake_id = ?").run(st, termReason, wakeId);
          const wake = getWake(sidecar, wakeId)!;
          expect(wake.state).toBe(st);

          const composable = isComposableWake(wake);

          if (st === "pending") {
            expect(composable).toBe(true);
            const claimed = claimInboxEvent(sidecar, {
              workerId: "test-claimant",
              conversationId,
              eventId: event.id,
              nowMs: 1_000,
            });
            expect(claimed).not.toBeNull();
            expect(claimed?.id).toBe(event.id);
          } else if (st === "claimed" || st === "authorized") {
            // Active in-flight states: composable by fence while running;
            // once in-flight work settles, wake transitions to pending and sibling work is claimed
            expect(composable).toBe(true);
            sidecar.prepare("UPDATE wakes SET state = 'pending', lease_expires_at_ms = NULL WHERE wake_id = ?").run(wakeId);
            const claimedAfterActive = claimInboxEvent(sidecar, {
              workerId: "test-claimant",
              conversationId,
              eventId: event.id,
              nowMs: 2_000,
            });
            expect(claimedAfterActive).not.toBeNull();
            expect(claimedAfterActive?.id).toBe(event.id);
          } else {
            // Non-composable states (terminal, reconciling, consequence_pending):
            // Claimant can NEVER service work attached to these wakes without prior reconciliation
            expect(composable).toBe(false);
            const claimResult = claimInboxEvent(sidecar, {
              workerId: "test-claimant",
              conversationId,
              eventId: event.id,
              nowMs: 1_000,
            });
            expect(claimResult).toBeNull();
          }
        } finally {
          sidecar.close();
        }
      }
    });

    it("D2: composeOrPreemptInTransaction preempts and creates fresh composable wake when existing wake is reconciling", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-inv-d";

        // Admit initial wake and cycle
        const wakeAdm = admitWakeInTransaction(sidecar, {
          occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef: "ref-1", conversationId }),
          triggerRef: "ref-1",
          sourceKind: "inbox",
          conversationId,
          capturedAuthorityRevision: 0,
          triggerKind: "owner_message",
          nowMs: 1_000,
        });
        if (wakeAdm.kind !== "created" && wakeAdm.kind !== "existing") throw new Error("wake not admitted");

        const cycle = getCycle(sidecar, wakeAdm.wake.cycleId)!;
        updateCycleState(sidecar, cycle.cycleId, "thinking", 1_000);

        // Put wake into reconciling state (e.g. after a failure or crash)
        reconcileWakeInTransaction(sidecar, wakeAdm.wake.wakeId, 1_500);
        const reconcilingWake = getWake(sidecar, wakeAdm.wake.wakeId);
        expect(reconcilingWake?.state).toBe("reconciling");

        // Owner sends another message
        const result = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "ref-2",
          occupantId: TEST_OWNER_ID,
          nowMs: 2_000,
        });

        // INVARIANT D: MUST NOT compose into reconciling wake! Must preempt to a fresh cycle and wake!
        expect(result.action).toBe("preempt");
        expect(result.generation).toBe(2);
        expect(result.cycleId).not.toBe(cycle.cycleId);

        const newCycle = getCycle(sidecar, result.cycleId);
        expect(newCycle?.wakeId).not.toBe(wakeAdm.wake.wakeId);

        const newWake = getWake(sidecar, newCycle!.wakeId!);
        expect(newWake?.state).toBe("pending");
        expect(isComposableWake(newWake)).toBe(true);
      } finally {
        sidecar.close();
      }
    });

    it("D3: preempted event with fresh wake is immediately claimable by durable work scheduler", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-inv-d3";

        // Reconciling wake on predecessor
        const wakeAdm = admitWakeInTransaction(sidecar, {
          occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef: "ref-d3-1", conversationId }),
          triggerRef: "ref-d3-1",
          sourceKind: "inbox",
          conversationId,
          capturedAuthorityRevision: 0,
          triggerKind: "owner_message",
          nowMs: 1_000,
        });
        if (wakeAdm.kind !== "created" && wakeAdm.kind !== "existing") throw new Error("wake not admitted");

        const cycle = getCycle(sidecar, wakeAdm.wake.cycleId)!;
        updateCycleState(sidecar, cycle.cycleId, "thinking", 1_000);
        reconcileWakeInTransaction(sidecar, wakeAdm.wake.wakeId, 1_500);

        // Preempt with fresh owner message
        const result = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "ref-d3-2",
          occupantId: TEST_OWNER_ID,
          nowMs: 2_000,
        });

        const newCycle = getCycle(sidecar, result.cycleId);

        // Append durable inbox event attached to the new wake
        const freshEvent = appendInboxEvent(sidecar, {
          id: "event-fresh-d3",
          wakeId: newCycle?.wakeId ?? undefined,
          conversationId,
          kind: "owner_message",
          payload: { ownerId: TEST_OWNER_ID, text: "are you there?" },
          createdAtMs: 2_000,
        });

        // Durable scheduler must successfully claim the fresh event without wake_reconciliation_required!
        const claimed = claimNextDurableWork(sidecar, {
          workerId: "worker-1",
          conversationId,
          eventId: freshEvent.id,
          nowMs: 2_000,
        });

        expect(claimed).not.toBeNull();
        expect(claimed?.eventId).toBe(freshEvent.id);
        expect(claimed?.attemptId).toBeDefined();
      } finally {
        sidecar.close();
      }
    });
  });

  describe("End-to-End Incident Sequence Replication & Resolution", () => {
    it("E2E: replicates full 8-step incident sequence and proves complete responsiveness", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-incident-e2e";

        // Step 1: Cycle 156 defers to worker undertaking -> releases occupancy (becomes silent)
        const cycle156 = admitTestCycle(sidecar, {
          cycleId: "cycle-156",
          conversationId,
          generation: 156,
          triggerKind: "owner_message",
          occupantId: TEST_OWNER_ID,
          nowMs: 1_000,
        });
        const event156 = appendInboxEvent(sidecar, {
          id: "event-156",
          conversationId,
          kind: "owner_message",
          payload: { cycleId: cycle156.cycleId, ownerId: TEST_OWNER_ID, text: "inspect codebase" },
          createdAtMs: 1_000,
        });

        const chat156 = vi.fn(async () => ({
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.inspect",
            request: { projectId: "project-ashley" },
            purpose: "investigate",
            evidenceNeed: "code",
            existingRefs: [],
          }),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        }));

        await runCognitiveCycle(
          sidecar,
          nuclear,
          event156,
          mockKernelDeps({
            completeChat: chat156,
            canOfferDirectProjectInspection: () => false,
            enqueueWorkerUndertaking: (req) => {
              const res = enqueueWorkerUndertaking(sidecar, req);
              if (res.ok) return { queued: true, undertaking: res.undertaking, created: true, acknowledgementId: null, acknowledgementAuthored: false };
              return { queued: false, reason: "err" };
            },
          }),
        );
        expect(getCycle(sidecar, cycle156.cycleId)?.state).toBe("silent");

        // Step 2: Cycle 157 runs and settles silent
        const cycle157 = admitTestCycle(sidecar, {
          cycleId: "cycle-157",
          conversationId,
          generation: 157,
          triggerKind: "idle_opportunity",
          nowMs: 2_000,
        });
        updateCycleState(sidecar, cycle157.cycleId, "silent", 2_000);

        // Step 3: Cycle 158 delivers speech and settles silent
        const cycle158 = admitTestCycle(sidecar, {
          cycleId: "cycle-158",
          conversationId,
          generation: 158,
          triggerKind: "owner_message",
          occupantId: TEST_OWNER_ID,
          nowMs: 3_000,
        });
        updateCycleState(sidecar, cycle158.cycleId, "silent", 3_000);

        // Step 4: Fresh Owner message arrives ("what do you input to it?")
        // With Monotonic Generation Allocation (Invariant B), it allocates 159 (never colliding with 157/158)
        const fenceResult159 = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-159",
          occupantId: TEST_OWNER_ID,
          nowMs: 4_000,
        });
        expect(fenceResult159.generation).toBe(159);

        // Step 5: Suppose an infrastructure failure triggers autonomous recovery
        // Invariant C ensures repair event wake and payload have canonical owner proven
        const evLog159 = appendOwnerUtterance(sidecar, {
          conversationId,
          speakerPrincipalId: TEST_OWNER_ID,
          text: "what do you input to it?",
          nowMs: 4_000,
        });

        const failedEvent = appendInboxEvent(sidecar, {
          id: "event-failed-159",
          conversationId,
          kind: "owner_message",
          payload: { ownerId: TEST_OWNER_ID, evidenceRowId: evLog159.rowId, text: "what do you input to it?" },
          createdAtMs: 4_000,
        });
        sidecar.prepare("UPDATE inbox_events SET state = 'reconciling' WHERE id = ?").run(failedEvent.id);

        const repairEventRecord = createRepairEvent(sidecar, {
          predecessorEventId: failedEvent.id,
          authorizationRef: "auth-incident-recovery",
          continuityRecovery: {
            primaryPredecessorEventId: failedEvent.id,
            outstandingOwnerEvidenceRefs: [evLog159.rowId],
            reason: "unanswered_owner_obligation_recovery",
          },
          nowMs: 5_000,
        });

        const repairInboxEvent = getInboxEvent(sidecar, repairEventRecord.eventId)!;
        expect((repairInboxEvent.payload as any).ownerId).toBe(TEST_OWNER_ID);

        // Thought cycle runs for repair event and produces licensed speech successfully!
        const chatRepair = vi.fn(async () => ({
          text: JSON.stringify(makeSemanticSettlement({
            speech: { mode: "draft", surfaceDraft: "I provide the project specifications and constraints." },
          })),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        }));

        const turnResult = await runCognitiveCycle(
          sidecar,
          nuclear,
          repairInboxEvent,
          mockKernelDeps({ completeChat: chatRepair }),
        );
        expect(turnResult.published).toBe(true);

        // Step 6: While any wake is reconciling, next owner message ("why don't you answer?")
        // With Invariant D, fence pre-empts into a fresh composable wake
        const wakeAdm160 = admitWakeInTransaction(sidecar, {
          occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef: "ref-wake-160", conversationId }),
          triggerRef: "ref-wake-160",
          sourceKind: "inbox",
          conversationId,
          capturedAuthorityRevision: 0,
          triggerKind: "owner_message",
          nowMs: 6_000,
        });
        if (wakeAdm160.kind !== "created" && wakeAdm160.kind !== "existing") throw new Error("wake not admitted");
        const cycle160 = getCycle(sidecar, wakeAdm160.wake.cycleId)!;
        updateCycleState(sidecar, cycle160.cycleId, "thinking", 6_000);
        reconcileWakeInTransaction(sidecar, wakeAdm160.wake.wakeId, 6_100);

        const fenceResult161 = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-161",
          occupantId: TEST_OWNER_ID,
          nowMs: 7_000,
        });

        expect(fenceResult161.action).toBe("preempt");
        expect(fenceResult161.generation).toBeGreaterThan(160);

        // The fresh event on the preempted wake is immediately claimable and responsive
        const event161 = appendInboxEvent(sidecar, {
          id: "event-161",
          wakeId: fenceResult161.cycle.wakeId ?? undefined,
          conversationId,
          kind: "owner_message",
          payload: { ownerId: TEST_OWNER_ID, text: "why don't you answer?" },
          createdAtMs: 7_000,
        });

        const claimed161 = claimNextDurableWork(sidecar, {
          workerId: "worker-live",
          conversationId,
          eventId: event161.id,
          nowMs: 7_000,
        });
        expect(claimed161).not.toBeNull();
        expect(claimed161?.eventId).toBe(event161.id);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Pre-Existing Stranded Production Event Recovery (Mint State Replay)", () => {
    it("recovers already-stranded pending Owner event attached to reconciling wake without resend or duplication", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";

        // 1. Quarantined predecessor (d88dea13...)
        const evLog1 = appendOwnerUtterance(sidecar, {
          conversationId,
          speakerPrincipalId: TEST_OWNER_ID,
          text: "what do you input to it?",
          nowMs: 1_000,
        });
        const predEvent = appendInboxEvent(sidecar, {
          id: "d88dea13-a6cf-411e-901f-cc74f737dddd",
          conversationId,
          kind: "owner_utterance",
          payload: { ownerId: TEST_OWNER_ID, evidenceRowId: evLog1.rowId },
          createdAtMs: 1_000,
        });
        sidecar.prepare(`UPDATE inbox_events SET state = 'quarantined', status = 'failed_terminal',
          last_failure_class = 'transient_retryable', last_error = 'infrastructure_failure'
          WHERE id = ?`).run(predEvent.id);

        // 2. Recovery wake and cycle admitted for repair:00d4ad
        const wakeAdm = admitWakeInTransaction(sidecar, {
          occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef: "wake:2b68b9e8", conversationId }),
          triggerRef: "wake:2b68b9e8",
          sourceKind: "inbox",
          conversationId,
          capturedAuthorityRevision: 0,
          triggerKind: "recovery",
          nowMs: 2_000,
        });
        const wakeId = wakeAdm.wake.wakeId;
        const cycleId = wakeAdm.wake.cycleId;

        // Transition cycle to thinking and wake to reconciling
        updateCycleState(sidecar, cycleId, "thinking", 2_000);
        reconcileWakeInTransaction(sidecar, wakeId, 2_100);

        // Repair event (repair:00d4ad...) attached to wake in reconciling state
        const repairEvent = appendInboxEvent(sidecar, {
          id: "repair:00d4ad9a061f7cc835b5a11cae60b9093ad1f452c113267128ae4379cef34eb4",
          wakeId,
          conversationId,
          kind: "repair",
          payload: {
            referenceOnly: true,
            repairOfEventId: predEvent.id,
            authorizationRef: "unanswered_owner_recovery:v1",
            continuityRecovery: {
              repairEventId: "repair:00d4ad9a061f7cc835b5a11cae60b9093ad1f452c113267128ae4379cef34eb4",
              primaryPredecessorEventId: predEvent.id,
              outstandingOwnerEvidenceRefs: [evLog1.rowId],
              reason: "unanswered_owner_obligation_recovery",
            },
          },
          createdAtMs: 2_000,
        });
        sidecar.prepare(`UPDATE inbox_events SET state = 'reconciling', status = 'claimed',
          attempt_count = 1, last_failure_class = 'outcome_unknown_reconcile',
          last_error = 'canonical_owner_principal_unproven' WHERE id = ?`).run(repairEvent.id);

        sidecar.prepare(`INSERT INTO durable_work_repairs
          (repair_event_id, predecessor_event_id, authorization_ref, created_at_ms)
          VALUES (?, ?, 'unanswered_owner_recovery:v1', 2000)`).run(repairEvent.id, predEvent.id);

        for (let i = 1; i <= 5; i++) {
          sidecar.prepare(`INSERT INTO durable_work_attempts
            (attempt_id, event_id, wake_id, ordinal, worker_id, started_at_ms, finished_at_ms, dispatch_truth, failure_class, error_code)
            VALUES (?, ?, NULL, ?, 'agent-service:142256', ?, ?, 'provider_responded', 'transient_retryable', 'infrastructure_failure')`).run(
            `attempt:pred:${i}`, predEvent.id, i, 1000 + i * 100, 1000 + i * 100 + 50,
          );
        }

        sidecar.prepare(`INSERT INTO durable_work_attempts
          (attempt_id, event_id, wake_id, ordinal, worker_id, started_at_ms, finished_at_ms, dispatch_truth, failure_class, error_code)
          VALUES (?, ?, ?, 1, 'agent-service:142256', 2000, 2000, 'unknown', 'outcome_unknown_reconcile', 'canonical_owner_principal_unproven')`).run(
          "attempt:1c415023", repairEvent.id, wakeId,
        );

        // 3. Fresh Owner event (2bed7f0e... "are you there?") already durable and attached to the reconciling wake
        const evLog2 = appendOwnerUtterance(sidecar, {
          conversationId,
          speakerPrincipalId: TEST_OWNER_ID,
          text: "are you there?",
          nowMs: 3_000,
        });
        const strandedOwnerEvent = appendInboxEvent(sidecar, {
          id: "2bed7f0e-78f5-4c96-9523-d9f9830e50ed",
          wakeId,
          conversationId,
          kind: "owner_utterance",
          payload: { ownerId: TEST_OWNER_ID, evidenceRowId: evLog2.rowId, text: "are you there?" },
          createdAtMs: 3_000,
        });
        expect(strandedOwnerEvent.status).toBe("pending");
        expect(strandedOwnerEvent.attemptCount).toBe(0);

        // Append evidence refs to cycle compose log
        sidecar.prepare("UPDATE cycle_records SET compose_log_ids_json = ? WHERE cycle_id = ?").run(
          JSON.stringify([evLog1.rowId, evLog2.rowId]), cycleId,
        );

        // STEP 1: Simulate normal startup outcome recovery pass (first boot)
        const startupResult = reconcileStrandedOutcomeUnknownAtStartup(sidecar, { nowMs: 4_000 });
        expect(startupResult.recoveredToPending).toBe(1);
        expect(startupResult.recoveredEventIds).toContain(repairEvent.id);

        // Verify repair event and wake are both in pending state
        expect(getInboxEvent(sidecar, repairEvent.id)?.status).toBe("pending");
        expect(getWake(sidecar, wakeId)?.state).toBe("pending");

        // STEP 2: IDEMPOTENCY CHECK - running startup recovery a second time
        const secondStartup = reconcileStrandedOutcomeUnknownAtStartup(sidecar, { nowMs: 4_050 });
        expect(secondStartup.scanned).toBe(0);
        expect(secondStartup.recoveredToPending).toBe(0);
        expect(secondStartup.recoveredEventIds).toHaveLength(0);

        // STEP 3: Inbox consumer claims and services repair event first (oldest eligible)
        const claimedRepair = claimNextDurableWork(sidecar, {
          workerId: "worker-mint-boot",
          conversationId,
          nowMs: 4_100,
        });
        expect(claimedRepair).not.toBeNull();
        expect(claimedRepair?.eventId).toBe(repairEvent.id);

        const chatRepair = vi.fn(async () => ({
          text: JSON.stringify(makeSemanticSettlement({
            speech: { mode: "draft", surfaceDraft: "I provide project specifications and constraints." },
          })),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        }));

        const repairTurnResult = await runCognitiveCycle(
          sidecar,
          nuclear,
          getInboxEvent(sidecar, repairEvent.id)!,
          mockKernelDeps({ completeChat: chatRepair }),
        );
        expect(repairTurnResult.published).toBe(true);

        // Settle repair attempt
        settleDurableAttempt(sidecar, {
          eventId: repairEvent.id,
          attemptId: claimedRepair!.attemptId,
          claimToken: claimedRepair!.claimToken,
          result: { kind: "completed" },
          nowMs: 4_200,
        });
        expect(getInboxEvent(sidecar, repairEvent.id)?.status).toBe("consumed");

        // CRITICAL INVARIANT: Wake remains in 'pending' because strandedOwnerEvent is an unconsumed same-wake sibling!
        const wakeAfterRepair = getWake(sidecar, wakeId);
        expect(wakeAfterRepair?.state).toBe("pending");

        // STEP 4: Next inbox consumer tick claims the previously stranded Owner event!
        const claimedStranded = claimNextDurableWork(sidecar, {
          workerId: "worker-mint-boot",
          conversationId,
          nowMs: 4_300,
        });
        expect(claimedStranded).not.toBeNull();
        expect(claimedStranded?.eventId).toBe(strandedOwnerEvent.id);

        // Fresh Thought cycle executes for the stranded owner event and answers "are you there?"
        const chatStranded = vi.fn(async () => ({
          text: JSON.stringify(makeSemanticSettlement({
            speech: { mode: "draft", surfaceDraft: "Yes, I am here! I apologize for the delay." },
          })),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        }));

        const strandedTurnResult = await runCognitiveCycle(
          sidecar,
          nuclear,
          getInboxEvent(sidecar, strandedOwnerEvent.id)!,
          mockKernelDeps({ completeChat: chatStranded }),
        );
        expect(strandedTurnResult.published).toBe(true);

        // Settle stranded owner attempt
        settleDurableAttempt(sidecar, {
          eventId: strandedOwnerEvent.id,
          attemptId: claimedStranded!.attemptId,
          claimToken: claimedStranded!.claimToken,
          result: { kind: "completed" },
          nowMs: 4_400,
        });

        // STEP 5: Verification of required end state
        expect(getInboxEvent(sidecar, strandedOwnerEvent.id)?.status).toBe("consumed");
        // Wake now transitions to terminal as all continuations are completed
        expect(getWake(sidecar, wakeId)?.state).toBe("terminal");

        // Original Owner evidence remains durable
        const evRecord = getEvidenceByRowId(sidecar, evLog2.rowId);
        expect(evRecord).toBeDefined();
        expect(evRecord?.text).toBe("are you there?");

        // No duplicate events or wakes created
        const allEvents = sidecar.prepare("SELECT id FROM inbox_events WHERE conversation_id = ?").all(conversationId);
        expect(allEvents.map((r: any) => r.id)).toEqual([predEvent.id, repairEvent.id, strandedOwnerEvent.id]);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Invariant E: speech publication race and unfulfilled failed speech recovery", () => {
    function setupDeliveryDatabases() {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      registerCognitiveDeliveryDatabases(sidecar, nuclear);
      return { sidecar, nuclear };
    }

    it("positive: speech authority survives non-preempting cycle progression (detached operation completion)", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-gen-race";
        // Gen 159: Owner-responsive cycle authors speech
        const gen159Cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-159",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-ref-159",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-159",
          cycleId: gen159Cycle.cycleId,
          generation: gen159Cycle.generation,
          conversationId,
          licensedText: "I am responding to your question.",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        sidecar.prepare("UPDATE speech_outbox SET send_status = 'sending' WHERE outbox_id = ?").run(outbox.outboxId);
        const insertRes = nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'reserved', ?, ?, ?, ?, NULL)`,
        ).run(conversationId, outbox.licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
        const reservationId = Number(insertRes.lastInsertRowid);

        // Gen 160: Detached operation completion advances conversation generation silently
        admitTestCycle(sidecar, {
          cycleId: "cycle-160",
          conversationId,
          triggerKind: "observation_or_receipt",
          triggerRef: "operation:detached-operation:1234:completion",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        // Delivery pump rechecks reservation - must pass despite generation 159 -> 160 progression
        const recheckResult = recheckOwnerDmPublicationReservation(
          nuclear,
          reservationId,
          2_500,
          { cognitiveSidecar: sidecar },
        );
        expect(recheckResult).toEqual({ ok: true });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("negative: speech publication is blocked if a subsequent Owner message arrives (true preemption)", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-preempt";
        const gen1Cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-preempt-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-msg-1",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-preempt-1",
          cycleId: gen1Cycle.cycleId,
          generation: gen1Cycle.generation,
          conversationId,
          licensedText: "First response",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        sidecar.prepare("UPDATE speech_outbox SET send_status = 'sending' WHERE outbox_id = ?").run(outbox.outboxId);
        const insertRes = nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'reserved', ?, ?, ?, ?, NULL)`,
        ).run(conversationId, outbox.licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
        const reservationId = Number(insertRes.lastInsertRowid);

        // New Owner message arrives and admits Gen 2
        admitTestCycle(sidecar, {
          cycleId: "cycle-preempt-2",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-msg-2",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        const recheckResult = recheckOwnerDmPublicationReservation(
          nuclear,
          reservationId,
          2_500,
          { cognitiveSidecar: sidecar },
        );
        expect(recheckResult).toEqual({ ok: false, reason: "stale_generation" });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("idempotency: already sent speech or already sent bubbles refuse redelivery", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-idempotency";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-idem-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-idem",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-idem-1",
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Sent response",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        const insertRes = nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'aborted', ?, ?, ?, ?, NULL)`,
        ).run(conversationId, outbox.licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
        const reservationId = Number(insertRes.lastInsertRowid);

        // Case 1: Outbox already marked sent
        sidecar.prepare("UPDATE speech_outbox SET send_status = 'sent' WHERE outbox_id = ?").run(outbox.outboxId);
        const recovery1 = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(recovery1.recovered).toBe(0);

        // Case 2: Outbox in send_failure but delivery_bubbles has sent bubble
        sidecar.prepare("UPDATE speech_outbox SET send_status = 'send_failure' WHERE outbox_id = ?").run(outbox.outboxId);
        nuclear.prepare(
          `INSERT INTO delivery_bubbles
             (reservation_id, ordinal, text, discord_message_id, sent_at)
           VALUES (?, 0, 'Sent response', 'discord-msg-999', '1970-01-01T00:00:02.000Z')`,
        ).run(reservationId);

        const recovery2 = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(recovery2.recovered).toBe(0);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("failed-row recovery: unfulfilled failed speech row is recovered and claimed by delivery pump", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-failed-recovery";
        // Replicate live production incident state:
        // Gen 159 authored speech into outbox 114 with reservation 361
        const gen159Cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-159",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-ref-159",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-159",
          cycleId: gen159Cycle.cycleId,
          generation: gen159Cycle.generation,
          conversationId,
          licensedText: "I am answering your question 'why don't you answer?'",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        // Insert reservation 361
        const insertRes = nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json, error_category, finalization_reason)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'aborted', ?, ?, ?, ?, NULL, 'send_failure', 'send_failure')`,
        ).run(conversationId, outbox.licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
        const reservationId = Number(insertRes.lastInsertRowid);

        // Mark outbox row as send_failure (simulating the race rejection)
        sidecar.prepare(
          `UPDATE speech_outbox
              SET send_status = 'send_failure',
                  nuclear_finalization_reason = 'owner_dm_publication_blocked:stale_generation'
            WHERE outbox_id = ?`,
        ).run(outbox.outboxId);

        // Gen 160: Detached operation completed silently
        admitTestCycle(sidecar, {
          cycleId: "cycle-160",
          conversationId,
          triggerKind: "observation_or_receipt",
          triggerRef: "operation:detached-operation:25762c93:completion",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        // Step 1: Run unfulfilled failed speech recovery (runs on startup or in pump sweep)
        const recoveryResult = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(recoveryResult.recovered).toBe(1);

        // Verify sidecar outbox is restored to 'projected'
        const restoredOutbox = sidecar.prepare("SELECT send_status, nuclear_finalization_reason FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId) as any;
        expect(restoredOutbox.send_status).toBe("projected");
        expect(restoredOutbox.nuclear_finalization_reason).toBeNull();

        // Verify nuclear reservation is restored to 'reserved' with error cleared
        const restoredRes = nuclear.prepare("SELECT state, error_category, finalization_reason FROM delivery_reservations WHERE id = ?").get(reservationId) as any;
        expect(restoredRes.state).toBe("reserved");
        expect(restoredRes.error_category).toBeNull();
        expect(restoredRes.finalization_reason).toBeNull();

        // Step 2: Delivery pump claims pending delivery
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 3_000 });
        expect(claimed.length).toBe(1);
        expect(claimed[0].reservationId).toBe(reservationId);

        // Step 3: Recheck passes for the claimed reservation
        const recheckResult = recheckOwnerDmPublicationReservation(
          nuclear,
          reservationId,
          3_100,
          { cognitiveSidecar: sidecar },
        );
        expect(recheckResult).toEqual({ ok: true });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("5.A: terminal send failure must not hot-loop (bounded to 1 recovery attempt)", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-hot-loop-guard";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-hl-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "ref-hl",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-hl-1",
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Non-recoverable failure test",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json, error_category, finalization_reason)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'aborted', ?, ?, ?, ?, NULL, 'send_failure', 'send_failure')`,
        ).run(conversationId, outbox.licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);

        // Speech outbox delivery intent indicates recovery was already attempted once
        const intentWithRecovery = JSON.stringify({ ...outbox.deliveryIntent, recoveryAttempts: 1 });
        sidecar.prepare(
          "UPDATE speech_outbox SET send_status = 'send_failure', delivery_intent_json = ?, nuclear_finalization_reason = 'send_failure' WHERE outbox_id = ?",
        ).run(intentWithRecovery, outbox.outboxId);

        // Attempt recovery - must refuse because recovery_attempts >= 1
        const recovery = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(recovery.recovered).toBe(0);

        // Verify nuclear reservation remains aborted
        const checkRes = nuclear.prepare("SELECT state FROM delivery_reservations WHERE speech_outbox_id = ?").get(outbox.outboxId) as any;
        expect(checkRes.state).toBe("aborted");
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("5.B: half-applied recovery Crash Point A (sidecar projected, nuclear aborted) converges to reserved", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-crash-pt-a";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-cpa-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "ref-cpa",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-cpa-1",
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Crash Point A test response",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        // Insert reservation in aborted state
        const insertRes = nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json, error_category, finalization_reason)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'aborted', ?, ?, ?, ?, NULL, 'send_failure', 'send_failure')`,
        ).run(conversationId, outbox.licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
        const resId = Number(insertRes.lastInsertRowid);

        // Simulating Crash Point A: Sidecar outbox was already updated to 'projected' before crash
        sidecar.prepare(
          "UPDATE speech_outbox SET send_status = 'projected', nuclear_finalization_reason = NULL WHERE outbox_id = ?",
        ).run(outbox.outboxId);

        // Recovery runs on restart/poll: detects Crash Point A and brings nuclear forward to 'reserved'
        const recovery = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(recovery.recovered).toBe(1);

        const checkRes = nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(resId) as any;
        expect(checkRes.state).toBe("reserved");

        // Can now be claimed and delivered normally
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 2_000 });
        expect(claimed.length).toBe(1);
        expect(claimed[0].reservationId).toBe(resId);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("5.C: half-applied recovery Crash Point B (sidecar projected, nuclear reserved) claims and delivers once", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-crash-pt-b";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-cpb-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "ref-cpb",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-cpb-1",
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Crash Point B test response",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        // Insert reservation already in 'reserved' state (Crash Point B: both restored, crash before claim)
        const insertRes = nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'reserved', ?, ?, ?, ?, NULL)`,
        ).run(conversationId, outbox.licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
        const resId = Number(insertRes.lastInsertRowid);

        sidecar.prepare(
          "UPDATE speech_outbox SET send_status = 'projected', nuclear_finalization_reason = NULL WHERE outbox_id = ?",
        ).run(outbox.outboxId);

        // Normal claim proceeds cleanly
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 2_000 });
        expect(claimed.length).toBe(1);
        expect(claimed[0].reservationId).toBe(resId);

        // Recheck succeeds
        const recheck = recheckOwnerDmPublicationReservation(nuclear, resId, 2_100, { cognitiveSidecar: sidecar });
        expect(recheck).toEqual({ ok: true });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("5.D: older pending owner event does NOT falsely supersede speech", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-older-event";
        // Cycle 159 admitted at T = 5,000
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-oe-159",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "ref-oe-159",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 5_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-oe-159",
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Response to cycle 159",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        // An older inbox event exists with created_at_ms = 4,000 (before cycle 159 was admitted)
        sidecar.prepare(
          `INSERT INTO inbox_events
             (id, conversation_id, kind, status, payload_json, created_at_ms)
           VALUES ('evt-older', ?, 'owner_message', 'pending', '{}', 4_000)`,
        ).run(conversationId);

        // Supersession recheck must NOT consider the older inbox event as superseding
        const speechRow = sidecar.prepare("SELECT * FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId) as any;
        const speechObj = {
          ...speechRow,
          outboxId: speechRow.outbox_id,
          cycleId: speechRow.cycle_id,
          conversationId: speechRow.conversation_id,
          sendStatus: speechRow.send_status,
          suppressed: Boolean(speechRow.suppressed),
          origin: speechRow.origin,
        };
        const supersession = speechSupersessionReason(sidecar, speechObj);
        expect(supersession).toBeNull();
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("5.E: unrelated later speech in another conversation does NOT revoke earlier speech", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const convA = "thread-conv-a";
        const convB = "thread-conv-b";

        const cycleA = admitTestCycle(sidecar, {
          cycleId: "cycle-conv-a",
          conversationId: convA,
          triggerKind: "owner_message",
          triggerRef: "ref-a",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });

        const outboxA = insertOutboxPending(sidecar, {
          settlementId: "settlement-conv-a",
          cycleId: cycleA.cycleId,
          generation: cycleA.generation,
          conversationId: convA,
          licensedText: "Response in Conv A",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: convA,
            conversationId: convA,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        // Later cycle in conversation B authors speech
        const cycleB = admitTestCycle(sidecar, {
          cycleId: "cycle-conv-b",
          conversationId: convB,
          triggerKind: "owner_message",
          triggerRef: "ref-b",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        insertOutboxPending(sidecar, {
          settlementId: "settlement-conv-b",
          cycleId: cycleB.cycleId,
          generation: cycleB.generation,
          conversationId: convB,
          licensedText: "Response in Conv B",
          deliveryIntent: {
            ownerId: "doc",
            channel: "discord",
            threadId: convB,
            conversationId: convB,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
        });

        // Check speech A supersession - must NOT be superseded by speech in Conv B
        const speechRowA = sidecar.prepare("SELECT * FROM speech_outbox WHERE outbox_id = ?").get(outboxA.outboxId) as any;
        const speechObjA = {
          ...speechRowA,
          outboxId: speechRowA.outbox_id,
          cycleId: speechRowA.cycle_id,
          conversationId: speechRowA.conversation_id,
          sendStatus: speechRowA.send_status,
          suppressed: Boolean(speechRowA.suppressed),
          origin: speechRowA.origin,
        };
        const supersession = speechSupersessionReason(sidecar, speechObjA);
        expect(supersession).toBeNull();
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });
});
