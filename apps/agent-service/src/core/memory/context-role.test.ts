import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertAssertion } from "./assertions.js";
import {
  annotationForFact,
  annotationForFactUnderAssertions,
  annotationForMessage,
  annotationForMessageUnderAssertions,
} from "./context-role.js";
import { upsertFact } from "./facts.js";
import { insertMessage, resolveActiveThread } from "./threads.js";
import { cutoverMemoryAssertions } from "./cutover.js";

const OWNER_ID = "doc";
const AUTHORITY_FROM = "2026-01-01T00:00:00.000Z";

function factWithAssertion(db: DatabaseSync): { factId: number; assertionId: number } {
  const factId = upsertFact(db, {
    ownerId: OWNER_ID,
    category: "preference",
    key: "context-role",
    value: "owner value",
    origin: "explicit_user",
  });
  const row = db.prepare(
    "SELECT id FROM memory_assertions WHERE legacy_fact_id = ?",
  ).get(factId) as { id?: number } | undefined;
  if (row?.id == null) throw new Error("context_role_assertion_missing");
  db.prepare(
    `UPDATE memory_assertions
     SET recorded_at = ?, authority_from = ?, authority_basis = 'adjudicated'
     WHERE id = ?`,
  ).run(AUTHORITY_FROM, AUTHORITY_FROM, row.id);
  return { factId, assertionId: Number(row.id) };
}

describe("C1 context-role authority boundary", () => {
  it("keeps live annotations absent under mem_facts while raw annotations work", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const fact = factWithAssertion(db);
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const messageId = insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "context role message",
        channel: "discord",
      });
      insertAssertion(db, {
        ownerId: OWNER_ID,
        kind: "owner_interpretation",
        subjectFacet: "owner_model",
        lineageKind: "owner_designated",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I2",
        claimText: "message claim",
        sourceKind: "context-role-test",
        sourceMessageId: messageId,
        recordedAt: AUTHORITY_FROM,
        authorityFrom: AUTHORITY_FROM,
        authorityBasis: "adjudicated",
        worldIntervalBasis: "adjudicated",
      });
      expect(annotationForFact(db, OWNER_ID, fact.factId)).toBeNull();
      expect(annotationForMessage(db, OWNER_ID, messageId)).toBeNull();
      expect(annotationForFactUnderAssertions(db, OWNER_ID, fact.factId)).toMatchObject({
        memory_context_role: "current_source_evidence",
        memory_assertion_ids: [fact.assertionId],
      });
      expect(annotationForMessageUnderAssertions(db, OWNER_ID, messageId)).toMatchObject({
        memory_context_role: "current_source_evidence",
        memory_assertion_ids: expect.any(Array),
      });
    } finally {
      db.close();
    }
  });

  it("keeps live annotations semantically equivalent after assertions cutover", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const fact = factWithAssertion(db);
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const messageId = insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "context role message",
        channel: "discord",
      });
      const assertionId = insertAssertion(db, {
        ownerId: OWNER_ID,
        kind: "owner_interpretation",
        subjectFacet: "owner_model",
        lineageKind: "owner_designated",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I2",
        claimText: "message claim",
        sourceKind: "context-role-test",
        sourceMessageId: messageId,
        recordedAt: AUTHORITY_FROM,
        authorityFrom: AUTHORITY_FROM,
        authorityBasis: "adjudicated",
        worldIntervalBasis: "adjudicated",
      });
      cutoverMemoryAssertions(db);
      expect(annotationForFact(db, OWNER_ID, fact.factId)).toEqual(
        annotationForFactUnderAssertions(db, OWNER_ID, fact.factId),
      );
      expect(annotationForMessage(db, OWNER_ID, messageId)).toEqual(
        annotationForMessageUnderAssertions(db, OWNER_ID, messageId),
      );
      expect(annotationForMessage(db, OWNER_ID, messageId)?.memory_assertion_ids).toContain(assertionId);
    } finally {
      db.close();
    }
  });
});
