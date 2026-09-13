import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import {
  confirmMutualAshleyDelivery,
  confirmMutualAshleyDecision,
  confirmMutualDoc,
  proposeMutualCommitment,
  tryActivateMutualCommitment,
} from "./transitions.js";
import { logDecision } from "../agency/log.js";
import { recordConsentEvent } from "./consent.js";

function allowMutualRelationship(db: DatabaseSync): void {
  const common = {
    ownerId: "doc",
    scope: "private_relationship_projection",
    purpose: "bounded relationship thought",
    classification: defaultUnclassifiedConversational(),
    capabilityMode: "dark_apply" as const,
  };
  recordConsentEvent(db, {
    ...common,
    grantorIdentityRole: "doc",
    granteeOrConsumer: "ashley",
    evidenceOrDecisionRef: "message:doc-consent",
    eventKind: "grant",
  });
  recordConsentEvent(db, {
    ...common,
    grantorIdentityRole: "ashley",
    granteeOrConsumer: "doc",
    evidenceOrDecisionRef: "decision:ashley-consent",
    eventKind: "grant",
  });
}

function seedDelivery(
  db: DatabaseSync,
  entityUuid: string,
  decisionId: number,
): void {
  db.prepare(
    `INSERT INTO delivery_reservations
       (owner_id, channel, thread_id, decision_id, trigger, state, created_at, entity_uuid)
     VALUES ('doc', 'test', 'thread', ?, 'reactive', 'committed', ?, ?)` ,
  ).run(decisionId, new Date().toISOString(), entityUuid);
}

describe("mutual commitments", () => {
  it("stays proposed until dual confirmation", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    allowMutualRelationship(db);
    const uuid = proposeMutualCommitment(db, {
      ownerId: "doc",
      text: "together we'll cook Sunday",
      sourceEntityType: "message",
      sourceEntityUuid: "msg-1",
      classification: defaultUnclassifiedConversational(),
      capabilityMode: "dark_apply",
    });
    expect(tryActivateMutualCommitment(db, uuid)).toBe(false);
    confirmMutualDoc(db, uuid, "doc-msg-1", { capabilityMode: "dark_apply" });
    expect(tryActivateMutualCommitment(db, uuid)).toBe(false);
    const decisionId = logDecision(db, {
      ownerId: "doc",
      channel: "test",
      trigger: "reactive",
      decision: {
        trigger: "reactive",
        kind: "speak",
        motivationIds: [],
        score: 50,
        reason: "accepted mutual commitment",
        objective: "express the accepted commitment",
        evidenceRefs: [],
        uncertainty: 0,
        urgency: 0,
        thoughtSource: "deterministic",
        thoughtError: null,
        affectLicense: {
          permitted: false,
          valence: 0,
          activation: 0.5,
          openness: 0.5,
          tension: 0,
          reason: "fixture",
        },
        cognitiveAllocation: {
          shouldSpeak: true,
          effort: "medium",
          completion: "complete",
        },
        authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
      },
    });
    seedDelivery(db, "delivery-1", decisionId);
    confirmMutualAshleyDecision(db, uuid, decisionId, undefined, { capabilityMode: "dark_apply" });
    confirmMutualAshleyDelivery(db, uuid, "delivery-1", decisionId, { capabilityMode: "dark_apply" });
    expect(tryActivateMutualCommitment(db, uuid, { capabilityMode: "dark_apply" })).toBe(true);
    const row = db
      .prepare(`SELECT status FROM mutual_commitments WHERE entity_uuid = ?`)
      .get(uuid) as { status?: string };
    expect(row.status).toBe("active");
    db.close();
    continuity.close();
  });
});
