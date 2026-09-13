import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import { insertMessage, resolveActiveThread } from "../memory/threads.js";
import {
  getOpenCognitiveItem,
  materializeOpenCognitiveItem,
  type OpenCognitiveItemProposal,
} from "./open-items.js";
import {
  OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD,
  OPEN_COGNITIVE_ITEM_DELAY_DURATIONS_MS,
  listOpenCognitiveItemReviewRequests,
  recordOpenCognitiveDecision,
  transitionOpenCognitiveItem,
} from "./reconsideration.js";
import { selectMotivationCandidates } from "../agency/candidate-selection.js";
import { processPendingOpenCognitiveReviews } from "../reflection/initiative.js";
import type { Decision, Motivation } from "../types.js";

const OWNER_ID = "doc";

function activateReading(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at,
        contract_id, build_identity, model_epoch)
     VALUES ('reading', ?, 'active', ?, ?, ?, ?, 0)
     ON CONFLICT(capability, release_id) DO UPDATE SET
       state = 'active', promoted_at = excluded.promoted_at,
       updated_at = excluded.updated_at, contract_id = excluded.contract_id,
       build_identity = excluded.build_identity, model_epoch = excluded.model_epoch`,
  ).run(
    currentContractId(),
    now,
    now,
    currentContractId(),
    currentBuildIdentity(),
  );
}

function seedItem(db: DatabaseSync, ownerId = OWNER_ID) {
  const now = "2026-08-09T00:00:00.000Z";
  const sourceEntityUuid = `question-source-${randomUUID()}`;
  db.prepare(
    `INSERT INTO questions
       (owner_id, subject, text, status, priority, created_at, updated_at,
        entity_uuid, data_classification)
     VALUES (?, 'about_self', 'How did the interview go?', 'open', 0.9, ?, ?, ?, 'never_public')`,
  ).run(ownerId, now, now, sourceEntityUuid);
  const sourceId = Number(
    (
      db.prepare("SELECT id FROM questions WHERE entity_uuid = ?").get(sourceEntityUuid) as {
        id: number;
      }
    ).id,
  );
  const proposal: OpenCognitiveItemProposal = {
    ownerId,
    kind: "question",
    semanticSummary: "A persistent question about the interview outcome",
    source: {
      type: "question",
      id: String(sourceId),
      entityUuid: sourceEntityUuid,
    },
    origin: "manual",
    semanticKeyMaterial: `interview:${sourceEntityUuid}`,
    provenance: "live",
    sourceCapability: "reading",
    contractId: currentContractId(),
    buildIdentity: currentBuildIdentity(),
    modelEpoch: 0,
  };
  return materializeOpenCognitiveItem(db, proposal).item;
}

function decision(
  kind: Decision["kind"],
  entityUuid: string,
  delayClass?: Decision["delayClass"],
): Decision {
  return {
    trigger: "proactive",
    kind,
    delayClass,
    motivationIds: [1],
    score: 60,
    reason: "bounded OCI test decision",
    evidenceRefs: [{ type: "open_cognitive_item", id: entityUuid }],
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
      reason: "test",
    },
    cognitiveAllocation: {
      shouldSpeak: kind !== "silence" && kind !== "delay",
      effort: "medium",
      completion: kind === "delay" ? "hold" : "complete",
    },
    authorizedClaims: {
      readingRecordIds: [],
      readingTitles: [],
      readingClaims: [],
    },
  };
}

describe("durable OCI reconsideration", () => {
  it("maps a delay class to a fixed defer_until and re-enters after expiry", () => {
    const path = join(tmpdir(), `ashley-oci-${randomUUID()}.db`);
    const originalMode = env.cognitionMode;
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    let db = openNuclearDb(new DatabaseSync(path), {
      continuity,
    });
    try {
      env.cognitionMode = "apply";
      activateReading(db);
      const item = seedItem(db);
      const now = new Date("2026-08-09T01:00:00.000Z");
      const result = recordOpenCognitiveDecision(db, {
        ownerId: OWNER_ID,
        decision: decision("delay", item.entityUuid, "brief"),
        now,
      });
      expect(result.updated).toBe(1);
      const deferred = getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)!;
      expect(deferred.status).toBe("OPEN");
      expect(deferred.attention).toMatchObject({
        delayClass: "brief",
        deferUntil: new Date(
          now.getTime() + OPEN_COGNITIVE_ITEM_DELAY_DURATIONS_MS.brief,
        ).toISOString(),
        lastConsideredAt: now.toISOString(),
        considerationCount: 1,
        lastOutcomeCode: "delay:brief",
      });
      const motivation: Motivation = {
        id: 1,
        ownerId: OWNER_ID,
        kind: "question",
        score: 60,
        summary: deferred.semanticSummary,
        refType: "open_cognitive_item",
        refId: deferred.entityUuid,
      };
      expect(selectMotivationCandidates(db, OWNER_ID, "proactive", [motivation], now)).toEqual([]);

      db.close();
      db = openNuclearDb(new DatabaseSync(path), {
        continuity,
      });
      const afterExpiry = new Date(
        now.getTime() + OPEN_COGNITIVE_ITEM_DELAY_DURATIONS_MS.brief + 1,
      );
      expect(
        selectMotivationCandidates(db, OWNER_ID, "proactive", [motivation], afterExpiry),
      ).toEqual([motivation]);
    } finally {
      env.cognitionMode = originalMode;
      try {
        db.close();
      } catch {
        // The first close may have completed before a later assertion failed.
      }
      continuity.close();
      unlinkSync(path);
    }
  });

  it("requests one bounded Reflection review after repeated non-resolution", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateReading(db);
      const item = seedItem(db);
      const first = new Date("2026-08-09T02:00:00.000Z");
      for (let count = 0; count < OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD; count += 1) {
        recordOpenCognitiveDecision(db, {
          ownerId: OWNER_ID,
          decision: decision("delay", item.entityUuid, "standard"),
          now: new Date(first.getTime() + count * 86_400_001),
        });
      }
      const current = getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)!;
      expect(current.status).toBe("OPEN");
      expect(current.attention?.considerationCount).toBe(
        OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD,
      );
      expect(current.attention?.reviewRequestedAt).toBeTruthy();
      expect(listOpenCognitiveItemReviewRequests(db, OWNER_ID)).toEqual([
        expect.objectContaining({ entityUuid: item.entityUuid }),
      ]);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM open_cognitive_item_transitions
             WHERE item_id = ? AND from_status = 'OPEN' AND to_status = 'OPEN'
               AND reason = 'reflection_review_requested'`,
          )
          .get(item.id),
      ).toEqual({ count: 1 });
      expect(
        transitionOpenCognitiveItem(db, {
          ownerId: OWNER_ID,
          entityUuid: item.entityUuid,
          action: "keep_open",
          reason: "reflection_keep_open",
          now: new Date("2026-08-12T00:00:00.000Z"),
        }).status,
      ).toBe("OPEN");
      expect(listOpenCognitiveItemReviewRequests(db, OWNER_ID)).toEqual([]);
      expect(
        transitionOpenCognitiveItem(db, {
          ownerId: OWNER_ID,
          entityUuid: item.entityUuid,
          action: "withdraw",
          reason: "reflection_withdraw",
        }).status,
      ).toBe("WITHDRAWN");
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("keeps delivery unresolved, validates grounded resolution, and rejects reverse or cross-owner transitions", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateReading(db);
      const item = seedItem(db);
      const speak = recordOpenCognitiveDecision(db, {
        ownerId: OWNER_ID,
        decision: decision("ask", item.entityUuid),
        now: new Date("2026-08-09T04:00:00.000Z"),
      });
      expect(speak.updated).toBe(1);
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)?.status).toBe("OPEN");

      const threadId = resolveActiveThread(db, OWNER_ID);
      const evidenceMessageId = insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "The interview went well.",
      });
      const resolved = transitionOpenCognitiveItem(db, {
        ownerId: OWNER_ID,
        entityUuid: item.entityUuid,
        action: "resolve",
        reason: "grounded_answer",
        evidenceRefs: [{ type: "message", id: evidenceMessageId }],
        now: new Date("2026-08-09T05:00:00.000Z"),
      });
      expect(resolved.status).toBe("RESOLVED");
      expect(
        db.prepare("SELECT status FROM questions WHERE id = ?").get(Number(item.sourceId)),
      ).toEqual({ status: "open" });
      expect(
        recordOpenCognitiveDecision(db, {
          ownerId: OWNER_ID,
          decision: decision("delay", item.entityUuid, "brief"),
          now: new Date("2026-08-09T06:00:00.000Z"),
        }).updated,
      ).toBe(0);
      expect(() =>
        transitionOpenCognitiveItem(db, {
          ownerId: "other-owner",
          entityUuid: item.entityUuid,
          action: "withdraw",
          reason: "wrong_owner",
        }),
      ).toThrow("oci_owner_mismatch");
      expect(() =>
        transitionOpenCognitiveItem(db, {
          ownerId: OWNER_ID,
          entityUuid: item.entityUuid,
          action: "withdraw",
          reason: "reverse_transition",
        }),
      ).toThrow("oci_transition_not_allowed");
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("lets Reflection consume a valid review through the OCI transition owner", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateReading(db);
      const item = seedItem(db);
      for (let count = 0; count < OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD; count += 1) {
        recordOpenCognitiveDecision(db, {
          ownerId: OWNER_ID,
          decision: decision("delay", item.entityUuid, "standard"),
          now: new Date(10_000 + count * 86_400_001),
        });
      }

      const result = processPendingOpenCognitiveReviews(db, OWNER_ID);

      expect(result).toEqual({ processed: 1, skipped: 0 });
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)).toMatchObject({
        status: "OPEN",
        attention: {
          delayClass: "long",
          reviewRequestedAt: null,
          lastOutcomeCode: "reflection_keep_open",
        },
      });
      expect(listOpenCognitiveItemReviewRequests(db, OWNER_ID)).toEqual([]);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("keeps invalid external resolution and withdrawn-source review requests fail closed", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateReading(db);
      const item = seedItem(db);
      for (let count = 0; count < OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD; count += 1) {
        recordOpenCognitiveDecision(db, {
          ownerId: OWNER_ID,
          decision: decision("delay", item.entityUuid, "standard"),
          now: new Date(20_000 + count * 86_400_001),
        });
      }
      const invalid = processPendingOpenCognitiveReviews(
        db,
        OWNER_ID,
        () => ({
          action: "resolve",
          reason: "invalid_external_resolution",
          evidenceRefs: [],
        }),
      );
      expect(invalid).toEqual({ processed: 0, skipped: 1 });
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)?.status).toBe("OPEN");
      expect(listOpenCognitiveItemReviewRequests(db, OWNER_ID)).toEqual([]);
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)?.attention).toMatchObject({
        reviewAttemptCount: 1,
        reviewLastDisposition: "invalid_transition",
        lastOutcomeCode: "reflection_quarantined:invalid_transition",
      });

      const unavailable = seedItem(db);
      for (let count = 0; count < OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD; count += 1) {
        recordOpenCognitiveDecision(db, {
          ownerId: OWNER_ID,
          decision: decision("delay", unavailable.entityUuid, "standard"),
          now: new Date(30_000 + count * 86_400_001),
        });
      }
      db.prepare("UPDATE questions SET status = 'forgotten' WHERE id = ?").run(Number(unavailable.sourceId));
      const withdrawnSource = processPendingOpenCognitiveReviews(db, OWNER_ID);
      expect(withdrawnSource).toEqual({ processed: 0, skipped: 1 });
      expect(getOpenCognitiveItem(db, OWNER_ID, unavailable.entityUuid)).toMatchObject({
        status: "OPEN",
        attention: {
          reviewRequestedAt: null,
          reviewLastDisposition: "source_unavailable",
          lastOutcomeCode: "reflection_quarantined:source_unavailable",
        },
      });
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("processes at most eight review requests per bounded Reflection invocation", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateReading(db);
      for (let index = 0; index < 12; index += 1) {
        const item = seedItem(db);
        for (let count = 0; count < OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD; count += 1) {
          recordOpenCognitiveDecision(db, {
            ownerId: OWNER_ID,
            decision: decision("delay", item.entityUuid, "standard"),
            now: new Date(30_000 + count * 86_400_001 + index),
          });
        }
      }

      const result = processPendingOpenCognitiveReviews(db, OWNER_ID);

      expect(result).toEqual({ processed: 8, skipped: 0 });
      expect(listOpenCognitiveItemReviewRequests(db, OWNER_ID)).toHaveLength(4);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });
});
