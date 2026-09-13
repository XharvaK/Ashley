/**
 * M5 control-plane persistence for CandidateChangeSet rows and audit events.
 * Work state only. Never Identity, Mind State, or Recall.
 */

import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";

export type ChangeSetStatus =
  | "proposed"
  | "quarantined"
  | "stale_base"
  | "superseded"
  | "abandoned";

export type ChangeSetEventType =
  | "created"
  | "sealed"
  | "proposed"
  | "secret_quarantined";

export type PersistedChangeSet = {
  changesetId: string;
  status: ChangeSetStatus;
  reviewStatus: "submitted" | null;
  quarantineReason: string | null;
  artifactRef: string | null;
  patchSha256: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function jsonBound(value: unknown): string {
  return JSON.stringify(value ?? []);
}

export function persistProposedChangeSet(
  db: DatabaseSync,
  input: {
    ownerId: string;
    changesetId: string;
    projectId: string;
    workspaceId: string;
    sourceSnapshotId: string;
    candidateSnapshotId: string;
    candidateTreeHash: string;
    baseTreeHash: string;
    baseCommit: string | null;
    sourceCleanliness: string;
    treeHashAlgorithm: string;
    objective: string;
    rationale: string;
    targetArea?: string;
    expectedEffect?: string;
    riskClass: string;
    evidenceRefs: readonly string[];
    verificationRecipeIds: readonly string[];
    intendedPaths?: readonly string[];
    changedPaths: unknown;
    linkedVerificationRefs: readonly string[];
    patchSha256: string;
    patchBytes: number;
    artifactRef: string;
    originChildTaskId?: string | null;
  },
): PersistedChangeSet {
  const createdAt = nowIso();
  const classification = defaultUnclassifiedConversational();
  db.prepare(
    `INSERT INTO candidate_changesets (
       entity_uuid, data_classification, owner_id, changeset_id, changeset_version,
       project_id, workspace_id, source_snapshot_id, candidate_snapshot_id,
       candidate_tree_hash, base_tree_hash, base_commit, source_cleanliness,
       stale_base, tree_hash_algorithm, objective, rationale, target_area,
       expected_effect, risk_class, evidence_refs_json, verification_recipe_ids_json,
       intended_paths_json, changed_paths_json, linked_verification_refs_json,
       patch_sha256, patch_bytes, artifact_ref, status, review_status,
       quarantine_reason, origin_child_task_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', 'submitted', NULL, ?, ?, ?)`,
  ).run(
    newEntityUuid(),
    classification,
    input.ownerId,
    input.changesetId,
    input.projectId,
    input.workspaceId,
    input.sourceSnapshotId,
    input.candidateSnapshotId,
    input.candidateTreeHash,
    input.baseTreeHash,
    input.baseCommit,
    input.sourceCleanliness,
    input.treeHashAlgorithm,
    input.objective,
    input.rationale,
    input.targetArea ?? null,
    input.expectedEffect ?? null,
    input.riskClass,
    jsonBound(input.evidenceRefs),
    jsonBound(input.verificationRecipeIds),
    input.intendedPaths ? jsonBound(input.intendedPaths) : null,
    jsonBound(input.changedPaths),
    jsonBound(input.linkedVerificationRefs),
    input.patchSha256,
    input.patchBytes,
    input.artifactRef,
    input.originChildTaskId ?? null,
    createdAt,
    createdAt,
  );
  appendChangeSetEvent(db, {
    ownerId: input.ownerId,
    changesetId: input.changesetId,
    eventType: "created",
    metadata: { projectId: input.projectId, workspaceId: input.workspaceId },
  });
  appendChangeSetEvent(db, {
    ownerId: input.ownerId,
    changesetId: input.changesetId,
    eventType: "sealed",
    metadata: {
      candidateTreeHash: input.candidateTreeHash,
      baseTreeHash: input.baseTreeHash,
      patchSha256: input.patchSha256,
      pathCount: Array.isArray(input.changedPaths) ? input.changedPaths.length : 0,
    },
  });
  appendChangeSetEvent(db, {
    ownerId: input.ownerId,
    changesetId: input.changesetId,
    eventType: "proposed",
    metadata: { reviewStatus: "submitted" },
  });
  return {
    changesetId: input.changesetId,
    status: "proposed",
    reviewStatus: "submitted",
    quarantineReason: null,
    artifactRef: input.artifactRef,
    patchSha256: input.patchSha256,
  };
}

export function persistQuarantinedChangeSet(
  db: DatabaseSync,
  input: {
    ownerId: string;
    changesetId: string;
    projectId: string;
    workspaceId: string;
    sourceSnapshotId: string;
    objective: string;
    rationale: string;
    riskClass: string;
    evidenceRefs: readonly string[];
    verificationRecipeIds: readonly string[];
    quarantineReason: string;
  },
): PersistedChangeSet {
  // Secret scan does not identify which Thought field hit. Persist no raw
  // Thought text and no patch bytes.
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO candidate_changesets (
       entity_uuid, data_classification, owner_id, changeset_id, changeset_version,
       project_id, workspace_id, source_snapshot_id, source_cleanliness,
       stale_base, objective, rationale, risk_class, evidence_refs_json,
       verification_recipe_ids_json, status, review_status, quarantine_reason,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'unknown', 0, ?, ?, ?, ?, ?, 'quarantined', NULL, ?, ?, ?)`,
  ).run(
    newEntityUuid(),
    defaultUnclassifiedConversational(),
    input.ownerId,
    input.changesetId,
    input.projectId,
    input.workspaceId,
    input.sourceSnapshotId,
    "[redacted:secret_detected]",
    "[redacted:secret_detected]",
    input.riskClass,
    jsonBound(input.evidenceRefs),
    jsonBound(input.verificationRecipeIds),
    input.quarantineReason,
    createdAt,
    createdAt,
  );
  appendChangeSetEvent(db, {
    ownerId: input.ownerId,
    changesetId: input.changesetId,
    eventType: "secret_quarantined",
    metadata: { reason: input.quarantineReason, pathCount: 0 },
  });
  return {
    changesetId: input.changesetId,
    status: "quarantined",
    reviewStatus: null,
    quarantineReason: input.quarantineReason,
    artifactRef: null,
    patchSha256: null,
  };
}

export function appendChangeSetEvent(
  db: DatabaseSync,
  input: {
    ownerId: string;
    changesetId: string;
    eventType: ChangeSetEventType;
    metadata: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO candidate_changeset_events (
       entity_uuid, data_classification, owner_id, changeset_id, event_type,
       metadata_json, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newEntityUuid(),
    defaultUnclassifiedConversational(),
    input.ownerId,
    input.changesetId,
    input.eventType,
    JSON.stringify(input.metadata),
    nowIso(),
  );
}

export function getChangeSet(
  db: DatabaseSync,
  changesetId: string,
): {
  status: string;
  review_status: string | null;
  artifact_ref: string | null;
  patch_sha256: string | null;
  patch_bytes: number | null;
  quarantine_reason: string | null;
  evidence_refs_json: string;
  owner_id: string;
  project_id: string;
  workspace_id: string;
} | null {
  return (
    (db
      .prepare(
        `SELECT status, review_status, artifact_ref, patch_sha256, patch_bytes,
                quarantine_reason, evidence_refs_json, owner_id, project_id, workspace_id
           FROM candidate_changesets WHERE changeset_id = ?`,
      )
      .get(changesetId) as {
      status: string;
      review_status: string | null;
      artifact_ref: string | null;
      patch_sha256: string | null;
      patch_bytes: number | null;
      quarantine_reason: string | null;
      evidence_refs_json: string;
      owner_id: string;
      project_id: string;
      workspace_id: string;
    } | undefined) ?? null
  );
}

export function listChangeSetEventTypes(db: DatabaseSync, changesetId: string): string[] {
  return (
    db
      .prepare(
        `SELECT event_type FROM candidate_changeset_events
          WHERE changeset_id = ? ORDER BY id ASC`,
      )
      .all(changesetId) as Array<{ event_type: string }>
  ).map((row) => row.event_type);
}

export function getChangeSetByOriginChildTaskId(
  db: DatabaseSync,
  originChildTaskId: string,
): { changesetId: string; workspaceId: string; candidateTreeHash: string | null } | null {
  const row = db
    .prepare(
      `SELECT changeset_id AS changesetId, workspace_id AS workspaceId,
              candidate_tree_hash AS candidateTreeHash
         FROM candidate_changesets WHERE origin_child_task_id = ?`,
    )
    .get(originChildTaskId) as
    | { changesetId: string; workspaceId: string; candidateTreeHash: string | null }
    | undefined;
  return row ?? null;
}
