import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getConversationEvidence } from "../../evidence/conversation-log.js";
import { resolveSocialConversation } from "../../../memory/threads.js";
import { openCognitiveSidecarDb } from "../db.js";
import {
  COGNITIVE_SIDECAR_SCHEMA_V1,
  COGNITIVE_SIDECAR_SCHEMA_V2,
  COGNITIVE_SIDECAR_SCHEMA_V3,
  COGNITIVE_SIDECAR_SCHEMA_V4,
  COGNITIVE_SIDECAR_SCHEMA_V5,
  COGNITIVE_SIDECAR_SCHEMA_V6,
  COGNITIVE_SIDECAR_SCHEMA_V7,
  COGNITIVE_SIDECAR_SCHEMA_V8,
  COGNITIVE_SIDECAR_SCHEMA_V9,
  COGNITIVE_SIDECAR_SCHEMA_V10,
  COGNITIVE_SIDECAR_SCHEMA_V11,
  COGNITIVE_SIDECAR_SCHEMA_V12,
  COGNITIVE_SIDECAR_SCHEMA_V13,
} from "../schema.js";

function createV13Fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V1);
  db.prepare(
    `INSERT INTO cognitive_sidecar_meta
       (id, schema_version, architecture_epoch, implementation_spec_version,
        thought_contract_version, authority_epoch)
     VALUES (1, 1, 'v0.2.1', '0.2.1.r6', 2, 1)`,
  ).run();
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V2);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V3);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V4);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V5);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V6);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V7);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V8);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V9);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V10);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V11);
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V12);
  db.exec(`
    DROP INDEX IF EXISTS idx_wakes_claim;
    DROP INDEX IF EXISTS idx_wakes_conversation;
    DROP TABLE wakes;
    ALTER TABLE wakes_v12 RENAME TO wakes;
    CREATE INDEX idx_wakes_claim ON wakes(state, lease_expires_at_ms, created_at_ms, wake_id);
    CREATE INDEX idx_wakes_conversation ON wakes(conversation_id, state, created_at_ms);
  `);
  db.exec("PRAGMA foreign_keys = ON");
  db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 12 WHERE id = 1").run();
  db.exec("PRAGMA user_version = 12");
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V13);
  db.exec("PRAGMA user_version = 13");
  return db;
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((column) => column.name);
}

function insertLegacyEvidence(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO conversation_evidence_log
       (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
        discord_message_ids_json, reservation_id, producing_cycle_id, architecture_epoch,
        content_hash, source_status, data_classification, secret_omitted, delivered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "evidence:legacy",
    "lineage:legacy",
    1,
    "conversation:legacy",
    "owner",
    "legacy text",
    10,
    "[]",
    null,
    null,
    "v0.2.1",
    "hash:legacy",
    "received",
    "ordinary",
    0,
    0,
  );
}

describe("cognitive sidecar Schema V14 migration", () => {
  it("migrates v13, preserves legacy defaults, and starts with no social conversations", () => {
    const db = createV13Fixture();
    insertLegacyEvidence(db);
    db.prepare(
      `INSERT INTO cycle_records
         (cycle_id, conversation_id, generation, state, trigger_kind, trigger_ref,
          occupant_id, authority_epoch, architecture_epoch, admitted_at_ms, updated_at_ms,
          compose_log_ids_json, preempted_generation)
       VALUES ('cycle:legacy', 'conversation:legacy', 1, 'admitted', 'owner_message',
          'trigger:legacy', 'owner', 1, 'v0.2.1', 10, 10, '[]', NULL)`,
    ).run();

    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(14);
      expect(columnNames(db, "conversation_evidence_log")).toEqual(expect.arrayContaining([
        "speaker_principal_id",
        "speaker_kind",
        "location_json",
        "audience_at_capture",
        "sent_at_ms",
        "reply_to_message_id",
        "mention_ids_json",
        "attachment_refs_json",
        "provenance_json",
      ]));
      expect(columnNames(db, "inbox_events")).toContain("envelope_json");
      expect(columnNames(db, "cycle_records")).toEqual(expect.arrayContaining([
        "attempt_id",
        "attempt_input_basis_json",
        "supersessions_used",
        "pending_queue_json",
        "disposition",
      ]));
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'social_conversations'").all())
        .toEqual([{ name: "social_conversations" }]);

      expect(getConversationEvidence(db, "evidence:legacy")).toMatchObject({
        role: "owner",
        speakerKind: "owner",
        audienceAtCapture: "owner_private",
        speakerPrincipalId: null,
        mentionIds: [],
        attachmentRefs: [],
        location: null,
        provenance: null,
      });
      expect(db.prepare("SELECT supersessions_used, pending_queue_json FROM cycle_records WHERE cycle_id = 'cycle:legacy'").get())
        .toEqual({ supersessions_used: 0, pending_queue_json: "[]" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM social_conversations").get()).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("resolves stable DM and room identities, updates last_at, and fails closed", () => {
    const db = new DatabaseSync(":memory:");
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    try {
      const dm = resolveSocialConversation(db, {
        kind: "dm",
        ashleyBotId: "bot-1",
        principalId: "person-1",
        nowMs: 100,
      });
      expect(dm).toBe("dm:bot-1:person-1");
      expect(resolveSocialConversation(db, {
        kind: "dm",
        ashleyBotId: "bot-1",
        principalId: "person-1",
        nowMs: 200,
      })).toBe(dm);
      expect(db.prepare("SELECT kind, principal_id, created_at_ms, last_at_ms FROM social_conversations WHERE conversation_id = ?").get(dm))
        .toEqual({ kind: "dm", principal_id: "person-1", created_at_ms: 100, last_at_ms: 200 });

      const room = resolveSocialConversation(db, {
        kind: "room",
        guildId: "guild-1",
        channelId: "channel-1",
        nowMs: 300,
      });
      expect(room).toBe("room:guild-1:channel-1");
      expect(() => resolveSocialConversation(db, { kind: "dm", ashleyBotId: "bot-1", nowMs: 400 }))
        .toThrow("social_principal_required");
      expect(() => resolveSocialConversation(db, { kind: "room", guildId: "guild-1", nowMs: 400 }))
        .toThrow("social_channel_required");
      expect(db.prepare("SELECT COUNT(*) AS count FROM social_conversations").get()).toEqual({ count: 2 });
    } finally {
      db.close();
    }
  });
});
