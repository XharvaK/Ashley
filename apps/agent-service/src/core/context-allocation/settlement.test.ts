import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { contextBudgetCanInfluence } from "./contract-state.js";
import { selectAndRender } from "./render.js";

describe("C2 settlement witnesses", () => {
  it("refuses a required section when C1/privacy filtering removes its only input", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(() => selectAndRender(db, {
        requestId: "refuse-secret",
        ownerId: "settlement-owner",
        purpose: "expression",
        routeId: "ashley_expression",
        surface: "private",
        requiredSections: ["safety"],
        inputs: [{
          ref: { type: "message", id: 1 },
          sourceType: "message",
          sourceId: 1,
          section: "safety",
          content: "secret safety material",
          classification: "secret",
          required: true,
          messageRole: "system",
        }],
      })).toThrow("context_required_section_unavailable:safety");
    } finally {
      db.close();
    }
  });

  it("does not allow observe or dark apply to become live authority", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(contextBudgetCanInfluence(db, "observe")).toBe(false);
      expect(contextBudgetCanInfluence(db, "dark_apply")).toBe(true);
      expect(db.prepare(
        `SELECT live_authority_existed FROM cognitive_maturation_contract_state
         WHERE wave = 'c2'`,
      ).get()).toEqual({ live_authority_existed: 0 });
    } finally {
      db.close();
    }
  });
});
