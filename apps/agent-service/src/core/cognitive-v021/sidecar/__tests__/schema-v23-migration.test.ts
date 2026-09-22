import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import { migrateDetachedFailureEvidenceToV23, openCognitiveSidecarDb } from "../db.js";
import { COGNITIVE_SIDECAR_SCHEMA_VERSION } from "../../types.js";
import {
  admitDetachedOperation,
  getDetachedOperation,
  markDetachedOperationStarted,
  setDetachedOperationTerminal,
} from "../../operation/detached.js";

function admitStartedOp(db: ReturnType<typeof openTestSidecar>, id: string) {
  const admitted = admitDetachedOperation(db, {
    idempotencyKey: `v23:${id}`,
    conversationId: `thread:${id}`,
    originCycleId: `cycle:${id}`,
    originGeneration: 1,
    originKind: "OWNER_REQUEST",
    originRef: `owner-event:${id}`,
    originOwnerEventId: `owner-event:${id}`,
    operationKind: "project.investigate",
    request: { projectId: "project-ashley", focus: id },
    purpose: `v23 ${id}`,
    evidenceNeed: "bounded file evidence",
    operationDeadlineAtMs: Date.now() + 1_000_000,
    nowMs: Date.now(),
  });
  if (!admitted.ok) throw new Error(`admit_failed:${id}`);
  const started = markDetachedOperationStarted(db, admitted.operation.operationId, {
    startProofRef: `proof:${id}`,
    nowMs: Date.now(),
  });
  if (!started.ok) throw new Error(`start_failed:${id}`);
  return admitted.operation.operationId;
}

describe("cognitive sidecar Schema V23 worker failure evidence", () => {
  it("migrates a V22 store, preserves rows, and is idempotent", () => {
    const db = openTestSidecar();
    try {
      // A legacy row settled before V23 existed.
      const legacyOp = admitStartedOp(db, "legacy");
      const legacyTerminal = setDetachedOperationTerminal(db, legacyOp, {
        terminalState: "failed",
        errorCode: "opencode_provider_rejected",
        nowMs: Date.now(),
      });
      expect(legacyTerminal.ok).toBe(true);
      // Simulate a pre-V23 store carrying that row.
      db.exec("ALTER TABLE detached_operations DROP COLUMN failure_evidence_json");
      db.exec("PRAGMA user_version = 22");
      db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = 22 WHERE id = 1").run();

      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
        .toBe(COGNITIVE_SIDECAR_SCHEMA_VERSION);
      expect(COGNITIVE_SIDECAR_SCHEMA_VERSION).toBe(24);
      expect(db.prepare("PRAGMA table_info(detached_operations)").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "failure_evidence_json" }),
      ]));
      // Legacy row survives with NULL evidence.
      expect(getDetachedOperation(db, legacyOp)).toMatchObject({
        errorCode: "opencode_provider_rejected",
        failureEvidenceJson: null,
      });

      // New terminal writes carry sanitized evidence.
      const freshOp = admitStartedOp(db, "fresh");
      const evidence = JSON.stringify({
        failureClass: "opencode_provider_rejected",
        statusCode: 403,
        errorType: "FreeTierError",
        message: "OpenCode's free tier can only be used from within OpenCode",
        processExit: 1,
        modelId: "opencode/nemotron-3.5-lightning-free",
        openCodeVersion: "1.18.30",
      });
      const freshTerminal = setDetachedOperationTerminal(db, freshOp, {
        terminalState: "failed",
        errorCode: "opencode_provider_rejected",
        failureEvidenceJson: evidence,
        nowMs: Date.now(),
      });
      expect(freshTerminal.ok).toBe(true);
      expect(getDetachedOperation(db, freshOp)?.failureEvidenceJson).toBe(evidence);

      // Re-running the migration is a no-op: version stays, evidence intact.
      const versionBefore = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      migrateDetachedFailureEvidenceToV23(db);
      migrateDetachedFailureEvidenceToV23(db);
      expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(versionBefore);
      expect(getDetachedOperation(db, freshOp)?.failureEvidenceJson).toBe(evidence);
      expect(getDetachedOperation(db, legacyOp)?.failureEvidenceJson).toBeNull();
    } finally {
      db.close();
    }
  });

  it("rejects non-JSON failure evidence at the terminal seam", () => {
    const db = openTestSidecar();
    try {
      const op = admitStartedOp(db, "guards");
      expect(setDetachedOperationTerminal(db, op, {
        terminalState: "failed",
        errorCode: "opencode_failed",
        failureEvidenceJson: "not-json{{{",
        nowMs: Date.now(),
      })).toMatchObject({ ok: false, reason: "invalid_failure_evidence" });
      expect(getDetachedOperation(db, op)?.state).toBe("started");
    } finally {
      db.close();
    }
  });
});
