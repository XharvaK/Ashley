import { describe, expect, it, vi } from "vitest";
import { appendInboxEvent, updateCycleState } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar, makeSemanticSettlement } from "../test-support.js";
import {
  runLiveCognitiveTurn,
  isAuthorizedDeferredFrontierContinuation,
  isPeriodicCognitionEnabled,
  isPeriodicLineageTriggerRef,
  isPeriodicRecoveryDispatchBlocked,
  PERIODIC_RECOVERY_DISPATCH_BLOCKED,
} from "./live.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation, InboxEvent } from "../types.js";
import { getWake } from "../wake/ledger.js";
import {
  insertDeferredFrontierRecord,
  claimDueDeferredFrontier,
  exhaustDeferredFrontier,
} from "../frontier/ledger.js";
import {
  reservePrivateThought,
  bindPrivateReservationInvocation,
  recordPrivateReservationNoDispatchProof,
  commitPrivateDispatch,
  getPrivateReservation,
} from "../private-budget/ledger.js";
import { reconcilePolicyClock } from "../private-budget/policy-time-ledger.js";
import { settleFrontierTerminalReservation } from "../frontier/coordinator.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function deps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb: openTestSidecar(),
      completeChat: vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake", modelAlias: "fake", resolvedModelId: null,
    })),
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
    ...overrides,
  };
}

function event(sidecar: ReturnType<typeof openTestSidecar>) {
  const cycle = admitTestCycle(sidecar, {
    cycleId: "cycle-live",
    conversationId: "thread-live",
    triggerKind: "owner_message",
    triggerRef: "owner-live",
    occupantId: "doc",
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId: "thread-live",
    text: "hello live",
    discordMessageIds: ["discord-live"],
    nowMs: 2,
  });
  return appendInboxEvent(sidecar, {
    conversationId: "thread-live",
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerId: "doc", channel: "discord", threadId: "thread-live" },
    createdAtMs: 2,
  });
}

describe("v0.2.1 live dispatcher", () => {
  it("maps one admitted event through Thought and the projector seam", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openTestSidecar();
    const attentionDb = openTestSidecar();
    const projectOutbox = vi.fn(async () => undefined);
    const result = await runLiveCognitiveTurn({
      sidecar,
      nuclear,
      event: event(sidecar),
      deps: deps({ attentionDb, projectOutbox }),
      projector: {
        project: projectOutbox,
        projectSystem: vi.fn(async () => undefined),
      },
    });
    expect(result).toMatchObject({ published: true, acceptedSettlements: 1 });
    expect(projectOutbox).toHaveBeenCalledTimes(1);
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
    sidecar.close();
    nuclear.close();
    attentionDb.close();
  });
});

describe("F1 Frontier & Dispatch Continuation Witnesses", () => {
  const BASE_TIME = 2_000_000;

  function setupScenario(params?: { triggerKind?: "owner_message" | "idle_opportunity" }) {
    const sidecar = openTestSidecar();
    const nuclear = openTestSidecar();
    const attentionDb = openTestSidecar();
    reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: BASE_TIME, authorizationRef: "owner:test" });

    const triggerKind = params?.triggerKind ?? "idle_opportunity";
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle:frontier:test",
      conversationId: "thread:frontier:test",
      triggerKind,
      occupantId: "doc",
      nowMs: BASE_TIME,
    });

    return { sidecar, nuclear, attentionDb, cycle };
  }

  function makeInboxEvent(overrides: Partial<InboxEvent> & Pick<InboxEvent, "conversationId" | "kind" | "wakeId">): InboxEvent {
    return {
      id: `ev:${Math.random().toString(36).slice(2)}`,
      payload: {},
      createdAtMs: BASE_TIME,
      status: "claimed",
      claimToken: null,
      workerId: null,
      leaseExpiresAtMs: null,
      attemptCount: 0,
      claimedAtMs: null,
      consumedAtMs: null,
      lastError: null,
      ...overrides,
    };
  }

  it("FRONTIER_WAITING_DOES_NOT_AUTHORIZE_PROVIDER_EXECUTION", async () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:fw:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:fw:1",
        attemptId: "att:fw:1",
        nowMs: BASE_TIME,
      });
      commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:fw:1",
        attemptId: "att:fw:1",
        nowMs: BASE_TIME,
      });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 10_000,
        latestEvidenceRowId: "ev:fw:1",
        nowMs: BASE_TIME,
      });
      expect(frontier.state).toBe("waiting");

      const event: InboxEvent = makeInboxEvent({
        id: "ev:inbox:fw",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: BASE_TIME,
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, event, wake, committedRes, cycle)).toBe(false);

      await expect(
        runLiveCognitiveTurn({
          sidecar,
          nuclear,
          event,
          deps: deps({ attentionDb }),
        }),
      ).rejects.toThrow("private_budget_reservation_not_dispatchable");
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_RUNNING_EXACT_IDENTITY_AUTHORIZES_CONTINUATION", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:fr:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:fr:1",
        attemptId: "att:fr:1",
        nowMs: BASE_TIME,
      });
      commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:fr:1",
        attemptId: "att:fr:1",
        nowMs: BASE_TIME,
      });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:fr:1",
        nowMs: BASE_TIME,
      });

      const claimNow = Date.now();
      const claim = claimDueDeferredFrontier(sidecar, frontier.frontierId, "worker:claim:1", 60_000, claimNow);
      expect(claim.claimed).toBe(true);
      const claimedFrontier = claim.frontier!;
      expect(claimedFrontier.state).toBe("running");

      const event: InboxEvent = makeInboxEvent({
        id: "ev:inbox:fr",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        claimToken: claimedFrontier.claimToken!,
        leaseExpiresAtMs: claimedFrontier.leaseExpiresAtMs!,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: claimNow,
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, event, wake, committedRes, cycle)).toBe(true);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_RUNNING_WRONG_CLAIM_TOKEN_REFUSED", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:wt:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:wt:1",
        attemptId: "att:wt:1",
        nowMs: BASE_TIME,
      });
      commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:wt:1",
        attemptId: "att:wt:1",
        nowMs: BASE_TIME,
      });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:wt:1",
        nowMs: BASE_TIME,
      });
      const claim = claimDueDeferredFrontier(sidecar, frontier.frontierId, "worker:claim:correct", 60_000, BASE_TIME + 2_000);
      const claimedFrontier = claim.frontier!;

      const eventWrongToken: InboxEvent = makeInboxEvent({
        id: "ev:inbox:wt",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        claimToken: "wrong:token:mismatch",
        leaseExpiresAtMs: claimedFrontier.leaseExpiresAtMs!,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: BASE_TIME + 2_000,
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, eventWrongToken, wake, committedRes, cycle)).toBe(false);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_RUNNING_EXPIRED_CLAIM_REFUSED", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:ec:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:ec:1",
        attemptId: "att:ec:1",
        nowMs: BASE_TIME,
      });
      commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:ec:1",
        attemptId: "att:ec:1",
        nowMs: BASE_TIME,
      });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:ec:1",
        nowMs: BASE_TIME,
      });
      const claim = claimDueDeferredFrontier(sidecar, frontier.frontierId, "worker:claim:ec", 60_000, BASE_TIME + 2_000);
      const claimedFrontier = claim.frontier!;

      // Set lease to past
      sidecar.prepare("UPDATE deferred_reactive_frontiers SET lease_expires_at_ms = ? WHERE frontier_id = ?").run(Date.now() - 10_000, frontier.frontierId);

      const event: InboxEvent = makeInboxEvent({
        id: "ev:inbox:ec",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        claimToken: claimedFrontier.claimToken!,
        leaseExpiresAtMs: Date.now() - 10_000,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: BASE_TIME + 2_000,
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, event, wake, committedRes, cycle)).toBe(false);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_RUNNING_CURRENT_CLAIM_ACCEPTED", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:cc:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:cc:1",
        attemptId: "att:cc:1",
        nowMs: BASE_TIME,
      });
      commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:cc:1",
        attemptId: "att:cc:1",
        nowMs: BASE_TIME,
      });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:cc:1",
        nowMs: BASE_TIME,
      });
      const claim = claimDueDeferredFrontier(sidecar, frontier.frontierId, "token:current:claim", 120_000, Date.now());
      const claimedFrontier = claim.frontier!;

      const event: InboxEvent = makeInboxEvent({
        id: "ev:inbox:cc",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        claimToken: claimedFrontier.claimToken!,
        leaseExpiresAtMs: claimedFrontier.leaseExpiresAtMs!,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: Date.now(),
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, event, wake, committedRes, cycle)).toBe(true);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("RECLAIMED_FRONTIER_OLD_EVENT_CANNOT_AUTHORIZE_PROVIDER", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:rc:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:rc:1",
        attemptId: "att:rc:1",
        nowMs: BASE_TIME,
      });
      commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:rc:1",
        attemptId: "att:rc:1",
        nowMs: BASE_TIME,
      });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:rc:1",
        nowMs: BASE_TIME,
      });
      const claim1 = claimDueDeferredFrontier(sidecar, frontier.frontierId, "token:first", 10_000, BASE_TIME + 2_000);
      const oldEvent: InboxEvent = makeInboxEvent({
        id: "ev:inbox:old",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        claimToken: claim1.frontier!.claimToken!,
        leaseExpiresAtMs: claim1.frontier!.leaseExpiresAtMs!,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: BASE_TIME + 2_000,
      });

      // Reclaim with new token
      sidecar.prepare("UPDATE deferred_reactive_frontiers SET lease_expires_at_ms = ? WHERE frontier_id = ?").run(BASE_TIME + 2_500, frontier.frontierId);
      const claim2 = claimDueDeferredFrontier(sidecar, frontier.frontierId, "token:second", 60_000, BASE_TIME + 3_000);
      expect(claim2.claimed).toBe(true);
      expect(claim2.frontier!.claimToken).toBe("token:second");

      const wake = getWake(sidecar, cycle.wakeId)!;
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, oldEvent, wake, committedRes, cycle)).toBe(false);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_RUNNING_WRONG_CYCLE_ID_REFUSED", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:wcid:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, { reservationId: reservation.reservationId, invocationId: "inv:wcid:1", attemptId: "att:wcid:1", nowMs: BASE_TIME });
      commitPrivateDispatch(sidecar, { reservationId: reservation.reservationId, invocationId: "inv:wcid:1", attemptId: "att:wcid:1", nowMs: BASE_TIME });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:wcid:1",
        nowMs: BASE_TIME,
      });
      const claim = claimDueDeferredFrontier(sidecar, frontier.frontierId, "worker:wcid", 120_000, Date.now());
      const claimedFrontier = claim.frontier!;

      // Event carries a different cycleId — lineage refuses.
      const eventWrongCycle: InboxEvent = makeInboxEvent({
        id: "ev:inbox:wcid",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        claimToken: claimedFrontier.claimToken!,
        leaseExpiresAtMs: claimedFrontier.leaseExpiresAtMs!,
        payload: { frontierId: frontier.frontierId, cycleId: "cycle:other:wrong" },
        createdAtMs: BASE_TIME + 1_000,
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, eventWrongCycle, wake, committedRes, cycle)).toBe(false);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_RUNNING_WRONG_GENERATION_REFUSED", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:wgen:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, { reservationId: reservation.reservationId, invocationId: "inv:wgen:1", attemptId: "att:wgen:1", nowMs: BASE_TIME });
      commitPrivateDispatch(sidecar, { reservationId: reservation.reservationId, invocationId: "inv:wgen:1", attemptId: "att:wgen:1", nowMs: BASE_TIME });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:wgen:1",
        nowMs: BASE_TIME,
      });
      const claim = claimDueDeferredFrontier(sidecar, frontier.frontierId, "worker:wgen", 120_000, Date.now());
      const claimedFrontier = claim.frontier!;

      const eventOk: InboxEvent = makeInboxEvent({
        id: "ev:inbox:wgen",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        claimToken: claimedFrontier.claimToken!,
        leaseExpiresAtMs: claimedFrontier.leaseExpiresAtMs!,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: BASE_TIME + 1_000,
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      // Tamper frontier generation to differ from cycle.generation
      sidecar.prepare("UPDATE deferred_reactive_frontiers SET generation = 999 WHERE frontier_id = ?").run(frontier.frontierId);
      // Now frontier.generation !== cycle.generation => refused
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, eventOk, wake, committedRes, cycle)).toBe(false);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_RUNNING_WRONG_WAKE_REFUSED", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:wwake:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, { reservationId: reservation.reservationId, invocationId: "inv:wwake:1", attemptId: "att:wwake:1", nowMs: BASE_TIME });
      commitPrivateDispatch(sidecar, { reservationId: reservation.reservationId, invocationId: "inv:wwake:1", attemptId: "att:wwake:1", nowMs: BASE_TIME });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:wwake:1",
        nowMs: BASE_TIME,
      });
      const claim = claimDueDeferredFrontier(sidecar, frontier.frontierId, "worker:wwake", 120_000, Date.now());
      const claimedFrontier = claim.frontier!;

      // Event carries a wakeId that does NOT match cycle.wakeId — lineage fails.
      const eventWrongWake: InboxEvent = makeInboxEvent({
        id: "ev:inbox:wwake",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: "wake:other:mismatch",
        claimToken: claimedFrontier.claimToken!,
        leaseExpiresAtMs: claimedFrontier.leaseExpiresAtMs!,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: BASE_TIME + 1_000,
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      // wake.wakeId !== event.wakeId ("wake:other:mismatch") => refused
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, eventWrongWake, wake, committedRes, cycle)).toBe(false);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_RUNNING_WRONG_FRONTIER_CYCLE_REFUSED", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario();
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:wfcyc:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, { reservationId: reservation.reservationId, invocationId: "inv:wfcyc:1", attemptId: "att:wfcyc:1", nowMs: BASE_TIME });
      commitPrivateDispatch(sidecar, { reservationId: reservation.reservationId, invocationId: "inv:wfcyc:1", attemptId: "att:wfcyc:1", nowMs: BASE_TIME });
      const committedRes = getPrivateReservation(sidecar, reservation.reservationId)!;

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:wfcyc:1",
        nowMs: BASE_TIME,
      });
      const claim = claimDueDeferredFrontier(sidecar, frontier.frontierId, "worker:wfcyc", 120_000, Date.now());
      const claimedFrontier = claim.frontier!;

      const eventOk: InboxEvent = makeInboxEvent({
        id: "ev:inbox:wfcyc",
        conversationId: cycle.conversationId,
        kind: "frontier_wake",
        wakeId: cycle.wakeId,
        claimToken: claimedFrontier.claimToken!,
        leaseExpiresAtMs: claimedFrontier.leaseExpiresAtMs!,
        payload: { frontierId: frontier.frontierId, cycleId: cycle.cycleId },
        createdAtMs: BASE_TIME + 1_000,
      });

      const wake = getWake(sidecar, cycle.wakeId)!;
      // Tamper frontier to point to a different cycleId — same conversation,
      // valid token, matching lease, running state, but frontier.cycleId !== cycle.cycleId.
      sidecar.prepare("UPDATE deferred_reactive_frontiers SET cycle_id = 'cycle:other:injected' WHERE frontier_id = ?").run(frontier.frontierId);
      expect(isAuthorizedDeferredFrontierContinuation(sidecar, eventOk, wake, committedRes, cycle)).toBe(false);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("PRIVATE_FRONTIER_ZERO_RESERVATION_FAILS_CLOSED", async () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario({ triggerKind: "idle_opportunity" });
    try {
      const event: InboxEvent = makeInboxEvent({
        id: "ev:inbox:pzero",
        conversationId: cycle.conversationId,
        kind: "idle_opportunity",
        wakeId: cycle.wakeId,
        payload: { cycleId: cycle.cycleId },
        createdAtMs: BASE_TIME,
      });

      await expect(
        runLiveCognitiveTurn({
          sidecar,
          nuclear,
          event,
          deps: deps({ attentionDb }),
        }),
      ).rejects.toThrow("private_budget_reservation_missing");
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("NON_PRIVATE_FRONTIER_ZERO_RESERVATION_REMAINS_ALLOWED", async () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario({ triggerKind: "owner_message" });
    try {
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: cycle.conversationId,
        text: "non-private message",
        discordMessageIds: ["discord:np:1"],
        nowMs: BASE_TIME,
      });
      const event: InboxEvent = makeInboxEvent({
        id: "ev:inbox:npzero",
        conversationId: cycle.conversationId,
        kind: "owner_message",
        wakeId: cycle.wakeId,
        payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId },
        createdAtMs: BASE_TIME,
      });

      const projectOutbox = vi.fn(async () => undefined);
      const result = await runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event,
        deps: deps({ attentionDb, projectOutbox }),
        projector: {
          project: projectOutbox,
          projectSystem: vi.fn(async () => undefined),
        },
      });
      expect(result.published).toBe(true);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });

  it("FRONTIER_CAPACITY_EXHAUSTION_RELEASES_PROVEN_NO_SEND_PARENT_WITHOUT_RESTART", () => {
    const { sidecar, nuclear, attentionDb, cycle } = setupScenario({ triggerKind: "idle_opportunity" });
    try {
      const resResult = reservePrivateThought(sidecar, {
        admissionId: "adm:fce:1",
        wakeId: cycle.wakeId,
        conversationId: cycle.conversationId,
        policyId: "private-v1",
        wallClockNowMs: BASE_TIME,
      });
      if (resResult.kind !== "reserved") throw new Error("reserve_failed");
      const reservation = resResult.reservation;
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:fce:1",
        attemptId: "att:fce:1",
        nowMs: BASE_TIME,
      });
      recordPrivateReservationNoDispatchProof(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:fce:1",
        attemptId: "att:fce:1",
        proofRef: "proof:fce:1",
        nowMs: BASE_TIME,
      });

      const frontier = insertDeferredFrontierRecord(sidecar, {
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: 1,
        nextEligibleAtMs: BASE_TIME + 1_000,
        latestEvidenceRowId: "ev:fce:1",
        nowMs: BASE_TIME,
      });

      exhaustDeferredFrontier(sidecar, frontier.frontierId, BASE_TIME + 2_000, "capacity_wait_max_duration_exceeded");
      updateCycleState(sidecar, cycle.cycleId, "idle", BASE_TIME + 2_000);

      settleFrontierTerminalReservation(sidecar, cycle.wakeId, cycle.conversationId, BASE_TIME + 2_000);

      const resAfter = getPrivateReservation(sidecar, reservation.reservationId);
      expect(resAfter).toMatchObject({
        state: "released",
        dispatchTruth: "not_started",
        releaseProofRef: "proof:fce:1",
      });
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
    }
  });
});

describe("P0 periodic recovery dispatch fence (R7 §§22.2–22.3)", () => {
  const BASE_TIME = 2_000_000;

  function setupPeriodicScenario(tag: string) {
    const sidecar = openTestSidecar();
    const nuclear = openTestSidecar();
    const attentionDb = openTestSidecar();
    reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: BASE_TIME, authorizationRef: `owner:${tag}` });
    const cycle = admitTestCycle(sidecar, {
      cycleId: `cycle:gate:${tag}`,
      conversationId: `thread:gate:${tag}`,
      triggerKind: "idle_opportunity",
      occupantId: "doc",
      nowMs: BASE_TIME,
    });
    // P1 will mint `periodic:` trigger_refs through the schedule ledger; P0
    // stamps the same mechanical lineage identity directly (the gate reads
    // the bound wake's trigger_ref prefix — never semantic content).
    sidecar.prepare("UPDATE wakes SET trigger_ref = ? WHERE wake_id = ?").run(
      `periodic:occurrence:${tag}:${BASE_TIME}`,
      cycle.wakeId,
    );
    return { sidecar, nuclear, attentionDb, cycle };
  }

  function reserveHeld(
    sidecar: ReturnType<typeof openTestSidecar>,
    cycle: { wakeId: string; conversationId: string },
    tag: string,
  ) {
    const result = reservePrivateThought(sidecar, {
      admissionId: `adm:gate:${tag}`,
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      policyId: "private-v1",
      wallClockNowMs: BASE_TIME,
    });
    if (result.kind !== "reserved") throw new Error("reserve_failed");
    return result.reservation;
  }

  it("KILL_SWITCH_MISSING_ENV_FAILS_CLOSED", () => {
    expect(isPeriodicCognitionEnabled({})).toBe(false);
    expect(isPeriodicCognitionEnabled({ PERIODIC_COGNITION_ENABLED: undefined })).toBe(false);
    expect(isPeriodicCognitionEnabled({ PERIODIC_COGNITION_ENABLED: "" })).toBe(false);
    expect(isPeriodicCognitionEnabled({ PERIODIC_COGNITION_ENABLED: "0" })).toBe(false);
    expect(isPeriodicCognitionEnabled({ PERIODIC_COGNITION_ENABLED: "yes" })).toBe(false);
    expect(isPeriodicCognitionEnabled({ PERIODIC_COGNITION_ENABLED: "true" })).toBe(true);
    expect(isPeriodicCognitionEnabled({ PERIODIC_COGNITION_ENABLED: "1" })).toBe(true);
    expect(isPeriodicCognitionEnabled({ PERIODIC_COGNITION_ENABLED: " True " })).toBe(true);
    expect(isPeriodicLineageTriggerRef("periodic:occurrence:abc:123")).toBe(true);
    expect(isPeriodicLineageTriggerRef("trigger:owner")).toBe(false);
    expect(isPeriodicLineageTriggerRef(null)).toBe(false);
  });

  it("KILL_SWITCH_BOUND_PREDISPATCH_NO_NEW_DISPATCH", async () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "0");
    const { sidecar, nuclear, attentionDb, cycle } = setupPeriodicScenario("blocked");
    try {
      const reservation = reserveHeld(sidecar, cycle, "blocked");
      const completeChat = vi.fn(async () => ({
        text: JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "fake",
        resolvedModelId: null,
      }));
      const event: InboxEvent = {
        id: "ev:gate:blocked",
        conversationId: cycle.conversationId,
        wakeId: cycle.wakeId,
        kind: "idle_opportunity",
        payload: { cycleId: cycle.cycleId, privateBudgetReservationId: reservation.reservationId },
        createdAtMs: BASE_TIME,
        status: "claimed",
        claimToken: null,
        workerId: null,
        leaseExpiresAtMs: null,
        attemptCount: 0,
        claimedAtMs: null,
        consumedAtMs: null,
        lastError: null,
      };
      await expect(
        runLiveCognitiveTurn({ sidecar, nuclear, event, deps: deps({ attentionDb, completeChat }) }),
      ).rejects.toThrow(PERIODIC_RECOVERY_DISPATCH_BLOCKED);
      // Zero new periodic provider dispatch.
      expect(completeChat).not.toHaveBeenCalled();
      // Binding retained, never unbound; no terminal fabrication.
      expect(getPrivateReservation(sidecar, reservation.reservationId)).toMatchObject({ state: "held" });
      expect(getWake(sidecar, cycle.wakeId)?.state).toBe("pending");
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
      vi.unstubAllEnvs();
    }
  });

  it("KILL_SWITCH_COMMITTED_CAN_FINISH", async () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "");
    const { sidecar, nuclear, attentionDb, cycle } = setupPeriodicScenario("committed");
    try {
      const reservation = reserveHeld(sidecar, cycle, "committed");
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:gate:committed",
        attemptId: "att:gate:committed",
        nowMs: BASE_TIME,
      });
      commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:gate:committed",
        attemptId: "att:gate:committed",
        nowMs: BASE_TIME,
      });
      const committed = getPrivateReservation(sidecar, reservation.reservationId);
      const event: InboxEvent = {
        id: "ev:gate:committed",
        conversationId: cycle.conversationId,
        wakeId: cycle.wakeId,
        kind: "idle_opportunity",
        payload: { cycleId: cycle.cycleId, privateBudgetReservationId: reservation.reservationId },
        createdAtMs: BASE_TIME,
        status: "claimed",
        claimToken: null,
        workerId: null,
        leaseExpiresAtMs: null,
        attemptCount: 0,
        claimedAtMs: null,
        consumedAtMs: null,
        lastError: null,
      };
      // The gate does not stop committed/running work: it falls through to
      // existing execution truth (held-only refuses a second dispatch here;
      // the authorized frontier-continuation path is unchanged behavior).
      expect(isPeriodicRecoveryDispatchBlocked(sidecar, event, committed)).toBe(false);
      await expect(
        runLiveCognitiveTurn({ sidecar, nuclear, event, deps: deps({ attentionDb }) }),
      ).rejects.toThrow("private_budget_reservation_not_dispatchable");
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
      vi.unstubAllEnvs();
    }
  });

  it("COMMITTED_PRIVATE_RESERVATION_NEVER_REENTERS_HELD_ONLY_DISPATCH", async () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "0");
    const sidecar = openTestSidecar();
    const nuclear = openTestSidecar();
    const attentionDb = openTestSidecar();
    try {
      reconcilePolicyClock(sidecar, { policyId: "private-v1", wallClockNowMs: BASE_TIME, authorizationRef: "owner:held-only" });
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle:gate:held-only",
        conversationId: "thread:gate:held-only",
        triggerKind: "idle_opportunity",
        occupantId: "doc",
        nowMs: BASE_TIME,
      });
      const reservation = reserveHeld(sidecar, cycle, "held-only");
      bindPrivateReservationInvocation(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:gate:held-only",
        attemptId: "att:gate:held-only",
        nowMs: BASE_TIME,
      });
      commitPrivateDispatch(sidecar, {
        reservationId: reservation.reservationId,
        invocationId: "inv:gate:held-only",
        attemptId: "att:gate:held-only",
        nowMs: BASE_TIME,
      });
      const event: InboxEvent = {
        id: "ev:gate:held-only",
        conversationId: cycle.conversationId,
        wakeId: cycle.wakeId,
        kind: "idle_opportunity",
        payload: { cycleId: cycle.cycleId, privateBudgetReservationId: reservation.reservationId },
        createdAtMs: BASE_TIME,
        status: "claimed",
        claimToken: null,
        workerId: null,
        leaseExpiresAtMs: null,
        attemptCount: 0,
        claimedAtMs: null,
        consumedAtMs: null,
        lastError: null,
      };
      // Non-periodic committed work never re-enters held-only dispatch: no
      // committed → fresh-Thought loop.
      await expect(
        runLiveCognitiveTurn({ sidecar, nuclear, event, deps: deps({ attentionDb }) }),
      ).rejects.toThrow("private_budget_reservation_not_dispatchable");
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
      vi.unstubAllEnvs();
    }
  });

  it("KILL_SWITCH_DUE_TRIGGERS_UNAFFECTED", async () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "0");
    const sidecar = openTestSidecar();
    const nuclear = openTestSidecar();
    const attentionDb = openTestSidecar();
    try {
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle:gate:owner",
        conversationId: "thread:gate:owner",
        triggerKind: "owner_message",
        occupantId: "doc",
        nowMs: BASE_TIME,
      });
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: cycle.conversationId,
        text: "owner message while periodic is disabled",
        discordMessageIds: ["discord:gate:owner"],
        nowMs: BASE_TIME,
      });
      const completeChat = vi.fn(async () => ({
        text: JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "fake",
        resolvedModelId: null,
      }));
      const projectOutbox = vi.fn(async () => undefined);
      const result = await runLiveCognitiveTurn({
        sidecar,
        nuclear,
        event: {
          id: "ev:gate:owner",
          conversationId: cycle.conversationId,
          wakeId: cycle.wakeId,
          kind: "owner_message",
          payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId },
          createdAtMs: BASE_TIME,
          status: "claimed",
          claimToken: null,
          workerId: null,
          leaseExpiresAtMs: null,
          attemptCount: 0,
          claimedAtMs: null,
          consumedAtMs: null,
          lastError: null,
        },
        deps: deps({ attentionDb, completeChat, projectOutbox }),
        projector: { project: projectOutbox, projectSystem: vi.fn(async () => undefined) },
      });
      expect(result.published).toBe(true);
      expect(completeChat).toHaveBeenCalled();
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
      vi.unstubAllEnvs();
    }
  });

  it("PERIODIC_ENABLED_GATE_PASSES_SAME_LINEAGE", () => {
    vi.stubEnv("PERIODIC_COGNITION_ENABLED", "1");
    const { sidecar, nuclear, attentionDb, cycle } = setupPeriodicScenario("enabled");
    try {
      const reservation = reserveHeld(sidecar, cycle, "enabled");
      const event: InboxEvent = {
        id: "ev:gate:enabled",
        conversationId: cycle.conversationId,
        wakeId: cycle.wakeId,
        kind: "idle_opportunity",
        payload: { cycleId: cycle.cycleId, privateBudgetReservationId: reservation.reservationId },
        createdAtMs: BASE_TIME,
        status: "claimed",
        claimToken: null,
        workerId: null,
        leaseExpiresAtMs: null,
        attemptCount: 0,
        claimedAtMs: null,
        consumedAtMs: null,
        lastError: null,
      };
      expect(isPeriodicRecoveryDispatchBlocked(sidecar, event, reservation)).toBe(false);
    } finally {
      sidecar.close();
      nuclear.close();
      attentionDb.close();
      vi.unstubAllEnvs();
    }
  });
});
