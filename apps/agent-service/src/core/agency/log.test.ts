import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { getDecision, logDecision } from "./log.js";

describe("decision log", () => {
  it("round-trips the auditable Thought fields", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const id = logDecision(db, {
      ownerId: "doc",
      channel: "discord",
      trigger: "reactive",
      decision: {
        trigger: "reactive",
        kind: "revisit",
        motivationIds: [],
        score: 42,
        reason: "A grounded callback is timely.",
        objective: "Reconnect the current turn to the earlier decision.",
        evidenceRefs: [{ type: "episode", id: 7 }],
        uncertainty: 0.2,
        urgency: 0.7,
        thoughtSource: "model",
        thoughtError: null,
        affectLicense: {
          permitted: true,
          valence: 0.4,
          activation: 0.6,
          openness: 0.8,
          tension: 0.1,
          reason: "Persisted outcome",
          source: { type: "episode", id: 7 },
        },
        cognitiveAllocation: {
          shouldSpeak: true,
          effort: "high",
          completion: "hold",
        },
        authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
      },
    });

    expect(getDecision(db, id)).toMatchObject({
      objective: "Reconnect the current turn to the earlier decision.",
      evidenceRefs: [{ type: "episode", id: 7 }],
      effort: "high",
      completion: "hold",
      uncertainty: 0.2,
      urgency: 0.7,
      thoughtSource: "model",
      thoughtError: null,
      affectLicense: {
        permitted: true,
        source: { type: "episode", id: 7 },
      },
    });
    db.close();
  });
});
