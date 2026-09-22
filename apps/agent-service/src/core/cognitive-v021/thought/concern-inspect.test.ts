import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { applyConcernDelta } from "../concerns/lineage.js";
import { captureThoughtSourcePackage } from "./input.js";
import { assertThoughtSourceCurrentness } from "./source-currentness.js";
import { parseThoughtSemanticOutput } from "./parse.js";
import { bindObservationIntent } from "./operation-binding.js";
import {
  CONCERN_DISCOVER_DEFAULT_LIMIT,
  CONCERN_DISCOVER_MAX_LIMIT,
  concernDiscoverCursorOf,
  concernDiscoverItemAuthorable,
  concernDiscoverLimitOf,
  concernInspectRefsFor,
  isConcernDiscoverRequest,
} from "./concern-inspect.js";
import type { CognitiveStatus, IdentitySlice, QuarantineKind } from "../types.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };

function seedConcern(
  db: DatabaseSync,
  input: { concernId: string; conversationId: string; statement: string; status?: CognitiveStatus | null },
): void {
  applyConcernDelta(db, {
    op: "upsert",
    record: {
      concernId: input.concernId,
      conversationId: input.conversationId,
      statement: input.statement,
      sourceTurnIds: ["turn-1"],
      dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
      assertionKey: null,
      status: input.status === undefined ? "dormant_but_revisitable" : input.status,
    },
  }, { cycleId: "cycle-seed", generation: 1 });
}

/** Quarantine is a Host/E fact: cognition can never author it. */
function quarantineConcern(db: DatabaseSync, concernId: string, kind: QuarantineKind): void {
  db.prepare("UPDATE concerns SET quarantine_kind = ? WHERE concern_id = ?").run(kind, concernId);
}

function captureFor(db: DatabaseSync, cycle: ReturnType<typeof admitTestCycle>) {
  return captureThoughtSourcePackage({
    sidecar: db,
    cycle,
    constitution,
    capabilityReality: {
      vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
      canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
      canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
      approvedProjectIds: [],
    },
  });
}

describe("concern.inspect dedicated capture and parse authority", () => {
  it("admits a pointer-only dormant concern to the inspect map without widening general dependencies", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-inspect-only", conversationId: "thread-inspect-only",
        triggerKind: "owner_message", triggerRef: "owner-inspect-only", occupantId: "doc", nowMs: 1,
      });
      seedConcern(db, { concernId: "concern-pointer-only", conversationId: "thread-inspect-only", statement: "Pointer-only dormant meaning." });
      const capture = captureFor(db, cycle);
      expect(capture.concernInspectDependencies["concern-pointer-only"]).toMatchObject({
        status: "dormant_but_revisitable",
      });
      expect(capture.sourceCurrentness.concernDependencies?.["concern-pointer-only"]).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("proves an unrelated pointer-only mutation does not newly stale an unrelated settlement", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-inspect-stable", conversationId: "thread-inspect-stable",
        triggerKind: "owner_message", triggerRef: "owner-inspect-stable", occupantId: "doc", nowMs: 1,
      });
      seedConcern(db, { concernId: "concern-pointer-stable", conversationId: "thread-inspect-stable", statement: "Stable pointer-only meaning." });
      const capture = captureFor(db, cycle);
      expect(() => assertThoughtSourceCurrentness(db, undefined, capture.sourceCurrentness)).not.toThrow();
      seedConcern(db, { concernId: "concern-pointer-stable", conversationId: "thread-inspect-stable", statement: "Changed pointer-only meaning." });
      expect(() => assertThoughtSourceCurrentness(db, undefined, capture.sourceCurrentness)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("admits exactly the bounded inspectable window and excludes grounded statuses", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-inspect-status", conversationId: "thread-inspect-status",
        triggerKind: "owner_message", triggerRef: "owner-inspect-status", occupantId: "doc", nowMs: 1,
      });
      for (const [id, status] of [
        ["concern-active", "active"],
        ["concern-investigating", "investigating"],
        ["concern-waiting", "waiting_for_evidence"],
      ] as const) {
        seedConcern(db, { concernId: id, conversationId: "thread-inspect-status", statement: `${id} meaning.`, status });
      }
      // Dormant, resolved, and unestablished concerns are deliberately
      // inspectable; quarantine adds a fourth inspectable reason.
      seedConcern(db, { concernId: "concern-resolved", conversationId: "thread-inspect-status", statement: "resolved meaning.", status: "resolved" });
      seedConcern(db, { concernId: "concern-unestablished", conversationId: "thread-inspect-status", statement: "unestablished meaning.", status: null });
      seedConcern(db, { concernId: "concern-quarantined", conversationId: "thread-inspect-status", statement: "quarantined meaning.", status: null });
      quarantineConcern(db, "concern-quarantined", "legacy_unavailable_source");
      const capture = captureFor(db, cycle);
      expect(Object.keys(capture.concernInspectDependencies).sort()).toEqual([
        "concern-quarantined",
        "concern-resolved",
        "concern-unestablished",
      ]);
      expect(capture.concernInspectDependencies["concern-quarantined"]).toMatchObject({
        status: null,
        quarantineKind: "legacy_unavailable_source",
      });
      expect(capture.concernInspectDependencies["concern-resolved"]).toMatchObject({
        status: "resolved",
        quarantineKind: null,
      });
    } finally {
      db.close();
    }
  });

  it("parses concern.inspect against the inspect allowlist while existingRefs stay ordinary", () => {
    const ordinary = new Set(["owner-1"]);
    const inspect = new Set(["concern-pointer-only"]);
    const ok = parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "concern.inspect",
      request: { concernRef: "concern-pointer-only" },
      purpose: "read the dormant meaning",
      evidenceNeed: "the canonical statement",
      existingRefs: ["owner-1"],
    }, ordinary, { concernInspectRefs: inspect });
    expect(ok).toMatchObject({ ok: true });
    expect(parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "concern.inspect",
      request: { concernRef: "concern-guessed" },
      purpose: "read the dormant meaning",
      evidenceNeed: "the canonical statement",
      existingRefs: ["owner-1"],
    }, ordinary, { concernInspectRefs: inspect })).toMatchObject({ ok: false, code: "reference_not_allowlisted", field: "request.concernRef" });
    expect(parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "concern.inspect",
      request: { concernRef: "concern-pointer-only", extra: true },
      purpose: "read the dormant meaning",
      evidenceNeed: "the canonical statement",
      existingRefs: ["owner-1"],
    }, ordinary, { concernInspectRefs: inspect })).toMatchObject({ ok: false, code: "wrong_type" });
  });

  it("keeps the inspect-only ref out of settlement authority", () => {
    const ordinary = new Set(["owner-1"]);
    const inspect = new Set(["concern-pointer-only"]);
    expect(parseThoughtSemanticOutput({
      kind: "settlement",
      speech: { mode: "none" },
      concernDeltas: [{
        op: "upsert",
        record: {
          identity: { kind: "existing", ref: "concern-pointer-only" },
          statement: "overwrite attempt",
          sourceTurnRefs: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          status: "active",
        },
      }],
    }, ordinary)).toMatchObject({ ok: false });
    expect(parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "project.inspect",
      request: { projectId: "project-ashley" },
      purpose: "unrelated read",
      evidenceNeed: "unrelated evidence",
      existingRefs: ["concern-pointer-only"],
    }, ordinary, { concernInspectRefs: inspect })).toMatchObject({ ok: false, code: "reference_not_allowlisted" });
  });

  it("binds an accepted inspect intent to its Host expectation end to end", () => {
    const ordinary = new Set(["owner-1"]);
    const authority = concernInspectRefsFor({
      "concern-pointer-only": { snapshotHash: "snapshot-1", status: "dormant_but_revisitable", quarantineKind: null },
    });
    const parsed = parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "concern.inspect",
      request: { concernRef: "concern-pointer-only" },
      purpose: "read the dormant meaning",
      evidenceNeed: "the canonical statement",
      existingRefs: ["owner-1"],
    }, ordinary, { concernInspectRefs: authority.refs });
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok || parsed.value.kind !== "observation_intent") throw new Error("fixture_parse_failed");
    const bound = bindObservationIntent({
      intent: parsed.value,
      cycleId: "cycle-1",
      generation: 1,
      parentDeadlineAtMs: 10_000,
      nowMs: 2_000,
      concernInspectExpectation: authority.expectations["concern-pointer-only"],
    });
    expect(bound.concernInspectionBinding).toEqual({
      concernId: "concern-pointer-only",
      expectedSnapshotHash: "snapshot-1",
      expectedStatus: "dormant_but_revisitable",
      expectedQuarantineKind: null,
    });
  });

  it("parses the discover union branch only when the Host authorized discover", () => {
    const ordinary = new Set(["owner-1"]);
    const inspect = new Set(["concern-pointer-only"]);
    const discoverIntent = {
      kind: "observation_intent",
      operationKind: "concern.inspect",
      request: { discover: {} },
      purpose: "list inspectable concerns",
      evidenceNeed: "the bounded id page",
      existingRefs: ["owner-1"],
    };
    expect(parseThoughtSemanticOutput(discoverIntent, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: true });
    expect(parseThoughtSemanticOutput(discoverIntent, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: false,
    })).toMatchObject({ ok: false, code: "reference_not_allowlisted", field: "request.discover" });
    expect(parseThoughtSemanticOutput(discoverIntent, ordinary, {
      concernInspectRefs: inspect,
    })).toMatchObject({ ok: false, code: "reference_not_allowlisted", field: "request.discover" });
    expect(parseThoughtSemanticOutput({
      ...discoverIntent,
      request: { discover: {}, concernRef: "concern-pointer-only" },
    }, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: false, code: "wrong_type", field: "request" });
    expect(parseThoughtSemanticOutput({
      ...discoverIntent,
      request: { discover: { cursor: "concern-pointer-only", limit: 4 }, extra: true },
    }, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: false, code: "wrong_type", field: "request" });
    expect(parseThoughtSemanticOutput({
      ...discoverIntent,
      request: { discover: { unexpected: 1 } },
    }, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: false, code: "wrong_type", field: "request.discover" });
    expect(parseThoughtSemanticOutput({
      ...discoverIntent,
      request: { discover: { cursor: "" } },
    }, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: false, code: "wrong_type", field: "request.discover.cursor" });
    expect(parseThoughtSemanticOutput({
      ...discoverIntent,
      request: { discover: { cursor: 7 } },
    }, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: false, code: "wrong_type", field: "request.discover.cursor" });
    expect(parseThoughtSemanticOutput({
      ...discoverIntent,
      request: { discover: { limit: 0 } },
    }, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: false, code: "wrong_type", field: "request.discover.limit" });
    expect(parseThoughtSemanticOutput({
      ...discoverIntent,
      request: { discover: { limit: 1.5 } },
    }, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: false, code: "wrong_type", field: "request.discover.limit" });
    expect(parseThoughtSemanticOutput({
      ...discoverIntent,
      request: { discover: { cursor: "concern-pointer-only", limit: 4 } },
    }, ordinary, {
      concernInspectRefs: inspect,
      concernDiscoverAllowed: true,
    })).toMatchObject({ ok: true });
  });

  it("classifies discover requests, bounds limit/cursor, and filters authorable items", () => {
    expect(isConcernDiscoverRequest({ discover: {} })).toBe(true);
    expect(isConcernDiscoverRequest({ discover: {}, concernRef: "c" })).toBe(false);
    expect(isConcernDiscoverRequest({ concernRef: "c" })).toBe(false);
    expect(isConcernDiscoverRequest(null)).toBe(false);
    expect(concernDiscoverLimitOf({ discover: {} })).toBe(CONCERN_DISCOVER_DEFAULT_LIMIT);
    expect(concernDiscoverLimitOf({ discover: { limit: 1000 } })).toBe(CONCERN_DISCOVER_MAX_LIMIT);
    expect(concernDiscoverLimitOf({ discover: { limit: 8 } })).toBe(8);
    expect(concernDiscoverLimitOf({ discover: { limit: -1 } })).toBe(CONCERN_DISCOVER_DEFAULT_LIMIT);
    expect(concernDiscoverCursorOf({ discover: {} })).toBeNull();
    expect(concernDiscoverCursorOf({ discover: { cursor: "concern-2" } })).toBe("concern-2");
    expect(concernDiscoverCursorOf({ discover: { cursor: "" } })).toBeNull();
    expect(concernDiscoverItemAuthorable({ cognitiveStatus: null, quarantineKind: null })).toBe(true);
    expect(concernDiscoverItemAuthorable({ cognitiveStatus: "resolved", quarantineKind: null })).toBe(true);
    expect(concernDiscoverItemAuthorable({ cognitiveStatus: null, quarantineKind: "legacy_unavailable_source" })).toBe(true);
    expect(concernDiscoverItemAuthorable({ cognitiveStatus: "dormant_but_revisitable", quarantineKind: null })).toBe(false);
    expect(concernDiscoverItemAuthorable({ cognitiveStatus: "active", quarantineKind: null })).toBe(false);
  });
});
