import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { beginAuthorityTransition, stabilizeAuthorityBarrier } from "../authority/barrier.js";
import { recordDerivedInvalidationInTransaction, readDerivedInvalidation } from "../authority/journal.js";
import { retractMemoryAssertion, upsertMemoryAssertion } from "../memory/assertions.js";
import { openTestSidecar } from "../test-support.js";
import { searchMemoryFts } from "./fts.js";
import { DerivedStore } from "./derived-store.js";
import { reconcileDerivedInvalidationJournal } from "./derived-retraction.js";

describe("derived invalidation journal reconciliation", () => {
  it("never returns a physically stale row while an invalidation is pending", () => {
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const sidecar = openTestSidecar();
    const derived = new DerivedStore(":memory:");
    try {
      upsertMemoryAssertion(sidecar, {
        assertionKey: "memory:retract:1",
        statement: "Sensitive Ashley retraction target",
        memoryKind: "owner_world_claim",
        dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      upsertMemoryAssertion(sidecar, {
        assertionKey: "memory:keep:1",
        statement: "Unrelated retained Ashley fact",
        memoryKind: "owner_world_claim",
        dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      expect(derived.reconcile(sidecar, { authorityDb: nuclear })).toBe(true);
      expect(searchMemoryFts(derived, sidecar, '"retraction"', { authorityDb: nuclear }).rows).toHaveLength(1);

      expect(retractMemoryAssertion(sidecar, "memory:retract:1")).toBe(true);
      const transition = beginAuthorityTransition(nuclear, "derived-retraction", 20);
      nuclear.exec("BEGIN IMMEDIATE");
      try {
        recordDerivedInvalidationInTransaction({
          db: nuclear,
          changeId: "derived-retraction-1",
          ownerId: "doc",
          conversationId: null,
          sourceRefs: ["memory:retract:1"],
          invalidationKind: "redaction",
          canonicalOwner: "nuclear",
          targetGeneration: 2,
          nowMs: 21,
        });
        nuclear.exec("COMMIT");
      } catch (error) {
        try { nuclear.exec("ROLLBACK"); } catch { /* preserve original */ }
        throw error;
      }
      stabilizeAuthorityBarrier(nuclear, { nuclear: 1, continuity: 0, cognitive_sidecar: 0 }, 22, transition.transitionId);

      const blocked = searchMemoryFts(derived, sidecar, '"retraction"', { authorityDb: nuclear });
      expect(blocked).toEqual({ state: "unavailable", rows: [] });
      expect(readDerivedInvalidation(nuclear, "derived-retraction-1")).toMatchObject({ state: "pending" });

      const reconciled = reconcileDerivedInvalidationJournal(nuclear, sidecar, derived, {
        workerId: "test-derived-reconciler",
        nowMs: 23,
      });
      expect(reconciled).toMatchObject({ processed: 1, applied: 1, failed: 0, quarantined: 0 });
      expect(readDerivedInvalidation(nuclear, "derived-retraction-1")).toMatchObject({ state: "applied" });
      expect(searchMemoryFts(derived, sidecar, '"retraction"', { authorityDb: nuclear })).toEqual({ state: "ready", rows: [] });
      expect(searchMemoryFts(derived, sidecar, '"retained"', { authorityDb: nuclear }).rows).toHaveLength(1);
      expect(derived.getIndexState()).toMatchObject({ status: "valid", scopeState: "current", barrierRevision: 1 });
    } finally {
      derived.close();
      sidecar.close();
      nuclear.close();
    }
  });
});
