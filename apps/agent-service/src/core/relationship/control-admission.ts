import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import { stableJson, sha256 } from "../model-fabric/hash.js";
import type { StructuredOutputSchemaFingerprint } from "../model-fabric/types.js";
import {
  readAuthorityBarrier,
} from "../cognitive-v021/authority/barrier.js";
import { advanceRelationalHardPolicyRevisionInTransaction } from "./hard-policy-revision.js";
import {
  resolvePrincipalRef,
  type PrincipalRef,
  type PrincipalResolutionContext,
} from "./principal-resolve.js";

export type ControlOp =
  | "grant_person"
  | "revoke_person"
  | "prohibit_person"
  | "unprohibit_person"
  | "narrow_person"
  | "grant_room"
  | "narrow_room"
  | "untrust_room"
  | "disclose_authorize";

export type ControlScope =
  | "person_wide"
  | "dm_only"
  | "room_only"
  | { roomLocal: string };

export type ControlDuration =
  | { kind: "until_revoked" }
  | { kind: "until"; atMs: number };

export type ControlSourceSpan = {
  messageId: string;
  start: number;
  end: number;
  polarity: "affirmative" | "negated";
};

export type ControlProposal = {
  ordinal: number;
  op: ControlOp;
  principalRef: PrincipalRef;
  scope: ControlScope;
  duration: ControlDuration;
  sourceSpan: ControlSourceSpan;
  thoughtCycle: { cycleId: string; attemptId: string };
};

export type HostControlProposal = {
  proposalId: string;
  sourceRef: string;
  ordinal: number;
  op: ControlOp;
  principalRef: PrincipalRef;
  scope: ControlScope;
  duration: ControlDuration;
};

export type PersistedControlInterpretation = {
  sourceRef: string;
  proposals: HostControlProposal[];
};

export type ControlInterpretationResult =
  | { kind: "none" }
  | { kind: "ambiguous"; reason: string }
  | { kind: "proposals"; proposals: ControlProposal[] };

export type ControlSettlement =
  | { settled: true; proposalId: string; appliedRevision: number; idempotentReplay: boolean }
  | { settled: false; proposalId: string; reason: string };

export type ControlActor = {
  kind: "owner";
  ownerId: string;
  nowMs?: number;
  resolutionContext?: PrincipalResolutionContext;
};

export const CONTROL_INTERPRETATION_SCHEMA_VERSION = 1 as const;
export const CONTROL_INTERPRETATION_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "ashley.thought.control-interpretation.v1.schema",
  type: "object",
  oneOf: [
    { type: "object", required: ["kind"], properties: { kind: { const: "none" } }, additionalProperties: false },
    {
      type: "object",
      required: ["kind", "reason"],
      properties: { kind: { const: "ambiguous" }, reason: { type: "string", minLength: 1, maxLength: 500 } },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "proposals"],
      properties: {
        kind: { const: "proposals" },
        proposals: { type: "array", minItems: 1, maxItems: 8, items: { type: "object" } },
      },
      additionalProperties: false,
    },
  ],
} as const;

export const CONTROL_INTERPRETATION_SCHEMA_FINGERPRINT =
  `sha256:${sha256(CONTROL_INTERPRETATION_SCHEMA)}` as StructuredOutputSchemaFingerprint;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function ownKeys(value: RecordValue, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function exactKeys(value: RecordValue, keys: readonly string[]): boolean {
  return ownKeys(value, keys) && Object.keys(value).length === keys.length;
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

function validatePrincipalRef(value: unknown): value is PrincipalRef {
  const row = record(value);
  if (!row || typeof row.kind !== "string") return false;
  if (row.kind === "mention") return exactKeys(row, ["kind", "userId", "messageId"])
    && text(row.userId) && text(row.messageId);
  if (row.kind === "reply_to") return exactKeys(row, ["kind", "messageId"])
    && text(row.messageId);
  if (row.kind === "name") return exactKeys(row, ["kind", "value", "messageId"])
    && text(row.value) && text(row.messageId);
  return false;
}

function validateScope(value: unknown): value is ControlScope {
  if (value === "person_wide" || value === "dm_only" || value === "room_only") return true;
  const row = record(value);
  return !!row && exactKeys(row, ["roomLocal"]) && text(row.roomLocal);
}

function validateDuration(value: unknown): value is ControlDuration {
  const row = record(value);
  if (!row || typeof row.kind !== "string") return false;
  if (row.kind === "until_revoked") return exactKeys(row, ["kind"]);
  return row.kind === "until" && exactKeys(row, ["kind", "atMs"]) && integer(row.atMs) && row.atMs >= 0;
}

function validateSourceSpan(value: unknown): value is ControlSourceSpan {
  const row = record(value);
  return !!row
    && exactKeys(row, ["messageId", "start", "end", "polarity"])
    && text(row.messageId)
    && integer(row.start) && row.start >= 0
    && integer(row.end) && row.end >= row.start
    && (row.polarity === "affirmative" || row.polarity === "negated");
}

function validateThoughtCycle(value: unknown): boolean {
  const row = record(value);
  return !!row && exactKeys(row, ["cycleId", "attemptId"]) && text(row.cycleId) && text(row.attemptId);
}

const CONTROL_OPS: readonly ControlOp[] = [
  "grant_person", "revoke_person", "prohibit_person", "unprohibit_person",
  "narrow_person", "grant_room", "narrow_room", "untrust_room", "disclose_authorize",
];

function validateProposal(value: unknown): value is ControlProposal {
  const row = record(value);
  return !!row
    && exactKeys(row, ["ordinal", "op", "principalRef", "scope", "duration", "sourceSpan", "thoughtCycle"])
    && integer(row.ordinal) && row.ordinal >= 0 && row.ordinal <= 7
    && typeof row.op === "string" && CONTROL_OPS.includes(row.op as ControlOp)
    && validatePrincipalRef(row.principalRef)
    && validateScope(row.scope)
    && validateDuration(row.duration)
    && validateSourceSpan(row.sourceSpan)
    && validateThoughtCycle(row.thoughtCycle);
}

/** Strict validator for the dedicated control phase. No ordinary Thought fields are accepted. */
export function validateControlInterpretation(value: unknown): ControlInterpretationResult {
  const row = record(value);
  if (!row || typeof row.kind !== "string") throw new Error("control_phase_violation");
  if (row.kind === "none") {
    if (!exactKeys(row, ["kind"])) throw new Error("control_phase_violation");
    return { kind: "none" };
  }
  if (row.kind === "ambiguous") {
    if (!exactKeys(row, ["kind", "reason"]) || !text(row.reason) || row.reason.length > 500) {
      throw new Error("control_phase_violation");
    }
    return { kind: "ambiguous", reason: row.reason };
  }
  if (row.kind !== "proposals" || !exactKeys(row, ["kind", "proposals"]) || !Array.isArray(row.proposals)
    || row.proposals.length < 1 || row.proposals.length > 8) {
    throw new Error("control_phase_violation");
  }
  const proposals: ControlProposal[] = [];
  const ordinals = new Set<number>();
  for (const item of row.proposals) {
    if (!validateProposal(item)) throw new Error("control_phase_violation");
    if (ordinals.has(item.ordinal)) throw new Error("control_phase_violation");
    ordinals.add(item.ordinal);
    proposals.push(item);
  }
  proposals.sort((left, right) => left.ordinal - right.ordinal);
  return { kind: "proposals", proposals };
}

export function parseControlInterpretation(raw: string | unknown): ControlInterpretationResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { throw new Error("control_phase_violation"); }
  }
  return validateControlInterpretation(value);
}

function requiredText(value: unknown, code: string): string {
  if (!text(value)) throw new Error(code);
  return value.trim();
}

function nowMs(value: number | undefined): number {
  const result = value ?? Date.now();
  if (!Number.isFinite(result)) throw new Error("control_time_invalid");
  return result;
}

function hostProposal(sourceRef: string, proposal: ControlProposal): HostControlProposal {
  return {
    proposalId: `ctrl:${sourceRef}:${proposal.ordinal}`,
    sourceRef,
    ordinal: proposal.ordinal,
    op: proposal.op,
    principalRef: proposal.principalRef,
    scope: proposal.scope,
    duration: proposal.duration,
  };
}

type StoredControlProposal = HostControlProposal & {
  actorOwnerId: string;
  sourceSpan: ControlSourceSpan;
  thoughtCycle: { cycleId: string; attemptId: string };
};

function storedProposal(row: RecordValue): StoredControlProposal {
  const proposal = JSON.parse(requiredText(row.proposal_json, "control_proposal_missing")) as RecordValue;
  const base = validateStoredProposal(proposal);
  if (!base) throw new Error("control_proposal_integrity_invalid");
  return base;
}

function validateStoredProposal(value: RecordValue): StoredControlProposal | null {
  const sourceSpan = value.sourceSpan;
  const thoughtCycle = value.thoughtCycle;
  if (!validateProposal({
    ordinal: value.ordinal,
    op: value.op,
    principalRef: value.principalRef,
    scope: value.scope,
    duration: value.duration,
    sourceSpan,
    thoughtCycle,
  })) return null;
  if (!text(value.proposalId) || !text(value.sourceRef) || !text(value.actorOwnerId)) return null;
  return {
    proposalId: value.proposalId,
    sourceRef: value.sourceRef,
    ordinal: value.ordinal as number,
    op: value.op as ControlOp,
    principalRef: value.principalRef as PrincipalRef,
    scope: value.scope as ControlScope,
    duration: value.duration as ControlDuration,
    actorOwnerId: value.actorOwnerId,
    sourceSpan: sourceSpan as ControlSourceSpan,
    thoughtCycle: thoughtCycle as { cycleId: string; attemptId: string },
  };
}

function storedJson(sourceRef: string, actorOwnerId: string, proposal: ControlProposal): string {
  const host = hostProposal(sourceRef, proposal);
  return stableJson({
    ...host,
    actorOwnerId,
    sourceSpan: proposal.sourceSpan,
    thoughtCycle: proposal.thoughtCycle,
  });
}

function resultFromJson(value: unknown): ControlSettlement | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as RecordValue;
    if (parsed.settled === true && text(parsed.proposalId) && integer(parsed.appliedRevision)
      && typeof parsed.idempotentReplay === "boolean") {
      return {
        settled: true,
        proposalId: parsed.proposalId,
        appliedRevision: parsed.appliedRevision,
        idempotentReplay: parsed.idempotentReplay,
      };
    }
    if (parsed.settled === false && text(parsed.proposalId) && text(parsed.reason)) {
      return { settled: false, proposalId: parsed.proposalId, reason: parsed.reason };
    }
  } catch {
    return null;
  }
  return null;
}

function rowForProposal(db: DatabaseSync, proposalId: string): RecordValue | undefined {
  return db.prepare("SELECT * FROM control_settlements WHERE proposal_id = ?").get(proposalId) as RecordValue | undefined;
}

function currentRevision(db: DatabaseSync): number {
  return readAuthorityBarrier(db).revision;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function durationExpiry(duration: ControlDuration, now: number): string | null {
  if (duration.kind === "until_revoked") return null;
  if (duration.atMs <= now) throw new Error("control_duration_expired");
  return iso(duration.atMs);
}

function roomLocal(value: ControlScope): { guildId: string; channelId: string } | null {
  if (typeof value !== "object") return null;
  const raw = value.roomLocal.trim();
  const normalized = raw.startsWith("room:") ? raw.slice("room:".length) : raw;
  const separator = normalized.indexOf(":");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  const guildId = normalized.slice(0, separator).trim();
  const channelId = normalized.slice(separator + 1).trim();
  return guildId && channelId ? { guildId, channelId } : null;
}

function sourceSpanJson(value: ControlSourceSpan): string {
  return stableJson(value);
}

function applyPersonGrant(
  db: DatabaseSync,
  proposal: StoredControlProposal,
  ownerId: string,
  principalId: string,
  now: number,
): boolean {
  const scope = proposal.scope;
  if (typeof scope !== "string" || !["person_wide", "dm_only", "room_only"].includes(scope)) {
    throw new Error("control_scope_invalid");
  }
  const existing = db.prepare(
    "SELECT entity_uuid FROM social_permits WHERE principal_id = ? AND scope = ? AND revoked_at IS NULL",
  ).get(principalId, scope);
  if (existing) return false;
  const entityUuid = assignNewEntityUuid();
  const expiresAt = durationExpiry(proposal.duration, now);
  advanceRelationalHardPolicyRevisionInTransaction(db, {
    reasonCode: "control_grant_person",
    changeId: entityUuid,
    nowMs: now,
    mutate: () => ({
      changes: Number(db.prepare(
        `INSERT INTO social_permits
           (entity_uuid, owner_id, principal_id, scope, granted_at, expires_at,
            source_span_json, proposal_ref, version, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
      ).run(
        entityUuid, ownerId, principalId, scope, iso(now), expiresAt,
        sourceSpanJson(proposal.sourceSpan), proposal.proposalId,
      ).changes),
      value: true,
    }),
  });
  return true;
}

function applyPersonRevoke(
  db: DatabaseSync,
  proposal: StoredControlProposal,
  principalId: string,
  now: number,
): boolean {
  if (typeof proposal.scope !== "string" || !["person_wide", "dm_only", "room_only"].includes(proposal.scope)) {
    throw new Error("control_scope_invalid");
  }
  const current = db.prepare(
    `SELECT entity_uuid, version FROM social_permits
      WHERE principal_id = ? AND scope = ? AND revoked_at IS NULL
      ORDER BY granted_at DESC, entity_uuid DESC LIMIT 1`,
  ).get(principalId, proposal.scope) as RecordValue | undefined;
  if (!current) return false;
  const entityUuid = requiredText(current.entity_uuid, "control_entity_missing");
  const version = Number(current.version);
  advanceRelationalHardPolicyRevisionInTransaction(db, {
    reasonCode: "control_revoke_person",
    changeId: entityUuid,
    nowMs: now,
    mutate: () => ({
      changes: Number(db.prepare(
        `UPDATE social_permits SET revoked_at = ?, version = version + 1
          WHERE entity_uuid = ? AND version = ? AND revoked_at IS NULL`,
      ).run(iso(now), entityUuid, version).changes),
      value: true,
    }),
  });
  return true;
}

function applyPersonProhibition(
  db: DatabaseSync,
  proposal: StoredControlProposal,
  ownerId: string,
  principalId: string,
  now: number,
): boolean {
  if (typeof proposal.scope === "object") throw new Error("control_scope_invalid");
  const current = db.prepare(
    `SELECT * FROM owner_prohibitions
      WHERE owner_id = ? AND target_principal_id = ? AND target_room_id IS NULL
        AND scope = 'no_contact' AND cleared_at IS NULL LIMIT 1`,
  ).get(ownerId, principalId) as RecordValue | undefined;
  const source = sourceSpanJson(proposal.sourceSpan);
  if (current && Number(current.hard_stop) === 1) return false;
  if (current) {
    const entityUuid = requiredText(current.entity_uuid, "control_entity_missing");
    const version = Number(current.version);
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "control_prohibit_person",
      changeId: entityUuid,
      nowMs: now,
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE owner_prohibitions SET hard_stop = 1, source_span_json = ?, version = version + 1
            WHERE entity_uuid = ? AND version = ? AND cleared_at IS NULL`,
        ).run(source, entityUuid, version).changes),
        value: true,
      }),
    });
    return true;
  }
  const entityUuid = assignNewEntityUuid();
  advanceRelationalHardPolicyRevisionInTransaction(db, {
    reasonCode: "control_prohibit_person",
    changeId: entityUuid,
    nowMs: now,
    mutate: () => ({
      changes: Number(db.prepare(
        `INSERT INTO owner_prohibitions
           (entity_uuid, owner_id, target_principal_id, target_room_id, scope,
            hard_stop, created_at, source_span_json, version, cleared_at)
         VALUES (?, ?, ?, NULL, 'no_contact', 1, ?, ?, 1, NULL)`,
      ).run(entityUuid, ownerId, principalId, iso(now), source).changes),
      value: true,
    }),
  });
  return true;
}

function applyUnprohibit(
  db: DatabaseSync,
  proposal: StoredControlProposal,
  ownerId: string,
  principalId: string | null,
  now: number,
): boolean {
  const room = roomLocal(proposal.scope);
  const current = room
    ? db.prepare(
      `SELECT * FROM owner_prohibitions
        WHERE owner_id = ? AND target_principal_id IS NULL AND target_room_id = ?
          AND cleared_at IS NULL LIMIT 1`,
    ).get(ownerId, `room:${room.guildId}:${room.channelId}`) as RecordValue | undefined
    : principalId
      ? db.prepare(
        `SELECT * FROM owner_prohibitions
          WHERE owner_id = ? AND target_principal_id = ? AND target_room_id IS NULL
            AND cleared_at IS NULL LIMIT 1`,
      ).get(ownerId, principalId) as RecordValue | undefined
      : undefined;
  if (!current) return false;
  const entityUuid = requiredText(current.entity_uuid, "control_entity_missing");
  const version = Number(current.version);
  advanceRelationalHardPolicyRevisionInTransaction(db, {
    reasonCode: "control_unprohibit",
    changeId: entityUuid,
    nowMs: now,
    mutate: () => ({
      changes: Number(db.prepare(
        `UPDATE owner_prohibitions SET cleared_at = ?, version = version + 1
          WHERE entity_uuid = ? AND version = ? AND cleared_at IS NULL`,
      ).run(iso(now), entityUuid, version).changes),
      value: true,
    }),
  });
  return true;
}

function applyNarrowPerson(
  db: DatabaseSync,
  proposal: StoredControlProposal,
  principalId: string,
  now: number,
): boolean {
  const scope = proposal.scope;
  if (typeof scope !== "string" || !["person_wide", "dm_only", "room_only"].includes(scope)) {
    throw new Error("control_scope_invalid");
  }
  const current = db.prepare(
    `SELECT * FROM social_permits WHERE principal_id = ? AND revoked_at IS NULL
      ORDER BY granted_at DESC, entity_uuid DESC LIMIT 1`,
  ).get(principalId) as RecordValue | undefined;
  if (!current) throw new Error("control_permit_missing");
  if (String(current.scope) === scope) return false;
  const conflict = db.prepare(
    "SELECT 1 FROM social_permits WHERE principal_id = ? AND scope = ? AND revoked_at IS NULL",
  ).get(principalId, scope);
  if (conflict) throw new Error("control_scope_conflict");
  const entityUuid = requiredText(current.entity_uuid, "control_entity_missing");
  const version = Number(current.version);
  advanceRelationalHardPolicyRevisionInTransaction(db, {
    reasonCode: "control_narrow_person",
    changeId: entityUuid,
    nowMs: now,
    mutate: () => ({
      changes: Number(db.prepare(
        `UPDATE social_permits SET scope = ?, version = version + 1
          WHERE entity_uuid = ? AND version = ? AND revoked_at IS NULL`,
      ).run(scope, entityUuid, version).changes),
      value: true,
    }),
  });
  return true;
}

function applyRoom(
  db: DatabaseSync,
  proposal: StoredControlProposal,
  ownerId: string,
  mode: "trusted_social" | "observe_only" | "disengaged",
  now: number,
): boolean {
  const room = roomLocal(proposal.scope);
  if (!room) throw new Error("control_room_scope_invalid");
  const current = db.prepare(
    "SELECT * FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
  ).get(room.guildId, room.channelId) as RecordValue | undefined;
  if (current && String(current.mode) === mode) return false;
  const source = sourceSpanJson(proposal.sourceSpan);
  if (current) {
    const entityUuid = requiredText(current.entity_uuid, "control_entity_missing");
    const oldMode = requiredText(current.mode, "control_room_mode_missing");
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: `control_room_${mode}`,
      changeId: entityUuid,
      nowMs: now,
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE trusted_rooms SET mode = ?, provenance = 'owner_grant_nl', added_by = ?,
                  added_at = ?, source_span_json = ?
            WHERE entity_uuid = ? AND mode = ?`,
        ).run(mode, ownerId, iso(now), source, entityUuid, oldMode).changes),
        value: true,
      }),
    });
    return true;
  }
  const entityUuid = assignNewEntityUuid();
  advanceRelationalHardPolicyRevisionInTransaction(db, {
    reasonCode: `control_room_${mode}`,
    changeId: entityUuid,
    nowMs: now,
    mutate: () => ({
      changes: Number(db.prepare(
        `INSERT INTO trusted_rooms
           (entity_uuid, owner_id, guild_id, channel_id, mode, provenance,
            added_by, added_at, source_span_json)
         VALUES (?, ?, ?, ?, ?, 'owner_grant_nl', ?, ?, ?)`,
      ).run(entityUuid, ownerId, room.guildId, room.channelId, mode, ownerId, iso(now), source).changes),
      value: true,
    }),
  });
  return true;
}

function resolveForSettlement(
  ref: PrincipalRef,
  context: PrincipalResolutionContext | undefined,
) {
  // Evidence and room membership are sidecar-owned inputs. The settlement
  // transaction is nuclear-owned, so callers must supply the already-resolved
  // context instead of making a cross-plane query here.
  return resolvePrincipalRef(ref, context ?? {});
}

function applyProposal(
  db: DatabaseSync,
  proposal: StoredControlProposal,
  actorOwnerId: string,
  resolutionContext: PrincipalResolutionContext | undefined,
  now: number,
): boolean {
  const resolved = proposal.op === "grant_room" || proposal.op === "narrow_room" || proposal.op === "untrust_room"
    ? null
    : resolveForSettlement(proposal.principalRef, resolutionContext);
  if (resolved && !resolved.ok) throw new Error(resolved.reason);
  const principalId = resolved?.ok ? resolved.principalId : null;
  switch (proposal.op) {
    case "grant_person":
      if (!principalId) throw new Error("ambiguous_principal");
      return applyPersonGrant(db, proposal, actorOwnerId, principalId, now);
    case "revoke_person":
      if (!principalId) throw new Error("ambiguous_principal");
      return applyPersonRevoke(db, proposal, principalId, now);
    case "prohibit_person":
      if (!principalId) throw new Error("ambiguous_principal");
      return applyPersonProhibition(db, proposal, actorOwnerId, principalId, now);
    case "unprohibit_person":
      return applyUnprohibit(db, proposal, actorOwnerId, principalId, now);
    case "narrow_person":
      if (!principalId) throw new Error("ambiguous_principal");
      return applyNarrowPerson(db, proposal, principalId, now);
    case "grant_room":
      return applyRoom(db, proposal, actorOwnerId, "trusted_social", now);
    case "narrow_room":
      return applyRoom(db, proposal, actorOwnerId, "observe_only", now);
    case "untrust_room":
      return applyRoom(db, proposal, actorOwnerId, "disengaged", now);
    case "disclose_authorize":
      throw new Error("control_disclosure_fields_required");
  }
}

function settleOne(
  db: DatabaseSync,
  row: RecordValue,
  options: { nowMs?: number; resolutionContext?: PrincipalResolutionContext },
): ControlSettlement {
  const proposalId = requiredText(row.proposal_id, "control_proposal_id_missing");
  const existing = resultFromJson(row.result_json);
  if (existing) return { ...existing, idempotentReplay: true } as ControlSettlement;
  const proposal = storedProposal(row);
  const now = nowMs(options.nowMs);
  let result: ControlSettlement;
  try {
    const effective = applyProposal(db, proposal, proposal.actorOwnerId, options.resolutionContext, now);
    result = {
      settled: true,
      proposalId,
      appliedRevision: currentRevision(db),
      idempotentReplay: false,
    };
    // `effective` is intentionally observed only to document the no-op path:
    // no-op proposals still settle with the unchanged revision and never call
    // the hard-policy helper.
    void effective;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "control_rejected";
    result = { settled: false, proposalId, reason };
  }
  const update = db.prepare(
    `UPDATE control_settlements SET result_json = ?, settled_at_ms = ?
      WHERE proposal_id = ? AND result_json IS NULL AND settled_at_ms IS NULL`,
  ).run(stableJson(result), now, proposalId);
  if (Number(update.changes) !== 1) {
    const reread = resultFromJson(rowForProposal(db, proposalId)?.result_json);
    if (reread) return { ...reread, idempotentReplay: true } as ControlSettlement;
    throw new Error("control_settlement_write_conflict");
  }
  return result;
}

export function persistControlProposals(
  nuclearDb: DatabaseSync,
  sourceRef: string,
  proposals: readonly ControlProposal[],
  actor: ControlActor,
): PersistedControlInterpretation {
  const normalizedSourceRef = requiredText(sourceRef, "control_source_ref_required");
  if (!actor || actor.kind !== "owner") throw new Error("control_actor_not_owner");
  const ownerId = requiredText(actor.ownerId, "control_owner_required");
  const interpretation = validateControlInterpretation({ kind: "proposals", proposals });
  if (interpretation.kind !== "proposals") throw new Error("control_phase_violation");
  const persisted: HostControlProposal[] = [];
  nuclearDb.exec("BEGIN IMMEDIATE");
  try {
    const createdAt = nowMs(actor.nowMs);
    for (const proposal of interpretation.proposals) {
      const host = hostProposal(normalizedSourceRef, proposal);
      const proposalJson = storedJson(normalizedSourceRef, ownerId, proposal);
      const existing = rowForProposal(nuclearDb, host.proposalId);
      if (existing) {
        const prior = requiredText(existing.proposal_json, "control_proposal_missing");
        if (prior !== proposalJson) throw new Error("control_proposal_conflict");
      } else {
        nuclearDb.prepare(
          `INSERT INTO control_settlements
             (proposal_id, source_ref, ordinal, proposal_json, result_json, created_at_ms, settled_at_ms)
           VALUES (?, ?, ?, ?, NULL, ?, NULL)
           ON CONFLICT(source_ref, ordinal) DO NOTHING`,
        ).run(host.proposalId, normalizedSourceRef, proposal.ordinal, proposalJson, createdAt);
        const after = rowForProposal(nuclearDb, host.proposalId);
        if (!after || requiredText(after.proposal_json, "control_proposal_missing") !== proposalJson) {
          throw new Error("control_proposal_conflict");
        }
      }
      persisted.push(host);
    }
    nuclearDb.exec("COMMIT");
  } catch (error) {
    try { nuclearDb.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return { sourceRef: normalizedSourceRef, proposals: persisted };
}

export function settlePersistedControlProposals(
  nuclearDb: DatabaseSync,
  sourceRef: string,
  options: { nowMs?: number; resolutionContext?: PrincipalResolutionContext } = {},
): ControlSettlement[] {
  const normalizedSourceRef = requiredText(sourceRef, "control_source_ref_required");
  const rows = nuclearDb.prepare(
    `SELECT * FROM control_settlements WHERE source_ref = ? ORDER BY ordinal ASC`,
  ).all(normalizedSourceRef) as RecordValue[];
  const results: ControlSettlement[] = [];
  for (const selected of rows) {
    nuclearDb.exec("BEGIN IMMEDIATE");
    try {
      const current = rowForProposal(nuclearDb, requiredText(selected.proposal_id, "control_proposal_id_missing"));
      if (!current) throw new Error("control_proposal_missing");
      const result = settleOne(nuclearDb, current, options);
      nuclearDb.exec("COMMIT");
      results.push(result);
    } catch (error) {
      try { nuclearDb.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  return results;
}

export function recoverControlSettlement(
  nuclearDb: DatabaseSync,
  proposalId: string,
): ControlSettlement | null {
  const row = rowForProposal(nuclearDb, requiredText(proposalId, "control_proposal_id_required"));
  return row ? resultFromJson(row.result_json) : null;
}

/** Model-free recovery after TX-B1; only durable pending rows are settled. */
export function replayPendingControlProposals(
  nuclearDb: DatabaseSync,
  sourceRef: string,
  options: { nowMs?: number; resolutionContext?: PrincipalResolutionContext } = {},
): ControlSettlement[] {
  return settlePersistedControlProposals(nuclearDb, sourceRef, options);
}

export function controlSettlementReceiptId(proposalId: string): string {
  return `control-settlement-receipt:${requiredText(proposalId, "control_proposal_id_required")}`;
}

// Kept as a source-near marker for audits: proposal identities are Host-owned,
// never supplied by Thought and never generated from a model UUID.
export const CONTROL_PROPOSAL_ID_PREFIX = "ctrl:";
