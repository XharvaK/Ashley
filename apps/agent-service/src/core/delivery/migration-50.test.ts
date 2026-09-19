import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, nuclearSchemaVersion, openNuclearDb } from "../db.js";

describe("nuclear v50 dispatch-boundary migration", () => {
  it("adds the nullable dispatch marker and remains idempotent", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(50);
      expect(nuclearSchemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(db.prepare("PRAGMA table_info(delivery_reservations)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "dispatch_started_at" }),
      ]));

      openNuclearDb(db);
      expect(nuclearSchemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
    } finally {
      db.close();
    }
  });
});
