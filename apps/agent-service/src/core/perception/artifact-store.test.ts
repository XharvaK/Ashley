import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../db.js";
import { fetchAttachmentBytes } from "./fetch.js";
import {
  readArtifactBytes,
  readArtifactTextPage,
  storeArtifactBytes,
  sweepExpiredArtifacts,
} from "./artifact-store.js";
import { createPendingArtifacts } from "./ingest.js";

vi.mock("./fetch.js", () => ({
  fetchAttachmentBytes: vi.fn(),
}));


let artifactDir = "";
let previousArtifactDir: string | undefined;

function openDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function createArtifact(
  db: DatabaseSync,
  ownerId: string,
  attachmentId: string,
): string {
  const [artifact] = createPendingArtifacts(db, {
    ownerId,
    attachments: [{
      discordAttachmentId: attachmentId,
      sourceUrl: `https://cdn.example.test/${attachmentId}.txt`,
      fileName: `${attachmentId}.txt`,
      declaredMime: "text/plain",
      declaredByteSize: 0,
    }],
    sourceMessageEntityUuid: `message-${attachmentId}`,
    deliveryReservationEntityUuid: `reservation-${attachmentId}`,
    aggregateTurnBytes: 0,
  });
  if (!artifact) throw new Error("test_artifact_missing");
  return artifact.entityUuid;
}

function bindFetchedArtifact(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  bytes: Uint8Array,
  mime = "text/plain",
): void {
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  db.prepare(
    `UPDATE perception_artifacts
        SET status = 'fetched', mime_detected = ?, content_hash = ?, byte_size = ?
      WHERE entity_uuid = ? AND owner_id = ?`,
  ).run(mime, contentHash, bytes.byteLength, entityUuid, ownerId);
}

beforeEach(() => {
  artifactDir = mkdtempSync(join(tmpdir(), "ashley-artifact-bytes-"));
  previousArtifactDir = process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR;
  process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR = artifactDir;
});

afterEach(() => {
  if (previousArtifactDir === undefined) delete process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR;
  else process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR = previousArtifactDir;
});

describe("perception artifact byte store", () => {
  it("round-trips verified bytes and marks the row preserved", () => {
    const db = openDb();
    const bytes = new TextEncoder().encode("same artifact bytes");
    const entityUuid = createArtifact(db, "owner-a", "attachment-a");
    bindFetchedArtifact(db, "owner-a", entityUuid, bytes);

    const proof = storeArtifactBytes(db, "owner-a", entityUuid, bytes, "text/plain");

    expect(proof).toEqual({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
      storedAtMs: expect.any(Number),
    });
    expect(readArtifactBytes(db, entityUuid, "owner-a")).toEqual(bytes);
    expect(db.prepare(
      "SELECT preserved, integrity_proof_json FROM perception_artifacts WHERE entity_uuid = ?",
    ).get(entityUuid)).toMatchObject({ preserved: 1 });
    db.close();
  });

  it("rejects a fetched content-hash mismatch without preserving the row", () => {
    const db = openDb();
    const bytes = new TextEncoder().encode("actual bytes");
    const entityUuid = createArtifact(db, "owner-a", "attachment-mismatch");
    bindFetchedArtifact(db, "owner-a", entityUuid, new TextEncoder().encode("expected bytes"));

    expect(() => storeArtifactBytes(db, "owner-a", entityUuid, bytes, "text/plain"))
      .toThrow("artifact_integrity_mismatch");
    expect(db.prepare(
      "SELECT preserved, integrity_proof_json FROM perception_artifacts WHERE entity_uuid = ?",
    ).get(entityUuid)).toEqual({ preserved: 0, integrity_proof_json: null });
    db.close();
  });

  it("fails closed when the shared byte file is corrupted", () => {
    const db = openDb();
    const bytes = new TextEncoder().encode("integrity matters");
    const entityUuid = createArtifact(db, "owner-a", "attachment-corrupt");
    bindFetchedArtifact(db, "owner-a", entityUuid, bytes);
    const proof = storeArtifactBytes(db, "owner-a", entityUuid, bytes, "text/plain");
    writeFileSync(join(artifactDir, proof.sha256), "corrupted");

    expect(() => readArtifactBytes(db, entityUuid, "owner-a")).toThrow("artifact_corrupt");
    db.close();
  });

  it("keeps separate provenance rows while sharing one byte file across owners", () => {
    const db = openDb();
    const bytes = new TextEncoder().encode("byte-identical but separately attributed");
    const first = createArtifact(db, "owner-a", "attachment-shared-a");
    const second = createArtifact(db, "owner-b", "attachment-shared-b");
    bindFetchedArtifact(db, "owner-a", first, bytes);
    bindFetchedArtifact(db, "owner-b", second, bytes);

    const firstProof = storeArtifactBytes(db, "owner-a", first, bytes, "text/plain");
    const secondProof = storeArtifactBytes(db, "owner-b", second, bytes, "text/plain");

    expect(secondProof.sha256).toBe(firstProof.sha256);
    expect(readdirSync(artifactDir).filter((name) => /^[a-f0-9]{64}$/.test(name))).toEqual([firstProof.sha256]);
    const provenance = db.prepare(
      "SELECT entity_uuid, provenance_json FROM perception_artifacts WHERE entity_uuid IN (?, ?) ORDER BY entity_uuid",
    ).all(first, second) as Array<{ entity_uuid: string; provenance_json: string | null }>;
    expect(provenance).toHaveLength(2);
    expect(provenance[0]?.provenance_json).not.toBe(provenance[1]?.provenance_json);
    expect(readArtifactBytes(db, first, "owner-a")).toEqual(bytes);
    expect(readArtifactBytes(db, second, "owner-b")).toEqual(bytes);
    db.close();
  });

  it("pages text from the preserved artifact and retains one content identity", () => {
    const db = openDb();
    const text = "0123456789abcdefghij";
    const bytes = new TextEncoder().encode(text);
    const entityUuid = createArtifact(db, "owner-a", "attachment-page");
    bindFetchedArtifact(db, "owner-a", entityUuid, bytes);
    const proof = storeArtifactBytes(db, "owner-a", entityUuid, bytes, "text/plain");

    const first = readArtifactTextPage(db, entityUuid, 0, 10, "owner-a");
    const second = readArtifactTextPage(db, entityUuid, 10, 10, "owner-a");

    expect(first.text + second.text).toBe(text);
    expect(first.contentHash).toBe(proof.sha256);
    expect(second.contentHash).toBe(proof.sha256);
    db.close();
  });

  it("cleans expired byte rows through a bounded perception-owned sweep", () => {
    const db = openDb();
    const bytes = new TextEncoder().encode("retained until due");
    const entityUuid = createArtifact(db, "owner-a", "attachment-expired");
    bindFetchedArtifact(db, "owner-a", entityUuid, bytes);
    const proof = storeArtifactBytes(db, "owner-a", entityUuid, bytes, "text/plain");
    db.prepare(
      "UPDATE perception_artifacts SET retention_until = ? WHERE entity_uuid = ?",
    ).run("2000-01-01T00:00:00.000Z", entityUuid);

    const result = sweepExpiredArtifacts(db, { nowMs: Date.parse("2026-09-15T00:00:00.000Z"), limit: 1 });

    expect(result).toEqual({ rowsVisited: 1, rowsExpired: 1, filesRemoved: 1 });
    expect(db.prepare(
      "SELECT status, preserved, integrity_proof_json FROM perception_artifacts WHERE entity_uuid = ?",
    ).get(entityUuid)).toEqual({ status: "expired", preserved: 0, integrity_proof_json: null });
    expect(readdirSync(artifactDir)).not.toContain(proof.sha256);
    db.close();
  });

});
