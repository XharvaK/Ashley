import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { applyConcernDelta, getConcern } from "../concerns/lineage.js";
import { inspectConcernCurrentness } from "../thought/source-currentness.js";
import { utf8JsonBytes } from "../thought/projection-allocator/composition-contract.js";
import { createV021LiveOperationExecutors } from "./live-operations.js";
import type { ObservationRequest } from "../types.js";

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

function bindingsFor(db: DatabaseSync, concernId: string): NonNullable<ObservationRequest["concernInspectionBinding"]> {
  const row = getConcern(db, concernId);
  if (!row) throw new Error("fixture_row_missing");
  return { concernId, expectedSnapshotHash: row.snapshotHash, expectedStatus: "dormant_but_revisitable" };
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
        currentStatus: "dormant_but_revisitable",
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
        currentStatus: "active",
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
      expect(observation.payload).toEqual({ concernId: "concern-missing", result: "missing" });
      expect(utf8JsonBytes(observation)).toBeLessThanOrEqual(640);
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
      });
      expect(verdict.matches).toBe(true);
      expect(verdict.currentStatus).toBe("dormant_but_revisitable");
      expect(inspectConcernCurrentness(sidecar, "concern-owned", {
        snapshotHash: "deadbeef",
        status: "dormant_but_revisitable",
      }).matches).toBe(false);
      expect(inspectConcernCurrentness(sidecar, "concern-absent", {
        snapshotHash: "deadbeef",
        status: "dormant_but_revisitable",
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
      payload: { concernId: "k".repeat(400), result: "missing" },
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
