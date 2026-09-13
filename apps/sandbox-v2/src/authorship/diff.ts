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
  | { ok: true; changes: PathChange[]; patchUtf8: string }
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

function fileBody(record: TreeFileRecord | undefined, missingLabel: string): string {
  if (!record) return `${missingLabel}\n`;
  if (record.utf8 === null) {
    return `binary file sha256=${record.sha256} bytes=${record.bytes}\n`;
  }
  return record.utf8.endsWith("\n") ? record.utf8 : `${record.utf8}\n`;
}

function renderPatch(
  changes: PathChange[],
  base: Map<string, TreeFileRecord>,
  candidate: Map<string, TreeFileRecord>,
): string {
  const parts: string[] = [];
  for (const change of changes) {
    parts.push(`diff --git a/${change.path} b/${change.path}`);
    parts.push(`--- a/${change.changeKind === "added" ? "/dev/null" : change.path}`);
    parts.push(`+++ b/${change.changeKind === "deleted" ? "/dev/null" : change.path}`);
    const before = base.get(change.path);
    const after = candidate.get(change.path);
    if (change.changeKind === "deleted") {
      for (const line of fileBody(before, "").split("\n").slice(0, -1)) {
        parts.push(`-${line}`);
      }
      continue;
    }
    if (change.changeKind === "added") {
      for (const line of fileBody(after, "").split("\n").slice(0, -1)) {
        parts.push(`+${line}`);
      }
      continue;
    }
    for (const line of fileBody(before, "").split("\n").slice(0, -1)) {
      parts.push(`-${line}`);
    }
    for (const line of fileBody(after, "").split("\n").slice(0, -1)) {
      parts.push(`+${line}`);
    }
  }
  return `${parts.join("\n")}\n`;
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
  const patchUtf8 = renderPatch(changes, input.base, input.candidate);
  const patchBytes = Buffer.byteLength(patchUtf8, "utf8");
  if (patchBytes > V2_LIMITS.CHANGESET_MAX_PATCH_BYTES) {
    return { ok: false, error: "changeset_too_large" };
  }
  return { ok: true, changes, patchUtf8 };
}
