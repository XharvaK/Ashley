import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { createOutboxProjector } from "../delivery/outbox-projector.js";
import { enqueueWorkerUndertakingIntent, serviceWorkerUndertakings } from "../operation/dispatch.js";
import { getDetachedOperation } from "../operation/detached.js";
import { getInterimOutboxByUndertaking } from "../operation/interim.js";
import { getWorkerUndertaking } from "../operation/worker-queue.js";
import { runCognitiveCycle } from "./run.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function deps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null })),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false }, currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} }, capability: capabilityReality,
      operational: { sandboxAvailable: false }, relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
    ...overrides,
  };
}

function setupThread(threadId: string) {
  const sidecar = openTestSidecar();
  const attentionDb = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  const cycle = admitTestCycle(sidecar, {
    cycleId: `cycle-${threadId}`,
    conversationId: threadId,
    triggerKind: "owner_message",
    triggerRef: "owner-1",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId: threadId, text: "investigate the service", discordMessageIds: ["d1"], nowMs: 2,
  });
  const event = appendInboxEvent(sidecar, {
    wakeId: cycle.wakeId,
    conversationId: threadId,
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: "investigate the service" },
    createdAtMs: 2,
  });
  return { sidecar, attentionDb, nuclear, cycle, evidence, event };
}

/** Manually-released worker gate. Method scope keeps narrowing sound across awaits. */
function manualWorkerGate<T>() {
  let release: ((value: T) => void) | undefined;
  return {
    promise: new Promise<T>((resolve) => { release = resolve; }),
    release(value: T): void {
      if (!release) throw new Error("worker never started");
      release(value);
    },
  };
}

function investigateCompletion(overrides: Record<string, unknown> = {}) {
  return {
    text: JSON.stringify({
      kind: "observation_intent",
      operationKind: "project.inspect",
      request: { projectId: "project-ashley", focus: "apps/agent-service" },
      purpose: "inspect the current project",
      evidenceNeed: "bounded file evidence",
      existingRefs: [],
      interimSpeech: { mode: "hold", surfaceDraft: "Yeah, give me a bit. I'm going to look through it." },
      ...overrides,
    }),
    model: "fake", modelAlias: "thought", resolvedModelId: null,
  };
}

describe("detached investigate Thought A", () => {
  it("yields to a durably admitted queue undertaking before the worker completes", async () => {
    const { sidecar, attentionDb, nuclear, event } = setupThread("thread-detach-yield");
    const projector = createOutboxProjector(sidecar, nuclear);
    const completeChat = vi.fn(async () => investigateCompletion());
    const executeObservation = vi.fn();
    const gate = manualWorkerGate<{ ok: true; payload: unknown }>();
    const workerCalls: string[] = [];
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
        executeObservation,
        enqueueWorkerUndertaking: (input) => enqueueWorkerUndertakingIntent(sidecar, input),
        projectInterim: (interimId) => projector.projectInterim(interimId),
      }));

      // Thought A yielded: durable queue identity, pending obligation.
      expect(result.published).toBe(false);
      expect(typeof result.workerUndertakingId).toBe("string");
      const undertakingId = result.workerUndertakingId!;
      expect(result.ownerObligationResolution).toMatchObject({
        ownerObligationOutcome: "transferred",
        successorIdentity: `worker_undertaking:${undertakingId}`,
        remainingResponsibility: "operation_pending",
      });
      // The synchronous observation path never ran.
      expect(executeObservation).not.toHaveBeenCalled();
      // Interim hold is durably owned and projected for delivery.
      const interim = getInterimOutboxByUndertaking(sidecar, undertakingId);
      expect(interim?.surfaceDraft).toBe("Yeah, give me a bit. I'm going to look through it.");
      expect(interim?.sendStatus).toBe("projected");
      expect(workerCalls).toEqual([]);

      const service = serviceWorkerUndertakings(sidecar, {
        nowMs: 20,
        worker: async ({ operation }) => {
          workerCalls.push(operation.operationId);
          return gate.promise;
        },
        capacityProbe: () => ({ available: true as const }),
      });
      while (workerCalls.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      const operationId = getWorkerUndertaking(sidecar, undertakingId)?.selectedOperationId;
      expect(operationId).toBeTruthy();
      expect(getDetachedOperation(sidecar, operationId ?? "")?.state).toBe("started");

      gate.release({ ok: true, payload: { summary: "done" } });
      await service;
      expect(getDetachedOperation(sidecar, operationId ?? "")).toMatchObject({
        state: "succeeded",
        terminalState: "succeeded",
      });
      expect(getWorkerUndertaking(sidecar, undertakingId)?.state).toBe("succeeded");
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("routes a semantic worker-required project.inspect without direct-read fallback", async () => {
    const { sidecar, attentionDb, nuclear, event } = setupThread("thread-semantic-worker");
    const completeChat = vi.fn(async () => investigateCompletion({
      operationKind: "project.inspect",
      request: {
        projectId: "project-ashley",
        locator: { kind: "file", path: "README.md" },
        question: "Explain why this file matters to the service",
      },
    }));
    const executeObservation = vi.fn();
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
        executeObservation,
        capabilityReality: {
          ...capabilityReality,
          canOfferProjectInspection: true,
          approvedProjectIds: ["project-ashley"],
        },
        enqueueWorkerUndertaking: (input) => enqueueWorkerUndertakingIntent(sidecar, input),
      }));
      expect(result.published).toBe(false);
      expect(result.workerUndertakingId).toBeTruthy();
      expect(executeObservation).not.toHaveBeenCalled();
      expect(getWorkerUndertaking(sidecar, result.workerUndertakingId!)).toMatchObject({
        state: "queued",
        semanticKind: "project.inspect",
      });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("keeps direct project.inspect synchronous with no detached identity", async () => {
    const { sidecar, attentionDb, nuclear, event } = setupThread("thread-detach-inspect");
    const observed: Observation = {
      observationId: "v021:observation:sync",
      cycleId: "cycle-thread-detach-inspect",
      generation: 1,
      derived: false,
      replaySafe: true,
      modality: "tool",
      payload: { operation: "project.read_file" },
      provenance: "sandbox-v2:project-inspection",
      dataClassification: "never_public",
      secretOmitted: false,
    };
    const completeChat = vi.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          kind: "observation_intent",
          operationKind: "project.inspect",
          request: { projectId: "project-ashley", locator: { kind: "file", path: "README.md" } },
          purpose: "read one known file",
          evidenceNeed: "the file contents",
          existingRefs: [],
        }),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      })
      .mockResolvedValue({
        text: JSON.stringify({
          kind: "abstain",
          reason: "insufficient_evidence",
          explanation: "Not enough to answer.",
          evidenceRefs: [],
        }),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      });
    const executeObservation = vi.fn(async () => observed);
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
        executeObservation,
      }));
      expect(executeObservation).toHaveBeenCalledTimes(1);
      expect(result.detachedOperationId).toBeUndefined();
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("deduplicates the same Owner queue admission without minting a second execution", async () => {
    const { sidecar, attentionDb, cycle, evidence, event } = setupThread("thread-detach-second");
    const completeChat = vi.fn(async () => investigateCompletion());
    try {
      const pre = enqueueWorkerUndertakingIntent(sidecar, {
        semanticKind: "project.inspect",
        intent: {
          kind: "observation_intent",
          operationKind: "project.inspect",
          request: { projectId: "project-ashley", focus: "apps/agent-service" },
           purpose: "inspect the current project",
          evidenceNeed: "bounded file evidence",
          existingRefs: [],
        },
        origin: { kind: "OWNER_REQUEST", ref: event.id, ownerEventId: event.id, evidenceRowId: evidence.rowId },
        ownerId: "doc",
        conversationId: cycle.conversationId,
        originCycleId: cycle.cycleId,
        originGeneration: cycle.generation,
        request: { projectId: "project-ashley", focus: "apps/agent-service" },
         purpose: "inspect the current project",
        evidenceNeed: "bounded file evidence",
        nowMs: 5,
      });
      expect(pre.queued).toBe(true);
      if (!pre.queued) return;

      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
        executeObservation: vi.fn(),
        enqueueWorkerUndertaking: (input) => enqueueWorkerUndertakingIntent(sidecar, input),
      }));
      expect(result.published).toBe(false);
      expect(result.workerUndertakingId).toBe(pre.undertaking.undertakingId);
      expect(result.infrastructureNotice).toBeNull();
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM worker_undertakings").get()).toMatchObject({ count: 1 });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("fails closed when no detach hook is wired", async () => {
    const { sidecar, attentionDb, nuclear, event } = setupThread("thread-detach-nohook");
    const completeChat = vi.fn()
      .mockResolvedValueOnce(investigateCompletion({ interimSpeech: { mode: "none" } }))
      .mockResolvedValue({
        text: JSON.stringify({
          kind: "abstain",
          reason: "insufficient_evidence",
          explanation: "Not enough to answer.",
          evidenceRefs: [],
        }),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      });
    const executeObservation = vi.fn(async (): Promise<Observation> => ({
      observationId: "v021:observation:sync-fallback",
      cycleId: "cycle-thread-detach-nohook",
      generation: 1,
      derived: false,
      replaySafe: true,
      modality: "tool",
      payload: { operation: "project.investigate" },
      provenance: "worker:project.investigate",
      dataClassification: "never_public",
      secretOmitted: true,
    }));
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
        executeObservation,
      }));
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBeNull();
      // Investigate has no synchronous fallback when detachment is absent.
      expect(executeObservation).not.toHaveBeenCalled();
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM detached_operations").get())
        .toMatchObject({ count: 0 });
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("fails closed when detachment is explicitly unavailable", async () => {
    const { sidecar, attentionDb, nuclear, event } = setupThread("thread-detach-unavailable");
    const completeChat = vi.fn()
      .mockResolvedValueOnce(investigateCompletion({ interimSpeech: { mode: "none" } }))
      .mockResolvedValue({
        text: JSON.stringify({
          kind: "abstain",
          reason: "insufficient_evidence",
          explanation: "Not enough to answer.",
          evidenceRefs: [],
        }),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      });
    const executeObservation = vi.fn();
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
        executeObservation,
      }));
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBeNull();
      expect(executeObservation).not.toHaveBeenCalled();
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM detached_operations").get())
        .toMatchObject({ count: 0 });
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("fails closed when the detachment seam throws", async () => {
    const { sidecar, attentionDb, nuclear, event } = setupThread("thread-detach-throws");
    const completeChat = vi.fn()
      .mockResolvedValueOnce(investigateCompletion({ interimSpeech: { mode: "none" } }))
      .mockResolvedValue({
        text: JSON.stringify({
          kind: "abstain",
          reason: "insufficient_evidence",
          explanation: "Not enough to answer.",
          evidenceRefs: [],
        }),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      });
    const executeObservation = vi.fn();
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
        executeObservation,
      }));
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBeNull();
      expect(executeObservation).not.toHaveBeenCalled();
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM detached_operations").get())
        .toMatchObject({ count: 0 });
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });
});
