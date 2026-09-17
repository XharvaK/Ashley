import type {
  ExecuteProjectInspectionV2Input,
  ExecuteProjectInspectionV2Result,
  ExecuteWorkspaceExperimentV2Input,
  ExecuteWorkspaceExperimentV2Result,
} from "../v2-execution.js";
import type { CognitionInspectionRequest, CognitionWorkspaceRequest } from "../../types.js";

export const READ_TOOL_OPERATIONS = [
  "project.read_file",
  "project.list_directory",
  "project.search_text",
] as const;

export const CANDIDATE_TOOL_OPERATIONS = [
  "workspace.read_file",
  "workspace.list_directory",
  "workspace.search_text",
  "workspace.write_file",
  "workspace.replace_file",
  "workspace.edit_text",
  "workspace.delete_file",
  "workspace.create_directory",
] as const;

const FORBIDDEN_TOOL_OPERATIONS = [
  "patch_export",
  "changeset.author",
  "objective.operate",
  "workspace.verify",
  "git.commit",
  "git.push",
  "deploy",
  "shell",
  "bash",
  "package.install",
] as const;

export type WorkerToolProfile = "read" | "candidate";

export type WorkerToolCall = {
  operation: string;
  request: Record<string, unknown>;
};

export type ToolBridgeError =
  | "forbidden_operation"
  | "profile_denied"
  | "path_escape"
  | "invalid_request"
  | "missing_workspace";

export type ToolBridgeOk = {
  ok: true;
  inspection?: ExecuteProjectInspectionV2Result;
  workspace?: ExecuteWorkspaceExperimentV2Result;
};

export type ToolBridgeDenied = {
  ok: false;
  error: ToolBridgeError;
};

export type ToolBridgeDispatchers = {
  executeProjectInspectionV2: (input: ExecuteProjectInspectionV2Input) => Promise<ExecuteProjectInspectionV2Result>;
  executeWorkspaceExperimentV2: (input: ExecuteWorkspaceExperimentV2Input) => Promise<ExecuteWorkspaceExperimentV2Result>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function pathEscapesProject(path: string): boolean {
  if (path.includes("\0")) return true;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\\")) return true;
  const parts = path.split("/");
  return parts.includes("..");
}

function inspectPathFields(request: Record<string, unknown>): ToolBridgeError | null {
  for (const key of ["path", "from", "to", "target"]) {
    const value = request[key];
    if (typeof value === "string" && pathEscapesProject(value)) return "path_escape";
  }
  return null;
}

function normalizeInspection(
  projectId: string,
  call: WorkerToolCall,
): CognitionInspectionRequest | null {
  const operation = call.operation;
  if (operation === "project.search_text") {
    const pattern = stringValue(call.request.pattern);
    if (!pattern) return null;
    return {
      operation,
      projectId,
      ...(typeof call.request.path === "string" ? { path: call.request.path } : {}),
      pattern,
      ...(typeof call.request.maxMatches === "number" ? { maxMatches: call.request.maxMatches } : {}),
    };
  }
  if (operation === "project.list_directory") {
    const path = stringValue(call.request.path) ?? ".";
    return { operation, projectId, path };
  }
  if (operation === "project.read_file") {
    const path = stringValue(call.request.path);
    if (!path) return null;
    return { operation, projectId, path };
  }
  return null;
}

export async function executeWorkerTool(input: {
  profile: WorkerToolProfile;
  projectId: string;
  workspaceId?: string;
  call: WorkerToolCall;
  dispatchers: ToolBridgeDispatchers;
  inspectionBase: Omit<ExecuteProjectInspectionV2Input, "request">;
  workspaceBase: Omit<ExecuteWorkspaceExperimentV2Input, "request">;
}): Promise<ToolBridgeOk | ToolBridgeDenied> {
  const operation = input.call.operation;
  if ((FORBIDDEN_TOOL_OPERATIONS as readonly string[]).includes(operation)) {
    return { ok: false, error: "forbidden_operation" };
  }
  if (!isRecord(input.call.request)) return { ok: false, error: "invalid_request" };
  const escape = inspectPathFields(input.call.request);
  if (escape) return { ok: false, error: escape };

  if (input.profile === "read") {
    if (!(READ_TOOL_OPERATIONS as readonly string[]).includes(operation)) {
      return { ok: false, error: "profile_denied" };
    }
    const request = normalizeInspection(input.projectId, input.call);
    if (!request) return { ok: false, error: "invalid_request" };
    const inspection = await input.dispatchers.executeProjectInspectionV2({
      ...input.inspectionBase,
      request,
    });
    return { ok: true, inspection };
  }

  if (!(CANDIDATE_TOOL_OPERATIONS as readonly string[]).includes(operation)) {
    return { ok: false, error: "profile_denied" };
  }
  const workspaceId = input.workspaceId ?? stringValue(input.call.request.workspaceId);
  if (!workspaceId) return { ok: false, error: "missing_workspace" };
  const workspaceRequest = {
    ...input.call.request,
    operation,
    projectId: input.projectId,
    workspaceId,
  } as CognitionWorkspaceRequest;
  const workspace = await input.dispatchers.executeWorkspaceExperimentV2({
    ...input.workspaceBase,
    request: workspaceRequest,
  });
  return { ok: true, workspace };
}
