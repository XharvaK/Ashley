import { expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

it("migrates a v60 memory row set to channel and lineage defaults", () => {
  const db = openTestSidecar();
  try {
    db.prepare(`INSERT INTO sidecar_memory_assertions
      (assertion_key, statement, memory_kind, dimensions_json, data_classification, lineage_parent_key, admitted_generation, live, content_hash)
      VALUES ('a1','kept','owner_preference','{}','ordinary',NULL,1,1,'hash')`).run();
    db.prepare(`INSERT INTO sidecar_memory_supports
      (support_id, assertion_key, source, provenance, source_architecture_epoch, source_ref, settlement_id, evidence_lineage_id, observation_id, receipt_id, dimensions_json, data_classification, created_at_ms)
      VALUES ('s1','a1','owner_utterance','native','v0.2.1',NULL,NULL,NULL,NULL,NULL,'{}','ordinary',1)`).run();
    db.prepare(`INSERT INTO episodes_v2
      (episode_id, conversation_id, cycle_id, started_at_ms, ended_at_ms, evidence_row_ids_json, summary, salience, unresolved_threads_json, data_classification, created_at_ms)
      VALUES ('e1','c','cycle',1,2,'[]','summary',0.5,'[]','ordinary',1)`).run();
    db.prepare(`INSERT INTO activity_journal
      (entry_id, conversation_id, cycle_id, pass_kind, read_refs_json, interests_json, spoke, data_classification, created_at_ms)
      VALUES ('j1','c','cycle','afterglow','[]','[]',0,'ordinary',1)`).run();
    db.prepare(`INSERT INTO domus_observations (
      observation_id, digest, world, branch, session, attachment, body, snapshot, seq,
      source_time_ms, expires_at_ms, receipt_time_ms, lineage_class, payload_json
    ) VALUES ('obs','digest','w','b','s','a','body','snap',1,1,2,3,'WORLD','{}')`).run();
    setTestSidecarVersion(db, 60);
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(69);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(69);
    for (const [table, idColumn, id] of [
      ["sidecar_memory_assertions", "assertion_key", "a1"],
      ["sidecar_memory_supports", "support_id", "s1"],
      ["episodes_v2", "episode_id", "e1"],
      ["activity_journal", "entry_id", "j1"],
    ] as const) {
      expect(db.prepare(`SELECT channel, lineage_class FROM ${table} WHERE ${idColumn} = ?`).get(id))
        .toEqual({ channel: "discord", lineage_class: "current" });
    }
    const columns = (db.prepare("PRAGMA table_info(domus_observations)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toContain("undone_at_ms");
    expect(db.prepare("SELECT undone_at_ms FROM domus_observations WHERE observation_id = 'obs'").get()).toEqual({ undone_at_ms: null });
    expect(() => db.prepare("UPDATE sidecar_memory_assertions SET lineage_class = 'gone' WHERE assertion_key = 'a1'").run()).toThrow();
  } finally {
    db.close();
  }
});
