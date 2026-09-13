import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { collectMotivations } from "../agency/motivations.js";

describe("C3 learned-autonomy implementation-HEAD gap", () => {
  it("keeps default Agency collection free of learned-interest influence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const motivations = collectMotivations(db, "c3-gap-owner", "proactive");
      expect(motivations.some((item) => item.kind === "learned_interest")).toBe(false);
    } finally {
      db.close();
    }
  });

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
