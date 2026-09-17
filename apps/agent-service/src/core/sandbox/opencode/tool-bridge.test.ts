import { describe, expect, it, vi } from "vitest";
import { executeWorkerTool, pathEscapesProject } from "./tool-bridge.js";

const inspectionBase = {
  projectInspectionPreparationDeadlineAtMs: 1,
  childExecutionDeadlineAtMs: 2,
  childTerminationDeadlineAtMs: 3,
  settlementDeadlineAtMs: 4,
};

const workspaceBase = {
  deadlineAtMs: 4,
};

describe("OpenCode V2 tool bridge", () => {
  it("rejects writes on the read profile and live-tree path escape", () => {
    expect(pathEscapesProject("../secret")).toBe(true);
    expect(pathEscapesProject("/etc/passwd")).toBe(true);
    expect(pathEscapesProject("README.md")).toBe(false);
  });

  it("refuses candidate worker operations against a missing workspace and forbidden kinds", async () => {
    const executeProjectInspectionV2 = vi.fn();
    const executeWorkspaceExperimentV2 = vi.fn();
    const write = await executeWorkerTool({
      profile: "read",
      projectId: "project-ashley",
      call: { operation: "workspace.write_file", request: { path: "a.ts", content: "x" } },
      dispatchers: { executeProjectInspectionV2, executeWorkspaceExperimentV2 },
      inspectionBase,
      workspaceBase,
    });
    expect(write).toEqual({ ok: false, error: "profile_denied" });
    expect(executeWorkspaceExperimentV2).not.toHaveBeenCalled();

    const git = await executeWorkerTool({
      profile: "candidate",
      projectId: "project-ashley",
      workspaceId: "ws-1",
      call: { operation: "git.commit", request: {} },
      dispatchers: { executeProjectInspectionV2, executeWorkspaceExperimentV2 },
      inspectionBase,
      workspaceBase,
    });
    expect(git).toEqual({ ok: false, error: "forbidden_operation" });

    const escape = await executeWorkerTool({
      profile: "read",
      projectId: "project-ashley",
      call: { operation: "project.read_file", request: { path: "../outside" } },
      dispatchers: { executeProjectInspectionV2, executeWorkspaceExperimentV2 },
      inspectionBase,
      workspaceBase,
    });
    expect(escape).toEqual({ ok: false, error: "path_escape" });
    expect(executeProjectInspectionV2).not.toHaveBeenCalled();
  });

  it("defaults list_directory to the project root when path is omitted", async () => {
    const executeProjectInspectionV2 = vi.fn(async () => ({
      license: { state: "succeeded" as const, profile: "project_investigation" },
      observation: null,
      dispatchAttempted: true,
    }));
    const executeWorkspaceExperimentV2 = vi.fn();
    const result = await executeWorkerTool({
      profile: "read",
      projectId: "project-ashley",
      call: { operation: "project.list_directory", request: {} },
      dispatchers: { executeProjectInspectionV2, executeWorkspaceExperimentV2 },
      inspectionBase,
      workspaceBase,
    });
    expect(result.ok).toBe(true);
    expect(executeProjectInspectionV2).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        operation: "project.list_directory",
        projectId: "project-ashley",
        path: ".",
      }),
    }));
  });

  it("dispatches authorized candidate workspace ops only with the Host workspace id", async () => {
    const executeProjectInspectionV2 = vi.fn();
    const executeWorkspaceExperimentV2 = vi.fn(async () => ({
      license: { state: "succeeded" as const, profile: "project_experimentation" },
      observation: null,
    }));
    const result = await executeWorkerTool({
      profile: "candidate",
      projectId: "project-ashley",
      workspaceId: "ws-1",
      call: { operation: "workspace.write_file", request: { path: "src/a.ts", content: "x" } },
      dispatchers: { executeProjectInspectionV2, executeWorkspaceExperimentV2 },
      inspectionBase,
      workspaceBase,
    });
    expect(result.ok).toBe(true);
    expect(executeWorkspaceExperimentV2).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        operation: "workspace.write_file",
        projectId: "project-ashley",
        workspaceId: "ws-1",
        path: "src/a.ts",
      }),
    }));
  });
});
