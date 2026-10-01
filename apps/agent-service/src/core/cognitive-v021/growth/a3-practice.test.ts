// Practices are her own procedural notes, earned from evidence, cheap to revert.
import { describe, it, expect } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { COGNITIVE_SIDECAR_SCHEMA_V39 } from "../sidecar/schema.js";
import { REVISION_LAYERS, proposeRevisions, evaluateRevisions, recordRevisionPositions, getRevision, revertRevision, resolveRevisionEvidence, revisionEvidenceStats, isFoundationalLayer } from "./revisions.js";
import { recordFriction } from "./friction.js";
import { growthForThought } from "./growth.js";
const T = 1000000;
function ready() { expect(REVISION_LAYERS, "practice layer supported").toContain("practice"); }
function evidence(db: ReturnType<typeof openTestSidecar>, id: string, cycleId: string | null) {
  recordFriction(db, { frictionId: id, kind: "self_reported", cycleId, subjectId: cycleId ? null : id, note: "friction", nowMs: T, dataClassification: "ordinary" });
  return `friction:${id}`;
}
function propose(db: ReturnType<typeof openTestSidecar>, refs: string[]) {
  const result = proposeRevisions(db, { cycleId: "proposal", proposals: [{ layer: "practice", topic: "checking", text: "Check evidence before answering", rationale: "experience", evidenceRefs: refs } as any], identity: null, nowMs: T })[0]!;
  expect(result.outcome).toBe("proposed");
  return (result as any).revisionId as number;
}
describe("A3b practices", () => {
  it.each(["two", "one", "affirm"])("applies only two origins or a later-pass affirm (%s)", mode => {
    ready(); const db = openTestSidecar();
    try {
      const refs = [evidence(db, "f1", "origin1")];
      if (mode === "two") refs.push(evidence(db, "f2", "origin2"));
      const id = propose(db, refs);
      expect(isFoundationalLayer("practice" as any)).toBe(false);
      recordRevisionPositions(db, { cycleId: "proposal", positions: [{ revisionId: id, position: "affirm", rationale: "same pass" }], nowMs: T });
      if (mode === "affirm") recordRevisionPositions(db, { cycleId: "later", positions: [{ revisionId: id, position: "affirm", rationale: "I affirm" }], nowMs: T+1 });
      expect(evaluateRevisions(db, null, T+2).applied).toEqual(mode === "one" ? [] : [id]);
    } finally { db.close(); }
  });
  it("counts friction once per cycle and Host kind/subject origin", () => {
    ready(); const db = openTestSidecar();
    try {
      const refs = [evidence(db, "f1", "same"), evidence(db, "f2", "same")];
      expect(resolveRevisionEvidence(db, refs[0]!)).toMatchObject({ atMs: T });
      const id = propose(db, refs);
      expect(revisionEvidenceStats(db, id).count).toBe(1);
      expect(evaluateRevisions(db, null, T).applied).toEqual([]);
      recordFriction(db, { frictionId: "host", kind: "effect_failed", subjectId: "effect1", cycleId: "same", nowMs: T, dataClassification: "never_public" });
      const host = "friction:host";
      expect(resolveRevisionEvidence(db, host)).not.toBeNull();
      proposeRevisions(db, { cycleId: "reinforce", proposals: [{ layer: "practice", topic: "checking", text: "Check evidence before answering", rationale: "experience", evidenceRefs: [host] } as any], identity: null, nowMs: T+1 });
      expect(revisionEvidenceStats(db, id).count).toBe(2);
    } finally { db.close(); }
  });
  it("reverts practice and removes it from Thought", () => {
    ready(); const db = openTestSidecar();
    try {
      const id = propose(db, [evidence(db, "f1", "one"), evidence(db, "f2", "two")]);
      evaluateRevisions(db, null, T);
      expect((growthForThought(db, null, T) as any).practices).toEqual([{ revisionId: id, text: "Check evidence before answering", heldSinceMs: T }]);
      expect(revertRevision(db, null, id, T+1)).toBe(true);
      expect(getRevision(db, id)?.status).toBe("reverted");
      expect((growthForThought(db, null, T+1) as any).practices ?? []).toEqual([]);
    } finally { db.close(); }
  });
  it("preserves every complete historical revision row while rebuilding the CHECK", () => {
    ready(); const db = openTestSidecar();
    try {
      db.exec("DROP TABLE growth_revisions");
      db.exec(COGNITIVE_SIDECAR_SCHEMA_V39.slice(0, COGNITIVE_SIDECAR_SCHEMA_V39.indexOf("CREATE TABLE IF NOT EXISTS growth_revision_evidence")));
      for (const [n, layer] of ["opinion", "taste", "trait", "value", "boundary"].entries()) db.prepare("INSERT INTO growth_revisions (layer, target_key, proposed_text, rationale, status, proposed_cycle_id, data_classification, created_at_ms, updated_at_ms, previous_text, ashley_position, owner_decision) VALUES (?, ?, ?, 'rationale', 'reverted', 'old', 'sensitive', ?, ?, 'previous', 'affirm', 'approve')").run(layer, `target${n}`, `text${n}`, T+n, T+n);
      const before = db.prepare("SELECT * FROM growth_revisions ORDER BY revision_id").all();
      db.exec("PRAGMA user_version = 46"); db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 46").run();
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("SELECT * FROM growth_revisions ORDER BY revision_id").all()).toEqual(before);
      expect(db.prepare("SELECT count(*) AS n FROM growth_revisions").get()!.n).toBe(before.length);
      propose(db, [evidence(db, "new", "new")]);
    } finally { db.close(); }
  });
});

describe("A3b friction citations", () => {
  it("exposes the stable friction id that a practice can cite", () => {
    const db = openTestSidecar();
    try {
      evidence(db, "visible", "origin");
      expect((growthForThought(db, null, T).friction.recent[0] as any).frictionId, "friction id is visible").toBe("visible");
    } finally { db.close(); }
  });
});
