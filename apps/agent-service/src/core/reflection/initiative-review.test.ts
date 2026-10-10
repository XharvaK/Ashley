import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { resetAdapterCache } from "../../mistral-client.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import * as commandCodeAdapterModule from "../model-routing/adapters/command-code-adapter.js";
import {
  beginAuthorityTransition,
  stabilizeAuthorityBarrier,
} from "../cognitive-v021/authority/barrier.js";
import { openContinuityDb } from "../continuity/db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import {
  getOpenCognitiveItem,
  materializeOpenCognitiveItem,
} from "../cognition/open-items.js";
import {
  processPendingOpenCognitiveReviewsAsync,
  processPendingOpenCognitiveReviews,
  parseReflectionReviewResponse,
} from "./initiative.js";

const OWNER_ID = "doc";
const originalCommandCodeKey = env.commandCodeApiKey;

afterEach(() => {
  env.commandCodeApiKey = originalCommandCodeKey;
  resetAdapterCache();
  vi.restoreAllMocks();
});

function stubReflectionDispatch(text: string) {
  env.commandCodeApiKey = "test-command-code-key";
  const dispatch = vi.fn(async (args: { modelId: string }) => ({
    text,
    providerModel: args.modelId,
    providerRequestId: "reflection-consumer-1",
    providerHttpStatus: 200,
    providerRequestHash: "sha256:request",
    providerResponseHash: `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`,
    usage: { promptTokens: 2, completionTokens: 1 },
    finishReason: "stop",
  }));
  vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
    provider: "command_code",
    dispatch,
  } as never);
  return dispatch;
}

function activateReading(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at,
        contract_id, build_identity, model_epoch)
     VALUES ('reading', ?, 'active', ?, ?, ?, ?, 0)`,
  ).run(
    currentContractId(),
    now,
    now,
    currentContractId(),
    currentBuildIdentity(),
  );
}

function seedReviewItem(db: DatabaseSync, suffix: string, ownerId = OWNER_ID) {
  const entityUuid = `reflection-source-${suffix}-${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO questions
       (owner_id, subject, text, status, priority, created_at, updated_at,
        entity_uuid, data_classification)
     VALUES (?, 'about_self', ?, 'open', 0.8, ?, ?, ?, 'never_public')`,
  ).run(ownerId, `Reflection source ${suffix}`, now, now, entityUuid);
  const source = db
    .prepare("SELECT id, entity_uuid FROM questions WHERE entity_uuid = ?")
    .get(entityUuid) as { id: number; entity_uuid: string };
  const item = materializeOpenCognitiveItem(db, {
    ownerId,
    kind: "question",
    semanticSummary: `Reflection item ${suffix}`,
    source: {
      type: "question",
      id: String(source.id),
      entityUuid: source.entity_uuid,
    },
    origin: "manual",
    provenance: "live",
    sourceCapability: "reading",
    contractId: currentContractId(),
    buildIdentity: currentBuildIdentity(),
    modelEpoch: 0,
  }).item;
  db.prepare(
    `UPDATE open_cognitive_item_attention
     SET review_requested_at = ?, consideration_count = 3
     WHERE item_id = ?`,
  ).run(now, item.id);
  return item;
}

describe("Reflection OCI adjudication", () => {
  it("parses only bounded advisory Reflection actions", () => {
    expect(parseReflectionReviewResponse('{"action":"KEEP"}')).toMatchObject({
      action: "keep_open",
      reason: "reflection_model_keep_open",
      authorityClass: "NON_AUTHORITATIVE_ADVISORY_OUTPUT",
    });
    expect(parseReflectionReviewResponse('{"action":"WITHDRAW"}')).toMatchObject({
      action: "withdraw",
      reason: "reflection_model_withdraw",
    });
    expect(parseReflectionReviewResponse(
      '{"action":"SUPERSEDE","replacementEntityUuid":"replacement"}',
    )).toMatchObject({
      action: "supersede",
      replacementEntityUuid: "replacement",
    });
    expect(parseReflectionReviewResponse('{"action":"speak"}')).toBeNull();
    const hostile = parseReflectionReviewResponse(
      '{"action":"WITHDRAW","speech":"send","identityMeaning":"changed","salience":99}',
    );
    expect(hostile).toMatchObject({
      action: "withdraw",
      authorityClass: "NON_AUTHORITATIVE_ADVISORY_OUTPUT",
    });
    expect(hostile).not.toHaveProperty("speech");
    expect(hostile).not.toHaveProperty("identityMeaning");
    expect(hostile).not.toHaveProperty("salience");
  });

  it("does not let advisory Reflection mutate an OCI during an authority transition", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const item = seedReviewItem(db, "transition-fence");
    const transition = beginAuthorityTransition(
      db,
      "p5_advisory_fence_test",
      Date.now(),
    );
    try {
      await expect(
        processPendingOpenCognitiveReviewsAsync(
          db,
          OWNER_ID,
          async () => ({ action: "withdraw", reason: "advisory_fixture" }),
        ),
      ).resolves.toEqual({ processed: 0, skipped: 1 });
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)?.status).toBe("OPEN");
    } finally {
      stabilizeAuthorityBarrier(db, transition.vector, Date.now(), transition.transitionId);
      db.close();
    }
  });

  it("uses an injected Reflection decision to withdraw and supersede", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const withdraw = seedReviewItem(db, "withdraw");
    const supersede = seedReviewItem(db, "supersede");
    const replacement = seedReviewItem(db, "replacement");
    db.prepare(
      `UPDATE open_cognitive_item_attention
       SET review_requested_at = NULL WHERE item_id = ?`,
    ).run(replacement.id);
    try {
      const result = await processPendingOpenCognitiveReviewsAsync(
        db,
        OWNER_ID,
        async (_db, item) => item.id === withdraw.id
          ? { action: "withdraw", reason: "reflection_fixture_withdraw" }
          : {
              action: "supersede",
              reason: "reflection_fixture_supersede",
              replacementEntityUuid: replacement.entityUuid,
            },
      );
      expect(result).toEqual({ processed: 2, skipped: 0 });
      expect(getOpenCognitiveItem(db, OWNER_ID, withdraw.entityUuid)?.status).toBe("WITHDRAWN");
      expect(getOpenCognitiveItem(db, OWNER_ID, supersede.entityUuid)?.status).toBe("SUPERSEDED");
      expect(getOpenCognitiveItem(db, OWNER_ID, replacement.entityUuid)?.status).toBe("OPEN");
    } finally {
      db.close();
    }
  });

  it("keeps invalid resolutions open, records disposition, and reaches the valid ninth request", async () => {
    const path = join(tmpdir(), `ashley-reflection-fairness-${randomUUID()}.db`);
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    let db = openNuclearDb(new DatabaseSync(path), {
      continuity,
    });
    activateReading(db);
    const valid = seedReviewItem(db, "valid-ninth");
    const invalid = Array.from({ length: 8 }, (_, index) => seedReviewItem(db, `invalid-${index}`));
    try {
      const invalidIds = new Set(invalid.map((item) => item.id));
      const attemptedIds: number[] = [];
      const adjudicator = async (_db: DatabaseSync, item: typeof valid) => {
        attemptedIds.push(item.id);
        return invalidIds.has(item.id)
          ? {
            action: "resolve" as const,
            reason: "reflection_fixture_invalid_resolution",
            evidenceRefs: [],
          }
          : { action: "withdraw" as const, reason: "reflection_fixture_valid" };
      };

      const first = await processPendingOpenCognitiveReviewsAsync(db, OWNER_ID, adjudicator);
      expect(first).toEqual({ processed: 0, skipped: 8 });
      expect(getOpenCognitiveItem(db, OWNER_ID, valid.entityUuid)?.status).toBe("OPEN");
      expect(
        db.prepare(
          `SELECT review_attempt_count, review_last_disposition,
                  review_requested_at, last_outcome_code
           FROM open_cognitive_item_attention WHERE item_id = ?`,
        ).get(invalid[7]!.id),
      ).toEqual({
        review_attempt_count: 1,
        review_last_disposition: "invalid_transition",
        review_requested_at: null,
        last_outcome_code: "reflection_quarantined:invalid_transition",
      });
      const firstAttemptIds = [...attemptedIds];

      db.close();
      db = openNuclearDb(new DatabaseSync(path), {
        continuity,
      });

      const second = await processPendingOpenCognitiveReviewsAsync(db, OWNER_ID, adjudicator);
      expect(second).toEqual({ processed: 1, skipped: 0 });
      expect(attemptedIds.slice(firstAttemptIds.length)).toEqual([valid.id]);
      expect(firstAttemptIds).not.toContain(valid.id);
      expect(getOpenCognitiveItem(db, OWNER_ID, valid.entityUuid)?.status).toBe("WITHDRAWN");
    } finally {
      try {
        db.close();
      } catch {
        // The connection was already closed before the restart assertion.
      }
      continuity.close();
      unlinkSync(path);
    }
  });

  it("backs off an adjudicator failure and does not hot-loop", async () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const item = seedReviewItem(db, "failure");
    try {
      const result = await processPendingOpenCognitiveReviewsAsync(
        db,
        OWNER_ID,
        async () => {
          throw new Error("reflection_fixture_failure");
        },
      );
      expect(result).toEqual({ processed: 0, skipped: 1 });
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)).toMatchObject({
        status: "OPEN",
        attention: {
          reviewRequestedAt: "2026-08-10T12:15:00.000Z",
          reviewAttemptCount: 1,
          reviewLastDisposition: "adjudicator_failure",
          lastOutcomeCode: "reflection_retry:adjudicator_failure",
        },
      });
      expect(processPendingOpenCognitiveReviews(db, OWNER_ID)).toEqual({
        processed: 0,
        skipped: 0,
      });

      vi.setSystemTime(new Date("2026-08-10T12:15:00.000Z"));
      expect(await processPendingOpenCognitiveReviewsAsync(
        db,
        OWNER_ID,
        async () => {
          throw new Error("reflection_fixture_failure");
        },
      )).toEqual({ processed: 0, skipped: 1 });
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)?.attention).toMatchObject({
        reviewRequestedAt: "2026-08-10T13:15:00.000Z",
        reviewAttemptCount: 2,
        lastOutcomeCode: "reflection_retry:adjudicator_failure",
      });

      vi.setSystemTime(new Date("2026-08-10T13:15:00.000Z"));
      expect(await processPendingOpenCognitiveReviewsAsync(
        db,
        OWNER_ID,
        async () => {
          throw new Error("reflection_fixture_failure");
        },
      )).toEqual({ processed: 0, skipped: 1 });
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)?.attention).toMatchObject({
        reviewRequestedAt: null,
        reviewAttemptCount: 3,
        reviewLastDisposition: "adjudicator_failure",
        lastOutcomeCode: "reflection_quarantined:adjudicator_failure",
      });
      vi.setSystemTime(new Date("2026-08-11T13:15:00.000Z"));
      expect(await processPendingOpenCognitiveReviewsAsync(
        db,
        OWNER_ID,
        async () => {
          throw new Error("must_not_retry_quarantined_review");
        },
      )).toEqual({ processed: 0, skipped: 0 });
    } finally {
      vi.useRealTimers();
      db.close();
    }
  });

  it("keeps a queue larger than the intake cap moving toward the oldest request", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const valid = seedReviewItem(db, "large-queue-valid");
    const invalid = Array.from({ length: 17 }, (_, index) =>
      seedReviewItem(db, `large-queue-invalid-${index}`),
    );
    const invalidIds = new Set(invalid.map((item) => item.id));
    const adjudicator = async (_db: DatabaseSync, item: typeof valid) =>
      invalidIds.has(item.id)
        ? {
            action: "resolve" as const,
            reason: "reflection_fixture_invalid_large_queue",
            evidenceRefs: [],
          }
        : { action: "withdraw" as const, reason: "reflection_fixture_oldest" };
    try {
      expect(await processPendingOpenCognitiveReviewsAsync(db, OWNER_ID, adjudicator))
        .toEqual({ processed: 0, skipped: 8 });
      expect(await processPendingOpenCognitiveReviewsAsync(db, OWNER_ID, adjudicator))
        .toEqual({ processed: 0, skipped: 8 });
      expect(await processPendingOpenCognitiveReviewsAsync(db, OWNER_ID, adjudicator))
        .toEqual({ processed: 1, skipped: 1 });
      expect(getOpenCognitiveItem(db, OWNER_ID, valid.entityUuid)?.status).toBe("WITHDRAWN");
      expect(
        db.prepare(
          `SELECT COUNT(*) AS count FROM open_cognitive_items
           WHERE owner_id = ? AND status = 'OPEN'`,
        ).get(OWNER_ID),
      ).toMatchObject({ count: 17 });
    } finally {
      db.close();
    }
  });

  it("quarantines 100 invalid requests within bounded queue progression", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    Array.from({ length: 100 }, (_, index) => seedReviewItem(db, `hundred-${index}`));
    let skipped = 0;
    try {
      for (let invocation = 0; invocation < 13; invocation += 1) {
        const result = await processPendingOpenCognitiveReviewsAsync(
          db,
          OWNER_ID,
          async () => ({
            action: "resolve",
            reason: "reflection_fixture_invalid_hundred",
            evidenceRefs: [],
          }),
        );
        expect(result.processed).toBe(0);
        expect(result.skipped).toBeLessThanOrEqual(8);
        skipped += result.skipped;
      }
      expect(skipped).toBe(100);
      expect(await processPendingOpenCognitiveReviewsAsync(
        db,
        OWNER_ID,
        async () => {
          throw new Error("quarantined_rows_must_not_recur");
        },
      )).toEqual({ processed: 0, skipped: 0 });
      expect(
        db.prepare(
          `SELECT COUNT(*) AS count
           FROM open_cognitive_item_attention a
           JOIN open_cognitive_items o ON o.id = a.item_id
           WHERE o.owner_id = ?
             AND a.review_attempt_count = 1
             AND a.review_requested_at IS NULL
             AND a.last_outcome_code = 'reflection_quarantined:invalid_transition'`,
        ).get(OWNER_ID),
      ).toEqual({ count: 100 });
    } finally {
      db.close();
    }
  });

  it("isolates mixed transient, permanent, terminal, and cross-owner requests", async () => {
    const now = new Date("2026-08-10T14:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const permanent = seedReviewItem(db, "mixed-permanent");
    const transient = seedReviewItem(db, "mixed-transient");
    const terminal = seedReviewItem(db, "mixed-terminal");
    const other = seedReviewItem(db, "mixed-other", "other-owner");
    db.prepare(
      `UPDATE open_cognitive_items SET status = 'WITHDRAWN'
       WHERE id = ?`,
    ).run(terminal.id);
    try {
      expect(await processPendingOpenCognitiveReviewsAsync(
        db,
        OWNER_ID,
        async (_db, item) => item.id === transient.id
          ? null
          : {
              action: "resolve",
              reason: "reflection_fixture_invalid_mixed",
              evidenceRefs: [],
            },
      )).toEqual({ processed: 0, skipped: 2 });
      expect(getOpenCognitiveItem(db, OWNER_ID, permanent.entityUuid)?.attention).toMatchObject({
        reviewRequestedAt: null,
        reviewLastDisposition: "invalid_transition",
      });
      expect(getOpenCognitiveItem(db, OWNER_ID, transient.entityUuid)?.attention).toMatchObject({
        reviewRequestedAt: "2026-08-10T14:15:00.000Z",
        reviewLastDisposition: "adjudicator_unprocessable",
      });
      expect(getOpenCognitiveItem(db, OWNER_ID, terminal.entityUuid)).toMatchObject({
        status: "WITHDRAWN",
        attention: { reviewAttemptCount: 0 },
      });
      expect(getOpenCognitiveItem(db, "other-owner", other.entityUuid)?.attention).toMatchObject({
        reviewRequestedAt: now.toISOString(),
        reviewAttemptCount: 0,
      });
    } finally {
      vi.useRealTimers();
      db.close();
    }
  });

  it("claims a pending review through the real Reflection adjudicator and keeps it open", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const item = seedReviewItem(db, "real-adjudicator");
    const dispatch = stubReflectionDispatch('{"action":"KEEP"}');
    try {
      const result = await withOfflineAppGateDisabled(() =>
        processPendingOpenCognitiveReviewsAsync(db, OWNER_ID),
      );
      expect(result).toEqual({ processed: 1, skipped: 0 });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        modelId: "meta/muse-spark-1.3-contributor",
        fabricReasoning: { kind: "command_code_reasoning_effort", value: "high" },
      });
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)).toMatchObject({
        status: "OPEN",
        attention: {
          reviewRequestedAt: null,
          lastOutcomeCode: "reflection_keep_open",
        },
      });
    } finally {
      db.close();
    }
  });

  it("keeps a malformed Reflection adjudication from changing review state", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const item = seedReviewItem(db, "malformed-adjudicator");
    const before = getOpenCognitiveItem(db, OWNER_ID, item.entityUuid);
    stubReflectionDispatch("not json");
    try {
      const result = await withOfflineAppGateDisabled(() =>
        processPendingOpenCognitiveReviewsAsync(db, OWNER_ID),
      );
      expect(result).toEqual({ processed: 0, skipped: 1 });
      const after = getOpenCognitiveItem(db, OWNER_ID, item.entityUuid);
      expect(after?.status).toBe("OPEN");
      expect(after?.attention).toMatchObject({
        reviewLastDisposition: "adjudicator_unprocessable",
      });
      expect(after?.semanticSummary).toBe(before?.semanticSummary);
    } finally {
      db.close();
    }
  });

  it("bounds a failed Reflection adjudication without closing the item", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const item = seedReviewItem(db, "failed-adjudicator");
    env.commandCodeApiKey = "test-command-code-key";
    vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
      provider: "command_code",
      dispatch: vi.fn(async () => {
        throw new Error("reflection_provider_rejected");
      }),
    } as never);
    try {
      const result = await withOfflineAppGateDisabled(() =>
        processPendingOpenCognitiveReviewsAsync(db, OWNER_ID),
      );
      expect(result).toEqual({ processed: 0, skipped: 1 });
      expect(getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)).toMatchObject({
        status: "OPEN",
        attention: { reviewLastDisposition: "adjudicator_failure" },
      });
    } finally {
      db.close();
    }
  });
});
