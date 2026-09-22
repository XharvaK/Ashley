import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { ThoughtInput } from "../../../types.js";
import {
  allocateThoughtProjection,
  ALLOCATOR_OMISSION_GUIDANCE,
  RECENCY_OMISSION_GUIDANCE,
  RequiredOverflowError,
  thoughtMessagesForProjection,
  WC_OPTIONAL_OMISSION_GUIDANCE,
} from "../allocator.js";
import { MAX_LOGICAL_SERIALIZED_INPUT_BYTES, estimateRequestInputBytes, estimateRequestTokens } from "../budget.js";
import { parseThoughtSemanticOutput } from "../../parse.js";
import { makeSemanticSettlement } from "../../../test-support.js";
import { buildAllocationCandidates } from "../sections.js";
import { createThoughtStructuralFeedback } from "../../structural-feedback.js";
import { ensureAuthoritativeLineage, openContinuityDb } from "../../../../continuity/db.js";
import { buildOrientationKernel } from "../../orientation-kernel.js";
import type { DomainPointersSection } from "../../domain-pointers.js";
import { buildCoverageManifest } from "../../coverage-manifest.js";
import { modelVisibleThoughtProjection } from "../../projection.js";
import {
  REQUIRED_LEARNED_SELF_BYTES,
  REQUIRED_OBSERVATION_ITEM_BYTES,
} from "../composition-contract.js";
import { mintEffectRef } from "../../../effect/effect-ref.js";

function makeThoughtInput(overrides: Partial<ThoughtInput> = {}): ThoughtInput {
  return {
    cycleId: "cycle-test-1",
    generation: 1,
    occupantId: "occupant-1",
    authorityEpoch: 1,
    trigger: { kind: "owner_message", ref: "msg-1" },
    rawConversation: [
      {
        rowId: "row-1",
        lineageId: "lin-1",
        version: 1,
        conversationId: "conv-1",
        role: "owner",
        text: "Hello Ashley, let's test allocation",
        createdAtMs: Date.now() - 1000,
        discordMessageIds: [],
        reservationId: null,
        producingCycleId: null,
        architectureEpoch: "v0.2.1",
        contentHash: "hash1",
        sourceStatus: "delivered",
        dataClassification: "ordinary",
        secretOmitted: false,
        delivered: true,
      },
    ],
    workingContext: [
      {
        id: "wc-topic-1",
        conversationId: "conv-1",
        type: "topic",
        text: "General discussion about architecture",
        concernId: null,
        sourceTurnIds: [],
        status: "active",
        supersedesId: null,
        updatedGeneration: 1,
      },
      {
        id: "wc-corr-1",
        conversationId: "conv-1",
        type: "correction",
        text: "Important owner correction about database schema",
        concernId: null,
        sourceTurnIds: [],
        status: "active",
        supersedesId: null,
        updatedGeneration: 1,
      },
    ],
    occupancy: [],
    constitution: { constitutional: ["Be truthful"], stableSelf: ["Project Ashley"] },
    learnedSelfSlice: { dispositions: ["disciplined"], interests: ["architecture"] },
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
        triggerTerms: ["architecture"],
        workingContextTopics: [],
        assertionKeys: [],
        includeLogSearch: true,
      },
      hits: [
        {
          kind: "lexical",
          sourceStore: "live_memory",
          ref: "mem:arch:1",
          snippet: "Project Ashley uses SQLite and unprivileged Bubblewrap",
          score: -5.0,
          assertionKey: "mem:arch:1",
          memoryKind: "owner_world_claim",
          dimensions: null,
          dataClassification: "ordinary",
          live: true,
          supportRefs: ["supp-1"],
        },
      ],
      state: "ready",
      miss: false,
    },
    inFlight: [],
    authorityObjections: [],
    runtimeCondition: {
      fallback: false,
      compression: false,
      lookupFailed: false,
      thoughtUnavailable: false,
    },
    rememberDirective: null,
    ...overrides,
  };
}

function makeConversationRows(
  count: number,
  textFor: (index: number) => string,
): ThoughtInput["rawConversation"] {
  return Array.from({ length: count }, (_, index) => ({
    rowId: `synthetic-row-${index}`,
    lineageId: `synthetic-lineage-${index}`,
    version: 1,
    conversationId: "conv-1",
    role: "owner" as const,
    text: textFor(index),
    createdAtMs: index + 1,
    discordMessageIds: [],
    reservationId: null,
    producingCycleId: null,
    architectureEpoch: "v0.2.1" as const,
    contentHash: `synthetic-hash-${index}`,
    sourceStatus: "delivered" as const,
    dataClassification: "ordinary" as const,
    secretOmitted: false,
    delivered: true,
  }));
}

function withSyntheticC2(input: ThoughtInput): ThoughtInput & {
  orientationKernel: ReturnType<typeof buildOrientationKernel>;
  domainPointers: DomainPointersSection;
} {
  const orientationKernel = buildOrientationKernel({
    values: ["synthetic value"],
    boundaries: ["synthetic boundary"],
    stableSelf: ["synthetic stable self"],
    staticOperatingContract: "Synthetic operating contract for allocation pressure tests.",
    capabilityReality: input.capabilityReality,
  });
  const domainPointers: DomainPointersSection = {
    version: 1,
    conversationId: input.rawConversation[0]?.conversationId ?? "conv-1",
    cycleId: input.cycleId,
    pointers: [{
      domain: "synthetic_domain",
      canonicalStore: "synthetic.db:domain",
      entityIds: ["synthetic-entity"],
      status: "active",
      updatedAtMs: 1,
      disposition: "POINTER_ONLY",
      pointerOnly: true,
    }],
    coverageManifest: buildCoverageManifest([{
      domain: "synthetic_domain",
      disposition: "POINTER_ONLY",
      sourceRecordCount: 1,
      eligibleRecordCount: 1,
      candidateIds: ["synthetic-entity"],
      required: false,
      pointerOnly: true,
    }]),
  };
  return { ...input, orientationKernel, domainPointers };
}

describe("Whole-Thought Projection Allocator", () => {
  it("degrades ordinary recent history while retaining the exact current trigger", () => {
    // Fixture calibration (same class as the E2b 16_384 -> 17_000 accommodation):
    // C1 + concern.inspect instruction growth pushes the disclosed final wire
    // ~90 tokens over the 32768 caller envelope at repeat(150), so row pressure
    // eases 150 -> 145. Degradation shape below is unchanged (4 recent rows
    // omitted, trigger retained exactly) with ~720 tokens headroom.
    const rows = makeConversationRows(
      12,
      (index) => `synthetic ordinary recent context row ${index} `.repeat(145),
    );
    const input = withSyntheticC2(makeThoughtInput({
      rawConversation: rows,
      trigger: { kind: "owner_message", ref: rows.at(-1)!.rowId },
    }));

    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      semanticBudgetTokens: 32_768,
      requestId: "req-ordinary-required-overflow-regression",
    });

    const includedIds = allocated.projected.rawConversation.map((row) => row.rowId);
    const omittedRecent = allocated.receipt.decision.omitted.filter(
      (candidate) => candidate.section === "recent_raw",
    );

    expect(allocated.receipt.semanticProjectionEnvelope.maxInputTokens).toBe(32_768);
    expect(includedIds).toContain(rows.at(-1)!.rowId);
    expect(includedIds).toContain(rows.at(-2)!.rowId);
    expect(includedIds).not.toContain(rows[0]!.rowId);
    expect(allocated.receipt.decision.included).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `recent_raw:${rows.at(-1)!.rowId}`, required: true }),
    ]));
    expect(buildAllocationCandidates(input, [])
      .filter((candidate) => candidate.section === "recent_raw" && candidate.required)
      .map((candidate) => candidate.ref)).toEqual(expect.arrayContaining(
        rows.slice(-4).map((row) => row.rowId),
      ));
    expect(buildAllocationCandidates(input, [])
      .find((candidate) => candidate.dialogueProtection === "current_trigger")?.requiredness)
      .toEqual({
        owner: "continuity_adapter",
        predicate: "current_trigger_row_resolved",
        overflow: "fail_closed",
      });
    expect(allocated.receipt.decision.included.find(
      (candidate) => candidate.id === `recent_raw:${rows.at(-1)!.rowId}`,
    )?.requiredness).toEqual({
      owner: "continuity_adapter",
      predicate: "current_trigger_row_resolved",
      overflow: "fail_closed",
    });
    expect(omittedRecent.length).toBeGreaterThan(0);
    expect(allocated.receipt.coverageManifest?.domains).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "recent_raw", disposition: "OMITTED_FOR_BUDGET" }),
    ]));
    expect(allocated.projected.conversationSelection?.omittedEvidenceIds).toEqual(
      expect.arrayContaining(omittedRecent.map((candidate) => candidate.ref)),
    );
    expect(allocated.receipt.requiredOverflow).toBe(false);
    expect(allocated.messages[1]?.content).toContain(rows.at(-1)!.text as string);
  });

  it("keeps every useful row for a small ordinary conversation", () => {
    const rows = makeConversationRows(12, (index) => `small synthetic row ${index}`);
    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({
        rawConversation: rows,
        trigger: { kind: "owner_message", ref: rows.at(-1)!.rowId },
      }),
      semanticBudgetTokens: 9_500,
      requestId: "req-small-ordinary-conversation",
    });

    expect(allocated.projected.rawConversation.map((row) => row.rowId)).toEqual(
      rows.map((row) => row.rowId),
    );
    expect(allocated.receipt.decision.omitted.filter(
      (candidate) => candidate.section === "recent_raw",
    )).toHaveLength(0);
  });

  it("fails before Thought when a required Working Context item exceeds its item bound", () => {
    const input = makeThoughtInput({
      workingContext: [{
        id: "wc-required-too-large",
        conversationId: "conv-1",
        type: "correction",
        text: "required correction ".repeat(80),
        concernId: null,
        sourceTurnIds: ["row-1"],
        status: "active",
        supersedesId: null,
        updatedGeneration: 1,
      }],
    });

    expect(() => allocateThoughtProjection({
      thoughtInput: input,
      requestId: "req-required-wc-item-overflow",
    })).toThrowError(expect.objectContaining({
      section: "working_context_pool",
    }));
  });

  it("fuses an oversized optional Working Context item without semantic summarization", () => {
    const input = makeThoughtInput({
      workingContext: [{
        id: "wc-optional-too-large",
        conversationId: "conv-1",
        type: "topic",
        text: "optional topic ".repeat(80),
        concernId: null,
        sourceTurnIds: ["row-1"],
        status: "active",
        supersedesId: null,
        updatedGeneration: 1,
      }],
    });

    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      requestId: "req-optional-wc-fuse",
    });

    expect(allocated.projected.workingContext).toEqual([]);
    expect(allocated.receipt.decision.omitted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "wc:wc-optional-too-large",
        reason: "fuse",
      }),
    ]));
  });

  it("keeps attachment association and truthful availability metadata with required observations", () => {
    const observation = {
      observationId: "observation-attachment-1",
      cycleId: "cycle-test-1",
      generation: 1,
      derived: false,
      replaySafe: true,
      modality: "image" as const,
      payload: {
        attachmentRef: "attachment-1",
        sourceTurnRef: "row-1",
        availability: "PARTIALLY_AVAILABLE",
        representation: "inline_text_excerpt",
      },
      provenance: "perception:attachment-1",
      dataClassification: "ordinary" as const,
      secretOmitted: false,
    };
    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ observations: [observation] }),
      requestId: "req-observation-attachment-preservation",
    });
    const visible = JSON.parse(allocated.messages[1]?.content ?? "{}") as {
      observations?: unknown[];
    };

    expect(visible.observations).toEqual([observation]);
  });

  it("retains the current trigger and frontier ownership while bounding inline frontier text", () => {
    const rows = makeConversationRows(
      20,
      (index) => `synthetic frontier context row ${index} `.repeat(150),
    );
    const frontierIds = rows.slice(0, 3).map((row) => row.rowId);
    const input = makeThoughtInput({
      rawConversation: rows,
      trigger: { kind: "owner_message", ref: rows.at(-1)!.rowId },
      conversationSelection: {
        frontierIncludedIds: frontierIds,
        omittedEvidenceIds: [],
      },
    });

    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      // The explicit finite operational namespace, its contract law, and the
      // frozen speech.none intentional-silence sentence are part of the
      // model-visible envelope, so retain the same regression scenario with
      // its small required headroom.
      semanticBudgetTokens: 32_768,
      requestId: "req-active-frontier-trigger-regression",
    });

    expect(allocated.projected.rawConversation.map((row) => row.rowId)).toContain(rows.at(-1)!.rowId);
    expect(allocated.projected.conversationSelection?.frontierIncludedIds).toEqual(frontierIds);
    expect(allocated.projected.conversationSelection?.omittedEvidenceIds).toEqual(
      expect.arrayContaining(rows.slice(3, 4).map((row) => row.rowId)),
    );
    expect(allocated.receipt.coverageManifest?.domains).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "recent_raw", disposition: "OMITTED_FOR_BUDGET" }),
    ]));
  });

  it("requires the authoritative current trigger row rather than its superseded predecessor", () => {
    const seedRows = makeConversationRows(
      12,
      (index) => `synthetic lineage pressure row ${index} `.repeat(50),
    );
    const staleTrigger = {
      ...seedRows[0]!,
      rowId: "trigger-lineage-v1",
      lineageId: "trigger-lineage",
      version: 1,
      text: "synthetic stale trigger ".repeat(100),
      createdAtMs: 1,
    };
    const currentTrigger = {
      ...staleTrigger,
      rowId: "trigger-lineage-v2",
      version: 2,
      text: "synthetic authoritative current trigger ".repeat(50),
      createdAtMs: 2,
    };
    const rows = [
      staleTrigger,
      currentTrigger,
      ...seedRows.slice(1).map((row, index) => ({ ...row, createdAtMs: index + 3 })),
    ];
    type LineageAwareThoughtInput = ThoughtInput & {
      conversationSelection: NonNullable<ThoughtInput["conversationSelection"]> & {
        currentTriggerRowId: string;
      };
    };
    const input = withSyntheticC2({
      ...makeThoughtInput({
        rawConversation: rows,
        trigger: { kind: "owner_message", ref: staleTrigger.rowId },
      }),
      conversationSelection: {
        frontierIncludedIds: [],
        omittedEvidenceIds: [],
        currentTriggerRowId: currentTrigger.rowId,
      },
    } as LineageAwareThoughtInput);

    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      // E2b accommodation: truthful retrieval-loss disclosure (~100 estimator
      // tokens for count + guidance) participates in the final wire, so this
      // pressure scenario budgets slightly above its pre-E2b 16_384 tuning.
      // Trigger-lineage assertions below are unchanged.
      semanticBudgetTokens: 17_000,
      requestId: "req-trigger-lineage-pressure",
    });
    const candidateDefinitions = buildAllocationCandidates(input, []);

    expect(allocated.projected.rawConversation.map((row) => row.rowId)).toContain(currentTrigger.rowId);
    expect(allocated.projected.rawConversation.map((row) => row.rowId)).not.toContain(staleTrigger.rowId);
    expect(candidateDefinitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `recent_raw:${currentTrigger.rowId}`, required: true }),
      expect.objectContaining({ id: `recent_raw:${staleTrigger.rowId}`, required: false }),
    ]));
    expect(allocated.receipt.decision.omitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `recent_raw:${staleTrigger.rowId}`, reason: "budget_omission" }),
    ]));
  });

  it("fails closed when the resolved current trigger itself exceeds the envelope", () => {
    const currentTrigger = {
      ...makeConversationRows(1, () => "synthetic current trigger")[0]!,
      rowId: "trigger-lineage-overflow-v2",
      lineageId: "trigger-lineage-overflow",
      version: 2,
      text: "synthetic current trigger overflow ".repeat(20_000),
    };
    const input = withSyntheticC2({
      ...makeThoughtInput({
        rawConversation: [currentTrigger],
        trigger: { kind: "owner_message", ref: "trigger-lineage-overflow-v1" },
      }),
      conversationSelection: {
        frontierIncludedIds: [],
        omittedEvidenceIds: [],
        currentTriggerRowId: currentTrigger.rowId,
      },
    } as ThoughtInput & {
      conversationSelection: NonNullable<ThoughtInput["conversationSelection"]> & {
        currentTriggerRowId: string;
      };
    });

    let error: unknown;
    try {
      allocateThoughtProjection({
        thoughtInput: input,
        semanticBudgetTokens: 9_500,
        requestId: "req-trigger-lineage-overflow",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RequiredOverflowError);
    expect(error).toMatchObject({
      section: "recent_raw",
      semanticBudgetTokens: 9_500,
    });
  });

  it("does not hide a contextual reference failure behind generic correction guidance", () => {
    const input = makeThoughtInput({
      rawConversation: [
        {
          rowId: "turn-1",
          lineageId: "lin-1",
          version: 1,
          conversationId: "conv-1",
          role: "owner",
          text: "Return the effect intent semantic branch.",
          createdAtMs: Date.now() - 1000,
          discordMessageIds: [],
          reservationId: null,
          producingCycleId: null,
          architectureEpoch: "v0.2.1",
          contentHash: "hash1",
          sourceStatus: "delivered",
          dataClassification: "ordinary",
          secretOmitted: false,
          delivered: true,
        },
      ],
      trigger: { kind: "owner_message", ref: "turn-1" },
      retrieval: {
        request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: [],
        state: "ready",
        miss: true,
      },
    });
    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      requestId: "req-contextual-correction",
    });
    const feedback = createThoughtStructuralFeedback({
      code: "reference_not_allowlisted",
      field: "existingRefs",
      allowlistedReferences: ["turn-1"],
    });

    const systemMessage = thoughtMessagesForProjection(allocated.projected, feedback)[0]?.content ?? "";

    expect(systemMessage).toContain("reference_not_allowlisted");
    expect(systemMessage).toContain("existingRefs");
    expect(systemMessage).toContain("host allowlisted reference IDs");
    expect(systemMessage).toContain('["turn-1"]');
    expect(systemMessage).toContain("Do not change the semantic answer or invent authority.");
    expect(systemMessage).not.toContain("Match the semantic Thought contract exactly.");
  });

  it("delivers the governed currentness rule in the assembled Thought system message", () => {
    const input = makeThoughtInput();
    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      requestId: "req-currentness-instruction",
    });
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";

    expect(systemMessage).toContain("governed evidence status, not ordinary conversational recency");
    expect(systemMessage).toContain("does not by itself license");
    expect(systemMessage).toContain("the owner just sent a message");
    expect(systemMessage).toContain('Use time:unknown_freshness');
    expect(systemMessage).toContain('Use time:historical');
    expect(systemMessage).toContain("omit the epistemic commitment");
  });

  it("delivers the observation-relevance and abstain-precedence rule in the assembled Thought system message", () => {
    const input = makeThoughtInput();
    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      requestId: "req-observation-relevance-instruction",
    });
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";

    expect(systemMessage).toContain("can actually supply evidence capable of resolving the current semantic need");
    expect(systemMessage).toContain("availability of an unrelated observation does not justify observation");
    expect(systemMessage).toContain("abstain takes precedence over observation");
  });

  it("allocates complete thought context within the logical semantic envelope", () => {
    const input = makeThoughtInput();
    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      quotaBucket: "groq:openai/gpt-oss-20b", // 8,000 TPM
      requestId: "req-1",
    });

    expect(allocated.receipt.hardTpm).toBe(8000);
    expect(allocated.receipt.estimatedInputTokens).toBeGreaterThan(0);
    expect(allocated.receipt.estimatedInputTokens)
      .toBeLessThanOrEqual(allocated.receipt.semanticProjectionEnvelope.maxInputTokens);
    expect(allocated.receipt.headroomTokens).toBeGreaterThanOrEqual(0);
    expect(allocated.receipt.compression).toBe(false);
    expect(allocated.projected.workingContext.length).toBe(2);
    expect(allocated.projected.retrieval.hits.length).toBe(1);
    expect(allocated.hashes.semanticProjectionHash).toBeDefined();
    expect(allocated.hashes.dispatchMessagesHash).toBeDefined();
  });

  it("omits optional candidates when the logical envelope is restricted, marking compression", () => {
    // Generate many optional retrieval hits and topics
    const manyHits = Array.from({ length: 50 }, (_, i) => ({
      kind: "lexical" as const,
      sourceStore: "live_memory" as const,
      ref: `mem:item:${i}`,
      snippet: `A large snippet of text with lots of words repeated to take up context space ${i} `.repeat(20),
      score: -1.0,
      assertionKey: `mem:item:${i}`,
      memoryKind: "owner_world_claim" as const,
      dimensions: null,
      dataClassification: "ordinary" as const,
      live: true,
      supportRefs: [],
    }));

    const input = makeThoughtInput({
      retrieval: {
        request: { triggerTerms: ["test"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: manyHits,
        state: "ready",
        miss: false,
      },
    });

    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-compressed",
    });

    expect(allocated.receipt.compression).toBe(true);
    expect(allocated.projected.runtimeCondition.compression).toBe(true);
    expect(allocated.receipt.decision.omitted.length).toBeGreaterThan(0);
    expect(allocated.receipt.decision.omitted[0].reason).toBe("budget_omission");
    expect(allocated.receipt.decision.omitted[0]).toMatchObject({
      required: false,
      priority: 18,
      estimatedTokens: expect.any(Number),
    });
    expect(allocated.receipt.estimatedInputTokens)
      .toBeLessThanOrEqual(allocated.receipt.semanticProjectionEnvelope.maxInputTokens);
    expect(allocated.receipt.tokenBreakdown.omitted_for_budget_count)
      .toBe(allocated.receipt.decision.omitted.length);
  });

  it("fails closed when a genuinely mandatory section exceeds the envelope", () => {
    const rows = makeConversationRows(1, () => "current synthetic trigger");
    const input = {
      ...makeThoughtInput({
        rawConversation: rows,
        trigger: { kind: "owner_message", ref: rows[0]!.rowId },
      }),
      orientationKernel: buildOrientationKernel({
        values: ["synthetic value"],
        boundaries: ["synthetic boundary"],
        stableSelf: [],
        staticOperatingContract: "mandatory orientation payload ".repeat(20_000),
        capabilityReality: makeThoughtInput().capabilityReality,
      }),
    };

    let error: unknown;
    try {
      allocateThoughtProjection({
        thoughtInput: input,
        semanticBudgetTokens: 9_500,
        requestId: "req-mandatory-overflow",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RequiredOverflowError);
    expect(error).toMatchObject({
      section: "orientation_kernel",
      semanticBudgetTokens: 9_500,
    });
    expect((error as RequiredOverflowError).estimatedInputTokens).toBeGreaterThan(9_500);
  });

  it("uses token pressure rather than a fixed required turn count", () => {
    const tinyRows = makeConversationRows(18, (index) => `tiny synthetic row ${index}`);
    const tiny = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({
        rawConversation: tinyRows,
        trigger: { kind: "owner_message", ref: tinyRows.at(-1)!.rowId },
      }),
      // Calibrated above the legacy 9_500 default: the normative interim-hold
      // law and the concern-authority separation law in the code-owned Thought
      // instruction moved fixed contract overhead, so the fit case carries
      // matching headroom. The pressure behavior below (large rows trim, tiny
      // rows fit) is unchanged.
      semanticBudgetTokens: 10_500,
      requestId: "req-token-driven-tiny-rows",
    });

    const largeRows = makeConversationRows(
      10,
      (index) => `large synthetic row ${index} `.repeat(300),
    );
    const large = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({
        rawConversation: largeRows,
        trigger: { kind: "owner_message", ref: largeRows.at(-1)!.rowId },
      }),
      semanticBudgetTokens: 32_768,
      requestId: "req-token-driven-large-rows",
    });

    expect(tiny.projected.rawConversation).toHaveLength(18);
    expect(tiny.receipt.decision.omitted.filter(
      (candidate) => candidate.section === "recent_raw",
    )).toHaveLength(0);
    expect(large.projected.rawConversation.map((row) => row.rowId)).toContain(largeRows.at(-1)!.rowId);
    expect(large.receipt.decision.omitted.filter(
      (candidate) => candidate.section === "recent_raw",
    ).length).toBeGreaterThan(0);
  });

  it("records provider-independent semantic budget and per-pass component token breakdown", () => {
    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput(),
      quotaBucket: "groq:openai/gpt-oss-20b",
      semanticProjectionEnvelope: {
        id: "test-envelope",
        version: 1,
        maxInputTokens: 9500,
      },
      requestId: "req-breakdown",
    });

    expect(allocated.receipt.semanticProjectionEnvelope.maxInputTokens).toBe(9500);
    expect(allocated.receipt.tokenBreakdown.static_contract_tokens).toBeGreaterThan(0);
    expect(allocated.receipt.tokenBreakdown.conversation_tokens).toBeGreaterThan(0);
    expect(allocated.receipt.tokenBreakdown.working_context_tokens).toBeGreaterThan(0);
    expect(allocated.receipt.tokenBreakdown.learned_self_tokens).toBeGreaterThan(0);
    expect(allocated.receipt.tokenBreakdown.retrieval_tokens).toBeGreaterThan(0);
    expect(allocated.receipt.tokenBreakdown.omitted_for_budget_count).toBe(0);
    expect(allocated.receipt.tokenBreakdown.required_overflow_count).toBe(0);
  });

  it("bounds available social destinations inside the projection allocator", () => {
    const availableDestinations = Array.from({ length: 12 }, (_, index) => ({
      audience: { kind: "dm" as const, principalId: `person-${index}` },
      source: "social_permit" as const,
      permitScope: "dm_only" as const,
    }));
    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ availableDestinations }),
      requestId: "req-destination-bound",
    });

    expect(allocated.projected.availableDestinations).toHaveLength(8);
    expect(allocated.projected.availableDestinations?.[0]).toEqual(availableDestinations[0]);
  });

  it("records mechanical W0 projection geometry and allocation operation counts", () => {
    const input = withSyntheticC2(makeThoughtInput());
    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      requestId: "req-w0-allocation-diagnostics",
    });
    const diagnostics = allocated.receipt.diagnostics;
    const candidateCount =
      allocated.receipt.decision.included.length + allocated.receipt.decision.omitted.length;
    const systemMessageBytes = Buffer.byteLength(allocated.messages[0]?.content ?? "", "utf8");

    expect(diagnostics).toMatchObject({
      system_message_bytes: systemMessageBytes,
      orientation_kernel_bytes: expect.any(Number),
      required_base_estimated_tokens: expect.any(Number),
      optional_context_estimated_tokens: expect.any(Number),
      system_prefix_bytes: systemMessageBytes,
      system_prefix_estimated_tokens: allocated.receipt.tokenBreakdown.static_contract_tokens,
      candidate_S0_S1_prefix_bytes: expect.any(Number),
      candidate_S0_S1_prefix_estimated_tokens: expect.any(Number),
      first_volatile_field: "rawConversation",
      first_volatile_byte_offset: expect.any(Number),
      allocation_candidate_count: candidateCount,
      renderTentative_call_count: candidateCount + 1,
      thoughtMessagesForProjection_call_count: candidateCount + 1,
      allocation_elapsed_ms: expect.any(Number),
    });
    expect(allocated.receipt.tokenBreakdown.static_contract_tokens)
      .toBe(Math.ceil(systemMessageBytes / 2));
    expect(allocated.receipt.tokenBreakdown.identity_kernel_tokens).toBeGreaterThan(0);
    expect(diagnostics?.orientation_kernel_bytes).toBeGreaterThan(0);
    expect(diagnostics?.candidate_S0_S1_prefix_bytes).toBeGreaterThan(systemMessageBytes);
    expect(diagnostics?.allocation_elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(diagnostics)).not.toContain("Hello Ashley");
  });

  it("uses stable-first visible key ordering without changing projected keys or values", () => {
    const allocated = allocateThoughtProjection({
      thoughtInput: withSyntheticC2(makeThoughtInput()),
      requestId: "req-w1-key-order",
    });
    const visible = modelVisibleThoughtProjection(allocated.projected);
    const serialized = JSON.parse(allocated.messages[1]?.content ?? "{}") as Record<string, unknown>;

    expect(Object.keys(serialized)).toEqual([
      "orientationKernel",
      "learnedSelfSlice",
      "occupantId",
      "authorityEpoch",
      "workingContext",
      "occupancy",
      "domainPointers",
      "rawConversation",
      "retrieval",
      "cycleId",
      "generation",
      "trigger",
      "observations",
      "inFlight",
      "allowedOperationalEffectRefs",
      "authorityObjections",
      "runtimeCondition",
      "rememberDirective",
    ]);
    expect(Object.keys(serialized).sort()).toEqual(Object.keys(visible).sort());
    expect(serialized).toEqual(visible);
  });

  it("keeps the stable prefix byte-identical when only cycle and trigger data change", () => {
    const first = allocateThoughtProjection({
      thoughtInput: withSyntheticC2(makeThoughtInput({
        cycleId: "cycle-w1-first",
        generation: 1,
        trigger: { kind: "owner_message", ref: "trigger-w1-first" },
      })),
      requestId: "req-w1-prefix-first",
    });
    const second = allocateThoughtProjection({
      thoughtInput: withSyntheticC2(makeThoughtInput({
        cycleId: "cycle-w1-second",
        generation: 2,
        trigger: { kind: "owner_message", ref: "trigger-w1-second" },
      })),
      requestId: "req-w1-prefix-second",
    });

    const firstJson = first.messages[1]?.content ?? "";
    const secondJson = second.messages[1]?.content ?? "";
    const firstS1End = firstJson.indexOf(',"workingContext":');
    const secondS1End = secondJson.indexOf(',"workingContext":');

    expect(firstS1End).toBeGreaterThan(0);
    expect(secondS1End).toBeGreaterThan(0);
    expect(firstJson.slice(0, firstS1End)).toBe(secondJson.slice(0, secondS1End));
    expect(JSON.parse(firstJson).cycleId).not.toBe(JSON.parse(secondJson).cycleId);
    expect(JSON.parse(firstJson).trigger).not.toEqual(JSON.parse(secondJson).trigger);
    expect(first.receipt.diagnostics?.first_volatile_field).toBe("rawConversation");
    expect(second.receipt.diagnostics?.first_volatile_field).toBe("rawConversation");
  });

  it("invalidates the stable prefix when canonical identity changes", () => {
    const unchanged = allocateThoughtProjection({
      thoughtInput: withSyntheticC2(makeThoughtInput()),
      requestId: "req-w1-identity-unchanged",
    });
    const changedInput = withSyntheticC2(makeThoughtInput());
    changedInput.orientationKernel = {
      ...changedInput.orientationKernel,
      values: ["changed canonical identity"],
    };
    const changed = allocateThoughtProjection({
      thoughtInput: changedInput,
      requestId: "req-w1-identity-changed",
    });

    const unchangedJson = unchanged.messages[1]?.content ?? "";
    const changedJson = changed.messages[1]?.content ?? "";
    const unchangedS1End = unchangedJson.indexOf(',"workingContext":');
    const changedS1End = changedJson.indexOf(',"workingContext":');

    expect(unchangedS1End).toBeGreaterThan(0);
    expect(changedS1End).toBeGreaterThan(0);
    expect(unchangedJson.slice(0, unchangedS1End))
      .not.toBe(changedJson.slice(0, changedS1End));
  });

  it("memoizes invariant message construction per allocation without changing output or estimation", () => {
    const feedback = createThoughtStructuralFeedback({
      code: "wrong_type",
      field: "speech.mode",
      previousCandidate: { kind: "settlement" },
    });
    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({
        inFlight: [{
          effectId: "effect-w4-memo",
          cycleId: "cycle-test-1",
          generation: 1,
          wakeId: null,
          correlationId: "correlation-w4-memo",
          idempotencyKey: "idempotency-w4-memo",
          status: "in_flight",
          dispatchedAtMs: 1,
          originJobId: null,
          originEventId: null,
          originAttemptId: null,
        }],
      }),
      structuralFeedback: feedback,
      requestId: "req-w4-local-memo",
    });
    const rebuilt = thoughtMessagesForProjection(allocated.projected, feedback);
    const rebuiltEstimate = estimateRequestTokens(rebuilt, {
      maxTokens: allocated.receipt.maxOutputTokens,
    });

    expect(allocated.messages).toEqual(rebuilt);
    expect(rebuiltEstimate).toEqual({
      estimatedInputTokens: allocated.receipt.estimatedInputTokens,
      estimatedOutputTokens: allocated.receipt.estimatedOutputTokens,
    });
    expect(allocated.receipt.diagnostics).toMatchObject({
      thoughtOutputCompatibilityInstruction_call_count: 1,
      formatThoughtStructuralFeedback_call_count: 1,
      formatThoughtStructuralCorrectionData_call_count: 1,
      inFlightEffectRefMap_call_count: 1,
    });
    expect(allocated.projected.inFlight).toEqual([{
      effectRef: expect.any(String),
      status: "in_flight",
    }]);
  });

  it("does not carry a request-local message memo across allocations", () => {
    const first = allocateThoughtProjection({
      thoughtInput: makeThoughtInput(),
      structuralFeedback: "wrong_type",
      requestId: "req-w4-first-memo",
    });
    const second = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ cycleId: "cycle-w4-second" }),
      structuralFeedback: "invalid_enum",
      requestId: "req-w4-second-memo",
    });

    expect(first.messages[0]?.content).toContain("wrong_type");
    expect(second.messages[0]?.content).toContain("invalid_enum");
    expect(second.messages[0]?.content).not.toContain("wrong_type");
    expect(first.receipt.diagnostics?.thoughtOutputCompatibilityInstruction_call_count).toBe(1);
    expect(second.receipt.diagnostics?.thoughtOutputCompatibilityInstruction_call_count).toBe(1);
  });

  it("attaches a structured coverage manifest to the allocation receipt", () => {
    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput(),
      requestId: "req-coverage-manifest",
    });

    expect(allocated.receipt.coverageManifest).toBeDefined();
    expect(allocated.receipt.coverageManifest?.version).toBe(1);
    expect(allocated.receipt.coverageManifest?.domains.length).toBeGreaterThan(0);
    expect(allocated.receipt.coverageManifest?.dispositionCounts.INCLUDED).toBeGreaterThan(0);
  });

  it("applies the authoritative tombstone on the production allocation path before payload inclusion", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    try {
      const { lineageId } = ensureAuthoritativeLineage(continuity, {
        nuclearSchemaVersion: 44,
        buildIdentity: "mat2-test",
      });
      continuity.prepare(
        `INSERT INTO forget_tombstones
           (tombstone_id, owner_id, lineage_id, status, created_at)
         VALUES (?, ?, ?, 'applied', ?)`,
      ).run("tombstone-row-1", "owner-1", lineageId, new Date().toISOString());
      continuity.prepare(
        `INSERT INTO forget_tombstone_targets
           (tombstone_id, entity_type, entity_uuid, action)
         VALUES (?, ?, ?, 'redact')`,
      ).run("tombstone-row-1", "conversation_evidence_log", "row-1");

      const allocated = allocateThoughtProjection({
        thoughtInput: makeThoughtInput(),
        requestId: "req-tombstone-production-path",
        continuityDb: continuity,
      } as Parameters<typeof allocateThoughtProjection>[0]);

      expect(allocated.projected.rawConversation).toEqual([]);
      expect(allocated.receipt.coverageManifest?.domains).toEqual(expect.arrayContaining([
        expect.objectContaining({
          domain: "recent_raw",
          disposition: "INELIGIBLE",
          candidate_ids: ["recent_raw:row-1"],
        }),
      ]));
    } finally {
      continuity.close();
    }
  });

  it("bounds active-frontier inline text while retaining every frontier identity in coverage metadata", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      rowId: `frontier-row-${index}`,
      lineageId: `frontier-lineage-${index}`,
      version: 1,
      conversationId: "conv-1",
      role: "owner" as const,
      text: `frontier evidence ${index} `.repeat(160),
      createdAtMs: index + 1,
      discordMessageIds: [],
      reservationId: null,
      producingCycleId: null,
      architectureEpoch: "v0.2.1" as const,
      contentHash: `frontier-hash-${index}`,
      sourceStatus: "delivered" as const,
      dataClassification: "ordinary" as const,
      secretOmitted: false,
      delivered: true,
    }));
    const frontierInput = makeThoughtInput({ rawConversation: rows }) as ThoughtInput & {
      conversationSelection: {
        frontierIncludedIds: string[];
        omittedEvidenceIds: string[];
      };
    };
    frontierInput.conversationSelection = {
      frontierIncludedIds: rows.map((row) => row.rowId),
      omittedEvidenceIds: [],
    };

    const allocated = allocateThoughtProjection({
      thoughtInput: frontierInput,
      semanticBudgetTokens: 32_768,
      requestId: "req-frontier-bounded",
    });

    expect(allocated.projected.rawConversation.length).toBeLessThan(rows.length);
    expect(allocated.projected.conversationSelection?.frontierIncludedIds).toEqual(
      rows.map((row) => row.rowId),
    );
    expect(allocated.projected.conversationSelection?.omittedEvidenceIds.length).toBeGreaterThan(0);
    expect(allocated.receipt.coverageManifest?.domains).toEqual(expect.arrayContaining([
      expect.objectContaining({
        domain: "recent_raw",
        disposition: "OMITTED_FOR_BUDGET",
      }),
    ]));
  });

  it("bounds required observations by newest eligible generation and item bytes", () => {
    const observations = [
      {
        observationId: "observation-too-large",
        cycleId: "cycle-test-1",
        generation: 100,
        derived: false,
        replaySafe: true,
        modality: "text" as const,
        payload: { text: "oversized observation ".repeat(100) },
        provenance: "test:oversized",
        dataClassification: "ordinary" as const,
        secretOmitted: false,
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        observationId: `observation-${index + 1}`,
        cycleId: "cycle-test-1",
        generation: index + 1,
        derived: false,
        replaySafe: true,
        modality: "text" as const,
        payload: { text: `observation ${index + 1}` },
        provenance: `test:${index + 1}`,
        dataClassification: "ordinary" as const,
        secretOmitted: false,
      })),
    ];

    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ observations }),
      semanticBudgetTokens: 32_768,
      requestId: "req-required-observation-local-contract",
    });
    const visible = modelVisibleThoughtProjection(allocated.projected) as {
      observations: typeof observations;
    };

    expect(visible.observations).toHaveLength(8);
    expect(visible.observations.map((observation) => observation.observationId)).toEqual([
      "observation-10",
      "observation-9",
      "observation-8",
      "observation-7",
      "observation-6",
      "observation-5",
      "observation-4",
      "observation-3",
    ]);
    expect(visible.observations.every(
      (observation) => JSON.stringify(observation).length <= REQUIRED_OBSERVATION_ITEM_BYTES,
    )).toBe(true);
    expect(visible.observations.some(
      (observation) => observation.observationId === "observation-too-large",
    )).toBe(false);
  });

  it("fails closed when no required observation can fit its local item bound", () => {
    const observations = Array.from({ length: 2 }, (_, index) => ({
      observationId: `observation-overflow-${index}`,
      cycleId: "cycle-test-1",
      generation: index + 1,
      derived: false,
      replaySafe: true,
      modality: "text" as const,
      payload: { text: "oversized observation ".repeat(100) },
      provenance: `test:overflow:${index}`,
      dataClassification: "ordinary" as const,
      secretOmitted: false,
    }));

    expect(() => allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ observations }),
      requestId: "req-required-observation-local-overflow",
    })).toThrowError(expect.objectContaining({
      section: "observations",
    }));
  });

  it("drops linked learned-self entries before the broad slice at its local byte bound", () => {
    const broadOrientation = {
      dispositions: ["broad disposition"],
      interests: ["broad interest"],
      supportRefs: ["broad-support"],
      audienceScope: { kind: "owner_private" as const },
      protectionStatus: "admitted" as const,
    };
    const learnedSelfSlice = {
      dispositions: ["broad disposition", "linked detail ".repeat(100)],
      interests: ["broad interest"],
      supportRefs: ["broad-support", "linked-support"],
      broadOrientation,
      personLinked: [{
        audience: { kind: "dm" as const, principalId: "person-1" },
        dispositions: ["linked detail ".repeat(100)],
        interests: [],
        sourceRefs: ["linked-source"],
        supportRefs: ["linked-support"],
        protectionStatus: "admitted" as const,
      }],
    };

    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ learnedSelfSlice }),
      semanticBudgetTokens: 32_768,
      requestId: "req-learned-self-local-contract",
    });
    const visible = modelVisibleThoughtProjection(allocated.projected) as {
      learnedSelfSlice: typeof learnedSelfSlice;
    };

    expect(Buffer.byteLength(JSON.stringify(visible.learnedSelfSlice), "utf8"))
      .toBeLessThanOrEqual(REQUIRED_LEARNED_SELF_BYTES);
    expect(visible.learnedSelfSlice.dispositions).toEqual(["broad disposition"]);
    expect(visible.learnedSelfSlice.interests).toEqual(["broad interest"]);
    expect(visible.learnedSelfSlice.supportRefs).toEqual(["broad-support"]);
    expect(visible.learnedSelfSlice).not.toHaveProperty("personLinked");
  });

  it("fails closed when the broad learned-self slice remains over its local byte bound", () => {
    const learnedSelfSlice = {
      dispositions: ["broad disposition ".repeat(100)],
      interests: [],
      broadOrientation: {
        dispositions: ["broad disposition ".repeat(100)],
        interests: [],
        audienceScope: { kind: "owner_private" as const },
        protectionStatus: "admitted" as const,
      },
      personLinked: [],
    };

    expect(() => allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ learnedSelfSlice }),
      requestId: "req-learned-self-local-overflow",
    })).toThrowError(expect.objectContaining({
      section: "learned_self",
    }));
  });

  it("keeps the highest-priority newest occupancy rows and exact in-flight effect IDs", () => {
    const occupancy = Array.from({ length: 15 }, (_, index) => ({
      conversationId: "conv-1",
      concernId: `concern-${index}`,
      status: "active" as const,
      priority: index % 5,
      updatedCycle: "cycle-test-1",
      updatedGeneration: index,
    }));
    const inFlight = ["effect-z", "effect-a", "effect-m"].map((effectId, index) => ({
      effectId,
      cycleId: "cycle-test-1",
      generation: 1,
      wakeId: null,
      correlationId: `correlation-${effectId}`,
      idempotencyKey: `idempotency-${effectId}`,
      status: "in_flight" as const,
      dispatchedAtMs: index + 1,
      originJobId: null,
      originEventId: null,
      originAttemptId: null,
    }));
    const expectedOccupancy = [...occupancy]
      .sort((left, right) => right.priority - left.priority
        || right.updatedGeneration - left.updatedGeneration
        || left.concernId.localeCompare(right.concernId))
      .slice(0, 12)
      .map((row) => row.concernId);

    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ occupancy, inFlight }),
      semanticBudgetTokens: 32_768,
      requestId: "req-occupancy-inflight-local-contract",
    });

    expect(allocated.projected.occupancy.map((row) => row.concernId))
      .toEqual(expectedOccupancy);
    expect(allocated.projected.inFlight.map((row) => row.effectRef)).toEqual([
      mintEffectRef("cycle-test-1", 1, "effect-a"),
      mintEffectRef("cycle-test-1", 1, "effect-m"),
      mintEffectRef("cycle-test-1", 1, "effect-z"),
    ]);
  });
});

describe("E2a recency loss honesty (allocator)", () => {
  it("carries recencyOmittedCount through allocation without touching budget semantics", () => {
    const rows = makeConversationRows(3, (index) => `small e2a row ${index}`);
    const input = makeThoughtInput({
      rawConversation: rows,
      trigger: { kind: "owner_message", ref: rows.at(-1)!.rowId },
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 7 },
    });

    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2a-carry",
    });

    expect(allocated.projected.rawConversation.map((row) => row.rowId)).toEqual(
      rows.map((row) => row.rowId),
    );
    expect(allocated.projected.conversationSelection?.recencyOmittedCount).toBe(7);
    expect(allocated.projected.conversationSelection?.omittedEvidenceIds).toEqual([]);
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage).toContain(RECENCY_OMISSION_GUIDANCE);
  });

  it("keeps budget omissions and the recency count separate under envelope pressure (J+K)", () => {
    const rows = makeConversationRows(
      12,
      (index) => `synthetic e2a pressure row ${index} `.repeat(150),
    );
    const input = withSyntheticC2(makeThoughtInput({
      rawConversation: rows,
      trigger: { kind: "owner_message", ref: rows.at(-1)!.rowId },
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 5 },
    }));

    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      semanticBudgetTokens: 32_768,
      requestId: "req-e2a-both-losses",
    });

    const omittedRecent = allocated.receipt.decision.omitted.filter(
      (candidate) => candidate.section === "recent_raw",
    );
    expect(omittedRecent.length).toBeGreaterThan(0);
    // Budgeting leaves the pre-allocation recency count exactly unchanged.
    expect(allocated.projected.conversationSelection?.recencyOmittedCount).toBe(5);
    expect(allocated.projected.conversationSelection?.omittedEvidenceIds).toEqual(
      expect.arrayContaining(omittedRecent.map((candidate) => candidate.ref)),
    );
    // Every wire omission ID is a budget ref; no recency-excluded ID is minted.
    for (const id of allocated.projected.conversationSelection?.omittedEvidenceIds ?? []) {
      expect(omittedRecent.map((candidate) => candidate.ref)).toContain(id);
    }
  });

  it("emits no count and no guidance on complete cycles", () => {
    const rows = makeConversationRows(3, (index) => `small complete row ${index}`);
    const input = makeThoughtInput({
      rawConversation: rows,
      trigger: { kind: "owner_message", ref: rows.at(-1)!.rowId },
    });

    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2a-complete",
    });

    expect(allocated.projected.conversationSelection).toBeUndefined();
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage).not.toContain(RECENCY_OMISSION_GUIDANCE);
    expect(systemMessage).not.toContain("recencyOmittedCount");
  });

  it("moves hashes on lossy cycles only", () => {
    const rows = makeConversationRows(3, (index) => `small hash row ${index}`);
    const base = makeThoughtInput({
      rawConversation: rows,
      trigger: { kind: "owner_message", ref: rows.at(-1)!.rowId },
    });
    const lossy = makeThoughtInput({
      rawConversation: rows,
      trigger: { kind: "owner_message", ref: rows.at(-1)!.rowId },
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 7 },
    });

    const complete = allocateThoughtProjection({
      thoughtInput: base,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2a-hash-complete",
    });
    const lossyAllocated = allocateThoughtProjection({
      thoughtInput: lossy,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2a-hash-lossy",
    });

    expect(lossyAllocated.hashes.semanticProjectionHash).not.toBe(
      complete.hashes.semanticProjectionHash,
    );
    expect(lossyAllocated.hashes.dispatchMessagesHash).not.toBe(
      complete.hashes.dispatchMessagesHash,
    );
    // Deterministic: the same lossy input hashes identically.
    const lossyAgain = allocateThoughtProjection({
      thoughtInput: lossy,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2a-hash-lossy-again",
    });
    expect(lossyAgain.hashes).toEqual(lossyAllocated.hashes);
  });
});

describe("E2b retrieval loss honesty (allocator)", () => {
  function makeRetrievalHits(count: number, snippetRepeat = 20): ThoughtInput["retrieval"]["hits"] {
    return Array.from({ length: count }, (_, i) => ({
      kind: "lexical" as const,
      sourceStore: "live_memory" as const,
      ref: `mem:e2b:${i}`,
      snippet: `E2b calibration snippet ${i} with filler words to consume budget `.repeat(snippetRepeat),
      score: -1.0,
      assertionKey: `mem:e2b:${i}`,
      memoryKind: "owner_world_claim" as const,
      dimensions: null,
      dataClassification: "ordinary" as const,
      live: true,
      supportRefs: [],
    }));
  }

  function retrievalInput(hitCount: number, snippetRepeat = 20, miss = false): ThoughtInput {
    return makeThoughtInput({
      retrieval: {
        request: { triggerTerms: ["e2b"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: makeRetrievalHits(hitCount, snippetRepeat),
        state: "ready",
        miss,
      },
    });
  }

  function omittedRetrievalRefs(allocated: ReturnType<typeof allocateThoughtProjection>): string[] {
    return allocated.receipt.decision.omitted
      .filter((candidate) => candidate.section === "retrieval_compact")
      .map((candidate) => String(candidate.ref ?? candidate.id));
  }

  // Full-budget probe: estimated input tokens when everything fits. Scans
  // start here so they only walk the loss-transition window (fast).
  let probeCounter = 0;
  function fitEstimate(input: ThoughtInput): number {
    probeCounter += 1;
    return allocateThoughtProjection({
      thoughtInput: input,
      semanticBudgetTokens: 32_768,
      requestId: `req-e2b-probe-${probeCounter}`,
    }).receipt.estimatedInputTokens;
  }
  // Deterministic downward budget scan. Returns the first (largest) budget at
  // or below `from` whose allocation succeeds and satisfies `want`. Stops at
  // the first RequiredOverflowError (smaller budgets only fail harder).
  function scanBudget(
    input: ThoughtInput,
    from: number,
    step: number,
    want: (allocated: ReturnType<typeof allocateThoughtProjection>) => boolean,
    tag: string,
    extra?: Omit<Parameters<typeof allocateThoughtProjection>[0], "thoughtInput" | "semanticBudgetTokens" | "requestId">,
  ): { budget: number; allocated: ReturnType<typeof allocateThoughtProjection> } {
    for (let budget = from; budget > 0; budget -= step) {
      let allocated: ReturnType<typeof allocateThoughtProjection>;
      try {
        allocated = allocateThoughtProjection({
          thoughtInput: input,
          semanticBudgetTokens: budget,
          requestId: `req-e2b-scan-${tag}-${budget}`,
          ...extra,
        });
      } catch (caught) {
        // Base/required failure is monotonic (smaller budgets only fail
        // harder) — stop. Disclosure-shell failures are NOT monotonic: below
        // a retrieval_loss_disclosure throw, fewer hits fit and allocation
        // may succeed again with higher omission — keep scanning down.
        if (caught instanceof RequiredOverflowError) {
          if ((caught as RequiredOverflowError).section === "retrieval_loss_disclosure") continue;
          break;
        }
        throw caught;
      }
      if (want(allocated!)) return { budget, allocated: allocated! };
    }
    throw new Error(`e2b calibration scan found no matching budget (${tag})`);
  }

  it("preserves a genuine source retrieval miss with no count and no guidance (A)", () => {
    const allocated = allocateThoughtProjection({
      thoughtInput: retrievalInput(0, 20, true),
      semanticBudgetTokens: 9_500,
      requestId: "req-e2b-genuine-miss",
    });

    expect(allocated.projected.retrieval.miss).toBe(true);
    expect(allocated.projected.retrieval.hits).toEqual([]);
    expect(allocated.projected.retrieval.allocatorOmittedCount).toBeUndefined();
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage).not.toContain(ALLOCATOR_OMISSION_GUIDANCE);
    expect(systemMessage).not.toContain("allocatorOmittedCount");
  });

  it("emits no count and no guidance when all retrieval hits fit (B)", () => {
    const input = retrievalInput(3, 4);
    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2b-all-fit",
    });

    expect(allocated.projected.retrieval.miss).toBe(false);
    expect(allocated.projected.retrieval.hits.length).toBe(3);
    expect(allocated.projected.retrieval.allocatorOmittedCount).toBeUndefined();
    const messages = thoughtMessagesForProjection(allocated.projected);
    const systemMessage = messages[0]?.content ?? "";
    expect(systemMessage).not.toContain(ALLOCATOR_OMISSION_GUIDANCE);
    expect(JSON.stringify(messages)).not.toContain("allocatorOmittedCount");
    // Deterministic complete cycle (same input object: allocation is pure).
    const again = allocateThoughtProjection({
      thoughtInput: input,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2b-all-fit-again",
    });
    expect(again.hashes).toEqual(allocated.hashes);
  });

  it("discloses an exact partial allocator omission with source miss preserved (C)", () => {
    const allocated = allocateThoughtProjection({
      thoughtInput: retrievalInput(20, 60),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2b-partial",
    });

    const included = allocated.projected.retrieval.hits.length;
    expect(included).toBeGreaterThan(0);
    expect(included).toBeLessThan(20);
    // Exact reconciliation: count = eligible total - included.
    expect(allocated.projected.retrieval.allocatorOmittedCount).toBe(20 - included);
    // Source truth preserved: retrieval found hits, so miss is false even
    // though the allocator shed some of them.
    expect(allocated.projected.retrieval.miss).toBe(false);
    expect(omittedRetrievalRefs(allocated).length).toBe(20 - included);
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage).toContain(ALLOCATOR_OMISSION_GUIDANCE);
    expect(systemMessage.split(ALLOCATOR_OMISSION_GUIDANCE).length - 1).toBe(1);
    // Real-loss disclosure fits: receipt truth holds.
    expect(allocated.receipt.estimatedInputTokens)
      .toBeLessThanOrEqual(allocated.receipt.semanticProjectionEnvelope.maxInputTokens);
    expect(allocated.receipt.headroomTokens).toBeGreaterThanOrEqual(0);
  });

  it("repairs miss truth on total allocator omission with exact count (D)", () => {
    const input = retrievalInput(4, 6);
    // Self-calibrate: largest budget where packing succeeds but zero retrieval
    // hits survive. Base/required content still fits (no throw).
    const { allocated } = scanBudget(
      input, fitEstimate(input), 25,
      (candidate) => candidate.projected.retrieval.hits.length === 0,
      "total-omission",
    );

    expect(allocated.projected.retrieval.miss).toBe(false);
    expect(allocated.projected.retrieval.hits).toEqual([]);
    expect(allocated.projected.retrieval.allocatorOmittedCount).toBe(4);
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage).toContain(ALLOCATOR_OMISSION_GUIDANCE);
    expect(omittedRetrievalRefs(allocated).length).toBe(4);
  });

  it("preserves unavailable infrastructure state verbatim (E)", () => {
    const withHit = makeThoughtInput({
      retrieval: {
        request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: makeRetrievalHits(1, 4),
        state: "unavailable",
        miss: false,
      },
    });
    const allocated = allocateThoughtProjection({
      thoughtInput: withHit,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2b-unavailable-hit",
    });
    expect(allocated.projected.retrieval.state).toBe("unavailable");
    expect(allocated.projected.retrieval.miss).toBe(false);
    expect(allocated.projected.retrieval.hits.length).toBe(1);
    expect(allocated.projected.retrieval.allocatorOmittedCount).toBeUndefined();

    const empty = makeThoughtInput({
      retrieval: {
        request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: [],
        state: "unavailable",
        miss: false,
      },
    });
    const emptyAllocated = allocateThoughtProjection({
      thoughtInput: empty,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2b-unavailable-empty",
    });
    expect(emptyAllocated.projected.retrieval.state).toBe("unavailable");
    expect(emptyAllocated.projected.retrieval.miss).toBe(false);
    expect(emptyAllocated.projected.retrieval.allocatorOmittedCount).toBeUndefined();
  });

  it("gives tombstoned retrieval candidates zero denominator and zero count (F)", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    try {
      const { lineageId } = ensureAuthoritativeLineage(continuity, {
        nuclearSchemaVersion: 44,
        buildIdentity: "e2b-test",
      });
      continuity.prepare(
        `INSERT INTO forget_tombstones
           (tombstone_id, owner_id, lineage_id, status, created_at)
         VALUES (?, ?, ?, 'applied', ?)`,
      ).run("tombstone-e2b-1", "owner-1", lineageId, new Date().toISOString());
      continuity.prepare(
        `INSERT INTO forget_tombstone_targets
           (tombstone_id, entity_type, entity_uuid, action)
         VALUES (?, ?, ?, 'redact')`,
      ).run("tombstone-e2b-1", "sidecar_memory_assertions", "mem:e2b:0");
      // NOTE: a redacted-shape compact retrieval hit is not constructible
      // through the existing seam (CompactRetrievalEvidence carries no
      // redacted/sourceStatus fields and the live continuity context carries
      // no redactedEntityIds). The design forbids adding a seam merely to
      // make redaction testable; the tombstone below proves the
      // invalidationReason gate that excludes redacted rows identically.

      // Tombstoned mem:e2b:0 + 3 eligible normals; force exactly 1 omission
      // among the normals. If the tombstoned row leaked into the denominator,
      // the count would read 2 instead of 1.
      const input = retrievalInput(4, 6);
      const { allocated } = scanBudget(
        input, fitEstimate(input), 25,
        (candidate) => (candidate.projected.retrieval.allocatorOmittedCount ?? 0) === 1,
        "tombstone-one-omission",
        { continuityDb: continuity },
      );

      expect(allocated.projected.retrieval.allocatorOmittedCount).toBe(1);
      expect(allocated.projected.retrieval.hits.map((hit) => hit.ref)).not.toContain("mem:e2b:0");
      const wire = JSON.stringify(modelVisibleThoughtProjection(allocated.projected));
      expect(wire).not.toContain("mem:e2b:0");
      expect(allocated.receipt.coverageManifest?.domains).toEqual(expect.arrayContaining([
        expect.objectContaining({ disposition: "INELIGIBLE" }),
      ]));
      // Eligible reconciliation: 2 included normals + 1 omitted normal = 3
      // eligible; the tombstoned row is in neither set.
      expect(allocated.projected.retrieval.hits.length).toBe(2);
      expect(omittedRetrievalRefs(allocated)).toHaveLength(1);
    } finally {
      continuity.close();
    }
  });

  it("keeps omitted refs off the wire and unallowlisted for evidence use", () => {
    const allocated = allocateThoughtProjection({
      thoughtInput: retrievalInput(20, 60),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2b-refs",
    });
    const omitted = omittedRetrievalRefs(allocated);
    expect(omitted.length).toBeGreaterThan(0);
    const includedRefs = new Set(allocated.projected.retrieval.hits.map((hit) => hit.ref));
    const wire = JSON.stringify(modelVisibleThoughtProjection(allocated.projected));
    for (const ref of omitted) {
      expect(includedRefs.has(ref)).toBe(false);
      expect(wire).not.toContain(ref);
    }
    // Parse-level enforcement with the projected-hits allowlist (mirrors the
    // retrieval clause of semanticReferencesForInput in run.ts, which derives
    // the live allowlist from allocated.projected only).
    const allowlist = new Set<string>([
      ...allocated.projected.retrieval.hits.flatMap((hit) =>
        "supportRefs" in hit && Array.isArray(hit.supportRefs) ? [hit.ref, ...hit.supportRefs] : [hit.ref]),
      allocated.projected.trigger.ref,
    ]);
    // Shape mirrors epistemic-binding.test.ts: a well-typed claim citing the
    // omitted ref, so the ONLY failure is the allowlist rejection.
    const draft = "citing unseen evidence";
    const forged = makeSemanticSettlement({
      speech: { mode: "draft", surfaceDraft: draft },
      commitments: {
        epistemic: [{
          dimensions: {
            source: "tool",
            status: "asserted",
            time: "historical",
            reliability: "fallible_observation",
          },
          statement: "x",
          surfaceSpan: draft,
          observationRefs: [omitted[0]!],
        }],
        conversational: ["answer"],
      },
      evidenceUse: { retrievalRefsUsed: [omitted[0]!] },
    });
    expect(parseThoughtSemanticOutput(forged, allowlist)).toMatchObject({
      ok: false,
      code: "reference_not_allowlisted",
    });
  });

  it("keeps E2a recency loss and E2b retrieval loss independent", () => {
    const input = makeThoughtInput({
      retrieval: {
        request: { triggerTerms: ["e2b"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: makeRetrievalHits(50, 20),
        state: "ready",
        miss: false,
      },
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 5 },
    });
    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      semanticBudgetTokens: 32_768,
      requestId: "req-e2b-e2a-joint",
    });

    const retrievalCount = allocated.projected.retrieval.allocatorOmittedCount ?? 0;
    expect(retrievalCount).toBeGreaterThan(0);
    expect(allocated.projected.retrieval.allocatorOmittedCount)
      .toBe(50 - allocated.projected.retrieval.hits.length);
    // E2a untouched: pre-allocation count carried exactly, never merged.
    expect(allocated.projected.conversationSelection?.recencyOmittedCount).toBe(5);
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage.split(RECENCY_OMISSION_GUIDANCE).length - 1).toBe(1);
    expect(systemMessage.split(ALLOCATOR_OMISSION_GUIDANCE).length - 1).toBe(1);
  });

  it("makes identical packing decisions with and without survivable retrieval (packing equivalence)", () => {
    const input = retrievalInput(6, 12);
    const { allocated } = scanBudget(
      input, fitEstimate(input), 25,
      (candidate) => (candidate.projected.retrieval.allocatorOmittedCount ?? 0) > 0,
      "packing-lossy",
    );
    // Control: same input with retrieval truncated to exactly the survivors.
    // Non-retrieval candidates are decided before the retrieval block under
    // identical tentatives (final-only disclosure), so their decisions must
    // match exactly.
    const survivors = allocated.projected.retrieval.hits.map((hit) => hit.ref);
    const control = makeThoughtInput({
      retrieval: {
        request: { triggerTerms: ["e2b"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: makeRetrievalHits(6, 12).filter((hit) => survivors.includes(hit.ref)),
        state: "ready",
        miss: false,
      },
    });
    const controlAllocated = allocateThoughtProjection({
      thoughtInput: control,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2b-packing-control",
    });

    const decisions = (value: ReturnType<typeof allocateThoughtProjection>) => ({
      included: value.receipt.decision.included
        .filter((candidate) => candidate.section !== "retrieval_compact")
        .map((candidate) => candidate.id),
      omitted: value.receipt.decision.omitted
        .filter((candidate) => candidate.section !== "retrieval_compact")
        .map((candidate) => `${candidate.id}:${candidate.reason}`),
    });
    expect(decisions(allocated)).toEqual(decisions(controlAllocated));
  });

  it("fails closed with retrieval_loss_disclosure when disclosure overflows a custom envelope", () => {
    // Analytic construction (no scan): measure base wire and per-hit cost,
    // then size a budget where HEAD-identical packing sheds every hit yet the
    // truthful disclosure itself does not fit the caller envelope.
    const hitCount = 4;
    const baseTokens = allocateThoughtProjection({
      thoughtInput: retrievalInput(0, 6),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2b-overflow-base",
    }).receipt.estimatedInputTokens;
    const fullTokens = fitEstimate(retrievalInput(hitCount, 10));
    const hitTokens = (fullTokens - baseTokens) / hitCount;
    // Exact disclosure byte cost: scalar JSON + separator + guidance sentence.
    const disclosureBytes = Buffer.byteLength(`"allocatorOmittedCount":${hitCount},`, "utf8")
      + 1
      + Buffer.byteLength(ALLOCATOR_OMISSION_GUIDANCE, "utf8");
    const disclosureTokens = Math.ceil(disclosureBytes / 2) + 2;
    // Guards: hits are individually larger than the disclosure shortfall, so
    // zero hits fit while the disclosure overflows.
    expect(hitTokens).toBeGreaterThan(disclosureTokens);
    const failingBudget = baseTokens + disclosureTokens - 5;
    expect(failingBudget).toBeGreaterThan(baseTokens);

    let error: unknown;
    try {
      allocateThoughtProjection({
        thoughtInput: retrievalInput(hitCount, 10),
        semanticBudgetTokens: failingBudget,
        requestId: "req-e2b-overflow-fail",
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RequiredOverflowError);
    expect(error).toMatchObject({
      section: "retrieval_loss_disclosure",
      semanticBudgetTokens: failingBudget,
    });
    expect((error as RequiredOverflowError).estimatedInputTokens).toBeGreaterThan(failingBudget);
    // The failure is the scoped semantic gate, not the global byte ceiling:
    // the disclosed wire stays orders of magnitude below it.
    expect((baseTokens + disclosureTokens) * 2).toBeLessThan(MAX_LOGICAL_SERIALIZED_INPUT_BYTES / 4);

    // Contrast: with room for disclosure the same loss shape succeeds.
    const okBudget = baseTokens + disclosureTokens + Math.ceil(hitTokens) + 50;
    const ok = allocateThoughtProjection({
      thoughtInput: retrievalInput(hitCount, 10),
      semanticBudgetTokens: okBudget,
      requestId: "req-e2b-overflow-ok",
    });
    expect((ok.projected.retrieval.allocatorOmittedCount ?? 0)).toBeGreaterThan(0);
    expect(ok.receipt.estimatedInputTokens).toBeLessThanOrEqual(okBudget);
  });

  it("fits truthful disclosure with non-negative headroom when loss is real (fits)", () => {
    const allocated = allocateThoughtProjection({
      thoughtInput: retrievalInput(6, 12),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2b-fits",
    });
    const count = allocated.projected.retrieval.allocatorOmittedCount ?? 0;
    expect(count).toBe(6 - allocated.projected.retrieval.hits.length);
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    if (count > 0) {
      expect(systemMessage.split(ALLOCATOR_OMISSION_GUIDANCE).length - 1).toBe(1);
    } else {
      expect(systemMessage).not.toContain(ALLOCATOR_OMISSION_GUIDANCE);
    }
    expect(allocated.receipt.estimatedInputTokens).toBeLessThanOrEqual(32_768);
    expect(allocated.receipt.headroomTokens).toBeGreaterThanOrEqual(0);
  });

  it("keeps complete near-budget cycles free of E2b effects (near boundary A)", () => {
    const probe = allocateThoughtProjection({
      thoughtInput: retrievalInput(3, 4),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2b-near-probe",
    });
    const tight = probe.receipt.estimatedInputTokens + 25;
    const allocated = allocateThoughtProjection({
      thoughtInput: retrievalInput(3, 4),
      semanticBudgetTokens: tight,
      requestId: "req-e2b-near-tight",
    });
    // The unrelated optional WC topic still survives; no count, no guidance,
    // no E2b-specific failure at the tight budget.
    expect(allocated.projected.workingContext.map((item) => item.id)).toContain("wc-topic-1");
    expect(allocated.projected.retrieval.hits.length).toBe(3);
    expect(allocated.projected.retrieval.allocatorOmittedCount).toBeUndefined();
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage).not.toContain(ALLOCATOR_OMISSION_GUIDANCE);
  });

  it("transitions exactly at the first real omission with no stale count (near boundary B)", () => {
    const input = retrievalInput(4, 8);
    // Largest budget with exactly one omission...
    const { budget: lossBudget, allocated: lossy } = scanBudget(
      input, fitEstimate(input), 5,
      (candidate) => (candidate.projected.retrieval.allocatorOmittedCount ?? 0) === 1,
      "first-omission",
    );
    expect(lossy.projected.retrieval.allocatorOmittedCount).toBe(1);
    const lossSystem = thoughtMessagesForProjection(lossy.projected)[0]?.content ?? "";
    expect(lossSystem).toContain(ALLOCATOR_OMISSION_GUIDANCE);
    // ...and the all-fit side one step above shows nothing. Scan upward from
    // the loss budget for the first budget with zero omission.
    let fitBudget = lossBudget;
    for (let budget = lossBudget + 1; budget <= 9_500; budget += 1) {
      const candidate = allocateThoughtProjection({
        thoughtInput: input,
        semanticBudgetTokens: budget,
        requestId: `req-e2b-fit-scan-${budget}`,
      });
      if ((candidate.projected.retrieval.allocatorOmittedCount ?? 0) === 0) {
        fitBudget = budget;
        const fitSystem = thoughtMessagesForProjection(candidate.projected)[0]?.content ?? "";
        expect(fitSystem).not.toContain(ALLOCATOR_OMISSION_GUIDANCE);
        expect(candidate.projected.retrieval.hits.length).toBe(4);
        break;
      }
    }
    expect(fitBudget).toBeGreaterThan(lossBudget);
  });

  it("renders exact counts across the 10 to 9 digit boundary (near boundary C)", () => {
    const input = retrievalInput(10, 8);
    const { allocated: one } = scanBudget(
      input, fitEstimate(input), 5,
      (candidate) => (candidate.projected.retrieval.allocatorOmittedCount ?? 0) === 1,
      "digit-one",
    );
    expect(one.projected.retrieval.allocatorOmittedCount).toBe(1);
    expect(one.projected.retrieval.hits.length).toBe(9);
    // Denominator total is exactly 10: 9 included + 1 budget-omitted.
    expect(omittedRetrievalRefs(one)).toHaveLength(1);
    const { allocated: none } = scanBudget(
      input, fitEstimate(input), 5,
      (candidate) => candidate.projected.retrieval.hits.length === 0,
      "digit-none",
    );
    expect(none.projected.retrieval.allocatorOmittedCount).toBe(10);
    expect(JSON.stringify(none.projected.retrieval)).toContain('"allocatorOmittedCount":10');
  });

  it("moves hashes on lossy retrieval cycles and stays deterministic", () => {
    const base = retrievalInput(3, 4);
    const complete = allocateThoughtProjection({
      thoughtInput: base,
      semanticBudgetTokens: 9_500,
      requestId: "req-e2b-hash-complete",
    });
    const heavy = retrievalInput(20, 60);
    const pressure = allocateThoughtProjection({
      thoughtInput: heavy,
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2b-hash-lossy",
    });
    expect(pressure.projected.retrieval.allocatorOmittedCount).toBeGreaterThan(0);
    expect(pressure.hashes.semanticProjectionHash).not.toBe(complete.hashes.semanticProjectionHash);
    expect(pressure.hashes.dispatchMessagesHash).not.toBe(complete.hashes.dispatchMessagesHash);
    // Deterministic: same input object reallocates identically.
    const again = allocateThoughtProjection({
      thoughtInput: heavy,
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2b-hash-lossy-again",
    });
    expect(again.hashes).toEqual(pressure.hashes);
  });
});

describe("E2c optional Working Context loss honesty (allocator)", () => {
  // One large optional topic at quota pressure: the E2b suite's
  // request/response pair proves this envelope sheds optionals while keeping
  // required sections. WC item text mirrors the proven E2b snippet shape.
  function makeWcItem(
    id: string,
    type: ThoughtInput["workingContext"][number]["type"],
    textRepeat = 8,
  ): ThoughtInput["workingContext"][number] {
    return {
      id,
      conversationId: "conv-1",
      type,
      text: `E2c calibration ${type} ${id} with filler words to consume budget `.repeat(textRepeat),
      concernId: null,
      sourceTurnIds: [],
      status: "active",
      supersedesId: null,
      updatedGeneration: 1,
    };
  }

  // E2c loss fixtures: large optional WC items using the proven E2b
  // snippet-repeat shape (repeat 60). At the groq pressure envelope the
  // allocator sheds optional WC wholesale (all-or-nothing at this item
  // size), so tests pin exact count + wholesale shape rather than partial
  // survival: count == eligible total, included == 0. Partial-survival
  // reconciliation is covered by the packing-equivalence control (L) and
  // the tombstone test (I), where survivors exist.
  function largeWcItems(
    prefix: string,
    count: number,
    types: Array<ThoughtInput["workingContext"][number]["type"]>,
  ): ThoughtInput["workingContext"] {
    return Array.from({ length: count }, (_, i) =>
      makeWcItem(`${prefix}-${i}`, types[i % types.length]!, 60));
  }

  function wcInput(
    items: ThoughtInput["workingContext"],
    retrievalHits: ThoughtInput["retrieval"]["hits"] = [],
  ): ThoughtInput {
    return makeThoughtInput({
      workingContext: items,
      retrieval: {
        request: { triggerTerms: ["e2c"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: retrievalHits,
        state: "ready",
        miss: retrievalHits.length === 0,
      },
    });
  }

  function omittedWcSections(
    allocated: ReturnType<typeof allocateThoughtProjection>,
  ): string[] {
    return allocated.receipt.decision.omitted
      .filter((candidate) =>
        candidate.section === "working_context_topic" ||
        candidate.section === "working_context_other")
      .map((candidate) => candidate.section);
  }

  // Candidate-flow oracle would couple this block to allocator internals if
  // rebuilt here, so reuse the same section namespace through the public
  // receipt truth plus the projected scalar (both allocator-authored).
  function includedOptionalWc(
    allocated: ReturnType<typeof allocateThoughtProjection>,
  ): number {
    return allocated.receipt.decision.included.filter((candidate) =>
      candidate.section === "working_context_topic" ||
      candidate.section === "working_context_other").length;
  }

  it("emits no count and no guidance when optional Working Context fits (A)", () => {
    const items = [
      makeWcItem("wc-e2c-topic-1", "topic", 2),
      makeWcItem("wc-e2c-other-1", "owner_teaching", 2),
    ];
    const allocated = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      semanticBudgetTokens: 9_500,
      requestId: "req-e2c-complete",
    });

    expect(allocated.projected.workingContext.map((item) => item.id))
      .toEqual(expect.arrayContaining(["wc-e2c-topic-1", "wc-e2c-other-1"]));
    expect(allocated.projected.workingContextSelection).toBeUndefined();
    const messages = thoughtMessagesForProjection(allocated.projected);
    const systemMessage = messages[0]?.content ?? "";
    expect(systemMessage).not.toContain(WC_OPTIONAL_OMISSION_GUIDANCE);
    expect(JSON.stringify(messages)).not.toContain("optionalAllocatorOmittedCount");
    // Strict shape: never an empty selection object.
    expect("workingContextSelection" in allocated.projected).toBe(false);
    // Deterministic: identical input content reallocates identically (fresh
    // objects — requestId is not part of the projection/hash identity, but
    // reusing one object would prove nothing about determinism).
    const again = allocateThoughtProjection({
      thoughtInput: wcInput([
        makeWcItem("wc-e2c-topic-1", "topic", 2),
        makeWcItem("wc-e2c-other-1", "owner_teaching", 2),
      ]),
      semanticBudgetTokens: 9_500,
      requestId: "req-e2c-complete-again",
    });
    expect(again.projected.workingContextSelection).toBeUndefined();
    expect(again.projected.workingContext.map((item) => item.id))
      .toEqual(allocated.projected.workingContext.map((item) => item.id));
  });

  it("discloses wholesale topic omission with exact count (C)", () => {
    const items = largeWcItems("wc-e2c-topic", 6, ["topic"]);
    const allocated = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-topic-loss",
    });

    // Wholesale shed at this item size: all 6 eligible topic items omitted.
    const count = allocated.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0;
    expect(count).toBe(6);
    expect(Number.isInteger(count)).toBe(true);
    expect(allocated.projected.workingContext).toEqual([]);
    // Receipt oracle in the shared section namespace: omitted rows sum to count.
    expect(omittedWcSections(allocated)).toHaveLength(count);
    // No subtype-specific omission metadata anywhere.
    const wire = JSON.stringify(modelVisibleThoughtProjection(allocated.projected));
    expect(wire).not.toContain("topicOmittedCount");
    expect(wire).not.toContain("otherOmittedCount");
    expect(wire).not.toContain("ownerTeachingOmittedCount");
    expect(wire).not.toContain("questionOmittedCount");
    expect(wire).not.toContain("fuseCount");
    expect(wire).not.toContain("budgetOmissionCount");
    // Omitted IDs/text stay off the projected array.
    const includedIds = new Set(allocated.projected.workingContext.map((item) => item.id));
    for (const row of allocated.receipt.decision.omitted) {
      if (row.section === "working_context_topic" || row.section === "working_context_other") {
        expect(includedIds.has(String(row.ref ?? row.id))).toBe(false);
      }
    }
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage.split(WC_OPTIONAL_OMISSION_GUIDANCE).length - 1).toBe(1);
    expect(allocated.receipt.estimatedInputTokens)
      .toBeLessThanOrEqual(allocated.receipt.semanticProjectionEnvelope.maxInputTokens);
  });

  it("discloses wholesale other-type omission with the same pooled field (D)", () => {
    const items = largeWcItems("wc-e2c-other", 6, ["owner_teaching", "question"]);
    const allocated = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-other-loss",
    });

    const count = allocated.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0;
    expect(count).toBe(6);
    expect(allocated.projected.workingContext).toEqual([]);
    expect(omittedWcSections(allocated)).toHaveLength(count);
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage.split(WC_OPTIONAL_OMISSION_GUIDANCE).length - 1).toBe(1);
  });

  it("pools topic and other omissions into one count without subtype metadata (E)", () => {
    const items = largeWcItems("wc-e2c-mix", 6, ["topic", "owner_teaching"]);
    const allocated = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-pooled-loss",
    });

    const count = allocated.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0;
    expect(count).toBe(6);
    expect(allocated.projected.workingContext).toEqual([]);
    const wire = JSON.stringify(modelVisibleThoughtProjection(allocated.projected));
    expect(wire).not.toContain("topicOmittedCount");
    expect(wire).not.toContain("otherOmittedCount");
    expect(wire).not.toContain("fuseCount");
    expect(wire).not.toContain("budgetOmissionCount");
    // The pooled reasons are budget_omission (these items fit the item fuse).
    expect(new Set(omittedWcSections(allocated))).toEqual(new Set(["working_context_topic", "working_context_other"]));
  });

  it("counts an oversized optional topic fuse exactly once (F)", () => {
    // One oversized topic (local fuse) + one fitting topic under a generous
    // envelope: the oversized item is eligible but fuse-skipped, so the
    // section-symmetric count reads exactly 1.
    const oversized = { ...makeWcItem("wc-e2c-fuse-1", "topic", 2), text: "x".repeat(4_096) };
    const fitting = makeWcItem("wc-e2c-fuse-2", "topic", 2);
    const allocated = allocateThoughtProjection({
      thoughtInput: wcInput([oversized, fitting]),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-fuse",
    });

    expect(allocated.projected.workingContextSelection?.optionalAllocatorOmittedCount).toBe(1);
    expect(allocated.projected.workingContext.map((item) => item.id)).toEqual(["wc-e2c-fuse-2"]);
    const fuseRows = allocated.receipt.decision.omitted.filter(
      (candidate) => candidate.section === "working_context_topic" && candidate.reason === "fuse",
    );
    expect(fuseRows).toHaveLength(1);
  });

  it("leaves the WC count unaffected by an oversized desk fuse (G)", () => {
    const oversizedDesk = {
      id: "desk-e2c-1",
      concernRef: null,
      body: "y".repeat(4_096),
      authorKind: "owner" as const,
      sourceRefs: [],
      verbatim: true,
      form: "note" as const,
      endorsementRef: null,
      audienceScope: { kind: "owner_private" as const },
      lifecycle: "active" as const,
      supersededBy: null,
      updatedCycle: "cycle-test-1",
      updatedGeneration: 1,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    const allocated = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({ deskEntries: [oversizedDesk] }),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-desk-fuse",
    });

    expect(allocated.receipt.decision.omitted.map((row) => row.section)).toContain("desk_entry");
    expect(allocated.receipt.decision.omitted.find(
      (row) => row.section === "desk_entry",
    )?.reason).toBe("fuse");
    expect(allocated.projected.workingContextSelection).toBeUndefined();
    expect(allocated.projected.workingContext.map((item) => item.id)).toContain("wc-topic-1");
  });

  it("keeps required correction fail-closed and never counted (H)", () => {
    const correction = {
      ...makeWcItem("wc-e2c-corr-1", "correction", 2),
      text: "z".repeat(60_000),
    };
    let error: unknown;
    try {
      allocateThoughtProjection({
        thoughtInput: wcInput([correction]),
        semanticBudgetTokens: 32_768,
        requestId: "req-e2c-required-overflow",
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RequiredOverflowError);
    expect(error).toMatchObject({
      section: "working_context_pool",
      semanticBudgetTokens: 32_768,
    });
  });

  it("preserves required referent/repair/commitment requiredness and priority", () => {
    const input = makeThoughtInput();
    const candidates = buildAllocationCandidates(input, []);
    const bySection = (section: string) =>
      candidates.find((candidate) => candidate.section === section);
    expect(bySection("working_context_referent")).toBeUndefined();
    expect(bySection("working_context_repair")).toBeUndefined();
    expect(bySection("working_context_commitment")).toBeUndefined();
    // The fixture carries correction; requiredness/priority/owner come from
    // the frozen adapter contract, not E2c.
    expect(bySection("working_context_correction")).toMatchObject({
      required: true,
      priority: 12,
    });
    expect(bySection("working_context_correction")?.requiredness).toEqual({
      owner: "working_context_adapter",
      predicate: "required_item_type_present",
      overflow: "fail_closed",
    });
    const requiredInput = wcInput([
      makeWcItem("wc-e2c-ref-1", "referent", 2),
      makeWcItem("wc-e2c-rep-1", "repair", 2),
      makeWcItem("wc-e2c-com-1", "commitment_temp", 2),
    ]);
    const requiredCandidates = buildAllocationCandidates(requiredInput, []);
    expect(requiredCandidates.find((c) => c.section === "working_context_referent"))
      .toMatchObject({ required: true, priority: 13 });
    expect(requiredCandidates.find((c) => c.section === "working_context_repair"))
      .toMatchObject({ required: true, priority: 14 });
    expect(requiredCandidates.find((c) => c.section === "working_context_commitment"))
      .toMatchObject({ required: true, priority: 15 });
    const allocated = allocateThoughtProjection({
      thoughtInput: requiredInput,
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-required-fit",
    });
    expect(allocated.projected.workingContextSelection).toBeUndefined();
    expect(allocated.projected.workingContext.map((item) => item.id)).toEqual(
      expect.arrayContaining(["wc-e2c-ref-1", "wc-e2c-rep-1", "wc-e2c-com-1"]),
    );
  });

  it("gives tombstoned optional WC zero denominator and zero count (I)", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    try {
      const { lineageId } = ensureAuthoritativeLineage(continuity, {
        nuclearSchemaVersion: 44,
        buildIdentity: "e2c-test",
      });
      continuity.prepare(
        `INSERT INTO forget_tombstones
           (tombstone_id, owner_id, lineage_id, status, created_at)
         VALUES (?, ?, ?, 'applied', ?)`,
      ).run("tombstone-e2c-1", "owner-1", lineageId, new Date().toISOString());
      continuity.prepare(
        `INSERT INTO forget_tombstone_targets
           (tombstone_id, entity_type, entity_uuid, action)
         VALUES (?, ?, ?, 'redact')`,
      ).run("tombstone-e2c-1", "working_context_items", "wc-e2c-tomb-0");

      // Tombstoned wc-e2c-tomb-0 + 8 eligible normals at the wholesale
      // shape: all 8 normals shed, so the count reads exactly 8. If the
      // tombstoned row leaked into the denominator, it would read 9.
      const items = [
        makeWcItem("wc-e2c-tomb-0", "topic", 2),
        ...largeWcItems("wc-e2c-tomb-n", 8, ["topic"]),
      ];
      const allocated = allocateThoughtProjection({
        thoughtInput: wcInput(items),
        quotaBucket: "groq:openai/gpt-oss-20b",
        requestId: "req-e2c-tombstone",
        continuityDb: continuity,
      });

      const count = allocated.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0;
      expect(count).toBe(8);
      expect(allocated.projected.workingContext).toEqual([]);
      const wire = JSON.stringify(modelVisibleThoughtProjection(allocated.projected));
      expect(wire).not.toContain("wc-e2c-tomb-0");
      expect(allocated.receipt.coverageManifest?.domains).toEqual(expect.arrayContaining([
        expect.objectContaining({ disposition: "INELIGIBLE" }),
      ]));
    } finally {
      continuity.close();
    }
  });

  it("reconciles eligible optional WC as included plus count with receipt rows (J/K)", () => {
    const items = largeWcItems("wc-e2c-recon", 6, ["topic", "owner_teaching"]);
    const allocated = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-reconcile",
    });

    const count = allocated.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0;
    expect(count).toBe(6);
    const included = includedOptionalWc(allocated);
    const omitted = omittedWcSections(allocated).length;
    // Section-symmetric reconciliation: 6 eligible = included + count.
    expect(included + count).toBe(items.length);
    // Receipt reconciliation: fuse + budget_omission rows sum to the count.
    expect(omitted).toBe(count);
    const reasons = allocated.receipt.decision.omitted
      .filter((candidate) =>
        candidate.section === "working_context_topic" ||
        candidate.section === "working_context_other")
      .map((candidate) => candidate.reason);
    expect(reasons.length).toBe(count);
    for (const reason of reasons) {
      expect(["fuse", "budget_omission"]).toContain(reason);
    }
    expect(allocated.receipt.tokenBreakdown.omitted_for_budget_count).toBeGreaterThanOrEqual(count);
  });

  it("makes identical packing decisions with and without shed optional WC (packing equivalence L)", () => {
    const items = Array.from({ length: 6 }, (_, i) => makeWcItem(`wc-e2c-pack-${i}`, "topic", 25));
    const probe = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-pack-probe",
    });
    // Find a lossy budget at full-envelope scale; then verify non-WC
    // decisions match a control truncated to exactly the survivors.
    let lossy = probe;
    let lossBudget = 32_768;
    for (let budget = 32_768; budget > 4_000; budget -= 250) {
      const candidate = allocateThoughtProjection({
        thoughtInput: wcInput(items),
        semanticBudgetTokens: budget,
        requestId: `req-e2c-pack-scan-${budget}`,
      });
      if ((candidate.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0) > 0) {
        lossy = candidate;
        lossBudget = budget;
        break;
      }
    }
    expect(lossy.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0)
      .toBeGreaterThan(0);
    const survivors = new Set(lossy.projected.workingContext.map((item) => item.id));
    const control = allocateThoughtProjection({
      thoughtInput: wcInput(items.filter((item) => survivors.has(item.id))),
      semanticBudgetTokens: lossBudget,
      requestId: "req-e2c-pack-control",
    });
    const decisions = (value: ReturnType<typeof allocateThoughtProjection>) => ({
      included: value.receipt.decision.included
        .filter((candidate) => !candidate.section.startsWith("working_context"))
        .map((candidate) => candidate.id),
      omitted: value.receipt.decision.omitted
        .filter((candidate) => !candidate.section.startsWith("working_context"))
        .map((candidate) => `${candidate.id}:${candidate.reason}`),
    });
    expect(decisions(lossy)).toEqual(decisions(control));
  });

  it("keeps E2a, E2b, and E2c independent on a joint-fit cycle (M)", () => {
    // Joint probe result (measured): 8 large WC items + 20 large retrieval
    // hits at the groq envelope sheds all WC (count 8) and some retrieval.
    const items = largeWcItems("wc-e2c-joint", 8, ["topic"]);
    const retrievalHits = Array.from({ length: 20 }, (_, i) => ({
      kind: "lexical" as const,
      sourceStore: "live_memory" as const,
      ref: `mem:e2c:${i}`,
      snippet: `E2b calibration snippet ${i} with filler words to consume budget `.repeat(60),
      score: -1.0,
      assertionKey: `mem:e2c:${i}`,
      memoryKind: "owner_world_claim" as const,
      dimensions: null,
      dataClassification: "ordinary" as const,
      live: true,
      supportRefs: [],
    }));
    const input = makeThoughtInput({
      workingContext: items,
      retrieval: {
        request: { triggerTerms: ["e2c"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
        hits: retrievalHits,
        state: "ready",
        miss: false,
      },
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 5 },
    });
    const allocated = allocateThoughtProjection({
      thoughtInput: input,
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-joint-fit",
    });

    const wcCount = allocated.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0;
    const retCount = allocated.projected.retrieval.allocatorOmittedCount ?? 0;
    expect(wcCount).toBeGreaterThan(0);
    expect(retCount).toBeGreaterThan(0);
    expect(wcCount).toBe(items.length - allocated.projected.workingContext.length);
    expect(retCount).toBe(retrievalHits.length - allocated.projected.retrieval.hits.length);
    expect(allocated.projected.conversationSelection?.recencyOmittedCount).toBe(5);
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage.split(RECENCY_OMISSION_GUIDANCE).length - 1).toBe(1);
    expect(systemMessage.split(ALLOCATOR_OMISSION_GUIDANCE).length - 1).toBe(1);
    expect(systemMessage.split(WC_OPTIONAL_OMISSION_GUIDANCE).length - 1).toBe(1);
    expect(allocated.receipt.estimatedInputTokens)
      .toBeLessThanOrEqual(allocated.receipt.semanticProjectionEnvelope.maxInputTokens);
  });

  it("keeps E2b-only overflow at retrieval_loss_disclosure (N)", () => {
    // Shipped-E2b analytic construction, unchanged: hits shed, disclosure
    // overflows the caller envelope. E2c adds nothing (fixture WC fits), so
    // the combined gate must reduce to the E2b section exactly.
    const hitCount = 4;
    const makeHits = (count: number) => Array.from({ length: count }, (_, i) => ({
      kind: "lexical" as const,
      sourceStore: "live_memory" as const,
      ref: `mem:e2c:n:${i}`,
      snippet: `E2c calibration snippet ${i} with filler words to consume budget `.repeat(10),
      score: -1.0,
      assertionKey: `mem:e2c:n:${i}`,
      memoryKind: "owner_world_claim" as const,
      dimensions: null,
      dataClassification: "ordinary" as const,
      live: true,
      supportRefs: [],
    }));
    const baseTokens = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({
        workingContext: [makeWcItem("wc-e2c-n-fit", "topic", 2)],
        retrieval: {
          request: { triggerTerms: ["e2c"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
          hits: [],
          state: "ready",
          miss: true,
        },
      }),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-overflow-base",
    }).receipt.estimatedInputTokens;
    const fullTokens = allocateThoughtProjection({
      thoughtInput: makeThoughtInput({
        workingContext: [makeWcItem("wc-e2c-n-fit", "topic", 2)],
        retrieval: {
          request: { triggerTerms: ["e2c"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
          hits: makeHits(hitCount),
          state: "ready",
          miss: false,
        },
      }),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-overflow-full",
    }).receipt.estimatedInputTokens;
    const hitTokens = (fullTokens - baseTokens) / hitCount;
    const disclosureBytes = Buffer.byteLength(`"allocatorOmittedCount":${hitCount},`, "utf8")
      + 1
      + Buffer.byteLength(ALLOCATOR_OMISSION_GUIDANCE, "utf8");
    const disclosureTokens = Math.ceil(disclosureBytes / 2) + 2;
    expect(hitTokens).toBeGreaterThan(disclosureTokens);
    const failingBudget = baseTokens + disclosureTokens - 5;
    expect(failingBudget).toBeGreaterThan(baseTokens);

    let error: unknown;
    try {
      allocateThoughtProjection({
        thoughtInput: makeThoughtInput({
          workingContext: [makeWcItem("wc-e2c-n-fit", "topic", 2)],
          retrieval: {
            request: { triggerTerms: ["e2c"], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
            hits: makeHits(hitCount),
            state: "ready",
            miss: false,
          },
        }),
        semanticBudgetTokens: failingBudget,
        requestId: "req-e2c-overflow-e2b-only",
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RequiredOverflowError);
    expect(error).toMatchObject({
      section: "retrieval_loss_disclosure",
      semanticBudgetTokens: failingBudget,
    });
    expect((error as RequiredOverflowError).estimatedInputTokens).toBeGreaterThan(failingBudget);
    expect((baseTokens + disclosureTokens) * 2).toBeLessThan(MAX_LOGICAL_SERIALIZED_INPUT_BYTES / 4);
  });

  it("fails closed with working_context_loss_disclosure on WC-only overflow (O)", () => {
    // Wholesale-shape analytic construction (mirrors the shipped E2b proof):
    // measure the base wire and the disclosure cost, then size a budget where
    // HEAD-identical packing sheds every WC item yet the truthful disclosure
    // itself does not fit the caller envelope. Probes use the default
    // maker's small fixture shape; the envelope scan below finds the lossy
    // window deterministically instead of assuming per-item costs.
    const items = largeWcItems("wc-e2c-o", 8, ["topic"]);
    const disclosureBytes = Buffer.byteLength(`"optionalAllocatorOmittedCount":8,`, "utf8")
      + 1
      + Buffer.byteLength(WC_OPTIONAL_OMISSION_GUIDANCE, "utf8");
    const disclosureTokens = Math.ceil(disclosureBytes / 2) + 2;
    // At the groq envelope the fixture sheds wholesale (measured: count 8,
    // included 0). Scan downward from full-envelope for the first budget
    // that throws working_context_loss_disclosure.
    const groqLossy = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-o-groq",
    });
    expect(groqLossy.projected.workingContextSelection?.optionalAllocatorOmittedCount).toBe(8);
    expect(disclosureTokens).toBeGreaterThan(0);
    const fullTokens = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-o-full",
    }).receipt.estimatedInputTokens;
    let error: unknown = null;
    let failingBudget = 0;
    for (let budget = fullTokens; budget > 0; budget -= 25) {
      try {
        allocateThoughtProjection({
          thoughtInput: wcInput(items),
          semanticBudgetTokens: budget,
          requestId: `req-e2c-o-scan-${budget}`,
        });
      } catch (caught) {
        if (caught instanceof RequiredOverflowError &&
          (caught as RequiredOverflowError).section === "working_context_loss_disclosure") {
          error = caught;
          failingBudget = budget;
          break;
        }
        // Base/required failure is monotonic — stop (same rule as E2b scans).
        if (caught instanceof RequiredOverflowError) break;
        throw caught;
      }
    }
    expect(error).toBeInstanceOf(RequiredOverflowError);
    expect(error).toMatchObject({
      section: "working_context_loss_disclosure",
      semanticBudgetTokens: failingBudget,
    });
    expect((error as RequiredOverflowError).estimatedInputTokens).toBeGreaterThan(failingBudget);
    // The failure is the scoped semantic gate, not the global byte ceiling.
    expect(failingBudget * 2).toBeLessThan(MAX_LOGICAL_SERIALIZED_INPUT_BYTES / 4);

    // Contrast: with room for disclosure the same loss shape succeeds.
    const ok = allocateThoughtProjection({
      thoughtInput: wcInput(items),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-o-ok",
    });
    expect(ok.projected.workingContextSelection?.optionalAllocatorOmittedCount).toBe(8);
    expect(ok.receipt.estimatedInputTokens).toBeLessThanOrEqual(ok.receipt.semanticProjectionEnvelope.maxInputTokens);
  });

  it("classifies joint retrieval plus WC overflow as joint_loss_disclosure (P)", () => {
    // Joint construction: both disclosures present on the final wire while it
    // exceeds the caller envelope. Presence-based classification must report
    // the joint section, not either single-disclosure section. Measured joint
    // probe: 8 large WC + 20 large retrieval hits at the groq envelope sheds
    // all WC (count 8) and some retrieval.
    const wcItems = largeWcItems("wc-e2c-p", 8, ["topic"]);
    const retHits = Array.from({ length: 20 }, (_, i) => ({
      kind: "lexical" as const,
      sourceStore: "live_memory" as const,
      ref: `mem:e2c:p:${i}`,
      snippet: `E2b calibration snippet ${i} with filler words to consume budget `.repeat(60),
      score: -1.0,
      assertionKey: `mem:e2c:p:${i}`,
      memoryKind: "owner_world_claim" as const,
      dimensions: null,
      dataClassification: "ordinary" as const,
      live: true,
      supportRefs: [],
    }));
    const jointProbe = allocateThoughtProjection({
      thoughtInput: wcInput(wcItems, retHits),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-p-probe",
    });
    expect(jointProbe.projected.workingContextSelection?.optionalAllocatorOmittedCount).toBe(8);
    expect(jointProbe.projected.retrieval.allocatorOmittedCount ?? 0).toBeGreaterThan(0);
    const fullTokens = allocateThoughtProjection({
      thoughtInput: wcInput(wcItems, retHits),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-p-full",
    }).receipt.estimatedInputTokens;
    let error: unknown = null;
    let failingBudget = 0;
    for (let budget = fullTokens; budget > 0; budget -= 25) {
      try {
        allocateThoughtProjection({
          thoughtInput: wcInput(wcItems, retHits),
          semanticBudgetTokens: budget,
          requestId: `req-e2c-p-scan-${budget}`,
        });
      } catch (caught) {
        if (caught instanceof RequiredOverflowError &&
          (caught as RequiredOverflowError).section === "joint_loss_disclosure") {
          error = caught;
          failingBudget = budget;
          break;
        }
        if (caught instanceof RequiredOverflowError &&
          ((caught as RequiredOverflowError).section === "retrieval_loss_disclosure" ||
            (caught as RequiredOverflowError).section === "working_context_loss_disclosure")) {
          // Single-disclosure overflow on the way down is fine — the joint
          // wire sheds differently per budget; keep scanning for the joint
          // classification.
          continue;
        }
        if (caught instanceof RequiredOverflowError) break;
        throw caught;
      }
    }
    expect(error).toBeInstanceOf(RequiredOverflowError);
    expect(error).toMatchObject({
      section: "joint_loss_disclosure",
      semanticBudgetTokens: failingBudget,
    });
    expect((error as RequiredOverflowError).estimatedInputTokens).toBeGreaterThan(failingBudget);

    // Joint fit contrast: generous envelope carries both disclosures exactly.
    const ok = allocateThoughtProjection({
      thoughtInput: wcInput(wcItems, retHits),
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-p-ok",
    });
    expect(ok.projected.workingContextSelection?.optionalAllocatorOmittedCount).toBe(8);
    expect(ok.projected.retrieval.allocatorOmittedCount ?? 0).toBeGreaterThan(0);
    const systemMessage = thoughtMessagesForProjection(ok.projected)[0]?.content ?? "";
    expect(systemMessage.split(ALLOCATOR_OMISSION_GUIDANCE).length - 1).toBe(1);
    expect(systemMessage.split(WC_OPTIONAL_OMISSION_GUIDANCE).length - 1).toBe(1);
  });

  it("introduces no new final gate on complete cycles (Q)", () => {
    // Genuine all-fit cycle: no disclosure of any kind, tight envelope.
    const probe = allocateThoughtProjection({
      thoughtInput: wcInput([makeWcItem("wc-e2c-q-1", "topic", 2)]),
      semanticBudgetTokens: 32_768,
      requestId: "req-e2c-q-probe",
    });
    const tight = probe.receipt.estimatedInputTokens + 25;
    const allocated = allocateThoughtProjection({
      thoughtInput: wcInput([makeWcItem("wc-e2c-q-1", "topic", 2)]),
      semanticBudgetTokens: tight,
      requestId: "req-e2c-q-tight",
    });
    expect(allocated.projected.workingContextSelection).toBeUndefined();
    expect(allocated.projected.retrieval.allocatorOmittedCount).toBeUndefined();
    expect(allocated.projected.conversationSelection?.recencyOmittedCount).toBeUndefined();
    const systemMessage = thoughtMessagesForProjection(allocated.projected)[0]?.content ?? "";
    expect(systemMessage).not.toContain(WC_OPTIONAL_OMISSION_GUIDANCE);
    expect(systemMessage).not.toContain(ALLOCATOR_OMISSION_GUIDANCE);
  });

  it("keeps prior system-message bytes identical without E2c (R)", () => {
    // Ordered-append refactor non-regression: pre-E2c combinations keep exact
    // HEAD bytes. Recreate all four from one base projection object.
    const base = allocateThoughtProjection({
      thoughtInput: wcInput([makeWcItem("wc-e2c-r-1", "topic", 2)]),
      semanticBudgetTokens: 9_500,
      requestId: "req-e2c-r-base",
    }).projected;
    const baseSystem = thoughtMessagesForProjection(base)[0]?.content ?? "";
    const e2a = thoughtMessagesForProjection({
      ...base,
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 3 },
    })[0]?.content ?? "";
    expect(e2a).toBe(`${baseSystem} ${RECENCY_OMISSION_GUIDANCE}`);
    const e2b = thoughtMessagesForProjection({
      ...base,
      retrieval: { ...base.retrieval, allocatorOmittedCount: 2 },
    })[0]?.content ?? "";
    expect(e2b).toBe(`${baseSystem} ${ALLOCATOR_OMISSION_GUIDANCE}`);
    const both = thoughtMessagesForProjection({
      ...base,
      conversationSelection: { frontierIncludedIds: [], omittedEvidenceIds: [], recencyOmittedCount: 3 },
      retrieval: { ...base.retrieval, allocatorOmittedCount: 2 },
    })[0]?.content ?? "";
    expect(both).toBe(`${baseSystem} ${RECENCY_OMISSION_GUIDANCE} ${ALLOCATOR_OMISSION_GUIDANCE}`);
    // E2c appends last and only when present.
    const e2c = thoughtMessagesForProjection({
      ...base,
      workingContextSelection: { optionalAllocatorOmittedCount: 1 },
    })[0]?.content ?? "";
    expect(e2c).toBe(`${baseSystem} ${WC_OPTIONAL_OMISSION_GUIDANCE}`);
  });

  it("moves hashes on lossy WC cycles and stays deterministic (S)", () => {
    const complete = allocateThoughtProjection({
      thoughtInput: wcInput([makeWcItem("wc-e2c-s-1", "topic", 2)]),
      semanticBudgetTokens: 9_500,
      requestId: "req-e2c-s-complete",
    });
    const heavy = wcInput(Array.from({ length: 12 }, (_, i) => makeWcItem(`wc-e2c-s-${i}`, "topic", 30)));
    const pressure = allocateThoughtProjection({
      thoughtInput: heavy,
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-s-lossy",
    });
    expect(pressure.projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0)
      .toBeGreaterThan(0);
    expect(pressure.hashes.semanticProjectionHash).not.toBe(complete.hashes.semanticProjectionHash);
    expect(pressure.hashes.dispatchMessagesHash).not.toBe(complete.hashes.dispatchMessagesHash);
    const again = allocateThoughtProjection({
      thoughtInput: heavy,
      quotaBucket: "groq:openai/gpt-oss-20b",
      requestId: "req-e2c-s-lossy-again",
    });
    expect(again.hashes).toEqual(pressure.hashes);
  });
});
