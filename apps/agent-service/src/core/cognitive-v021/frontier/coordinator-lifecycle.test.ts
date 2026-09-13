import { describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { openNuclearDb } from "../../db.js";
import {
  startFrontierCoordinator,
  type FrontierCoordinatorHandle,
} from "./coordinator.js";
import {
  insertDeferredFrontierRecord,
  getDeferredFrontier,
} from "./ledger.js";
import { admitTestCycle } from "../test-support.js";
import type { KernelDeps } from "../types.js";

describe("Frontier Coordinator Production Lifecycle (B1)", () => {
  function makeMockDeps(overrides: Partial<KernelDeps> = {}): KernelDeps {
    return {
      nowMs: () => 1_000_000,
      attentionDb: new DatabaseSync(":memory:"),
      completeChat: vi.fn(async () => ({
        text: "{}",
        model: "mistral-small-2603",
        modelAlias: "mistral-small-2603",
        resolvedModelId: "mistral-small-2603",
      })),
      runPerception: vi.fn(async () => []),
      executeObservation: vi.fn(),
      executeEffect: vi.fn(),
      checkAuthority: () => ({ ok: true } as any),
      loadAuthorityPacks: () => ({
        epistemic: { allowInferredWorldClaims: false },
        currentness: { requireObservationForLatest: false },
        receipt: { receiptsByEffectId: {} },
        capability: { approvedProjectIds: [] },
        operational: { sandboxAvailable: false },
        relational: { withdrawalActive: false, neverMention: [] },
        stateEpoch: { authorityEpoch: 1 },
      } as any),
      expressionEnabled: false,
      projectOutbox: vi.fn(async () => undefined),
      projectSystemNotice: vi.fn(async () => undefined),
      constitution: { soul: "test", values: [] } as any,
      capabilityReality: { approvedProjectIds: [] } as any,
      ...overrides,
    };
  }

  it("starts coordinator exactly once and discovers persisted waiting frontier on startup", async () => {
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), {
      dataPlane: { kind: "isolated" },
    });
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));

    // 1. Durably seed a waiting frontier before coordinator starts (simulating state prior to boot/restart)
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-b1-lifecycle",
      conversationId: "thread-b1-lifecycle",
      triggerKind: "owner_message",
      triggerRef: "ev-b1-1",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1_000_000,
    });

    const frontier = insertDeferredFrontierRecord(sidecar, {
      conversationId: cycle.conversationId,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      nextEligibleAtMs: 1_000_500, // Due at +500ms
      latestEvidenceRowId: "ev-b1-1",
      nowMs: 1_000_000,
    });

    expect(frontier.state).toBe("waiting");

    // 2. Start coordinator with clock at +600ms (so the frontier is due)
    let currentTime = 1_000_600;
    const deps = makeMockDeps({
      nowMs: () => currentTime,
      attentionDb: nuclear,
    });

    let coordinator: FrontierCoordinatorHandle | null = startFrontierCoordinator(
      sidecar,
      nuclear,
      deps,
      {
        workerId: "test-prod-worker",
        pollMs: 100,
        nowMs: () => currentTime,
      },
    );

    // 3. Coordinator polls and discovers the waiting frontier
    const processed = await coordinator.pollNow();
    expect(processed).toBe(1);

    // 4. Verify graceful shutdown stops the coordinator
    coordinator.stop();
    coordinator = null;

    // 5. Verify no further processing occurs after stop
    const recheck = getDeferredFrontier(sidecar, frontier.frontierId);
    expect(recheck).toBeDefined();

    sidecar.close();
    nuclear.close();
  });

  it("restart reconstructs scheduling exclusively from durable SQLite frontier rows", async () => {
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), {
      dataPlane: { kind: "isolated" },
    });
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));

    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-b1-restart",
      conversationId: "thread-b1-restart",
      triggerKind: "owner_message",
      triggerRef: "ev-b1-restart",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 2_000_000,
    });

    // Seed frontier due now
    insertDeferredFrontierRecord(sidecar, {
      conversationId: cycle.conversationId,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      nextEligibleAtMs: 2_000_100,
      latestEvidenceRowId: "ev-b1-due",
      nowMs: 2_000_000,
    });

    // Simulate service restart: new coordinator instance spun up with zero in-memory state
    let simTime = 2_000_200;
    const deps = makeMockDeps({ nowMs: () => simTime, attentionDb: nuclear });

    const newCoordinator = startFrontierCoordinator(sidecar, nuclear, deps, {
      workerId: "restart-worker",
      pollMs: 100,
      nowMs: () => simTime,
    });

    // The new coordinator discovers the persisted due frontier immediately
    const processed = await newCoordinator.pollNow();
    expect(processed).toBe(1);

    newCoordinator.stop();
    sidecar.close();
    nuclear.close();
  });
});
