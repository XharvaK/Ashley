import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import { classifyTable } from "../qualification/state-inventory.js";

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (db.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0,
  );
}

describe("nuclear schema v33 durable operational jobs", () => {
  it("installs envelope and recovery tables with zero rows", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(
        (db.prepare(`SELECT COUNT(*) AS c FROM operational_jobs`).get() as { c: number }).c,
      ).toBe(0);
      expect(
        (db.prepare(`SELECT COUNT(*) AS c FROM verification_receipts`).get() as { c: number }).c,
      ).toBe(0);
      expect(classifyTable("operational_jobs").cls).toBe("CONTROL_PLANE");
      expect(classifyTable("verification_receipts").cls).toBe("CONTROL_PLANE");
    } finally {
      db.close();
    }
  });
});
