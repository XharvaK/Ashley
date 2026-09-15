import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import {
  SOCIAL_AUTHORITY_INDEXES,
  SOCIAL_AUTHORITY_TABLES,
  validateNuclearV46Schema,
} from "./migration-46.js";

describe("nuclear migration 46 social authority", () => {
  it("lands the seven authority tables and separate partial indexes", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(47);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(47);
      validateNuclearV46Schema(db);

      for (const table of SOCIAL_AUTHORITY_TABLES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(table)).toEqual({ 1: 1 });
      }
      for (const index of SOCIAL_AUTHORITY_INDEXES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
        ).get(index)).toEqual({ 1: 1 });
      }

      const partialIndexes = db.prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'index' AND name IN ('idx_social_permits_live', 'idx_recipient_restrictions_live')
         ORDER BY name`,
      ).all() as Array<{ name: string; sql: string }>;
      expect(partialIndexes).toHaveLength(2);
      expect(partialIndexes.find((index) => index.name === "idx_social_permits_live")!.sql.toLowerCase())
        .toContain("where revoked_at is null");
      expect(partialIndexes.find((index) => index.name === "idx_recipient_restrictions_live")!.sql.toLowerCase())
        .toContain("where cleared_at is null");
    } finally {
      db.close();
    }
  });

  it("reopens V46 without changing the schema", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const before = db.prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE name IN (${SOCIAL_AUTHORITY_TABLES.map(() => "?").join(",")}, ${SOCIAL_AUTHORITY_INDEXES.map(() => "?").join(",")})
         ORDER BY type, name`,
      ).all(...SOCIAL_AUTHORITY_TABLES, ...SOCIAL_AUTHORITY_INDEXES);
      openNuclearDb(db);
      const after = db.prepare(
        `SELECT type, name, sql FROM sqlite_master
         WHERE name IN (${SOCIAL_AUTHORITY_TABLES.map(() => "?").join(",")}, ${SOCIAL_AUTHORITY_INDEXES.map(() => "?").join(",")})
         ORDER BY type, name`,
      ).all(...SOCIAL_AUTHORITY_TABLES, ...SOCIAL_AUTHORITY_INDEXES);
      expect(after).toEqual(before);
    } finally {
      db.close();
    }
  });
});
