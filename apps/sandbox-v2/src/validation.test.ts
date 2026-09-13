import { describe, expect, it } from "vitest";
import { validateProjectInspectionRequest } from "./validation.js";

const read = {
  version: 2,
  operation: "project.read_file",
  projectId: "p",
  path: "src/a.ts",
} as const;
const list = {
  version: 2,
  operation: "project.list_directory",
  projectId: "p",
  path: ".",
} as const;
const search = {
  version: 2,
  operation: "project.search_text",
  projectId: "p",
  path: ".",
  pattern: "hello",
} as const;

describe("validateProjectInspectionRequest", () => {
  it("accepts canonical relative paths for every operation", () => {
    for (const request of [read, list, search]) {
      expect(validateProjectInspectionRequest(request).ok).toBe(true);
    }
    expect(
      validateProjectInspectionRequest({ ...read, path: "deep/nested/dir/file.txt" }).ok,
    ).toBe(true);
  });

  it("rejects absolute paths, escapes, backslashes, and NUL", () => {
    for (const path of [
      "/etc/passwd",
      "../outside",
      "src/../outside",
      "src\\file.ts",
      "C:/x",
      "a\0b",
      "",
    ]) {
      const result = validateProjectInspectionRequest({ ...read, path });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("path_invalid");
    }
  });

  it("rejects invalid projectIds", () => {
    const result = validateProjectInspectionRequest({ ...read, projectId: "" });
    expect(result.ok).toBe(false);
    const long = validateProjectInspectionRequest({ ...read, projectId: "x".repeat(129) });
    expect(long.ok).toBe(false);
  });

  it("bounds the search pattern and maxMatches", () => {
    const badPattern = validateProjectInspectionRequest({
      ...search,
      pattern: "x".repeat(257),
    });
    expect(badPattern.ok).toBe(false);
    const emptyPattern = validateProjectInspectionRequest({ ...search, pattern: "" });
    expect(emptyPattern.ok).toBe(false);
    for (const bad of [0, -1, 1.5, 2001]) {
      const result = validateProjectInspectionRequest({ ...search, maxMatches: bad });
      expect(result.ok).toBe(false);
    }
    const ok = validateProjectInspectionRequest({ ...search, maxMatches: 50 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.maxMatches).toBe(50);
  });

  it("defaults search path to the project root", () => {
    const result = validateProjectInspectionRequest({
      ...search,
      path: undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(".");
  });

  it("rejects non-objects and non-canonical list paths", () => {
    expect(validateProjectInspectionRequest(null as never).ok).toBe(false);
    expect(validateProjectInspectionRequest({ ...list, path: ".." }).ok).toBe(false);
  });
});