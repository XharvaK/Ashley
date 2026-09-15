import type { DatabaseSync } from "node:sqlite";
import {
  beginAuthorityTransitionInExistingTransaction,
  stabilizeAuthorityBarrierInExistingTransaction,
} from "../cognitive-v021/authority/barrier.js";
import {
  advanceCanonicalOwnerVersionInTransaction,
  readAuthorityVersionVector,
} from "../cognitive-v021/authority/version-vector.js";

export type HardPolicyMutation = {
  changes: number;
};

/**
 * Complete one effective hard-policy mutation while the caller owns the
 * surrounding nuclear BEGIN IMMEDIATE transaction. The callback is invoked
 * only after the existing authority barrier has entered `transitioning`.
 * No-op decisions are made by the caller before this helper is called.
 */
export function advanceRelationalHardPolicyRevisionInTransaction<T>(
  db: DatabaseSync,
  input: {
    reasonCode: string;
    changeId: string;
    nowMs: number;
    mutate: () => HardPolicyMutation & { value: T };
  },
): T {
  const transition = beginAuthorityTransitionInExistingTransaction(
    db,
    input.reasonCode,
    input.nowMs,
  );
  const mutation = input.mutate();
  if (Number(mutation.changes) !== 1) {
    throw new Error("hard_policy_mutation_not_effective");
  }
  advanceCanonicalOwnerVersionInTransaction(
    db,
    "nuclear",
    input.changeId,
    input.nowMs,
  );
  stabilizeAuthorityBarrierInExistingTransaction(
    db,
    readAuthorityVersionVector(db),
    input.nowMs,
    transition.transitionId,
  );
  return mutation.value;
}
