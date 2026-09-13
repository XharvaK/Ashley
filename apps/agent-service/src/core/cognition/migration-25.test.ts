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

function columnNames(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (
      db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    ).map((column) => column.name),
  );
}

function dropColumnIfPresent(
  db: DatabaseSync,
  table: string,
  column: string,
): void {
  if (columnNames(db, table).has(column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

function sourceV24Fixture(): Fixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  dropColumnIfPresent(nuclear, "attention_requests", "accepted_contract_id");
  dropColumnIfPresent(nuclear, "attention_requests", "accepted_build_identity");
  dropColumnIfPresent(nuclear, "open_cognitive_items", "generation_order");
  nuclear.exec("DROP TABLE IF EXISTS recall_qualification_events");
  nuclear.exec("DROP TABLE IF EXISTS recall_qualification_epochs");
  nuclear.exec("PRAGMA user_version = 24");
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 24 WHERE id = 1")
    .run();
  return { nuclear, continuity };
}

function pendingV25Fixture(): Fixture {
  const fixture = sourceV24Fixture();
  const lineageId = (
    fixture.nuclear
      .prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1")
      .get() as { lineage_id: string }
  ).lineage_id;
  beginNuclearMigration(fixture.continuity, {
    from: 24,
    to: 25,
    lineageId,
    buildIdentity: currentBuildIdentity(),
  });
  fixture.nuclear.exec(`
    ALTER TABLE attention_requests
      ADD COLUMN accepted_contract_id TEXT;
    ALTER TABLE attention_requests
      ADD COLUMN accepted_build_identity TEXT;
    ALTER TABLE open_cognitive_items
      ADD COLUMN generation_order INTEGER NOT NULL DEFAULT 0;
    PRAGMA user_version = 25;
  `);
  return fixture;
}

function closeFixture(fixture: Fixture): void {
  fixture.nuclear.close();
  fixture.continuity.close();
}

describe("nuclear schema v25 INIT-03 ordering metadata", () => {
  it("adds durable accepted-dispatch provenance and OCI generation order", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      const attentionColumns = columnNames(db, "attention_requests");
      expect(attentionColumns.has("accepted_contract_id")).toBe(true);
      expect(attentionColumns.has("accepted_build_identity")).toBe(true);
      expect(
        (
          db.prepare("PRAGMA table_info(open_cognitive_items)").all() as Array<{
            name: string;
            notnull: number;
            dflt_value: string | null;
          }>
        ).find((column) => column.name === "generation_order"),
      ).toMatchObject({ notnull: 1, dflt_value: "0" });
    } finally {
      db.close();
    }
  });

  it("refuses pending recovery when v25 target content is incomplete", () => {
    const fixture = pendingV25Fixture();
    try {
      fixture.nuclear.exec(
        "ALTER TABLE open_cognitive_items DROP COLUMN generation_order",
      );
      expect(() =>
        openNuclearDb(fixture.nuclear, { continuity: fixture.continuity }),
      ).toThrow(
        "nuclear_schema_content_invalid:v25:missing_column:open_cognitive_items.generation_order",
      );
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 24,
        to: 25,
        phase: "pending",
      });
    } finally {
      closeFixture(fixture);
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
  ]>)("recovers v25 after failure injection %s", (_label, fault, phase) => {
    const fixture = sourceV24Fixture();
    try {
      if (fault === "during_sidecar_update") {
        fixture.continuity.exec(`
          CREATE TRIGGER migration_fault_sidecar_update_v25
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
          ? 24
          : 25,
      );
      if (phase === "none") {
        expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
      } else {
        expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
          from: 24,
          to: 25,
          phase,
        });
      }
      if (fault === "during_sidecar_update") {
        fixture.continuity.exec("DROP TRIGGER migration_fault_sidecar_update_v25");
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
