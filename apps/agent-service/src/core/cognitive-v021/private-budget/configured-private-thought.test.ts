import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { admitWake } from "../wake/ledger.js";
import { reservePrivateThought } from "./ledger.js";
import {
  activePrivateThoughtPolicyId,
  CONFIGURED_PRIVATE_THOUGHT_POLICY_ID,
  configurePrivateThoughtBudget,
  PRIVATE_THOUGHT_POLICY_ID,
  resolveBudgetPolicy,
} from "./policies.js";

const BASE = 1000000;

function reserve(db: DatabaseSync, suffix: string) {
  const admitted = admitWake(db, {
    occurrenceId: suffix,
    triggerRef: suffix,
    sourceKind: "idle",
    conversationId: "fixture",
    cycleId: suffix,
    capturedAuthorityRevision: 1,
    nowMs: BASE,
  });
  return reservePrivateThought(db, {
    admissionId: suffix,
    wakeId: admitted.wake.wakeId,
    conversationId: "fixture",
    policyId: CONFIGURED_PRIVATE_THOUGHT_POLICY_ID,
    wallClockNowMs: BASE,
  });
}

describe("configured private Thought budget", () => {
  it("keeps the default policy when nothing is configured", () => {
    const db = openTestSidecar();
    try {
      expect(activePrivateThoughtPolicyId(db)).toBe(PRIVATE_THOUGHT_POLICY_ID);
    } finally {
      db.close();
    }
  });

  it("activates a configured limit and keeps the same version idempotent", () => {
    const db = openTestSidecar();
    try {
      configurePrivateThoughtBudget(db, { limit: 30, version: 1 });
      expect(activePrivateThoughtPolicyId(db)).toBe(CONFIGURED_PRIVATE_THOUGHT_POLICY_ID);
      expect(resolveBudgetPolicy(db, CONFIGURED_PRIVATE_THOUGHT_POLICY_ID).limit).toBe(30);
      expect(() => configurePrivateThoughtBudget(db, { limit: 30, version: 1 })).not.toThrow();
      expect(resolveBudgetPolicy(db, CONFIGURED_PRIVATE_THOUGHT_POLICY_ID).limit).toBe(30);
    } finally {
      db.close();
    }
  });

  it("rejects a different limit at the same version and accepts a higher version", () => {
    const db = openTestSidecar();
    try {
      configurePrivateThoughtBudget(db, { limit: 30, version: 1 });
      expect(() => configurePrivateThoughtBudget(db, { limit: 31, version: 1 })).toThrow("private_budget_policy_revision_invalid");
      expect(resolveBudgetPolicy(db, CONFIGURED_PRIVATE_THOUGHT_POLICY_ID).limit).toBe(30);
      configurePrivateThoughtBudget(db, { limit: 30, version: 2 });
      expect(resolveBudgetPolicy(db, CONFIGURED_PRIVATE_THOUGHT_POLICY_ID)).toMatchObject({ limit: 30, version: 2 });
    } finally {
      db.close();
    }
  });

  it("admits 30 reservations in one window and refuses the 31st", () => {
    const db = openTestSidecar();
    try {
      configurePrivateThoughtBudget(db, { limit: 30, version: 1 });
      for (let index = 0; index < 30; index += 1) {
        expect(reserve(db, `configured-${index}`).kind).toBe("reserved");
      }
      expect(reserve(db, "configured-30")).toEqual({ kind: "refused", reason: "capacity_exhausted", remaining: 0 });
    } finally {
      db.close();
    }
  });
});
