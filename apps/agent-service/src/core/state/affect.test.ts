import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { attachAffectLicense, applyAffectiveEvent, getAffectiveState } from "./affect.js";
import type { Decision, Trigger } from "../types.js";

// The legacy decider is retired; these tests exercise the attach step on a
// fixed baseline decision.
function baselineDecision(trigger: Trigger, kind: Decision["kind"]): Decision {
  return {
    trigger,
    kind,
    motivationIds: [],
    score: 100,
    reason: "baseline",
    evidenceRefs: [],
    uncertainty: 0,
    urgency: 0,
    thoughtSource: "deterministic",
    thoughtError: null,
    affectLicense: { permitted: false, valence: 0, activation: 0.5, openness: 0.5, tension: 0, reason: "neutral baseline" },
    cognitiveAllocation: { shouldSpeak: true, effort: "low", completion: "complete" },
    authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
  };
}

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
      baselineDecision("reactive", "speak"),
      state,
    );
    expect(decision.affectLicense).toMatchObject({
      permitted: true,
      source: { type: "episode", id: "7" },
    });
    db.close();
  });
});
