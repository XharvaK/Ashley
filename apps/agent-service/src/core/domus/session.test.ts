import { describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { afterglowPassFromPayload, tickAfterglow, completeAfterglow } from "../cognitive-v021/initiative/afterglow.js";
import type { IdleThoughtRunner } from "../cognitive-v021/initiative/idle.js";
import { recordJournalEntry } from "../cognitive-v021/initiative/journal.js";
import { episodesForThought, listRecentEpisodes, recordEpisode } from "../cognitive-v021/memory/episodes.js";
import { admitObservation, observationDigest, upsertHeartbeat } from "./store.js";
import {
  DOMUS_SESSION_QUIET_MS, DOMUS_SESSION_ROLLING_MS, domusSessionForThought, domusSessionsDue, readDomusSessionState,
} from "./session.js";

const T0 = Date.UTC(2026, 9, 6, 18, 0);
const MINUTE = 60_000;

function observe(db: DatabaseSync, seq: number, atMs: number, attachment = "helper-a", world = "slot8") {
  const observationId = `${attachment}.${seq}`;
  const payload = { v: 1, observation_id: observationId, world, seq, percepts: [{ kind: "need", salience: 0.4, facts: {} }] };
  admitObservation(db, { observationId, digest: observationDigest(payload), world, branch: "g", session: "s", attachment, body: "b",
    snapshot: String(seq), seq, sourceTimeMs: atMs, expiresAtMs: atMs + 600_000, receiptTimeMs: atMs, lineageClass: "CURRENT",
    payloadJson: JSON.stringify(payload) });
  db.prepare("UPDATE domus_observations SET admission_state = 'admitted' WHERE observation_id = ?").run(observationId);
  return observationId;
}

function heartbeat(db: DatabaseSync, atMs: number, attached: boolean, attachment = "helper-a") {
  upsertHeartbeat(db, { helperSession: attachment, receivedAtMs: atMs, sentAtMs: atMs, json: JSON.stringify({ v: 1, helper_session: attachment, attached }) });
}

function play(db: DatabaseSync, minutes: number) {
  for (let minute = 0; minute <= minutes; minute++) observe(db, minute, T0 + minute * MINUTE);
  recordJournalEntry(db, { conversationId: "owner-thread", cycleId: "game-1", passKind: "private", spoke: false, nowMs: T0 + 2 * MINUTE,
    channel: "domus:slot8", claim: { activity: "think", entry: "Played the piano until my fingers ached." } });
}

describe("M2 when a stretch of play is due", () => {
  it("waits while she is still playing, and is due once the game went quiet", () => {
    const db = openTestSidecar();
    play(db, 10);
    heartbeat(db, T0 + 10 * MINUTE, true);
    expect(domusSessionsDue(db, T0 + 11 * MINUTE)).toEqual([]);
    const due = domusSessionsDue(db, T0 + 10 * MINUTE + DOMUS_SESSION_QUIET_MS);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ world: "slot8", reason: "ended", fromMs: T0, throughMs: T0 + 10 * MINUTE });
    expect(due[0]!.observationIds).toHaveLength(11);
  });

  it("is due at once when the helper says the game is detached, and while a long stretch still runs", () => {
    const db = openTestSidecar();
    play(db, 5);
    heartbeat(db, T0 + 6 * MINUTE, false);
    expect(domusSessionsDue(db, T0 + 6 * MINUTE)[0]?.reason).toBe("ended");
    const long = openTestSidecar();
    play(long, 31);
    heartbeat(long, T0 + 31 * MINUTE, true);
    expect(domusSessionsDue(long, T0 + 31 * MINUTE)[0]).toMatchObject({ reason: "rolling" });
    expect(T0 + 31 * MINUTE - T0).toBeGreaterThanOrEqual(DOMUS_SESSION_ROLLING_MS);
  });

  it("lets a stretch with nothing lived in it go without a pass", () => {
    const db = openTestSidecar();
    for (let minute = 0; minute <= 3; minute++) observe(db, minute, T0 + minute * MINUTE);
    expect(domusSessionsDue(db, T0 + 3 * MINUTE + DOMUS_SESSION_QUIET_MS)).toEqual([]);
    expect(readDomusSessionState(db, "slot8").reflectedThroughMs).toBe(T0 + 3 * MINUTE);
    expect(domusSessionsDue(db, T0 + 60 * MINUTE)).toEqual([]);
  });
});

describe("M2 the session afterglow", () => {
  it("runs once the conversation has nothing to reflect, and keeps one episode on the game lane citing the stretch", async () => {
    const db = openTestSidecar();
    play(db, 10);
    db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, label, state,
      requested_at_ms, expires_at_ms, updated_at_ms) VALUES ('a1', 'game-1', 'slot8', 'helper-a', 'helper-a.1', 'a3', 'Practice (Piano)', 'finished', ?, ?, ?)`)
      .run(T0 + MINUTE, T0 + 2 * MINUTE, T0 + 2 * MINUTE);
    const nowMs = T0 + 10 * MINUTE + DOMUS_SESSION_QUIET_MS;
    let seen: unknown;
    const thought = vi.fn<IdleThoughtRunner>(async (input) => {
      seen = input.event?.payload;
      return { published: true, acceptedSettlements: 1, thoughtModelAttempts: 1 };
    });
    const result = await tickAfterglow(db, { conversationId: "owner-thread", occupantId: "doc", authorityEpoch: 1, nowMs, thought });
    expect(result).toMatchObject({ outcome: "ran", mode: "session" });
    const pass = afterglowPassFromPayload(seen)!;
    expect(pass).toMatchObject({ mode: "session", session: { world: "slot8", fromMs: T0, throughMs: T0 + 10 * MINUTE } });
    const shown = domusSessionForThought(db, pass.session!);
    expect(shown.journal.map(item => item.entry)).toEqual(["Played the piano until my fingers ached."]);
    expect(shown.acts).toEqual([{ label: "Practice (Piano)", state: "finished", atMs: T0 + MINUTE }]);
    expect(shown.observations.at(-1)).toEqual({ observationId: "helper-a.10", atMs: T0 + 10 * MINUTE });

    expect(completeAfterglow(db, { conversationId: "owner-thread", cycleId: "session-cycle", pass, nowMs: nowMs + 1,
      reflection: { episode: { summary: "An evening at the piano.", salience: 0.6 }, threadStory: "must not be written" } })).toBe("reflected");
    const [episode] = listRecentEpisodes(db, 5);
    expect(episode).toMatchObject({ channel: "domus:slot8", summary: "An evening at the piano.", startedAtMs: T0, endedAtMs: T0 + 10 * MINUTE });
    expect(episode!.evidenceRowIds).toHaveLength(11);
    expect(db.prepare("SELECT COUNT(*) AS n FROM thread_stories").get()).toEqual({ n: 0 });
    // Reflected once: nothing is due any more.
    expect(domusSessionsDue(db, nowMs + 2)).toEqual([]);
  });

  it("drops the reflection when an undo reached the stretch first", () => {
    const db = openTestSidecar();
    play(db, 3);
    const [due] = domusSessionsDue(db, T0 + 3 * MINUTE + DOMUS_SESSION_QUIET_MS);
    db.prepare("UPDATE domus_observations SET undone_at_ms = ? WHERE observation_id = 'helper-a.2'").run(T0 + 20 * MINUTE);
    const { reason: _r, lastAtMs: _l, ...session } = due!;
    expect(completeAfterglow(db, { conversationId: "owner-thread", cycleId: "c", nowMs: T0 + 21 * MINUTE,
      pass: { kind: "afterglow", mode: "session", rowIds: [], throughSeq: 0, session },
      reflection: { episode: { summary: "Gone.", salience: 0.5 } } })).toBe("forget_race");
    expect(listRecentEpisodes(db, 5)).toEqual([]);
    expect(readDomusSessionState(db, "slot8").reflectedThroughMs).toBe(T0 + 3 * MINUTE);
  });

  it("keeps the latest game session in view of a Discord turn after talk pushed it out of the recent ones", () => {
    const db = openTestSidecar();
    const episode = (cycleId: string, atMs: number, summary: string, channel?: `domus:${string}`) => recordEpisode(db, {
      conversationId: "owner-thread", cycleId, rows: [{ rowId: `${cycleId}-row`, createdAtMs: atMs, dataClassification: "ordinary" }],
      reflection: { summary, salience: 0.5 }, nowMs: atMs, ...(channel ? { channel } : {}) });
    episode("game", T0, "An evening at the piano.", "domus:slot8");
    for (let index = 1; index <= 3; index++) episode(`talk-${index}`, T0 + index * MINUTE, `Talk ${index}.`);
    expect(episodesForThought(db, []).map(item => item.summary)).toEqual(["Talk 1.", "Talk 2.", "Talk 3."]);
    expect(episodesForThought(db, [], undefined, T0 + 10 * MINUTE).map(item => item.summary))
      .toEqual(["An evening at the piano.", "Talk 1.", "Talk 2.", "Talk 3."]);
    expect(episodesForThought(db, [], undefined, T0 + 4 * 24 * 60 * MINUTE).map(item => item.summary)).toEqual(["Talk 1.", "Talk 2.", "Talk 3."]);
  });

  it("reads a session pass back from its inbox payload, and refuses a malformed one", () => {
    const session = { world: "slot8", fromMs: 1, throughMs: 2, observationIds: ["o1"] };
    expect(afterglowPassFromPayload({ innerPass: { kind: "afterglow", mode: "session", rowIds: [], throughSeq: 0, session } }))
      .toEqual({ kind: "afterglow", mode: "session", rowIds: [], throughSeq: 0, session });
    expect(afterglowPassFromPayload({ innerPass: { kind: "afterglow", mode: "session", rowIds: [], throughSeq: 0, session: { ...session, fromMs: "x" } } }))
      .toBeNull();
  });
});
