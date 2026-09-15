import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { sha256Text, stableJson } from "../model-fabric/hash.js";
import { readAuthorityBarrier } from "../cognitive-v021/authority/barrier.js";
import {
  markClaimOutcome,
  tryClaimRelationshipMotivation,
} from "./claims.js";
import type {
  CommitmentProposal,
  CommitmentRealizationBinding,
  HostCommitmentProposal,
  SocialAudience,
} from "../cognitive-v021/social/types.js";

export type { CommitmentProposal, CommitmentRealizationBinding, HostCommitmentProposal } from "../cognitive-v021/social/types.js";

export type FeasibilityVerdict =
  | { admitted: true; commitmentId: string; fireAtMs?: number; admissionRevision: number }
  | { admitted: false; reason: string };

export type CommitmentSettlement =
  | ({ settled: true; proposalId: string; idempotentReplay: boolean } & (
      | { admitted: true; commitmentId: string; fireAtMs?: number; admissionRevision: number }
      | { admitted: false; reason: string }
    ))
  | { settled: false; proposalId: string; reason: string; idempotentReplay?: boolean };

export const COMMITMENT_PROVISIONAL_ORPHAN = "provisional_orphan" as const;
export type CommitmentRecoveryStatus = typeof COMMITMENT_PROVISIONAL_ORPHAN;

export type CommitmentAdmissionOptions = {
  ownerId?: string;
  nowMs?: number;
  enabled?: boolean;
  maxPerBeneficiary?: number;
  maxGlobal?: number;
  overdueGraceMs?: number;
  blockedBackoffMs?: number;
};

export type CommitmentOpportunity = {
  commitmentId: string;
  ownerId: string;
  action: string;
  beneficiary: string;
  destination: SocialAudience;
  temporal: CommitmentProposal["temporal"];
  realizationClause: string;
  fireAtMs: number | null;
  state: string;
  attemptCount: number;
  leaseToken: string | null;
  leaseExpiresAtMs: number | null;
  recoveryStatus?: CommitmentRecoveryStatus;
};

const DEFAULT_MAX_PER_BENEFICIARY = 3;
const DEFAULT_MAX_GLOBAL = 12;
const DEFAULT_OVERDUE_GRACE_MS = 5 * 60_000;
const DEFAULT_BLOCKED_BACKOFF_MS = 15 * 60_000;
const COMMITMENT_STATES = ["admitted", "communicated", "attempted", "deferred_blocked"] as const;

type RecordValue = Record<string, unknown>;
type CommitmentTemporal = CommitmentProposal["temporal"];

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function validDestination(value: unknown): value is SocialAudience {
  const row = record(value);
  if (!row || typeof row.kind !== "string") return false;
  if (row.kind === "owner_private") return exactKeys(row, ["kind"]);
  if (row.kind === "owner_dm") return exactKeys(row, ["kind", "threadId"]) && text(row.threadId);
  if (row.kind === "dm") return exactKeys(row, ["kind", "principalId"]) && text(row.principalId);
  if (row.kind === "room") return exactKeys(row, ["kind", "roomId"]) && text(row.roomId);
  return false;
}

function validTemporal(value: unknown): value is CommitmentTemporal {
  const row = record(value);
  if (!row || typeof row.kind !== "string") return false;
  if (row.kind === "exact") return exactKeys(row, ["kind", "atMs"]) && integer(row.atMs);
  if (row.kind === "bounded") {
    return exactKeys(row, ["kind", "windowStartMs", "windowEndMs"])
      && integer(row.windowStartMs)
      && integer(row.windowEndMs)
      && row.windowEndMs >= row.windowStartMs;
  }
  return row.kind === "open" && exactKeys(row, ["kind"]);
}

function validThoughtCycle(value: unknown): value is { cycleId: string; attemptId: string } {
  const row = record(value);
  return !!row
    && exactKeys(row, ["cycleId", "attemptId"])
    && text(row.cycleId)
    && text(row.attemptId);
}

export function validateCommitmentProposal(value: unknown): value is CommitmentProposal {
  const row = record(value);
  return !!row
    && exactKeys(row, ["ordinal", "action", "beneficiary", "destination", "temporal", "realizationClause", "thoughtCycle"])
    && integer(row.ordinal) && row.ordinal >= 0 && row.ordinal <= 7
    && text(row.action)
    && (row.beneficiary === "owner" || text(row.beneficiary))
    && validDestination(row.destination)
    && validTemporal(row.temporal)
    && text(row.realizationClause)
    && validThoughtCycle(row.thoughtCycle);
}

export function validateCommitmentProposals(value: readonly unknown[]): CommitmentProposal[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new Error("commitment_proposals_invalid");
  }
  const ordinals = new Set<number>();
  const proposals: CommitmentProposal[] = [];
  for (const proposal of value) {
    if (!validateCommitmentProposal(proposal)) throw new Error("commitment_proposal_shape_invalid");
    if (ordinals.has(proposal.ordinal)) throw new Error("commitment_proposal_ordinal_duplicate");
    ordinals.add(proposal.ordinal);
    proposals.push({
      ordinal: proposal.ordinal,
      action: proposal.action.trim(),
      beneficiary: proposal.beneficiary,
      destination: proposal.destination,
      temporal: proposal.temporal,
      realizationClause: proposal.realizationClause,
      thoughtCycle: { ...proposal.thoughtCycle },
    });
  }
  return proposals;
}

function now(value: number | undefined): number {
  const result = value ?? Date.now();
  if (!Number.isFinite(result)) throw new Error("commitment_time_invalid");
  return result;
}

function hostProposal(sourceRef: string, proposal: CommitmentProposal): HostCommitmentProposal {
  return { ...proposal, proposalId: `cmt:${sourceRef}:${proposal.ordinal}`, sourceRef };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function proposalFromRow(row: RecordValue): HostCommitmentProposal {
  const value = parseJson(row.proposal_json);
  const stored = record(value);
  if (!stored) throw new Error("commitment_proposal_integrity_invalid");
  const { proposalId: _storedProposalId, sourceRef: _storedSourceRef, ...proposalValue } = stored;
  if (!validateCommitmentProposal(proposalValue)) throw new Error("commitment_proposal_integrity_invalid");
  const sourceRef = String(row.source_ref ?? "");
  const proposalId = String(row.proposal_id ?? "");
  if (!sourceRef || !proposalId) throw new Error("commitment_proposal_identity_invalid");
  const proposal = value as CommitmentProposal;
  if (proposalId !== `cmt:${sourceRef}:${proposal.ordinal}`) throw new Error("commitment_proposal_identity_invalid");
  return { ...proposal, proposalId, sourceRef };
}

function settlementFromJson(value: unknown): CommitmentSettlement | null {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  const row = record(parsed);
  if (!row || typeof row.proposalId !== "string" || typeof row.settled !== "boolean") return null;
  if (row.settled === false && text(row.reason)) {
    return {
      settled: false,
      proposalId: row.proposalId,
      reason: row.reason,
      ...(typeof row.idempotentReplay === "boolean" ? { idempotentReplay: row.idempotentReplay } : {}),
    };
  }
  if (row.settled === true && row.admitted === false && text(row.reason) && typeof row.idempotentReplay === "boolean") {
    return {
      settled: true,
      proposalId: row.proposalId,
      idempotentReplay: row.idempotentReplay,
      admitted: false,
      reason: row.reason,
    };
  }
  if (row.settled === true && row.admitted === true && text(row.commitmentId)
    && integer(row.admissionRevision) && typeof row.idempotentReplay === "boolean"
    && (row.fireAtMs === undefined || row.fireAtMs === null || integer(row.fireAtMs))) {
    return {
      settled: true,
      proposalId: row.proposalId,
      idempotentReplay: row.idempotentReplay,
      admitted: true,
      commitmentId: row.commitmentId,
      ...(row.fireAtMs == null ? {} : { fireAtMs: row.fireAtMs }),
      admissionRevision: row.admissionRevision,
    };
  }
  return null;
}

function resultWithReplay(result: CommitmentSettlement): CommitmentSettlement {
  return { ...result, idempotentReplay: true } as CommitmentSettlement;
}

function isCommitmentEnabledValue(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

/** Explicit activation is required; missing and malformed values fail closed. */
export function isCommitmentsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isCommitmentEnabledValue(env.RA_COMMITMENTS);
}

function activeCount(db: DatabaseSync, ownerId: string): number {
  const states = COMMITMENT_STATES.map(() => "?").join(",");
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM ashley_self_commitments
      WHERE owner_id = ? AND commitment_state IN (${states})`,
  ).get(ownerId, ...COMMITMENT_STATES) as { count?: unknown } | undefined;
  return Number(row?.count ?? 0);
}

function beneficiaryCount(db: DatabaseSync, ownerId: string, beneficiary: string): number {
  const states = COMMITMENT_STATES.map(() => "?").join(",");
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM ashley_self_commitments
      WHERE owner_id = ? AND beneficiary_principal = ? AND commitment_state IN (${states})`,
  ).get(ownerId, beneficiary, ...COMMITMENT_STATES) as { count?: unknown } | undefined;
  return Number(row?.count ?? 0);
}

function parseRoomId(roomId: string): { guildId: string; channelId: string } | null {
  const normalized = roomId.trim().startsWith("room:") ? roomId.trim().slice(5) : roomId.trim();
  const separator = normalized.indexOf(":");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  return {
    guildId: normalized.slice(0, separator),
    channelId: normalized.slice(separator + 1),
  };
}

function authorityAllows(
  db: DatabaseSync,
  ownerId: string,
  proposal: CommitmentProposal,
  fireAtMs: number | undefined,
  nowMs: number,
): string | null {
  if (proposal.destination.kind === "owner_private") {
    return proposal.beneficiary === "owner" ? null : "beneficiary_destination_mismatch";
  }
  if (proposal.destination.kind === "owner_dm") {
    if (proposal.beneficiary !== "owner") return "beneficiary_destination_mismatch";
    const thread = db.prepare(
      `SELECT id FROM mem_threads
         WHERE id = ? AND owner_id = ? AND status = 'active' AND channel = 'discord'
         LIMIT 1`,
    ).get(proposal.destination.threadId, ownerId) as { id?: unknown } | undefined;
    return thread?.id === proposal.destination.threadId ? null : "owner_dm_not_authorized";
  }
  if (proposal.destination.kind === "dm") {
    if (proposal.beneficiary !== proposal.destination.principalId) return "beneficiary_destination_mismatch";
    const nowIso = new Date(nowMs).toISOString();
    const permits = db.prepare(
      `SELECT owner_id, scope, expires_at FROM social_permits
        WHERE principal_id = ? AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)`
    ).all(proposal.beneficiary, nowIso) as Array<{ owner_id?: unknown; scope?: unknown; expires_at?: unknown }>;
    const permit = permits.find((item) => String(item.owner_id ?? "") === ownerId
      && (item.scope === "person_wide" || item.scope === "dm_only"));
    if (!permit) return "contact_not_eligible";
    const prohibitions = db.prepare(
      `SELECT scope, hard_stop FROM owner_prohibitions
        WHERE cleared_at IS NULL AND target_principal_id = ?`,
    ).all(proposal.beneficiary) as Array<{ scope?: unknown; hard_stop?: unknown }>;
    if (prohibitions.some((item) => Number(item.hard_stop) === 1 || item.scope === "no_contact" || item.scope === "no_dm" || item.scope === "no_direct")) {
      return "owner_prohibition";
    }
    const boundaries = db.prepare(
      `SELECT scope FROM ashley_boundaries
        WHERE superseded_at IS NULL AND (target_principal_id IS NULL OR target_principal_id = ?)`,
    ).all(proposal.beneficiary) as Array<{ scope?: unknown }>;
    if (boundaries.some((item) => item.scope === "no_contact" || item.scope === "no_dm" || item.scope === "no_direct")) {
      return "ashley_boundary";
    }
    const restrictions = db.prepare(
      `SELECT kind FROM recipient_restrictions
        WHERE principal_id = ? AND cleared_at IS NULL`,
    ).all(proposal.beneficiary) as Array<{ kind?: unknown }>;
    if (restrictions.some((item) => item.kind === "do_not_contact" || item.kind === "no_dm" || item.kind === "no_initiation")) {
      return "recipient_restricted";
    }
    if (fireAtMs !== undefined && permit.expires_at != null && Date.parse(String(permit.expires_at)) <= fireAtMs) {
      return "authority_expires_before_fire_time";
    }
    return null;
  }
  const location = parseRoomId(proposal.destination.roomId);
  if (!location) return "room_identity_invalid";
  const room = db.prepare(
    "SELECT mode FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
  ).get(location.guildId, location.channelId) as { mode?: unknown } | undefined;
  if (room?.mode !== "trusted_social") return "room_not_authorized";
  const roomProhibitions = db.prepare(
    `SELECT scope, hard_stop FROM owner_prohibitions
      WHERE cleared_at IS NULL AND target_room_id = ?`,
  ).all(`room:${location.guildId}:${location.channelId}`) as Array<{ scope?: unknown; hard_stop?: unknown }>;
  if (roomProhibitions.some((item) => Number(item.hard_stop) === 1 || item.scope === "no_contact")) return "room_prohibited";
  return null;
}

function fireTime(proposal: CommitmentProposal, nowMs: number): { fireAtMs?: number; reason?: string } {
  if (proposal.temporal.kind === "open") return {};
  if (proposal.temporal.kind === "exact") {
    return proposal.temporal.atMs > nowMs
      ? { fireAtMs: proposal.temporal.atMs }
      : { reason: "temporal_not_future" };
  }
  if (proposal.temporal.windowEndMs <= nowMs) return { reason: "temporal_window_expired" };
  return { fireAtMs: Math.max(nowMs, proposal.temporal.windowStartMs) };
}

function feasibility(
  db: DatabaseSync,
  proposal: HostCommitmentProposal,
  options: CommitmentAdmissionOptions,
): FeasibilityVerdict {
  const nowMs = now(options.nowMs);
  const ownerId = options.ownerId?.trim() || "owner";
  if (!options.enabled && !isCommitmentsEnabled()) return { admitted: false, reason: "commitments_disabled" };
  if (proposal.action.length > 800) return { admitted: false, reason: "action_too_long" };
  if (proposal.beneficiary !== "owner" && proposal.destination.kind === "owner_private") {
    return { admitted: false, reason: "beneficiary_destination_mismatch" };
  }
  const timing = fireTime(proposal, nowMs);
  if (timing.reason) return { admitted: false, reason: timing.reason };
  const authorityFailure = authorityAllows(db, ownerId, proposal, timing.fireAtMs, nowMs);
  if (authorityFailure) return { admitted: false, reason: authorityFailure };
  const beneficiary = proposal.beneficiary === "owner" ? ownerId : proposal.beneficiary;
  const maxPerBeneficiary = options.maxPerBeneficiary ?? DEFAULT_MAX_PER_BENEFICIARY;
  const maxGlobal = options.maxGlobal ?? DEFAULT_MAX_GLOBAL;
  if (beneficiaryCount(db, ownerId, beneficiary) >= maxPerBeneficiary) return { admitted: false, reason: "beneficiary_cap" };
  if (activeCount(db, ownerId) >= maxGlobal) return { admitted: false, reason: "global_cap" };
  const commitmentId = proposal.proposalId;
  return {
    admitted: true,
    commitmentId,
    ...(timing.fireAtMs === undefined ? {} : { fireAtMs: timing.fireAtMs }),
    admissionRevision: readAuthorityBarrier(db).revision,
  };
}

function insertOpportunity(
  db: DatabaseSync,
  proposal: HostCommitmentProposal,
  ownerId: string,
  result: Extract<FeasibilityVerdict, { admitted: true }>,
  nowMs: number,
): void {
  const destination = stableJson(proposal.destination);
  const evidence = stableJson({ proposal, admissionRevision: result.admissionRevision });
  const nowIso = new Date(nowMs).toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO ashley_self_commitments
       (owner_id, entity_uuid, data_classification, text, status, due_at,
        source_entity_type, source_entity_uuid, evidence_json, text_hash,
        created_at, updated_at, provenance, party_subject_scope,
        beneficiary_principal, destination_json, fire_at_ms, lease_token,
        lease_expires_at_ms, attempt_count, commitment_state)
     VALUES (?, ?, 'ordinary', ?, 'motivated', ?, 'thought_commitment', ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, NULL, NULL, 0, 'admitted')`,
  ).run(
    ownerId,
    result.commitmentId,
    proposal.action,
    result.fireAtMs == null ? null : new Date(result.fireAtMs).toISOString(),
    proposal.proposalId,
    evidence,
    sha256Text(proposal.action.normalize("NFC").trim().toLowerCase()).slice(0, 32),
    nowIso,
    nowIso,
    proposal.beneficiary === "owner" ? ownerId : proposal.beneficiary,
    proposal.beneficiary === "owner" ? ownerId : proposal.beneficiary,
    destination,
    result.fireAtMs ?? null,
  );
}

function rowForProposal(db: DatabaseSync, proposalId: string): RecordValue | undefined {
  return db.prepare("SELECT * FROM commitment_settlements WHERE proposal_id = ?").get(proposalId) as RecordValue | undefined;
}

/** TX-B1: persist immutable Thought proposals and commit before admission. */
export function persistCommitmentProposals(
  nuclearDb: DatabaseSync,
  settlementRef: string,
  proposals: readonly CommitmentProposal[],
): HostCommitmentProposal[] {
  if (!text(settlementRef)) throw new Error("commitment_source_required");
  const validated = validateCommitmentProposals(proposals);
  const host = validated.map((proposal) => hostProposal(settlementRef.trim(), proposal));
  nuclearDb.exec("BEGIN IMMEDIATE");
  try {
    const insert = nuclearDb.prepare(
      `INSERT INTO commitment_settlements
         (proposal_id, source_ref, ordinal, proposal_json, result_json, created_at_ms, settled_at_ms)
       VALUES (?, ?, ?, ?, NULL, ?, NULL)
       ON CONFLICT(source_ref, ordinal) DO NOTHING`,
    );
    const at = Date.now();
    for (const proposal of host) {
      const existing = nuclearDb.prepare(
        "SELECT proposal_json FROM commitment_settlements WHERE source_ref = ? AND ordinal = ?",
      ).get(proposal.sourceRef, proposal.ordinal) as { proposal_json?: unknown } | undefined;
      if (existing && stableJson(parseJson(existing.proposal_json)) !== stableJson(proposal)) {
        throw new Error("commitment_source_conflict");
      }
      insert.run(proposal.proposalId, proposal.sourceRef, proposal.ordinal, stableJson(proposal), at);
    }
    nuclearDb.exec("COMMIT");
    return host;
  } catch (error) {
    try { nuclearDb.exec("ROLLBACK"); } catch { /* preserve primary failure */ }
    throw error;
  }
}

function settleOne(
  nuclearDb: DatabaseSync,
  row: RecordValue,
  options: CommitmentAdmissionOptions,
): CommitmentSettlement {
  const proposal = proposalFromRow(row);
  const result = feasibility(nuclearDb, proposal, options);
  const nowMs = now(options.nowMs);
  if (result.admitted) {
    insertOpportunity(nuclearDb, proposal, options.ownerId?.trim() || "owner", result, nowMs);
  }
  const settlement: CommitmentSettlement = result.admitted
    ? { settled: true, proposalId: proposal.proposalId, idempotentReplay: false, ...result }
    : { settled: true, proposalId: proposal.proposalId, idempotentReplay: false, admitted: false, reason: result.reason };
  nuclearDb.prepare(
    "UPDATE commitment_settlements SET result_json = ?, settled_at_ms = ? WHERE proposal_id = ? AND result_json IS NULL",
  ).run(stableJson(settlement), nowMs, proposal.proposalId);
  return settlement;
}

/** TX-B2: settle each pending proposal without advancing the authority barrier. */
export function settlePersistedCommitmentProposals(
  nuclearDb: DatabaseSync,
  settlementRef: string,
  options: CommitmentAdmissionOptions = {},
): CommitmentSettlement[] {
  const rows = nuclearDb.prepare(
    "SELECT * FROM commitment_settlements WHERE source_ref = ? ORDER BY ordinal ASC",
  ).all(settlementRef) as RecordValue[];
  const results: CommitmentSettlement[] = [];
  for (const candidate of rows) {
    nuclearDb.exec("BEGIN IMMEDIATE");
    try {
      const row = rowForProposal(nuclearDb, String(candidate.proposal_id ?? ""));
      if (!row) throw new Error("commitment_proposal_missing");
      const stored = settlementFromJson(row.result_json);
      if (stored) {
        nuclearDb.exec("COMMIT");
        results.push(resultWithReplay(stored));
        continue;
      }
      const result = settleOne(nuclearDb, row, options);
      nuclearDb.exec("COMMIT");
      results.push(result);
    } catch (error) {
      try { nuclearDb.exec("ROLLBACK"); } catch { /* preserve primary failure */ }
      throw error;
    }
  }
  return results;
}

export function replayPendingCommitmentProposals(
  nuclearDb: DatabaseSync,
  settlementRef: string,
  options: CommitmentAdmissionOptions = {},
): CommitmentSettlement[] {
  return settlePersistedCommitmentProposals(nuclearDb, settlementRef, options);
}

/** Startup/reconciliation recovery. It never regenerates Thought output. */
export function recoverPendingCommitmentProposals(
  nuclearDb: DatabaseSync,
  options: CommitmentAdmissionOptions = {},
): CommitmentSettlement[] {
  const pending = nuclearDb.prepare(
    `SELECT proposal_id, result_json
       FROM commitment_settlements
      WHERE result_json IS NULL
      ORDER BY source_ref, ordinal`,
  ).all() as RecordValue[];
  const results: CommitmentSettlement[] = [];
  for (const candidate of pending) {
    const proposalId = String(candidate.proposal_id ?? "");
    if (!proposalId) throw new Error("commitment_proposal_identity_invalid");
    nuclearDb.exec("BEGIN IMMEDIATE");
    try {
      const row = rowForProposal(nuclearDb, proposalId);
      if (!row) throw new Error("commitment_proposal_missing");
      const stored = settlementFromJson(row.result_json);
      if (stored) {
        nuclearDb.exec("COMMIT");
        results.push(resultWithReplay(stored));
        continue;
      }
      const settlement: CommitmentSettlement = {
        settled: false,
        proposalId,
        reason: COMMITMENT_PROVISIONAL_ORPHAN,
        idempotentReplay: false,
      };
      nuclearDb.prepare(
        "UPDATE commitment_settlements SET result_json = ?, settled_at_ms = ? WHERE proposal_id = ? AND result_json IS NULL",
      ).run(stableJson(settlement), now(options.nowMs), proposalId);
      nuclearDb.exec("COMMIT");
      results.push(settlement);
    } catch (error) {
      try { nuclearDb.exec("ROLLBACK"); } catch { /* preserve primary failure */ }
      throw error;
    }
  }
  return results;
}

export function commitmentBindingsForSettlement(
  nuclearDb: DatabaseSync,
  settlementRef: string,
): CommitmentRealizationBinding[] {
  const rows = nuclearDb.prepare(
    "SELECT proposal_json, result_json FROM commitment_settlements WHERE source_ref = ? ORDER BY ordinal ASC",
  ).all(settlementRef) as RecordValue[];
  return rows.flatMap((row) => {
    const proposal = parseJson(row.proposal_json) as RecordValue | null;
    const result = settlementFromJson(row.result_json);
    if (!proposal || !result || result.settled !== true || result.admitted !== true || !text(proposal.realizationClause)) return [];
    return [{
      commitmentId: result.commitmentId,
      realizationClauseHash: sha256Text(proposal.realizationClause),
      admissionRevision: result.admissionRevision,
    }];
  });
}

function opportunityFromRow(row: RecordValue): CommitmentOpportunity | null {
  const evidence = record(parseJson(row.evidence_json));
  const proposal = record(evidence?.proposal);
  if (!proposal || !text(proposal.action) || !text(proposal.beneficiary) || !validDestination(proposal.destination) || !validTemporal(proposal.temporal) || !text(proposal.realizationClause)) return null;
  const recoveryStatus = evidence?.recoveryStatus === COMMITMENT_PROVISIONAL_ORPHAN
    ? COMMITMENT_PROVISIONAL_ORPHAN
    : undefined;
  return {
    commitmentId: String(row.entity_uuid ?? ""),
    ownerId: String(row.owner_id ?? ""),
    action: proposal.action,
    beneficiary: proposal.beneficiary,
    destination: proposal.destination,
    temporal: proposal.temporal,
    realizationClause: proposal.realizationClause,
    fireAtMs: row.fire_at_ms == null ? null : Number(row.fire_at_ms),
    state: String(row.commitment_state ?? ""),
    attemptCount: Number(row.attempt_count ?? 0),
    leaseToken: row.lease_token == null ? null : String(row.lease_token),
    leaseExpiresAtMs: row.lease_expires_at_ms == null ? null : Number(row.lease_expires_at_ms),
    ...(recoveryStatus ? { recoveryStatus } : {}),
  };
}

export function getCommitmentOpportunity(
  nuclearDb: DatabaseSync,
  input: { ownerId: string; commitmentId: string },
): CommitmentOpportunity | null {
  const row = nuclearDb.prepare(
    "SELECT * FROM ashley_self_commitments WHERE owner_id = ? AND entity_uuid = ?",
  ).get(input.ownerId, input.commitmentId) as RecordValue | undefined;
  return row ? opportunityFromRow(row) : null;
}

export function listDueCommitmentOpportunities(
  nuclearDb: DatabaseSync,
  ownerId: string,
  nowMs = Date.now(),
  limit = 20,
): CommitmentOpportunity[] {
  const states = COMMITMENT_STATES.map(() => "?").join(",");
  const rows = nuclearDb.prepare(
    `SELECT * FROM ashley_self_commitments
      WHERE owner_id = ? AND commitment_state IN (${states})
        AND (fire_at_ms IS NULL OR fire_at_ms <= ?)
        AND (commitment_state <> 'attempted' OR lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)
      ORDER BY COALESCE(fire_at_ms, 0), id LIMIT ?`,
  ).all(ownerId, ...COMMITMENT_STATES, nowMs, nowMs, Math.max(1, Math.min(100, limit))) as RecordValue[];
  return rows.map(opportunityFromRow).filter((item): item is CommitmentOpportunity => item !== null);
}

export function recoverCommitmentOpportunities(
  nuclearDb: DatabaseSync,
  options: { ownerId: string; nowMs?: number; overdueGraceMs?: number } = { ownerId: "owner" },
): { requeued: number; missed: number } {
  const nowMs = now(options.nowMs);
  const grace = options.overdueGraceMs ?? DEFAULT_OVERDUE_GRACE_MS;
  const rows = nuclearDb.prepare(
    `SELECT entity_uuid, fire_at_ms, lease_expires_at_ms, attempt_count, commitment_state
      FROM ashley_self_commitments
      WHERE owner_id = ? AND commitment_state IN ('admitted','communicated','attempted','deferred_blocked')`,
  ).all(options.ownerId) as Array<RecordValue>;
  let requeued = 0;
  let missed = 0;
  for (const row of rows) {
    const id = String(row.entity_uuid ?? "");
    if (!id) continue;
    const state = String(row.commitment_state ?? "");
    const leaseExpiresAtMs = row.lease_expires_at_ms == null ? null : Number(row.lease_expires_at_ms);
    if (state === "attempted" && leaseExpiresAtMs != null && leaseExpiresAtMs > nowMs) continue;
    if (row.fire_at_ms != null && Number(row.fire_at_ms) + grace < nowMs) {
      const result = nuclearDb.prepare(
        `UPDATE ashley_self_commitments SET commitment_state = 'missed_overdue', status = 'released',
           lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ?
          WHERE entity_uuid = ? AND commitment_state IN ('admitted','communicated','attempted','deferred_blocked')`,
      ).run(new Date(nowMs).toISOString(), id);
      missed += Number(result.changes);
    } else if (state === "attempted" && Number(row.attempt_count ?? 0) < 3) {
      const evidenceRow = nuclearDb.prepare(
        "SELECT evidence_json FROM ashley_self_commitments WHERE owner_id = ? AND entity_uuid = ?",
      ).get(options.ownerId, id) as RecordValue | undefined;
      const evidence = record(parseJson(evidenceRow?.evidence_json)) ?? {};
      nuclearDb.prepare(
        "UPDATE ashley_self_commitments SET evidence_json = ?, updated_at = ? WHERE owner_id = ? AND entity_uuid = ?",
      ).run(
        stableJson({ ...evidence, recoveryStatus: COMMITMENT_PROVISIONAL_ORPHAN }),
        new Date(nowMs).toISOString(),
        options.ownerId,
        id,
      );
      const result = nuclearDb.prepare(
        `UPDATE ashley_self_commitments SET commitment_state = 'admitted',
           lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ?
          WHERE entity_uuid = ? AND commitment_state = 'attempted'
            AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)`,
      ).run(new Date(nowMs).toISOString(), id, nowMs);
      requeued += Number(result.changes);
    } else if (state === "attempted") {
      const result = nuclearDb.prepare(
        `UPDATE ashley_self_commitments SET commitment_state = 'missed_overdue', status = 'released',
           lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ?
          WHERE entity_uuid = ? AND commitment_state = 'attempted'`,
      ).run(new Date(nowMs).toISOString(), id);
      missed += Number(result.changes);
    } else {
      requeued += 1;
    }
  }
  return { requeued, missed };
}

export function claimCommitmentOpportunity(
  nuclearDb: DatabaseSync,
  input: { ownerId: string; commitmentId: string; nowMs?: number; leaseMs?: number },
): CommitmentOpportunity | null {
  const nowMs = now(input.nowMs);
  const current = nuclearDb.prepare(
    "SELECT attempt_count, commitment_state, lease_expires_at_ms FROM ashley_self_commitments WHERE owner_id = ? AND entity_uuid = ?",
  ).get(input.ownerId, input.commitmentId) as RecordValue | undefined;
  if (!current || !COMMITMENT_STATES.includes(String(current.commitment_state) as typeof COMMITMENT_STATES[number])) return null;
  if (Number(current.attempt_count ?? 0) >= 3) return null;
  if (current.lease_expires_at_ms != null && Number(current.lease_expires_at_ms) > nowMs) return null;
  const leasedByClaim = tryClaimRelationshipMotivation(nuclearDb, {
    ownerId: input.ownerId,
    relationshipEntityType: "commitment",
    relationshipEntityUuid: input.commitmentId,
    motivationId: 0,
  });
  if (!leasedByClaim) return null;
  const leaseToken = `commitment-lease:${assignNewEntityUuid()}`;
  const leaseExpiresAtMs = nowMs + (input.leaseMs ?? 5 * 60_000);
  nuclearDb.exec("BEGIN IMMEDIATE");
  try {
    const result = nuclearDb.prepare(
      `UPDATE ashley_self_commitments
          SET commitment_state = 'attempted', lease_token = ?, lease_expires_at_ms = ?,
              attempt_count = attempt_count + 1, updated_at = ?
        WHERE owner_id = ? AND entity_uuid = ?
          AND commitment_state IN ('admitted','communicated','deferred_blocked')
          AND (lease_expires_at_ms IS NULL OR lease_expires_at_ms <= ?)`
    ).run(leaseToken, leaseExpiresAtMs, new Date(nowMs).toISOString(), input.ownerId, input.commitmentId, nowMs);
    if (Number(result.changes) !== 1) {
      nuclearDb.exec("COMMIT");
      markClaimOutcome(nuclearDb, input.commitmentId, "released", "commitment_claim_race");
      return null;
    }
    nuclearDb.exec("COMMIT");
    return opportunityFromRow(nuclearDb.prepare("SELECT * FROM ashley_self_commitments WHERE entity_uuid = ?").get(input.commitmentId) as RecordValue);
  } catch (error) {
    try { nuclearDb.exec("ROLLBACK"); } catch { /* preserve primary failure */ }
    markClaimOutcome(nuclearDb, input.commitmentId, "released", "commitment_claim_failed");
    throw error;
  }
}

function currentOpportunityAuthority(
  nuclearDb: DatabaseSync,
  opportunity: CommitmentOpportunity,
  nowMs: number,
): string | null {
  const proposal: CommitmentProposal = {
    ordinal: 0,
    action: opportunity.action,
    beneficiary: opportunity.beneficiary === opportunity.ownerId ? "owner" : opportunity.beneficiary,
    destination: opportunity.destination,
    temporal: opportunity.temporal,
    realizationClause: opportunity.realizationClause,
    thoughtCycle: { cycleId: "recheck", attemptId: "recheck" },
  };
  return authorityAllows(nuclearDb, opportunity.ownerId, proposal, opportunity.fireAtMs ?? undefined, nowMs);
}

export type CommitmentWakeVerdict =
  | { kind: "fulfill"; opportunity: CommitmentOpportunity }
  | { kind: "defer"; opportunity: CommitmentOpportunity; nextFireAtMs: number; reason: string }
  | { kind: "missed"; opportunity: CommitmentOpportunity; reason: string }
  | { kind: "not_found" };

export function recheckCommitmentOpportunity(
  nuclearDb: DatabaseSync,
  input: { ownerId: string; commitmentId: string; nowMs?: number; blockedBackoffMs?: number; overdueGraceMs?: number },
): CommitmentWakeVerdict {
  const nowMs = now(input.nowMs);
  const row = nuclearDb.prepare(
    "SELECT * FROM ashley_self_commitments WHERE owner_id = ? AND entity_uuid = ?",
  ).get(input.ownerId, input.commitmentId) as RecordValue | undefined;
  const opportunity = row ? opportunityFromRow(row) : null;
  if (!opportunity) return { kind: "not_found" };
  if (opportunity.fireAtMs != null && opportunity.fireAtMs + (input.overdueGraceMs ?? DEFAULT_OVERDUE_GRACE_MS) < nowMs) {
    nuclearDb.prepare(
      `UPDATE ashley_self_commitments SET commitment_state = 'missed_overdue', status = 'released',
         lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ? WHERE entity_uuid = ?`,
    ).run(new Date(nowMs).toISOString(), input.commitmentId);
    markClaimOutcome(nuclearDb, input.commitmentId, "released", "missed_overdue");
    return { kind: "missed", opportunity: { ...opportunity, state: "missed_overdue" }, reason: "missed_overdue" };
  }
  const failure = currentOpportunityAuthority(nuclearDb, opportunity, nowMs);
  if (!failure) return { kind: "fulfill", opportunity };
  const nextFireAtMs = nowMs + (input.blockedBackoffMs ?? DEFAULT_BLOCKED_BACKOFF_MS);
  nuclearDb.prepare(
    `UPDATE ashley_self_commitments SET commitment_state = 'deferred_blocked', fire_at_ms = ?,
       due_at = ?, lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ?
      WHERE entity_uuid = ? AND commitment_state IN ('attempted','admitted','communicated','deferred_blocked')`,
  ).run(nextFireAtMs, new Date(nextFireAtMs).toISOString(), new Date(nowMs).toISOString(), input.commitmentId);
  markClaimOutcome(nuclearDb, input.commitmentId, "released", failure);
  return { kind: "defer", opportunity: { ...opportunity, state: "deferred_blocked", fireAtMs: nextFireAtMs }, nextFireAtMs, reason: failure };
}

export function reviseCommitment(
  nuclearDb: DatabaseSync,
  input: { ownerId: string; commitmentId: string; replacementSourceRef: string; nowMs?: number },
): boolean {
  const nowMs = now(input.nowMs);
  const row = nuclearDb.prepare(
    "SELECT evidence_json FROM ashley_self_commitments WHERE owner_id = ? AND entity_uuid = ?",
  ).get(input.ownerId, input.commitmentId) as { evidence_json?: unknown } | undefined;
  if (!row) return false;
  const evidence = record(parseJson(row.evidence_json)) ?? {};
  nuclearDb.prepare(
    `UPDATE ashley_self_commitments SET commitment_state = 'revised', status = 'released',
       evidence_json = ?, lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ? WHERE owner_id = ? AND entity_uuid = ?`,
  ).run(stableJson({ ...evidence, supersededBySourceRef: input.replacementSourceRef }), new Date(nowMs).toISOString(), input.ownerId, input.commitmentId);
  markClaimOutcome(nuclearDb, input.commitmentId, "released", "revised");
  return true;
}

export function relinquishCommitment(
  nuclearDb: DatabaseSync,
  input: { ownerId: string; commitmentId: string; reason?: string; nowMs?: number },
): boolean {
  const nowMs = now(input.nowMs);
  const result = nuclearDb.prepare(
    `UPDATE ashley_self_commitments SET commitment_state = 'relinquished', status = 'released',
       evidence_json = json_set(COALESCE(evidence_json, '{}'), '$.relinquishmentReason', ?),
       lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ?
      WHERE owner_id = ? AND entity_uuid = ? AND commitment_state NOT IN ('completed','relinquished','revised','missed_overdue')`,
  ).run(input.reason ?? "thought_relinquished", new Date(nowMs).toISOString(), input.ownerId, input.commitmentId);
  if (Number(result.changes) === 1) markClaimOutcome(nuclearDb, input.commitmentId, "released", input.reason ?? "relinquished");
  return Number(result.changes) === 1;
}

export function applyCommitmentDeliveryOutcome(
  nuclearDb: DatabaseSync,
  input: {
    ownerId: string;
    commitmentId: string;
    state: "committed" | "partially_delivered" | "aborted" | "cancelled";
    cause?: string;
    receiptCount: number;
    nowMs?: number;
  },
): void {
  const nowMs = now(input.nowMs);
  const row = nuclearDb.prepare(
    "SELECT attempt_count FROM ashley_self_commitments WHERE owner_id = ? AND entity_uuid = ?",
  ).get(input.ownerId, input.commitmentId) as { attempt_count?: unknown } | undefined;
  if (!row) return;
  if (input.receiptCount > 0 && (input.state === "committed" || input.state === "partially_delivered")) {
    nuclearDb.prepare(
      `UPDATE ashley_self_commitments SET commitment_state = 'completed', status = 'fulfilled',
         lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ? WHERE owner_id = ? AND entity_uuid = ?`,
    ).run(new Date(nowMs).toISOString(), input.ownerId, input.commitmentId);
    markClaimOutcome(nuclearDb, input.commitmentId, "committed");
    return;
  }
  if (input.state === "cancelled") {
    relinquishCommitment(nuclearDb, { ownerId: input.ownerId, commitmentId: input.commitmentId, reason: input.cause ?? "cancelled", nowMs });
    return;
  }
  const attempts = Number(row.attempt_count ?? 0);
  if (attempts >= 3) {
    nuclearDb.prepare(
      `UPDATE ashley_self_commitments SET commitment_state = 'deferred_blocked', status = 'deferred',
         lease_token = NULL, lease_expires_at_ms = NULL, updated_at = ? WHERE owner_id = ? AND entity_uuid = ?`,
    ).run(new Date(nowMs).toISOString(), input.ownerId, input.commitmentId);
    markClaimOutcome(nuclearDb, input.commitmentId, "released", "retry_exhausted");
  }
}

export const COMMITMENT_DEFAULTS = {
  maxPerBeneficiary: DEFAULT_MAX_PER_BENEFICIARY,
  maxGlobal: DEFAULT_MAX_GLOBAL,
  overdueGraceMs: DEFAULT_OVERDUE_GRACE_MS,
  blockedBackoffMs: DEFAULT_BLOCKED_BACKOFF_MS,
} as const;
