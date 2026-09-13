import { describe, expect, it } from "vitest";
import {
  V2_CAPABILITY_REGISTRY,
  V2_DEFERRED_OPERATIONS,
  isProjectListDirectoryResult,
  isProjectReadFileResult,
  isProjectSearchTextResult,
  isSandboxV2OperationResult,
  isSandboxV2Request,
  v2CapabilitySpec,
} from "./v2-types.js";

describe("isSandboxV2Request", () => {
  it("accepts well-formed requests for every operation", () => {
    for (const request of [
      { version: 2, operation: "file.roundtrip", content: "hello" },
      { version: 2, operation: "project.read_file", projectId: "p", path: "a.ts" },
      { version: 2, operation: "project.list_directory", projectId: "p", path: "." },
      { version: 2, operation: "project.search_text", projectId: "p", path: ".", pattern: "x" },
      { version: 2, operation: "workspace.verify", projectId: "p", workspaceId: "ws", recipeId: "r" },
      {
        version: 2,
        operation: "changeset.author",
        projectId: "p",
        workspaceId: "ws",
      },
    ]) {
      expect(isSandboxV2Request(request)).toBe(true);
    }
  });

  it("rejects wrong version, unknown operations, and non-objects", () => {
    expect(isSandboxV2Request({ version: 1, operation: "project.read_file" })).toBe(false);
    expect(isSandboxV2Request({ version: 2, operation: "project.delete" })).toBe(false);
    expect(isSandboxV2Request({ version: 2, operation: "file.roundtrip" })).toBe(true);
    expect(isSandboxV2Request(null)).toBe(false);
    expect(isSandboxV2Request("x")).toBe(false);
  });
});

describe("capability registry", () => {
  it("preserves M1 and M2 operation sets and registers M3 workspace family", () => {
    const operations = V2_CAPABILITY_REGISTRY.map((spec) => spec.operation);
    expect(operations).toEqual([
      "file.roundtrip",
      "project.read_file",
      "project.list_directory",
      "project.search_text",
      "workspace.read_file",
      "workspace.list_directory",
      "workspace.search_text",
      "workspace.write_file",
      "workspace.replace_file",
      "workspace.edit_text",
      "workspace.delete_file",
      "workspace.create_directory",
      "workspace.verify",
      "changeset.author",
      "patch_export",
    ]);

    // M2 project_inspection family
    const m2Ops = V2_CAPABILITY_REGISTRY.filter((s) => s.family === "project_inspection").map((s) => s.operation);
    expect(m2Ops).toEqual([
      "project.read_file",
      "project.list_directory",
      "project.search_text",
    ]);

    const m3Ops = V2_CAPABILITY_REGISTRY.filter((s) => s.family === "project_experimentation").map((s) => s.operation);
    expect(m3Ops).toEqual([
      "workspace.read_file",
      "workspace.list_directory",
      "workspace.search_text",
      "workspace.write_file",
      "workspace.replace_file",
      "workspace.edit_text",
      "workspace.delete_file",
      "workspace.create_directory",
    ]);

    const m4Ops = V2_CAPABILITY_REGISTRY.filter((s) => s.family === "project_verification").map((s) => s.operation);
    expect(m4Ops).toEqual(["workspace.verify"]);

    const m5Ops = V2_CAPABILITY_REGISTRY.filter((s) => s.family === "project_authorship").map((s) => s.operation);
    expect(m5Ops).toEqual(["changeset.author"]);
    const m7Ops = V2_CAPABILITY_REGISTRY.filter((s) => s.family === "patch_export").map((s) => s.operation);
    expect(m7Ops).toEqual(["patch_export"]);
  });

  it("marks project inspection read-only and project-required", () => {
    for (const spec of V2_CAPABILITY_REGISTRY.filter((s) => s.family === "project_inspection")) {
      expect(spec.readOnly).toBe(true);
      expect(spec.requiresProject).toBe(true);
    }
  });

  it("marks workspace experiments project-required with appropriate readOnly flags", () => {
    for (const spec of V2_CAPABILITY_REGISTRY.filter((s) => s.family === "project_experimentation")) {
      expect(spec.requiresProject).toBe(true);
      if (["workspace.read_file", "workspace.list_directory", "workspace.search_text"].includes(spec.operation)) {
        expect(spec.readOnly).toBe(true);
      } else {
        expect(spec.readOnly).toBe(false);
      }
    }
  });

  it("marks verification as project-required and candidate-read-only", () => {
    const spec = v2CapabilitySpec("workspace.verify");
    expect(spec?.family).toBe("project_verification");
    expect(spec?.readOnly).toBe(true);
    expect(spec?.requiresProject).toBe(true);
  });

  it("marks authorship as project-required and candidate-read-only", () => {
    const spec = v2CapabilitySpec("changeset.author");
    expect(spec?.family).toBe("project_authorship");
    expect(spec?.readOnly).toBe(true);
    expect(spec?.requiresProject).toBe(true);
  });

  it("defers the git ops fail-closed", () => {
    expect(V2_DEFERRED_OPERATIONS).toEqual([
      "inspect_project_git_status",
      "inspect_project_git_diff",
      "inspect_project_git_log",
      "changeset.apply",
      "changeset.merge",
      "git.commit",
      "git.push",
    ]);
    expect(v2CapabilitySpec("inspect_project_git_status")).toBeUndefined();
  });
});

describe("operation result guards (fail-closed)", () => {
  it("accepts a complete read_file result and rejects partial ones", () => {
    const valid = {
      kind: "project.read_file",
      path: "a.ts",
      bytes: 5,
      contentBase64: "aGVsbG8=",
      sha256: "f".repeat(64),
      truncated: false,
    };
    expect(isProjectReadFileResult(valid)).toBe(true);
    expect(isSandboxV2OperationResult(valid, "project.read_file")).toBe(true);
    expect(isProjectReadFileResult({ ...valid, truncated: true })).toBe(false);
    expect(isProjectReadFileResult({ ...valid, contentBase64: "" })).toBe(false);
    expect(isProjectReadFileResult({ ...valid, bytes: -1 })).toBe(false);
    expect(isProjectReadFileResult({ ...valid, sha256: "short" })).toBe(false);
    expect(isSandboxV2OperationResult(valid, "project.list_directory")).toBe(false);
  });

  it("accepts a complete list_directory result and rejects malformed entries", () => {
    const valid = {
      kind: "project.list_directory",
      path: ".",
      entries: [
        { name: "a", kind: "file", size: 1 },
        { name: "d", kind: "dir", size: 0 },
      ],
      truncated: false,
    };
    expect(isProjectListDirectoryResult(valid)).toBe(true);
    expect(isProjectListDirectoryResult({ ...valid, truncated: true })).toBe(true);
    expect(
      isProjectListDirectoryResult({
        ...valid,
        entries: [{ name: "x", kind: "socket", size: 0 }],
      }),
    ).toBe(false);
    expect(isProjectListDirectoryResult({ ...valid, entries: "nope" })).toBe(false);
  });

  it("accepts a complete search_text result and rejects malformed matches", () => {
    const valid = {
      kind: "project.search_text",
      path: ".",
      matches: [{ path: "a.ts", line: 1, text: "x" }],
      truncated: true,
      filesScanned: 3,
    };
    expect(isProjectSearchTextResult(valid)).toBe(true);
    expect(isProjectSearchTextResult({ ...valid, matches: [{ path: "a", line: 0, text: "" }] })).toBe(
      false,
    );
    expect(isProjectSearchTextResult({ ...valid, filesScanned: -1 })).toBe(false);
  });
});