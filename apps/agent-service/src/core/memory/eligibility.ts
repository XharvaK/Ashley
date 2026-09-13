import type { DatabaseSync } from "node:sqlite";
import {
  getAssertion,
  listAssertions,
  type MemoryAssertion,
} from "./assertions.js";
import { getMemoryContractState } from "./contract-state.js";

type ContradictionRow = {
  kind?: string;
  status?: string;
  left_assertion_id?: number;
  right_assertion_id?: number;
};

function hasCoveringBarrier(
  db: DatabaseSync,
  assertionId: number,
  at: string,
): boolean | null {
  try {
    const row = db.prepare(
      `SELECT 1 AS found
       FROM memory_deny_barrier_members
       WHERE assertion_id = ?
         AND held_from <= ?
         AND (held_to IS NULL OR ? < held_to)
       LIMIT 1`,
    ).get(assertionId, at, at);
    return row != null;
  } catch {
    return null;
  }
}

function contradictionBlocks(
  db: DatabaseSync,
  assertion: MemoryAssertion,
): boolean | null {
  let rows: ContradictionRow[];
  try {
    rows = db.prepare(
      `SELECT kind, status, left_assertion_id, right_assertion_id
       FROM memory_contradictions
       WHERE status = 'open'
         AND (left_assertion_id = ? OR right_assertion_id = ?)`,
    ).all(assertion.id, assertion.id) as ContradictionRow[];
  } catch {
    return null;
  }
  for (const contradiction of rows) {
    if (contradiction.kind === "temporal_nonoverlap") continue;
    if (contradiction.kind === "peer_derived" || contradiction.kind === "external_sources") {
      return true;
    }
    const otherId = contradiction.left_assertion_id === assertion.id
      ? contradiction.right_assertion_id
      : contradiction.left_assertion_id;
    const other = typeof otherId === "number" ? getAssertion(db, otherId) : null;
    if (!other) return true;
    if (
      contradiction.kind === "owner_self_vs_derived" &&
      assertion.derivationKind === "derived" &&
      other.subjectFacet === "owner_model"
    ) return true;
    if (
      contradiction.kind === "owner_vs_external" &&
      assertion.subjectFacet === "external_verifiable"
    ) return true;
  }
  return false;
}

/** Currentness used by the compatibility projection; influence predicates are separate. */
export function assertionCurrentAt(
  assertion: MemoryAssertion,
  at: string,
): boolean {
  if (assertion.terminationReason !== null) return false;
  const effectiveFrom = assertion.authorityFrom ?? (
    assertion.authorityBasis === "legacy_current" ||
    assertion.authorityBasis === "legacy_supersession"
      ? assertion.recordedAt
      : null
  );
  if (effectiveFrom === null || at < effectiveFrom) return false;
  return assertion.authorityTo === null || at < assertion.authorityTo;
}

/** Return true only when all C1 assertions-policy predicates are proven. */
export function influenceEligibleUnderAssertionsAt(
  db: DatabaseSync,
  assertionId: number,
  at = new Date().toISOString(),
): boolean {
  const assertion = getAssertion(db, assertionId);
  if (!assertion) return false;
  if (assertion.terminationReason !== null) return false;
  if (assertion.subjectFacet === "unknown") return false;
  if (assertion.influenceClass === "I0") return false;
  if (!assertionCurrentAt(assertion, at)) return false;
  const barrier = hasCoveringBarrier(db, assertionId, at);
  if (barrier !== false) return false;
  const contradiction = contradictionBlocks(db, assertion);
  if (contradiction !== false) return false;
  return true;
}

/** Live compatibility wrapper; the historical result is unchanged. */
export function influenceEligibleAt(
  db: DatabaseSync,
  assertionId: number,
  at = new Date().toISOString(),
): boolean {
  return influenceEligibleUnderAssertionsAt(db, assertionId, at);
}

export function listEligibleAssertions(
  db: DatabaseSync,
  ownerId: string,
  at = new Date().toISOString(),
): MemoryAssertion[] {
  return listAssertions(db, ownerId)
    .filter((assertion) => influenceEligibleAt(db, assertion.id, at));
}

/** Retrieval is intentionally broader than current influence eligibility. */
export function listRetrievableAssertions(
  db: DatabaseSync,
  ownerId: string,
): MemoryAssertion[] {
  return listAssertions(db, ownerId);
}

/**
 * Return whether a consumer source is covered by an open C1 deny barrier.
 * A read failure is itself a barrier for influence purposes.
 */
export function sourceCoveredByDenyBarrier(
  db: DatabaseSync,
  sourceType: string,
  sourceId: string | number,
  at = new Date().toISOString(),
): boolean {
  if (getMemoryContractState(db)?.currentnessAuthority !== "memory_assertions") {
    return false;
  }
  return sourceCoveredByDenyBarrierUnderAssertions(db, sourceType, sourceId, at);
}

/**
 * Evaluate the assertions deny barrier without consulting the currentness
 * marker. This is the pre-cutover policy seam used by C1 shadow evaluation.
 */
export function sourceCoveredByDenyBarrierUnderAssertions(
  db: DatabaseSync,
  sourceType: string,
  sourceId: string | number,
  at = new Date().toISOString(),
): boolean {
  try {
    if (sourceType === "fact" || sourceType === "mem_fact") {
      return db.prepare(
        `SELECT 1
         FROM memory_assertions AS a
         JOIN memory_deny_barrier_members AS m ON m.assertion_id = a.id
         WHERE a.legacy_fact_id = ?
           AND m.held_from <= ?
           AND (m.held_to IS NULL OR ? < m.held_to)
         LIMIT 1`,
      ).get(Number(sourceId), at, at) !== undefined;
    }
    if (sourceType === "episode") {
      return db.prepare(
        `SELECT 1
         FROM memory_episode_claims AS c
         JOIN memory_deny_barrier_members AS m ON m.assertion_id = c.assertion_id
         WHERE c.episode_id = ?
           AND m.held_from <= ?
           AND (m.held_to IS NULL OR ? < m.held_to)
         LIMIT 1`,
      ).get(Number(sourceId), at, at) !== undefined;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Re-check source messages immediately before a consolidator writes derived
 * records. A barrier may have been committed while the model was analyzing.
 */
export function messagesCoveredByDenyBarrier(
  db: DatabaseSync,
  ownerId: string,
  messageIds: number[],
  at = new Date().toISOString(),
): boolean {
  const ids = [...new Set(messageIds)].filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (ids.length === 0) return false;
  if (getMemoryContractState(db)?.currentnessAuthority !== "memory_assertions") {
    return false;
  }
  const marks = ids.map(() => "?").join(", ");
  try {
    return db.prepare(
      `SELECT 1
       FROM memory_deny_barrier_members AS m
       JOIN memory_assertions AS a ON a.id = m.assertion_id
       WHERE a.owner_id = ?
         AND m.held_from <= ?
         AND (m.held_to IS NULL OR ? < m.held_to)
         AND (
           a.source_message_id IN (${marks})
           OR EXISTS (
             SELECT 1
             FROM memory_episode_claims AS c
             JOIN episode_messages AS em ON em.episode_id = c.episode_id
             WHERE c.assertion_id = a.id AND em.message_id IN (${marks})
           )
         )
       LIMIT 1`,
    ).get(ownerId, at, at, ...ids, ...ids) !== undefined;
  } catch {
    return true;
  }
}

/**
 * An episode may remain inspectable after cutover, but its full summary is
 * never a current Thought source. It is eligible only when at least one
 * claim projection is independently eligible at the requested instant.
 */
export function episodeInfluenceEligibleAt(
  db: DatabaseSync,
  ownerId: string,
  episodeId: number,
  at = new Date().toISOString(),
): boolean {
  if (getMemoryContractState(db)?.currentnessAuthority !== "memory_assertions") {
    return true;
  }
  return episodeInfluenceEligibleUnderAssertionsAt(db, ownerId, episodeId, at);
}

export function episodeInfluenceEligibleUnderAssertionsAt(
  db: DatabaseSync,
  ownerId: string,
  episodeId: number,
  at = new Date().toISOString(),
): boolean {
  try {
    const episode = db.prepare(
      `SELECT 1 FROM episodes
       WHERE id = ? AND owner_id = ? AND status = 'active'
         AND provenance = 'live' LIMIT 1`,
    ).get(episodeId, ownerId);
    if (episode === undefined) return false;
    const claims = db.prepare(
      `SELECT assertion_id FROM memory_episode_claims
       WHERE episode_id = ?`,
    ).all(episodeId) as Array<{ assertion_id?: number }>;
    return claims.some((claim) =>
      claim.assertion_id != null && influenceEligibleUnderAssertionsAt(db, Number(claim.assertion_id), at),
    );
  } catch {
    return false;
  }
}

/** Mind State remains consumer-owned; C1 only denies a barrier-covered source. */
export function mindStateInfluenceEligibleAt(
  db: DatabaseSync,
  sourceType: string,
  sourceId: string | number,
  at = new Date().toISOString(),
): boolean {
  if (getMemoryContractState(db)?.currentnessAuthority !== "memory_assertions") {
    return true;
  }
  return mindStateInfluenceEligibleUnderAssertionsAt(db, sourceType, sourceId, at);
}

function mindStateInfluenceEligibleUnderAssertionsAt(
  db: DatabaseSync,
  sourceType: string,
  sourceId: string | number,
  at: string,
): boolean {
  return !sourceCoveredByDenyBarrierUnderAssertions(db, sourceType, sourceId, at);
}

export function mindStateItemInfluenceEligibleAt(
  db: DatabaseSync,
  ownerId: string,
  itemId: number,
  at = new Date().toISOString(),
): boolean {
  if (getMemoryContractState(db)?.currentnessAuthority !== "memory_assertions") {
    return true;
  }
  return mindStateItemInfluenceEligibleUnderAssertionsAt(db, ownerId, itemId, at);
}

export function mindStateItemInfluenceEligibleUnderAssertionsAt(
  db: DatabaseSync,
  ownerId: string,
  itemId: number,
  at = new Date().toISOString(),
): boolean {
  try {
    const item = db.prepare(
      `SELECT source_type, source_id FROM mind_state_items
       WHERE id = ? AND owner_id = ? AND status = 'active' LIMIT 1`,
    ).get(itemId, ownerId) as {
      source_type?: string;
      source_id?: string;
    } | undefined;
    if (!item || !item.source_type || item.source_id == null) return false;
    return mindStateInfluenceEligibleUnderAssertionsAt(db, item.source_type, item.source_id, at);
  } catch {
    return false;
  }
}
