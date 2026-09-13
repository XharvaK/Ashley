import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import {
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (
      db.prepare("PRAGMA user_version").get() as {
        user_version?: number;
      }
    ).user_version ?? 0,
  );
}

describe("nuclear schema v24 cognition continuity", () => {
  it("adds host-owned model identity to OCI rows", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));

    expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
    expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
    expect(
      (
        db.prepare("PRAGMA table_info(open_cognitive_items)").all() as Array<{
          name: string;
          notnull: number;
          dflt_value: string | null;
        }>
      ).find((column) => column.name === "model_identity"),
    ).toMatchObject({ notnull: 1, dflt_value: "''" });

    db.close();
  });

  it("recovers v24 after a post-nuclear-commit sidecar fault", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    db.exec(`
      ALTER TABLE attention_requests DROP COLUMN accepted_contract_id;
      ALTER TABLE attention_requests DROP COLUMN accepted_build_identity;
      ALTER TABLE open_cognitive_items DROP COLUMN generation_order;
      ALTER TABLE open_cognitive_items DROP COLUMN model_identity;
      PRAGMA user_version = 23;
    `);
    continuity
      .prepare(
        `UPDATE lineage_state SET nuclear_schema_version = 23 WHERE id = 1`,
      )
      .run();

    expect(() =>
      openNuclearDb(db, {
        continuity,
        testFailAfterNuclearCommitBeforeContinuityFinalization: true,
      }),
    ).toThrow("test_fault_after_nuclear_commit_before_continuity_finalization");
    expect(getPendingNuclearMigration(continuity)).toMatchObject({
      from: 23,
      to: 24,
      phase: "nuclear_committed",
    });
    expect(schemaVersion(db)).toBe(24);
    expect(
      (
        continuity
          .prepare(
            `SELECT nuclear_schema_version FROM lineage_state WHERE id = 1`,
          )
          .get() as { nuclear_schema_version?: number }
      ).nuclear_schema_version,
    ).toBe(23);

    openNuclearDb(db, { continuity });

    expect(getPendingNuclearMigration(continuity)).toBeNull();
    expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
    expect(
      (
        continuity
          .prepare(
            `SELECT nuclear_schema_version FROM lineage_state WHERE id = 1`,
          )
          .get() as { nuclear_schema_version?: number }
      ).nuclear_schema_version,
    ).toBe(NUCLEAR_SUPPORTED_VERSION);
    db.close();
    continuity.close();
  });
});
