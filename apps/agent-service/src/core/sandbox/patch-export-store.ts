/**
 * M7 control-plane persistence for named patch_export records.
 * Work state only. Never Identity, Mind State, or Recall. Not apply.
 */

import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";

export type PatchExportRecordStatus = "succeeded" | "failed" | "outcome_unknown";

function nowIso(): string {
  return new Date().toISOString();
}

export function persistPatchExportRecord(
  db: DatabaseSync,
  input: {
    ownerId: string;
    taskId: string;
    projectId: string;
    changesetId: string;
    artifactRef: string;
    destinationPath: string;
    expectedSha256: string;
    witnessSha256: string | null;
    bytesWritten: number | null;
    status: PatchExportRecordStatus;
    errorCode: string | null;
  },
): void {
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO patch_export_records (
       entity_uuid, data_classification, owner_id, task_id, project_id, changeset_id,
       artifact_ref, destination_path, expected_sha256, witness_sha256, bytes_written,
       status, error_code, applied, live_unwritten, git_unwritten, created_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?)`,
  ).run(
    newEntityUuid(),
    defaultUnclassifiedConversational(),
    input.ownerId,
    input.taskId,
    input.projectId,
    input.changesetId,
    input.artifactRef,
    input.destinationPath,
    input.expectedSha256,
    input.witnessSha256,
    input.bytesWritten,
    input.status,
    input.errorCode,
    createdAt,
    createdAt,
  );
}

export function getPatchExportRecord(
  db: DatabaseSync,
  taskId: string,
): {
  status: string;
  changesetId: string;
  witnessSha256: string | null;
  applied: number;
  liveUnwritten: number;
  gitUnwritten: number;
  errorCode: string | null;
} | null {
  const row = db
    .prepare(
      `SELECT status, changeset_id AS changesetId, witness_sha256 AS witnessSha256,
              applied, live_unwritten AS liveUnwritten, git_unwritten AS gitUnwritten,
              error_code AS errorCode
         FROM patch_export_records WHERE task_id = ?`,
    )
    .get(taskId) as
    | {
        status: string;
        changesetId: string;
        witnessSha256: string | null;
        applied: number;
        liveUnwritten: number;
        gitUnwritten: number;
        errorCode: string | null;
      }
    | undefined;
  return row ?? null;
}
