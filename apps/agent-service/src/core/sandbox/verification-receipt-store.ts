import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";

export type VerificationReceiptRow = {
  taskId: string;
  workspaceId: string;
  recipeId: string;
  recipeVersion: string | null;
  snapshotId: string | null;
  candidateTreeHash: string | null;
  baseTreeHash: string | null;
  outcome: string;
  settledAt: string;
  factsJson: string;
};

export function persistVerificationReceipt(
  db: DatabaseSync,
  input: {
    ownerId: string;
    taskId: string;
    workspaceId: string;
    recipeId: string;
    recipeVersion?: string | null;
    snapshotId?: string | null;
    candidateTreeHash?: string | null;
    baseTreeHash?: string | null;
    outcome: string;
    facts?: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO verification_receipts (
       entity_uuid, data_classification, owner_id, task_id, workspace_id, recipe_id,
       recipe_version, snapshot_id, candidate_tree_hash, base_tree_hash, outcome,
       settled_at, facts_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newEntityUuid(),
    defaultUnclassifiedConversational(),
    input.ownerId,
    input.taskId,
    input.workspaceId,
    input.recipeId,
    input.recipeVersion ?? null,
    input.snapshotId ?? null,
    input.candidateTreeHash ?? null,
    input.baseTreeHash ?? null,
    input.outcome,
    new Date().toISOString(),
    JSON.stringify(input.facts ?? {}),
  );
}

export function getVerificationReceiptByTaskId(
  db: DatabaseSync,
  taskId: string,
): VerificationReceiptRow | null {
  const row = db
    .prepare(
      `SELECT task_id AS taskId, workspace_id AS workspaceId, recipe_id AS recipeId,
              recipe_version AS recipeVersion, snapshot_id AS snapshotId,
              candidate_tree_hash AS candidateTreeHash, base_tree_hash AS baseTreeHash,
              outcome, settled_at AS settledAt, facts_json AS factsJson
         FROM verification_receipts WHERE task_id = ?`,
    )
    .get(taskId) as VerificationReceiptRow | undefined;
  return row ?? null;
}

export function getSuccessfulVerificationReceiptForCandidate(
  db: DatabaseSync,
  input: { ownerId: string; workspaceId: string; candidateTreeHash: string },
): VerificationReceiptRow | null {
  const rows = db
    .prepare(
      `SELECT task_id AS taskId, workspace_id AS workspaceId, recipe_id AS recipeId,
              recipe_version AS recipeVersion, snapshot_id AS snapshotId,
              candidate_tree_hash AS candidateTreeHash, base_tree_hash AS baseTreeHash,
              outcome, settled_at AS settledAt, facts_json AS factsJson
         FROM verification_receipts
        WHERE owner_id = ? AND workspace_id = ? AND candidate_tree_hash = ?
        ORDER BY id DESC`,
    )
    .all(input.ownerId, input.workspaceId, input.candidateTreeHash) as VerificationReceiptRow[];

  for (const row of rows) {
    if (row.outcome !== "succeeded") continue;
    try {
      const facts = JSON.parse(row.factsJson) as { verificationOutcome?: unknown };
      if (facts.verificationOutcome === "verified_success") return row;
    } catch {
      // An unreadable facts payload cannot witness a successful candidate.
    }
  }
  return null;
}
