import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import { validateNuclearV45Schema } from "./migration-45.js";

describe("nuclear migration 45 artifact preservation", () => {
  it("lands the additive artifact proof columns as V45", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(46);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(46);
      validateNuclearV45Schema(db);
      const columns = db.prepare("PRAGMA table_info(perception_artifacts)").all() as Array<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "integrity_proof_json",
        "provenance_json",
        "preserved",
      ]));
      expect(columns.find((column) => column.name === "preserved")).toMatchObject({
        notnull: 1,
        dflt_value: "0",
      });
    } finally {
      db.close();
    }
  });
});
