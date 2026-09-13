import type { DatabaseSync } from "node:sqlite";
import { startRecallQualificationEpoch } from "./recall-qualification-epoch.js";

/**
 * Shared test fixture helper for Recall qualification epochs.
 *
 * A qualification campaign is created ONLY by the explicit owner-authorized
 * epoch-start operation; recording evidence never creates one. Tests that
 * exercise Recall QUALIFICATION (promotion eligibility, epoch-scoped counts)
 * must therefore establish a deterministic epoch before seeding evidence.
 *
 * The request key is deterministic, so repeated calls in the same test are
 * idempotent (CAS returns the same epoch with `created: false`). If a
 * different epoch is already current, the CAS fails with `epoch_changed` and
 * this throws — a fixture that silently qualified against the wrong campaign
 * must fail loudly.
 */
export const TEST_EPOCH_OWNER = "owner:test";
export const TEST_EPOCH_REQUEST_KEY = "deterministic-epoch:1";

export function startDeterministicRecallEpoch(
  db: DatabaseSync,
  requestKey: string = TEST_EPOCH_REQUEST_KEY,
): string {
  const result = startRecallQualificationEpoch(db, {
    authorizedBy: TEST_EPOCH_OWNER,
    startRequestKey: requestKey,
    expectedCurrentEpochId: null,
  });
  if (!result.ok) {
    throw new Error(`recall_epoch_test_setup_failed:${result.reason}`);
  }
  return result.epochId;
}
