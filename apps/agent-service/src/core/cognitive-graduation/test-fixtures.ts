import type { DatabaseSync } from "node:sqlite";
import { logDecision } from "../agency/log.js";
import { insertAssertion } from "../memory/assertions.js";
import { claimProactiveDelivery, recordBubbleReceipt } from "../delivery/store.js";
import { resolveActiveThread } from "../memory/threads.js";
import { selectConsequentialPrediction } from "./predictions.js";
import type { CognitivePrediction } from "./types.js";

export const C4_OWNER = "c4-owner";
export const C4_TIME_1 = "2026-08-20T10:00:00.000Z";
export const C4_TIME_2 = "2026-08-21T10:00:00.000Z";

export function c4Assertion(
  db: DatabaseSync,
  textValue: string,
  recordedAt: string = C4_TIME_1,
  classification: "ordinary" | "sensitive" | "never_public" | "secret" = "ordinary",
): number {
  return insertAssertion(db, {
    ownerId: C4_OWNER,
    kind: "owner_interpretation",
    subjectFacet: "ashley_side",
    lineageKind: "ashley_native",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I2",
    claimText: textValue,
    sourceKind: "c4_fixture",
    recordedAt,
    authorityFrom: recordedAt,
    worldIntervalBasis: "adjudicated",
    authorityBasis: "adjudicated",
    dataClassification: classification,
  });
}

export function c4Decision(db: DatabaseSync, ownerId = C4_OWNER): number {
  return logDecision(db, {
    ownerId,
    channel: "test",
    trigger: "reactive",
    decision: {
      trigger: "reactive",
      kind: "speak",
      motivationIds: [],
      score: 50,
      reason: "C4 fixture decision",
      objective: "Observe the bounded result.",
      evidenceRefs: [],
      uncertainty: 0.7,
      urgency: 0.2,
      thoughtSource: "deterministic",
      thoughtError: null,
      affectLicense: {
        permitted: true,
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
}

export function c4Prediction(
  db: DatabaseSync,
  overrides: Partial<Parameters<typeof selectConsequentialPrediction>[1]> = {},
): CognitivePrediction {
  const first = c4Assertion(db, "Ashley keeps a bounded interest in compilers.", C4_TIME_1);
  const second = c4Assertion(db, "The compiler topic remains current across a later turn.", C4_TIME_2);
  return selectConsequentialPrediction(db, {
    ownerId: C4_OWNER,
    decisionId: c4Decision(db),
    judgmentText: "The bounded compiler interest is likely to remain useful.",
    judgmentClass: "ashley_interest",
    evidenceRefs: [
      { type: "assertion", id: first },
      { type: "assertion", id: second },
    ],
    evidentialStrength: 0.8,
    expectedObservableOutcome: { observed: true },
    expectedHorizon: "next_grounded_activity",
    modelRouteReceiptId: "route-receipt:c4-fixture",
    workingViewAssertionId: first,
    capabilityMode: "dark_apply",
    ...overrides,
  });
}

export function deliveredReservation(db: DatabaseSync, ownerId = C4_OWNER): number {
  const decisionId = c4Decision(db, ownerId);
  const threadId = resolveActiveThread(db, ownerId, "test");
  const reservation = claimProactiveDelivery(db, {
    ownerId,
    channel: "test",
    threadId,
    initiativeReservationId: 1,
    decisionId,
    draftText: "A bounded fixture delivery.",
    bubbles: [{ ordinal: 0, text: "A bounded fixture delivery." }],
    nowMs: Date.parse(C4_TIME_2),
  });
  recordBubbleReceipt(db, reservation.id, 0, "fixture-discord-message", Date.parse(C4_TIME_2) + 1000);
  db.prepare(
    "UPDATE delivery_reservations SET state = 'committed', finalized_at = ? WHERE id = ?",
  ).run(C4_TIME_2, reservation.id);
  return reservation.id;
}
