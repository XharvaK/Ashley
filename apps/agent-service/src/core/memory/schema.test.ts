import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb, migrate } from "../db.js";
import {
  forgetByTopic,
  upsertFact,
} from "./facts.js";
import { createEpisode } from "./episodes.js";
import {
  insertMessage,
  resolveActiveThread,
} from "./threads.js";

const OWNER_ID = "doc";
const PRE_C1_SCHEMA_VERSION = 34;

const C1_TABLES = [
  "memory_contract_state",
  "memory_assertions",
  "memory_corrections",
  "memory_correction_targets",
  "memory_deny_barriers",
  "memory_deny_barrier_members",
  "memory_contradictions",
  "memory_derivation_links",
  "memory_episode_claims",
  "memory_correction_receipts",
  "memory_correction_outcomes",
  "memory_reconciliation_requests",
] as const;

const REQUIRED_COLUMNS: Record<string, string[]> = {
  memory_contract_state: [
    "c1_contract_version",
    "currentness_authority",
    "cutover_at",
    "applied_c1_authority_exists",
    "correction_seq",
  ],
  memory_assertions: [
    "entity_uuid",
    "owner_id",
    "kind",
    "subject_facet",
    "lineage_kind",
    "derivation_kind",
    "support_state",
    "influence_class",
    "category",
    "key",
    "value",
    "claim_text",
    "source_kind",
    "source_entity_uuid",
    "source_message_id",
    "source_quote",
    "legacy_fact_id",
    "legacy_episode_id",
    "recorded_at",
    "valid_from",
    "valid_to",
    "world_interval_basis",
    "authority_from",
    "authority_to",
    "authority_basis",
    "termination_reason",
    "superseded_by_assertion_id",
    "confidence",
    "importance",
    "data_classification",
    "created_at",
    "updated_at",
  ],
  memory_corrections: [
    "entity_uuid",
    "owner_id",
    "source_message_id",
    "correction_ordinal",
    "admission_path",
    "class",
    "scope_text",
    "proposal_json",
    "lifecycle_status",
    "stop_required",
    "barrier_id",
    "adjudicated_at",
    "idempotency_key",
    "capability_mode_at_write",
  ],
  memory_correction_targets: [
    "correction_id",
    "assertion_id",
    "inclusion_reason",
    "resolution_basis",
    "application_state",
  ],
  memory_deny_barriers: [
    "entity_uuid",
    "owner_id",
    "correction_id",
    "status",
    "committed_at",
    "scope_note",
  ],
  memory_deny_barrier_members: [
    "barrier_id",
    "assertion_id",
    "held_from",
    "held_to",
    "hold_reason",
    "authorized_by_correction_id",
    "closed_by_correction_id",
    "membership_seq",
  ],
  memory_contradictions: [
    "owner_id",
    "left_assertion_id",
    "right_assertion_id",
    "kind",
    "status",
    "created_at",
  ],
  memory_derivation_links: [
    "assertion_id",
    "consumer_kind",
    "consumer_id",
    "created_at",
  ],
  memory_episode_claims: [
    "episode_id",
    "assertion_id",
    "span_start",
    "span_end",
    "excerpt",
  ],
  memory_correction_receipts: [
    "correction_id",
    "barrier_committed",
    "fanout_state",
    "readback_ok",
    "barrier_membership_seq_high",
    "completed_at",
  ],
  memory_correction_outcomes: [
    "correction_id",
    "class",
    "ashley_error_kind",
    "created_at",
  ],
  memory_reconciliation_requests: [
    "correction_id",
    "consumer_kind",
    "consumer_id",
    "requested_action",
    "status",
  ],
};

function removeC1Tables(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = OFF");
  for (const table of [...C1_TABLES].reverse()) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`PRAGMA user_version = ${PRE_C1_SCHEMA_VERSION}`);
}

function tableSql(db: DatabaseSync, table: string): string {
  const row = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table) as { sql?: string } | undefined;
  return row?.sql ?? "";
}

describe("C1 schema and conservative shadow backfill", () => {
  it("creates the C1 tables, marker, constraints, and legacy assertions", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      removeC1Tables(db);

      const activeFactId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
      });
      const oldFactId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "tea",
        value: "likes tea",
        origin: "explicit_user",
      });
      const successorFactId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "tea",
        value: "does not like tea",
        origin: "explicit_user",
      });
      const forgottenFactId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "ongoing",
        key: "old topic",
        value: "old value",
        origin: "explicit_user",
      });
      expect(forgetByTopic(db, OWNER_ID, "old topic")).toBe(1);

      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const messageId = insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "A residual episode claim.",
        channel: "discord",
      });
      const episode = createEpisode(db, {
        ownerId: OWNER_ID,
        threadId,
        summary: "A residual episode claim.",
        messageIds: [messageId],
        provenance: "shadow",
      });
      expect(episode).not.toBeNull();

      migrate(db, { skipContinuityRequirement: true });

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).all().map((row) => String((row as { name: string }).name));
      for (const table of C1_TABLES) {
        expect(tables).toContain(table);
        const columns = db.prepare(`PRAGMA table_info(${table})`).all()
          .map((row) => String((row as { name: string }).name));
        expect(columns).toEqual(expect.arrayContaining(REQUIRED_COLUMNS[table]));
      }

      const marker = db.prepare(
        `SELECT c1_contract_version, currentness_authority, cutover_at,
                applied_c1_authority_exists, correction_seq
         FROM memory_contract_state WHERE id = 1`,
      ).get();
      expect(marker).toEqual({
        c1_contract_version: 1,
        currentness_authority: "mem_facts",
        cutover_at: null,
        applied_c1_authority_exists: 0,
        correction_seq: 0,
      });

      const assertionSql = tableSql(db, "memory_assertions");
      expect(assertionSql).toContain("unknown");
      expect(assertionSql).toContain("I0");
      expect(assertionSql).toContain("I3");
      expect(assertionSql).toContain("legacy_unknown");
      expect(assertionSql).toContain("termination_reason");
      const correctionSql = tableSql(db, "memory_corrections");
      expect(correctionSql).toContain("unclassified");
      expect(correctionSql).toContain("stop_required");
      const targetSql = tableSql(db, "memory_correction_targets");
      expect(targetSql).toContain("conservative_hold");
      expect(targetSql).toContain("application_state");
      const barrierMemberSql = tableSql(db, "memory_deny_barrier_members");
      expect(barrierMemberSql).toContain("held_to");
      expect(barrierMemberSql).toContain("membership_seq");
      const receiptSql = tableSql(db, "memory_correction_receipts");
      expect(receiptSql).toContain("fanout_state");
      expect(receiptSql).toContain("readback_ok");

      const facts = db.prepare(
        `SELECT id, legacy_fact_id, kind, subject_facet, lineage_kind,
                derivation_kind, support_state, influence_class,
                valid_from, valid_to, world_interval_basis,
                authority_from, authority_to, authority_basis,
                termination_reason, superseded_by_assertion_id
         FROM memory_assertions
         WHERE legacy_fact_id IS NOT NULL ORDER BY legacy_fact_id`,
      ).all() as Array<Record<string, unknown>>;
      expect(facts).toHaveLength(4);
      expect(facts.every((fact) => fact.kind === "keyed_fact")).toBe(true);
      expect(facts.every((fact) => fact.subject_facet === "unknown")).toBe(true);
      expect(facts.every((fact) => fact.lineage_kind === "unknown")).toBe(true);
      expect(facts.every((fact) => fact.derivation_kind === "derived")).toBe(true);
      expect(facts.every((fact) => fact.support_state === "supported")).toBe(true);
      expect(facts.every((fact) => fact.influence_class === "I0")).toBe(true);
      expect(facts.every((fact) => fact.valid_from === null && fact.valid_to === null)).toBe(true);
      expect(facts.every((fact) => fact.world_interval_basis === "legacy_unknown")).toBe(true);
      expect(facts.every((fact) => fact.authority_basis === "legacy_current" || fact.authority_basis === "legacy_supersession")).toBe(true);

      const activeFact = facts.find((fact) => fact.legacy_fact_id === activeFactId);
      expect(activeFact?.termination_reason).toBeNull();
      expect(activeFact?.authority_from).toBeNull();
      const oldFact = facts.find((fact) => fact.legacy_fact_id === oldFactId);
      expect(oldFact?.termination_reason).toBe("superseded");
      expect(oldFact?.authority_to).not.toBeNull();
      expect(oldFact?.superseded_by_assertion_id).toBe(
        facts.find((fact) => fact.legacy_fact_id === successorFactId)?.id,
      );
      const forgottenFact = facts.find((fact) => fact.legacy_fact_id === forgottenFactId);
      expect(forgottenFact?.termination_reason).toBe("forgotten");

      const episodeAssertion = db.prepare(
        `SELECT kind, subject_facet, lineage_kind, derivation_kind,
                support_state, influence_class, valid_from, valid_to,
                world_interval_basis, legacy_episode_id
         FROM memory_assertions WHERE legacy_episode_id = ?`,
      ).get(episode!.id) as Record<string, unknown> | undefined;
      expect(episodeAssertion).toMatchObject({
        kind: "episode_claim",
        subject_facet: "unknown",
        lineage_kind: "unknown",
        derivation_kind: "derived",
        support_state: "supported",
        influence_class: "I0",
        valid_from: null,
        valid_to: null,
        world_interval_basis: "legacy_unknown",
        legacy_episode_id: episode!.id,
      });

      const episodeClaim = db.prepare(
        `SELECT episode_id, assertion_id, span_start, span_end, excerpt
         FROM memory_episode_claims WHERE episode_id = ?`,
      ).get(episode!.id) as Record<string, unknown> | undefined;
      expect(episodeClaim).toMatchObject({
        episode_id: episode!.id,
        span_start: 0,
        span_end: "A residual episode claim.".length,
        excerpt: "A residual episode claim.",
      });
    } finally {
      db.close();
    }
  });
});
