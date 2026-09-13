import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { admitTestCycle, openTestSidecar } from "../../test-support.js";
import { appendInboxEvent } from "../../cycle/inbox.js";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import type { Observation, KernelDeps } from "../../types.js";
import { runCognitiveCycle } from "../run.js";

describe("Observation Persistence Identity & Reinjection", () => {
  it("persists observation with active cycle_id and generation and reinjects into next Thought pass", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = new DatabaseSync(":memory:");

    const activeCycleId = "cycle-obs-identity-42";
    const activeGeneration = 1;
    const occupantId = "doc";

    const cycle = admitTestCycle(sidecar, {
      cycleId: activeCycleId,
      conversationId: "thread-obs-test",
      generation: activeGeneration,
      triggerKind: "owner_message",
      triggerRef: "owner-ref-42",
      occupantId,
      nowMs: 100,
    });

    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: "thread-obs-test",
      text: "please inspect the system configuration",
      discordMessageIds: ["d-obs-1"],
      nowMs: 105,
    });

    const event = appendInboxEvent(sidecar, {
      conversationId: "thread-obs-test",
      kind: "owner_message",
      payload: {
        cycleId: activeCycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
    });

    let passCount = 0;
    let pass2Messages: unknown = null;

    const completeChat = vi.fn(async (messages: unknown, options?: any) => {
      passCount++;
      if (passCount === 1) {
        // Pass 1: Thought requests an observation
        return {
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.read_file",
            request: { path: "config.json" },
            purpose: "inspect the system configuration",
            evidenceNeed: "the current configuration contents",
            existingRefs: ["owner-ref-42"],
          }),
          model: "fake",
          modelAlias: "fake",
          resolvedModelId: null,
        };
      }

      // Pass 2: Captures reinjected messages
      pass2Messages = messages;
      // Return cancellation or failure to complete loop cleanly
      throw Object.assign(new Error("cycle_finished_after_reinjection_check"), { name: "AbortError" });
    });

    const targetObservationId = "obs-identity-target-999";
    const observed: Observation = {
      observationId: targetObservationId,
      cycleId: activeCycleId,
      generation: activeGeneration,
      derived: false,
      replaySafe: true,
      modality: "text",
      payload: { content: "target configuration verified payload" },
      provenance: "project.read_file",
      dataClassification: "ordinary",
      secretOmitted: false,
    };

    const executeObservation = vi.fn(async () => observed);

    const deps: KernelDeps = {
      nowMs: () => 150,
      attentionDb,
      completeChat,
      runPerception: vi.fn(async () => []),
      executeObservation,
      executeEffect: vi.fn(),
      checkAuthority: () => ({ ok: true as const }),
      loadAuthorityPacks: () => ({
        epistemic: { allowInferredWorldClaims: false },
        currentness: { requireObservationForLatest: true },
        receipt: { receiptsByEffectId: {} },
        capability: {
          vision: false,
          attachmentText: false,
          conversationalRead: false,
          webSearch: false,
          canOfferProjectInspection: true,
          canOfferWorkspace: false,
          canOfferVerification: false,
          canOfferAuthorship: false,
          canOfferBoundedOperation: false,
          canOfferPatchExport: false,
          approvedProjectIds: [],
        },
        operational: { sandboxAvailable: false },
        relational: { withdrawalActive: false, neverMention: [] },
        stateEpoch: { authorityEpoch: 1 },
      }),
      expressionEnabled: false,
      projectOutbox: vi.fn(async () => undefined),
      constitution: { constitutional: ["truth first"], stableSelf: [] },
      capabilityReality: {
        vision: false,
        attachmentText: false,
        conversationalRead: false,
        webSearch: false,
        canOfferProjectInspection: true,
        canOfferWorkspace: false,
        canOfferVerification: false,
        canOfferAuthorship: false,
        canOfferBoundedOperation: false,
        canOfferPatchExport: false,
        approvedProjectIds: [],
      },
    };

    try {
      await runCognitiveCycle(sidecar, attentionDb, event, deps);

      // 1. Assert executeObservation was invoked
      expect(executeObservation).toHaveBeenCalledTimes(1);

      // 2. Query SQLite table directly to verify active cycle and generation identity persisted
      const row = sidecar.prepare(`
        SELECT observation_id, cycle_id, generation, data_classification, provenance
        FROM observations
        WHERE observation_id = ?
      `).get(targetObservationId) as {
        observation_id: string;
        cycle_id: string;
        generation: number;
        data_classification: string;
        provenance: string;
      };

      expect(row).toBeDefined();
      expect(row.observation_id).toBe(targetObservationId);
      expect(row.cycle_id).toBe(activeCycleId);
      expect(row.generation).toBe(activeGeneration);
      expect(row.data_classification).toBe("ordinary");
      expect(row.provenance).toBe("project.read_file");

      // 3. Assert Pass 2 received the reinjected observation in its messages
      expect(passCount).toBe(2);
      expect(pass2Messages).toBeDefined();
      const messagesStr = JSON.stringify(pass2Messages);
      expect(messagesStr).toContain(targetObservationId);
      expect(messagesStr).toContain("target configuration verified payload");
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });
});
