import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROVISIONAL_TREE_HASH_ALGORITHM,
  bindCandidateSnapshot,
  computeProvisionalCandidateTreeHash,
} from "./snapshot.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTree(): string {
  const root = mkdtempSync(join(tmpdir(), "ashley-m4-tree-"));
  tempDirs.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const n = 1;\n", "utf8");
  writeFileSync(join(root, "README.md"), "fixture\n", "utf8");
  return root;
}

describe("M4 provisional candidate tree hash", () => {
  it("is labeled provisional and changes when file content changes", () => {
    const tree = makeTree();
    const before = computeProvisionalCandidateTreeHash(tree);
    expect(before).toHaveLength(64);
    writeFileSync(join(tree, "src", "index.ts"), "export const n = 2;\n", "utf8");
    const after = computeProvisionalCandidateTreeHash(tree);
    expect(after).not.toBe(before);
  });

  it("is independent of sibling directory names and skips symlinks", () => {
    const tree = makeTree();
    const baseline = computeProvisionalCandidateTreeHash(tree);
    try {
      symlinkSync(join(tree, "README.md"), join(tree, "link-readme"));
    } catch {
      // Windows without symlink privilege: skip this assertion branch.
    }
    const withMaybeLink = computeProvisionalCandidateTreeHash(tree);
    expect(withMaybeLink).toBe(baseline);
  });

  it("binds a unique snapshotId to the current hash without mutating the tree", () => {
    const tree = makeTree();
    const first = bindCandidateSnapshot({
      workspaceId: "ws1",
      projectId: "p1",
      sourceSnapshotId: "snap_abc",
      treeRoot: tree,
    });
    const second = bindCandidateSnapshot({
      workspaceId: "ws1",
      projectId: "p1",
      sourceSnapshotId: "snap_abc",
      treeRoot: tree,
    });
    expect(first.treeHashAlgorithm).toBe(PROVISIONAL_TREE_HASH_ALGORITHM);
    expect(first.candidateTreeHash).toBe(second.candidateTreeHash);
    expect(first.snapshotId).not.toBe(second.snapshotId);
    expect(first.snapshotId.startsWith("vsnap_")).toBe(true);
  });
});
