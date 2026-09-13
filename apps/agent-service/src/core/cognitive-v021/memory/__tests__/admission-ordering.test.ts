import { describe, it, expect, vi } from "vitest";
import { admitTestCycle, openTestSidecar, makeThoughtDraft } from "../../test-support.js";
import { publishSemanticTransaction } from "../../settlement/publish.js";
import { openDerivedStore, registerDerivedStoreForSidecar } from "../../retrieval/derived-store.js";
import { searchMemoryFts } from "../../retrieval/fts.js";
import { upsertMemoryAssertion, retractMemoryAssertion, getMemoryAssertion } from "../assertions.js";
import { tickAdmission, admitOwnerSuppliedClaim } from "../admission.js";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import type { DurableNomination } from "../../types.js";

function makeNomination(overrides: Partial<DurableNomination> = {}): DurableNomination {
  return {
    nominationId: "nomination-1",
    cycleId: "cycle-1",
    generation: 1,
    assertionKey: "owner:subject",
    statement: "The owner prefers the first subject.",
    memoryKind: "owner_world_claim",
    dimensions: {
      source: "owner_utterance",
      status: "asserted",
      time: "current",
      reliability: "owner_supplied",
    },
    dataClassification: "never_public",
    supersedesAssertionKey: null,
    concernId: null,
    sourceRefs: [],
    ...overrides,
  };
}

function insertConsumedObservations(
  db: Parameters<typeof tickAdmission>[0],
  cycleId: string,
  generation: number,
  observationIds: readonly string[],
): void {
  for (const observationId of new Set(observationIds)) {
    db.prepare(
      `INSERT OR IGNORE INTO observations
         (observation_id, cycle_id, generation, derived, replay_safe, modality,
          payload_json, provenance, data_classification, secret_omitted, created_at_ms)
       VALUES (?, ?, ?, 0, 1, 'text', ?, 'test:memory-admission-ordering', 'ordinary', 0, 0)`,
    ).run(
      observationId,
      cycleId,
      generation,
      JSON.stringify({ fixture: "memory-admission-ordering" }),
    );
  }
}

function publishNoms(
  db: Parameters<typeof tickAdmission>[0],
  inputs: DurableNomination[],
  settlementId: string,
): void {
  const draft = makeThoughtDraft({
    cycleId: inputs[0].cycleId,
    generation: inputs[0].generation,
    operations: {
      ...makeThoughtDraft().operations,
      observationsConsumed: ["obs-default"],
    },
    speech: {
      mode: "none",
      mustSay: [],
      mustNot: [],
      surfaceDraft: null,
      acceptableRealizations: [],
      presentationDirectives: [],
    },
    durableNominations: inputs,
  });
  insertConsumedObservations(
    db,
    inputs[0].cycleId,
    inputs[0].generation,
    draft.operations.observationsConsumed,
  );
  publishSemanticTransaction(db, {
    ...draft,
    settlementId,
    speech: { ...draft.speech, finalLicensedText: null },
  }, {
    currentness: {
      requireObservationForLatest: false,
      binding: {
        barrierId: "global",
        barrierEpoch: 1,
        barrierRevision: 1,
        ownerVersions: { nuclear: 1, continuity: 1, cognitive_sidecar: 1 },
      },
      complete: true,
      observedObservationIds: ["obs-default"],
    },
  });
}

describe("Memory Transaction Ordering & Post-Commit Synchronization", () => {
  const dimensions = {
    source: "owner_utterance" as const,
    status: "asserted" as const,
    time: "current" as const,
    reliability: "owner_supplied" as const,
  };

  it("Test A: batch transaction executes in order: begin -> mutation -> mutation -> commit -> derived_sync", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    registerDerivedStoreForSidecar(sidecar, derived);

    const eventOrder: string[] = [];

    // Instrument sidecar exec to trace BEGIN, COMMIT, ROLLBACK
    const originalExec = sidecar.exec.bind(sidecar);
    sidecar.exec = (sql: string) => {
      if (sql.includes("BEGIN")) eventOrder.push("begin");
      if (sql.includes("COMMIT")) eventOrder.push("commit");
      if (sql.includes("ROLLBACK")) eventOrder.push("rollback");
      return originalExec(sql);
    };

    // Instrument syncAfterCommit
    const originalSync = derived.syncAfterCommit.bind(derived);
    derived.syncAfterCommit = (db, changes) => {
      eventOrder.push("derived_sync");
      return originalSync(db, changes);
    };

    const ev = appendOwnerUtterance(sidecar, {
      conversationId: "thread-1",
      text: "Batch owner evidence",
      discordMessageIds: ["m1"],
      nowMs: 1,
    });
    admitTestCycle(sidecar, {
      cycleId: "c1",
      conversationId: "thread-1",
      generation: 1,
      triggerKind: "owner_message",
      triggerRef: ev.rowId,
      occupantId: "doc",
      nowMs: 1,
    });

    const nom1 = makeNomination({
      nominationId: "nom-batch-1",
      cycleId: "c1",
      generation: 1,
      assertionKey: "batch:key:1",
      statement: "Batch assertion one",
      sourceRefs: [ev.rowId],
    });
    const nom2 = makeNomination({
      nominationId: "nom-batch-2",
      cycleId: "c1",
      generation: 1,
      assertionKey: "batch:key:2",
      statement: "Batch assertion two",
      sourceRefs: [ev.rowId],
    });

    publishNoms(sidecar, [nom1, nom2], "settle-1");

    // Initial derived reconcile
    derived.reconcile(sidecar);
    eventOrder.length = 0; // Clear setup events

    // Execute tickAdmission
    const res = tickAdmission(sidecar, { nominationIds: [nom1.nominationId, nom2.nominationId] });
    expect(res.admitted).toBe(2);

    expect(eventOrder).toEqual([
      "begin",
      "commit",
      "derived_sync",
    ]);

    derived.close();
    sidecar.close();
  });

  it("Test B: transaction rollback results in zero derived sync calls", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    registerDerivedStoreForSidecar(sidecar, derived);
    derived.reconcile(sidecar);

    let syncCalls = 0;
    const originalSync = derived.syncAfterCommit.bind(derived);
    derived.syncAfterCommit = (db, changes) => {
      syncCalls += 1;
      return originalSync(db, changes);
    };

    // Manually execute a failing transaction
    sidecar.exec("BEGIN IMMEDIATE");
    try {
      upsertMemoryAssertion(sidecar, {
        assertionKey: "rollback:key:1",
        statement: "Rollback statement",
        memoryKind: "owner_world_claim",
        dimensions,
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      // Simulate error before commit
      throw new Error("simulated_mutation_failure");
    } catch {
      sidecar.exec("ROLLBACK");
    }

    expect(syncCalls).toBe(0);

    // Derived store remains intact and does not contain rolled back row
    const search = searchMemoryFts(derived, sidecar, "Rollback statement");
    expect(search.rows.length).toBe(0);

    derived.close();
    sidecar.close();
  });

  it("Test C: real tickAdmission performs derived sync after COMMIT with all changed keys including supersessions", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    registerDerivedStoreForSidecar(sidecar, derived);

    // Seed an initial assertion that will be superseded
    upsertMemoryAssertion(sidecar, {
      assertionKey: "old:key:to_supersede",
      statement: "Old prior statement before supersession",
      memoryKind: "owner_world_claim",
      dimensions,
      dataClassification: "ordinary",
      lineageParentKey: null,
      admittedGeneration: 1,
      live: true,
    });
    derived.reconcile(sidecar);

    const evC = appendOwnerUtterance(sidecar, {
      conversationId: "thread-1",
      text: "New superseding replacement statement",
      discordMessageIds: ["m-c"],
      nowMs: 1,
    });
    admitTestCycle(sidecar, {
      cycleId: "c-tick",
      conversationId: "thread-1",
      generation: 1,
      triggerKind: "owner_message",
      triggerRef: evC.rowId,
      occupantId: "doc",
      nowMs: 1,
    });

    const nom = makeNomination({
      nominationId: "nom-tick-1",
      cycleId: "c-tick",
      generation: 1,
      assertionKey: "new:key:superseding",
      statement: "New superseding replacement statement",
      supersedesAssertionKey: "old:key:to_supersede",
      sourceRefs: [evC.rowId],
    });

    publishNoms(sidecar, [nom], "s-tick");

    const syncSpy = vi.spyOn(derived, "syncAfterCommit");

    const result = tickAdmission(sidecar, { nominationIds: [nom.nominationId] });
    expect(result.admitted).toBe(1);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    const syncArg = syncSpy.mock.calls[0][1];
    expect(syncArg.changedAssertionKeys).toContain("new:key:superseding");
    expect(syncArg.changedAssertionKeys).toContain("old:key:to_supersede");

    // Prove lexical search reflects both new assertion and superseded status
    const newSearch = searchMemoryFts(derived, sidecar, "New superseding");
    expect(newSearch.rows.length).toBe(1);
    expect(newSearch.rows[0].assertionKey).toBe("new:key:superseding");
    expect(newSearch.rows[0].sourceStore).toBe("live_memory");

    const oldSearch = searchMemoryFts(derived, sidecar, "prior");
    expect(oldSearch.rows.length).toBe(1);
    expect(oldSearch.rows[0].assertionKey).toBe("old:key:to_supersede");
    expect(oldSearch.rows[0].sourceStore).toBe("quarantined_memory"); // live = 0

    derived.close();
    sidecar.close();
  });

  it("Test D: real admitOwnerSuppliedClaim synchronizes after authoritative COMMIT", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    registerDerivedStoreForSidecar(sidecar, derived);
    derived.reconcile(sidecar);

    const evD = appendOwnerUtterance(sidecar, {
      conversationId: "thread-1",
      text: "Owner directly remembered topic",
      discordMessageIds: ["m-d"],
      nowMs: 1,
    });
    admitTestCycle(sidecar, {
      cycleId: "c-owner",
      conversationId: "thread-1",
      generation: 1,
      triggerKind: "owner_message",
      triggerRef: evD.rowId,
      occupantId: "doc",
      nowMs: 1,
    });

    const nom = makeNomination({
      nominationId: "nom-owner-1",
      cycleId: "c-owner",
      generation: 1,
      assertionKey: "owner:claim:direct",
      statement: "Owner directly remembered topic",
      supersedesAssertionKey: null,
      sourceRefs: [evD.rowId],
    });

    publishNoms(sidecar, [nom], "s-owner");

    const syncSpy = vi.spyOn(derived, "syncAfterCommit");

    const admitted = admitOwnerSuppliedClaim(sidecar, {
      settlementId: "s-owner",
      nominationId: nom.nominationId,
      evidence: evD,
    });
    expect(admitted?.result).toBe("admitted");
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy.mock.calls[0][1].changedAssertionKeys).toEqual(["owner:claim:direct"]);

    const search = searchMemoryFts(derived, sidecar, "directly remembered");
    expect(search.rows.length).toBe(1);
    expect(search.rows[0].assertionKey).toBe("owner:claim:direct");

    derived.close();
    sidecar.close();
  });

  it("Test E: real retractMemoryAssertion synchronizes after mutation", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    registerDerivedStoreForSidecar(sidecar, derived);

    upsertMemoryAssertion(sidecar, {
      assertionKey: "retract:target:1",
      statement: "Target statement to be retracted",
      memoryKind: "owner_world_claim",
      dimensions,
      dataClassification: "ordinary",
      lineageParentKey: null,
      admittedGeneration: 1,
      live: true,
    });
    derived.reconcile(sidecar);

    const syncSpy = vi.spyOn(derived, "syncAfterCommit");
    const changed = retractMemoryAssertion(sidecar, "retract:target:1");
    expect(changed).toBe(true);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy.mock.calls[0][1].changedAssertionKeys).toEqual(["retract:target:1"]);

    // Retracted statement statement is redacted and live=0
    const assertion = getMemoryAssertion(sidecar, "retract:target:1");
    expect(assertion?.live).toBe(false);

    derived.close();
    sidecar.close();
  });

  it("Test F: derived sync failure does not alter or rollback authoritative semantic commit", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    registerDerivedStoreForSidecar(sidecar, derived);
    derived.reconcile(sidecar);

    const evF = appendOwnerUtterance(sidecar, {
      conversationId: "thread-1",
      text: "Semantic state survives derived failure",
      discordMessageIds: ["m-f"],
      nowMs: 1,
    });
    admitTestCycle(sidecar, {
      cycleId: "c-fail",
      conversationId: "thread-1",
      generation: 1,
      triggerKind: "owner_message",
      triggerRef: evF.rowId,
      occupantId: "doc",
      nowMs: 1,
    });

    const nom = makeNomination({
      nominationId: "nom-fail-1",
      cycleId: "c-fail",
      generation: 1,
      assertionKey: "surviving:semantic:key",
      statement: "Semantic state survives derived failure",
      supersedesAssertionKey: null,
      sourceRefs: [evF.rowId],
    });

    publishNoms(sidecar, [nom], "s-fail");

    // Make derived sync throw an error
    vi.spyOn(derived, "syncAfterCommit").mockImplementation(() => {
      throw new Error("disk_io_failure_during_derived_sync");
    });

    // Authoritative tickAdmission must still succeed
    const res = tickAdmission(sidecar, { nominationIds: [nom.nominationId] });
    expect(res.admitted).toBe(1);

    // Semantic database contains the admitted assertion
    const assertion = getMemoryAssertion(sidecar, "surviving:semantic:key");
    expect(assertion).not.toBeNull();
    expect(assertion?.statement).toBe("Semantic state survives derived failure");
    expect(assertion?.live).toBe(true);

    // Derived store was marked invalid
    expect(derived.getIndexState()?.status).toBe("invalid");

    derived.close();
    sidecar.close();
  });
});
