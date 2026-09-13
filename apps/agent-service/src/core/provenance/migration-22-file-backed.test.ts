import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { createIsolatedDataPlane } from "../data-plane.js";

const dataDir = mkdtempSync(join(tmpdir(), "ashley-v22-file-backed-"));
const plane = createIsolatedDataPlane(dataDir);
mkdirSync(plane.conversationsDir, { recursive: true });

const { openContinuityDb } = await import("../continuity/db.js");
const { openNuclearDb, NUCLEAR_SUPPORTED_VERSION } = await import("../db.js");
const { recordRecallLiveCutover } = await import("../memory/cutover.js");
const { createEpisode, listUnconsolidatedMessages } = await import("../memory/episodes.js");
const {
  currentBuildIdentity,
  currentContractId,
  operatorRollbackCapability,
} = await import("../rollout/capabilities.js");

const connections: DatabaseSync[] = [];

afterAll(() => {
  for (const connection of connections) {
    try {
      connection.close();
    } catch {
      // Already closed by the test.
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

function downgradeToV21(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  db.exec(`
    DROP TABLE recall_live_cutovers;
    CREATE TABLE episodes_v21 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id TEXT NOT NULL,
      thread_id TEXT NOT NULL REFERENCES mem_threads(id),
      summary TEXT NOT NULL,
      entities TEXT NOT NULL DEFAULT '',
      source_start_message_id INTEGER NOT NULL REFERENCES mem_messages(id),
      source_end_message_id INTEGER NOT NULL REFERENCES mem_messages(id),
      salience REAL NOT NULL DEFAULT 0.5,
      unresolved INTEGER NOT NULL DEFAULT 0 CHECK (unresolved IN (0, 1)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'forgotten')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      entity_uuid TEXT,
      data_classification TEXT,
      provenance TEXT NOT NULL DEFAULT 'shadow' CHECK (provenance IN ('shadow', 'live')),
      UNIQUE(owner_id, thread_id, source_start_message_id, source_end_message_id)
    );
    INSERT INTO episodes_v21
      (id, owner_id, thread_id, summary, entities, source_start_message_id,
       source_end_message_id, salience, unresolved, status, created_at, updated_at,
       entity_uuid, data_classification, provenance)
    SELECT id, owner_id, thread_id, summary, entities, source_start_message_id,
           source_end_message_id, salience, unresolved, status, created_at, updated_at,
           entity_uuid, data_classification, provenance
    FROM episodes;
    DROP TABLE episodes;
    ALTER TABLE episodes_v21 RENAME TO episodes;
    CREATE INDEX idx_episodes_owner
      ON episodes (owner_id, status, unresolved DESC, salience DESC, updated_at DESC);
    CREATE INDEX idx_episodes_thread_end
      ON episodes (owner_id, thread_id, source_end_message_id DESC);
    CREATE INDEX idx_episodes_provenance
      ON episodes (owner_id, provenance, status, id DESC);
    CREATE UNIQUE INDEX idx_episodes_entity_uuid
      ON episodes (entity_uuid) WHERE entity_uuid IS NOT NULL;
    PRAGMA user_version = 21;
  `);
  db.exec("COMMIT");
  db.exec("PRAGMA foreign_keys = ON");
}

describe("migration-22 file-backed qualification", () => {
  it("migrates, closes, reopens, and preserves authority identity and release isolation", () => {
    const continuity = openContinuityDb(new DatabaseSync(plane.continuityDbPath), {
      dataPlane: plane,
    });
    connections.push(continuity);
    const db = openNuclearDb(new DatabaseSync(plane.nuclearDbPath), {
      continuity,
      dataPlane: plane,
    });
    connections.push(db);
    const releaseId = currentContractId();
    const historicalEpisodeId = 7;
    const historicalUuid = "00000000-0000-4000-8000-000000000007";

    db.exec(`
      INSERT INTO mem_threads (id, owner_id, status, channel, created_at, updated_at)
      VALUES ('file-thread', 'doc', 'active', 'discord', '2026', '2026'),
             ('release-isolation-thread', 'doc', 'archived', 'discord', '2026', '2026');
      INSERT INTO mem_messages (id, thread_id, owner_id, role, text, channel, created_at)
      VALUES (1, 'file-thread', 'doc', 'user', 'historical one', 'discord', '2026'),
             (2, 'file-thread', 'doc', 'assistant', 'historical two', 'discord', '2026'),
             (3, 'file-thread', 'doc', 'user', 'future message', 'discord', '2026'),
             (10, 'release-isolation-thread', 'doc', 'user', 'other one', 'discord', '2026'),
             (11, 'release-isolation-thread', 'doc', 'user', 'other two', 'discord', '2026');
      INSERT OR IGNORE INTO capability_releases
        (capability, release_id, state, updated_at, contract_id, build_identity)
      VALUES ('recall', '${releaseId}', 'active', '2026', '${releaseId}', 'v21-fixture');
      INSERT INTO episodes
        (id, owner_id, thread_id, summary, entities, source_start_message_id,
         source_end_message_id, salience, unresolved, status, created_at, updated_at,
         entity_uuid, data_classification, provenance)
      VALUES (${historicalEpisodeId}, 'doc', 'file-thread', 'historical shadow episode',
              'history', 1, 2, 0.8, 0, 'active', '2026', '2026',
              '${historicalUuid}', 'conversational', 'shadow');
      INSERT INTO episode_messages (episode_id, message_id) VALUES (${historicalEpisodeId}, 1), (${historicalEpisodeId}, 2);
      INSERT INTO cognitive_jobs
        (id, owner_id, kind, source_key, payload_json, status, available_at, created_at, updated_at)
      VALUES (11, 'doc', 'consolidate_thread', 'file-job', '{"threadId":"file-thread"}',
              'pending', '2026', '2026', '2026');
      INSERT INTO cognitive_runs
        (id, job_id, owner_id, kind, model, input_json, output_json, status, created_at, episode_id,
         entity_uuid, data_classification)
      VALUES (13, 11, 'doc', 'consolidate_thread', 'test', '{}', '{}', 'completed', '2026',
              ${historicalEpisodeId}, '00000000-0000-4000-8000-000000000013', 'conversational');
      INSERT INTO evidence_links
        (owner_id, target_type, target_id, source_type, source_id, created_at)
      VALUES ('doc', 'fact', 'fact-1', 'episode', '${historicalEpisodeId}', '2026');
      INSERT INTO episodes_fts (rowid, summary, entities)
      VALUES (${historicalEpisodeId}, 'historical shadow episode', 'history');
      INSERT INTO capability_events
        (capability, release_id, kind, source_key, detail_json, occurred_at,
         contract_id, build_identity, model_epoch)
      VALUES ('recall', '${releaseId}', 'operator_promote', 'v21-promote', '{}', '2026',
              '${releaseId}', 'v21-fixture', 0);
    `);

    downgradeToV21(db);
    continuity.prepare(
      "UPDATE lineage_state SET nuclear_schema_version = 21 WHERE id = 1",
    ).run();
    db.close();

    const migrated = openNuclearDb(new DatabaseSync(plane.nuclearDbPath), {
      continuity,
      dataPlane: plane,
    });
    try {
      expect(migrated.prepare("PRAGMA user_version").get()).toEqual({
        user_version: NUCLEAR_SUPPORTED_VERSION,
      });
      expect(migrated.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(migrated.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });

      const episode = migrated.prepare(
        "SELECT id, entity_uuid, provenance FROM episodes WHERE id = ?",
      ).get(historicalEpisodeId);
      expect(episode).toEqual({ id: historicalEpisodeId, entity_uuid: historicalUuid, provenance: "shadow" });
      expect(migrated.prepare("SELECT episode_id, message_id FROM episode_messages WHERE episode_id = ? ORDER BY message_id").all(historicalEpisodeId))
        .toEqual([{ episode_id: historicalEpisodeId, message_id: 1 }, { episode_id: historicalEpisodeId, message_id: 2 }]);
      expect(migrated.prepare("SELECT episode_id FROM cognitive_runs WHERE id = 13").get()).toEqual({ episode_id: historicalEpisodeId });
      expect(migrated.prepare(
        "SELECT source_type, source_id FROM evidence_links WHERE owner_id = 'doc'",
      ).all()).toEqual([{ source_type: "episode", source_id: String(historicalEpisodeId) }]);
      expect(migrated.prepare("SELECT rowid, summary FROM episodes_fts WHERE episodes_fts MATCH 'historical'").all())
        .toEqual([{ rowid: historicalEpisodeId, summary: "historical shadow episode" }]);
      expect(migrated.prepare("SELECT kind FROM capability_events WHERE source_key = 'v21-promote'").get())
        .toEqual({ kind: "operator_promote" });

      const live = createEpisode(migrated, {
        ownerId: "doc",
        threadId: "file-thread",
        summary: "historical live episode",
        messageIds: [1, 2],
        provenance: "live",
      });
      expect(live).not.toBeNull();
      expect(live!.id).toBeGreaterThan(historicalEpisodeId);
      expect(migrated.prepare("SELECT provenance FROM episodes WHERE id = ?").get(live!.id))
        .toEqual({ provenance: "live" });
      expect(migrated.prepare("SELECT rowid FROM episodes_fts WHERE rowid = ?").get(live!.id))
        .toEqual({ rowid: live!.id });
      expect(migrated.prepare("SELECT episode_id FROM episode_messages WHERE episode_id = ?").get(live!.id))
        .toEqual({ episode_id: live!.id });
      migrated.prepare(
        `INSERT INTO cognitive_runs
           (job_id, owner_id, kind, input_json, output_json, status, created_at, episode_id)
         VALUES (11, 'doc', 'consolidate_thread', '{}', '{}', 'completed', '2026', ?)`,
      ).run(live!.id);
      expect(migrated.prepare("SELECT episode_id FROM cognitive_runs WHERE episode_id = ?").get(live!.id))
        .toEqual({ episode_id: live!.id });

      migrated.exec(`
        INSERT INTO capability_releases (capability, release_id, state, updated_at)
        VALUES ('recall', 'release-old', 'active', '2026');
        INSERT INTO recall_live_cutovers
          (owner_id, capability, release_id, cutoff_message_id, authorized_by, contract_id, build_identity, created_at)
        VALUES ('doc', 'recall', 'release-old', 10, 'doc', 'release-old', 'v21-fixture', '2026');
      `);
      expect(listUnconsolidatedMessages(
        migrated,
        "doc",
        "release-isolation-thread",
        24,
        "live",
        releaseId,
      ).map((message) => message.id)).toEqual([10, 11]);

      const cutover = recordRecallLiveCutover(migrated, "doc", {
        authorizedBy: "doc",
        masterMode: "observe",
      });
      expect(cutover.success).toBe(true);
      expect(migrated.prepare("SELECT cutoff_message_id FROM recall_live_cutovers WHERE owner_id = 'doc' AND release_id = ?").get(releaseId))
        .toEqual({ cutoff_message_id: 11 });

      migrated.exec(`
        UPDATE mem_threads SET status = 'archived' WHERE id = 'file-thread';
        INSERT INTO mem_threads (id, owner_id, status, channel, created_at, updated_at)
        VALUES ('post-cutover-thread', 'doc', 'active', 'discord', '2026', '2026');
        INSERT INTO mem_messages (id, thread_id, owner_id, role, text, channel, created_at)
        VALUES (12, 'post-cutover-thread', 'doc', 'user', 'new thread one', 'discord', '2026'),
               (13, 'post-cutover-thread', 'doc', 'assistant', 'new thread two', 'discord', '2026');
      `);
      expect(listUnconsolidatedMessages(
        migrated,
        "doc",
        "post-cutover-thread",
        24,
        "live",
        releaseId,
      ).map((message) => message.id)).toEqual([12, 13]);
      expect(operatorRollbackCapability(migrated, "recall", {
        releaseId,
        authorizedBy: "doc",
      })).toMatchObject({ success: true, status: "rolled_back" });
      expect(migrated.prepare("SELECT COUNT(*) AS c FROM capability_events WHERE kind IN ('operator_rollback', 'operator_cutover')").get())
        .toEqual({ c: 2 });

      const sequence = migrated.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'episodes'").get() as { seq: number };
      expect(sequence.seq).toBeGreaterThan(historicalEpisodeId);
    } finally {
      migrated.close();
      continuity.close();
    }

    const reopenedContinuity = openContinuityDb(
      new DatabaseSync(plane.continuityDbPath),
      { dataPlane: plane },
    );
    connections.push(reopenedContinuity);
    const reopened = openNuclearDb(new DatabaseSync(plane.nuclearDbPath), {
      continuity: reopenedContinuity,
      dataPlane: plane,
    });
    connections.push(reopened);
    try {
      expect(reopened.prepare("PRAGMA user_version").get()).toEqual({
        user_version: NUCLEAR_SUPPORTED_VERSION,
      });
      expect(reopened.prepare("SELECT id, entity_uuid FROM episodes WHERE id = ?").get(historicalEpisodeId))
        .toEqual({ id: historicalEpisodeId, entity_uuid: historicalUuid });
      expect(reopened.prepare("SELECT cutoff_message_id FROM recall_live_cutovers WHERE owner_id = 'doc' AND release_id = ?").get(releaseId))
        .toEqual({ cutoff_message_id: 11 });
      expect(reopened.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(reopened.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    } finally {
      reopened.close();
      reopenedContinuity.close();
    }

    const snapshots = readdirSync(join(dataDir, "migration-backups"))
      .filter((name) => name.startsWith("nuclear-v21-pre22-") && name.endsWith(".db"));
    expect(snapshots).toHaveLength(2);
    const snapshot = new DatabaseSync(join(dataDir, "migration-backups", snapshots.sort().at(-1)!));
    try {
      expect(snapshot.prepare("PRAGMA user_version").get()).toEqual({ user_version: 21 });
      expect(snapshot.prepare("SELECT id, entity_uuid FROM episodes WHERE id = ?").get(historicalEpisodeId))
        .toEqual({ id: historicalEpisodeId, entity_uuid: historicalUuid });
    } finally {
      snapshot.close();
    }
  });
});
