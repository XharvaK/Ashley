import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import { insertAssertion } from "./assertions.js";
import { validateNuclearV47Schema, V47_TABLE_COLUMNS } from "./migration-47.js";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { upsertMemoryAssertion } from "../cognitive-v021/memory/assertions.js";
import { openDerivedStore } from "../cognitive-v021/retrieval/derived-store.js";
import { searchMemoryFts } from "../cognitive-v021/retrieval/fts.js";

describe("nuclear migration 47 relational bindings", () => {
  it("lands V47 columns/table and preserves legacy NULL/default behavior", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(50);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(50);
      validateNuclearV47Schema(db);

      for (const [table, columns] of Object.entries(V47_TABLE_COLUMNS)) {
        const actual = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
          .map((column) => column.name));
        expect([...columns].every((column) => actual.has(column))).toBe(true);
      }
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'commitment_settlements'",
      ).get()).toEqual({ 1: 1 });

      const assertionId = insertAssertion(db, {
        ownerId: "owner-1",
        kind: "keyed_fact",
        subjectFacet: "owner_model",
        lineageKind: "explicit_seed",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I0",
        category: "project",
        key: "legacy-v47",
        value: "legacy row",
        sourceKind: "test",
      });
      expect(db.prepare(
        `SELECT speaker_principal, audience_scope, source_evidence_ref,
                protection_subjects_json, protection_basis_refs_json, protection_status
           FROM memory_assertions WHERE id = ?`,
      ).get(assertionId)).toEqual({
        speaker_principal: null,
        audience_scope: null,
        source_evidence_ref: null,
        protection_subjects_json: null,
        protection_basis_refs_json: null,
        protection_status: null,
      });

      db.prepare(
        `INSERT INTO delivery_reservations
          (owner_id, channel, thread_id, trigger, state, created_at)
         VALUES (?, ?, ?, 'reactive', 'drafted', ?)` ,
      ).run("owner-1", "discord", "thread-1", "2026-09-15T12:00:00.000Z");
      expect(db.prepare(
        "SELECT destination_json, attempt_input_basis_json, hard_dependency_bundle_json, license_refs_json FROM delivery_reservations",
      ).get()).toEqual({
        destination_json: null,
        attempt_input_basis_json: null,
        hard_dependency_bundle_json: null,
        license_refs_json: "[]",
      });

      for (const table of ["doc_reminders", "ashley_self_commitments", "mutual_commitments"]) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
          notnull: number;
          dflt_value: string | null;
        }>;
        expect(columns.find((column) => column.name === "attempt_count")).toMatchObject({
          notnull: 1,
          dflt_value: "0",
        });
      }
    } finally {
      db.close();
    }
  });

  it("keeps legacy memory FTS rows searchable after the V47 migration", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    try {
      upsertMemoryAssertion(sidecar, {
        assertionKey: "legacy:fts:v47",
        statement: "legacy V47 migration search witness",
        memoryKind: "owner_world_claim",
        dimensions: {
          source: "owner_utterance",
          status: "asserted",
          time: "current",
          reliability: "owner_supplied",
        },
        dataClassification: "ordinary",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      derived.reconcileIfNeeded(sidecar);
      expect(searchMemoryFts(derived, sidecar, '"V47"').rows.map((row) => row.assertionKey))
        .toEqual(["legacy:fts:v47"]);
    } finally {
      derived.close();
      sidecar.close();
    }
  });
});
