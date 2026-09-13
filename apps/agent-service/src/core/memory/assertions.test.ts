import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  getAssertion,
  insertAssertion,
  listAssertions,
} from "./assertions.js";
import {
  getMemoryContractState,
  isMemoryAssertionsCurrentnessAuthority,
} from "./contract-state.js";
import { rebuildMemFactsProjection } from "./projection-facts.js";

const OWNER_ID = "doc";
const NOW = "2026-08-26T12:00:00.000Z";

describe("C1 assertion library", () => {
  it("writes a typed assertion without collapsing orthogonal state", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const id = insertAssertion(db, {
        ownerId: OWNER_ID,
        kind: "keyed_fact",
        subjectFacet: "owner_model",
        lineageKind: "explicit_seed",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I2",
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        sourceKind: "user_message",
        sourceMessageId: null,
        recordedAt: NOW,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: null,
        worldIntervalBasis: "adjudicated",
        authorityFrom: NOW,
        authorityTo: null,
        authorityBasis: "adjudicated",
      });

      expect(getAssertion(db, id)).toMatchObject({
        id,
        ownerId: OWNER_ID,
        kind: "keyed_fact",
        subjectFacet: "owner_model",
        lineageKind: "explicit_seed",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I2",
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        recordedAt: NOW,
        validFrom: "2026-01-01T00:00:00.000Z",
        authorityFrom: NOW,
        authorityBasis: "adjudicated",
        terminationReason: null,
      });
      expect(listAssertions(db, OWNER_ID)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("keeps contract state readable and refuses projection before cutover", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(getMemoryContractState(db)).toMatchObject({
        c1ContractVersion: 1,
        currentnessAuthority: "mem_facts",
        cutoverAt: null,
        appliedC1AuthorityExists: false,
        correctionSeq: 0,
      });
      expect(isMemoryAssertionsCurrentnessAuthority(db)).toBe(false);
      expect(() => rebuildMemFactsProjection(db, { ownerId: OWNER_ID, at: NOW }))
        .toThrow("memory_assertions_not_currentness_authority");
    } finally {
      db.close();
    }
  });

  it("rebuilds only eligible keyed assertions into an idempotent compatibility projection", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      db.prepare(
        `UPDATE memory_contract_state
         SET currentness_authority = 'memory_assertions', cutover_at = ?
         WHERE id = 1`,
      ).run(NOW);
      const first = insertAssertion(db, {
        ownerId: OWNER_ID,
        kind: "keyed_fact",
        subjectFacet: "owner_model",
        lineageKind: "owner_designated",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I2",
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        sourceKind: "test",
        recordedAt: NOW,
        authorityFrom: NOW,
        authorityBasis: "adjudicated",
      });
      const second = insertAssertion(db, {
        ownerId: OWNER_ID,
        kind: "keyed_fact",
        subjectFacet: "owner_model",
        lineageKind: "owner_designated",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I2",
        category: "preference",
        key: "tea",
        value: "likes tea",
        sourceKind: "test",
        recordedAt: NOW,
        authorityFrom: NOW,
        authorityBasis: "adjudicated",
      });

      expect(rebuildMemFactsProjection(db, { ownerId: OWNER_ID, at: NOW })).toBe(2);
      expect(db.prepare(
        `SELECT category, key, value FROM mem_facts
         WHERE owner_id = ? AND superseded_by IS NULL ORDER BY key`,
      ).all(OWNER_ID)).toEqual([
        { category: "preference", key: "coffee", value: "likes coffee" },
        { category: "preference", key: "tea", value: "likes tea" },
      ]);

      const firstFactRow = db.prepare(
        "SELECT id FROM mem_facts WHERE owner_id = ? AND key = 'coffee'",
      ).get(OWNER_ID) as { id: number };
      const firstFactId = firstFactRow.id;
      expect(rebuildMemFactsProjection(db, { ownerId: OWNER_ID, at: NOW })).toBe(2);
      const repeatedFactRow = db.prepare(
        "SELECT id FROM mem_facts WHERE owner_id = ? AND key = 'coffee'",
      ).get(OWNER_ID) as { id: number };
      expect(repeatedFactRow.id).toBe(firstFactId);

      db.prepare(
        "UPDATE memory_assertions SET termination_reason = 'invalidated' WHERE id = ?",
      ).run(first);
      expect(rebuildMemFactsProjection(db, { ownerId: OWNER_ID, at: NOW })).toBe(1);
      expect(db.prepare(
        `SELECT key FROM mem_facts
         WHERE owner_id = ? AND superseded_by IS NULL ORDER BY key`,
      ).all(OWNER_ID)).toEqual([{ key: "tea" }]);
      expect(getAssertion(db, second)?.terminationReason).toBeNull();
    } finally {
      db.close();
    }
  });
});
