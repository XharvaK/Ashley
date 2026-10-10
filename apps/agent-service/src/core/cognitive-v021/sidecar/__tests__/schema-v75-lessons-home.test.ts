import { expect, it } from "vitest";
import { openCognitiveSidecarDb } from "../db.js";
import { openTestSidecar, setTestSidecarVersion } from "../../test-support.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";

const columnsOf = (db: { prepare(sql: string): { all(): unknown[] } }) =>
  (db.prepare("PRAGMA table_info(lessons)").all() as Array<{ name: string }>).map(column => column.name);

it("adds the came-home column to lessons, keeping the lessons that were there (v75)", () => {
  const db = openTestSidecar();
  try {
    db.exec("ALTER TABLE lessons DROP COLUMN brought_home_at_ms");
    db.prepare(`INSERT INTO lessons (lesson_id, cycle_id, ordinal, from_principal, place_ref, what, curious_about, at_ms)
      VALUES ('lesson:cycle-1:0', 'cycle-1', 0, 'p1', 'contact:p1', 'Old fact', NULL, 1)`).run();
    setTestSidecarVersion(db, 74);
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(76);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(76);
    expect((db.prepare("SELECT schema_version FROM cognitive_sidecar_meta WHERE id = 1").get() as { schema_version: number }).schema_version).toBe(76);
    expect(columnsOf(db)).toContain("brought_home_at_ms");
    expect(db.prepare("SELECT what, brought_home_at_ms FROM lessons WHERE lesson_id = 'lesson:cycle-1:0'").get())
      .toEqual({ what: "Old fact", brought_home_at_ms: null });
  } finally {
    db.close();
  }
});

it("does not add the came-home column twice when it already exists", () => {
  const db = openTestSidecar();
  try {
    setTestSidecarVersion(db, 74);
    openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
    expect(columnsOf(db).filter(name => name === "brought_home_at_ms")).toEqual(["brought_home_at_ms"]);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(76);
  } finally {
    db.close();
  }
});
