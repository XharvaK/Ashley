import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";

describe("C3 learned-autonomy implementation-HEAD gap", () => {
  it("does not create C5 shared-culture or similarity state", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_culture'",
      ).get()).toBeUndefined();
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'identity_similarity'",
      ).get()).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
