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

    expect(result).toMatchObject({
      ok: false,
      error: "invalid_request",
      fieldErrors: [{
        fieldPath: "$.mustNotExist",
        expectedSchemaId: "ashley.workspace_worker_request.v1",
        preconditionCode: "unexpected_field",
        executionStarted: false,
      }],
    });
    expect(request.dispatchers.executeWorkspaceExperimentV2).not.toHaveBeenCalled();
  });

  it("rejects a replace without its raw-byte hash before workspace dispatch", async () => {
    const request = input("workspace.replace_file", {
      path: "existing.txt",
      content: "replacement",
    });

    const result = await executeWorkerTool(request);

    expect(result).toMatchObject({
      ok: false,
      error: "invalid_request",
      fieldErrors: [{
        fieldPath: "$.expectedSha256",
        expectedSchemaId: "ashley.workspace_worker_request.v1",
        preconditionCode: "required_field_missing",
        executionStarted: false,
      }],
    });
    expect(request.dispatchers.executeWorkspaceExperimentV2).not.toHaveBeenCalled();
  });

  it("keeps workspace.verify forbidden to the worker", async () => {
    const request = input("workspace.verify", {
      workspaceId: "workspace-1",
      recipeId: "typescript-fixture-compile-v1",
    });

    const result = await executeWorkerTool(request);

    expect(result).toEqual({
      ok: false,
      error: "forbidden_operation",
      fieldErrors: [{
        fieldPath: "$.operation",
        expectedSchemaId: "ashley.workspace_worker_request.v1",
        preconditionCode: "forbidden_operation",
        executionStarted: false,
      }],
    });
    expect(request.dispatchers.executeWorkspaceExperimentV2).not.toHaveBeenCalled();
  });
});
