import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { sha256 } from "../../model-fabric/hash.js";
import { detectCredentialShape } from "../../privacy/secrets.js";
import { releaseConversationCognition } from "../cycle/cognition-claim.js";
import { getInFlightByEffectId, getEffectReceipt } from "./in-flight.js";
import { recordEffectDiagnostic, updateEffectDiagnosticContinuation } from "./diagnostics.js";
import { MAX_EFFECT_ROUNDS, type EffectContinuationRecord, type EffectContinuationState, type EffectProposal } from "../types.js";

export const EFFECT_CONTINUATION_LEASE_MS = 360_000 as const;
export const EFFECT_CONTINUATION_PUBLICATION_MARGIN_MS = 5_000 as const;

/** Unique to one agent-service process. A new process never resumes a started worker. */
export const EFFECT_CONTINUATION_RUNTIME_ID = randomUUID();

type DbRow = Record<string, unknown>;

export type AcceptedEffectContinuation = Readonly<{
  continuation: EffectContinuationRecord;
  diagnosticId: string;
}>;

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || detectCredentialShape(trimmed).hit) return null;
  return trimmed.slice(0, maxLength);
}

function targetFor(request: unknown): Readonly<Record<string, string>> {
  if (typeof request !== "object" || request === null || Array.isArray(request)) return {};
  const value = request as Record<string, unknown>;
  const target: Record<string, string> = {};
  for (const key of ["projectId", "workspaceId"] as const) {
    const safe = safeText(value[key], 256);
    if (safe) target[key] = safe;
  }
  return Object.freeze(target);
}

function parseTarget(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "string") return Object.freeze({});
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return Object.freeze({});
    const target: Record<string, string> = {};
    for (const key of ["projectId", "workspaceId"] as const) {
      const item = (parsed as Record<string, unknown>)[key];
      if (typeof item === "string" && item.length > 0 && item.length <= 256) target[key] = item;
    }
    return Object.freeze(target);
  } catch {
    return Object.freeze({});
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function stateValue(value: unknown): EffectContinuationState | null {
  return value === "running" || value === "succeeded" || value === "failed"
    || value === "outcome_unknown" || value === "cancelled"
    ? value
    : null;
}

function mapContinuation(value: unknown): EffectContinuationRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as DbRow;
  const effectId = stringValue(row.effect_id);
  const conversationId = stringValue(row.conversation_id);
  const cycleId = stringValue(row.cycle_id);
  const generation = numberValue(row.generation);
  const deadlineAtMs = numberValue(row.deadline_at_ms);
  const remainingEffectRounds = numberValue(row.remaining_effect_rounds);
  const runtimeId = stringValue(row.runtime_id);
  const leaseToken = stringValue(row.lease_token);
  const leaseExpiresAtMs = numberValue(row.lease_expires_at_ms);
  const state = stateValue(row.state);
  const startedAtMs = numberValue(row.started_at_ms);
  const updatedAtMs = numberValue(row.updated_at_ms);
  const purpose = typeof row.purpose === "string" ? row.purpose : "";
  if (!effectId || !conversationId || !cycleId || generation === null || deadlineAtMs === null
    || remainingEffectRounds === null || !runtimeId || !leaseToken || leaseExpiresAtMs === null
    || !state || startedAtMs === null || updatedAtMs === null) return null;
  return {
    effectId,
    conversationId,
    cycleId,
    generation,
    deadlineAtMs,
    remainingEffectRounds,
    purpose,
    target: parseTarget(row.target_json),
    runtimeId,
    leaseToken,
    leaseExpiresAtMs,
    state,
    terminalClass: stringValue(row.terminal_class),
    effectTruth: stringValue(row.effect_truth),
    diagnosticRef: stringValue(row.diagnostic_ref),
    completionEventRef: stringValue(row.completion_event_ref),
    startedAtMs,
    updatedAtMs,
  };
}

export function getEffectContinuation(
  db: DatabaseSync,
  effectId: string,
): EffectContinuationRecord | null {
  if (!effectId.trim()) return null;
  return mapContinuation(db.prepare(
    "SELECT * FROM effect_continuations WHERE effect_id = ? LIMIT 1",
  ).get(effectId));
}

export function listRunningEffectContinuations(db: DatabaseSync, limit = 50): EffectContinuationRecord[] {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  return db.prepare(
    `SELECT * FROM effect_continuations
      WHERE state = 'running'
      ORDER BY started_at_ms ASC, effect_id ASC LIMIT ?`,
  ).all(bounded).map(mapContinuation).filter((row): row is EffectContinuationRecord => row !== null);
}

function rollback(db: DatabaseSync): void {
  try { db.exec("ROLLBACK"); } catch { /* preserve the primary failure */ }
}

/** Transfer a durably admitted develop effect from the cognition claim to its own bounded lease. */
export function acceptEffectContinuation(
  db: DatabaseSync,
  input: {
    proposal: EffectProposal;
    conversationId: string;
    deadlineAtMs: number;
    remainingEffectRounds: number;
    cognitionClaimToken: string;
    runtimeId: string;
    nowMs: number;
    leaseMs?: number;
  },
): AcceptedEffectContinuation {
  const proposal = input.proposal;
  const leaseMs = input.leaseMs ?? EFFECT_CONTINUATION_LEASE_MS;
  if (proposal.kind !== "candidate.develop"
    || !proposal.effectId.trim()
    || !input.conversationId.trim()
    || !input.cognitionClaimToken.trim()
    || !input.runtimeId.trim()
    || !Number.isSafeInteger(input.deadlineAtMs)
    || input.deadlineAtMs <= input.nowMs
    || !Number.isSafeInteger(input.remainingEffectRounds)
    || input.remainingEffectRounds < 0
    || input.remainingEffectRounds > MAX_EFFECT_ROUNDS
    || !Number.isSafeInteger(input.nowMs)
    || input.nowMs < 0
    || !Number.isSafeInteger(leaseMs)
    || leaseMs < 1) {
    throw new Error("effect_continuation_input_invalid");
  }
  const inFlight = getInFlightByEffectId(db, proposal.effectId);
  if (!inFlight || inFlight.status !== "in_flight" || inFlight.operationKind !== "candidate.develop"
    || inFlight.cycleId !== proposal.cycleId || inFlight.generation !== proposal.generation
    || !inFlight.audienceScope) {
    throw new Error("effect_continuation_effect_not_durably_admitted");
  }
  const cycle = db.prepare("SELECT conversation_id FROM cycle_records WHERE cycle_id = ? LIMIT 1")
    .get(proposal.cycleId) as DbRow | undefined;
  if (cycle?.conversation_id !== input.conversationId) throw new Error("effect_continuation_conversation_conflict");
  const purpose = safeText(proposal.purpose, 280) ?? "Purpose unavailable";
  const target = targetFor(proposal.request);
  const leaseToken = randomUUID();
  const leaseExpiresAtMs = Math.min(input.nowMs + leaseMs, input.deadlineAtMs + EFFECT_CONTINUATION_PUBLICATION_MARGIN_MS);
  if (!Number.isSafeInteger(leaseExpiresAtMs) || leaseExpiresAtMs <= input.nowMs) {
    throw new Error("effect_continuation_lease_invalid");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    if (getEffectReceipt(db, proposal.effectId)) throw new Error("effect_continuation_receipt_already_exists");
    if (getEffectContinuation(db, proposal.effectId)) throw new Error("effect_continuation_already_exists");
    const claim = db.prepare(
      `SELECT 1 FROM cognition_claims
        WHERE conversation_id = ? AND claim_token = ? AND cycle_id = ? AND generation = ?
          AND lease_expires_at_ms > ? LIMIT 1`,
    ).get(input.conversationId, input.cognitionClaimToken, proposal.cycleId, proposal.generation, input.nowMs);
    if (!claim) throw new Error("effect_continuation_cognition_claim_lost");

    const diagnostic = recordEffectDiagnostic(db, {
      effectId: proposal.effectId,
      conversationId: input.conversationId,
      cycleId: proposal.cycleId,
      generation: proposal.generation,
      audienceScope: inFlight.audienceScope,
      dataClassification: "never_public",
      secretOmitted: true,
      diagnostic: {
        completionBindingId: proposal.effectId,
        continuation: {
          state: "running",
          deadlineAtMs: input.deadlineAtMs,
          remainingEffectRounds: input.remainingEffectRounds,
          purpose,
          target,
          terminalClass: null,
          effectTruth: "in_progress",
        },
      },
      atMs: input.nowMs,
    });
    db.prepare(
      `INSERT INTO effect_continuations
         (effect_id, conversation_id, cycle_id, generation, deadline_at_ms,
          remaining_effect_rounds, purpose, target_json, runtime_id, lease_token,
          lease_expires_at_ms, state, terminal_class, effect_truth, diagnostic_ref,
          completion_event_ref, started_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, 'in_progress', ?, NULL, ?, ?)`,
    ).run(
      proposal.effectId,
      input.conversationId,
      proposal.cycleId,
      proposal.generation,
      input.deadlineAtMs,
      input.remainingEffectRounds,
      purpose,
      JSON.stringify(target),
      input.runtimeId,
      leaseToken,
      leaseExpiresAtMs,
      diagnostic.diagnosticId,
      input.nowMs,
      input.nowMs,
    );
    const released = releaseConversationCognition(db, {
      conversationId: input.conversationId,
      claimToken: input.cognitionClaimToken,
    });
    if (!released) throw new Error("effect_continuation_cognition_release_failed");
    const continuation = getEffectContinuation(db, proposal.effectId);
    if (!continuation) throw new Error("effect_continuation_persist_failed");
    db.exec("COMMIT");
    return { continuation, diagnosticId: diagnostic.diagnosticId };
  } catch (error) {
    rollback(db);
    throw error;
  }
}

export function renewEffectContinuationLease(
  db: DatabaseSync,
  input: { effectId: string; leaseToken: string; nowMs: number; leaseMs?: number },
): boolean {
  const leaseMs = input.leaseMs ?? EFFECT_CONTINUATION_LEASE_MS;
  if (!input.effectId.trim() || !input.leaseToken.trim() || !Number.isSafeInteger(input.nowMs)
    || input.nowMs < 0 || !Number.isSafeInteger(leaseMs) || leaseMs < 1) return false;
  const row = getEffectContinuation(db, input.effectId);
  if (!row || row.state !== "running" || row.leaseToken !== input.leaseToken
    || input.nowMs >= row.deadlineAtMs + EFFECT_CONTINUATION_PUBLICATION_MARGIN_MS
    || row.leaseExpiresAtMs <= input.nowMs) return false;
  const expiresAtMs = Math.min(input.nowMs + leaseMs, row.deadlineAtMs + EFFECT_CONTINUATION_PUBLICATION_MARGIN_MS);
  const changed = db.prepare(
    `UPDATE effect_continuations
        SET lease_expires_at_ms = ?, updated_at_ms = ?
      WHERE effect_id = ? AND state = 'running' AND lease_token = ?
        AND lease_expires_at_ms > ? AND deadline_at_ms = ?`,
  ).run(expiresAtMs, input.nowMs, input.effectId, input.leaseToken, input.nowMs, row.deadlineAtMs);
  return Number(changed.changes) === 1;
}

export function isEffectContinuationCurrent(
  db: DatabaseSync,
  input: { effectId: string; leaseToken: string; nowMs: number },
): boolean {
  const row = getEffectContinuation(db, input.effectId);
  return Boolean(row && row.state === "running" && row.leaseToken === input.leaseToken
    && row.leaseExpiresAtMs > input.nowMs && row.deadlineAtMs > input.nowMs
    && !getEffectReceipt(db, input.effectId));
}

export function finishEffectContinuation(
  db: DatabaseSync,
  input: {
    effectId: string;
    leaseToken: string;
    state: Exclude<EffectContinuationState, "running">;
    terminalClass: string;
    effectTruth: string;
    nowMs: number;
  },
): boolean {
  if (!input.effectId.trim() || !input.leaseToken.trim() || !input.terminalClass.trim()
    || !input.effectTruth.trim() || !Number.isSafeInteger(input.nowMs) || input.nowMs < 0) return false;
  const changed = db.prepare(
    `UPDATE effect_continuations
        SET state = ?, terminal_class = ?, effect_truth = ?, lease_expires_at_ms = ?, updated_at_ms = ?
      WHERE effect_id = ? AND state = 'running' AND lease_token = ?`,
  ).run(input.state, input.terminalClass.slice(0, 80), input.effectTruth.slice(0, 80), input.nowMs,
    input.nowMs, input.effectId, input.leaseToken);
  if (Number(changed.changes) !== 1) return false;
  updateEffectDiagnosticContinuation(db, input.effectId, {
    state: input.state,
    terminalClass: input.terminalClass,
    effectTruth: input.effectTruth,
  });
  return true;
}

export function effectContinuationBindingHash(record: EffectContinuationRecord): string {
  return sha256({
    effectId: record.effectId,
    conversationId: record.conversationId,
    cycleId: record.cycleId,
    generation: record.generation,
    deadlineAtMs: record.deadlineAtMs,
    remainingEffectRounds: record.remainingEffectRounds,
    purpose: record.purpose,
    target: record.target,
    diagnosticRef: record.diagnosticRef,
  });
}

export function recordEffectContinuationCompletion(
  db: DatabaseSync,
  effectId: string,
  eventId: string,
  nowMs: number,
): boolean {
  if (!effectId.trim() || !eventId.trim() || !Number.isSafeInteger(nowMs) || nowMs < 0) return false;
  const result = db.prepare(
    `UPDATE effect_continuations SET completion_event_ref = COALESCE(completion_event_ref, ?), updated_at_ms = ?
      WHERE effect_id = ? AND state <> 'running'`,
  ).run(eventId, nowMs, effectId);
  return Number(result.changes) === 1;
}

/** Terminalize a lost process or expired worker without dispatching it again. */
export function abandonEffectContinuation(
  db: DatabaseSync,
  input: {
    effectId: string;
    nowMs: number;
    terminalClass: string;
    effectTruth: string;
    state?: Exclude<EffectContinuationState, "running">;
  },
): EffectContinuationRecord | null {
  if (!input.effectId.trim() || !Number.isSafeInteger(input.nowMs) || input.nowMs < 0) return null;
  const state = input.state ?? "outcome_unknown";
  db.prepare(
    `UPDATE effect_continuations
        SET state = ?, terminal_class = ?, effect_truth = ?, lease_expires_at_ms = ?, updated_at_ms = ?
      WHERE effect_id = ? AND state = 'running'`,
  ).run(state, input.terminalClass.slice(0, 80), input.effectTruth.slice(0, 80), input.nowMs, input.nowMs, input.effectId);
  const row = getEffectContinuation(db, input.effectId);
  if (row?.state === state) {
    updateEffectDiagnosticContinuation(db, input.effectId, {
      state,
      terminalClass: input.terminalClass,
      effectTruth: input.effectTruth,
    });
    return row;
  }
  return null;
}

export function effectContinuationFromCompletion(
  db: DatabaseSync,
  input: {
    eventId: string;
    conversationId: string;
    payload: Record<string, unknown>;
  },
): EffectContinuationRecord | null {
  const effectId = typeof input.payload.effectContinuationId === "string"
    ? input.payload.effectContinuationId
    : "";
  if (!effectId || input.eventId !== `operation:${effectId}:completion`) return null;
  const event = db.prepare(
    "SELECT kind, conversation_id, payload_json FROM inbox_events WHERE id = ? LIMIT 1",
  ).get(input.eventId) as DbRow | undefined;
  if (event?.kind !== "observation_or_receipt" || event.conversation_id !== input.conversationId) return null;
  let storedPayload: unknown;
  try { storedPayload = JSON.parse(String(event.payload_json ?? "")); } catch { return null; }
  if (typeof storedPayload !== "object" || storedPayload === null || Array.isArray(storedPayload)) return null;
  const stored = storedPayload as Record<string, unknown>;
  const record = getEffectContinuation(db, effectId);
  const receipt = getEffectReceipt(db, effectId);
  if (!record || record.conversationId !== input.conversationId || record.state === "running"
    || record.completionEventRef !== input.eventId
    || !receipt || receipt.outcome === "in_progress" || receipt.outcome === "not_attempted") return null;
  const receiptTerminalClass = typeof receipt.claims.terminationClass === "string"
    ? receipt.claims.terminationClass
    : receipt.outcome === "succeeded" ? "SUCCESS" : "FAILED";
  const receiptEffectTruth = typeof receipt.claims.executionTruth === "string"
    ? receipt.claims.executionTruth
    : receipt.outcome === "succeeded" ? "unknown" : "effect_unknown";
  const receiptState = receiptTerminalClass === "CANCELLED"
    ? "cancelled"
    : receipt.outcome === "succeeded"
      ? "succeeded"
      : receipt.outcome === "failed"
        ? "failed"
        : "outcome_unknown";
  const completionFields = [
    "operationId",
    "effectId",
    "effectContinuationId",
    "effectBindingHash",
    "terminalState",
    "terminalClass",
    "effectTruth",
    "purpose",
    "diagnosticRef",
    "deadlineAtMs",
    "remainingEffectRounds",
    "originCycleId",
    "originGeneration",
    "originOwnerEventId",
    "receiptRef",
    "triggerRef",
  ] as const;
  if (receiptTerminalClass !== record.terminalClass
    || receiptEffectTruth !== record.effectTruth
    || receiptState !== record.state
    || completionFields.some((key) => input.payload[key] !== stored[key])
    || JSON.stringify(input.payload.target) !== JSON.stringify(stored.target)) return null;
  if (stored.operationId !== effectId || stored.effectId !== effectId
    || stored.effectContinuationId !== effectId
    || stored.originCycleId !== record.cycleId
    || stored.originGeneration !== record.generation
    || stored.effectBindingHash !== effectContinuationBindingHash(record)
    || stored.deadlineAtMs !== record.deadlineAtMs
    || stored.remainingEffectRounds !== record.remainingEffectRounds
    || stored.purpose !== record.purpose
    || JSON.stringify(stored.target) !== JSON.stringify(record.target)
    || stored.terminalClass !== record.terminalClass
    || stored.effectTruth !== record.effectTruth
    || stored.diagnosticRef !== record.diagnosticRef
    || stored.terminalState !== record.state
    || stored.receiptRef !== receipt.receiptId
    || stored.triggerRef !== `operation-completion:${effectId}`
    || stored.terminalClass !== input.payload.terminalClass
    || stored.effectTruth !== input.payload.effectTruth) return null;
  return record;
}

export function attachEffectContinuationLease(
  record: EffectContinuationRecord,
): { effectId: string; leaseToken: string } {
  return { effectId: record.effectId, leaseToken: record.leaseToken };
}
