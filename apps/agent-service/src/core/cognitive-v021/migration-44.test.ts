import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ensureNuclearV44Schema, validateNuclearV44Schema } from "./migration-44.js";

describe("nuclear migration 44 authority barrier", () => {
  it("creates one reconciling barrier and all canonical owner versions", () => {
    const db = new DatabaseSync(":memory:");
    ensureNuclearV44Schema(db);
    validateNuclearV44Schema(db);
    expect(db.prepare("SELECT state FROM authority_transition_barrier WHERE barrier_id='global'").get()).toEqual({ state: "reconciling" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM canonical_owner_versions").get()).toEqual({ count: 3 });
    db.close();
  });
});
