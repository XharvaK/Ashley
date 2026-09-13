import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AshleyCore } from "./runtime.js";
import {
  connectNuclearDb,
  NUCLEAR_SUPPORTED_VERSION,
  nuclearSchemaVersion,
  openNuclearDb,
} from "./db.js";
import {
  createIsolatedDataPlane,
  createProductionDataPlane,
  mayMigrateStorage,
  reservedProductionDataDir,
  reservedProductionNuclearDbPath,
  reservedProductionCognitiveSidecarDbPath,
  canonicalPathIdentity,
  isCanonicalInside,
} from "./data-plane.js";
import { openContinuityDb } from "./continuity/db.js";
import { bootstrapProductionRuntime } from "../bootstrap/production.js";
import {
  bootstrapIsolatedRuntime,
  isolatedDataDirFromArgv,
} from "../bootstrap/isolated.js";
import { AgentManager } from "../agent.js";

const temps: string[] = [];
const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function isolatedBootProcess(dataDir: string) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      [
        'import { existsSync, mkdirSync } from "node:fs";',
        'import { DatabaseSync } from "node:sqlite";',
        'import { createIsolatedDataPlane } from "./src/core/data-plane.ts";',
        'import { openNuclearDb } from "./src/core/db.ts";',
        'const dataDir = process.env.ASHLEY_Q4_DATA_DIR;',
        'if (!dataDir) throw new Error("isolated_test_data_dir_missing");',
        'const plane = createIsolatedDataPlane(dataDir);',
        'mkdirSync(plane.conversationsDir, { recursive: true });',
        'const nuclear = openNuclearDb(new DatabaseSync(plane.nuclearDbPath), { dataPlane: plane, migrate: true });',
        'const mirror = nuclear.prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1").get();',
        'if (existsSync(plane.continuityDbPath) === false) throw new Error("isolated_continuity_file_missing");',
        'const continuity = new DatabaseSync(plane.continuityDbPath);',
        'const state = continuity.prepare("SELECT lineage_id FROM lineage_state WHERE id = 1").get();',
        'const adoptions = continuity.prepare("SELECT COUNT(*) AS count FROM continuity_events WHERE json_extract(detail_json, \'$.event\') = \'lineage_adoption\'").get();',
        'if (!mirror?.lineage_id || mirror.lineage_id !== state?.lineage_id) throw new Error("isolated_lineage_mismatch");',
        'console.log(JSON.stringify({ lineageId: mirror.lineage_id, continuityPath: plane.continuityDbPath, adoptions: Number(adoptions?.count ?? 0) }));',
        'continuity.close();',
        'nuclear.close();',
      ].join(" "),
    ],
    {
      cwd: APP_ROOT,
      encoding: "utf8",
      env: { ...process.env, ASHLEY_Q4_DATA_DIR: dataDir },
    },
  );
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can keep SQLite handles briefly after close.
      }
    }
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number })
      .user_version ?? 0,
  );
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).some((row) => row.name === column);
}

function seedSchema28File(nuclearPath: string, continuityPath: string): void {
  mkdirSync(dirname(nuclearPath), { recursive: true });
  mkdirSync(dirname(continuityPath), { recursive: true });
  const isolated = createIsolatedDataPlane(dirname(dirname(nuclearPath)));
  const continuity = openContinuityDb(new DatabaseSync(continuityPath), {
    dataPlane: isolated,
  });
  const nuclear = openNuclearDb(new DatabaseSync(nuclearPath), {
    continuity,
    dataPlane: isolated,
    migrate: true,
  });
  nuclear.exec(
    "ALTER TABLE delivery_reservations DROP COLUMN phase_lifecycle_json",
  );
  nuclear.exec("PRAGMA user_version = 28");
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 28 WHERE id = 1")
    .run();
  nuclear.close();
  continuity.close();
}

describe("production data-plane authority", () => {
  it("reserves the cognitive v0.2.1 sidecar beside production continuity", () => {
    const isolatedDir = tempDir("ashley-cognitive-sidecar-plane-");
    const isolated = createIsolatedDataPlane(isolatedDir);
    const reserved = reservedProductionCognitiveSidecarDbPath();

    expect(reserved).toBe(
      join(reservedProductionDataDir(), "cognitive-v021.db"),
    );
    expect(isolated.cognitiveSidecarDbPath).toBe(
      join(isolatedDir, "cognitive-v021.db"),
    );
  });

  it("does not grant production authority by import or no-arg construction", () => {
    expect(() => openNuclearDb()).toThrow(/data_plane_required/);
    expect(() => new AshleyCore()).toThrow(/data_plane_required/);
    expect(
      mayMigrateStorage({
        filePath: reservedProductionNuclearDbPath(),
        migrate: undefined,
      }),
    ).toBe(false);
    expect(() => createIsolatedDataPlane(reservedProductionDataDir())).toThrow(
      /isolated_data_plane_cannot_use_production_dir/,
    );
  });

  it("does not load production .env on env module import", () => {
    const envSource = readFileSync(
      fileURLToPath(new URL("../env.ts", import.meta.url)),
      "utf8",
    );
    expect(envSource).toContain("export function loadEnvFile");
    expect(envSource).not.toContain(
      'join(homedir(), ".composer-assistant", ".env")',
    );
  });

  it("keeps a schema-28 production DB unchanged when a schema-29 runtime constructs AshleyCore", () => {
    const prodDir = tempDir("ashley-prod-plane-");
    const plane = createProductionDataPlane({ dataDir: prodDir });
    seedSchema28File(plane.nuclearDbPath, plane.continuityDbPath);

    const db = new DatabaseSync(plane.nuclearDbPath);
    expect(schemaVersion(db)).toBe(28);
    expect(
      columnExists(db, "delivery_reservations", "phase_lifecycle_json"),
    ).toBe(false);

    const core = new AshleyCore(db, { dataPlane: plane });
    expect(schemaVersion(db)).toBe(28);
    expect(
      columnExists(db, "delivery_reservations", "phase_lifecycle_json"),
    ).toBe(false);
    expect(core.getHealth().schemaVersion).toBe(28);
    db.close();
  });

  it("may migrate an explicit isolated qualification DB to the candidate schema", () => {
    expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
    const qualDir = tempDir("ashley-qual-plane-");
    const plane = createIsolatedDataPlane(qualDir);
    seedSchema28File(plane.nuclearDbPath, plane.continuityDbPath);

    const continuity = openContinuityDb(
      new DatabaseSync(plane.continuityDbPath),
      { dataPlane: plane },
    );
    const db = openNuclearDb(new DatabaseSync(plane.nuclearDbPath), {
      continuity,
      dataPlane: plane,
      migrate: true,
    });
    expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
    expect(
      columnExists(db, "delivery_reservations", "phase_lifecycle_json"),
    ).toBe(true);
    const core = new AshleyCore(db, { dataPlane: plane });
    expect(core.getHealth().schemaVersion).toBe(NUCLEAR_SUPPORTED_VERSION);
    db.close();
    continuity.close();
  });

  it("persists isolated continuity across fresh process restarts", () => {
    const dir = tempDir("ashley-isolated-process-restart-");
    const plane = createIsolatedDataPlane(dir);

    const first = isolatedBootProcess(dir);
    expect(`${first.stdout}\n${first.stderr}`).not.toContain("isolated_continuity_file_missing");
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(existsSync(plane.continuityDbPath)).toBe(true);
    const firstResult = JSON.parse(first.stdout.trim()) as {
      lineageId: string;
      continuityPath: string;
      adoptions: number;
    };
    expect(firstResult.continuityPath).toBe(plane.continuityDbPath);
    expect(firstResult.lineageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(firstResult.adoptions).toBe(1);

    const second = isolatedBootProcess(dir);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    const secondResult = JSON.parse(second.stdout.trim()) as typeof firstResult;
    expect(secondResult.lineageId).toBe(firstResult.lineageId);
    expect(secondResult.adoptions).toBe(1);

    const third = isolatedBootProcess(dir);
    expect(third.status, `${third.stdout}\n${third.stderr}`).toBe(0);
    const thirdResult = JSON.parse(third.stdout.trim()) as typeof firstResult;
    expect(thirdResult.lineageId).toBe(firstResult.lineageId);
    expect(thirdResult.adoptions).toBe(1);
  });

  it("treats opening an existing DB as distinct from migrating it", () => {
    const dir = tempDir("ashley-open-ne-migrate-");
    const plane = createIsolatedDataPlane(dir);
    seedSchema28File(plane.nuclearDbPath, plane.continuityDbPath);
    const continuity = openContinuityDb(
      new DatabaseSync(plane.continuityDbPath),
      { dataPlane: plane },
    );
    const opened = connectNuclearDb(new DatabaseSync(plane.nuclearDbPath), {
      continuity,
      dataPlane: plane,
    });
    expect(schemaVersion(opened)).toBe(28);
    expect(
      columnExists(opened, "delivery_reservations", "phase_lifecycle_json"),
    ).toBe(false);

    openNuclearDb(opened, { continuity, dataPlane: plane, migrate: false });
    expect(schemaVersion(opened)).toBe(28);

    openNuclearDb(opened, { continuity, dataPlane: plane, migrate: true });
    expect(schemaVersion(opened)).toBe(NUCLEAR_SUPPORTED_VERSION);
    expect(
      columnExists(opened, "delivery_reservations", "phase_lifecycle_json"),
    ).toBe(true);
    opened.close();
    continuity.close();
  });

  it("fails closed without mutation when the schema is newer than the runtime", () => {
    const dir = tempDir("ashley-newer-schema-");
    const plane = createIsolatedDataPlane(dir);
    mkdirSync(plane.conversationsDir, { recursive: true });
    const continuity = openContinuityDb(
      new DatabaseSync(plane.continuityDbPath),
      { dataPlane: plane },
    );
    const db = openNuclearDb(new DatabaseSync(plane.nuclearDbPath), {
      continuity,
      dataPlane: plane,
      migrate: true,
    });
    db.exec("PRAGMA user_version = 99");
    expect(schemaVersion(db)).toBe(99);
    expect(() =>
      openNuclearDb(db, { continuity, dataPlane: plane, migrate: true }),
    ).toThrow(
      new RegExp(`unsupported_nuclear_schema:99>${NUCLEAR_SUPPORTED_VERSION}`),
    );
    expect(schemaVersion(db)).toBe(99);
    db.close();
    continuity.close();
  });

  it("preserves migrate-on-bootstrap through the explicit production activator", () => {
    const dir = tempDir("ashley-prod-bootstrap-");
    const manager = bootstrapProductionRuntime({ dataDir: dir });
    expect(manager).toBeInstanceOf(AgentManager);
    expect(nuclearSchemaVersion(manager.core.getDatabase())).toBe(
      NUCLEAR_SUPPORTED_VERSION,
    );
    expect(manager.dataPlane.kind).toBe("production");
    expect(manager.dataPlane.dataDir).toBe(dir);
    manager.logger.close();
    manager.core.getDatabase().close();
  });

  it("follows symlink identity for isolated vs reserved checks", () => {
    const target = tempDir("ashley-canon-target-");
    const holder = tempDir("ashley-canon-holder-");
    const link = join(holder, "link");
    symlinkSync(
      target,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(canonicalPathIdentity(link)).toBe(canonicalPathIdentity(target));
    expect(
      isCanonicalInside(target, join(link, "conversations", "nuclear.db")),
    ).toBe(true);
  });

  it("rejects an isolated plane that canonicalizes onto reserved production", () => {
    const reserved = reservedProductionDataDir();
    const nuclear = reservedProductionNuclearDbPath();
    const before = existsSync(nuclear) ? statSync(nuclear) : null;

    expect(() =>
      createIsolatedDataPlane(join(reserved, "..", ".composer-assistant")),
    ).toThrow(/isolated_data_plane_cannot_use_production_dir/);
    expect(() => createIsolatedDataPlane(join(reserved, "persona-eval-data"))).toThrow(
      /isolated_data_plane_cannot_use_production_dir/,
    );

    const linkDir = tempDir("ashley-reserved-link-");
    const link = join(linkDir, "link");
    try {
      symlinkSync(reserved, link, process.platform === "win32" ? "junction" : "dir");
      expect(() => createIsolatedDataPlane(link)).toThrow(
        /isolated_data_plane_cannot_use_production_dir/,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /isolated_data_plane_cannot_use_production_dir/.test(error.message)
      ) {
        throw error;
      }
    }

    const isolatedRoot = tempDir("ashley-isolated-nested-link-");
    mkdirSync(isolatedRoot, { recursive: true });
    const nested = join(isolatedRoot, "conversations");
    try {
      symlinkSync(
        join(reserved, "conversations"),
        nested,
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(() => createIsolatedDataPlane(isolatedRoot)).toThrow(
        /isolated_data_plane_cannot_use_production_dir/,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /isolated_data_plane_cannot_use_production_dir/.test(error.message)
      ) {
        throw error;
      }
    }

    const after = existsSync(nuclear) ? statSync(nuclear) : null;
    expect(after?.mtimeMs ?? null).toBe(before?.mtimeMs ?? null);
    expect(after?.size ?? null).toBe(before?.size ?? null);
  });

  it("does not migrate continuity under connect-only AshleyCore construction", () => {
    const dir = tempDir("ashley-connect-continuity-");
    const plane = createProductionDataPlane({ dataDir: dir });
    seedSchema28File(plane.nuclearDbPath, plane.continuityDbPath);
    writeFileSync(plane.continuityDbPath, "");
    const emptyContinuity = new DatabaseSync(plane.continuityDbPath);
    expect(schemaVersion(emptyContinuity)).toBe(0);
    emptyContinuity.close();

    const db = new DatabaseSync(plane.nuclearDbPath);
    const core = new AshleyCore(db, { dataPlane: plane });
    expect(schemaVersion(db)).toBe(28);
    expect(core.getHealth().schemaVersion).toBe(28);
    const continuity = new DatabaseSync(plane.continuityDbPath);
    expect(schemaVersion(continuity)).toBe(0);
    const tables = continuity
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'continuity_meta'`,
      )
      .all();
    expect(tables).toEqual([]);
    continuity.close();
    db.close();
  });
});
