import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { assertC5ContractCompatible } from "./c5-contract-state.js";
import { C5_TABLES } from "./migration-39.js";
import { classifyTable } from "../qualification/state-inventory.js";

describe("C5 additive schema", () => {
  it("creates typed relationship projection, contract, consent, and repair records", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // The historical C5 packet recorded v42. Current source also includes
      // W4 migrations v43 and v44; db.ts is the live schema authority.
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(44);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: NUCLEAR_SUPPORTED_VERSION,
      });
      for (const table of C5_TABLES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(table)).toEqual({ 1: 1 });
        expect(classifyTable(table)).toMatchObject({ cls: "SHADOW_ARTIFACT" });
      }
      expect(db.prepare(
        `SELECT highest_contract_version, live_authority_existed, state
         FROM cognitive_maturation_contract_state WHERE wave = 'c5'`,
      ).get()).toEqual({ highest_contract_version: 1, live_authority_existed: 0, state: "observe" });
      const consentColumns = (db.prepare(
        "PRAGMA table_info(consent_records)",
      ).all() as Array<{ name?: string }>).map((row) => row.name);
      expect(consentColumns).toContain("event_kind");
      expect(consentColumns).not.toContain("current_eligible");
      const contractSql = String(db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'interaction_contracts'",
      ).get()?.sql ?? "").toLowerCase();
      expect(contractSql).toContain("implicit_hypothesis");
      expect(contractSql).toContain("lifecycle_state");
      expect(db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'trigger'
         AND name = 'trg_consent_records_no_update'`,
      ).get()).toEqual({ 1: 1 });
    } finally {
      db.close();
    }
  });

  it("fails closed when a persisted C5 contract is newer than this candidate", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      db.prepare(
        `UPDATE cognitive_maturation_contract_state
         SET highest_contract_version = 2 WHERE wave = 'c5'`,
      ).run();
      expect(() => assertC5ContractCompatible(db)).toThrow(
        "relational_graduation_contract_unsupported:2>1",
      );
    } finally {
      db.close();
    }
  });
});
