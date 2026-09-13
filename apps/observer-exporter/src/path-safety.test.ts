import { mkdirSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertOutputRootSafe,
  assertPathContained,
} from "./path-safety.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function tempPath(): string {
  const path = mkdtempSync(join(tmpdir(), "observer-path-"));
  temporaryPaths.push(path);
  return path;
}

describe("observer output containment", () => {
  it("rejects the data root and paths inside it", () => {
    const root = tempPath();
    expect(() => assertOutputRootSafe(root, root)).toThrow(/output_inside_data_plane/);
    expect(() => assertOutputRootSafe(join(root, "bundles"), root)).toThrow(
      /output_inside_data_plane/,
    );
  });

  it("does not confuse a prefix-lookalike with a child path", () => {
    const parent = tempPath();
    const dataRoot = join(parent, "ashley-data");
    const sibling = join(parent, "ashley-data-export");
    mkdirSync(dataRoot);
    mkdirSync(sibling);
    expect(assertOutputRootSafe(sibling, dataRoot)).toBeDefined();
  });

  it("resolves symlinked output paths before applying ancestry rules", () => {
    const parent = tempPath();
    const dataRoot = join(parent, "ashley-data");
    const link = join(parent, "outside-link");
    mkdirSync(dataRoot);
    symlinkSync(dataRoot, link, "junction");
    expect(() => assertOutputRootSafe(join(link, "bundles"), dataRoot)).toThrow(
      /output_inside_data_plane/,
    );
  });

  it("enforces containment for publisher and bundle targets", () => {
    const parent = tempPath();
    const root = join(parent, "root");
    mkdirSync(root);
    expect(assertPathContained(root, join(root, "nested", "file.md"))).toBe(
      join(root, "nested", "file.md"),
    );
    expect(() => assertPathContained(root, join(root, "..", "outside.md"))).toThrow(
      /path_outside_root/,
    );
  });
});
