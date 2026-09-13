import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ensureNuclearV43Schema,
  validateNuclearV43Schema,
} from "./migration-43.js";

describe("nuclear migration 43", () => {
  it("adds the complete Thought attempt binding contract", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE attention_requests (
        id INTEGER PRIMARY KEY,
        purpose TEXT NOT NULL,
        state TEXT NOT NULL,
        outcome TEXT,
        dispatch_sequence INTEGER
      );
    `);

    ensureNuclearV43Schema(db);
    validateNuclearV43Schema(db);

    const columns = (
      db.prepare("PRAGMA table_info(attention_requests)").all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining([
      "thought_invocation_id",
      "thought_cycle_id",
      "thought_generation",
      "thought_semantic_pass",
      "thought_structural_attempt",
      "thought_authority_epoch",
      "thought_authority_vector_json",
      "thought_trigger_ref",
      "semantic_projection_hash",
      "dispatch_messages_hash",
      "allowlist_fingerprint",
      "mf_invocation_id",
      "mf_attempt_id",
      "actual_provider",
      "actual_occupant_id",
      "actual_wire_binding_id",
      "schema_enforcement_mode",
      "resource_policy_fingerprint",
      "absolute_deadline_at_ms",
    ]));

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('attention_requests_thought_invocation', 'attention_requests_mf_attempt') ORDER BY name",
    ).all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual([
      "attention_requests_mf_attempt",
      "attention_requests_thought_invocation",
    ]);
    db.close();
  });

  it("rejects a partial Thought context", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE attention_requests (
        id INTEGER PRIMARY KEY,
        purpose TEXT NOT NULL,
        state TEXT NOT NULL,
        outcome TEXT,
        dispatch_sequence INTEGER
      );
    `);
    ensureNuclearV43Schema(db);

    expect(() => db.prepare(
      "INSERT INTO attention_requests (id, purpose, state, thought_invocation_id) VALUES (1, 'thought', 'queued', 'invocation-1')",
    ).run()).toThrow();
    expect(() => db.prepare(
      "INSERT INTO attention_requests (id, purpose, state, thought_cycle_id) VALUES (2, 'maintenance', 'queued', 'cycle-2')",
    ).run()).toThrow();
    expect(() => db.prepare(
      "INSERT INTO attention_requests (id, purpose, state, thought_invocation_id, thought_cycle_id, thought_generation, thought_semantic_pass, thought_structural_attempt, thought_authority_epoch, thought_authority_vector_json, thought_trigger_ref, semantic_projection_hash, dispatch_messages_hash, allowlist_fingerprint, mf_invocation_id, mf_attempt_id, actual_provider, actual_occupant_id, actual_wire_binding_id, schema_enforcement_mode, resource_policy_fingerprint, absolute_deadline_at_ms) VALUES (3, 'thought', 'queued', 'i3', 'c3', -1, 1, 0, 1, '{}', 't3', 'p', 'm', 'a', 'mf', 'ma', 'nim', 'o', 'w', 'native', 'r', 1000)",
    ).run()).toThrow();
    db.close();
  });
});
