import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import {
  maxClassification,
  type DataClassification,
} from "../privacy/classification.js";
import type { C5Provenance, DocReminderStatus } from "./types.js";
import { relationshipProjectionDiagnostics } from "./projections.js";

function textHash(text: string): string {
  return createHash("sha256")
    .update(text.normalize("NFC").trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function upsertDocReminder(
  db: DatabaseSync,
  input: {
    ownerId: string;
    text: string;
    dueAt: string | null;
    sourceEntityType: string;
    sourceEntityUuid: string;
    classification: DataClassification;
    status?: DocReminderStatus;
    provenance?: C5Provenance;
    partySubjectScope?: string;
  },
): string {
  const text = input.text.trim().slice(0, 600);
  if (!text) throw new Error("relationship_text_required");
  const now = new Date().toISOString();
  const hash = textHash(text);
  const provenance = input.provenance ?? "shadow";
  const partySubjectScope = input.partySubjectScope?.trim().slice(0, 200) || "owner";
  const existing = db
    .prepare(
      `SELECT entity_uuid FROM doc_reminders
       WHERE owner_id = ? AND source_entity_uuid = ? AND text_hash = ?`,
    )
    .get(input.ownerId, input.sourceEntityUuid, hash) as
    | { entity_uuid?: string }
    | undefined;
  const entityUuid = existing?.entity_uuid ?? assignNewEntityUuid();
  db.prepare(
    `INSERT INTO doc_reminders
       (owner_id, entity_uuid, data_classification, text, status, due_at,
        source_entity_type, source_entity_uuid, text_hash, created_at, updated_at,
        provenance, party_subject_scope)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, source_entity_uuid, text_hash) DO UPDATE SET
       text = excluded.text,
       due_at = excluded.due_at,
       status = excluded.status,
       data_classification = excluded.data_classification,
       updated_at = excluded.updated_at,
       provenance = excluded.provenance,
       party_subject_scope = excluded.party_subject_scope`,
  ).run(
    input.ownerId,
    entityUuid,
    input.classification,
    text,
    input.status ?? "pending",
    input.dueAt,
    input.sourceEntityType,
    input.sourceEntityUuid,
    hash,
    now,
    now,
    provenance,
    partySubjectScope,
  );
  return entityUuid;
}

export function listDueDocReminders(
  db: DatabaseSync,
  ownerId: string,
  nowIso: string,
): Array<{ entityUuid: string; text: string; dueAt: string }> {
  return db
    .prepare(
      `SELECT entity_uuid, text, due_at FROM doc_reminders
       WHERE owner_id = ? AND status IN ('pending', 'due')
         AND due_at IS NOT NULL AND due_at <= ?
       ORDER BY due_at ASC LIMIT 20`,
    )
    .all(ownerId, nowIso)
    .flatMap((row) => {
      const item = row as Record<string, unknown>;
      const dueAt = String(item.due_at ?? "");
      const entityUuid = String(item.entity_uuid ?? "");
      if (!entityUuid || !dueAt) return [];
      return [{ entityUuid, text: String(item.text ?? ""), dueAt }];
    });
}

export function updateDocReminderStatus(
  db: DatabaseSync,
  entityUuid: string,
  status: DocReminderStatus,
): void {
  db.prepare(
    `UPDATE doc_reminders SET status = ?, updated_at = ? WHERE entity_uuid = ?`,
  ).run(status, new Date().toISOString(), entityUuid);
}

export function inheritClassification(
  current: DataClassification,
  evidence: DataClassification,
): DataClassification {
  return maxClassification(current, evidence);
}

export function listRelationshipSummary(
  db: DatabaseSync,
  ownerId: string,
  limit: number,
  offset: number,
): {
  docReminders: number;
  selfCommitments: number;
  mutualActive: number;
  mutualProposed: number;
  tensions: number;
  withdrawals: number;
  c5: ReturnType<typeof relationshipProjectionDiagnostics> & { warnings: string[] };
  items: Array<{ kind: string; status: string; text: string }>;
} {
  const safeLimit = Math.max(1, Math.min(25, limit));
  const safeOffset = Math.max(0, offset);
  const items: Array<{ kind: string; status: string; text: string }> = [];
  const push = (kind: string, rows: unknown[]) => {
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const classification = String(r.data_classification ?? "ordinary");
      if (classification === "secret" || classification === "never_public") {
        continue;
      }
      items.push({
        kind,
        status: String(r.status ?? ""),
        text: String(r.text ?? "").slice(0, 120),
      });
    }
  };
  push(
    "doc_reminder",
    db
      .prepare(
        `SELECT status, text, data_classification FROM doc_reminders
         WHERE owner_id = ? AND status NOT IN ('fulfilled', 'cancelled', 'forgotten')
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(ownerId, safeLimit, safeOffset),
  );
  const count = (table: string, where = "") =>
    Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM ${table} WHERE owner_id = ? ${where}`,
          )
          .get(ownerId) as { c?: number }
      ).c ?? 0,
    );
  const selfCommitmentCount = count("ashley_self_commitments", "AND status = 'active'");
  const tensionCount = count("relational_tensions", "AND status = 'open'");
  const c5Diagnostics = relationshipProjectionDiagnostics(db, ownerId);
  const warnings: string[] = [];
  if (c5Diagnostics.currentCount === 0) warnings.push("c5_current_shared_culture_not_computed");
  if (c5Diagnostics.historicalCount === 0) warnings.push("c5_no_historical_shared_culture_snapshot");
  if (selfCommitmentCount === 0) warnings.push("c5_no_self_commitments_recorded");
  if (tensionCount === 0) warnings.push("c5_no_relational_tensions_recorded");
  return {
    docReminders: count("doc_reminders", "AND status NOT IN ('fulfilled','cancelled')"),
    selfCommitments: selfCommitmentCount,
    mutualActive: count("mutual_commitments", "AND status = 'active'"),
    mutualProposed: count("mutual_commitments", "AND status = 'proposed'"),
    tensions: tensionCount,
    withdrawals: count("withdrawal_records", "AND status = 'active'"),
    c5: { ...c5Diagnostics, warnings },
    items: items.slice(0, safeLimit),
  };
}
