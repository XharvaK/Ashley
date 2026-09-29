import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { openTestSidecar } from "../../test-support.js";
import { applyV021Forget, applyV021ForgetTargets, planV021Forget } from "../forget.js";
import {
  episodesForThought,
  getThreadStory,
  listRecentEpisodes,
  recordEpisode,
  searchEpisodes,
  writeThreadStory,
} from "../episodes.js";

const CONVERSATION = "thread-episodes";

function episode(db: DatabaseSync, cycleId: string, text: string, summary: string, atMs: number, takeaway?: string) {
  const row = appendOwnerUtterance(db, { conversationId: CONVERSATION, text, nowMs: atMs, audienceAtCapture: "owner_private" });
  const stored = recordEpisode(db, {
    conversationId: CONVERSATION,
    cycleId,
    rows: [{ rowId: row.rowId, createdAtMs: row.createdAtMs, dataClassification: row.dataClassification }],
    reflection: { summary, salience: 0.6, ...(takeaway ? { takeaway } : {}) },
    nowMs: atMs,
  });
  return { row, episode: stored! };
}

describe("episodes", () => {
  it("stores one episode per reflection, searchable by what it was about", () => {
    const db = openTestSidecar();
    try {
      episode(db, "cycle-1", "let's plan Kyoto", "We started planning a spring trip to Kyoto.", 1_000);
      episode(db, "cycle-2", "the synth arrived", "Doc's new synthesizer arrived; we talked patches.", 2_000, "I like modular sound design.");
      const rough = episode(db, "cycle-3", "bad day at work", "Doc had a rough day at work.", 3_000);
      // A replayed completion of the same reflection writes nothing new.
      recordEpisode(db, {
        conversationId: CONVERSATION,
        cycleId: "cycle-3",
        rows: [{ rowId: rough.row.rowId, createdAtMs: 3_000, dataClassification: "ordinary" }],
        reflection: { summary: "duplicate replay", salience: 0.6 },
        nowMs: 3_500,
      });

      expect(listRecentEpisodes(db, 10).map((item) => item.summary)).toEqual([
        "Doc had a rough day at work.",
        "Doc's new synthesizer arrived; we talked patches.",
        "We started planning a spring trip to Kyoto.",
      ]);
      expect(searchEpisodes(db, ["modular"], 5).map((item) => item.summary))
        .toEqual(["Doc's new synthesizer arrived; we talked patches."]);
      // Thought sees the most recent ones plus what the moment brings to mind, oldest first.
      expect(episodesForThought(db, ["Kyoto"], { recent: 1, matched: 1 }).map((item) => item.summary)).toEqual([
        "We started planning a spring trip to Kyoto.",
        "Doc had a rough day at work.",
      ]);
    } finally {
      db.close();
    }
  });

  it("are forgotten by topic, and with any conversation row they were built from", () => {
    const db = openTestSidecar();
    try {
      episode(db, "cycle-1", "let's plan Kyoto", "We started planning a spring trip to Kyoto.", 1_000);
      const synth = episode(db, "cycle-2", "the synth arrived", "Doc's new instrument arrived.", 2_000);
      writeThreadStory(db, { conversationId: CONVERSATION, story: "Doc and I plan trips and talk music.", throughRowId: synth.row.rowId, cycleId: "cycle-2", dataClassification: "ordinary", nowMs: 2_000 });

      applyV021Forget(db, { topic: "kyoto", nowMs: 5_000 });
      expect(listRecentEpisodes(db, 10).map((item) => item.summary)).toEqual(["Doc's new instrument arrived."]);
      expect(searchEpisodes(db, ["spring"], 5)).toEqual([]);
      // The Kyoto row was redacted, and the story retells the whole conversation.
      expect(getThreadStory(db, CONVERSATION)).toBeNull();

      // "synth" is only in the source message, not in the episode's words:
      // forgetting the message still takes the episode with it.
      const plan = planV021Forget(db, { topic: "synth" });
      expect(plan.targets).toContainEqual({ entityType: "v021_episode", entityUuid: synth.episode.episodeId, action: "redact" });
      applyV021ForgetTargets(db, plan.targets, { nowMs: 6_000 });
      expect(listRecentEpisodes(db, 10)).toEqual([]);
      const stored = db.prepare("SELECT summary, forgotten_at_ms FROM episodes_v2 WHERE episode_id = ?").get(synth.episode.episodeId);
      expect(stored).toMatchObject({ forgotten_at_ms: 6_000 });
      expect(JSON.stringify(stored)).not.toContain("instrument");
    } finally {
      db.close();
    }
  });
});
