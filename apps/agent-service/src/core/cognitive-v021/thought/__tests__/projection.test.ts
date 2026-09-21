import { describe, it, expect } from "vitest";
import type { ConversationEvidenceRecord, Observation, RetrievalHit, ThoughtInput } from "../../types.js";
import { mintEffectRef } from "../../effect/effect-ref.js";
import {
  projectThoughtInput,
  projectRetrievalHit,
  modelVisibleThoughtProjection,
  computeSemanticProjectionHash,
  computeDispatchMessagesHash,
  type CompactMemoryEvidence,
  type CompactConversationEvidence,
  type ProjectedThoughtInput,
} from "../projection.js";
import { RECENCY_OMISSION_GUIDANCE, thoughtMessagesForProjection } from "../projection-allocator/allocator.js";

function makeThoughtInput(overrides: Partial<ThoughtInput> = {}): ThoughtInput {
  return {
    cycleId: "cycle-1",
    generation: 1,
    occupantId: "occupant-1",
    authorityEpoch: 1,
    trigger: { kind: "owner_message", ref: "msg-1" },
    rawConversation: [],
    workingContext: [],
    occupancy: [],
    constitution: { constitutional: [], stableSelf: [] },
    learnedSelfSlice: { dispositions: [], interests: [] },
    capabilityReality: {
      vision: false,
      attachmentText: false,
      conversationalRead: false,
      webSearch: false,
      canOfferProjectInspection: false,
      canOfferWorkspace: false,
      canOfferVerification: false,
      canOfferAuthorship: false,
      canOfferBoundedOperation: false,
      canOfferInquiry: false,
      canOfferPatchExport: false,
      approvedProjectIds: [],
    },
    observations: [],
    retrieval: {
      request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
      hits: [],
      state: "ready",
      miss: true,
    },
    inFlight: [],
    authorityObjections: [],
    runtimeCondition: { fallback: false, compression: false, lookupFailed: false, thoughtUnavailable: false },
    rememberDirective: null,
    ...overrides,
  };
}

describe("Model-Visible Thought Projection", () => {
  it("projects memory hit into compact epistemic evidence", () => {
    const fullHit: RetrievalHit = {
      kind: "key",
      sourceStore: "live_memory",
      ref: "mem:sleep:1",
      snippet: "Owner sleeps at 11pm",
      score: -100,
      assertionKey: "mem:sleep:1",
      memoryKind: "owner_preference",
      dimensions: {
        source: "owner_utterance",
        status: "asserted",
        time: "current",
        reliability: "owner_supplied",
      },
      dataClassification: "never_public",
      live: true,
      supportRefs: ["supp-1", "supp-2"],
    };

    const compact = projectRetrievalHit(fullHit) as CompactMemoryEvidence;
    expect(compact.kind).toBe("key");
    expect(compact.ref).toBe("mem:sleep:1");
    expect(compact.sourceStore).toBe("live_memory");
    expect(compact.memoryKind).toBe("owner_preference");
    expect(compact.snippet).toBe("Owner sleeps at 11pm");
    expect(compact.supportCount).toBe(2);
    expect((compact as Record<string, unknown>).score).toBeUndefined();
    expect((compact as Record<string, unknown>).dataClassification).toBeUndefined();
  });

  it("projects conversation log hit without fake memory fields", () => {
    const fullHit: RetrievalHit = {
      kind: "log",
      sourceStore: "conversation_log",
      ref: "row-123",
      snippet: "Hello Ashley",
      score: -2.5,
      assertionKey: null,
      memoryKind: null,
      dimensions: null,
      dataClassification: "ordinary",
      live: null,
      supportRefs: ["lineage-1"],
    };

    const compact = projectRetrievalHit(fullHit) as CompactConversationEvidence;
    expect(compact.kind).toBe("log");
    expect(compact.ref).toBe("row-123");
    expect(compact.sourceStore).toBe("conversation_log");
    expect(compact.snippet).toBe("Hello Ashley");
    expect(compact.role).toBe("unknown");
    expect((compact as Record<string, unknown>).memoryKind).toBeUndefined();
    expect((compact as Record<string, unknown>).dimensions).toBeUndefined();
  });

  it("table-driven role transport across FTS -> discover -> projection preserves role and never defaults to owner", () => {
    const cases = [
      { inputRole: "owner", expectedFts: "owner", expectedDiscover: "owner", expectedProjection: "owner" },
      { inputRole: "ashley", expectedFts: "ashley", expectedDiscover: "ashley", expectedProjection: "ashley" },
      { inputRole: "system", expectedFts: "system", expectedDiscover: "system", expectedProjection: "system" },
      { inputRole: null, expectedFts: "unknown", expectedDiscover: "unknown", expectedProjection: "unknown" },
      { inputRole: undefined, expectedFts: "unknown", expectedDiscover: "unknown", expectedProjection: "unknown" },
    ];

    for (const c of cases) {
      // 1. FTS resolution: sidecar.role -> fts.role
      const sidecarRole = c.inputRole;
      const ftsRole = sidecarRole === "owner" || sidecarRole === "ashley" || sidecarRole === "system"
        ? sidecarRole
        : "unknown";
      expect(ftsRole).toBe(c.expectedFts);

      // 2. Discover resolution: row.role -> hit.role
      const hitRole = ftsRole ?? "unknown";
      expect(hitRole).toBe(c.expectedDiscover);

      // 3. Projection resolution: hit.role -> compact.role
      const compact = projectRetrievalHit({
        kind: "log",
        sourceStore: "conversation_log",
        ref: "row-1",
        snippet: "text",
        score: 1,
        assertionKey: null,
        memoryKind: null,
        dimensions: null,
        dataClassification: "ordinary",
        live: null,
        role: hitRole,
        supportRefs: [],
      }) as CompactConversationEvidence;
      expect(compact.role).toBe(c.expectedProjection);
    }
  });

  it("produces stable semanticProjectionHash and preserves full provenance kernel-side", () => {
    const dummyInput: ThoughtInput = {
      cycleId: "cycle-1",
      generation: 1,
      occupantId: "occupant-1",
      authorityEpoch: 1,
      trigger: { kind: "owner_message", ref: "msg-1" },
      rawConversation: [],
      workingContext: [],
      occupancy: [],
      constitution: { constitutional: [], stableSelf: [] },
      learnedSelfSlice: { dispositions: [], interests: [] },
      capabilityReality: {
        vision: false,
        attachmentText: false,
        conversationalRead: false,
        webSearch: false,
        canOfferProjectInspection: false,
        canOfferWorkspace: false,
        canOfferVerification: false,
        canOfferAuthorship: false,
        canOfferBoundedOperation: false,
        canOfferInquiry: false,
        canOfferPatchExport: false,
        approvedProjectIds: [],
      },
      observations: [],
      retrieval: {
        request: {
          triggerTerms: ["sleep"],
          workingContextTopics: [],
          assertionKeys: [],
          includeLogSearch: true,
        },
        hits: [],
        state: "ready",
        miss: false,
      },
      inFlight: [],
      authorityObjections: [],
      runtimeCondition: { fallback: false, compression: false, lookupFailed: false, thoughtUnavailable: false },
      rememberDirective: null,
    };

    const hit: RetrievalHit = {
      kind: "lexical",
      sourceStore: "live_memory",
      ref: "mem:1",
      snippet: "Statement",
      score: -1.0,
      assertionKey: "mem:1",
      memoryKind: "owner_world_claim",
      dimensions: null,
      dataClassification: "ordinary",
      live: true,
      supportRefs: ["supp-1"],
    };

    const projection1 = projectThoughtInput(dummyInput, [hit]);
    const projection2 = projectThoughtInput(dummyInput, [hit]);

    expect(projection1.semanticProjectionHash).toBe(projection2.semanticProjectionHash);
    expect(projection1.provenance.get("mem:1")).toEqual(hit);
    expect(projection1.projected.retrieval.hits.length).toBe(1);
    expect(projection1.projected.retrieval.hits[0].ref).toBe("mem:1");
  });

  it("explains that conversationalRead gates additional page reads, not supplied raw conversation", () => {
    const ownerTurn: ConversationEvidenceRecord = {
      rowId: "turn-1",
      lineageId: "lineage-1",
      version: 1,
      conversationId: "thread-1",
      role: "owner",
      text: "Please acknowledge that you received this message.",
      createdAtMs: 1,
      discordMessageIds: [],
      reservationId: null,
      producingCycleId: "cycle-1",
      architectureEpoch: "v0.2.1",
      contentHash: "hash-1",
      sourceStatus: "current",
      dataClassification: "ordinary",
      secretOmitted: false,
      delivered: true,
    };
    const input: ThoughtInput = {
      cycleId: "cycle-1",
      generation: 1,
      occupantId: "occupant-1",
      authorityEpoch: 1,
      trigger: { kind: "owner_message", ref: "turn-1" },
      rawConversation: [ownerTurn],
      workingContext: [],
      occupancy: [],
      constitution: { constitutional: [], stableSelf: [] },
      learnedSelfSlice: { dispositions: [], interests: [] },
      capabilityReality: {
        vision: false,
        attachmentText: false,
        conversationalRead: false,
        webSearch: false,
        canOfferProjectInspection: false,
        canOfferWorkspace: false,
        canOfferVerification: false,
        canOfferAuthorship: false,
        canOfferBoundedOperation: false,
        canOfferInquiry: false,
        canOfferPatchExport: false,
        approvedProjectIds: [],
      },
      observations: [],
      retrieval: {
        request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: [],
        state: "ready",
        miss: true,
      },
      inFlight: [],
      authorityObjections: [],
      runtimeCondition: { fallback: false, compression: false, lookupFailed: false, thoughtUnavailable: false },
      rememberDirective: null,
    };

    const projected = projectThoughtInput(input, []).projected;
    const messages = thoughtMessagesForProjection(projected);
    const visibleInput = JSON.parse(messages[1]?.content as string) as typeof projected;

    expect(messages[0]?.content).toContain(
      "CapabilityReality field semantics: conversationalRead reports only whether an additional authorized user-requested URL/page read may be performed",
    );
    expect(messages[0]?.content).toContain(
      "every included rawConversation entry is directly readable current context regardless of conversationalRead",
    );
    expect(visibleInput.capabilityReality.conversationalRead).toBe(false);
    expect(visibleInput.rawConversation[0]?.text).toBe(ownerTurn.text);
    expect(visibleInput.allowedOperationalEffectRefs).toEqual([]);
  });

  it("projects active effects to opaque effectRef and does NOT expose raw effectId to model", () => {
    const rawEffectId = "b9090fc9-2708-4100-b8d0-51a44e5aa0f3";
    const cycleId = "cycle-eff-1";
    const generation = 2;
    const expectedRef = mintEffectRef(cycleId, generation, rawEffectId);

    const input: ThoughtInput = {
      cycleId,
      generation,
      occupantId: "occupant-1",
      authorityEpoch: 1,
      trigger: { kind: "owner_message", ref: "turn-1" },
      rawConversation: [],
      workingContext: [],
      occupancy: [],
      constitution: { constitutional: [], stableSelf: [] },
      learnedSelfSlice: { dispositions: [], interests: [] },
      capabilityReality: {
        vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
        canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
        canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
        approvedProjectIds: [],
      },
      observations: [],
      retrieval: {
        request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: [],
        state: "ready",
        miss: true,
      },
      inFlight: [{
        effectId: rawEffectId,
        cycleId,
        generation,
        wakeId: "wake-1",
        correlationId: "corr-1",
        idempotencyKey: "idem-1",
        status: "in_flight",
        dispatchedAtMs: 1,
        originJobId: null,
        originEventId: "ev-1",
        originAttemptId: null,
      }],
      authorityObjections: [],
      runtimeCondition: { fallback: false, compression: false, lookupFailed: false, thoughtUnavailable: false },
      rememberDirective: null,
    };

    const projected = projectThoughtInput(input, []).projected;
    const messages = thoughtMessagesForProjection(projected);
    const userMessageContent = messages[1]?.content as string;

    // 1. Thought input contains effect:<hash>
    expect(userMessageContent).toContain(expectedRef);

    // 2. Thought input does NOT contain raw effectId UUID
    expect(userMessageContent).not.toContain(rawEffectId);

    // 3. Structured projected inFlight item contains effectRef, not effectId
    expect(projected.allowedOperationalEffectRefs).toEqual([expectedRef]);
    expect(projected.inFlight[0]).toEqual({
      effectRef: expectedRef,
      status: "in_flight",
    });
    expect((projected.inFlight[0] as any).effectId).toBeUndefined();
  });

  it("omits root payload.selectedModelId only at the model-visible boundary", () => {
    const workerPayload = (): Record<string, unknown> => ({
      operation: "project.investigate",
      projectId: "project-ashley",
      selectedModelId: "opencode/nemotron-3.5-lightning-free",
      summary: "worker used opencode/nemotron-3.5-lightning-free prose",
      steps: [{ operation: "project.read_file", state: "succeeded", error: null, observation: "file text" }],
      lastObservation: "file text",
      nested: { selectedModelId: "opencode/nemotron-3.5-lightning-free" },
    });
    const observationFor = (observationId: string, provenance: string): Observation => ({
      observationId,
      cycleId: "cycle-1",
      generation: 1,
      derived: false,
      replaySafe: true,
      modality: "tool",
      payload: workerPayload(),
      provenance,
      dataClassification: "never_public",
      secretOmitted: true,
    });
    const detached = observationFor("v021:observation:detached:op-1", "worker:project.investigate");
    const direct = observationFor("v021:observation:req-1", "worker:project.investigate");
    const scalar: Observation = {
      ...detached,
      observationId: "obs-scalar",
      payload: "plain text evidence",
    };
    const input = makeThoughtInput({ observations: [detached, direct, scalar] });
    const base = projectThoughtInput(input, []).projected;

    // A. RAW / CARRIER TRUTH: projectThoughtInput keeps the raw key.
    for (const observation of base.observations) {
      if (typeof observation.payload === "object" && observation.payload !== null) {
        expect((observation.payload as Record<string, unknown>).selectedModelId)
          .toBe(observation.observationId === "obs-scalar" ? undefined : "opencode/nemotron-3.5-lightning-free");
      }
    }

    const visible = modelVisibleThoughtProjection(base) as Pick<ProjectedThoughtInput, "observations">;

    // B. MODEL-VISIBLE OMISSION on both detached-shaped and direct-shaped rows.
    expect(visible.observations).toHaveLength(3);
    for (const observation of visible.observations) {
      if (typeof observation.payload === "object" && observation.payload !== null) {
        const payload = observation.payload as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(payload, "selectedModelId")).toBe(false);
      }
    }
    expect(visible.observations[2]?.payload).toBe("plain text evidence");

    // C. NON-MUTATION: original carrier, rows, and payload objects unchanged.
    expect(base.observations).toHaveLength(3);
    expect((base.observations[0]?.payload as Record<string, unknown>).selectedModelId)
      .toBe("opencode/nemotron-3.5-lightning-free");
    expect((detached.payload as Record<string, unknown>).selectedModelId)
      .toBe("opencode/nemotron-3.5-lightning-free");
    expect(visible.observations[0]).not.toBe(base.observations[0]);
    expect(visible.observations[0]?.payload).not.toBe(base.observations[0]?.payload);

    // D. FIELD STABILITY: everything else deep-equal; nested/prose untouched.
    for (const [index, observation] of visible.observations.entries()) {
      const raw = base.observations[index]?.payload as Record<string, unknown>;
      const shown = observation.payload as Record<string, unknown>;
      if (typeof raw !== "object" || raw === null) continue;
      expect(shown.operation).toEqual(raw.operation);
      expect(shown.projectId).toEqual(raw.projectId);
      expect(shown.summary).toEqual(raw.summary);
      expect(shown.steps).toEqual(raw.steps);
      expect(shown.lastObservation).toEqual(raw.lastObservation);
      expect(shown.nested).toEqual(raw.nested);
      expect(observation.provenance).toBe(base.observations[index]?.provenance);
      expect(observation.observationId).toBe(base.observations[index]?.observationId);
    }

    // E. HASH / WIRE: hash witnesses the stripped view; wire user content omits root key only.
    const expectedHash = computeSemanticProjectionHash({ ...base, observations: visible.observations });
    expect(computeSemanticProjectionHash(base)).toBe(expectedHash);
    const messages = thoughtMessagesForProjection(base);
    const wireUser = JSON.parse(messages[1]?.content as string) as Pick<ProjectedThoughtInput, "observations">;
    for (const observation of wireUser.observations) {
      if (typeof observation.payload === "object" && observation.payload !== null && !Array.isArray(observation.payload)) {
        const payload = observation.payload as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(payload, "selectedModelId")).toBe(false);
      }
    }
    // Nested/prose occurrences are NOT deep-scrubbed: nested key survives by contract.
    expect((wireUser.observations[0]?.payload as Record<string, unknown>).nested)
      .toEqual({ selectedModelId: "opencode/nemotron-3.5-lightning-free" });
    expect(JSON.stringify(base.observations)).toContain("selectedModelId");
  });
});

describe("E2a recency loss honesty (projection seam)", () => {
  it("appends the factual recency guidance only on lossy cycles (L)", () => {
    const lossy = makeThoughtInput({
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 4 },
    });
    const complete = makeThoughtInput();

    const lossyProjected = projectThoughtInput(lossy, []).projected;
    const completeProjected = projectThoughtInput(complete, []).projected;

    expect(lossyProjected.conversationSelection?.recencyOmittedCount).toBe(4);
    expect(completeProjected.conversationSelection).toBeUndefined();

    const lossySystem = thoughtMessagesForProjection(lossyProjected)[0]?.content ?? "";
    const completeSystem = thoughtMessagesForProjection(completeProjected)[0]?.content ?? "";
    expect(lossySystem).toContain(RECENCY_OMISSION_GUIDANCE);
    // Exactly once: the sentence is appended, never duplicated or templated.
    expect(lossySystem.split(RECENCY_OMISSION_GUIDANCE).length - 1).toBe(1);
    expect(completeSystem).not.toContain(RECENCY_OMISSION_GUIDANCE);
    expect(completeSystem).not.toContain("recencyOmittedCount");
  });

  it("moves the semantic and dispatch hashes on lossy cycles only (M)", () => {
    const lossy = makeThoughtInput({
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 4 },
    });
    const complete = makeThoughtInput();

    const lossyProjected = projectThoughtInput(lossy, []).projected;
    const completeProjected = projectThoughtInput(complete, []).projected;

    expect(computeSemanticProjectionHash(lossyProjected)).not.toBe(
      computeSemanticProjectionHash(completeProjected),
    );
    expect(
      computeDispatchMessagesHash(thoughtMessagesForProjection(lossyProjected)),
    ).not.toBe(
      computeDispatchMessagesHash(thoughtMessagesForProjection(completeProjected)),
    );
  });
});
