/**
 * Host-side validation of the embedded workspace runner's evidence document
 * (Sandbox V2 M3).
 */

import {
  isSandboxV2OperationResult,
  type SandboxV2OperationName,
  type SandboxV2OperationResult,
} from "../v2-types.js";

export type WorkspaceRunnerChecks = {
  envClean: boolean;
  homeAbsent: boolean;
  runAbsent: boolean;
  hostSentinelAbsent: boolean;
  fdClean: boolean;
  workspaceWritable: boolean;
  usrReadOnly: boolean;
  loopbackConnectSucceeded: boolean;
  externalIsolated: boolean;
  externalError: string;
};

export type WorkspaceRunnerEvidence = {
  version: 2;
  operation: SandboxV2OperationName;
  ok: true;
  result: SandboxV2OperationResult;
  checks: WorkspaceRunnerChecks;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fail-closed shape guard for workspace runner evidence: version 2, ok:true, matching
 * operation, a valid operation-specific result, and a complete check set with
 * every isolation property present.
 */
export function isWorkspaceRunnerEvidence(
  value: unknown,
  operation: SandboxV2OperationName,
): value is WorkspaceRunnerEvidence {
  if (!isRecord(value)) return false;
  if (value.version !== 2) return false;
  if (value.ok !== true) return false;
  if (value.operation !== operation) return false;
  if (!isSandboxV2OperationResult(value.result, operation)) return false;
  const checks = value.checks;
  if (!isRecord(checks)) return false;
  return (
    checks.envClean === true &&
    checks.homeAbsent === true &&
    checks.runAbsent === true &&
    checks.hostSentinelAbsent === true &&
    checks.fdClean === true &&
    checks.workspaceWritable === true &&
    checks.usrReadOnly === true &&
    typeof checks.loopbackConnectSucceeded === "boolean" &&
    checks.externalIsolated === true &&
    typeof checks.externalError === "string"
  );
}

/** Temporary alias for initial compilation compatibility if needed. */
export const isInspectionRunnerEvidence = isWorkspaceRunnerEvidence;
