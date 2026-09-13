import type { DatabaseSync } from "node:sqlite";

/** Associates a nuclear DB handle with its continuity sidecar for this process. */
const continuityByNuclear = new WeakMap<DatabaseSync, DatabaseSync>();

/** Share one in-memory continuity among multiple handles on the same nuclear file. */
const continuityByNuclearPath = new Map<string, DatabaseSync>();

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function registerContinuityFor(
  nuclear: DatabaseSync,
  continuity: DatabaseSync,
  nuclearFilePath?: string | null,
): void {
  continuityByNuclear.set(nuclear, continuity);
  if (nuclearFilePath && nuclearFilePath.trim()) {
    continuityByNuclearPath.set(normalizePath(nuclearFilePath), continuity);
  }
}

export function getContinuityFor(
  nuclear: DatabaseSync,
): DatabaseSync | undefined {
  return continuityByNuclear.get(nuclear);
}

export function getContinuityForNuclearPath(
  nuclearFilePath: string,
): DatabaseSync | undefined {
  return continuityByNuclearPath.get(normalizePath(nuclearFilePath));
}
