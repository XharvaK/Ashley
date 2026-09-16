import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { applyV021Forget, planV021Forget } from "../memory/forget.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import type { AssertionKey, DeskEntryDraft, DeskDelta } from "../types.js";
import type { SocialAudience } from "../social/types.js";
import { applyDeskDeltas, listDeskEntries } from "./store.js";
import { admitTestCycle } from "../test-support.js";
import { buildThoughtInput } from "../thought/input.js";
import { buildAllocationCandidates } from "../thought/projection-allocator/sections.js";
import type { CapabilityReality, IdentitySlice } from "../types.js";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
  databases.push(db);
  return db;
}

function ownerAssertion(db: DatabaseSync): void {
  upsertMemoryAssertion(db, {
    assertionKey: "assertion:owner" as AssertionKey,
    statement: "The owner wants the desk to remain private.",
    memoryKind: "owner_preference",
    dimensions: {
      source: "owner_utterance",
      status: "asserted",
      time: "current",
      reliability: "owner_supplied",
    },
    dataClassification: "ordinary",
    lineageParentKey: null,
    admittedGeneration: 1,
    live: true,
  });
}

function entry(overrides: Partial<DeskEntryDraft> = {}): DeskEntryDraft {
  return {
    id: "desk:one",
    concernRef: "concern:one",
    body: "A bounded private desk note.",
    authorKind: "ashley",
    sourceRefs: ["evidence:one"],
    verbatim: false,
    form: "note",
    endorsementRef: null,
    audienceScope: { kind: "owner_private" },
    ...overrides,
  };
}

const context = { cycleId: "cycle:one", generation: 1 };
const identity: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["careful"] };
const capability: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: true, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

describe("Owner-private personal desk", () => {
  it("applies a settlement delta and round-trips active entries with orthogonal attribution", () => {
    const db = database();
    ownerAssertion(db);
    const deltas: DeskDelta[] = [
      { op: "upsert", entry: entry({ id: "desk:commentary", authorKind: "ashley", verbatim: false }) },
      {
        op: "upsert",
        entry: entry({
          id: "desk:quote",
          body: "The owner said: keep the note private.",
          authorKind: "quoted_external",
          verbatim: true,
          form: "observation",
          endorsementRef: "assertion:owner",
        }),
      },
    ];

    applyDeskDeltas(db, deltas, context);

    expect(listDeskEntries(db)).toMatchObject([
      { id: "desk:commentary", authorKind: "ashley", verbatim: false, endorsementRef: null },
      { id: "desk:quote", authorKind: "quoted_external", verbatim: true, form: "observation", endorsementRef: "assertion:owner" },
    ]);
  });

  it("refuses mixed attribution and clears endorsement after an attribution-significant edit", () => {
    const db = database();
    ownerAssertion(db);

    expect(() => applyDeskDeltas(db, [{
      op: "upsert",
      entry: entry({ authorKind: "quoted_external", verbatim: false }),
    }], context)).toThrow("desk_attribution_mixed");

    applyDeskDeltas(db, [{
      op: "upsert",
      entry: entry({ endorsementRef: "assertion:owner" }),
    }], context);
    applyDeskDeltas(db, [{
      op: "upsert",
      entry: entry({ body: "The note was materially rewritten.", endorsementRef: "assertion:owner" }),
    }], { cycleId: "cycle:two", generation: 2 });

    expect(listDeskEntries(db)[0]).toMatchObject({
      body: "The note was materially rewritten.",
      endorsementRef: null,
    });
  });

  it("keeps archive and tombstone rows durable while excluding them from ordinary projection", () => {
    const db = database();
    applyDeskDeltas(db, [
      { op: "upsert", entry: entry({ id: "desk:archived" }) },
      { op: "upsert", entry: entry({ id: "desk:tombstoned", body: "Tombstone this entry." }) },
      { op: "archive", id: "desk:archived" },
      { op: "tombstone", id: "desk:tombstoned" },
    ], context);

    expect(listDeskEntries(db)).toEqual([]);
    expect(db.prepare("SELECT id, lifecycle, body FROM desk_entries ORDER BY id").all()).toEqual([
      { id: "desk:archived", lifecycle: "archived", body: "A bounded private desk note." },
      { id: "desk:tombstoned", lifecycle: "tombstoned", body: "Tombstone this entry." },
    ]);
  });

  it("fails closed to Owner-private and does not project a non-owner audience", () => {
    const db = database();
    const externalAudience: SocialAudience = { kind: "dm", principalId: "person:one" };
    applyDeskDeltas(db, [{ op: "upsert", entry: entry({ audienceScope: externalAudience }) }], context);

    expect(listDeskEntries(db)).toMatchObject([{ audienceScope: { kind: "owner_private" } }]);
    expect(listDeskEntries(db, { audience: externalAudience })).toEqual([]);
  });

  it("redacts forgotten content without introducing a new lifecycle state", () => {
    const db = database();
    applyDeskDeltas(db, [{
      op: "upsert",
      entry: entry({ body: "private topic that must be forgotten" }),
    }], context);

    const preview = planV021Forget(db, { topic: "private topic" });
    expect(preview.targets).toContainEqual({
      entityType: "v021_desk_entry",
      entityUuid: "desk:one",
      action: "redact",
    });
    applyV021Forget(db, { topic: "private topic", nowMs: 10 });

    expect(db.prepare("SELECT body, lifecycle, endorsement_ref, source_refs_json FROM desk_entries WHERE id = 'desk:one'").get())
      .toEqual({ body: "[redacted]", lifecycle: "active", endorsement_ref: null, source_refs_json: "[]" });
    expect(listDeskEntries(db)).toEqual([]);
  });

  it("loads the persisted desk into Thought input and the bounded allocator", () => {
    const db = database();
    const cycle = admitTestCycle(db, {
      cycleId: "cycle:desk-input",
      conversationId: "conversation:desk-input",
      triggerKind: "owner_message",
      triggerRef: "trigger:desk-input",
      occupantId: "owner",
      nowMs: 1,
    });
    applyDeskDeltas(db, [{ op: "upsert", entry: entry({ id: "desk:input" }) }], context);

    const input = buildThoughtInput({
      sidecar: db,
      cycle,
      constitution: identity,
      capabilityReality: capability,
      learnedSelfSlice: { dispositions: [], interests: [] },
      rawConversation: [],
      workingContext: [],
      occupancy: [],
    });

    expect(input.deskEntries).toEqual([expect.objectContaining({ id: "desk:input" })]);
    const candidates = buildAllocationCandidates(input, []);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "desk:desk:input", section: "desk_entry", canonicalStore: "desk_entries" }),
    ]));
  });
});
