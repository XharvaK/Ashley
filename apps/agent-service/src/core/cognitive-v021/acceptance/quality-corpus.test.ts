import { describe, it, expect } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { openDerivedStore } from "../retrieval/derived-store.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { buildThoughtInput } from "../thought/input.js";
import { retrieveCandidates } from "../retrieval/discover.js";
import { allocateThoughtProjection } from "../thought/projection-allocator/allocator.js";
import { estimateRequestTokens } from "../../attention/estimate.js";
import { quotaContractFor } from "../../model-routing/router.js";
import { QUALITY_CORPUS_SCENARIOS } from "../test/fixtures/quality-corpus.js";
import type { IdentitySlice, CapabilityReality } from "../types.js";

const constitution: IdentitySlice = {
  constitutional: [
    "Truth first, relationship second, agency third",
    "Never feign capabilities or memories",
  ],
  stableSelf: ["Curious", "Attentive", "Disciplined"],
};

const capabilityReality: CapabilityReality = {
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
};

const HARD_TPM_CEILING = quotaContractFor("nim:openai/gpt-oss-20b").tpm; // 16,000

describe("Quality Corpus 18-Scenario Acceptance Qualification (§17.4, §18)", () => {
  for (const scenario of QUALITY_CORPUS_SCENARIOS) {
    it(`evaluates scenario [${scenario.name}] against hard architectural gates`, () => {
      const sidecar = openTestSidecar();
      const derived = openDerivedStore(":memory:");

      try {
        // 1. Insert memory assertions
        for (const item of scenario.memoryAssertions) {
          if (item.dataClassification === "secret") {
            sidecar.prepare(`
              INSERT INTO sidecar_memory_assertions (
                assertion_key, statement, memory_kind, dimensions_json,
                data_classification, lineage_parent_key, admitted_generation, live, content_hash
              ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'secrethash')
            `).run(
              item.assertionKey,
              item.statement,
              item.memoryKind,
              JSON.stringify(item.dimensions),
              item.dataClassification,
              item.lineageParentKey ?? null,
              item.live ? 1 : 0,
            );
          } else {
            upsertMemoryAssertion(sidecar, {
              assertionKey: item.assertionKey,
              statement: item.statement,
              memoryKind: item.memoryKind,
              dimensions: item.dimensions,
              dataClassification: item.dataClassification,
              lineageParentKey: item.lineageParentKey ?? null,
              admittedGeneration: 1,
              live: item.live,
            });
          }
        }

        // 2. Insert concerns if declared
        if (scenario.concerns) {
          for (const concern of scenario.concerns) {
            sidecar.prepare(`
              INSERT INTO concerns (concern_id, conversation_id, statement, source_refs_json, dimensions_json, assertion_key, status, snapshot_hash)
              VALUES (?, 'conv-1', 'Concern statement', '[]', '{}', ?, 'active', 'hash')
            `).run(concern.concernId, concern.assertionKey);
          }
        }

        // 3. Reconcile derived store
        derived.reconcileIfNeeded(sidecar);

        // 4. Setup conversation and cycle
        const cycle = admitTestCycle(sidecar, {
          conversationId: "conv-1",
          triggerKind: "owner_message",
          triggerRef: "ev-trigger",
          occupantId: "owner-1",
        });

        for (let i = 0; i < scenario.rawConversation.length; i++) {
          const raw = scenario.rawConversation[i];
          appendOwnerUtterance(sidecar, {
            conversationId: "conv-1",
            text: raw.text,
            discordMessageIds: [`msg-${i}`],
          });
        }

        // 5. Build Working Context items
        const workingContext = scenario.workingContext.map((wc) => ({
          id: wc.id,
          conversationId: "conv-1",
          type: wc.type,
          text: wc.text,
          concernId: wc.concernId ?? null,
          sourceTurnIds: [],
          status: "active" as const,
          supersedesId: null,
          updatedGeneration: 1,
        }));

        // 6. Build ThoughtInput (assembling evidence)
        const thoughtInput = buildThoughtInput({
          sidecar,
          cycle,
          triggerText: scenario.triggerText,
          constitution,
          capabilityReality,
          observations: [],
          inFlight: [],
          runtimeCondition: { thoughtUnavailable: false },
          rememberDirective: null,
          authorityObjections: [],
          workingContext,
          derivedStore: derived,
        });

        // 7. Allocate Thought Projection
        const allocated = allocateThoughtProjection({
          thoughtInput,
          requestId: `req-${scenario.name}`,
          maxOutputTokens: 4096,
        });

        // 8. Verification against Hard Gates:

        // Gate A: Total demand <= 16000 TPM
        const estimate = estimateRequestTokens(allocated.messages as any, { maxTokens: 4096 });
        const totalDemand = estimate.estimatedInputTokens + 4096;
        expect(totalDemand).toBeLessThanOrEqual(HARD_TPM_CEILING);

        // Gate B: currentTriggerAltered === 0
        expect(allocated.projected.trigger.ref).toBe("ev-trigger");

        // Gate C: constitutionalContextLost === 0
        expect(allocated.projected.constitution.constitutional).toEqual(constitution.constitutional);

        // Gate D: wcRequiredPreserved === true
        const requiredWcTypes = new Set(["correction", "referent", "repair", "commitment_temp"]);
        const originalRequiredWc = workingContext.filter((w) => requiredWcTypes.has(w.type));
        const projectedWcIds = new Set(allocated.projected.workingContext.map((w) => w.id));
        for (const req of originalRequiredWc) {
          expect(projectedWcIds.has(req.id)).toBe(true);
        }

        // Gate E: requiredEvidenceLost === 0
        const projectedHitKeys = new Set(allocated.projected.retrieval.hits.map((h) => h.ref));
        for (const reqKey of scenario.expected.requiredEvidence) {
          expect(projectedHitKeys.has(reqKey)).toBe(true);
        }

        // Gate F: dangerousIrrelevant is NOT present
        for (const dangKey of scenario.expected.dangerousIrrelevant) {
          expect(projectedHitKeys.has(dangKey)).toBe(false);
        }

        // Gate G: Secret rows never leak into projected retrieval
        const secretHits = allocated.projected.retrieval.hits.filter(
          (h) => "snippet" in h && h.snippet.includes("supersecret123"),
        );
        expect(secretHits.length).toBe(0);

        // Gate H: Expect miss handled cleanly
        if (scenario.expected.expectMiss) {
          expect(allocated.projected.retrieval.hits.length).toBe(0);
          expect(allocated.projected.retrieval.miss).toBe(true);
        }
      } finally {
        derived.close();
        sidecar.close();
      }
    });
  }
});
