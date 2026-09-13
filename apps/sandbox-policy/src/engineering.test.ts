import { describe, it, expect } from "vitest";
import {
  validateEngineeringAction,
  engineeringActionCapability,
  isCanonicalRelativePath,
  ENGINEERING_META_ACTIONS,
} from "./engineering.js";
import type { EngineeringAction } from "./engineering.js";

describe("engineering action validation", () => {
  it("accepts a minimal workspace write with canonical relative path", () => {
    const action: EngineeringAction = {
      type: "write_workspace_file",
      fields: { workspaceId: "ws1", relativePath: "src/fix.ts", contentBase64: "aGVsbG8=" },
    };
    const r = validateEngineeringAction(action);
    expect(r.ok).toBe(true);
    expect(r.ok && r.capability).toBe("candidate_workspace_read_write_delete");
  });

  it("rejects relative path with ..", () => {
    const action: EngineeringAction = {
      type: "write_workspace_file",
      fields: { workspaceId: "ws1", relativePath: "../escape", contentBase64: "aA==" },
    };
    const r = validateEngineeringAction(action);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errorCode).toBe("relative_path_invalid");
  });

  it("rejects credential-shaped payloads", () => {
    const action: EngineeringAction = {
      type: "write_workspace_file",
      fields: { workspaceId: "ws1", relativePath: "x", reason: "use ghp_secretToken1234567890abcdefghijklmnop" },
    };
    const r = validateEngineeringAction(action);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown action types", () => {
    const r = validateEngineeringAction({ type: "rm_rf" as never, fields: {} });
    expect(r.ok).toBe(false);
  });

  it("maps capabilities correctly", () => {
    expect(engineeringActionCapability("inspect_project_file")).toBe("engineering_project_read");
    expect(engineeringActionCapability("commit_candidate")).toBe("candidate_repository_git_write");
    expect(engineeringActionCapability("complete")).toBeNull();
    expect(engineeringActionCapability("abort")).toBeNull();
  });

  it("meta actions are not executable", () => {
    expect(ENGINEERING_META_ACTIONS.has("complete")).toBe(true);
    expect(ENGINEERING_META_ACTIONS.has("write_workspace_file")).toBe(false);
  });

  it("isCanonicalRelativePath rejects absolute and escapes", () => {
    expect(isCanonicalRelativePath("a/b/c")).toBe(true);
    expect(isCanonicalRelativePath("/abs")).toBe(false);
    expect(isCanonicalRelativePath("..")).toBe(false);
    expect(isCanonicalRelativePath("a\\b")).toBe(false);
  });
});
