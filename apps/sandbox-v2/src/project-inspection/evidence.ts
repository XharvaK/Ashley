/**
 * Host-side validation of the embedded runner's evidence document
 * (Sandbox V2 M2).
 *
 * The host never trusts the runner's self-report alone: isolation checks are
 * combined with host-owned evidence (loopback positive control + host
 * listener hit count) before a result is accepted. Any malformed, partial,
 * or false check fails closed. `loopbackConnectSucceeded` must be a boolean
 * here but its verdict is combined with host evidence by the executor.
 */

import {
  isSandboxV2OperationResult,
  type SandboxV2OperationName,
  type SandboxV2OperationResult,
} from "../v2-types.js";

export type InspectionRunnerChecks = {
  envClean: boolean;
  homeAbsent: boolean;
  runAbsent: boolean;
  hostSentinelAbsent: boolean;
  fdClean: boolean;
  projectReadOnly: boolean;
  loopbackConnectSucceeded: boolean;
  externalIsolated: boolean;
  externalError: string;
};

export type InspectionRunnerEvidence = {
  version: 2;
  operation: SandboxV2OperationName;
  ok: true;
  result: SandboxV2OperationResult;
  checks: InspectionRunnerChecks;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fail-closed shape guard for runner evidence: version 2, ok:true, matching
 * operation, a valid operation-specific result, and a complete check set with
 * every isolation property present. Loopback/external verdicts must already
 * report isolation; the host independently confirms the loopback side.
 */
export function isInspectionRunnerEvidence(
  value: unknown,
  operation: SandboxV2OperationName,
): value is InspectionRunnerEvidence {
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
    checks.projectReadOnly === true &&
    typeof checks.loopbackConnectSucceeded === "boolean" &&
    checks.externalIsolated === true &&
    typeof checks.externalError === "string"
  );
}