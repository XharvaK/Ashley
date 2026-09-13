import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";

const REQUIRED_TABLES = [
  "context_budget_policies",
  "context_allocation_receipts",
  "context_summary_projections",
  "cognitive_maturation_contract_state",
] as const;

function columns(db: DatabaseSync, table: string): string[] {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .map((row) => String((row as { name: string }).name));
}

describe("C2 additive schema", () => {
  it("creates policy, receipt, summary, and shared contract-state tables", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      // The historical C2 packet recorded v42. Current source also includes
      // W4 migrations v43 and v44; db.ts is the live schema authority.
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(44);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({
        user_version: NUCLEAR_SUPPORTED_VERSION,
      });
      for (const table of REQUIRED_TABLES) {
        expect(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        ).get(table)).toEqual({ 1: 1 });
      }
      expect(columns(db, "context_budget_policies")).toEqual(expect.arrayContaining([
        "policy_id", "version", "total_utf8_bytes", "section_json",
        "token_estimate_divisor", "created_at",
      ]));
      expect(columns(db, "context_allocation_receipts")).toEqual(expect.arrayContaining([
        "receipt_id", "request_id", "owner_id", "purpose",
        "route_policy_snapshot_id", "route_id", "profile_id",
        "profile_version", "profile_fingerprint", "provider_adapter_class",
        "egress_approval_ref", "route_class", "policy_id", "policy_version",
        "projection_id", "content_binding", "included_json", "omitted_json",
        "truncated_json", "compressed_json", "degradation_json",
        "same_snapshot_id", "capability_mode", "created_at",
      ]));
      expect(columns(db, "cognitive_maturation_contract_state")).toEqual(expect.arrayContaining([
        "wave", "highest_contract_version", "live_authority_existed",
        "event_highwater", "cutover_or_activation_state",
      ]));
      expect(db.prepare(
        `SELECT wave, highest_contract_version, live_authority_existed,
                event_highwater, cutover_or_activation_state
         FROM cognitive_maturation_contract_state WHERE wave = 'c2'`,
      ).get()).toEqual({
        wave: "c2",
        highest_contract_version: 1,
        live_authority_existed: 0,
        event_highwater: 0,
        cutover_or_activation_state: "observe",
      });
    } finally {
      db.close();
    }
  });

  it("enforces receipt identity, capability mode, and summary classification constraints", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(() => db.prepare(
        `INSERT INTO context_allocation_receipts
          (receipt_id, request_id, owner_id, purpose,
           route_policy_snapshot_id, route_id, profile_id, profile_version,
           profile_fingerprint, provider_adapter_class, route_class,
           policy_id, policy_version, projection_id, content_binding,
           included_json, omitted_json, truncated_json, compressed_json,
           degradation_json, capability_mode, created_at)
         VALUES ('r1', 'q1', 'doc', 'expression', 'snap', 'route', 'profile', 1,
                 'fp', 'adapter', 'remote_companion', 'policy', 1, 'p1',
                 'sha256:x', '{}', '{}', '{}', '{}', '{}', 'observe', 'now')`,
      ).run()).not.toThrow();
      expect(() => db.prepare(
        `INSERT INTO context_allocation_receipts
          (receipt_id, request_id, owner_id, purpose,
           route_policy_snapshot_id, route_id, profile_id, profile_version,
           profile_fingerprint, provider_adapter_class, route_class,
           policy_id, policy_version, projection_id, content_binding,
           included_json, omitted_json, truncated_json, compressed_json,
           degradation_json, capability_mode, created_at)
         VALUES ('r1', 'q2', 'doc', 'expression', 'snap', 'route', 'profile', 1,
                 'fp', 'adapter', 'remote_companion', 'policy', 1, 'p2',
                 'sha256:y', '{}', '{}', '{}', '{}', '{}', 'apply', 'now')`,
      ).run()).toThrow();
      expect(() => db.prepare(
        `INSERT INTO context_summary_projections
          (summary_id, owner_id, policy_id, mechanism, created_at,
           source_refs_json, source_content_binding, classification,
           text_utf8, limitations_json)
         VALUES ('s1', 'doc', 'policy', 'deterministic_extract', 'now',
                 '[]', 'sha256:s', 'secret', 'must not enter', '{}')`,
      ).run()).toThrow();
    } finally {
      db.close();
    }
  });

  it("fails closed when a persisted schema is newer than the candidate", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const newerVersion = NUCLEAR_SUPPORTED_VERSION + 1;
      db.exec(`PRAGMA user_version = ${newerVersion}`);
      expect(() => openNuclearDb(db, { continuityOptional: true })).toThrow(
        `unsupported_nuclear_schema:${newerVersion}>${NUCLEAR_SUPPORTED_VERSION}`,
      );
    } finally {
      db.close();
    }
  });
});
