
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { runCognitiveCycle } from "./run.js";
import { getCapabilityReality } from "./capability-reality.js";
import { currentBuildIdentity, currentContractId, currentReleaseId } from "../../rollout/capabilities.js";
import { env } from "../../../env.js";


const originalOwnerId = env.discordOwnerId;
beforeAll(() => {
  env.discordOwnerId = "owner-currentness";
});
afterAll(() => {
  env.discordOwnerId = originalOwnerId;
});

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
      occupantId: "owner-currentness",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId,
      text: "inspect the current project",
      discordMessageIds: ["capability-refresh-message"],
      nowMs: 2,
      speakerPrincipalId: "owner-currentness",
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
        ownerId: "owner-currentness",
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
        thoughtLegDeadlineAtMs: expect.any(Number),
      });
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });
});

function realityWith(overrides: Partial<CapabilityReality>): CapabilityReality {
  return { ...initialReality, ...overrides };
}

type AttachmentGateInput = Parameters<NonNullable<KernelDeps["resolveAttachmentObservations"]>>[0];

function attachmentOwnerCycle(
  sidecar: ReturnType<typeof openTestSidecar>,
  conversationId: string,
  suffix: string,
  nowMs: number,
) {
  const cycle = admitTestCycle(sidecar, {
    conversationId,
    triggerKind: "owner_message",
    triggerRef: `owner-currentness-${suffix}`,
    occupantId: "owner-currentness",
    authorityEpoch: 1,
    nowMs,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId,
    text: "read the attached note",
    discordMessageIds: [`currentness-${suffix}-message`],
    nowMs,
    speakerPrincipalId: "owner-currentness",
    speakerKind: "owner",
    audienceAtCapture: "owner_private",
  });
  const event = appendInboxEvent(sidecar, {
    wakeId: cycle.wakeId,
    conversationId,
    kind: "owner_utterance",
    payload: {
      cycleId: cycle.cycleId,
      evidenceRowId: evidence.rowId,
      ownerId: "owner-currentness",
      ownerMessage: evidence.text,
      attachments: [{
        discordAttachmentId: `currentness-${suffix}-attachment`,
        declaredMime: "text/plain",
        fileName: "note.txt",
        sourceUrl: "https://cdn.example.test/note.txt",
      }],
    },
    createdAtMs: nowMs,
  });
  return { cycle, event, evidence };
}

describe("R-1 capability currentness: one mechanical truth for the kernel and the attachment gate", () => {
  it("gives the attachment-resolution gate the refreshed per-invocation reality, not the process-start reality", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-r1-gate-refreshed";
    const { event } = attachmentOwnerCycle(sidecar, conversationId, "gate", 2);
    const staleProcessStart = realityWith({ attachmentText: false, vision: false });
    const gateInputs: AttachmentGateInput[] = [];
    const resolveAttachmentObservations = vi.fn(async (input: AttachmentGateInput) => {
      gateInputs.push(input);
      return [];
    });
    const refreshCapabilityReality = vi.fn(() => realityWith({ attachmentText: true, vision: true }));
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
    }));
    const kernelDependencies = {
      ...deps({ attentionDb, completeChat, resolveAttachmentObservations }),
      capabilityReality: staleProcessStart,
      refreshCapabilityReality,
    } as KernelDeps;

    try {
      const result = await runCognitiveCycle(sidecar, nuclear, event, kernelDependencies);
      expect(result.published).toBe(true);
      expect(resolveAttachmentObservations).toHaveBeenCalledTimes(1);
      expect(gateInputs[0]?.attachmentTextEnabled).toBe(true);
      expect(Boolean(gateInputs[0]?.visionAccess)).toBe(true);
      expect(refreshCapabilityReality).toHaveBeenCalled();
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("lets the process-start reality win only when the host supplies no refresh seam", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-r1-gate-fallback";
    const { event } = attachmentOwnerCycle(sidecar, conversationId, "fallback", 2);
    const gateInputs: AttachmentGateInput[] = [];
    const resolveAttachmentObservations = vi.fn(async (input: AttachmentGateInput) => {
      gateInputs.push(input);
      return [];
    });
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
    }));
    const kernelDependencies = {
      ...deps({ attentionDb, completeChat, resolveAttachmentObservations }),
      capabilityReality: realityWith({ attachmentText: false, vision: false }),
      refreshCapabilityReality: undefined,
    } as KernelDeps;

    try {
      const result = await runCognitiveCycle(sidecar, nuclear, event, kernelDependencies);
      expect(result.published).toBe(true);
      expect(gateInputs[0]?.attachmentTextEnabled).toBe(false);
      expect(Boolean(gateInputs[0]?.visionAccess)).toBe(false);
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("shows invocation B the changed capability truth at both the kernel and the attachment gate", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const staleProcessStart = realityWith({ attachmentText: false, vision: false });
    let live = false;
    const gateInputs: AttachmentGateInput[] = [];
    const resolveAttachmentObservations = vi.fn(async (input: AttachmentGateInput) => {
      gateInputs.push(input);
      return [];
    });
    const refreshCapabilityReality = vi.fn(() => realityWith({
      attachmentText: live,
      vision: live,
      conversationalRead: live,
      webSearch: live,
    }));
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
    }));
    const kernelDependencies = {
      ...deps({ attentionDb, completeChat, resolveAttachmentObservations }),
      capabilityReality: staleProcessStart,
      refreshCapabilityReality,
    } as KernelDeps;

    try {
      const invocationA = attachmentOwnerCycle(sidecar, "thread-r1-ab", "invocation-a", 2);
      const resultA = await runCognitiveCycle(sidecar, nuclear, invocationA.event, kernelDependencies);
      expect(resultA.published).toBe(true);
      expect(gateInputs[0]?.attachmentTextEnabled).toBe(false);
      expect(Boolean(gateInputs[0]?.visionAccess)).toBe(false);

      live = true;

      const invocationB = attachmentOwnerCycle(sidecar, "thread-r1-ab", "invocation-b", 3);
      const resultB = await runCognitiveCycle(sidecar, nuclear, invocationB.event, kernelDependencies);
      expect(resultB.published).toBe(true);
      expect(gateInputs[1]?.attachmentTextEnabled).toBe(true);
      expect(Boolean(gateInputs[1]?.visionAccess)).toBe(true);

      expect(staleProcessStart.attachmentText).toBe(false);
      expect(staleProcessStart.vision).toBe(false);
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("keeps dispatch-time authority revalidation independent of capability currentness", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-r1-authority-independent";
    const cycle = admitTestCycle(sidecar, {
      conversationId,
      triggerKind: "owner_message",
      triggerRef: "owner-r1-authority",
      occupantId: "owner-currentness",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId,
      text: "inspect the current project",
      discordMessageIds: ["r1-authority-message"],
      nowMs: 2,
      speakerPrincipalId: "owner-currentness",
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
        ownerId: "owner-currentness",
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
      text: JSON.stringify({
        kind: "observation_intent",
        operationKind: "project.inspect",
        request: { projectId: "project-ashley", locator: { kind: "file", path: "README.md" } },
        purpose: "inspect the current project",
        evidenceNeed: "the current project file",
        existingRefs: [evidence.rowId],
      }),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
    }));
    const executeObservation = vi.fn();
    const checkAuthority = vi.fn(() => ({ ok: false, codes: ["capability_not_released"] as never[] }));
    const kernelDependencies = {
      ...deps({
        attentionDb,
        completeChat,
        executeObservation,
        checkAuthority: checkAuthority as unknown as KernelDeps["checkAuthority"],
      }),
      // Capability currentness says the operation is available.
      capabilityReality: realityWith({ canOfferProjectInspection: true }),
      refreshCapabilityReality: () => realityWith({
        canOfferProjectInspection: true,
        canOfferVerification: true,
      }),
    } as KernelDeps;

    try {
      await runCognitiveCycle(sidecar, nuclear, event, kernelDependencies);
      expect(checkAuthority).toHaveBeenCalled();
      expect(executeObservation).not.toHaveBeenCalled();
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });
});
