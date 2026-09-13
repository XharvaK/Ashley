import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  NUCLEAR_SUPPORTED_VERSION,
  openNuclearDb,
} from "../db.js";
import {
  beginNuclearMigration,
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";
import { currentBuildIdentity } from "../rollout/capabilities.js";
import { MIGRATION_27_SANDBOX_TASK_ADMISSIONS_DDL } from "./migration-27.js";

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

function sourceV26Fixture(): Fixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  nuclear.exec(`
    DROP INDEX idx_sandbox_task_admissions_owner_status;
    DROP INDEX idx_sandbox_task_admissions_decision;
    DROP TABLE sandbox_task_admissions;
    ALTER TABLE decision_log DROP COLUMN thought_validation_json;
    PRAGMA user_version = 26;
  `);
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 26 WHERE id = 1")
    .run();
  return { nuclear, continuity };
}

function pendingV27Fixture(): Fixture {
  const fixture = sourceV26Fixture();
  const lineageId = (
    fixture.nuclear
      .prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1")
      .get() as { lineage_id: string }
  ).lineage_id;
  beginNuclearMigration(fixture.continuity, {
    from: 26,
    to: 27,
    lineageId,
    buildIdentity: currentBuildIdentity(),
  });
  fixture.nuclear.exec(MIGRATION_27_SANDBOX_TASK_ADMISSIONS_DDL);
  fixture.nuclear.exec("PRAGMA user_version = 27");
  return fixture;
}

function closeFixture(fixture: Fixture): void {
  fixture.nuclear.close();
  fixture.continuity.close();
}

describe("nuclear schema v27 sandbox task admissions", () => {
  it("installs the admission ledger with zero rows and no auto admission", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        (
          db.prepare(
            `SELECT COUNT(*) AS c FROM sandbox_task_admissions`,
          ).get() as { c: number }
        ).c,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("supports recorded and refused rows under the check constraints", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const insert = db.prepare(
        `INSERT INTO sandbox_task_admissions (
           owner_id, intent_id, status, derived_from, decision_id,
           purposes_json, profile_key, profile_recipe_ids_json,
           evidence_refs_json, refusal_code, refusal_reason,
           build_identity, model_epoch, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insert.run(
        "owner-1",
        "intent-1",
        "recorded",
        "reactive",
        1,
        '["sandbox_verify_build_health"]',
        "verify-build-health",
        '["verify:agent-tsc"]',
        '["oci-1"]',
        null,
        null,
        currentBuildIdentity(),
        0,
        "2026-01-01T00:00:00.000Z",
      );
      insert.run(
        "owner-1",
        "intent-2",
        "refused",
        "proactive",
        2,
        "[]",
        "",
        "[]",
        "[]",
        "no_grounded_evidence",
        "no_current_qualified_oci_evidence",
        currentBuildIdentity(),
        0,
        "2026-01-01T00:00:01.000Z",
      );
      expect(
        (
          db.prepare(`SELECT COUNT(*) AS c FROM sandbox_task_admissions`).get() as {
            c: number;
          }
        ).c,
      ).toBe(2);
      expect(() =>
        insert.run(
          "owner-1",
          "intent-3",
          "bogus",
          "reactive",
          3,
          "[]",
          "",
          "[]",
          "[]",
          null,
          null,
          currentBuildIdentity(),
          0,
          "2026-01-01T00:00:02.000Z",
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("is not auto-admitted by openNuclearDb (zero authority until runtime observes)", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(
        (
          db.prepare(`SELECT COUNT(*) AS c FROM sandbox_task_admissions`).get() as {
            c: number;
          }
        ).c,
      ).toBe(0);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
    } finally {
      db.close();
    }
  });

  it("migrates a v26 source through the protocol with a pending recovery", () => {
    const fixture = pendingV27Fixture();
    try {
      const pending = getPendingNuclearMigration(fixture.continuity);
      expect(pending).toMatchObject({ from: 26, to: 27 });
      const reopen = openNuclearDb(fixture.nuclear, {
        continuity: fixture.continuity,
      });
      expect(schemaVersion(reopen)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        (
          reopen.prepare(
            `SELECT COUNT(*) AS c FROM sandbox_task_admissions`,
          ).get() as { c: number }
        ).c,
      ).toBe(0);
    } finally {
      closeFixture(fixture);
    }
  });
});
