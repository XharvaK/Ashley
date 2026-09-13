import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";

describe("C4 prediction/outcome characterization", () => {
  it("keeps the selected prediction pair separate from existing decision telemetry", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(db.prepare("SELECT COUNT(*) AS count FROM cognitive_predictions").get()).toEqual({ count: 0 });
      const decisionColumns = db.prepare("PRAGMA table_info(decision_log)").all() as Array<{ name?: string }>;
      expect(decisionColumns.map((column) => column.name)).not.toContain("expected_observable_outcome");
      expect(decisionColumns.map((column) => column.name)).not.toContain("adjudication_id");
    } finally {
      db.close();
    }
  });

  it("does not treat the existing initiative-learning surface as Q8 calibration", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const columns = db.prepare("PRAGMA table_info(initiative_learning)").all() as Array<{ name?: string }>;
      expect(columns.map((column) => column.name)).not.toContain("prediction_id");
      expect(columns.map((column) => column.name)).not.toContain("adjudication_id");
    } finally {
      db.close();
    }
  });
});
