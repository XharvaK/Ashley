import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, NUCLEAR_SUPPORTED_VERSION, nuclearSchemaVersion } from "../db.js";

describe("nuclear v42 cognitive projection migration", () => {
  it("is additive, versioned, and idempotently exposes the global key", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // This migration remains v42; the current candidate continues through
      // the source-authoritative W4 migrations v43 and v44.
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(44);
      expect(nuclearSchemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(db.prepare("PRAGMA table_info(delivery_reservations)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "cognitive_v021_projection_key" }),
      ]));
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS delivery_reservations_v021_projection_key ON delivery_reservations(cognitive_v021_projection_key) WHERE cognitive_v021_projection_key IS NOT NULL");
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'delivery_reservations_v021_projection_key'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
