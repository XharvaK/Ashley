import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, nuclearSchemaVersion, NUCLEAR_SUPPORTED_VERSION } from "../../db.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { insertOutboxPending } from "../speech/outbox.js";
import { emitInfrastructureNotice, THOUGHT_UNAVAILABLE_NOTICE, updateSystemNoticeStatus } from "../speech/infrastructure-notice.js";
import { OutboxDeliveryProjector } from "./outbox-projector.js";
import { recheckOwnerRoomPublicationReservation } from "../settlement/publish.js";
import { upsertTrustedRoom } from "../../relationship/social-authority.js";

type PlannedBubbleFixture = {
  discordMessageId?: string | null;
  sentAt?: string | null;
};

function seedSystemReservation(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  suffix: string,
  options: {
    state?: string;
    bubbles?: PlannedBubbleFixture[];
    existingId?: string | null;
  } = {},
) {
  const threadId = `thread-correlation-${suffix}`;
  const notice = emitInfrastructureNotice(sidecar, {
    ownerId: "doc",
    channel: "discord",
    threadId,
    conversationId: threadId,
    reason: `correlation-${suffix}`,
  });
  if (options.existingId !== undefined) {
    sidecar.prepare(
      "UPDATE system_notice_outbox SET discord_message_id = ? WHERE notice_id = ?",
    ).run(options.existingId, notice.noticeId);
  }
  const reservation = nuclear.prepare(
    `INSERT INTO delivery_reservations
       (owner_id, channel, thread_id, trigger, delivery_lane, state,
        draft_text, created_at, cognitive_v021_projection_key)
     VALUES (?, ?, ?, 'reactive', 'reactive', ?, ?, ?, ?)`,
  ).run(
    "doc",
    "discord",
    threadId,
    options.state ?? "committed",
    notice.noticeText,
    "1970-01-01T00:00:01.000Z",
    notice.projectionKey,
  );
  const reservationId = Number(reservation.lastInsertRowid);
  const insertBubble = nuclear.prepare(
    `INSERT INTO delivery_bubbles
       (reservation_id, ordinal, text, discord_message_id, sent_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const [ordinal, bubble] of (options.bubbles ?? []).entries()) {
    insertBubble.run(
      reservationId,
      ordinal,
      `bubble-${suffix}-${ordinal}`,
      bubble.discordMessageId ?? null,
      bubble.sentAt ?? null,
    );
  }
  return { notice, reservationId };
}

describe("v0.2.1 cross-database outbox projection", () => {
  it("carries an authenticated Owner room destination without external admission", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const previousSeed = process.env.RA_ROOM_SEED_ACTIVE;
    const previousPublication = process.env.RA_ROOM_PUBLICATION;
    process.env.RA_ROOM_SEED_ACTIVE = "true";
    process.env.RA_ROOM_PUBLICATION = "owner-channel";
    try {
      upsertTrustedRoom(nuclear, {
        ownerId: "doc",
        guildId: "owner-guild",
        channelId: "owner-channel",
        mode: "trusted_social",
        provenance: "explicit_config",
        addedBy: "doc",
        nowMs: 1,
      });
      const row = insertOutboxPending(sidecar, {
        settlementId: "owner-room-settlement",
        cycleId: "owner-room-cycle",
        generation: 1,
        conversationId: "room:owner-guild:owner-channel",
        licensedText: "room-bound Owner answer",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "room:owner-guild:owner-channel",
          conversationId: "room:owner-guild:owner-channel",
          trigger: "owner_message_reactive",
          deliveryLane: "reactive",
          purpose: "licensed_speech",
          destination: {
            kind: "room",
            roomId: "room:owner-guild:owner-channel",
            guildId: "owner-guild",
            channelId: "owner-channel",
            ownerRoom: true,
          },
        },
      });
      await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 }).project(row.outboxId);
      const reservation = nuclear.prepare(
        "SELECT state, destination_json, attempt_input_basis_json FROM delivery_reservations",
      ).get() as { state: string; destination_json: string; attempt_input_basis_json: string | null };
      expect(reservation.state).toBe("reserved");
      expect(JSON.parse(reservation.destination_json)).toMatchObject({
        kind: "room",
        roomId: "room:owner-guild:owner-channel",
        ownerRoom: true,
      });
      expect(reservation.attempt_input_basis_json).toBeNull();
      expect(recheckOwnerRoomPublicationReservation(nuclear, 1)).toEqual({ ok: true });
    } finally {
      if (previousSeed === undefined) delete process.env.RA_ROOM_SEED_ACTIVE;
      else process.env.RA_ROOM_SEED_ACTIVE = previousSeed;
      if (previousPublication === undefined) delete process.env.RA_ROOM_PUBLICATION;
      else process.env.RA_ROOM_PUBLICATION = previousPublication;
      sidecar.close();
      nuclear.close();
    }
  });

  it("uses a versioned nuclear key and keeps speech/system namespaces distinct", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(nuclearSchemaVersion(nuclear)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(nuclear.prepare("PRAGMA table_info(delivery_reservations)").all()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "cognitive_v021_projection_key" })]));
      admitTestCycle(sidecar, { cycleId: "cycle-project", conversationId: "thread-project", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      const speech = insertOutboxPending(sidecar, { settlementId: "settlement-project", cycleId: "cycle-project", generation: 1, conversationId: "thread-project", licensedText: "hello" });
      const notice = emitInfrastructureNotice(sidecar, { ownerId: "doc", channel: "discord", threadId: "thread-project", conversationId: "thread-project", cycleId: "cycle-project", generation: 1, reason: "unavailable" });
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.project(speech.outboxId);
      await projector.projectSystem(notice.noticeId);
      expect(nuclear.prepare("SELECT cognitive_v021_projection_key, draft_text FROM delivery_reservations ORDER BY id").all()).toEqual([
        expect.objectContaining({ cognitive_v021_projection_key: "speech:1", draft_text: "hello" }),
        expect.objectContaining({ cognitive_v021_projection_key: "system:1", draft_text: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: UNKNOWN` }),
      ]);
      await projector.project(speech.outboxId);
      expect(nuclear.prepare("SELECT COUNT(*) AS count FROM delivery_reservations").get()).toMatchObject({ count: 2 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("binds the stored commitment identity and speech outbox id to the reservation", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const speech = insertOutboxPending(sidecar, {
        settlementId: "settlement-commitment-identity",
        cycleId: "cycle-commitment-identity",
        generation: 1,
        conversationId: "thread-commitment-identity",
        licensedText: "commitment realization",
        commitmentBindings: [{
          commitmentId: "cmt:commitment-identity:0",
          realizationClauseHash: "clause-hash",
          admissionRevision: 7,
        }],
      });

      await new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 }).project(speech.outboxId);

      expect(nuclear.prepare(
        "SELECT commitment_id, commitment_occurrence_id, commitment_attempt_id, speech_outbox_id, cognitive_v021_projection_key FROM delivery_reservations",
      ).get()).toEqual({
        commitment_id: "cmt:commitment-identity:0",
        commitment_occurrence_id: null,
        commitment_attempt_id: null,
        speech_outbox_id: speech.outboxId,
        cognitive_v021_projection_key: `speech:${speech.outboxId}`,
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reconciles a destination reservation that already committed", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      admitTestCycle(sidecar, { cycleId: "cycle-commit", conversationId: "thread-commit", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      const speech = insertOutboxPending(sidecar, { settlementId: "settlement-commit", cycleId: "cycle-commit", generation: 1, conversationId: "thread-commit", licensedText: "already sent" });
      const reservation = nuclear.prepare(`INSERT INTO delivery_reservations (owner_id, channel, thread_id, trigger, delivery_lane, state, draft_text, created_at, cognitive_v021_projection_key) VALUES ('doc', 'discord', 'thread-commit', 'reactive', 'reactive', 'committed', 'already sent', '1970-01-01T00:00:01.000Z', ?)`).run("speech:" + speech.outboxId);
      nuclear.prepare(
        "INSERT INTO delivery_bubbles (reservation_id, ordinal, text, discord_message_id, sent_at) VALUES (?, 0, ?, ?, ?)",
      ).run(Number(reservation.lastInsertRowid), "already sent", "discord-commit", "2026-09-07T12:00:00.000Z");
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
      await projector.project(speech.outboxId);
      expect(sidecar.prepare("SELECT send_status, nuclear_reservation_id FROM speech_outbox WHERE outbox_id = ?").get(speech.outboxId)).toMatchObject({ send_status: "delivered", nuclear_reservation_id: 1 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("defers a proactive daily-cap row, then suppresses it after revalidation", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const row = insertOutboxPending(sidecar, {
        settlementId: "settlement-deferred",
        cycleId: "cycle-deferred",
        generation: 1,
        conversationId: "thread-deferred",
        licensedText: "proactive draft",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-deferred",
          conversationId: "thread-deferred",
          trigger: "idle",
          deliveryLane: "proactive",
          purpose: "licensed_speech",
        },
      });
      let cap = true;
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, {
        gate: () => cap ? { ok: false, reason: "daily_cap" } : { ok: false, reason: "proactive_paused" },
      });
      await projector.project(row.outboxId);
      expect(sidecar.prepare("SELECT send_status FROM speech_outbox WHERE outbox_id = ?").get(row.outboxId)).toMatchObject({ send_status: "pending" });
      expect(nuclear.prepare("SELECT COUNT(*) AS count FROM delivery_reservations").get()).toMatchObject({ count: 0 });
      cap = false;
      await projector.project(row.outboxId);
      expect(sidecar.prepare("SELECT send_status, nuclear_finalization_reason FROM speech_outbox WHERE outbox_id = ?").get(row.outboxId)).toMatchObject({ send_status: "suppressed", nuclear_finalization_reason: "proactive_paused" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("suppresses a deferred row when its publisher generation is no longer current", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const row = insertOutboxPending(sidecar, {
        settlementId: "settlement-superseded",
        cycleId: "cycle-superseded",
        generation: 1,
        conversationId: "thread-superseded",
        licensedText: "stale proactive draft",
        deliveryIntent: {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-superseded",
          conversationId: "thread-superseded",
          trigger: "future_trigger",
          deliveryLane: "proactive",
          purpose: "licensed_speech",
        },
      });
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, {
        gate: () => ({ ok: false, reason: "daily_cap" }),
        isCurrentGeneration: () => false,
      });
      await projector.project(row.outboxId);
      expect(sidecar.prepare("SELECT send_status, nuclear_finalization_reason FROM speech_outbox WHERE outbox_id = ?").get(row.outboxId)).toMatchObject({ send_status: "suppressed", nuclear_finalization_reason: "superseded_generation" });
      expect(nuclear.prepare("SELECT COUNT(*) AS count FROM delivery_reservations").get()).toMatchObject({ count: 0 });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("projects only a complete singular receipt and preserves lifecycle truth", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const projector = new OutboxDeliveryProjector(sidecar, nuclear, { nowMs: () => 1_000 });
    const sentAt = "2026-09-07T12:00:00.000Z";
    const matrix: Array<{
      suffix: string;
      bubbles: PlannedBubbleFixture[];
      expectedId: string | null;
    }> = [
      { suffix: "zero", bubbles: [], expectedId: null },
      { suffix: "missing-id", bubbles: [{ sentAt }], expectedId: null },
      { suffix: "missing-sent-at", bubbles: [{ discordMessageId: "msg-2" }], expectedId: null },
      { suffix: "empty-sent-at", bubbles: [{ discordMessageId: "msg-3", sentAt: " " }], expectedId: null },
      { suffix: "empty-id", bubbles: [{ discordMessageId: " ", sentAt }], expectedId: null },
      { suffix: "valid", bubbles: [{ discordMessageId: "msg-valid", sentAt }], expectedId: "msg-valid" },
      {
        suffix: "multiple",
        bubbles: [
          { discordMessageId: "msg-first", sentAt },
          { discordMessageId: "msg-second", sentAt },
        ],
        expectedId: null,
      },
    ];
    try {
      for (const entry of matrix) {
        const seeded = seedSystemReservation(sidecar, nuclear, entry.suffix, {
          bubbles: entry.bubbles,
          existingId: "stale-id",
        });
        await projector.projectSystem(seeded.notice.noticeId);
        const projected = sidecar.prepare(
          "SELECT send_status, discord_message_id FROM system_notice_outbox WHERE notice_id = ?",
        ).get(seeded.notice.noticeId) as { send_status: string; discord_message_id: string | null };
        const expectedStatus = entry.expectedId === "msg-valid" ? "delivered" : "send_failure";
        expect(projected).toEqual({ send_status: expectedStatus, discord_message_id: entry.expectedId });
        expect(nuclear.prepare("SELECT COUNT(*) AS count FROM delivery_reservations WHERE id = ?").get(seeded.reservationId)).toMatchObject({ count: 1 });
      }

      const sending = seedSystemReservation(sidecar, nuclear, "sending", {
        state: "sending",
        bubbles: [{ discordMessageId: "msg-sending", sentAt }],
      });
      await projector.projectSystem(sending.notice.noticeId);
      expect(sidecar.prepare(
        "SELECT send_status, discord_message_id FROM system_notice_outbox WHERE notice_id = ?",
      ).get(sending.notice.noticeId)).toEqual({ send_status: "sending", discord_message_id: "msg-sending" });

      const partial = seedSystemReservation(sidecar, nuclear, "partial", {
        state: "partially_delivered",
        bubbles: [
          { discordMessageId: "msg-partial-first", sentAt },
          { discordMessageId: "msg-partial-second", sentAt },
        ],
      });
      await projector.projectSystem(partial.notice.noticeId);
      expect(sidecar.prepare(
        "SELECT send_status, discord_message_id FROM system_notice_outbox WHERE notice_id = ?",
      ).get(partial.notice.noticeId)).toEqual({ send_status: "send_failure", discord_message_id: null });

      const repeated = seedSystemReservation(sidecar, nuclear, "repeated", {
        bubbles: [{ discordMessageId: "msg-repeated", sentAt }],
      });
      await projector.projectSystem(repeated.notice.noticeId);
      await projector.projectSystem(repeated.notice.noticeId);
      expect(nuclear.prepare("SELECT COUNT(*) AS count FROM delivery_reservations WHERE cognitive_v021_projection_key = ?").get(repeated.notice.projectionKey)).toMatchObject({ count: 1 });
      expect(sidecar.prepare(
        "SELECT send_status, discord_message_id FROM system_notice_outbox WHERE notice_id = ?",
      ).get(repeated.notice.noticeId)).toEqual({ send_status: "delivered", discord_message_id: "msg-repeated" });

      const direct = emitInfrastructureNotice(sidecar, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-tristate",
        conversationId: "thread-tristate",
        reason: "tristate",
      });
      updateSystemNoticeStatus(sidecar, direct.noticeId, "projected", { discordMessageId: "keep-id" });
      updateSystemNoticeStatus(sidecar, direct.noticeId, "projected");
      expect(sidecar.prepare("SELECT discord_message_id FROM system_notice_outbox WHERE notice_id = ?").get(direct.noticeId)).toMatchObject({ discord_message_id: "keep-id" });
      updateSystemNoticeStatus(sidecar, direct.noticeId, "projected", { discordMessageId: null });
      expect(sidecar.prepare("SELECT discord_message_id FROM system_notice_outbox WHERE notice_id = ?").get(direct.noticeId)).toMatchObject({ discord_message_id: null });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});
