import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { isValidTypedInspectionRequest } from "../cognitive-v021/thought/typed-inspection.js";
import { applyHomeOps, homeForThought, isHomeOps, normalizeHomePath, readHomeFile } from "./home.js";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");

function home() {
  const root = mkdtempSync(join(tmpdir(), "ashley-home-"));
  const sidecar = openTestSidecar();
  return { root, sidecar, close: () => { sidecar.close(); rmSync(root, { recursive: true, force: true }); } };
}

describe("E1 her home folder", () => {
  it("keeps paths inside her home", () => {
    expect(normalizeHomePath("notes/1f916.md")).toBe("notes/1f916.md");
    expect(normalizeHomePath("./notes//")).toBe("notes");
    expect(normalizeHomePath("/abs/path.md")).toBe("abs/path.md");
    for (const bad of ["../escape", "notes/../../x", "", "a/".repeat(9) + "b", "bad:name", 7]) expect(normalizeHomePath(bad)).toBeNull();
  });

  it("writes, appends, makes folders, moves, and deletes into the trash; each result is kept once per cycle", () => {
    const { root, sidecar, close } = home();
    try {
      const results = applyHomeOps(sidecar, root, { cycleId: "c1", nowMs: NOW, ops: [
        { op: "mkdir", path: "notes" },
        { op: "write", path: "notes/1f916.md", content: "# 1f916\n" },
        { op: "append", path: "notes/1f916.md", content: "- registered\n" },
        { op: "move", path: "notes/1f916.md", to: "places/1f916.md" },
        { op: "write", path: "scratch.txt", content: "tmp" },
        { op: "delete", path: "scratch.txt" },
        { op: "write", path: "../out.txt", content: "no" },
      ] });
      expect(results.map(result => [result.op, result.ok, result.reason ?? null])).toEqual([
        ["mkdir", true, null], ["write", true, null], ["append", true, null], ["move", true, null],
        ["write", true, null], ["delete", true, null], ["write", false, "path_invalid"]]);
      expect(readFileSync(join(root, "places/1f916.md"), "utf8")).toBe("# 1f916\n- registered\n");
      expect(readdirSync(join(root, ".trash"))).toEqual([`${NOW}-scratch.txt`]);
      expect(applyHomeOps(sidecar, root, { cycleId: "c1", nowMs: NOW, ops: [{ op: "write", path: "again.md", content: "x" }] })).toEqual([]);
      const view = homeForThought(sidecar, root, NOW)!;
      expect(view.files.map(file => file.path)).toEqual(["notes", "places", "places/1f916.md"]);
      expect(view.recentOps).toHaveLength(7);
      expect(readHomeFile(root, "places/1f916.md")).toMatchObject({ text: "# 1f916\n- registered\n", truncated: false });
    } finally { close(); }
  });

  it("refuses keys and passwords, oversized files and the trash", () => {
    const { root, sidecar, close } = home();
    try {
      const results = applyHomeOps(sidecar, root, { cycleId: "c2", nowMs: NOW, ops: [
        { op: "write", path: "key.txt", content: "api_key=" + "a1B2".repeat(10) },
        { op: "write", path: ".trash/x", content: "x" },
        { op: "delete", path: "missing.md" },
      ] });
      expect(results.map(result => result.reason)).toEqual(["looks_like_a_secret", "trash_is_kept", "not_found"]);
      expect(isHomeOps([{ op: "write", path: "big.md", content: "x".repeat(70_000) }])).toBe(false);
      expect(isHomeOps([{ op: "write", path: "a.md", content: "hi" }, { op: "move", path: "a.md", to: "b.md" }])).toBe(true);
      expect(isHomeOps([{ op: "rm", path: "a.md" }])).toBe(false);
    } finally { close(); }
  });

  it("offers home.read with one path", () => {
    expect(isValidTypedInspectionRequest("home.read", { path: "notes/a.md" })).toBe(true);
    expect(isValidTypedInspectionRequest("home.read", { path: "" })).toBe(false);
    expect(isValidTypedInspectionRequest("home.read", { path: "a.md", extra: 1 })).toBe(false);
  });
});
