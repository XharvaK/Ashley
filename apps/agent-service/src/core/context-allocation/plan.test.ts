import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { buildEligibleInputs } from "./eligibility.js";
import {
  ensureContextBudgetPolicy,
  planBudget,
  selectContextInputs,
} from "./plan.js";
import type {
  ContextInputCandidate,
  ContextRequest,
} from "./types.js";

const OWNER_ID = "c2-plan-owner";

function request(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    requestId: "plan-request",
    ownerId: OWNER_ID,
    purpose: "expression",
    routeId: "ashley_expression",
    surface: "private",
    ...overrides,
  };
}

function inputs(): ContextInputCandidate[] {
  return [
    {
      ref: { type: "message", id: 1 },
      sourceType: "message",
      sourceId: 1,
      section: "safety",
      content: "safe",
      classification: "never_public",
      required: true,
      influenceEligible: true,
      retrievalEligible: true,
      priority: 0,
    },
    {
      ref: { type: "message", id: 2 },
      sourceType: "message",
      sourceId: 2,
      section: "history",
      content: "🙂",
      classification: "never_public",
      influenceEligible: true,
      retrievalEligible: true,
      priority: 10,
    },
    {
      ref: { type: "message", id: 3 },
      sourceType: "message",
      sourceId: 3,
      section: "history",
      content: "later history",
      classification: "never_public",
      influenceEligible: true,
      retrievalEligible: true,
      priority: 9,
    },
  ];
}

describe("C2 byte-budget planning", () => {
  it("uses UTF-8 bytes as the hard accounting unit and estimates tokens separately", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const eligible = buildEligibleInputs(db, request({ inputs: inputs() }));
      const plan = planBudget(request({
        maxUtf8Bytes: 10,
        sectionBudgets: { safety: 10, history: 4 },
        tokenEstimateDivisor: 4,
      }), eligible);
      const selection = selectContextInputs(plan, eligible);
      expect(selection.included.map((item) => item.sourceId)).toEqual([1, 2]);
      expect(selection.includedUtf8Bytes).toBe(8);
      expect(selection.estimatedTokens).toBe(2);
      expect(selection.omitted).toEqual(expect.arrayContaining([
        expect.objectContaining({ ref: { type: "message", id: 3 }, omitReason: "budget_omission" }),
      ]));
    } finally {
      db.close();
    }
  });

  it("preserves the required minimum and refuses a plan that cannot fit it", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const eligible = buildEligibleInputs(db, request({ inputs: inputs() }));
      expect(() => planBudget(request({
        maxUtf8Bytes: 3,
        sectionBudgets: { safety: 3 },
      }), eligible)).toThrow("context_required_minimum_overflow");
    } finally {
      db.close();
    }
  });

  it("creates different bounded selections from the same persistent candidate set", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const eligible = buildEligibleInputs(db, request({ inputs: inputs() }));
      const narrow = selectContextInputs(planBudget(request({
        maxUtf8Bytes: 8,
        sectionBudgets: { safety: 8, history: 4 },
        snapshotId: "same-state",
      }), eligible), eligible);
      const wide = selectContextInputs(planBudget(request({
        maxUtf8Bytes: 30,
        sectionBudgets: { safety: 8, history: 22 },
        snapshotId: "same-state",
      }), eligible), eligible);
      expect(wide.included.map((item) => item.sourceId)).toEqual([1, 2, 3]);
      expect(narrow.included.map((item) => item.sourceId)).not.toEqual(
        wide.included.map((item) => item.sourceId),
      );
      expect(eligible.map((item) => item.content)).toEqual(["safe", "🙂", "later history"]);
    } finally {
      db.close();
    }
  });

  it("persists a versioned policy without granting capability influence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      ensureContextBudgetPolicy(db, {
        policyId: "c2-test",
        version: 1,
        totalUtf8Bytes: 120,
        sectionBudgets: { safety: 40 },
        tokenEstimateDivisor: 4,
      });
      expect(db.prepare(
        "SELECT policy_id, version, total_utf8_bytes FROM context_budget_policies",
      ).get()).toEqual({
        policy_id: "c2-test",
        version: 1,
        total_utf8_bytes: 120,
      });
    } finally {
      db.close();
    }
  });
});
