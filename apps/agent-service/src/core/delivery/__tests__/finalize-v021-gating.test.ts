import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import "../../qualification/mistral-client-mock.js";
import { openNuclearDb } from "../../db.js";
import { claimReactiveDelivery, attachDraftAndBubbles, recordBubbleReceipt } from "../store.js";
import { finalizeDelivery } from "../finalize.js";
import { persistCommitmentProposals, settlePersistedCommitmentProposals, type CommitmentProposal } from "../../relationship/commitment-admission.js";

const commitmentOwner = "doc";
const commitmentNowMs = Date.parse("2026-09-15T12:00:00.000Z");

function commitmentProposal(): CommitmentProposal {
  return {
    ordinal: 0,
    action: "send the Owner a commitment update",
    beneficiary: "owner",
    destination: { kind: "owner_private" },
    temporal: { kind: "exact", atMs: commitmentNowMs + 60_000 },
    realizationClause: "I will send the Owner a commitment update.",
    thoughtCycle: { cycleId: "cycle-commitment-finalize", attemptId: "attempt-commitment-finalize" },
  };
}

function prepareCommitmentDelivery(input: { identity: boolean; bubbleCount: number; receiptCount: number }) {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  const settlementRef = `finalize-commitment-${input.identity}-${input.bubbleCount}-${input.receiptCount}`;
  persistCommitmentProposals(db, settlementRef, [commitmentProposal()]);
  settlePersistedCommitmentProposals(db, settlementRef, {
    ownerId: commitmentOwner,
    nowMs: commitmentNowMs,
    enabled: true,
  });
  const claim = claimReactiveDelivery(db, {
    ownerId: commitmentOwner,
    channel: "discord",
    mergedUserText: "commitment finalization",
    inboundDiscordMessageIds: [`commitment-${settlementRef}`],
    finalFragmentReceivedAtMs: commitmentNowMs,
    simulateDelivery: true,
  });
  expect(claim.kind).toBe("claimed");
  if (claim.kind !== "claimed") throw new Error("delivery_claim_missing");
  attachDraftAndBubbles(db, claim.reservation.id, "commitment reply", Array.from({ length: input.bubbleCount }, (_, ordinal) => ({
    ordinal,
    text: `commitment bubble ${ordinal}`,
  })));
  for (let ordinal = 0; ordinal < input.receiptCount; ordinal += 1) {
    recordBubbleReceipt(db, claim.reservation.id, ordinal, `commitment-receipt-${ordinal}`);
  }
  if (input.identity) {
    db.prepare(
      "UPDATE delivery_reservations SET commitment_id = ?, speech_outbox_id = ? WHERE id = ?",
    ).run("cmt:" + settlementRef + ":0", 42, claim.reservation.id);
  }
  return { db, reservationId: claim.reservation.id, commitmentId: "cmt:" + settlementRef + ":0" };
}

function prepareReceiptedDelivery() {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  const claim = claimReactiveDelivery(db, {
    ownerId: "doc",
    channel: "discord",
    mergedUserText: "finalize gating",
    inboundDiscordMessageIds: [`mat2-${Date.now()}-${Math.random()}`],
    finalFragmentReceivedAtMs: Date.now(),
    simulateDelivery: true,
  });
  expect(claim.kind).toBe("claimed");
  if (claim.kind !== "claimed") throw new Error("delivery_claim_missing");
  attachDraftAndBubbles(db, claim.reservation.id, "reply", [
    { ordinal: 0, text: "reply" },
  ]);
  recordBubbleReceipt(db, claim.reservation.id, 0, "discord-receipt");
  return { db, reservationId: claim.reservation.id };
}

describe("v021 delivery finalization", () => {
  it("does not enqueue a legacy cognitive job", () => {
    const { db, reservationId } = prepareReceiptedDelivery();
    try {
      const result = finalizeDelivery(db, {
        reservationId,
        ownerId: "doc",
        cause: "complete",
      });

      expect(result.state).toBe("committed");
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM cognitive_jobs").get(),
      ).toEqual({ count: 0 });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM mem_messages WHERE role = 'assistant'").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("settles a fully receipted v021 reservation through commitment identity", () => {
    const { db, reservationId, commitmentId } = prepareCommitmentDelivery({ identity: true, bubbleCount: 1, receiptCount: 1 });
    try {
      const result = finalizeDelivery(db, {
        reservationId,
        ownerId: commitmentOwner,
        cause: "complete",
      });

      expect(result.state).toBe("committed");
      expect(db.prepare("SELECT commitment_state, status FROM ashley_self_commitments WHERE entity_uuid = ?").get(commitmentId))
        .toEqual({ commitment_state: "completed", status: "fulfilled" });
    } finally {
      db.close();
    }
  });

  it("does not settle a historical reservation whose commitment identity is NULL", () => {
    const { db, reservationId, commitmentId } = prepareCommitmentDelivery({ identity: false, bubbleCount: 1, receiptCount: 1 });
    try {
      const result = finalizeDelivery(db, {
        reservationId,
        ownerId: commitmentOwner,
        cause: "complete",
      });

      expect(result.state).toBe("committed");
      expect(db.prepare("SELECT commitment_state, status FROM ashley_self_commitments WHERE entity_uuid = ?").get(commitmentId))
        .toEqual({ commitment_state: "admitted", status: "motivated" });
    } finally {
      db.close();
    }
  });

  it("keeps a partially delivered identity-bound commitment incomplete", () => {
    const { db, reservationId, commitmentId } = prepareCommitmentDelivery({ identity: true, bubbleCount: 2, receiptCount: 1 });
    try {
      const result = finalizeDelivery(db, {
        reservationId,
        ownerId: commitmentOwner,
        cause: "complete",
      });

      expect(result.state).toBe("partially_delivered");
      expect(db.prepare("SELECT commitment_state, status FROM ashley_self_commitments WHERE entity_uuid = ?").get(commitmentId))
        .toEqual({ commitment_state: "admitted", status: "motivated" });
    } finally {
      db.close();
    }
  });

});
