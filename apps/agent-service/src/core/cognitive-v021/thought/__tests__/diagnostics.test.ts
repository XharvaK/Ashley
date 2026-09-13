import { describe, it, expect, vi } from "vitest";
import {
  RAW_DEBUG_RETENTION_MAX_MS,
  RAW_DEBUG_RETENTION_MAX_DAYS,
  buildProviderS5,
  captureThoughtDebug,
  openObservabilityStore,
  initObservabilitySchema,
  readObservabilityMode,
  resolveReducibleCollection,
  type ThoughtDispatchDiagnostic,
} from "../diagnostics.js";
import { CREDENTIAL_OMITTED_PLACEHOLDER } from "../../../privacy/secrets.js";
import { openDerivedStore } from "../../retrieval/derived-store.js";
import { admitTestCycle, openTestSidecar, makeSemanticSettlement } from "../../test-support.js";
import type { AllocationReceipt } from "../projection-allocator/receipt.js";
import { DEFAULT_SEMANTIC_PROJECTION_ENVELOPE } from "../projection-allocator/budget.js";
import { DatabaseSync } from "node:sqlite";
import { appendInboxEvent } from "../../cycle/inbox.js";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { runCognitiveCycle } from "../run.js";
import { attachModelFabricMetadata } from "../../../model-fabric/receipts.js";
import type { ModelFabricDispatchMetadata } from "../../../model-fabric/types.js";

describe("Thought Diagnostics & Observability DB", () => {
  it("persists allocation receipts and dispatch diagnostics in dedicated forensic store", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      const receipt: AllocationReceipt = {
        cycleId: "cycle-diag-1",
        generation: 1,
        requestId: "req-diag-1",
        policyId: "thought-projection-v1",
        policyVersion: 1,
        semanticProjectionEnvelope: DEFAULT_SEMANTIC_PROJECTION_ENVELOPE,
        tokenBreakdown: {
          static_contract_tokens: 0, conversation_tokens: 0, working_context_tokens: 0,
          identity_kernel_tokens: 0, domain_pointer_tokens: 0, learned_self_tokens: 0,
          retrieval_tokens: 0, observations_tokens: 0, in_flight_effect_tokens: 0,
          authority_revision_feedback_tokens: 0, omitted_for_budget_tokens: 0,
          omitted_for_budget_count: 0, required_overflow_count: 0,
        },
        quotaBucket: "groq:openai/gpt-oss-20b",
        hardTpm: 8000,
        maxOutputTokens: 4096,
        estimatedInputTokens: 2500,
        estimatedOutputTokens: 4096,
        totalDemandTokens: 6596,
        headroomTokens: 1404,
        compression: false,
        requiredOverflow: false,
        decision: {
          included: [{ id: "trigger_evidence", section: "trigger_evidence", required: true }],
          omitted: [],
          includedWireBytes: 1500,
          estimatedInputTokens: 2500,
        },
        diagnostics: {
          system_message_bytes: 5100,
          orientation_kernel_bytes: 7200,
          required_base_estimated_tokens: 5000,
          optional_context_estimated_tokens: 700,
          system_prefix_bytes: 5100,
          system_prefix_estimated_tokens: 2550,
          candidate_S0_S1_prefix_bytes: 14000,
          candidate_S0_S1_prefix_estimated_tokens: 7000,
          first_volatile_field: "cycleId",
          first_volatile_byte_offset: 1,
          allocation_candidate_count: 12,
          renderTentative_call_count: 13,
          thoughtMessagesForProjection_call_count: 13,
          allocation_elapsed_ms: 4,
        },
        semanticProjectionHash: "hash-sem-1",
        dispatchMessagesHash: "hash-msg-1",
      };

      obs.recordReceipt(receipt);

      const diag: ThoughtDispatchDiagnostic = {
        cycleId: "cycle-diag-1",
        generation: 1,
        requestId: "req-diag-1",
        pass: 1,
        code: "transport_failover_unavailable_for_projection",
        stage: "provider_dispatch",
        dispatchTruth: "not_sent",
        quotaBucket: "groq:openai/gpt-oss-20b",
        estimatedInputTokens: 7500,
        totalDemandTokens: 11596,
        semanticProjectionHash: "hash-sem-1",
        dispatchMessagesHash: "hash-msg-1",
        primaryProvider: "nim",
        primaryAttemptId: "att-nim-1",
        primaryDispatchTruth: "sent",
        suppressedProvider: "groq",
        fallbackAttemptOrdinal: 2,
        fallbackFromAttemptId: "att-nim-1",
        secondaryDispatchTruth: "not_sent",
      };

      obs.recordDiagnostic(diag);

      const receipts = obs.listReceipts();
      expect(receipts.length).toBe(1);
      expect(receipts[0].requestId).toBe("req-diag-1");
      expect(receipts[0].quotaBucket).toBe("groq:openai/gpt-oss-20b");
      expect(receipts[0].totalDemandTokens).toBe(6596);
      expect(receipts[0].headroomTokens).toBe(1404);
      expect(receipts[0].decision.included.length).toBe(1);
      expect(receipts[0].diagnostics).toMatchObject({
        system_message_bytes: 5100,
        candidate_S0_S1_prefix_bytes: 14000,
        first_volatile_field: "cycleId",
        allocation_candidate_count: 12,
      });

      const diagnostics = obs.listDiagnostics();
      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].code).toBe("transport_failover_unavailable_for_projection");
      expect(diagnostics[0].stage).toBe("provider_dispatch");
      expect(diagnostics[0].dispatchTruth).toBe("not_sent");
      expect(diagnostics[0].suppressedProvider).toBe("groq");
      expect(diagnostics[0].secondaryDispatchTruth).toBe("not_sent");
      expect(diagnostics[0].semanticProjectionHash).toBe("hash-sem-1");
    } finally {
      obs.close();
    }
  });

  it("P2 era: persists the 16K output reserve on allocation receipts", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      obs.recordReceipt({
        cycleId: "cycle-diag-16k",
        generation: 1,
        requestId: "req-diag-16k",
        policyId: "thought-projection-v1",
        policyVersion: 1,
        semanticProjectionEnvelope: DEFAULT_SEMANTIC_PROJECTION_ENVELOPE,
        tokenBreakdown: {
          static_contract_tokens: 0, conversation_tokens: 0, working_context_tokens: 0,
          identity_kernel_tokens: 0, domain_pointer_tokens: 0, learned_self_tokens: 0,
          retrieval_tokens: 0, observations_tokens: 0, in_flight_effect_tokens: 0,
          authority_revision_feedback_tokens: 0, omitted_for_budget_tokens: 0,
          omitted_for_budget_count: 0, required_overflow_count: 0,
        },
        quotaBucket: "cloudflare:@cf/deepseek-ai/deepseek-v4-flash-0731",
        hardTpm: 65536,
        maxOutputTokens: 16384,
        estimatedInputTokens: 2500,
        estimatedOutputTokens: 16384,
        totalDemandTokens: 18884,
        headroomTokens: 46652,
        compression: false,
        requiredOverflow: false,
        decision: {
          included: [{ id: "trigger_evidence", section: "trigger_evidence", required: true }],
          omitted: [],
          includedWireBytes: 1500,
          estimatedInputTokens: 2500,
        },
        semanticProjectionHash: "hash-sem-16k",
        dispatchMessagesHash: "hash-msg-16k",
      });
      const receipts = obs.listReceipts();
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({ maxOutputTokens: 16384, estimatedOutputTokens: 16384 });
    } finally {
      obs.close();
    }
  });

  it("round-trips required allocation overflow details through the existing diagnostic payload", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      obs.recordDiagnostic({
        cycleId: "cycle-overflow-details",
        generation: 1,
        requestId: "req-overflow-details",
        pass: 1,
        code: "context_allocation_required_overflow",
        stage: "allocation",
        dispatchTruth: "not_sent",
        estimatedInputTokens: 9_709,
        requiredOverflowSection: "recent_raw",
        semanticBudgetTokens: 9_500,
        overflowTokens: 209,
      });

      const stored = obs.db.prepare(
        "SELECT cycle_metrics_json FROM thought_dispatch_diagnostics WHERE request_id = ?",
      ).get("req-overflow-details") as { cycle_metrics_json: string };
      expect(JSON.parse(stored.cycle_metrics_json)).toMatchObject({
        required_overflow_section: "recent_raw",
        estimated_input_tokens: 9_709,
        semantic_budget_tokens: 9_500,
        overflow_tokens: 209,
      });

      expect(obs.listDiagnostics()[0]).toMatchObject({
        code: "context_allocation_required_overflow",
        requiredOverflowSection: "recent_raw",
        estimatedInputTokens: 9_709,
        semanticBudgetTokens: 9_500,
        overflowTokens: 209,
      });
    } finally {
      obs.close();
    }
  });

  it("round-trips bounded abort and affinity telemetry without prose", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      obs.recordDiagnostic({
        cycleId: "cycle-abort-truth",
        generation: 1,
        requestId: "req-abort-truth",
        pass: 1,
        code: "attention_deadline",
        stage: "provider_dispatch",
        dispatchTruth: "unknown",
        providerFailure: {
          dispatchTruth: "unknown",
          parserStatus: "not_run",
          validatorStatus: "not_run",
          structuralRetryStatus: "not_applicable",
          provider: "cloudflare",
          elapsedMs: 59_789,
          remainingDeadlineMs: 0,
          failureClass: "timeout",
          abortReasonName: "TimeoutError",
          noHttpResponse: true,
          sessionAffinityApplied: false,
          affinityPolicy: "none",
        },
      });
      obs.recordDiagnostic({
        cycleId: "cycle-usage-truth",
        generation: 1,
        requestId: "req-usage-truth",
        pass: 1,
        code: "provider_returned",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
        providerFailure: {
          dispatchTruth: "sent",
          parserStatus: "passed",
          validatorStatus: "passed",
          structuralRetryStatus: "not_applicable",
          provider: "cloudflare",
          elapsedMs: 14_037,
          remainingDeadlineMs: 45_849,
          inputTokens: 11_233,
          completionTokens: 872,
          reasoningTokens: 1_900,
          cachedInputTokens: 9_100,
          neuronUsage: 4_200,
          noHttpResponse: false,
          abortReasonName: "none",
          sessionAffinityApplied: false,
          affinityPolicy: "none",
        },
      });

      const stored = obs.db.prepare(
        "SELECT provider_failure_json FROM thought_dispatch_diagnostics WHERE request_id = ?",
      ).get("req-abort-truth") as { provider_failure_json: string };
      expect(stored.provider_failure_json).toContain('"abortReasonName":"TimeoutError"');
      expect(stored.provider_failure_json).toContain('"noHttpResponse":true');

      const rows = obs.listDiagnostics();
      expect(rows).toHaveLength(2);
      const aborted = rows.filter((row) => row.code === "attention_deadline");
      const returned = rows.filter((row) => row.code === "provider_returned");
      expect(aborted).toHaveLength(1);
      expect(returned).toHaveLength(1);
      expect(aborted[0].providerFailure).toMatchObject({
        abortReasonName: "TimeoutError",
        noHttpResponse: true,
        sessionAffinityApplied: false,
        affinityPolicy: "none",
      });
      expect(returned[0].providerFailure).toMatchObject({
        inputTokens: 11_233,
        completionTokens: 872,
        reasoningTokens: 1_900,
        cachedInputTokens: 9_100,
        neuronUsage: 4_200,
        noHttpResponse: false,
        abortReasonName: "none",
        sessionAffinityApplied: false,
        affinityPolicy: "none",
      });
    } finally {
      obs.close();
    }
  });

  it("round-trips applied affinity-transport truth without the raw identifier", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      obs.recordDiagnostic({
        cycleId: "cycle-affinity-truth",
        generation: 1,
        requestId: "req-affinity-truth",
        pass: 1,
        code: "provider_returned",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
        providerFailure: {
          dispatchTruth: "sent",
          parserStatus: "passed",
          validatorStatus: "passed",
          structuralRetryStatus: "not_applicable",
          provider: "cloudflare",
          model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
          elapsedMs: 12_345,
          remainingDeadlineMs: 45_000,
          inputTokens: 7_100,
          completionTokens: 64,
          cachedInputTokens: 6_900,
          neuronUsage: 3_100,
          noHttpResponse: false,
          abortReasonName: "none",
          sessionAffinityApplied: true,
          affinityPolicy: "cloudflare_thought_route_affinity_v1",
        },
      });

      const stored = obs.db.prepare(
        "SELECT provider_failure_json FROM thought_dispatch_diagnostics WHERE request_id = ?",
      ).get("req-affinity-truth") as { provider_failure_json: string };
      expect(stored.provider_failure_json).toContain(
        '"affinityPolicy":"cloudflare_thought_route_affinity_v1"',
      );
      expect(stored.provider_failure_json).toContain('"sessionAffinityApplied":true');

      const rows = obs.listDiagnostics();
      expect(rows).toHaveLength(1);
      expect(rows[0].providerFailure).toMatchObject({
        cachedInputTokens: 6_900,
        sessionAffinityApplied: true,
        affinityPolicy: "cloudflare_thought_route_affinity_v1",
      });
    } finally {
      obs.close();
    }
  });

  it("survives derived index rebuilds without data loss", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    const obs = openObservabilityStore(":memory:");

    try {
      const receipt: AllocationReceipt = {
        cycleId: "cycle-diag-2",
        generation: 1,
        requestId: "req-diag-2",
        policyId: "thought-projection-v1",
        policyVersion: 1,
        semanticProjectionEnvelope: DEFAULT_SEMANTIC_PROJECTION_ENVELOPE,
        tokenBreakdown: {
          static_contract_tokens: 0, conversation_tokens: 0, working_context_tokens: 0,
          identity_kernel_tokens: 0, domain_pointer_tokens: 0, learned_self_tokens: 0,
          retrieval_tokens: 0, observations_tokens: 0, in_flight_effect_tokens: 0,
          authority_revision_feedback_tokens: 0, omitted_for_budget_tokens: 0,
          omitted_for_budget_count: 0, required_overflow_count: 0,
        },
        quotaBucket: "nim:openai/gpt-oss-20b",
        hardTpm: 16000,
        maxOutputTokens: 4096,
        estimatedInputTokens: 3000,
        estimatedOutputTokens: 4096,
        totalDemandTokens: 7096,
        headroomTokens: 8904,
        compression: false,
        requiredOverflow: false,
        decision: {
          included: [{ id: "trigger_evidence", section: "trigger_evidence", required: true }],
          omitted: [],
          includedWireBytes: 2000,
          estimatedInputTokens: 3000,
        },
        semanticProjectionHash: "hash-sem-2",
        dispatchMessagesHash: "hash-msg-2",
      };

      obs.recordReceipt(receipt);

      // Rebuild derived store
      derived.rebuild(sidecar);

      // Observability data is intact
      const receipts = obs.listReceipts();
      expect(receipts.length).toBe(1);
      expect(receipts[0].requestId).toBe("req-diag-2");
    } finally {
      obs.close();
      derived.close();
      sidecar.close();
    }
  });

  it("persists real allocation receipt and malformed diagnostic during runCognitiveCycle", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const obsDb = new DatabaseSync(":memory:");
    initObservabilitySchema(obsDb);

    const cycle = admitTestCycle(sidecar, {
      cycleId: "cycle-obs-real",
      conversationId: "thread-obs-real",
      triggerKind: "owner_message",
      triggerRef: "ref-obs-1",
      occupantId: "doc",
      nowMs: 1,
    });

    const utterance = appendOwnerUtterance(sidecar, {
      conversationId: "thread-obs-real",
      text: "test observability integration",
      discordMessageIds: ["msg-obs-1"],
      nowMs: 2,
    });

    const event = appendInboxEvent(sidecar, {
      conversationId: "thread-obs-real",
      kind: "owner_message",
      payload: {
        cycleId: cycle.cycleId,
        evidenceRowId: utterance.rowId,
        ownerMessage: utterance.text,
      },
      createdAtMs: 2,
    });

    let calls = 0;
    const completeChat = vi.fn(async (_messages) => {
      calls++;
      if (calls === 1) {
        return {
          text: "malformed provider payload",
          model: "fake",
          modelAlias: "thought",
          providerModel: "nvidia/nemotron-test",
          resolvedModelId: "nvidia/nemotron-test",
          usage: { promptTokens: 17, completionTokens: 9, reasoningTokens: 4 },
          finishReason: "length",
          responseDiagnostics: {
            contentContainerType: "string" as const,
            contentChunkTypes: [],
            textChunkCount: 0,
            thinkingChunkCount: 0,
            finalTextBytes: Buffer.byteLength("malformed provider payload", "utf8"),
            finishReason: "length",
            finishReasonClass: "LENGTH" as const,
            outputTokenLimit: 128,
            outputTokens: 9,
            reasoningTokens: 4,
            requestWireBytes: 3456,
            requestWireAdditionalBytes: 1234,
            reasoningContentBytes: 31,
            reasoningHash: "sha256:reasoning-hash",
            extractionFailure: "none" as const,
          },
          providerBoundaryControls: {
            maxTokens: 128,
            reasoningConfiguration: "reasoning_effort:high",
            temperature: 1,
            deadlineAtMs: 4_000,
          },
          providerBoundaryTiming: {
            requestStartedAtMs: 100,
            responseAtMs: 140,
            elapsedMs: 40,
            remainingDeadlineMs: 3_860,
            outcome: "response_received" as const,
          },
          capturedAttemptIdentity: {
            allocationId: 9,
            modelFabricInvocationId: "mf-inv-1",
            modelFabricAttemptId: "mf-att-1",
            attemptOrdinal: 1,
            dispatchSequence: 2,
            routeAlias: "thought",
            provider: "nim",
            configuredModelId: "nvidia/nemotron-test",
            occupantId: "doc",
            modelEpoch: 1,
            contractId: "contract-v2",
            buildIdentity: "build-test",
            logicalStructuredOutputId: "ashley.thought.semantic.v2",
            semanticSchemaFingerprint: "sha256:canonical",
            wireSchemaFingerprint: "sha256:wire",
            actualWireBindingId: "binding-test",
            schemaEnforcementMode: "guided_json",
            resourcePolicyFingerprint: "sha256:resource",
          },
          wireEvidence: {
            adapterId: "ashley.adapter.nim.v1",
            wireFormat: "nim_guided_json",
            sanitizedBodyDigest: "sha256:wire-body",
            emittedEnforcementMode: "guided_json",
            providerDeclaredEnforcement: "unavailable",
            bindingId: "binding-test",
          },
        };
      }
      return {
        text: JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    });

    const deps = {
      nowMs: () => 10,
      attentionDb,
      completeChat,
      runPerception: vi.fn(async () => []),
      executeObservation: vi.fn(),
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
          canOfferProjectInspection: false,
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
        canOfferProjectInspection: false,
        canOfferWorkspace: false,
        canOfferVerification: false,
        canOfferAuthorship: false,
        canOfferBoundedOperation: false,
        canOfferPatchExport: false,
        approvedProjectIds: [],
      },
      observabilityDb: obsDb,
    };

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps as any);
      expect(result.published).toBe(true);

      const store = openObservabilityStore(obsDb);
      const receipts = store.listReceipts();
      expect(receipts.length).toBeGreaterThanOrEqual(1);
      expect(receipts[0].cycleId).toBe("cycle-obs-real");

      const diagnostics = store.listDiagnostics();
      const malformed = diagnostics.filter((row) => row.code === "parser_malformed");
      expect(malformed).toHaveLength(1);
      expect(malformed[0].cycleId).toBe("cycle-obs-real");
      expect(malformed[0].dispatchTruth).toBe("unknown");
      expect(malformed[0].providerFailure).toMatchObject({
        provider: "nim",
        model: "nvidia/nemotron-test",
        providerModel: "nvidia/nemotron-test",
        modelFabricInvocationId: "mf-inv-1",
        modelFabricAttemptId: "mf-att-1",
        attemptOrdinal: 1,
        dispatchSequence: 2,
        canonicalSchemaFingerprint: "sha256:canonical",
        wireSchemaFingerprint: "sha256:wire",
        wireBindingId: "binding-test",
        wireFormat: "nim_guided_json",
        wireBodyDigest: "sha256:wire-body",
        maxTokens: 128,
        reasoningConfiguration: "reasoning_effort:high",
        temperature: 1,
        deadlineAtMs: 4_000,
        requestStartedAtMs: 100,
        responseAtMs: 140,
        elapsedMs: 40,
        remainingDeadlineMs: 3_860,
        finishReason: "length",
        inputTokens: 17,
        completionTokens: 9,
        requestWireBytes: 3456,
        requestWireAdditionalBytes: 1234,
        contentBytes: Buffer.byteLength("malformed provider payload", "utf8"),
        reasoningContentBytes: 31,
        reasoningHash: "sha256:reasoning-hash",
        parserStatus: "failed",
        validatorStatus: "not_run",
        failureClass: "invalid_json",
        structuralRetryStatus: "scheduled",
      });
      const storedProviderFailure = obsDb.prepare(
        "SELECT provider_failure_json FROM thought_dispatch_diagnostics WHERE code = 'parser_malformed'",
      ).get() as { provider_failure_json: string };
      expect(storedProviderFailure.provider_failure_json).not.toContain("malformed provider payload");
      // The successful corrective retry records bounded provider usage telemetry.
      const returned = diagnostics.filter((row) => row.code === "provider_returned");
      expect(returned).toHaveLength(1);
      expect(returned[0]).toMatchObject({ stage: "provider_dispatch", dispatchTruth: "unknown" });
      expect(returned[0].providerFailure).toMatchObject({
        noHttpResponse: false,
        abortReasonName: "none",
        sessionAffinityApplied: false,
        affinityPolicy: "none",
      });
      // Cycle aggregates attach to the latest non-publication row.
      expect(returned[0].cycleMetrics).toMatchObject({
        first_pass_total_input_tokens: expect.any(Number),
        total_cycle_input_tokens_including_retries: expect.any(Number),
        retry_amplification_ratio: expect.any(Number),
        request_count: 2,
      });
    } finally {
      obsDb.close();
      sidecar.close();
      attentionDb.close();
    }
  });

  it("persists transport_failover_unavailable_for_projection diagnostic from typed Model Fabric metadata when secondary failover is suppressed", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = new DatabaseSync(":memory:");
    const obsDb = new DatabaseSync(":memory:");
    initObservabilitySchema(obsDb);

    const event = appendInboxEvent(sidecar, {
      conversationId: "thread-failover-suppressed",
      kind: "owner_message",
      payload: { text: "Hello, triggering failover suppression test" },
      id: "evt-failover-suppressed",
    });

    const errorWithMf = new Error("Transport error on primary provider");
    const mfMeta: ModelFabricDispatchMetadata = {
      receipt: {
        receiptStage: "resolved",
        configuredRouteId: "thought" as any,
        finalDispatchedRouteId: "thought" as any,
        finalAttemptId: "att-primary-123",
        fallbackClass: "none",
        invocationId: "inv-suppress-1",
        sessionId: "sess-1" as any,
        logicalRole: "thought",
        requestedPurpose: "thought",
        specialistRequirement: null,
        latencyMs: 10,
        attentionRequestId: null,
        traceId: null,
        projectionId: null,
        projectionContentBinding: null,
        projectionTelemetryFingerprint: null,
        fallbackChain: null,
        attempts: [
          {
            receiptStage: "dispatch_attempted",
            invocationId: "inv-suppress-1",
            attemptId: "att-primary-123",
            attemptOrdinal: 1,
            fallbackFromAttemptId: null,
            fallbackClass: "none",
            providerRequestCount: 1,
            latencyMs: 10,
            projectionId: "proj-1" as any,
            projectionContentBinding: { canonicalization: "context_projection_content_v1", algorithm: "sha256", value: "sha256:abc", privacyPolicyId: "priv-1" },
            projectionTelemetryFingerprint: "projection_structure_v1:abc" as any,
            requestedReasoningPolicy: null,
            effectiveReasoningSent: null,
            translatedWireControl: null,
            observedReasoning: { status: "unavailable" },
            backend: "nim",
            dispatchedRouteId: "thought" as any,
            registryVersion: "1",
            profileId: "profile-1" as any,
            profileVersion: 1 as any,
            profileFingerprint: "fp-1" as any,
            provider: "nim" as any,
            configuredModelId: "meta/llama-3.3-70b-instruct",
            contextPolicyId: "thought_context_v1" as any,
            admissionBasis: "primary_direct" as any,
            effectiveReasoning: null,
            inferencePolicyFingerprint: null,
            structuredOutputSchemaFingerprint: null,
            dispatchTruth: "sent_outcome_unknown",
          },
        ],
      },
      failure: {
        code: "provider_unavailable",
        stage: "provider_dispatch",
        retryability: "policy_may_fallback",
        dispatchTruth: "sent_outcome_unknown",
        retryAfterMs: null,
        sanitizedCauseClass: "transport_error",
      },
      resolvedRoute: null,
      failoverSuppressed: "transport_failover_unavailable_for_projection",
      suppressedProvider: "groq",
      suppressedBucket: "groq:openai/gpt-oss-20b",
      semanticProjectionHash: "test-sem-hash-123",
      dispatchMessagesHash: "test-msg-hash-123",
    };

    attachModelFabricMetadata(errorWithMf, mfMeta);

    let primaryAttempts = 0;
    const completeChat = vi.fn(async () => {
      primaryAttempts += 1;
      throw errorWithMf;
    });

    const deps = {
      nowMs: () => 10,
      attentionDb,
      completeChat,
      runPerception: vi.fn(async () => []),
      executeObservation: vi.fn(),
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
          canOfferProjectInspection: false,
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
        canOfferProjectInspection: false,
        canOfferWorkspace: false,
        canOfferVerification: false,
        canOfferAuthorship: false,
        canOfferBoundedOperation: false,
        canOfferPatchExport: false,
        approvedProjectIds: [],
      },
      observabilityDb: obsDb,
    };

    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps as any);
      expect(result.published).toBe(false);
      expect(primaryAttempts).toBe(1);

      const store = openObservabilityStore(obsDb);
      const diagnostics = store.listDiagnostics();
      const suppressedDiag = diagnostics.find(
        (d) => d.code === "transport_failover_unavailable_for_projection",
      );

      expect(suppressedDiag).toBeDefined();
      expect(suppressedDiag?.stage).toBe("provider_dispatch");
      expect(suppressedDiag?.primaryDispatchTruth).toBe("sent");
      expect(suppressedDiag?.primaryProvider).toBe("nim");
      expect(suppressedDiag?.primaryAttemptId).toBe("att-primary-123");
      expect(suppressedDiag?.suppressedProvider).toBe("groq");
      expect(suppressedDiag?.secondaryDispatchTruth).toBe("not_sent");
      expect(suppressedDiag?.fallbackAttemptOrdinal).toBe(2);
      expect(suppressedDiag?.fallbackFromAttemptId).toBe("att-primary-123");
      expect(suppressedDiag?.quotaBucket).toBe("groq:openai/gpt-oss-20b");
      expect(suppressedDiag?.semanticProjectionHash).toBe("test-sem-hash-123");
      expect(suppressedDiag?.dispatchMessagesHash).toBe("test-msg-hash-123");
      expect(suppressedDiag?.providerFailure).toMatchObject({
        provider: "nim",
        model: "meta/llama-3.3-70b-instruct",
        modelFabricInvocationId: "inv-suppress-1",
        modelFabricAttemptId: "att-primary-123",
        dispatchTruth: "unknown",
        parserStatus: "not_run",
        validatorStatus: "not_run",
        failureClass: "transport_error",
        structuralRetryStatus: "not_applicable",
      });
      expect(suppressedDiag?.providerFailure).not.toHaveProperty("inputTokens");
      expect(suppressedDiag?.providerFailure).not.toHaveProperty("completionTokens");
      expect(suppressedDiag?.providerFailure).not.toHaveProperty("finishReason");
      expect(suppressedDiag?.providerFailure).not.toHaveProperty("requestStartedAtMs");
    } finally {
      obsDb.close();
      sidecar.close();
      attentionDb.close();
    }
  });

  it("observability DB write failure does not alter or block cognitive cycle execution", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = new DatabaseSync(":memory:");
    const obsDb = new DatabaseSync(":memory:");
    initObservabilitySchema(obsDb);

    const event = appendInboxEvent(sidecar, {
      conversationId: "thread-obs-failure",
      kind: "owner_message",
      payload: { text: "Hello with failing observability db" },
      id: "evt-obs-failure",
    });

    // Make observability DB throw on prepare / write
    obsDb.prepare = () => {
      throw new Error("disk_full_or_io_error_in_observability_db");
    };

    const completeChat = vi.fn(async () => {
      throw new Error("generic_transport_unavailable");
    });

    const deps = {
      nowMs: () => 10,
      attentionDb,
      completeChat,
      runPerception: vi.fn(async () => []),
      executeObservation: vi.fn(),
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
          canOfferProjectInspection: false,
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
        canOfferProjectInspection: false,
        canOfferWorkspace: false,
        canOfferVerification: false,
        canOfferAuthorship: false,
        canOfferBoundedOperation: false,
        canOfferPatchExport: false,
        approvedProjectIds: [],
      },
      observabilityDb: obsDb,
    };

    try {
      // Cycle must handle observability DB error gracefully without throwing
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps as any);
      expect(result.published).toBe(false);
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("does not create a provider forensic payload for a healthy return", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      obs.recordDiagnostic({
        cycleId: "cycle-healthy-provider",
        generation: 1,
        requestId: "req-healthy-provider",
        pass: 1,
        code: "provider_returned",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
      });
      const raw = obs.db.prepare(
        "SELECT provider_failure_json FROM thought_dispatch_diagnostics WHERE request_id = ?",
      ).get("req-healthy-provider") as { provider_failure_json: string | null };
      expect(raw.provider_failure_json).toBeNull();
      expect(obs.listDiagnostics()[0].providerFailure).toBeNull();
    } finally {
      obs.close();
    }
  });

  it("round-trips provider HTTP status through the bounded failure allowlist", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      obs.recordDiagnostic({
        cycleId: "cycle-status-provider",
        generation: 1,
        requestId: "req-status-provider",
        pass: 1,
        code: "provider_unavailable",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
        providerFailure: {
          provider: "nim",
          providerHttpStatus: 503,
          reasoningTokens: 150,
          cachedInputTokens: 200,
          dispatchTruth: "sent",
          parserStatus: "not_run",
          validatorStatus: "not_run",
          structuralRetryStatus: "not_applicable",
        },
      });
      obs.recordDiagnostic({
        cycleId: "cycle-legacy-provider",
        generation: 1,
        requestId: "req-legacy-provider",
        pass: 1,
        code: "provider_unavailable",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
        providerFailure: {
          provider: "nim",
          dispatchTruth: "sent",
          parserStatus: "not_run",
          validatorStatus: "not_run",
          structuralRetryStatus: "not_applicable",
        },
      });

      const diagnostics = obs.listDiagnostics();
      expect(diagnostics.find((item) => item.requestId === "req-status-provider")?.providerFailure)
        .toMatchObject({ providerHttpStatus: 503, reasoningTokens: 150, cachedInputTokens: 200 });
      expect(diagnostics.find((item) => item.requestId === "req-legacy-provider")?.providerFailure)
        .not.toHaveProperty("providerHttpStatus");
    } finally {
      obs.close();
    }
  });

  it("persists a bounded publication rejection without implying a committed settlement", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      obs.recordDiagnostic({
        cycleId: "cycle-publication-rejection",
        generation: 4,
        requestId: "request-publication-rejection",
        pass: 2,
        code: "publication_rejected",
        stage: "publication",
        dispatchTruth: "unknown",
        semanticProjectionHash: "sha256:projection",
        dispatchMessagesHash: "sha256:messages",
        publicationReason: "future_trigger_snapshot_conflict",
      });

      const diagnostic = obs.listDiagnostics()[0];
      expect(diagnostic).toMatchObject({
        code: "publication_rejected",
        stage: "publication",
        publicationReason: "future_trigger_snapshot_conflict",
        dispatchTruth: "unknown",
      });
      const columns = (obs.db.prepare(
        "PRAGMA table_info(thought_dispatch_diagnostics)",
      ).all() as Array<{ name?: string }>).map((column) => column.name);
      expect(columns).not.toContain("attempted_settlement_id");
    } finally {
      obs.close();
    }
  });

  it("migrates the existing diagnostic owner while preserving IDs and old rows", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE thought_dispatch_diagnostics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cycle_id TEXT NOT NULL,
          generation INTEGER NOT NULL,
          request_id TEXT NOT NULL,
          pass INTEGER NOT NULL,
          code TEXT NOT NULL CHECK(code IN ('provider_returned')),
          stage TEXT NOT NULL CHECK(stage IN ('provider_dispatch')),
          dispatch_truth TEXT NOT NULL CHECK(dispatch_truth IN ('not_sent', 'sent', 'unknown')),
          quota_bucket TEXT,
          estimated_input_tokens INTEGER,
          total_demand_tokens INTEGER,
          semantic_projection_hash TEXT,
          dispatch_messages_hash TEXT,
          primary_provider TEXT,
          primary_attempt_id TEXT,
          primary_dispatch_truth TEXT,
          suppressed_provider TEXT,
          fallback_attempt_ordinal INTEGER,
          fallback_from_attempt_id TEXT,
          secondary_dispatch_truth TEXT,
          cycle_metrics_json TEXT,
          provider_failure_json TEXT,
          created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX idx_tdd_cycle ON thought_dispatch_diagnostics (cycle_id, generation);
        CREATE TRIGGER preserve_old_row AFTER INSERT ON thought_dispatch_diagnostics
          BEGIN SELECT CASE WHEN NEW.id < 1 THEN RAISE(ABORT, 'bad_id') END; END;
      `);
      db.prepare(
        `INSERT INTO thought_dispatch_diagnostics
          (id, cycle_id, generation, request_id, pass, code, stage, dispatch_truth, created_at_ms)
         VALUES (41, 'old-cycle', 1, 'old-request', 1, 'provider_returned', 'provider_dispatch', 'sent', 10)`,
      ).run();

      initObservabilitySchema(db);
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
      expect(db.prepare("SELECT id, request_id FROM thought_dispatch_diagnostics").all())
        .toEqual([{ id: 41, request_id: "old-request" }]);
      expect(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'preserve_old_row'",
      ).get()).toMatchObject({ name: "preserve_old_row" });
      expect(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tdd_cycle'",
      ).get()).toMatchObject({ name: "idx_tdd_cycle" });

      initObservabilitySchema(db);
      expect(db.prepare("SELECT COUNT(*) AS count FROM thought_dispatch_diagnostics").get())
        .toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("fails explicitly for an incompatible declared current schema", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE thought_dispatch_diagnostics (
          id INTEGER PRIMARY KEY,
          code TEXT NOT NULL CHECK(code IN ('provider_returned', 'publication_rejected')),
          stage TEXT NOT NULL CHECK(stage IN ('provider_dispatch', 'publication')),
          publication_reason TEXT
        );
        PRAGMA user_version = 1;
      `);

      expect(() => initObservabilitySchema(db)).toThrow("observability_schema_incompatible");
    } finally {
      db.close();
    }
  });

  it("persists nullable S5 columns and the debug table in observability schema v2", () => {
    const obs = openObservabilityStore(":memory:");
    try {
      expect(obs.db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 2 });
      const columns = (obs.db.prepare("PRAGMA table_info(thought_dispatch_diagnostics)").all() as Array<{ name?: string }>)
        .map((column) => column.name);
      expect(columns).toEqual(expect.arrayContaining([
        "provider_request_id",
        "cf_ray",
        "total_tokens",
        "cached_source",
        "cached_tokens",
        "messages_fingerprint",
        "params_fingerprint",
        "affinity_fingerprint",
        "affinity_applied",
        "estimator_input_tokens",
        "estimator_output_tokens",
        "estimator_total_tokens",
        "estimator_version",
        "policy_id",
        "policy_version",
        "output_token_limit",
        "resource_policy_fingerprint",
        "model_id",
        "attempt_ordinal",
        "latency_ms",
        "finish_reason",
        "error_code",
      ]));
      expect(obs.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thought_debug_captures'").get())
        .toMatchObject({ name: "thought_debug_captures" });
      expect(obs.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_thought_debug_expires'").get())
        .toMatchObject({ name: "idx_thought_debug_expires" });
    } finally {
      obs.close();
    }
  });

  it("builds S5 provider detail without laundering missing numbers or affinity identity", () => {
    const detail = buildProviderS5({
      dispatchTruth: "sent",
      parserStatus: "passed",
      validatorStatus: "passed",
      structuralRetryStatus: "not_applicable",
      provider: "cloudflare",
      model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      providerRequestId: "provider-request",
      cfRay: "ray-1",
      totalTokens: 0,
      cachedInputTokens: 0,
      maxTokens: 16_384,
      affinityPolicy: "cloudflare_thought_route_affinity_v1",
      sessionAffinityApplied: true,
      elapsedMs: 123,
      attemptOrdinal: 2,
      finishReason: "stop",
    }, {
      dispatchMessagesHash: "sha256:messages",
      estimate: { input: 0, output: 0, total: 0 },
      policy: { id: "thought-projection-v1", version: 1 },
    });
    expect(detail).toMatchObject({
      providerRequestId: "provider-request",
      cfRay: "ray-1",
      totalTokens: 0,
      cachedTokens: 0,
      messagesFingerprint: "sha256:messages",
      affinityApplied: true,
      estimatorInputTokens: 0,
      estimatorOutputTokens: 0,
      estimatorTotalTokens: 0,
      policyId: "thought-projection-v1",
      policyVersion: 1,
      outputTokenLimit: 16_384,
      attemptOrdinal: 2,
      latencyMs: 123,
    });
    expect(detail?.affinityFingerprint).toMatch(/^sha256:/);
    expect(detail?.paramsFingerprint).toMatch(/^sha256:/);
    expect(detail?.resourcePolicyFingerprint).toMatch(/^sha256:/);
    expect(detail?.estimatorVersion).toBeNull();

    const unknowns = buildProviderS5({
      dispatchTruth: "sent",
      parserStatus: "passed",
      validatorStatus: "passed",
      structuralRetryStatus: "not_applicable",
    });
    expect(unknowns).toMatchObject({
      totalTokens: null,
      cachedTokens: null,
      affinityApplied: null,
      policyId: null,
      policyVersion: null,
    });
  });

  it("fails closed for collection mode and keeps middle mode incident-only", () => {
    expect(readObservabilityMode({} as NodeJS.ProcessEnv)).toBe("off");
    expect(readObservabilityMode({ ASHLEY_OBSERVABILITY_MODE: "rich" } as NodeJS.ProcessEnv)).toBe("rich");
    expect(readObservabilityMode({ ASHLEY_OBSERVABILITY_MODE: "sampled" } as NodeJS.ProcessEnv)).toBe("sampled");
    expect(readObservabilityMode({ ASHLEY_OBSERVABILITY_MODE: "50%" } as NodeJS.ProcessEnv)).toBe("off");
    expect(resolveReducibleCollection({ mode: "off", code: "provider_returned" })).toBe(false);
    expect(resolveReducibleCollection({ mode: "rich", code: "provider_returned" })).toBe(true);
    expect(resolveReducibleCollection({ mode: "sampled", code: "provider_returned" })).toBe(false);
    expect(resolveReducibleCollection({
      mode: "sampled",
      code: "provider_returned",
      providerFailure: {
        dispatchTruth: "sent",
        parserStatus: "passed",
        validatorStatus: "passed",
        structuralRetryStatus: "not_applicable",
        failureClass: "provider_internal",
      },
    })).toBe(true);
  });

  it("gates S5 detail centrally while preserving accountability in every mode", () => {
    const providerFailure = {
      dispatchTruth: "sent" as const,
      parserStatus: "passed" as const,
      validatorStatus: "passed" as const,
      structuralRetryStatus: "not_applicable" as const,
      provider: "cloudflare",
      model: "model:test",
      providerRequestId: "provider-request:test",
      cfRay: "ray:test",
      totalTokens: 20,
      cachedInputTokens: 0,
      inputTokens: 12,
      completionTokens: 8,
      failureClass: "provider_internal",
    };
    const s5 = {
      providerRequestId: "provider-request:test",
      cfRay: "ray:test",
      totalTokens: 20,
      cachedTokens: 0,
      messagesFingerprint: "sha256:messages",
      estimatorInputTokens: 12,
      estimatorOutputTokens: 8,
      estimatorTotalTokens: 20,
      modelId: "model:test",
    };
    const obs = openObservabilityStore(":memory:");
    try {
      vi.stubEnv("ASHLEY_OBSERVABILITY_MODE", "rich");
      obs.recordDiagnostic({
        cycleId: "cycle-mode-rich",
        generation: 1,
        requestId: "request-mode-rich",
        pass: 1,
        code: "provider_returned",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
        providerFailure,
        providerDiagnostics: s5,
      });

      vi.stubEnv("ASHLEY_OBSERVABILITY_MODE", "off");
      obs.recordDiagnostic({
        cycleId: "cycle-mode-off",
        generation: 1,
        requestId: "request-mode-off",
        pass: 1,
        code: "provider_unavailable",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
        providerFailure,
        providerDiagnostics: s5,
      });

      vi.stubEnv("ASHLEY_OBSERVABILITY_MODE", "sampled");
      obs.recordDiagnostic({
        cycleId: "cycle-mode-sampled-success",
        generation: 1,
        requestId: "request-mode-sampled-success",
        pass: 1,
        code: "provider_returned",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
        providerFailure: { ...providerFailure, failureClass: undefined },
        providerDiagnostics: s5,
      });
      obs.recordDiagnostic({
        cycleId: "cycle-mode-sampled-incident",
        generation: 1,
        requestId: "request-mode-sampled-incident",
        pass: 1,
        code: "provider_returned",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
        providerFailure,
        providerDiagnostics: s5,
      });

      const rows = obs.listDiagnostics();
      expect(rows.find((row) => row.requestId === "request-mode-rich")?.providerDiagnostics)
        .toMatchObject({ providerRequestId: "provider-request:test", cachedTokens: 0 });
      expect(rows.find((row) => row.requestId === "request-mode-off")?.providerDiagnostics).toBeNull();
      expect(rows.find((row) => row.requestId === "request-mode-off")?.providerFailure)
        .toMatchObject({ failureClass: "provider_internal", dispatchTruth: "sent" });
      expect(rows.find((row) => row.requestId === "request-mode-sampled-success")?.providerDiagnostics).toBeNull();
      expect(rows.find((row) => row.requestId === "request-mode-sampled-incident")?.providerDiagnostics)
        .toMatchObject({ providerRequestId: "provider-request:test" });
      expect(obs.db.prepare(
        "SELECT provider_request_id, cf_ray, total_tokens FROM thought_dispatch_diagnostics WHERE request_id = ?",
      ).get("request-mode-off")).toMatchObject({ provider_request_id: null, cf_ray: null, total_tokens: null });
    } finally {
      obs.close();
      vi.unstubAllEnvs();
    }
  });

  it("captures only an explicitly enabled occurrence under both gates and clamps TTL", () => {
    vi.stubEnv("ASHLEY_OBSERVABILITY_MODE", "rich");
    const obs = openObservabilityStore(":memory:");
    try {
      expect(RAW_DEBUG_RETENTION_MAX_DAYS).toBe(28);
      expect(RAW_DEBUG_RETENTION_MAX_MS).toBe(2_419_200_000);
      obs.enableThoughtDebugCapture({
        occurrenceId: "periodic-occurrence:debug",
        ttlMs: RAW_DEBUG_RETENTION_MAX_MS * 2,
        enabledBy: "owner",
        captureMode: "rich",
        nowMs: 1_000,
      });
      expect(captureThoughtDebug(obs.db, {
        occurrenceId: "periodic-occurrence:debug",
        projectedDebugJson: JSON.stringify({ Authorization: "Bearer eyJheader.eyJpayload.signature" }),
        code: "provider_returned",
        nowMs: 1_001,
      })).toBe(true);
      const row = obs.getThoughtDebugCapture("periodic-occurrence:debug", 1_001);
      expect(row).toMatchObject({
        expiresAtMs: 1_000 + RAW_DEBUG_RETENTION_MAX_MS,
        projectedDebugJson: CREDENTIAL_OMITTED_PLACEHOLDER,
      });
      expect(captureThoughtDebug(obs.db, {
        occurrenceId: "periodic-occurrence:other",
        projectedDebugJson: "ordinary projected bytes",
        code: "provider_returned",
        nowMs: 1_001,
      })).toBe(false);

      vi.stubEnv("ASHLEY_OBSERVABILITY_MODE", "off");
      expect(captureThoughtDebug(obs.db, {
        occurrenceId: "periodic-occurrence:debug",
        projectedDebugJson: "must not replace capture",
        code: "provider_returned",
        nowMs: 1_002,
      })).toBe(false);
      expect(obs.getThoughtDebugCapture("periodic-occurrence:debug", 1_002)?.projectedDebugJson)
        .toBe(CREDENTIAL_OMITTED_PLACEHOLDER);
    } finally {
      obs.close();
      vi.unstubAllEnvs();
    }
  });

  it("purges every qualifying debug row without touching accountability tables", () => {
    vi.stubEnv("ASHLEY_OBSERVABILITY_MODE", "rich");
    const obs = openObservabilityStore(":memory:");
    try {
      for (let i = 0; i < 60; i += 1) {
        obs.enableThoughtDebugCapture({
          occurrenceId: `periodic-occurrence:expiry:${i}`,
          ttlMs: 1,
          enabledBy: "owner",
          captureMode: "rich",
          nowMs: 10_000,
        });
      }
      expect(obs.db.prepare("SELECT COUNT(*) AS count FROM thought_debug_captures").get()).toMatchObject({ count: 60 });
      obs.recordDiagnostic({
        cycleId: "cycle-expiry-accountability",
        generation: 1,
        requestId: "request-expiry-accountability",
        pass: 1,
        code: "provider_returned",
        stage: "provider_dispatch",
        dispatchTruth: "sent",
      }, 10_000);
      expect(obs.purgeThoughtDebugCaptures(10_061)).toBe(60);
      expect(obs.db.prepare("SELECT COUNT(*) AS count FROM thought_debug_captures").get()).toMatchObject({ count: 0 });
      expect(obs.db.prepare("SELECT COUNT(*) AS count FROM thought_dispatch_diagnostics").get()).toMatchObject({ count: 1 });
      expect(obs.getThoughtDebugCapture("periodic-occurrence:expiry:0", 10_000)).toBeNull();
    } finally {
      obs.close();
      vi.unstubAllEnvs();
    }
  });
});
