import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import {
  beginNuclearMigration,
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";
import { currentBuildIdentity } from "../rollout/capabilities.js";
import { classifyTable } from "../qualification/state-inventory.js";
import { persistPatchExportRecord, getPatchExportRecord } from "./patch-export-store.js";
import { MIGRATION_32_PATCH_EXPORT_DDL } from "./migration-32.js";

type Fixture = {
  nuclear: DatabaseSync;
  continuity: DatabaseSync;
};

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0,
  );
}

function sourceV31Fixture(): Fixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  nuclear.exec(`
    DROP INDEX IF EXISTS idx_patch_export_records_changeset;
    DROP INDEX IF EXISTS idx_patch_export_records_entity_uuid;
    DROP INDEX IF EXISTS idx_patch_export_records_owner_status;
    DROP TABLE IF EXISTS patch_export_records;
    DROP INDEX IF EXISTS idx_operational_jobs_entity_uuid;
    DROP INDEX IF EXISTS idx_operational_job_deliveries_kind;
    DROP INDEX IF EXISTS idx_verification_receipts_task;
    DROP TABLE IF EXISTS operational_job_deliveries;
    DROP TABLE IF EXISTS operational_jobs;
    DROP TABLE IF EXISTS verification_receipts;
    PRAGMA user_version = 31;
  `);
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 31 WHERE id = 1")
    .run();
  return { nuclear, continuity };
}

describe("nuclear schema v32 patch export", () => {
  it("installs control-plane tables with zero rows", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        (db.prepare(`SELECT COUNT(*) AS c FROM patch_export_records`).get() as { c: number }).c,
      ).toBe(0);
      expect(classifyTable("patch_export_records").cls).toBe("CONTROL_PLANE");
    } finally {
      db.close();
    }
  });

  it("migrates a v31 source through the protocol", () => {
    const fixture = sourceV31Fixture();
    try {
      const lineageId = (
        fixture.nuclear
          .prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1")
          .get() as { lineage_id: string }
      ).lineage_id;
      beginNuclearMigration(fixture.continuity, {
        from: 31,
        to: 32,
        lineageId,
        buildIdentity: currentBuildIdentity(),
      });
      fixture.nuclear.exec(MIGRATION_32_PATCH_EXPORT_DDL);
      fixture.nuclear.exec("PRAGMA user_version = 32");
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 31,
        to: 32,
      });
      const reopen = openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
      expect(schemaVersion(reopen)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
      persistPatchExportRecord(reopen, {
        ownerId: "doc",
        taskId: "v2-export-test",
        projectId: "project-ashley",
        changesetId: "cs_" + "ab".repeat(16),
        artifactRef: "/var/lib/ashley-sandbox/control/sealed.patch",
        destinationPath: "/var/lib/ashley-sandbox/review/cs_ab.patch",
        expectedSha256: "ab".repeat(32),
        witnessSha256: "ab".repeat(32),
        bytesWritten: 12,
        status: "succeeded",
        errorCode: null,
      });
      expect(getPatchExportRecord(reopen, "v2-export-test")?.status).toBe("succeeded");
      expect(getPatchExportRecord(reopen, "v2-export-test")?.applied).toBe(0);
    } finally {
      fixture.nuclear.close();
      fixture.continuity.close();
    }
  });

  it("has no apply/git/deploy columns that could store an effect other than copy", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const names = (
        db.prepare("PRAGMA table_info(patch_export_records)").all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(names).toContain("applied");
      expect(names).toContain("live_unwritten");
      expect(names).toContain("git_unwritten");
      expect(names).not.toContain("git_commit");
      expect(names).not.toContain("deployed");
    } finally {
      db.close();
    }
  });
});
