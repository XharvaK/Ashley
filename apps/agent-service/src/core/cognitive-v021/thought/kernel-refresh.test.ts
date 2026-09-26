
import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { runCognitiveCycle } from "./run.js";
import { getCapabilityReality } from "./capability-reality.js";
import { currentBuildIdentity, currentContractId, currentReleaseId } from "../../rollout/capabilities.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const initialReality: CapabilityReality = {
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
      receipt: { receiptsByEffectId: {} }, capability: initialReality,
      operational: { sandboxAvailable: false }, relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality: initialReality,
    ...overrides,
  };
}

describe("per-invocation capability orientation refresh", () => {
  it("shows the changed capability release row on the next Thought invocation in the same cycle", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-capability-refresh";
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-capability-refresh",
      conversationId,
      triggerKind: "owner_message",
      triggerRef: "owner-capability-refresh",
      occupantId: "owner-refresh",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId,
      text: "inspect the current project",
      discordMessageIds: ["capability-refresh-message"],
      nowMs: 2,
      speakerPrincipalId: "owner-refresh",
      speakerKind: "owner",
      audienceAtCapture: "owner_private",
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId,
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerId: "owner-refresh",
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    const releaseId = currentReleaseId();
    nuclear.prepare(
      `INSERT INTO capability_releases
         (capability, release_id, state, updated_at, contract_id, build_identity, model_epoch)
       VALUES ('vision', ?, 'active', 'before-refresh', ?, ?, 0)
       ON CONFLICT(capability,release_id) DO UPDATE SET state='active', updated_at='before-refresh'`,
    ).run(releaseId, currentContractId(), currentBuildIdentity());

    let calls = 0;
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => {
      calls += 1;
      const output = calls === 1
        ? {
            kind: "observation_intent",
            operationKind: "project.inspect",
            request: { projectId: "project-ashley", locator: { kind: "file", path: "README.md" } },
            purpose: "inspect the current project",
            evidenceNeed: "the current project file",
            existingRefs: [evidence.rowId],
          }
        : makeSemanticSettlement();
      return { text: JSON.stringify(output), model: "fake", modelAlias: "thought", resolvedModelId: null };
    });
    const executeObservation = vi.fn(async (): Promise<Observation> => {
      nuclear.prepare(
        "UPDATE capability_releases SET state='disabled', updated_at='after-refresh' WHERE capability='vision' AND release_id=?",
      ).run(releaseId);
      return {
        observationId: "capability-refresh-observation",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        derived: false,
        replaySafe: true,
        modality: "tool",
        payload: { result: "read-only observation" },
        provenance: "test:project-inspect",
        dataClassification: "never_public",
        secretOmitted: false,
      };
    });
    const refreshCapabilityReality = vi.fn(() => getCapabilityReality(nuclear));
    const kernelDependencies = {
      ...deps({ attentionDb, completeChat, executeObservation }),
      refreshCapabilityReality,
    } as KernelDeps;

    try {
      const result = await runCognitiveCycle(sidecar, nuclear, event, kernelDependencies);
      expect(result.published).toBe(true);
      expect(completeChat).toHaveBeenCalledTimes(2);
      expect(refreshCapabilityReality).toHaveBeenCalledTimes(2);

      const modelInputs = completeChat.mock.calls.map(([messages]) => {
        const list = messages as unknown as Array<{ content?: unknown }>;
        return JSON.parse(String(list[1]?.content ?? "{}")) as Record<string, unknown>;
      });
      const firstReality = (modelInputs[0]?.orientationKernel as {
        capabilityReality?: { asOf?: { releaseRows?: Array<{ capability: string; state: string; updatedAt: string }> } };
      } | undefined)?.capabilityReality;
      const secondReality = (modelInputs[1]?.orientationKernel as {
        capabilityReality?: { asOf?: { releaseRows?: Array<{ capability: string; state: string; updatedAt: string }> } };
      } | undefined)?.capabilityReality;
      expect(firstReality?.asOf?.releaseRows).toContainEqual(expect.objectContaining({
        capability: "vision", state: "active", updatedAt: "before-refresh",
      }));
      expect(secondReality?.asOf?.releaseRows).toContainEqual(expect.objectContaining({
        capability: "vision", state: "disabled", updatedAt: "after-refresh",
      }));
      expect(modelInputs[1]).toMatchObject({
        wakeCauses: [{ sourceKind: "inbox", triggerRef: expect.any(String), purpose: null, purposeStatus: "absent" }],
        previousInvocationDelta: "unknown",
        thoughtLegDeadlineAtMs: expect.any(Number),
      });
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });
});
