import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { applyConcernDelta } from "../concerns/lineage.js";
import { captureThoughtSourcePackage } from "./input.js";
import { assertThoughtSourceCurrentness } from "./source-currentness.js";
import { parseThoughtSemanticOutput } from "./parse.js";
import { bindObservationIntent } from "./operation-binding.js";
import { concernInspectRefsFor } from "./concern-inspect.js";
import type { IdentitySlice } from "../types.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };

function seedConcern(
  db: DatabaseSync,
  input: { concernId: string; conversationId: string; statement: string; status?: string },
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
      status: (input.status ?? "dormant_but_revisitable") as "dormant_but_revisitable",
    },
  }, { cycleId: "cycle-seed", generation: 1 });
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

  it("rejects non-dormant pointer statuses from the inspect namespace", () => {
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
        ["concern-resolved", "resolved"],
        ["concern-quarantined", "quarantined"],
      ] as const) {
        seedConcern(db, { concernId: id, conversationId: "thread-inspect-status", statement: `${id} meaning.`, status });
      }
      const capture = captureFor(db, cycle);
      expect(Object.keys(capture.concernInspectDependencies)).toEqual([]);
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
      "concern-pointer-only": { snapshotHash: "snapshot-1", status: "dormant_but_revisitable" },
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
    });
  });
});
