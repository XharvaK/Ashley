import { expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

const columnsOf = (db: { prepare(sql: string): { all(): unknown[] } }) =>
  (db.prepare("PRAGMA table_info(domus_acts)").all() as Array<{ name: string }>).map(column => column.name);

it("adds the answer column to domus acts, keeping the acts that were there (v74)", () => {
  const db = openTestSidecar();
  try {
    db.exec("ALTER TABLE domus_acts DROP COLUMN answer_json");
    db.prepare(`INSERT INTO domus_acts (act_id, cycle_id, world, attachment, observation_id, option_ref, object_id, guid64,
      label, state, requested_at_ms, expires_at_ms, updated_at_ms) VALUES ('act-1', 'cycle-1', 'slot8', 'helper-a', 'helper-a.1', 'a1',
      '1001', '13001', 'Read a Book (Bookshelf)', 'requested', 1, 2, 1)`).run();
    setTestSidecarVersion(db, 73);
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(76);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(76);
    expect((db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get() as { schema_version: number }).schema_version).toBe(76);
    expect(columnsOf(db)).toContain("answer_json");
    expect(db.prepare("SELECT label, answer_json FROM domus_acts WHERE act_id = 'act-1'").get())
      .toEqual({ label: "Read a Book (Bookshelf)", answer_json: null });
  } finally {
    db.close();
  }
});

it("does not add the answer column twice when the column already exists", () => {
  const db = openTestSidecar();
  try {
    setTestSidecarVersion(db, 73);
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    expect(columnsOf(db).filter(name => name === "answer_json")).toEqual(["answer_json"]);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(76);
  } finally {
    db.close();
  }
});
