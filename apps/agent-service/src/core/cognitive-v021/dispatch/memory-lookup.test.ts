import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { createV021LiveOperationExecutors } from "./live-operations.js";
import { getCapabilityReality } from "../thought/capability-reality.js";
import { parseThoughtSemanticOutput } from "../thought/parse.js";
import { REDACTED_MEMORY_STATEMENT, upsertMemoryAssertion } from "../memory/assertions.js";
import { getMemoryStrength, recordMemoryFormation } from "../memory/strength.js";
import type { MemoryKind, ObservationRequest } from "../types.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { recordEpisode } from "../memory/episodes.js";

const OWNER = "owner-lookup";

function request(value: Record<string, unknown>, audience: unknown = { kind: "owner_private" }): ObservationRequest {
  return {
    requestId: "request-memory-lookup",
    cycleId: "cycle-lookup",
    generation: 1,
    kind: "memory.lookup",
    request: value,
    replaySafe: true,
    audience,
  } as unknown as ObservationRequest;
}

function remember(db: DatabaseSync, key: string, kind: MemoryKind, statement: string, salience: number): void {
  upsertMemoryAssertion(db, {
    assertionKey: key,
    statement,
    memoryKind: kind,
    dimensions: { source: "owner_utterance", status: "asserted", time: "unknown_freshness", reliability: "owner_supplied" },
    dataClassification: "ordinary",
    lineageParentKey: null,
    admittedGeneration: 1,
    live: true,
  });
  recordMemoryFormation(db, { assertionKey: key, salience, nowMs: 1 });
}

function setup() {
  const sidecar = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  admitTestCycle(sidecar, {
    cycleId: "cycle-lookup",
    conversationId: "thread-lookup",
    triggerKind: "owner_message",
    triggerRef: "lookup",
    occupantId: OWNER,
    authorityEpoch: 1,
    nowMs: 1,
  });
  remember(sidecar, "cilantro", "owner_preference", "Alex can't stand cilantro.", 0.4);
  remember(sidecar, "cilantro-soap", "owner_preference", "To Alex cilantro tastes like soap.", 0.9);
  remember(sidecar, "trip", "owner_goal", "Alex plans a trip to Kyoto in spring.", 0.8);
  remember(sidecar, "forgotten", "owner_preference", REDACTED_MEMORY_STATEMENT, 1);
  const executor = createV021LiveOperationExecutors({ nuclear, sidecar, ownerId: OWNER });
  return { sidecar, nuclear, executor };
}

describe("memory.lookup", () => {
  it("is an advertised, read-only Owner-private observation with a validated request", () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(getCapabilityReality(nuclear).semanticObservations).toContainEqual(
        { operationKind: "memory.lookup", semanticClass: "observation", readOnly: true, available: true },
      );
    } finally {
      nuclear.close();
    }
    const intent = (value: Record<string, unknown>) => ({
      kind: "observation_intent",
      operationKind: "memory.lookup",
      request: value,
      purpose: "remember what Alex said about food",
      evidenceNeed: "my own memories",
      existingRefs: [],
    });
    expect(parseThoughtSemanticOutput(intent({ query: "cilantro", kinds: ["owner_preference"], limit: 5 }), new Set()).ok).toBe(true);
    expect(parseThoughtSemanticOutput(intent({ query: "" }), new Set()).ok).toBe(false);
    expect(parseThoughtSemanticOutput(intent({ query: "x", kinds: ["gossip"] }), new Set()).ok).toBe(false);
    expect(parseThoughtSemanticOutput(intent({ query: "x", sql: "DROP" }), new Set()).ok).toBe(false);
  });

  it("finds matching memories, strongest first, never the forgotten, without counting a recall", async () => {
    const { sidecar, nuclear, executor } = setup();
    try {
      const observation = await executor.executeObservation(request({ query: "Cilantro?" }));
      const payload = observation.payload as { memories: Array<{ key: string; strength: number }>; matchedCount: number; nextCursor: string | null };
      expect(payload.memories.map((memory) => memory.key)).toEqual(["cilantro-soap", "cilantro"]);
      expect(payload.matchedCount).toBe(2);
      expect(payload.nextCursor).toBeNull();
      expect(getMemoryStrength(sidecar, "cilantro-soap")?.recallCount).toBe(0);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("brings back the episodes the words recall", async () => {
    const { sidecar, nuclear, executor } = setup();
    try {
      const row = appendOwnerUtterance(sidecar, { conversationId: "thread-lookup", text: "cilantro again?!", nowMs: 5, audienceAtCapture: "owner_private" });
      recordEpisode(sidecar, {
        conversationId: "thread-lookup",
        cycleId: "cycle-episode",
        rows: [{ rowId: row.rowId, createdAtMs: 5, dataClassification: "ordinary" }],
        reflection: { summary: "Alex groaned about cilantro on his tacos.", salience: 0.5 },
        nowMs: 6,
      });
      const observation = await executor.executeObservation(request({ query: "cilantro" }));
      expect((observation.payload as { episodes?: Array<{ summary: string }> }).episodes?.map((episode) => episode.summary))
        .toEqual(["Alex groaned about cilantro on his tacos."]);
      const goals = await executor.executeObservation(request({ query: "cilantro", kinds: ["owner_goal"] }));
      expect((goals.payload as { episodes?: unknown }).episodes).toBeUndefined();
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("answers a house question from the game episode, ignoring function words", async () => {
    const { sidecar, nuclear, executor } = setup();
    try {
      const gameRow = appendOwnerUtterance(sidecar, { conversationId: "thread-lookup", text: "the house", nowMs: 7, audienceAtCapture: "owner_private" });
      recordEpisode(sidecar, {
        conversationId: "thread-lookup",
        cycleId: "cycle-game",
        rows: [{ rowId: gameRow.rowId, createdAtMs: 7, dataClassification: "ordinary" }],
        reflection: { summary: "Ashley cooked a meal in the house kitchen.", salience: 0.5 },
        nowMs: 8,
        channel: "domus:w1",
      });
      const talkRow = appendOwnerUtterance(sidecar, { conversationId: "thread-lookup", text: "what did you do", nowMs: 9, audienceAtCapture: "owner_private" });
      recordEpisode(sidecar, {
        conversationId: "thread-lookup",
        cycleId: "cycle-talk",
        rows: [{ rowId: talkRow.rowId, createdAtMs: 9, dataClassification: "ordinary" }],
        reflection: { summary: "We talked about what you do for work.", salience: 0.5 },
        nowMs: 10,
      });
      const house = await executor.executeObservation(request({ query: "What did you do in the house?" }));
      const episodes = (house.payload as { episodes?: Array<{ summary: string; channel?: string }> }).episodes ?? [];
      expect(episodes.map((episode) => episode.summary)).toEqual(["Ashley cooked a meal in the house kitchen."]);
      expect(episodes[0]?.channel).toBe("domus:w1");

      // Only function words left: nothing is searched, so no memory or episode comes back.
      const empty = await executor.executeObservation(request({ query: "what did you do?" }));
      expect(empty.payload).toMatchObject({ memories: [], matchedCount: 0 });
      expect((empty.payload as { episodes?: unknown }).episodes).toBeUndefined();
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("narrows by kind and pages with a scoped cursor", async () => {
    const { sidecar, nuclear, executor } = setup();
    try {
      const goals = await executor.executeObservation(request({ query: "Alex", kinds: ["owner_goal"] }));
      expect((goals.payload as { memories: Array<{ key: string }> }).memories.map((memory) => memory.key)).toEqual(["trip"]);

      const first = await executor.executeObservation(request({ query: "Alex", limit: 1 }));
      const cursor = (first.payload as { nextCursor: string }).nextCursor;
      expect(cursor).toMatch(/^v1\./);
      const second = await executor.executeObservation(request({ query: "Alex", limit: 1, cursor }));
      expect((second.payload as { memories: Array<{ key: string }> }).memories).toHaveLength(1);
      await expect(executor.executeObservation(request({ query: "trip", limit: 1, cursor }))).rejects.toThrow(/cursor/);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("is unavailable to any audience but the Owner's private one", async () => {
    const { sidecar, nuclear, executor } = setup();
    try {
      await expect(executor.executeObservation(request({ query: "cilantro" }, { kind: "room", roomId: "room:g:c" })))
        .rejects.toThrow(/capability_not_in_live_set|CAPABILITY_UNAVAILABLE/);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});
