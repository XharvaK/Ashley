import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { upsertFact } from "./facts.js";
import { insertMessage, resolveActiveThread } from "./threads.js";
import { writeFromUserTurn } from "../writers.js";

const OWNER_ID = "doc";

function sourceMessage(db: DatabaseSync, text: string): number {
  const threadId = resolveActiveThread(db, OWNER_ID, "discord");
  return insertMessage(db, {
    threadId,
    ownerId: OWNER_ID,
    role: "user",
    text,
    channel: "discord",
  });
}

describe("C1 assertion-first memory writers", () => {
  it("writes the assertion before projecting an explicit owner fact", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const sourceMessageId = sourceMessage(db, "I like coffee.");
      const factId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
        sourceMessageId,
        sourceQuote: "I like coffee.",
      });
      expect(factId).toBeGreaterThan(0);
      expect(db.prepare(
        `SELECT owner_id, kind, subject_facet, lineage_kind, derivation_kind,
                influence_class, category, key, value, source_message_id,
                source_quote, termination_reason
         FROM memory_assertions WHERE owner_id = ?`,
      ).all(OWNER_ID)).toEqual([{
        owner_id: OWNER_ID,
        kind: "keyed_fact",
        subject_facet: "owner_model",
        lineage_kind: "explicit_seed",
        derivation_kind: "observed",
        influence_class: "I2",
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        source_message_id: sourceMessageId,
        source_quote: "I like coffee.",
        termination_reason: null,
      }]);
    } finally {
      db.close();
    }
  });

  it("ends the prior assertion when an explicit owner value supersedes the key", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
      });
      const second = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "prefers tea",
        origin: "explicit_user",
      });
      const oldAssertion = db.prepare(
        "SELECT id, termination_reason, superseded_by_assertion_id FROM memory_assertions WHERE legacy_fact_id = ?",
      ).get(first) as { id: number; termination_reason: string | null; superseded_by_assertion_id: number | null };
      const newAssertion = db.prepare(
        "SELECT id, termination_reason FROM memory_assertions WHERE legacy_fact_id = ?",
      ).get(second) as { id: number; termination_reason: string | null };
      expect(oldAssertion.termination_reason).toBe("superseded");
      expect(oldAssertion.superseded_by_assertion_id).toBe(newAssertion.id);
      expect(newAssertion.termination_reason).toBeNull();
      expect(db.prepare(
        "SELECT value FROM mem_facts WHERE id = ? AND superseded_by IS NULL",
      ).get(second)).toEqual({ value: "prefers tea" });
    } finally {
      db.close();
    }
  });

  it("links a replacement derived assertion to the reused projection row", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const factId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "ongoing",
        key: "status",
        value: "old derived status",
        origin: "legacy",
      });
      const replacementFactId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "ongoing",
        key: "status",
        value: "new derived status",
        origin: "legacy",
      });
      const assertions = db.prepare(
        `SELECT id, value, termination_reason, legacy_fact_id
         FROM memory_assertions WHERE owner_id = ? ORDER BY id ASC`,
      ).all(OWNER_ID);
      expect(assertions).toHaveLength(2);
      expect(assertions[0]).toMatchObject({
        value: "old derived status",
        termination_reason: "superseded",
        legacy_fact_id: factId,
      });
      expect(assertions[1]).toMatchObject({
        value: "new derived status",
        termination_reason: null,
        legacy_fact_id: replacementFactId,
      });
      expect(replacementFactId).not.toBe(factId);
    } finally {
      db.close();
    }
  });

  it("keeps pin writes on the ordinary fact path while linking the source message", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const sourceMessageId = sourceMessage(db, "remember this: my notebook");
      const result = writeFromUserTurn(
        db,
        OWNER_ID,
        "remember this: my notebook",
        sourceMessageId,
      );
      expect(result.pinned).toBe(true);
      expect(db.prepare(
        `SELECT kind, source_message_id, category FROM memory_assertions
         WHERE owner_id = ?`,
      ).get(OWNER_ID)).toEqual({
        kind: "keyed_fact",
        source_message_id: sourceMessageId,
        category: "pinned",
      });
    } finally {
      db.close();
    }
  });

  it("rolls back an assertion when its compatibility projection fails", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      db.exec(`
        CREATE TRIGGER require_assertion_before_fact_insert
        BEFORE INSERT ON mem_facts
        WHEN NOT EXISTS (
          SELECT 1 FROM memory_assertions
          WHERE owner_id = NEW.owner_id
            AND category = NEW.category
            AND key = NEW.key
            AND value = NEW.value
            AND termination_reason IS NULL
        )
        BEGIN SELECT RAISE(ABORT, 'assertion_not_first'); END;
        CREATE TRIGGER fail_fact_insert AFTER INSERT ON mem_facts
        BEGIN SELECT RAISE(ABORT, 'fact_projection_failed'); END;
      `);
      expect(() => upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
      })).toThrow("fact_projection_failed");
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM memory_assertions WHERE owner_id = ?",
      ).get(OWNER_ID)).toEqual({ count: 0 });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM mem_facts WHERE owner_id = ?",
      ).get(OWNER_ID)).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});
