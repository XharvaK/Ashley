import { describe, expect, it, vi } from "vitest";
import { executeWorkerTool } from "./tool-bridge.js";

function input(operation: string, request: Record<string, unknown>) {
  return {
    profile: "candidate" as const,
    projectId: "project-ashley",
    workspaceId: "workspace-1",
    call: { operation, request },
    dispatchers: {
      executeProjectInspectionV2: vi.fn(),
      executeWorkspaceExperimentV2: vi.fn(async () => ({
        license: { state: "none" as const, profile: "workspace_experiment" as const },
        observation: null,
      })),
    },
    inspectionBase: {} as never,
    workspaceBase: {} as never,
  };
}

describe("worker tool bridge workspace schema", () => {
  it("rejects the obsolete mustNotExist field before workspace dispatch", async () => {
    const request = input("workspace.write_file", {
      path: "new.txt",
      content: "new contents",
      mustNotExist: false,
    });

    const result = await executeWorkerTool(request);

    expect(result).toEqual({ ok: false, error: "invalid_request" });
    expect(request.dispatchers.executeWorkspaceExperimentV2).not.toHaveBeenCalled();
  });

  it("rejects a replace without its raw-byte hash before workspace dispatch", async () => {
    const request = input("workspace.replace_file", {
      path: "existing.txt",
      content: "replacement",
    });

    const result = await executeWorkerTool(request);

    expect(result).toEqual({ ok: false, error: "invalid_request" });
    expect(request.dispatchers.executeWorkspaceExperimentV2).not.toHaveBeenCalled();
  });

  it("keeps workspace.verify forbidden to the worker", async () => {
    const request = input("workspace.verify", {
      workspaceId: "workspace-1",
      recipeId: "typescript-fixture-compile-v1",
    });

    const result = await executeWorkerTool(request);

    expect(result).toEqual({ ok: false, error: "forbidden_operation" });
    expect(request.dispatchers.executeWorkspaceExperimentV2).not.toHaveBeenCalled();
  });
});
