export type M6PermittedStepKind =
  | "candidate_workspace_experiment"
  | "candidate_verification"
  | "candidate_authorship";

export type M6StopReason =
  | "succeeded"
  | "step_failed"
  | "budget_exhausted"
  | "deadline_exceeded"
  | "cancelled"
  | "authority_lost"
  | "m7_effect_forbidden"
  | "unpermitted_operation"
  | "operation_ceiling_exceeded"
  | "empty_sequence"
  | "unbounded_continue_forbidden"
  | "objective_admission_denied"
  | "repeated_non_progress"
  | "cleanup_failure";

export type M6StepSpec = {
  kind: string;
  operation?: string;
};

export type M6StepExecution = {
  ok: boolean;
  error?: string;
  mutatedCandidate?: boolean;
};

export type M6StepRecord = {
  index: number;
  kind: string;
  operation?: string;
  outcome: "succeeded" | "failed" | "skipped";
  error?: string;
};

export type M6ControllerResult = {
  stopReason: M6StopReason;
  stepsExecuted: number;
  stepRecords: readonly M6StepRecord[];
  borderState: "none";
};
