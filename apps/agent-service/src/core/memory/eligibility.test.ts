import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertMessage, resolveActiveThread } from "./threads.js";
import { insertAssertion } from "./assertions.js";
import {
  episodeInfluenceEligibleAt,
  episodeInfluenceEligibleUnderAssertionsAt,
  influenceEligibleAt,
  influenceEligibleUnderAssertionsAt,
  mindStateItemInfluenceEligibleAt,
  mindStateItemInfluenceEligibleUnderAssertionsAt,
  sourceCoveredByDenyBarrier,
  sourceCoveredByDenyBarrierUnderAssertions,
} from "./eligibility.js";

const OWNER_ID = "doc";
const AT = "2026-08-26T12:00:00.000Z";

function createAssertion(
  db: DatabaseSync,
  overrides: Partial<Parameters<typeof insertAssertion>[1]> = {},
): number {
  return insertAssertion(db, {
    ownerId: OWNER_ID,
    kind: "keyed_fact",
    subjectFacet: "owner_model",
    lineageKind: "owner_designated",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I2",
    category: "preference",
    key: `key-${Math.random()}`,
    value: "value",
    sourceKind: "test",
    recordedAt: "2026-01-01T00:00:00.000Z",
    validFrom: null,
    validTo: null,
    worldIntervalBasis: "legacy_unknown",
    authorityFrom: "2026-01-01T00:00:00.000Z",
    authorityTo: null,
    authorityBasis: "adjudicated",
    ...overrides,
  });
}

function addOpenBarrier(db: DatabaseSync, assertionId: number): void {
  const threadId = resolveActiveThread(db, OWNER_ID, "discord");
  const messageId = insertMessage(db, {
    threadId,
    ownerId: OWNER_ID,
    role: "user",
    text: "I corrected that.",
    channel: "discord",
  });
  const correctionId = Number(db.prepare(
    `INSERT INTO memory_corrections
       (entity_uuid, owner_id, source_message_id, correction_ordinal,
        admission_path, class, scope_text, proposal_json, lifecycle_status,
        stop_required, idempotency_key, capability_mode_at_write)
     VALUES (lower(hex(randomblob(16))), ?, 1 * ?, 1, 'typed_control',
             'INTERPRETATION_INVALIDATION', 'test', '{}', 'applying', 1,
             ?, 'apply')`,
  ).run(OWNER_ID, messageId, `${OWNER_ID}:${messageId}:1`).lastInsertRowid);
  const barrierId = Number(db.prepare(
    `INSERT INTO memory_deny_barriers
       (entity_uuid, owner_id, correction_id, status, committed_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, 'active', ?)` ,
  ).run(OWNER_ID, correctionId, AT).lastInsertRowid);
  db.prepare(
    `INSERT INTO memory_deny_barrier_members
       (barrier_id, assertion_id, held_from, held_to, hold_reason,
        authorized_by_correction_id, membership_seq)
     VALUES (?, ?, ?, NULL, 'owner_confirmed', ?, 1)`,
  ).run(barrierId, assertionId, AT, correctionId);
}

describe("C1 influence eligibility", () => {
  it("delegates raw assertions policy without reading the currentness marker", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const id = createAssertion(db);
      expect(influenceEligibleUnderAssertionsAt(db, id, AT)).toBe(true);
      expect(influenceEligibleAt(db, id, AT)).toBe(true);
      expect(sourceCoveredByDenyBarrierUnderAssertions(db, "fact", 1, AT)).toBe(false);
      expect(sourceCoveredByDenyBarrier(db, "fact", 1, AT)).toBe(false);
      expect(episodeInfluenceEligibleUnderAssertionsAt(db, OWNER_ID, 999, AT)).toBe(false);
      expect(episodeInfluenceEligibleAt(db, OWNER_ID, 999, AT)).toBe(true);
      expect(mindStateItemInfluenceEligibleUnderAssertionsAt(db, OWNER_ID, 999, AT)).toBe(false);
      expect(mindStateItemInfluenceEligibleAt(db, OWNER_ID, 999, AT)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("applies the orthogonal fail-closed formula", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const i0 = createAssertion(db, { influenceClass: "I0" });
      const unknownFacet = createAssertion(db, { subjectFacet: "unknown" });
      const future = createAssertion(db, { authorityFrom: "2026-09-01T00:00:00.000Z" });
      const missingAdjudicatedStart = createAssertion(db, { authorityFrom: null });
      const terminated = createAssertion(db, { terminationReason: "invalidated" });
      const barred = createAssertion(db);
      addOpenBarrier(db, barred);

      expect(influenceEligibleAt(db, i0, AT)).toBe(false);
      expect(influenceEligibleAt(db, unknownFacet, AT)).toBe(false);
      expect(influenceEligibleAt(db, future, AT)).toBe(false);
      expect(influenceEligibleAt(db, missingAdjudicatedStart, AT)).toBe(false);
      expect(influenceEligibleAt(db, terminated, AT)).toBe(false);
      expect(influenceEligibleAt(db, barred, AT)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("uses recorded_at only for legacy-current authority and keeps world time separate", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const legacyCurrent = createAssertion(db, {
        authorityFrom: null,
        authorityBasis: "legacy_current",
        recordedAt: "2026-01-01T00:00:00.000Z",
        validFrom: "2030-01-01T00:00:00.000Z",
        validTo: "2030-02-01T00:00:00.000Z",
      });
      expect(influenceEligibleAt(db, legacyCurrent, AT)).toBe(true);
      expect(influenceEligibleAt(db, legacyCurrent, "2025-12-31T23:59:59.000Z")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("does not treat temporal non-overlap as a live contradiction", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const left = createAssertion(db, { key: "temporal", value: "old" });
      const right = createAssertion(db, { key: "temporal", value: "new" });
      db.prepare(
        `INSERT INTO memory_contradictions
           (owner_id, left_assertion_id, right_assertion_id, kind, status, created_at)
         VALUES (?, ?, ?, 'temporal_nonoverlap', 'open', ?)`,
      ).run(OWNER_ID, left, right, AT);
      expect(influenceEligibleAt(db, left, AT)).toBe(true);
      expect(influenceEligibleAt(db, right, AT)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("fails closed when the barrier membership source cannot be read", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const id = createAssertion(db);
      db.exec("PRAGMA foreign_keys = OFF; DROP TABLE memory_deny_barrier_members; PRAGMA foreign_keys = ON");
      expect(influenceEligibleAt(db, id, AT)).toBe(false);
    } finally {
      db.close();
    }
  });
});
