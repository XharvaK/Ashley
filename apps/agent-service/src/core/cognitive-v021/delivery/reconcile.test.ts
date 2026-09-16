import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { finalizeDelivery } from "../../delivery/finalize.js";
import { recordBubbleReceipt } from "../../delivery/store.js";
import {
  persistCommitmentProposals,
  settlePersistedCommitmentProposals,
  type CommitmentProposal,
} from "../../relationship/commitment-admission.js";
import { openTestSidecar } from "../test-support.js";
import { emitInfrastructureNotice } from "../speech/infrastructure-notice.js";
import { insertOutboxPending } from "../speech/outbox.js";
import {
  markProjectedDeliverySending,
  reconcileProjectedDelivery,
  reconcileProjectedDeliverySweep,
} from "./outbox-projector.js";

describe("v0.2.1 delivery reconciliation", () => {
  it.each(["cancelled", "expired", "aborted"] as const)(
    "preserves the confirmed prefix when the terminal remainder is %s",
    async (state) => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const outbox = insertOutboxPending(sidecar, {
          settlementId: `settlement-prefix-${state}`,
          cycleId: `cycle-prefix-${state}`,
          generation: 1,
          conversationId: `thread-prefix-${state}`,
          licensedText: "first bubble\n\nsecond bubble",
        });
        const projector = new (await import("./outbox-projector.js")).OutboxDeliveryProjector(
          sidecar,
          nuclear,
          { nowMs: () => 1_000 },
        );
        await projector.project(outbox.outboxId);
        const reservationId = Number((sidecar.prepare(
          "SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
        ).get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id);
        recordBubbleReceipt(nuclear, reservationId, 0, `discord-${state}-first`, 2_000);
        nuclear.prepare(
          "UPDATE delivery_reservations SET state = ?, finalization_reason = ?, finalized_at = ? WHERE id = ?",
        ).run(state, `${state}_after_partial`, "2026-09-07T12:00:00.000Z", reservationId);

        expect(reconcileProjectedDelivery(sidecar, nuclear, reservationId)).toBe(true);
        expect(sidecar.prepare(
          "SELECT send_status, discord_message_ids_json, nuclear_finalization_reason FROM speech_outbox WHERE outbox_id = ?",
        ).get(outbox.outboxId)).toEqual({
          send_status: "partially_delivered",
          discord_message_ids_json: JSON.stringify([`discord-${state}-first`]),
          nuclear_finalization_reason: `${state}_after_partial`,
        });
        expect(sidecar.prepare(
          "SELECT text, discord_message_ids_json, delivered FROM conversation_evidence_log WHERE reservation_id = ?",
        ).get(reservationId)).toEqual({
          text: "first bubble",
          discord_message_ids_json: JSON.stringify([`discord-${state}-first`]),
          delivered: 1,
        });

        reconcileProjectedDelivery(sidecar, nuclear, reservationId);
        await projector.project(outbox.outboxId);
        expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log WHERE reservation_id = ?").get(reservationId)).toEqual({ count: 1 });
        expect(nuclear.prepare("SELECT COUNT(*) AS count FROM delivery_reservations").get()).toEqual({ count: 1 });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    },
  );

  it.each(["cancelled", "expired", "aborted"] as const)(
    "classifies a terminal %s reservation with every bubble receipted as complete delivery",
    async (state) => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      try {
        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-full-" + state,
          cycleId: "cycle-full-" + state,
          generation: 1,
          conversationId: "thread-full-" + state,
          licensedText: "first bubble\n\nsecond bubble",
        });
        const { OutboxDeliveryProjector } = await import("./outbox-projector.js");
        await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 }).project(outbox.outboxId);
        const reservationId = Number(
          (sidecar.prepare(
            "SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
          ).get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id,
        );
        recordBubbleReceipt(nuclear, reservationId, 0, "discord-" + state + "-first", 2_000);
        recordBubbleReceipt(nuclear, reservationId, 1, "discord-" + state + "-second", 2_001);
        nuclear.prepare(
          "UPDATE delivery_reservations SET state = ?, finalization_reason = ?, finalized_at = ? WHERE id = ?",
        ).run(state, state + "_after_full_receipt", "2026-09-07T12:00:00.000Z", reservationId);

        expect(reconcileProjectedDelivery(sidecar, nuclear, reservationId)).toBe(true);
        expect(sidecar.prepare(
          "SELECT send_status, discord_message_ids_json, nuclear_finalization_reason FROM speech_outbox WHERE outbox_id = ?",
        ).get(outbox.outboxId)).toEqual({
          send_status: "delivered",
          discord_message_ids_json: JSON.stringify(["discord-" + state + "-first", "discord-" + state + "-second"]),
          nuclear_finalization_reason: state + "_after_full_receipt",
        });
        expect(sidecar.prepare(
          "SELECT text, discord_message_ids_json, delivered FROM conversation_evidence_log WHERE reservation_id = ?",
        ).get(reservationId)).toEqual({
          text: "first bubble\n\nsecond bubble",
          discord_message_ids_json: JSON.stringify(["discord-" + state + "-first", "discord-" + state + "-second"]),
          delivered: 1,
        });
      } finally {
        sidecar.close();
        nuclear.close();
      }
    },
  );

  it("does not create conversation evidence for a cancelled reservation with no valid receipt", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-cancel-no-receipt",
        cycleId: "cycle-cancel-no-receipt",
        generation: 1,
        conversationId: "thread-cancel-no-receipt",
        licensedText: "never delivered",
      });
      const projector = new (await import("./outbox-projector.js")).OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.project(outbox.outboxId);
      const reservationId = Number((sidecar.prepare("SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id);
      nuclear.prepare("UPDATE delivery_reservations SET state = 'cancelled', finalization_reason = 'cancelled', finalized_at = ? WHERE id = ?").run("2026-09-07T12:00:00.000Z", reservationId);

      reconcileProjectedDelivery(sidecar, nuclear, reservationId);
      expect(sidecar.prepare("SELECT send_status FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId)).toEqual({ send_status: "suppressed" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log WHERE reservation_id = ?").get(reservationId)).toEqual({ count: 0 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("fails closed when committed transport truth is incomplete or out of prefix order", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-conflict",
        cycleId: "cycle-conflict",
        generation: 1,
        conversationId: "thread-conflict",
        licensedText: "first bubble\n\nsecond bubble",
      });
      const projector = new (await import("./outbox-projector.js")).OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.project(outbox.outboxId);
      const reservationId = Number((sidecar.prepare("SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id);
      recordBubbleReceipt(nuclear, reservationId, 1, "discord-conflict-second", 2_000);
      nuclear.prepare("UPDATE delivery_reservations SET state = 'committed', finalization_reason = 'all_bubbles_delivered', finalized_at = ? WHERE id = ?").run("2026-09-07T12:00:00.000Z", reservationId);

      reconcileProjectedDelivery(sidecar, nuclear, reservationId);
      expect(sidecar.prepare("SELECT send_status, discord_message_ids_json, nuclear_finalization_reason FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId)).toEqual({
        send_status: "send_failure",
        discord_message_ids_json: "[]",
        nuclear_finalization_reason: "reconciliation_conflict",
      });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log WHERE reservation_id = ?").get(reservationId)).toEqual({ count: 0 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reconciles terminal projection rows through a bounded sweep", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-sweep",
        cycleId: "cycle-sweep",
        generation: 1,
        conversationId: "thread-sweep",
        licensedText: "sweep me",
      });
      const projector = new (await import("./outbox-projector.js")).OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.project(outbox.outboxId);
      const reservationId = Number((sidecar.prepare("SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id);
      nuclear.prepare("UPDATE delivery_reservations SET state = 'cancelled', finalization_reason = 'cancelled', finalized_at = ? WHERE id = ?").run("2026-09-07T12:00:00.000Z", reservationId);

      expect(reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 1 })).toEqual({ scanned: 1, reconciled: 1, conflicts: 0 });
      expect(sidecar.prepare("SELECT send_status FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId)).toEqual({ send_status: "suppressed" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("bounds each sweep to one owner page and progresses to later work", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const rows: Array<{ outboxId: number; reservationId: number }> = [];
      for (let index = 0; index < 51; index += 1) {
        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-sweep-progress-" + index,
          cycleId: "cycle-sweep-progress-" + index,
          generation: 1,
          conversationId: "thread-sweep-progress-" + index,
          licensedText: index === 50 ? "later stranded" : "historical " + index,
        });
        const inserted = nuclear.prepare(
          "INSERT INTO delivery_reservations " +
          "(owner_id, channel, thread_id, trigger, delivery_lane, state, " +
          "draft_text, created_at, cognitive_v021_projection_key) " +
          "VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'cancelled', " +
          "?, '2026-09-07T12:00:00.000Z', ?)",
        ).run(
          "thread-sweep-progress-" + index,
          index === 50 ? "later stranded" : "historical " + index,
          outbox.projectionKey,
        );
        const reservationId = Number(inserted.lastInsertRowid);
        if (index < 50) {
          sidecar.prepare(
            "UPDATE speech_outbox SET send_status = 'suppressed', nuclear_reservation_id = ? WHERE outbox_id = ?",
          ).run(reservationId, outbox.outboxId);
        } else {
          nuclear.prepare(
            "INSERT INTO delivery_bubbles " +
            "(reservation_id, ordinal, text, discord_message_id, sent_at) " +
            "VALUES (?, 0, 'later stranded', 'discord-later', '2026-09-07T12:00:01.000Z')",
          ).run(reservationId);
        }
        rows.push({ outboxId: outbox.outboxId, reservationId });
      }

      expect(reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 50 })).toEqual({
        scanned: 0,
        reconciled: 0,
        conflicts: 0,
      });
      expect(sidecar.prepare(
        "SELECT send_status, nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
      ).get(rows[50].outboxId)).toEqual({
        send_status: "pending",
        nuclear_reservation_id: null,
      });
      expect(nuclear.prepare("SELECT COUNT(*) AS count FROM delivery_reservations").get()).toEqual({ count: 51 });

      expect(reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 50 })).toEqual({
        scanned: 1,
        reconciled: 1,
        conflicts: 0,
      });
      expect(sidecar.prepare(
        "SELECT send_status, nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
      ).get(rows[50].outboxId)).toEqual({
        send_status: "delivered",
        nuclear_reservation_id: rows[50].reservationId,
      });

      expect(reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 50 })).toEqual({
        scanned: 0,
        reconciled: 0,
        conflicts: 0,
      });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log").get()).toEqual({ count: 1 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reaches a later active candidate past an active noncandidate prefix", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      for (let index = 0; index < 51; index += 1) {
        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-sweep-active-prefix-" + index,
          cycleId: "cycle-sweep-active-prefix-" + index,
          generation: 1,
          conversationId: "thread-sweep-active-prefix-" + index,
          licensedText: index === 50 ? "later active candidate" : "active noncandidate " + index,
        });
        if (index !== 50) continue;
        const inserted = nuclear.prepare(
          "INSERT INTO delivery_reservations " +
          "(owner_id, channel, thread_id, trigger, delivery_lane, state, " +
          "draft_text, created_at, cognitive_v021_projection_key) " +
          "VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'cancelled', " +
          "?, '2026-09-07T12:00:00.000Z', ?)",
        ).run("thread-sweep-active-prefix-50", "later active candidate", outbox.projectionKey);
        const reservationId = Number(inserted.lastInsertRowid);
        nuclear.prepare(
          "INSERT INTO delivery_bubbles (reservation_id, ordinal, text, discord_message_id, sent_at) " +
          "VALUES (?, 0, 'later active candidate', 'discord-later-active', '2026-09-07T12:00:01.000Z')",
        ).run(reservationId);
      }

      expect(reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 50 })).toEqual({
        scanned: 1,
        reconciled: 1,
        conflicts: 0,
      });
      expect(sidecar.prepare(
        "SELECT send_status FROM speech_outbox WHERE outbox_id = 51",
      ).get()).toEqual({ send_status: "delivered" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("keeps a system notice reachable across bounded speech-filled sweeps", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      for (let index = 0; index < 50; index += 1) {
        const outbox = insertOutboxPending(sidecar, {
          settlementId: "settlement-sweep-fair-" + index,
          cycleId: "cycle-sweep-fair-" + index,
          generation: 1,
          conversationId: "thread-sweep-fair-" + index,
          licensedText: "speech candidate " + index,
        });
        nuclear.prepare(
          "INSERT INTO delivery_reservations " +
          "(owner_id, channel, thread_id, trigger, delivery_lane, state, " +
          "created_at, cognitive_v021_projection_key) " +
          "VALUES ('doc', 'discord', ?, 'reactive', 'reactive', 'cancelled', " +
          "'2026-09-07T12:00:00.000Z', ?)",
        ).run("thread-sweep-fair-" + index, outbox.projectionKey);
      }
      const notice = emitInfrastructureNotice(sidecar, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-sweep-fair-system",
        conversationId: "thread-sweep-fair-system",
        cycleId: "cycle-sweep-fair-system",
        generation: 1,
        reason: "fairness",
      });
      const noticeReservation = nuclear.prepare(
        "INSERT INTO delivery_reservations " +
        "(owner_id, channel, thread_id, trigger, delivery_lane, state, " +
        "created_at, cognitive_v021_projection_key) " +
        "VALUES ('doc', 'discord', 'thread-sweep-fair-system', 'reactive', 'reactive', 'cancelled', " +
        "'2026-09-07T12:00:00.000Z', ?)",
      ).run(notice.projectionKey);
      nuclear.prepare(
        "INSERT INTO delivery_bubbles (reservation_id, ordinal, text, discord_message_id, sent_at) " +
        "VALUES (?, 0, 'system notice', NULL, NULL)",
      ).run(Number(noticeReservation.lastInsertRowid));

      expect(reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 50 })).toEqual({
        scanned: 50,
        reconciled: 50,
        conflicts: 0,
      });
      expect(sidecar.prepare(
        "SELECT send_status FROM system_notice_outbox WHERE notice_id = ?",
      ).get(notice.noticeId)).toEqual({ send_status: "pending" });
      expect(sidecar.prepare(
        "SELECT COUNT(*) AS count FROM speech_outbox WHERE send_status = 'pending'",
      ).get()).toEqual({ count: 0 });

      expect(reconcileProjectedDeliverySweep(sidecar, nuclear, { limit: 50 })).toEqual({
        scanned: 1,
        reconciled: 1,
        conflicts: 0,
      });
      expect(sidecar.prepare(
        "SELECT send_status FROM system_notice_outbox WHERE notice_id = ?",
      ).get(notice.noticeId)).toEqual({ send_status: "suppressed" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("updates sidecar status and appends receipt-backed Ashley evidence once", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-reconcile",
        cycleId: "cycle-reconcile",
        generation: 1,
        conversationId: "thread-reconcile",
        licensedText: "receipt-backed text",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-reconcile",
          conversationId: "thread-reconcile",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
        },
      });
      const projector = new (await import("./outbox-projector.js")).OutboxDeliveryProjector(
        sidecar,
        nuclear,
        { nowMs: () => 1_000 },
      );
      await projector.project(outbox.outboxId);
      const reservationId = Number(
        (sidecar.prepare(
          "SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
        ).get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id,
      );
      expect(markProjectedDeliverySending(sidecar, nuclear, reservationId)).toBe(true);
      expect(sidecar.prepare(
        "SELECT send_status FROM speech_outbox WHERE outbox_id = ?",
      ).get(outbox.outboxId)).toMatchObject({ send_status: "sending" });

      recordBubbleReceipt(nuclear, reservationId, 0, "discord-reconcile", 2_000);
      finalizeDelivery(nuclear, {
        reservationId,
        ownerId: "doc",
        cause: "complete",
      });
      expect(reconcileProjectedDelivery(sidecar, nuclear, reservationId)).toBe(true);
      expect(sidecar.prepare(
        "SELECT send_status, discord_message_ids_json FROM speech_outbox WHERE outbox_id = ?",
      ).get(outbox.outboxId)).toMatchObject({
        send_status: "delivered",
        discord_message_ids_json: '["discord-reconcile"]',
      });
      expect(sidecar.prepare(
        "SELECT role, text, delivered FROM conversation_evidence_log WHERE reservation_id = ?",
      ).get(reservationId)).toMatchObject({
        role: "ashley",
        text: "receipt-backed text",
        delivered: 1,
      });
      reconcileProjectedDelivery(sidecar, nuclear, reservationId);
      expect(sidecar.prepare(
        "SELECT COUNT(*) AS count FROM conversation_evidence_log WHERE reservation_id = ?",
      ).get(reservationId)).toMatchObject({ count: 1 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("preserves a partial terminal outcome in the sidecar", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-partial-reconcile",
        cycleId: "cycle-partial-reconcile",
        generation: 1,
        conversationId: "thread-partial-reconcile",
        licensedText: "A\n\nB",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-partial-reconcile",
          conversationId: "thread-partial-reconcile",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
        },
      });
      const { OutboxDeliveryProjector } = await import("./outbox-projector.js");
      await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 })
        .project(outbox.outboxId);
      const reservationId = Number(
        (sidecar.prepare(
          "SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
        ).get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id,
      );
      recordBubbleReceipt(nuclear, reservationId, 0, "discord-partial", 2_000);
      finalizeDelivery(nuclear, {
        reservationId,
        ownerId: "doc",
        cause: "send_failure",
      });
      reconcileProjectedDelivery(sidecar, nuclear, reservationId);
      expect(sidecar.prepare(
        "SELECT send_status FROM speech_outbox WHERE outbox_id = ?",
      ).get(outbox.outboxId)).toMatchObject({ send_status: "partially_delivered" });
      expect(sidecar.prepare(
        "SELECT failure_class, external_effect_truth FROM c3_terminal_experiences WHERE source_domain_owner = 'delivery'",
      ).get()).toMatchObject({
        failure_class: "delivery_partially_delivered",
        external_effect_truth: "effect_indeterminate",
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("admits a late receipt as evidence without reopening the terminal reservation", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const nowMs = Date.parse("2026-09-15T12:00:00.000Z");
      const settlementId = "settlement-late-receipt";
      const lateCommitment: CommitmentProposal = {
        ordinal: 0,
        action: "send the Owner a progress update",
        beneficiary: "owner",
        destination: { kind: "owner_private" },
        temporal: { kind: "exact", atMs: nowMs + 60_000 },
        realizationClause: "I will send the Owner a progress update tomorrow.",
        thoughtCycle: { cycleId: "cycle-late-receipt", attemptId: "attempt-late-receipt" },
      };
      persistCommitmentProposals(nuclear, settlementId, [lateCommitment]);
      expect(settlePersistedCommitmentProposals(nuclear, settlementId, {
        ownerId: "doc",
        nowMs,
        enabled: true,
      })).toMatchObject([{ admitted: true, commitmentId: "cmt:settlement-late-receipt:0" }]);

      const outbox = insertOutboxPending(sidecar, {
        settlementId,
        cycleId: "cycle-late-receipt",
        generation: 1,
        conversationId: "thread-late-receipt",
        licensedText: "first bubble\n\nsecond bubble",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-late-receipt",
          conversationId: "thread-late-receipt",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
        },
        commitmentBindings: [{
          commitmentId: "cmt:settlement-late-receipt:0",
          realizationClauseHash: "hash-late-receipt",
          admissionRevision: 0,
        }],
      });
      const { OutboxDeliveryProjector } = await import("./outbox-projector.js");
      await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 })
        .project(outbox.outboxId);
      const reservationId = Number(
        (sidecar.prepare(
          "SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
        ).get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id,
      );

      recordBubbleReceipt(nuclear, reservationId, 0, "discord-late-first", 2_000);
      finalizeDelivery(nuclear, {
        reservationId,
        ownerId: "doc",
        cause: "send_failure",
      });
      expect(nuclear.prepare(
        "SELECT state FROM delivery_reservations WHERE id = ?",
      ).get(reservationId)).toEqual({ state: "partially_delivered" });
      expect(nuclear.prepare(
        "SELECT commitment_state, status FROM ashley_self_commitments WHERE entity_uuid = ?",
      ).get("cmt:settlement-late-receipt:0")).toEqual({ commitment_state: "admitted", status: "motivated" });

      recordBubbleReceipt(nuclear, reservationId, 1, "discord-late-second", 2_001);
      expect(nuclear.prepare(
        "SELECT state, first_sent_at FROM delivery_reservations WHERE id = ?",
      ).get(reservationId)).toMatchObject({ state: "partially_delivered", first_sent_at: "1970-01-01T00:00:02.000Z" });
      expect(nuclear.prepare(
        "SELECT discord_message_id FROM delivery_bubbles WHERE reservation_id = ? AND ordinal = 1",
      ).get(reservationId)).toEqual({ discord_message_id: "discord-late-second" });
      expect(nuclear.prepare(
        "SELECT commitment_state, status FROM ashley_self_commitments WHERE entity_uuid = ?",
      ).get("cmt:settlement-late-receipt:0")).toEqual({ commitment_state: "completed", status: "fulfilled" });

      expect(finalizeDelivery(nuclear, {
        reservationId,
        ownerId: "doc",
        cause: "complete",
      })).toMatchObject({
        state: "partially_delivered",
        receiptCount: 2,
        plannedCount: 2,
      });
      expect(nuclear.prepare(
        "SELECT state FROM delivery_reservations WHERE id = ?",
      ).get(reservationId)).toEqual({ state: "partially_delivered" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("does not mint a C3 terminal experience for a cancelled reservation", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-cancel-reconcile",
        cycleId: "cycle-cancel-reconcile",
        generation: 1,
        conversationId: "thread-cancel-reconcile",
        licensedText: "cancelled text",
      });
      const { OutboxDeliveryProjector } = await import("./outbox-projector.js");
      await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 }).project(outbox.outboxId);
      const reservationId = Number((sidecar.prepare(
        "SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?",
      ).get(outbox.outboxId) as { nuclear_reservation_id: number }).nuclear_reservation_id);
      finalizeDelivery(nuclear, { reservationId, ownerId: "unknown", cause: "cancel" });
      reconcileProjectedDelivery(sidecar, nuclear, reservationId);
      expect(sidecar.prepare("SELECT send_status FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId)).toMatchObject({ send_status: "suppressed" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toMatchObject({ count: 0 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});
