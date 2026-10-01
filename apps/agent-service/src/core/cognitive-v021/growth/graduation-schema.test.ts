// Graduation persists operational evidence separately from Thought's adjudications.
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
describe("graduation durable layers", () => {
  it("fails closed when the current schema is missing a prediction column", () => {
    const db = openTestSidecar();
    try {
      expect(db.prepare("PRAGMA table_info(expectations)").all().map(row => row.name)).toContain("judgment_class");
      db.exec("ALTER TABLE expectations DROP COLUMN judgment_class");
      expect(() => openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } })).toThrow();
    } finally { db.close(); }
  });
  it("installs separate observation and adjudication stores", () => {
    const db = openTestSidecar();
    try {
      for (const name of ["graduation_observations", "graduation_adjudications", "graduation_calibration", "graduation_contract_state"]) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name), name).toBeTruthy();
      }
    } finally { db.close(); }
  });
  it("defaults graduation to observe with an attributable mode record", () => {
    const db = openTestSidecar();
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='graduation_contract_state'").all()).toHaveLength(1);
      expect(db.prepare("SELECT mode, actor, at_ms FROM graduation_contract_state WHERE id=1").get()).toMatchObject({ mode: "observe", actor: "migration", at_ms: 0 });
    } finally { db.close(); }
  });
});
