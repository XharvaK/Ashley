import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { fieldDayWindow } from "./field-day.js";
import { extractEvidence, extractIdentity } from "./evidence.js";
import {
  createContinuityFixture,
  createNuclearFixture,
  removeTemp,
  tempDir,
} from "../../../test/observer-support.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) removeTemp(path);
});

function fixtures(): { nuclear: DatabaseSync; continuity: DatabaseSync; dir: string } {
  const dir = tempDir("observer-identity-");
  temporaryPaths.push(dir);
  const nuclearPath = `${dir}/nuclear.db`;
  const continuityPath = `${dir}/continuity.db`;
  const nuclearWriter = createNuclearFixture(nuclearPath);
  nuclearWriter.prepare("INSERT INTO capability_contracts VALUES (?, ?, ?, ?, ?)").run(
    "contract-v3",
    "3",
    "hash",
    "2026-08-01T00:00:00.000Z",
    1,
  );
  nuclearWriter.prepare("INSERT INTO capability_releases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "recall",
    "recall-release",
    "active",
    3,
    "2026-08-02T00:00:00.000Z",
    "2026-08-03T00:00:00.000Z",
    null,
    null,
    null,
    "2026-08-03T00:00:00.000Z",
    "contract-v3",
    "build-123",
    2,
  );
  nuclearWriter.prepare("INSERT INTO capability_releases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "memory_evidence",
    "c1-release",
    "observe",
    3,
    "2026-08-02T00:00:00.000Z",
    null,
    null,
    null,
    null,
    "2026-08-03T00:00:00.000Z",
    "contract-v3",
    "build-123",
    0,
  );
  nuclearWriter.prepare("INSERT INTO memory_contract_state VALUES (?, ?, ?, ?, ?, ?)").run(
    1,
    1,
    "mem_facts",
    null,
    0,
    4,
  );
  nuclearWriter.prepare("INSERT INTO memory_evidence_qualification_epochs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "c1-epoch",
    "current",
    "start-1",
    null,
    "owner-1",
    "contract-v3",
    "build-123",
    "owner",
    "2026-08-04T00:00:00.000Z",
    null,
    3,
    null,
    null,
    null,
    null,
    null,
    null,
  );
  nuclearWriter.prepare("INSERT INTO recall_qualification_epochs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "recall-epoch",
    "current",
    "start-r",
    null,
    "contract-v3",
    "build-123",
    "owner",
    "2026-08-04T00:00:00.000Z",
    null,
    3,
    "2026-08-05T00:00:00.000Z",
    2,
  );
  nuclearWriter.prepare("INSERT INTO recall_live_cutovers VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "owner-1",
    "recall",
    "recall-release",
    409,
    "owner",
    "contract-v3",
    "build-123",
    "2026-08-06T00:00:00.000Z",
  );
  nuclearWriter.prepare("INSERT INTO capability_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    1,
    "recall",
    "recall-release",
    "live_shadow",
    "source-1",
    "{\"must_not_export\":\"provider body\"}",
    "2026-08-26T01:00:00.000Z",
    "contract-v3",
    "build-123",
    2,
  );
  nuclearWriter.close();

  const continuityWriter = createContinuityFixture(continuityPath);
  continuityWriter.prepare("INSERT INTO lineage_state VALUES (?, ?, ?, ?, ?)").run(
    1,
    "lineage-1",
    41,
    "build-123",
    "2026-08-26T00:00:00.000Z",
  );
  continuityWriter.close();
  return {
    nuclear: new DatabaseSync(nuclearPath, { readOnly: true }),
    continuity: new DatabaseSync(continuityPath, { readOnly: true }),
    dir,
  };
}

describe("source-bound identity and evidence", () => {
  it("extracts identity from snapshots without promoting checkout to runtime source", () => {
    const { nuclear, continuity } = fixtures();
    const result = extractIdentity({
      nuclear,
      continuity,
      checkoutSha: "checkout-sha",
      fieldDay: "2026-08-26",
    });
    nuclear.close();
    continuity.close();

    expect(result.identity).toMatchObject({
      checkoutSha: "checkout-sha",
      runtimeBuildIdentity: "build-123",
      buildIdentity: "build-123",
      runtimeSourceSha: "UNKNOWN",
      contractId: "contract-v3",
      nuclearSchemaVersion: 41,
      continuitySchemaVersion: 1,
      lineageId: "lineage-1",
      memoryEvidenceState: "observe",
      recallState: "active",
      currentnessAuthority: "mem_facts",
      c1ContractVersion: 1,
      cutoverAt: null,
      c1EpochId: "c1-epoch",
      recallEpochId: "recall-epoch",
      recallCutoffPresent: true,
      recallCutoffMessageId: 409,
      cognitionMode: "UNKNOWN",
      fieldDay: "2026-08-26",
    });
  });

  it("projects allowlisted lifecycle evidence and excludes detail JSON", () => {
    const { nuclear, continuity } = fixtures();
    const result = extractEvidence({
      nuclear,
      continuity,
      window: fieldDayWindow("2026-08-26"),
    });
    nuclear.close();
    continuity.close();
    const serialized = JSON.stringify(result);
    expect(result.evidence.capability_events).toHaveLength(1);
    expect(serialized).not.toContain("provider body");
    expect(serialized).not.toContain("detail_json");
    expect(result.evidence.capability_releases).toHaveLength(2);
    expect(result.evidence.recall_live_cutovers[0]?.cutoff_message_id).toBe(409);
  });

  it("records an absent C1 surface as UNKNOWN instead of borrowing Recall", () => {
    const dir = tempDir("observer-identity-absent-");
    temporaryPaths.push(dir);
    const nuclearPath = `${dir}/nuclear.db`;
    const continuityPath = `${dir}/continuity.db`;
    const writer = createNuclearFixture(nuclearPath);
    writer.exec("DROP TABLE memory_evidence_qualification_epochs; DROP TABLE memory_evidence_qualification_events;");
    writer.close();
    const continuityWriter = createContinuityFixture(continuityPath);
    continuityWriter.close();
    const nuclear = new DatabaseSync(nuclearPath, { readOnly: true });
    const continuity = new DatabaseSync(continuityPath, { readOnly: true });
    const result = extractIdentity({
      nuclear,
      continuity,
      checkoutSha: "checkout-sha",
      fieldDay: "2026-08-26",
    });
    nuclear.close();
    continuity.close();
    expect(result.identity.c1EpochId).toBe("UNKNOWN");
    expect(result.surfaces.tables.memory_evidence_qualification_epochs).toBe(
      "schema_surface_absent",
    );
  });

  it("keeps missing runtime binding and mode unknown", () => {
    const dir = tempDir("observer-identity-runtime-missing-");
    temporaryPaths.push(dir);
    const nuclearPath = `${dir}/nuclear.db`;
    const continuityPath = `${dir}/continuity.db`;
    const nuclearWriter = createNuclearFixture(nuclearPath);
    nuclearWriter.close();
    const continuityWriter = createContinuityFixture(continuityPath);
    continuityWriter.prepare("INSERT INTO lineage_state VALUES (?, ?, ?, ?, ?)").run(
      1,
      "lineage-1",
      41,
      null,
      "2026-08-26T00:00:00.000Z",
    );
    continuityWriter.close();
    const readNuclear = new DatabaseSync(nuclearPath, { readOnly: true });
    const readContinuity = new DatabaseSync(continuityPath, { readOnly: true });
    const result = extractIdentity({
      nuclear: readNuclear,
      continuity: readContinuity,
      checkoutSha: "checkout-sha",
      fieldDay: "2026-08-26",
    });
    readNuclear.close();
    readContinuity.close();
    expect(result.identity.runtimeBuildIdentity).toBe("UNKNOWN");
    expect(result.identity.cognitionMode).toBe("UNKNOWN");
  });
});
