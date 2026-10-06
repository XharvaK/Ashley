import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { appendInboxEvent } from "../cognitive-v021/cycle/inbox.js";
import { recordJournalEntry } from "../cognitive-v021/initiative/journal.js";
import { domusLaneId } from "./lane.js";
import { DOMUS_FEED_LIMIT, domusFeed, heldLine } from "./feed.js";
import { parseFeed } from "./ingress.js";

const NOW = 50_000_000;
const LANE = domusLaneId("owner");

function pass(db: DatabaseSync, input: { cycle: string; at: number; entry?: string; inputs?: string; attachment?: string;
  classification?: "ordinary" | "sensitive" }) {
  appendInboxEvent(db, { conversationId: LANE, kind: "domus_notification", createdAtMs: input.at - 5,
    payload: { cycleId: input.cycle, domus: { world: "slot0", attachment: input.attachment ?? "helper-a", observationIds: ["o"] },
      ...(input.inputs === undefined ? { inputs: "game_only" } : input.inputs ? { inputs: input.inputs } : {}) } });
  recordJournalEntry(db, { conversationId: LANE, cycleId: input.cycle, passKind: "private", spoke: false, nowMs: input.at,
    channel: "domus:slot0", dataClassification: input.classification ?? "ordinary",
    ...(input.entry ? { claim: { activity: "think" as const, entry: input.entry } } : {}) });
}

function act(db: DatabaseSync, cycle: string, actId: string, label: string, state: string) {
  db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, label, state,
    requested_at_ms, expires_at_ms, updated_at_ms) VALUES (?, ?, 'slot0', 'helper-a', 'o', 'a1', ?, ?, ?, ?, ?)`)
    .run(actId, cycle, label, state, NOW, NOW + 90_000, NOW);
}

describe("E3 the overlay feed", () => {
  it("lists only passes stamped game-only, for this helper session, newest last", () => {
    const db = openTestSidecar();
    try {
      pass(db, { cycle: "c1", at: NOW - 3000, entry: "The kitchen smells of toast." });
      pass(db, { cycle: "c2", at: NOW - 2000, entry: "Written while the switch was off.", inputs: "" });
      pass(db, { cycle: "c3", at: NOW - 1000, entry: "Another helper's pass.", attachment: "helper-b" });
      pass(db, { cycle: "c4", at: NOW - 500 });
      const items = domusFeed(db, { helperSession: "helper-a", nowMs: NOW });
      expect(items.map(item => item.line ?? (item.quiet ? "quiet" : "held"))).toEqual(["The kitchen smells of toast.", "quiet"]);
      expect(items.every(item => item.inputs === "game_only")).toBe(true);
      expect(domusFeed(db, { helperSession: "helper-a", nowMs: NOW + 3 * 60 * 60 * 1000 })).toEqual([]);
    } finally { db.close(); }
  });

  it("holds a line that is not ordinary or names someone she knows from Discord, a handle, an id or a link", () => {
    const db = openTestSidecar();
    try {
      db.prepare("INSERT INTO discord_names (kind, id, name, updated_at_ms) VALUES ('user', '1', 'Quillon', 1)").run();
      pass(db, { cycle: "c1", at: NOW - 5000, entry: "I wonder what Quillon would cook." });
      pass(db, { cycle: "c2", at: NOW - 4000, entry: "A private feeling.", classification: "sensitive" });
      pass(db, { cycle: "c3", at: NOW - 3000, entry: "Someone said @marrow_99 likes piano." });
      pass(db, { cycle: "c4", at: NOW - 2000, entry: "See https://example.invalid later." });
      pass(db, { cycle: "c5", at: NOW - 1000, entry: "Quilloney is a word I made up." });
      const items = domusFeed(db, { helperSession: "helper-a", nowMs: NOW });
      expect(items.map(item => item.held === true)).toEqual([true, true, true, true, false]);
      expect(items.filter(item => item.held).every(item => item.line === undefined)).toBe(true);
      expect(heldLine("ref 123456789012345678", [])).toBe(true);
      expect(heldLine("<@42> hi", [])).toBe(true);
      expect(heldLine("Grab a snack from the fridge", [])).toBe(false);
    } finally { db.close(); }
  });

  it("carries the act she chose, how it ended, and what became of each step of her plan", () => {
    const db = openTestSidecar();
    try {
      pass(db, { cycle: "c1", at: NOW - 1000, entry: "Dinner first, then music." });
      act(db, "c1", "act1", "Cook (Stove)", "finished");
      db.prepare(`INSERT INTO domus_act_events (act_id, phase, at_ms, received_at_ms, detail_json) VALUES ('act1', 'finished', ?, ?, ?)`)
        .run(NOW, NOW, JSON.stringify({ finishing_type: "NATURAL" }));
      act(db, "c9", "act2", "Play (Piano)", "pushed");
      const step = db.prepare(`INSERT INTO domus_plan_steps (plan_id, step, world, attachment, option_ref, label, state, act_id, reason,
        planned_at_ms, updated_at_ms) VALUES ('act1', ?, 'slot0', 'helper-a', 'a2', ?, ?, ?, ?, 1, 1)`);
      step.run(1, "Play (Piano)", "released", "act2", null);
      step.run(2, "Read (Book)", "dropped", null, "woken_by:env:asked");
      const [item] = domusFeed(db, { helperSession: "helper-a", nowMs: NOW });
      expect(item!.act).toEqual({ label: "Cook (Stove)", state: "finished", how: "NATURAL" });
      expect(item!.plan).toEqual([{ label: "Play (Piano)", state: "pushed" }, { label: "Read (Book)", state: "dropped", reason: "woken_by:env:asked" }]);
    } finally { db.close(); }
  });

  it("keeps a bounded window and a strict body", () => {
    const db = openTestSidecar();
    try {
      for (let i = 0; i < DOMUS_FEED_LIMIT + 3; i++) pass(db, { cycle: `c${i}`, at: NOW - 10_000 + i, entry: `line ${i}` });
      const items = domusFeed(db, { helperSession: "helper-a", nowMs: NOW });
      expect(items).toHaveLength(DOMUS_FEED_LIMIT);
      expect(items.at(-1)!.line).toBe(`line ${DOMUS_FEED_LIMIT + 2}`);
      expect(parseFeed({ v: 1, helper_session: "helper-a" })).toEqual({ helperSession: "helper-a" });
      expect(() => parseFeed({ v: 1, helper_session: "helper-a", since: 1 })).toThrow();
      expect(() => parseFeed({ v: 2, helper_session: "helper-a" })).toThrow();
    } finally { db.close(); }
  });
});
