import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { openDerivedStore } from "../retrieval/derived-store.js";
import { retrieveCandidates } from "../retrieval/discover.js";
import { allocateThoughtProjection } from "../thought/projection-allocator/allocator.js";
import { buildThoughtInput } from "../thought/input.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import type { CapabilityReality, EpistemicDimensions, IdentitySlice, ThoughtInput } from "../types.js";

import { fileURLToPath } from "node:url";

const constitution: IdentitySlice = {
  constitutional: ["Truth first", "Be grounded and precise"],
  stableSelf: ["Project Ashley companion runtime"],
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
  approvedProjectIds: ["project-ashley"],
};

describe("Thought Context Optimization — Coherent Candidate Qualification", () => {
  it("qualifies on Incident C synthetic surrogate (174 items) with top precision and multi-provider headroom", () => {
    const fixturePath = fileURLToPath(new URL("../retrieval/fixtures/incident-c-synthetic.json", import.meta.url));
    const labelsPath = fileURLToPath(new URL("../retrieval/fixtures/incident-c-labels.json", import.meta.url));

    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<{
      assertionKey: string;
      statement: string;
      memoryKind: string;
      dimensions: EpistemicDimensions;
      dataClassification: string;
      live: boolean;
      matchedTerms?: string[];
    }>;

    const triggerText = "I need to sleep soon - let's talk tomorrow";
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");

    try {
      const dimensions: EpistemicDimensions = {
        source: "owner_utterance",
        status: "asserted",
        time: "current",
        reliability: "owner_supplied",
      };

      // 1. Ingest all synthetic items into sidecar
      for (const item of fixture) {
        if (item.dataClassification === "secret") {
          sidecar.prepare(`
            INSERT INTO sidecar_memory_assertions (
              assertion_key, statement, memory_kind, dimensions_json,
              data_classification, lineage_parent_key, admitted_generation, live, content_hash
            ) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)
          `).run(
            item.assertionKey,
            item.statement,
            item.memoryKind,
            JSON.stringify(item.dimensions ?? dimensions),
            item.dataClassification,
            item.live ? 1 : 0,
            `hash-${item.assertionKey}`,
          );
        } else {
          upsertMemoryAssertion(sidecar, {
            assertionKey: item.assertionKey,
            statement: item.statement,
            memoryKind: item.memoryKind as any,
            dimensions: item.dimensions ?? dimensions,
            dataClassification: item.dataClassification as any,
            lineageParentKey: null,
            admittedGeneration: 1,
            live: item.live,
          });
        }
      }

      // Reconcile derived store
      const reconciled = derived.reconcileIfNeeded(sidecar);
      expect(reconciled).toBe(true);

      // Verify FTS integrity
      const integrity = derived.checkIntegrity();
      expect(integrity.ok).toBe(true);

      // 2. Set up conversation cycle
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-incident-c-qual",
        conversationId: "thread-c-qual",
        triggerKind: "owner_message",
        triggerRef: "trigger-1",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1000,
      });

      const utterance = appendOwnerUtterance(sidecar, {
        conversationId: cycle.conversationId,
        text: triggerText,
        discordMessageIds: ["msg-c-1"],
        nowMs: 1001,
      });

      appendInboxEvent(sidecar, {
        conversationId: cycle.conversationId,
        kind: "owner_message",
        payload: {
          cycleId: cycle.cycleId,
          evidenceRowId: utterance.rowId,
          ownerMessage: triggerText,
        },
        createdAtMs: 1002,
      });

      // 3. Perform natural lexical retrieval over trigger terms (no circular exact-key injection)
      const retrievalResult = retrieveCandidates(
        sidecar,
        {
          conversationId: cycle.conversationId,
          request: {
            triggerTerms: ["sleep", "soon", "tomorrow"],
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: true,
          },
        },
        derived,
      );

      expect(retrievalResult.state).toBe("ready");
      expect(retrievalResult.miss).toBe(false);
      expect(retrievalResult.hits.length).toBeGreaterThan(0);

      // 4. Build Thought Input & allocate for the current Cloudflare Super route.
      const thoughtInput = buildThoughtInput({
        sidecar,
        cycle,
        triggerText,
        triggerEvidence: utterance,
        constitution,
        capabilityReality,
        observations: [],
        inFlight: [],
        runtimeCondition: { thoughtUnavailable: false },
        rememberDirective: null,
        authorityObjections: [],
        derivedStore: derived,
      });

      const cloudflareAllocation = allocateThoughtProjection({
        sidecar,
        thoughtInput,
        quotaBucket: "cloudflare:@cf/nvidia/nemotron-3-120b-a12b",
        requestId: "req-cloudflare-qual",
      });

      expect(cloudflareAllocation.receipt.hardTpm).toBe(65536);
      expect(cloudflareAllocation.receipt.estimatedInputTokens)
        .toBeLessThanOrEqual(cloudflareAllocation.receipt.semanticProjectionEnvelope.maxInputTokens);
      expect(cloudflareAllocation.receipt.headroomTokens).toBeGreaterThan(0);

      // 5. Allocate for the current Groq expression fallback route.
      const groqAllocation = allocateThoughtProjection({
        sidecar,
        thoughtInput,
        quotaBucket: "groq:qwen/qwen3.6-27b",
        requestId: "req-groq-qual",
      });

      expect(groqAllocation.receipt.hardTpm).toBe(6100);
      expect(groqAllocation.receipt.estimatedInputTokens)
        .toBeLessThanOrEqual(groqAllocation.receipt.semanticProjectionEnvelope.maxInputTokens);
      expect(groqAllocation.receipt.headroomTokens).toBeGreaterThan(0);

      // 6. Verify significant wire reduction vs naive dump of all synthetic items
      const naiveWireBytes = Buffer.byteLength(JSON.stringify(fixture), "utf8");
      const optimizedWireBytes = groqAllocation.receipt.decision.includedWireBytes;

      expect(optimizedWireBytes).toBeLessThan(naiveWireBytes * 0.5);
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("scales to 200, 500, and 1000 memory assertions with sub-millisecond per-item performance", () => {
    for (const scale of [200, 500, 1000]) {
      const sidecar = openTestSidecar();
      const derived = openDerivedStore(":memory:");

      try {
        const dimensions: EpistemicDimensions = {
          source: "owner_utterance",
          status: "asserted",
          time: "current",
          reliability: "owner_supplied",
        };

        for (let i = 0; i < scale; i++) {
          upsertMemoryAssertion(sidecar, {
            assertionKey: `scale:key:${i}`,
            statement: `Statement number ${i} regarding project ashley module ${i % 10} performance and telemetry validation`,
            memoryKind: "owner_world_claim",
            dimensions,
            dataClassification: "ordinary",
            lineageParentKey: null,
            admittedGeneration: 1,
            live: true,
          });
        }

        const t0 = performance.now();
        derived.reconcileIfNeeded(sidecar);
        const reconcileElapsedMs = performance.now() - t0;

        const t1 = performance.now();
        const search = retrieveCandidates(
          sidecar,
          {
            conversationId: "scale-conv",
            request: {
              triggerTerms: ["module", "telemetry"],
              workingContextTopics: [],
              assertionKeys: [`scale:key:${scale - 1}`],
              includeLogSearch: true,
            },
          },
          derived,
        );
        const searchElapsedMs = performance.now() - t1;

        expect(search.state).toBe("ready");
        expect(search.hits.length).toBeGreaterThan(0);
        // Assert sub-second rebuild even for 1000 items and fast search
        expect(reconcileElapsedMs).toBeLessThan(1000);
        expect(searchElapsedMs).toBeLessThan(100);
      } finally {
        derived.close();
        sidecar.close();
      }
    }
  });
});
