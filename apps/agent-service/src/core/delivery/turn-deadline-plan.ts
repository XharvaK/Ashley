export type TurnDeadlineBranchKind =
  | "ordinary"
  | "sandbox_m1"
  | "project_inspection"
  | "candidate_workspace_experiment"
  | "candidate_verification"
  | "candidate_authorship";

export type ProjectInspectionOperation =
  | "project.read_file"
  | "project.list_directory"
  | "project.search_text";

export type CandidateWorkspaceOperation =
  | "workspace.read_file"
  | "workspace.list_directory"
  | "workspace.search_text"
  | "workspace.write_file"
  | "workspace.replace_file"
  | "workspace.edit_text"
  | "workspace.delete_file"
  | "workspace.create_directory";

type GenerationPolicy = {
  perceptionMs: number;
  expressionMs: number;
  generationSettlementMs: number;
};

type OperationalPolicy<TOperation extends string> = GenerationPolicy & {
  childExecutionMs: Readonly<Record<TOperation, number>>;
  acquisitionSettlementMs: number;
  cleanupReserveMs: number;
  continuationMs: number;
};

type AvailableWorkspacePolicy = OperationalPolicy<CandidateWorkspaceOperation> & {
  available: true;
};

type UnavailableWorkspacePolicy = {
  available: false;
  unavailableReason: string;
};

type AvailableVerificationPolicy = GenerationPolicy & {
  available: true;
  childExecutionMs: number;
  acquisitionSettlementMs: number;
  cleanupReserveMs: number;
  continuationMs: number;
};

export type TurnDeadlinePolicy = {
  version: string;
  qualification: "unqualified" | "test_only" | "qualified";
  softResponsivenessTargetMs: number;
  initialThoughtMs: number;
  externalTransportMs: number;
  firstBubbleReceiptReserveMs: number;
  finalDeliveryReserveMs: number;
  ordinary: GenerationPolicy;
  sandboxM1: GenerationPolicy & {
    childExecutionMs: number;
    acquisitionSettlementMs: number;
    cleanupReserveMs: number;
  };
  projectInspection: OperationalPolicy<ProjectInspectionOperation> & {
    projectInspectionPreparationMs: number;
  };
  candidateWorkspaceExperiment:
    | AvailableWorkspacePolicy
    | UnavailableWorkspacePolicy;
  /**
   * M4 candidate verification. Default unavailable: implemented != available.
   * Absence is treated as available: false.
   */
  candidateVerification?:
    | AvailableVerificationPolicy
    | UnavailableWorkspacePolicy;
  /**
   * M5 candidate authorship. Default unavailable: implemented != available.
   * Absence is treated as available: false.
   */
  candidateAuthorship?:
    | AvailableVerificationPolicy
    | UnavailableWorkspacePolicy;
};

export type TurnDeadlineCommon = Readonly<{
  softResponsivenessTargetAtMs: number;
  initialThoughtDeadlineAtMs: number;
  externalTransportHardDeadlineAtMs: number;
  firstBubbleReceiptDeadlineAtMs: number;
  reservationHardDeadlineAtMs: number;
}>;

export type OrdinaryTurnDeadlineBranch = Readonly<{
  kind: "ordinary";
  available: true;
  perceptionDeadlineAtMs: number;
  expressionDeadlineAtMs: number;
  generationDeadlineAtMs: number;
}>;

export type SandboxM1TurnDeadlineBranch = Readonly<{
  kind: "sandbox_m1";
  available: true;
  childExecutionDeadlineAtMs: number;
  childTerminationDeadlineAtMs: number;
  acquisitionSettlementDeadlineAtMs: number;
  perceptionDeadlineAtMs: number;
  expressionDeadlineAtMs: number;
  generationDeadlineAtMs: number;
}>;

export type ProjectInspectionTurnDeadlineBranch = Readonly<{
  kind: "project_inspection";
  available: true;
  projectInspectionPreparationDeadlineAtMs: number;
  childExecutionDeadlineAtMs: Readonly<Record<ProjectInspectionOperation, number>>;
  childTerminationDeadlineAtMs: number;
  acquisitionSettlementDeadlineAtMs: number;
  continuationDeadlineAtMs: number;
  perceptionDeadlineAtMs: number;
  expressionDeadlineAtMs: number;
  generationDeadlineAtMs: number;
}>;

export type CandidateWorkspaceTurnDeadlineBranch =
  | Readonly<{
      kind: "candidate_workspace_experiment";
      available: true;
      childExecutionDeadlineAtMs: Readonly<Record<CandidateWorkspaceOperation, number>>;
      childTerminationDeadlineAtMs: number;
      acquisitionSettlementDeadlineAtMs: number;
      continuationDeadlineAtMs: number;
      perceptionDeadlineAtMs: number;
      expressionDeadlineAtMs: number;
      generationDeadlineAtMs: number;
    }>
  | Readonly<{
      kind: "candidate_workspace_experiment";
      available: false;
      unavailableReason: string;
    }>;

export type CandidateVerificationTurnDeadlineBranch =
  | Readonly<{
      kind: "candidate_verification";
      available: true;
      childExecutionDeadlineAtMs: number;
      childTerminationDeadlineAtMs: number;
      acquisitionSettlementDeadlineAtMs: number;
      continuationDeadlineAtMs: number;
      perceptionDeadlineAtMs: number;
      expressionDeadlineAtMs: number;
      generationDeadlineAtMs: number;
    }>
  | Readonly<{
      kind: "candidate_verification";
      available: false;
      unavailableReason: string;
    }>;

export type CandidateAuthorshipTurnDeadlineBranch =
  | Readonly<{
      kind: "candidate_authorship";
      available: true;
      childExecutionDeadlineAtMs: number;
      childTerminationDeadlineAtMs: number;
      acquisitionSettlementDeadlineAtMs: number;
      continuationDeadlineAtMs: number;
      perceptionDeadlineAtMs: number;
      expressionDeadlineAtMs: number;
      generationDeadlineAtMs: number;
    }>
  | Readonly<{
      kind: "candidate_authorship";
      available: false;
      unavailableReason: string;
    }>;

export type TurnDeadlineBranch =
  | OrdinaryTurnDeadlineBranch
  | SandboxM1TurnDeadlineBranch
  | ProjectInspectionTurnDeadlineBranch
  | CandidateWorkspaceTurnDeadlineBranch
  | CandidateVerificationTurnDeadlineBranch
  | CandidateAuthorshipTurnDeadlineBranch;

export type AvailableTurnDeadlineBranch =
  | OrdinaryTurnDeadlineBranch
  | SandboxM1TurnDeadlineBranch
  | ProjectInspectionTurnDeadlineBranch
  | Extract<CandidateWorkspaceTurnDeadlineBranch, { available: true }>
  | Extract<CandidateVerificationTurnDeadlineBranch, { available: true }>
  | Extract<CandidateAuthorshipTurnDeadlineBranch, { available: true }>;

type AvailableBranchByKind = {
  ordinary: OrdinaryTurnDeadlineBranch;
  sandbox_m1: SandboxM1TurnDeadlineBranch;
  project_inspection: ProjectInspectionTurnDeadlineBranch;
  candidate_workspace_experiment: Extract<
    CandidateWorkspaceTurnDeadlineBranch,
    { available: true }
  >;
  candidate_verification: Extract<
    CandidateVerificationTurnDeadlineBranch,
    { available: true }
  >;
  candidate_authorship: Extract<
    CandidateAuthorshipTurnDeadlineBranch,
    { available: true }
  >;
};

export type TurnDeadlinePlan = Readonly<{
  version: string;
  qualification: TurnDeadlinePolicy["qualification"];
  admittedAtMs: number;
  common: TurnDeadlineCommon;
  branches: Readonly<{
    ordinary: OrdinaryTurnDeadlineBranch;
    sandbox_m1: SandboxM1TurnDeadlineBranch;
    project_inspection: ProjectInspectionTurnDeadlineBranch;
    candidate_workspace_experiment: CandidateWorkspaceTurnDeadlineBranch;
    candidate_verification: CandidateVerificationTurnDeadlineBranch;
    candidate_authorship: CandidateAuthorshipTurnDeadlineBranch;
  }>;
}>;

export type TurnDeadlinePlanOptions = {
  /** Bot-owned absolute HTTP transport cutoff for a real Discord turn. */
  externalTransportHardDeadlineAtMs?: number;
};

const PROJECT_INSPECTION_OPERATIONS: readonly ProjectInspectionOperation[] = [
  "project.read_file",
  "project.list_directory",
  "project.search_text",
];

const CANDIDATE_WORKSPACE_OPERATIONS: readonly CandidateWorkspaceOperation[] = [
  "workspace.read_file",
  "workspace.list_directory",
  "workspace.search_text",
  "workspace.write_file",
  "workspace.replace_file",
  "workspace.edit_text",
  "workspace.delete_file",
  "workspace.create_directory",
];

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function requirePositiveDuration(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`turn_deadline_policy_invalid:${name}`);
  }
}

function operationDeadlines<TOperation extends string>(
  startAtMs: number,
  operations: readonly TOperation[],
  durations: Readonly<Record<TOperation, number>>,
): {
  deadlines: Record<TOperation, number>;
  maxDeadlineAtMs: number;
  minDeadlineAtMs: number;
} {
  const deadlines = {} as Record<TOperation, number>;
  let maxDeadlineAtMs = startAtMs;
  let minDeadlineAtMs = Number.POSITIVE_INFINITY;
  for (const operation of operations) {
    const duration = durations[operation];
    requirePositiveDuration(`childExecutionMs.${operation}`, duration);
    const deadline = startAtMs + duration;
    deadlines[operation] = deadline;
    maxDeadlineAtMs = Math.max(maxDeadlineAtMs, deadline);
    minDeadlineAtMs = Math.min(minDeadlineAtMs, deadline);
  }
  return { deadlines, maxDeadlineAtMs, minDeadlineAtMs };
}

function childTerminationDeadline(
  policyName: string,
  maxChildDeadlineAtMs: number,
  acquisitionSettlementDeadlineAtMs: number,
  cleanupReserveMs: number,
): number {
  requirePositiveDuration(`${policyName}.cleanupReserveMs`, cleanupReserveMs);
  const deadlineAtMs = acquisitionSettlementDeadlineAtMs - cleanupReserveMs;
  if (
    maxChildDeadlineAtMs >= deadlineAtMs ||
    deadlineAtMs >= acquisitionSettlementDeadlineAtMs
  ) {
    throw new Error(`turn_deadline_policy_invalid:${policyName}.termination_order`);
  }
  return deadlineAtMs;
}

function generationDeadlines(
  startAtMs: number,
  policy: GenerationPolicy,
): {
  perceptionDeadlineAtMs: number;
  expressionDeadlineAtMs: number;
  generationDeadlineAtMs: number;
} {
  requirePositiveDuration("perceptionMs", policy.perceptionMs);
  requirePositiveDuration("expressionMs", policy.expressionMs);
  requirePositiveDuration("generationSettlementMs", policy.generationSettlementMs);
  const perceptionDeadlineAtMs = startAtMs + policy.perceptionMs;
  const expressionDeadlineAtMs = perceptionDeadlineAtMs + policy.expressionMs;
  const generationDeadlineAtMs =
    expressionDeadlineAtMs + policy.generationSettlementMs;
  return {
    perceptionDeadlineAtMs,
    expressionDeadlineAtMs,
    generationDeadlineAtMs,
  };
}

function assertGenerationBeforeTransport(
  branch: TurnDeadlineBranch,
  externalTransportHardDeadlineAtMs: number,
): void {
  if (branch.available && "generationDeadlineAtMs" in branch) {
    if (branch.generationDeadlineAtMs >= externalTransportHardDeadlineAtMs) {
      throw new Error(`turn_deadline_policy_invalid:${branch.kind}:transport_reserve`);
    }
  }
}

/**
 * Source-supported timing policy with Mint-physical qualification for
 * mandatory-cleanup reserves and M2 projectInspectionPreparationMs
 * (2026-08-21, host Mint 6.17.0-29-generic, bwrap 0.9.0, 2 cores, ext4 SSD,
 * /tmp). envelope: M2 limits 10k files / 100 MiB / 25 MiB single / depth 32 /
 * path 1024, warm+cold, realistic CPU (1-core) + light-IO pressure. Worst
 * synthetic torture (2 cores + continuous fdatasync) exceeds envelope and
 * remains fail-closed; see qualification packet for full distributions and
 * margin reasoning.
 *
 * Qualified reserves:
 *  - sandboxM1.cleanupReserveMs 500ms Mint-qualified (M1 max 40ms, 12.5×).
 *  - projectInspection.cleanupReserveMs 3500ms Mint-qualified: covers
 *    realistic-pressure max 2672ms with 31% headroom (1.31×), idle max
 *    1143ms with 3.06×, p95 2603→1.34×; tail tight (max-p95 69ms). Worst
 *    synthetic max 4801ms is beyond qualified envelope (would need ~7200ms
 *    reserve → 7700ms settlement, still <120s transport, note only).
 * Termination grace (settlement − reserve): M1 3500ms, M2 500ms, both cover
 * measured termination ack max 31ms combined-loaded (16×/5.6× over 89ms
 * sub-READY tail) and wake tail 15ms (33×); zero unacked at 250ms across
 * 140 probes, 500ms is 2× that proven window.
 *
 * All other budgets reuse prior hard boundaries / incident and remain
 * provisional: 5s soft target, 6s Thought window, 4s guard, 20s Perception,
 * 30s M1 cap, 6s M2 child cap (covers 5.042s tail, still explicitly
 * unqualified for child timing), 120s transport + final delivery.
 *
 * projectInspectionPreparationMs is Mint-qualified 2026-08-21 on the
 * complete pre-dispatch phase (reactive handoff → adapter/dispatcher →
 * validation → registry → substrate preflight → sanitized view →
 * sentinel/FD/env → loopback → positive-control → runner request →
 * pre-dispatch gate). Realistic-pressure max 30112ms with 1.31× → 39447ms.
 * Overall policy qualification stays "unqualified" because child execution
 * and generation budgets are still provisional.
 *
 * The closed M3 branch has no provisional execution budget and cannot be
 * selected while candidateWorkspaceAllowed=false.
 */
export const PROVISIONAL_UNQUALIFIED_TURN_DEADLINE_POLICY: TurnDeadlinePolicy =
  deepFreeze({
    version: "phase-budget-v2-m2-preparation-39447",
    qualification: "unqualified",
    softResponsivenessTargetMs: 5_000,
    initialThoughtMs: 6_000,
    externalTransportMs: 120_000,
    firstBubbleReceiptReserveMs: 5_000,
    finalDeliveryReserveMs: 120_000,
    ordinary: {
      perceptionMs: 20_000,
      expressionMs: 4_000,
      generationSettlementMs: 4_000,
    },
    sandboxM1: {
      childExecutionMs: 30_000,
      acquisitionSettlementMs: 4_000,
      // Mint-qualified 2026-08-21: 500ms covers M1 mandatory post-child path
      // max 40ms (sentinel 39ms) with 12.5×; M1 has no view removal.
      cleanupReserveMs: 500,
      perceptionMs: 20_000,
      expressionMs: 4_000,
      generationSettlementMs: 4_000,
    },
    projectInspection: {
      // Mint-qualified 2026-08-21: complete-phase realistic-pressure max
      // 30112ms (worst-combined, 1 CPU + light IO), p95 30112, idle max
      // 20410; 39447ms is ceil(30112 × 1.31) — same host multiplier as the
      // accepted M2 cleanup reserve — 9335ms / 1.31× over observed max.
      projectInspectionPreparationMs: 39_447,
      childExecutionMs: {
        "project.read_file": 6_000,
        "project.list_directory": 6_000,
        "project.search_text": 6_000,
      },
      acquisitionSettlementMs: 4_000,
      // Mint-qualified 2026-08-21: 3500ms covers realistic-pressure M2 cleanup
      // max 2672ms (1.31×), p95 2603 (1.34×), idle max 1143 (3.06×). Worst
      // synthetic torture max 4801ms exceeds envelope (see packet § residual).
      cleanupReserveMs: 3500,
      continuationMs: 6_000,
      perceptionMs: 20_000,
      expressionMs: 4_000,
      generationSettlementMs: 4_000,
    },
  candidateWorkspaceExperiment: {
    available: true,
    childExecutionMs: {
      "workspace.read_file": 6_000,
      "workspace.list_directory": 6_000,
      "workspace.search_text": 6_000,
      "workspace.write_file": 6_000,
      "workspace.replace_file": 6_000,
      "workspace.edit_text": 6_000,
      "workspace.delete_file": 6_000,
      "workspace.create_directory": 6_000,
    },
    acquisitionSettlementMs: 4_000,
    cleanupReserveMs: 1_000,
    continuationMs: 6_000,
    perceptionMs: 20_000,
    expressionMs: 4_000,
    generationSettlementMs: 4_000,
  },
  candidateVerification: {
    available: true,
    childExecutionMs: 6_000,
    acquisitionSettlementMs: 4_000,
    cleanupReserveMs: 1_000,
    continuationMs: 6_000,
    perceptionMs: 20_000,
    expressionMs: 4_000,
    generationSettlementMs: 4_000,
  },
  candidateAuthorship: {
    available: true,
    childExecutionMs: 6_000,
    acquisitionSettlementMs: 4_000,
    cleanupReserveMs: 1_000,
    continuationMs: 6_000,
    perceptionMs: 20_000,
    expressionMs: 4_000,
    generationSettlementMs: 4_000,
  },
});

export function createTurnDeadlinePlan(
  admittedAtMs: number,
  policy: TurnDeadlinePolicy = PROVISIONAL_UNQUALIFIED_TURN_DEADLINE_POLICY,
  options: TurnDeadlinePlanOptions = {},
): TurnDeadlinePlan {
  if (!Number.isFinite(admittedAtMs)) {
    throw new Error("turn_deadline_admitted_at_invalid");
  }
  for (const [name, value] of Object.entries({
    softResponsivenessTargetMs: policy.softResponsivenessTargetMs,
    initialThoughtMs: policy.initialThoughtMs,
    externalTransportMs: policy.externalTransportMs,
    firstBubbleReceiptReserveMs: policy.firstBubbleReceiptReserveMs,
    finalDeliveryReserveMs: policy.finalDeliveryReserveMs,
  })) {
    requirePositiveDuration(name, value);
  }
  if (policy.initialThoughtMs >= policy.externalTransportMs) {
    throw new Error("turn_deadline_policy_invalid:common_order");
  }

  const externalTransportHardDeadlineAtMs =
    options.externalTransportHardDeadlineAtMs ??
    admittedAtMs + policy.externalTransportMs;
  const receiptReserveMs = policy.firstBubbleReceiptReserveMs;
  const finalDeliveryReserveMs = policy.finalDeliveryReserveMs;
  if (
    !Number.isFinite(externalTransportHardDeadlineAtMs) ||
    externalTransportHardDeadlineAtMs <= admittedAtMs + policy.initialThoughtMs
  ) {
    throw new Error("turn_deadline_policy_invalid:external_transport_cutoff");
  }

  const common: TurnDeadlineCommon = {
    softResponsivenessTargetAtMs:
      admittedAtMs + policy.softResponsivenessTargetMs,
    initialThoughtDeadlineAtMs: admittedAtMs + policy.initialThoughtMs,
    externalTransportHardDeadlineAtMs,
    firstBubbleReceiptDeadlineAtMs:
      externalTransportHardDeadlineAtMs + receiptReserveMs,
    reservationHardDeadlineAtMs:
      externalTransportHardDeadlineAtMs +
      receiptReserveMs +
      finalDeliveryReserveMs,
  };

  const ordinary: OrdinaryTurnDeadlineBranch = {
    kind: "ordinary",
    available: true,
    ...generationDeadlines(common.initialThoughtDeadlineAtMs, policy.ordinary),
  };

  requirePositiveDuration("sandboxM1.childExecutionMs", policy.sandboxM1.childExecutionMs);
  requirePositiveDuration(
    "sandboxM1.acquisitionSettlementMs",
    policy.sandboxM1.acquisitionSettlementMs,
  );
  const m1ChildDeadlineAtMs =
    common.initialThoughtDeadlineAtMs + policy.sandboxM1.childExecutionMs;
  const m1SettlementDeadlineAtMs =
    m1ChildDeadlineAtMs + policy.sandboxM1.acquisitionSettlementMs;
  const m1TerminationDeadlineAtMs = childTerminationDeadline(
    "sandboxM1",
    m1ChildDeadlineAtMs,
    m1SettlementDeadlineAtMs,
    policy.sandboxM1.cleanupReserveMs,
  );
  const sandboxM1: SandboxM1TurnDeadlineBranch = {
    kind: "sandbox_m1",
    available: true,
    childExecutionDeadlineAtMs: m1ChildDeadlineAtMs,
    childTerminationDeadlineAtMs: m1TerminationDeadlineAtMs,
    acquisitionSettlementDeadlineAtMs: m1SettlementDeadlineAtMs,
    ...generationDeadlines(m1SettlementDeadlineAtMs, policy.sandboxM1),
  };

  requirePositiveDuration(
    "projectInspection.projectInspectionPreparationMs",
    policy.projectInspection.projectInspectionPreparationMs,
  );
  const projectPreparationDeadlineAtMs =
    common.initialThoughtDeadlineAtMs +
    policy.projectInspection.projectInspectionPreparationMs;
  const projectChildren = operationDeadlines(
    projectPreparationDeadlineAtMs,
    PROJECT_INSPECTION_OPERATIONS,
    policy.projectInspection.childExecutionMs,
  );
  if (projectChildren.minDeadlineAtMs <= projectPreparationDeadlineAtMs) {
    throw new Error(
      "turn_deadline_policy_invalid:projectInspection.preparation_order",
    );
  }
  requirePositiveDuration(
    "projectInspection.acquisitionSettlementMs",
    policy.projectInspection.acquisitionSettlementMs,
  );
  requirePositiveDuration(
    "projectInspection.continuationMs",
    policy.projectInspection.continuationMs,
  );
  const projectSettlementDeadlineAtMs =
    projectChildren.maxDeadlineAtMs +
    policy.projectInspection.acquisitionSettlementMs;
  const projectTerminationDeadlineAtMs = childTerminationDeadline(
    "projectInspection",
    projectChildren.maxDeadlineAtMs,
    projectSettlementDeadlineAtMs,
    policy.projectInspection.cleanupReserveMs,
  );
  const projectContinuationDeadlineAtMs =
    projectSettlementDeadlineAtMs + policy.projectInspection.continuationMs;
  const projectInspection: ProjectInspectionTurnDeadlineBranch = {
    kind: "project_inspection",
    available: true,
    projectInspectionPreparationDeadlineAtMs: projectPreparationDeadlineAtMs,
    childExecutionDeadlineAtMs: projectChildren.deadlines,
    childTerminationDeadlineAtMs: projectTerminationDeadlineAtMs,
    acquisitionSettlementDeadlineAtMs: projectSettlementDeadlineAtMs,
    continuationDeadlineAtMs: projectContinuationDeadlineAtMs,
    ...generationDeadlines(
      projectContinuationDeadlineAtMs,
      policy.projectInspection,
    ),
  };

  let candidateWorkspaceExperiment: CandidateWorkspaceTurnDeadlineBranch;
  if (!policy.candidateWorkspaceExperiment.available) {
    candidateWorkspaceExperiment = {
      kind: "candidate_workspace_experiment",
      available: false,
      unavailableReason:
        policy.candidateWorkspaceExperiment.unavailableReason.slice(0, 64),
    };
  } else {
    const workspaceChildren = operationDeadlines(
      common.initialThoughtDeadlineAtMs,
      CANDIDATE_WORKSPACE_OPERATIONS,
      policy.candidateWorkspaceExperiment.childExecutionMs,
    );
    requirePositiveDuration(
      "candidateWorkspace.acquisitionSettlementMs",
      policy.candidateWorkspaceExperiment.acquisitionSettlementMs,
    );
    requirePositiveDuration(
      "candidateWorkspace.continuationMs",
      policy.candidateWorkspaceExperiment.continuationMs,
    );
    const workspaceSettlementDeadlineAtMs =
      workspaceChildren.maxDeadlineAtMs +
      policy.candidateWorkspaceExperiment.acquisitionSettlementMs;
    const workspaceTerminationDeadlineAtMs = childTerminationDeadline(
      "candidateWorkspace",
      workspaceChildren.maxDeadlineAtMs,
      workspaceSettlementDeadlineAtMs,
      policy.candidateWorkspaceExperiment.cleanupReserveMs,
    );
    const workspaceContinuationDeadlineAtMs =
      workspaceSettlementDeadlineAtMs +
      policy.candidateWorkspaceExperiment.continuationMs;
    candidateWorkspaceExperiment = {
      kind: "candidate_workspace_experiment",
      available: true,
      childExecutionDeadlineAtMs: workspaceChildren.deadlines,
      childTerminationDeadlineAtMs: workspaceTerminationDeadlineAtMs,
      acquisitionSettlementDeadlineAtMs: workspaceSettlementDeadlineAtMs,
      continuationDeadlineAtMs: workspaceContinuationDeadlineAtMs,
      ...generationDeadlines(
        workspaceContinuationDeadlineAtMs,
        policy.candidateWorkspaceExperiment,
      ),
    };
  }

  const verificationPolicy = policy.candidateVerification ?? {
    available: false as const,
    unavailableReason: "candidate_verification_unqualified",
  };
  let candidateVerification: CandidateVerificationTurnDeadlineBranch;
  if (!verificationPolicy.available) {
    candidateVerification = {
      kind: "candidate_verification",
      available: false,
      unavailableReason: verificationPolicy.unavailableReason.slice(0, 64),
    };
  } else {
    requirePositiveDuration(
      "candidateVerification.childExecutionMs",
      verificationPolicy.childExecutionMs,
    );
    requirePositiveDuration(
      "candidateVerification.acquisitionSettlementMs",
      verificationPolicy.acquisitionSettlementMs,
    );
    requirePositiveDuration(
      "candidateVerification.continuationMs",
      verificationPolicy.continuationMs,
    );
    const verificationChildDeadlineAtMs =
      common.initialThoughtDeadlineAtMs + verificationPolicy.childExecutionMs;
    const verificationSettlementDeadlineAtMs =
      verificationChildDeadlineAtMs + verificationPolicy.acquisitionSettlementMs;
    const verificationTerminationDeadlineAtMs = childTerminationDeadline(
      "candidateVerification",
      verificationChildDeadlineAtMs,
      verificationSettlementDeadlineAtMs,
      verificationPolicy.cleanupReserveMs,
    );
    const verificationContinuationDeadlineAtMs =
      verificationSettlementDeadlineAtMs + verificationPolicy.continuationMs;
    candidateVerification = {
      kind: "candidate_verification",
      available: true,
      childExecutionDeadlineAtMs: verificationChildDeadlineAtMs,
      childTerminationDeadlineAtMs: verificationTerminationDeadlineAtMs,
      acquisitionSettlementDeadlineAtMs: verificationSettlementDeadlineAtMs,
      continuationDeadlineAtMs: verificationContinuationDeadlineAtMs,
      ...generationDeadlines(
        verificationContinuationDeadlineAtMs,
        verificationPolicy,
      ),
    };
  }

  const authorshipPolicy = policy.candidateAuthorship ?? {
    available: false as const,
    unavailableReason: "candidate_authorship_unqualified",
  };
  let candidateAuthorship: CandidateAuthorshipTurnDeadlineBranch;
  if (!authorshipPolicy.available) {
    candidateAuthorship = {
      kind: "candidate_authorship",
      available: false,
      unavailableReason: authorshipPolicy.unavailableReason.slice(0, 64),
    };
  } else {
    requirePositiveDuration(
      "candidateAuthorship.childExecutionMs",
      authorshipPolicy.childExecutionMs,
    );
    requirePositiveDuration(
      "candidateAuthorship.acquisitionSettlementMs",
      authorshipPolicy.acquisitionSettlementMs,
    );
    requirePositiveDuration(
      "candidateAuthorship.continuationMs",
      authorshipPolicy.continuationMs,
    );
    const authorshipChildDeadlineAtMs =
      common.initialThoughtDeadlineAtMs + authorshipPolicy.childExecutionMs;
    const authorshipSettlementDeadlineAtMs =
      authorshipChildDeadlineAtMs + authorshipPolicy.acquisitionSettlementMs;
    const authorshipTerminationDeadlineAtMs = childTerminationDeadline(
      "candidateAuthorship",
      authorshipChildDeadlineAtMs,
      authorshipSettlementDeadlineAtMs,
      authorshipPolicy.cleanupReserveMs,
    );
    const authorshipContinuationDeadlineAtMs =
      authorshipSettlementDeadlineAtMs + authorshipPolicy.continuationMs;
    candidateAuthorship = {
      kind: "candidate_authorship",
      available: true,
      childExecutionDeadlineAtMs: authorshipChildDeadlineAtMs,
      childTerminationDeadlineAtMs: authorshipTerminationDeadlineAtMs,
      acquisitionSettlementDeadlineAtMs: authorshipSettlementDeadlineAtMs,
      continuationDeadlineAtMs: authorshipContinuationDeadlineAtMs,
      ...generationDeadlines(
        authorshipContinuationDeadlineAtMs,
        authorshipPolicy,
      ),
    };
  }

  const branches = {
    ordinary,
    sandbox_m1: sandboxM1,
    project_inspection: projectInspection,
    candidate_workspace_experiment: candidateWorkspaceExperiment,
    candidate_verification: candidateVerification,
    candidate_authorship: candidateAuthorship,
  };
  for (const branch of Object.values(branches)) {
    assertGenerationBeforeTransport(
      branch,
      common.externalTransportHardDeadlineAtMs,
    );
  }

  return deepFreeze({
    version: policy.version.slice(0, 64),
    qualification: policy.qualification,
    admittedAtMs,
    common,
    branches,
  }) as TurnDeadlinePlan;
}

export function selectTurnDeadlineBranch<K extends TurnDeadlineBranchKind>(
  plan: TurnDeadlinePlan,
  kind: K,
):
  | { ok: true; branch: AvailableBranchByKind[K] }
  | { ok: false; reason: string } {
  if (!Object.prototype.hasOwnProperty.call(plan.branches, kind)) {
    return { ok: false, reason: "deadline_branch_unknown" };
  }
  const branch = plan.branches[kind];
  if (!branch.available) {
    return { ok: false, reason: branch.unavailableReason };
  }
  return { ok: true, branch: branch as AvailableBranchByKind[K] };
}
