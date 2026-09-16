import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../cognitive-v021/types.js";
import { openCognitiveSidecarDb } from "../cognitive-v021/sidecar/db.js";
import { recordEffectReceipt } from "../cognitive-v021/effect/in-flight.js";
import {
  assessC1RestoreContinuity,
  createDualBackupPackage,
  restoreDualBackupPackage,
  restoreVerifyPackage,
  verifyBackupPackage,
} from "./backup-package.js";
import {
  getAuthoritativeLineageId,
  openContinuityDb,
} from "./db.js";
import { cleanShutdownSession, startRuntimeSession } from "./sessions.js";

function pragmaValue(db: DatabaseSync, pragma: string, key: string): unknown {
  const row = db.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown>;
  return row[key];
}

function assertDatabaseIntegrity(db: DatabaseSync): void {
  expect(pragmaValue(db, "integrity_check", "integrity_check")).toBe("ok");
  expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
}

describe("wave10c backup and restore assurance", () => {
  it("records a clean shutdown only for the active runtime session", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const lineageId = getAuthoritativeLineageId(continuity);
    const sessionId = startRuntimeSession(continuity, { lineageId, nuclearSchemaVersion: 47 });
    try {
      cleanShutdownSession(continuity, { sessionId, lineageId });
      expect(
        continuity
          .prepare("SELECT clean_shutdown_at FROM runtime_sessions WHERE session_id = ?")
          .get(sessionId),
      ).toMatchObject({ clean_shutdown_at: expect.any(String) });
      expect(
        continuity
          .prepare("SELECT kind, session_id, lineage_id FROM continuity_events WHERE kind = 'shutdown_clean' ORDER BY id DESC LIMIT 1")
          .get(),
      ).toEqual({ kind: "shutdown_clean", session_id: sessionId, lineage_id: lineageId });
    } finally {
      nuclear.close();
      continuity.close();
    }
  });

  it("packages both temporary databases and fails closed for a mismatched sidecar", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-wave10c-"));
    const nuclearPath = join(dir, "nuclear.db");
    const continuityPath = join(dir, "continuity.db");
    const sidecarPath = join(dir, "cognitive-v021.db");
    const continuity = openContinuityDb(new DatabaseSync(continuityPath));
    const nuclear = openNuclearDb(new DatabaseSync(nuclearPath), { continuity });
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
    const key = "b".repeat(64);

    try {
      assertDatabaseIntegrity(nuclear);
      assertDatabaseIntegrity(continuity);
      const lineageId = getAuthoritativeLineageId(continuity);
      const result = createDualBackupPackage({
        nuclearDbPath: nuclearPath,
        continuityDbPath: continuityPath,
        sidecarDbPath: sidecarPath,
        continuity,
        outDir: join(dir, "backups"),
        transferKeyHex: key,
        nuclearSchemaVersion: 18,
        continuitySchemaVersion: 1,
        sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
        buildIdentity: "wave10c-test",
      });

      const manifest = verifyBackupPackage({
        packagePath: result.packagePath,
        transferKeyHex: key,
        expectedLineageId: lineageId,
      });
      expect(manifest.nuclearSchemaVersion).toBe(18);
      expect(manifest.continuitySchemaVersion).toBe(1);
      expect(manifest.packageVersion).toBe(2);
      expect(manifest.sidecarSchemaVersion).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect(manifest.sidecarHash).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.nuclearSnapshotAt).toBe(manifest.continuitySnapshotAt);
      expect(manifest.nuclearSnapshotAt).toBe(manifest.sidecarSnapshotAt);
      expect(manifest.createdAt).toBe(manifest.nuclearSnapshotAt);
      expect(manifest.c1CorrectionSeq).toBe(0);
      const watermark = continuity.prepare(
        `SELECT detail_json FROM backup_watermarks
         WHERE kind = 'backup' ORDER BY id DESC LIMIT 1`,
      ).get() as { detail_json?: string } | undefined;
      expect(JSON.parse(watermark?.detail_json ?? "{}")).toMatchObject({
        c1CorrectionSeq: 0,
      });
      expect(restoreVerifyPackage({
        packagePath: result.packagePath,
        transferKeyHex: key,
        currentContinuity: continuity,
        tempDir: join(dir, "restore-same-lineage"),
      })).toMatchObject({ ready: true });

      const otherContinuityPath = join(dir, "other-continuity.db");
      const otherContinuity = openContinuityDb(new DatabaseSync(otherContinuityPath));
      const otherNuclear = openNuclearDb(
        new DatabaseSync(join(dir, "other-nuclear.db")),
        { continuity: otherContinuity },
      );
      try {
        expect(restoreVerifyPackage({
          packagePath: result.packagePath,
          transferKeyHex: key,
          currentContinuity: otherContinuity,
          tempDir: join(dir, "restore-mismatch"),
        })).toMatchObject({
          ready: false,
          note: "current_sidecar_lineage_prefers_fail_closed",
        });
      } finally {
        otherNuclear.close();
        otherContinuity.close();
      }
    } finally {
      sidecar.close();
      nuclear.close();
      continuity.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installs only a verified cohort and replays later tombstones and receipts", () => {
    const dir = mkdtempSync(join(tmpdir(), "ashley-wave10c-restore-"));
    const nuclearPath = join(dir, "nuclear.db");
    const continuityPath = join(dir, "continuity.db");
    const sidecarPath = join(dir, "cognitive-v021.db");
    const key = "c".repeat(64);
    const continuity = openContinuityDb(new DatabaseSync(continuityPath));
    const nuclear = openNuclearDb(new DatabaseSync(nuclearPath), { continuity });
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
    const assertionKey = "restore-assertion";
    sidecar.prepare(
      `INSERT INTO sidecar_memory_assertions
       (assertion_key, statement, memory_kind, dimensions_json, data_classification,
        lineage_parent_key, admitted_generation, live, content_hash)
       VALUES (?, ?, 'learned_self', '{}', 'ordinary', NULL, 1, 1, 'hash')`,
    ).run(assertionKey, "restore me");
    const result = createDualBackupPackage({
      nuclearDbPath: nuclearPath,
      continuityDbPath: continuityPath,
      sidecarDbPath: sidecarPath,
      continuity,
      outDir: join(dir, "backups"),
      transferKeyHex: key,
      nuclearSchemaVersion: 18,
      continuitySchemaVersion: 1,
      sidecarSchemaVersion: COGNITIVE_SIDECAR_SCHEMA_VERSION,
      buildIdentity: "wave10c-restore-test",
    });
    const lineageId = getAuthoritativeLineageId(continuity);
    const tombstoneId = "restore-tombstone";
    const receipt = {
      receiptId: "restore-receipt",
      effectId: "restore-effect",
      idempotencyKey: "restore-idempotency",
      outcome: "succeeded" as const,
      claims: { laterTruth: true },
      atMs: 200,
      dataClassification: "never_public" as const,
      secretOmitted: true,
    };
    nuclear.close();
    continuity.close();
    sidecar.close();

    const currentContinuity = openContinuityDb(new DatabaseSync(continuityPath));
    const currentSidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
    currentContinuity.prepare(
      `INSERT INTO forget_tombstones
       (tombstone_id, owner_id, lineage_id, preview_id, receipt_id, status,
        created_at, applied_at, category_counts_json, external_non_erasure_json)
       VALUES (?, 'doc', ?, NULL, NULL, 'applied', ?, ?, '{}', '{}')`,
    ).run(tombstoneId, lineageId, new Date().toISOString(), new Date().toISOString());
    currentContinuity.prepare(
      `INSERT INTO forget_tombstone_targets
       (tombstone_id, entity_type, entity_uuid, action)
       VALUES (?, 'v021_memory_assertion', ?, 'redact')`,
    ).run(tombstoneId, assertionKey);
    recordEffectReceipt(currentSidecar, receipt);
    currentContinuity.close();
    currentSidecar.close();

    try {
      expect(restoreDualBackupPackage({
        packagePath: result.packagePath,
        transferKeyHex: key,
        nuclearDbPath: nuclearPath,
        continuityDbPath: continuityPath,
        sidecarDbPath: sidecarPath,
        tempDir: join(dir, "restore-stage"),
        derivedDbPath: join(dir, "derived.db"),
      })).toMatchObject({ ready: true });

      const restoredContinuity = openContinuityDb(new DatabaseSync(continuityPath));
      const restoredSidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
      expect(restoredContinuity.prepare("SELECT tombstone_id FROM forget_tombstones WHERE tombstone_id = ?").get(tombstoneId)).toBeTruthy();
      expect(restoredSidecar.prepare("SELECT statement, live FROM sidecar_memory_assertions WHERE assertion_key = ?").get(assertionKey)).toMatchObject({ statement: "[redacted]", live: 0 });
      expect(restoredSidecar.prepare("SELECT claims_json, at_ms FROM effect_receipts WHERE effect_id = ?").get(receipt.effectId)).toMatchObject({ claims_json: JSON.stringify(receipt.claims), at_ms: receipt.atMs });
      restoredSidecar.close();
      restoredContinuity.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed for a C1 restore gap, missing witness, and matching old checkpoints", () => {
    expect(assessC1RestoreContinuity({
      restoredCorrectionSeq: 4,
      sidecarCorrectionSeq: 5,
      manifestCorrectionSeq: 5,
      appliedC1AuthorityExists: true,
    })).toMatchObject({
      status: "gap",
      influenceFailClosed: true,
    });
    expect(assessC1RestoreContinuity({
      restoredCorrectionSeq: 5,
      sidecarCorrectionSeq: undefined,
      manifestCorrectionSeq: 5,
      appliedC1AuthorityExists: true,
    })).toMatchObject({
      status: "unknown",
      influenceFailClosed: true,
    });
    expect(assessC1RestoreContinuity({
      restoredCorrectionSeq: 5,
      sidecarCorrectionSeq: 5,
      manifestCorrectionSeq: 5,
      appliedC1AuthorityExists: true,
      sameOlderCheckpoint: true,
    })).toMatchObject({
      status: "unknown",
      influenceFailClosed: true,
    });
    expect(assessC1RestoreContinuity({
      restoredCorrectionSeq: 5,
      sidecarCorrectionSeq: 5,
      manifestCorrectionSeq: 5,
      appliedC1AuthorityExists: true,
    })).toMatchObject({
      status: "proven",
      influenceFailClosed: false,
    });
  });
});
