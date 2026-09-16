import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  appendExternalUtteranceInTransaction,
  getConversationEvidence,
} from "../../evidence/conversation-log.js";
import { openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
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
  COGNITIVE_SIDECAR_SCHEMA_V14,
  COGNITIVE_SIDECAR_SCHEMA_V15,
  COGNITIVE_SIDECAR_SCHEMA_V16,
} from "../schema.js";

function applyBaseThroughV12(db: DatabaseSync): void {
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
}

function createV16Fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyBaseThroughV12(db);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V13);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V14);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V15);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V16);
  db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 16 WHERE id = 1").run();
  db.exec("PRAGMA user_version = 16");
  return db;
}

function createV13Fixture(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyBaseThroughV12(db);
  db.exec(COGNITIVE_SIDECAR_SCHEMA_V13);
  db.exec("PRAGMA user_version = 13");
  return db;
}

function insertLegacyRow(
  db: DatabaseSync,
  rowId: string,
  role: string,
  speakerKind: string | null,
): void {
  db.prepare(
    `INSERT INTO conversation_evidence_log
       (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
        discord_message_ids_json, reservation_id, producing_cycle_id, architecture_epoch,
        content_hash, source_status, data_classification, secret_omitted, delivered,
        speaker_principal_id, speaker_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rowId,
    `lineage:${rowId}`,
    1,
    "conversation:legacy",
    role,
    `legacy text ${rowId}`,
    10,
    "[]",
    null,
    null,
    "v0.2.1",
    `hash:${rowId}`,
    "received",
    "ordinary",
    0,
    0,
    null,
    speakerKind,
  );
}

function insertPreV14Row(db: DatabaseSync, rowId: string, role: string): void {
  db.prepare(
    `INSERT INTO conversation_evidence_log
       (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
        discord_message_ids_json, reservation_id, producing_cycle_id, architecture_epoch,
        content_hash, source_status, data_classification, secret_omitted, delivered)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rowId,
    `lineage:${rowId}`,
    1,
    "conversation:legacy",
    role,
    `legacy text ${rowId}`,
    10,
    "[]",
    null,
    null,
    "v0.2.1",
    `hash:${rowId}`,
    "received",
    "ordinary",
    0,
    0,
  );
}
function speakerKindOf(db: DatabaseSync, rowId: string): unknown {
  return (db.prepare("SELECT speaker_kind FROM conversation_evidence_log WHERE row_id = ?").get(rowId) as { speaker_kind: unknown }).speaker_kind;
}

function fullRow(db: DatabaseSync, rowId: string): Record<string, unknown> {
  return db.prepare("SELECT * FROM conversation_evidence_log WHERE row_id = ?").get(rowId) as Record<string, unknown>;
}

describe("cognitive sidecar Schema V17 migration", () => {
  it("backfills proven owner/ashley attribution and leaves everything else byte-identical", () => {
    const db = createV16Fixture();
    insertLegacyRow(db, "evidence:owner", "owner", null);
    insertLegacyRow(db, "evidence:ashley", "ashley", null);
    insertLegacyRow(db, "evidence:external", "external_dialog", null);
    insertLegacyRow(db, "evidence:system", "system", null);
    insertLegacyRow(db, "evidence:explicit", "owner", "external_bot");
    const before = new Map(
      ["evidence:owner", "evidence:ashley", "evidence:external", "evidence:system", "evidence:explicit"].map(
        (rowId) => [rowId, fullRow(db, rowId)] as const,
      ),
    );
    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });

      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(
        COGNITIVE_SIDECAR_SCHEMA_VERSION,
      );
      expect(
        (db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get() as { schema_version: number })
          .schema_version,
      ).toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);

      expect(speakerKindOf(db, "evidence:owner")).toBe("owner");
      expect(speakerKindOf(db, "evidence:ashley")).toBe("ashley");
      expect(speakerKindOf(db, "evidence:external")).toBeNull();
      expect(speakerKindOf(db, "evidence:system")).toBeNull();
      expect(speakerKindOf(db, "evidence:explicit")).toBe("external_bot");

      for (const [rowId, row] of before) {
        const after = fullRow(db, rowId);
        for (const [key, value] of Object.entries(row)) {
          if (key === "speaker_kind") continue;
          expect(after[key], `${rowId}.${key}`).toEqual(value);
        }
      }

      expect(getConversationEvidence(db, "evidence:owner")).toMatchObject({
        role: "owner",
        speakerKind: "owner",
        audienceAtCapture: "unknown",
      });
      expect(getConversationEvidence(db, "evidence:ashley")).toMatchObject({
        role: "ashley",
        speakerKind: "ashley",
      });
      expect(getConversationEvidence(db, "evidence:external")).toBeNull();
      expect(getConversationEvidence(db, "evidence:system")).not.toBeNull();
    } finally {
      db.close();
    }
  });

  it("migrates a historical v13 database with legacy rows to V17", () => {
    const db = createV13Fixture();
    insertPreV14Row(db, "evidence:legacy", "owner");
    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(
        COGNITIVE_SIDECAR_SCHEMA_VERSION,
      );
      expect(speakerKindOf(db, "evidence:legacy")).toBe("owner");
      expect(getConversationEvidence(db, "evidence:legacy")).toMatchObject({
        role: "owner",
        speakerKind: "owner",
      });
    } finally {
      db.close();
    }
  });

  it("is idempotent across a second open", () => {
    const db = createV16Fixture();
    insertLegacyRow(db, "evidence:owner", "owner", null);
    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      const first = fullRow(db, "evidence:owner");
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(fullRow(db, "evidence:owner")).toEqual(first);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(
        COGNITIVE_SIDECAR_SCHEMA_VERSION,
      );
    } finally {
      db.close();
    }
  });

  it("still rejects current malformed external intake", () => {
    const db = createV16Fixture();
    try {
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(() =>
        appendExternalUtteranceInTransaction(db, {
          conversationId: "conversation:legacy",
          text: "unattributed external claim",
          discordMessageIds: ["msg:malformed"],
        }),
      ).toThrow("speaker_kind_invalid");
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM conversation_evidence_log").get() as { count: number }).count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});
