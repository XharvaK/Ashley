import type { DatabaseSync } from "node:sqlite";
import { capabilityCanInfluence } from "../../rollout/capabilities.js";
import type { V2ProjectReadRegistry } from "../../sandbox/project-registry.js";
import { commandCodeWorkerReadiness } from "../../sandbox/worker/command-code-worker.js";
import type { CapabilityReality } from "../types.js";

/**
 * Private, neutral solvability preflight for official modification cases.
 *
 * POSSIBILITY ONLY. It composes the SAME ordinary runtime owners the live
 * path uses — the capability projection, the selected-backend readiness
 * owner, the operator registry, and the capability influence gates — and
 * never executes a semantic solution, never chooses or suggests an
 * operation or sequence, and never contributes anything to Thought input.
 * The qualification harness owns dispatch; this module only decides whether
 * an official modification case may become VALID before that dispatch.
 */

export type PreflightCheckStatus = "pass" | "fail" | "not_applicable";

export type SolvabilityPreflightCheck = {
  id: string;
  status: PreflightCheckStatus;
  /** Bounded mechanical detail; never an operation hint or expected sequence. */
  detail?: string;
};

export type SolvabilityPreflightResult = {
  solvable: boolean;
  checks: readonly SolvabilityPreflightCheck[];
  blockers: readonly string[];
};

export type SolvabilityPreflightInput = {
  candidateIdentity: { head: string; tree: string };
  workerIdentity: { backend: string; profile: string; pinnedVersion: string };
  resourceIdentity: { hostMaxSteps: number; cliMaxTurns: number } | null;
  db: DatabaseSync;
  registry: V2ProjectReadRegistry;
  /** Built by the ordinary capability projection owner — never approximated. */
  capabilityReality: CapabilityReality;
  projectId: string;
  /** Workspace acquisition receipt from the harness-owned WorkspaceManager. */
  workspace: { workspaceId: string; workspaceTreeRoot: string } | null;
  worker: {
    workerEnabled: boolean;
    apiKey: string;
    binaryPath: string;
    pinnedVersion: string;
    bubblewrapPath: string;
    nodeExecutable?: string;
  };
  recipeId: string | null;
  masterMode: "observe" | "apply";
  lifecycleEnabled: boolean;
  controls: {
    interruptionRevocationDeclared: boolean;
    boundsClosureDeclared: boolean;
    evidenceCaptureDeclared: boolean;
  };
};

function influence(db: DatabaseSync, name: Parameters<typeof capabilityCanInfluence>[1], masterMode: "observe" | "apply"): boolean {
  try {
    return capabilityCanInfluence(db, name, masterMode) === true;
  } catch {
    return false;
  }
}

export function evaluateModificationSolvability(
  input: SolvabilityPreflightInput,
): SolvabilityPreflightResult {
  const checks: SolvabilityPreflightCheck[] = [];

  checks.push({
    id: "candidate_identity_frozen",
    status: typeof input.candidateIdentity.head === "string" && input.candidateIdentity.head.length > 0 &&
      typeof input.candidateIdentity.tree === "string" && input.candidateIdentity.tree.length > 0
      ? "pass"
      : "fail",
    ...(typeof input.candidateIdentity.head === "string" ? { detail: `head=${input.candidateIdentity.head}` } : { detail: "head_missing" }),
  });

  const develop = input.capabilityReality.operationCapabilities?.find(
    (row) => row.operationKind === "candidate.develop",
  );
  checks.push({
    id: "authoring_capability_catalogued",
    status: develop ? "pass" : "fail",
    ...(develop ? {} : { detail: "candidate.develop absent from ordinary catalogue" }),
  });

  const targetAuthorized = Boolean(
    develop && input.projectId &&
    develop.authorizedProjectIds.includes(input.projectId),
  );
  checks.push({
    id: "candidate_develop_offerable_for_target",
    status: develop && develop.available === true && targetAuthorized ? "pass" : "fail",
    detail: develop
      ? `available=${develop.available}${develop.unavailableReasons.length > 0 ? ` reasons=${develop.unavailableReasons.join(",")}` : ""}${targetAuthorized ? "" : " target_not_authorized"}`
      : "row_missing",
  });

  const entry = input.registry.list().find((row) => row.projectId === input.projectId);
  const engineeringEffective = Boolean(entry && entry.enabled && entry.engineeringAllowed === true);
  const workspaceGrantEffective = Boolean(entry && entry.enabled && entry.candidateWorkspaceAllowed === true);
  const experimentationInfluence = influence(input.db, "project_experimentation", input.masterMode);
  checks.push({
    id: "engineering_authority_effective",
    status: engineeringEffective && workspaceGrantEffective && experimentationInfluence && input.lifecycleEnabled
      ? "pass"
      : "fail",
    detail: `engineering=${engineeringEffective} workspace=${workspaceGrantEffective} influence=${experimentationInfluence} lifecycle=${input.lifecycleEnabled}`,
  });

  const authorshipInfluence = influence(input.db, "candidate_authorship", input.masterMode);
  checks.push({
    id: "authorship_status_recorded",
    status: "not_applicable",
    detail: `candidate_authorship_influence=${authorshipInfluence}`,
  });

  const workspaceBound = Boolean(
    input.workspace &&
    input.workspace.workspaceId.length > 0 &&
    input.workspace.workspaceTreeRoot.length > 0 &&
    entry?.canonicalRoot,
  );
  checks.push({
    id: "candidate_workspace_bound",
    status: workspaceBound ? "pass" : "fail",
    ...(input.workspace ? { detail: `workspaceId=${input.workspace.workspaceId}` } : { detail: "workspace_not_acquired" }),
  });

  const readiness = commandCodeWorkerReadiness(input.worker);
  checks.push({
    id: "selected_develop_backend_ready",
    status: input.workerIdentity.backend === "command_code" && input.workerIdentity.profile === "develop" && readiness.ready
      ? "pass"
      : "fail",
    detail: `backend=${input.workerIdentity.backend} ready=${readiness.ready}${readiness.reason ? ` reason=${readiness.reason}` : ""}`,
  });

  checks.push({
    id: "engineering_quota_offerable",
    status: "not_applicable",
    detail: "selected command_code develop backend has no quota owner; no quota fact is claimed",
  });

  const verifyRow = input.capabilityReality.operationCapabilities?.find(
    (row) => row.operationKind === "workspace.verify",
  );
  const recipeBound = Boolean(
    input.recipeId &&
    entry &&
    entry.enabled &&
    entry.verificationAllowed === true &&
    (entry.allowedRecipeIds ?? []).includes(input.recipeId) &&
    workspaceBound,
  );
  checks.push({
    id: "verification_capability_recipe_bound",
    status: Boolean(verifyRow && verifyRow.available) && recipeBound &&
      influence(input.db, "candidate_verification", input.masterMode)
      ? "pass"
      : "fail",
    detail: `verify_available=${Boolean(verifyRow?.available)} recipe_bound=${recipeBound}${input.recipeId ? ` recipeId=${input.recipeId}` : " recipeId_missing"}`,
  });

  checks.push({
    id: "interruption_revocation_controls",
    status: input.controls.interruptionRevocationDeclared ? "pass" : "fail",
  });
  checks.push({
    id: "evidence_capture_active",
    status: input.controls.evidenceCaptureDeclared ? "pass" : "fail",
  });
  checks.push({
    id: "bounds_closure_declared",
    status: input.controls.boundsClosureDeclared && input.resourceIdentity !== null &&
      input.resourceIdentity.hostMaxSteps > 0 && input.resourceIdentity.cliMaxTurns > 0
      ? "pass"
      : "fail",
  });

  const blockers = checks
    .filter((check) => check.status === "fail")
    .map((check) => check.id);
  return { solvable: blockers.length === 0, checks, blockers };
}
