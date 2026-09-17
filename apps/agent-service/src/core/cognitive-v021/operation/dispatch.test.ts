import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import type { DeliveryIntent, ObservationIntentSemanticOutput } from "../types.js";
import { OutboxDeliveryProjector } from "../delivery/outbox-projector.js";
import { claimPendingCognitiveDeliveries } from "../delivery/pending.js";
import { recheckOwnerPublicationReservation } from "../settlement/publish.js";
import {
  admitDetachedOperation,
  getDetachedOperation,
  markDetachedOperationStarted,
  setDetachedOperationTerminal,
} from "./detached.js";
import {
  authorizeInterimSpeech,
  getInterimOutbox,
  getInterimOutboxByOperation,
  recheckInterimPublicationReservation,
  updateInterimStatus,
} from "./interim.js";
import {
  detachInvestigateIntent,
  dispatchDetachedOperation,
  type DetachedWorker,
} from "./dispatch.js";

const INTENT: ObservationIntentSemanticOutput = {
  kind: "observation_intent",
  operationKind: "project.investigate",
  request: { projectId: "project-ashley", focus: "apps/agent-service" },
  purpose: "investigate the current project",
  evidenceNeed: "bounded file evidence",
  existingRefs: [],
};

const HOLD = { mode: "hold" as const, surfaceDraft: "Yeah, give me a bit. I'm going to look through it." };
const INTENT_WITH_HOLD: ObservationIntentSemanticOutput = { ...INTENT, interimSpeech: HOLD };

function origin(conversationId = "thread-detach") {
  const sidecar = openTestSidecar();
  const cycle = admitTestCycle(sidecar, {
    cycleId: `cycle-${conversationId}`,
    conversationId,
    triggerKind: "owner_message",
    triggerRef: "owner-1",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  return { sidecar, cycle };
}

function detachInput(overrides: Record<string, unknown> = {}) {
  return {
    intent: INTENT_WITH_HOLD,
    cycleId: "cycle-thread-detach",
    generation: 1,
    conversationId: "thread-detach",
    originOwnerEventId: "owner-1",
    ownerId: "doc",
    nowMs: 1_000,
    ...overrides,
  };
}

const testIntent: DeliveryIntent = {
  ownerId: "doc",
  channel: "discord",
  threadId: "thread-detach",
  conversationId: "thread-detach",
  trigger: "owner_message_reactive",
  deliveryLane: "reactive",
  purpose: "licensed_speech",
};

const successWorker: DetachedWorker = async () => ({ ok: true, payload: { operation: "project.investigate", summary: "found it" } });

/** Manually-released worker gate. Method scope keeps narrowing sound across awaits. */
function manualWorkerGate<T>() {
  let release: ((value: T) => void) | undefined;
  return {
    promise: new Promise<T>((resolve) => { release = resolve; }),
    release(value: T): void {
      if (!release) throw new Error("worker never started");
      release(value);
    },
  };
}

describe("detached investigate admission", () => {
  it("admits the operation and authorizes the interim hold", () => {
    const { sidecar } = origin();
    try {
      const detached = detachInvestigateIntent(sidecar, detachInput());
      expect(detached.detached).toBe(true);
      if (!detached.detached) return;
      expect(detached.created).toBe(true);
      expect(detached.interimAuthored).toBe(true);
      expect(detached.interimId).toBeGreaterThan(0);
      expect(detached.operation.state).toBe("admitted");
      expect(detached.operation.operationId.startsWith("detached-operation:")).toBe(true);
      const interim = getInterimOutbox(sidecar, detached.interimId!);
      expect(interim).toMatchObject({
        operationId: detached.operation.operationId,
        surfaceDraft: HOLD.surfaceDraft,
        sendStatus: "pending",
      });
      expect(interim?.projectionKey).toBe(`interim:${detached.interimId}`);
      expect(getDetachedOperation(sidecar, detached.operation.operationId)?.interimOutboxRef)
        .toBe(`interim:${detached.interimId}`);
    } finally {
      sidecar.close();
    }
  });

  it("admits without interim ownership when Thought authors no hold", () => {
    const { sidecar } = origin();
    try {
      const detached = detachInvestigateIntent(sidecar, detachInput({ intent: INTENT }));
      expect(detached.detached).toBe(true);
      if (!detached.detached) return;
      expect(detached.interimAuthored).toBe(false);
      expect(detached.interimId).toBe(null);
      expect(getInterimOutboxByOperation(sidecar, detached.operation.operationId)).toBe(null);
    } finally {
      sidecar.close();
    }
  });

  it("refuses non-investigate kinds and malformed input without touching ownership", () => {
    const { sidecar } = origin();
    try {
      expect(detachInvestigateIntent(sidecar, detachInput({
        intent: { ...INTENT, operationKind: "project.inspect" },
      }))).toEqual({ detached: false, reason: "not_detachable_kind" });
      expect(detachInvestigateIntent(sidecar, detachInput({ ownerId: "" })))
        .toEqual({ detached: false, reason: "invalid_detach_request" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM detached_operations").get())
        .toMatchObject({ count: 0 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM operation_interim_outbox").get())
        .toMatchObject({ count: 0 });
    } finally {
      sidecar.close();
    }
  });

  it("refuses a second pending operation for the same conversation", () => {
    const { sidecar } = origin();
    try {
      expect(detachInvestigateIntent(sidecar, detachInput()).detached).toBe(true);
      expect(detachInvestigateIntent(sidecar, detachInput({ cycleId: "cycle-thread-detach-2" })))
        .toEqual({ detached: false, reason: "operation_already_pending" });
    } finally {
      sidecar.close();
    }
  });

  it("authorizes no interim speech without admission", () => {
    const { sidecar } = origin();
    try {
      expect(authorizeInterimSpeech(sidecar, {
        operationId: "detached-operation:missing",
        surfaceDraft: "hello",
        deliveryIntent: testIntent,
        nowMs: 1_000,
      })).toEqual({ ok: false, reason: "detached_operation_missing" });

      const admitted = admitDetachedOperation(sidecar, {
        idempotencyKey: "key-terminal",
        conversationId: "thread-detach",
        originCycleId: "cycle-thread-detach",
        originGeneration: 1,
        originOwnerEventId: "owner-1",
        operationKind: "project.investigate",
        request: { projectId: "project-ashley" },
        purpose: "p",
        evidenceNeed: "e",
        operationDeadlineAtMs: 60_000,
        nowMs: 1_000,
      });
      if (!admitted.ok) throw new Error("admission failed");
      const opId = admitted.operation.operationId;
      expect(markDetachedOperationStarted(sidecar, opId, { startProofRef: "s", nowMs: 2_000 }).ok).toBe(true);
      expect(setDetachedOperationTerminal(sidecar, opId, { terminalState: "succeeded", nowMs: 3_000 }).ok).toBe(true);
      expect(authorizeInterimSpeech(sidecar, {
        operationId: opId,
        surfaceDraft: "late promise",
        deliveryIntent: testIntent,
        nowMs: 4_000,
      })).toEqual({ ok: false, reason: "detached_operation_not_admittable" });
    } finally {
      sidecar.close();
    }
  });
});

describe("detached worker dispatch", () => {
  it("starts with proof, stores worker evidence, and succeeds terminally", async () => {
    const { sidecar } = origin();
    try {
      const detached = detachInvestigateIntent(sidecar, detachInput());
      if (!detached.detached) throw new Error("detach failed");
      const opId = detached.operation.operationId;
      const result = await dispatchDetachedOperation(sidecar, opId, successWorker, { nowMs: 2_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.operation).toMatchObject({ state: "succeeded", terminalState: "succeeded" });
      expect(result.operation.startProofRef).toBe(`worker-dispatch:${opId}:2000`);
      expect(result.operation.observationRef).toBe(`v021:observation:detached:${opId}`);
      const stored = sidecar.prepare(
        "SELECT provenance, payload_json FROM observations WHERE observation_id = ?",
      ).get(`v021:observation:detached:${opId}`) as { provenance: string; payload_json: string };
      expect(stored.provenance).toBe("opencode-worker:project.investigate");
      expect(JSON.parse(stored.payload_json)).toMatchObject({ summary: "found it" });
    } finally {
      sidecar.close();
    }
  });

  it("persists worker failure as failed with the worker error code", async () => {
    const { sidecar } = origin();
    try {
      const detached = detachInvestigateIntent(sidecar, detachInput());
      if (!detached.detached) throw new Error("detach failed");
      const result = await dispatchDetachedOperation(
        sidecar,
        detached.operation.operationId,
        async () => ({ ok: false, errorCode: "worker_failed" }),
      );
      expect(result).toMatchObject({ ok: true, operation: { state: "failed", errorCode: "worker_failed" } });
    } finally {
      sidecar.close();
    }
  });

  it("persists a thrown dispatch as outcome_unknown without blind rerun", async () => {
    const { sidecar } = origin();
    try {
      const detached = detachInvestigateIntent(sidecar, detachInput());
      if (!detached.detached) throw new Error("detach failed");
      const opId = detached.operation.operationId;
      let calls = 0;
      const throwing: DetachedWorker = async () => {
        calls += 1;
        throw new Error("transport exploded mid-flight");
      };
      const result = await dispatchDetachedOperation(sidecar, opId, throwing);
      expect(result).toMatchObject({
        ok: true,
        operation: { state: "outcome_unknown", errorCode: "worker_dispatch_failed" },
      });
      // The ambiguous dispatch never reruns: a duplicate dispatch observes
      // terminal immutability instead of executing again.
      const again = await dispatchDetachedOperation(sidecar, opId, throwing);
      expect(again).toEqual({ ok: false, reason: "detached_operation_terminal_immutable", operation: (result as { operation: unknown }).operation });
      expect(calls).toBe(1);
    } finally {
      sidecar.close();
    }
  });

  it("refuses duplicate dispatch while started without rerunning the worker", async () => {
    const { sidecar } = origin();
    try {
      const detached = detachInvestigateIntent(sidecar, detachInput());
      if (!detached.detached) throw new Error("detach failed");
      const opId = detached.operation.operationId;
      const gate = manualWorkerGate<{ ok: true; payload: unknown }>();
      let calls = 0;
      const gated: DetachedWorker = () => {
        calls += 1;
        return gate.promise;
      };
      const first = dispatchDetachedOperation(sidecar, opId, gated, { nowMs: 2_000 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getDetachedOperation(sidecar, opId)?.state).toBe("started");
      const duplicate = await dispatchDetachedOperation(sidecar, opId, gated, { nowMs: 2_100 });
      expect(duplicate.ok).toBe(false);
      expect(calls).toBe(1);
      gate.release({ ok: true, payload: { done: true } });
      const settled = await first;
      expect(settled).toMatchObject({ ok: true, operation: { state: "succeeded" } });
    } finally {
      sidecar.close();
    }
  });

  it("reports a missing operation without throwing", async () => {
    const { sidecar } = origin();
    try {
      await expect(dispatchDetachedOperation(sidecar, "detached-operation:missing", successWorker))
        .resolves.toEqual({ ok: false, reason: "detached_operation_missing" });
    } finally {
      sidecar.close();
    }
  });
});

describe("interim delivery independence", () => {
  function interimNuclear() {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-interim-delivery",
      conversationId: "thread-interim-delivery",
      triggerKind: "owner_message",
      triggerRef: "owner-1",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    return { sidecar, nuclear, cycle };
  }

  it("projects the interim hold to a claimable Owner-DM reservation without touching the operation", async () => {
    const { sidecar, nuclear, cycle } = interimNuclear();
    try {
      const detached = detachInvestigateIntent(sidecar, {
        intent: INTENT_WITH_HOLD,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        conversationId: cycle.conversationId,
        originOwnerEventId: "owner-1",
        ownerId: "doc",
        nowMs: 1_000,
      });
      if (!detached.detached || detached.interimId == null) throw new Error("detach failed");
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.projectInterim(detached.interimId);
      expect(getInterimOutbox(sidecar, detached.interimId)?.sendStatus).toBe("projected");
      const reservation = nuclear.prepare(
        "SELECT id, state, draft_text, cognitive_v021_projection_key, destination_json FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
      ).get(`interim:${detached.interimId}`) as Record<string, unknown>;
      expect(reservation).toMatchObject({
        state: "reserved",
        draft_text: HOLD.surfaceDraft,
        destination_json: null,
      });
      // The hold is claimable on the existing cognitive Owner-DM lane.
      const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 2_000 });
      expect(claimed.map((delivery) => delivery.reservationId)).toContain(Number(reservation.id));
      // Recheck routes by the interim key to interim truth, never speech.
      expect(recheckOwnerPublicationReservation(
        nuclear,
        Number(reservation.id),
        3_000,
        { cognitiveSidecar: sidecar },
      )).toEqual({ ok: true });
      // Delivery-side activity never mutates operation truth.
      expect(getDetachedOperation(sidecar, detached.operation.operationId)?.state).toBe("admitted");
      // And the operation still dispatches afterwards.
      const dispatched = await dispatchDetachedOperation(
        sidecar,
        detached.operation.operationId,
        successWorker,
      );
      expect(dispatched).toMatchObject({ ok: true, operation: { state: "succeeded" } });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("a failed interim delivery neither cancels work nor blocks dispatch", async () => {
    const { sidecar, nuclear, cycle } = interimNuclear();
    try {
      const detached = detachInvestigateIntent(sidecar, {
        intent: INTENT_WITH_HOLD,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        conversationId: cycle.conversationId,
        originOwnerEventId: "owner-1",
        ownerId: "doc",
        nowMs: 1_000,
      });
      if (!detached.detached || detached.interimId == null) throw new Error("detach failed");
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.projectInterim(detached.interimId);
      // Simulate Discord-side failure: the hold suppresses, work continues.
      updateInterimStatus(sidecar, detached.interimId, "suppressed");
      const reservation = nuclear.prepare(
        "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
      ).get(`interim:${detached.interimId}`) as { id: number };
      expect(recheckInterimPublicationReservation(
        nuclear,
        Number(reservation.id),
        3_000,
        { cognitiveSidecar: sidecar },
      )).toEqual({ ok: false, reason: "interim_suppressed" });
      const dispatched = await dispatchDetachedOperation(
        sidecar,
        detached.operation.operationId,
        successWorker,
      );
      expect(dispatched).toMatchObject({ ok: true, operation: { state: "succeeded" } });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("missing and stale interim rows refuse with interim-specific reasons", async () => {
    const { sidecar, nuclear, cycle } = interimNuclear();
    try {
      const detached = detachInvestigateIntent(sidecar, {
        intent: INTENT_WITH_HOLD,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        conversationId: cycle.conversationId,
        originOwnerEventId: "owner-1",
        ownerId: "doc",
        nowMs: 1_000,
      });
      if (!detached.detached || detached.interimId == null) throw new Error("detach failed");
      const missing = nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            draft_text, created_at, cognitive_v021_projection_key,
            speech_outbox_id, destination_json)
         VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'reserved', ?, ?, ?, NULL, NULL)`,
      ).run(cycle.conversationId, "ghost hold", "1970-01-01T00:00:01.000Z", "interim:999999");
      expect(recheckOwnerPublicationReservation(
        nuclear,
        Number(missing.lastInsertRowid),
        2_000,
        { cognitiveSidecar: sidecar },
      )).toEqual({ ok: false, reason: "interim_missing" });

      // A newer cycle supersedes the interim's origin generation.
      admitTestCycle(sidecar, {
        conversationId: cycle.conversationId,
        triggerKind: "owner_message",
        triggerRef: "owner-2",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 5_000,
      });
      const projector2 = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 6_000 });
      await projector2.projectInterim(detached.interimId);
      const reservation = nuclear.prepare(
        "SELECT id FROM delivery_reservations WHERE cognitive_v021_projection_key = ?",
      ).get(`interim:${detached.interimId}`) as { id: number };
      expect(recheckOwnerPublicationReservation(
        nuclear,
        Number(reservation.id),
        7_000,
        { cognitiveSidecar: sidecar },
      )).toEqual({ ok: false, reason: "stale_generation" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});
