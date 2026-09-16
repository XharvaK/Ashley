import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, nuclearSchemaVersion, openNuclearDb } from "../db.js";

describe("nuclear v48 commitment identity migration", () => {
  it("adds nullable reservation identity columns and remains idempotent", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(49);
      expect(nuclearSchemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(db.prepare("PRAGMA table_info(delivery_reservations)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "commitment_id" }),
        expect.objectContaining({ name: "commitment_occurrence_id" }),
        expect.objectContaining({ name: "commitment_attempt_id" }),
        expect.objectContaining({ name: "speech_outbox_id" }),
      ]));

      openNuclearDb(db);
      expect(nuclearSchemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
    } finally {
      db.close();
    }
  });
});
