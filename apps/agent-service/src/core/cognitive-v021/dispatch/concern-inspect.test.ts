import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { applyConcernDelta, getConcern } from "../concerns/lineage.js";
import { inspectConcernCurrentness } from "../thought/source-currentness.js";
import { utf8JsonBytes } from "../thought/projection-allocator/composition-contract.js";
import { createV021LiveOperationExecutors } from "./live-operations.js";
import type { CognitiveStatus, ObservationRequest, QuarantineKind } from "../types.js";

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

function bindingsFor(db: DatabaseSync, concernId: string): NonNullable<ObservationRequest["concernInspectionBinding"]> {
  const row = getConcern(db, concernId);
  if (!row) throw new Error("fixture_row_missing");
  return {
    concernId,
    expectedSnapshotHash: row.snapshotHash,
    expectedStatus: row.status,
    expectedQuarantineKind: null,
  };
}

function requestFor(
  concernId: string,
  binding: NonNullable<ObservationRequest["concernInspectionBinding"]>,
): ObservationRequest {
  return {
    requestId: `inspect-${concernId}`,
    cycleId: "cycle-inspect-exec",
    generation: 1,
    kind: "concern.inspect",
    request: { concernRef: concernId },
    replaySafe: true as const,
    concernInspectionBinding: binding,
  };
}

describe("concern.inspect executor branch", () => {
  it("returns current canonical content for a matching binding", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-inspect-exec", conversationId: "thread-inspect-exec",
        triggerKind: "owner_message", triggerRef: "owner-inspect-exec", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-current", conversationId: "thread-inspect-exec", statement: "Dormant meaning." });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(requestFor("concern-current", bindingsFor(sidecar, "concern-current")));
      expect(observation).toMatchObject({
        modality: "tool",
        provenance: "sidecar:concern.inspect",
        dataClassification: "never_public",
        secretOmitted: false,
        replaySafe: true,
      });
      expect(observation.payload).toEqual({
        concernId: "concern-current",
        result: "current",
        class: "dormant",
        cognitiveStatus: "dormant_but_revisitable",
        quarantine: null,
        statement: "Dormant meaning.",
        statementTruncated: false,
      });
      expect(utf8JsonBytes(observation)).toBeLessThanOrEqual(640);
      const keys = Object.keys(observation.payload as Record<string, unknown>);
      for (const forbidden of ["snapshotHash", "expectedSnapshotHash", "actualSnapshotHash", "updatedCycle", "updatedGeneration", "occupancyStatus", "dimensions", "sourceTurnRefIds", "assertionKeyPresent", "no_longer_authorized"]) {
        expect(keys).not.toContain(forbidden);
      }
      expect(JSON.stringify(observation.payload)).not.toContain("no_longer_authorized");
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("returns stale with the current status and statement when the row changes", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-inspect-stale", conversationId: "thread-inspect-stale",
        triggerKind: "owner_message", triggerRef: "owner-inspect-stale", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-stale", conversationId: "thread-inspect-stale", statement: "Original dormant meaning." });
      const binding = bindingsFor(sidecar, "concern-stale");
      seedConcern(sidecar, { concernId: "concern-stale", conversationId: "thread-inspect-stale", statement: "Changed dormant meaning." });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(requestFor("concern-stale", binding));
      expect(observation.payload).toEqual({
        concernId: "concern-stale",
        result: "stale",
        class: "dormant",
        cognitiveStatus: "dormant_but_revisitable",
        quarantine: null,
        statement: "Changed dormant meaning.",
        statementTruncated: false,
      });
      expect(utf8JsonBytes(observation)).toBeLessThanOrEqual(640);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("returns stale with the actual status after a mid-flight transition, never silently current", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-inspect-transition", conversationId: "thread-inspect-transition",
        triggerKind: "owner_message", triggerRef: "owner-inspect-transition", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-transition", conversationId: "thread-inspect-transition", statement: "Dormant meaning." });
      const binding = bindingsFor(sidecar, "concern-transition");
      seedConcern(sidecar, { concernId: "concern-transition", conversationId: "thread-inspect-transition", statement: "Revived meaning.", status: "active" });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(requestFor("concern-transition", binding));
      expect(observation.payload).toMatchObject({
        concernId: "concern-transition",
        result: "stale",
        class: "active_like",
        cognitiveStatus: "active",
        quarantine: null,
        statement: "Revived meaning.",
      });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("returns result-only missing for a deleted row", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-inspect-missing", conversationId: "thread-inspect-missing",
        triggerKind: "owner_message", triggerRef: "owner-inspect-missing", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-missing", conversationId: "thread-inspect-missing", statement: "Soon gone." });
      const binding = bindingsFor(sidecar, "concern-missing");
      sidecar.prepare("DELETE FROM concerns WHERE concern_id = ?").run("concern-missing");
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(requestFor("concern-missing", binding));
      expect(observation.payload).toEqual({ result: "missing" });
      expect(utf8JsonBytes(observation)).toBeLessThanOrEqual(640);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("serves a quarantined concern with its kind, never as a silent trust upgrade", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-inspect-quarantine", conversationId: "thread-inspect-quarantine",
        triggerKind: "owner_message", triggerRef: "owner-inspect-quarantine", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-quarantined", conversationId: "thread-inspect-quarantine", statement: "Unavailable source meaning.", status: null });
      quarantineConcern(sidecar, "concern-quarantined", "legacy_quarantine_reason_unavailable");
      const binding = {
        concernId: "concern-quarantined",
        expectedSnapshotHash: getConcern(sidecar, "concern-quarantined")!.snapshotHash,
        expectedStatus: null,
        expectedQuarantineKind: "legacy_quarantine_reason_unavailable" as const,
      };
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(requestFor("concern-quarantined", binding));
      expect(observation.payload).toEqual({
        concernId: "concern-quarantined",
        result: "current",
        class: "quarantined",
        cognitiveStatus: null,
        quarantine: { kind: "legacy_quarantine_reason_unavailable" },
        statement: "Unavailable source meaning.",
        statementTruncated: false,
      });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("never serves a forgotten concern, even to a matching binding", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-inspect-forgotten", conversationId: "thread-inspect-forgotten",
        triggerKind: "owner_message", triggerRef: "owner-inspect-forgotten", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-forgotten", conversationId: "thread-inspect-forgotten", statement: "Soon forgotten." });
      const binding = bindingsFor(sidecar, "concern-forgotten");
      sidecar.prepare(
        `UPDATE concerns SET statement = '', source_refs_json = '[]', assertion_key = NULL,
             cognitive_status = NULL, forgotten = 1 WHERE concern_id = ?`,
      ).run("concern-forgotten");
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(requestFor("concern-forgotten", binding));
      expect(observation.payload).toEqual({ result: "missing" });
      expect(JSON.stringify(observation.payload)).not.toContain("Soon forgotten.");
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("rejects a binding/request mismatch without reading content", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-inspect-mismatch", conversationId: "thread-inspect-mismatch",
        triggerKind: "owner_message", triggerRef: "owner-inspect-mismatch", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-a", conversationId: "thread-inspect-mismatch", statement: "A." });
      seedConcern(sidecar, { concernId: "concern-b", conversationId: "thread-inspect-mismatch", statement: "B." });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      await expect(executors.executeObservation({
        ...requestFor("concern-a", bindingsFor(sidecar, "concern-b")),
        request: { concernRef: "concern-a" },
      })).rejects.toThrow("observation_unavailable");
      await expect(executors.executeObservation({
        requestId: "inspect-none", cycleId: "cycle-inspect-mismatch", generation: 1,
        kind: "concern.inspect", request: { concernRef: "concern-a" }, replaySafe: true as const,
      })).rejects.toThrow("observation_unavailable");
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("owns currentness comparison in the canonical helper, not the executor", () => {
    const sidecar = openTestSidecar();
    try {
      seedConcern(sidecar, { concernId: "concern-owned", conversationId: "thread-owned", statement: "Owned meaning." });
      const row = getConcern(sidecar, "concern-owned");
      if (!row) throw new Error("fixture_row_missing");
      const verdict = inspectConcernCurrentness(sidecar, "concern-owned", {
        snapshotHash: row.snapshotHash,
        status: "dormant_but_revisitable",
        quarantineKind: null,
      });
      expect(verdict.matches).toBe(true);
      expect(verdict.currentStatus).toBe("dormant_but_revisitable");
      expect(inspectConcernCurrentness(sidecar, "concern-owned", {
        snapshotHash: "deadbeef",
        status: "dormant_but_revisitable",
        quarantineKind: null,
      }).matches).toBe(false);
      expect(inspectConcernCurrentness(sidecar, "concern-absent", {
        snapshotHash: "deadbeef",
        status: "dormant_but_revisitable",
        quarantineKind: null,
      })).toMatchObject({ actual: null, matches: false, currentStatus: null });
    } finally {
      sidecar.close();
    }
  });

  it("truncates to the largest UTF-8-safe prefix fitting the final Observation", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-1", conversationId: "thread-inspect-truncate",
        triggerKind: "owner_message", triggerRef: "owner-inspect-truncate", occupantId: "doc", nowMs: 1,
      });
      const statement = `prefix-${"x".repeat(600)}-suffix`;
      seedConcern(sidecar, { concernId: "c-long", conversationId: "thread-inspect-truncate", statement });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(requestFor("c-long", bindingsFor(sidecar, "c-long")));
      const payload = observation.payload as { statement: string; statementTruncated: boolean; originalStatementBytes: number };
      expect(payload.statementTruncated).toBe(true);
      expect(payload.originalStatementBytes).toBe(Buffer.byteLength(statement, "utf8"));
      expect(utf8JsonBytes(observation)).toBeLessThanOrEqual(640);
      expect(statement.startsWith(payload.statement)).toBe(true);
      const tail = statement.slice(payload.statement.length);
      expect(tail.length).toBeGreaterThan(0);
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(payload.statement, "utf8"))).not.toThrow();
      expect(payload.statement.length).toBeGreaterThan(0);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("leaves concern, occupancy, trigger, and working-context rows byte-identical", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-inspect-side", conversationId: "thread-inspect-side",
        triggerKind: "owner_message", triggerRef: "owner-inspect-side", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-side", conversationId: "thread-inspect-side", statement: "Side-effect probe." });
      const beforeConcerns = sidecar.prepare("SELECT * FROM concerns ORDER BY concern_id").all();
      const beforeOccupancy = sidecar.prepare("SELECT * FROM mind_occupancy ORDER BY concern_id").all();
      const beforeTriggers = sidecar.prepare("SELECT * FROM future_triggers ORDER BY trigger_id").all();
      const beforeWc = sidecar.prepare("SELECT * FROM working_context_items ORDER BY id").all();
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      await executors.executeObservation(requestFor("concern-side", bindingsFor(sidecar, "concern-side")));
      expect(sidecar.prepare("SELECT * FROM concerns ORDER BY concern_id").all()).toEqual(beforeConcerns);
      expect(sidecar.prepare("SELECT * FROM mind_occupancy ORDER BY concern_id").all()).toEqual(beforeOccupancy);
      expect(sidecar.prepare("SELECT * FROM future_triggers ORDER BY trigger_id").all()).toEqual(beforeTriggers);
      expect(sidecar.prepare("SELECT * FROM working_context_items ORDER BY id").all()).toEqual(beforeWc);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("fails closed before persistence when even fixed metadata cannot fit", () => {
    const oversized: ObservationRequest = {
      requestId: "inspect-huge",
      cycleId: "c".repeat(400),
      generation: 1,
      kind: "concern.inspect",
      request: { concernRef: "k".repeat(400) },
      replaySafe: true as const,
      concernInspectionBinding: { concernId: "k".repeat(400), expectedSnapshotHash: "s".repeat(64), expectedStatus: "dormant_but_revisitable" },
    };
    const candidate = {
      observationId: `v021:observation:${oversized.requestId}`,
      cycleId: oversized.cycleId,
      generation: 1,
      derived: false,
      replaySafe: true,
      modality: "tool",
      payload: { result: "missing" },
      provenance: "sidecar:concern.inspect",
      dataClassification: "never_public",
      secretOmitted: false,
    };
    expect(utf8JsonBytes(candidate)).toBeGreaterThan(640);
  });

  it("rejects an over-bound missing Observation through the executor before persistence", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      const concernId = "k".repeat(400);
      admitTestCycle(sidecar, {
        cycleId: "c".repeat(400), conversationId: "thread-inspect-missing-bound",
        triggerKind: "owner_message", triggerRef: "owner-inspect-missing-bound", occupantId: "doc", nowMs: 1,
      });
      expect(getConcern(sidecar, concernId)).toBeNull();
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      await expect(executors.executeObservation({
        requestId: "inspect-huge-exec",
        cycleId: "c".repeat(400),
        generation: 1,
        kind: "concern.inspect",
        request: { concernRef: concernId },
        replaySafe: true as const,
        concernInspectionBinding: { concernId, expectedSnapshotHash: "s".repeat(64), expectedStatus: "dormant_but_revisitable" },
      })).rejects.toThrow("observation_unavailable");
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM observations").get()).toMatchObject({ count: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});

function discoverRequest(
  cycleId: string,
  request: Record<string, unknown>,
): ObservationRequest {
  return {
    requestId: `discover-${cycleId}`,
    cycleId,
    generation: 1,
    kind: "concern.inspect",
    request,
    replaySafe: true as const,
  };
}

describe("concern.inspect discover executor branch", () => {
  it("returns a content-free inspectable page ordered concern_id ASC", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cp", conversationId: "th",
        triggerKind: "owner_message", triggerRef: "owner-discover-page", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "act", conversationId: "th", statement: "Active.", status: "active" });
      seedConcern(sidecar, { concernId: "dorm", conversationId: "th", statement: "Dormant A." });
      seedConcern(sidecar, { concernId: "res", conversationId: "th", statement: "Resolved B.", status: "resolved" });
      seedConcern(sidecar, { concernId: "une", conversationId: "th", statement: "Unestablished D.", status: null });
      seedConcern(sidecar, { concernId: "qtn", conversationId: "th", statement: "Quarantined E.", status: null });
      quarantineConcern(sidecar, "qtn", "legacy_unavailable_source");
      seedConcern(sidecar, { concernId: "for", conversationId: "th", statement: "Forgotten F.", status: null });
      sidecar.prepare(
        `UPDATE concerns SET statement = '', source_refs_json = '[]', assertion_key = NULL,
             cognitive_status = NULL, forgotten = 1 WHERE concern_id = 'for'`,
      ).run();
      seedConcern(sidecar, { concernId: "oth", conversationId: "th2", statement: "Other thread." });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(discoverRequest("cp", { discover: {} }));
      expect(observation).toMatchObject({
        modality: "tool",
        provenance: "sidecar:concern.inspect",
        dataClassification: "never_public",
        secretOmitted: false,
        replaySafe: true,
      });
      expect(observation.payload).toEqual({
        result: "page",
        concerns: [
          { concernId: "dorm", cognitiveStatus: "dormant_but_revisitable", quarantineKind: null },
          { concernId: "qtn", cognitiveStatus: null, quarantineKind: "legacy_unavailable_source" },
          { concernId: "res", cognitiveStatus: "resolved", quarantineKind: null },
          { concernId: "une", cognitiveStatus: null, quarantineKind: null },
        ],
        omittedCount: 0,
        nextCursor: null,
      });
      expect(JSON.stringify(observation.payload)).not.toContain("statement");
      expect(JSON.stringify(observation.payload)).not.toContain("act");
      expect(JSON.stringify(observation.payload)).not.toContain("oth");
      expect(utf8JsonBytes(observation)).toBeLessThanOrEqual(640);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM observations").get()).toMatchObject({ count: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("pages with a keyset cursor and reports omittedCount with nextCursor", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-discover-cursor", conversationId: "thread-discover-cursor",
        triggerKind: "owner_message", triggerRef: "owner-discover-cursor", occupantId: "doc", nowMs: 1,
      });
      for (const id of ["concern-1", "concern-2", "concern-3", "concern-4"]) {
        seedConcern(sidecar, { concernId: id, conversationId: "thread-discover-cursor", statement: `${id} meaning.` });
      }
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const first = await executors.executeObservation(discoverRequest("cycle-discover-cursor", {
        discover: { limit: 2 },
      }));
      expect(first.payload).toEqual({
        result: "page",
        concerns: [
          { concernId: "concern-1", cognitiveStatus: "dormant_but_revisitable", quarantineKind: null },
          { concernId: "concern-2", cognitiveStatus: "dormant_but_revisitable", quarantineKind: null },
        ],
        omittedCount: 2,
        nextCursor: "concern-2",
      });
      const second = await executors.executeObservation(discoverRequest("cycle-discover-cursor", {
        discover: { cursor: "concern-2", limit: 2 },
      }));
      expect(second.payload).toEqual({
        result: "page",
        concerns: [
          { concernId: "concern-3", cognitiveStatus: "dormant_but_revisitable", quarantineKind: null },
          { concernId: "concern-4", cognitiveStatus: "dormant_but_revisitable", quarantineKind: null },
        ],
        omittedCount: 0,
        nextCursor: null,
      });
      expect(utf8JsonBytes(first)).toBeLessThanOrEqual(640);
      expect(utf8JsonBytes(second)).toBeLessThanOrEqual(640);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("fails closed with cursor_invalid for a cursor outside the conversation window", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-discover-bad-cursor", conversationId: "thread-discover-bad-cursor",
        triggerKind: "owner_message", triggerRef: "owner-discover-bad-cursor", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-present", conversationId: "thread-discover-bad-cursor", statement: "Present." });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(discoverRequest("cycle-discover-bad-cursor", {
        discover: { cursor: "concern-absent" },
      }));
      expect(observation.payload).toEqual({
        result: "cursor_invalid",
        concerns: [],
        omittedCount: 0,
        nextCursor: null,
      });
      expect(utf8JsonBytes(observation)).toBeLessThanOrEqual(640);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("fails closed when a cursor is not an inspectable returned concern", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-discover-hidden-cursor", conversationId: "thread-discover-hidden-cursor",
        triggerKind: "owner_message", triggerRef: "owner-discover-hidden-cursor", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-a", conversationId: "thread-discover-hidden-cursor", statement: "A.", status: "resolved" });
      seedConcern(sidecar, { concernId: "concern-b", conversationId: "thread-discover-hidden-cursor", statement: "B.", status: "active" });
      seedConcern(sidecar, { concernId: "concern-c", conversationId: "thread-discover-hidden-cursor", statement: "C.", status: "resolved" });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });

      const observation = await executors.executeObservation(discoverRequest("cycle-discover-hidden-cursor", {
        discover: { cursor: "concern-b", limit: 1 },
      }));

      expect(observation.payload).toEqual({
        result: "cursor_invalid",
        concerns: [],
        omittedCount: 0,
        nextCursor: null,
      });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("throws observation_unavailable when the cycle has no conversation binding", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      await expect(executors.executeObservation(discoverRequest("cycle-missing", {
        discover: {},
      }))).rejects.toThrow("observation_unavailable");
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("shrinks the page to the 640-byte observation bound and keeps omittedCount truthful", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-discover-bound", conversationId: "thread-discover-bound",
        triggerKind: "owner_message", triggerRef: "owner-discover-bound", occupantId: "doc", nowMs: 1,
      });
      for (let index = 0; index < 24; index += 1) {
        const id = `concern-bound-${String(index).padStart(2, "0")}-${"x".repeat(40)}`;
        seedConcern(sidecar, { concernId: id, conversationId: "thread-discover-bound", statement: `Bound ${index}.` });
      }
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(discoverRequest("cycle-discover-bound", {
        discover: { limit: 64 },
      }));
      const payload = observation.payload as {
        result: string;
        concerns: Array<{ concernId: string }>;
        omittedCount: number;
        nextCursor: string | null;
      };
      expect(payload.result).toBe("page");
      expect(payload.concerns.length).toBeGreaterThan(0);
      expect(payload.concerns.length).toBeLessThan(24);
      expect(payload.omittedCount).toBeGreaterThan(0);
      expect(payload.nextCursor).toBe(payload.concerns.at(-1)?.concernId ?? null);
      expect(utf8JsonBytes(observation)).toBeLessThanOrEqual(640);
      expect(JSON.stringify(payload.concerns)).not.toContain("statement");
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("never returns a binding-shaped payload on the discover branch", async () => {
    const nuclear = new DatabaseSync(":memory:");
    const sidecar = openTestSidecar();
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-discover-shape", conversationId: "thread-discover-shape",
        triggerKind: "owner_message", triggerRef: "owner-discover-shape", occupantId: "doc", nowMs: 1,
      });
      seedConcern(sidecar, { concernId: "concern-shape", conversationId: "thread-discover-shape", statement: "Shape." });
      const executors = createV021LiveOperationExecutors({ nuclear, sidecar });
      const observation = await executors.executeObservation(discoverRequest("cycle-discover-shape", {
        discover: {},
      }));
      const keys = Object.keys(observation.payload as Record<string, unknown>);
      expect(keys.sort()).toEqual(["concerns", "nextCursor", "omittedCount", "result"]);
      for (const forbidden of ["concernId", "statement", "class", "cognitiveStatus", "quarantine", "statementTruncated", "snapshotHash"]) {
        expect(keys).not.toContain(forbidden);
      }
      const items = (observation.payload as { concerns: Array<Record<string, unknown>> }).concerns;
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(["cognitiveStatus", "concernId", "quarantineKind"]);
      }
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
