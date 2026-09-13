/**
 * M5 apply is permanently refuse-closed. Application is a later
 * self-change lifecycle, not an authorship operation.
 */

export const M5_APPLY_FORBIDDEN_OPERATIONS: readonly string[] = [
  "changeset.apply",
  "changeset.merge",
  "git.commit",
  "git.push",
];

export function refuseApplyCandidateChangeSet(): { ok: false; error: "m5_apply_forbidden" } {
  return { ok: false, error: "m5_apply_forbidden" };
}

export function isM5ApplyForbiddenOperation(operation: string): boolean {
  return M5_APPLY_FORBIDDEN_OPERATIONS.includes(operation);
}
