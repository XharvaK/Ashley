import { describe, expect, it } from "vitest";
import { admitTestCycle, makeThoughtDraft, openTestSidecar } from "../test-support.js";
import { publishSemanticTransaction } from "../settlement/publish.js";
import { listRecentJournal } from "../initiative/journal.js";
import { recordSettlementAftermath, recoverSettlementAftermath } from "./aftermath.js";

const NOW = Date.UTC(2026, 9, 1, 12, 0);
const options = { identityStore: null, timeZone: "UTC", nowMs: NOW };

function publishAwakePass(db: ReturnType<typeof openTestSidecar>, withAftermath = true) {
  admitTestCycle(db, { cycleId: "cycle-awake", conversationId: "thread", generation: 1, triggerKind: "idle_opportunity", triggerRef: "awake:1", occupantId: "doc", nowMs: NOW });
  const draft = makeThoughtDraft({
    cycleId: "cycle-awake",
    generation: 1,
    speech: { mode: "none", mustSay: [], mustNot: [], surfaceDraft: null, acceptableRealizations: [], presentationDirectives: [] },
  });
  const settlement = {
    ...draft,
    settlementId: "settlement-awake",
    speech: { ...draft.speech, finalLicensedText: null },
    journal: { activity: "think" as const, entry: "Thought about Kyoto." },
    interests: [{ root: "Cognitive biases", branch: "anchoring", note: "first numbers stick" }],
  };
  const publication = publishSemanticTransaction(db, settlement as typeof settlement & Parameters<typeof publishSemanticTransaction>[1], {
    nowMs: NOW,
    triggerKind: "idle_opportunity",
    ...(withAftermath ? { aftermath: { conversationId: "thread", passKind: "awake" as const, nightPass: null } } : {}),
  });
  expect(publication.published).toBe(true);
}

function livedCount(db: ReturnType<typeof openTestSidecar>): unknown {
  return db.prepare("SELECT lived_count FROM interest_branches WHERE branch_id = 'cognitive-biases/anchoring'").get();
}

describe("R13 settlement aftermath", () => {
  it("owes the aftermath from the moment of publication, and recovery replays it after a crash", () => {
    const db = openTestSidecar();
    try {
      publishAwakePass(db);
      // The process died before the aftermath step ran: the record is owed, not lost.
      expect(db.prepare("SELECT status FROM settlement_aftermath").get()).toEqual({ status: "pending" });
      expect(listRecentJournal(db, { limit: 5 })).toEqual([]);

      expect(recoverSettlementAftermath(db, options)).toEqual({ recorded: 1, failed: 0 });
      expect(listRecentJournal(db, { limit: 5 })).toEqual([expect.objectContaining({ passKind: "awake", activity: "think", entry: "Thought about Kyoto." })]);
      expect(livedCount(db)).toEqual({ lived_count: 1 });
      expect(db.prepare("SELECT status FROM settlement_aftermath").get()).toEqual({ status: "recorded" });
    } finally {
      db.close();
    }
  });

  it("records once however often it is replayed", () => {
    const db = openTestSidecar();
    try {
      publishAwakePass(db);
      expect(recordSettlementAftermath(db, "settlement-awake", options)).toBe("recorded");
      expect(recordSettlementAftermath(db, "settlement-awake", options)).toBe("not_pending");
      expect(recoverSettlementAftermath(db, options)).toEqual({ recorded: 0, failed: 0 });
      expect(livedCount(db)).toEqual({ lived_count: 1 });
    } finally {
      db.close();
    }
  });

  it("owes nothing for a settlement published without an aftermath", () => {
    const db = openTestSidecar();
    try {
      publishAwakePass(db, false);
      expect(db.prepare("SELECT COUNT(*) AS n FROM settlement_aftermath").get()).toEqual({ n: 0 });
      expect(recordSettlementAftermath(db, "settlement-awake", options)).toBe("not_pending");
    } finally {
      db.close();
    }
  });
});

describe("A3c decline aftermath", () => {
  it("stores declines once and recovery respects the original band", () => {
    const db = openTestSidecar();
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sense_declines'").get(), "decline table exists").toBeDefined();
      publishAwakePass(db);
      const row = db.prepare("SELECT payload_json FROM settlements WHERE settlement_id = 'settlement-awake'").get()!;
      const payload = JSON.parse(String(row.payload_json));
      payload.senses = { decline: [{ sense: "backup", rationale: "I have considered this" }] };
      db.prepare("UPDATE settlements SET payload_json = ? WHERE settlement_id = 'settlement-awake'").run(JSON.stringify(payload));
      db.prepare("UPDATE settlement_aftermath SET context_json = ? WHERE settlement_id = 'settlement-awake'").run(JSON.stringify({ conversationId: "thread", passKind: "awake", nightPass: null, senseBands: { backup: "aging" } }));
      expect(recordSettlementAftermath(db, "settlement-awake", { ...options, nowMs: NOW+2*86400000 })).toBe("recorded");
      expect(recordSettlementAftermath(db, "settlement-awake", { ...options, nowMs: NOW+2*86400000 })).toBe("not_pending");
      expect(db.prepare("SELECT sense, rationale, declined_band, declined_at_ms, until_ms FROM sense_declines").all()).toEqual([{ sense: "backup", rationale: "I have considered this", declined_band: "aging", declined_at_ms: NOW, until_ms: NOW+7*86400000 }]);
    } finally { db.close(); }
  });
});
