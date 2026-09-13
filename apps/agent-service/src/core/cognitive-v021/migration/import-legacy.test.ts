import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { reservedProductionCognitiveSidecarDbPath } from "../../data-plane.js";
import { openTestSidecar } from "../test-support.js";
import { importLegacySemanticState, LegacyImportError } from "./import-legacy.js";

function legacyFixture(): DatabaseSync {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  db.prepare("INSERT INTO mem_threads (id, owner_id, status, channel, created_at, updated_at) VALUES (?, ?, 'active', 'discord', ?, ?)").run("thread-legacy", "doc", "2026-01-01", "2026-01-01");
  db.prepare("INSERT INTO mem_messages (thread_id, owner_id, role, text, channel, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("thread-legacy", "doc", "user", "I use careful tools.", "discord", "2026-01-01");
  db.prepare("INSERT INTO mem_messages (thread_id, owner_id, role, text, channel, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("thread-legacy", "doc", "assistant", "I heard you.", "discord", "2026-01-01");
  db.prepare("INSERT INTO mem_facts (owner_id, category, key, value, confidence, importance, source_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("doc", "preference", "tooling", "small tools", 0.8, 80, 1, "2026-01-01");
  return db;
}

describe("v0.2.1 legacy semantic import", () => {
  it("supports dry-run, idempotent apply, verify, and quarantine", () => {
    const nuclear = legacyFixture();
    const sidecar = openTestSidecar();
    try {
      const dry = importLegacySemanticState({ nuclear, sidecar, mode: "dry-run" });
      expect(dry.counts).toMatchObject({ messages: 2, assertions: 1, supports: 1 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log").get()).toMatchObject({ count: 0 });

      const applied = importLegacySemanticState({ nuclear, sidecar, mode: "apply" });
      expect(applied.counts).toMatchObject({ messages: 2, assertions: 1, supports: 1 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions WHERE live = 0").get()).toMatchObject({ count: 1 });
      expect(sidecar.prepare("SELECT admitted_generation FROM sidecar_memory_assertions").get()).toMatchObject({ admitted_generation: null });
      expect(sidecar.prepare("SELECT provenance, source_architecture_epoch FROM sidecar_memory_supports").get()).toMatchObject({ provenance: "legacy_import", source_architecture_epoch: "legacy" });
      expect(sidecar.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%identity%'").all()).toEqual([]);

      const replay = importLegacySemanticState({ nuclear, sidecar, mode: "apply" });
      expect(replay.counts).toEqual({ messages: 0, assertions: 0, supports: 0, concerns: 0, occupancy: 0 });
      expect(replay.duplicateCount).toBeGreaterThan(0);
      expect(importLegacySemanticState({ nuclear, sidecar, mode: "verify" }).verified).toBe(true);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("reports a source tamper during verify and refuses reserved paths", () => {
    const nuclear = legacyFixture();
    const sidecar = openTestSidecar();
    try {
      importLegacySemanticState({ nuclear, sidecar, mode: "apply" });
      nuclear.prepare("UPDATE mem_messages SET text = 'tampered' WHERE id = 1").run();
      expect(() => importLegacySemanticState({ nuclear, sidecar, mode: "verify" })).toThrowError(expect.objectContaining({ code: "HASH_MISMATCH" }));
      expect(() => importLegacySemanticState({ nuclear, sidecar, mode: "dry-run", sidecarPath: reservedProductionCognitiveSidecarDbPath() })).toThrowError(expect.objectContaining({ code: "RESERVED_PATH_REFUSED" }));
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
