import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import { classifyTable } from "../qualification/state-inventory.js";

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0,
  );
}

describe("nuclear schema v34 durable cognition", () => {
  it("adds cognition columns without rewriting v33 tables", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // The historical migration packet recorded v42. Current source also
      // includes W4 migrations v43 and v44; db.ts is the live schema authority.
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(44);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      const names = (
        db.prepare(`PRAGMA table_info(operational_jobs)`).all() as Array<{ name: string }>
      ).map((row) => row.name);
      expect(names).toContain("job_phase");
      expect(names).toContain("cognition_state");
      expect(names).toContain("normalized_thought_json");
      expect(names).toContain("thought_attention_request_id");
      expect(names).toContain("thought_attention_attempt_ids_json");
      expect(classifyTable("operational_jobs").cls).toBe("CONTROL_PLANE");
    } finally {
      db.close();
    }
  });
});
