import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { AshleyCore } from "../runtime.js";
import { logDecision } from "../agency/log.js";
import { collectMotivations } from "../agency/motivations.js";
import { decide } from "../agency/decide.js";
import { openNuclearDb } from "../db.js";
import { insertAssertion } from "../memory/assertions.js";
import { admitOwnerCorrection } from "../memory/corrections.js";
import { fanoutCorrection } from "../memory/fanout.js";
import { insertMessage, resolveActiveThread } from "../memory/threads.js";
import { recordIdentityEntry } from "../identity/store.js";
import { listIdentityReviews, proposeRevision } from "../learning/revisions.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import { observeReactiveRelationshipSignals } from "./authority.js";
import { recordConsentEvent } from "./consent.js";
import {
  getCurrentSharedCulture,
  recomputeSharedCulture,
  relationshipProjectionDiagnostics,
} from "./projections.js";
import { recordRepairAdjudication, recordRepairProposal } from "./repair.js";
import { recordRelationalTension } from "./tensions.js";
import {
  confirmMutualAshleyDecision,
  confirmMutualAshleyDelivery,
  confirmMutualDoc,
  proposeMutualCommitment,
  tryActivateMutualCommitment,
} from "./transitions.js";

const OWNER = "c5-settlement-owner";

function allowMutualRelationship(db: DatabaseSync): void {
  const common = {
    ownerId: OWNER,
    scope: "private_relationship_projection",
    purpose: "bounded relationship thought",
    classification: "ordinary" as const,
    eventKind: "grant" as const,
    capabilityMode: "dark_apply" as const,
  };
  recordConsentEvent(db, {
    ...common,
    grantorIdentityRole: "doc",
    granteeOrConsumer: "ashley",
    evidenceOrDecisionRef: "message:settlement-doc-consent",
  });
  recordConsentEvent(db, {
    ...common,
    grantorIdentityRole: "ashley",
    granteeOrConsumer: "doc",
    evidenceOrDecisionRef: "decision:settlement-ashley-consent",
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
     VALUES (?, 'test', 'thread', ?, 'reactive', 'committed', ?, ?)` ,
  ).run(OWNER, decisionId, new Date().toISOString(), entityUuid);
}

function activateRelationshipCapabilities(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at,
        contract_id, build_identity, model_epoch)
     VALUES (?, ?, 'active', ?, ?, ?, ?, 0)
     ON CONFLICT(capability, release_id) DO UPDATE SET state = 'active'`,
  );
  for (const capability of [
    "recall", "mind_state", "thought", "relational_initiative", "relationship_state",
  ]) {
    insert.run(capability, currentContractId(), now, now, currentContractId(), currentBuildIdentity());
  }
}

function decision(db: DatabaseSync, kind: "speak" | "challenge" = "speak"): number {
  return logDecision(db, {
    ownerId: OWNER,
    channel: "test",
    trigger: "reactive",
    decision: {
      trigger: "reactive",
      kind,
      motivationIds: [],
      score: 50,
      reason: "C5 settlement decision",
      objective: "make a bounded relationship choice",
      evidenceRefs: [],
      uncertainty: 0.2,
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
}

function assertion(
  db: DatabaseSync,
  subjectFacet: "owner_model" | "ashley_side",
  text: string,
): number {
  return insertAssertion(db, {
    ownerId: OWNER,
    kind: "owner_interpretation",
    subjectFacet,
    lineageKind: subjectFacet === "owner_model" ? "owner_designated" : "ashley_native",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I1",
    claimText: text,
    sourceKind: "c5_settlement_fixture",
    recordedAt: "2026-08-20T10:00:00.000Z",
    authorityFrom: "2026-08-20T10:00:00.000Z",
    worldIntervalBasis: "adjudicated",
    authorityBasis: "adjudicated",
    dataClassification: defaultUnclassifiedConversational(),
  });
}

describe("C5 local settlement witness", () => {
  it("recomputes the current projection through the C1 correction fan-out seam", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const ownerAssertion = assertion(db, "owner_model", "Doc enjoys careful correction work.");
      assertion(db, "ashley_side", "Ashley enjoys careful correction work.");
      recomputeSharedCulture(db, OWNER, { at: new Date("2026-08-20T12:00:00.000Z") });
      const threadId = resolveActiveThread(db, OWNER, "discord");
      const sourceMessageId = insertMessage(db, {
        threadId,
        ownerId: OWNER,
        role: "user",
        text: "The stored owner relationship fact is wrong and must be corrected.",
        channel: "discord",
      });
      const admitted = admitOwnerCorrection(db, {
        ownerId: OWNER,
        sourceMessageId,
        correctionOrdinal: 1,
        admissionPath: "typed_control",
        class: "INTERPRETATION_INVALIDATION",
        scopeText: "owner relationship fact",
        targets: [{
          assertionId: ownerAssertion,
          inclusionReason: "owner_confirmed",
          resolutionBasis: "owner_confirmed",
        }],
        capabilityMode: "apply",
      });

      const result = fanoutCorrection(db, admitted.correction.id);
      expect(result.receipt.readbackOk).toBe(true);
      expect(result.readback.blockedAssertionIds).toContain(ownerAssertion);
      expect(getCurrentSharedCulture(db, OWNER)?.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(relationshipProjectionDiagnostics(db, OWNER)).toMatchObject({
        currentCount: 1,
        historicalCount: 1,
      });
    } finally {
      db.close();
    }
  });

  it("recomputes shared culture when an owner-authorized Ashley Identity revision applies", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const previousMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      const core = new AshleyCore(db);
      const oldIdentityId = recordIdentityEntry(db, {
        ownerId: OWNER,
        layer: "stable",
        kind: "value.honesty_over_comfort",
        text: "Ashley values careful compiler work.",
        source: "manual",
      });
      assertion(db, "owner_model", "Doc values careful compiler work.");
      const before = recomputeSharedCulture(db, OWNER);
      expect(before.sourceBindings.ashleyIdentityEntryIds).toContain(oldIdentityId);

      const revisionId = proposeRevision(db, {
        ownerId: OWNER,
        targetLayer: "stable_identity",
        targetKey: "value.honesty_over_comfort",
        proposedValue: "Ashley values patient watercolor work.",
        rationale: "Owner-authorized Identity review fixture.",
        evidenceType: "message",
        evidenceId: "message:identity-review",
        provenance: "shadow",
      });
      const review = listIdentityReviews(db, OWNER).find((item) => item.revisionId === revisionId);
      expect(review).toBeDefined();

      expect(core.recordAshleyIdentityPosition({
        ownerId: OWNER,
        reviewId: review!.id,
        position: "affirm",
        rationale: "Ashley review evidence.",
        evidenceType: "message",
        evidenceId: "message:identity-review",
      }).recorded).toBe(true);
      expect(core.recordDocIdentityDecision({
        ownerId: OWNER,
        reviewId: review!.id,
        decision: "approve",
        rationale: "Owner approves the bounded revision.",
      }).recorded).toBe(true);

      const after = getCurrentSharedCulture(db, OWNER);
      expect(after?.sourceBindings.ashleyIdentityEntryIds).toEqual([]);
      expect(after?.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(relationshipProjectionDiagnostics(db, OWNER)).toMatchObject({
        currentCount: 1,
        historicalCount: 1,
      });
    } finally {
      env.cognitionMode = previousMode;
      db.close();
    }
  });

  it("proves bounded proposal, bilateral decision, reminder motivation, repair separation, withdrawal, and correction", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const previousMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateRelationshipCapabilities(db);
      allowMutualRelationship(db);

      const ownerAssertion = assertion(db, "owner_model", "Doc enjoys careful repair work.");
      assertion(db, "ashley_side", "Ashley enjoys careful repair work.");
      const firstProjection = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-20T12:00:00.000Z"),
      });
      expect(firstProjection.sourceBindings.ownerAssertionIds).toContain(ownerAssertion);

      const mutualUuid = proposeMutualCommitment(db, {
        ownerId: OWNER,
        text: "We will review the repair notes together.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:bounded-proposal",
        classification: "ordinary",
        capabilityMode: "dark_apply",
      });
      confirmMutualDoc(db, mutualUuid, "message:owner-explicit-confirmation", { capabilityMode: "dark_apply" });
      const ashleyDecisionId = decision(db);
      seedDelivery(db, "delivery:accepted-expression", ashleyDecisionId);
      confirmMutualAshleyDecision(db, mutualUuid, ashleyDecisionId, undefined, { capabilityMode: "dark_apply" });
      confirmMutualAshleyDelivery(db, mutualUuid, "delivery:accepted-expression", ashleyDecisionId, { capabilityMode: "dark_apply" });
      expect(tryActivateMutualCommitment(db, mutualUuid, { capabilityMode: "dark_apply" })).toBe(true);

      observeReactiveRelationshipSignals(db, {
        ownerId: OWNER,
        message: "Remind me to review the repair notes.",
        messageEntityUuid: "message:reminder",
        dueAt: "2026-08-20T13:00:00.000Z",
      });
      expect(collectMotivations(db, OWNER, "proactive")
        .some((motivation) => motivation.kind === "reminder")).toBe(true);
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM scheduled_proactive_messages WHERE owner_id = ?",
      ).get(OWNER)).toEqual({ count: 0 });

      const tensionDecisionId = decision(db, "challenge");
      const tension = recordRelationalTension(db, {
        ownerId: OWNER,
        text: "The scope of the repair may still be misunderstood.",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${tensionDecisionId}:tension`,
        decisionId: tensionDecisionId,
        evidenceRefs: [{ type: "decision", id: tensionDecisionId }],
        hostValidationOk: true,
        classification: "never_public",
      });
      const proposal = recordRepairProposal(db, {
        ownerId: OWNER,
        tensionId: tension.id,
        proposalOrigin: "model",
        text: "Ask once for clarification without pressure.",
        evidenceRefs: [{ type: "relational_tension", id: tension.entityUuid }],
        classification: "never_public",
      });
      const adjudication = recordRepairAdjudication(db, {
        ownerId: OWNER,
        proposalId: proposal.id,
        disposition: "unresolved",
        adjudicatingDecisionId: decision(db, "challenge"),
        hostValidationOk: true,
        classification: "never_public",
        deliveryReceiptId: "delivery:not-a-repair-verdict",
      });
      expect(adjudication.disposition).toBe("unresolved");
      expect(db.prepare(
        "SELECT status FROM relational_tensions WHERE id = ?",
      ).get(tension.id)).toEqual({ status: "open" });

      const withdrawal = db.prepare(
        `SELECT entity_uuid FROM withdrawal_records WHERE owner_id = ? LIMIT 1`,
      ).get(OWNER) as { entity_uuid?: string } | undefined;
      expect(withdrawal).toBeUndefined();
      observeReactiveRelationshipSignals(db, {
        ownerId: OWNER,
        message: "Please leave me alone for now.",
        messageEntityUuid: "message:space",
      });
      const silenced = decide([], "proactive", { db, ownerId: OWNER });
      expect(silenced.kind).toBe("silence");
      expect(silenced.silenceReasonCode).toBe("withdrawal_pause");

      db.prepare(
        `UPDATE memory_assertions SET termination_reason = 'invalidated',
         authority_to = '2026-08-21T12:00:00.000Z' WHERE id = ?`,
      ).run(ownerAssertion);
      const corrected = recomputeSharedCulture(db, OWNER, {
        at: new Date("2026-08-21T12:00:00.000Z"),
      });
      expect(corrected.sourceBindings.ownerAssertionIds).toEqual([]);
      expect(relationshipProjectionDiagnostics(db, OWNER)).toMatchObject({
        currentCount: 1,
        historicalCount: 1,
      });
    } finally {
      env.cognitionMode = previousMode;
      db.close();
    }
  });
});
