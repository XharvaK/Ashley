import { describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendAshleyEvidence, appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { applyV021Forget } from "../memory/forget.js";
import { getThreadStory, listRecentEpisodes } from "../memory/episodes.js";
import {
  AFTERGLOW_MAX_ATTEMPTS,
  AFTERGLOW_MAX_ROWS,
  AFTERGLOW_ROLLING_QUIET_MS,
  AFTERGLOW_SILENCE_MS,
  afterglowPassFromPayload,
  completeAfterglow,
  evaluateAfterglow,
  listUnreflectedRows,
  readAfterglowState,
  tickAfterglow,
} from "./afterglow.js";
import type { IdleThoughtRunner } from "./idle.js";

const CONVERSATION = "thread-afterglow";
const T0 = Date.UTC(2026, 8, 29, 10, 0);
const MINUTE = 60_000;

function owner(db: DatabaseSync, text: string, atMs: number) {
  return appendOwnerUtterance(db, { conversationId: CONVERSATION, text, nowMs: atMs, audienceAtCapture: "owner_private" });
}

function ashley(db: DatabaseSync, text: string, atMs: number) {
  return appendAshleyEvidence(db, { conversationId: CONVERSATION, text, nowMs: atMs, delivered: true, audienceAtCapture: "owner_private" });
}

function publishedRunner(): ReturnType<typeof vi.fn<IdleThoughtRunner>> {
  return vi.fn<IdleThoughtRunner>(async () => ({ published: true, acceptedSettlements: 1, thoughtModelAttempts: 1 }));
}

function tick(db: DatabaseSync, nowMs: number, thought: IdleThoughtRunner) {
  return tickAfterglow(db, { conversationId: CONVERSATION, occupantId: "doc", authorityEpoch: 1, nowMs, thought });
}

/** What the kernel does after a Thought: the cycle rests and its event is settled. */
function settleLastAttempt(db: DatabaseSync, status: "consumed" | "failed"): void {
  db.prepare("UPDATE inbox_events SET status = ? WHERE id LIKE 'afterglow:%' AND status = 'pending'").run(status);
  db.prepare("UPDATE cycle_records SET state = 'idle' WHERE conversation_id = ?").run(CONVERSATION);
}

describe("afterglow timing", () => {
  it("waits for 30 minutes of silence after a conversation with the Owner", () => {
    const db = openTestSidecar();
    try {
      expect(evaluateAfterglow(db, { conversationId: CONVERSATION, nowMs: T0 }).kind).toBe("nothing");
      ashley(db, "morning! want the news digest?", T0);
      // Ashley talking alone is not a conversation to reflect on.
      expect(evaluateAfterglow(db, { conversationId: CONVERSATION, nowMs: T0 + 2 * AFTERGLOW_SILENCE_MS }).kind).toBe("nothing");

      owner(db, "we should plan the Kyoto trip", T0 + MINUTE);
      ashley(db, "spring or autumn?", T0 + 2 * MINUTE);
      // Each new message restarts the silence clock.
      owner(db, "spring, for the blossoms", T0 + 20 * MINUTE);
      expect(evaluateAfterglow(db, { conversationId: CONVERSATION, nowMs: T0 + 49 * MINUTE }))
        .toMatchObject({ kind: "not_due", unreflected: 4 });
      const due = evaluateAfterglow(db, { conversationId: CONVERSATION, nowMs: T0 + 50 * MINUTE });
      expect(due).toMatchObject({ kind: "due", mode: "silence" });
      expect(due.kind === "due" && due.rows.map((row) => row.text)).toEqual([
        "morning! want the news digest?",
        "we should plan the Kyoto trip",
        "spring or autumn?",
        "spring, for the blossoms",
      ]);
    } finally {
      db.close();
    }
  });

  it("reflects early when a long conversation would push rows out of the window unreflected", () => {
    const db = openTestSidecar();
    try {
      for (let index = 0; index < 31; index += 1) owner(db, `message ${index}`, T0 + index * 1_000);
      // Not in the middle of an exchange: a rolling pass waits for a short pause.
      expect(evaluateAfterglow(db, { conversationId: CONVERSATION, nowMs: T0 + 40_000 }).kind).toBe("not_due");
      expect(evaluateAfterglow(db, { conversationId: CONVERSATION, nowMs: T0 + 30_000 + AFTERGLOW_ROLLING_QUIET_MS }))
        .toMatchObject({ kind: "due", mode: "rolling" });
    } finally {
      db.close();
    }
  });
});

describe("afterglow pass", () => {
  it("runs one private Thought over exactly the unreflected rows, then moves the watermark past them", async () => {
    const db = openTestSidecar();
    try {
      const first = owner(db, "we should plan the Kyoto trip", T0);
      const second = ashley(db, "spring or autumn?", T0 + MINUTE);
      const thought = publishedRunner();
      const result = await tick(db, T0 + MINUTE + AFTERGLOW_SILENCE_MS, thought);

      expect(result).toMatchObject({ outcome: "ran", mode: "silence", coveredRows: 2 });
      expect(thought).toHaveBeenCalledTimes(1);
      const input = thought.mock.calls[0]![0];
      expect(input.trigger.kind).toBe("idle_opportunity");
      expect(input.privateBudgetReservation.state).toBe("held");
      const pass = afterglowPassFromPayload(input.event?.payload);
      expect(pass?.rowIds).toEqual([first.rowId, second.rowId]);

      // A message that arrives while she reflects belongs to the next afterglow.
      const later = owner(db, "also: book the ryokan", T0 + 40 * MINUTE);
      expect(completeAfterglow(db, {
        conversationId: CONVERSATION,
        cycleId: input.cycle.cycleId,
        pass: pass!,
        reflection: {
          episode: { summary: "Alex and I started planning a spring trip to Kyoto.", salience: 0.8, tone: "excited", takeaway: "He lights up about travel." },
          threadStory: "Alex and I are planning a spring trip to Kyoto.",
        },
        nowMs: T0 + 40 * MINUTE,
      })).toBe("reflected");

      const [episode] = listRecentEpisodes(db, 5);
      expect(episode).toMatchObject({ summary: "Alex and I started planning a spring trip to Kyoto.", salience: 0.8 });
      expect(episode?.evidenceRowIds).toEqual([first.rowId, second.rowId]);
      expect(getThreadStory(db, CONVERSATION)?.story).toBe("Alex and I are planning a spring trip to Kyoto.");
      expect(listUnreflectedRows(db, CONVERSATION, 10).map((row) => row.rowId)).toEqual([later.rowId]);

      // Completion is idempotent: a replay writes nothing twice.
      completeAfterglow(db, { conversationId: CONVERSATION, cycleId: input.cycle.cycleId, pass: pass!, reflection: { episode: { summary: "Alex and I started planning a spring trip to Kyoto.", salience: 0.8 } }, nowMs: T0 + 41 * MINUTE });
      expect(listRecentEpisodes(db, 5)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("never reflects while a turn is in progress", async () => {
    const db = openTestSidecar();
    try {
      owner(db, "hey", T0);
      admitTestCycle(db, { conversationId: CONVERSATION, triggerKind: "owner_message", triggerRef: "busy", occupantId: "doc", authorityEpoch: 1, nowMs: T0 });
      const thought = publishedRunner();
      expect(await tick(db, T0 + AFTERGLOW_SILENCE_MS, thought)).toMatchObject({ outcome: "busy" });
      expect(thought).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("does not start a second attempt while one is in flight, and gives up after repeated failure", async () => {
    const db = openTestSidecar();
    try {
      const row = owner(db, "hey", T0);
      const thought = vi.fn<IdleThoughtRunner>(async () => { throw new Error("provider down"); });
      const now = T0 + AFTERGLOW_SILENCE_MS;
      expect(await tick(db, now, thought)).toMatchObject({ outcome: "ran" });
      db.prepare("UPDATE cycle_records SET state = 'idle' WHERE conversation_id = ?").run(CONVERSATION);
      expect(await tick(db, now, thought)).toMatchObject({ outcome: "in_flight" });

      settleLastAttempt(db, "failed");
      for (let attempt = 2; attempt <= AFTERGLOW_MAX_ATTEMPTS; attempt += 1) {
        expect(await tick(db, now, thought)).toMatchObject({ outcome: "ran" });
        settleLastAttempt(db, "failed");
      }
      expect(thought).toHaveBeenCalledTimes(AFTERGLOW_MAX_ATTEMPTS);
      expect(await tick(db, now, thought)).toMatchObject({ outcome: "abandoned" });
      expect(readAfterglowState(db, CONVERSATION).reflectedThroughSeq).toBeGreaterThan(0);
      expect(listUnreflectedRows(db, CONVERSATION, 10)).toEqual([]);
      // The row itself is untouched: only the reflection was given up.
      expect(db.prepare("SELECT text FROM conversation_evidence_log WHERE row_id = ?").get(row.rowId)).toEqual({ text: "hey" });
    } finally {
      db.close();
    }
  });

  it("does not count a pass the Owner interrupted as a failure", async () => {
    const db = openTestSidecar();
    try {
      // More rows than one pass covers, so the covered range stays the same
      // when the Owner comes back.
      for (let index = 0; index < AFTERGLOW_MAX_ROWS + 1; index += 1) owner(db, `message ${index}`, T0 + index * 1_000);
      const thought = publishedRunner();
      let now = T0 + AFTERGLOW_SILENCE_MS + MINUTE;
      for (let attempt = 1; attempt <= AFTERGLOW_MAX_ATTEMPTS + 1; attempt += 1) {
        expect(await tick(db, now, thought)).toMatchObject({ outcome: "ran", coveredRows: AFTERGLOW_MAX_ROWS });
        settleLastAttempt(db, "failed");
        owner(db, `I'm back (${attempt})`, now + MINUTE);
        now += AFTERGLOW_SILENCE_MS + 2 * MINUTE;
      }
      expect(readAfterglowState(db, CONVERSATION)).toMatchObject({ attemptCount: AFTERGLOW_MAX_ATTEMPTS + 1, failedAttempts: 0 });
    } finally {
      db.close();
    }
  });

  it("drops a reflection when a forget reached one of its rows first", async () => {
    const db = openTestSidecar();
    try {
      owner(db, "my password hint is the cat's name", T0);
      owner(db, "anyway, how's your day", T0 + MINUTE);
      const thought = publishedRunner();
      await tick(db, T0 + MINUTE + AFTERGLOW_SILENCE_MS, thought);
      const input = thought.mock.calls[0]![0];
      applyV021Forget(db, { topic: "password hint", nowMs: T0 + 40 * MINUTE });

      expect(completeAfterglow(db, {
        conversationId: CONVERSATION,
        cycleId: input.cycle.cycleId,
        pass: afterglowPassFromPayload(input.event?.payload)!,
        reflection: { episode: { summary: "Alex told me his password hint.", salience: 0.4 }, threadStory: "Alex shared his password hint." },
        nowMs: T0 + 41 * MINUTE,
      })).toBe("forget_race");
      expect(listRecentEpisodes(db, 5)).toEqual([]);
      expect(getThreadStory(db, CONVERSATION)).toBeNull();
      expect(readAfterglowState(db, CONVERSATION)).toMatchObject({ attemptCount: 0 });
      expect(listUnreflectedRows(db, CONVERSATION, 10)).toEqual([]);
    } finally {
      db.close();
    }
  });
});
