import { expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../cognitive-v021/sidecar/db.js";
import { openTestSidecar, setTestSidecarVersion } from "../cognitive-v021/test-support.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../cognitive-v021/types.js";

it("applies v60 idempotently on a v59 database that already has rows", () => {
  const db = openTestSidecar();
  try {
    db.prepare(`INSERT INTO growth_dimensions
      (id, name, weekly_question, status, origin, created_at_ms, updated_at_ms)
      VALUES ('d1','Kept','Question?','active','owner_seed',1,1)`).run();
    const growth = db.prepare("SELECT * FROM growth_dimensions").all();
    setTestSidecarVersion(db, 59);
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(64);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(64);
    expect(db.prepare("SELECT * FROM growth_dimensions").all()).toEqual(growth);
    expect(db.prepare("SELECT COUNT(*) AS n FROM domus_observations").get()).toEqual({ n: 0 });
    db.prepare(`INSERT INTO domus_observations (
      observation_id, digest, world, branch, session, attachment, body, snapshot, seq,
      source_time_ms, expires_at_ms, receipt_time_ms, lineage_class, payload_json
    ) VALUES ('obs','digest','w','b','s','a','body','snap',1,1,2,3,'WORLD','{}')`).run();
    for (const table of ["sidecar_memory_assertions", "sidecar_memory_supports", "episodes_v2", "activity_journal"]) {
      db.exec(`ALTER TABLE ${table} DROP COLUMN channel`);
      db.exec(`ALTER TABLE ${table} DROP COLUMN lineage_class`);
    }
    db.exec("ALTER TABLE domus_observations DROP COLUMN undone_at_ms");
    db.exec("PRAGMA user_version = 59");
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    expect(db.prepare("SELECT observation_id FROM domus_observations").all()).toEqual([{ observation_id: "obs" }]);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(64);
    expect(db.prepare("SELECT COUNT(*) AS n FROM inbox_events").get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});
