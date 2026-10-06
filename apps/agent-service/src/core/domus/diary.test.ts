import { describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { afterglowPassFromPayload } from "../cognitive-v021/initiative/afterglow.js";
import type { IdleThoughtRunner } from "../cognitive-v021/initiative/idle.js";
import { recordJournalEntry } from "../cognitive-v021/initiative/journal.js";
import { listRecentEpisodes } from "../cognitive-v021/memory/episodes.js";
import { admitObservation, observationDigest } from "./store.js";
import {
  DOMUS_DIARY_MAX_ATTEMPTS,
  completeDomusDiary,
  domusDiaryForThought,
  domusDiariesDue,
  listDomusDiary,
  tickDomusDiary,
} from "./diary.js";

const T0 = Date.UTC(2026, 9, 6, 23, 0);
const HOUR = 60 * 60_000;

function observe(db: DatabaseSync, observationId: string, atMs: number, day?: Record<string, unknown>, world = "willow") {
  const payload: Record<string, unknown> = { v: 1, observation_id: observationId, world, seq: 1, percepts: [{ kind: "sleep_onset", salience: 0.4, facts: {} }] };
  if (day) payload.day = day;
  admitObservation(db, {
    observationId, digest: observationDigest(payload), world, branch: "g", session: "s", attachment: "helper-a", body: "b",
    snapshot: observationId, seq: 1, sourceTimeMs: atMs, expiresAtMs: atMs + 600_000, receiptTimeMs: atMs, lineageClass: "CURRENT",
    payloadJson: JSON.stringify(payload),
  });
  db.prepare("UPDATE domus_observations SET admission_state = 'admitted' WHERE observation_id = ?").run(observationId);
}

function act(db: DatabaseSync, id: string, atMs: number, label: string) {
  db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, label, state,
    requested_at_ms, expires_at_ms, updated_at_ms) VALUES (?, ?, 'willow', 'helper-a', 'obs', 'opt', ?, 'finished', ?, ?, ?)`)
    .run(id, id, label, atMs, atMs + 1_000, atMs);
}

function settle(db: DatabaseSync) {
  db.prepare("UPDATE inbox_events SET status = 'failed' WHERE id LIKE 'diary:domus:%' AND status = 'pending'").run();
  db.prepare("UPDATE cycle_records SET state = 'idle'").run();
}

describe("8h when a night is due", () => {
  it("is due for an admitted observation that carries a day, and not without one or after an undo", () => {
    const db = openTestSidecar();
    observe(db, "plain", T0);
    expect(domusDiariesDue(db)).toEqual([]);
    observe(db, "night-1", T0 + 1, { slept: true, acts: [] });
    expect(domusDiariesDue(db)).toEqual([{ world: "willow", observationId: "night-1" }]);
    db.prepare("UPDATE domus_observations SET undone_at_ms = ? WHERE observation_id = 'night-1'").run(T0 + 2);
    expect(domusDiariesDue(db)).toEqual([]);
  });
});

describe("8h the diary pass", () => {
  it("queues one afterglow whose mode is diary", async () => {
    const db = openTestSidecar();
    observe(db, "night-1", T0, { slept: true });
    let seen: unknown;
    const thought = vi.fn<IdleThoughtRunner>(async (input) => {
      seen = input.event?.payload;
      return { published: true, acceptedSettlements: 1, thoughtModelAttempts: 1 };
    });
    const result = await tickDomusDiary(db, { conversationId: "owner-thread", occupantId: "doc", authorityEpoch: 1, nowMs: T0 + 1, thought });
    expect(result).toMatchObject({ outcome: "ran", mode: "diary" });
    const pass = afterglowPassFromPayload(seen);
    expect(pass).toMatchObject({ mode: "diary", diary: { world: "willow", observationId: "night-1" } });
    expect((seen as { innerPass?: { mode?: string } }).innerPass?.mode).toBe("diary");
  });

  it("shows the day, and the journal and acts since the previous written night", () => {
    const db = openTestSidecar();
    observe(db, "night-0", T0 - 10 * HOUR, { slept: true });
    db.prepare(`INSERT INTO domus_diary_state (observation_id, world, state, attempt_count, failed_attempts, cycle_id, updated_at_ms)
      VALUES ('night-0', 'willow', 'written', 1, 0, 'older', ?)`).run(T0 - 10 * HOUR);
    observe(db, "night-1", T0, { slept: true, frames: [{ who: "Maya" }] });
    recordJournalEntry(db, { conversationId: "owner-thread", cycleId: "old", passKind: "private", spoke: false, nowMs: T0 - 20 * HOUR,
      channel: "domus:willow", claim: { activity: "think", entry: "Before the last written night." } });
    recordJournalEntry(db, { conversationId: "owner-thread", cycleId: "day", passKind: "private", spoke: false, nowMs: T0 - 2 * HOUR,
      channel: "domus:willow", claim: { activity: "think", entry: "Played until the house went quiet." } });
    act(db, "old-act", T0 - 20 * HOUR, "Old act");
    act(db, "day-act", T0 - 2 * HOUR, "Practice piano");
    const shown = domusDiaryForThought(db, { world: "willow", observationId: "night-1" });
    expect(shown.day).toEqual({ slept: true, frames: [{ who: "Maya" }] });
    expect(shown.atMs).toBe(T0);
    expect(shown.journal.map((item) => item.entry)).toEqual(["Played until the house went quiet."]);
    expect(shown.acts).toEqual([{ label: "Practice piano", state: "finished", atMs: T0 - 2 * HOUR }]);
  });

  it("keeps one episode on the game lane, ignores a second call, and drops the night when the observation was undone", () => {
    const db = openTestSidecar();
    observe(db, "night-1", T0, { slept: true });
    const diary = { world: "willow", observationId: "night-1" };
    const reflection = { episode: { summary: "I played until my eyes closed.", salience: 0.7, takeaway: "The piano can wait until morning." }, threadStory: "must not be written" };
    expect(completeDomusDiary(db, { conversationId: "owner-thread", cycleId: "diary-cycle", diary, reflection, nowMs: T0 + 1 })).toBe("written");
    expect(completeDomusDiary(db, { conversationId: "owner-thread", cycleId: "diary-cycle", diary,
      reflection: { episode: { summary: "A different night.", salience: 0.2 } }, nowMs: T0 + 2 })).toBe("written");
    const [episode] = listRecentEpisodes(db, 5);
    expect(episode).toMatchObject({ channel: "domus:willow", summary: "I played until my eyes closed.", evidenceRowIds: ["night-1"] });
    expect(listRecentEpisodes(db, 5)).toHaveLength(1);
    expect(db.prepare("SELECT state, cycle_id FROM domus_diary_state WHERE observation_id = 'night-1'").get()).toEqual({ state: "written", cycle_id: "diary-cycle" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM thread_stories").get()).toEqual({ n: 0 });
    expect(listDomusDiary(db)).toEqual([{
      world: "willow",
      at: new Date(T0).toISOString(),
      text: "I played until my eyes closed.",
      takeaway: "The piano can wait until morning.",
    }]);

    const undone = openTestSidecar();
    observe(undone, "night-2", T0, { slept: true });
    undone.prepare("UPDATE domus_observations SET undone_at_ms = ? WHERE observation_id = 'night-2'").run(T0 + 5);
    expect(completeDomusDiary(undone, { conversationId: "owner-thread", cycleId: "lost", diary: { world: "willow", observationId: "night-2" },
      reflection, nowMs: T0 + 6 })).toBe("forget_race");
    expect(listRecentEpisodes(undone, 5)).toEqual([]);
    expect(undone.prepare("SELECT state FROM domus_diary_state WHERE observation_id = 'night-2'").get()).toEqual({ state: "forget_race" });
    expect(listDomusDiary(undone)).toEqual([]);
  });

  it("gives up after three failed attempts and does not retry", async () => {
    const db = openTestSidecar();
    observe(db, "night-1", T0, { slept: true });
    const thought = vi.fn<IdleThoughtRunner>(async () => ({ published: true, acceptedSettlements: 1, thoughtModelAttempts: 1 }));
    const tick = () => tickDomusDiary(db, { conversationId: "owner-thread", occupantId: "doc", authorityEpoch: 1, nowMs: T0 + 1, thought });
    expect(await tick()).toMatchObject({ outcome: "ran", mode: "diary" });
    db.prepare("UPDATE cycle_records SET state = 'idle'").run();
    expect(await tick()).toMatchObject({ outcome: "in_flight", mode: "diary" });
    settle(db);
    for (let attempt = 2; attempt <= DOMUS_DIARY_MAX_ATTEMPTS; attempt += 1) {
      expect(await tick()).toMatchObject({ outcome: "ran" });
      settle(db);
    }
    expect(await tick()).toMatchObject({ outcome: "abandoned", mode: "diary" });
    expect(db.prepare("SELECT state, failed_attempts FROM domus_diary_state WHERE observation_id = 'night-1'").get())
      .toEqual({ state: "abandoned", failed_attempts: DOMUS_DIARY_MAX_ATTEMPTS });
    expect(await tick()).toBeNull();
    expect(thought).toHaveBeenCalledTimes(DOMUS_DIARY_MAX_ATTEMPTS);
  });
});
