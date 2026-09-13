import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertAssertion } from "./assertions.js";
import {
  admitOwnerCorrection,
} from "./corrections.js";
import {
  closeDenyBarrierMembers,
  commitDenyBarrier,
  listOpenDenyBarrierMembers,
} from "./barriers.js";
import { getMemoryContractState } from "./contract-state.js";
import { insertMessage, resolveActiveThread } from "./threads.js";

const OWNER_ID = "doc";
const FIRST = "2026-08-26T12:00:00.000Z";
const SECOND = "2026-08-26T13:00:00.000Z";

function makeAssertion(db: DatabaseSync): number {
  return insertAssertion(db, {
    ownerId: OWNER_ID,
    kind: "keyed_fact",
    subjectFacet: "owner_model",
    lineageKind: "owner_designated",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I2",
    category: "preference",
    key: "coffee",
    value: "likes coffee",
    sourceKind: "test",
    recordedAt: "2026-01-01T00:00:00.000Z",
    authorityFrom: "2026-01-01T00:00:00.000Z",
    authorityBasis: "adjudicated",
  });
}

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

describe("C1 deny barriers", () => {
  it("closes membership append-only and preserves the historical interval", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const assertionId = makeAssertion(db);
      const sourceId = sourceMessage(db, "Correct that coffee fact.");
      const admitted = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: sourceId,
        correctionOrdinal: 1,
        admissionPath: "typed_control",
        class: "INTERPRETATION_INVALIDATION",
        scopeText: "coffee",
        targets: [{
          assertionId,
          inclusionReason: "owner_confirmed",
          resolutionBasis: "owner_confirmed",
        }],
        capabilityMode: "apply",
        now: FIRST,
      });
      expect(admitted.barrier).not.toBeNull();
      expect(listOpenDenyBarrierMembers(db, assertionId, SECOND)).toHaveLength(1);

      const closeSourceId = sourceMessage(db, "Narrow the correction.");
      const closeCorrectionId = Number(db.prepare(
        `INSERT INTO memory_corrections
           (entity_uuid, owner_id, source_message_id, correction_ordinal,
            admission_path, class, scope_text, proposal_json, lifecycle_status,
            stop_required, idempotency_key, capability_mode_at_write)
         VALUES (lower(hex(randomblob(16))), ?, ?, 1, 'typed_control',
                 'SCOPE_REFINEMENT', 'coffee', '{}', 'admitted', 1, ?, 'apply')`,
      ).run(OWNER_ID, closeSourceId, `${OWNER_ID}:${closeSourceId}:1`).lastInsertRowid);
      closeDenyBarrierMembers(db, {
        barrierId: admitted.barrier!.id,
        assertionIds: [assertionId],
        closedByCorrectionId: closeCorrectionId,
        closedAt: SECOND,
      });

      expect(listOpenDenyBarrierMembers(db, assertionId, SECOND)).toHaveLength(0);
      expect(listOpenDenyBarrierMembers(db, assertionId, FIRST)).toHaveLength(1);
      expect(getMemoryContractState(db)?.correctionSeq).toBe(3);
      const history = db.prepare(
        `SELECT held_from, held_to, closed_by_correction_id
         FROM memory_deny_barrier_members WHERE barrier_id = ?`,
      ).all(admitted.barrier!.id);
      expect(history).toEqual([{
        held_from: FIRST,
        held_to: SECOND,
        closed_by_correction_id: closeCorrectionId,
      }]);
      expect(db.prepare(
        "SELECT status FROM memory_deny_barriers WHERE id = ?",
      ).get(admitted.barrier!.id)).toEqual({ status: "released" });
      expect(() => commitDenyBarrier(db, {
        ownerId: OWNER_ID,
        correctionId: admitted.correction.id,
        members: [{ assertionId, holdReason: "owner_confirmed" }],
        committedAt: SECOND,
      })).toThrow("memory_barrier_reopen_refused");
    } finally {
      db.close();
    }
  });
});
