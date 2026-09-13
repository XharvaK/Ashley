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
import { MIGRATION_30_CANDIDATE_CHANGESET_DDL } from "./migration-30.js";
import { persistProposedChangeSet, listChangeSetEventTypes } from "./changeset-store.js";

type Fixture = {
  nuclear: DatabaseSync;
  continuity: DatabaseSync;
};

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0,
  );
}

function sourceV29Fixture(): Fixture {
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
    DROP INDEX IF EXISTS idx_candidate_changeset_events_entity_uuid;
    DROP INDEX IF EXISTS idx_candidate_changeset_events_changeset;
    DROP INDEX IF EXISTS idx_candidate_changesets_entity_uuid;
    DROP INDEX IF EXISTS idx_candidate_changesets_owner_status;
    DROP TABLE IF EXISTS candidate_changeset_events;
    DROP TABLE IF EXISTS candidate_changesets;
    PRAGMA user_version = 29;
  `);
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 29 WHERE id = 1")
    .run();
  return { nuclear, continuity };
}

describe("nuclear schema v30 candidate change-sets", () => {
  it("installs control-plane tables with zero rows", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        (db.prepare(`SELECT COUNT(*) AS c FROM candidate_changesets`).get() as { c: number }).c,
      ).toBe(0);
      expect(
        (db.prepare(`SELECT COUNT(*) AS c FROM candidate_changeset_events`).get() as { c: number }).c,
      ).toBe(0);
      expect(classifyTable("candidate_changesets").cls).toBe("CONTROL_PLANE");
      expect(classifyTable("candidate_changeset_events").cls).toBe("CONTROL_PLANE");
    } finally {
      db.close();
    }
  });

  it("persists a proposed row with audit events and no apply columns", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const row = persistProposedChangeSet(db, {
        ownerId: "doc",
        changesetId: "cs_" + "ab".repeat(16),
        projectId: "project-ashley",
        workspaceId: "ws-m5-01",
        sourceSnapshotId: "snap_src",
        candidateSnapshotId: "vsnap_1",
        candidateTreeHash: "cd".repeat(32),
        baseTreeHash: "ef".repeat(32),
        baseCommit: null,
        sourceCleanliness: "unknown",
        treeHashAlgorithm: "m4-provisional-tree-v0",
        objective: "tighten a bound",
        rationale: "the candidate already contains the edit",
        riskClass: "low",
        evidenceRefs: ["vsnap_1"],
        verificationRecipeIds: ["typescript_fixture_compile_v1"],
        changedPaths: [{ path: "src/a.ts", changeKind: "modified" }],
        linkedVerificationRefs: ["vsnap_1"],
        patchSha256: "ab".repeat(32),
        patchBytes: 12,
        artifactRef: "/tmp/sealed.patch",
      });
      expect(row.status).toBe("proposed");
      expect(row.reviewStatus).toBe("submitted");
      expect(listChangeSetEventTypes(db, row.changesetId)).toEqual([
        "created",
        "sealed",
        "proposed",
      ]);
      const cols = (
        db.prepare("PRAGMA table_info(candidate_changesets)").all() as Array<{ name: string }>
      ).map((c) => c.name);
      expect(cols).not.toContain("approved");
      expect(cols).not.toContain("applied");
      expect(cols).not.toContain("committed");
      expect(cols).not.toContain("deployed");
    } finally {
      db.close();
    }
  });

  it("migrates a v29 source through the protocol", () => {
    const fixture = sourceV29Fixture();
    try {
      const lineageId = (
        fixture.nuclear
          .prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1")
          .get() as { lineage_id: string }
      ).lineage_id;
      beginNuclearMigration(fixture.continuity, {
        from: 29,
        to: 30,
        lineageId,
        buildIdentity: currentBuildIdentity(),
      });
      fixture.nuclear.exec(MIGRATION_30_CANDIDATE_CHANGESET_DDL);
      fixture.nuclear.exec("PRAGMA user_version = 30");
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 29,
        to: 30,
      });
      const reopen = openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
      expect(schemaVersion(reopen)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
    } finally {
      fixture.nuclear.close();
      fixture.continuity.close();
    }
  });
});
