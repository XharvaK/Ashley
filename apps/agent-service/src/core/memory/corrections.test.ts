import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertAssertion } from "./assertions.js";
import {
  admitOwnerCorrection,
  getCorrection,
  listCorrectionTargets,
} from "./corrections.js";
import { getMemoryContractState } from "./contract-state.js";
import { insertMessage, resolveActiveThread } from "./threads.js";

const OWNER_ID = "doc";
const NOW = "2026-08-26T12:00:00.000Z";

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

function assertion(db: DatabaseSync, key: string): number {
  return insertAssertion(db, {
    ownerId: OWNER_ID,
    kind: "keyed_fact",
    subjectFacet: "owner_model",
    lineageKind: "owner_designated",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I2",
    category: "preference",
    key,
    value: `value-${key}`,
    sourceKind: "test",
    recordedAt: "2026-01-01T00:00:00.000Z",
    authorityFrom: "2026-01-01T00:00:00.000Z",
    authorityBasis: "adjudicated",
  });
}

describe("C1 correction admission", () => {
  it("keeps separate ordinals and many targets for one owner message", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const coffee = assertion(db, "coffee");
      const tea = assertion(db, "tea");
      const messageId = sourceMessage(db, "I no longer like coffee, and I never liked tea.");

      const first = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: messageId,
        correctionOrdinal: 1,
        admissionPath: "conversational_deterministic",
        class: "TEMPORAL_SUPERSESSION",
        scopeText: "coffee",
        targets: [{
          assertionId: coffee,
          inclusionReason: "exact_key",
          resolutionBasis: "deterministic",
        }],
        capabilityMode: "apply",
        now: NOW,
      });
      const second = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: messageId,
        correctionOrdinal: 2,
        admissionPath: "conversational_deterministic",
        class: "INTERPRETATION_INVALIDATION",
        scopeText: "tea",
        targets: [{
          assertionId: tea,
          inclusionReason: "exact_key",
          resolutionBasis: "deterministic",
        }],
        capabilityMode: "apply",
        now: NOW,
      });

      expect(first.correction.id).not.toBe(second.correction.id);
      expect(first.correction.lifecycleStatus).toBe("applying");
      expect(second.correction.lifecycleStatus).toBe("applying");
      expect(listCorrectionTargets(db, first.correction.id)).toHaveLength(1);
      expect(listCorrectionTargets(db, second.correction.id)).toHaveLength(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM memory_corrections").get())
        .toEqual({ count: 2 });
      expect(getMemoryContractState(db)?.correctionSeq).toBe(4);
    } finally {
      db.close();
    }
  });

  it("is idempotent and attaches clarification without minting a duplicate", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const coffee = assertion(db, "coffee");
      const messageId = sourceMessage(db, "That coffee memory is wrong.");
      const input = {
        ownerId: OWNER_ID,
        sourceMessageId: messageId,
        correctionOrdinal: 1,
        admissionPath: "conversational_deterministic" as const,
        scopeText: "coffee",
        targets: [{
          assertionId: coffee,
          inclusionReason: "conservative_lexical" as const,
          resolutionBasis: "conservative_hold" as const,
        }],
        capabilityMode: "apply" as const,
        now: NOW,
      };
      const first = admitOwnerCorrection(db, input);
      expect(first.correction.class).toBe("unclassified");
      expect(first.correction.lifecycleStatus).toBe("clarification_required");
      expect(first.barrier).not.toBeNull();
      expect(first.receipt?.barrierCommitted).toBe(true);
      expect(getMemoryContractState(db)?.correctionSeq).toBe(2);

      const retry = admitOwnerCorrection(db, input);
      expect(retry.correction.id).toBe(first.correction.id);
      expect(getMemoryContractState(db)?.correctionSeq).toBe(2);
      expect(db.prepare("SELECT COUNT(*) AS count FROM memory_corrections").get())
        .toEqual({ count: 1 });

      const clarification = admitOwnerCorrection(db, {
        ...input,
        class: "PROVENANCE_CORRECTION",
        proposal: { clarification: "The stored quote was attributed to the wrong source." },
        targets: [{
          assertionId: coffee,
          inclusionReason: "owner_confirmed",
          resolutionBasis: "owner_confirmed",
        }],
      });
      expect(clarification.correction.id).toBe(first.correction.id);
      expect(clarification.correction.class).toBe("PROVENANCE_CORRECTION");
      expect(db.prepare("SELECT COUNT(*) AS count FROM memory_corrections").get())
        .toEqual({ count: 1 });
      expect(listCorrectionTargets(db, first.correction.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("records observe intents without claiming a stop or an applied effect", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const coffee = assertion(db, "coffee");
      const messageId = sourceMessage(db, "Maybe that coffee fact needs correction.");
      const result = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: messageId,
        correctionOrdinal: 1,
        admissionPath: "conversational_deterministic",
        scopeText: "coffee",
        targets: [{
          assertionId: coffee,
          inclusionReason: "conservative_lexical",
          resolutionBasis: "conservative_hold",
        }],
        capabilityMode: "observe",
        now: NOW,
      });

      expect(result.correction.lifecycleStatus).toBe("observe_recorded");
      expect(result.correction.stopRequired).toBe(true);
      expect(result.barrier).toBeNull();
      expect(result.receipt?.barrierCommitted).toBe(false);
      expect(result.receipt?.fanoutState).toBe("not_started");
      expect(db.prepare("SELECT COUNT(*) AS count FROM memory_deny_barriers").get())
        .toEqual({ count: 0 });
      expect(getCorrection(db, result.correction.id)?.lifecycleStatus)
        .toBe("observe_recorded");
    } finally {
      db.close();
    }
  });
});
