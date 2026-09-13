import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } from "../db.js";
import { validateNuclearSchemaContent } from "../cognition/schema-contract.js";
import { C3_INDEXES, C3_TABLES } from "./migration-37.js";

describe("C3 additive schema", () => {
  it("creates typed influence, evidence, receipt, and seed-lineage tables", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // The historical C3 packet recorded v42. Current source also includes
      // W4 migrations v43 and v44; db.ts is the live schema authority.
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(44);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: NUCLEAR_SUPPORTED_VERSION,
      });
      for (const table of C3_TABLES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(table)).toEqual({ 1: 1 });
      }
      for (const index of C3_INDEXES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
        ).get(index)).toEqual({ 1: 1 });
      }
      const state = db.prepare(
        "SELECT wave, highest_contract_version, live_authority_existed, state FROM cognitive_maturation_contract_state WHERE wave = 'c3'",
      ).get();
      expect(state).toEqual({
        wave: "c3",
        highest_contract_version: 1,
        live_authority_existed: 0,
        state: "observe",
      });
      const motivationSql = String(db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'motivations'",
      ).get()?.sql ?? "").toLowerCase();
      expect(motivationSql).toContain("learned_interest");
    } finally {
      db.close();
    }
  });

  it("rejects a C5 object when a v39 reader validates newer content", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      db.exec("PRAGMA user_version = 39");
      expect(() => validateNuclearSchemaContent(db, 39, { rejectNewerContent: true }))
        .toThrow(/unexpected_v40/);
    } finally {
      db.close();
    }
  });
});
