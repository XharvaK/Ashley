import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLearnedSelfSlice } from "../identity/learned-self.js";
import { appendMemorySupport } from "../memory/supports.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { appendEvidenceInTransaction } from "../evidence/conversation-log.js";
import { buildThoughtInput } from "./input.js";
import { openNuclearDb } from "../../db.js";
import { runPerceptionTurn } from "../../perception/index.js";
import { fetchAttachmentBytes } from "../../perception/fetch.js";
import { checkAttachmentPreflight } from "../../perception/preflight.js";
import { getCapabilityReality } from "./capability-reality.js";

vi.mock("../../perception/fetch.js", () => ({
  fetchAttachmentBytes: vi.fn(),
}));

vi.mock("../../perception/preflight.js", () => ({
  checkAttachmentPreflight: vi.fn(),
  conversationalReadPreflight: vi.fn(),
}));

let previousArtifactDir: string | undefined;

beforeEach(() => {
  previousArtifactDir = process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR;
  process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR = mkdtempSync(join(tmpdir(), "ashley-audience-"));
});

afterEach(() => {
  if (previousArtifactDir === undefined) delete process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR;
  else process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR = previousArtifactDir;
  vi.clearAllMocks();
});

describe("audience eligibility", () => {
  it("keeps same-audience conversation evidence and excludes owner-private evidence", () => {
    const sidecar = openTestSidecar();
    const ownerEvidence = appendEvidenceInTransaction(sidecar, "owner", {
      conversationId: "social-dm",
      text: "owner-private context",
      speakerKind: "owner",
      sentAtMs: 1,
    });
    const externalEvidence = appendEvidenceInTransaction(sidecar, "external_dialog", {
      conversationId: "social-dm",
      text: "same-dm context",
      speakerKind: "external_human",
      speakerPrincipalId: "person-1",
      location: {
        kind: "external_dm",
        principalId: "person-1",
        channelId: "dm-channel-1",
      },
      audienceAtCapture: "dm",
      sentAtMs: 2,
    });

    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-1",
      conversationId: "social-dm",
      generation: 1,
      triggerKind: "owner_message",
      occupantId: "doc",
      authorityEpoch: 1,
      architectureEpoch: "v0.2.1",
      preemptedGeneration: null,
      triggerRef: externalEvidence.rowId,
    });

    const input = buildThoughtInput({
      sidecar,
      cycle,
      triggerText: externalEvidence.text ?? "",
      triggerEvidence: externalEvidence,
      rawConversation: [ownerEvidence, externalEvidence],
      constitution: { constitutional: ["truth first"], stableSelf: [] },
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
      audience: { kind: "dm", principalId: "person-1" },
      licenses: [],
    });

    expect(input.rawConversation.map((row) => row.text)).toEqual(["same-dm context"]);
    expect(input.rawConversation).not.toContainEqual(ownerEvidence);
  });

  it("partitions learned self into broad orientation and person-linked slices", () => {
    const sidecar = openTestSidecar();
    const adoptionDimensions = {
      source: "ashley_interpretation" as const,
      status: "interpreted" as const,
      time: "current" as const,
      reliability: "inferred" as const,
    };
    const adoptedNominations = [
      {
        nominationId: "evidence:broad",
        assertionKey: "broad-1",
        statement: "general orientation",
      },
      {
        nominationId: "evidence:person",
        assertionKey: "person-1",
        statement: "person-linked orientation",
      },
    ].map((nomination) => ({
      ...nomination,
      cycleId: "cycle:audience",
      generation: 1,
      memoryKind: "learned_self_evidence" as const,
      dimensions: adoptionDimensions,
      dataClassification: "ordinary" as const,
      supersedesAssertionKey: null,
      concernId: null,
      sourceRefs: [],
    }));
    for (const nomination of adoptedNominations) {
      sidecar.prepare(
        `INSERT INTO durable_nominations
           (nomination_id, cycle_id, generation, assertion_key, statement, memory_kind,
            dimensions_json, data_classification, supersedes_assertion_key, concern_id, admitted, source_refs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(
        nomination.nominationId,
        nomination.cycleId,
        nomination.generation,
        nomination.assertionKey,
        nomination.statement,
        nomination.memoryKind,
        JSON.stringify(nomination.dimensions),
        nomination.dataClassification,
        nomination.supersedesAssertionKey,
        nomination.concernId,
        JSON.stringify(nomination.sourceRefs),
      );
      appendMemorySupport(sidecar, {
        supportId: `support:${nomination.assertionKey}`,
        assertionKey: nomination.assertionKey,
        source: "ashley_interpretation",
        provenance: "native",
        sourceArchitectureEpoch: "v0.2.1",
        sourceRef: nomination.nominationId,
        settlementId: "settlement:audience",
        evidenceLineageId: `lineage:${nomination.assertionKey}`,
        observationId: null,
        receiptId: null,
        dimensions: adoptionDimensions,
        dataClassification: "ordinary",
        createdAtMs: 1,
      });
    }
    sidecar.prepare(
      "INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)",
    ).run(
      "settlement:audience",
      "cycle:audience",
      1,
      JSON.stringify({ durableNominations: adoptedNominations }),
    );
    const slice = buildLearnedSelfSlice(sidecar, [
      {
        assertionKey: "broad-1",
        statement: "general orientation",
        memoryKind: "learned_self_evidence",
        dimensions: { confidence: 0.9 },
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
        audienceScope: { kind: "owner_private" },
        protectionStatus: "admitted",
      },
      {
        assertionKey: "person-1",
        statement: "person-linked orientation",
        memoryKind: "learned_self_evidence",
        dimensions: { confidence: 0.9 },
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
        audienceScope: { kind: "dm", principalId: "person-1" },
        protectionStatus: "admitted",
      },
    ] as never);

    expect(slice.broadOrientation).toBeDefined();
    expect(slice.personLinked).toHaveLength(1);
    expect(slice.personLinked?.[0]?.audience).toEqual({ kind: "dm", principalId: "person-1" });
  });

  it("fails closed for retrieval candidates without admitted audience metadata", async () => {
    const sidecar = openTestSidecar();
    const { retrieveCandidates } = await import("../retrieval/discover.js");
    const result = retrieveCandidates(
      sidecar,
      {
        conversationId: "social-dm",
        request: {
          triggerTerms: [],
          workingContextTopics: [],
          assertionKeys: [],
          includeLogSearch: true,
        },
      },
      undefined,
      {
        audience: { kind: "dm", principalId: "person-1" },
        licenses: [],
      },
    );

    expect(result.hits).toEqual([]);
  });

  it("applies the dm/room/Owner and licensed/unlicensed eligibility matrix", () => {
    const sidecar = openTestSidecar();
    const ownerPrivate = {
      id: "owner-private",
      conversationId: "matrix-conversation",
      type: "topic" as const,
      text: "Owner private",
      concernId: null,
      sourceTurnIds: [],
      status: "active" as const,
      supersedesId: null,
      updatedGeneration: 1,
      audienceScope: { kind: "owner_private" as const },
      protectionStatus: "admitted" as const,
      licenseRefs: ["license-owner"],
    };
    const roomLocal = {
      id: "room-local",
      conversationId: "matrix-conversation",
      type: "topic" as const,
      text: "Room local",
      concernId: null,
      sourceTurnIds: [],
      status: "active" as const,
      supersedesId: null,
      updatedGeneration: 1,
      audienceScope: { kind: "room" as const, roomId: "room:guild-1:channel-1" },
      protectionStatus: "admitted" as const,
    };
    const base = {
      sidecar,
      cycle: admitTestCycle(sidecar, {
        cycleId: "matrix-cycle",
        conversationId: "matrix-conversation",
        generation: 1,
        triggerKind: "owner_message",
        occupantId: "doc",
        authorityEpoch: 1,
        architectureEpoch: "v0.2.1",
        preemptedGeneration: null,
        triggerRef: "matrix-trigger",
      }),
      triggerText: "matrix",
      constitution: { constitutional: ["truth first"], stableSelf: [] },
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
      workingContext: [ownerPrivate, roomLocal],
    };

    const dm = buildThoughtInput({
      ...base,
      audience: { kind: "dm", principalId: "person-1" },
      licenses: [],
    });
    expect(dm.workingContext).toEqual([]);

    const licensedDm = buildThoughtInput({
      ...base,
      audience: { kind: "dm", principalId: "person-1" },
      licenses: ["license-owner"],
    });
    expect(licensedDm.workingContext.map((item) => item.id)).toEqual(["owner-private"]);

    const room = buildThoughtInput({
      ...base,
      audience: { kind: "room", roomId: "room:guild-1:channel-1" },
      licenses: [],
    });
    expect(room.workingContext.map((item) => item.id)).toEqual(["room-local"]);

    const owner = buildThoughtInput({ ...base, audience: { kind: "owner_private" } });
    expect(owner.workingContext.map((item) => item.id)).toEqual(["owner-private", "room-local"]);
  });

  it("binds external perception parts to the requesting audience", async () => {
    vi.mocked(checkAttachmentPreflight).mockReturnValue({
      allowed: true,
      visionAllowed: false,
      attachmentTextAllowed: true,
      fetchBudgetMs: 1_000,
    });
    const bytes = new TextEncoder().encode("external attachment");
    vi.mocked(fetchAttachmentBytes).mockResolvedValue({
      bytes,
      mime: "text/plain",
      finalUrl: "https://cdn.example.test/file.txt",
      contentHash: createHash("sha256").update(bytes).digest("hex"),
    });
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const result = await runPerceptionTurn(db, {
      ownerId: "owner-1",
      message: "read this",
      attachments: [{
        discordAttachmentId: "attachment-1",
        declaredMime: "text/plain",
        fileName: "file.txt",
        declaredByteSize: bytes.byteLength,
        sourceUrl: "https://cdn.example.test/file.txt",
      }],
      sourceMessageEntityUuid: "message-1",
      deliveryReservationEntityUuid: "reservation-1",
      deliveryReservationId: 1,
      deadlineAtMs: Date.now() + 10_000,
      decision: {} as never,
      audience: { kind: "dm", principalId: "person-1" },
    });

    expect(result.thoughtParts[0]?.audienceScope).toEqual({ kind: "dm", principalId: "person-1" });
    db.close();
  });

  it("defaults external capability reality to no Owner/project authority", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const reality = getCapabilityReality(db, {
      audience: { kind: "room", roomId: "room:guild-1:channel-1" },
      licenses: [],
    });

    expect(reality.approvedProjectIds).toEqual([]);
    expect(reality.canOfferProjectInspection).toBe(false);
    expect(reality.canOfferWorkspace).toBe(false);
    expect(reality.canOfferVerification).toBe(false);
    expect(reality.canOfferAuthorship).toBe(false);
    expect(reality.operationCapabilities?.every((capability) => capability.available === false)).toBe(true);
    db.close();
  });
});
