import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
  statSync,
  linkSync,
  chmodSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { copySanitizedTree } from "./workspace-copy.js";
import { buildWorkspaceExclusionSet } from "./workspace-exclusions.js";
import type { TreeCopyLimits } from "./workspace-copy.js";

const NO_PROTECTED = { delegatedWriteDeniedOwnerApprovable: [], absoluteDenial: [] };
const win = process.platform === "win32";

const TEST_COPY_LIMITS: TreeCopyLimits = {
  maxFiles: 10_000,
  maxBytes: 100 * 1_024 * 1_024,
  maxSingleFileBytes: 25 * 1_024 * 1_024,
  maxPathLength: 1_024,
  maxDepth: 32,
  maxExcludedEntries: 20_000,
};

function makeSourceTree(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "ashley-copy-src-"));
  for (const [rel, content] of Object.entries(files)) {
    const native = path.join(root, ...rel.split("/"));
    mkdirSync(path.dirname(native), { recursive: true });
    writeFileSync(native, content);
  }
  return root;
}

function makeDest(): string {
  return mkdtempSync(path.join(tmpdir(), "ashley-copy-dst-"));
}

async function copy(
  source: string,
  dest: string,
  overrides: Record<string, unknown> = {},
) {
  return copySanitizedTree({
    sourceRoot: source,
    destinationRoot: dest,
    exclusionSet: buildWorkspaceExclusionSet(NO_PROTECTED, source),
    limits: { ...TEST_COPY_LIMITS },
    ...overrides,
  });
}

function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const childRel = rel === "" ? name : `${rel}/${name}`;
      out.push(childRel);
      if (statSync(full).isDirectory()) walk(full, childRel);
    }
  };
  walk(root, "");
  return out;
}

describe("sanitized tree copy", () => {
  it("copies a nested tree with identical contents and empty dirs", async () => {
    const source = makeSourceTree({
      "README.md": "hello",
      "src/index.ts": "export const x = 1;",
      "src/sub/deep.ts": "deep",
      "src/empty-dir/keep": "x",
      "src/other-empty/.gitkeep": "",
    });
    const dest = makeDest();
    const result = await copy(source, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readFileSync(path.join(dest, "src/index.ts"), "utf8")).toBe("export const x = 1;");
    expect(readFileSync(path.join(dest, "README.md"), "utf8")).toBe("hello");
    expect(statSync(path.join(dest, "src/empty-dir")).isDirectory()).toBe(true);
    expect(result.counts.files).toBe(5);
    expect(result.counts.directories).toBe(4);
  });

  it("skips excluded entries and records the exclusion code", async () => {
    const source = makeSourceTree({
      "ok.txt": "fine",
      ".env": "SECRET=1",
      ".git/config": "x",
      "node_modules/pkg/index.js": "x",
      "a/b/secret.key": "k",
    });
    const dest = makeDest();
    const result = await copy(source, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listTree(dest)).toEqual(["a", "a/b", "ok.txt"]);
    expect(result.counts.excluded).toBe(4);
  });

  it.skipIf(win)("fails on special files (fifo)", async () => {
    const source = makeSourceTree({ "ok.txt": "x" });
    const fifo = path.join(source, "pipe");
    const made = spawnSync("mkfifo", [fifo]);
    if (made.status !== 0) return;
    const dest = makeDest();
    const result = await copy(source, dest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("workspace_unsafe_object");
      expect(result.reason).toContain("special_file_forbidden");
      expect(result.counts.specialFiles).toBe(1);
    }
  });

  it.skipIf(win)("skips symlinks by default and fails under the fail policy", async () => {
    const source = makeSourceTree({ "ok.txt": "x", "target.txt": "content" });
    const { symlinkSync } = await import("node:fs");
    try {
      symlinkSync(path.join(source, "target.txt"), path.join(source, "link.txt"));
    } catch {
      return;
    }
    const dest = makeDest();
    const skipped = await copy(source, dest);
    expect(skipped.ok).toBe(true);
    if (skipped.ok) {
      expect(skipped.counts.skippedSymlinks).toBe(1);
      expect(listTree(dest)).not.toContain("link.txt");
    }
    const failed = await copy(source, makeDest(), { symlinkPolicy: "fail" });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.errorCode).toBe("workspace_unsafe_object");
      expect(failed.reason).toContain("symlink_forbidden");
    }
  });

  it("counts hard-linked files", async () => {
    const source = makeSourceTree({ "a.txt": "same content", "b.txt": "other" });
    try {
      linkSync(path.join(source, "a.txt"), path.join(source, "c.txt"));
    } catch {
      return;
    }
    const dest = makeDest();
    const result = await copy(source, dest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.counts.hardLinkedFiles).toBe(2);
      expect(readFileSync(path.join(dest, "c.txt"), "utf8")).toBe("same content");
    }
  });

  it("fails when a single file exceeds the byte ceiling", async () => {
    const source = makeSourceTree({ "big.bin": "x".repeat(100) });
    const dest = makeDest();
    const result = await copy(source, dest, {
      limits: { ...TEST_COPY_LIMITS, maxSingleFileBytes: 50 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("limit_exceeded");
      expect(result.reason).toContain("single_file_bytes_exceeded");
    }
  });

  it("fails when the total byte ceiling is exceeded", async () => {
    const source = makeSourceTree({ "a.txt": "x".repeat(30), "b.txt": "y".repeat(30) });
    const dest = makeDest();
    const result = await copy(source, dest, {
      limits: { ...TEST_COPY_LIMITS, maxBytes: 50 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("limit_exceeded");
      expect(result.reason).toContain("bytes_exceeded");
    }
  });

  it("fails when the file count ceiling is exceeded", async () => {
    const source = makeSourceTree({ "a.txt": "x", "b.txt": "x", "c.txt": "x" });
    const dest = makeDest();
    const result = await copy(source, dest, {
      limits: { ...TEST_COPY_LIMITS, maxFiles: 2 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("limit_exceeded");
      expect(result.reason).toContain("files_exceeded");
    }
  });

  it("fails when the depth ceiling is exceeded", async () => {
    const source = makeSourceTree({ "a/b/c/d/e.txt": "x" });
    const dest = makeDest();
    const result = await copy(source, dest, {
      limits: { ...TEST_COPY_LIMITS, maxDepth: 3 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("limit_exceeded");
      expect(result.reason).toContain("depth_exceeded");
    }
  });

  it("fails when the path length ceiling is exceeded", async () => {
    const source = makeSourceTree({ "x.txt": "x" });
    const dest = makeDest();
    const result = await copy(source, dest, {
      limits: { ...TEST_COPY_LIMITS, maxPathLength: 3 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("limit_exceeded");
      expect(result.reason).toContain("path_length_exceeded");
    }
  });

  it("fails when excluded entries exceed the ceiling", async () => {
    const source = makeSourceTree({
      ".env.a": "x",
      ".env.b": "x",
      ".env.c": "x",
      "ok.txt": "x",
    });
    const dest = makeDest();
    const result = await copy(source, dest, {
      limits: { ...TEST_COPY_LIMITS, maxExcludedEntries: 2 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("limit_exceeded");
      expect(result.reason).toContain("excluded_entries_exceeded");
    }
  });

  it("bounds total scanned entries", async () => {
    const source = makeSourceTree({});
    mkdirSync(path.join(source, "d1"), { recursive: true });
    mkdirSync(path.join(source, "d2"), { recursive: true });
    mkdirSync(path.join(source, "d3"), { recursive: true });
    mkdirSync(path.join(source, "d4"), { recursive: true });
    mkdirSync(path.join(source, "d5"), { recursive: true });
    const dest = makeDest();
    const result = await copy(source, dest, {
      limits: { ...TEST_COPY_LIMITS, maxFiles: 2, maxExcludedEntries: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("limit_exceeded");
      expect(result.reason).toContain("scan_exceeded");
    }
  });

  it.skipIf(win)("fails on case collisions", async () => {
    const source = makeSourceTree({ "dir/A.txt": "a", "DIR/a.txt": "a" });
    const dest = makeDest();
    const result = await copy(source, dest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("case_collision");
      expect(result.counts.caseCollisions).toBe(1);
    }
  });

  it("computes per-file and aggregate digests deterministically", async () => {
    const files: Record<string, string> = {
      "a.txt": "alpha",
      "src/b.txt": "beta",
    };
    const source = makeSourceTree(files);
    const dest1 = makeDest();
    const dest2 = makeDest();
    const first = await copy(source, dest1, { digests: true });
    const second = await copy(source, dest2, { digests: true });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const expectedA = createHash("sha256").update("alpha").digest("hex");
    expect(first.fileDigests?.["a.txt"]).toBe(expectedA);
    expect(first.digest).toBe(second.digest);
    expect(first.fileDigests).toEqual(second.fileDigests);
    const changed = makeSourceTree(files);
    writeFileSync(path.join(changed, "a.txt"), "ALPHA");
    const third = await copy(changed, makeDest(), { digests: true });
    expect(third.ok).toBe(true);
    if (third.ok) {
      expect(third.digest).not.toBe(first.digest);
    }
  });

  it.skipIf(win)("fails on privileged setuid files", async () => {
    const source = makeSourceTree({ "tool.bin": "x" });
    try {
      chmodSync(path.join(source, "tool.bin"), 0o4755);
    } catch {
      return;
    }
    const dest = makeDest();
    const result = await copy(source, dest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("workspace_unsafe_object");
      expect(result.reason).toContain("privileged_file_forbidden");
      expect(result.counts.privilegedFiles).toBe(1);
    }
  });
});

describe("sanitized tree copy cooperative deadline", () => {
  it("behaves identically to baseline with a far-future deadline", async () => {
    const files = {
      "README.md": "hello",
      "src/index.ts": "export const x = 1;",
      "src/sub/deep.ts": "deep",
    };
    const source = makeSourceTree(files);
    const dest = makeDest();
    const result = await copy(source, dest, { deadlineAtMs: Date.now() + 60_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(listTree(dest).sort()).toEqual(
        ["README.md", "src", "src/index.ts", "src/sub", "src/sub/deep.ts"].sort(),
      );
      expect(readFileSync(path.join(dest, "src", "sub", "deep.ts"), "utf8")).toBe("deep");
    }
  });

  it("fails closed with deadline_exceeded when the injected clock passes the cutoff mid-traversal", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i++) files[`src/dir${i}/file.txt`] = `content-${i}`;
    const source = makeSourceTree(files);
    const dest = makeDest();
    let now = 1_000;
    const clock = { nowMs: () => (now += 250) };
    const result = await copy(source, dest, { deadlineAtMs: 2_000, clock });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("deadline_exceeded");
    }
    expect(listTree(dest).length).toBeLessThan(Object.keys(files).length * 2);
  });

  it("aborts an in-flight streamed copy when the real deadline expires and leaves no locked handles", async () => {
    const big = Buffer.alloc(8 * 1024 * 1024, 0x61).toString("utf8");
    const source = makeSourceTree({ "big.bin": big, "small.txt": "s" });
    const dest = makeDest();
    const result = await copy(source, dest, { deadlineAtMs: Date.now() + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("deadline_exceeded");
    }
    let removed = false;
    try {
      rmSync(dest, { recursive: true, force: true });
      removed = !existsSync(dest);
    } catch {
      removed = false;
    }
    expect(removed).toBe(true);
    rmSync(source, { recursive: true, force: true });
  });

  it("fails immediately at entry when the deadline is already passed", async () => {
    const source = makeSourceTree({ "a.txt": "x" });
    const dest = makeDest();
    const result = await copy(source, dest, {
      deadlineAtMs: 1_000,
      clock: { nowMs: () => 2_000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("deadline_exceeded");
    }
    expect(listTree(dest)).toEqual([]);
  });
});
