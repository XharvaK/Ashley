import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { logDecision } from "../agency/log.js";
import { collectMotivations } from "../agency/motivations.js";
import { openNuclearDb } from "../db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import type { Decision } from "../types.js";
import { observeReactiveRelationshipSignals } from "./authority.js";
import { recordConsentEvent } from "./consent.js";
import { listDueDocReminders } from "./store.js";
import { recordAshleySelfCommitment } from "./self-commitments.js";
import { recordRelationalTension } from "./tensions.js";
import {
  confirmMutualAshleyDecision,
  confirmMutualAshleyDelivery,
  confirmMutualDoc,
  proposeMutualCommitment,
  tryActivateMutualCommitment,
} from "./transitions.js";

const OWNER = "c5-writer-owner";

function allowMutualRelationship(db: DatabaseSync): void {
  const common = {
    ownerId: OWNER,
    scope: "private_relationship_projection",
    purpose: "bounded relationship thought",
    classification: "ordinary" as const,
    capabilityMode: "dark_apply" as const,
  };
  recordConsentEvent(db, {
    ...common,
    grantorIdentityRole: "doc",
    granteeOrConsumer: "ashley",
    evidenceOrDecisionRef: "message:writer-doc-consent",
    eventKind: "grant",
  });
  recordConsentEvent(db, {
    ...common,
    grantorIdentityRole: "ashley",
    granteeOrConsumer: "doc",
    evidenceOrDecisionRef: "decision:writer-ashley-consent",
    eventKind: "grant",
  });
}

function seedDelivery(
  db: DatabaseSync,
  entityUuid: string,
  decisionId: number | null,
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

function fixtureDecision(db: DatabaseSync, kind: Decision["kind"] = "speak"): number {
  return logDecision(db, {
    ownerId: OWNER,
    channel: "test",
    trigger: "reactive",
    decision: {
      trigger: "reactive",
      kind,
      motivationIds: [],
      score: 50,
      reason: "C5 writer decision",
      objective: "make a bounded relationship choice",
      evidenceRefs: [],
      uncertainty: 0.3,
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
        shouldSpeak: kind !== "silence",
        effort: "medium",
        completion: "complete",
      },
      authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
    },
  });
}

describe("C5 relationship writers", () => {
  it("records observe proposals as shadow and dark-apply fixture records as live, while apply fails closed", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const observeDecision = fixtureDecision(db);
      const observed = recordAshleySelfCommitment(db, {
        ownerId: OWNER,
        text: "Ashley will revisit the bounded topic.",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${observeDecision}`,
        decisionId: observeDecision,
        evidenceRefs: [{ type: "decision", id: observeDecision }],
        hostValidationOk: true,
        classification: "never_public",
        capabilityMode: "observe",
      });
      expect(observed.status).toBe("motivated");
      expect(observed.provenance).toBe("shadow");

      const repeatedShadow = recordAshleySelfCommitment(db, {
        ownerId: OWNER,
        text: "Ashley will revisit the bounded topic.",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${observeDecision}`,
        decisionId: observeDecision,
        evidenceRefs: [{ type: "decision", id: observeDecision }],
        hostValidationOk: true,
        classification: "never_public",
        capabilityMode: "dark_apply",
      });
      expect(repeatedShadow.status).toBe("motivated");
      expect(repeatedShadow.provenance).toBe("shadow");

      const darkDecision = fixtureDecision(db);
      const dark = recordAshleySelfCommitment(db, {
        ownerId: OWNER,
        text: "Ashley will review the bounded topic tomorrow.",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${darkDecision}`,
        decisionId: darkDecision,
        evidenceRefs: [{ type: "decision", id: darkDecision }],
        hostValidationOk: true,
        classification: "ordinary",
        capabilityMode: "dark_apply",
      });
      expect(dark.status).toBe("active");
      expect(dark.provenance).toBe("live");
      expect(() => recordAshleySelfCommitment(db, {
        ownerId: OWNER,
        text: "Live C5 is not authorized.",
        sourceEntityType: "decision",
        sourceEntityUuid: "decision:apply",
        decisionId: darkDecision,
        evidenceRefs: [{ type: "decision", id: darkDecision }],
        hostValidationOk: true,
        classification: "ordinary",
        capabilityMode: "apply",
      })).toThrow("relational_graduation_live_apply_not_authorized");
    } finally {
      db.close();
    }
  });

  it("requires evidence and a validated decision for tension and self-commitment writers", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const decisionId = fixtureDecision(db, "challenge");
      expect(() => recordAshleySelfCommitment(db, {
        ownerId: OWNER,
        text: "Missing evidence",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${decisionId}:missing`,
        decisionId,
        evidenceRefs: [],
        hostValidationOk: true,
        classification: "ordinary",
      })).toThrow("relationship_evidence_required");
      expect(() => recordRelationalTension(db, {
        ownerId: OWNER,
        text: "Missing evidence tension",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${decisionId}:tension`,
        decisionId,
        evidenceRefs: [],
        hostValidationOk: true,
        classification: "ordinary",
      })).toThrow("relationship_evidence_required");
      const tension = recordRelationalTension(db, {
        ownerId: OWNER,
        text: "A bounded disagreement remains unresolved.",
        sourceEntityType: "decision",
        sourceEntityUuid: `decision:${decisionId}:valid-tension`,
        decisionId,
        evidenceRefs: [{ type: "decision", id: decisionId }],
        hostValidationOk: true,
        classification: "ordinary",
      });
      expect(tension.status).toBe("open");
      expect(tension.repairStatus).toBe("open");
    } finally {
      db.close();
    }
  });

  it("uses an explicit reminder due clock without making a null due time fuel or auto-sending", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const previousMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateRelationshipCapabilities(db);
      observeReactiveRelationshipSignals(db, {
        ownerId: OWNER,
        message: "Remind me to review the shared notes.",
        messageEntityUuid: "message:due",
        dueAt: "2026-08-20T10:00:00.000Z",
      });
      observeReactiveRelationshipSignals(db, {
        ownerId: OWNER,
        message: "Remind me to review the private notes.",
        messageEntityUuid: "message:no-due",
        dueAt: null,
      });

      const due = listDueDocReminders(db, OWNER, "2026-08-21T10:00:00.000Z");
      expect(due).toHaveLength(1);
      expect(due[0]?.dueAt).toBe("2026-08-20T10:00:00.000Z");
      const motivations = collectMotivations(db, OWNER, "proactive");
      expect(motivations.filter((item) => item.kind === "reminder")).toHaveLength(1);
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM scheduled_proactive_messages WHERE owner_id = ?",
      ).get(OWNER)).toEqual({ count: 0 });
    } finally {
      env.cognitionMode = previousMode;
      db.close();
    }
  });

  it("keeps production mutual delivery separate from Ashley acceptance", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      allowMutualRelationship(db);
      const entityUuid = proposeMutualCommitment(db, {
        ownerId: OWNER,
        text: "We will revisit the notes together.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:mutual",
        classification: "ordinary",
        capabilityMode: "dark_apply",
      });
      seedDelivery(db, "delivery:expression-only", null);
      confirmMutualDoc(db, entityUuid, "message:owner-confirmed", { capabilityMode: "dark_apply" });
      confirmMutualAshleyDelivery(db, entityUuid, "delivery:expression-only", undefined, { capabilityMode: "dark_apply" });
      expect(tryActivateMutualCommitment(db, entityUuid, { capabilityMode: "dark_apply" })).toBe(false);
      const decisionId = fixtureDecision(db);
      seedDelivery(db, "delivery:authorized-expression", decisionId);
      confirmMutualAshleyDecision(db, entityUuid, decisionId, `decision:${decisionId}`, { capabilityMode: "dark_apply" });
      confirmMutualAshleyDelivery(db, entityUuid, "delivery:authorized-expression", decisionId, { capabilityMode: "dark_apply" });
      expect(tryActivateMutualCommitment(db, entityUuid, { capabilityMode: "dark_apply" })).toBe(true);
      expect(db.prepare(
        "SELECT status, ashley_decision_id, ashley_delivery_entity_uuid FROM mutual_commitments WHERE entity_uuid = ?",
      ).get(entityUuid)).toMatchObject({
        status: "active",
        ashley_decision_id: decisionId,
        ashley_delivery_entity_uuid: "delivery:authorized-expression",
      });
    } finally {
      db.close();
    }
  });

  it("does not time-shift an observe-era mutual proposal into dark-apply influence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      allowMutualRelationship(db);
      const entityUuid = proposeMutualCommitment(db, {
        ownerId: OWNER,
        text: "We will keep the bounded plan under review.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:shadow-mutual",
        classification: "ordinary",
      });
      confirmMutualDoc(db, entityUuid, "message:owner-confirmation");
      const decisionId = fixtureDecision(db);
      seedDelivery(db, "delivery:shadow-expression", decisionId);
      confirmMutualAshleyDecision(db, entityUuid, decisionId);
      confirmMutualAshleyDelivery(db, entityUuid, "delivery:shadow-expression", decisionId);

      expect(tryActivateMutualCommitment(db, entityUuid, { capabilityMode: "dark_apply" })).toBe(false);
      expect(db.prepare(
        "SELECT status, provenance FROM mutual_commitments WHERE entity_uuid = ?",
      ).get(entityUuid)).toEqual({ status: "proposed", provenance: "shadow" });

      expect(proposeMutualCommitment(db, {
        ownerId: OWNER,
        text: "We will keep the bounded plan under review.",
        sourceEntityType: "message",
        sourceEntityUuid: "message:shadow-mutual",
        classification: "ordinary",
        capabilityMode: "dark_apply",
      })).toBe(entityUuid);
      expect(db.prepare(
        "SELECT status, provenance FROM mutual_commitments WHERE entity_uuid = ?",
      ).get(entityUuid)).toEqual({ status: "proposed", provenance: "shadow" });
    } finally {
      db.close();
    }
  });
});
