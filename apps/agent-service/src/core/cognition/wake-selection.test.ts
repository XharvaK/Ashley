import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import {
  materializeOpenCognitiveItem,
  countOpenCognitiveItemReviewDue,
  OPEN_COGNITIVE_REVIEW_DUE_COUNT_SQL,
  type OpenCognitiveItemRecord,
} from "./open-items.js";
import {
  explainOpenCognitiveReviewDueQuery,
  explainOpenCognitiveWakeQuery,
  selectOpenCognitiveItemsForWake,
} from "./wake-selection.js";

const OWNER_ID = "doc";
const NOW = new Date("2026-08-10T00:00:00.000Z");

function activateReading(db: DatabaseSync): void {
  const now = NOW.toISOString();
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

function seedItem(db: DatabaseSync, index: number): OpenCognitiveItemRecord {
  const revision = new Date(NOW.getTime() + index).toISOString();
  const entityUuid = `wake-question-${index}`;
  db.prepare(
    `INSERT INTO questions
       (owner_id, subject, text, status, priority, created_at, updated_at,
        entity_uuid, data_classification)
     VALUES (?, 'about_self', ?, 'open', 0.8, ?, ?, ?, 'never_public')`,
  ).run(
    OWNER_ID,
    `Wake question ${index}`,
    revision,
    revision,
    entityUuid,
  );
  const source = db
    .prepare("SELECT id FROM questions WHERE entity_uuid = ?")
    .get(entityUuid) as { id: number };
  return materializeOpenCognitiveItem(db, {
    ownerId: OWNER_ID,
    kind: "question",
    semanticSummary: `Wake candidate ${index}`,
    source: {
      type: "question",
      id: String(source.id),
      entityUuid,
    },
    origin: "manual",
    provenance: "live",
    sourceCapability: "reading",
    contractId: currentContractId(),
    buildIdentity: currentBuildIdentity(),
    modelEpoch: 0,
    dataClassification: "never_public",
  }).item;
}

function forgetSources(db: DatabaseSync, items: OpenCognitiveItemRecord[]): void {
  const update = db.prepare(
    "UPDATE questions SET status = 'forgotten' WHERE entity_uuid = ?",
  );
  for (const item of items) update.run(item.sourceEntityUuid);
}

function instrumentAttentionVisits(db: DatabaseSync): () => number {
  let visits = 0;
  db.function("record_wake_attention_visit", (value) => {
    visits += 1;
    return value;
  });
  db.exec(`
    CREATE TEMP VIEW open_cognitive_item_attention AS
    SELECT item_id, delay_class,
           record_wake_attention_visit(defer_until) AS defer_until,
           last_considered_at, consideration_count, last_outcome_code,
           review_requested_at, updated_at, review_attempt_count,
           review_last_disposition
    FROM main.open_cognitive_item_attention;
  `);
  return () => visits;
}

function seedCrossOwnerReviewFixture(db: DatabaseSync, size: number): void {
  const insertItem = db.prepare(
    `INSERT INTO open_cognitive_items
       (owner_id, entity_uuid, kind, status, semantic_summary,
        source_type, source_id, source_entity_uuid, semantic_key_hash,
        source_capability, contract_id, provenance, source_revision, origin,
        build_identity, model_epoch, data_classification, status_reason,
        created_at, updated_at)
     VALUES (?, ?, 'question', 'OPEN', ?, 'question', ?, ?, ?,
             'reading', ?, 'shadow', '', 'manual', ?, 0, 'never_public',
             'created', ?, ?)`,
  );
  const insertAttention = db.prepare(
    `INSERT INTO open_cognitive_item_attention
       (item_id, delay_class, defer_until, last_considered_at,
        consideration_count, last_outcome_code, review_requested_at,
        updated_at)
     VALUES (?, 'none', NULL, NULL, 0, NULL, ?, ?)`,
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const owner of [OWNER_ID, "other-owner"]) {
      for (let index = 0; index < size; index += 1) {
        const key = `${owner}:${index}`;
        const hash = Buffer.from(key).toString("hex").padEnd(64, "0").slice(0, 64);
        const result = insertItem.run(
          owner,
          `review-item:${key}`,
          `Review item ${key}`,
          String(index + 1),
          `review-source:${key}`,
          hash,
          currentContractId(),
          currentBuildIdentity(),
          NOW.toISOString(),
          NOW.toISOString(),
        );
        insertAttention.run(
          Number(result.lastInsertRowid),
          owner === "other-owner" ? NOW.toISOString() : null,
          NOW.toISOString(),
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function instrumentReviewDueCount(db: DatabaseSync, ownerId: string): number {
  let visits = 0;
  db.function("record_review_due_visit", (itemId) => {
    visits += 1;
    return itemId;
  });
  const instrumented = OPEN_COGNITIVE_REVIEW_DUE_COUNT_SQL.replace(
    "/* REVIEW_VISIT */",
    "record_review_due_visit(a.item_id) IS NOT NULL AND",
  );
  db.prepare(instrumented).get(ownerId, NOW.toISOString());
  return visits;
}

describe("bounded OCI wake selection", () => {
  it("overfetches blocked rows so a valid ninth row is selected", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const items = Array.from({ length: 9 }, (_, index) => seedItem(db, index));
    forgetSources(db, items.slice(0, 8));

    const result = selectOpenCognitiveItemsForWake(db, OWNER_ID, NOW);

    expect(result.items).toEqual([
      expect.objectContaining({ entityUuid: items[8]!.entityUuid }),
    ]);
    expect(result.scanned).toBe(9);
    expect(result.scanned).toBeLessThanOrEqual(128);
    db.close();
  });

  it("bounds each wake to four pages while reaching a valid item after 100 blocked rows", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const items = Array.from({ length: 101 }, (_, index) => seedItem(db, index));
    forgetSources(db, items.slice(0, 100));

    const result = selectOpenCognitiveItemsForWake(db, OWNER_ID, NOW);

    expect(result.items.map((item) => item.entityUuid)).toEqual([
      items[100]!.entityUuid,
    ]);
    expect(result.scanned).toBe(101);
    expect(result.scanned).toBeLessThanOrEqual(128);
    db.close();
  });

  it("advances a durable cursor so eligible rows beyond the first page are not starved", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const items = Array.from({ length: 150 }, (_, index) => seedItem(db, index));
    forgetSources(db, items.filter((_, index) => index !== 9 && index !== 140));

    const first = selectOpenCognitiveItemsForWake(db, OWNER_ID, NOW);
    const second = selectOpenCognitiveItemsForWake(db, OWNER_ID, NOW);

    expect(first.items.map((item) => item.entityUuid)).toEqual([
      items[9]!.entityUuid,
    ]);
    expect(second.items.map((item) => item.entityUuid)).toEqual([
      items[140]!.entityUuid,
    ]);
    expect(first.nextAfterId).toBeGreaterThan(0);
    expect(second.scanned).toBeLessThanOrEqual(128);
    db.close();
  });

  it("wraps at the end and scans only the bounded page budget", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    const items = Array.from({ length: 200 }, (_, index) => seedItem(db, index));
    forgetSources(db, items.slice(1));
    db.prepare(
      `INSERT INTO open_cognitive_item_wake_cursor
         (owner_id, after_item_id, updated_at)
       VALUES (?, 999999, ?)
       ON CONFLICT(owner_id) DO UPDATE SET after_item_id = excluded.after_item_id,
                                          updated_at = excluded.updated_at`,
    ).run(OWNER_ID, NOW.toISOString());

    const result = selectOpenCognitiveItemsForWake(db, OWNER_ID, NOW);

    expect(result.wrapped).toBe(true);
    expect(result.items.map((item) => item.entityUuid)).toEqual([
      items[0]!.entityUuid,
    ]);
    expect(result.scanned).toBeLessThanOrEqual(128);
    db.close();
  });

  it("uses the owner/status/id wake index without a whole-population sort", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    activateReading(db);
    Array.from({ length: 1000 }, (_, index) => seedItem(db, index));

    const wakePlan = explainOpenCognitiveWakeQuery(
      db,
      OWNER_ID,
      0,
      NOW.toISOString(),
      32,
    );
    expect(wakePlan.some((row) => row.detail.includes("idx_open_cognitive_items_owner_status_id"))).toBe(true);
    expect(wakePlan.some((row) => row.detail.includes("TEMP B-TREE"))).toBe(false);

    db.prepare(
      "UPDATE open_cognitive_item_attention SET review_requested_at = ?",
    ).run(NOW.toISOString());
    const reviewPlan = explainOpenCognitiveReviewDueQuery(db, OWNER_ID, 9);
    expect(reviewPlan.some((row) => row.detail.includes("idx_open_cognitive_items_owner_status_id"))).toBe(true);
    expect(reviewPlan.some((row) => row.detail.includes("TEMP B-TREE"))).toBe(false);
    expect(countOpenCognitiveItemReviewDue(db, OWNER_ID)).toBe(9);
    db.close();
  }, 60_000);

  it("keeps bounded no-material, blocked, and deferred wakes independent of inventory size", () => {
    for (const size of [10, 100, 1000]) {
      const db = openNuclearDb(new DatabaseSync(":memory:"));
      activateReading(db);
      const items = Array.from({ length: size }, (_, index) => seedItem(db, index));
      const plan = explainOpenCognitiveWakeQuery(
        db,
        OWNER_ID,
        0,
        NOW.toISOString(),
        32,
      );
      expect(plan.some((row) => row.detail.includes("idx_open_cognitive_items_owner_status_id"))).toBe(true);
      expect(plan.some((row) => row.detail.includes("TEMP B-TREE"))).toBe(false);

      forgetSources(db, items);
      const blocked = selectOpenCognitiveItemsForWake(db, OWNER_ID, NOW);
      expect(blocked.items).toHaveLength(0);
      expect(blocked.scanned).toBeLessThanOrEqual(128);

      db.prepare(
        `UPDATE open_cognitive_item_attention
         SET defer_until = ?`,
      ).run(new Date(NOW.getTime() + 86_400_000).toISOString());
      const deferred = selectOpenCognitiveItemsForWake(db, OWNER_ID, NOW);
      expect(deferred.items).toHaveLength(0);
      expect(deferred.scanned).toBeLessThanOrEqual(128);
      db.close();
    }
  }, 60_000);

  it.each([10, 100, 1000])(
    "bounds one raw page to 32 actual SQLite attention visits with %i deferred rows",
    (size) => {
      const db = openNuclearDb(new DatabaseSync(":memory:"));
      activateReading(db);
      Array.from({ length: size }, (_, index) => seedItem(db, index));
      db.prepare(
        `UPDATE open_cognitive_item_attention SET defer_until = ?`,
      ).run(new Date(NOW.getTime() + 86_400_000).toISOString());
      const visits = instrumentAttentionVisits(db);

      const result = selectOpenCognitiveItemsForWake(db, OWNER_ID, NOW, {
        maxPages: 1,
      });

      expect(result.items).toHaveLength(0);
      expect(result.scanned).toBeLessThanOrEqual(32);
      expect(visits()).toBe(Math.min(size, 32));
      db.close();
    },
  );

  it.each([10, 100, 1000])(
    "bounds owner review work with a %i-row cross-owner due flood",
    (size) => {
      const db = openNuclearDb(new DatabaseSync(":memory:"));
      seedCrossOwnerReviewFixture(db, size);

      expect(countOpenCognitiveItemReviewDue(db, OWNER_ID)).toBe(0);
      expect(instrumentReviewDueCount(db, OWNER_ID)).toBe(Math.min(size, 32));
      db.close();
    },
  );

  it("bounds no, few, many, invalid, and terminal-mixed owner review work", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    seedCrossOwnerReviewFixture(db, 1000);
    const setFirst = db.prepare(
      `UPDATE open_cognitive_item_attention
       SET review_requested_at = ?
       WHERE item_id IN (
         SELECT id FROM open_cognitive_items
         WHERE owner_id = ? ORDER BY id ASC LIMIT ?
       )`,
    );

    expect(countOpenCognitiveItemReviewDue(db, OWNER_ID, NOW)).toBe(0);
    expect(instrumentReviewDueCount(db, OWNER_ID)).toBe(32);

    setFirst.run(NOW.toISOString(), OWNER_ID, 3);
    expect(countOpenCognitiveItemReviewDue(db, OWNER_ID, NOW)).toBe(3);
    expect(instrumentReviewDueCount(db, OWNER_ID)).toBe(32);

    db.prepare(
      `UPDATE open_cognitive_item_attention SET review_requested_at = ?
       WHERE item_id IN (
         SELECT id FROM open_cognitive_items WHERE owner_id = ?
       )`,
    ).run(NOW.toISOString(), OWNER_ID);
    expect(countOpenCognitiveItemReviewDue(db, OWNER_ID, NOW)).toBe(9);
    expect(instrumentReviewDueCount(db, OWNER_ID)).toBe(9);

    db.prepare(
      `UPDATE open_cognitive_item_attention SET review_requested_at = NULL
       WHERE item_id IN (
         SELECT id FROM open_cognitive_items WHERE owner_id = ?
       )`,
    ).run(OWNER_ID);
    setFirst.run("not-a-date", OWNER_ID, 1);
    expect(countOpenCognitiveItemReviewDue(db, OWNER_ID, NOW)).toBe(1);
    expect(instrumentReviewDueCount(db, OWNER_ID)).toBe(32);

    db.prepare(
      `UPDATE open_cognitive_items SET status = 'WITHDRAWN'
       WHERE id IN (
         SELECT id FROM open_cognitive_items
         WHERE owner_id = ? ORDER BY id ASC LIMIT 16
       )`,
    ).run(OWNER_ID);
    db.prepare(
      `UPDATE open_cognitive_item_attention SET review_requested_at = ?
       WHERE item_id IN (
         SELECT id FROM open_cognitive_items WHERE owner_id = ?
       )`,
    ).run(NOW.toISOString(), OWNER_ID);
    expect(countOpenCognitiveItemReviewDue(db, OWNER_ID, NOW)).toBe(9);
    expect(instrumentReviewDueCount(db, OWNER_ID)).toBe(9);
    db.close();
  });
});
