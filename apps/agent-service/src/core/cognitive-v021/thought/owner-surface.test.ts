import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ThoughtInput } from "../types.js";
import { buildAllocationCandidates } from "./projection-allocator/sections.js";
import { modelVisibleThoughtProjection, projectThoughtInput } from "./projection.js";
import {
  markOwnerBubbleReactionsShown,
  reactionEmojiFact,
  recordOwnerBubbleReaction,
  unshownOwnerBubbleReactions,
} from "./owner-surface.js";

function openStores(): { nuclear: DatabaseSync; sidecar: DatabaseSync } {
  const nuclear = new DatabaseSync(":memory:");
  nuclear.exec(`
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE delivery_bubbles (discord_message_id TEXT, sent_at TEXT);
  `);
  return { nuclear, sidecar: new DatabaseSync(":memory:") };
}

function makeThoughtInput(overrides: Partial<ThoughtInput> = {}): ThoughtInput {
  return {
    cycleId: "cycle-1",
    generation: 1,
    occupantId: "occupant-1",
    authorityEpoch: 1,
    trigger: { kind: "owner_message", ref: "msg-1" },
    rawConversation: [],
    workingContext: [],
    occupancy: [],
    constitution: { constitutional: [], stableSelf: [] },
    learnedSelfSlice: { dispositions: [], interests: [] },
    capabilityReality: {
      vision: false,
      attachmentText: false,
      conversationalRead: false,
      webSearch: false,
      canOfferProjectInspection: false,
      canOfferWorkspace: false,
      canOfferVerification: false,
      canOfferAuthorship: false,
      canOfferBoundedOperation: false,
      canOfferInquiry: false,
      canOfferPatchExport: false,
      approvedProjectIds: [],
    },
    observations: [],
    retrieval: {
      request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
      hits: [],
      state: "ready",
      miss: true,
    },
    inFlight: [],
    authorityObjections: [],
    runtimeCondition: { fallback: false, compression: false, lookupFailed: false, thoughtUnavailable: false },
    rememberDirective: null,
    ...overrides,
  };
}

describe("owner bubble reactions", () => {
  it("keeps unicode as received and reduces a custom emoji to its name", () => {
    expect(reactionEmojiFact("👍")).toBe("👍");
    expect(reactionEmojiFact("<:party_blob:99>")).toBe("party_blob");
    expect(reactionEmojiFact("<a:party_blob:99>")).toBe("party_blob");
    expect(reactionEmojiFact("   ")).toBeNull();
  });

  it("shows at most five resolvable reactions, newest first, and only once", () => {
    const { nuclear, sidecar } = openStores();
    const insert = nuclear.prepare(
      "INSERT INTO delivery_bubbles (discord_message_id, sent_at) VALUES (?, ?)",
    );
    for (let index = 0; index < 6; index += 1) {
      insert.run(`m${index}`, new Date(1_000 + index).toISOString());
      recordOwnerBubbleReaction(nuclear, { messageId: `m${index}`, emoji: "👍", atMs: 10_000 + index });
    }
    recordOwnerBubbleReaction(nuclear, { messageId: "missing", emoji: "<:spark:7>", atMs: 99_000 });

    const first = unshownOwnerBubbleReactions(nuclear, sidecar);
    expect(first.facts).toHaveLength(5);
    expect(first.facts.map((fact) => fact.atMs)).toEqual([10_005, 10_004, 10_003, 10_002, 10_001]);
    expect(first.facts[0]).toMatchObject({ emoji: "👍", atMs: 10_005 });
    expect(typeof first.facts[0]!.onHerMessageAt).toBe("number");

    markOwnerBubbleReactionsShown(nuclear, first.ids);
    const second = unshownOwnerBubbleReactions(nuclear, sidecar);
    expect(second.facts.map((fact) => fact.atMs)).toEqual([10_000]);
    expect(second.facts[0]!.emoji).toBe("👍");

    const stillWaiting = unshownOwnerBubbleReactions(nuclear, sidecar);
    expect(stillWaiting.facts.map((fact) => fact.atMs)).toEqual([10_000]);
    const named = recordThenRead(nuclear, sidecar);
    expect(named.emoji).toBe("spark");
  });

  it("appends reactions after every key that already existed, including anything before growth", () => {
    const base = projectThoughtInput(makeThoughtInput(), []).projected;
    const withReactions = projectThoughtInput(makeThoughtInput({
      reactions: [{ emoji: "👍", onHerMessageAt: 5, atMs: 9 }],
    }), []).projected;
    const baseKeys = Object.keys(modelVisibleThoughtProjection(base));
    const nextKeys = Object.keys(modelVisibleThoughtProjection(withReactions));
    expect(nextKeys.slice(0, baseKeys.length)).toEqual(baseKeys);
    expect(nextKeys.at(-1)).toBe("reactions");
    const growthAt = nextKeys.indexOf("growth");
    if (growthAt >= 0) expect(nextKeys.indexOf("reactions")).toBeGreaterThan(growthAt);

    const packed = buildAllocationCandidates(makeThoughtInput({
      reactions: [{ emoji: "👍", onHerMessageAt: 5, atMs: 9 }],
    }), []);
    expect(packed.at(-1)).toMatchObject({ section: "host_surface", required: false, priority: 19 });
    expect(buildAllocationCandidates(makeThoughtInput(), []).some((candidate) => candidate.section === "host_surface")).toBe(false);
  });
});

function recordThenRead(nuclear: DatabaseSync, sidecar: DatabaseSync): { emoji: string } {
  nuclear.prepare("INSERT INTO delivery_bubbles (discord_message_id, sent_at) VALUES (?, ?)").run(
    "custom-1",
    new Date(50_000).toISOString(),
  );
  recordOwnerBubbleReaction(nuclear, { messageId: "custom-1", emoji: "<:spark:7>", atMs: 60_000 });
  const shown = unshownOwnerBubbleReactions(nuclear, sidecar);
  const fact = shown.facts.find((item) => item.atMs === 60_000);
  if (!fact) throw new Error("custom emoji fact missing");
  return fact;
}
