import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { incrementCorrectionSequence } from "./contract-state.js";

export type BarrierStatus = "active" | "narrowed" | "released";
export type BarrierHoldReason = "deterministic" | "owner_confirmed" | "conservative_hold";

export type DenyBarrier = {
  id: number;
  entityUuid: string;
  ownerId: string;
  correctionId: number;
  status: BarrierStatus;
  committedAt: string;
  scopeNote: string;
};

export type DenyBarrierMember = {
  id: number;
  barrierId: number;
  assertionId: number;
  heldFrom: string;
  heldTo: string | null;
  holdReason: BarrierHoldReason;
  authorizedByCorrectionId: number;
  closedByCorrectionId: number | null;
  membershipSeq: number;
};

export type CommitDenyBarrierInput = {
  ownerId: string;
  correctionId: number;
  members: Array<{ assertionId: number; holdReason: BarrierHoldReason }>;
  committedAt?: string;
  scopeNote?: string;
  inTransaction?: boolean;
};

export type CloseDenyBarrierMembersInput = {
  barrierId: number;
  assertionIds?: number[];
  closedByCorrectionId: number;
  closedAt: string;
  inTransaction?: boolean;
};

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? value as Row : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value);
}

function mapBarrier(value: unknown): DenyBarrier | null {
  const source = asRow(value);
  if (!source) return null;
  const status = stringValue(source.status);
  if (status !== "active" && status !== "narrowed" && status !== "released") return null;
  return {
    id: numberValue(source.id),
    entityUuid: stringValue(source.entity_uuid),
    ownerId: stringValue(source.owner_id),
    correctionId: numberValue(source.correction_id),
    status,
    committedAt: stringValue(source.committed_at),
    scopeNote: stringValue(source.scope_note),
  };
}

function mapMember(value: unknown): DenyBarrierMember | null {
  const source = asRow(value);
  if (!source) return null;
  const holdReason = stringValue(source.hold_reason);
  if (holdReason !== "deterministic" && holdReason !== "owner_confirmed" && holdReason !== "conservative_hold") return null;
  return {
    id: numberValue(source.id),
    barrierId: numberValue(source.barrier_id),
    assertionId: numberValue(source.assertion_id),
    heldFrom: stringValue(source.held_from),
    heldTo: typeof source.held_to === "string" ? source.held_to : null,
    holdReason,
    authorizedByCorrectionId: numberValue(source.authorized_by_correction_id),
    closedByCorrectionId: nullableNumber(source.closed_by_correction_id),
    membershipSeq: numberValue(source.membership_seq),
  };
}

function withTransaction<T>(
  db: DatabaseSync,
  inTransaction: boolean,
  callback: () => T,
): T {
  if (inTransaction) return callback();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* preserve the original barrier error */
    }
    throw error;
  }
}

export function getDenyBarrier(
  db: DatabaseSync,
  barrierId: number,
): DenyBarrier | null {
  return mapBarrier(db.prepare(
    "SELECT * FROM memory_deny_barriers WHERE id = ?",
  ).get(barrierId));
}

export function listDenyBarrierMembers(
  db: DatabaseSync,
  barrierId: number,
): DenyBarrierMember[] {
  return db.prepare(
    `SELECT * FROM memory_deny_barrier_members
     WHERE barrier_id = ? ORDER BY membership_seq ASC`,
  ).all(barrierId)
    .map(mapMember)
    .filter((member): member is DenyBarrierMember => member !== null);
}

export function listOpenDenyBarrierMembers(
  db: DatabaseSync,
  assertionId: number,
  at = new Date().toISOString(),
): DenyBarrierMember[] {
  return db.prepare(
    `SELECT m.*
     FROM memory_deny_barrier_members AS m
     JOIN memory_deny_barriers AS b ON b.id = m.barrier_id
     WHERE m.assertion_id = ?
       AND m.held_from <= ?
       AND (m.held_to IS NULL OR ? < m.held_to)
     ORDER BY m.membership_seq ASC`,
  ).all(assertionId, at, at)
    .map(mapMember)
    .filter((member): member is DenyBarrierMember => member !== null);
}

export function commitDenyBarrier(
  db: DatabaseSync,
  input: CommitDenyBarrierInput,
): { barrier: DenyBarrier; members: DenyBarrierMember[]; sequenceHigh: number } {
  if (input.members.length === 0) throw new Error("memory_barrier_target_required");
  const membersByAssertion = new Map<number, BarrierHoldReason>();
  for (const member of input.members) {
    if (membersByAssertion.has(member.assertionId)) {
      throw new Error("memory_barrier_duplicate_member");
    }
    membersByAssertion.set(member.assertionId, member.holdReason);
  }
  const barrierMembers = [...membersByAssertion.entries()].map(([assertionId, holdReason]) => ({
    assertionId,
    holdReason,
  }));
  const committedAt = input.committedAt ?? new Date().toISOString();
  return withTransaction(db, input.inTransaction === true, () => {
    const correction = asRow(db.prepare(
      `SELECT id, owner_id, barrier_id FROM memory_corrections WHERE id = ?`,
    ).get(input.correctionId));
    if (!correction || correction.owner_id !== input.ownerId) {
      throw new Error("memory_correction_owner_mismatch");
    }
    for (const member of barrierMembers) {
      const assertion = asRow(db.prepare(
        `SELECT id, owner_id FROM memory_assertions WHERE id = ?`,
      ).get(member.assertionId));
      if (!assertion) throw new Error(`memory_assertion_missing:${member.assertionId}`);
      if (assertion.owner_id !== input.ownerId) throw new Error("memory_assertion_owner_mismatch");
    }

    let barrier = correction.barrier_id == null
      ? null
      : getDenyBarrier(db, numberValue(correction.barrier_id));
    if (correction.barrier_id != null && !barrier) {
      throw new Error("memory_barrier_unavailable");
    }
    if (correction.barrier_id == null) {
      const result = db.prepare(
        `INSERT INTO memory_deny_barriers
           (entity_uuid, owner_id, correction_id, status, committed_at, scope_note)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      ).run(
        newEntityUuid(),
        input.ownerId,
        input.correctionId,
        committedAt,
        input.scopeNote ?? "",
      );
      const barrierId = Number(result.lastInsertRowid);
      db.prepare(
        "UPDATE memory_corrections SET barrier_id = ? WHERE id = ?",
      ).run(barrierId, input.correctionId);
      barrier = getDenyBarrier(db, barrierId);
    }
    if (!barrier) throw new Error("memory_barrier_unavailable");
    if (barrier.status === "released") throw new Error("memory_barrier_reopen_refused");

    const insertMember = db.prepare(
      `INSERT INTO memory_deny_barrier_members
         (barrier_id, assertion_id, held_from, held_to, hold_reason,
          authorized_by_correction_id, closed_by_correction_id, membership_seq)
       VALUES (?, ?, ?, NULL, ?, ?, NULL, ?)`,
    );
    for (const member of barrierMembers) {
      const open = db.prepare(
        `SELECT 1 AS found FROM memory_deny_barrier_members
         WHERE barrier_id = ? AND assertion_id = ? AND held_to IS NULL LIMIT 1`,
      ).get(barrier.id, member.assertionId);
      if (open) continue;
      const row = db.prepare(
        `SELECT COALESCE(MAX(membership_seq), 0) + 1 AS next_seq
         FROM memory_deny_barrier_members WHERE barrier_id = ?`,
      ).get(barrier.id) as { next_seq?: number };
      const sequence = numberValue(row.next_seq);
      insertMember.run(
        barrier.id,
        member.assertionId,
        committedAt,
        member.holdReason,
        input.correctionId,
        sequence,
      );
      incrementCorrectionSequence(db);
    }
    db.prepare(
      `UPDATE memory_deny_barriers SET status = 'active' WHERE id = ?`,
    ).run(barrier.id);
    db.prepare(
      `UPDATE memory_contract_state
       SET applied_c1_authority_exists = 1 WHERE id = 1`,
    ).run();
    const allMembers = listDenyBarrierMembers(db, barrier.id);
    const sequenceHigh = allMembers.reduce(
      (high, member) => Math.max(high, member.membershipSeq),
      0,
    );
    return {
      barrier: getDenyBarrier(db, barrier.id) ?? barrier,
      members: allMembers,
      sequenceHigh,
    };
  });
}

export function closeDenyBarrierMembers(
  db: DatabaseSync,
  input: CloseDenyBarrierMembersInput,
): DenyBarrierMember[] {
  return withTransaction(db, input.inTransaction === true, () => {
    const barrier = getDenyBarrier(db, input.barrierId);
    if (!barrier) throw new Error("memory_barrier_missing");
    const correction = asRow(db.prepare(
      `SELECT id, owner_id FROM memory_corrections WHERE id = ?`,
    ).get(input.closedByCorrectionId));
    if (!correction) throw new Error("memory_closing_correction_missing");
    if (correction.owner_id !== barrier.ownerId) throw new Error("memory_closing_correction_owner_mismatch");
    const ids = input.assertionIds == null
      ? null
      : [...new Set(input.assertionIds)];
    const openMembers = listDenyBarrierMembers(db, input.barrierId)
      .filter((member) =>
        member.heldTo === null && (ids === null || ids.includes(member.assertionId))
      );
    const close = db.prepare(
      `UPDATE memory_deny_barrier_members
       SET held_to = ?, closed_by_correction_id = ?
       WHERE id = ? AND held_to IS NULL`,
    );
    for (const member of openMembers) {
      close.run(input.closedAt, input.closedByCorrectionId, member.id);
      incrementCorrectionSequence(db);
    }
    const remaining = listDenyBarrierMembers(db, input.barrierId)
      .some((member) => member.heldTo === null);
    db.prepare(
      `UPDATE memory_deny_barriers SET status = ? WHERE id = ?`,
    ).run(remaining ? "narrowed" : "released", input.barrierId);
    return listDenyBarrierMembers(db, input.barrierId);
  });
}
