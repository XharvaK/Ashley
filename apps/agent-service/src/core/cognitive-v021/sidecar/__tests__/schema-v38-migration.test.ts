import { describe, expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { interestBranchIdFor, isInterestRoot } from "../../memory/interests.js";

describe("cognitive sidecar schema v38", () => {
  it("adds the inner-life tables and re-homes the seeded tastes as interest branches", () => {
    const db = openTestSidecar();
    try {
      for (const table of ["inner_state", "activity_journal", "interest_branches"]) db.exec(`DROP TABLE IF EXISTS ${table}`);
      setTestSidecarVersion(db, 37);

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(65);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(65);
      expect(db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get()).toEqual({ schema_version: 65 });
      for (const table of ["inner_state", "activity_journal", "interest_branches"]) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), table).toBeTruthy();
      }
      const seeds = db.prepare("SELECT branch_id, root, label, origin, lived_count FROM interest_branches ORDER BY branch_id").all() as Array<Record<string, unknown>>;
      expect(seeds).toHaveLength(8);
      for (const seed of seeds) {
        expect(isInterestRoot(seed.root), String(seed.root)).toBe(true);
        expect(seed.branch_id).toBe(interestBranchIdFor(String(seed.root), String(seed.label)));
        expect(seed).toMatchObject({ origin: "seed", lived_count: 1 });
      }
    } finally {
      db.close();
    }
  });
});
