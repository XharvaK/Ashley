import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSanitizedProjectView, removeProjectView } from "./source-view.js";
import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";

const EMPTY_PROTECTED: ProtectedRootsConfig = {
  delegatedWriteDeniedOwnerApprovable: [],
  absoluteDenial: [],
};

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ashley-v2-proj-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "src", "main.ts"), "const x = 1;\n", "utf8");
  writeFileSync(join(root, ".env"), "SECRET=1", "utf8");
  writeFileSync(join(root, ".env.local"), "SECRET=2", "utf8");
  writeFileSync(join(root, "id_ed25519"), "PRIVATE KEY", "utf8");
  writeFileSync(join(root, ".git", "config"), "git config", "utf8");
  writeFileSync(join(root, "node_modules", "dep.js"), "module", "utf8");
  return root;
}

function canCreateSymlinks(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "ashley-v2-sym-"));
  try {
    const target = join(probe, "t.txt");
    const link = join(probe, "l.txt");
    writeFileSync(target, "x", "utf8");
    symlinkSync(target, link, "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

const CAN_SYMLINK = canCreateSymlinks();

describe("buildSanitizedProjectView", () => {
  it("copies source but excludes secret/env/dependency/VCS material", async () => {
    const root = makeProject();
    try {
      const view = await buildSanitizedProjectView({
        canonicalRoot: root,
        protectedRoots: EMPTY_PROTECTED,
      });
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      expect(existsSync(join(view.viewRoot, "src", "main.ts"))).toBe(true);
      expect(existsSync(join(view.viewRoot, ".env"))).toBe(false);
      expect(existsSync(join(view.viewRoot, ".env.local"))).toBe(false);
      expect(existsSync(join(view.viewRoot, "id_ed25519"))).toBe(false);
      expect(existsSync(join(view.viewRoot, ".git"))).toBe(false);
      expect(existsSync(join(view.viewRoot, "node_modules"))).toBe(false);
      removeProjectView(view.viewRoot);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes protected roots strictly inside the source root", async () => {
    const root = makeProject();
    try {
      const protectedDir = join(root, "secrets");
      mkdirSync(protectedDir);
      writeFileSync(join(protectedDir, "token.txt"), "token", "utf8");
      const view = await buildSanitizedProjectView({
        canonicalRoot: root,
        protectedRoots: {
          delegatedWriteDeniedOwnerApprovable: [],
          absoluteDenial: [protectedDir],
        },
      });
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      expect(existsSync(join(view.viewRoot, "secrets"))).toBe(false);
      removeProjectView(view.viewRoot);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.runIf(CAN_SYMLINK)("never follows symlinks into excluded or outside material", async () => {
    const root = makeProject();
    try {
      writeFileSync(join(root, "real-secret.txt"), "secret", "utf8");
      symlinkSync(join(root, "real-secret.txt"), join(root, "src", "link.txt"));
      const view = await buildSanitizedProjectView({
        canonicalRoot: root,
        protectedRoots: EMPTY_PROTECTED,
      });
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      expect(existsSync(join(view.viewRoot, "src", "link.txt"))).toBe(false);
      expect(existsSync(join(view.viewRoot, "real-secret.txt"))).toBe(true);
      removeProjectView(view.viewRoot);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed for missing or non-directory roots", async () => {
    const missing = await buildSanitizedProjectView({
      canonicalRoot: join(tmpdir(), "does-not-exist-v2"),
      protectedRoots: EMPTY_PROTECTED,
    });
    expect(missing.ok).toBe(false);
    const fileRoot = mkdtempSync(join(tmpdir(), "ashley-v2-file-"));
    try {
      writeFileSync(join(fileRoot, "a.txt"), "x", "utf8");
      const notDir = await buildSanitizedProjectView({
        canonicalRoot: join(fileRoot, "a.txt"),
        protectedRoots: EMPTY_PROTECTED,
      });
      expect(notDir.ok).toBe(false);
    } finally {
      rmSync(fileRoot, { recursive: true, force: true });
    }
  });

  it("propagates the cooperative preparation deadline and removes the partial view", async () => {
    const root = makeProject();
    try {
      const expired = await buildSanitizedProjectView({
        canonicalRoot: root,
        protectedRoots: EMPTY_PROTECTED,
        deadlineAtMs: 1_000,
        clock: { nowMs: () => 2_000 },
      });
      expect(expired.ok).toBe(false);
      if (!expired.ok) expect(expired.error).toBe("deadline_exceeded");

      let now = 1_000;
      const midTraversal = await buildSanitizedProjectView({
        canonicalRoot: root,
        protectedRoots: EMPTY_PROTECTED,
        deadlineAtMs: 1_500,
        clock: { nowMs: () => (now += 400) },
      });
      expect(midTraversal.ok).toBe(false);
      if (!midTraversal.ok) expect(midTraversal.error).toBe("deadline_exceeded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("removeProjectView", () => {
  it("removes the view directory and is safe for missing roots", () => {
    const root = mkdtempSync(join(tmpdir(), "ashley-v2-clean-"));
    try {
      writeFileSync(join(root, "a.txt"), "x", "utf8");
      removeProjectView(root);
      expect(existsSync(root)).toBe(false);
      removeProjectView(join(tmpdir(), "never-created-v2"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});