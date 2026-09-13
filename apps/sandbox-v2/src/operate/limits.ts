/**
 * Hard ceilings for Sandbox V2 M6 bounded operation.
 * The model cannot raise these. Admission that exceeds them is refused.
 */
export const M6_MAX_STEPS = 8;
export const M6_MAX_OBJECTIVE_CHARS = 500;
export const M6_MAX_CONDITION_CHARS = 500;
export const M6_MAX_WALL_MS = 15 * 60 * 1000;

export const M6_PERMITTED_STEP_KINDS = [
  "candidate_workspace_experiment",
  "candidate_verification",
  "candidate_authorship",
] as const;

export const M6_FORBIDDEN_EFFECT_OPERATIONS = [
  "patch_export",
  "live_apply",
  "changeset.apply",
  "changeset.merge",
  "git.commit",
  "git.push",
  "git.branch",
  "deploy",
  "restart",
  "package.install",
  "network.request",
] as const;
