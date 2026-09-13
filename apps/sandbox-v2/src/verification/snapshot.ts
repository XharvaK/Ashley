/**
 * Provisional candidate tree hash and snapshot identity (Sandbox V2 M4).
 *
 * Architecture requires snapshot *identity*. The storage mechanism remains
 * OPEN. This algorithm is an implementation-level provisional contract and
 * MUST NOT be treated as the frozen canonical hash.
 *
 * Provisional rules (unstable):
 * - walk files under the durable `tree/` directory
 * - skip symbolic links (do not follow)
 * - include regular files only
 * - relative paths use POSIX `/` separators, sorted lexicographically
 * - each file contributes `path\\0sha256(bytes)\\n`
 * - `candidateTreeHash` is sha256 of that concatenation
 *
 * Encoding, ignored files, and symlink policy may change. Label receipts that
 * cite this hash as using the provisional algorithm.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const PROVISIONAL_TREE_HASH_ALGORITHM = "m4-provisional-tree-v0";

export type CandidateSnapshotIdentity = {
  snapshotId: string;
  workspaceId: string;
  projectId: string;
  candidateTreeHash: string;
  sourceSnapshotId: string;
  treeHashAlgorithm: typeof PROVISIONAL_TREE_HASH_ALGORITHM;
};

function posixRel(treeRoot: string, filePath: string): string {
  return relative(treeRoot, filePath).split(sep).join("/");
}

function walkFiles(treeRoot: string, current: string, acc: string[]): void {
  if (!existsSync(current)) return;
  let entries;
  try {
    entries = readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walkFiles(treeRoot, fullPath, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    acc.push(fullPath);
  }
}

export function computeProvisionalCandidateTreeHash(treeRoot: string): string {
  const files: string[] = [];
  walkFiles(treeRoot, treeRoot, files);
  const records: string[] = [];
  for (const filePath of files) {
    const rel = posixRel(treeRoot, filePath);
    if (rel.length === 0 || rel.startsWith("..")) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(filePath);
      statSync(filePath);
    } catch {
      continue;
    }
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    records.push(`${rel}\0${fileHash}`);
  }
  records.sort();
  return createHash("sha256").update(records.join("\n"), "utf8").digest("hex");
}

export function bindCandidateSnapshot(input: {
  workspaceId: string;
  projectId: string;
  sourceSnapshotId: string;
  treeRoot: string;
}): CandidateSnapshotIdentity {
  const candidateTreeHash = computeProvisionalCandidateTreeHash(input.treeRoot);
  return {
    snapshotId: `vsnap_${randomBytes(16).toString("hex")}`,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    candidateTreeHash,
    sourceSnapshotId: input.sourceSnapshotId,
    treeHashAlgorithm: PROVISIONAL_TREE_HASH_ALGORITHM,
  };
}
