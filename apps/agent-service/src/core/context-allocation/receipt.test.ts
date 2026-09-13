import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { ensureContextBudgetPolicy } from "./plan.js";
import { selectAndRender } from "./render.js";
import type { ContextInputCandidate, ContextRequest } from "./types.js";

const OWNER_ID = "c2-receipt-owner";

function request(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    requestId: "receipt-request",
    ownerId: OWNER_ID,
    purpose: "expression",
    routeId: "ashley_expression",
    surface: "private",
    capabilityMode: "dark_apply",
    snapshotId: "persistent-snapshot",
    currentMessage: "current question",
    inputs: [
      {
        ref: { type: "message", id: 10 },
        sourceType: "message",
        sourceId: 10,
        section: "safety",
        content: "[safety] required",
        classification: "never_public",
        influenceEligible: true,
        retrievalEligible: true,
        required: true,
        messageRole: "system",
      },
      {
        ref: { type: "fact", id: 11 },
        sourceType: "fact",
        sourceId: 11,
        section: "evidence",
        content: "eligible fact",
        classification: "never_public",
        influenceEligible: true,
        retrievalEligible: true,
        memoryContextRole: "current_source_evidence",
        messageRole: "user",
        priority: 5,
      },
    ],
    ...overrides,
  };
}

describe("C2 allocation receipts and rendering", () => {
  it("renders a bounded projection with C1 labels and records metadata without prompt bodies", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      ensureContextBudgetPolicy(db, {
        policyId: "receipt-policy",
        version: 1,
        totalUtf8Bytes: 400,
        sectionBudgets: { safety: 100, evidence: 200 },
      });
      const allocation = selectAndRender(db, request({ policyId: "receipt-policy" }));
      expect(allocation.messages.map((message) => message.content)).toEqual([
        "[safety] required",
        "fact: [memory_context_role=current_source_evidence; assertion_ids=none; correction_ids=none] eligible fact",
        "current question",
      ]);
      expect(allocation.projection.evidenceRefs.length).toBeGreaterThan(0);
      expect(allocation.receipt.projectionId).toBe(allocation.projection.projectionId);
      expect(allocation.receipt.contentBinding).toBe(allocation.projection.contentBinding.value);
      expect(allocation.receipt.sameSnapshotId).toBe("persistent-snapshot");
      expect(JSON.stringify(allocation.receipt)).not.toContain("eligible fact");
      expect(JSON.stringify(allocation.receipt)).not.toContain("current question");
    } finally {
      db.close();
    }
  });

  it("produces separate receipts for different budgets over unchanged state", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      ensureContextBudgetPolicy(db, {
        policyId: "multi-policy",
        version: 1,
        totalUtf8Bytes: 500,
        sectionBudgets: { safety: 120, evidence: 300 },
      });
      const narrow = selectAndRender(db, request({
        requestId: "narrow",
        policyId: "multi-policy",
        maxUtf8Bytes: 120,
        sectionBudgets: { safety: 120, evidence: 20 },
      }));
      const wide = selectAndRender(db, request({
        requestId: "wide",
        policyId: "multi-policy",
        maxUtf8Bytes: 500,
        sectionBudgets: { safety: 120, evidence: 300 },
      }));
      expect(narrow.receipt.sameSnapshotId).toBe(wide.receipt.sameSnapshotId);
      expect(narrow.receipt.receiptId).not.toBe(wide.receipt.receiptId);
      expect(narrow.projection.contentBinding.value).not.toBe(wide.projection.contentBinding.value);
      expect(narrow.receipt.omitted.length).toBeGreaterThan(0);
      expect(wide.receipt.omitted.length).toBe(0);
    } finally {
      db.close();
    }
  });
});
