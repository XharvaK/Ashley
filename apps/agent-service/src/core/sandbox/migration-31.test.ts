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
import { persistAdmittedBoundedOperation, getBoundedOperationStatus } from "./bounded-operation-store.js";
import { MIGRATION_31_BOUNDED_OPERATION_DDL } from "./migration-31.js";

type Fixture = {
  nuclear: DatabaseSync;
  continuity: DatabaseSync;
};

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0,
  );
}

function sourceV30Fixture(): Fixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  nuclear.exec(`
    DROP INDEX IF EXISTS idx_patch_export_records_changeset;
    DROP INDEX IF EXISTS idx_patch_export_records_entity_uuid;
    DROP INDEX IF EXISTS idx_patch_export_records_owner_status;
    DROP TABLE IF EXISTS patch_export_records;
    DROP INDEX IF EXISTS idx_bounded_operation_steps_entity_uuid;
    DROP INDEX IF EXISTS idx_bounded_operation_steps_task;
    DROP INDEX IF EXISTS idx_bounded_operation_tasks_entity_uuid;
    DROP INDEX IF EXISTS idx_bounded_operation_tasks_owner_status;
    DROP TABLE IF EXISTS bounded_operation_steps;
    DROP TABLE IF EXISTS bounded_operation_tasks;
    PRAGMA user_version = 30;
  `);
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 30 WHERE id = 1")
    .run();
  return { nuclear, continuity };
}

describe("nuclear schema v31 bounded operations", () => {
  it("installs control-plane tables with zero rows", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        (db.prepare(`SELECT COUNT(*) AS c FROM bounded_operation_tasks`).get() as { c: number }).c,
      ).toBe(0);
      expect(
        (db.prepare(`SELECT COUNT(*) AS c FROM bounded_operation_steps`).get() as { c: number }).c,
      ).toBe(0);
      expect(classifyTable("bounded_operation_tasks").cls).toBe("CONTROL_PLANE");
      expect(classifyTable("bounded_operation_steps").cls).toBe("CONTROL_PLANE");
    } finally {
      db.close();
    }
  });

  it("migrates a v30 source through the protocol", () => {
    const fixture = sourceV30Fixture();
    try {
      const lineageId = (
        fixture.nuclear
          .prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1")
          .get() as { lineage_id: string }
      ).lineage_id;
      beginNuclearMigration(fixture.continuity, {
        from: 30,
        to: 31,
        lineageId,
        buildIdentity: currentBuildIdentity(),
      });
      fixture.nuclear.exec(MIGRATION_31_BOUNDED_OPERATION_DDL);
      fixture.nuclear.exec("PRAGMA user_version = 31");
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 30,
        to: 31,
      });
      const reopen = openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
      expect(schemaVersion(reopen)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
      persistAdmittedBoundedOperation(reopen, {
        ownerId: "doc",
        taskId: "v2-operate-test",
        projectId: "project-ashley",
        workspaceId: "ws-m6-01ab",
        origin: "owner_request",
        objective: "bounded sequence",
        successCondition: "steps complete",
        failureCondition: "a step fails",
        admittedStepsJson: "[]",
        maxSteps: 2,
        deadlineAtMs: Date.now() + 60_000,
      });
      expect(getBoundedOperationStatus(reopen, "v2-operate-test")?.status).toBe("admitted");
    } finally {
      fixture.nuclear.close();
      fixture.continuity.close();
    }
  });

  it("has no apply/export/git columns", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const names = (
        db.prepare("PRAGMA table_info(bounded_operation_tasks)").all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(names).not.toContain("applied");
      expect(names).not.toContain("exported");
      expect(names).not.toContain("git_commit");
      expect(names).not.toContain("patch_bytes");
    } finally {
      db.close();
    }
  });
});
