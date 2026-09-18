import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle, makeSemanticSettlement } from "../test-support.js";
import { appendInboxEvent, getInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { produceOperationCompletion } from "../operation/completion.js";
import {
  admitDetachedOperation,
  markDetachedOperationStarted,
  setDetachedOperationTerminal,
} from "../operation/detached.js";
import { OutboxDeliveryProjector } from "../delivery/outbox-projector.js";
import {
  authorizeInterimSpeech,
  authorizeUndertakingAcknowledgement,
  recheckInterimPublicationReservation,
} from "../operation/interim.js";
import {
  enqueueWorkerUndertaking,
} from "../operation/worker-queue.js";
import {
  DETACHED_OPERATION_DEFAULT_DEADLINE_MS,
  DETACHED_WORKER_MAX_WALL_CLOCK_MS,
  WORKER_FINALIZATION_RESERVE_MS,
  OPENCODE_MODEL_TURN_MAX_MS,
  dispatchDetachedOperation,
} from "../operation/dispatch.js";
import {
  checkUnansweredOwnerEligibility,
  serviceUnansweredOwnerRecovery,
} from "../retry/owner-recovery.js";
import { startDurableAttempt } from "../retry/ledger.js";
import {
  executeModeBWorker,
  terminateProcessWithEscalation,
  spawnOpenCodeTransport,
} from "../../sandbox/opencode/worker-adapter.js";
import {
  claimPendingCognitiveDeliveries,
  listPendingCognitiveDeliveries,
  reconcileLegacyWrongPrincipalSpeechReservations,
  LEGACY_WRONG_PRINCIPAL_RECONCILE_LIMIT,
} from "../delivery/pending.js";
import {
  insertOutboxPending,
  registerCognitiveDeliveryDatabases,
} from "../speech/outbox.js";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  createQuotaRouter,
  resetOpenCodeProcessQuotaMemory,
} from "../../sandbox/opencode/quota-router.js";
import { C1_OPENCODE_FREE_CATALOG, MODE_B_INVESTIGATE } from "../../sandbox/opencode/catalog.js";
import { runCognitiveCycle } from "../thought/run.js";
import type { KernelDeps } from "../types.js";
import { env } from "../../../env.js";

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

describe("Natural Witness Repair — 2026-09-18 Incident Verifications", () => {
  beforeEach(() => {
    resetOpenCodeProcessQuotaMemory();
  });

  describe("Repair A: Completion Owner Principal", () => {
    it("A1: produceOperationCompletion resolves canonical ownerId from workerUndertaking", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-100";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-a1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-a1",
          occupantId: "owner-snowflake-999",
          nowMs: 1_000,
        });
        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-a1",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "OWNER_REQUEST",
          originRef: "event-a1",
          originOwnerEventId: "event-a1",
          workerUndertakingId: "undertaking-a1",
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "files",
          operationDeadlineAtMs: 3_600_000,
          nowMs: 1_000,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) throw new Error("admission failed");

        sidecar.prepare(
          `INSERT INTO worker_undertakings
             (undertaking_id, semantic_kind, origin_kind, origin_ref, origin_owner_event_id, owner_id,
              conversation_id, origin_cycle_id, origin_generation, request_json,
              purpose, evidence_need, admission_key, state, queued_at_ms, updated_at_ms)
           VALUES ('undertaking-a1', 'project.inspect', 'OWNER_REQUEST', 'event-a1', 'event-a1', 'owner-snowflake-999',
                   ?, ?, ?, '{}', 'investigate', 'files', 'key-a1', 'running', 1000, 1000)`,
        ).run(conversationId, cycle.cycleId, cycle.generation);

        markDetachedOperationStarted(sidecar, admitted.operation.operationId, { startProofRef: "start-a1", nowMs: 1_500 });
        setDetachedOperationTerminal(sidecar, admitted.operation.operationId, { terminalState: "succeeded", nowMs: 2_000 });
        const completion = produceOperationCompletion(sidecar, admitted.operation.operationId, { nowMs: 2_000 });
        expect(completion.ok).toBe(true);
        if (!completion.ok) return;
        const event = getInboxEvent(sidecar, completion.eventId);
        expect(event).toBeDefined();
        const payload = event!.payload as Record<string, unknown>;
        expect(payload.ownerId).toBe("owner-snowflake-999");
      } finally {
        sidecar.close();
      }
    });

    it("A2: produceOperationCompletion resolves canonical ownerId from originOwnerEventId", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-200";
        const originOwnerEvent = appendInboxEvent(sidecar, {
          id: "event-orig-owner",
          conversationId,
          kind: "owner_message",
          payload: { ownerId: "owner-snowflake-888" },
          createdAtMs: 500,
        });
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-a2",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: originOwnerEvent.id,
          nowMs: 1_000,
        });
        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-a2",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "OWNER_REQUEST",
          originRef: originOwnerEvent.id,
          originOwnerEventId: originOwnerEvent.id,
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "files",
          operationDeadlineAtMs: 3_600_000,
          nowMs: 1_000,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) throw new Error("admission failed");

        markDetachedOperationStarted(sidecar, admitted.operation.operationId, { startProofRef: "start-a2", nowMs: 1_500 });
        setDetachedOperationTerminal(sidecar, admitted.operation.operationId, { terminalState: "succeeded", nowMs: 2_000 });
        const completion = produceOperationCompletion(sidecar, admitted.operation.operationId, { nowMs: 2_000 });
        expect(completion.ok).toBe(true);
        if (!completion.ok) return;
        const event = getInboxEvent(sidecar, completion.eventId);
        const payload = event!.payload as Record<string, unknown>;
        expect(payload.ownerId).toBe("owner-snowflake-888");
      } finally {
        sidecar.close();
      }
    });

    it("A3: produceOperationCompletion resolves canonical ownerId from interim speech", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-300";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-a3",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-a3",
          nowMs: 1_000,
        });
        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-a3",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "OWNER_REQUEST",
          originRef: "event-a3",
          originOwnerEventId: "event-a3",
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "files",
          operationDeadlineAtMs: 3_600_000,
          nowMs: 1_000,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) throw new Error("admission failed");

        authorizeInterimSpeech(sidecar, {
          operationId: admitted.operation.operationId,
          surfaceDraft: "Hold on please",
          deliveryIntent: {
            ownerId: "owner-snowflake-777",
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "owner_message_reactive",
            deliveryLane: "reactive",
            purpose: "licensed_speech",
          },
          nowMs: 1_200,
        });

        markDetachedOperationStarted(sidecar, admitted.operation.operationId, { startProofRef: "start-a3", nowMs: 1_500 });
        setDetachedOperationTerminal(sidecar, admitted.operation.operationId, { terminalState: "succeeded", nowMs: 2_000 });
        const completion = produceOperationCompletion(sidecar, admitted.operation.operationId, { nowMs: 2_000 });
        expect(completion.ok).toBe(true);
        if (!completion.ok) return;
        const event = getInboxEvent(sidecar, completion.eventId);
        const payload = event!.payload as Record<string, unknown>;
        expect(payload.ownerId).toBe("owner-snowflake-777");
      } finally {
        sidecar.close();
      }
    });

    it("A4: produceOperationCompletion omits ownerId when originKind !== OWNER_REQUEST", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-400";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-a4",
          conversationId,
          triggerKind: "idle_opportunity",
          triggerRef: "curiosity-a4",
          nowMs: 1_000,
        });
        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-a4",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "ASHLEY_CURIOSITY",
          originRef: "curiosity-a4",
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "curiosity inspect",
          evidenceNeed: "files",
          operationDeadlineAtMs: 3_600_000,
          nowMs: 1_000,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) throw new Error("admission failed");

        markDetachedOperationStarted(sidecar, admitted.operation.operationId, { startProofRef: "start-a4", nowMs: 1_500 });
        setDetachedOperationTerminal(sidecar, admitted.operation.operationId, { terminalState: "succeeded", nowMs: 2_000 });
        const completion = produceOperationCompletion(sidecar, admitted.operation.operationId, { nowMs: 2_000 });
        expect(completion.ok).toBe(true);
        if (!completion.ok) return;
        const event = getInboxEvent(sidecar, completion.eventId);
        const payload = event!.payload as Record<string, unknown>;
        expect(payload.ownerId).toBeUndefined();
      } finally {
        sidecar.close();
      }
    });

    it("A5: deliveryIntentFor fails closed with canonical_owner_principal_unproven when unproven threadId is supplied with configured ownerId", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      const originalDiscordOwnerId = env.discordOwnerId;
      env.discordOwnerId = "authorized-owner-snowflake-123";
      try {
        const threadId = "thread-unproven-conversation-id";
        const completionEvent = appendInboxEvent(sidecar, {
          id: "event-completion-unproven",
          conversationId: threadId,
          kind: "observation_or_receipt",
          payload: { detachedOperationId: "op-unproven" },
          createdAtMs: 1_000,
        });
        const completeChat = vi.fn(async () => ({
          text: JSON.stringify(makeSemanticSettlement({
            speech: { mode: "draft", surfaceDraft: "investigation report" },
          })),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        }));
        await expect(
          runCognitiveCycle(sidecar, nuclear, completionEvent, mockKernelDeps({ completeChat })),
        ).rejects.toThrow("canonical_owner_principal_unproven");
      } finally {
        env.discordOwnerId = originalDiscordOwnerId;
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Repair B: Undertaking ACK Currentness", () => {
    it("B1: recheckInterimPublicationReservation passes when generation advances but undertaking is active", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-b1";
        const cycleGen1 = admitTestCycle(sidecar, {
          cycleId: "cycle-b1-g1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-b1",
          generation: 150,
          nowMs: 1_000,
        });

        const queued = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "event-b1", ownerEventId: "event-b1" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycleGen1.cycleId,
          originGeneration: cycleGen1.generation,
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_000,
        });
        expect(queued.ok).toBe(true);
        if (!queued.ok) return;

        const interim = authorizeUndertakingAcknowledgement(sidecar, {
          undertakingId: queued.undertaking.undertakingId,
          conversationId,
          cycleId: cycleGen1.cycleId,
          generation: 150,
          surfaceDraft: "Working on it...",
          deliveryIntent: {
            ownerId: "doc", channel: "discord", threadId: conversationId,
            conversationId, trigger: "owner_message_reactive", deliveryLane: "reactive", purpose: "licensed_speech",
          },
          nowMs: 1_100,
        });
        expect(interim.ok).toBe(true);
        if (!interim.ok) return;

        const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_100 });
        await projector.projectInterim(interim.interim.interimId);
        const reservation = nuclear.prepare(
          "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
        ).get(`interim:${interim.interim.interimId}`) as { id: number };

        // Simulate cycle generation advancement to 151 (e.g. from detached worker completion wake)
        admitTestCycle(sidecar, {
          cycleId: "cycle-b1-g2",
          conversationId,
          triggerKind: "observation_or_receipt",
          triggerRef: "completion-b1",
          generation: 151,
          nowMs: 2_000,
        });

        // Recheck reservation: must succeed despite generation 150 !== 151 because undertaking is still active
        const recheck = recheckInterimPublicationReservation(nuclear, Number(reservation.id), 2_000, { cognitiveSidecar: sidecar });
        expect(recheck.ok).toBe(true);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("B2: recheckInterimPublicationReservation fails when undertaking transitions to terminal state", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-b2";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-b2",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-b2",
          generation: 1,
          nowMs: 1_000,
        });

        const queued = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "event-b2", ownerEventId: "event-b2" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_000,
        });
        expect(queued.ok).toBe(true);
        if (!queued.ok) return;

        const interim = authorizeUndertakingAcknowledgement(sidecar, {
          undertakingId: queued.undertaking.undertakingId,
          conversationId,
          cycleId: cycle.cycleId,
          generation: 1,
          surfaceDraft: "Working on it...",
          deliveryIntent: {
            ownerId: "doc", channel: "discord", threadId: conversationId,
            conversationId, trigger: "owner_message_reactive", deliveryLane: "reactive", purpose: "licensed_speech",
          },
          nowMs: 1_100,
        });
        expect(interim.ok).toBe(true);
        if (!interim.ok) return;

        const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_100 });
        await projector.projectInterim(interim.interim.interimId);
        const reservation = nuclear.prepare(
          "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
        ).get(`interim:${interim.interim.interimId}`) as { id: number };

        // Terminalize undertaking
        sidecar.prepare("UPDATE worker_undertakings SET state = 'succeeded', terminal_at_ms = 2000 WHERE undertaking_id = ?")
          .run(queued.undertaking.undertakingId);

        const recheck = recheckInterimPublicationReservation(nuclear, Number(reservation.id), 2_000, { cognitiveSidecar: sidecar });
        expect(recheck.ok).toBe(false);
        if (!recheck.ok) {
          expect(recheck.reason).toBe("undertaking_terminal");
        }
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("B3: recheckInterimPublicationReservation fails when undertaking cancel was requested", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-b3";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-b3",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-b3",
          generation: 1,
          nowMs: 1_000,
        });

        const queued = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "event-b3", ownerEventId: "event-b3" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_000,
        });
        expect(queued.ok).toBe(true);
        if (!queued.ok) return;

        const interim = authorizeUndertakingAcknowledgement(sidecar, {
          undertakingId: queued.undertaking.undertakingId,
          conversationId,
          cycleId: cycle.cycleId,
          generation: 1,
          surfaceDraft: "Working on it...",
          deliveryIntent: {
            ownerId: "doc", channel: "discord", threadId: conversationId,
            conversationId, trigger: "owner_message_reactive", deliveryLane: "reactive", purpose: "licensed_speech",
          },
          nowMs: 1_100,
        });
        expect(interim.ok).toBe(true);
        if (!interim.ok) return;

        const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_100 });
        await projector.projectInterim(interim.interim.interimId);
        const reservation = nuclear.prepare(
          "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
        ).get(`interim:${interim.interim.interimId}`) as { id: number };

        sidecar.prepare("UPDATE worker_undertakings SET cancel_requested_at_ms = 2000 WHERE undertaking_id = ?")
          .run(queued.undertaking.undertakingId);

        const recheck = recheckInterimPublicationReservation(nuclear, Number(reservation.id), 2_000, { cognitiveSidecar: sidecar });
        expect(recheck.ok).toBe(false);
        if (!recheck.ok) {
          expect(recheck.reason).toBe("undertaking_cancelled");
        }
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("B4: recheckInterimPublicationReservation fails when undertaking curiosity expired", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-b4";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-b4",
          conversationId,
          triggerKind: "idle_opportunity",
          triggerRef: "event-b4",
          generation: 1,
          nowMs: 1_000,
        });

        const queued = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "ASHLEY_CURIOSITY", ref: "event-b4" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_000,
        });
        expect(queued.ok).toBe(true);
        if (!queued.ok) return;

        const interim = authorizeUndertakingAcknowledgement(sidecar, {
          undertakingId: queued.undertaking.undertakingId,
          conversationId,
          cycleId: cycle.cycleId,
          generation: 1,
          surfaceDraft: "Checking things out...",
          deliveryIntent: {
            ownerId: "doc", channel: "discord", threadId: conversationId,
            conversationId, trigger: "idle", deliveryLane: "proactive", purpose: "licensed_speech",
          },
          nowMs: 1_100,
        });
        expect(interim.ok).toBe(true);
        if (!interim.ok) return;

        const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_100 });
        await projector.projectInterim(interim.interim.interimId);
        const reservation = nuclear.prepare(
          "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
        ).get(`interim:${interim.interim.interimId}`) as { id: number };

        sidecar.prepare("UPDATE worker_undertakings SET curiosity_expires_at_ms = 1500 WHERE undertaking_id = ?")
          .run(queued.undertaking.undertakingId);

        const recheck = recheckInterimPublicationReservation(nuclear, Number(reservation.id), 2_000, { cognitiveSidecar: sidecar });
        expect(recheck.ok).toBe(false);
        if (!recheck.ok) {
          expect(recheck.reason).toBe("undertaking_expired");
        }
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("B5: recheckInterimPublicationReservation falls back to cycle fence when undertakingId is absent", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-b5";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-b5",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-b5",
          generation: 1,
          nowMs: 1_000,
        });

        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-b5",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "OWNER_REQUEST",
          originRef: "event-b5",
          originOwnerEventId: "event-b5",
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          operationDeadlineAtMs: 3_600_000,
          nowMs: 1_000,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) throw new Error("admission failed");

        const interim = authorizeInterimSpeech(sidecar, {
          operationId: admitted.operation.operationId,
          surfaceDraft: "Immediate ack",
          deliveryIntent: {
            ownerId: "doc", channel: "discord", threadId: conversationId,
            conversationId, trigger: "owner_message_reactive", deliveryLane: "reactive", purpose: "licensed_speech",
          },
          origin: "live",
          nowMs: 1_100,
        });
        expect(interim.ok).toBe(true);
        if (!interim.ok) return;

        const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_100 });
        await projector.projectInterim(interim.interim.interimId);
        const reservation = nuclear.prepare(
          "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
        ).get(`interim:${interim.interim.interimId}`) as { id: number };

        // Same cycle: ok
        expect(recheckInterimPublicationReservation(nuclear, Number(reservation.id), 1_100, { cognitiveSidecar: sidecar }).ok).toBe(true);

        // Advance cycle generation without undertaking
        admitTestCycle(sidecar, {
          cycleId: "cycle-b5-g2",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-b5-2",
          generation: 2,
          nowMs: 2_000,
        });
        const recheck = recheckInterimPublicationReservation(nuclear, Number(reservation.id), 2_000, { cognitiveSidecar: sidecar });
        expect(recheck.ok).toBe(false);
        if (!recheck.ok) {
          expect(recheck.reason).toBe("stale_generation");
        }
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Repair C: R1 Recovery Preserves Owner Origin", () => {
    it("C1: R1 continuity recovery routes inspection undertaking with OWNER_REQUEST origin", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-c1";
        const predEvidence = appendOwnerUtterance(sidecar, {
          conversationId,
          text: "inspect the error please",
          discordMessageIds: ["d-c1"],
          nowMs: 100,
        });
        const predecessorEvent = appendInboxEvent(sidecar, {
          id: "event-pred-c1",
          conversationId,
          kind: "owner_message",
          payload: { evidenceRowId: predEvidence.rowId, ownerId: "doc" },
          createdAtMs: 100,
        });

        // Fail predecessor to quarantined
        startDurableAttempt(sidecar, { eventId: predecessorEvent.id, workerId: "w-c1", nowMs: 150 });
        sidecar.prepare("UPDATE inbox_events SET state = 'quarantined', status = 'failed_terminal' WHERE id = ?")
          .run(predecessorEvent.id);

        // Service unanswered owner recovery creates repair event
        const serviced = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 200 });
        expect(serviced.createdRepairs).toHaveLength(1);
        const repairEvent = getInboxEvent(sidecar, serviced.createdRepairs[0]!.repair.eventId)!;

        let capturedOriginKind: string | null = null;
        let capturedOriginRef: string | null = null;
        let capturedOriginOwnerEventId: string | null = null;
        const enqueueWorkerUndertakingMock = (input: any) => {
          capturedOriginKind = input.origin.kind;
          capturedOriginRef = input.origin.ref;
          capturedOriginOwnerEventId = input.origin.ownerEventId;
          return {
            queued: true as const,
            undertaking: {} as any,
            created: true,
            acknowledgementId: null,
            acknowledgementAuthored: false,
          };
        };

        const completeChat = vi.fn(async () => ({
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.inspect",
            request: { projectId: "project-ashley", focus: "error" },
            purpose: "investigate error",
            evidenceNeed: "code",
            existingRefs: [],
          }),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        }));

        await runCognitiveCycle(
          sidecar,
          nuclear,
          repairEvent,
          mockKernelDeps({
            completeChat,
            enqueueWorkerUndertaking: enqueueWorkerUndertakingMock as any,
          }),
        );

        // Assert that R1 recovery mapped to OWNER_REQUEST, not ASHLEY_CURIOSITY
        expect(capturedOriginKind).toBe("OWNER_REQUEST");
        expect(capturedOriginRef).toBe(predecessorEvent.id);
        expect(capturedOriginOwnerEventId).toBe(predecessorEvent.id);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("C2: enqueueWorkerUndertaking deduplicates against active undertaking with matching origin_ref", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-c2";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-c2",
          conversationId,
          triggerKind: "recovery",
          triggerRef: "repair-c2",
          nowMs: 1_000,
        });

        const first = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "predecessor-event-123", ownerEventId: "predecessor-event-123" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_000,
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.created).toBe(true);

        const second = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "predecessor-event-123", ownerEventId: "predecessor-event-123" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_100,
        });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.created).toBe(false);
        expect(second.undertaking.undertakingId).toBe(first.undertaking.undertakingId);
      } finally {
        sidecar.close();
      }
    });

    it("C2-b: enqueueWorkerUndertaking admits distinct work from same predecessor when request differs", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-c2-b";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-c2-b",
          conversationId,
          triggerKind: "recovery",
          triggerRef: "repair-c2-b",
          nowMs: 1_000,
        });

        const first = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "pred-event-456", ownerEventId: "pred-event-456" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley", focus: "focus-A" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_000,
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.created).toBe(true);

        const second = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "pred-event-456", ownerEventId: "pred-event-456" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley", focus: "focus-B" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_100,
        });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.created).toBe(true);
        expect(second.undertaking.undertakingId).not.toBe(first.undertaking.undertakingId);
      } finally {
        sidecar.close();
      }
    });

    it("C2-c: enqueueWorkerUndertaking admits distinct work from same predecessor when purpose or evidenceNeed differs", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-c2-c";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-c2-c",
          conversationId,
          triggerKind: "recovery",
          triggerRef: "repair-c2-c",
          nowMs: 1_000,
        });

        const first = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "pred-event-789", ownerEventId: "pred-event-789" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley" },
          purpose: "purpose A",
          evidenceNeed: "code",
          nowMs: 1_000,
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.created).toBe(true);

        const second = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "pred-event-789", ownerEventId: "pred-event-789" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley" },
          purpose: "purpose B",
          evidenceNeed: "code",
          nowMs: 1_100,
        });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.created).toBe(true);
        expect(second.undertaking.undertakingId).not.toBe(first.undertaking.undertakingId);
      } finally {
        sidecar.close();
      }
    });

    it("C3: checkUnansweredOwnerEligibility rejects when predecessor has active worker undertaking", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-c3";
        const evidence = appendOwnerUtterance(sidecar, {
          conversationId, text: "help me", discordMessageIds: ["d-c3"], nowMs: 100,
        });
        const candidate = {
          id: "event-c3",
          conversationId,
          kind: "owner_message",
          payloadJson: JSON.stringify({ evidenceRowId: evidence.rowId, ownerId: "doc" }),
          createdAtMs: 100,
          terminalReason: null,
          lastError: null,
          wakeId: null,
        };

        // Active undertaking for this candidate in another conversation
        sidecar.prepare(
          `INSERT INTO worker_undertakings
             (undertaking_id, semantic_kind, origin_kind, origin_ref, origin_owner_event_id, owner_id,
              conversation_id, origin_cycle_id, origin_generation, request_json,
              purpose, evidence_need, admission_key, state, queued_at_ms, updated_at_ms)
           VALUES ('undertaking-c3', 'project.inspect', 'OWNER_REQUEST', 'event-c3', 'event-c3', 'doc',
                   'other-thread', 'cycle-c3', 1, '{}', 'purpose', 'need', 'key-c3', 'running', 100, 100)`,
        ).run();

        const eligibility = checkUnansweredOwnerEligibility(sidecar, candidate);
        expect(eligibility.eligible).toBe(false);
        if (!eligibility.eligible) {
          expect(eligibility.reason).toBe("worker_undertaking_owns");
        }
      } finally {
        sidecar.close();
      }
    });

    it("C4: checkUnansweredOwnerEligibility rejects when predecessor has active repair event", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-c4";
        const evidence = appendOwnerUtterance(sidecar, {
          conversationId, text: "help me", discordMessageIds: ["d-c4"], nowMs: 100,
        });
        appendInboxEvent(sidecar, {
          id: "event-c4",
          conversationId,
          kind: "owner_message",
          payload: { evidenceRowId: evidence.rowId, ownerId: "doc" },
          createdAtMs: 100,
        });
        sidecar.prepare("UPDATE inbox_events SET state = 'quarantined', status = 'failed_terminal' WHERE id = ?")
          .run("event-c4");

        const candidate = {
          id: "event-c4",
          conversationId,
          kind: "owner_message",
          payloadJson: JSON.stringify({ evidenceRowId: evidence.rowId, ownerId: "doc" }),
          createdAtMs: 100,
          terminalReason: null,
          lastError: null,
          wakeId: null,
        };

        // Active repair in durable_work_repairs
        appendInboxEvent(sidecar, {
          id: "repair-c4",
          conversationId,
          kind: "repair",
          payload: {},
          createdAtMs: 200,
        });
        sidecar.prepare(
          `INSERT INTO durable_work_repairs (repair_event_id, predecessor_event_id, authorization_ref, created_at_ms)
           VALUES ('repair-c4', 'event-c4', 'auth-c4', 200)`,
        ).run();

        const eligibility = checkUnansweredOwnerEligibility(sidecar, candidate);
        expect(eligibility.eligible).toBe(false);
        if (!eligibility.eligible) {
          expect(eligibility.reason).toBe("repair_active");
        }
      } finally {
        sidecar.close();
      }
    });
  });


  describe("Repair E: One-Hour Worker Deadline Hierarchy", () => {
    it("E1: Deadlines and reserve constants are correctly configured", () => {
      expect(DETACHED_WORKER_MAX_WALL_CLOCK_MS).toBe(3_600_000); // 1 hour
      expect(WORKER_FINALIZATION_RESERVE_MS).toBe(30_000); // 30 seconds
      expect(OPENCODE_MODEL_TURN_MAX_MS).toBe(300_000); // 5 minutes
      expect(DETACHED_OPERATION_DEFAULT_DEADLINE_MS).toBe(3_600_000); // 1 hour
    });

    it("E2: dispatchDetachedOperation uses DETACHED_OPERATION_DEFAULT_DEADLINE_MS (1 hour)", async () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-e2";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-e2",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-e2",
          nowMs: 1_000,
        });
        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-e2",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "OWNER_REQUEST",
          originRef: "event-e2",
          originOwnerEventId: "event-e2",
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          operationDeadlineAtMs: 1_000 + DETACHED_OPERATION_DEFAULT_DEADLINE_MS,
          nowMs: 1_000,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) throw new Error("admission failed");

        let dispatchedDeadline: number | undefined;
        await dispatchDetachedOperation(
          sidecar,
          admitted.operation.operationId,
          async (input) => {
            dispatchedDeadline = input.operation.operationDeadlineAtMs ?? undefined;
            return { ok: true, payload: { result: "done" } };
          },
          { nowMs: 1_000 },
        );

        // 1_000 ms + 3_600_000 ms = 3_601_000 ms
        expect(dispatchedDeadline).toBe(3_601_000);
      } finally {
        sidecar.close();
      }
    });

    it("E3: executeModeBWorker bounds turn to OPENCODE_MODEL_TURN_MAX_MS (5 min) and fails over on timeout", async () => {
      const completeDeadlines: number[] = [];
      const completeModelIds: string[] = [];
      let turnCount = 0;

      const mockTransport = {
        complete: vi.fn(async (input: { modelId: string; deadlineAtMs: number }) => {
          completeDeadlines.push(input.deadlineAtMs);
          completeModelIds.push(input.modelId);
          turnCount++;
          if (turnCount === 1) {
            // First turn times out
            throw new Error("opencode_timeout");
          }
          // Sibling turn completes
          return {
            text: JSON.stringify({ type: "complete", summary: "investigation finished by sibling" }),
          };
        }),
      };

      const router = createQuotaRouter({
        catalog: C1_OPENCODE_FREE_CATALOG,
        nowMs: 1_000,
      });

      const startTime = 1_000;
      let currentTime = startTime;
      const sessionDeadline = startTime + DETACHED_WORKER_MAX_WALL_CLOCK_MS - WORKER_FINALIZATION_RESERVE_MS;

      const result = await executeModeBWorker({
        kind: MODE_B_INVESTIGATE,
        request: { projectId: "project-ashley" },
        purpose: "test timeout hierarchy",
        isolationRoot: "C:\\tmp\\test-isolation",
        binaryPath: "opencode",
        pinnedVersion: C1_OPENCODE_FREE_CATALOG.pinnedOpenCodeVersion,
        quotaPath: "C:\\tmp\\quota.json",
        router,
        persistQuota: () => {},
        dispatchers: {
          executeProjectInspectionV2: vi.fn() as any,
          executeWorkspaceExperimentV2: vi.fn() as any,
        },
        inspectionBase: {
          messageEntityUuid: "msg-1",
          db: new DatabaseSync(":memory:"),
          masterMode: "normal" as any,
          registry: { projects: {} } as any,
          projectInspectionPreparationDeadlineAtMs: 10_000,
          childExecutionDeadlineAtMs: 20_000,
          childTerminationDeadlineAtMs: 30_000,
          settlementDeadlineAtMs: 40_000,
        },
        workspaceBase: {
          messageEntityUuid: "msg-1",
          db: new DatabaseSync(":memory:"),
          masterMode: "normal" as any,
          registry: { projects: {} } as any,
          deadlineAtMs: 40_000,
          childExecutionDeadlineAtMs: 20_000,
          childTerminationDeadlineAtMs: 30_000,
          settlementDeadlineAtMs: 40_000,
        },
        pathEnv: "",
        nowMs: () => currentTime,
        deadlineAtMs: sessionDeadline,
        workerEnabled: true,
        transport: mockTransport,
      });

      // Verify that turn deadline was bounded to nowMs + OPENCODE_MODEL_TURN_MAX_MS (1_000 + 300_000 = 301_000)
      // rather than the 1-hour session deadline (3_571_000)
      expect(completeDeadlines[0]).toBe(startTime + OPENCODE_MODEL_TURN_MAX_MS);
      expect(completeDeadlines[0]).toBeLessThan(sessionDeadline);

      // Verify that failover occurred: 2 turns executed, second with sibling model
      expect(completeModelIds).toHaveLength(2);
      expect(completeModelIds[0]).not.toBe(completeModelIds[1]);

      // Worker succeeded via sibling model
      expect(result.license.state).toBe("succeeded");
      expect(result.summary).toBe("investigation finished by sibling");
    });

    it("E4: executeModeBWorker terminates with deadline_exhausted when remaining time <= WORKER_FINALIZATION_RESERVE_MS", async () => {
      const mockTransport = {
        complete: vi.fn(async () => {
          throw new Error("opencode_timeout");
        }),
      };

      const router = createQuotaRouter({
        catalog: C1_OPENCODE_FREE_CATALOG,
        nowMs: 1_000,
      });

      // Session deadline is set to now + 25 seconds (less than the 30s reserve)
      const now = 1_000;
      const tightDeadline = now + 25_000;

      const result = await executeModeBWorker({
        kind: MODE_B_INVESTIGATE,
        request: { projectId: "project-ashley" },
        purpose: "test reserve exhaust",
        isolationRoot: "C:\\tmp\\test-isolation",
        binaryPath: "opencode",
        pinnedVersion: C1_OPENCODE_FREE_CATALOG.pinnedOpenCodeVersion,
        quotaPath: "C:\\tmp\\quota.json",
        router,
        persistQuota: () => {},
        dispatchers: {
          executeProjectInspectionV2: vi.fn() as any,
          executeWorkspaceExperimentV2: vi.fn() as any,
        },
        inspectionBase: {
          messageEntityUuid: "msg-1",
          db: new DatabaseSync(":memory:"),
          masterMode: "normal" as any,
          registry: { projects: {} } as any,
          projectInspectionPreparationDeadlineAtMs: 10_000,
          childExecutionDeadlineAtMs: 20_000,
          childTerminationDeadlineAtMs: 30_000,
          settlementDeadlineAtMs: 40_000,
        },
        workspaceBase: {
          messageEntityUuid: "msg-1",
          db: new DatabaseSync(":memory:"),
          masterMode: "normal" as any,
          registry: { projects: {} } as any,
          deadlineAtMs: 40_000,
          childExecutionDeadlineAtMs: 20_000,
          childTerminationDeadlineAtMs: 30_000,
          settlementDeadlineAtMs: 40_000,
        },
        pathEnv: "",
        nowMs: () => now,
        deadlineAtMs: tightDeadline,
        workerEnabled: true,
        transport: mockTransport,
      });

      expect(result.license.state).toBe("none");
      expect(result.license.error).toBe("deadline_exhausted");
    });
  });

  describe("Repair P1: Incident Reservation Identity & Reconciliation", () => {
    it("P1-1: Reservation 358 incident shape (owner_id = conversation UUID, state = 'reserved', delivery_lane = 'proactive', speech_outbox_id = 111) is truthfully suppressed as stale_generation when generation is stale", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle:8a8dfb5cc5ecd70c9c1a4a863c146cc4e08ba7f371cd1d528157754ccdf11726",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-154",
          occupantId: "212123686923272192",
          generation: 154,
          nowMs: 1_000,
        });

        registerCognitiveDeliveryDatabases(sidecar, nuclear);

        // Insert speech_outbox row 111
        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-incident-111",
          cycleId: cycle.cycleId,
          generation: 154,
          conversationId,
          licensedText: "still around. the retries kept hitting model_temporarily_unavailable",
          deliveryIntent: {
            ownerId: conversationId, // Wrong principal in legacy intent
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "operation_completion",
            deliveryLane: "proactive",
            purpose: "licensed_speech",
          },
        });
        sidecar.prepare("UPDATE speech_outbox SET outbox_id = 111, projection_key = 'speech:111' WHERE outbox_id = ?").run(outbox.outboxId);

        // Insert delivery_reservations row 358 matching exact production forensic row
        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
           VALUES (358, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                   ?, '2026-09-18T09:22:22.436Z', 'speech:111', 111)`,
        ).run(conversationId, conversationId, outbox.licensedText);

        // Advance sidecar to subsequent generation (cycle 158) making generation 154 stale
        admitTestCycle(sidecar, {
          cycleId: "cycle:subsequent-158",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-158",
          occupantId: "212123686923272192",
          generation: 158,
          nowMs: 10_000,
        });

        // Run reconciliation
        const result = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "212123686923272192", 10_000);
        expect(result.corrected).toBe(0);
        expect(result.suppressedStale).toBe(1);

        // Verify reservation 358 was truthfully aborted as stale_generation
        const res = nuclear.prepare("SELECT state, finalization_reason FROM delivery_reservations WHERE id = 358").get() as { state: string; finalization_reason: string };
        expect(res.state).toBe("aborted");
        expect(res.finalization_reason).toBe("stale_generation");

        // Verify speech_outbox 111 was suppressed with stale_generation
        const speech = sidecar.prepare("SELECT send_status, nuclear_finalization_reason FROM speech_outbox WHERE outbox_id = 111").get() as { send_status: string; nuclear_finalization_reason: string };
        expect(speech.send_status).toBe("suppressed");
        expect(speech.nuclear_finalization_reason).toBe("stale_generation");

        // Verify Discord pump finds zero deliverable rows (never blindly resent)
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "212123686923272192", nowMs: 10_000 });
        expect(claimed).toEqual([]);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("P1-2: Non-stale legacy wrong-principal final speech reservation is corrected to canonical Owner snowflake and delivered", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        registerCognitiveDeliveryDatabases(sidecar, nuclear);
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle:current-154",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-154",
          occupantId: "212123686923272192",
          generation: 154,
          nowMs: 1_000,
        });

        // Insert speech_outbox row
        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-current-154",
          cycleId: cycle.cycleId,
          generation: 154,
          conversationId,
          licensedText: "here is the answer to your question",
          deliveryIntent: {
            ownerId: conversationId, // Wrong principal
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "operation_completion",
            deliveryLane: "proactive",
            purpose: "licensed_speech",
          },
        });

        // Insert delivery_reservations row with wrong owner_id = conversationId
        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
           VALUES (359, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                   ?, '2026-09-18T09:22:22.436Z', ?, ?)`,
        ).run(conversationId, conversationId, outbox.licensedText, outbox.projectionKey, outbox.outboxId);

        // Add delivery bubble
        nuclear.prepare(
          `INSERT INTO delivery_bubbles (reservation_id, ordinal, text) VALUES (359, 0, ?)`,
        ).run(outbox.licensedText);

        // The pump claims with canonical Owner ID
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "212123686923272192", nowMs: 2_000 });
        expect(claimed).toHaveLength(1);
        expect(claimed[0]!.reservationId).toBe(359);

        // Verify owner_id was updated to canonical Owner snowflake in DB
        const res = nuclear.prepare("SELECT owner_id, state FROM delivery_reservations WHERE id = 359").get() as { owner_id: string; state: string };
        expect(res.owner_id).toBe("212123686923272192");
        expect(res.state).toBe("sending");

        // Verify sidecar delivery_intent_json was updated
        const speech = sidecar.prepare("SELECT delivery_intent_json FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId) as { delivery_intent_json: string };
        const parsedIntent = JSON.parse(speech.delivery_intent_json);
        expect(parsedIntent.ownerId).toBe("212123686923272192");
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("P1-3: listPendingCognitiveDeliveries is purely observational and does NOT mutate legacy reservation", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        registerCognitiveDeliveryDatabases(sidecar, nuclear);
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle:obs-154",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-154",
          occupantId: "212123686923272192",
          generation: 154,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-obs-154",
          cycleId: cycle.cycleId,
          generation: 154,
          conversationId,
          licensedText: "observational speech",
          deliveryIntent: {
            ownerId: conversationId,
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "operation_completion",
            deliveryLane: "proactive",
            purpose: "licensed_speech",
          },
        });

        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
           VALUES (401, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                   ?, '2026-09-18T09:22:22.436Z', ?, ?)`,
        ).run(conversationId, conversationId, outbox.licensedText, outbox.projectionKey, outbox.outboxId);

        // listPendingCognitiveDeliveries is called
        const listed = listPendingCognitiveDeliveries(nuclear, "212123686923272192");
        expect(listed).toEqual([]);

        // Verification: row remains completely unmutated in nuclear DB
        const row = nuclear.prepare("SELECT owner_id, state FROM delivery_reservations WHERE id = 401").get() as { owner_id: string; state: string };
        expect(row.owner_id).toBe(conversationId);
        expect(row.state).toBe("reserved");
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("P1-4: claimPendingCognitiveDeliveries reconciles legacy reservation on mutating path", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        registerCognitiveDeliveryDatabases(sidecar, nuclear);
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle:claim-154",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-154",
          occupantId: "212123686923272192",
          generation: 154,
          nowMs: 1_000,
        });

        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-claim-154",
          cycleId: cycle.cycleId,
          generation: 154,
          conversationId,
          licensedText: "claim speech",
          deliveryIntent: {
            ownerId: conversationId,
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "operation_completion",
            deliveryLane: "proactive",
            purpose: "licensed_speech",
          },
        });

        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
           VALUES (402, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                   ?, '2026-09-18T09:22:22.436Z', ?, ?)`,
        ).run(conversationId, conversationId, outbox.licensedText, outbox.projectionKey, outbox.outboxId);

        nuclear.prepare(`INSERT INTO delivery_bubbles (reservation_id, ordinal, text) VALUES (402, 0, ?)`).run(outbox.licensedText);

        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "212123686923272192", nowMs: 2_000 });
        expect(claimed).toHaveLength(1);
        expect(claimed[0]!.reservationId).toBe(402);

        const row = nuclear.prepare("SELECT owner_id, state FROM delivery_reservations WHERE id = 402").get() as { owner_id: string; state: string };
        expect(row.owner_id).toBe("212123686923272192");
        expect(row.state).toBe("sending");
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("P1-5: >limit suspicious rows converge over repeated passes", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        registerCognitiveDeliveryDatabases(sidecar, nuclear);
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";
        // Create 60 stale speech rows
        const totalRows = 60;
        for (let i = 1; i <= totalRows; i++) {
          const outboxId = 500 + i;
          nuclear.prepare(
            `INSERT INTO delivery_reservations
               (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
                draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
             VALUES (?, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                     'text', '2026-09-18T09:22:22.436Z', ?, ?)`,
          ).run(outboxId, conversationId, conversationId, `speech:${outboxId}`, outboxId);

          const out = insertOutboxPending(sidecar, {
            settlementId: `s-${outboxId}`,
            cycleId: "cycle:old",
            generation: 10,
            conversationId,
            licensedText: "text",
            deliveryIntent: {
              ownerId: conversationId,
              channel: "discord",
              threadId: conversationId,
              conversationId,
              trigger: "operation_completion",
              deliveryLane: "proactive",
              purpose: "licensed_speech",
            },
          });
          sidecar.prepare("UPDATE speech_outbox SET outbox_id = ?, projection_key = ? WHERE outbox_id = ?").run(outboxId, `speech:${outboxId}`, out.outboxId);
        }

        // Pass 1 with default limit 50: processes 50 rows
        const pass1 = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "212123686923272192", 2000, 50);
        expect(pass1.suppressedStale).toBe(50);

        // Pass 2: processes remaining 10 rows
        const pass2 = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "212123686923272192", 3000, 50);
        expect(pass2.suppressedStale).toBe(10);

        // Pass 3: zero remaining, idempotent
        const pass3 = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "212123686923272192", 4000, 50);
        expect(pass3.suppressedStale).toBe(0);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("P1-6: correct rows do NOT consume the suspicious-row bound", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        registerCognitiveDeliveryDatabases(sidecar, nuclear);
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";
        // Insert 50 correct rows with canonical Owner snowflake
        for (let i = 1; i <= 50; i++) {
          const resId = 1000 + i;
          nuclear.prepare(
            `INSERT INTO delivery_reservations
               (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
                draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
             VALUES (?, '212123686923272192', 'discord', ?, 'proactive', 'proactive', 'reserved',
                     'correct text', '2026-09-18T09:22:22.436Z', ?, ?)`,
          ).run(resId, conversationId, `speech:${resId}`, resId);
        }

        // Insert 1 suspicious row with wrong principal (id 2000)
        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
           VALUES (2000, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                   'suspicious text', '2026-09-18T09:22:22.436Z', 'speech:2000', 2000)`,
        ).run(conversationId, conversationId);

        const out2000 = insertOutboxPending(sidecar, {
          settlementId: "s-2000",
          cycleId: "cycle:old",
          generation: 10,
          conversationId,
          licensedText: "suspicious text",
          deliveryIntent: {
            ownerId: conversationId,
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "operation_completion",
            deliveryLane: "proactive",
            purpose: "licensed_speech",
          },
        });
        sidecar.prepare("UPDATE speech_outbox SET outbox_id = ?, projection_key = ? WHERE outbox_id = ?").run(2000, "speech:2000", out2000.outboxId);

        // Reconcile with limit 50: suspicious row MUST NOT be starved by the 50 correct rows
        const pass = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "212123686923272192", 2000, 50);
        expect(pass.suppressedStale).toBe(1);

        const check = nuclear.prepare("SELECT state, finalization_reason FROM delivery_reservations WHERE id = 2000").get() as { state: string; finalization_reason: string };
        expect(check.state).toBe("aborted");
        expect(check.finalization_reason).toBe("stale_generation");
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("P1-7: crash/repeated invocation remains idempotent across databases", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        registerCognitiveDeliveryDatabases(sidecar, nuclear);
        const conversationId = "2d445d64-ca17-4fd7-91e3-9f3578062a16";

        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
           VALUES (3000, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                   'crash text', '2026-09-18T09:22:22.436Z', 'speech:3000', 3000)`,
        ).run(conversationId, conversationId);

        // Sidecar already updated to suppressed (simulating crash before nuclear update landed)
        const out3000 = insertOutboxPending(sidecar, {
          settlementId: "s-3000",
          cycleId: "cycle:old",
          generation: 10,
          conversationId,
          licensedText: "crash text",
          deliveryIntent: {
            ownerId: conversationId,
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "operation_completion",
            deliveryLane: "proactive",
            purpose: "licensed_speech",
          },
        });
        sidecar.prepare("UPDATE speech_outbox SET outbox_id = ?, projection_key = ?, send_status = 'suppressed', suppressed = 1 WHERE outbox_id = ?").run(3000, "speech:3000", out3000.outboxId);

        // Pass 1 converges the nuclear state
        const pass1 = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "212123686923272192", 2000, 50);
        expect(pass1.suppressedStale).toBe(1);

        // Pass 2 is completely idempotent
        const pass2 = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "212123686923272192", 3000, 50);
        expect(pass2.suppressedStale).toBe(0);
        expect(pass2.corrected).toBe(0);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("V4-1: sidecar write failure leaves Nuclear discoverable and retry converges", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        registerCognitiveDeliveryDatabases(sidecar, nuclear);
        const canonicalOwnerId = "212123686923272192";
        const conversationId = "5c8f5d2e-9b1f-4a7c-9f3e-2c9b1f4a7c11";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle:v4-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-v4-1",
          occupantId: canonicalOwnerId,
          generation: 154,
          nowMs: 1_000,
        });
        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-v4-1",
          cycleId: cycle.cycleId,
          generation: 154,
          conversationId,
          licensedText: "v4-1 retry convergence speech",
          deliveryIntent: {
            ownerId: conversationId,
            channel: "discord",
            threadId: conversationId,
            conversationId,
            trigger: "operation_completion",
            deliveryLane: "proactive",
            purpose: "licensed_speech",
          },
        });
        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
           VALUES (410, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                   ?, '2026-09-18T09:22:22.436Z', ?, ?)`,
        ).run(conversationId, conversationId, outbox.licensedText, outbox.projectionKey, outbox.outboxId);
        sidecar.exec(
          `CREATE TRIGGER v4_sidecar_intent_failure BEFORE UPDATE OF delivery_intent_json ON speech_outbox
           BEGIN SELECT RAISE(ABORT, 'v4_sidecar_update_failure'); END`,
        );
        const failed = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, canonicalOwnerId, 2_000);
        expect(failed.corrected).toBe(0);
        expect(failed.suppressedStale).toBe(0);
        const leftUntouched = nuclear.prepare("SELECT owner_id, state FROM delivery_reservations WHERE id = 410").get() as {
          owner_id: string;
          state: string;
        };
        expect(leftUntouched.owner_id).toBe(conversationId);
        expect(leftUntouched.state).toBe("reserved");
        sidecar.exec("DROP TRIGGER v4_sidecar_intent_failure");
        const retried = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, canonicalOwnerId, 3_000);
        expect(retried.corrected).toBe(1);
        const converged = nuclear.prepare("SELECT owner_id FROM delivery_reservations WHERE id = 410").get() as {
          owner_id: string;
        };
        expect(converged.owner_id).toBe(canonicalOwnerId);
        const intent = JSON.parse(
          (sidecar.prepare("SELECT delivery_intent_json FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId) as {
            delivery_intent_json: string;
          }).delivery_intent_json,
        ) as { ownerId: string };
        expect(intent.ownerId).toBe(canonicalOwnerId);
        const again = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, canonicalOwnerId, 4_000);
        expect(again.corrected).toBe(0);
        expect(again.suppressedStale).toBe(0);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("V4-2: UUID-like non-thread rows cannot consume the bounded legacy page", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        registerCognitiveDeliveryDatabases(sidecar, nuclear);
        const canonicalOwnerId = "212123686923272192";
        const genuineConversationId = "6d9f6a1e-1b2c-4d3e-8f4a-9b1c2d3e4f50";
        const genuineCycle = admitTestCycle(sidecar, {
          cycleId: "cycle:v4-2-genuine",
          conversationId: genuineConversationId,
          triggerKind: "owner_message",
          triggerRef: "event-v4-2-genuine",
          occupantId: canonicalOwnerId,
          generation: 154,
          nowMs: 1_000,
        });
        const genuineOutbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-v4-2-genuine",
          cycleId: genuineCycle.cycleId,
          generation: 154,
          conversationId: genuineConversationId,
          licensedText: "v4-2 genuine legacy speech",
          deliveryIntent: {
            ownerId: genuineConversationId,
            channel: "discord",
            threadId: genuineConversationId,
            conversationId: genuineConversationId,
            trigger: "operation_completion",
            deliveryLane: "proactive",
            purpose: "licensed_speech",
          },
        });
        for (let i = 1; i <= 60; i += 1) {
          const resId = 5000 + i;
          const unrelatedOwner = `aaaaaaaa-bbbb-cccc-dddd-${String(i).padStart(12, "0")}`;
          const unrelatedThread = `thread-v4-2-${i}`;
          nuclear.prepare(
            `INSERT INTO delivery_reservations
               (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
                draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
             VALUES (?, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                     'unrelated text', '2026-09-18T09:22:22.436Z', ?, 0)`,
          ).run(resId, unrelatedOwner, unrelatedThread, `speech:${resId}`);
        }
        const genuineId = 5061;
        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key, speech_outbox_id)
           VALUES (?, ?, 'discord', ?, 'proactive', 'proactive', 'reserved',
                   ?, '2026-09-18T09:22:22.436Z', ?, ?)`,
        ).run(genuineId, genuineConversationId, genuineConversationId, genuineOutbox.licensedText, genuineOutbox.projectionKey, genuineOutbox.outboxId);
        const pass = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, canonicalOwnerId, 2_000, 50);
        expect(pass.corrected).toBe(1);
        const genuine = nuclear.prepare("SELECT owner_id FROM delivery_reservations WHERE id = 5061").get() as {
          owner_id: string;
        };
        expect(genuine.owner_id).toBe(canonicalOwnerId);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Repair P2: Timed-Out OpenCode Child Termination (V3-1)", () => {
    it("P2-1: terminateProcessWithEscalation requests SIGTERM, ignores exit, escalates to SIGKILL, and only close proves teardown", async () => {
      const signals: string[] = [];
      const mockChild = new EventEmitter() as unknown as ChildProcess & {
        exitCode: number | null;
        kill: (signal?: NodeJS.Signals | number) => boolean;
      };
      mockChild.exitCode = null;
      mockChild.kill = vi.fn((signal?: any) => {
        signals.push(String(signal));
        return true;
      });

      let resolved = false;
      const terminationPromise = terminateProcessWithEscalation(mockChild as unknown as ChildProcess, {
        termGraceMs: 50,
        killGraceMs: 50,
      }).then((res) => {
        resolved = true;
        return res;
      });

      // Initially sends SIGTERM
      expect(signals).toEqual(["SIGTERM"]);
      expect(resolved).toBe(false);

      // Emitting exit alone MUST NOT resolve
      mockChild.emit("exit", 0);
      expect(resolved).toBe(false);

      // Wait for grace period to expire -> escalates to SIGKILL
      await new Promise((r) => setTimeout(r, 70));
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(resolved).toBe(false);

      // Emitting close resolves the promise with closed: true
      mockChild.emit("close", 0);
      const res = await terminationPromise;
      expect(resolved).toBe(true);
      expect(res.closed).toBe(true);
    });

    it("P2-2: spawnOpenCodeTransport real lifecycle: timeout -> SIGTERM -> exit does NOT reject -> close rejects opencode_timeout", async () => {
      const signals: string[] = [];
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.exitCode = null;
      mockChild.kill = vi.fn((sig) => {
        signals.push(String(sig));
        return true;
      });

      const transport = spawnOpenCodeTransport({
        termGraceMs: 50,
        killGraceMs: 50,
        spawnChild: (() => mockChild) as any,
      });

      let rejectedError: string | null = null;
      let closedAtTimeOfRejection = false;
      let childIsClosed = false;

      const completePromise = transport.complete({
        modelId: "model-a",
        prompt: "test",
        env: {},
        cwd: ".",
        deadlineAtMs: Date.now() + 10,
        binaryPath: "opencode",
      }).catch((err) => {
        rejectedError = err instanceof Error ? err.message : String(err);
        closedAtTimeOfRejection = childIsClosed;
      });

      // 1. Timeout fires -> SIGTERM requested
      await new Promise((r) => setTimeout(r, 20));
      expect(signals).toContain("SIGTERM");
      expect(rejectedError).toBeNull();

      // 2. 'exit' occurs -> promise does NOT reject yet
      mockChild.emit("exit", 0);
      await new Promise((r) => setTimeout(r, 10));
      expect(rejectedError).toBeNull();

      // 3. 'close' occurs -> only then does complete() reject with opencode_timeout
      childIsClosed = true;
      mockChild.emit("close", 0);
      await completePromise;

      expect(rejectedError).toBe("opencode_timeout");
      expect(closedAtTimeOfRejection).toBe(true);
    });

    it("P2-3: spawnOpenCodeTransport TERM grace expires -> SIGKILL requested -> close after SIGKILL rejects opencode_timeout", async () => {
      const signals: string[] = [];
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.exitCode = null;
      mockChild.kill = vi.fn((sig) => {
        signals.push(String(sig));
        return true;
      });

      const transport = spawnOpenCodeTransport({
        termGraceMs: 20,
        killGraceMs: 50,
        spawnChild: (() => mockChild) as any,
      });

      let rejectedError: string | null = null;
      const completePromise = transport.complete({
        modelId: "model-a",
        prompt: "test",
        env: {},
        cwd: ".",
        deadlineAtMs: Date.now() + 10,
        binaryPath: "opencode",
      }).catch((err) => {
        rejectedError = err instanceof Error ? err.message : String(err);
      });

      // Timeout (10ms) + termGrace (20ms) -> escalates to SIGKILL.
      // Deterministically observe the recorded signals instead of sampling at a
      // fixed sleep: Node timers can run late under full-corpus contention.
      await vi.waitFor(() => {
        expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      });
      expect(rejectedError).toBeNull();

      // Close after SIGKILL
      mockChild.emit("close", null);
      await completePromise;
      expect(rejectedError).toBe("opencode_timeout");
    });

    it("P2-4: spawnOpenCodeTransport no close after bounded SIGKILL grace -> rejects opencode_termination_unconfirmed", async () => {
      const signals: string[] = [];
      const mockChild = new EventEmitter() as any;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.exitCode = null;
      mockChild.kill = vi.fn((sig) => {
        signals.push(String(sig));
        return true;
      });

      const transport = spawnOpenCodeTransport({
        termGraceMs: 20,
        killGraceMs: 20,
        spawnChild: (() => mockChild) as any,
      });

      let rejectedError: string | null = null;
      const completePromise = transport.complete({
        modelId: "model-a",
        prompt: "test",
        env: {},
        cwd: ".",
        deadlineAtMs: Date.now() + 10,
        binaryPath: "opencode",
      }).catch((err) => {
        rejectedError = err instanceof Error ? err.message : String(err);
      });

      // Timeout (10ms) + termGrace (20ms) + killGrace (20ms) + margin
      await completePromise;
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(rejectedError).toBe("opencode_termination_unconfirmed");
    });

    it("P2-5: executeModeBWorker termination-unconfirmed does NOT reroute to sibling model", async () => {
      let completeCalls = 0;
      const transport = {
        async complete() {
          completeCalls += 1;
          throw new Error("opencode_termination_unconfirmed");
        },
      };

      const result = await executeModeBWorker({
        kind: MODE_B_INVESTIGATE,
        request: { projectId: "project-ashley" },
        purpose: "test",
        isolationRoot: "/tmp/iso-p2-5",
        binaryPath: "opencode",
        pinnedVersion: "1.18.30",
        quotaPath: "/tmp/quota-p2-5.json",
        router: createQuotaRouter(),
        persistQuota: vi.fn(),
        dispatchers: {
          executeProjectInspectionV2: vi.fn() as any,
          executeWorkspaceExperimentV2: vi.fn() as any,
        },
        inspectionBase: {} as any,
        workspaceBase: {} as any,
        pathEnv: "/usr/bin",
        nowMs: () => Date.now(),
        deadlineAtMs: Date.now() + 60_000,
        transport,
        workerEnabled: true,
      });

      expect(completeCalls).toBe(1);
      expect(result.license.error).toBe("opencode_termination_unconfirmed");
      expect(result.license.state).toBe("none");
    });

    it("P2-6: real process timeout does not leave active children", async () => {
      const transport = spawnOpenCodeTransport({
        termGraceMs: 50,
        killGraceMs: 50,
      });

      let rejectedError: string | null = null;
      await transport.complete({
        modelId: "test",
        prompt: "test",
        env: {},
        cwd: ".",
        deadlineAtMs: Date.now() + 20,
        binaryPath: process.execPath,
      }).catch((err) => {
        rejectedError = err instanceof Error ? err.message : String(err);
      });

      expect(rejectedError).toBe("opencode_timeout");
    });
  });

  describe("Repair P4: Never Substitute Conversation ID for Owner Principal", () => {
    it("P4-1: runCognitiveCycle fails closed with canonical_owner_principal_unproven when OWNER_REQUEST cannot prove canonical Owner principal", async () => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const conversationId = "thread-unproven-owner";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-unproven",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-unproven",
          occupantId: null, // No authorized occupant
          nowMs: 1_000,
        });

        // Event has no ownerId in payload and no speakerPrincipalId in evidence
        const event = appendInboxEvent(sidecar, {
          id: "event-unproven",
          conversationId,
          kind: "owner_message",
          payload: {}, // missing ownerId
          createdAtMs: 1_000,
        });

        const completeChat = vi.fn(async () => ({
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.inspect",
            request: { projectId: "project-ashley" },
            purpose: "unproven test",
            evidenceNeed: "code",
            existingRefs: [],
          }),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        }));

        await expect(
          runCognitiveCycle(
            sidecar,
            nuclear,
            event,
            mockKernelDeps({
              completeChat,
              canOfferDirectProjectInspection: () => false,
              enqueueWorkerUndertaking: vi.fn(),
            }),
          ),
        ).rejects.toThrow("canonical_owner_principal_unproven");
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("P4-2: produceOperationCompletion does not fall back to unrelated recent conversation inbox events", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-p4-comp";
        // Unrelated recent owner event from an unauthorized or different principal
        appendInboxEvent(sidecar, {
          id: "event-unrelated",
          conversationId,
          kind: "owner_message",
          payload: { ownerId: "unrelated-user" },
          createdAtMs: 50,
        });

        appendInboxEvent(sidecar, {
          id: "event-p4-comp",
          conversationId,
          kind: "owner_message",
          payload: {},
          createdAtMs: 100,
        });

        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-p4-comp",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-p4-comp",
          occupantId: null,
          nowMs: 1_000,
        });

        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-p4-comp",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "OWNER_REQUEST",
          originRef: "event-p4-comp",
          originOwnerEventId: "event-p4-comp",
          workerUndertakingId: null,
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          operationDeadlineAtMs: 3_600_000,
          nowMs: 1_000,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) return;

        markDetachedOperationStarted(sidecar, admitted.operation.operationId, {
          startProofRef: "start-p4-comp",
          nowMs: 1_500,
        });

        setDetachedOperationTerminal(sidecar, admitted.operation.operationId, {
          terminalState: "succeeded",
          nowMs: 2_000,
        });

        const result = produceOperationCompletion(sidecar, admitted.operation.operationId, {
          nowMs: 2_100,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const event = getInboxEvent(sidecar, result.eventId);
        const payload = event?.payload as Record<string, unknown>;
        // Must NOT fall back to "unrelated-user" from the unrelated event
        expect(payload.ownerId).toBeUndefined();
      } finally {
        sidecar.close();
      }
    });
  });

  describe("Repair P5: Reproduce Actual Notice-39 Ordering", () => {
    it("P5-1: Integration test verifying 3-step Notice-39 sequence", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-notice-39";
        const evidence = appendOwnerUtterance(sidecar, {
          conversationId,
          text: "can you read the repo?",
          discordMessageIds: ["d-39"],
          nowMs: 100,
        });
        const pred = appendInboxEvent(sidecar, {
          id: "pred-notice-39",
          conversationId,
          kind: "owner_utterance",
          payload: { evidenceRowId: evidence.rowId, ownerId: "212123686923272192" },
          createdAtMs: 100,
        });

        // Step 1: Owner event exhausts durable attempts (5 attempts fail -> quarantined / failed_terminal)
        startDurableAttempt(sidecar, { eventId: pred.id, workerId: "w1", nowMs: 110 });
        sidecar.prepare(
          `UPDATE inbox_events
              SET state = 'quarantined', status = 'failed_terminal',
                  attempt_count = 5, terminal_reason = 'attempts_exhausted',
                  quarantine_reason = 'attempts_exhausted'
            WHERE id = ?`,
        ).run(pred.id);

        // At this point, R1 recovery remains eligible and no repair has yet materialized:
        // Verification: ZERO final failure notices exist!
        const initialNotices = sidecar.prepare("SELECT COUNT(*) AS count FROM system_notice_outbox").get() as { count: number };
        expect(initialNotices.count).toBe(0);

        // Step 2: Service recovery runs -> repair 1 materializes -> ZERO final failure notice!
        const firstPass = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 200 });
        expect(firstPass.createdRepairs).toHaveLength(1);
        expect(firstPass.finalFailureNoticeIds).toHaveLength(0);
        const noticesAfterFirst = sidecar.prepare("SELECT COUNT(*) AS count FROM system_notice_outbox").get() as { count: number };
        expect(noticesAfterFirst.count).toBe(0);

        // Simulate repair 1 failing terminal
        const repair1Id = firstPass.createdRepairs[0]!.repair.eventId;
        sidecar.prepare("UPDATE inbox_events SET state = 'terminal', status = 'failed_terminal' WHERE id = ?").run(repair1Id);

        // Repair 2 materializes -> ZERO final failure notice!
        const secondPass = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 300 });
        expect(secondPass.createdRepairs).toHaveLength(1);
        expect(secondPass.finalFailureNoticeIds).toHaveLength(0);
        expect(sidecar.prepare("SELECT COUNT(*) AS count FROM system_notice_outbox").get()).toEqual({ count: 0 });

        // Simulate repair 2 failing terminal
        const repair2Id = secondPass.createdRepairs[0]!.repair.eventId;
        sidecar.prepare("UPDATE inbox_events SET state = 'terminal', status = 'failed_terminal' WHERE id = ?").run(repair2Id);

        // Repair 3 materializes -> ZERO final failure notice!
        const thirdPass = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 400 });
        expect(thirdPass.createdRepairs).toHaveLength(1);
        expect(thirdPass.finalFailureNoticeIds).toHaveLength(0);
        expect(sidecar.prepare("SELECT COUNT(*) AS count FROM system_notice_outbox").get()).toEqual({ count: 0 });

        // Simulate repair 3 failing terminal
        const repair3Id = thirdPass.createdRepairs[0]!.repair.eventId;
        sidecar.prepare("UPDATE inbox_events SET state = 'terminal', status = 'failed_terminal' WHERE id = ?").run(repair3Id);

        // Step 3: Only after bounded automatic ownership is genuinely exhausted (3 repairs failed)
        // -> exactly ONE final notice is emitted!
        const fourthPass = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 500 });
        expect(fourthPass.createdRepairs).toHaveLength(0);
        expect(fourthPass.lineageExhaustedConversations).toContain(conversationId);
        expect(fourthPass.finalFailureNoticeIds).toHaveLength(1);

        const finalNotices = sidecar.prepare("SELECT notice_id, notice_key, notice_text FROM system_notice_outbox").all() as Array<{ notice_id: number; notice_key: string; notice_text: string }>;
        expect(finalNotices).toHaveLength(1);
        expect(finalNotices[0]!.notice_key).toContain("owner_recovery_exhausted");

        // Subsequent pass is idempotent: no duplicate notice created
        const fifthPass = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 600 });
        expect(fifthPass.finalFailureNoticeIds).toHaveLength(0);
        expect(sidecar.prepare("SELECT COUNT(*) AS count FROM system_notice_outbox").get()).toEqual({ count: 1 });
      } finally {
        sidecar.close();
      }
    });
  });

  describe("Repair P6: Complete Deadline Qualification", () => {
    it("P6-1: 45m queue wait then start -> fresh 1h execution allowance", async () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-p6-1";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-p6-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-p6-1",
          nowMs: 1_000,
        });

        // Enqueue at 1_000 ms
        const queued = enqueueWorkerUndertaking(sidecar, {
          semanticKind: "project.inspect",
          origin: { kind: "OWNER_REQUEST", ref: "event-p6-1", ownerEventId: "event-p6-1" },
          ownerId: "doc",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          nowMs: 1_000,
        });
        expect(queued.ok).toBe(true);

        // 45 minutes later = 45 * 60 * 1000 = 2_700_000 ms
        const startExecutionTime = 1_000 + 2_700_000;

        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-p6-1",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "OWNER_REQUEST",
          originRef: "event-p6-1",
          originOwnerEventId: "event-p6-1",
          workerUndertakingId: (queued as any).undertaking.undertakingId,
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          operationDeadlineAtMs: startExecutionTime + DETACHED_OPERATION_DEFAULT_DEADLINE_MS,
          nowMs: startExecutionTime,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) return;

        let dispatchedDeadline: number | undefined;
        await dispatchDetachedOperation(
          sidecar,
          admitted.operation.operationId,
          async (input) => {
            dispatchedDeadline = input.operation.operationDeadlineAtMs ?? undefined;
            return { ok: true, payload: { result: "done" } };
          },
          { nowMs: startExecutionTime },
        );

        // Execution allowance is startExecutionTime + 3_600_000 (fresh 1h, not reduced by 45m wait)
        expect(dispatchedDeadline).toBe(startExecutionTime + 3_600_000);
      } finally {
        sidecar.close();
      }
    });

    it("P6-2: Capacity wait / worker_busy does not consume execution clock", async () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-p6-2";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-p6-2",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "event-p6-2",
          nowMs: 1_000,
        });

        // Admitted at 1_000
        const admitted = admitDetachedOperation(sidecar, {
          idempotencyKey: "op-p6-2",
          conversationId,
          originCycleId: cycle.cycleId,
          originGeneration: cycle.generation,
          originKind: "OWNER_REQUEST",
          originRef: "event-p6-2",
          originOwnerEventId: "event-p6-2",
          operationKind: "project.investigate",
          request: { projectId: "project-ashley" },
          purpose: "investigate",
          evidenceNeed: "code",
          operationDeadlineAtMs: 1_000 + DETACHED_OPERATION_DEFAULT_DEADLINE_MS,
          nowMs: 1_000,
        });
        expect(admitted.ok).toBe(true);
        if (!admitted.ok) return;

        // Waiting on capacity until 60_000 ms
        const capacityResolvedTime = 60_000;
        let effectiveDeadline: number | undefined;
        await dispatchDetachedOperation(
          sidecar,
          admitted.operation.operationId,
          async (input) => {
            effectiveDeadline = input.operation.operationDeadlineAtMs ?? undefined;
            return { ok: true, payload: { done: true } };
          },
          { nowMs: capacityResolvedTime },
        );

        expect(effectiveDeadline).toBe(capacityResolvedTime + DETACHED_OPERATION_DEFAULT_DEADLINE_MS);
      } finally {
        sidecar.close();
      }
    });

    it("P6-3: Timeout advances fake clock by 300s and sibling gets a fresh turn", async () => {
      let currentTime = 1_000;
      const turnDeadlines: number[] = [];
      const turnModels: string[] = [];

      const mockTransport = {
        complete: vi.fn(async (input: { modelId: string; deadlineAtMs: number }) => {
          turnDeadlines.push(input.deadlineAtMs);
          turnModels.push(input.modelId);
          if (turnModels.length === 1) {
            // First turn times out after 300s
            currentTime += 300_000;
            throw new Error("opencode_timeout");
          }
          // Sibling turn executes
          return {
            text: JSON.stringify({ type: "complete", summary: "sibling done" }),
          };
        }),
      };

      const router = createQuotaRouter({
        catalog: C1_OPENCODE_FREE_CATALOG,
        nowMs: 1_000,
      });

      const sessionDeadline = currentTime + DETACHED_WORKER_MAX_WALL_CLOCK_MS;
      const result = await executeModeBWorker({
        kind: MODE_B_INVESTIGATE,
        request: { projectId: "project-ashley" },
        purpose: "sibling turn test",
        isolationRoot: "C:\\tmp\\test-isolation",
        binaryPath: "opencode",
        pinnedVersion: C1_OPENCODE_FREE_CATALOG.pinnedOpenCodeVersion,
        quotaPath: "C:\\tmp\\quota.json",
        router,
        persistQuota: () => {},
        dispatchers: {
          executeProjectInspectionV2: vi.fn() as any,
          executeWorkspaceExperimentV2: vi.fn() as any,
        },
        inspectionBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          projectInspectionPreparationDeadlineAtMs: 10_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        workspaceBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          deadlineAtMs: 40_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        pathEnv: "",
        nowMs: () => currentTime,
        deadlineAtMs: sessionDeadline,
        workerEnabled: true,
        transport: mockTransport,
      });

      expect(turnModels).toHaveLength(2);
      expect(turnDeadlines[0]).toBe(1_000 + 300_000); // 301_000
      expect(turnDeadlines[1]).toBe(301_000 + 300_000); // 601_000 (fresh 300s for sibling)
      expect(result.license.state).toBe("succeeded");
    });

    it("P6-4: Multiple model/tool rounds exceed 60s safely", async () => {
      let currentTime = 1_000;
      let rounds = 0;

      const mockTransport = {
        complete: vi.fn(async () => {
          rounds++;
          currentTime += 40_000; // 40s per round
          if (rounds < 3) {
            return {
              text: JSON.stringify({
                type: "tool_request",
                operation: "project.read_file",
                request: { path: "src/index.ts" },
              }),
            };
          }
          return {
            text: JSON.stringify({ type: "complete", summary: "3 rounds finished in 120s" }),
          };
        }),
      };

      const router = createQuotaRouter({
        catalog: C1_OPENCODE_FREE_CATALOG,
        nowMs: 1_000,
      });

      const result = await executeModeBWorker({
        kind: MODE_B_INVESTIGATE,
        request: { projectId: "project-ashley" },
        purpose: "multi round test",
        isolationRoot: "C:\\tmp\\test-isolation",
        binaryPath: "opencode",
        pinnedVersion: C1_OPENCODE_FREE_CATALOG.pinnedOpenCodeVersion,
        quotaPath: "C:\\tmp\\quota.json",
        router,
        persistQuota: () => {},
        dispatchers: {
          executeProjectInspectionV2: vi.fn(async () => ({
            license: { state: "succeeded" as const, profile: "project_investigation" },
            observation: { text: "content" },
            dispatchAttempted: true,
          })) as any,
          executeWorkspaceExperimentV2: vi.fn() as any,
        },
        inspectionBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          projectInspectionPreparationDeadlineAtMs: 10_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        workspaceBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          deadlineAtMs: 40_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        pathEnv: "",
        nowMs: () => currentTime,
        deadlineAtMs: 1_000 + DETACHED_WORKER_MAX_WALL_CLOCK_MS,
        workerEnabled: true,
        transport: mockTransport,
      });

      // Total time consumed: 120s (well beyond 60s legacy bound)
      expect(rounds).toBe(3);
      expect(currentTime - 1_000).toBe(120_000);
      expect(result.license.state).toBe("succeeded");
      expect(result.summary).toBe("3 rounds finished in 120s");
    });

    it("P6-5: Insufficient finalization reserve prevents a new turn", async () => {
      let currentTime = 1_000;
      const tightDeadline = 1_000 + 20_000; // Only 20s left (less than 30s reserve)

      const mockTransport = {
        complete: vi.fn(async () => {
          return { text: JSON.stringify({ type: "complete", summary: "done" }) };
        }),
      };

      const router = createQuotaRouter({
        catalog: C1_OPENCODE_FREE_CATALOG,
        nowMs: 1_000,
      });

      const result = await executeModeBWorker({
        kind: MODE_B_INVESTIGATE,
        request: { projectId: "project-ashley" },
        purpose: "reserve test",
        isolationRoot: "C:\\tmp\\test-isolation",
        binaryPath: "opencode",
        pinnedVersion: C1_OPENCODE_FREE_CATALOG.pinnedOpenCodeVersion,
        quotaPath: "C:\\tmp\\quota.json",
        router,
        persistQuota: () => {},
        dispatchers: {
          executeProjectInspectionV2: vi.fn() as any,
          executeWorkspaceExperimentV2: vi.fn() as any,
        },
        inspectionBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          projectInspectionPreparationDeadlineAtMs: 10_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        workspaceBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          deadlineAtMs: 40_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        pathEnv: "",
        nowMs: () => currentTime,
        deadlineAtMs: tightDeadline,
        workerEnabled: true,
        transport: mockTransport,
      });

      expect(mockTransport.complete).not.toHaveBeenCalled();
      expect(result.license.state).toBe("none");
      expect(result.license.error).toBe("deadline_exhausted");
    });

    it("P6-6: Child timeout waits for confirmed termination before next turn", async () => {
      let turn1Terminated = false;
      let turn2Started = false;
      let turn1TerminatedBeforeTurn2 = false;

      const mockTransport = {
        complete: vi.fn(async () => {
          if (!turn1Terminated) {
            // Model 1: simulate delay in child termination
            await new Promise((resolve) => setTimeout(resolve, 20));
            turn1Terminated = true;
            throw new Error("opencode_timeout");
          }
          // Model 2
          turn2Started = true;
          turn1TerminatedBeforeTurn2 = turn1Terminated;
          return { text: JSON.stringify({ type: "complete", summary: "turn 2 done" }) };
        }),
      };

      const router = createQuotaRouter({
        catalog: C1_OPENCODE_FREE_CATALOG,
        nowMs: 1_000,
      });

      const result = await executeModeBWorker({
        kind: MODE_B_INVESTIGATE,
        request: { projectId: "project-ashley" },
        purpose: "child termination ordering test",
        isolationRoot: "C:\\tmp\\test-isolation",
        binaryPath: "opencode",
        pinnedVersion: C1_OPENCODE_FREE_CATALOG.pinnedOpenCodeVersion,
        quotaPath: "C:\\tmp\\quota.json",
        router,
        persistQuota: () => {},
        dispatchers: {
          executeProjectInspectionV2: vi.fn() as any,
          executeWorkspaceExperimentV2: vi.fn() as any,
        },
        inspectionBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          projectInspectionPreparationDeadlineAtMs: 10_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        workspaceBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          deadlineAtMs: 40_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        pathEnv: "",
        nowMs: () => 1_000,
        deadlineAtMs: 1_000 + DETACHED_WORKER_MAX_WALL_CLOCK_MS,
        workerEnabled: true,
        transport: mockTransport,
      });

      expect(turn1TerminatedBeforeTurn2).toBe(true);
      expect(turn2Started).toBe(true);
      expect(result.license.state).toBe("succeeded");
    });

    it("P6-7: No turn starts after outer deadline", async () => {
      const now = 3_605_000;
      const expiredDeadline = 3_600_000;

      const mockTransport = {
        complete: vi.fn(async () => ({ text: "{}" })),
      };

      const router = createQuotaRouter({
        catalog: C1_OPENCODE_FREE_CATALOG,
        nowMs: now,
      });

      const result = await executeModeBWorker({
        kind: MODE_B_INVESTIGATE,
        request: { projectId: "project-ashley" },
        purpose: "expired test",
        isolationRoot: "C:\\tmp\\test-isolation",
        binaryPath: "opencode",
        pinnedVersion: C1_OPENCODE_FREE_CATALOG.pinnedOpenCodeVersion,
        quotaPath: "C:\\tmp\\quota.json",
        router,
        persistQuota: () => {},
        dispatchers: {
          executeProjectInspectionV2: vi.fn() as any,
          executeWorkspaceExperimentV2: vi.fn() as any,
        },
        inspectionBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          projectInspectionPreparationDeadlineAtMs: 10_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        workspaceBase: {
          messageEntityUuid: "msg-1", db: new DatabaseSync(":memory:"), masterMode: "normal" as any, registry: { projects: {} } as any,
          deadlineAtMs: 40_000, childExecutionDeadlineAtMs: 20_000, childTerminationDeadlineAtMs: 30_000, settlementDeadlineAtMs: 40_000,
        },
        pathEnv: "",
        nowMs: () => now,
        deadlineAtMs: expiredDeadline,
        workerEnabled: true,
        transport: mockTransport,
      });

      expect(mockTransport.complete).not.toHaveBeenCalled();
      expect(result.license.state).toBe("none");
      expect(result.license.error).toBe("deadline_exhausted");
    });

    it("P6-8: Outer 1h bound is absolute", () => {
      expect(DETACHED_WORKER_MAX_WALL_CLOCK_MS).toBe(3_600_000);
      expect(DETACHED_OPERATION_DEFAULT_DEADLINE_MS).toBe(3_600_000);
    });
  });
});
