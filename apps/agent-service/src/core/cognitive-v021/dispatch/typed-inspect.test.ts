
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { applyConcernDelta } from "../concerns/lineage.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { persistOrVerifyObservation } from "../observation/persistence.js";
import { scheduleFutureTrigger } from "../initiative/future-triggers.js";
import { createObservationSubscription } from "../observation/subscriptions.js";
import { admitDetachedOperation, setDetachedOperationTerminal } from "../operation/detached.js";
import { markInFlightUnknown, putInFlight } from "../effect/in-flight.js";
import { createV021LiveOperationExecutors } from "./live-operations.js";
import { getCapabilityReality } from "../thought/capability-reality.js";
import { REGISTERED_OPERATION_KINDS } from "../thought/output-contract.js";
import { parseThoughtSemanticOutput } from "../thought/parse.js";
import type { ObservationRequest } from "../types.js";
import type { ExecuteProjectInspectionV2Result } from "../../sandbox/v2-execution.js";

function request(kind: string, value: Record<string, unknown>, audience: unknown = { kind: "owner_private" }): ObservationRequest {
  return {
    requestId: `request-${kind}`,
    cycleId: "cycle-inspect-owner",
    generation: 1,
    kind,
    request: value,
    replaySafe: true,
    audience,
  } as unknown as ObservationRequest;
}

function semantic(operationKind: string, value: Record<string, unknown>) {
  return {
    kind: "observation_intent",
    operationKind,
    request: value,
    purpose: "inspect current state",
    evidenceNeed: "typed read-only evidence",
    existingRefs: [],
  };
}

describe("typed inspect operations", () => {
  it("registers four fixed inspect kinds and validates each request shape", () => {
    const kinds = ["capability.inspect", "evidence.inspect", "temporal.inspect", "work.inspect"];
    for (const kind of kinds) expect(REGISTERED_OPERATION_KINDS).toContain(kind);

    const valid = [
      semantic("capability.inspect", { operationKind: "candidate.develop" }),
      semantic("evidence.inspect", { filter: { modality: "tool" }, limit: 8 }),
      semantic("temporal.inspect", { limit: 8 }),
      semantic("work.inspect", { limit: 8 }),
    ];
    for (const value of valid) expect(parseThoughtSemanticOutput(value, new Set())).toMatchObject({ ok: true });

    expect(parseThoughtSemanticOutput(
      semantic("capability.inspect", { operationKind: "candidate.develop", prompt: "tell me about Ashley" }),
      new Set(),
    )).toMatchObject({ ok: false });
    expect(parseThoughtSemanticOutput(
      semantic("evidence.inspect", { filter: { unknownField: "x" } }),
      new Set(),
    )).toMatchObject({ ok: false });
  });

  it("returns one named operation's current capability facts and never claims social delegation", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const ownerId = "owner-inspect";
    admitTestCycle(sidecar, {
      cycleId: "cycle-inspect-owner",
      conversationId: "thread-inspect-owner",
      triggerKind: "owner_message",
      triggerRef: "owner-inspect",
      occupantId: ownerId,
      authorityEpoch: 1,
      nowMs: 1,
    });
    try {
      const expected = getCapabilityReality(nuclear);
      const candidate = expected.operationCapabilities?.find((item) => item.operationKind === "candidate.develop");
      expect(candidate).toBeDefined();
      const executor = createV021LiveOperationExecutors({ nuclear, sidecar, ownerId });
      const observation = await executor.executeObservation(request("capability.inspect", {
        operationKind: "candidate.develop",
      }));
      expect(observation.payload).toMatchObject({
        operationKind: "candidate.develop",
        schemaId: "ashley.workspace_worker_request.v1",
        capability: candidate,
        socialOperationDelegation: "unavailable_no_record",
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("keeps capability project ids empty for an external audience and rejects external inspection", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const ownerId = "owner-inspect";
    admitTestCycle(sidecar, {
      cycleId: "cycle-inspect-owner",
      conversationId: "thread-inspect-owner",
      triggerKind: "owner_message",
      triggerRef: "owner-inspect",
      occupantId: ownerId,
      authorityEpoch: 1,
      nowMs: 1,
    });
    try {
      const external = getCapabilityReality(nuclear, { audience: { kind: "room", roomId: "room-external" } });
      expect(external.approvedProjectIds).toEqual([]);
      expect(external.operationCapabilities?.every((item) => item.authorizedProjectIds.length === 0)).toBe(true);
      expect(external.semanticObservations?.every((item) => !item.available)).toBe(true);

      const executor = createV021LiveOperationExecutors({ nuclear, sidecar, ownerId });
      await expect(executor.executeObservation(request(
        "capability.inspect",
        { operationKind: "candidate.develop" },
        { kind: "room", roomId: "room-external" },
      ))).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
        reasonCode: "capability_not_in_live_set",
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("pages metadata-only evidence from Owner-visible cycles without exposing another occupant", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const ownerId = "owner-inspect";
    const conversationId = "thread-evidence-inspect";
    const ownerCycle = admitTestCycle(sidecar, {
      cycleId: "cycle-inspect-owner",
      conversationId,
      triggerKind: "owner_message",
      triggerRef: "owner-inspect",
      occupantId: ownerId,
      authorityEpoch: 1,
      nowMs: 1,
    });
    const otherCycle = admitTestCycle(sidecar, {
      cycleId: "cycle-inspect-other",
      conversationId,
      triggerKind: "owner_message",
      triggerRef: "other-inspect",
      occupantId: "other-occupant",
      authorityEpoch: 1,
      nowMs: 2,
    });
    const addObservation = (observationId: string, cycleId: string, generation: number, payload: unknown) => persistOrVerifyObservation(sidecar, {
      observationId,
      cycleId,
      generation,
      derived: false,
      replaySafe: true,
      modality: "tool",
      payload,
      provenance: "test:evidence",
      dataClassification: "ordinary",
      secretOmitted: false,
    }, 10);
    addObservation("owner-evidence-1", ownerCycle.cycleId, ownerCycle.generation, { text: "OWNER_CONTENT_MUST_NOT_APPEAR" });
    addObservation("owner-evidence-2", ownerCycle.cycleId, ownerCycle.generation, { text: "second private payload" });
    addObservation("other-evidence", otherCycle.cycleId, otherCycle.generation, { text: "OTHER_OCCUPANT_SECRET" });

    try {
      const executor = createV021LiveOperationExecutors({ nuclear, sidecar, ownerId });
      const first = await executor.executeObservation(request("evidence.inspect", {
        filter: { modality: "tool" },
        limit: 1,
      }));
      expect(first.payload).toMatchObject({
        searchedPopulation: 2,
        matchedPopulation: 2,
        rows: [expect.objectContaining({ observationId: "owner-evidence-1", representationIds: [] })],
        nextCursor: expect.any(String),
      });
      expect(JSON.stringify(first.payload)).not.toContain("OWNER_CONTENT_MUST_NOT_APPEAR");
      expect(JSON.stringify(first.payload)).not.toContain("OTHER_OCCUPANT_SECRET");
      expect(JSON.stringify(first.payload)).not.toContain("other-evidence");

      const cursor = (first.payload as { nextCursor: string }).nextCursor;
      const second = await executor.executeObservation(request("evidence.inspect", {
        filter: { modality: "tool" },
        limit: 1,
        cursor,
      }));
      expect(second.payload).toMatchObject({
        searchedPopulation: 2,
        rows: [expect.objectContaining({ observationId: "owner-evidence-2" })],
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("returns temporal purpose only from stored payload and labels the missing pre-W4 objective facet", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const ownerId = "owner-inspect";
    const conversationId = "thread-temporal-inspect";
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-inspect-owner",
      conversationId,
      triggerKind: "owner_message",
      triggerRef: "owner-inspect",
      occupantId: ownerId,
      authorityEpoch: 1,
      nowMs: 1,
    });
    applyConcernDelta(sidecar, {
      op: "upsert",
      record: {
        concernId: "concern-temporal",
        conversationId,
        statement: "Follow up on the result.",
        sourceTurnIds: ["owner-turn"],
        dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
        assertionKey: null,
        status: "active",
      },
    }, { cycleId: cycle.cycleId, generation: 1 });
    scheduleFutureTrigger(sidecar, {
      triggerId: "trigger-temporal",
      conversationId,
      concernId: "concern-temporal",
      snapshotHash: "snapshot-temporal",
      dueAtMs: 20_000,
      payload: { purpose: "check the follow-up state" },
    });
    createObservationSubscription(sidecar, {
      subscriptionId: "subscription-temporal",
      conversationId,
      concernId: "concern-temporal",
      source: "owner",
      scope: "conversation",
      topicKeys: ["follow-up"],
      match: "equality",
      expiresAtMs: null,
      externalSource: null,
      pollIntervalMs: null,
      requesterId: ownerId,
    });
    try {
      const executor = createV021LiveOperationExecutors({ nuclear, sidecar, ownerId });
      const observation = await executor.executeObservation(request("temporal.inspect", { limit: 8 }));
      expect(observation.payload).toMatchObject({
        concerns: [expect.objectContaining({ concernId: "concern-temporal" })],
        futureTriggers: [expect.objectContaining({
          triggerId: "trigger-temporal",
          purpose: "check the follow-up state",
          objectiveFacetState: "missing_pre_w4_p2",
        })],
        commitments: expect.any(Array),
        subscriptions: [expect.objectContaining({ subscriptionId: "subscription-temporal" })],
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reports failed detached work and does not start it", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const ownerId = "owner-inspect";
    const conversationId = "thread-work-inspect";
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-inspect-owner",
      conversationId,
      triggerKind: "owner_message",
      triggerRef: "owner-inspect",
      occupantId: ownerId,
      authorityEpoch: 1,
      nowMs: 1,
    });
    const admitted = admitDetachedOperation(sidecar, {
      idempotencyKey: "work-inspect-failed",
      conversationId,
      originCycleId: cycle.cycleId,
      originGeneration: cycle.generation,
      originKind: "OWNER_REQUEST",
      originRef: "owner-request-event",
      originOwnerEventId: "owner-request-event",
      operationKind: "project.investigate",
      request: { projectId: "project-ashley" },
      purpose: "inspect a project",
      evidenceNeed: "project evidence",
      operationDeadlineAtMs: 1_000,
      nowMs: 2,
    });
    expect(admitted.ok).toBe(true);
    if (admitted.ok) {
      const terminal = setDetachedOperationTerminal(sidecar, admitted.operation.operationId, {
        terminalState: "failed",
        errorCode: "file_too_large",
        nowMs: 3,
      });
      expect(terminal.ok).toBe(true);
    }
    try {
      const executor = createV021LiveOperationExecutors({ nuclear, sidecar, ownerId });
      const observation = await executor.executeObservation(request("work.inspect", { limit: 8 }));
      expect(observation.payload).toMatchObject({
        detachedOperations: [expect.objectContaining({
          state: "failed",
          errorCode: "file_too_large",
          startAtMs: null,
        })],
      });
      const row = sidecar.prepare("SELECT state, start_at_ms FROM detached_operations WHERE idempotency_key = ?")
        .get("work-inspect-failed") as { state: string; start_at_ms: number | null };
      expect(row).toEqual({ state: "failed", start_at_ms: null });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("pages in-flight and unknown effects even when there are no detached operations", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const ownerId = "owner-inspect";
    const conversationId = "thread-work-inspect-effects";
    const firstCycle = admitTestCycle(sidecar, {
      cycleId: "cycle-inspect-owner",
      generation: 1,
      conversationId,
      triggerKind: "owner_message",
      triggerRef: "work-effect-1",
      occupantId: ownerId,
      authorityEpoch: 1,
      nowMs: 1,
    });
    const secondCycle = admitTestCycle(sidecar, {
      cycleId: "cycle-work-effect-2",
      generation: 2,
      conversationId,
      triggerKind: "owner_message",
      triggerRef: "work-effect-2",
      occupantId: ownerId,
      authorityEpoch: 1,
      nowMs: 2,
    });
    putInFlight(sidecar, {
      cycleId: firstCycle.cycleId,
      generation: firstCycle.generation,
      correlationId: "work-effect-correlation-1",
      idempotencyKey: "work-effect-key-1",
      originEventId: "work-effect-1",
      operationKind: "candidate.develop",
      payload: { projectId: "project-ashley" },
    });
    const unknown = putInFlight(sidecar, {
      cycleId: secondCycle.cycleId,
      generation: secondCycle.generation,
      correlationId: "work-effect-correlation-2",
      idempotencyKey: "work-effect-key-2",
      originEventId: "work-effect-2",
      operationKind: "candidate.develop",
      payload: { projectId: "project-ashley" },
    });
    markInFlightUnknown(sidecar, unknown.effectId);
    try {
      const executor = createV021LiveOperationExecutors({ nuclear, sidecar, ownerId });
      const first = await executor.executeObservation(request("work.inspect", { limit: 1 }));
      expect(first.payload).toMatchObject({
        detachedOperations: [],
        searchedPopulation: 2,
        inFlightEffects: [expect.objectContaining({ status: "in_flight" })],
        nextCursor: expect.any(String),
      });
      const cursor = (first.payload as { nextCursor: string }).nextCursor;
      const second = await executor.executeObservation(request("work.inspect", { limit: 1, cursor }));
      expect(second.payload).toMatchObject({
        detachedOperations: [],
        inFlightEffects: [expect.objectContaining({ status: "unknown" })],
        nextCursor: null,
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("preserves project.inspect sandbox failure codes", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const failedResult = {
      license: { state: "failed", error: "file_too_large" },
      observation: null,
      dispatchAttempted: false,
    } satisfies ExecuteProjectInspectionV2Result;
    try {
      const executor = createV021LiveOperationExecutors({
        nuclear,
        sidecar,
        adapters: { executeProjectInspectionV2: async () => failedResult },
      });
      await expect(executor.executeObservation(request("project.inspect", {
        projectId: "project-ashley",
        locator: { kind: "file", path: "README.md" },
      }))).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
        reasonCode: "file_too_large",
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("keeps project.inspect failures structured when a result object has no sandbox code", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const failedResult = {
      license: { state: "failed" },
      observation: null,
      dispatchAttempted: false,
    } satisfies ExecuteProjectInspectionV2Result;
    try {
      const executor = createV021LiveOperationExecutors({
        nuclear,
        sidecar,
        adapters: { executeProjectInspectionV2: async () => failedResult },
      });
      await expect(executor.executeObservation(request("project.inspect", {
        projectId: "project-ashley",
        locator: { kind: "file", path: "README.md" },
      }))).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
        reasonCode: "project_inspection_failed",
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reports an invalid successful project.inspect result as a structured blocker", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const invalidResult = {
      license: { state: "succeeded", profile: "project_investigation" },
      observation: null,
      dispatchAttempted: true,
    } satisfies ExecuteProjectInspectionV2Result;
    try {
      const executor = createV021LiveOperationExecutors({
        nuclear,
        sidecar,
        adapters: { executeProjectInspectionV2: async () => invalidResult },
      });
      await expect(executor.executeObservation(request("project.inspect", {
        projectId: "project-ashley",
        locator: { kind: "file", path: "README.md" },
      }))).rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
        reasonCode: "project_inspection_result_invalid",
      });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});
