import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type DataPlaneKind = "production" | "isolated";

export type DataPlaneContext = {
  readonly kind: DataPlaneKind;
  readonly dataDir: string;
  readonly conversationsDir: string;
  readonly sessionsDir: string;
  readonly nuclearDbPath: string;
  readonly continuityDbPath: string;
  readonly cognitiveSidecarDbPath: string;
  readonly migrationBackupsDir: string;
  readonly statePath: string;
  readonly configPath: string;
  readonly logsDir: string;
  readonly archiveDbPath: string;
  readonly envPath: string;
  readonly allowMigrate: boolean;
};

export function normalizeFsPath(path: string): string {
  return resolve(path).replace(/\\/g, "/").toLowerCase();
}

/**
 * Filesystem identity for authority checks: realpath of the deepest existing
 * ancestor plus any missing suffix. String-only resolve() is not enough.
 */
export function canonicalPathIdentity(input: string): string {
  if (!input || input === ":memory:") return input;
  const abs = resolve(input);
  const missing: string[] = [];
  let cursor = abs;
  for (let i = 0; i < 256; i += 1) {
    if (existsSync(cursor)) {
      let real = cursor;
      try {
        real = realpathSync(cursor);
      } catch {
        real = cursor;
      }
      const combined = missing.length > 0 ? join(real, ...missing) : real;
      return combined.replace(/\\/g, "/").toLowerCase();
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  return abs.replace(/\\/g, "/").toLowerCase();
}

export function reservedProductionDataDir(): string {
  return resolve(join(homedir(), ".composer-assistant"));
}

export function reservedProductionNuclearDbPath(): string {
  return join(reservedProductionDataDir(), "conversations", "nuclear.db");
}

export function reservedProductionContinuityDbPath(): string {
  return join(reservedProductionDataDir(), "continuity.db");
}

export function reservedProductionCognitiveSidecarDbPath(): string {
  return join(reservedProductionDataDir(), "cognitive-v021.db");
}

export function isCanonicalInside(parent: string, child: string): boolean {
  const parentN = canonicalPathIdentity(parent).replace(/\/+$/, "");
  const childN = canonicalPathIdentity(child);
  return childN === parentN || childN.startsWith(`${parentN}/`);
}

export function isReservedProductionDataDir(dir: string): boolean {
  return canonicalPathIdentity(dir) === canonicalPathIdentity(reservedProductionDataDir());
}

export function isPathInside(parent: string, child: string): boolean {
  return isCanonicalInside(parent, child);
}

export function isReservedProductionStoragePath(filePath: string): boolean {
  if (!filePath || filePath === ":memory:") return false;
  return isCanonicalInside(reservedProductionDataDir(), filePath);
}

function pathsFromDataDir(dataDir: string): Omit<
  DataPlaneContext,
  "kind" | "allowMigrate"
> {
  const resolved = resolve(dataDir);
  const conversationsDir = join(resolved, "conversations");
  return {
    dataDir: resolved,
    conversationsDir,
    sessionsDir: join(conversationsDir, "sessions"),
    nuclearDbPath: join(conversationsDir, "nuclear.db"),
    continuityDbPath: join(resolved, "continuity.db"),
    cognitiveSidecarDbPath: join(resolved, "cognitive-v021.db"),
    migrationBackupsDir: join(resolved, "migration-backups"),
    statePath: join(resolved, "state.json"),
    configPath: join(resolved, "config.json"),
    logsDir: join(resolved, "logs"),
    archiveDbPath: join(conversationsDir, "index.db"),
    envPath: join(resolved, ".env"),
  };
}

function assertIsolatedPathsOutsideProduction(
  paths: Omit<DataPlaneContext, "kind" | "allowMigrate">,
): void {
  const reserved = reservedProductionDataDir();
  const candidates = [
    paths.dataDir,
    paths.conversationsDir,
    paths.sessionsDir,
    paths.nuclearDbPath,
    paths.continuityDbPath,
    paths.cognitiveSidecarDbPath,
    paths.migrationBackupsDir,
    paths.statePath,
    paths.configPath,
    paths.logsDir,
    paths.archiveDbPath,
    paths.envPath,
  ];
  for (const candidate of candidates) {
    if (isCanonicalInside(reserved, candidate)) {
      throw new Error("isolated_data_plane_cannot_use_production_dir");
    }
  }
}

export function createIsolatedDataPlane(dataDir: string): DataPlaneContext {
  const paths = pathsFromDataDir(dataDir);
  assertIsolatedPathsOutsideProduction(paths);
  return { kind: "isolated", allowMigrate: true, ...paths };
}

export function createProductionDataPlane(options?: {
  dataDir?: string;
}): DataPlaneContext {
  const paths = pathsFromDataDir(
    options?.dataDir ?? reservedProductionDataDir(),
  );
  return { kind: "production", allowMigrate: true, ...paths };
}

export function dataPlaneOwnsFile(
  plane: DataPlaneContext,
  filePath: string | null,
): boolean {
  if (!filePath || filePath === ":memory:") return plane.kind === "isolated";
  return (
    canonicalPathIdentity(filePath) === canonicalPathIdentity(plane.nuclearDbPath) ||
    canonicalPathIdentity(filePath) === canonicalPathIdentity(plane.continuityDbPath) ||
    isCanonicalInside(plane.dataDir, filePath)
  );
}

export function isolatedPlaneForFile(filePath: string): DataPlaneContext {
  if (isReservedProductionStoragePath(filePath)) {
    throw new Error("isolated_data_plane_cannot_use_production_dir");
  }
  const resolved = resolve(filePath);
  const parent = dirname(resolved);
  const leaf = resolved.replace(/\\/g, "/").split("/").pop();
  const parentLeaf = parent.replace(/\\/g, "/").split("/").pop();
  if (leaf === "nuclear.db" && parentLeaf === "conversations") {
    return createIsolatedDataPlane(dirname(parent));
  }
  return createIsolatedDataPlane(parent);
}

export function mayMigrateStorage(input: {
  filePath: string | null;
  plane?: DataPlaneContext;
  migrate?: boolean;
}): boolean {
  if (input.migrate === false) return false;
  const filePath = input.filePath;
  const isMemory = !filePath || filePath === ":memory:";

  if (input.plane?.kind === "production") {
    return (
      input.migrate === true &&
      input.plane.allowMigrate &&
      (isMemory || dataPlaneOwnsFile(input.plane, filePath))
    );
  }

  if (filePath && isReservedProductionStoragePath(filePath)) {
    return false;
  }

  if (isMemory) {
    return !input.plane || input.plane.allowMigrate;
  }

  if (input.plane) {
    switch (input.plane.kind) {
      case "isolated":
        return (
          input.plane.allowMigrate && dataPlaneOwnsFile(input.plane, filePath)
        );
      default: {
        const _exhaustive: never = input.plane.kind;
        throw new Error(`unknown_data_plane_kind:${String(_exhaustive)}`);
      }
    }
  }
  return true;
}
