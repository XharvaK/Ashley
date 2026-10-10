import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { isRecoverableNuclearMigrationPair, NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "./db.js";
import { getContinuityFor } from "./continuity/registry.js";
import { getPendingNuclearMigration } from "./continuity/db.js";
import { MIGRATION_16_CHANGE_PROPOSAL_DDL } from "./cognition/legacy-change-proposal-migration-16.js";

function userVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

/** A fresh supported database rewound to the v56 shape (the change-proposal tables back, sidecar at 56). */
function openV56(): DatabaseSync {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  db.exec(MIGRATION_16_CHANGE_PROPOSAL_DDL);
  db.exec("PRAGMA user_version = 56");
  getContinuityFor(db)!.exec("UPDATE lineage_state SET nuclear_schema_version = 56 WHERE id = 1");
  return db;
}

describe("pending nuclear migration recovery", () => {
  it("accepts every single step from the first pending-record step up to the supported version", () => {
    expect(NUCLEAR_SUPPORTED_VERSION).toBe(57);
    for (let from = 22; from < NUCLEAR_SUPPORTED_VERSION; from += 1) {
      expect(isRecoverableNuclearMigrationPair(from, from + 1)).toBe(true);
    }
    expect(isRecoverableNuclearMigrationPair(21, 22)).toBe(false);
    expect(isRecoverableNuclearMigrationPair(53, 55)).toBe(false);
    expect(isRecoverableNuclearMigrationPair(22, 22)).toBe(false);
    expect(isRecoverableNuclearMigrationPair(NUCLEAR_SUPPORTED_VERSION, NUCLEAR_SUPPORTED_VERSION + 1)).toBe(false);
  });

  it("finalizes 56 to 57 after a crash between the nuclear commit and the sidecar finalization", () => {
    const db = openV56();
    try {
      const continuity = getContinuityFor(db)!;
      expect(() =>
        openNuclearDb(db, { continuity, testFailAfterNuclearCommitBeforeContinuityFinalization: true }),
      ).toThrow("test_fault_after_nuclear_commit_before_continuity_finalization");
      expect(userVersion(db)).toBe(57);
      expect(getPendingNuclearMigration(continuity)).toMatchObject({ from: 56, to: 57, phase: "nuclear_committed" });

      openNuclearDb(db, { continuity });

      expect(userVersion(db)).toBe(57);
      expect(getPendingNuclearMigration(continuity)).toBeFalsy();
    } finally {
      db.close();
    }
  });

  it("rolls 56 to 57 back and completes it after a crash inside the step before its commit", () => {
    const db = openV56();
    try {
      const continuity = getContinuityFor(db)!;
      expect(() => openNuclearDb(db, { continuity, testMigrationFault: "during_ddl" })).toThrow(
        "test_fault_during_ddl",
      );
      expect(userVersion(db)).toBe(56);
      expect(getPendingNuclearMigration(continuity)).toMatchObject({ from: 56, to: 57, phase: "pending" });

      openNuclearDb(db, { continuity });

      expect(userVersion(db)).toBe(57);
      expect(getPendingNuclearMigration(continuity)).toBeFalsy();
    } finally {
      db.close();
    }
  });
});
