import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import {
  getOpenCognitiveContinuityStatus,
  materializeOpenCognitiveItem,
} from "./open-items.js";

const OWNER_ID = "doc";

function activateReading(db: DatabaseSync): void {
  activateCapability(db, "reading");
}

function activateCapability(db: DatabaseSync, capability: string): void {
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

function seedQuestion(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
  text: string,
): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO questions
       (owner_id, subject, text, status, priority, created_at, updated_at,
        entity_uuid, data_classification)
     VALUES (?, 'about_self', ?, 'open', 0.8, ?, ?, ?, 'never_public')`,
  ).run(ownerId, text, now, now, entityUuid);
  return Number(result.lastInsertRowid);
}

describe("OCI continuity diagnostics", () => {
  it("reports owner-scoped bounded counts without mutating state or leaking summaries", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateReading(db);
      const firstSourceId = seedQuestion(
        db,
        OWNER_ID,
        "diagnostic-question-1",
        "Private interview summary one",
      );
      const secondSourceId = seedQuestion(
        db,
        OWNER_ID,
        "diagnostic-question-2",
        "Private interview summary two",
      );
      const first = materializeOpenCognitiveItem(db, {
        ownerId: OWNER_ID,
        kind: "question",
        semanticSummary: "Private interview OCI one",
        source: {
          type: "question",
          id: String(firstSourceId),
          entityUuid: "diagnostic-question-1",
        },
        origin: "manual",
        semanticKeyMaterial: "diagnostic-one",
        provenance: "live",
        sourceCapability: "reading",
        contractId: currentContractId(),
        buildIdentity: currentBuildIdentity(),
        modelEpoch: 0,
      }).item;
      const second = materializeOpenCognitiveItem(db, {
        ownerId: OWNER_ID,
        kind: "revisit",
        semanticSummary: "Private interview OCI two",
        source: {
          type: "question",
          id: String(secondSourceId),
          entityUuid: "diagnostic-question-2",
        },
        origin: "manual",
        semanticKeyMaterial: "diagnostic-two",
        provenance: "live",
        sourceCapability: "reading",
        contractId: currentContractId(),
        buildIdentity: currentBuildIdentity(),
        modelEpoch: 0,
      }).item;
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      db.prepare(
        `UPDATE open_cognitive_item_attention
         SET defer_until = ?, review_requested_at = ?, delay_class = 'standard'
         WHERE item_id = ?`,
      ).run(future, new Date().toISOString(), first.id);

      const beforeReleases = db
        .prepare("SELECT COUNT(*) AS count FROM capability_releases")
        .get() as { count: number };
      const beforeKv = db
        .prepare("SELECT COUNT(*) AS count FROM kv")
        .get() as { count: number };
      const status = getOpenCognitiveContinuityStatus(db, OWNER_ID);
      const afterReleases = db
        .prepare("SELECT COUNT(*) AS count FROM capability_releases")
        .get() as { count: number };
      const afterKv = db
        .prepare("SELECT COUNT(*) AS count FROM kv")
        .get() as { count: number };

      expect(status).toMatchObject({
        totalCount: 2,
        openCount: 2,
        deferredCount: 1,
        reviewDueCount: 1,
        availableBySourceClass: { question: 1 },
        unavailableByReason: { deferred: 1 },
      });
      expect(status.availableBySourceClass).not.toHaveProperty("revisit");
      expect(JSON.stringify(status)).not.toContain("Private interview");
      expect(status).not.toHaveProperty("semanticSummary");
      expect(first.entityUuid).not.toBe(second.entityUuid);
      expect(afterReleases).toEqual(beforeReleases);
      expect(afterKv).toEqual(beforeKv);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("reports capability demotion, shadow provenance, and deferral as unavailable without mutation", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateReading(db);
      activateCapability(db, "recall");
      activateCapability(db, "mind_state");
      const activeSourceId = seedQuestion(
        db,
        OWNER_ID,
        "diagnostic-active-question",
        "active diagnostic source",
      );
      const demotedSourceId = seedQuestion(
        db,
        OWNER_ID,
        "diagnostic-demoted-question",
        "demoted diagnostic source",
      );
      const shadowSourceId = seedQuestion(
        db,
        OWNER_ID,
        "diagnostic-shadow-question",
        "shadow diagnostic source",
      );
      const deferredSourceId = seedQuestion(
        db,
        OWNER_ID,
        "diagnostic-deferred-question",
        "deferred diagnostic source",
      );
      const source = (id: number, entityUuid: string) => ({
        type: "question" as const,
        id: String(id),
        entityUuid,
      });
      const materialize = (
        sourceRef: { type: "question"; id: string; entityUuid: string },
        capability: string,
        provenance: "live" | "shadow" = "live",
      ) =>
        materializeOpenCognitiveItem(db, {
          ownerId: OWNER_ID,
          kind: "question",
          semanticSummary: `diagnostic ${sourceRef.entityUuid}`,
          source: sourceRef,
          origin: "manual",
          provenance,
          sourceCapability: capability,
          contractId: currentContractId(),
          buildIdentity: currentBuildIdentity(),
          modelEpoch: 0,
        }).item;
      materialize(
        source(activeSourceId, "diagnostic-active-question"),
        "reading",
      );
      materialize(
        source(demotedSourceId, "diagnostic-demoted-question"),
        "mind_state",
      );
      materialize(
        source(shadowSourceId, "diagnostic-shadow-question"),
        "reading",
        "shadow",
      );
      const deferred = materialize(
        source(deferredSourceId, "diagnostic-deferred-question"),
        "reading",
      );
      db.prepare(
        "UPDATE open_cognitive_item_attention SET defer_until = ? WHERE item_id = ?",
      ).run(new Date(Date.now() + 3_600_000).toISOString(), deferred.id);
      db.prepare(
        `UPDATE capability_releases SET state = 'rolled_back'
         WHERE capability = 'mind_state' AND release_id = ?`,
      ).run(currentContractId());

      const beforeReleases = db
        .prepare("SELECT COUNT(*) AS count FROM capability_releases")
        .get() as { count: number };
      const beforeKv = db
        .prepare("SELECT COUNT(*) AS count FROM kv")
        .get() as { count: number };
      const status = getOpenCognitiveContinuityStatus(db, OWNER_ID);
      const afterReleases = db
        .prepare("SELECT COUNT(*) AS count FROM capability_releases")
        .get() as { count: number };
      const afterKv = db
        .prepare("SELECT COUNT(*) AS count FROM kv")
        .get() as { count: number };

      expect(status).toMatchObject({
        totalCount: 4,
        openCount: 4,
        availableBySourceClass: { question: 1 },
        unavailableByReason: {
          capability_blocked: 1,
          shadow: 1,
          deferred: 1,
        },
      });
      expect(getOpenCognitiveContinuityStatus(db, "other-owner")).toMatchObject({
        totalCount: 0,
        openCount: 0,
        availableBySourceClass: {},
        unavailableByReason: {},
      });
      expect(JSON.stringify(status)).not.toMatch(
        /active diagnostic source|demoted diagnostic source|shadow diagnostic source|deferred diagnostic source/i,
      );
      expect(afterReleases).toEqual(beforeReleases);
      expect(afterKv).toEqual(beforeKv);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });
});
