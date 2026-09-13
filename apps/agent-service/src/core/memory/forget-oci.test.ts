import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { currentModelContinuityIdentity } from "../attention/continuity.js";
import { runAttentiveDispatch } from "../attention/governor.js";
import { resolveActiveThread, insertMessage } from "./threads.js";
import { applyForgetTargets, forgetOwnerTopicImmediate } from "./forget.js";
import { upsertDocReminder } from "../relationship/store.js";
import {
  getOpenCognitiveItem,
  materializeOpenCognitiveItem,
  openCognitiveItemEligibleForInfluence,
  type OpenCognitiveItemProposal,
} from "../cognition/open-items.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";

const OWNER_ID = "doc";

function activate(db: DatabaseSync, capability: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at,
        contract_id, build_identity, model_epoch)
     VALUES (?, ?, 'active', ?, ?, ?, ?, 0)
     ON CONFLICT(capability, release_id) DO UPDATE SET
       state = 'active', promoted_at = excluded.promoted_at,
       updated_at = excluded.updated_at, contract_id = excluded.contract_id,
       build_identity = excluded.build_identity, model_epoch = excluded.model_epoch`,
  ).run(
    capability,
    currentContractId(),
    now,
    now,
    currentContractId(),
    currentBuildIdentity(),
  );
}

describe("OCI forget and provenance boundaries", () => {
  it("redacts OCI semantic content when its message source is forgotten", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activate(db, "recall");
      const threadId = resolveActiveThread(db, OWNER_ID);
      const messageId = insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "The interview outcome is still open.",
      });
      const source = db
        .prepare("SELECT entity_uuid FROM mem_messages WHERE id = ?")
        .get(messageId) as { entity_uuid: string };
      const proposal: OpenCognitiveItemProposal = {
        ownerId: OWNER_ID,
        kind: "question",
        semanticSummary: "Remember the interview outcome",
        source: {
          type: "message",
          id: String(messageId),
          entityUuid: source.entity_uuid,
        },
        origin: "manual",
        semanticKeyMaterial: "forget-source-test",
        provenance: "live",
        sourceCapability: "recall",
        contractId: currentContractId(),
        buildIdentity: currentBuildIdentity(),
        modelEpoch: 0,
      };
      const item = materializeOpenCognitiveItem(db, proposal).item;
      expect(
        applyForgetTargets(db, OWNER_ID, [
          { entityType: "mem_messages", entityUuid: source.entity_uuid, action: "redact" },
        ]),
      ).toMatchObject({ receiptId: expect.any(String) });
      const forgotten = getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)!;
      expect(forgotten.semanticSummary).toBe("[redacted]");
      expect(forgotten.status).toBe("WITHDRAWN");
      expect(forgotten.redactedAt).toEqual(expect.any(String));
      expect(openCognitiveItemEligibleForInfluence(db, forgotten)).toBe(false);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("keeps a shadow OCI non-influential after the capability later becomes active", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "observe";
      const threadId = resolveActiveThread(db, OWNER_ID);
      const messageId = insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "Shadow provenance must not time shift.",
      });
      const source = db
        .prepare("SELECT entity_uuid FROM mem_messages WHERE id = ?")
        .get(messageId) as { entity_uuid: string };
      const item = materializeOpenCognitiveItem(db, {
        ownerId: OWNER_ID,
        kind: "revisit",
        semanticSummary: "A shadow revisit",
        source: {
          type: "message",
          id: String(messageId),
          entityUuid: source.entity_uuid,
        },
        origin: "manual",
        semanticKeyMaterial: "shadow-time-shift",
        provenance: "shadow",
        sourceCapability: "recall",
        contractId: currentContractId(),
        buildIdentity: currentBuildIdentity(),
        modelEpoch: 0,
      }).item;
      env.cognitionMode = "apply";
      activate(db, "recall");
      expect(item.provenance).toBe("shadow");
      expect(openCognitiveItemEligibleForInfluence(db, item)).toBe(false);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("fails closed after capability demotion, model epoch change, source revision, and deletion", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    const originalGroqKey = env.groqApiKey;
    try {
      env.cognitionMode = "apply";
      env.groqApiKey = "test-key";
      activate(db, "reading");
      const now = "2026-08-09T00:00:00.000Z";
      const jobId = Number(db.prepare(
        `INSERT INTO cognitive_jobs
           (owner_id, kind, source_key, payload_json, status, attempts,
            available_at, last_error, created_at, updated_at)
         VALUES (?, 'consolidate_thread', ?, '{}', 'pending', 0, ?, NULL, ?, ?)`
      ).run(
        OWNER_ID,
        "forget-model-continuity-test",
        now,
        now,
        now,
      ).lastInsertRowid);
      db.prepare(
        `INSERT INTO questions
           (owner_id, subject, text, status, priority, created_at, updated_at,
            entity_uuid, data_classification)
         VALUES (?, 'about_self', 'Which interview outcome remains open?', 'open',
                 0.8, ?, ?, ?, 'never_public')`,
      ).run(OWNER_ID, now, now, "source-question-revision");
      const source = db
        .prepare("SELECT id, entity_uuid, updated_at FROM questions WHERE entity_uuid = ?")
        .get("source-question-revision") as {
        id: number;
        entity_uuid: string;
        updated_at: string;
      };
      const dispatch = await runAttentiveDispatch<{ text: string }>(db, {
        messages: [{ role: "user", content: "forget model continuity fixture" }],
        purpose: "maintenance",
        lane: "curiosity_maintenance",
        modelAlias: env.mistralModel,
        providerId: "groq",
        quotaBucket: "groq:forget-model-continuity-test",
        ownerId: OWNER_ID,
        cognitiveJobId: jobId,
        dispatch: async () => ({
          providerModel: "model-v1",
          usage: { promptTokens: 2, completionTokens: 2 },
          result: { text: "accepted" },
        }),
      });
      const modelContinuity = currentModelContinuityIdentity(db, env.mistralModel);
      const item = materializeOpenCognitiveItem(db, {
        ownerId: OWNER_ID,
        kind: "question",
        semanticSummary: "The interview outcome remains unresolved",
        source: {
          type: "question",
          id: String(source.id),
          entityUuid: source.entity_uuid,
        },
        origin: "cognition",
        semanticKeyMaterial: "revision-authority",
        provenance: "live",
        sourceCapability: "reading",
        contractId: currentContractId(),
        buildIdentity: currentBuildIdentity(),
        modelEpoch: modelContinuity.modelEpoch,
        modelIdentity: modelContinuity.identity ?? "",
        dispatchIdentity: dispatch.acceptedDispatchIdentity,
        sourceRevision: source.updated_at,
      }).item;
      expect(openCognitiveItemEligibleForInfluence(db, item)).toBe(true);

      db.prepare(
        "UPDATE capability_releases SET state = 'rolled_back' WHERE capability = 'reading'",
      ).run();
      expect(openCognitiveItemEligibleForInfluence(db, item)).toBe(false);

      activate(db, "reading");
      db.prepare(
        `INSERT INTO model_continuity_state
           (alias, resolved_model_id, model_epoch, last_accepted_dispatch_sequence, updated_at)
         VALUES (?, 'model-v2', 1, 1, ?)
         ON CONFLICT(alias) DO UPDATE SET
           resolved_model_id = 'model-v2', model_epoch = 2,
           updated_at = excluded.updated_at`,
      ).run(env.mistralModel, now);
      expect(openCognitiveItemEligibleForInfluence(db, item)).toBe(false);

      db.prepare(
        "UPDATE model_continuity_state SET model_epoch = 0 WHERE alias = ?",
      ).run(env.mistralModel);
      db.prepare(
        "UPDATE questions SET text = 'The authoritative outcome changed', updated_at = ? WHERE id = ?",
      ).run("2026-08-09T00:01:00.000Z", source.id);
      expect(openCognitiveItemEligibleForInfluence(db, item)).toBe(false);

      db.prepare("DELETE FROM questions WHERE id = ?").run(source.id);
      expect(openCognitiveItemEligibleForInfluence(db, item)).toBe(false);
    } finally {
      env.cognitionMode = originalMode;
      env.groqApiKey = originalGroqKey;
      db.close();
    }
  });

  it("redacts OCI derived from a relationship source through the forget preview", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const db = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activate(db, "reading");
      const reminderUuid = upsertDocReminder(db, {
        ownerId: OWNER_ID,
        text: "Private interview follow-up plan",
        dueAt: null,
        sourceEntityType: "message",
        sourceEntityUuid: "source-message-relationship",
        classification: "ordinary",
        provenance: "live",
        partySubjectScope: "owner",
      });
      const reminder = db
        .prepare("SELECT id FROM doc_reminders WHERE entity_uuid = ?")
        .get(reminderUuid) as { id: number };
      const item = materializeOpenCognitiveItem(db, {
        ownerId: OWNER_ID,
        kind: "revisit",
        semanticSummary: "Revisit the private interview plan",
        source: {
          type: "doc_reminder",
          id: String(reminder.id),
          entityUuid: reminderUuid,
        },
        origin: "manual",
        semanticKeyMaterial: "relationship-forget",
        provenance: "live",
        sourceCapability: "reading",
        contractId: currentContractId(),
        buildIdentity: currentBuildIdentity(),
        modelEpoch: 0,
      }).item;

      const result = forgetOwnerTopicImmediate(
        db,
        OWNER_ID,
        "private interview follow-up",
        continuity,
      );
      expect(result.receiptId).toEqual(expect.any(String));
      const forgotten = getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)!;
      expect(forgotten.semanticSummary).toBe("[redacted]");
      expect(forgotten.status).toBe("WITHDRAWN");
      expect(forgotten.redactionCode).toBe("source_forgotten");
    } finally {
      env.cognitionMode = originalMode;
      db.close();
      continuity.close();
    }
  });
});
