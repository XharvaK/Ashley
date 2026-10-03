import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { journalForThought, recordJournalEntry } from "../../initiative/journal.js";
import { upsertMemoryAssertion } from "../../memory/assertions.js";
import { listLiveMemoryAssertions } from "../../memory/assertions.js";
import { recordEpisode, episodesForThought, listRecentEpisodes, searchEpisodes } from "../../memory/episodes.js";
import { buildCoreProfile } from "../../memory/strength.js";
import { admitTestCycle, openTestSidecar } from "../../test-support.js";
import { buildThoughtInput } from "../../thought/input.js";
import { projectRetrievalHit } from "../../thought/projection.js";
import { computeMemorySourceHash, openDerivedStore } from "../derived-store.js";
import { retrieveCandidates } from "../discover.js";
import { refreshMemoryVectors, type Embedder } from "../vectors.js";

const fake: Embedder = {
  model: "fake-domus",
  async embed(texts) {
    return texts.map(() => Float32Array.from([1, 0, 0, 0]));
  },
};

const DIMS = {
  source: "owner_utterance" as const,
  status: "asserted" as const,
  time: "historical" as const,
  reliability: "owner_supplied" as const,
};

function remember(
  db: DatabaseSync,
  key: string,
  statement: string,
  channel?: "discord" | `domus:${string}`,
): void {
  upsertMemoryAssertion(db, {
    assertionKey: key,
    statement,
    memoryKind: "owner_world_claim",
    dimensions: DIMS,
    dataClassification: "ordinary",
    lineageParentKey: null,
    admittedGeneration: 1,
    live: true,
    ...(channel ? { channel } : {}),
  });
}

function recall(
  db: DatabaseSync,
  derived: ReturnType<typeof openDerivedStore>,
  vector: Float32Array,
  assertionKeys: string[],
) {
  return retrieveCandidates(db, {
    conversationId: "owner-thread",
    request: {
      triggerTerms: ["lantern"],
      workingContextTopics: ["lantern"],
      assertionKeys,
      includeLogSearch: false,
    },
  }, derived, { queryVector: { model: fake.model, vector } }).hits;
}

describe("domus channel at recall", () => {
  it("projects domus channel on every memory tier and omits discord", async () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      remember(sidecar, "mem:key", "Quartz rests in the drawer.", "domus:w1");
      remember(sidecar, "mem:lex", "The orchard lantern hangs by the gate.", "domus:w1");
      remember(sidecar, "mem:vec", "A sibling lives abroad.", "domus:w1");
      remember(sidecar, "mem:discord-key", "Quartz rests in a box.");
      remember(sidecar, "mem:discord-lex", "The orchard lantern sits on the desk.");
      remember(sidecar, "mem:discord-vec", "A cousin lives abroad.");
      derived.reconcile(sidecar);
      await refreshMemoryVectors(derived, sidecar, fake, { nowMs: 1 });
      const [queryVector] = await fake.embed(["lantern"]);
      const hits = recall(sidecar, derived, queryVector!, ["mem:key", "mem:discord-key"]);
      const expectTier = (kind: "key" | "lexical" | "vector", domusKey: string, discordKey: string) => {
        const domus = hits.find((hit) => hit.kind === kind && hit.assertionKey === domusKey);
        const discord = hits.find((hit) => hit.kind === kind && hit.assertionKey === discordKey);
        expect(domus?.channel).toBe("domus:w1");
        expect(discord).toBeTruthy();
        expect("channel" in (discord ?? {})).toBe(false);
        expect(projectRetrievalHit(domus!).channel).toBe("domus:w1");
        expect("channel" in projectRetrievalHit(discord!)).toBe(false);
      };
      expectTier("key", "mem:key", "mem:discord-key");
      expectTier("lexical", "mem:lex", "mem:discord-lex");
      expectTier("vector", "mem:vec", "mem:discord-vec");
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("drops undone memories from every tier, the core profile, and live model context", async () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      remember(sidecar, "mem:domus", "The orchard lantern hangs by the gate.", "domus:w1");
      const beforeHash = sidecar.prepare(
        "SELECT content_hash FROM sidecar_memory_assertions WHERE assertion_key = ?",
      ).get("mem:domus") as { content_hash: string };
      const beforeSource = computeMemorySourceHash(sidecar);
      sidecar.prepare(
        "UPDATE sidecar_memory_assertions SET lineage_class = 'undone' WHERE assertion_key = ?",
      ).run("mem:domus");
      const afterHash = sidecar.prepare(
        "SELECT content_hash FROM sidecar_memory_assertions WHERE assertion_key = ?",
      ).get("mem:domus") as { content_hash: string };
      expect(afterHash.content_hash).toBe(beforeHash.content_hash);
      expect(computeMemorySourceHash(sidecar)).toEqual(beforeSource);
      derived.reconcile(sidecar);
      await refreshMemoryVectors(derived, sidecar, fake, { nowMs: 1 });
      const [queryVector] = await fake.embed(["lantern"]);
      const hits = recall(sidecar, derived, queryVector!, ["mem:domus"]);
      expect(hits.filter((hit) => hit.assertionKey === "mem:domus")).toEqual([]);
      expect(listLiveMemoryAssertions(sidecar).map((row) => row.assertionKey)).not.toContain("mem:domus");
      expect(buildCoreProfile(sidecar, 1).owner.map((entry) => entry.key)).not.toContain("mem:domus");
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("projects episode channel and hides undone episodes from recall lists", () => {
    const db = openTestSidecar();
    try {
      const domusRow = appendOwnerUtterance(db, { conversationId: "thread", text: "orchard", nowMs: 1_000 });
      const discordRow = appendOwnerUtterance(db, { conversationId: "thread", text: "desk", nowMs: 2_000 });
      const undoneRow = appendOwnerUtterance(db, { conversationId: "thread", text: "gone", nowMs: 3_000 });
      recordEpisode(db, {
        conversationId: "thread", cycleId: "c-domus",
        rows: [{ rowId: domusRow.rowId, createdAtMs: 1_000, dataClassification: "ordinary" }],
        reflection: { summary: "Orchard lantern by the gate.", salience: 0.5 },
        nowMs: 1_000, channel: "domus:w1",
      });
      recordEpisode(db, {
        conversationId: "thread", cycleId: "c-discord",
        rows: [{ rowId: discordRow.rowId, createdAtMs: 2_000, dataClassification: "ordinary" }],
        reflection: { summary: "Desk lantern in the study.", salience: 0.5 },
        nowMs: 2_000,
      });
      const undone = recordEpisode(db, {
        conversationId: "thread", cycleId: "c-undone",
        rows: [{ rowId: undoneRow.rowId, createdAtMs: 3_000, dataClassification: "ordinary" }],
        reflection: { summary: "Forgotten lantern in the cellar.", salience: 0.5 },
        nowMs: 3_000, channel: "domus:w1",
      });
      db.prepare("UPDATE episodes_v2 SET lineage_class = 'undone' WHERE episode_id = ?").run(undone!.episodeId);
      const thought = episodesForThought(db, ["cellar", "study"], { recent: 5, matched: 5 });
      const domus = thought.find((item) => item.summary.startsWith("Orchard"));
      const discord = thought.find((item) => item.summary.startsWith("Desk"));
      expect(domus?.channel).toBe("domus:w1");
      expect(discord).toBeTruthy();
      expect("channel" in (discord ?? {})).toBe(false);
      expect(thought.some((item) => item.summary.startsWith("Forgotten"))).toBe(false);
      expect(listRecentEpisodes(db, 10).some((item) => item.episodeId === undone!.episodeId)).toBe(false);
      expect(searchEpisodes(db, ["cellar"], 5)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("projects journal channel and hides undone journal entries", () => {
    const db = openTestSidecar();
    const now = 1_700_000_000_000;
    try {
      recordJournalEntry(db, {
        conversationId: "thread", cycleId: "j-domus", passKind: "awake",
        claim: { entry: "Walked the orchard." }, spoke: false, nowMs: now, channel: "domus:w1",
      });
      recordJournalEntry(db, {
        conversationId: "thread", cycleId: "j-discord", passKind: "awake",
        claim: { entry: "Sat at the desk." }, spoke: false, nowMs: now + 1,
      });
      const undone = recordJournalEntry(db, {
        conversationId: "thread", cycleId: "j-undone", passKind: "awake",
        claim: { entry: "Left the cellar." }, spoke: false, nowMs: now + 2, channel: "domus:w1",
      });
      db.prepare("UPDATE activity_journal SET lineage_class = 'undone' WHERE entry_id = ?").run(undone.entryId);
      const thought = journalForThought(db, now + 3);
      const domus = thought.find((item) => item.entry === "Walked the orchard.");
      const discord = thought.find((item) => item.entry === "Sat at the desk.");
      expect(domus?.channel).toBe("domus:w1");
      expect(discord).toBeTruthy();
      expect("channel" in (discord ?? {})).toBe(false);
      expect(thought.some((item) => item.entry === "Left the cellar.")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("carries domus channel through Thought input and keeps discord serialization free of channel", async () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      remember(sidecar, "mem:domus", "The orchard lantern hangs by the gate.", "domus:w1");
      const row = appendOwnerUtterance(sidecar, { conversationId: "owner-thread", text: "orchard", nowMs: 5_000 });
      recordEpisode(sidecar, {
        conversationId: "owner-thread", cycleId: "c-domus",
        rows: [{ rowId: row.rowId, createdAtMs: 5_000, dataClassification: "ordinary" }],
        reflection: { summary: "Orchard lantern by the gate.", salience: 0.5 },
        nowMs: 5_000, channel: "domus:w1",
      });
      recordJournalEntry(sidecar, {
        conversationId: "owner-thread", cycleId: "j-domus", passKind: "awake",
        claim: { entry: "Walked the orchard." }, spoke: false, nowMs: 5_000, channel: "domus:w1",
      });
      derived.reconcile(sidecar);
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-domus", conversationId: "owner-thread", generation: 1,
        triggerKind: "owner_message", occupantId: "owner-1", authorityEpoch: 1,
        architectureEpoch: "v0.2.1", preemptedGeneration: null, triggerRef: row.rowId,
      });
      const input = buildThoughtInput({
        sidecar, cycle, triggerText: "lantern",
        constitution: { constitutional: ["truth first"], stableSelf: [] },
        capabilityReality: {
          vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
          canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
          canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false,
          canOfferPatchExport: false, approvedProjectIds: [],
        },
        derivedStore: derived,
        clock: { nowMs: 5_000, timeZone: "UTC" },
      });
      expect(input.retrieval.hits.find((hit) => hit.assertionKey === "mem:domus")?.channel).toBe("domus:w1");
      expect(input.episodes?.some((item) => item.channel === "domus:w1")).toBe(true);
      expect(input.activityJournal?.some((item) => item.channel === "domus:w1")).toBe(true);
      expect(input.coreProfile?.owner.some((entry) => entry.channel === "domus:w1")).toBe(true);
    } finally {
      derived.close();
      sidecar.close();
    }

    const discordDb = openTestSidecar();
    const discordDerived = openDerivedStore(":memory:");
    try {
      remember(discordDb, "mem:discord", "The study lamp sits on the desk.");
      const row = appendOwnerUtterance(discordDb, { conversationId: "owner-thread", text: "study", nowMs: 5_000 });
      recordEpisode(discordDb, {
        conversationId: "owner-thread", cycleId: "c-discord",
        rows: [{ rowId: row.rowId, createdAtMs: 5_000, dataClassification: "ordinary" }],
        reflection: { summary: "Study lamp on the desk.", salience: 0.5 },
        nowMs: 5_000,
      });
      recordJournalEntry(discordDb, {
        conversationId: "owner-thread", cycleId: "j-discord", passKind: "awake",
        claim: { entry: "Sat with the study lamp." }, spoke: false, nowMs: 5_000,
      });
      discordDerived.reconcile(discordDb);
      const cycle = admitTestCycle(discordDb, {
        cycleId: "cycle-discord", conversationId: "owner-thread", generation: 1,
        triggerKind: "owner_message", occupantId: "owner-1", authorityEpoch: 1,
        architectureEpoch: "v0.2.1", preemptedGeneration: null, triggerRef: row.rowId,
      });
      const input = buildThoughtInput({
        sidecar: discordDb, cycle, triggerText: "lamp",
        constitution: { constitutional: ["truth first"], stableSelf: [] },
        capabilityReality: {
          vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
          canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
          canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false,
          canOfferPatchExport: false, approvedProjectIds: [],
        },
        derivedStore: discordDerived,
        clock: { nowMs: 5_000, timeZone: "UTC" },
      });
      expect(JSON.stringify(input)).not.toContain("channel");
    } finally {
      discordDerived.close();
      discordDb.close();
    }
  });
});
