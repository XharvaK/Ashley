import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendAshleyEvidence, appendOwnerUtterance } from "../evidence/conversation-log.js";
import { retireStaleReconcilingOwnerRows, STALE_RECONCILING_OWNER_MS } from "./owner-recovery.js";

const NOW = Date.parse("2026-10-06T06:30:00.000Z");
const OLD = NOW - 8 * 24 * 60 * 60_000;

function stuck(db: ReturnType<typeof openTestSidecar>, id: string, atMs: number) {
  const evidence = appendOwnerUtterance(db, { conversationId: "owner-thread", text: `message ${id}`, discordMessageIds: [id], nowMs: atMs });
  appendInboxEvent(db, { id, conversationId: "owner-thread", kind: "owner_utterance", payload: { evidenceRowId: evidence.rowId }, createdAtMs: atMs });
  db.prepare("UPDATE inbox_events SET state = 'reconciling', status = 'claimed' WHERE id = ?").run(id);
}

describe("stale reconciling Owner rows", () => {
  it("retires a row stuck for over a day that she has answered since, and leaves recent or unanswered ones", () => {
    const db = openTestSidecar();
    try {
      stuck(db, "old-answered", OLD);
      appendAshleyEvidence(db, { conversationId: "owner-thread", text: "a later reply", discordMessageIds: ["a1"], nowMs: OLD + 60_000,
        producingCycleId: "c", delivered: true, speakerKind: "ashley", audienceAtCapture: "dm", dataClassification: "ordinary" });
      stuck(db, "recent", NOW - STALE_RECONCILING_OWNER_MS + 60_000);
      expect(retireStaleReconcilingOwnerRows(db, NOW)).toEqual(["old-answered"]);
      expect(db.prepare("SELECT state, terminal_reason FROM inbox_events WHERE id = 'old-answered'").get())
        .toEqual({ state: "terminal", terminal_reason: "stale" });
      expect(db.prepare("SELECT state FROM inbox_events WHERE id = 'recent'").get()).toEqual({ state: "reconciling" });

      const lonely = openTestSidecar();
      try {
        stuck(lonely, "old-unanswered", OLD);
        expect(retireStaleReconcilingOwnerRows(lonely, NOW)).toEqual([]);
      } finally { lonely.close(); }
    } finally { db.close(); }
  });
});
