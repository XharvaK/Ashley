import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { attachAffectLicense, applyAffectiveEvent, getAffectiveState } from "./affect.js";
import { decide } from "../agency/decide.js";

describe("grounded affect", () => {
  it("is bounded, idempotent, and licenses only sourced feeling claims", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    applyAffectiveEvent(db, {
      ownerId: "doc",
      sourceType: "episode",
      sourceId: 7,
      valenceDelta: 2,
      activationDelta: 2,
      opennessDelta: -2,
      tensionDelta: 2,
      reason: "A meaningful unresolved exchange.",
    });
    applyAffectiveEvent(db, {
      ownerId: "doc",
      sourceType: "episode",
      sourceId: 7,
      valenceDelta: -1,
      reason: "duplicate must not reapply",
    });
    const state = getAffectiveState(db, "doc");
    expect(state).toMatchObject({ valence: 1, activation: 1, openness: 0, tension: 1 });
    const decision = attachAffectLicense(
      decide([{ kind: "user_message", score: 100, summary: "tell me" }], "reactive"),
      state,
    );
    expect(decision.affectLicense).toMatchObject({
      permitted: true,
      source: { type: "episode", id: "7" },
    });
    db.close();
  });
});
