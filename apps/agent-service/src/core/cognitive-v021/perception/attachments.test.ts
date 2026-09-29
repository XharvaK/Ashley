import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import { MAX_AGGREGATE_ATTACHMENT_BYTES, MAX_SINGLE_ATTACHMENT_BYTES } from "../../perception/types.js";
import { readArtifactBytes } from "../../perception/artifact-store.js";
import { persistOrVerifyObservation } from "../observation/persistence.js";
import { openTestSidecar } from "../test-support.js";
import { resolveAttachmentObservations } from "./attachments.js";
import { isValidEvidenceOperationRequest } from "../thought/typed-inspection.js";

const ownerId = "owner-attachment-test";

function attachment(name: string, mime: string, id = name, size?: number) {
  return {
    discordAttachmentId: id,
    declaredMime: mime,
    fileName: name,
    ...(size === undefined ? {} : { declaredByteSize: size }),
    sourceUrl: `https://cdn.example.test/${name}`,
  };
}

function fetchResult(bytes: string | Uint8Array, mime: string, finalUrl = "https://cdn.example.test/final"): {
  bytes: Uint8Array;
  mime: string;
  finalUrl: string;
  contentHash: string;
} {
  const body = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return {
    bytes: body,
    mime,
    finalUrl,
    contentHash: createHash("sha256").update(body).digest("hex"),
  };
}

function png(width = 3, height = 2): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

describe("owner attachment observation intake", () => {
  let artifactDir = "";
  let previousArtifactDir: string | undefined;

  beforeEach(() => {
    artifactDir = mkdtempSync(join(tmpdir(), "ashley-attachment-observation-"));
    previousArtifactDir = process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR;
    process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR = artifactDir;
  });

  afterEach(() => {
    if (previousArtifactDir === undefined) delete process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR;
    else process.env.ASHLEY_ARTIFACT_BYTE_STORE_DIR = previousArtifactDir;
  });

  it("turns an owner text attachment into a retained untrusted observation", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const fetchAttachment = vi.fn(async () => fetchResult("owner supplied notes", "text/plain"));

    const observations = await resolveAttachmentObservations({
      nuclear,
      ownerId,
      cycleId: "cycle-attachment-text",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-1",
      deliveryReservationEntityUuid: "owner-event-1",
      attachmentTextEnabled: true,
      attachments: [attachment("notes.txt", "text/plain")],
      fetchAttachment,
    });

    assert.equal(observations.length, 1);
    assert.equal(fetchAttachment.mock.calls.length, 1);
    const observation = observations[0]!;
    assert.equal(observation.modality, "text");
    assert.equal(observation.provenance, "perception:attachment");
    assert.equal(observation.view?.inputTrust, "untrusted_evidence");
    assert.equal(observation.view?.completeness, "complete");
    assert.equal((observation.payload as { contentUtf8: string }).contentUtf8, "owner supplied notes");
    assert.equal(observation.view?.parentArtifactId, (observation.payload as { artifactId: string }).artifactId);

    const artifactId = (observation.payload as { artifactId: string }).artifactId;
    assert.deepEqual(readArtifactBytes(nuclear, artifactId, ownerId), new TextEncoder().encode("owner supplied notes"));
    const row = nuclear.prepare(
      "SELECT status, preserved, source_message_entity_uuid, delivery_reservation_entity_uuid FROM perception_artifacts WHERE entity_uuid = ?",
    ).get(artifactId) as Record<string, unknown>;
    assert.equal(row.status, "fetched");
    assert.equal(row.preserved, 1);
    assert.equal(row.source_message_entity_uuid, "evidence-owner-1");
    assert.equal(row.delivery_reservation_entity_uuid, "owner-event-1");
    nuclear.close();
  });

  it("projects JSON and CSV with bounded structured selectors", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const fetchAttachment = vi.fn(async ({ url }: { url: string }) =>
      url.endsWith(".json")
        ? fetchResult('{"profile":{"name":"Ashley","count":2}}', "application/json")
        : fetchResult("name,count\nAshley,2\nAlex,1\n", "text/csv"));

    const observations = await resolveAttachmentObservations({
      nuclear,
      ownerId,
      cycleId: "cycle-attachment-structured",
      generation: 2,
      sourceMessageEntityUuid: "evidence-owner-2",
      deliveryReservationEntityUuid: "owner-event-2",
      attachmentTextEnabled: true,
      attachments: [
        attachment("data.json", "application/json"),
        attachment("data.csv", "text/csv"),
      ],
      fetchAttachment,
    });

    assert.equal(observations.length, 2);
    const json = observations.find((item) => (item.payload as { format?: string }).format === "json")!;
    assert.deepEqual(json.view?.requestedSelector, {
      kind: "json_path",
      path: "",
      maxItems: 64,
      maxChars: 8_000,
    });
    assert.equal((json.payload as { value: { profile: { name: string } } }).value.profile.name, "Ashley");

    const csv = observations.find((item) => (item.payload as { format?: string }).format === "csv")!;
    assert.deepEqual(csv.view?.requestedSelector, {
      kind: "csv_range",
      startRow: 0,
      endRow: 3,
      startColumn: 0,
      endColumn: 2,
    });
    assert.deepEqual((csv.payload as { rows: string[][] }).rows[1], ["Ashley", "2"]);
    nuclear.close();
  });

  it("emits explicit unsupported, unreadable, and capability errors", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const fetchAttachment = vi.fn(async () => {
      throw new Error("network_down");
    });

    const unsupported = await resolveAttachmentObservations({
      nuclear,
      ownerId,
      cycleId: "cycle-attachment-errors",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-3",
      deliveryReservationEntityUuid: "owner-event-3",
      attachmentTextEnabled: true,
      attachments: [attachment("notes.exe", "application/octet-stream")],
      fetchAttachment,
    });
    assert.equal((unsupported[0]!.payload as { error: { code: string; mediaType: string } }).error.code, "unsupported_media");
    assert.equal((unsupported[0]!.payload as { error: { mediaType: string } }).error.mediaType, "application/octet-stream");
    assert.equal(fetchAttachment.mock.calls.length, 0);

    const unreadable = await resolveAttachmentObservations({
      nuclear,
      ownerId,
      cycleId: "cycle-attachment-unreadable",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-4",
      deliveryReservationEntityUuid: "owner-event-4",
      attachmentTextEnabled: true,
      attachments: [attachment("notes.txt", "text/plain")],
      fetchAttachment,
    });
    assert.equal((unreadable[0]!.payload as { error: { code: string } }).error.code, "attachment_unreadable");

    const unavailable = await resolveAttachmentObservations({
      nuclear,
      ownerId,
      cycleId: "cycle-attachment-disabled",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-5",
      deliveryReservationEntityUuid: "owner-event-5",
      attachmentTextEnabled: false,
      attachments: [attachment("notes.txt", "text/plain")],
      fetchAttachment,
    });
    assert.equal((unavailable[0]!.payload as { error: { code: string } }).error.code, "capability_not_in_live_set");
    nuclear.close();
  });

  it("rejects size limits without fetching", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const fetchAttachment = vi.fn(async () => fetchResult("should not fetch", "text/plain"));
    const observations = await resolveAttachmentObservations({
      nuclear,
      ownerId,
      cycleId: "cycle-attachment-limits",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-6",
      deliveryReservationEntityUuid: "owner-event-6",
      attachmentTextEnabled: true,
      attachments: [
        attachment("large.txt", "text/plain", "large", MAX_SINGLE_ATTACHMENT_BYTES + 1),
        attachment("a.txt", "text/plain", "a", MAX_AGGREGATE_ATTACHMENT_BYTES),
        attachment("b.txt", "text/plain", "b", 1),
      ],
      fetchAttachment,
    });
    assert.equal(observations.length, 3);
    assert.equal(fetchAttachment.mock.calls.length, 0);
    assert.ok(observations.every((item) => (item.payload as { error?: unknown }).error));
    nuclear.close();
  });

  it("reuses a stored mediated visual observation on retry without a second vision request", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openTestSidecar();
    const bytes = png();
    const firstFetch = vi.fn(async () => fetchResult(bytes, "image/png"));
    const firstDescribe = vi.fn(async () => "first bounded caption");
    const input = {
      nuclear,
      observationDb: sidecar,
      ownerId,
      cycleId: "cycle-attachment-visual-retry",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-8",
      deliveryReservationEntityUuid: "owner-event-8",
      attachmentTextEnabled: false,
      visionAccess: "mediated" as const,
      attachments: [attachment("scene.png", "image/png", "scene")],
    };

    const first = await resolveAttachmentObservations({
      ...input,
      imageTransport: { kind: "mediated_visual", helperModelId: "test-helper", describeImage: firstDescribe },
      fetchAttachment: firstFetch,
    });
    persistOrVerifyObservation(sidecar, first[0]!, 100);

    const secondFetch = vi.fn(async () => fetchResult(bytes, "image/png"));
    const secondDescribe = vi.fn(async () => "different bounded caption");
    const second = await resolveAttachmentObservations({
      ...input,
      imageTransport: { kind: "mediated_visual", helperModelId: "test-helper", describeImage: secondDescribe },
      fetchAttachment: secondFetch,
    });

    expect(second).toEqual(first);
    expect(secondFetch).not.toHaveBeenCalled();
    expect(secondDescribe).not.toHaveBeenCalled();
    sidecar.close();
    nuclear.close();
  });

  it("gives Thought the image itself and writes a concise recall record in the background", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openTestSidecar();
    const bytes = png();
    let releaseRecord: (value: string) => void = () => {};
    const describeForRecord = vi.fn(() => new Promise<string>((resolve) => { releaseRecord = resolve; }));
    const input = {
      nuclear,
      observationDb: sidecar,
      ownerId,
      cycleId: "cycle-attachment-direct",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-direct",
      deliveryReservationEntityUuid: "owner-event-direct",
      attachmentTextEnabled: false,
      visionAccess: true as const,
      attachments: [attachment("shot.png", "image/png", "shot")],
    };

    const first = await resolveAttachmentObservations({
      ...input,
      imageTransport: { kind: "direct_visual", recordModelId: "test-helper", describeForRecord },
      fetchAttachment: vi.fn(async () => fetchResult(bytes, "image/png")),
    });

    // The turn does not wait for the record.
    const observation = first[0]!;
    const payload = observation.payload as Record<string, unknown>;
    expect(observation.view?.access).toBe("direct_visual");
    expect(payload.imageDataUri).toMatch(/^data:image\/png;base64,/);
    expect(Object.keys(payload)).not.toContain("imageDataUri");
    expect(payload).not.toHaveProperty("description");
    expect(describeForRecord).toHaveBeenCalledTimes(1);
    const artifactId = payload.artifactId as string;
    const excerptOf = () => (nuclear.prepare("SELECT excerpt FROM perception_artifacts WHERE entity_uuid = ?")
      .get(artifactId) as { excerpt: string | null }).excerpt;
    expect(excerptOf()).toBeNull();

    releaseRecord("Sims 4 CAS quiz: \"I get asked out on a date\" [Go out] [Ask who else] [Politely decline]");
    await vi.waitFor(() => expect(excerptOf()).toContain("asked out on a date"));

    // A replay in the same cycle (supersession/retry) sees the same pixels
    // again from the retained artifact, without refetching or re-describing.
    persistOrVerifyObservation(sidecar, observation, 100);
    const refetch = vi.fn(async () => fetchResult(bytes, "image/png"));
    const replay = await resolveAttachmentObservations({
      ...input,
      imageTransport: { kind: "direct_visual", recordModelId: "test-helper", describeForRecord },
      fetchAttachment: refetch,
    });
    expect((replay[0]!.payload as Record<string, unknown>).imageDataUri).toBe(payload.imageDataUri);
    expect(refetch).not.toHaveBeenCalled();
    expect(describeForRecord).toHaveBeenCalledTimes(1);
    sidecar.close();
    nuclear.close();
  });

  it("never revives a forgotten artifact when the background record lands late", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    let releaseRecord: (value: string) => void = () => {};
    const observations = await resolveAttachmentObservations({
      nuclear,
      ownerId,
      cycleId: "cycle-attachment-direct-forget",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-forget",
      deliveryReservationEntityUuid: "owner-event-forget",
      attachmentTextEnabled: false,
      visionAccess: true,
      attachments: [attachment("secret.png", "image/png", "secret")],
      imageTransport: {
        kind: "direct_visual",
        describeForRecord: () => new Promise<string>((resolve) => { releaseRecord = resolve; }),
      },
      fetchAttachment: vi.fn(async () => fetchResult(png(), "image/png")),
    });
    const artifactId = (observations[0]!.payload as { artifactId: string }).artifactId;
    nuclear.prepare("UPDATE perception_artifacts SET status = 'redacted', excerpt = NULL WHERE entity_uuid = ?").run(artifactId);
    releaseRecord("the forgotten picture");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const row = nuclear.prepare("SELECT excerpt FROM perception_artifacts WHERE entity_uuid = ?").get(artifactId) as { excerpt: string | null };
    expect(row.excerpt).toBeNull();
    nuclear.close();
  });

  it("accepts structured evidence selectors and rejects unbounded selectors", () => {
    assert.equal(isValidEvidenceOperationRequest("evidence.read", {
      artifactId: "artifact-1",
      representationId: "representation-1",
      selector: { kind: "json_path", path: "/profile", maxItems: 32, maxChars: 1_000 },
    }), true);
    assert.equal(isValidEvidenceOperationRequest("evidence.read", {
      artifactId: "artifact-1",
      representationId: "representation-1",
      selector: { kind: "csv_range", startRow: 0, endRow: 10, startColumn: 0, endColumn: 4 },
    }), true);
    assert.equal(isValidEvidenceOperationRequest("evidence.read", {
      artifactId: "artifact-1",
      representationId: "representation-1",
      selector: { kind: "json_path", path: "/profile", maxItems: 0, maxChars: 1_000 },
    }), false);
  });

  it("turns malformed attachment refs into an explicit observation error", async () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const observations = await resolveAttachmentObservations({
      nuclear,
      ownerId,
      cycleId: "cycle-attachment-invalid",
      generation: 1,
      sourceMessageEntityUuid: "evidence-owner-7",
      deliveryReservationEntityUuid: "owner-event-7",
      attachmentTextEnabled: true,
      attachments: [{ fileName: "missing-url.txt" }],
      fetchAttachment: vi.fn(),
    });
    assert.equal((observations[0]!.payload as { error: { code: string } }).error.code, "attachment_ref_invalid");
    nuclear.close();
  });
});
