import { mkdirSync, mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRE_MIGRATE_KEEP,
  findPreMigrationCopyBefore,
  listPreMigrationCopies,
  preMigrateDirFor,
  takePreMigrationCopy,
} from "./pre-migration-copy.js";
import { createIsolatedDataPlane } from "./data-plane.js";
import { openContinuityDb, getPendingNuclearMigration } from "./continuity/db.js";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "./db.js";
import { MIGRATION_16_CHANGE_PROPOSAL_DDL } from "./cognition/legacy-change-proposal-migration-16.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "./cognitive-v021/types.js";
import { openCognitiveSidecarDb } from "./cognitive-v021/sidecar/db.js";

let dataDir = "";

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "pre-migrate-copy-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dataDir, { recursive: true, force: true });
});

function fileDb(name: string, rows: string[]): DatabaseSync {
  const db = new DatabaseSync(join(dataDir, name));
  db.exec("CREATE TABLE t (v TEXT); PRAGMA user_version = 41");
  for (const row of rows) db.prepare("INSERT INTO t (v) VALUES (?)").run(row);
  return db;
}

describe("pre-migration copy", () => {
  it("writes one consistent copy named by database, version and time, and logs its path", () => {
    const source = fileDb("source.db", ["kept"]);
    try {
      const path = takePreMigrationCopy({
        source,
        dataDir,
        db: "nuclear",
        fromVersion: 41,
        now: new Date("2026-10-10T12:00:00.000Z"),
      });
      expect(path).toBe(join(preMigrateDirFor(dataDir), "nuclear-v41-2026-10-10T12-00-00-000Z.db"));
      expect(existsSync(path)).toBe(true);
      const copy = new DatabaseSync(path);
      try {
        expect(copy.prepare("PRAGMA user_version").get()).toEqual({ user_version: 41 });
        expect(copy.prepare("SELECT v FROM t").all()).toEqual([{ v: "kept" }]);
      } finally {
        copy.close();
      }
      expect(readdirSync(preMigrateDirFor(dataDir)).some((name) => name.endsWith(".partial"))).toBe(false);
      const logged = JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])) as { event: string; path: string };
      expect(logged).toMatchObject({ event: "pre_migration_copy", path });
    } finally {
      source.close();
    }
  });

  it("keeps the newest copies of each database and leaves the other database's copies alone", () => {
    const source = fileDb("keep.db", ["x"]);
    try {
      for (let hour = 0; hour < PRE_MIGRATE_KEEP + 2; hour += 1) {
        takePreMigrationCopy({
          source,
          dataDir,
          db: "nuclear",
          fromVersion: 41,
          now: new Date(Date.UTC(2026, 9, 10, hour)),
        });
      }
      takePreMigrationCopy({
        source,
        dataDir,
        db: "cognitive-v021",
        fromVersion: 74,
        now: new Date(Date.UTC(2026, 9, 1)),
      });
      const nuclear = listPreMigrationCopies(preMigrateDirFor(dataDir), "nuclear");
      expect(nuclear).toHaveLength(PRE_MIGRATE_KEEP);
      expect(nuclear[0]!.stamp > nuclear[PRE_MIGRATE_KEEP - 1]!.stamp).toBe(true);
      expect(listPreMigrationCopies(preMigrateDirFor(dataDir), "cognitive-v021")).toHaveLength(1);
    } finally {
      source.close();
    }
  });

  it("finds the copy taken before a given version for a deploy rollback", () => {
    const source = fileDb("find.db", ["x"]);
    try {
      takePreMigrationCopy({ source, dataDir, db: "nuclear", fromVersion: 55, now: new Date(Date.UTC(2026, 9, 9)) });
      takePreMigrationCopy({ source, dataDir, db: "nuclear", fromVersion: 56, now: new Date(Date.UTC(2026, 9, 10)) });
      const found = findPreMigrationCopyBefore(dataDir, "nuclear", 56);
      expect(found).toContain("nuclear-v56-");
      expect(findPreMigrationCopyBefore(dataDir, "nuclear", 40)).toBeNull();
    } finally {
      source.close();
    }
  });

  it("fails closed and leaves no copy when the snapshot cannot be written", () => {
    const source = fileDb("closed.db", ["x"]);
    source.close();
    expect(() =>
      takePreMigrationCopy({ source, dataDir, db: "nuclear", fromVersion: 41 }),
    ).toThrow(/^pre_migration_snapshot_failed:/);
    expect(listPreMigrationCopies(preMigrateDirFor(dataDir), "nuclear")).toHaveLength(0);
    expect(readdirSync(preMigrateDirFor(dataDir)).filter((name) => name.endsWith(".partial"))).toHaveLength(0);
  });

  it("nuclear run from 56 copies the file before its one pending step and the step still completes", () => {
    const plane = createIsolatedDataPlane(dataDir);
    mkdirSync(join(dataDir, "conversations"), { recursive: true });
    const continuity = openContinuityDb(new DatabaseSync(plane.continuityDbPath), { dataPlane: plane });
    try {
      const db = openNuclearDb(new DatabaseSync(plane.nuclearDbPath), { continuity, dataPlane: plane });
      db.exec(MIGRATION_16_CHANGE_PROPOSAL_DDL);
      db.exec("PRAGMA user_version = 56");
      continuity.exec("UPDATE lineage_state SET nuclear_schema_version = 56 WHERE id = 1");
      db.close();

      const reopened = openNuclearDb(new DatabaseSync(plane.nuclearDbPath), { continuity, dataPlane: plane });
      try {
        expect(reopened.prepare("PRAGMA user_version").get()).toEqual({ user_version: NUCLEAR_SUPPORTED_VERSION });
        expect(getPendingNuclearMigration(continuity)).toBeFalsy();
      } finally {
        reopened.close();
      }
      const copy = findPreMigrationCopyBefore(dataDir, "nuclear", 56);
      expect(copy).not.toBeNull();
      const copyDb = new DatabaseSync(copy!);
      try {
        expect(copyDb.prepare("PRAGMA user_version").get()).toEqual({ user_version: 56 });
        expect(copyDb.prepare("SELECT name FROM sqlite_master WHERE name = 'change_proposals'").get()).toBeTruthy();
      } finally {
        copyDb.close();
      }
    } finally {
      continuity.close();
    }
  });

  it("sidecar run from 74 takes its copy before the v75 step", () => {
    const plane = createIsolatedDataPlane(dataDir);
    const path = plane.cognitiveSidecarDbPath;
    const first = openCognitiveSidecarDb(new DatabaseSync(path), { dataPlane: plane });
    first.exec(`PRAGMA user_version = ${COGNITIVE_SIDECAR_SCHEMA_VERSION - 1}`);
    first.close();
    const reopened = openCognitiveSidecarDb(new DatabaseSync(path), { dataPlane: plane });
    reopened.close();
    const copies = listPreMigrationCopies(preMigrateDirFor(dataDir), "cognitive-v021");
    expect(copies).toHaveLength(1);
    expect(copies[0]!.fromVersion).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION - 1);
    const copyDb = new DatabaseSync(copies[0]!.path);
    try {
      expect(copyDb.prepare("PRAGMA user_version").get()).toEqual({ user_version: COGNITIVE_SIDECAR_SCHEMA_VERSION - 1 });
    } finally {
      copyDb.close();
    }
  });
});
