/**
 * Sandbox V2 typed-capability dispatcher (Sandbox V2 M2).
 *
 * One coherent seam: a caller hands a typed `SandboxV2Request` naming one
 * closed operation; the dispatcher routes to the capability handler for that
 * operation. Unknown operations, deferred (known-but-unsupported) operations,
 * and malformed envelopes fail closed with a typed result — never a silent
 * unknown, never a partial implementation.
 *
 * Environment seams are injectable so unit tests can script runners on any
 * host; the real production wiring always uses the real Bubblewrap substrate
 * and the frozen M1 kernel.
 */

import { executeProjectInspection, type ProjectInspectionExecutorOptions } from
  "./project-inspection/executor.js";
import { handleFileRoundtripV2, type M1RoundtripExecutorOptions } from
  "./adapters/m1-roundtrip.js";
import { executeWorkspaceExperiment, type WorkspaceExperimentSpawn } from
  "./workspace/executor.js";
import {
  executeCandidateVerification,
  type VerificationSpawn,
} from "./verification/executor.js";
import {
  executeCandidateAuthorship,
} from "./authorship/executor.js";
import {
  isM5ApplyForbiddenOperation,
  refuseApplyCandidateChangeSet,
} from "./authorship/apply.js";
import {
  isForbiddenM7Profile,
  refuseUnadmittedM7Profile,
} from "./export/forbidden.js";
import { executePatchExport } from "./export/executor.js";
import type { RecipeCatalog } from "./verification/recipe-catalog.js";
import { v2CapabilitySpec, V2_DEFERRED_OPERATIONS, SANDBOX_V2_OPERATION_NAMES, isSandboxV2Request } from
  "./v2-types.js";
import type { V2ProjectReadRegistry } from "./registry.js";
import type { SandboxV2Request, SandboxV2Result } from "./v2-types.js";
import type { ProtectedRootsConfig } from "@composer-assistant/sandbox-policy";

export type SandboxV2Environment = {
  registry: V2ProjectReadRegistry;
  protectedRoots?: ProtectedRootsConfig;
  /** Overrides substrate availability (default: real host probe). */
  sandboxAvailable?: () => boolean;
  /** Overrides the inspection spawner (tests inject a scripted runner). */
  spawnInspection?: ProjectInspectionExecutorOptions["spawnRunner"];
  /** Overrides the workspace experiment spawner. */
  spawnWorkspace?: WorkspaceExperimentSpawn;
  /**
   * Overrides the M4 verification spawner. Must not fall back to the M3
   * writable workspace spawn seam.
   */
  spawnVerification?: VerificationSpawn;
  recipeCatalog?: RecipeCatalog;
  /** Workspace manager override. */
  workspaceManager?: import("./workspace/workspace-manager.js").WorkspaceManager;
  managedWorkspaceRoot?: string;
  /** Overrides the sanitized view builder (tests map POSIX roots on any host). */
  viewBuilder?: ProjectInspectionExecutorOptions["viewBuilder"];
  /** Overrides the roundtrip executor (tests inject a fake M1). */
  roundtripExecutor?: M1RoundtripExecutorOptions["executor"];
  /** Inspection timeout override. */
  timeoutMs?: number;
  /** Absolute preparation cutoff supplied by the owning turn plan (M2 only). */
  projectInspectionPreparationDeadlineAtMs?: number;
  /** Absolute child-execution cutoff supplied by the owning turn plan. */
  childExecutionDeadlineAtMs?: number;
  /** Absolute child termination-acknowledgement cutoff supplied by the turn plan. */
  childTerminationDeadlineAtMs?: number;
  /** Absolute acquisition/validation/cleanup settlement cutoff. */
  settlementDeadlineAtMs?: number;
  /** Deterministic test seam for deadline enforcement. */
  clock?: { nowMs(): number };
  /** Recovery provenance only. Grants no workspace authority. */
  originChildTaskId?: string;
};

export type SandboxV2DispatchOptions = {
  env: SandboxV2Environment;
};

export class SandboxV2Dispatcher {
  private readonly env: SandboxV2Environment;

  constructor(options: SandboxV2DispatchOptions) {
    this.env = options.env;
  }

  async dispatch(request: unknown): Promise<SandboxV2Result> {
    const executedAtMs = Date.now();
    const fail = (operation: string, error: string): SandboxV2Result => ({
      outcome: "failed",
      operation,
      error,
      executedAtMs,
    });

    if (typeof request !== "object" || request === null) return fail("unknown", "invalid-request");
    const envelope = request as Record<string, unknown>;
    if (envelope.version !== 2 || typeof envelope.operation !== "string") {
      return fail("unknown", "invalid-request");
    }
    if (isM5ApplyForbiddenOperation(envelope.operation)) {
      return fail(envelope.operation, refuseApplyCandidateChangeSet().error);
    }
    if (isForbiddenM7Profile(envelope.operation)) {
      return fail(envelope.operation, refuseUnadmittedM7Profile().error);
    }
    if (V2_DEFERRED_OPERATIONS.includes(envelope.operation)) {
      return fail(envelope.operation, "unsupported_operation");
    }
    if (!SANDBOX_V2_OPERATION_NAMES.includes(envelope.operation)) {
      return fail(envelope.operation, "unknown_operation");
    }
    if (!isSandboxV2Request(request)) return fail(envelope.operation, "invalid-request");

    const spec = v2CapabilitySpec(request.operation);
    if (spec === undefined) return fail(request.operation, "unknown_operation");
    if (
      request.operation === "project.read_file" ||
      request.operation === "project.list_directory" ||
      request.operation === "project.search_text"
    ) {
      const { registry, protectedRoots } = this.env;
      return executeProjectInspection(request, {
        registry,
        protectedRoots,
        available: this.env.sandboxAvailable,
        spawnRunner: this.env.spawnInspection,
        viewBuilder: this.env.viewBuilder,
        timeoutMs: this.env.timeoutMs,
        projectInspectionPreparationDeadlineAtMs:
          this.env.projectInspectionPreparationDeadlineAtMs,
        childExecutionDeadlineAtMs: this.env.childExecutionDeadlineAtMs,
        childTerminationDeadlineAtMs: this.env.childTerminationDeadlineAtMs,
        settlementDeadlineAtMs: this.env.settlementDeadlineAtMs,
        clock: this.env.clock,
      });
    }
    if (request.operation === "file.roundtrip") {
      return handleFileRoundtripV2(request, {
        executor: this.env.roundtripExecutor,
        available: this.env.sandboxAvailable,
        childExecutionDeadlineAtMs: this.env.childExecutionDeadlineAtMs,
        childTerminationDeadlineAtMs: this.env.childTerminationDeadlineAtMs,
        settlementDeadlineAtMs: this.env.settlementDeadlineAtMs,
        clock: this.env.clock,
      });
    }
    if (
      request.operation === "workspace.read_file" ||
      request.operation === "workspace.list_directory" ||
      request.operation === "workspace.search_text" ||
      request.operation === "workspace.write_file" ||
      request.operation === "workspace.replace_file" ||
      request.operation === "workspace.edit_text" ||
      request.operation === "workspace.delete_file" ||
      request.operation === "workspace.create_directory"
    ) {
      const { registry, protectedRoots } = this.env;
      return executeWorkspaceExperiment(request, {
        registry,
        protectedRoots,
        available: this.env.sandboxAvailable,
        spawnRunner: this.env.spawnWorkspace ?? this.env.spawnInspection,
        workspaceManager: this.env.workspaceManager,
        managedWorkspaceRoot: this.env.managedWorkspaceRoot,
        timeoutMs: this.env.timeoutMs,
        childExecutionDeadlineAtMs: this.env.childExecutionDeadlineAtMs,
        childTerminationDeadlineAtMs: this.env.childTerminationDeadlineAtMs,
        settlementDeadlineAtMs: this.env.settlementDeadlineAtMs,
        clock: this.env.clock,
        originChildTaskId: this.env.originChildTaskId,
      });
    }
    if (request.operation === "workspace.verify") {
      const { registry, protectedRoots } = this.env;
      return executeCandidateVerification(request, {
        registry,
        protectedRoots,
        available: this.env.sandboxAvailable,
        spawnVerification: this.env.spawnVerification,
        workspaceManager: this.env.workspaceManager,
        managedWorkspaceRoot: this.env.managedWorkspaceRoot,
        recipeCatalog: this.env.recipeCatalog,
        timeoutMs: this.env.timeoutMs,
        childExecutionDeadlineAtMs: this.env.childExecutionDeadlineAtMs,
        childTerminationDeadlineAtMs: this.env.childTerminationDeadlineAtMs,
        settlementDeadlineAtMs: this.env.settlementDeadlineAtMs,
        clock: this.env.clock,
      });
    }
    if (request.operation === "changeset.author") {
      const { registry, protectedRoots } = this.env;
      return executeCandidateAuthorship(request, {
        registry,
        protectedRoots,
        workspaceManager: this.env.workspaceManager,
        managedWorkspaceRoot: this.env.managedWorkspaceRoot,
        viewBuilder: this.env.viewBuilder,
        settlementDeadlineAtMs: this.env.settlementDeadlineAtMs,
        clock: this.env.clock,
      });
    }
    if (request.operation === "patch_export") {
      return executePatchExport(request, {
        registry: this.env.registry,
        clock: this.env.clock,
      });
    }
    return fail(request.operation, "unknown_operation");
  }
}
