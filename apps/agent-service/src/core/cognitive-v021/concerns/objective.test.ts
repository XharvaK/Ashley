import { describe, expect, it } from "vitest";
import type { ConcernRecord, MindOccupancy, SourceSupportRef } from "../types.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { makeSemanticSettlement, openTestSidecar, setTestSidecarVersion } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { applyConcernDelta, getConcern } from "./lineage.js";
import { parseThoughtSemanticOutput } from "../thought/parse.js";
import { buildOccupiedConcernProjection } from "../thought/occupied-concerns.js";

const dimensions: ConcernRecord["dimensions"] = {
  source: "owner_utterance",
  status: "asserted",
  time: "current",
  reliability: "owner_supplied",
};

function supportRef(db: ReturnType<typeof openTestSidecar>): SourceSupportRef {
  const text = "The Owner wants the release tracked.";
  const evidence = appendOwnerUtterance(db, {
    conversationId: "thread:objective",
    text,
    nowMs: 1,
  });
  return {
    kind: "conversation_text_span",
    evidenceRowId: evidence.rowId,
    start: 0,
    end: text.length,
    quote: text,
  };
}

function objective(supportRefs?: SourceSupportRef[]) {
  return {
    intendedOutcome: "Keep the release decision grounded in current evidence.",
    adoptionRevision: 1,
    delegationRef: "delegation:future",
    audience: { kind: "owner_private" } as const,
    target: { kind: "release", id: "release-1" },
    continuationConsiderations: "run candidate.develop then verify",
    stoppingConsiderations: "Stop when the evidence is sufficient or the objective is abandoned.",
    disposition: "waiting" as const,
    relatedRefs: ["trigger:1", "operation:1"],
    ...(supportRefs === undefined ? {} : { supportRefs }),
  };
}

function occupancy(status: MindOccupancy["status"] = "active"): MindOccupancy {
  return {
    conversationId: "thread:objective",
    concernId: "concern:objective",
    status,
    priority: 5,
    updatedCycle: "cycle:objective",
    updatedGeneration: 1,
  };
}

describe("concern objective facet", () => {
  it("persists typed support, projects the facet, and keeps its own disposition after resolve", () => {
    const db = openTestSidecar();
    try {
      const typedSupport = supportRef(db);
      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern:objective",
          conversationId: "thread:objective",
          statement: "Track the release decision.",
          sourceTurnIds: ["legacy-turn:release"],
          supportRefs: [typedSupport],
          dimensions,
          assertionKey: null,
          status: "active",
          objective: objective(),
        },
      }, { cycleId: "cycle:objective", generation: 1 });

      const stored = getConcern(db, "concern:objective");
      expect(stored).toMatchObject({
        sourceTurnIds: ["legacy-turn:release"],
        supportRefs: [typedSupport],
        objective: objective(),
      });

      const projected = buildOccupiedConcernProjection([occupancy()], [stored!]);
      expect(projected).toEqual([{
        concernId: "concern:objective",
        statement: "Track the release decision.",
        status: "active",
        priority: 5,
        dimensions: { status: "asserted", reliability: "owner_supplied" },
        objective: { ...objective(), supportRefs: [typedSupport] },
        provenance: "cognitive_sidecar.concerns",
      }]);

      applyConcernDelta(db, {
        op: "resolve",
        concernId: "concern:objective",
      }, { cycleId: "cycle:objective-resolved", generation: 2 });
      expect(getConcern(db, "concern:objective")).toMatchObject({
        status: "resolved",
        objective: { disposition: "waiting" },
      });
      expect(getConcern(db, "concern:objective")?.objective?.disposition).not.toBe("active");
    } finally {
      db.close();
    }
  });

  it("changes the concern snapshot hash when the objective or its typed support changes", () => {
    const db = openTestSidecar();
    try {
      const firstSupport = supportRef(db);
      const firstRecord = {
        concernId: "concern:hash",
        conversationId: "thread:objective",
        statement: "Hash this concern.",
        sourceTurnIds: [],
        supportRefs: [firstSupport],
        dimensions,
        assertionKey: null,
        status: "active" as const,
        objective: objective(),
      };
      applyConcernDelta(db, { op: "upsert", record: firstRecord }, { cycleId: "cycle:hash", generation: 1 });
      const persistedFirst = getConcern(db, "concern:hash")!;
      expect(persistedFirst.snapshotHash).toMatch(/^[0-9a-f]{64}$/);

      const changed = { ...firstRecord, objective: { ...firstRecord.objective, adoptionRevision: 2 } };
      applyConcernDelta(db, { op: "upsert", record: changed }, { cycleId: "cycle:hash-2", generation: 2 });
      const persistedChangedObjective = getConcern(db, "concern:hash")!;
      expect(persistedChangedObjective.snapshotHash).not.toBe(persistedFirst.snapshotHash);

      const changedSupport = supportRef(db);
      applyConcernDelta(db, {
        op: "upsert",
        record: { ...changed, supportRefs: [changedSupport] },
      }, { cycleId: "cycle:hash-3", generation: 3 });
      expect(getConcern(db, "concern:hash")?.snapshotHash).not.toBe(persistedChangedObjective.snapshotHash);
    } finally {
      db.close();
    }
  });

  it("rejects a structural workflow field but accepts workflow-like prose in considerations", () => {
    const db = openTestSidecar();
    try {
      expect(() => applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern:workflow",
          conversationId: "thread:objective",
          statement: "Reject executable workflow structure.",
          sourceTurnIds: [],
          dimensions,
          assertionKey: null,
          status: "active",
          objective: {
            intendedOutcome: "A bounded outcome.",
            workflow: { steps: ["candidate.develop", "verify"] },
          } as never,
        },
      }, { cycleId: "cycle:workflow", generation: 1 })).toThrow("concern_objective_workflow_forbidden");

      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern:prose",
          conversationId: "thread:objective",
          statement: "Text is not a workflow.",
          sourceTurnIds: [],
          dimensions,
          assertionKey: null,
          status: "active",
          objective: {
            intendedOutcome: "A bounded outcome.",
            continuationConsiderations: "run candidate.develop then verify",
          },
        },
      }, { cycleId: "cycle:prose", generation: 1 });
      expect(getConcern(db, "concern:prose")?.objective?.continuationConsiderations)
        .toBe("run candidate.develop then verify");
    } finally {
      db.close();
    }
  });

  it("does not invent an objective for a legacy quarantined concern", () => {
    const db = openTestSidecar();
    try {
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, support_refs_json,
            dimensions_json, assertion_key, cognitive_status, quarantine_kind, forgotten,
            snapshot_hash, updated_cycle, objective_json)
         VALUES (?, ?, ?, '[]', '[]', ?, NULL, NULL, ?, 0, ?, ?, NULL)`,
      ).run(
        "concern:legacy-quarantine",
        "thread:objective",
        "Legacy source is unavailable.",
        JSON.stringify(dimensions),
        "legacy_unavailable_source",
        "snapshot:legacy",
        "cycle:legacy",
      );

      expect(getConcern(db, "concern:legacy-quarantine")?.objective).toBeUndefined();
      expect(db.prepare("SELECT objective_json FROM concerns WHERE concern_id = ?")
        .get("concern:legacy-quarantine")).toEqual({ objective_json: null });
    } finally {
      db.close();
    }
  });

  it("migrates a V32 sidecar by adding a nullable objective column", () => {
    const db = openTestSidecar();
    try {
      setTestSidecarVersion(db, 32);
      expect((db.prepare("PRAGMA table_info(concerns)").all() as Array<{ name: string }>)
        .some((column) => column.name === "objective_json")).toBe(false);
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA table_info(concerns)").all() as Array<{ name: string }>)
        .some((column) => column.name === "objective_json")).toBe(true);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 33 });
    } finally {
      db.close();
    }
  });

  it("accepts the optional semantic objective facet and rejects structural workflow arrays", () => {
    const semantic = makeSemanticSettlement({
      concernDeltas: [{
        op: "upsert",
        record: {
          identity: { kind: "existing", ref: "concern:semantic" },
          statement: "Keep the concern grounded.",
          sourceTurnRefs: ["turn:semantic"],
          dimensions,
          status: "active",
          objective: {
            unresolvedQuestion: "Which evidence remains material?",
            adoptionRevision: 2,
            delegationRef: null,
            audience: { kind: "owner_private" },
            target: { concern: "concern:semantic" },
            disposition: "needs_review",
            relatedRefs: ["trigger:semantic"],
          },
        },
      }],
    });
    expect(parseThoughtSemanticOutput(
      semantic,
      new Set(["concern:semantic", "turn:semantic"]),
    )).toMatchObject({ ok: true });

    const malformed = makeSemanticSettlement({
      concernDeltas: [{
        op: "upsert",
        record: {
          identity: { kind: "existing", ref: "concern:semantic" },
          statement: "Reject executable structure.",
          sourceTurnRefs: [],
          dimensions,
          status: "active",
          objective: {
            intendedOutcome: "A bounded outcome.",
            operations: [{ name: "candidate.develop" }],
          },
        },
      }],
    });
    expect(parseThoughtSemanticOutput(malformed, new Set(["concern:semantic"]))).toMatchObject({ ok: false });
  });
});
