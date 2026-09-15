import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../../errors.js";
import {
  appendInboxEvent,
  basisFromEvidenceRows,
  getCycleFreshnessState,
  getInboxEvent,
  initializeAttemptInputBasis,
} from "../cycle/inbox.js";
import { appendExternalUtteranceInTransaction, appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitExternalBatch, admitExternalCapture, type ExternalCaptureBody } from "../ingress/http.js";
import { applyWorkingContextDelta } from "../evidence/working-context.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation, ThoughtInput } from "../types.js";
import { makeSemanticSettlement } from "../test-support.js";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../../db.js";
import { issueLicense, upsertTrustedRoom } from "../../relationship/social-authority.js";
import { promoteEligibleRoomPending } from "../social/room-activation.js";
import { validateThoughtSettlementDraft } from "../settlement/validate.js";
import { parseThoughtSemanticOutput } from "./parse.js";
import { getThoughtAttemptCounters } from "./counters.js";
import { computeDispatchMessagesHash } from "./projection.js";
import { initObservabilitySchema, openObservabilityStore } from "./diagnostics.js";
import { THOUGHT_UNAVAILABLE_NOTICE } from "../speech/infrastructure-notice.js";
import {
  createThoughtCycleTokenMetrics,
  executionProvenanceFromMetadata,
  materializeEffectsCompleted,
  observeThoughtCycleInput,
  ownerRoomDestinationFor,
  runCognitiveCycle,
} from "./run.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function roomCapture(messageId: string, message: string): ExternalCaptureBody {
  return {
    envelope: {
      speakerPrincipalId: "room-human-1",
      speakerKind: "external_human",
      location: { kind: "room", guildId: "mixed-guild", channelId: "mixed-channel" },
      audienceAtCapture: "unknown",
      sentAtMs: 1_000,
      discordMessageId: messageId,
      mentionIds: [],
      attachmentRefs: [],
      provenance: { source: "discord", receivedAtMs: 1_000 },
    },
    message,
    discordMessageId: messageId,
    attachments: [],
    gateHint: "allow_social",
    conversationKey: "room:mixed-guild:mixed-channel",
  };
}

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

describe("v0.2.1 Thought run", () => {
  it("binds authenticated Owner room context to a room destination without externalizing the cycle", () => {
    const destination = ownerRoomDestinationFor(
      "room:guild-1:channel-1",
      {
        ownerId: "doc",
        ownerRoomContext: { guildId: "guild-1", channelId: "channel-1" },
      },
      { role: "owner", speakerKind: "owner", speakerPrincipalId: "doc" },
    );
    expect(destination).toEqual({
      kind: "room",
      roomId: "room:guild-1:channel-1",
      guildId: "guild-1",
      channelId: "channel-1",
      ownerRoom: true,
    });
    expect(ownerRoomDestinationFor(
      "room:guild-1:channel-1",
      { ownerId: "doc", ownerRoomContext: { guildId: "guild-1", channelId: "channel-1" } },
      { role: "owner", speakerKind: "external_human", speakerPrincipalId: "doc" },
    )).toBeNull();
    expect(ownerRoomDestinationFor(
      "room:other-guild:channel-1",
      { ownerId: "doc", ownerRoomContext: { guildId: "guild-1", channelId: "channel-1" } },
      { role: "owner", speakerKind: "owner", speakerPrincipalId: "doc" },
    )).toBeNull();
  });

  it("keeps an Owner room cycle eligible for the existing Owner operation path", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const roomId = "room:owner-guild:owner-channel";
    const cycle = admitTestCycle(sidecar, {
      conversationId: roomId,
      triggerKind: "owner_message",
      triggerRef: "owner-room-operation",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: roomId,
      text: "inspect the current project",
      discordMessageIds: ["owner-room-operation-message"],
      nowMs: 2,
      speakerPrincipalId: "doc",
      speakerKind: "owner",
      location: { kind: "room", guildId: "owner-guild", channelId: "owner-channel" },
      audienceAtCapture: "room",
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: roomId,
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerId: "doc",
        ownerMessage: evidence.text,
        ownerRoomContext: { guildId: "owner-guild", channelId: "owner-channel" },
      },
      createdAtMs: 2,
    });
    let calls = 0;
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => {
      calls += 1;
      const output = calls === 1
        ? {
            kind: "observation_intent",
            operationKind: "project.read_file",
            request: { path: "README.md" },
            purpose: "inspect the current project",
            evidenceNeed: "the current project file",
            existingRefs: [evidence.rowId],
          }
        : makeSemanticSettlement();
      return { text: JSON.stringify(output), model: "fake", modelAlias: "thought", resolvedModelId: null };
    });
    const executeObservation = vi.fn(async () => ({
      observationId: "owner-room-observation",
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      derived: false,
      replaySafe: true,
      modality: "text" as const,
      payload: { text: "README observed" },
      provenance: "owner-room-test",
      dataClassification: "ordinary" as const,
      secretOmitted: false,
    }));
    try {
      const result = await runCognitiveCycle(sidecar, nuclear, event, deps({
        attentionDb,
        completeChat,
        executeObservation,
      }));
      expect(result.published).toBe(true);
      expect(executeObservation).toHaveBeenCalledTimes(1);
      expect(result.infrastructureNotice).toBeNull();
      const thoughtMessages = completeChat.mock.calls[0]?.[0] as Array<{ content?: unknown }> | undefined;
      const projectedInput = JSON.parse(String(thoughtMessages?.[1]?.content ?? "{}")) as {
        availableDestinations?: Array<{ audience?: { kind?: string; threadId?: string } }>;
      };
      expect(projectedInput.availableDestinations).toEqual(expect.arrayContaining([
        expect.objectContaining({ audience: expect.objectContaining({ kind: "owner_dm" }) }),
      ]));
      const outbox = sidecar.prepare("SELECT delivery_intent_json FROM speech_outbox").get() as { delivery_intent_json: string };
      expect(JSON.parse(outbox.delivery_intent_json).destination).toEqual({
        kind: "room",
        roomId,
        guildId: "owner-guild",
        channelId: "owner-channel",
        ownerRoom: true,
      });
    } finally {
      sidecar.close();
      attentionDb.close();
      nuclear.close();
    }
  });

  it("binds external room freshness when a current Owner room cycle absorbs a participant", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const ownerId = "doc";
    const roomId = "room:mixed-guild:mixed-channel";
    const nowMs = 1_000;
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-mixed-owner-external-room",
      conversationId: roomId,
      triggerKind: "owner_message",
      triggerRef: "owner-room-mixed-origin",
      occupantId: ownerId,
      authorityEpoch: 1,
      nowMs,
    });
    upsertTrustedRoom(nuclear, {
      ownerId,
      guildId: "mixed-guild",
      channelId: "mixed-channel",
      mode: "trusted_social",
      provenance: "explicit_config",
      addedBy: ownerId,
      sourceSpan: { source: "mixed-origin-test" },
      nowMs,
    });
    issueLicense(nuclear, {
      ownerId,
      materialHash: "mixed-room-material",
      sourcePrincipal: "room-human-1",
      controlledProtections: { kind: "mixed-origin-test" },
      granteeAudience: { kind: "room", roomId },
      usesAllowed: 3,
      grantRef: "mixed-origin-room-grant",
      nowMs,
    });
    const previousEnv = new Map<string, string | undefined>([
      ["RA_ROOM_SEED_ACTIVE", process.env.RA_ROOM_SEED_ACTIVE],
      ["RA_ROOM_PUBLICATION", process.env.RA_ROOM_PUBLICATION],
    ]);
    process.env.RA_ROOM_SEED_ACTIVE = "true";
    process.env.RA_ROOM_PUBLICATION = "mixed-channel";

    try {
      const firstCapture = admitExternalCapture(sidecar, nuclear, roomCapture("mixed-room-1", "first participant message"), { nowMs });
      expect(admitExternalBatch(sidecar, nuclear, {
        captureRefs: [firstCapture.captureRef],
        conversationKey: roomId,
      }, { nowMs, ownerId, roomSeedActive: true }).results[0]?.disposition)
        .toBe("external_eligible_pending");
      const firstPromotion = promoteEligibleRoomPending(sidecar, nuclear, {
        nowMs,
        ownerId,
        env: { RA_ROOM_SEED_ACTIVE: "true", RA_ROOM_PUBLICATION: "mixed-channel" },
      });
      expect(firstPromotion).toMatchObject({ promoted: 1, rejected: 0 });
      expect(firstPromotion.cycleIds).toEqual([cycle.cycleId]);
      const firstEvent = getInboxEvent(sidecar, firstPromotion.eventIds[0]!);
      expect(firstEvent?.kind).toBe("external_utterance");
      expect(firstEvent?.conversationId).toBe(roomId);
      expect(getCycleFreshnessState(sidecar, cycle.cycleId)).toMatchObject({
        attemptId: `attempt:${cycle.cycleId}:1`,
        attemptInputBasis: expect.objectContaining({ orderedRefs: expect.any(Array) }),
      });

      const secondCapture = admitExternalCapture(sidecar, nuclear, roomCapture("mixed-room-2", "second participant message"), { nowMs: nowMs + 1 });
      expect(admitExternalBatch(sidecar, nuclear, {
        captureRefs: [secondCapture.captureRef],
        conversationKey: roomId,
      }, { nowMs: nowMs + 1, ownerId, roomSeedActive: true }).results[0]?.disposition)
        .toBe("external_eligible_pending");

      let secondPromotion: ReturnType<typeof promoteEligibleRoomPending> | undefined;
      const completeChat = vi.fn(async () => {
        secondPromotion = promoteEligibleRoomPending(sidecar, nuclear, {
          nowMs: nowMs + 2,
          ownerId,
          env: { RA_ROOM_SEED_ACTIVE: "true", RA_ROOM_PUBLICATION: "mixed-channel" },
        });
        return {
          text: JSON.stringify(makeSemanticSettlement({
            interactionIntent: "continue",
            speech: { mode: "draft", surfaceDraft: "room response" },
          })),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      });
      const result = await runCognitiveCycle(
        sidecar,
        nuclear,
        firstEvent!,
        deps({ completeChat }),
      );

      expect(secondPromotion).toMatchObject({ promoted: 1, rejected: 0 });
      expect(getCycleFreshnessState(sidecar, cycle.cycleId).attemptId)
        .toBe(`attempt:${cycle.cycleId}:2`);
      expect(completeChat).toHaveBeenCalledTimes(1);
      expect(result.published).toBe(false);
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements WHERE cycle_id = ?").get(cycle.cycleId))
        .toMatchObject({ count: 0 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox WHERE cycle_id = ?").get(cycle.cycleId))
        .toMatchObject({ count: 0 });
    } finally {
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      nuclear.close();
      sidecar.close();
    }
  });

  it("fails closed on a legacy periodic event without an observation binding and does not reacquire", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-periodic-legacy-binding",
      conversationId: "thread-periodic-legacy-binding",
      triggerKind: "idle_opportunity",
      triggerRef: "periodic-legacy-binding",
      occupantId: "private",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const event = appendInboxEvent(sidecar, {
      id: "periodic:legacy-binding",
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "idle_opportunity",
      payload: {
        cycleId: cycle.cycleId,
        periodicScheduleOccurrenceId: "periodic-occurrence:legacy-binding",
        privateBudgetReservationId: "missing-reservation-is-not-reached",
      },
      createdAtMs: 2,
    });
    const completeChat = vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null }));
    const runPerception = vi.fn(async (): Promise<Observation[]> => []);
    try {
      await expect(runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat, runPerception })))
        .rejects.toThrow("observation_binding_unknown:legacy_observation_binding_missing");
      expect(runPerception).not.toHaveBeenCalled();
      expect(completeChat).not.toHaveBeenCalled();
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it.each(["observation_intent", "effect_intent"] as const)(
    "does not dispatch an external %s even when generic authority checks pass",
    async (kind) => {
      const sidecar = openTestSidecar();
      const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
      const conversationId = "dm:ashley:external-operation";
      const principalId = "external-principal";
      const cycle = admitTestCycle(sidecar, {
        cycleId: `cycle-external-${kind}`,
        conversationId,
        triggerKind: "external_message",
        triggerRef: `external-${kind}`,
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });

      sidecar.exec("BEGIN IMMEDIATE");
      const { evidence } = appendExternalUtteranceInTransaction(sidecar, {
        conversationId,
        text: "perform an instrumental operation",
        discordMessageIds: [`discord-${kind}`],
        nowMs: 2,
        speakerPrincipalId: principalId,
        speakerKind: "external_human",
        location: { kind: "external_dm", principalId, channelId: "dm-channel" },
        audienceAtCapture: "dm",
        sentAtMs: 2,
        mentionIds: [],
        attachmentRefs: [],
        provenance: { source: "discord", receivedAtMs: 2 },
      });
      sidecar.exec("COMMIT");
      initializeAttemptInputBasis(sidecar, {
        cycleId: cycle.cycleId,
        basis: basisFromEvidenceRows(sidecar, [evidence.rowId]),
        nowMs: 3,
      });

      const event = appendInboxEvent(sidecar, {
        id: `external-operation-${kind}`,
        wakeId: cycle.wakeId,
        conversationId,
        kind: "external_utterance",
        payload: {
          cycleId: cycle.cycleId,
          evidenceRowId: evidence.rowId,
          ownerMessage: evidence.text,
          externalDestination: { kind: "external_dm", principalId, channelId: "dm-channel" },
        },
        createdAtMs: 3,
      });
      const completeChat = vi.fn(async () => ({
        text: JSON.stringify(kind === "observation_intent"
          ? {
            kind,
            operationKind: "project.read_file",
            request: { path: "README.md" },
            purpose: "inspect the workspace",
            evidenceNeed: "the file contents",
            existingRefs: [evidence.rowId],
          }
          : {
            kind,
            operationKind: "workspace.write_file",
            request: { projectId: "project-ashley", path: "blocked.txt" },
            purpose: "write the workspace",
            expectedOutcome: "the file is written",
            existingRefs: [evidence.rowId],
          }),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      }));
      const executeObservation = vi.fn();
      const executeEffect = vi.fn();

      try {
        const result = await runCognitiveCycle(
          sidecar,
          nuclear,
          event,
          deps({ attentionDb: nuclear, completeChat, executeObservation, executeEffect }),
        );

        expect(result.published).toBe(false);
        expect(result.infrastructureNotice).toBe(
          `${THOUGHT_UNAVAILABLE_NOTICE} Error code: AUTHORITY_REJECTED`,
        );
        expect(executeObservation).not.toHaveBeenCalled();
        expect(executeEffect).not.toHaveBeenCalled();
      } finally {
        sidecar.close();
        nuclear.close();
      }
    },
  );

  it("projects physical execution truth only from the canonical Model Fabric receipt", () => {
    const attempted = executionProvenanceFromMetadata({
      receipt: {
        receiptStage: "resolved",
        attempts: [{ dispatchTruth: "sent_outcome_unknown", providerRequestCount: 1 }],
      } as any,
    } as any);
    const responded = executionProvenanceFromMetadata({
      receipt: {
        receiptStage: "resolved",
        attempts: [{ dispatchTruth: "response_received", providerRequestCount: 1 }],
      } as any,
    } as any);
    const notSent = executionProvenanceFromMetadata({
      receipt: {
        receiptStage: "resolved",
        attempts: [{ dispatchTruth: "not_sent", providerRequestCount: 0 }],
      } as any,
    } as any);
    const multipleAttempts = executionProvenanceFromMetadata({
      receipt: {
        receiptStage: "resolved",
        attempts: [
          { dispatchTruth: "not_sent", providerRequestCount: 0 },
          { dispatchTruth: "response_received", providerRequestCount: 1 },
        ],
      } as any,
    } as any);
    const mixedUnknown = executionProvenanceFromMetadata({
      receipt: {
        receiptStage: "resolved",
        attempts: [
          { dispatchTruth: "sent_outcome_unknown", providerRequestCount: 1 },
          { dispatchTruth: "not_sent", providerRequestCount: 0 },
        ],
      } as any,
    } as any);

    expect(attempted).toEqual({ dispatchTruth: "unknown", providerAttempts: 1 });
    expect(responded).toEqual({ dispatchTruth: "sent", providerAttempts: 1 });
    expect(notSent).toEqual({ dispatchTruth: "not_sent", providerAttempts: 0 });
    expect(multipleAttempts).toEqual({ dispatchTruth: "sent", providerAttempts: 1 });
    expect(mixedUnknown).toEqual({ dispatchTruth: "unknown", providerAttempts: 1 });
  });

  it("preserves a known response receipt across a later internal exception", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-known-response-internal-error",
      conversationId: "thread-known-response-internal-error",
      triggerKind: "owner_message",
      triggerRef: "owner-known-response-internal-error",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: "preserve the response receipt",
      discordMessageIds: ["known-response-internal-error-message"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
      capturedAttemptIdentity: { allocationId: -1 },
      modelFabric: {
        receipt: {
          receiptStage: "resolved",
          attempts: [{ dispatchTruth: "response_received", providerRequestCount: 1 }],
        },
      },
    } as any));

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
      }));

      expect(result).toMatchObject({
        published: false,
        thoughtExecutionProvenance: { dispatchTruth: "sent", providerAttempts: 1 },
      });
      expect(completeChat).toHaveBeenCalledTimes(1);
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it.each(["corrected", "still_invalid", "deadline"] as const)(
    "revises the live operational effectRef incident with one shared deadline: %s",
    async (outcome) => {
      const sidecar = openTestSidecar();
      const attentionDb = openTestSidecar();
      const cycle = admitTestCycle(sidecar, {
        conversationId: "effect-ref-incident", triggerKind: "owner_message",
        triggerRef: "owner-incident", occupantId: "doc", authorityEpoch: 1, nowMs: 1,
      });
      const evidence = appendOwnerUtterance(sidecar, {
        conversationId: cycle.conversationId, text: "How are you?",
        discordMessageIds: ["incident-message"], nowMs: 2,
      });
      const event = appendInboxEvent(sidecar, {
        wakeId: cycle.wakeId, conversationId: cycle.conversationId, kind: "owner_message",
        payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
        createdAtMs: 2,
      });
      const bad = makeSemanticSettlement();
      bad.commitments.operational = [{ effectRef: "none", claimedState: "not_attempted" }];
      const corrected = makeSemanticSettlement({
        speech: { ...bad.speech, surfaceDraft: "model-authored correction", mustSay: [], acceptableRealizations: [] },
      });
      expect(parseThoughtSemanticOutput(JSON.stringify(bad), new Set()).ok).toBe(true);
      expect(parseThoughtSemanticOutput(JSON.stringify(corrected), new Set()).ok).toBe(true);
      let now = 1_000;
      const requests: Array<{ messages: Array<{ role: string; content: string }>; deadline: unknown }> = [];
      const completeChat: KernelDeps["completeChat"] = async (messages, options) => {
        expect(options.projectionIdentity?.dispatchMessagesHash).toBe(computeDispatchMessagesHash(messages));
        expect(options.thoughtInvocationContext?.structuralAttemptOrdinal).toBe(0);
        expect(options.temperature).toBe(1.0);
        expect(options.structuredOutput?.contractId).toBe("ashley.thought.semantic.v2");
        const operationalSchema = (options.structuredOutput?.schema as any)?.oneOf?.find(
          (branch: any) => branch.properties?.kind?.const === "settlement",
        )?.properties?.commitments?.properties?.operational;
        expect(operationalSchema).toBeUndefined();
        expect(JSON.parse(messages[1]?.content ?? "{}").allowedOperationalEffectRefs).toEqual([]);
        requests.push({ messages, deadline: options.deadlineAtMs });
        now = outcome === "deadline" ? 181_000 : now + 10_000;
        return {
          text: JSON.stringify(requests.length === 1 || outcome !== "corrected" ? bad : corrected),
          model: "fake", modelAlias: "thought", resolvedModelId: null,
        };
      };
      try {
        const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
          attentionDb, completeChat, nowMs: () => now,
        }));
        const steps = sidecar.prepare("SELECT payload_json FROM thought_steps ORDER BY pass").all()
          .map((row) => JSON.parse(String(row.payload_json)));
        const active = { cycleId: cycle.cycleId, generation: cycle.generation,
          occupantId: cycle.occupantId, authorityEpoch: 1, effectAllowlist: new Set<string>() };
        expect(validateThoughtSettlementDraft(steps[0].settlement, active)).toMatchObject({
          ok: false, codes: ["OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN"],
        });
        expect(steps[0].settlement.commitments.operational).toEqual(bad.commitments.operational);
        const counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
        expect(counters.structuralRetries).toBe(0);
        expect(counters.authorityRevisions).toBe(outcome === "still_invalid" ? 2 : 1);
        expect(requests.map((r) => r.deadline)).toEqual(
          Array(outcome === "corrected" ? 2 : outcome === "still_invalid" ? 3 : 1).fill(181_000),
        );
        if (outcome !== "deadline") {
          expect(JSON.parse(requests[1].messages[1].content).authorityObjections)
            .toEqual(["OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN"]);
          const feedback = requests[1].messages.map((m) => {
            try { return JSON.parse(m.content).settlementRevision; } catch { return undefined; }
          }).find(Boolean);
          expect(feedback).toMatchObject({
            failureCode: "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN",
            invalidEffectRefs: ["none"], allowedEffectRefs: [],
          });
        }
        expect(result.published).toBe(outcome === "corrected");
        if (outcome === "corrected") {
          expect(validateThoughtSettlementDraft(steps[1].settlement, active).ok).toBe(true);
          expect(steps[1].settlement.commitments.operational).toBeUndefined();
          expect(steps[1].settlement.speech.surfaceDraft).toBe("model-authored correction");
          expect(sidecar.prepare("SELECT COUNT(*) AS n FROM system_notice_outbox").get()).toMatchObject({ n: 0 });
        } else if (outcome === "deadline") {
          expect(result.infrastructureNotice).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_DEADLINE_EXCEEDED`);
        } else {
          expect(sidecar.prepare("SELECT COUNT(*) AS n FROM settlements").get()).toMatchObject({ n: 0 });
          expect(sidecar.prepare("SELECT notice_key FROM system_notice_outbox").get()?.notice_key)
            .toContain("revision_exhausted");
        }
      } finally {
        sidecar.close();
        attentionDb.close();
      }
    },
  );

  it("keeps the post-repair authority revision bounded when the revision provider is unavailable", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      conversationId: "nemotron-17-01-incident", triggerKind: "owner_message",
      triggerRef: "owner-17-01-incident", occupantId: "doc", authorityEpoch: 1, nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId, text: "Now probably fixed, how are you feeling?",
      discordMessageIds: ["17-01-incident-message"], nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId, conversationId: cycle.conversationId, kind: "owner_message",
      payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
      createdAtMs: 2,
    });
    const bad = makeSemanticSettlement();
    bad.commitments.operational = [{ effectRef: "conversationContinuation", claimedState: "in_progress" }];
    expect(parseThoughtSemanticOutput(JSON.stringify(bad), new Set()).ok).toBe(true);

    let now = 1_000;
    const requests: Array<{ messages: Array<{ role: string; content: string }>; deadline: number }> = [];
    const completeChat: KernelDeps["completeChat"] = async (messages, options) => {
      requests.push({ messages, deadline: options.deadlineAtMs ?? -1 });
      if (requests.length === 1) {
        now += 1_000;
        return { text: JSON.stringify(bad), model: "fake", modelAlias: "thought", resolvedModelId: null };
      }
      throw new Error("provider_unavailable");
    };

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb, completeChat, nowMs: () => now,
      }));
      const steps = sidecar.prepare("SELECT pass, payload_json FROM thought_steps ORDER BY pass").all()
        .map((row) => ({ pass: Number(row.pass), payload: JSON.parse(String(row.payload_json)) }));
      const counters = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);

      expect(result).toMatchObject({
        published: false,
        infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: UNKNOWN`,
        thoughtModelAttempts: 2,
        acceptedThoughtPasses: 1,
      });
      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.deadline)).toEqual([181_000, 181_000]);
      expect(JSON.parse(requests[1].messages[1].content).authorityObjections)
        .toEqual(["OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN"]);
      const feedback = requests[1].messages.map((message) => {
        try { return JSON.parse(message.content).settlementRevision; } catch { return undefined; }
      }).find(Boolean);
      expect(feedback).toMatchObject({
        failureCode: "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN",
        invalidEffectRefs: ["conversationContinuation"],
        allowedEffectRefs: [],
      });
      expect(steps[0]).toMatchObject({ pass: 1, payload: { kind: "settlement" } });
      expect(steps[1]).toMatchObject({ pass: 2, payload: { kind: "failure", reason: "unavailable" } });
      expect(counters).toMatchObject({
        thoughtModelAttempts: 2,
        acceptedThoughtPasses: 1,
        structuralRetries: 0,
        authorityRevisions: 1,
      });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
      expect(sidecar.prepare("SELECT notice_key FROM system_notice_outbox").get()?.notice_key)
        .toContain("unavailable");
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("tracks first-pass and cumulative retry input without changing per-pass receipts", () => {
    const first = createThoughtCycleTokenMetrics();
    const second = observeThoughtCycleInput(first, 1_000);
    const third = observeThoughtCycleInput(second, 500);

    expect(first).toEqual({
      first_pass_total_input_tokens: 0,
      total_cycle_input_tokens_including_retries: 0,
      retry_amplification_ratio: 0,
      request_count: 0,
    });
    expect(second.first_pass_total_input_tokens).toBe(1_000);
    expect(second.total_cycle_input_tokens_including_retries).toBe(1_000);
    expect(third.total_cycle_input_tokens_including_retries).toBe(1_500);
    expect(third.retry_amplification_ratio).toBe(1.5);
    expect(second).not.toBe(first);
  });

  it("persists required overflow details without dispatching a provider", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const observabilityDb = new DatabaseSync(":memory:");
    initObservabilitySchema(observabilityDb);
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-required-overflow-details",
      conversationId: "thread-required-overflow-details",
      triggerKind: "owner_message",
      triggerRef: "owner-overflow-details",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: "trigger for synthetic overflow detail test",
      discordMessageIds: ["overflow-details-message"],
      nowMs: 2,
    });
    applyWorkingContextDelta(sidecar, {
      op: "upsert",
      item: {
        id: "wc-overflow-details",
        conversationId: cycle.conversationId,
        type: "correction",
        text: "synthetic correction overflow payload ".repeat(20_000),
        concernId: null,
        sourceTurnIds: [evidence.rowId],
        status: "active",
        supersedesId: null,
      },
    }, { cycleId: cycle.cycleId, generation: cycle.generation });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    const completeChat = vi.fn(async () => ({
      text: "provider must not be called",
      model: "fake",
      modelAlias: "fake",
      resolvedModelId: null,
    }));

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
        observabilityDb,
      }));
      expect(result).toMatchObject({
        published: false,
        infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: LOCAL_DISPATCH_FAILURE`,
        thoughtExecutionProvenance: { dispatchTruth: "not_sent", providerAttempts: 0 },
      });
      expect(completeChat).not.toHaveBeenCalled();

      const diagnostic = openObservabilityStore(observabilityDb).listDiagnostics().find(
        (item) => item.code === "context_allocation_required_overflow",
      );
      expect(diagnostic).toMatchObject({
        stage: "allocation",
        dispatchTruth: "not_sent",
        requiredOverflowSection: "working_context_pool",
        estimatedInputTokens: expect.any(Number),
        semanticBudgetTokens: 32_768,
        overflowTokens: expect.any(Number),
      });
      expect(diagnostic!.overflowTokens).toBe(
        diagnostic!.estimatedInputTokens! - diagnostic!.semanticBudgetTokens!,
      );
      const storedPayload = observabilityDb.prepare(
        "SELECT cycle_metrics_json FROM thought_dispatch_diagnostics WHERE code = 'context_allocation_required_overflow'",
      ).get() as { cycle_metrics_json: string };
      expect(storedPayload.cycle_metrics_json).not.toContain("synthetic correction overflow payload");
    } finally {
      observabilityDb.close();
      sidecar.close();
      attentionDb.close();
    }
  });

  it("runs perception before Thought, includes observations, and passes attentionDb", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message",
      triggerRef: "owner-1", occupantId: "doc", authorityEpoch: 1, nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: "thread-1", text: "hello", discordMessageIds: ["d1"], nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: "thread-1", kind: "owner_message",
      payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: "hello" }, createdAtMs: 2,
    });
    const order: string[] = [];
    const observation: Observation = {
      observationId: "observation-1", cycleId: cycle.cycleId, generation: 1, derived: false,
      replaySafe: true, modality: "text", payload: { text: "raw" }, provenance: "test",
      dataClassification: "ordinary", secretOmitted: false,
    };
    const completeChat = vi.fn(async (_messages, options) => {
      order.push("thought");
      expect(options.attentionDb).toBe(attentionDb);
      return {
        text: JSON.stringify({
          ...({
            ...makeSemanticSettlement({ interpretation: { discourseActs: ["inform"], referentBindings: [], corrections: [], unresolvedAmbiguities: [], topics: ["hello"] }, evidenceUse: { observationRefsUsed: ["observation-1"], retrievalRefsUsed: [], sourceRefsUsed: [], openIntentRefs: [] } }),
          }),
        }),
        model: "fake", modelAlias: "fake", resolvedModelId: null,
      };
    });
    const runPerception = vi.fn(async () => {
      order.push("perception");
      return [observation];
    });
    const project = vi.fn(async () => undefined);
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat, runPerception, projectOutbox: project }));
    expect(order).toEqual(["perception", "thought"]);
    expect(completeChat).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        published: true,
        acceptedSettlements: 1,
        thoughtModelAttempts: 1,
        ownerObligationResolution: {
          ownerObligationOutcome: "transferred",
          deliveryDisposition: "handed_to_delivery",
          successorIdentity: `speech_outbox:${result.outboxId}`,
        },
      });
    expect(project).toHaveBeenCalledTimes(1);
    sidecar.close();
    attentionDb.close();
  });

  it("materializes and publishes a sparse settlement without manufacturing optional domains", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-sparse-materialization",
      conversationId: "thread-sparse-materialization",
      triggerKind: "owner_message",
      triggerRef: "owner-sparse-materialization",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: "goodnight",
      discordMessageIds: ["sparse-materialization-message"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
      createdAtMs: 2,
    });

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat: vi.fn(async () => ({
          text: JSON.stringify({
            kind: "settlement",
            speech: { mode: "draft", surfaceDraft: "Goodnight. Sleep well." },
          }),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        })),
      }));
      expect(result.published).toBe(true);

      const row = sidecar.prepare("SELECT payload_json FROM settlements WHERE cycle_id = ?").get(cycle.cycleId) as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as Record<string, any>;
      expect(payload.speech).toMatchObject({ mode: "draft", surfaceDraft: "Goodnight. Sleep well." });
      expect(payload.speech).not.toHaveProperty("mustSay");
      expect(payload.speech).not.toHaveProperty("mustNot");
      for (const field of [
        "interpretation", "commitments", "workingContextDelta", "concernDeltas", "occupancyDelta",
        "futureTriggers", "subscriptions", "durableNominations",
      ]) {
        expect(payload).not.toHaveProperty(field);
      }
      expect(payload.operations).toEqual({
        observationsConsumed: [],
        effectsCompleted: [],
        intentsStillInFlight: [],
      });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 1 });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("carries authored retrieval and source reliance into published operations", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-evidence-reliance",
      conversationId: "thread-evidence-reliance",
      triggerKind: "owner_message",
      triggerRef: "owner-evidence-reliance",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: "Use the evidence trail for this answer.",
      discordMessageIds: ["evidence-reliance-message"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
      createdAtMs: 2,
    });

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat: vi.fn(async () => ({
          text: JSON.stringify({
            kind: "settlement",
            speech: { mode: "draft", surfaceDraft: "I used the evidence trail." },
            evidenceUse: {
              retrievalRefsUsed: [evidence.rowId],
              sourceRefsUsed: [evidence.rowId],
            },
          }),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        })),
      }));
      expect(result.published).toBe(true);

      const settlementRow = sidecar.prepare(
        "SELECT payload_json FROM settlements WHERE cycle_id = ?",
      ).get(cycle.cycleId) as { payload_json: string };
      const settlementPayload = JSON.parse(settlementRow.payload_json) as Record<string, any>;
      expect(settlementPayload.operations).toMatchObject({
        retrievalRefsUsed: [evidence.rowId],
        sourceRefsUsed: [evidence.rowId],
      });

      const ledgerRow = sidecar.prepare(
        "SELECT payload_json FROM causal_ledger WHERE cycle_id = ?",
      ).get(cycle.cycleId) as { payload_json: string };
      const ledgerPayload = JSON.parse(ledgerRow.payload_json) as Record<string, any>;
      expect(ledgerPayload).toMatchObject({
        retrievalRefsUsed: [evidence.rowId],
        sourceRefsUsed: [evidence.rowId],
      });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("publishes intentional silence together with an authored internal delta", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-silent-delta",
      conversationId: "thread-silent-delta",
      triggerKind: "owner_message",
      triggerRef: "owner-silent-delta",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: "Remember that preference for later.",
      discordMessageIds: ["silent-delta-message"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
      createdAtMs: 2,
    });

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat: vi.fn(async () => ({
          text: JSON.stringify({
            kind: "settlement",
            speech: { mode: "none" },
            workingContextDeltas: [{
              op: "upsert",
              item: {
                identity: { kind: "local", alias: "remember-later" },
                type: "owner_teaching",
                text: "Owner prefers this preference to remain available later.",
                concernRef: null,
                sourceTurnRefs: [evidence.rowId],
                status: "active",
                supersedesRef: null,
              },
            }],
          }),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        })),
      }));
      expect(result).toMatchObject({ published: true, outboxId: null, acceptedSettlements: 1 });
      expect(result.ownerObligationResolution).toMatchObject({
        ownerObligationOutcome: "unresolved",
        remainingResponsibility: "owner_conversational_obligation",
        deliveryDisposition: "not_applicable",
      });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
      const workingContext = sidecar.prepare("SELECT payload_json, superseded FROM working_context_items").get() as {
        payload_json: string;
        superseded: number;
      };
      expect(JSON.parse(workingContext.payload_json)).toMatchObject({
        text: "Owner prefers this preference to remain available later.",
        status: "active",
      });
      expect(workingContext.superseded).toBe(0);
      expect(sidecar.prepare("SELECT state FROM cycle_records WHERE cycle_id = ?").get(cycle.cycleId)).toMatchObject({ state: "silent" });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it.each([
    {
      label: "dangling local references",
      diagnosticCode: "dangling_local_reference",
      diagnosticField: "workingContextDeltas[0].item.concernRef",
      settlement: (observationId: string) => makeSemanticSettlement({
        speech: { mode: "none" },
        workingContextDeltas: [{
          op: "upsert",
          item: {
            identity: { kind: "local", alias: "working-item" },
            type: "topic",
            text: "A topic with a missing concern alias.",
            concernRef: { kind: "local", alias: "missing-concern" },
            sourceTurnRefs: [],
            status: "active",
            supersedesRef: null,
          },
        }],
      }),
    },
    {
      label: "duplicate local aliases",
      diagnosticCode: "alias_duplicate",
      diagnosticField: "workingContextDeltas[1].item.identity",
      settlement: (observationId: string) => makeSemanticSettlement({
        speech: { mode: "none" },
        workingContextDeltas: [
          {
            op: "upsert",
            item: {
              identity: { kind: "local", alias: "same-item" },
              type: "topic",
              text: "The first item.",
              concernRef: null,
              sourceTurnRefs: [],
              status: "active",
              supersedesRef: null,
            },
          },
          {
            op: "upsert",
            item: {
              identity: { kind: "local", alias: "same-item" },
              type: "topic",
              text: "The second item.",
              concernRef: null,
              sourceTurnRefs: [],
              status: "active",
              supersedesRef: null,
            },
          },
        ],
      }),
    },
    {
      label: "existing references with the wrong target domain",
      diagnosticCode: "reference_target_type_mismatch",
      diagnosticField: "workingContextDeltas[0].item.concernRef",
      settlement: (observationId: string) => makeSemanticSettlement({
        speech: { mode: "none" },
        workingContextDeltas: [{
          op: "upsert",
          item: {
            identity: { kind: "local", alias: "working-item" },
            type: "topic",
            text: "A topic pointing at an observation as its concern.",
            concernRef: { kind: "existing", ref: observationId },
            sourceTurnRefs: [],
            status: "active",
            supersedesRef: null,
          },
        }],
      }),
    },
  ])("routes $label through the bounded malformed Thought failure path", async ({
    label,
    diagnosticCode,
    diagnosticField,
    settlement,
  }) => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const suffix = label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const cycle = admitTestCycle(sidecar, {
      cycleId: `cycle-materialization-${suffix}`,
      conversationId: `thread-materialization-${suffix}`,
      triggerKind: "owner_message",
      triggerRef: `owner-materialization-${suffix}`,
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: "Please handle this semantic settlement.",
      discordMessageIds: [`materialization-${suffix}-message`],
      nowMs: 2,
    });
    const observationId = `observation-materialization-${suffix}`;
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
        observations: [{
          observationId,
          provenance: "test-materialization",
          modality: "text",
          dataClassification: "ordinary",
          payload: { text: "observation" },
          derived: false,
          replaySafe: true,
          secretOmitted: false,
        }],
      },
      createdAtMs: 2,
    });

    try {
      const completeChat = vi.fn(async () => ({
        text: JSON.stringify(settlement(observationId)),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      }));
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
      }));
      const steps = sidecar.prepare(
        "SELECT payload_json FROM thought_steps ORDER BY pass",
      ).all().map((row) => JSON.parse(String((row as { payload_json: string }).payload_json)));

      expect(result).toMatchObject({
        published: false,
        infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: STRUCTURAL_RETRY_EXHAUSTED`,
        thoughtModelAttempts: 3,
        acceptedThoughtPasses: 0,
      });
      expect(completeChat).toHaveBeenCalledTimes(3);
      expect(steps).toHaveLength(3);
      expect(steps.at(-1)).toMatchObject({
        kind: "failure",
        reason: "malformed",
        diagnosticCode,
        diagnosticField,
      });
      expect(steps).not.toContainEqual(expect.objectContaining({ reason: "unavailable" }));
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
      expect(sidecar.prepare("SELECT notice_key FROM system_notice_outbox").get()?.notice_key)
        .toContain(":malformed");
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("fails closed on a predecessor Thought output envelope and does not publish speech", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, { conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "owner-1", nowMs: 1 });
    const evidence = appendOwnerUtterance(sidecar, { conversationId: "thread-1", text: "hello", discordMessageIds: ["d1"], nowMs: 2 });
    const event = appendInboxEvent(sidecar, { wakeId: cycle.wakeId, conversationId: "thread-1", kind: "owner_message", payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: "hello" }, createdAtMs: 2 });
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify({
        kind: "settlement",
        cycleId: cycle.cycleId,
        generation: 1,
        pass: 1,
        requestId: "model-authored-request",
        occupantId: "model-authored-occupant",
        settlement: makeSemanticSettlement(),
      }),
      model: "fake",
      modelAlias: "fake",
      resolvedModelId: null,
    }));
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ completeChat }));
    expect(result).toMatchObject({ published: false, acceptedSettlements: 0, infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: STRUCTURAL_RETRY_EXHAUSTED` });
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    sidecar.close();
    attentionDb.close();
  });

  it("records an allowlisted provider-unavailable failure without turning C3 into a speech authority", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-c3-thought",
      conversationId: "thread-c3-thought",
      triggerKind: "owner_message",
      triggerRef: "owner-c3-thought",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: "Please answer this after the provider becomes available.",
      discordMessageIds: ["c3-thought-message"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat: vi.fn(async () => {
          throw new Error("provider_unavailable");
        }),
      }));
      expect(result).toMatchObject({ published: false, infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: UNKNOWN` });
      expect(sidecar.prepare(
        "SELECT failure_class, terminal_phase, notice_id FROM c3_terminal_experiences",
      ).get()).toMatchObject({ failure_class: "unavailable", terminal_phase: "thought" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("reuses one absolute deadline and gives a bounded corrective structural retry", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-deadline",
      conversationId: "thread-deadline",
      triggerKind: "owner_message",
      triggerRef: "owner-deadline",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: "thread-deadline",
      text: "hello",
      discordMessageIds: ["deadline-message"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: "thread-deadline",
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: "hello",
      },
      createdAtMs: 2,
    });
    let now = 1_000;
    const deadlines: number[] = [];
    const userInputs: string[] = [];
    const systemMessages: string[] = [];
    const structuredContractIds: string[] = [];
    const maxTokens: Array<number | undefined> = [];
    const temperatures: Array<number | undefined> = [];
    let calls = 0;
    const completeChat = vi.fn(async (
      messages: Array<{ role: string; content: string }>,
      options: {
        deadlineAtMs?: number | null;
        maxTokens?: number;
        temperature?: number;
        responseFormat?: string;
        structuredOutput?: { contractId?: string };
      },
    ) => {
      calls += 1;
      deadlines.push(options.deadlineAtMs ?? -1);
      maxTokens.push(options.maxTokens);
      temperatures.push(options.temperature);
      expect(options.responseFormat).toBe("json_schema");
      structuredContractIds.push(options.structuredOutput?.contractId ?? "");
      systemMessages.push(messages[0]?.content ?? "");
      userInputs.push(messages[1]?.content ?? "");
      const input = JSON.parse(messages[1]?.content ?? "{}") as ThoughtInput;
      if (calls === 1) {
        now = 3_500;
        return { text: "not json", model: "fake", modelAlias: "thought", resolvedModelId: null };
      }
      return {
        text: JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    });
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
      attentionDb,
      completeChat,
      nowMs: () => now,
    }));
    expect(result.published).toBe(true);
    expect(deadlines).toEqual([181_000, 181_000]);
    expect(maxTokens).toEqual([undefined, 16_384]);
    expect(temperatures).toEqual([1.0, 1.0]);
    expect(structuredContractIds).toEqual(["ashley.thought.semantic.v2", "ashley.thought.semantic.v2"]);
    expect(userInputs[1]).toBe(userInputs[0]);
    expect(systemMessages[0]).toContain("schemaId=ashley.thought.semantic.v2.schema");
    expect(systemMessages[0]).toContain("permitted kinds");
    expect(systemMessages[0]).toContain("Semantic selection rules");
    expect(systemMessages[0]).toContain("settlement only when the current supplied evidence and context are sufficient");
    expect(systemMessages[0]).not.toContain("Code validates semantics");
    expect(systemMessages[0]).toContain("mustSay");
    expect(systemMessages[0]).toContain("commitments");
    expect(systemMessages[0]).toContain("evidenceUse");
    expect(systemMessages[0]).toContain("finalLicensedText");
    expect(systemMessages[1]).toContain("invalid_json");
    expect(systemMessages[1]).toContain("structural validation");
    sidecar.close();
    attentionDb.close();
  });

  it("carries the prior model-authored candidate into a localized correction without changing the pass", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-contextual-correction",
      conversationId: "thread-contextual-correction",
      triggerKind: "owner_message",
      triggerRef: "owner-contextual-correction",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: "thread-contextual-correction",
      text: "Return the effect intent semantic branch.",
      discordMessageIds: ["contextual-correction-message"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: "thread-contextual-correction",
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    const messagesByCall: string[][] = [];
    let calls = 0;
    const completeChat = vi.fn(async (
      messages: Array<{ role: string; content: string }>,
    ) => {
      calls += 1;
      messagesByCall.push(messages.map((message) => message.content));
      return {
        text: calls === 1
          ? JSON.stringify({
              kind: "abstain",
              reason: "insufficient_evidence",
              explanation: "The supplied evidence is not enough.",
              evidenceRefs: ["not-allowlisted"],
            })
          : JSON.stringify({
              kind: "abstain",
              reason: "insufficient_evidence",
              explanation: "The supplied evidence is not enough.",
              evidenceRefs: [evidence.rowId],
            }),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    });

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
      }));

      expect(result.published).toBe(false);
      expect(calls).toBe(2);
      expect(messagesByCall[1][0]).toContain("reference_not_allowlisted");
      expect(messagesByCall[1][0]).toContain("evidenceRefs");
      expect(messagesByCall[1][0]).toContain("host allowlisted reference IDs");
      expect(messagesByCall[1][0]).toContain(evidence.rowId);
      expect(messagesByCall[1][1]).toBe(messagesByCall[0][1]);
      const correctionData = JSON.parse(messagesByCall[1][2] ?? "null") as {
        structuralCorrection: {
          candidateRole: string;
          previousCandidate: Record<string, unknown>;
          failureCode: string;
          failingPath: string;
          allowedRepairScope: { kind: string; path: string };
          hostAllowlistedReferenceIds: string[];
        };
      };
      expect(correctionData.structuralCorrection).toMatchObject({
        candidateRole: "model_authored_data",
        previousCandidate: {
          kind: "abstain",
          evidenceRefs: ["not-allowlisted"],
        },
        failureCode: "reference_not_allowlisted",
        failingPath: "evidenceRefs",
        allowedRepairScope: { kind: "localized", path: "evidenceRefs" },
        hostAllowlistedReferenceIds: expect.arrayContaining([evidence.rowId]),
      });
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("rejects structural correction branch drift with a typed scope failure", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-correction-drift",
      conversationId: "thread-correction-drift",
      triggerKind: "owner_message",
      triggerRef: "owner-correction-drift",
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: "thread-correction-drift",
      text: "Please answer from the supplied evidence.",
      discordMessageIds: ["correction-drift-message"],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: "thread-correction-drift",
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    let calls = 0;
    const completeChat = vi.fn(async () => {
      calls += 1;
      return {
        text: calls === 1
          ? JSON.stringify({
              kind: "effect_intent",
              operationKind: "workspace.verify",
              request: {
                version: 2,
                operation: "workspace.verify",
                projectId: "qualification-fixture",
                workspaceId: "qualification-fixture-workspace",
                recipeId: "typescript_fixture_compile_v1",
              },
              purpose: "run the approved read-only workspace verification",
              expectedOutcome: "the mechanical verification result is reported without changing files",
              existingRefs: ["not-allowlisted"],
            })
          : JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    });

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat,
      }));

      expect(result.published).toBe(false);
      expect(calls).toBe(2);
      const rows = sidecar.prepare(
        "SELECT payload_json FROM thought_steps WHERE kind = 'failure' ORDER BY created_at_ms, request_id",
      ).all() as Array<{ payload_json: string }>;
      expect(rows.map((row) => JSON.parse(row.payload_json))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            correctionFailureCode: "structural_correction_scope_violation",
          }),
        ]),
      );
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it.each([
    ["effect", "Show me / explain what an effect_intent semantic object looks like."],
    ["observation", "Analyze what an observation_intent semantic object would contain."],
  ])("does not infer a semantic branch from an internal-branch mention (%s)", async (_label, ownerMessage) => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-negative-branch-" + _label,
      conversationId: "thread-negative-branch-" + _label,
      triggerKind: "owner_message",
      triggerRef: "owner-negative-branch-" + _label,
      occupantId: "doc",
      authorityEpoch: 1,
      nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId,
      text: ownerMessage,
      discordMessageIds: ["negative-branch-" + _label],
      nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: cycle.conversationId,
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: evidence.rowId,
        ownerMessage: evidence.text,
      },
      createdAtMs: 2,
    });
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb,
        completeChat: vi.fn(async () => ({
          text: JSON.stringify(makeSemanticSettlement()),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        })),
      }));
      expect(result.published).toBe(true);
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("materializes effectsCompleted only for terminal physical receipts (succeeded or failed)", () => {
    const inFlight = [
      { effectId: "e-succ" },
      { effectId: "e-fail" },
      { effectId: "e-unk" },
      { effectId: "e-prog" },
      { effectId: "e-notatt" },
      { effectId: "e-norec" },
    ] as any;

    const receiptsByEffectId = {
      "e-succ": { outcome: "succeeded" },
      "e-fail": { outcome: "failed" },
      "e-unk": { outcome: "outcome_unknown" },
      "e-prog": { outcome: "in_progress" },
      "e-notatt": { outcome: "not_attempted" },
    } as any;

    const completed = materializeEffectsCompleted(inFlight, receiptsByEffectId);
    expect(completed).toEqual(["e-succ", "e-fail"]);
    expect(materializeEffectsCompleted(inFlight, undefined)).toEqual([]);
  });
});

describe("Thought provider deadline truth and bounded usage telemetry", () => {
  function admitDeadlineCycle(sidecar: DatabaseSync, conversationId: string) {
    const cycle = admitTestCycle(sidecar, {
      conversationId, triggerKind: "owner_message",
      triggerRef: `owner-${conversationId}`, occupantId: "doc", authorityEpoch: 1, nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: cycle.conversationId, text: "deadline truth probe",
      discordMessageIds: [`${conversationId}-message`], nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId, conversationId: cycle.conversationId, kind: "owner_message",
      payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
      createdAtMs: 2,
    });
    return { cycle, event };
  }

  it("reports a dispatch deadline timeout as thought_deadline with unknown dispatch truth", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const obsDb = new DatabaseSync(":memory:");
    initObservabilitySchema(obsDb);
    const { event } = admitDeadlineCycle(sidecar, "thread-deadline-truth");
    const completeChat: KernelDeps["completeChat"] = async () => {
      throw new AppError("timeout", "Thought provider deadline exceeded", 408);
    };
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb, completeChat, observabilityDb: obsDb,
      }));
      expect(result).toMatchObject({
        published: false,
        thoughtModelAttempts: 1,
        infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_DEADLINE_EXCEEDED`,
      });
      const store = openObservabilityStore(obsDb);
      const diagnostics = store.listDiagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code: "attention_deadline",
        stage: "provider_dispatch",
        dispatchTruth: "unknown",
      });
      expect(diagnostics[0].providerFailure).toMatchObject({
        abortReasonName: "TimeoutError",
        noHttpResponse: true,
        failureClass: "timeout",
        sessionAffinityApplied: false,
        affinityPolicy: "none",
      });
      const stored = obsDb.prepare(
        "SELECT provider_failure_json FROM thought_dispatch_diagnostics",
      ).get() as { provider_failure_json: string };
      expect(stored.provider_failure_json).not.toContain("deadline exceeded");
    } finally {
      obsDb.close();
      sidecar.close();
      attentionDb.close();
    }
  });

  it("records bounded provider usage on successful Thought without influencing semantics", async () => {
    const runOnce = async (usage: Record<string, number> | undefined) => {
      const sidecar = openTestSidecar();
      const attentionDb = openTestSidecar();
      const obsDb = new DatabaseSync(":memory:");
      initObservabilitySchema(obsDb);
      const { event } = admitDeadlineCycle(sidecar, "thread-usage-truth");
      const completeChat: KernelDeps["completeChat"] = async () => ({
        text: JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
        ...(usage ? { usage: { promptTokens: 0, completionTokens: 0, ...usage } } : {}),
        providerBoundaryTiming: {
          requestStartedAtMs: 100,
          responseAtMs: 140,
          elapsedMs: 40,
          remainingDeadlineMs: 3_860,
          outcome: "response_received" as const,
        },
        modelFabric: {
          receipt: {
            receiptStage: "resolved",
            attempts: [{
              receiptStage: "provider_response",
              dispatchTruth: "response_received",
              providerRequestCount: 1,
              usage: {
                inputTokens: usage?.promptTokens ?? null,
                outputTokens: usage?.completionTokens ?? null,
                cachedInputTokens: usage?.cachedTokens ?? null,
                reasoningTokens: usage?.reasoningTokens ?? null,
                ...(usage?.neuronUsage !== undefined ? { neuronUsage: usage.neuronUsage } : {}),
                providerReported: usage !== undefined,
              },
            }],
          },
        } as any,
      });
      try {
        const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
          attentionDb, completeChat, observabilityDb: obsDb,
        }));
        const store = openObservabilityStore(obsDb);
        return { result, diagnostics: store.listDiagnostics() };
      } finally {
        obsDb.close();
        sidecar.close();
        attentionDb.close();
      }
    };

    const fullUsage = { promptTokens: 111, completionTokens: 22, cachedTokens: 33, reasoningTokens: 44, neuronUsage: 55 };
    const withUsage = await runOnce(fullUsage);
    expect(withUsage.result.published).toBe(true);
    const returned = withUsage.diagnostics.filter((row) => row.code === "provider_returned");
    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({ stage: "provider_dispatch", dispatchTruth: "sent" });
    expect(returned[0].providerFailure).toMatchObject({
      inputTokens: 111,
      completionTokens: 22,
      cachedInputTokens: 33,
      reasoningTokens: 44,
      neuronUsage: 55,
      elapsedMs: 40,
      remainingDeadlineMs: 3_860,
      noHttpResponse: false,
      abortReasonName: "none",
      sessionAffinityApplied: false,
      affinityPolicy: "none",
    });

    const withoutUsage = await runOnce(undefined);
    expect(withoutUsage.result.published).toBe(true);
    const returnedEmpty = withoutUsage.diagnostics.filter((row) => row.code === "provider_returned");
    expect(returnedEmpty).toHaveLength(1);
    expect(returnedEmpty[0].providerFailure).not.toMatchObject({
      inputTokens: expect.anything(),
      completionTokens: expect.anything(),
      cachedInputTokens: expect.anything(),
      reasoningTokens: expect.anything(),
      neuronUsage: expect.anything(),
    });
    expect(returnedEmpty[0].providerFailure).toMatchObject({
      noHttpResponse: false,
      abortReasonName: "none",
      sessionAffinityApplied: false,
      affinityPolicy: "none",
    });

    // Numeric telemetry cannot influence the terminal semantic outcome.
    expect(withoutUsage.result.published).toBe(withUsage.result.published);
    expect(withoutUsage.result.infrastructureNotice).toBe(withUsage.result.infrastructureNotice);
  });

  it("reports the observed affinity-transport truth on successful Thought", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const obsDb = new DatabaseSync(":memory:");
    initObservabilitySchema(obsDb);
    const { event } = admitDeadlineCycle(sidecar, "thread-affinity-truth");
    const completeChat: KernelDeps["completeChat"] = async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake",
      modelAlias: "thought",
      resolvedModelId: null,
      providerBoundaryTransport: {
        sessionAffinityApplied: true,
        affinityPolicy: "cloudflare_thought_route_affinity_v1",
      },
      modelFabric: {
        receipt: {
          receiptStage: "resolved",
          attempts: [{
            receiptStage: "provider_response",
            dispatchTruth: "response_received",
            providerRequestCount: 1,
            usage: { inputTokens: 7, outputTokens: 1, cachedInputTokens: null, reasoningTokens: null, providerReported: true },
          }],
        },
        providerBoundaryTransport: {
          sessionAffinityApplied: true,
          affinityPolicy: "cloudflare_thought_route_affinity_v1",
        },
      } as any,
    });
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb, completeChat, observabilityDb: obsDb,
      }));
      expect(result.published).toBe(true);
      const store = openObservabilityStore(obsDb);
      const returned = store.listDiagnostics().filter((row) => row.code === "provider_returned");
      expect(returned).toHaveLength(1);
      expect(returned[0].providerFailure).toMatchObject({
        sessionAffinityApplied: true,
        affinityPolicy: "cloudflare_thought_route_affinity_v1",
      });
      const stored = obsDb.prepare(
        "SELECT provider_failure_json FROM thought_dispatch_diagnostics",
      ).get() as { provider_failure_json: string };
      expect(stored.provider_failure_json).toContain("cloudflare_thought_route_affinity_v1");
    } finally {
      obsDb.close();
      sidecar.close();
      attentionDb.close();
    }
  });

  it("preserves applied affinity truth on a failed Thought attempt without changing classification", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const obsDb = new DatabaseSync(":memory:");
    initObservabilitySchema(obsDb);
    const { event } = admitDeadlineCycle(sidecar, "thread-affinity-failure-truth");
    const completeChat: KernelDeps["completeChat"] = async () => {
      const error = new AppError("provider_unavailable", "Cloudflare Workers AI unavailable", 503);
      (error as unknown as Record<string, unknown>).modelFabric = {
        receipt: {
          receiptStage: "resolved",
          attempts: [{ dispatchTruth: "response_received", providerRequestCount: 1 }],
        },
        failure: { sanitizedCauseClass: "provider_unavailable" },
        providerBoundaryTransport: {
          sessionAffinityApplied: true,
          affinityPolicy: "cloudflare_thought_route_affinity_v1",
        },
      };
      throw error;
    };
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({
        attentionDb, completeChat, observabilityDb: obsDb,
      }));
      expect(result.published).toBe(false);
      const store = openObservabilityStore(obsDb);
      const diagnostics = store.listDiagnostics();
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].providerFailure).toMatchObject({
        failureClass: "provider_unavailable",
        sessionAffinityApplied: true,
        affinityPolicy: "cloudflare_thought_route_affinity_v1",
      });
    } finally {
      obsDb.close();
      sidecar.close();
      attentionDb.close();
    }
  });
});
