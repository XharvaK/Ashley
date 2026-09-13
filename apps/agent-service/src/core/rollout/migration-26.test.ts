import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  NUCLEAR_SUPPORTED_VERSION,
  openNuclearDb,
  type NuclearMigrationTestFault,
} from "../db.js";
import {
  beginNuclearMigration,
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";
import { currentBuildIdentity } from "../rollout/capabilities.js";
import { MIGRATION_26_RECALL_QUALIFICATION_EPOCHS_DDL } from "./migration-26.js";

type Fixture = {
  nuclear: DatabaseSync;
  continuity: DatabaseSync;
};

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (
      db.prepare("PRAGMA user_version").get() as {
        user_version?: number;
      }
    ).user_version ?? 0,
  );
}

function sourceV25Fixture(): Fixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  nuclear.exec(`
    DROP INDEX idx_sandbox_task_admissions_owner_status;
    DROP INDEX idx_sandbox_task_admissions_decision;
    DROP TABLE sandbox_task_admissions;
    DROP INDEX idx_recall_qualification_epochs_single_current;
    DROP INDEX idx_recall_qualification_events_epoch;
    DROP TABLE recall_qualification_events;
    DROP TABLE recall_qualification_epochs;
    ALTER TABLE decision_log DROP COLUMN thought_validation_json;
    PRAGMA user_version = 25;
  `);
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 25 WHERE id = 1")
    .run();
  return { nuclear, continuity };
}

function pendingV26Fixture(): Fixture {
  const fixture = sourceV25Fixture();
  const lineageId = (
    fixture.nuclear
      .prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1")
      .get() as { lineage_id: string }
  ).lineage_id;
  beginNuclearMigration(fixture.continuity, {
    from: 25,
    to: 26,
    lineageId,
    buildIdentity: currentBuildIdentity(),
  });
  fixture.nuclear.exec(MIGRATION_26_RECALL_QUALIFICATION_EPOCHS_DDL);
  fixture.nuclear.exec("PRAGMA user_version = 26");
  return fixture;
}

function closeFixture(fixture: Fixture): void {
  fixture.nuclear.close();
  fixture.continuity.close();
}

describe("nuclear schema v26 Recall qualification epochs", () => {
  it("installs the epoch registry with zero current epochs and no auto campaign", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        (
          db.prepare(
            `SELECT COUNT(*) AS c FROM recall_qualification_epochs`,
          ).get() as { c: number }
        ).c,
      ).toBe(0);
      expect(
        (
          db.prepare(
            `SELECT COUNT(*) AS c FROM recall_qualification_events`,
          ).get() as { c: number }
        ).c,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("leaves historical v3 qualification evidence untouched during migration", () => {
    const fixture = sourceV25Fixture();
    try {
      fixture.nuclear.exec(`
        INSERT OR IGNORE INTO capability_releases
          (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
        VALUES ('recall', 'ashley-capability-v3', 'observe', '2026-01-01T00:00:00.000Z',
                'ashley-capability-v3', 'v3-build', 0);
        INSERT INTO capability_events
          (capability, release_id, kind, source_key, detail_json, occurred_at,
           contract_id, build_identity, model_epoch)
        VALUES
          ('recall', 'ashley-capability-v3', 'isolated_eval', 'v3:seed',
           '{"seeds":5,"passed":true}', '2026-01-01T00:00:00.000Z',
           'ashley-capability-v3', 'v3-build', 0),
          ('recall', 'ashley-capability-v3', 'live_shadow', 'v3:shadow',
           '{}', '2026-01-02T00:00:00.000Z', 'ashley-capability-v3', 'v3-build', 0);
      `);
      fixture.nuclear.exec(`
        UPDATE capability_releases
        SET eval_seed_count = 5, qualified_at = '2026-01-01T00:00:00.000Z'
        WHERE capability = 'recall' AND release_id = 'ashley-capability-v3';
      `);
      const beforeEvents = fixture.nuclear
        .prepare("SELECT * FROM capability_events ORDER BY source_key")
        .all();
      const beforeRelease = fixture.nuclear
        .prepare(
          `SELECT eval_seed_count, qualified_at FROM capability_releases
           WHERE capability = 'recall' AND release_id = 'ashley-capability-v3'`,
        )
        .get();

      openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
      expect(schemaVersion(fixture.nuclear)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        fixture.nuclear.prepare("SELECT * FROM capability_events ORDER BY source_key").all(),
      ).toEqual(beforeEvents);
      expect(
        fixture.nuclear
          .prepare(
            `SELECT eval_seed_count, qualified_at FROM capability_releases
             WHERE capability = 'recall' AND release_id = 'ashley-capability-v3'`,
          )
          .get(),
      ).toEqual(beforeRelease);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
    } finally {
      closeFixture(fixture);
    }
  });

  it("refuses pending recovery when v26 target content is incomplete", () => {
    const fixture = pendingV26Fixture();
    try {
      fixture.nuclear.exec("DROP TABLE recall_qualification_epochs");
      expect(() =>
        openNuclearDb(fixture.nuclear, { continuity: fixture.continuity }),
      ).toThrow(
        "nuclear_schema_content_invalid:v26:missing_table:recall_qualification_epochs",
      );
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 25,
        to: 26,
        phase: "pending",
      });
    } finally {
      closeFixture(fixture);
    }
  });

  it("refuses v25 recovery when v26 objects are already present", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    try {
      nuclear.exec(`
        DROP INDEX idx_recall_qualification_epochs_single_current;
        DROP INDEX idx_recall_qualification_events_epoch;
        DROP TABLE recall_qualification_events;
        DROP TABLE recall_qualification_epochs;
        ALTER TABLE attention_requests DROP COLUMN accepted_contract_id;
        ALTER TABLE attention_requests DROP COLUMN accepted_build_identity;
        ALTER TABLE open_cognitive_items DROP COLUMN generation_order;
        PRAGMA user_version = 24;
      `);
      continuity
        .prepare(
          "UPDATE lineage_state SET nuclear_schema_version = 24 WHERE id = 1",
        )
        .run();
      const lineageId = (
        nuclear.prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1").get() as {
          lineage_id: string;
        }
      ).lineage_id;
      beginNuclearMigration(continuity, {
        from: 24,
        to: 25,
        lineageId,
        buildIdentity: currentBuildIdentity(),
      });
      nuclear.exec(`
        ALTER TABLE attention_requests ADD COLUMN accepted_contract_id TEXT;
        ALTER TABLE attention_requests ADD COLUMN accepted_build_identity TEXT;
        ALTER TABLE open_cognitive_items ADD COLUMN generation_order INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version = 25;
      `);
      nuclear.exec(MIGRATION_26_RECALL_QUALIFICATION_EPOCHS_DDL);
      expect(() =>
        openNuclearDb(nuclear, { continuity }),
      ).toThrow(
        "nuclear_schema_content_invalid:v25:unexpected_v26_object:recall_qualification_epochs",
      );
      expect(getPendingNuclearMigration(continuity)).toMatchObject({
        from: 24,
        to: 25,
        phase: "pending",
      });
    } finally {
      nuclear.close();
      continuity.close();
    }
  });

  it.each([
    ["before pending", "before_pending", "none"],
    ["after pending", "after_pending", "pending"],
    ["during DDL", "during_ddl", "pending"],
    ["after nuclear commit", "after_nuclear_commit", "pending"],
    ["during sidecar update", "during_sidecar_update", "pending"],
    ["after sidecar update", "after_sidecar_update", "nuclear_committed"],
    ["before finalization", "before_finalization", "nuclear_committed"],
  ] as Array<[
    string,
    NuclearMigrationTestFault,
    "none" | "pending" | "nuclear_committed",
  ]>)("recovers v26 after failure injection %s", (_label, fault, phase) => {
    const fixture = sourceV25Fixture();
    try {
      if (fault === "during_sidecar_update") {
        fixture.continuity.exec(`
          CREATE TRIGGER migration_fault_sidecar_update_v26
          BEFORE UPDATE OF value ON continuity_meta
          WHEN NEW.key = 'pending_nuclear_migration'
          BEGIN
            SELECT RAISE(ABORT, 'test_fault_during_sidecar_update');
          END;
        `);
      }
      expect(() =>
        openNuclearDb(fixture.nuclear, {
          continuity: fixture.continuity,
          testMigrationFault: fault,
        }),
      ).toThrow(`test_fault_${fault}`);
      expect(schemaVersion(fixture.nuclear)).toBe(
        phase === "pending" &&
          (fault === "after_pending" || fault === "during_ddl") ||
          phase === "none"
          ? 25
          : 26,
      );
      if (phase === "none") {
        expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
      } else {
        expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
          from: 25,
          to: 26,
          phase,
        });
      }
      if (fault === "during_sidecar_update") {
        fixture.continuity.exec("DROP TRIGGER migration_fault_sidecar_update_v26");
      }

      openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
      expect(schemaVersion(fixture.nuclear)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
      expect(
        (
          fixture.continuity
            .prepare("SELECT nuclear_schema_version FROM lineage_state WHERE id = 1")
            .get() as { nuclear_schema_version: number }
        ).nuclear_schema_version,
      ).toBe(NUCLEAR_SUPPORTED_VERSION);
    } finally {
      closeFixture(fixture);
    }
  });
});
