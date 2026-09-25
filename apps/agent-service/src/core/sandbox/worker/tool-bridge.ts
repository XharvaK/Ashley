import { createHash } from "node:crypto";
import type {
  ExecuteProjectInspectionV2Input,
  ExecuteProjectInspectionV2Result,
  ExecuteWorkspaceExperimentV2Input,
  ExecuteWorkspaceExperimentV2Result,
} from "../v2-execution.js";
import type { CognitionInspectionRequest, CognitionWorkspaceRequest } from "../../types.js";
import {
  validateWorkspaceWorkerRequest,
  workspaceWorkerFieldError,
  WORKSPACE_TOOL_OPERATIONS,
  WORKSPACE_WORKER_REQUEST_SCHEMA_ID,
  type WorkspaceWorkerFieldError,
} from "@composer-assistant/sandbox-v2";
import { CREDENTIAL_OMITTED_PLACEHOLDER, detectCredentialShape } from "../../privacy/secrets.js";

export const READ_TOOL_OPERATIONS = [
  "project.read_file",
  "project.list_directory",
  "project.search_text",
] as const;

export const CANDIDATE_TOOL_OPERATIONS = WORKSPACE_TOOL_OPERATIONS;

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

export type WorkerToolRequestDiagnostic = {
  request: {
    operation: string;
    schemaVersion: string;
    fieldShapes: readonly { field: string; type: string; lengthBytes?: number }[];
    omittedFieldCount: number;
    targetPath: string | null;
    targetPathRedacted: boolean;
    targetPathTruncated: boolean;
    preconditionHash: string | null;
    failedField: string | null;
    argumentDigest: `sha256:${string}`;
  };
  validationStage: "bridge" | "runner";
  executionStarted: boolean;
  resultCode: string | null;
  beforeSha256: string | null;
  afterSha256: string | null;
  verificationRef: string | null;
};

export type ToolBridgeError =
  | "forbidden_operation"
  | "profile_denied"
  | "path_escape"
  | "invalid_request"
  | "missing_workspace";

export type ToolBridgeOk = {
  ok: true;
  diagnostic: WorkerToolRequestDiagnostic;
  inspection?: ExecuteProjectInspectionV2Result;
  workspace?: ExecuteWorkspaceExperimentV2Result;
};

export type ToolBridgeDenied = {
  ok: false;
  error: ToolBridgeError;
  fieldErrors: readonly WorkspaceWorkerFieldError[];
  diagnostic: WorkerToolRequestDiagnostic;
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
}

function fieldType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function safeResultCode(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!/^[a-z0-9_.-]{1,120}$/i.test(value) || detectCredentialShape(value).hit) return "result_code_omitted";
  return value;
}

function requestDiagnostic(call: WorkerToolCall): WorkerToolRequestDiagnostic["request"] {
  const request = isRecord(call.request) ? call.request : {};
  const keys = Object.keys(request).sort();
  const fieldShapes = keys.slice(0, 32).map((field) => {
    const value = request[field];
    return {
      field: detectCredentialShape(field).hit ? CREDENTIAL_OMITTED_PLACEHOLDER : field.slice(0, 80),
      type: fieldType(value),
      ...(typeof value === "string" ? { lengthBytes: Buffer.byteLength(value, "utf8") } : {}),
    };
  });
  const rawPath = ["path", "from", "to", "target"]
    .map((key) => request[key])
    .find((value): value is string => typeof value === "string") ?? null;
  const pathHasCredential = rawPath !== null && detectCredentialShape(rawPath).hit;
  const targetPathTruncated = rawPath !== null && rawPath.length > 512;
  const targetPath = pathHasCredential
    ? CREDENTIAL_OMITTED_PLACEHOLDER
    : rawPath === null ? null : rawPath.slice(0, 512);
  const preconditionHash = validHash(request.expectedSha256)
    ? request.expectedSha256.toLowerCase()
    : null;
  const argumentDigest = createHash("sha256").update(canonicalJson(call), "utf8").digest("hex");
  const operation = call.operation.slice(0, 120);
  return {
    operation: detectCredentialShape(operation).hit ? CREDENTIAL_OMITTED_PLACEHOLDER : operation,
    schemaVersion: WORKSPACE_WORKER_REQUEST_SCHEMA_ID,
    fieldShapes,
    omittedFieldCount: Math.max(0, keys.length - fieldShapes.length),
    targetPath,
    targetPathRedacted: pathHasCredential,
    targetPathTruncated,
    preconditionHash,
    failedField: null,
    argumentDigest: `sha256:${argumentDigest}`,
  };
}

function bridgeDiagnostic(
  request: WorkerToolRequestDiagnostic["request"],
  error: ToolBridgeError,
  fieldErrors: readonly WorkspaceWorkerFieldError[],
): WorkerToolRequestDiagnostic {
  const first = fieldErrors[0];
  const fieldPath = typeof first?.fieldPath === "string" ? first.fieldPath : null;
  const failedFieldRaw = fieldPath?.split(".").filter(Boolean).at(-1)?.replace(/\]$/, "") ?? null;
  return {
    request: {
      ...request,
      failedField: failedFieldRaw && !detectCredentialShape(failedFieldRaw).hit
        ? failedFieldRaw.slice(0, 80)
        : failedFieldRaw ? CREDENTIAL_OMITTED_PLACEHOLDER : null,
    },
    validationStage: "bridge",
    executionStarted: false,
    resultCode: safeResultCode(first?.preconditionCode ?? error),
    beforeSha256: null,
    afterSha256: validHash(first?.afterSha256) ? first.afterSha256.toLowerCase() : null,
    verificationRef: null,
  };
}

function runnerDiagnostic(
  request: WorkerToolRequestDiagnostic["request"],
  license: {
    state: string;
    error?: string | null;
    fieldErrors?: readonly { fieldPath?: string; expectedSchemaId?: string; preconditionCode?: string; executionStarted?: boolean; afterSha256?: string }[];
    workspaceClaimEffect?: { beforeSha256?: string; afterSha256?: string } | null;
    receiptRef?: string | null;
  },
  observation?: unknown,
  dispatchAttempted?: boolean,
): WorkerToolRequestDiagnostic {
  const first = license.fieldErrors?.[0];
  const observed = isRecord(observation) ? observation : {};
  const afterSha256 = license.workspaceClaimEffect?.afterSha256
    ?? (validHash(first?.afterSha256) ? first.afterSha256 : null)
    ?? (validHash(observed.afterSha256) ? observed.afterSha256 : null)
    ?? (validHash(observed.sha256) ? observed.sha256 : null);
  const beforeSha256 = license.workspaceClaimEffect?.beforeSha256
    ?? request.preconditionHash;
  return {
    request,
    validationStage: "runner",
    executionStarted: first?.executionStarted
      ?? dispatchAttempted
      ?? (license.state === "succeeded" || license.state === "outcome_unknown"),
    resultCode: safeResultCode(first?.preconditionCode ?? license.error ?? null),
    beforeSha256: validHash(beforeSha256) ? beforeSha256.toLowerCase() : null,
    afterSha256: validHash(afterSha256) ? afterSha256.toLowerCase() : null,
    verificationRef: typeof license.receiptRef === "string"
      ? detectCredentialShape(license.receiptRef).hit ? CREDENTIAL_OMITTED_PLACEHOLDER : license.receiptRef.slice(0, 256)
      : null,
  };
}

function denied(
  request: WorkerToolRequestDiagnostic["request"],
  error: ToolBridgeError,
  fieldErrors: readonly WorkspaceWorkerFieldError[],
): ToolBridgeDenied {
  return { ok: false, error, fieldErrors, diagnostic: bridgeDiagnostic(request, error, fieldErrors) };
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
  const requestSummary = requestDiagnostic(input.call);
  if ((FORBIDDEN_TOOL_OPERATIONS as readonly string[]).includes(operation)) {
    return denied(requestSummary, "forbidden_operation", [workspaceWorkerFieldError("$.operation", "forbidden_operation")]);
  }
  if (!isRecord(input.call.request)) {
    return denied(requestSummary, "invalid_request", [workspaceWorkerFieldError("$request", "object_required")]);
  }
  const escape = inspectPathFields(input.call.request);
  if (escape) {
    return denied(requestSummary, escape, [workspaceWorkerFieldError("$.path", escape)]);
  }

  if (input.profile === "read") {
    if (!(READ_TOOL_OPERATIONS as readonly string[]).includes(operation)) {
      return denied(requestSummary, "profile_denied", [workspaceWorkerFieldError("$.operation", "profile_denied")]);
    }
    const request = normalizeInspection(input.projectId, input.call);
    if (!request) {
      return denied(requestSummary, "invalid_request", [workspaceWorkerFieldError("$request", "invalid_request")]);
    }
    const inspection = await input.dispatchers.executeProjectInspectionV2({
      ...input.inspectionBase,
      request,
    });
    return {
      ok: true,
      inspection,
      diagnostic: runnerDiagnostic(requestSummary, inspection.license, inspection.observation, inspection.dispatchAttempted),
    };
  }

  if (!(CANDIDATE_TOOL_OPERATIONS as readonly string[]).includes(operation)) {
    return denied(requestSummary, "profile_denied", [workspaceWorkerFieldError("$.operation", "profile_denied")]);
  }
  const validation = validateWorkspaceWorkerRequest(operation, input.call.request);
  if (!validation.ok) {
    return denied(requestSummary, "invalid_request", validation.fieldErrors);
  }
  const workspaceId = input.workspaceId;
  if (!workspaceId) {
    return denied(requestSummary, "missing_workspace", [workspaceWorkerFieldError("$.workspaceId", "missing_workspace")]);
  }
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
  return {
    ok: true,
    workspace,
    diagnostic: runnerDiagnostic(requestSummary, workspace.license, workspace.observation),
  };
}
