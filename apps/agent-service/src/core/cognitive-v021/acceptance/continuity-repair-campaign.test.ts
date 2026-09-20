import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { composeOrPreemptInTransaction } from "../cycle/fence.js";
import { getWake, cancelWake } from "../wake/ledger.js";
import { insertOutboxPending, registerCognitiveDeliveryDatabases } from "../speech/outbox.js";
import { recheckOwnerDmPublicationReservation, speechSupersessionReason } from "../settlement/publish.js";
import { getSpeechOutbox } from "../speech/outbox.js";
import {
  appendAshleyEvidence,
  appendOwnerUtterance,
} from "../evidence/conversation-log.js";
import {
  appendCycleLogIds,
  appendInboxEvent,
  getCycle,
  updateCycleState,
} from "../cycle/inbox.js";
import { buildThoughtInput } from "../thought/input.js";
import {
  checkUnansweredOwnerEligibility,
  outstandingOwnerTail,
  serviceUnansweredOwnerRecovery,
} from "../retry/owner-recovery.js";
import {
  claimPendingCognitiveDeliveries,
  reconcileLegacyWrongPrincipalSpeechReservations,
  reconcileOrphanedSendingDeliveries,
  reconcileUnfulfilledFailedSpeechReservations,
} from "../delivery/pending.js";

function setupDeliveryDatabases() {
  const sidecar = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  registerCognitiveDeliveryDatabases(sidecar, nuclear);
  return { sidecar, nuclear };
}

function reactiveIntent(conversationId: string) {
  return {
    ownerId: "doc",
    channel: "discord",
    threadId: conversationId,
    conversationId,
    trigger: "owner_message_reactive",
    deliveryLane: "reactive",
    purpose: "licensed_speech",
  } as const;
}

function insertReservedSpeech(nuclear: DatabaseSync, sidecar: DatabaseSync, opts: {
  conversationId: string;
  cycleId: string;
  generation: number;
  licensedText: string;
}) {
  const outbox = insertOutboxPending(sidecar, {
    settlementId: `settlement-${opts.cycleId}`,
    cycleId: opts.cycleId,
    generation: opts.generation,
    conversationId: opts.conversationId,
    licensedText: opts.licensedText,
    deliveryIntent: { ...reactiveIntent(opts.conversationId) },
  });
  sidecar.prepare("UPDATE speech_outbox SET send_status = 'sending' WHERE outbox_id = ?").run(outbox.outboxId);
  const insertRes = nuclear.prepare(
    `INSERT INTO delivery_reservations
       (owner_id, channel, thread_id, trigger, delivery_lane, state,
        draft_text, created_at, cognitive_v021_projection_key,
        speech_outbox_id, destination_json)
     VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'reserved', ?, ?, ?, ?, NULL)`,
  ).run(opts.conversationId, outbox.licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
  return { outbox, reservationId: Number(insertRes.lastInsertRowid) };
}

describe("Continuity Repair Campaign", () => {
  describe("Repair 1: compose-wake bookkeeping is not semantic cancellation", () => {
    it("composed A+B speech survives an unrelated later silent generation", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r1-compose";
        // Owner A admitted: fresh cycle Ga.
        const fenceA = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          evidenceRowIds: ["ev-a"],
          triggerKind: "owner_message",
          triggerRef: "ev-a",
          occupantId: "doc",
          nowMs: 1_000,
        });
        expect(fenceA.action).toBe("compose");

        // Owner B arrives before A's Thought publishes: fence composes into the
        // SAME continuing cycle and records attempt-level wake cancellation.
        const fenceB = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          evidenceRowIds: ["ev-b"],
          triggerKind: "owner_message",
          triggerRef: "ev-b",
          occupantId: "doc",
          nowMs: 1_500,
        });
        expect(fenceB.action).toBe("compose");
        expect(fenceB.cycleId).toBe(fenceA.cycleId);

        // Production-shaped bookkeeping is present on the still-active wake.
        const wakeAfterCompose = getWake(sidecar, fenceB.cycle.wakeId!);
        expect(wakeAfterCompose?.cancellationId).not.toBeNull();
        expect(wakeAfterCompose?.state).not.toBe("terminal");

        // The same continuing cycle authors valid A+B speech.
        const { reservationId } = insertReservedSpeech(nuclear, sidecar, {
          conversationId,
          cycleId: fenceB.cycleId,
          generation: fenceB.generation,
          licensedText: "Covering both of your messages.",
        });

        // An unrelated detached-operation completion advances the generation.
        admitTestCycle(sidecar, {
          cycleId: "cycle-r1-obs",
          conversationId,
          triggerKind: "observation_or_receipt",
          triggerRef: "operation:detached-operation:9:completion",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        // Publication must remain allowed despite the historical cancellation id.
        expect(
          recheckOwnerDmPublicationReservation(nuclear, reservationId, 2_500, {
            cognitiveSidecar: sidecar,
          }),
        ).toEqual({ ok: true });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("composed speech still publishes after its wake completes normally", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r1-completed-wake";
        const fenceA = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          evidenceRowIds: ["ev-a"],
          triggerKind: "owner_message",
          triggerRef: "ev-a",
          occupantId: "doc",
          nowMs: 1_000,
        });
        composeOrPreemptInTransaction(sidecar, {
          conversationId,
          evidenceRowIds: ["ev-b"],
          triggerKind: "owner_message",
          triggerRef: "ev-b",
          occupantId: "doc",
          nowMs: 1_500,
        });
        const { reservationId } = insertReservedSpeech(nuclear, sidecar, {
          conversationId,
          cycleId: fenceA.cycleId,
          generation: fenceA.generation,
          licensedText: "Composed answer.",
        });

        // The composed wake finishes normally while retaining its historical
        // cancellation metadata. That must not revoke the speech.
        sidecar.prepare(
          "UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?",
        ).run(fenceA.cycle.wakeId);
        const finished = getWake(sidecar, fenceA.cycle.wakeId!);
        expect(finished?.state).toBe("terminal");
        expect(finished?.terminalReason).toBe("completed");
        expect(finished?.cancellationId).not.toBeNull();

        admitTestCycle(sidecar, {
          cycleId: "cycle-r1c-obs",
          conversationId,
          triggerKind: "observation_or_receipt",
          triggerRef: "operation:detached-operation:10:completion",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        expect(
          recheckOwnerDmPublicationReservation(nuclear, reservationId, 2_500, {
            cognitiveSidecar: sidecar,
          }),
        ).toEqual({ ok: true });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("negative: terminally cancelled producing wake still blocks old speech", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r1-cancelled";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r1x-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-r1x",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });
        const { reservationId } = insertReservedSpeech(nuclear, sidecar, {
          conversationId,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          licensedText: "Revoked answer.",
        });

        // Real semantic cancellation of the producing wake.
        cancelWake(sidecar, { wakeId: cycle.wakeId!, nowMs: 1_500 });
        expect(getWake(sidecar, cycle.wakeId!)?.state).toBe("terminal");

        admitTestCycle(sidecar, {
          cycleId: "cycle-r1x-2",
          conversationId,
          triggerKind: "observation_or_receipt",
          triggerRef: "operation:detached-operation:11:completion",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        expect(
          recheckOwnerDmPublicationReservation(nuclear, reservationId, 2_500, {
            cognitiveSidecar: sidecar,
          }),
        ).toEqual({ ok: false, reason: "stale_generation" });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("negative: true owner preemption via fence still suppresses old speech", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r1-preempt";
        const fenceA = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          evidenceRowIds: ["ev-a"],
          triggerKind: "owner_message",
          triggerRef: "ev-a",
          occupantId: "doc",
          nowMs: 1_000,
        });
        // A publishes speech before B arrives, so B must preempt (not compose).
        const { outbox, reservationId } = insertReservedSpeech(nuclear, sidecar, {
          conversationId,
          cycleId: fenceA.cycleId,
          generation: fenceA.generation,
          licensedText: "First answer.",
        });
        const fenceB = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          evidenceRowIds: ["ev-b"],
          triggerKind: "owner_message",
          triggerRef: "ev-b",
          occupantId: "doc",
          nowMs: 2_000,
        });
        expect(fenceB.action).toBe("preempt");

        // Synchronous fence suppression already revoked the old wording, and the
        // bound nuclear reservation was cancelled alongside it.
        const row = sidecar.prepare(
          "SELECT send_status FROM speech_outbox WHERE outbox_id = ?",
        ).get(outbox.outboxId) as { send_status?: unknown };
        expect(row.send_status).toBe("suppressed");
        const reservation = nuclear.prepare(
          "SELECT state FROM delivery_reservations WHERE id = ?",
        ).get(reservationId) as { state?: unknown };
        expect(["aborted", "cancelled"]).toContain(reservation.state);
        expect(
          recheckOwnerDmPublicationReservation(nuclear, reservationId, 2_500, {
            cognitiveSidecar: sidecar,
          }),
        ).toEqual({ ok: false, reason: "delivery_not_sendable" });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Repair 2: newer Owner input transfers the obligation, never erases it", () => {
    it("fence preempt inherits outstanding refs even on the zombie path", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-r2-zombie-union";
        // Old cycle carrying A's obligation ref, now a zombie (thinking with a
        // terminal wake) with later silent generations already present.
        const zombie = admitTestCycle(sidecar, {
          cycleId: "cycle-r2-zombie",
          conversationId,
          generation: 156,
          triggerKind: "owner_message",
          nowMs: 1_000,
        });
        appendCycleLogIds(sidecar, zombie.cycleId, ["ev-r2-a"], 1_100);
        updateCycleState(sidecar, zombie.cycleId, "thinking", 1_000);
        sidecar.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?").run(zombie.wakeId);
        for (const [cycleId, generation] of [["cycle-r2-157", 157], ["cycle-r2-158", 158]] as const) {
          const silent = admitTestCycle(sidecar, {
            cycleId,
            conversationId,
            generation,
            triggerKind: "idle_opportunity",
            nowMs: 2_000,
          });
          updateCycleState(sidecar, silent.cycleId, "silent", 2_000);
        }

        const result = composeOrPreemptInTransaction(sidecar, {
          conversationId,
          evidenceRowIds: ["ev-r2-b"],
          triggerKind: "owner_message",
          triggerRef: "ev-r2-b",
          occupantId: "doc",
          nowMs: 4_000,
        });
        expect(result.action).toBe("preempt");
        expect(result.generation).toBe(159);
        const successor = getCycle(sidecar, result.cycleId)!;
        expect(successor.composeLogIds).toContain("ev-r2-a");
        expect(successor.composeLogIds).toContain("ev-r2-b");
      } finally {
        sidecar.close();
      }
    });

    it("successor Thought input mechanically carries A+B beyond the recency window", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-r2-thought-carry";
        const rows = Array.from({ length: 15 }, (_, index) => appendOwnerUtterance(sidecar, {
          conversationId,
          text: `owner turn ${index}`,
          discordMessageIds: [`r2-msg-${index}`],
          nowMs: 1_000 + index,
        }));
        // Successor cycle inherited A's ref (outside the last-12 window).
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r2-successor",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: rows.at(-1)!.rowId,
          occupantId: "doc",
          nowMs: 2_000,
        });
        appendCycleLogIds(sidecar, cycle.cycleId, [rows[0]!.rowId, rows.at(-1)!.rowId], 2_000);

        const input = buildThoughtInput({
          sidecar,
          cycle: getCycle(sidecar, cycle.cycleId)!,
          triggerText: rows.at(-1)!.text ?? rows.at(-1)!.rowId,
          constitution: { constitutional: ["truth first"], stableSelf: ["curious"] },
          capabilityReality: {
            vision: false, attachmentText: false, conversationalRead: true, webSearch: false,
            canOfferProjectInspection: true, canOfferWorkspace: false, canOfferVerification: false,
            canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
            approvedProjectIds: ["project-ashley"],
          },
          workingContext: [],
          occupancy: [],
          learnedSelfSlice: { dispositions: [], interests: [] },
        });
        const carried = input.rawConversation.map((row) => row.rowId);
        expect(carried).toContain(rows[0]!.rowId);
        expect(carried).toContain(rows.at(-1)!.rowId);
      } finally {
        sidecar.close();
      }
    });

    it("B-successor failure coalesces A+B into one repair instead of losing A", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-r2-coalesce";
        const evA = appendOwnerUtterance(sidecar, {
          conversationId, text: "A: first question", discordMessageIds: ["r2-a"], nowMs: 100,
        });
        const evB = appendOwnerUtterance(sidecar, {
          conversationId, text: "B: second question", discordMessageIds: ["r2-b"], nowMs: 200,
        });
        for (const [id, ev] of [["event-r2-a", evA], ["event-r2-b", evB]] as const) {
          const event = appendInboxEvent(sidecar, {
            id,
            conversationId,
            kind: "owner_utterance",
            payload: { evidenceRowId: ev.rowId },
            createdAtMs: ev.createdAtMs,
          });
          sidecar.prepare(
            `UPDATE inbox_events SET state = 'quarantined', status = 'failed_terminal',
               terminal_reason = 'transient_retryable' WHERE id = ?`,
          ).run(event.id);
        }

        const result = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 3_000 });
        expect(result.eligibleConversations).toBe(1);
        expect(result.createdRepairs).toHaveLength(1);
        expect(result.createdRepairs[0]!.predecessorEventId).toBe("event-r2-a");
        expect(result.createdRepairs[0]!.outstandingOwnerEvidenceRefs).toEqual([evA.rowId, evB.rowId]);
      } finally {
        sidecar.close();
      }
    });

    it("composed successor delivery closes the obligation without duplicate repairs", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-r2-close";
        const evA = appendOwnerUtterance(sidecar, {
          conversationId, text: "A: answered question", discordMessageIds: ["r2c-a"], nowMs: 100,
        });
        const eventA = appendInboxEvent(sidecar, {
          id: "event-r2c-a",
          conversationId,
          kind: "owner_utterance",
          payload: { evidenceRowId: evA.rowId },
          createdAtMs: 100,
        });
        sidecar.prepare(
          `UPDATE inbox_events SET state = 'quarantined', status = 'failed_terminal',
             terminal_reason = 'transient_retryable' WHERE id = ?`,
        ).run(eventA.id);
        // The composed successor delivered Owner-visible speech after A.
        appendAshleyEvidence(sidecar, {
          conversationId,
          text: "Answering both questions.",
          discordMessageIds: ["discord-r2c-1"],
          delivered: true,
          nowMs: 500,
        });

        const verdict = checkUnansweredOwnerEligibility(sidecar, {
          id: eventA.id,
          conversationId,
          kind: "owner_utterance",
          payloadJson: JSON.stringify({ evidenceRowId: evA.rowId }),
          createdAtMs: 100,
          terminalReason: "transient_retryable",
          lastError: "transient_retryable",
          wakeId: null,
        });
        expect(verdict).toEqual({ eligible: false, reason: "later_reply_delivered" });
        expect(serviceUnansweredOwnerRecovery(sidecar, { nowMs: 1_000 }).createdRepairs).toHaveLength(0);
      } finally {
        sidecar.close();
      }
    });
  });

  describe("Repair 3: replacement lineage scopes newer-speech supersession", () => {
    it("unrelated autonomous speech does not revoke a pending reactive answer", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r3-autonomous";
        const ownerCycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r3-owner",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-r3",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });
        appendCycleLogIds(sidecar, ownerCycle.cycleId, ["ev-r3-owner"], 1_000);
        const { reservationId, outbox } = insertReservedSpeech(nuclear, sidecar, {
          conversationId,
          cycleId: ownerCycle.cycleId,
          generation: ownerCycle.generation,
          licensedText: "Reactive answer to your question.",
        });

        // Later unrelated autonomous speech with a disjoint obligation lineage.
        const autoCycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r3-auto",
          conversationId,
          triggerKind: "idle_opportunity",
          triggerRef: "curiosity:r3",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });
        appendCycleLogIds(sidecar, autoCycle.cycleId, ["ev-r3-auto"], 2_000);
        insertOutboxPending(sidecar, {
          settlementId: `settlement-${autoCycle.cycleId}`,
          cycleId: autoCycle.cycleId,
          generation: autoCycle.generation,
          conversationId,
          licensedText: "Unrelated autonomous note.",
          deliveryIntent: { ...reactiveIntent(conversationId) },
        });

        const speech = getSpeechOutbox(sidecar, outbox.outboxId)!;
        expect(speechSupersessionReason(sidecar, speech)).toBeNull();
        expect(
          recheckOwnerDmPublicationReservation(nuclear, reservationId, 2_500, {
            cognitiveSidecar: sidecar,
          }),
        ).toEqual({ ok: true });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("actual replacement speech for the same obligation still supersedes", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r3-replacement";
        const ownerCycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r3r-owner",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-r3r",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });
        appendCycleLogIds(sidecar, ownerCycle.cycleId, ["ev-r3r-owner"], 1_000);
        const { reservationId, outbox } = insertReservedSpeech(nuclear, sidecar, {
          conversationId,
          cycleId: ownerCycle.cycleId,
          generation: ownerCycle.generation,
          licensedText: "First wording.",
        });

        // Newer speech whose producing cycle demonstrably inherited the same
        // obligation ref is a genuine replacement.
        const replacementCycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r3r-new",
          conversationId,
          triggerKind: "idle_opportunity",
          triggerRef: "followup:r3r",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });
        appendCycleLogIds(sidecar, replacementCycle.cycleId, ["ev-r3r-owner", "ev-r3r-extra"], 2_000);
        insertOutboxPending(sidecar, {
          settlementId: `settlement-${replacementCycle.cycleId}`,
          cycleId: replacementCycle.cycleId,
          generation: replacementCycle.generation,
          conversationId,
          licensedText: "Replacement wording.",
          deliveryIntent: { ...reactiveIntent(conversationId) },
        });

        const speech = getSpeechOutbox(sidecar, outbox.outboxId)!;
        expect(speechSupersessionReason(sidecar, speech)).toBe("stale_generation");
        expect(
          recheckOwnerDmPublicationReservation(nuclear, reservationId, 2_500, {
            cognitiveSidecar: sidecar,
          }),
        ).toEqual({ ok: false, reason: "stale_generation" });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Repair 5: stranded sending rows always have a recovery owner", () => {
    function insertSendingReservation(
      nuclear: DatabaseSync,
      conversationId: string,
      outboxId: number,
      projectionKey: string,
      opts: { leaseExpiresAt: string | null; dispatchStartedAt: string | null; firstSentAt?: string | null },
    ) {
      const insertRes = nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            draft_text, created_at, cognitive_v021_projection_key,
            speech_outbox_id, destination_json, delivery_lease_expires_at,
            dispatch_started_at, first_sent_at)
         VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'sending', ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).run(
        conversationId, "sending draft", "1970-01-01T00:00:01.000Z", projectionKey, outboxId,
        opts.leaseExpiresAt, opts.dispatchStartedAt, opts.firstSentAt ?? null,
      );
      return Number(insertRes.lastInsertRowid);
    }

    let sendingSpeechOrdinal = 0;
    function insertSendingSpeech(sidecar: DatabaseSync, conversationId: string, licensedText: string) {
      sendingSpeechOrdinal += 1;
      const cycle = admitTestCycle(sidecar, {
        cycleId: `cycle-r5-${sendingSpeechOrdinal}`,
        conversationId,
        triggerKind: "owner_message",
        triggerRef: `owner-r5-${sendingSpeechOrdinal}`,
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1_000,
      });
      const outbox = insertOutboxPending(sidecar, {
        settlementId: `settlement-${cycle.cycleId}`,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        conversationId,
        licensedText,
        deliveryIntent: { ...reactiveIntent(conversationId) },
      });
      sidecar.prepare("UPDATE speech_outbox SET send_status = 'sending' WHERE outbox_id = ?").run(outbox.outboxId);
      return outbox;
    }

    it("stranded sending rows expire without replay and stay visible", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r5-stranded";
        const noMarker = insertSendingSpeech(sidecar, conversationId, "Never dispatched.");
        const noMarkerId = insertSendingReservation(nuclear, conversationId, noMarker.outboxId, noMarker.projectionKey, {
          leaseExpiresAt: "1970-01-01T00:00:02.000Z",
          dispatchStartedAt: null,
        });
        const marked = insertSendingSpeech(sidecar, conversationId, "Maybe dispatched.");
        const markedId = insertSendingReservation(nuclear, conversationId, marked.outboxId, marked.projectionKey, {
          leaseExpiresAt: "1970-01-01T00:00:02.000Z",
          dispatchStartedAt: "1970-01-01T00:00:01.500Z",
        });

        // A crash row without a marker is byte-identical to an ambiguous row
        // stranded by an unmarked pump: zero receipts never prove zero
        // dispatch, so both fail closed identically.
        const result = reconcileOrphanedSendingDeliveries(nuclear, sidecar, "doc", Date.parse("1970-01-01T00:01:00.000Z"));
        expect(result).toEqual({ expired: 2 });

        for (const reservationId of [noMarkerId, markedId]) {
          const reservation = nuclear.prepare(
            "SELECT state, finalization_reason FROM delivery_reservations WHERE id = ?",
          ).get(reservationId) as { state?: unknown; finalization_reason?: unknown };
          expect(reservation).toMatchObject({ state: "expired", finalization_reason: "delivery_lease_expired" });
        }

        // Never resurrected for ordinary redelivery...
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: Date.parse("1970-01-01T00:01:00.000Z") });
        expect(claimed.map((d) => d.reservationId)).not.toContain(noMarkerId);
        expect(claimed.map((d) => d.reservationId)).not.toContain(markedId);

        // ...but each unconfirmed send stays durably visible exactly once.
        for (const outbox of [noMarker, marked]) {
          const notices = sidecar.prepare(
            "SELECT notice_text FROM system_notice_outbox WHERE notice_key = ?",
          ).all(`delivery_exhausted:speech:${outbox.outboxId}`) as Array<{ notice_text?: unknown }>;
          expect(notices).toHaveLength(1);
          expect(String(notices[0]!.notice_text)).toContain("DELIVERY_UNCONFIRMED");
        }
        const again = reconcileOrphanedSendingDeliveries(nuclear, sidecar, "doc", Date.parse("1970-01-01T00:02:00.000Z"));
        expect(again).toEqual({ expired: 0 });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("a set dispatch marker blocks failed-row resurrection with a visible notice", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r5-marked-abort";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r5-ma",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-r5-ma",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });
        const outbox = insertOutboxPending(sidecar, {
          settlementId: `settlement-${cycle.cycleId}`,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Ambiguous terminal.",
          deliveryIntent: { ...reactiveIntent(conversationId) },
        });
        sidecar.prepare("UPDATE speech_outbox SET send_status = 'send_failure' WHERE outbox_id = ?").run(outbox.outboxId);
        const insertRes = nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json, error_category, finalization_reason, dispatch_started_at)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'aborted', ?, ?, ?, ?, NULL, 'send_failure', 'send_failure', ?)`,
        ).run(
          conversationId, "Ambiguous terminal.", "1970-01-01T00:00:01.000Z",
          outbox.projectionKey, outbox.outboxId, "1970-01-01T00:00:01.500Z",
        );
        const reservationId = Number(insertRes.lastInsertRowid);

        // Positive dispatch proof: never resurrected, never replayed...
        const recovery = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(recovery.recovered).toBe(0);
        expect(nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(reservationId))
          .toMatchObject({ state: "aborted" });
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 6_000 });
        expect(claimed.map((d) => d.reservationId)).not.toContain(reservationId);

        // ...but the unconfirmed send stays durably visible exactly once.
        const notices = sidecar.prepare(
          "SELECT notice_text FROM system_notice_outbox WHERE notice_key = ?",
        ).all(`delivery_exhausted:speech:${outbox.outboxId}`) as Array<{ notice_text?: unknown }>;
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.notice_text)).toContain("DELIVERY_UNCONFIRMED");
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("live leases and receipt-backed rows are left to their owners", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r5-live";
        const liveOutbox = insertSendingSpeech(sidecar, conversationId, "Pump alive.");
        const liveId = insertSendingReservation(nuclear, conversationId, liveOutbox.outboxId, liveOutbox.projectionKey, {
          leaseExpiresAt: "1970-01-01T00:10:00.000Z",
          dispatchStartedAt: null,
        });

        const receiptOutbox = insertSendingSpeech(sidecar, conversationId, "Receipted.");
        const receiptId = insertSendingReservation(nuclear, conversationId, receiptOutbox.outboxId, receiptOutbox.projectionKey, {
          leaseExpiresAt: "1970-01-01T00:00:02.000Z",
          dispatchStartedAt: "1970-01-01T00:00:01.500Z",
          firstSentAt: "1970-01-01T00:00:01.600Z",
        });
        nuclear.prepare(
          `INSERT INTO delivery_bubbles (reservation_id, ordinal, text, discord_message_id, sent_at)
           VALUES (?, 0, 'Receipted.', 'discord-msg-r5', '1970-01-01T00:00:01.600Z')`,
        ).run(receiptId);

        const result = reconcileOrphanedSendingDeliveries(nuclear, sidecar, "doc", Date.parse("1970-01-01T00:01:00.000Z"));
        expect(result).toEqual({ expired: 0 });
        expect(nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(liveId))
          .toMatchObject({ state: "sending" });
        expect(nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(receiptId))
          .toMatchObject({ state: "sending" });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Repair 6: exhausted recovery leaves visible truth, never quiet loss", () => {
    function insertAbortedSpeechRow(
      nuclear: DatabaseSync,
      sidecar: DatabaseSync,
      conversationId: string,
      licensedText: string,
    ) {
      const cycle = admitTestCycle(sidecar, {
        cycleId: `cycle-r6-${conversationId}`,
        conversationId,
        triggerKind: "owner_message",
        triggerRef: `owner-r6-${conversationId}`,
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1_000,
      });
      const outbox = insertOutboxPending(sidecar, {
        settlementId: `settlement-${cycle.cycleId}`,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        conversationId,
        licensedText,
        deliveryIntent: { ...reactiveIntent(conversationId) },
      });
      sidecar.prepare("UPDATE speech_outbox SET send_status = 'send_failure' WHERE outbox_id = ?").run(outbox.outboxId);
      const insertRes = nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            draft_text, created_at, cognitive_v021_projection_key,
            speech_outbox_id, destination_json, error_category, finalization_reason)
         VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'aborted', ?, ?, ?, ?, NULL, 'send_failure', 'send_failure')`,
      ).run(conversationId, licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
      return { outbox, reservationId: Number(insertRes.lastInsertRowid) };
    }

    function exhaustedNotices(sidecar: DatabaseSync, outboxId: number) {
      return sidecar.prepare(
        "SELECT notice_id, notice_text, send_status FROM system_notice_outbox WHERE notice_key = ?",
      ).all(`delivery_exhausted:speech:${outboxId}`) as Array<{ notice_id?: unknown; notice_text?: unknown; send_status?: unknown }>;
    }

    it("second terminal failure stops retrying but records exactly one failure notice", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r6-exhaust";
        const evA = appendOwnerUtterance(sidecar, {
          conversationId, text: "A: please answer", discordMessageIds: ["r6-a"], nowMs: 100,
        });
        const eventA = appendInboxEvent(sidecar, {
          id: "event-r6-a",
          conversationId,
          kind: "owner_utterance",
          payload: { evidenceRowId: evA.rowId, ownerId: "doc" },
          createdAtMs: 100,
        });
        sidecar.prepare(
          "UPDATE inbox_events SET state = 'terminal', status = 'consumed', terminal_reason = 'completed' WHERE id = ?",
        ).run(eventA.id);

        const { outbox, reservationId } = insertAbortedSpeechRow(nuclear, sidecar, conversationId, "Authored answer.");

        // First failure: the one safe resurrection.
        expect(reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc").recovered).toBe(1);
        expect(exhaustedNotices(sidecar, outbox.outboxId)).toHaveLength(0);

        // Second terminal failure after the resurrection (transport failed again).
        nuclear.prepare(
          `UPDATE delivery_reservations SET state = 'aborted', error_category = 'send_failure',
             finalization_reason = 'send_failure', finalized_at = ? WHERE id = ?`,
        ).run("1970-01-01T00:00:05.000Z", reservationId);
        sidecar.prepare("UPDATE speech_outbox SET send_status = 'send_failure' WHERE outbox_id = ?").run(outbox.outboxId);

        // No further automatic retry...
        const second = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(second.recovered).toBe(0);
        expect(nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(reservationId))
          .toMatchObject({ state: "aborted" });
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 6_000 });
        expect(claimed.map((d) => d.reservationId)).not.toContain(reservationId);

        // ...but exactly one durable terminal notice keeps the failure visible.
        const notices = exhaustedNotices(sidecar, outbox.outboxId);
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.notice_text)).toContain("DELIVERY_FAILED");

        // A third sweep must not duplicate the notice or revive the row.
        const third = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(third.recovered).toBe(0);
        expect(exhaustedNotices(sidecar, outbox.outboxId)).toHaveLength(1);

        // And the Owner obligation is still outstanding truth, not fulfillment:
        // no Ashley delivery exists, and the evidence tail still holds A.
        expect(outstandingOwnerTail(sidecar, conversationId)).toContain(evA.rowId);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("ambiguous expiry records one unconfirmed notice and never replays", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r6-ambiguous";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r6-amb",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-r6-amb",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });
        const outbox = insertOutboxPending(sidecar, {
          settlementId: `settlement-${cycle.cycleId}`,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Ambiguous send.",
          deliveryIntent: { ...reactiveIntent(conversationId) },
        });
        sidecar.prepare("UPDATE speech_outbox SET send_status = 'sending' WHERE outbox_id = ?").run(outbox.outboxId);
        const insertRes = nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json, delivery_lease_expires_at, dispatch_started_at)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'sending', ?, ?, ?, ?, NULL, ?, ?)`,
        ).run(
          conversationId, "Ambiguous send.", "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId,
          "1970-01-01T00:00:02.000Z", "1970-01-01T00:00:01.500Z",
        );
        const reservationId = Number(insertRes.lastInsertRowid);

        const result = reconcileOrphanedSendingDeliveries(nuclear, sidecar, "doc", Date.parse("1970-01-01T00:01:00.000Z"));
        expect(result).toEqual({ expired: 1 });

        const notices = exhaustedNotices(sidecar, outbox.outboxId);
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.notice_text)).toContain("DELIVERY_UNCONFIRMED");

        // A repeat sweep expires nothing new and duplicates nothing.
        const again = reconcileOrphanedSendingDeliveries(nuclear, sidecar, "doc", Date.parse("1970-01-01T00:02:00.000Z"));
        expect(again).toEqual({ expired: 0 });
        expect(exhaustedNotices(sidecar, outbox.outboxId)).toHaveLength(1);
        expect(nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(reservationId))
          .toMatchObject({ state: "expired" });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Single fulfillment owner: R1 defers to serviceable authoritative speech", () => {
    function insertAbortedSpeechRow(
      nuclear: DatabaseSync,
      sidecar: DatabaseSync,
      conversationId: string,
      cycleId: string,
      generation: number,
      licensedText: string,
    ) {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: `settlement-own-${cycleId}`,
        cycleId,
        generation,
        conversationId,
        licensedText,
        deliveryIntent: { ...reactiveIntent(conversationId) },
      });
      sidecar.prepare("UPDATE speech_outbox SET send_status = 'send_failure' WHERE outbox_id = ?").run(outbox.outboxId);
      const insertRes = nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            draft_text, created_at, cognitive_v021_projection_key,
            speech_outbox_id, destination_json, error_category, finalization_reason)
         VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'aborted', ?, ?, ?, ?, NULL, 'send_failure', 'send_failure')`,
      ).run(conversationId, licensedText, "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId);
      return { outbox, reservationId: Number(insertRes.lastInsertRowid) };
    }

    function settleAdmissionEvent(sidecar: DatabaseSync, triggerRef: string) {
      // admitTestCycle records its trigger as a nonterminal inbox row; a
      // settled test turn must not leave a phantom open continuation.
      sidecar.prepare(
        `UPDATE inbox_events SET state = 'terminal', status = 'consumed',
           terminal_reason = 'completed' WHERE id = ?`,
      ).run(triggerRef);
    }

    function quarantineOwnerEvent(sidecar: DatabaseSync, id: string, conversationId: string, evidenceRowId: string, createdAtMs: number) {
      const event = appendInboxEvent(sidecar, {
        id,
        conversationId,
        kind: "owner_utterance",
        payload: { evidenceRowId, ownerId: "doc" },
        createdAtMs,
      });
      sidecar.prepare(
        `UPDATE inbox_events SET state = 'quarantined', status = 'failed_terminal',
           terminal_reason = 'transient_retryable' WHERE id = ?`,
      ).run(event.id);
      return event;
    }

    it("1: recoverable send_failure speech owns the tail; R1 stays out and delivery closes it", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-own-1";
        const evA = appendOwnerUtterance(sidecar, {
          conversationId, text: "A: production-shaped question", discordMessageIds: ["own-1-a"], nowMs: 100,
        });
        const eventA = quarantineOwnerEvent(sidecar, "event-own-1-a", conversationId, evA.rowId, 100);
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-own-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-own-1",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 200,
        });
        settleAdmissionEvent(sidecar, "owner-own-1");
        appendCycleLogIds(sidecar, cycle.cycleId, [evA.rowId], 200);
        const { outbox, reservationId } = insertAbortedSpeechRow(
          nuclear, sidecar, conversationId, cycle.cycleId, cycle.generation, "Authoritative answer.",
        );

        // R1 must not independently re-run Thought while delivery owns it.
        const verdict = checkUnansweredOwnerEligibility(sidecar, {
          id: eventA.id,
          conversationId,
          kind: "owner_utterance",
          payloadJson: JSON.stringify({ evidenceRowId: evA.rowId, ownerId: "doc" }),
          createdAtMs: 100,
          terminalReason: "transient_retryable",
          lastError: "transient_retryable",
          wakeId: null,
        });
        expect(verdict).toEqual({ eligible: false, reason: "delivery_owns_obligation" });
        expect(serviceUnansweredOwnerRecovery(sidecar, { nowMs: 1_000 }).createdRepairs).toHaveLength(0);

        // The delivery path still owns and completes it: recover, claim, recheck.
        expect(reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc").recovered).toBe(1);
        const claimed = claimPendingCognitiveDeliveries(nuclear, { ownerId: "doc", nowMs: 2_000 });
        expect(claimed.map((d) => d.reservationId)).toContain(reservationId);
        expect(
          recheckOwnerDmPublicationReservation(nuclear, reservationId, 2_100, { cognitiveSidecar: sidecar }),
        ).toEqual({ ok: true });
        // Recovered to projected and claimed to sending on the nuclear side
        // (direct claim leaves the sidecar projection untouched; the HTTP
        // claim path marks it sending via markProjectedDeliverySending).
        expect(getSpeechOutbox(sidecar, outbox.outboxId)?.sendStatus).toBe("projected");
        expect(nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(reservationId))
          .toMatchObject({ state: "sending" });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("2: projected/reserved/sending speech is not duplicated by R1", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-own-2";
        const evA = appendOwnerUtterance(sidecar, {
          conversationId, text: "A: in-flight question", discordMessageIds: ["own-2-a"], nowMs: 100,
        });
        const eventA = quarantineOwnerEvent(sidecar, "event-own-2-a", conversationId, evA.rowId, 100);
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-own-2",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-own-2",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 200,
        });
        settleAdmissionEvent(sidecar, "owner-own-2");
        appendCycleLogIds(sidecar, cycle.cycleId, [evA.rowId], 200);
        const outbox = insertOutboxPending(sidecar, {
          settlementId: `settlement-${cycle.cycleId}`,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "In-flight answer.",
          deliveryIntent: { ...reactiveIntent(conversationId) },
        });
        sidecar.prepare("UPDATE speech_outbox SET send_status = 'sending' WHERE outbox_id = ?").run(outbox.outboxId);
        nuclear.prepare(
          `INSERT INTO delivery_reservations
             (owner_id, channel, thread_id, trigger, delivery_lane, state,
              draft_text, created_at, cognitive_v021_projection_key,
              speech_outbox_id, destination_json, delivery_lease_expires_at)
           VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'sending', ?, ?, ?, ?, NULL, ?)`,
        ).run(conversationId, "In-flight answer.", "1970-01-01T00:00:01.000Z", outbox.projectionKey, outbox.outboxId, "1970-01-01T00:10:00.000Z");

        const verdict = checkUnansweredOwnerEligibility(sidecar, {
          id: eventA.id,
          conversationId,
          kind: "owner_utterance",
          payloadJson: JSON.stringify({ evidenceRowId: evA.rowId, ownerId: "doc" }),
          createdAtMs: 100,
          terminalReason: "transient_retryable",
          lastError: "transient_retryable",
          wakeId: null,
        });
        expect(verdict).toEqual({ eligible: false, reason: "delivery_owns_obligation" });
        expect(serviceUnansweredOwnerRecovery(sidecar, { nowMs: 1_000 }).createdRepairs).toHaveLength(0);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("3: truly suppressed speech leaves R1 eligible for the unresolved obligation", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-own-3";
        const evA = appendOwnerUtterance(sidecar, {
          conversationId, text: "A: revoked answer needed", discordMessageIds: ["own-3-a"], nowMs: 100,
        });
        const eventA = quarantineOwnerEvent(sidecar, "event-own-3-a", conversationId, evA.rowId, 100);
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-own-3",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-own-3",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 200,
        });
        settleAdmissionEvent(sidecar, "owner-own-3");
        appendCycleLogIds(sidecar, cycle.cycleId, [evA.rowId], 200);
        const outbox = insertOutboxPending(sidecar, {
          settlementId: `settlement-${cycle.cycleId}`,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Revoked wording.",
          deliveryIntent: { ...reactiveIntent(conversationId) },
        });
        sidecar.prepare(
          "UPDATE speech_outbox SET send_status = 'suppressed', suppressed = 1 WHERE outbox_id = ?",
        ).run(outbox.outboxId);

        const result = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 1_000 });
        expect(result.createdRepairs).toHaveLength(1);
        expect(result.createdRepairs[0]!.predecessorEventId).toBe(eventA.id);
        expect(result.createdRepairs[0]!.outstandingOwnerEvidenceRefs).toEqual([evA.rowId]);
      } finally {
        sidecar.close();
      }
    });

    it("4: an unrelated obligation is not blocked by another obligation's pending speech", () => {
      const sidecar = openTestSidecar();
      try {
        const conversationId = "thread-own-4";
        const evA = appendOwnerUtterance(sidecar, {
          conversationId, text: "A: answered elsewhere", discordMessageIds: ["own-4-a"], nowMs: 100,
        });
        const eventA = appendInboxEvent(sidecar, {
          id: "event-own-4-a",
          conversationId,
          kind: "owner_utterance",
          payload: { evidenceRowId: evA.rowId, ownerId: "doc" },
          createdAtMs: 100,
        });
        sidecar.prepare(
          "UPDATE inbox_events SET state = 'terminal', status = 'consumed', terminal_reason = 'completed' WHERE id = ?",
        ).run(eventA.id);
        // A's speech is serviceable but covers only A's ref.
        const cycleA = admitTestCycle(sidecar, {
          cycleId: "cycle-own-4-a",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-own-4-a",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 150,
        });
        settleAdmissionEvent(sidecar, "owner-own-4-a");
        appendCycleLogIds(sidecar, cycleA.cycleId, [evA.rowId], 150);
        const outboxA = insertOutboxPending(sidecar, {
          settlementId: `settlement-${cycleA.cycleId}`,
          cycleId: cycleA.cycleId,
          generation: cycleA.generation,
          conversationId,
          licensedText: "A's pending answer.",
          deliveryIntent: { ...reactiveIntent(conversationId) },
        });
        sidecar.prepare("UPDATE speech_outbox SET send_status = 'sending' WHERE outbox_id = ?").run(outboxA.outboxId);

        // B is a genuinely unowned obligation in the same conversation.
        const evB = appendOwnerUtterance(sidecar, {
          conversationId, text: "B: still needs an answer", discordMessageIds: ["own-4-b"], nowMs: 200,
        });
        const cycleB = admitTestCycle(sidecar, {
          cycleId: "cycle-own-4-b",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-own-4-b",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 250,
        });
        settleAdmissionEvent(sidecar, "owner-own-4-b");
        const eventB = appendInboxEvent(sidecar, {
          id: "event-own-4-b",
          wakeId: cycleB.wakeId,
          conversationId,
          kind: "owner_utterance",
          payload: { evidenceRowId: evB.rowId, ownerId: "doc" },
          createdAtMs: 200,
        });
        sidecar.prepare(
          `UPDATE inbox_events SET state = 'quarantined', status = 'failed_terminal',
             terminal_reason = 'transient_retryable' WHERE id = ?`,
        ).run(eventB.id);

        const result = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 1_000 });
        expect(result.createdRepairs).toHaveLength(1);
        expect(result.createdRepairs[0]!.predecessorEventId).toBe(eventB.id);
        expect(result.createdRepairs[0]!.outstandingOwnerEvidenceRefs).toContain(evB.rowId);
      } finally {
        sidecar.close();
      }
    });

    it("5: terminally exhausted delivery stays visibly owned without hot-looping", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-own-5";
        const evA = appendOwnerUtterance(sidecar, {
          conversationId, text: "A: exhausted question", discordMessageIds: ["own-5-a"], nowMs: 100,
        });
        const eventA = quarantineOwnerEvent(sidecar, "event-own-5-a", conversationId, evA.rowId, 100);
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-own-5",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-own-5",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 200,
        });
        settleAdmissionEvent(sidecar, "owner-own-5");
        appendCycleLogIds(sidecar, cycle.cycleId, [evA.rowId], 200);
        const { outbox, reservationId } = insertAbortedSpeechRow(
          nuclear, sidecar, conversationId, cycle.cycleId, cycle.generation, "Exhausted answer.",
        );
        // Spend the one recovery, then fail terminally again.
        expect(reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc").recovered).toBe(1);
        nuclear.prepare(
          `UPDATE delivery_reservations SET state = 'aborted', error_category = 'send_failure',
             finalization_reason = 'send_failure' WHERE id = ?`,
        ).run(reservationId);
        sidecar.prepare("UPDATE speech_outbox SET send_status = 'send_failure' WHERE outbox_id = ?").run(outbox.outboxId);

        // Exhausted speech is not serviceable: R1 re-cognition stays available
        // through the normal anchor, while the failed-row path refuses to loop
        // and records exactly one terminal notice.
        const second = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(second.recovered).toBe(0);
        expect(nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(reservationId))
          .toMatchObject({ state: "aborted" });
        const notices = sidecar.prepare(
          "SELECT notice_text FROM system_notice_outbox WHERE notice_key = ?",
        ).all(`delivery_exhausted:speech:${outbox.outboxId}`) as Array<{ notice_text?: unknown }>;
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.notice_text)).toContain("DELIVERY_FAILED");

        // The quarantined anchor remains R1-repairable (bounded re-cognition),
        // and a second sweep creates no duplicate repair and no retry.
        const first = serviceUnansweredOwnerRecovery(sidecar, { nowMs: 3_000 });
        expect(first.createdRepairs).toHaveLength(1);
        expect(first.createdRepairs[0]!.predecessorEventId).toBe(eventA.id);
        const repeat = reconcileUnfulfilledFailedSpeechReservations(nuclear, sidecar, "doc");
        expect(repeat.recovered).toBe(0);
        expect(serviceUnansweredOwnerRecovery(sidecar, { nowMs: 4_000 }).createdRepairs).toHaveLength(0);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });

  describe("Repair 4: legacy wrong-principal fence uses semantic supersession", () => {
    function insertWrongPrincipalReservation(nuclear: DatabaseSync, conversationId: string, outboxId: number, projectionKey: string) {
      const insertRes = nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            draft_text, created_at, cognitive_v021_projection_key,
            speech_outbox_id, destination_json)
         VALUES (?, 'discord', ?, 'reactive', 'reactive', 'reserved', ?, ?, ?, ?, NULL)`,
      ).run(conversationId, conversationId, "legacy draft", "1970-01-01T00:00:01.000Z", projectionKey, outboxId);
      return Number(insertRes.lastInsertRowid);
    }

    it("corrects (not suppresses) when only a silent generation advanced", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r4-silent";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r4-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-r4",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });
        const outbox = insertOutboxPending(sidecar, {
          settlementId: `settlement-${cycle.cycleId}`,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Legacy answer.",
          deliveryIntent: { ...reactiveIntent(conversationId), ownerId: conversationId },
        });
        const reservationId = insertWrongPrincipalReservation(nuclear, conversationId, outbox.outboxId, outbox.projectionKey);

        // Only an unrelated silent generation advances: not supersession.
        admitTestCycle(sidecar, {
          cycleId: "cycle-r4-obs",
          conversationId,
          triggerKind: "observation_or_receipt",
          triggerRef: "operation:detached-operation:12:completion",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        const result = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "doc", 2_500);
        expect(result).toEqual({ corrected: 1, suppressedStale: 0 });
        const reservation = nuclear.prepare(
          "SELECT owner_id, state FROM delivery_reservations WHERE id = ?",
        ).get(reservationId) as { owner_id?: unknown; state?: unknown };
        expect(reservation).toMatchObject({ owner_id: "doc", state: "reserved" });
        expect(getSpeechOutbox(sidecar, outbox.outboxId)?.suppressed).toBe(false);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });

    it("still suppresses when a newer Owner cycle truly preempts", () => {
      const { sidecar, nuclear } = setupDeliveryDatabases();
      try {
        const conversationId = "thread-r4-preempt";
        const cycle = admitTestCycle(sidecar, {
          cycleId: "cycle-r4p-1",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-r4p",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 1_000,
        });
        const outbox = insertOutboxPending(sidecar, {
          settlementId: `settlement-${cycle.cycleId}`,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          conversationId,
          licensedText: "Stale legacy answer.",
          deliveryIntent: { ...reactiveIntent(conversationId), ownerId: conversationId },
        });
        const reservationId = insertWrongPrincipalReservation(nuclear, conversationId, outbox.outboxId, outbox.projectionKey);

        admitTestCycle(sidecar, {
          cycleId: "cycle-r4p-2",
          conversationId,
          triggerKind: "owner_message",
          triggerRef: "owner-r4p-2",
          occupantId: "doc",
          authorityEpoch: 1,
          nowMs: 2_000,
        });

        const result = reconcileLegacyWrongPrincipalSpeechReservations(nuclear, sidecar, "doc", 2_500);
        expect(result).toEqual({ corrected: 0, suppressedStale: 1 });
        const reservation = nuclear.prepare(
          "SELECT state FROM delivery_reservations WHERE id = ?",
        ).get(reservationId) as { state?: unknown };
        expect(reservation.state).toBe("aborted");
        expect(getSpeechOutbox(sidecar, outbox.outboxId)?.suppressed).toBe(true);
      } finally {
        sidecar.close();
        nuclear.close();
      }
    });
  });
});
