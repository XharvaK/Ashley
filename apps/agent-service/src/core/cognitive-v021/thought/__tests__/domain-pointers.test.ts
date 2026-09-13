import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { openNuclearDb } from "../../../db.js";
import { currentBuildIdentity, currentContractId } from "../../../rollout/capabilities.js";
import { buildDomainPointers } from "../domain-pointers.js";

describe("MAT-II domain pointers", () => {
  it("projects compact IDs, status, and timestamps without operational payloads", () => {
    const db = openTestSidecar();
    try {
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json, assertion_key, status, snapshot_hash, updated_cycle)
         VALUES (?, ?, ?, '[]', '{}', NULL, 'active', 'snapshot', ?)`
      ).run("concern-1", "conversation-1", "private concern text", "cycle-1");
      db.prepare(
        `INSERT INTO future_triggers
           (trigger_id, conversation_id, concern_id, due_at_ms, snapshot_hash, status, payload_json)
         VALUES (?, ?, ?, ?, ?, 'scheduled', ?)`
      ).run("trigger-1", "conversation-1", "concern-1", 1234, "snapshot", JSON.stringify({ private: "payload" }));
      db.prepare(
        `INSERT INTO observation_subscriptions
           (subscription_id, conversation_id, spec_json, cancelled)
         VALUES (?, ?, ?, 0)`
      ).run("subscription-1", "conversation-1", JSON.stringify({ private: "spec" }));
      db.prepare(
        `INSERT INTO mind_occupancy
           (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES (?, ?, 'active', 9, ?, 2)`
      ).run("conversation-1", "concern-1", "cycle-1");

      const section = buildDomainPointers(db, "conversation-1", "cycle-1");
      const serialized = JSON.stringify(section);

      expect(section.pointers).toEqual(expect.arrayContaining([
        expect.objectContaining({ domain: "concerns", entityIds: ["concern-1"], status: "active" }),
        expect.objectContaining({ domain: "future_triggers", entityIds: ["trigger-1"], status: "scheduled" }),
        expect.objectContaining({ domain: "observation_subscriptions", entityIds: ["subscription-1"] }),
      ]));
      expect(serialized).not.toContain("private concern text");
      expect(serialized).not.toContain("private");
      expect(serialized).not.toContain("payload_json");
      expect(section.pointers.some((pointer) => pointer.domain === "mind_occupancy")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("reports optional pointer-store failure as UNREACHABLE and continues", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE concerns");
      const section = buildDomainPointers(db, "conversation-1", "cycle-1");
      expect(section.pointers).toEqual(expect.arrayContaining([
        expect.objectContaining({ domain: "concerns", disposition: "UNREACHABLE" }),
      ]));
    } finally {
      db.close();
    }
  });

  it("separates terminal stale-trigger evidence from actionable scheduled IDs", () => {
    const db = openTestSidecar();
    try {
      db.prepare(
        `INSERT INTO future_triggers
           (trigger_id, conversation_id, concern_id, due_at_ms, snapshot_hash, status, payload_json)
         VALUES ('suppressed-trigger', 'conversation-1', 'concern-1', 1234, 'snapshot', 'suppressed_stale', '{}')`,
      ).run();
      db.prepare(
        `INSERT INTO causal_ledger
           (cycle_id, generation, payload_json, thought_unavailable)
         VALUES ('future-trigger:suppressed-trigger', 7, ?, 0)`,
      ).run(JSON.stringify({
        triggerKind: "future_trigger_due",
        triggerId: "suppressed-trigger",
        concernId: "concern-1",
        result: "suppressed_stale",
        reason: "snapshot_mismatch",
        atMs: 9876,
      }));

      const pointer = buildDomainPointers(db, "conversation-1", "cycle-1").pointers
        .find((candidate) => candidate.domain === "future_triggers");
      expect(pointer).toMatchObject({ entityIds: [], status: "empty" });
      expect(pointer?.terminalEvidence).toEqual([expect.objectContaining({
        triggerId: "suppressed-trigger",
        concernId: "concern-1",
        status: "suppressed_stale",
        reason: "snapshot_mismatch",
        eventCycleId: "future-trigger:suppressed-trigger",
        eventGeneration: 7,
        suppressedAtMs: 9876,
      })]);
      expect(JSON.stringify(pointer)).not.toContain("payload_json");
    } finally {
      db.close();
    }
  });

  it("fails closed on Mind Occupancy store failure without claiming an empty house", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE mind_occupancy");
      expect(() => buildDomainPointers(db, "conversation-1", "cycle-1"))
        .toThrowError("mind_occupancy_unreachable");
      expect(() => buildDomainPointers(db, "conversation-1", "cycle-1"))
        .not.toThrowError("empty_house");
    } finally {
      db.close();
    }
  });

  it("uses the relationship source owner without presenting OCI as a live domain", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const empty = buildDomainPointers(sidecar, "conversation-1", "cycle-1", nuclear, "owner-1");
      expect(empty.pointers).toEqual(expect.arrayContaining([
        expect.objectContaining({ domain: "relationship_state", disposition: "EMPTY" }),
      ]));
      expect(empty.pointers.some((pointer) => pointer.domain === "open_cognition")).toBe(false);

      const now = "2026-09-05T00:00:00.000Z";
      nuclear.prepare(
        `INSERT INTO relationship_projections
           (entity_uuid, owner_id, kind, projection_policy_id,
            projection_policy_version, source_bindings_json, source_watermark_json,
            data_classification, provenance, party_subject_scope, effective_from,
            effective_to, supersedes_projection_id, content_binding, computed_at)
         VALUES (?, ?, 'current_shared_culture', ?, 1, '{}', '{}', 'ordinary', 'live', ?, ?, NULL, NULL, ?, ?)`,
      ).run("relationship-entity-1", "owner-1", "policy", "owner + Ashley", now, "binding", now);
      nuclear.prepare(
        `INSERT INTO questions
           (owner_id, subject, text, status, priority, created_at, updated_at,
            entity_uuid, data_classification)
         VALUES (?, 'about_self', ?, 'open', 0.8, ?, ?, ?, 'never_public')`,
      ).run("owner-1", "private source question", now, now, "question-source-1");
      const question = nuclear.prepare(
        "SELECT id FROM questions WHERE entity_uuid = ?",
      ).get("question-source-1") as { id: number };
      nuclear.prepare(
        `INSERT INTO open_cognitive_items
           (owner_id, entity_uuid, kind, status, semantic_summary,
            source_type, source_id, source_entity_uuid, semantic_key_hash,
            source_capability, contract_id, provenance, source_revision, origin,
            build_identity, model_epoch, data_classification, status_reason,
            created_at, updated_at)
         VALUES (?, ?, 'question', 'OPEN', ?, 'question', ?, ?, ?, 'reading', ?, 'live', ?, 'manual', ?, 0, 'never_public', 'created', ?, ?)`,
      ).run(
        "owner-1",
        "open-entity-1",
        "private semantic summary",
        String(question.id),
        "question-source-1",
        "a".repeat(64),
        currentContractId(),
        now,
        currentBuildIdentity(),
        now,
        now,
      );

      const pointed = buildDomainPointers(sidecar, "conversation-1", "cycle-1", nuclear, "owner-1");
      const relationship = pointed.pointers.find((pointer) => pointer.domain === "relationship_state");
      const cognition = pointed.pointers.find((pointer) => pointer.domain === "open_cognition");
      expect(relationship).toMatchObject({
        disposition: "POINTER_ONLY",
        pointerOnly: true,
        entityIds: ["relationship-entity-1"],
      });
      expect(cognition).toBeUndefined();
      const serialized = JSON.stringify(pointed);
      expect(serialized).not.toContain("private source question");
      expect(serialized).not.toContain("private semantic summary");
      expect(pointed.coverageManifest.domains.find((domain) => domain.domain === "open_cognition")).toBeUndefined();
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("keeps pointerOnly directly accessible while deriving it from disposition on the wire", () => {
    const db = openTestSidecar();
    try {
      db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json, assertion_key, status, snapshot_hash, updated_cycle)
         VALUES (?, ?, ?, '[]', '{}', NULL, 'active', 'snapshot', ?)`
      ).run("pointer-only-concern", "conversation-1", "private concern text", "cycle-1");

      const section = buildDomainPointers(db, "conversation-1", "cycle-1");
      const pointer = section.pointers.find((candidate) => candidate.domain === "concerns");
      const serialized = JSON.parse(JSON.stringify(section)) as {
        pointers: Array<Record<string, unknown>>;
      };
      const serializedPointer = serialized.pointers.find((candidate) => candidate.domain === "concerns");

      expect(pointer).toMatchObject({
        canonicalStore: "cognitive-v021.db:concerns",
        entityIds: ["pointer-only-concern"],
        status: "active",
        disposition: "POINTER_ONLY",
        pointerOnly: true,
      });
      expect(serializedPointer).toMatchObject({
        canonicalStore: "cognitive-v021.db:concerns",
        entityIds: ["pointer-only-concern"],
        status: "active",
        disposition: "POINTER_ONLY",
      });
      expect(serializedPointer).not.toHaveProperty("pointerOnly");

      const empty = section.pointers.find((candidate) => candidate.domain === "future_triggers");
      const serializedEmpty = serialized.pointers.find((candidate) => candidate.domain === "future_triggers");
      expect(empty).toMatchObject({ disposition: "EMPTY", pointerOnly: false });
      expect(serializedEmpty).not.toHaveProperty("pointerOnly");
    } finally {
      db.close();
    }
  });

  it("reports source-owner query failure as UNREACHABLE for both domains", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      nuclear.exec("DROP TABLE relationship_projections");
      nuclear.exec("DROP TABLE open_cognitive_items");

      const section = buildDomainPointers(sidecar, "conversation-1", "cycle-1", nuclear, "owner-1");
      expect(section.pointers).toEqual(expect.arrayContaining([
        expect.objectContaining({ domain: "relationship_state", disposition: "UNREACHABLE" }),
      ]));
      expect(section.pointers.some((pointer) => pointer.domain === "open_cognition")).toBe(false);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
