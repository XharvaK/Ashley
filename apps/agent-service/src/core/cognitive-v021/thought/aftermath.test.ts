import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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


describe("GS1 aftermath classification", () => {
  it.each([true, false, undefined])("labels all writes with sawSecret=%s on live and recovery paths", (sawSecret) => {
    for (const recovery of [false, true]) {
      const db = openTestSidecar();
      try {
        publishAwakePass(db);
        db.prepare("INSERT INTO friction_events (friction_id, kind, occurred_at_ms, evidence_refs_json, data_classification) VALUES ('basis', 'self_reported', ?, '[]', 'ordinary')").run(NOW);
        const row = db.prepare("SELECT payload_json FROM settlements").get()!;
        const payload = JSON.parse(String(row.payload_json));
        if (sawSecret !== undefined) payload.sawSecret = sawSecret;
        payload.growth = {
          appraisal: { note: "calm", valence: 0.1 },
          expectations: ["a quiet day"],
          friction: [{ kind: "self_reported", note: "a recurring difficulty", refs: [] }],
          revisions: [{ layer: "practice", topic: "pausing", text: "Pause before replying", rationale: "helps", evidenceRefs: ["friction:basis"] }],
        };
        payload.night = { diary: "a quiet day", narrative: "learning patience" };
        payload.senses = { decline: [{ sense: "backup", rationale: "considered" }] };
        db.prepare("UPDATE settlements SET payload_json = ?").run(JSON.stringify(payload));
        db.prepare("UPDATE settlement_aftermath SET context_json = ?").run(JSON.stringify({ conversationId: "thread", passKind: "night", nightPass: { kind: "night", slot: 7, sinceMs: NOW - 86400000, weekly: true, weekSinceMs: NOW - 7*86400000 }, senseBands: { backup: "aging" } }));
        if (recovery) expect(recoverSettlementAftermath(db, options)).toEqual({ recorded: 1, failed: 0 });
        else expect(recordSettlementAftermath(db, "settlement-awake", options)).toBe("recorded");
        const expected = sawSecret === false ? "ordinary" : "never_public";
        for (const table of ["mood_events", "expectations", "growth_revisions", "diary_entries", "self_narratives", "activity_journal", "sense_declines"]) {
          expect(db.prepare(`SELECT data_classification FROM ${table}`).all(), table).toEqual([{ data_classification: expected }]);
        }
        expect(db.prepare("SELECT data_classification FROM friction_events WHERE friction_id = 'basis'").get()).toEqual({ data_classification: "ordinary" });
        expect(db.prepare("SELECT data_classification FROM friction_events WHERE cycle_id = 'cycle-awake'").get()).toEqual({ data_classification: expected });
      } finally { db.close(); }
    }
  });
});

describe("A1-2 home ops are file effects, applied once after the aftermath rows commit", () => {
  it("does not append twice when the aftermath fails after the home write and recovery replays it", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "aftermath-home-"));
    const db = openTestSidecar();
    try {
      publishAwakePass(db);
      const row = db.prepare("SELECT payload_json FROM settlements WHERE settlement_id = 'settlement-awake'").get()!;
      const payload = JSON.parse(String(row.payload_json));
      payload.home = [{ op: "append", path: "notes.md", content: "one line\n" }];
      db.prepare("UPDATE settlements SET payload_json = ? WHERE settlement_id = 'settlement-awake'").run(JSON.stringify(payload));
      // A later step fails once, after the home file was written.
      db.exec("CREATE TRIGGER fixture_record_fail BEFORE UPDATE OF status ON settlement_aftermath WHEN NEW.status = 'recorded' BEGIN SELECT RAISE(ABORT, 'fixture_record_fail'); END");
      const withHome = { ...options, dataDir };
      expect(() => recordSettlementAftermath(db, "settlement-awake", withHome)).toThrow();
      db.exec("DROP TRIGGER fixture_record_fail");
      expect(recoverSettlementAftermath(db, withHome)).toEqual({ recorded: 1, failed: 0 });
      expect(readFileSync(join(dataDir, "home", "notes.md"), "utf8")).toBe("one line\n");
      expect(db.prepare("SELECT status FROM settlement_aftermath").get()).toEqual({ status: "recorded" });
    } finally {
      db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("A10 N1 guest turns cannot write growth or interest touches", () => {
  it.each([false, true])("gates growth and interests on the owner-private audience (ownerPrivate=%s)", (ownerPrivate) => {
    const db = openTestSidecar();
    try {
      publishAwakePass(db);
      const row = db.prepare("SELECT payload_json FROM settlements WHERE settlement_id = 'settlement-awake'").get()!;
      const payload = JSON.parse(String(row.payload_json));
      payload.growth = { appraisal: { note: "calm", valence: 0.1 } };
      db.prepare("UPDATE settlements SET payload_json = ? WHERE settlement_id = 'settlement-awake'").run(JSON.stringify(payload));
      db.prepare("UPDATE settlement_aftermath SET context_json = ?").run(JSON.stringify({ conversationId: "thread", passKind: "awake", nightPass: null, ownerPrivate }));
      expect(recordSettlementAftermath(db, "settlement-awake", options)).toBe("recorded");
      const touches = db.prepare("SELECT COUNT(*) AS n FROM interest_touches").get();
      const moods = db.prepare("SELECT COUNT(*) AS n FROM mood_events").get();
      expect(touches).toEqual({ n: ownerPrivate ? 1 : 0 });
      expect(moods).toEqual({ n: ownerPrivate ? 1 : 0 });
    } finally {
      db.close();
    }
  });
});
