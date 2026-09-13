import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";

const TABLES = [
  "cognitive_predictions",
  "cognitive_outcome_observations",
  "cognitive_outcome_adjudications",
  "working_view_links",
  "lived_experience_links",
  "thought_calibration_adjustments",
] as const;

describe("C4 additive schema", () => {
  it("creates append-only prediction, outcome, link, and calibration tables", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // The historical C4 packet recorded v42. Current source also includes
      // W4 migrations v43 and v44; db.ts is the live schema authority.
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(44);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: NUCLEAR_SUPPORTED_VERSION,
      });
      for (const table of TABLES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(table)).toEqual({ 1: 1 });
      }
      expect(db.prepare(
        "SELECT highest_contract_version, live_authority_existed, state FROM cognitive_maturation_contract_state WHERE wave = 'c4'",
      ).get()).toEqual({
        highest_contract_version: 1,
        live_authority_existed: 0,
        state: "observe",
      });
      const predictionSql = String(db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cognitive_predictions'",
      ).get()?.sql ?? "").toLowerCase();
      expect(predictionSql).toContain("expected_horizon");
      expect(predictionSql).toContain("model_route_receipt_id");
      expect(predictionSql).toContain("length(trim(judgment_text))");
      const observationSql = String(db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cognitive_outcome_observations'",
      ).get()?.sql ?? "").toLowerCase();
      expect(observationSql).toContain("outcome_unknown");
      const adjudicationSql = String(db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cognitive_outcome_adjudications'",
      ).get()?.sql ?? "").toLowerCase();
      expect(adjudicationSql).toContain("partial_support");
      expect(adjudicationSql).toContain("ashley_thought_reflection");
      expect(adjudicationSql).not.toContain("thought_reflection_proposed");
    } finally {
      db.close();
    }
  });
});
