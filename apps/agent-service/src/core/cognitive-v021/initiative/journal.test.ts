import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendAshleyEvidence, appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { applyV021Forget } from "../memory/forget.js";
import { listInterestBranches, recordInterestTouches } from "../memory/interests.js";
import { JOURNAL_THOUGHT_LIMIT, journalForThought, listRecentJournal, recordJournalEntry } from "./journal.js";
import { UNSOLICITED_FUSE_LIMIT, countUnsolicited, recentUnsolicited, unsolicitedFuseTripped } from "./reach-out.js";

const T0 = Date.UTC(2026, 8, 29, 12, 0);
const MINUTE = 60_000;

function observe(db: DatabaseSync, input: { id: string; cycleId: string; modality: string; provenance: string; payload: unknown }): void {
  db.prepare(
    `INSERT INTO observations (observation_id, cycle_id, generation, derived, replay_safe, modality, payload_json, provenance, data_classification, secret_omitted, created_at_ms)
     VALUES (?, ?, 1, 0, 1, ?, ?, ?, 'ordinary', 0, ?)`,
  ).run(input.id, input.cycleId, input.modality, JSON.stringify(input.payload), input.provenance, T0);
}

describe("activity journal", () => {
  it("records what the Host saw her read, keeps her words, and writes once per cycle", () => {
    const db = openTestSidecar();
    try {
      observe(db, { id: "obs-page", cycleId: "cycle-read", modality: "page", provenance: "perception:web-fetch", payload: { finalUrl: "https://example.org/basic-channel" } });
      observe(db, { id: "obs-memory", cycleId: "cycle-read", modality: "text", provenance: "sidecar:memory.lookup", payload: { hits: [] } });
      const recorded = recordJournalEntry(db, {
        conversationId: "thread", cycleId: "cycle-read", passKind: "awake",
        claim: { activity: "read", entry: "Read about Basic Channel." }, spoke: false, nowMs: T0,
      });
      expect(recorded).toMatchObject({ activity: "read", readRefs: 1 });
      // Replays write nothing twice.
      recordJournalEntry(db, { conversationId: "thread", cycleId: "cycle-read", passKind: "awake", spoke: true, nowMs: T0 + MINUTE });
      const [entry] = listRecentJournal(db, { limit: 5 });
      expect(entry).toMatchObject({ activity: "read", entry: "Read about Basic Channel.", spoke: false });
      expect(entry?.reads).toEqual([{ observationId: "obs-page", modality: "page", label: "https://example.org/basic-channel" }]);
      expect(journalForThought(db, T0 + MINUTE)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("does not record reading where nothing was read", () => {
    const db = openTestSidecar();
    try {
      expect(recordJournalEntry(db, {
        conversationId: "thread", cycleId: "cycle-empty", passKind: "awake",
        claim: { activity: "read", entry: "Read a great essay." }, spoke: false, nowMs: T0,
      })).toMatchObject({ activity: null, readRefs: 0 });
      expect(listRecentJournal(db, { limit: 5 })[0]).toMatchObject({ activity: null, entry: "Read a great essay.", reads: [] });
      // With no claim at all, the Host facts of the pass still stand.
      recordJournalEntry(db, { conversationId: "thread", cycleId: "cycle-silent", passKind: "afterglow", spoke: false, nowMs: T0 + MINUTE });
      expect(listRecentJournal(db, { limit: 5 })[0]).toMatchObject({ passKind: "afterglow", activity: null, entry: null });
    } finally {
      db.close();
    }
  });

  it("forgets entries that mention the topic or cite a read the forget redacted", () => {
    const db = openTestSidecar();
    try {
      observe(db, { id: "obs-kyoto", cycleId: "cycle-a", modality: "page", provenance: "perception:web-fetch", payload: { contentUtf8: "Ryokan prices in Kyoto" } });
      recordJournalEntry(db, { conversationId: "thread", cycleId: "cycle-a", passKind: "awake", claim: { activity: "read", entry: "Looked into lodging." }, spoke: false, nowMs: T0 });
      recordJournalEntry(db, { conversationId: "thread", cycleId: "cycle-b", passKind: "awake", claim: { activity: "think", entry: "Thought about the Kyoto trip." }, spoke: false, nowMs: T0 });
      recordJournalEntry(db, { conversationId: "thread", cycleId: "cycle-c", passKind: "awake", claim: { activity: "rest", entry: "Rested." }, spoke: false, nowMs: T0 });
      recordInterestTouches(db, [{ root: "Cities & travel", branch: "Kyoto ryokans" }], T0);

      applyV021Forget(db, { topic: "kyoto", nowMs: T0 + MINUTE });

      expect(listRecentJournal(db, { limit: 5 }).map((entry) => entry.entry)).toEqual(["Rested."]);
      const forgotten = db.prepare("SELECT entry, read_refs_json FROM activity_journal WHERE cycle_id = 'cycle-a'").get();
      expect(forgotten).toEqual({ entry: null, read_refs_json: "[]" });
      expect(listInterestBranches(db, T0).some((branch) => branch.label.toLowerCase().includes("kyoto"))).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe("H0.4 quiet passes in the journal", () => {
  it("reads a run of wordless passes on one channel as one line, so they never crowd out the rest", () => {
    const db = openTestSidecar();
    try {
      const pass = (cycleId: string, minute: number, input: { entry?: string; channel?: `domus:${string}` } = {}) =>
        recordJournalEntry(db, { conversationId: "thread", cycleId, passKind: input.channel ? "private" : "awake", spoke: false,
          nowMs: T0 + minute * MINUTE, ...(input.channel ? { channel: input.channel } : {}),
          ...(input.entry ? { claim: { activity: "think" as const, entry: input.entry } } : {}) });
      pass("chat-thought", 0, { entry: "Thinking about the record fair." });
      pass("game-start", 1, { channel: "domus:slot8", entry: "Home, hungry." });
      for (let index = 0; index < 40; index++) pass(`game-quiet-${index}`, 2 + index, { channel: "domus:slot8" });
      pass("game-meal", 50, { channel: "domus:slot8", entry: "Ate at last." });
      const all = journalForThought(db, T0 + 60 * MINUTE);
      expect(all.map(item => item.entry ?? `quiet:${item.quiet}`)).toEqual(["Ate at last.", "quiet:40", "Home, hungry.", "Thinking about the record fair."]);
      expect(all[1]).toMatchObject({ channel: "domus:slot8", quiet: 40, sinceMs: T0 + 2 * MINUTE, atMs: T0 + 41 * MINUTE });
      expect(all.length).toBeLessThanOrEqual(JOURNAL_THOUGHT_LIMIT);
      // A Domus pass reads its own world's lane only.
      expect(journalForThought(db, T0 + 60 * MINUTE, "domus:slot8").map(item => item.entry ?? item.quiet)).toEqual(["Ate at last.", 40, "Home, hungry."]);
    } finally {
      db.close();
    }
  });
});

describe("interest graph", () => {
  it("grows the branches she lives, sprouts new ones, and lets the untouched fade", () => {
    const db = openTestSidecar();
    try {
      const month = 30 * 24 * 60 * MINUTE;
      const grown = recordInterestTouches(db, [
        { root: "Electronic music", branch: "dub techno", note: "Basic Channel" },
        { root: "Philosophy", branch: "compatibilism" },
        { root: "Knitting", branch: "cables" },
        { root: "Philosophy", branch: "   " },
      ], T0);
      expect(grown).toEqual(["electronic-music/dub-techno", "philosophy/compatibilism"]);
      const branches = listInterestBranches(db, T0 + month);
      const dub = branches.find((branch) => branch.branchId === "electronic-music/dub-techno");
      const seedOnly = branches.find((branch) => branch.branchId === "technology/database-internals");
      expect(dub).toMatchObject({ livedCount: 2, lastNote: "Basic Channel", origin: "seed" });
      expect(branches.find((branch) => branch.branchId === "philosophy/compatibilism")).toMatchObject({ origin: "ashley", livedCount: 1 });
      // Lived twice, recently, outranks a seed nobody touched.
      expect(dub!.strength).toBeGreaterThan(seedOnly!.strength);
      expect(branches[0]?.branchId).toBe("electronic-music/dub-techno");
    } finally {
      db.close();
    }
  });
});

describe("reaching out", () => {
  it.each(["idle_opportunity", "self_change_result", "domus_notification"] as const)("counts %s speech against the unsolicited fuse and reports how it landed", (triggerKind) => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread-reach";
      const idle = admitTestCycle(db, { conversationId, triggerKind, triggerRef: "awake:1", occupantId: "doc", authorityEpoch: 1, nowMs: T0 });
      const reply = admitTestCycle(db, { conversationId, triggerKind: "owner_message", triggerRef: "owner-1", occupantId: "doc", authorityEpoch: 1, nowMs: T0 });
      appendAshleyEvidence(db, { conversationId, text: "found a great Basic Channel interview", nowMs: T0, producingCycleId: idle.cycleId, delivered: true, audienceAtCapture: "owner_private" });
      appendAshleyEvidence(db, { conversationId, text: "sure, here you go", nowMs: T0, producingCycleId: reply.cycleId, delivered: true, audienceAtCapture: "owner_private" });
      appendOwnerUtterance(db, { conversationId, text: "oh nice, send it", nowMs: T0 + 7 * MINUTE, audienceAtCapture: "owner_private" });

      expect(countUnsolicited(db, T0 + 10 * MINUTE)).toBe(1);
      expect(recentUnsolicited(db)).toEqual([{ atMs: T0, excerpt: "found a great Basic Channel interview", ownerRepliedAfterMs: 7 * MINUTE }]);
      expect(unsolicitedFuseTripped(db, T0 + 10 * MINUTE)).toBe(false);
      for (let index = 1; index < UNSOLICITED_FUSE_LIMIT; index += 1) {
        appendAshleyEvidence(db, { conversationId, text: `note ${index}`, nowMs: T0 + index, producingCycleId: idle.cycleId, delivered: true, audienceAtCapture: "owner_private" });
      }
      expect(unsolicitedFuseTripped(db, T0 + 10 * MINUTE)).toBe(true);
      // The window is 24 hours.
      expect(unsolicitedFuseTripped(db, T0 + 25 * 60 * MINUTE)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("says she spoke only when her message was delivered (R11)", () => {
    const db = openTestSidecar();
    try {
      recordJournalEntry(db, { conversationId: "thread", cycleId: "cycle-queued", passKind: "awake", claim: { activity: "reach_out", entry: "Sent Alex the article." }, spoke: true, nowMs: T0 });
      expect(listRecentJournal(db, { limit: 1 })[0]).toMatchObject({ spoke: false });
      appendAshleyEvidence(db, { conversationId: "thread", text: "Found the article you meant.", producingCycleId: "cycle-queued", delivered: true, nowMs: T0 + MINUTE });
      expect(listRecentJournal(db, { limit: 1 })[0]).toMatchObject({ spoke: true });
    } finally {
      db.close();
    }
  });
});
