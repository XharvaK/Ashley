import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import type { ClaimState } from "./types.js";

const MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60_000;

export function tryClaimRelationshipMotivation(
  db: DatabaseSync,
  input: {
    ownerId: string;
    relationshipEntityType: string;
    relationshipEntityUuid: string;
    motivationId: number;
  },
): boolean {
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const active = db
      .prepare(
        `SELECT entity_uuid, lease_until FROM relationship_motivation_claims
         WHERE owner_id = ? AND relationship_entity_uuid = ?
           AND claim_state = 'claimed'`,
      )
      .get(input.ownerId, input.relationshipEntityUuid) as
      | { entity_uuid?: string; lease_until?: string }
      | undefined;
    if (active?.entity_uuid) {
      if (active.lease_until && active.lease_until > nowIso) {
        db.exec("COMMIT");
        return false;
      }
      db.prepare(
        `UPDATE relationship_motivation_claims
         SET claim_state = 'released', updated_at = ?
         WHERE entity_uuid = ?`,
      ).run(nowIso, active.entity_uuid);
    }
    const entityUuid = assignNewEntityUuid();
    db.prepare(
      `INSERT INTO relationship_motivation_claims
         (owner_id, entity_uuid, relationship_entity_type, relationship_entity_uuid,
          motivation_id, claim_state, lease_until, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'claimed', ?, 0, ?, ?)`,
    ).run(
      input.ownerId,
      entityUuid,
      input.relationshipEntityType,
      input.relationshipEntityUuid,
      input.motivationId,
      leaseUntil,
      nowIso,
      nowIso,
    );
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markClaimOutcome(
  db: DatabaseSync,
  relationshipEntityUuid: string,
  state: ClaimState,
  errorCode?: string,
): void {
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT attempt_count FROM relationship_motivation_claims
       WHERE relationship_entity_uuid = ? AND claim_state = 'claimed'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(relationshipEntityUuid) as { attempt_count?: number } | undefined;
  const attempts = Number(row?.attempt_count ?? 0);
  db.prepare(
    `UPDATE relationship_motivation_claims
     SET claim_state = ?, attempt_count = ?, last_error_code = ?, updated_at = ?
     WHERE relationship_entity_uuid = ? AND claim_state = 'claimed'`,
  ).run(
    state,
    state === "aborted" ? attempts + 1 : attempts,
    errorCode ?? null,
    now,
    relationshipEntityUuid,
  );
}

export function incrementClaimAttempt(
  db: DatabaseSync,
  relationshipEntityUuid: string,
  errorCode?: string,
): number {
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT attempt_count FROM relationship_motivation_claims
       WHERE relationship_entity_uuid = ? AND claim_state = 'claimed'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(relationshipEntityUuid) as { attempt_count?: number } | undefined;
  const attempts = Number(row?.attempt_count ?? 0) + 1;
  db.prepare(
    `UPDATE relationship_motivation_claims
     SET attempt_count = ?, last_error_code = ?, updated_at = ?
     WHERE relationship_entity_uuid = ? AND claim_state = 'claimed'`,
  ).run(attempts, errorCode ?? null, now, relationshipEntityUuid);
  return attempts;
}

export function canRetryClaim(relationshipEntityUuid: string, attempts: number): boolean {
  return attempts < MAX_ATTEMPTS;
}

export { MAX_ATTEMPTS as RELATIONSHIP_CLAIM_MAX_ATTEMPTS };
