import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { ensureNuclearV44Schema, validateNuclearV44Schema } from "../cognitive-v021/migration-44.js";

describe("nuclear authority barrier migration 44", () => {
  it("boots through a reconciling migration singleton and opens stable only after startup reconciliation", () => {
    const isolated = new DatabaseSync(":memory:");
    try {
      ensureNuclearV44Schema(isolated);
      validateNuclearV44Schema(isolated);
      expect(isolated.prepare("SELECT state FROM authority_transition_barrier WHERE barrier_id = 'global'").get())
        .toEqual({ state: "reconciling" });
      expect(isolated.prepare("SELECT COUNT(*) AS count FROM canonical_owner_versions").get())
        .toEqual({ count: 3 });
      ensureNuclearV44Schema(isolated);
      expect(isolated.prepare("SELECT COUNT(*) AS count FROM authority_transition_barrier").get())
        .toEqual({ count: 1 });
    } finally {
      isolated.close();
    }

    const opened = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(opened.prepare("SELECT state FROM authority_transition_barrier WHERE barrier_id = 'global'").get())
        .toEqual({ state: "stable" });
      validateNuclearV44Schema(opened);
    } finally {
      opened.close();
    }
  });
});
