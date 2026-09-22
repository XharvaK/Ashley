import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import {
  migrateConcernsToV24,
  openCognitiveSidecarDb,
  type ConcernsV24MigrationReport,
} from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import { COGNITIVE_SIDECAR_SCHEMA_V1, COGNITIVE_SIDECAR_SCHEMA_V2 } from "../schema.js";

type LegacyConcern = {
  concernId: string;
  conversationId?: string;
  statement: string;
  sourceRefsJson?: string;
  dimensionsJson?: string;
  assertionKey?: string | null;
  status: string;
};

const IMPORT_DIMENSIONS = JSON.stringify({
  source: "prior_settlement",
  status: "unverified",
  time: "historical",
  reliability: "unavailable_source",
});

/**
 * Build a genuine v23 sidecar: the V1 DDL still carries the legacy
 * `concerns.status NOT NULL` column, and the v24 rebuild is what retires it.
 */
function legacySidecar(concerns: readonly LegacyConcern[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
  db.prepare(
    `INSERT INTO cognitive_sidecar_meta
       (id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version, authority_epoch)
     VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 2, 1)`,
  ).run();
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V2);
  db.exec(`
    PRAGMA user_version = 23;
    UPDATE cognitive_sidecar_meta SET schema_version = 23 WHERE id = 1;
  `);
  for (const concern of concerns) {
    db.prepare(
      `INSERT INTO concerns
         (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
          assertion_key, status, snapshot_hash, updated_cycle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      concern.concernId,
      concern.conversationId ?? "thread-v24",
      concern.statement,
      concern.sourceRefsJson ?? '["turn-1"]',
      concern.dimensionsJson ?? '{"source":"owner_utterance","status":"asserted","time":"historical","reliability":"owner_supplied"}',
      concern.assertionKey ?? null,
      concern.status,
      `snapshot-${concern.concernId}`,
    );
  }
  return db;
}

function addOccupancy(db: DatabaseSync, concernId: string, status: string, priority = 5): void {
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES ('thread-v24', ?, ?, ?, 'legacy-import', 0)`,
  ).run(concernId, status, priority);
}

function concernRow(db: DatabaseSync, concernId: string): Record<string, unknown> {
  const row = db.prepare("SELECT * FROM concerns WHERE concern_id = ?").get(concernId) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`concern_missing:${concernId}`);
  return row;
}

function occupancyRow(db: DatabaseSync, concernId: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM mind_occupancy WHERE concern_id = ?").get(concernId) as
    | Record<string, unknown>
    | undefined;
}

function migrate(db: DatabaseSync): ConcernsV24MigrationReport {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("BEGIN IMMEDIATE");
  try {
    const report = migrateConcernsToV24(db);
    db.exec("PRAGMA user_version = 24");
    db.exec("COMMIT");
    return report;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
}

describe("cognitive sidecar Schema V24 concern authority separation", () => {
  it("retires the physical NOT NULL status column and adds the three axes", () => {
    const db = legacySidecar([
      { concernId: "concern-active", statement: "Active meaning.", status: "active" },
    ]);
    try {
      migrate(db);
      const columns = (db.prepare("PRAGMA table_info(concerns)").all() as Array<{ name: string; notnull: number }>);
      const names = columns.map((column) => column.name);
      expect(names).toContain("cognitive_status");
      expect(names).toContain("quarantine_kind");
      expect(names).toContain("forgotten");
      expect(names).not.toContain("status");
      expect(columns.find((column) => column.name === "cognitive_status")?.notnull).toBe(0);
      expect(concernRow(db, "concern-active")).toMatchObject({
        cognitive_status: "active",
        quarantine_kind: null,
        forgotten: 0,
      });
    } finally {
      db.close();
    }
  });

  it("classifies every legacy shape without inventing cognition or provenance", () => {
    const db = legacySidecar([
      { concernId: "concern-grounded", statement: "Grounded meaning.", status: "active" },
      { concernId: "concern-dormant", statement: "Dormant meaning.", status: "dormant_but_revisitable" },
      { concernId: "concern-resolved", statement: "Resolved meaning.", status: "resolved" },
      { concernId: "concern-forgotten", statement: "", sourceRefsJson: "[]", assertionKey: null, status: "resolved" },
      {
        concernId: "concern-redacted-unlabelled",
        statement: "",
        sourceRefsJson: "[]",
        assertionKey: null,
        status: "active",
      },
      {
        concernId: "legacy:concern:7",
        statement: "Imported meaning.",
        dimensionsJson: IMPORT_DIMENSIONS,
        status: "quarantined",
      },
      { concernId: "concern-unknown-quarantine", statement: "Doubtful meaning.", status: "quarantined" },
      {
        concernId: "concern-partial-resolved",
        statement: "Partial meaning.",
        sourceRefsJson: "[]",
        status: "resolved",
      },
    ]);
    for (const concernId of [
      "concern-grounded",
      "concern-dormant",
      "concern-resolved",
      "concern-forgotten",
      "legacy:concern:7",
      "concern-unknown-quarantine",
      "concern-partial-resolved",
    ]) {
      addOccupancy(db, concernId, concernId === "legacy:concern:7" || concernId === "concern-unknown-quarantine"
        ? "quarantined"
        : "active");
    }
    try {
      const report = migrate(db);
      expect(report).toMatchObject({
        forgetSignatureClassified: 1,
        redactedWithoutResolvedLabel: 1,
        importQuarantineClassified: 1,
        unknownQuarantineClassified: 1,
        // `concern-partial-resolved` keeps its cognitive `resolved` label and is
        // reported as ambiguous rather than silently promoted or discarded.
        ambiguousResolvedKeptCognitive: 1,
      });

      // Known cognition survives unchanged and keeps its occupancy mirror.
      expect(concernRow(db, "concern-grounded")).toMatchObject({ cognitive_status: "active", quarantine_kind: null, forgotten: 0 });
      expect(concernRow(db, "concern-dormant")).toMatchObject({ cognitive_status: "dormant_but_revisitable", quarantine_kind: null });
      expect(concernRow(db, "concern-resolved")).toMatchObject({ cognitive_status: "resolved", quarantine_kind: null });

      // Forget is a privacy fact, never a cognitive judgment.
      for (const concernId of ["concern-forgotten", "concern-redacted-unlabelled"]) {
        expect(concernRow(db, concernId)).toMatchObject({
          cognitive_status: null,
          quarantine_kind: null,
          forgotten: 1,
          statement: "",
        });
        expect(occupancyRow(db, concernId)).toBeUndefined();
      }

      // Quarantine is a Host provenance fact, never an invented cognitive status.
      expect(concernRow(db, "legacy:concern:7")).toMatchObject({
        cognitive_status: null,
        quarantine_kind: "legacy_unavailable_source",
        forgotten: 0,
        statement: "Imported meaning.",
      });
      expect(concernRow(db, "concern-unknown-quarantine")).toMatchObject({
        cognitive_status: null,
        quarantine_kind: "legacy_quarantine_reason_unavailable",
        forgotten: 0,
      });

      // Ambiguous resolved material stays inspectable and is not called forgotten.
      expect(concernRow(db, "concern-partial-resolved")).toMatchObject({
        cognitive_status: "resolved",
        quarantine_kind: null,
        forgotten: 0,
      });
    } finally {
      db.close();
    }
  });

  it("deletes quarantine and NULL-status occupancy and repairs divergence", () => {
    const db = legacySidecar([
      { concernId: "concern-divergent", statement: "Divergent meaning.", status: "active" },
      {
        concernId: "concern-missing-occupancy",
        statement: "Missing occupancy meaning.",
        status: "investigating",
      },
      { concernId: "concern-unknown-quarantine", statement: "Doubtful meaning.", status: "quarantined" },
    ]);
    addOccupancy(db, "concern-divergent", "waiting_for_evidence", 9);
    addOccupancy(db, "concern-unknown-quarantine", "quarantined", 1);
    try {
      const report = migrate(db);
      expect(report.divergenceRepaired).toBe(1);
      expect(report.missingOccupancyLeft).toBe(1);
      // Concern wins; no priority or generation is invented.
      expect(occupancyRow(db, "concern-divergent")).toMatchObject({
        status: "active",
        priority: 9,
        updated_cycle: "legacy-import",
        updated_generation: 0,
      });
      // Missing occupancy is left missing rather than fabricated.
      expect(occupancyRow(db, "concern-missing-occupancy")).toBeUndefined();
      expect(concernRow(db, "concern-missing-occupancy")).toMatchObject({ cognitive_status: "investigating" });
      // Legacy quarantine occupancy was never a cognitive mirror.
      expect(occupancyRow(db, "concern-unknown-quarantine")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("is idempotent and converges when the migration is re-run", () => {
    const db = legacySidecar([
      { concernId: "concern-grounded", statement: "Grounded meaning.", status: "active" },
      { concernId: "concern-forgotten", statement: "", sourceRefsJson: "[]", status: "resolved" },
    ]);
    try {
      migrate(db);
      const second = migrate(db);
      expect(second).toMatchObject({
        forgetSignatureClassified: 0,
        importQuarantineClassified: 0,
        unknownQuarantineClassified: 0,
        divergenceRepaired: 0,
      });
      expect(concernRow(db, "concern-grounded")).toMatchObject({ cognitive_status: "active" });
      expect(concernRow(db, "concern-forgotten")).toMatchObject({ forgotten: 1, cognitive_status: null });
    } finally {
      db.close();
    }
  });

  it("opens a fresh v24 store through the public migration chain", () => {
    const db = openTestSidecar();
    try {
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
        .toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      const names = (db.prepare("PRAGMA table_info(concerns)").all() as Array<{ name: string }>)
        .map((column) => column.name);
      expect(names).toContain("cognitive_status");
      expect(names).not.toContain("status");
      // Re-opening converges without re-classifying anything.
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("SELECT COUNT(*) AS count FROM concerns").get() as { count: number }).count).toBe(0);
    } finally {
      db.close();
    }
  });
});
