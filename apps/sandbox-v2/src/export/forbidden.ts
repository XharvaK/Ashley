/**
 * Later M7 profiles and apply-class ops remain refuse-closed in the first
 * patch_export slice. Named effect is not general authority.
 */

export const M7_FORBIDDEN_PROFILES: readonly string[] = [
  "live_apply",
  "git_branch_create",
  "git_commit",
  "git_push",
  "git_pr",
  "package_acquire",
  "package_install",
  "artifact_publish",
  "deploy",
  "restart",
  "network.request",
];

export function refuseUnadmittedM7Profile(): { ok: false; error: "m7_profile_forbidden" } {
  return { ok: false, error: "m7_profile_forbidden" };
}

export function isForbiddenM7Profile(operation: string): boolean {
  return M7_FORBIDDEN_PROFILES.includes(operation);
}
