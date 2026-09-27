import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { NUCLEAR_SUPPORTED_VERSION, openNuclearDb } from "../db.js";
import { validateNuclearV52Schema } from "./migration-52.js";

describe("nuclear schema v52 commitment timing", () => {
  it("adds timing fields with reconsider defaults and leaves old rows readable", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(52);
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 52 });
      validateNuclearV52Schema(db);
      db.prepare(
        `INSERT INTO ashley_self_commitments
           (owner_id, entity_uuid, data_classification, text, status, due_at,
            source_entity_type, source_entity_uuid, evidence_json, text_hash,
            created_at, updated_at)
         VALUES (?, ?, 'ordinary', ?, 'active', NULL, 'legacy', ?, NULL, ?, ?, ?)`,
      ).run(
        "owner-v52",
        "legacy-v52",
        "legacy commitment",
        "legacy-source-v52",
        "legacy-hash-v52",
        "2026-09-27T12:00:00.000Z",
        "2026-09-27T12:00:00.000Z",
      );
      expect(db.prepare(
        `SELECT timing_timezone_id, required_precision_ms, late_behavior, latest_useful_at_ms
           FROM ashley_self_commitments WHERE entity_uuid = ?`,
      ).get("legacy-v52")).toEqual({
        timing_timezone_id: "UTC",
        required_precision_ms: 3_600_000,
        late_behavior: "reconsider",
        latest_useful_at_ms: null,
      });
    } finally {
      db.close();
    }
  });
});
