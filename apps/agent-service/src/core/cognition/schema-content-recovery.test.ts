import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  NUCLEAR_SUPPORTED_VERSION,
  openNuclearDb,
  type NuclearMigrationTestFault,
} from "../db.js";
import { currentBuildIdentity } from "../rollout/capabilities.js";
import {
  beginNuclearMigration,
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";

type Fixture = {
  nuclear: DatabaseSync;
  continuity: DatabaseSync;
};

function pendingV24Fixture(): Fixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  const lineage = (
    nuclear
      .prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1")
      .get() as { lineage_id: string }
  ).lineage_id;
  nuclear.exec(`
    ALTER TABLE attention_requests DROP COLUMN accepted_contract_id;
    ALTER TABLE attention_requests DROP COLUMN accepted_build_identity;
    ALTER TABLE open_cognitive_items DROP COLUMN generation_order;
    PRAGMA user_version = 24;
  `);
  continuity
    .prepare(
      `UPDATE lineage_state SET nuclear_schema_version = 23 WHERE id = 1`,
    )
    .run();
  beginNuclearMigration(continuity, {
    from: 23,
    to: 24,
    lineageId: lineage,
    buildIdentity: currentBuildIdentity(),
  });
  return { nuclear, continuity };
}

function sourceV23Fixture(): Fixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  nuclear.exec(`
    ALTER TABLE attention_requests DROP COLUMN accepted_contract_id;
    ALTER TABLE attention_requests DROP COLUMN accepted_build_identity;
    ALTER TABLE open_cognitive_items DROP COLUMN generation_order;
    DROP INDEX idx_open_cognitive_items_semantic_generation;
    DROP INDEX idx_open_cognitive_items_owner_semantic_generation;
    DROP INDEX idx_open_cognitive_items_owner_status_id;
    DROP INDEX idx_open_cognitive_item_attention_review_due;
    DROP TABLE open_cognitive_item_review_cursor;
    DROP TABLE open_cognitive_item_wake_cursor;
    ALTER TABLE open_cognitive_items DROP COLUMN model_identity;
    ALTER TABLE open_cognitive_items DROP COLUMN semantic_identity_hash;
    ALTER TABLE open_cognitive_items DROP COLUMN continuity_generation;
    ALTER TABLE open_cognitive_item_attention DROP COLUMN review_attempt_count;
    ALTER TABLE open_cognitive_item_attention DROP COLUMN review_last_disposition;
    PRAGMA user_version = 23;
  `);
  continuity
    .prepare(
      `UPDATE lineage_state SET nuclear_schema_version = 23 WHERE id = 1`,
    )
    .run();
  return { nuclear, continuity };
}

function closeFixture(fixture: Fixture): void {
  fixture.nuclear.close();
  fixture.continuity.close();
}

describe("migration recovery schema content", () => {
  it.each([
    ["missing required column", (db: DatabaseSync) => {
      db.exec("ALTER TABLE open_cognitive_items DROP COLUMN model_identity");
    }],
    ["missing required table", (db: DatabaseSync) => {
      db.exec("DROP TABLE open_cognitive_item_review_cursor");
    }],
    ["missing correctness index", (db: DatabaseSync) => {
      db.exec("DROP INDEX idx_open_cognitive_item_attention_review_due");
    }],
    ["incorrect correctness index", (db: DatabaseSync) => {
      db.exec(`
        DROP INDEX idx_open_cognitive_item_attention_review_due;
        CREATE INDEX idx_open_cognitive_item_attention_review_due
          ON open_cognitive_item_attention (item_id);
      `);
    }],
  ])("refuses recovery with %s even when PRAGMA is 24", (_label, corrupt) => {
    const fixture = pendingV24Fixture();
    try {
      corrupt(fixture.nuclear);
      expect(() => openNuclearDb(fixture.nuclear, {
        continuity: fixture.continuity,
      })).toThrow("nuclear_schema_content_invalid:v24:");
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 23,
        to: 24,
        phase: "pending",
      });
      expect(
        (
          fixture.continuity
            .prepare("SELECT nuclear_schema_version FROM lineage_state WHERE id = 1")
            .get() as { nuclear_schema_version: number }
        ).nuclear_schema_version,
      ).toBe(23);
    } finally {
      closeFixture(fixture);
    }
  });

  it("keeps an incomplete target pending across repeated restart attempts", () => {
    const fixture = pendingV24Fixture();
    try {
      fixture.nuclear.exec("DROP TABLE open_cognitive_item_wake_cursor");
      expect(() => openNuclearDb(fixture.nuclear, {
        continuity: fixture.continuity,
      })).toThrow("nuclear_schema_content_invalid:v24:");
      expect(() => openNuclearDb(fixture.nuclear, {
        continuity: fixture.continuity,
      })).toThrow("nuclear_schema_content_invalid:v24:");
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        phase: "pending",
      });
    } finally {
      closeFixture(fixture);
    }
  });

  it("rejects an unexpected partial source schema instead of rolling it back", () => {
    const fixture = pendingV24Fixture();
    try {
      fixture.nuclear.exec("ALTER TABLE open_cognitive_items DROP COLUMN model_identity");
      fixture.nuclear.exec("PRAGMA user_version = 23");
      expect(() => openNuclearDb(fixture.nuclear, {
        continuity: fixture.continuity,
      })).toThrow("nuclear_schema_content_invalid:v23:");
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 23,
        to: 24,
        phase: "pending",
      });
    } finally {
      closeFixture(fixture);
    }
  });

  it("refuses a stale pending record when the nuclear version is unknown", () => {
    const fixture = pendingV24Fixture();
    try {
      fixture.nuclear.exec("PRAGMA user_version = 21");
      expect(() => openNuclearDb(fixture.nuclear, {
        continuity: fixture.continuity,
      })).toThrow("continuity_pending_migration_version_mismatch:21");
      expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
        from: 23,
        to: 24,
        phase: "pending",
      });
    } finally {
      closeFixture(fixture);
    }
  });

  it("finalizes only after the complete target content validates", () => {
    const fixture = pendingV24Fixture();
    try {
      openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
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

  it.each([
    ["before pending", "before_pending", "none"],
    ["after pending", "after_pending", "pending"],
    ["during DDL", "during_ddl", "pending"],
    ["after nuclear commit", "after_nuclear_commit", "pending"],
    ["during sidecar update", "during_sidecar_update", "pending"],
    ["after sidecar update", "after_sidecar_update", "nuclear_committed"],
    ["before finalization", "before_finalization", "nuclear_committed"],
  ] as Array<[string, NuclearMigrationTestFault, "none" | "pending" | "nuclear_committed"]>) (
    "recovers after failure injection %s",
    (_label, fault, expectedPhase) => {
      const fixture = sourceV23Fixture();
      try {
        if (fault === "during_sidecar_update") {
          // Exercise the actual sidecar UPDATE path with SQLite, not a mock.
          fixture.continuity.exec(`
            CREATE TRIGGER migration_fault_sidecar_update
            BEFORE UPDATE OF value ON continuity_meta
            WHEN NEW.key = 'pending_nuclear_migration'
            BEGIN
              SELECT RAISE(ABORT, 'test_fault_during_sidecar_update');
            END;
          `);
        }
        expect(() => openNuclearDb(fixture.nuclear, {
          continuity: fixture.continuity,
          testMigrationFault: fault,
        })).toThrow(`test_fault_${fault}`);
        const expectedVersion = expectedPhase === "none"
          || expectedPhase === "pending" &&
            (fault === "after_pending" || fault === "during_ddl")
          ? 23
          : 24;
        expect(
          (
            fixture.nuclear.prepare("PRAGMA user_version").get() as {
              user_version: number;
            }
          ).user_version,
        ).toBe(expectedVersion);
        if (expectedPhase === "none") {
          expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
        } else {
          expect(getPendingNuclearMigration(fixture.continuity)).toMatchObject({
            from: 23,
            to: 24,
            phase: expectedPhase,
          });
        }
        if (fault === "during_ddl") {
          expect(
            fixture.nuclear
              .prepare(
                `SELECT name FROM sqlite_master
                 WHERE type = 'table' AND name = 'migration_fault_probe'`,
              )
              .get(),
          ).toBeUndefined();
        }
        if (fault === "during_sidecar_update") {
          fixture.continuity.exec("DROP TRIGGER migration_fault_sidecar_update");
        }
        openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
        expect(
          (
            fixture.nuclear.prepare("PRAGMA user_version").get() as {
              user_version: number;
            }
          ).user_version,
        ).toBe(NUCLEAR_SUPPORTED_VERSION);
        expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
        expect(
          (
            fixture.continuity
              .prepare(
                `SELECT nuclear_schema_version FROM lineage_state WHERE id = 1`,
              )
              .get() as { nuclear_schema_version: number }
          ).nuclear_schema_version,
        ).toBe(NUCLEAR_SUPPORTED_VERSION);
      } finally {
        closeFixture(fixture);
      }
    },
  );
});
