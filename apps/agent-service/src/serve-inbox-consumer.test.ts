import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "./core/db.js";
import { openTestSidecar } from "./core/cognitive-v021/test-support.js";
import { admitCognitiveIngress } from "./core/cognitive-v021/ingress/http.js";
import {
  consumeNextInboxEvent,
  type InboxConsumerHandler,
} from "./core/cognitive-v021/cycle/inbox-consumer.js";
import { getCycle, getInboxEvent, updateCycleState } from "./core/cognitive-v021/cycle/inbox.js";
import { getActiveDeferredFrontier } from "./core/cognitive-v021/frontier/ledger.js";
import { createAgentInboxConsumerHandler } from "./serve.js";
import type { CognitiveDispatchResult, InboxEvent } from "./core/cognitive-v021/types.js";

describe("production inbox consumer wiring seam (Campaign 1)", () => {
  it("mechanically proves compile-time rejection of Promise<void> handlers", () => {
    // @ts-expect-error - Promise<void> callback must fail compilation against InboxConsumerHandler
    const _invalidHandler: InboxConsumerHandler = async (_event: InboxEvent): Promise<void> => {
      await Promise.resolve();
    };
    expect(typeof _invalidHandler).toBe("function");
  });

  it("propagates deferred result through actual production adapter to settle deferred_to_frontier", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const nowMs = 1788427906615;
    const nextEligibleAtMs = nowMs + 15_000;

    // 1. Ingress arrives and admits an owner utterance into cycle and inbox
    const ingress = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "synthetic-fixture-user", message: "Reflective inquiry on evolution" },
      { nowMs },
    );
    expect(ingress.accepted).toBe(true);

    const cycleId = ingress.cycleId;
    const conversationId = ingress.conversationId;
    const inboxEventId = ingress.inboxEventId;

    // Simulate Thought pass execution having transitioned cycle to thinking
    updateCycleState(sidecar, cycleId, "thinking", nowMs);

    // Verify initial state
    expect(getCycle(sidecar, cycleId)?.state).toBe("thinking");
    expect(getActiveDeferredFrontier(sidecar, conversationId)).toBeNull();

    // 2. Mock AgentManager returning the exact Campaign-1 deferred result
    const deferredResult: CognitiveDispatchResult = {
      cycleId,
      generation: ingress.generation,
      published: false,
      outboxId: null,
      infrastructureNotice: null,
      thoughtModelAttempts: 2,
      acceptedThoughtPasses: 1,
      composeCancelledAttempts: 0,
      acceptedSettlements: 0,
      deferred: true,
      nextEligibleAtMs,
      conversationId,
      latestEvidenceRowId: ingress.evidenceRowId,
    };

    const manager = {
      dispatchCognitiveEvent: vi.fn(async (_event: InboxEvent) => deferredResult),
    };

    // 3. Obtain the actual production adapter wired in serve.ts
    const handler = createAgentInboxConsumerHandler(manager);

    // 4. Consume the inbox event through the production consumer loop path
    const tickResult = await consumeNextInboxEvent(sidecar, {
      workerId: "agent-service:production-seam",
      handler,
      nowMs: () => nowMs,
    });

    expect(tickResult.outcome).toBe("consumed");
    expect(manager.dispatchCognitiveEvent).toHaveBeenCalledTimes(1);

    // 5. Verify mechanical settlement invariants:
    // a) durable attempt settles as deferred_to_frontier
    // b) cycle state transitions to capacity_wait
    const cycle = getCycle(sidecar, cycleId);
    expect(cycle?.state).toBe("capacity_wait");

    // c) deferred frontier is durably inserted
    const frontier = getActiveDeferredFrontier(sidecar, conversationId);
    expect(frontier).not.toBeNull();
    expect(frontier?.cycleId).toBe(cycleId);
    expect(frontier?.generation).toBe(ingress.generation);
    expect(frontier?.nextEligibleAtMs).toBe(nextEligibleAtMs);
    expect(frontier?.latestEvidenceRowId).toBe(ingress.evidenceRowId);

    // d) inbox event is NOT marked terminal_reason=completed
    const settledInbox = getInboxEvent(sidecar, inboxEventId);
    expect(settledInbox?.status).toBe("consumed");
    expect(settledInbox?.terminalReason).toBe("deferred_to_frontier");
    expect(settledInbox?.terminalReason).not.toBe("completed");

    sidecar.close();
    nuclear.close();
  });

  it("fails when the adapter is replaced with the original missing-return implementation", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const nowMs = 1788427906615;
    const nextEligibleAtMs = nowMs + 15_000;

    const ingress = admitCognitiveIngress(
      sidecar,
      nuclear,
      { userId: "synthetic-fixture-user", message: "Reflective inquiry on evolution" },
      { nowMs },
    );
    expect(ingress.accepted).toBe(true);

    const cycleId = ingress.cycleId;
    const conversationId = ingress.conversationId;
    const inboxEventId = ingress.inboxEventId;

    updateCycleState(sidecar, cycleId, "thinking", nowMs);

    const deferredResult: CognitiveDispatchResult = {
      cycleId,
      generation: ingress.generation,
      published: false,
      outboxId: null,
      infrastructureNotice: null,
      thoughtModelAttempts: 2,
      acceptedThoughtPasses: 1,
      composeCancelledAttempts: 0,
      acceptedSettlements: 0,
      deferred: true,
      nextEligibleAtMs,
      conversationId,
      latestEvidenceRowId: ingress.evidenceRowId,
    };

    const manager = {
      dispatchCognitiveEvent: vi.fn(async (_event: InboxEvent) => deferredResult),
    };

    // Original broken implementation from a0b8496:
    // handler: async (event) => { await manager.dispatchCognitiveEvent(event); }
    // which returns undefined (Promise<void>)
    const brokenOldHandler = (async (event: InboxEvent) => {
      await manager.dispatchCognitiveEvent(event);
    }) as unknown as InboxConsumerHandler;

    const tickResult = await consumeNextInboxEvent(sidecar, {
      workerId: "agent-service:production-seam",
      handler: brokenOldHandler,
      nowMs: () => nowMs,
    });

    expect(tickResult).toMatchObject({ outcome: "failed", error: "retry_wait" });

    // The missing-return defect is rejected fail-closed:
    // - cycle remains in thinking (never transitions to capacity_wait)
    expect(getCycle(sidecar, cycleId)?.state).toBe("thinking");
    expect(getCycle(sidecar, cycleId)?.state).not.toBe("capacity_wait");

    // - frontier is never created
    expect(getActiveDeferredFrontier(sidecar, conversationId)).toBeNull();

    // - inbox remains retryable and records the missing result
    const failedInbox = getInboxEvent(sidecar, inboxEventId);
    expect(failedInbox).toMatchObject({
      status: "failed_retryable",
      lastError: "cognitive_dispatch_result_missing",
    });
    expect(failedInbox?.status).not.toBe("consumed");
    expect(failedInbox?.terminalReason).not.toBe("completed");

    sidecar.close();
    nuclear.close();
  });
});
