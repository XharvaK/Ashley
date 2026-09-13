import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../../test-support.js";
import { openCognitiveSidecarDb } from "../../sidecar/db.js";
import { upsertMemoryAssertion } from "../../memory/assertions.js";
import { DerivedStore, openDerivedStore } from "../derived-store.js";
import { searchMemoryFts, searchConversationFts } from "../fts.js";

describe("Derived FTS Store & Index Synchronization", () => {
  it("initializes virtual tables, passes integrity check, and backfills from sidecar", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");

    try {
      const dimensions = {
        source: "owner_utterance" as const,
        status: "asserted" as const,
        time: "current" as const,
        reliability: "owner_supplied" as const,
      };

      for (let i = 0; i < 50; i++) {
        upsertMemoryAssertion(sidecar, {
          assertionKey: `key:${i}`,
          statement: `Statement ${i} about Project Ashley and HY3 engine`,
          memoryKind: "owner_world_claim",
          dimensions,
          dataClassification: i % 2 === 0 ? "ordinary" : "never_public",
          lineageParentKey: null,
          admittedGeneration: 1,
          live: true,
        });
      }

      // Reconcile / backfill into derived store
      const reconciled = derived.reconcileIfNeeded(sidecar);
      expect(reconciled).toBe(true);

      const integrity = derived.checkIntegrity();
      expect(integrity.ok).toBe(true);
      expect(integrity.pragma).toBe("ok");
      expect(integrity.memoryFts).toBe("ok");
      expect(integrity.conversationFts).toBe("ok");

      const state = derived.getIndexState();
      expect(state).not.toBeNull();
      expect(state?.status).toBe("valid");
      expect(state?.sidecarAssertionCount).toBe(50);

      // Search memory FTS
      const result = searchMemoryFts(derived, sidecar, '"HY3"');
      expect(result.state).toBe("ready");
      expect(result.rows.length).toBe(50);
      expect(result.rows[0].statement).toContain("HY3");
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("never copies secret-classified rows into memory_fts or conversation_fts", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");

    try {
      const dimensions = {
        source: "owner_utterance" as const,
        status: "asserted" as const,
        time: "current" as const,
        reliability: "owner_supplied" as const,
      };

      sidecar.prepare(`
        INSERT INTO sidecar_memory_assertions (
          assertion_key, statement, memory_kind, dimensions_json,
          data_classification, lineage_parent_key, admitted_generation, live, content_hash
        ) VALUES (
          'mem:secret:1', 'Top secret credentials password123', 'owner_world_claim',
          '{"source":"owner_utterance","status":"asserted","time":"current","reliability":"owner_supplied"}',
          'secret', NULL, 1, 1, 'secrethash'
        )
      `).run();

      upsertMemoryAssertion(sidecar, {
        assertionKey: "mem:sensitive:1",
        statement: "Sensitive personal detail",
        memoryKind: "owner_world_claim",
        dimensions,
        dataClassification: "sensitive",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });

      upsertMemoryAssertion(sidecar, {
        assertionKey: "mem:never_public:1",
        statement: "Never public private note",
        memoryKind: "owner_world_claim",
        dimensions,
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });

      derived.reconcileIfNeeded(sidecar);

      // Inspect virtual table directly
      const allFts = derived.db.prepare("SELECT assertion_key, statement FROM memory_fts").all() as Array<{
        assertion_key: string;
        statement: string;
      }>;

      expect(allFts.map((r) => r.assertion_key)).not.toContain("mem:secret:1");
      expect(allFts.map((r) => r.assertion_key)).toContain("mem:sensitive:1");
      expect(allFts.map((r) => r.assertion_key)).toContain("mem:never_public:1");

      const secretSearch = searchMemoryFts(derived, sidecar, '"password123"');
      expect(secretSearch.rows.length).toBe(0);

      const sensitiveSearch = searchMemoryFts(derived, sidecar, '"Sensitive"');
      expect(sensitiveSearch.rows.length).toBe(1);

      const neverPublicSearch = searchMemoryFts(derived, sidecar, '"Never"');
      expect(neverPublicSearch.rows.length).toBe(1);
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("detects same-key statement mutation with unchanged row count via fingerprint", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");

    try {
      const dimensions = {
        source: "owner_utterance" as const,
        status: "asserted" as const,
        time: "current" as const,
        reliability: "owner_supplied" as const,
      };

      upsertMemoryAssertion(sidecar, {
        assertionKey: "mem:key:1",
        statement: "Original text about cats",
        memoryKind: "owner_preference",
        dimensions,
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });

      derived.reconcileIfNeeded(sidecar);
      expect(searchMemoryFts(derived, sidecar, '"cats"').rows.length).toBe(1);

      // Mutate statement on sidecar directly
      sidecar.prepare(`
        UPDATE sidecar_memory_assertions
        SET statement = 'Mutated text about dogs',
            content_hash = 'newhash123'
        WHERE assertion_key = 'mem:key:1'
      `).run();

      // Row count is still 1, but fingerprint changed
      derived.reconcileIfNeeded(sidecar);

      expect(searchMemoryFts(derived, sidecar, '"cats"').rows.length).toBe(0);
      expect(searchMemoryFts(derived, sidecar, '"dogs"').rows.length).toBe(1);
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("synchronizes incrementally via syncAfterCommit", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");

    try {
      const dimensions = {
        source: "owner_utterance" as const,
        status: "asserted" as const,
        time: "current" as const,
        reliability: "owner_supplied" as const,
      };

      upsertMemoryAssertion(sidecar, {
        assertionKey: "key:sync:1",
        statement: "Initial assertion statement",
        memoryKind: "owner_preference",
        dimensions,
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });

      derived.reconcileIfNeeded(sidecar);
      expect(searchMemoryFts(derived, sidecar, '"Initial"').rows.length).toBe(1);

      // Sidecar transaction commits new assertion
      upsertMemoryAssertion(sidecar, {
        assertionKey: "key:sync:2",
        statement: "Second assertion statement",
        memoryKind: "owner_preference",
        dimensions,
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });

      // Post-commit sync
      derived.syncAfterCommit(sidecar, { changedAssertionKeys: ["key:sync:2"] });

      expect(searchMemoryFts(derived, sidecar, '"Second"').rows.length).toBe(1);
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("handles invalid status by returning unavailable or rebuilding", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");

    try {
      const dimensions = {
        source: "owner_utterance" as const,
        status: "asserted" as const,
        time: "current" as const,
        reliability: "owner_supplied" as const,
      };

      upsertMemoryAssertion(sidecar, {
        assertionKey: "k1",
        statement: "Some valid statement",
        memoryKind: "owner_preference",
        dimensions,
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });

      derived.reconcileIfNeeded(sidecar);
      derived.markInvalid();

      expect(derived.getIndexState()?.status).toBe("invalid");

      // Searching triggers reconcileIfNeeded and recovers
      const search = searchMemoryFts(derived, sidecar, '"valid"');
      expect(search.state).toBe("ready");
      expect(search.rows.length).toBe(1);
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("proves VALID_DERIVED_STORE_SEARCH_FULL_SOURCE_SCANS = 0 during search on valid derived store", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");

    try {
      const dimensions = {
        source: "owner_utterance" as const,
        status: "asserted" as const,
        time: "current" as const,
        reliability: "owner_supplied" as const,
      };

      for (let i = 0; i < 100; i++) {
        upsertMemoryAssertion(sidecar, {
          assertionKey: `scale:item:${i}`,
          statement: `Item ${i} memory assertion for zero-scan validation`,
          memoryKind: "owner_world_claim",
          dimensions,
          dataClassification: "ordinary",
          lineageParentKey: null,
          admittedGeneration: 1,
          live: true,
        });
      }

      // Initial reconciliation
      derived.reconcile(sidecar);
      expect(derived.getIndexState()?.status).toBe("valid");

      // Spy on full-table scan query preparation in sidecar
      let fullSourceScans = 0;
      const originalPrepare = sidecar.prepare.bind(sidecar);
      sidecar.prepare = (sql: string) => {
        if (sql.includes("SELECT assertion_key, content_hash FROM sidecar_memory_assertions") ||
            sql.includes("SELECT row_id, content_hash, version FROM conversation_evidence_log")) {
          fullSourceScans += 1;
        }
        return originalPrepare(sql);
      };

      // Perform 10 searches on the valid store
      for (let i = 0; i < 10; i++) {
        const result = searchMemoryFts(derived, sidecar, "validation");
        expect(result.state).toBe("ready");
        expect(result.rows.length).toBe(100);
      }

      // Assert zero full source scans occurred during valid-store searches
      expect(fullSourceScans).toBe(0);
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("fails closed on orphaned FTS row missing from authoritative sidecar", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");

    try {
      // Reconcile clean store first to establish valid state
      derived.reconcile(sidecar);
      expect(derived.getIndexState()?.status).toBe("valid");

      // Direct insertion of orphan entry into FTS table (simulating store corruption / orphan row)
      derived.db.prepare("INSERT INTO memory_fts (assertion_key, statement, memory_kind) VALUES (?, ?, ?)").run(
        "orphan:key:1",
        "Orphaned assertion statement",
        "owner_world_claim",
      );

      const result = searchMemoryFts(derived, sidecar, "Orphaned");
      // Must fail closed with unavailable, not return ordinary / unclassified row
      expect(result.state).toBe("unavailable");
      expect(result.rows).toEqual([]);
      expect(derived.getIndexState()?.status).toBe("invalid");
    } finally {
      derived.close();
      sidecar.close();
    }
  });

  it("detects commit->crash gap on startup, rebuilds derived store, and restores zero-scan valid reads", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ashley-crash-gap-"));
    const sidecarPath = join(tmpDir, "sidecar.db");
    const derivedPath = join(tmpDir, "derived.db");

    try {
      const dimensions = {
        source: "owner_utterance" as const,
        status: "asserted" as const,
        time: "current" as const,
        reliability: "owner_supplied" as const,
      };

      // 1. First process lifecycle: initialize and reconcile
      let sidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
      let derived = openDerivedStore(derivedPath);

      for (let i = 0; i < 5; i++) {
        upsertMemoryAssertion(sidecar, {
          assertionKey: `gap:key:${i}`,
          statement: `Statement ${i} before crash`,
          memoryKind: "owner_world_claim",
          dimensions,
          dataClassification: "ordinary",
          lineageParentKey: null,
          admittedGeneration: 1,
          live: true,
        });
      }

      derived.reconcile(sidecar);
      expect(derived.getIndexState()?.status).toBe("valid");

      // 2. Authoritative COMMIT succeeds, but process crashes before derived sync
      upsertMemoryAssertion(sidecar, {
        assertionKey: "gap:key:crash_target",
        statement: "UniqueCrashTargetStatement committed before crash",
        memoryKind: "owner_world_claim",
        dimensions,
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });

      // Intentionally DO NOT sync derived store. Close both DB handles simulating crash.
      derived.close();
      sidecar.close();

      // 3. New process lifecycle: reopen both database files
      sidecar = openCognitiveSidecarDb(new DatabaseSync(sidecarPath), { dataPlane: { kind: "isolated" } });
      derived = openDerivedStore(derivedPath);

      // Pre-startup check: derived store file still has status 'valid', but is out of sync with sidecar
      const preState = derived.getIndexState();
      expect(preState?.status).toBe("valid");
      expect(preState?.sidecarAssertionCount).toBe(5); // Stale count before startup reconciliation

      // 4. Run authoritative startup reconciliation
      const reconciled = derived.reconcileAtStartup(sidecar);
      expect(reconciled).toBe(true);

      const postState = derived.getIndexState();
      expect(postState?.status).toBe("valid");
      expect(postState?.sidecarAssertionCount).toBe(6); // Accurately reflects 6 sidecar rows

      // 5. Prove new source row is now lexically retrievable
      const search = searchMemoryFts(derived, sidecar, "UniqueCrashTargetStatement");
      expect(search.state).toBe("ready");
      expect(search.rows.length).toBe(1);
      expect(search.rows[0].assertionKey).toBe("gap:key:crash_target");

      // 6. Prove zero full source scans on subsequent normal queries
      let fullSourceScans = 0;
      const originalPrepare = sidecar.prepare.bind(sidecar);
      sidecar.prepare = (sql: string) => {
        if (sql.includes("SELECT assertion_key, content_hash FROM sidecar_memory_assertions") ||
            sql.includes("SELECT row_id, content_hash, version FROM conversation_evidence_log")) {
          fullSourceScans += 1;
        }
        return originalPrepare(sql);
      };

      for (let i = 0; i < 5; i++) {
        const query = searchMemoryFts(derived, sidecar, "UniqueCrashTargetStatement");
        expect(query.state).toBe("ready");
      }
      expect(fullSourceScans).toBe(0);

      derived.close();
      sidecar.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
