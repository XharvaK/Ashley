import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";

describe("nuclear migration 53 social operation delegations", () => {
  it("creates the additive delegation table and live lookup indexes without copying permits", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'social_operation_delegations'",
      ).get()).toEqual({ 1: 1 });
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_social_operation_delegations_live'",
      ).get()).toEqual({ 1: 1 });
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_social_operation_delegations_lookup'",
      ).get()).toEqual({ 1: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM social_operation_delegations").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});
