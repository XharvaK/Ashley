import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ThoughtInput } from "../types.js";
import { buildAllocationCandidates } from "./projection-allocator/sections.js";
import { modelVisibleThoughtProjection, projectThoughtInput } from "./projection.js";
import {
  OWNER_RETURN_GAP_MS,
  lastExchangeEnd,
  loadExchangeRows,
  markOwnerBubbleReactionsShown,
  ownerMessageShape,
  reactionEmojiFact,
  recordOwnerBubbleReaction,
  returningForThought,
  returningFromRows,
  unshownOwnerBubbleReactions,
  type ExchangeRow,
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

function exchange(rowId: string, role: "owner" | "ashley", text: string, atMs: number): ExchangeRow {
  return { rowId, role, text, atMs };
}

function onReturn(prior: ExchangeRow[], currentText = "hello again") {
  const previousAt = [...prior].reverse().find((row) => row.role === "owner")?.atMs ?? 0;
  const current = exchange("current", "owner", currentText, previousAt + OWNER_RETURN_GAP_MS);
  return returningFromRows({
    mode: "owner_message",
    rows: [...prior, current],
    currentRowId: "current",
    nowMs: current.atMs,
  });
}

describe("returning facts", () => {
  it("names each end-shape from the exchange that already ended", () => {
    expect(onReturn([
      exchange("o1", "owner", "morning", 0),
      exchange("a1", "ashley", "You there?", 1),
    ])).toMatchObject({ sinceOwnerLastMs: OWNER_RETURN_GAP_MS, lastExchangeEnd: "her_open_question" });
    expect(onReturn([exchange("o1", "owner", "ok", 0)])).toMatchObject({ lastExchangeEnd: "owner_fragment" });
    expect(onReturn([exchange("o1", "owner", "BRB", 0)])).toMatchObject({ lastExchangeEnd: "owner_brb" });
    expect(onReturn([exchange("o1", "owner", "iyi geceler", 0)])).toMatchObject({ lastExchangeEnd: "owner_goodnight" });
    expect(onReturn([exchange("o1", "owner", "See you tomorrow.", 0)])).toMatchObject({ lastExchangeEnd: "plain" });
    expect(ownerMessageShape("back soon")).toBe("owner_brb");
    expect(ownerMessageShape("good night")).toBe("owner_goodnight");
    expect(ownerMessageShape("one two three")).toBe("owner_fragment");
    expect(ownerMessageShape("one two three four")).toBe("plain");
    expect(ownerMessageShape("ok.")).toBe("plain");
    expect(lastExchangeEnd([
      exchange("o1", "owner", "brb", 0),
      exchange("a1", "ashley", "sleep well", 1),
    ])).toBe("plain");
  });

  it("stays off a quick reply and on afterglow, including under the return gap", () => {
    const quick = returningFromRows({
      mode: "owner_message",
      rows: [
        exchange("o1", "owner", "hey", 0),
        exchange("a1", "ashley", "hi", 1_000),
        exchange("o2", "owner", "ok", 60_000),
      ],
      currentRowId: "o2",
      nowMs: 60_000,
    });
    expect(quick).toBeNull();
    expect(returningFromRows({
      mode: "owner_message",
      rows: [exchange("o2", "owner", "first ever", 60_000)],
      currentRowId: "o2",
      nowMs: 60_000,
    })).toBeNull();

    const afterglow = returningFromRows({
      mode: "afterglow",
      rows: [
        exchange("o1", "owner", "gn", 1_000),
        exchange("a1", "ashley", "Sleep well?", 2_000),
      ],
      nowMs: 1_000 + 5 * 60 * 1000,
    });
    expect(afterglow).toEqual({
      sinceOwnerLastMs: 5 * 60 * 1000,
      lastExchangeEnd: "her_open_question",
    });

    const base = projectThoughtInput(makeThoughtInput(), []).projected;
    const withReturning = projectThoughtInput(makeThoughtInput({
      returning: { sinceOwnerLastMs: OWNER_RETURN_GAP_MS, lastExchangeEnd: "plain" },
    }), []).projected;
    const baseKeys = Object.keys(modelVisibleThoughtProjection(base));
    const nextKeys = Object.keys(modelVisibleThoughtProjection(withReturning));
    expect(nextKeys.slice(0, baseKeys.length)).toEqual(baseKeys);
    expect(nextKeys.at(-1)).toBe("returning");
  });

  it("reads the gap from conversation rows, preferring sent time", () => {
    const sidecar = new DatabaseSync(":memory:");
    sidecar.exec(`
      CREATE TABLE conversation_evidence_log (
        row_id TEXT PRIMARY KEY,
        lineage_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT,
        created_at_ms INTEGER NOT NULL,
        sent_at_ms INTEGER,
        source_status TEXT NOT NULL
      );
    `);
    const insert = sidecar.prepare(
      `INSERT INTO conversation_evidence_log
       (row_id, lineage_id, version, conversation_id, role, text, created_at_ms, sent_at_ms, source_status)
       VALUES (?, ?, 1, 'conv-1', ?, ?, ?, ?, 'received')`,
    );
    insert.run("old", "lin-old", "owner", "brb", 10, 0);
    insert.run("ask", "lin-ask", "ashley", "Back soon?", 20, 5);
    insert.run("now", "lin-now", "owner", "hello", 30, OWNER_RETURN_GAP_MS + 5);
    expect(loadExchangeRows(sidecar, "conv-1").map((row) => row.atMs)).toEqual([0, 5, OWNER_RETURN_GAP_MS + 5]);
    expect(returningForThought(sidecar, {
      mode: "owner_message",
      conversationId: "conv-1",
      currentRowId: "now",
      nowMs: OWNER_RETURN_GAP_MS + 5,
    })).toEqual({
      sinceOwnerLastMs: OWNER_RETURN_GAP_MS + 5,
      lastExchangeEnd: "her_open_question",
    });
    expect(returningForThought(sidecar, {
      mode: "afterglow",
      conversationId: "conv-1",
      nowMs: OWNER_RETURN_GAP_MS + 5 + 1_000,
    })).toEqual({
      sinceOwnerLastMs: 1_000,
      lastExchangeEnd: "owner_fragment",
    });
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
