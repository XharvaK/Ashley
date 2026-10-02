import { V2_LIMITS } from "../limits.js";
import type { TreeFileRecord } from "./tree.js";

export type PathChangeKind = "added" | "modified" | "deleted";

export type PathChange = {
  path: string;
  changeKind: PathChangeKind;
  beforeSha256: string | null;
  afterSha256: string | null;
};

export type DiffResult =
  | { ok: true; changes: PathChange[] }
  | { ok: false; error: "empty_changeset" | "unbounded_path" | "changeset_too_large" };

function compareRecords(
  base: Map<string, TreeFileRecord>,
  candidate: Map<string, TreeFileRecord>,
): PathChange[] {
  const paths = new Set([...base.keys(), ...candidate.keys()]);
  const changes: PathChange[] = [];
  for (const path of [...paths].sort()) {
    const before = base.get(path);
    const after = candidate.get(path);
    if (!before && after) {
      changes.push({
        path,
        changeKind: "added",
        beforeSha256: null,
        afterSha256: after.sha256,
      });
      continue;
    }
    if (before && !after) {
      changes.push({
        path,
        changeKind: "deleted",
        beforeSha256: before.sha256,
        afterSha256: null,
      });
      continue;
    }
    if (before && after && before.sha256 !== after.sha256) {
      changes.push({
        path,
        changeKind: "modified",
        beforeSha256: before.sha256,
        afterSha256: after.sha256,
      });
    }
  }
  return changes;
}

export function diffCandidateAgainstBase(input: {
  base: Map<string, TreeFileRecord>;
  candidate: Map<string, TreeFileRecord>;
  intendedPaths?: readonly string[];
}): DiffResult {
  let changes = compareRecords(input.base, input.candidate);
  if (input.intendedPaths) {
    const allowed = new Set(input.intendedPaths);
    const extra = changes.filter((change) => !allowed.has(change.path));
    if (extra.length > 0) {
      return { ok: false, error: "unbounded_path" };
    }
    changes = changes.filter((change) => allowed.has(change.path));
  }
  if (changes.length === 0) {
    return { ok: false, error: "empty_changeset" };
  }
  if (changes.length > V2_LIMITS.CHANGESET_MAX_PATHS) {
    return { ok: false, error: "changeset_too_large" };
  }
  return { ok: true, changes };
}
