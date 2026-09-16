import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import {
  appendAshleyEvidence,
  appendEvidenceInTransaction,
  appendOwnerUtterance,
} from "../evidence/conversation-log.js";
import { retrieveCandidates } from "./discover.js";
import { openDerivedStore } from "./derived-store.js";
import { searchConversationFts } from "./fts.js";
import { listOwnerTrustedRoomConversationIds } from "../../relationship/social-authority.js";
import { buildThoughtInput } from "../thought/input.js";

const DM = "dm-thread-1";
const ROOM = "room:guild-1:channel-1";
const OTHER_ROOM = "room:other-guild:other-channel";

const ROOM_LOCATION = {
  kind: "room",
  guildId: "guild-1",
  channelId: "channel-1",
} as const;

type Fixture = {
  sidecar: DatabaseSync;
  dmOwner: string;
  roomOwner: string;
  roomAshley: string;
  roomExternal: string;
  roomSecret: string;
  roomOmitted: string;
  roomSupersededV1: string;
  roomErased: string;
  otherRoomOwner: string;
};

function seedFixture(): Fixture {
  const sidecar = openTestSidecar();
  const dmOwner = appendOwnerUtterance(sidecar, {
    conversationId: DM,
    text: "Orpheus cactus sits on the windowsill",
  }).rowId;

  const roomOwner = appendOwnerUtterance(sidecar, {
    conversationId: ROOM,
    text: "Vesper lantern glows amber in the server hall",
    speakerPrincipalId: "owner-1",
    speakerKind: "owner",
    location: { ...ROOM_LOCATION },
    audienceAtCapture: "room",
  }).rowId;

  const roomAshley = appendAshleyEvidence(sidecar, {
    conversationId: ROOM,
    text: "Ashley rewired the Vesper lantern socket",
    speakerKind: "ashley",
    location: { ...ROOM_LOCATION },
    audienceAtCapture: "room",
  }).rowId;

  const roomExternal = appendEvidenceInTransaction(sidecar, "external_dialog", {
    conversationId: ROOM,
    text: "Vesper festival opens next week",
    speakerPrincipalId: "person-9",
    speakerKind: "external_human",
    location: { ...ROOM_LOCATION },
    audienceAtCapture: "room",
  }).rowId;

  const roomSecret = appendOwnerUtterance(sidecar, {
    conversationId: ROOM,
    text: "Vesper vault combination alpha",
    speakerPrincipalId: "owner-1",
    speakerKind: "owner",
    location: { ...ROOM_LOCATION },
    audienceAtCapture: "room",
    dataClassification: "secret",
  }).rowId;

  const roomOmitted = appendOwnerUtterance(sidecar, {
    conversationId: ROOM,
    text: "Vesper spare bulb inventory",
    speakerPrincipalId: "owner-1",
    speakerKind: "owner",
    location: { ...ROOM_LOCATION },
    audienceAtCapture: "room",
  }).rowId;
  sidecar.prepare(
    "UPDATE conversation_evidence_log SET secret_omitted = 1 WHERE row_id = ?",
  ).run(roomOmitted);

  const v1 = appendOwnerUtterance(sidecar, {
    conversationId: ROOM,
    text: "Quixotic pancake memo draft",
    speakerPrincipalId: "owner-1",
    speakerKind: "owner",
    location: { ...ROOM_LOCATION },
    audienceAtCapture: "room",
  });
  appendOwnerUtterance(sidecar, {
    conversationId: ROOM,
    text: "Completely different final wording",
    speakerPrincipalId: "owner-1",
    speakerKind: "owner",
    location: { ...ROOM_LOCATION },
    audienceAtCapture: "room",
    editOfRowId: v1.rowId,
  });

  const roomErased = appendOwnerUtterance(sidecar, {
    conversationId: ROOM,
    text: "Zebra umbrella standby",
    speakerPrincipalId: "owner-1",
    speakerKind: "owner",
    location: { ...ROOM_LOCATION },
    audienceAtCapture: "room",
  }).rowId;

  const otherRoomOwner = appendOwnerUtterance(sidecar, {
    conversationId: OTHER_ROOM,
    text: "Vesper beacon test",
    speakerPrincipalId: "owner-1",
    speakerKind: "owner",
    location: { kind: "room", guildId: "other-guild", channelId: "other-channel" },
    audienceAtCapture: "room",
  }).rowId;

  return {
    sidecar,
    dmOwner,
    roomOwner,
    roomAshley,
    roomExternal,
    roomSecret,
    roomOmitted,
    roomSupersededV1: v1.rowId,
    roomErased,
    otherRoomOwner,
  };
}

function logRefs(result: { hits: Array<{ kind: string; ref: string }> }): string[] {
  return result.hits.filter((hit) => hit.kind === "log").map((hit) => hit.ref);
}

function openNuclearWithRooms(): DatabaseSync {
  const nuclear = new DatabaseSync(":memory:");
  nuclear.exec(
    `CREATE TABLE trusted_rooms (
      owner_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      mode TEXT NOT NULL
    )`,
  );
  nuclear.exec(
    `CREATE TABLE derived_invalidation_journal (
      change_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      conversation_id TEXT,
      source_refs_json TEXT NOT NULL,
      invalidation_kind TEXT NOT NULL,
      canonical_owner TEXT NOT NULL,
      canonical_version INTEGER NOT NULL,
      target_generation INTEGER NOT NULL,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
  );
  const insert = nuclear.prepare(
    "INSERT INTO trusted_rooms (owner_id, guild_id, channel_id, mode) VALUES (?, ?, ?, ?)",
  );
  insert.run("owner-1", "guild-1", "channel-1", "trusted_social");
  insert.run("owner-1", "guild-2", "channel-2", "disengaged");
  insert.run("owner-1", "guild-3", "channel-3", "observe_only");
  insert.run("owner-2", "guild-4", "channel-4", "trusted_social");
  insert.run("owner-1", "", "channel-5", "trusted_social");
  insert.run("owner-1", "guild-6", "", "trusted_social");
  return nuclear;
}

describe("owner-private cross-surface recall bridge", () => {
  it("A: keeps same-conversation Owner-private retrieval working", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    try {
      derived.reconcile(fixture.sidecar);
      const result = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["orpheus"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
        },
        derived,
      );
      expect(result.state).toBe("ready");
      expect(logRefs(result)).toContain(fixture.dmOwner);
    } finally {
      derived.close();
      fixture.sidecar.close();
    }
  });

  it("ignores caller-provided cross-surface IDs when authorityDb is absent", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    try {
      derived.reconcile(fixture.sidecar);
      const result = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["vesper"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [ROOM],
        },
        derived,
      );
      expect(result.state).toBe("ready");
      expect(logRefs(result)).not.toContain(fixture.roomOwner);
      expect(logRefs(result)).not.toContain(fixture.roomAshley);

      const direct = searchConversationFts(
        derived,
        fixture.sidecar,
        DM,
        "vesper",
        { additionalConversationIds: [ROOM] },
      );
      expect(direct.state).toBe("ready");
      expect(direct.rows.map((row) => row.rowId)).not.toContain(fixture.roomOwner);
    } finally {
      derived.close();
      fixture.sidecar.close();
    }
  });

  it("B+C: returns eligible Owner and Ashley room rows to an authenticated Owner-private cycle", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    const nuclear = openNuclearWithRooms();
    try {
      derived.reconcile(fixture.sidecar);
      const result = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["vesper"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [ROOM],
        },
        derived,
        { authorityDb: nuclear, ownerId: "owner-1", audience: { kind: "owner_private" } },
      );
      expect(result.state).toBe("ready");
      const refs = logRefs(result);
      expect(refs).toContain(fixture.roomOwner);
      expect(refs).toContain(fixture.roomAshley);
    } finally {
      nuclear.close();
      derived.close();
      fixture.sidecar.close();
    }
  });

  it("D: excludes external-participant room rows from the cross-surface scope", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    try {
      derived.reconcile(fixture.sidecar);
      const result = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["vesper"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [ROOM],
        },
        derived,
      );
      expect(logRefs(result)).not.toContain(fixture.roomExternal);
    } finally {
      derived.close();
      fixture.sidecar.close();
    }
  });

  it("E: excludes non-allowed rooms and admits only canonical trusted rooms for the Owner", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    try {
      derived.reconcile(fixture.sidecar);
      const result = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["vesper"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [ROOM],
        },
        derived,
      );
      expect(logRefs(result)).not.toContain(fixture.otherRoomOwner);
    } finally {
      derived.close();
      fixture.sidecar.close();
    }

    const nuclear = openNuclearWithRooms();
    try {
      expect(listOwnerTrustedRoomConversationIds(nuclear, "owner-1")).toEqual([
        "room:guild-1:channel-1",
      ]);
      expect(listOwnerTrustedRoomConversationIds(nuclear, "owner-2")).toEqual([
        "room:guild-4:channel-4",
      ]);
      expect(listOwnerTrustedRoomConversationIds(nuclear, "")).toEqual([]);
    } finally {
      nuclear.close();
    }
  });

  it("F10: callee authority overrides forged audience and cross-surface scope", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    const nuclear = openNuclearWithRooms();
    try {
      derived.reconcile(fixture.sidecar);
      const ownerPrivate = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          ownerId: "owner-1",
          request: {
            triggerTerms: ["vesper"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [OTHER_ROOM],
        },
        derived,
        { authorityDb: nuclear, audience: { kind: "owner_private" } },
      );
      expect(ownerPrivate.state).toBe("ready");
      expect(logRefs(ownerPrivate)).toContain(fixture.roomOwner);
      expect(logRefs(ownerPrivate)).not.toContain(fixture.otherRoomOwner);

      const roomWithForgedAudience = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: ROOM,
          ownerId: "owner-1",
          request: {
            triggerTerms: ["orpheus"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [DM],
        },
        derived,
        { authorityDb: nuclear, audience: { kind: "owner_private" } },
      );
      expect(logRefs(roomWithForgedAudience)).not.toContain(fixture.dmOwner);
    } finally {
      nuclear.close();
      derived.close();
      fixture.sidecar.close();
    }
  });

  it("F: excludes secret, secret-omitted, superseded, and erased room rows", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    try {
      derived.reconcile(fixture.sidecar);
      // Erase after indexing so the FTS row is stale: the authoritative
      // recheck, not the index, must exclude it.
      fixture.sidecar.prepare(
        "UPDATE conversation_evidence_log SET text = NULL, source_status = 'redacted' WHERE row_id = ?",
      ).run(fixture.roomErased);

      const vesper = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["vesper"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [ROOM],
        },
        derived,
      );
      const vesperRefs = logRefs(vesper);
      expect(vesperRefs).not.toContain(fixture.roomSecret);
      expect(vesperRefs).not.toContain(fixture.roomOmitted);

      const superseded = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["quixotic"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [ROOM],
        },
        derived,
      );
      expect(logRefs(superseded)).not.toContain(fixture.roomSupersededV1);
      expect(logRefs(superseded)).toEqual([]);

      const erased = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["zebra"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [ROOM],
        },
        derived,
      );
      expect(logRefs(erased)).toEqual([]);
    } finally {
      derived.close();
      fixture.sidecar.close();
    }
  });

  it("G: keeps Owner-private DM evidence out of room-audience retrieval", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    try {
      derived.reconcile(fixture.sidecar);
      // Adversarial scope: even when a DM conversation ID is offered to a
      // room audience, no Owner-private evidence may surface.
      const leaked = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: ROOM,
          request: {
            triggerTerms: ["orpheus"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [DM],
        },
        derived,
        { audience: { kind: "room", roomId: ROOM } },
      );
      expect(logRefs(leaked)).toEqual([]);

      // Room-local recall for the same audience is unaffected.
      const local = retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: ROOM,
          request: {
            triggerTerms: ["vesper"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
        },
        derived,
        { audience: { kind: "room", roomId: ROOM } },
      );
      const localRefs = logRefs(local);
      expect(localRefs).toContain(fixture.roomOwner);
      expect(localRefs).toContain(fixture.roomAshley);
    } finally {
      derived.close();
      fixture.sidecar.close();
    }
  });

  it("H: preserves distinct conversation identities and copies no rows", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    try {
      derived.reconcile(fixture.sidecar);
      const before = fixture.sidecar.prepare(
        "SELECT row_id, conversation_id FROM conversation_evidence_log ORDER BY row_id",
      ).all() as Array<{ row_id: string; conversation_id: string }>;
      retrieveCandidates(
        fixture.sidecar,
        {
          conversationId: DM,
          request: {
            triggerTerms: ["vesper"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
          crossSurfaceConversationIds: [ROOM],
        },
        derived,
      );
      const after = fixture.sidecar.prepare(
        "SELECT row_id, conversation_id FROM conversation_evidence_log ORDER BY row_id",
      ).all() as Array<{ row_id: string; conversation_id: string }>;
      expect(after).toEqual(before);
      const byId = new Map(after.map((row) => [row.row_id, row.conversation_id]));
      expect(byId.get(fixture.dmOwner)).toBe(DM);
      expect(byId.get(fixture.roomOwner)).toBe(ROOM);
    } finally {
      derived.close();
      fixture.sidecar.close();
    }
  });

  it("projects the cross-surface scope through Thought input for Owner-private only", () => {
    const fixture = seedFixture();
    const derived = openDerivedStore(":memory:");
    const nuclear = openNuclearWithRooms();
    try {
      derived.reconcile(fixture.sidecar);
      const constitution = { constitutional: ["truth first"], stableSelf: [] as string[] };
      const capabilityReality = {
        vision: false,
        attachmentText: false,
        conversationalRead: false,
        webSearch: false,
        canOfferProjectInspection: false,
        canOfferWorkspace: false,
        canOfferVerification: false,
        canOfferAuthorship: false,
        canOfferBoundedOperation: false,
        canOfferPatchExport: false,
        approvedProjectIds: [] as string[],
      };

      const dmCycle = admitTestCycle(fixture.sidecar, {
        cycleId: "cycle-dm",
        conversationId: DM,
        generation: 1,
        triggerKind: "owner_message",
        occupantId: "owner-1",
        authorityEpoch: 1,
        architectureEpoch: "v0.2.1",
        preemptedGeneration: null,
        triggerRef: fixture.dmOwner,
      });
      const ownerPrivate = buildThoughtInput({
        sidecar: fixture.sidecar,
        cycle: dmCycle,
        triggerText: "vesper lantern",
        constitution,
        capabilityReality,
        derivedStore: derived,
        authorityDb: nuclear,
        crossSurfaceConversationIds: [ROOM],
      });
      const ownerRefs = ownerPrivate.retrieval.hits
        .filter((hit) => hit.kind === "log")
        .map((hit) => hit.ref);
      expect(ownerRefs).toContain(fixture.roomOwner);

      const roomCycle = admitTestCycle(fixture.sidecar, {
        cycleId: "cycle-room",
        conversationId: ROOM,
        generation: 1,
        triggerKind: "owner_message",
        occupantId: "owner-1",
        authorityEpoch: 1,
        architectureEpoch: "v0.2.1",
        preemptedGeneration: null,
        triggerRef: fixture.roomOwner,
      });
      const roomInput = buildThoughtInput({
        sidecar: fixture.sidecar,
        cycle: roomCycle,
        triggerText: "orpheus cactus",
        constitution,
        capabilityReality,
        derivedStore: derived,
        authorityDb: nuclear,
        audience: { kind: "room", roomId: ROOM },
        crossSurfaceConversationIds: [DM],
      });
      const roomRefs = roomInput.retrieval.hits
        .filter((hit) => hit.kind === "log")
        .map((hit) => hit.ref);
      expect(roomRefs).not.toContain(fixture.dmOwner);
    } finally {
      nuclear.close();
      derived.close();
      fixture.sidecar.close();
    }
  });
});
