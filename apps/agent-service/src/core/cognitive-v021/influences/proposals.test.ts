// Three real cycle receipts permit a proposal, never an adoption.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle, setTestSidecarVersion } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { recordGrowth } from "../growth/growth.js";
import { recordInterestTouches, forgetInterestBranch } from "../memory/interests.js";
import { readEligibility } from "./eligibility.js";
const T = Date.UTC(2026, 9, 1, 12), OWNER = "fixture:influence-owner";
function fixture() {
  const db = openTestSidecar(), nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  return { db, nuclear, identityStore: { nuclear, ownerId: OWNER } };
}
function touch(db: ReturnType<typeof openTestSidecar>, cycleId: string, n: number, branch = "compilers") {
  admitTestCycle(db, { cycleId, conversationId: "fixture:influences", generation: n + 1, triggerKind: "idle_opportunity", triggerRef: cycleId, nowMs: T + n });
  const [key] = recordInterestTouches(db, [{ root: "Technology", branch }], T + n);
  db.prepare("INSERT OR IGNORE INTO interest_touches (branch_key,cycle_id,touched_at_ms) VALUES (?,?,?)").run(key, cycleId, T + n);
  return key;
}
const rows = (db: ReturnType<typeof openTestSidecar>) => db.prepare("SELECT * FROM learned_influences ORDER BY id").all();
const grow = (f: ReturnType<typeof fixture>, cycleId: string, n: number) => recordGrowth(f.db, { cycleId, identityStore: f.identityStore, dataClassification: "ordinary", nowMs: T + n });
describe("A5b bounded branch proposals", () => {
  it("reads admitted branch evidence without treating it as numeric C1 assertion evidence", () => {
    const f = fixture(); try {
      for (let n = 1; n <= 3; n++) touch(f.db, "eligible" + n, n);
      grow(f, "eligible3", 3); const row = rows(f.db)[0];
      expect(row).toBeTruthy();
      admitTestCycle(f.db, { cycleId: "later", conversationId: "fixture:influences", generation: 5, triggerKind: "idle_opportunity", triggerRef: "later", nowMs: T + 4 });
      f.db.prepare("UPDATE learned_influences SET adjudication_state='accepted',adjudicator='thought',qualified_at=?,adjudication_decision_id='fixture:later',admitting_cycle_id='later' WHERE id=?").run(new Date(T + 4).toISOString(), Number(row.id));
      expect(readEligibility(f.db, Number(row.id), { evidenceDb: f.nuclear, mode: "apply", at: new Date(T + 5) })).toBe(true);
      f.db.prepare("UPDATE learned_influences SET qualified_at='invalid-time' WHERE id=?").run(Number(row.id));
      expect(readEligibility(f.db, Number(row.id), { evidenceDb: f.nuclear, mode: "apply", at: new Date(T + 5) })).toBe(false);
    } finally { f.db.close(); f.nuclear.close(); }
  });
  it("proposes only after three distinct cycles and keeps replay pending without Host admission", () => {
    const f = fixture(); try {
      const key = touch(f.db, "one", 1); grow(f, "one", 1);
      touch(f.db, "two", 2); grow(f, "two", 2); expect(rows(f.db)).toHaveLength(0);
      f.db.prepare("INSERT OR IGNORE INTO interest_touches (branch_key,cycle_id,touched_at_ms) VALUES (?,?,?)").run(key, "two", T + 3);
      grow(f, "two", 3); expect(rows(f.db)).toHaveLength(0);
      touch(f.db, "three", 4); grow(f, "three", 4); grow(f, "three", 4);
      expect(rows(f.db)).toHaveLength(1);
      expect(rows(f.db)[0]).toMatchObject({ branch_key: key, text: "compilers", adjudication_state: "pending", qualified_at: null, adjudicator: null, proposed_cycle_id: "three", lineage_kind: "ashley_native", influence_class: "I1" });
    } finally { f.db.close(); f.nuclear.close(); }
  });
  it("stores distinct typed branch evidence and preserves explicit seed lineage", () => {
    const f = fixture(); try {
      for (let n = 1; n <= 3; n++) touch(f.db, "seed" + n, n, "database internals");
      grow(f, "seed3", 3); expect(rows(f.db)).toHaveLength(1);
      expect(rows(f.db)[0]).toMatchObject({ lineage_kind: "explicit_seed", semantic_owner: "thought", text: "database internals" });
      expect(f.db.prepare("SELECT count(*) AS n FROM learned_influence_evidence").get()).toEqual({ n: 0 });
      const has = !!f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='learned_influence_branch_evidence'").get();
      expect(has ? f.db.prepare("SELECT cycle_id FROM learned_influence_branch_evidence ORDER BY cycle_id").all() : []).toEqual([{ cycle_id: "seed1" }, { cycle_id: "seed2" }, { cycle_id: "seed3" }]);
    } finally { f.db.close(); f.nuclear.close(); }
  });
  it("forgets proposal text and typed evidence when the branch is forgotten", () => {
    const f = fixture(); try {
      let key = ""; for (let n = 1; n <= 3; n++) key = touch(f.db, "forget" + n, n);
      grow(f, "forget3", 3); expect(rows(f.db)).toHaveLength(1);
      forgetInterestBranch(f.db, key); expect(rows(f.db)).toEqual([]);
      expect(f.db.prepare("SELECT * FROM interest_touches").all()).toEqual([]);
      expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { f.db.close(); f.nuclear.close(); }
  });
  it("upgrades v51 without manufacturing proposals or receipts", () => {
    const db = openTestSidecar(); try {
      setTestSidecarVersion(db, 51); openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 75 });
      expect(db.prepare("SELECT * FROM learned_influences").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM interest_touches").all()).toEqual([]);
    } finally { db.close(); }
  });
  it("rolls back an incomplete proposal when its evidence write fails", () => {
    const f = fixture(); try {
      for (let n = 1; n <= 3; n++) touch(f.db, "rollback" + n, n);
      if (f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='learned_influence_branch_evidence'").get()) {
        f.db.exec("CREATE TRIGGER fixture_influence_failure BEFORE INSERT ON learned_influence_branch_evidence BEGIN SELECT RAISE(ABORT,'fixture_influence_failure'); END");
      }
      expect(() => grow(f, "rollback3", 3)).toThrow("fixture_influence_failure");
      expect(rows(f.db)).toEqual([]);
      expect(f.db.prepare("SELECT * FROM interest_touches").all()).toHaveLength(3);
    } finally { f.db.close(); f.nuclear.close(); }
  });
});
