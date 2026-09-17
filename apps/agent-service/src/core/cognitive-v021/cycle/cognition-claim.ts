import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Durable per-conversation cognition claim (same sidecar store only).
 *
 * Production runs several Thought drivers against one sidecar: the inbox
 * consumer, the frontier coordinator (which dispatches Thought directly,
 * bypassing inbox leases), and HTTP idle ticks. Event leases exclude only
 * the claimed event, so without this claim two drivers could run Ashley
 * Thought for the same conversation concurrently. The claim makes the
 * second driver refuse with conversation_cognition_occupied before any
 * provider work, and the refused event retries naturally.
 *
 * Scope law: the claim serializes drivers sharing THIS sidecar store. An
 * independent checkout/database (e.g. a Windows dev copy) is a different
 * store and is NOT fenced by this claim; independent runtimes must remain
 * operationally excluded from the same live Discord identity. The Host
 * worker never claims and is never fenced: worker execution is not
 * cognition and runs concurrently by design.
 */

export const CONVERSATION_COGNITION_OCCUPIED = "conversation_cognition_occupied" as const;

/** Worst-case single-cycle hold: legs, observation rounds, and sync work. */
export const COGNITION_CLAIM_LEASE_MS = 600_000 as const;

export type CognitionClaimInput = {
  conversationId: string;
  eventId: string;
  wakeId?: string | null;
  cycleId?: string | null;
  generation?: number | null;
  nowMs?: number;
  leaseMs?: number;
};

export type CognitionClaimResult =
  | { ok: true; claimToken: string; leaseExpiresAtMs: number }
  | { ok: false; reason: typeof CONVERSATION_COGNITION_OCCUPIED };

export type CognitionClaimRecord = {
  conversationId: string;
  holderEventId: string;
  holderWakeId: string | null;
  cycleId: string | null;
  generation: number | null;
  claimToken: string;
  leaseExpiresAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type ActiveThoughtCompletionQueueInput = {
  conversationId: string;
  cycleId: string;
  generation: number;
  nowMs?: number;
};

function safeMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Atomically acquire the conversation claim. One statement: insert, or
 * take over an expired lease. A live lease held by another event refuses.
 * The same event re-entering while its own claim lives is also refused:
 * redelivery retries later rather than doubling Thought.
 */
export function claimConversationCognition(
  sidecar: DatabaseSync,
  input: CognitionClaimInput,
): CognitionClaimResult {
  const nowMs = input.nowMs ?? Date.now();
  const leaseMs = input.leaseMs ?? COGNITION_CLAIM_LEASE_MS;
  if (
    typeof input.conversationId !== "string"
    || input.conversationId.length === 0
    || typeof input.eventId !== "string"
    || input.eventId.length === 0
    || !safeMs(nowMs)
    || !Number.isSafeInteger(leaseMs)
    || leaseMs <= 0
  ) {
    return { ok: false, reason: CONVERSATION_COGNITION_OCCUPIED };
  }
  const claimToken = randomUUID();
  const leaseExpiresAtMs = nowMs + leaseMs;
  const generation = typeof input.generation === "number" && Number.isSafeInteger(input.generation)
    ? input.generation
    : null;
  const row = sidecar
    .prepare(
      `INSERT INTO cognition_claims
         (conversation_id, holder_event_id, holder_wake_id, cycle_id, generation,
          claim_token, lease_expires_at_ms, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         holder_event_id = excluded.holder_event_id,
         holder_wake_id = excluded.holder_wake_id,
         cycle_id = excluded.cycle_id,
         generation = excluded.generation,
         claim_token = excluded.claim_token,
         lease_expires_at_ms = excluded.lease_expires_at_ms,
         updated_at_ms = excluded.updated_at_ms
         WHERE cognition_claims.lease_expires_at_ms < excluded.created_at_ms
       RETURNING claim_token`,
    )
    .get(
      input.conversationId,
      input.eventId,
      input.wakeId ?? null,
      input.cycleId ?? null,
      generation,
      claimToken,
      leaseExpiresAtMs,
      nowMs,
      nowMs,
    ) as { claim_token?: unknown } | undefined;
  if (row?.claim_token === claimToken) {
    return { ok: true, claimToken, leaseExpiresAtMs };
  }
  return { ok: false, reason: CONVERSATION_COGNITION_OCCUPIED };
}

/**
 * Per-pass renewal: extends the lease only while this holder still owns it.
 * False means the holder was lost (expiry + takeover): the cycle must stop
 * dispatching provider work immediately.
 */
export function renewConversationCognition(
  sidecar: DatabaseSync,
  input: { conversationId: string; claimToken: string; nowMs?: number; leaseMs?: number },
): boolean {
  const nowMs = input.nowMs ?? Date.now();
  const leaseMs = input.leaseMs ?? COGNITION_CLAIM_LEASE_MS;
  if (
    typeof input.conversationId !== "string"
    || input.conversationId.length === 0
    || typeof input.claimToken !== "string"
    || input.claimToken.length === 0
    || !safeMs(nowMs)
    || !Number.isSafeInteger(leaseMs)
    || leaseMs <= 0
  ) {
    return false;
  }
  const updated = sidecar
    .prepare(
      `UPDATE cognition_claims
          SET lease_expires_at_ms = ?, updated_at_ms = ?
        WHERE conversation_id = ? AND claim_token = ?`,
    )
    .run(nowMs + leaseMs, nowMs, input.conversationId, input.claimToken);
  return Number(updated.changes) === 1;
}

/** Release only our own claim. A stale holder can never release a successor. */
export function releaseConversationCognition(
  sidecar: DatabaseSync,
  input: { conversationId: string; claimToken: string },
): void {
  if (
    typeof input.conversationId !== "string"
    || input.conversationId.length === 0
    || typeof input.claimToken !== "string"
    || input.claimToken.length === 0
  ) {
    return;
  }
  sidecar
    .prepare("DELETE FROM cognition_claims WHERE conversation_id = ? AND claim_token = ?")
    .run(input.conversationId, input.claimToken);
}

export function readConversationCognition(
  sidecar: DatabaseSync,
  conversationId: string,
): CognitionClaimRecord | null {
  if (typeof conversationId !== "string" || conversationId.length === 0) return null;
  const row = sidecar
    .prepare("SELECT * FROM cognition_claims WHERE conversation_id = ?")
    .get(conversationId) as Record<string, unknown> | undefined;
  if (!row || typeof row.claim_token !== "string") return null;
  return {
    conversationId: String(row.conversation_id),
    holderEventId: String(row.holder_event_id),
    holderWakeId: typeof row.holder_wake_id === "string" ? row.holder_wake_id : null,
    cycleId: typeof row.cycle_id === "string" ? row.cycle_id : null,
    generation: typeof row.generation === "number" && Number.isSafeInteger(row.generation)
      ? row.generation
      : null,
    claimToken: row.claim_token,
    leaseExpiresAtMs: Number(row.lease_expires_at_ms),
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** Live iff a row exists and its lease covers nowMs. */
export function isConversationCognitionHeld(
  sidecar: DatabaseSync,
  conversationId: string,
  nowMs = Date.now(),
): boolean {
  const row = readConversationCognition(sidecar, conversationId);
  return !!row && Number.isSafeInteger(row.leaseExpiresAtMs) && row.leaseExpiresAtMs > nowMs;
}

/**
 * Prove the narrow Model-2 exception: a live Thought may finish after a
 * detached operation completion has admitted a newer queued wake. This does
 * not make the older Thought current in general. It requires the same-store
 * cognition claim to still name the older cycle and the newer cycle to be a
 * nonterminal detached completion. Any Owner successor, missing claim, lease
 * expiry, or malformed evidence returns false.
 */
export function activeThoughtMayFinishWhileDetachedCompletionQueued(
  sidecar: DatabaseSync,
  input: ActiveThoughtCompletionQueueInput,
): boolean {
  const nowMs = input.nowMs ?? Date.now();
  if (
    typeof input.conversationId !== "string"
    || input.conversationId.length === 0
    || typeof input.cycleId !== "string"
    || input.cycleId.length === 0
    || !Number.isSafeInteger(input.generation)
    || input.generation < 0
    || !safeMs(nowMs)
  ) {
    return false;
  }

  const claim = readConversationCognition(sidecar, input.conversationId);
  if (
    !claim
    || claim.cycleId !== input.cycleId
    || claim.leaseExpiresAtMs <= nowMs
  ) {
    return false;
  }

  const current = sidecar.prepare(
    `SELECT cycle_id, generation, trigger_kind, wake_id
       FROM cycle_records
      WHERE conversation_id = ?
      ORDER BY generation DESC, updated_at_ms DESC
      LIMIT 1`,
  ).get(input.conversationId) as {
    cycle_id?: unknown;
    generation?: unknown;
    trigger_kind?: unknown;
    wake_id?: unknown;
  } | undefined;
  const currentCycleId = typeof current?.cycle_id === "string" ? current.cycle_id : "";
  const currentGeneration = typeof current?.generation === "number"
    ? current.generation
    : Number(current?.generation);
  const wakeId = typeof current?.wake_id === "string" ? current.wake_id : "";
  if (
    !currentCycleId
    || !Number.isSafeInteger(currentGeneration)
    || currentGeneration <= input.generation
    || currentCycleId === input.cycleId
    || current?.trigger_kind !== "observation_or_receipt"
    || !wakeId
  ) {
    return false;
  }

  const completion = sidecar.prepare(
    `SELECT 1
       FROM inbox_events
      WHERE wake_id = ?
        AND kind = 'observation_or_receipt'
        AND state NOT IN ('terminal', 'quarantined')
        AND TRIM(COALESCE(json_extract(payload_json, '$.detachedOperationId'), '')) <> ''
      LIMIT 1`,
  ).get(wakeId);
  return Boolean(completion);
}
