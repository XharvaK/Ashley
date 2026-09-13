import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { upsertFact } from "./facts.js";
import {
  buildLegacyImpactInventory,
  cutoverMemoryAssertions,
  verifyC1Consistency,
} from "./cutover.js";
import { getMemoryContractState } from "./contract-state.js";

const OWNER_ID = "doc";

function openFixture(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function fact(
  db: DatabaseSync,
  value = "likes coffee",
  origin: "explicit_user" | "legacy" = "explicit_user",
): number {
  return upsertFact(db, {
    ownerId: OWNER_ID,
    category: "preference",
    key: "coffee",
    value,
    origin,
  });
}

describe("C1 authority cutover", () => {
  it("refuses inconsistent dual-write rows and leaves the marker unchanged", () => {
    const db = openFixture();
    try {
      const factId = fact(db);
      db.prepare("UPDATE mem_facts SET value = 'drifted' WHERE id = ?").run(factId);

      const report = verifyC1Consistency(db);
      expect(report.ok).toBe(false);
      expect(report.mismatchedFactIds).toContain(factId);
      expect(() => cutoverMemoryAssertions(db)).toThrow(
        "memory_cutover_consistency_failed",
      );
      expect(getMemoryContractState(db)?.currentnessAuthority).toBe("mem_facts");
    } finally {
      db.close();
    }
  });

  it("refuses a remaining independent mem_facts writer", () => {
    const db = openFixture();
    try {
      fact(db);
      expect(() => cutoverMemoryAssertions(db, {
        writerInventory: [{
          name: "unbridged-test-writer",
          sourcePath: "test-fixture",
          assertionFirst: false,
        }],
      })).toThrow("memory_cutover_independent_writer");
      expect(getMemoryContractState(db)?.currentnessAuthority).toBe("mem_facts");
    } finally {
      db.close();
    }
  });

  it("rolls back an interrupted marker conversion", () => {
    const db = openFixture();
    try {
      fact(db);
      expect(() => cutoverMemoryAssertions(db, {
        testFailAfterMarker: true,
      })).toThrow("memory_cutover_interrupted");
      expect(getMemoryContractState(db)?.currentnessAuthority).toBe("mem_facts");
      expect(getMemoryContractState(db)?.cutoverAt).toBeNull();
    } finally {
      db.close();
    }
  });

  it("flips authority atomically and rebuilds the compatibility projection on restart", () => {
    const db = openFixture();
    try {
      const factId = fact(db);
      const result = cutoverMemoryAssertions(db, {
        now: new Date(Date.now() + 1000).toISOString(),
      });
      expect(result.marker.currentnessAuthority).toBe("memory_assertions");
      expect(result.consistency.ok).toBe(true);
      db.prepare("DELETE FROM mem_facts WHERE id = ?").run(factId);

      openNuclearDb(db, { continuityOptional: true });
      expect(db.prepare(
        "SELECT owner_id, category, key, value, superseded_by FROM mem_facts",
      ).all()).toEqual([{
        owner_id: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        superseded_by: null,
      }]);
    } finally {
      db.close();
    }
  });

  it("reports quantified legacy facet impact before reader cutover", () => {
    const db = openFixture();
    try {
      fact(db, "derived legacy value", "legacy");
      const inventory = buildLegacyImpactInventory(db, OWNER_ID);
      expect(inventory.totalMigratedAssertions).toBe(1);
      expect(inventory.countsByFacet.unknown).toBe(1);
      expect(inventory.remainingUnknown).toBe(1);
      expect(inventory.currentlyInfluentialLegacyFacts).toBe(1);
      expect(inventory.affectedPaths).toEqual([
        "motivation_insert",
        "mindStateBlock",
        "resolveEvidenceRefs",
        "thought_candidate_json",
        "expression_memory_block",
      ]);
      expect(inventory.ownerVisibleBehaviorChange).toBe("yes");
    } finally {
      db.close();
    }
  });

  it("refuses a persisted C1 contract newer than this executable", () => {
    const db = openFixture();
    try {
      db.prepare(
        "UPDATE memory_contract_state SET c1_contract_version = 2",
      ).run();
      expect(() => openNuclearDb(db, { continuityOptional: true })).toThrow(
        "unsupported_memory_contract",
      );
    } finally {
      db.close();
    }
  });
});
