import { describe, expect, it } from "vitest";
import { appendInboxEvent, getCycle } from "./inbox.js";
import { captureOwnerDispatchCoverage, proveExactOwnerSupersession } from "./owner-coverage.js";
import { ownerCoverageHash } from "../owner-obligation.js";
import { admitWake } from "../wake/ledger.js";
import { openTestSidecar } from "../test-support.js";

function ownerEventFixture(options: { withSuccessor: boolean; partial: boolean }): {
  db: ReturnType<typeof openTestSidecar>;
  event: ReturnType<typeof appendInboxEvent>;
} {
  const db = openTestSidecar();
  const conversationId = "conversation:owner-supersession";
  const oldWake = admitWake(db, {
    occurrenceId: "occurrence:owner-supersession-old",
    triggerRef: "trigger:owner-supersession-old",
    sourceKind: "inbox",
    conversationId,
    cycleId: "cycle:owner-supersession-old",
    generation: 1,
    capturedAuthorityRevision: 1,
    nowMs: 1,
  });
  db.prepare("UPDATE cycle_records SET compose_log_ids_json = ? WHERE cycle_id = ?")
    .run(JSON.stringify(options.partial ? [] : ["evidence:old"]), "cycle:owner-supersession-old");
  const event = appendInboxEvent(db, {
    id: "event:owner-supersession-old",
    wakeId: oldWake.wake.wakeId,
    conversationId,
    kind: "owner_message",
    payload: { cycleId: "cycle:owner-supersession-old", evidenceRowId: "evidence:old" },
    createdAtMs: 2,
  });

  if (options.partial) {
    appendInboxEvent(db, {
      id: "event:owner-supersession-uncovered",
      wakeId: oldWake.wake.wakeId,
      conversationId,
      kind: "owner_message",
      payload: { cycleId: "cycle:owner-supersession-old", evidenceRowId: "evidence:uncovered" },
      createdAtMs: 3,
    });
  }

  if (options.withSuccessor) {
    const successorWake = admitWake(db, {
      occurrenceId: "occurrence:owner-supersession-new",
      triggerRef: "trigger:owner-supersession-new",
      sourceKind: "inbox",
      conversationId,
      cycleId: "cycle:owner-supersession-new",
      generation: 2,
      preemptedGeneration: 1,
      capturedAuthorityRevision: 1,
      nowMs: 4,
    });
    db.prepare("UPDATE cycle_records SET compose_log_ids_json = ? WHERE cycle_id = ?")
      .run(JSON.stringify(["evidence:old", "evidence:new"]), "cycle:owner-supersession-new");
    appendInboxEvent(db, {
      id: "event:owner-supersession-new",
      wakeId: successorWake.wake.wakeId,
      conversationId,
      kind: "owner_message",
      payload: { cycleId: "cycle:owner-supersession-new", evidenceRowId: "evidence:new" },
      createdAtMs: 5,
    });
  }

  return { db, event };
}

describe("Owner supersession proof", () => {
  it("proves superseded only for an exact attributable successor", () => {
    const fixture = ownerEventFixture({ withSuccessor: true, partial: false });
    try {
      const coverage = captureOwnerDispatchCoverage(fixture.db, fixture.event);
      const result = proveExactOwnerSupersession(fixture.db, fixture.event, coverage);
      expect(result).toEqual({
        kind: "superseded",
        successorIdentity: {
          wakeId: getCycle(fixture.db, "cycle:owner-supersession-new")?.wakeId,
          eventId: "event:owner-supersession-new",
        },
        coveredOwnerEventIds: ["event:owner-supersession-old"],
        uncoveredOwnerEventIds: [],
        coverageHash: ownerCoverageHash({
          primaryEventId: "event:owner-supersession-old",
          coveredOwnerEventIds: ["event:owner-supersession-old"],
          uncoveredOwnerEventIds: [],
        }),
      });
    } finally {
      fixture.db.close();
    }
  });

  it("does not call a stale generation superseded without a proven successor", () => {
    const fixture = ownerEventFixture({ withSuccessor: false, partial: false });
    try {
      const coverage = captureOwnerDispatchCoverage(fixture.db, fixture.event);
      expect(proveExactOwnerSupersession(fixture.db, fixture.event, coverage)).toBeNull();
    } finally {
      fixture.db.close();
    }
  });

  it("fails closed when an uncovered Owner remainder exists", () => {
    const fixture = ownerEventFixture({ withSuccessor: true, partial: true });
    try {
      const coverage = captureOwnerDispatchCoverage(fixture.db, fixture.event);
      expect(coverage.uncoveredOwnerEventIds).toEqual(["event:owner-supersession-uncovered"]);
      expect(proveExactOwnerSupersession(fixture.db, fixture.event, coverage)).toBeNull();
      expect(getCycle(fixture.db, "cycle:owner-supersession-new")?.preemptedGeneration).toBe(1);
    } finally {
      fixture.db.close();
    }
  });
});
