import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { openDerivedStore } from "../retrieval/derived-store.js";
import { retrieveCandidates, tokenizeForDiscovery } from "../retrieval/discover.js";
import { buildThoughtInput } from "../thought/input.js";
import { allocateThoughtProjection } from "../thought/projection-allocator/allocator.js";
import { admitTestCycle } from "../test-support.js";

describe("Thought Context Scale Qualification Harness (1K, 10K, 100K)", () => {
  const scales = [1_000, 10_000, 100_000];

  for (const count of scales) {
    it(`evaluates retrieval and projection allocation at scale N = ${count.toLocaleString()}`, () => {
      const tmpDir = mkdtempSync(join(tmpdir(), `ashley-scale-${count}-`));
      const sidecarPath = join(tmpDir, "sidecar.db");
      const derivedPath = join(tmpDir, "derived.db");
      let sidecar: DatabaseSync | null = null;
      let derived: ReturnType<typeof openDerivedStore> | null = null;

      try {
        const sidecarRaw = new DatabaseSync(sidecarPath);
        sidecar = openCognitiveSidecarDb(sidecarRaw, { dataPlane: { kind: "isolated" } });
        derived = openDerivedStore(derivedPath);

        // Populate sidecar with `count` assertions
        const insertStmt = sidecar.prepare(`
          INSERT INTO sidecar_memory_assertions
            (assertion_key, statement, memory_kind, dimensions_json, data_classification, live, content_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        sidecar.exec("BEGIN TRANSACTION;");
        const dimensionsJson = JSON.stringify({
          source: "owner_utterance",
          status: "asserted",
          time: "current",
          reliability: "owner_supplied",
        });

        for (let i = 1; i <= count; i++) {
          const isTarget = i % 100 === 0;
          const statement = isTarget
            ? `Target validation record number ${i} concerning quantum infrastructure verification.`
            : `Ordinary contextual memory statement ${i} about operational topics and general knowledge.`;
          insertStmt.run(
            `scale:key:${i}`,
            statement,
            "owner_world_claim",
            dimensionsJson,
            "ordinary",
            1,
            `hash-${i}`,
          );
        }
        sidecar.exec("COMMIT;");

        // 1. Initial reconcile / build duration
        const startReconcile = performance.now();
        const reconciled = derived.reconcile(sidecar);
        const reconcileDurationMs = performance.now() - startReconcile;
        expect(reconciled).toBe(true);

        // 2. Instrument sidecar for whole-source scans during valid queries
        let fullSourceScans = 0;
        const originalPrepare = sidecar.prepare.bind(sidecar);
        sidecar.prepare = (sql: string) => {
          if (
            sql.includes("SELECT assertion_key, content_hash FROM sidecar_memory_assertions") ||
            sql.includes("SELECT row_id, content_hash, version FROM conversation_evidence_log")
          ) {
            fullSourceScans += 1;
          }
          return originalPrepare(sql);
        };

        // 3. Normal valid query duration and candidate retrieval
        const queryText = "quantum infrastructure verification validation";
        const triggerTerms = tokenizeForDiscovery(queryText);
        const startQuery = performance.now();
        const candidates = retrieveCandidates(
          sidecar,
          {
            conversationId: "thread-scale",
            request: {
              triggerTerms,
              assertionKeys: [],
              workingContextTopics: [],
              includeLogSearch: true,
            },
          },
          derived,
        );
        const queryDurationMs = performance.now() - startQuery;

        expect(candidates.state).toBe("ready");
        expect(candidates.hits.length).toBeGreaterThan(0);
        expect(fullSourceScans).toBe(0); // HARD INVARIANT: zero full source scans on valid queries

        // 4. Build Thought Input and Allocate Projection
        const cycle = admitTestCycle(sidecar, {
          cycleId: `cycle-scale-${count}`,
          conversationId: "thread-scale",
          generation: 1,
          triggerKind: "owner_message",
          triggerRef: "msg-scale-1",
          occupantId: "doc",
          nowMs: 1000,
        });

        const input = buildThoughtInput({
          sidecar,
          cycle,
          triggerText: queryText,
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
          observations: [],
          inFlight: [],
          runtimeCondition: { thoughtUnavailable: false },
          rememberDirective: null,
          authorityObjections: [],
          derivedStore: derived,
        });

        const startAlloc = performance.now();
        const allocated = allocateThoughtProjection({
          thoughtInput: input,
          requestId: randomUUID(),
        });
        const allocDurationMs = performance.now() - startAlloc;

        const receipt = allocated.receipt;

        // HARD INVARIANTS: Bounded model-visible Thought input within the
        // provider-independent semantic projection envelope. Provider quota
        // metadata is owned by Attention and is intentionally absent here.
        expect(receipt.estimatedInputTokens).toBeLessThanOrEqual(receipt.semanticProjectionEnvelope.maxInputTokens);
        expect(receipt.hardTpm).toBe(0);
        expect(receipt.headroomTokens).toBeGreaterThanOrEqual(0);
        expect(receipt.requiredOverflow).toBe(false);
        expect(fullSourceScans).toBe(0);

        // Record metrics
        console.log(
          `[SCALE N=${count.toLocaleString()}] Reconcile: ${reconcileDurationMs.toFixed(2)}ms | ` +
          `Query: ${queryDurationMs.toFixed(2)}ms | Alloc: ${allocDurationMs.toFixed(2)}ms | ` +
          `Hits: ${candidates.hits.length} | WireBytes: ${receipt.decision.includedWireBytes}B | ` +
          `InputTokens: ${receipt.estimatedInputTokens} | TotalDemand: ${receipt.totalDemandTokens} | ` +
          `FullScans: ${fullSourceScans}`
        );
      } finally {
        try { derived?.close(); } catch { /* ignore */ }
        try { sidecar?.close(); } catch { /* ignore */ }
        try {
          rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        } catch {
          // Ignore Windows pending file locks on temp test dirs
        }
      }
    });
  }
});
