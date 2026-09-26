import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { createPendingArtifacts, transitionArtifactStatus } from "../../perception/ingest.js";
import { storeArtifactBytes, readArtifactBytes } from "../../perception/artifact-store.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { persistOrVerifyObservation } from "../observation/persistence.js";
import { projectFileArtifactIdentity, textArtifactRepresentationId } from "../observation/view.js";
import type { ObservationRequest } from "../types.js";
import { parseThoughtSemanticOutput } from "../thought/parse.js";
import { isValidEvidenceOperationRequest } from "../thought/typed-inspection.js";
import { executeEvidenceOperation } from "./evidence-operations.js";

const OWNER_ID = "owner-evidence";
const CYCLE_ID = "cycle-evidence";
let previousArtifactDir: string | undefined;

beforeEach(() => {
  previousArtifactDir = process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR;
  process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR = mkdtempSync(join(tmpdir(), "ashley-evidence-bytes-"));
});

afterEach(() => {
  if (previousArtifactDir === undefined) delete process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR;
  else process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR = previousArtifactDir;
});

function request(
  kind: string,
  value: Record<string, unknown>,
  audience: ObservationRequest["audience"] = { kind: "owner_private" },
): ObservationRequest {
  return {
    requestId: `request-${kind}`,
    cycleId: CYCLE_ID,
    generation: 1,
    kind,
    request: value,
    replaySafe: true,
    audience,
  };
}

function createRetainedArtifact(db: DatabaseSync, bytes: Uint8Array): string {
  const [created] = createPendingArtifacts(db, {
    ownerId: OWNER_ID,
    attachments: [{
      discordAttachmentId: `attachment-${bytes.byteLength}`,
      sourceUrl: "https://cdn.example.test/evidence.txt",
      fileName: "evidence.txt",
      declaredMime: "text/plain",
      declaredByteSize: bytes.byteLength,
    }],
    sourceMessageEntityUuid: "message-evidence",
    deliveryReservationEntityUuid: `reservation-${bytes.byteLength}`,
    aggregateTurnBytes: bytes.byteLength,
  });
  if (!created) throw new Error("test_artifact_missing");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  transitionArtifactStatus(db, created.entityUuid, OWNER_ID, "fetched", {
    mimeDetected: "text/plain",
    contentHash,
    byteSize: bytes.byteLength,
  });
  storeArtifactBytes(db, OWNER_ID, created.entityUuid, bytes, "text/plain");
  return created.entityUuid;
}

function createRetainedStructuredArtifact(
  db: DatabaseSync,
  fileName: string,
  mime: string,
  text: string,
): string {
  const bytes = new TextEncoder().encode(text);
  const [created] = createPendingArtifacts(db, {
    ownerId: OWNER_ID,
    attachments: [{
      discordAttachmentId: `attachment-${fileName}`,
      sourceUrl: `https://cdn.example.test/${fileName}`,
      fileName,
      declaredMime: mime,
      declaredByteSize: bytes.byteLength,
    }],
    sourceMessageEntityUuid: `message-${fileName}`,
    deliveryReservationEntityUuid: `reservation-${fileName}`,
    aggregateTurnBytes: bytes.byteLength,
  });
  if (!created) throw new Error("test_structured_artifact_missing");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  transitionArtifactStatus(db, created.entityUuid, OWNER_ID, "fetched", {
    mimeDetected: mime,
    contentHash,
    byteSize: bytes.byteLength,
  });
  storeArtifactBytes(db, OWNER_ID, created.entityUuid, bytes, mime);
  return created.entityUuid;
}

function semantic(operationKind: string, value: Record<string, unknown>) {
  return {
    kind: "observation_intent",
    operationKind,
    request: value,
    purpose: "read retained evidence",
    evidenceNeed: "the requested text window",
    existingRefs: [],
  };
}

describe("CAM-W3-P1 evidence operations", () => {
  it("reads two character windows and binds continuation to the retained artifact", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const artifactId = createRetainedArtifact(nuclear, new TextEncoder().encode("0123456789abcdefghij"));
    const representationId = textArtifactRepresentationId(artifactId);
    const selector = { kind: "text_window", offsetChars: 0, limitChars: 10 };

    const first = await executeEvidenceOperation({
      req: request("evidence.read", { artifactId, representationId, selector }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 100,
    });
    expect(first.payload).toMatchObject({
      artifactId,
      representationId,
      text: "0123456789",
      offsetChars: 0,
      totalChars: 20,
      nextCursor: expect.objectContaining({
        schema: "ashley.artifact_cursor.v1",
        artifactId,
        representationId,
        selector,
        continuation: { offsetChars: 10 },
      }),
    });
    expect(first.view).toMatchObject({
      parentArtifactId: artifactId,
      representationId,
      requestedSelector: selector,
      returnedSelector: { kind: "text_window", offsetChars: 0, limitChars: 10 },
      completeness: "complete",
      omission: null,
      continuation: expect.objectContaining({
        schema: "ashley.artifact_cursor.v1",
        continuation: { offsetChars: 10 },
      }),
      contentHashBasis: "retained_bytes",
      inputTrust: "untrusted_evidence",
    });

    const cursor = (first.payload as { nextCursor: unknown }).nextCursor;
    const second = await executeEvidenceOperation({
      req: request("evidence.read", { artifactId, representationId, selector, cursor }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 101,
    });
    expect(second.payload).toMatchObject({ text: "abcdefghij", offsetChars: 10, nextCursor: null });
    nuclear.close();
  });

  it("stops a cursor when the retained artifact hash changes", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const artifactId = createRetainedArtifact(nuclear, new TextEncoder().encode("0123456789abcdefghij"));
    const representationId = textArtifactRepresentationId(artifactId);
    const selector = { kind: "text_window", offsetChars: 0, limitChars: 10 };
    const first = await executeEvidenceOperation({
      req: request("evidence.read", { artifactId, representationId, selector }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 100,
    });
    const cursor = (first.payload as { nextCursor: unknown }).nextCursor;
    nuclear.prepare("UPDATE perception_artifacts SET content_hash = ? WHERE entity_uuid = ?")
      .run("b".repeat(64), artifactId);

    await expect(executeEvidenceOperation({
      req: request("evidence.read", { artifactId, representationId, selector, cursor }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 101,
    })).rejects.toMatchObject({ reasonCode: "artifact_version_mismatch" });
    nuclear.close();
  });

  it("binds audience and rejects an audience-swapped cursor", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const artifactId = createRetainedArtifact(nuclear, new TextEncoder().encode("0123456789abcdefghij"));
    const representationId = textArtifactRepresentationId(artifactId);
    const selector = { kind: "text_window", offsetChars: 0, limitChars: 10 };
    const first = await executeEvidenceOperation({
      req: request("evidence.read", { artifactId, representationId, selector }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 100,
    });
    const cursor = (first.payload as { nextCursor: unknown }).nextCursor;

    await expect(executeEvidenceOperation({
      req: request(
        "evidence.read",
        { artifactId, representationId, selector, cursor },
        { kind: "owner_dm", threadId: "owner-thread" },
      ),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 101,
    })).rejects.toMatchObject({ reasonCode: "cursor_binding_mismatch" });
    nuclear.close();
  });

  it("rejects a bare offset and exposes both evidence operations to semantic parsing", () => {
    const valid = {
      artifactId: "artifact-1",
      representationId: "representation-1",
      selector: { kind: "text_window", offsetChars: 0, limitChars: 10 },
    };
    expect(isValidEvidenceOperationRequest("evidence.read", valid)).toBe(true);
    expect(isValidEvidenceOperationRequest("evidence.read", {
      artifactId: "artifact-1",
      representationId: "representation-1",
      selector: { offset: 0, limitChars: 10 },
    })).toBe(false);
    expect(isValidEvidenceOperationRequest("evidence.read", {
      artifactId: "artifact-1",
      representationId: "representation-1",
      selector: { kind: "text_window", offsetChars: 0, limitChars: 10 },
      purpose: "the important part",
    })).toBe(false);
    expect(parseThoughtSemanticOutput(semantic("evidence.read", valid), new Set())).toMatchObject({ ok: true });
    expect(parseThoughtSemanticOutput(semantic("evidence.refresh", {
      artifactId: "artifact-1",
      representationId: "representation-1",
      sourceUrl: "https://cdn.example.test/evidence.txt",
    }), new Set())).toMatchObject({ ok: true });
  });

  it("reads bounded JSON paths and CSV ranges from one retained parse", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const jsonArtifactId = createRetainedStructuredArtifact(
      nuclear,
      "profile.json",
      "application/json",
      '{"profile":{"name":"Ashley","count":2}}',
    );
    const jsonRepresentationId = textArtifactRepresentationId(jsonArtifactId);
    const jsonSelector = { kind: "json_path", path: "/profile/name", maxItems: 4, maxChars: 100 } as const;
    const json = await executeEvidenceOperation({
      req: request("evidence.read", {
        artifactId: jsonArtifactId,
        representationId: jsonRepresentationId,
        selector: jsonSelector,
      }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 100,
    });
    expect(json.payload).toMatchObject({ format: "json", value: "Ashley", selector: jsonSelector });
    expect(json.view).toMatchObject({
      derivation: "artifact_read",
      requestedSelector: jsonSelector,
      returnedSelector: jsonSelector,
      inputTrust: "untrusted_evidence",
    });

    const csvArtifactId = createRetainedStructuredArtifact(
      nuclear,
      "people.csv",
      "text/csv",
      "name,count\nAshley,2\nAlex,1\n",
    );
    const csvRepresentationId = textArtifactRepresentationId(csvArtifactId);
    const csvSelector = { kind: "csv_range", startRow: 1, endRow: 3, startColumn: 0, endColumn: 2 } as const;
    const csv = await executeEvidenceOperation({
      req: request("evidence.read", {
        artifactId: csvArtifactId,
        representationId: csvRepresentationId,
        selector: csvSelector,
      }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 101,
    });
    expect(csv.payload).toMatchObject({
      format: "csv",
      rows: [["Ashley", "2"], ["Alex", "1"]],
      selector: csvSelector,
    });
    nuclear.close();
  });

  it("records an unchanged refresh and preserves the old artifact across a changed refresh", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const original = new TextEncoder().encode("original bytes");
    const artifactId = createRetainedArtifact(nuclear, original);
    const representationId = textArtifactRepresentationId(artifactId);
    const sourceUrl = "https://cdn.example.test/evidence.txt";
    const unchanged = await executeEvidenceOperation({
      req: request("evidence.refresh", { artifactId, representationId, sourceUrl }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 100,
      refresh: async () => ({
        bytes: original,
        mime: "text/plain",
        finalUrl: sourceUrl,
        contentHash: createHash("sha256").update(original).digest("hex"),
      }),
    });
    expect(unchanged.payload).toMatchObject({ unchanged: true, validator: "sha256", artifactId, representationId });

    const replacement = new TextEncoder().encode("replacement bytes");
    const changed = await executeEvidenceOperation({
      req: request("evidence.refresh", { artifactId, representationId, sourceUrl }),
      nuclear,
      ownerId: OWNER_ID,
      nowMs: () => 101,
      refresh: async () => ({
        bytes: replacement,
        mime: "text/plain",
        finalUrl: sourceUrl,
        contentHash: createHash("sha256").update(replacement).digest("hex"),
      }),
    });
    const changedPayload = changed.payload as { unchanged: boolean; artifactId: string; representationId: string };
    expect(changedPayload).toMatchObject({ unchanged: false, representationId: expect.stringMatching(/^representation:v1:/) });
    expect(changedPayload.artifactId).not.toBe(artifactId);
    expect(readArtifactBytes(nuclear, artifactId, OWNER_ID)).toEqual(original);
    expect(readArtifactBytes(nuclear, changedPayload.artifactId, OWNER_ID)).toEqual(replacement);
    nuclear.close();
  });

  it("reads a retained project text view without copying it into the byte store", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openTestSidecar();
    admitTestCycle(sidecar, {
      cycleId: CYCLE_ID,
      conversationId: "conversation-evidence",
      triggerKind: "owner_message",
      triggerRef: "evidence-project",
      occupantId: OWNER_ID,
      authorityEpoch: 1,
      nowMs: 1,
    });
    const identity = projectFileArtifactIdentity({
      projectId: "project-ashley",
      path: "large.txt",
      rawByteHash: "a".repeat(64),
      capturedAtMs: 2,
    });
    persistOrVerifyObservation(sidecar, {
      observationId: "observation-project-text",
      cycleId: CYCLE_ID,
      generation: 1,
      derived: false,
      replaySafe: true,
      modality: "tool",
      payload: {
        projectId: "project-ashley",
        operation: "project.read_file",
        path: "large.txt",
        verified: true,
        truncated: false,
        executedAtMs: 2,
        contentUtf8: "project retained text",
        bytes: 21,
        sha256: "a".repeat(64),
      },
      provenance: "sandbox-v2:project-inspection",
      dataClassification: "never_public",
      secretOmitted: false,
      view: {
        ...identity,
        requestedSelector: { kind: "whole_file" },
        returnedSelector: { kind: "whole_file" },
        completeness: "complete",
        omission: null,
        continuation: null,
        errors: [],
        contentHashBasis: "raw_bytes",
      },
    }, 2);
    const result = await executeEvidenceOperation({
      req: request("evidence.read", {
        artifactId: identity.parentArtifactId,
        representationId: identity.representationId,
        selector: { kind: "text_window", offsetChars: 0, limitChars: 7 },
      }),
      nuclear,
      sidecar,
      ownerId: OWNER_ID,
      nowMs: () => 3,
    });
    expect(result.payload).toMatchObject({ text: "project", totalChars: 21 });
    sidecar.close();
    nuclear.close();
  });
});
