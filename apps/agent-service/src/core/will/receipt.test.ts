import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { recordJournalEntry } from "../cognitive-v021/initiative/journal.js";
import { recordPlaceIntents } from "../places/intents.js";
import { applyPursuitOps } from "./pursuits.js";
import { lifeReceipt, renderLifeReceipt, LIFE_RECEIPT_WINDOW_MS } from "./receipt.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const HOUR = 60 * 60_000;

describe("F1 her weekly life receipt", () => {
  it("counts her own time, pursuits, place acts and home changes from the last seven days only", () => {
    const db = openTestSidecar();
    try {
      recordJournalEntry(db, { conversationId: "owner", cycleId: "old", passKind: "awake", spoke: false, nowMs: NOW - LIFE_RECEIPT_WINDOW_MS - HOUR,
        claim: { activity: "rest", entry: "long ago" } });
      recordJournalEntry(db, { conversationId: "owner", cycleId: "a1", passKind: "awake", spoke: false, nowMs: NOW - 2 * HOUR,
        claim: { activity: "rest", entry: "quiet" } });
      recordJournalEntry(db, { conversationId: "owner", cycleId: "a2", passKind: "awake", spoke: true, nowMs: NOW - HOUR,
        claim: { activity: "reach_out", entry: "told the Owner about the label" } });
      recordJournalEntry(db, { conversationId: "owner", cycleId: "n1", passKind: "night", spoke: false, nowMs: NOW - 3 * HOUR });
      applyPursuitOps(db, { cycleId: "p1", nowMs: NOW - HOUR, ops: [{ start: { title: "Dub techno lineage", why: "it keeps coming back" } }] });
      recordPlaceIntents(db, { cycleId: "i1", claims: [{ place: "room:g:c", interaction: "initiate", say: "hi" }], sawSecret: true, nowMs: NOW - HOUR });
      db.prepare("INSERT INTO home_ops (cycle_id, ordinal, op, path, ok, at_ms) VALUES ('h1', 0, 'write', 'notes/sites.md', 1, ?)").run(NOW - HOUR);
      const receipt = lifeReceipt(db, NOW);
      expect(receipt.ownTime).toEqual({ passes: 2, spoke: 1, activities: { rest: 1, reach_out: 1 } });
      expect(receipt.night).toBe(1);
      expect(receipt.pursuits).toMatchObject({ started: 1, activeNow: 1, finished: 0 });
      expect(receipt.places).toEqual([{ place: "room:g:c", posted: 0, refused: 1 }]);
      expect(receipt.home).toEqual({ changes: 1, files: ["notes/sites.md"] });
      const lines = renderLifeReceipt(receipt);
      expect(lines[0]).toBe("Her week: 2 own-time passes (rest 1, reach_out 1), 1 reached out, 1 nights");
      expect(lines.some(line => line.startsWith("Home: 1 changes (notes/sites.md)"))).toBe(true);
    } finally { db.close(); }
  });
});
