import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import { darkApplyContext } from "./dark-apply.js";
import type { ContextRequest } from "./types.js";

const request: ContextRequest = {
  requestId: "dark-apply-request",
  ownerId: "dark-apply-owner",
  purpose: "thought",
  routeId: "thought",
  surface: "private",
  currentMessage: "current",
  inputs: [{
    ref: { type: "message", id: 1 },
    sourceType: "message",
    sourceId: 1,
    section: "safety",
    content: "safety",
    classification: "never_public",
    influenceEligible: true,
    retrievalEligible: true,
    required: true,
    messageRole: "system",
  }],
};

describe("C2 dark apply boundary", () => {
  it("exercises allocation and receipts without granting live capability influence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const result = darkApplyContext(db, request);
      expect(result.receipt.capabilityMode).toBe("dark_apply");
      expect(result.receipt.projectionId).toBe(result.projection.projectionId);
      expect(capabilityCanInfluence(db, "context_budget")).toBe(false);
      expect(db.prepare(
        `SELECT live_authority_existed FROM cognitive_maturation_contract_state
         WHERE wave = 'c2'`,
      ).get()).toEqual({ live_authority_existed: 0 });
    } finally {
      db.close();
    }
  });

  it("fails closed when persisted C2 contract state is newer than this implementation", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      db.prepare(
        `UPDATE cognitive_maturation_contract_state
         SET highest_contract_version = 2 WHERE wave = 'c2'`,
      ).run();
      expect(() => darkApplyContext(db, request)).toThrow("c2_contract_version_unsupported:2>1");
    } finally {
      db.close();
    }
  });
});
