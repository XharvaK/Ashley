import type { DatabaseSync } from "node:sqlite";
import { assignNewEntityUuid } from "../continuity/nuclear-targetable.js";
import {
  readAuthorityBarrier,
  type AuthorityBarrierSnapshot,
} from "../cognitive-v021/authority/barrier.js";
import { advanceRelationalHardPolicyRevisionInTransaction } from "./hard-policy-revision.js";

export type SocialPermitScope = "person_wide" | "dm_only" | "room_only";
export type TrustedRoomMode = "trusted_social" | "observe_only" | "disengaged";
export type TrustedRoomProvenance = "seeded_from_owner_config" | "owner_grant_nl" | "explicit_config";
export type RecipientRestrictionKind = "no_dm" | "no_initiation" | "room_only" | "do_not_contact";
export type AshleyBoundaryScope = "no_initiation" | "no_dm" | "no_direct" | "no_contact";

export type SocialPermit = {
  entityUuid: string;
  ownerId: string;
  principalId: string;
  scope: SocialPermitScope;
  grantedAt: string;
  expiresAt: string | null;
  sourceSpan: unknown;
  proposalRef: string | null;
  version: number;
  revokedAt: string | null;
};

export type OwnerProhibition = {
  entityUuid: string;
  ownerId: string;
  targetPrincipalId: string | null;
  targetRoomId: string | null;
  scope: string;
  hardStop: boolean;
  createdAt: string;
  sourceSpan: unknown;
  version: number;
  clearedAt: string | null;
};

export type TrustedRoom = {
  entityUuid: string;
  ownerId: string;
  guildId: string;
  channelId: string;
  mode: TrustedRoomMode;
  provenance: TrustedRoomProvenance;
  addedBy: string;
  addedAt: string;
  sourceSpan: unknown;
};

export type RecipientRestriction = {
  entityUuid: string;
  ownerId: string;
  principalId: string;
  kind: RecipientRestrictionKind;
  setAt: string;
  sourceMessageRef: string;
  clearedAt: string | null;
};

export type AshleyBoundary = {
  entityUuid: string;
  ownerId: string;
  targetPrincipalId: string | null;
  scope: AshleyBoundaryScope;
  decisionRef: string;
  createdAt: string;
  supersedesRef: string | null;
  supersededAt: string | null;
};

export type DisclosureLicense = {
  entityUuid: string;
  ownerId: string;
  materialHash: string;
  sourcePrincipal: string;
  controlledProtections: unknown;
  granteeAudience: unknown;
  usesAllowed: number;
  usesConsumed: number;
  expiresAt: string | null;
  grantRef: string;
  version: number;
  revokedAt: string | null;
};

export type EligibilityBundle = {
  barrier: Pick<AuthorityBarrierSnapshot, "epoch" | "revision">;
  absentAsOfMs: number;
  permits: SocialPermit[];
  prohibitions: OwnerProhibition[];
  trustedRoom: TrustedRoom | null;
  restrictions: RecipientRestriction[];
  boundaries: AshleyBoundary[];
  licenses: DisclosureLicense[];
};

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | undefined {
  return typeof value === "object" && value !== null ? value as Row : undefined;
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function timeMs(value: number | undefined): number {
  const result = value ?? Date.now();
  if (!Number.isFinite(result)) throw new Error("social_authority_time_invalid");
  return result;
}

function isoTime(value: number | undefined): string {
  return new Date(timeMs(value)).toISOString();
}

function json(value: unknown, code: string): string {
  try {
    const result = JSON.stringify(value ?? {});
    if (!result) throw new Error(code);
    return result;
  } catch {
    throw new Error(code);
  }
}

function nullableText(value: unknown): string | null {
  return value == null ? null : String(value);
}

function integer(value: unknown): number {
  const result = Number(value);
  if (!Number.isInteger(result)) throw new Error("social_authority_integer_invalid");
  return result;
}

function booleanInt(value: unknown): boolean {
  return Number(value) === 1;
}

function permit(row: Row): SocialPermit {
  return {
    entityUuid: String(row.entity_uuid ?? ""),
    ownerId: String(row.owner_id ?? ""),
    principalId: String(row.principal_id ?? ""),
    scope: String(row.scope) as SocialPermitScope,
    grantedAt: String(row.granted_at ?? ""),
    expiresAt: nullableText(row.expires_at),
    sourceSpan: row.source_span_json == null ? null : JSON.parse(String(row.source_span_json)),
    proposalRef: nullableText(row.proposal_ref),
    version: integer(row.version),
    revokedAt: nullableText(row.revoked_at),
  };
}

function prohibition(row: Row): OwnerProhibition {
  return {
    entityUuid: String(row.entity_uuid ?? ""),
    ownerId: String(row.owner_id ?? ""),
    targetPrincipalId: nullableText(row.target_principal_id),
    targetRoomId: nullableText(row.target_room_id),
    scope: String(row.scope ?? ""),
    hardStop: booleanInt(row.hard_stop),
    createdAt: String(row.created_at ?? ""),
    sourceSpan: row.source_span_json == null ? null : JSON.parse(String(row.source_span_json)),
    version: integer(row.version),
    clearedAt: nullableText(row.cleared_at),
  };
}

function trustedRoom(row: Row): TrustedRoom {
  return {
    entityUuid: String(row.entity_uuid ?? ""),
    ownerId: String(row.owner_id ?? ""),
    guildId: String(row.guild_id ?? ""),
    channelId: String(row.channel_id ?? ""),
    mode: String(row.mode) as TrustedRoomMode,
    provenance: String(row.provenance) as TrustedRoomProvenance,
    addedBy: String(row.added_by ?? ""),
    addedAt: String(row.added_at ?? ""),
    sourceSpan: row.source_span_json == null ? null : JSON.parse(String(row.source_span_json)),
  };
}

function restriction(row: Row): RecipientRestriction {
  return {
    entityUuid: String(row.entity_uuid ?? ""),
    ownerId: String(row.owner_id ?? ""),
    principalId: String(row.principal_id ?? ""),
    kind: String(row.kind) as RecipientRestrictionKind,
    setAt: String(row.set_at ?? ""),
    sourceMessageRef: String(row.source_message_ref ?? ""),
    clearedAt: nullableText(row.cleared_at),
  };
}

function boundary(row: Row): AshleyBoundary {
  return {
    entityUuid: String(row.entity_uuid ?? ""),
    ownerId: String(row.owner_id ?? ""),
    targetPrincipalId: nullableText(row.target_principal_id),
    scope: String(row.scope) as AshleyBoundaryScope,
    decisionRef: String(row.decision_ref ?? ""),
    createdAt: String(row.created_at ?? ""),
    supersedesRef: nullableText(row.supersedes_ref),
    supersededAt: nullableText(row.superseded_at),
  };
}

function license(row: Row): DisclosureLicense {
  return {
    entityUuid: String(row.entity_uuid ?? ""),
    ownerId: String(row.owner_id ?? ""),
    materialHash: String(row.material_hash ?? ""),
    sourcePrincipal: String(row.source_principal ?? ""),
    controlledProtections: JSON.parse(String(row.controlled_protections_json ?? "{}")),
    granteeAudience: JSON.parse(String(row.grantee_audience_json ?? "{}")),
    usesAllowed: integer(row.uses_allowed),
    usesConsumed: integer(row.uses_consumed),
    expiresAt: nullableText(row.expires_at),
    grantRef: String(row.grant_ref ?? ""),
    version: integer(row.version),
    revokedAt: nullableText(row.revoked_at),
  };
}

function withImmediateTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the mutation failure */ }
    throw error;
  }
}

function activePermit(db: DatabaseSync, principalId: string, scope: SocialPermitScope): Row | undefined {
  return asRow(db.prepare(
    `SELECT entity_uuid, owner_id, principal_id, scope, granted_at, expires_at,
            source_span_json, proposal_ref, version, revoked_at
       FROM social_permits
      WHERE principal_id = ? AND scope = ? AND revoked_at IS NULL`,
  ).get(principalId, scope));
}

function rowByEntity(db: DatabaseSync, table: string, entityUuid: string): Row | undefined {
  return asRow(db.prepare(`SELECT * FROM ${table} WHERE entity_uuid = ?`).get(entityUuid));
}

function expectedVersion(current: Row, provided: number | undefined): number {
  const currentVersion = integer(current.version);
  if (provided != null && provided !== currentVersion) throw new Error("stale_authority_version");
  return currentVersion;
}

export function grantPerson(
  db: DatabaseSync,
  input: {
    ownerId: string;
    principalId: string;
    scope: SocialPermitScope;
    sourceSpan: unknown;
    proposalRef?: string;
    expiresAt?: string | null;
    grantedAt?: string;
    entityUuid?: string;
    nowMs?: number;
  },
): SocialPermit {
  const ownerId = required(input.ownerId, "social_owner_required");
  const principalId = required(input.principalId, "social_principal_required");
  const now = input.nowMs;
  return withImmediateTransaction(db, () => {
    const existing = activePermit(db, principalId, input.scope);
    if (existing) return permit(existing);
    const entityUuid = required(input.entityUuid ?? assignNewEntityUuid(), "social_entity_required");
    const grantedAt = input.grantedAt ?? isoTime(now);
    const sourceSpanJson = json(input.sourceSpan, "social_source_span_invalid");
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "social_permit_grant",
      changeId: entityUuid,
      nowMs: timeMs(now),
      mutate: () => ({
        changes: Number(db.prepare(
          `INSERT INTO social_permits
             (entity_uuid, owner_id, principal_id, scope, granted_at, expires_at,
              source_span_json, proposal_ref, version, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
        ).run(
          entityUuid,
          ownerId,
          principalId,
          input.scope,
          grantedAt,
          input.expiresAt ?? null,
          sourceSpanJson,
          input.proposalRef ?? null,
        ).changes),
        value: undefined,
      }),
    });
    return permit(rowByEntity(db, "social_permits", entityUuid)!);
  });
}

export function revokePerson(
  db: DatabaseSync,
  input: { entityUuid: string; expectedVersion?: number; revokedAt?: string; nowMs?: number },
): SocialPermit {
  const entityUuid = required(input.entityUuid, "social_entity_required");
  return withImmediateTransaction(db, () => {
    const current = rowByEntity(db, "social_permits", entityUuid);
    if (!current) throw new Error("social_permit_missing");
    if (current.revoked_at != null) return permit(current);
    const version = expectedVersion(current, input.expectedVersion);
    const revokedAt = input.revokedAt ?? isoTime(input.nowMs);
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "social_permit_revoke",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE social_permits SET revoked_at = ?, version = version + 1
            WHERE entity_uuid = ? AND version = ? AND revoked_at IS NULL`,
        ).run(revokedAt, entityUuid, version).changes),
        value: undefined,
      }),
    });
    return permit(rowByEntity(db, "social_permits", entityUuid)!);
  });
}

export function prohibitPerson(
  db: DatabaseSync,
  input: {
    ownerId: string;
    targetPrincipalId?: string;
    targetRoomId?: string;
    scope: string;
    hardStop?: boolean;
    sourceSpan: unknown;
    nowMs?: number;
    entityUuid?: string;
  },
): OwnerProhibition {
  const ownerId = required(input.ownerId, "social_owner_required");
  const principal = input.targetPrincipalId?.trim() || null;
  const room = input.targetRoomId?.trim() || null;
  if (!principal && !room) throw new Error("prohibition_target_required");
  if (principal && room) throw new Error("prohibition_target_ambiguous");
  const now = timeMs(input.nowMs);
  return withImmediateTransaction(db, () => {
    const current = asRow(db.prepare(
      `SELECT * FROM owner_prohibitions
        WHERE owner_id = ? AND target_principal_id IS ? AND target_room_id IS ?
          AND scope = ? AND cleared_at IS NULL
        LIMIT 1`,
    ).get(ownerId, principal, room, input.scope));
    const hardStop = input.hardStop === true;
    if (current && booleanInt(current.hard_stop) === hardStop) return prohibition(current);
    const entityUuid = current
      ? String(current.entity_uuid)
      : required(input.entityUuid ?? assignNewEntityUuid(), "social_entity_required");
    const sourceSpanJson = json(input.sourceSpan, "social_source_span_invalid");
    if (current) {
      const version = expectedVersion(current, undefined);
      advanceRelationalHardPolicyRevisionInTransaction(db, {
        reasonCode: "owner_prohibition_change",
        changeId: entityUuid,
        nowMs: now,
        mutate: () => ({
          changes: Number(db.prepare(
            `UPDATE owner_prohibitions
                SET hard_stop = ?, source_span_json = ?, version = version + 1
              WHERE entity_uuid = ? AND version = ? AND cleared_at IS NULL`,
          ).run(hardStop ? 1 : 0, sourceSpanJson, entityUuid, version).changes),
          value: undefined,
        }),
      });
    } else {
      advanceRelationalHardPolicyRevisionInTransaction(db, {
        reasonCode: "owner_prohibition_create",
        changeId: entityUuid,
        nowMs: now,
        mutate: () => ({
          changes: Number(db.prepare(
            `INSERT INTO owner_prohibitions
               (entity_uuid, owner_id, target_principal_id, target_room_id, scope,
                hard_stop, created_at, source_span_json, version, cleared_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
          ).run(
            entityUuid,
            ownerId,
            principal,
            room,
            input.scope,
            hardStop ? 1 : 0,
            isoTime(now),
            sourceSpanJson,
          ).changes),
          value: undefined,
        }),
      });
    }
    return prohibition(rowByEntity(db, "owner_prohibitions", entityUuid)!);
  });
}

export function clearProhibition(
  db: DatabaseSync,
  input: { entityUuid: string; nowMs?: number },
): OwnerProhibition {
  const entityUuid = required(input.entityUuid, "social_entity_required");
  return withImmediateTransaction(db, () => {
    const current = rowByEntity(db, "owner_prohibitions", entityUuid);
    if (!current) throw new Error("prohibition_missing");
    if (current.cleared_at != null) return prohibition(current);
    const version = expectedVersion(current, undefined);
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "owner_prohibition_clear",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE owner_prohibitions SET cleared_at = ?, version = version + 1
            WHERE entity_uuid = ? AND version = ? AND cleared_at IS NULL`,
        ).run(isoTime(input.nowMs), entityUuid, version).changes),
        value: undefined,
      }),
    });
    return prohibition(rowByEntity(db, "owner_prohibitions", entityUuid)!);
  });
}

export function narrowPerson(
  db: DatabaseSync,
  input: { entityUuid: string; scope: SocialPermitScope; expectedVersion?: number; nowMs?: number },
): SocialPermit {
  const entityUuid = required(input.entityUuid, "social_entity_required");
  return withImmediateTransaction(db, () => {
    const current = rowByEntity(db, "social_permits", entityUuid);
    if (!current) throw new Error("social_permit_missing");
    if (current.revoked_at != null) throw new Error("social_permit_revoked");
    if (String(current.scope) === input.scope) return permit(current);
    const version = expectedVersion(current, input.expectedVersion);
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "social_permit_narrow",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE social_permits SET scope = ?, version = version + 1
            WHERE entity_uuid = ? AND version = ? AND revoked_at IS NULL`,
        ).run(input.scope, entityUuid, version).changes),
        value: undefined,
      }),
    });
    return permit(rowByEntity(db, "social_permits", entityUuid)!);
  });
}

export function upsertTrustedRoom(
  db: DatabaseSync,
  input: {
    ownerId: string;
    guildId: string;
    channelId: string;
    mode: TrustedRoomMode;
    provenance: TrustedRoomProvenance;
    addedBy: string;
    sourceSpan?: unknown;
    expectedMode?: TrustedRoomMode;
    nowMs?: number;
    entityUuid?: string;
  },
): TrustedRoom {
  const ownerId = required(input.ownerId, "social_owner_required");
  const guildId = required(input.guildId, "trusted_room_guild_required");
  const channelId = required(input.channelId, "trusted_room_channel_required");
  const now = timeMs(input.nowMs);
  return withImmediateTransaction(db, () => {
    const current = asRow(db.prepare(
      "SELECT * FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
    ).get(guildId, channelId));
    if (current && String(current.mode) === input.mode) return trustedRoom(current);
    const sourceSpanJson = input.sourceSpan == null ? null : json(input.sourceSpan, "social_source_span_invalid");
    const entityUuid = current
      ? String(current.entity_uuid)
      : required(input.entityUuid ?? assignNewEntityUuid(), "social_entity_required");
    if (current) {
      if (input.expectedMode == null || input.expectedMode !== String(current.mode)) {
        throw new Error("stale_trusted_room_mode");
      }
      const expectedMode = input.expectedMode;
      advanceRelationalHardPolicyRevisionInTransaction(db, {
        reasonCode: "trusted_room_mode_change",
        changeId: entityUuid,
        nowMs: now,
        mutate: () => ({
          changes: Number(db.prepare(
            `UPDATE trusted_rooms SET mode = ?, provenance = ?, added_by = ?,
                    added_at = ?, source_span_json = ?
              WHERE entity_uuid = ? AND mode = ?`,
          ).run(
            input.mode,
            input.provenance,
            input.addedBy,
            isoTime(now),
            sourceSpanJson,
            entityUuid,
            expectedMode,
          ).changes),
          value: undefined,
        }),
      });
    } else {
      advanceRelationalHardPolicyRevisionInTransaction(db, {
        reasonCode: "trusted_room_create",
        changeId: entityUuid,
        nowMs: now,
        mutate: () => ({
          changes: Number(db.prepare(
            `INSERT INTO trusted_rooms
               (entity_uuid, owner_id, guild_id, channel_id, mode, provenance,
                added_by, added_at, source_span_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            entityUuid,
            ownerId,
            guildId,
            channelId,
            input.mode,
            input.provenance,
            required(input.addedBy, "trusted_room_added_by_required"),
            isoTime(now),
            sourceSpanJson,
          ).changes),
          value: undefined,
        }),
      });
    }
    return trustedRoom(rowByEntity(db, "trusted_rooms", entityUuid)!);
  });
}

/** Variant for an already-open seed/migration transaction. */
export function upsertTrustedRoomInExistingTransaction(
  db: DatabaseSync,
  input: Parameters<typeof upsertTrustedRoom>[1],
): TrustedRoom {
  const ownerId = required(input.ownerId, "social_owner_required");
  const guildId = required(input.guildId, "trusted_room_guild_required");
  const channelId = required(input.channelId, "trusted_room_channel_required");
  const now = timeMs(input.nowMs);
  const current = asRow(db.prepare(
    "SELECT * FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
  ).get(guildId, channelId));
  if (current && String(current.mode) === input.mode) return trustedRoom(current);
  const sourceSpanJson = input.sourceSpan == null ? null : json(input.sourceSpan, "social_source_span_invalid");
  const entityUuid = current
    ? String(current.entity_uuid)
    : required(input.entityUuid ?? assignNewEntityUuid(), "social_entity_required");
  if (current) {
    if (input.expectedMode == null || input.expectedMode !== String(current.mode)) {
      throw new Error("stale_trusted_room_mode");
    }
    const expectedMode = input.expectedMode;
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "trusted_room_mode_change",
      changeId: entityUuid,
      nowMs: now,
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE trusted_rooms SET mode = ?, provenance = ?, added_by = ?,
                  added_at = ?, source_span_json = ?
            WHERE entity_uuid = ? AND mode = ?`,
        ).run(
          input.mode,
          input.provenance,
          input.addedBy,
          isoTime(now),
          sourceSpanJson,
          entityUuid,
          expectedMode,
        ).changes),
        value: undefined,
      }),
    });
  } else {
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "trusted_room_create",
      changeId: entityUuid,
      nowMs: now,
      mutate: () => ({
        changes: Number(db.prepare(
          `INSERT INTO trusted_rooms
             (entity_uuid, owner_id, guild_id, channel_id, mode, provenance,
              added_by, added_at, source_span_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          entityUuid,
          ownerId,
          guildId,
          channelId,
          input.mode,
          input.provenance,
          required(input.addedBy, "trusted_room_added_by_required"),
          isoTime(now),
          sourceSpanJson,
        ).changes),
        value: undefined,
      }),
    });
  }
  return trustedRoom(rowByEntity(db, "trusted_rooms", entityUuid)!);
}

function requireAuthenticatedSender(authenticatedSender: boolean): void {
  if (authenticatedSender !== true) throw new Error("recipient_restriction_sender_unauthorized");
}

export function setRecipientRestriction(
  db: DatabaseSync,
  input: {
    authenticatedSender: boolean;
    ownerId: string;
    principalId: string;
    kind: RecipientRestrictionKind;
    sourceMessageRef: string;
    nowMs?: number;
    entityUuid?: string;
  },
): RecipientRestriction {
  requireAuthenticatedSender(input.authenticatedSender);
  const ownerId = required(input.ownerId, "social_owner_required");
  const principalId = required(input.principalId, "social_principal_required");
  const sourceMessageRef = required(input.sourceMessageRef, "restriction_source_required");
  return withImmediateTransaction(db, () => {
    const current = asRow(db.prepare(
      `SELECT * FROM recipient_restrictions
        WHERE principal_id = ? AND kind = ? AND cleared_at IS NULL`,
    ).get(principalId, input.kind));
    if (current) return restriction(current);
    const entityUuid = required(input.entityUuid ?? assignNewEntityUuid(), "social_entity_required");
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "recipient_restriction_set",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `INSERT INTO recipient_restrictions
             (entity_uuid, owner_id, principal_id, kind, set_at, source_message_ref, cleared_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
        ).run(
          entityUuid,
          ownerId,
          principalId,
          input.kind,
          isoTime(input.nowMs),
          sourceMessageRef,
        ).changes),
        value: undefined,
      }),
    });
    return restriction(rowByEntity(db, "recipient_restrictions", entityUuid)!);
  });
}

export function clearRecipientRestriction(
  db: DatabaseSync,
  input: { authenticatedSender: boolean; entityUuid: string; nowMs?: number },
): RecipientRestriction {
  requireAuthenticatedSender(input.authenticatedSender);
  const entityUuid = required(input.entityUuid, "social_entity_required");
  return withImmediateTransaction(db, () => {
    const current = rowByEntity(db, "recipient_restrictions", entityUuid);
    if (!current) throw new Error("recipient_restriction_missing");
    if (current.cleared_at != null) return restriction(current);
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "recipient_restriction_clear",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE recipient_restrictions SET cleared_at = ?
            WHERE entity_uuid = ? AND cleared_at IS NULL`,
        ).run(isoTime(input.nowMs), entityUuid).changes),
        value: undefined,
      }),
    });
    return restriction(rowByEntity(db, "recipient_restrictions", entityUuid)!);
  });
}

function requireBoundaryCaller(caller: string): void {
  if (caller !== "thought" && caller !== "agency") throw new Error("boundary_authority_required");
}

export function setAshleyBoundary(
  db: DatabaseSync,
  input: {
    ownerId: string;
    targetPrincipalId?: string | null;
    scope: AshleyBoundaryScope;
    decisionRef: string;
    caller: "thought" | "agency" | "owner" | string;
    supersedesRef?: string | null;
    nowMs?: number;
    entityUuid?: string;
  },
): AshleyBoundary {
  requireBoundaryCaller(input.caller);
  const ownerId = required(input.ownerId, "social_owner_required");
  const decisionRef = required(input.decisionRef, "boundary_decision_required");
  const targetPrincipalId = input.targetPrincipalId?.trim() || null;
  return withImmediateTransaction(db, () => {
    const current = asRow(db.prepare(
      `SELECT * FROM ashley_boundaries
        WHERE owner_id = ? AND target_principal_id IS ? AND scope = ? AND superseded_at IS NULL
        LIMIT 1`,
    ).get(ownerId, targetPrincipalId, input.scope));
    if (current && String(current.decision_ref) === decisionRef) return boundary(current);
    const entityUuid = required(input.entityUuid ?? assignNewEntityUuid(), "social_entity_required");
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "ashley_boundary_set",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `INSERT INTO ashley_boundaries
             (entity_uuid, owner_id, target_principal_id, scope, decision_ref,
              created_at, supersedes_ref, superseded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        ).run(
          entityUuid,
          ownerId,
          targetPrincipalId,
          input.scope,
          decisionRef,
          isoTime(input.nowMs),
          input.supersedesRef ?? null,
        ).changes),
        value: undefined,
      }),
    });
    return boundary(rowByEntity(db, "ashley_boundaries", entityUuid)!);
  });
}

export function supersedeAshleyBoundary(
  db: DatabaseSync,
  input: { entityUuid: string; caller: "thought" | "agency" | "owner" | string; nowMs?: number },
): AshleyBoundary {
  requireBoundaryCaller(input.caller);
  const entityUuid = required(input.entityUuid, "social_entity_required");
  return withImmediateTransaction(db, () => {
    const current = rowByEntity(db, "ashley_boundaries", entityUuid);
    if (!current) throw new Error("boundary_missing");
    if (current.superseded_at != null) return boundary(current);
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "ashley_boundary_supersede",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE ashley_boundaries SET superseded_at = ?
            WHERE entity_uuid = ? AND superseded_at IS NULL`,
        ).run(isoTime(input.nowMs), entityUuid).changes),
        value: undefined,
      }),
    });
    return boundary(rowByEntity(db, "ashley_boundaries", entityUuid)!);
  });
}

export function issueLicense(
  db: DatabaseSync,
  input: {
    ownerId: string;
    materialHash: string;
    sourcePrincipal: string;
    controlledProtections: unknown;
    granteeAudience: unknown;
    usesAllowed: number;
    grantRef: string;
    expiresAt?: string | null;
    nowMs?: number;
    entityUuid?: string;
  },
): DisclosureLicense {
  const ownerId = required(input.ownerId, "social_owner_required");
  const materialHash = required(input.materialHash, "license_material_required");
  const sourcePrincipal = required(input.sourcePrincipal, "license_source_required");
  const grantRef = required(input.grantRef, "license_grant_ref_required");
  if (!Number.isInteger(input.usesAllowed) || input.usesAllowed < 1) {
    throw new Error("license_uses_allowed_invalid");
  }
  const controlledProtections = json(input.controlledProtections, "license_protections_invalid");
  const granteeAudience = json(input.granteeAudience, "license_audience_invalid");
  return withImmediateTransaction(db, () => {
    const entityUuid = required(input.entityUuid ?? assignNewEntityUuid(), "social_entity_required");
    const existing = rowByEntity(db, "disclosure_licenses", entityUuid);
    if (existing) return license(existing);
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "disclosure_license_issue",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `INSERT INTO disclosure_licenses
             (entity_uuid, owner_id, material_hash, source_principal,
              controlled_protections_json, grantee_audience_json, uses_allowed,
              uses_consumed, expires_at, grant_ref, version, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, NULL)`,
        ).run(
          entityUuid,
          ownerId,
          materialHash,
          sourcePrincipal,
          controlledProtections,
          granteeAudience,
          input.usesAllowed,
          input.expiresAt ?? null,
          grantRef,
        ).changes),
        value: undefined,
      }),
    });
    return license(rowByEntity(db, "disclosure_licenses", entityUuid)!);
  });
}

export function revokeLicense(
  db: DatabaseSync,
  input: { entityUuid: string; expectedVersion?: number; nowMs?: number },
): DisclosureLicense {
  const entityUuid = required(input.entityUuid, "social_entity_required");
  return withImmediateTransaction(db, () => {
    const current = rowByEntity(db, "disclosure_licenses", entityUuid);
    if (!current) throw new Error("license_missing");
    if (current.revoked_at != null) return license(current);
    const version = expectedVersion(current, input.expectedVersion);
    advanceRelationalHardPolicyRevisionInTransaction(db, {
      reasonCode: "disclosure_license_revoke",
      changeId: entityUuid,
      nowMs: timeMs(input.nowMs),
      mutate: () => ({
        changes: Number(db.prepare(
          `UPDATE disclosure_licenses SET revoked_at = ?, version = version + 1
            WHERE entity_uuid = ? AND version = ? AND revoked_at IS NULL`,
        ).run(isoTime(input.nowMs), entityUuid, version).changes),
        value: undefined,
      }),
    });
    return license(rowByEntity(db, "disclosure_licenses", entityUuid)!);
  });
}

export type ConsumeLicenseOnceInput = {
  entityUuid: string;
  expectedVersion: number;
  reservationId: string;
  nowMs?: number;
};

function consumeLicenseOnceInTransaction(
  db: DatabaseSync,
  input: ConsumeLicenseOnceInput,
): DisclosureLicense {
  const entityUuid = required(input.entityUuid, "social_entity_required");
  required(input.reservationId, "license_reservation_required");
  const now = timeMs(input.nowMs);
  const current = rowByEntity(db, "disclosure_licenses", entityUuid);
  if (!current) throw new Error("license_missing");
  if (current.revoked_at != null) throw new Error("license_revoked");
  if (integer(current.uses_consumed) >= integer(current.uses_allowed)) throw new Error("license_consumed");
  const expiresAt = nullableText(current.expires_at);
  if (expiresAt != null && expiresAt <= isoTime(now)) throw new Error("license_expired");
  const version = expectedVersion(current, input.expectedVersion);
  advanceRelationalHardPolicyRevisionInTransaction(db, {
    reasonCode: "disclosure_license_consume",
    changeId: `${entityUuid}:consume:${input.reservationId}`,
    nowMs: now,
    mutate: () => ({
      changes: Number(db.prepare(
        `UPDATE disclosure_licenses
            SET uses_consumed = uses_consumed + 1, version = version + 1
          WHERE entity_uuid = ? AND version = ? AND revoked_at IS NULL
            AND uses_consumed < uses_allowed
            AND (expires_at IS NULL OR expires_at > ?)`,
      ).run(entityUuid, version, isoTime(now)).changes),
      value: undefined,
    }),
  });
  return license(rowByEntity(db, "disclosure_licenses", entityUuid)!);
}

/** Compose one-shot use consumption inside RA-P13's existing nuclear transaction. */
export function consumeLicenseOnceInExistingTransaction(
  db: DatabaseSync,
  input: ConsumeLicenseOnceInput,
): DisclosureLicense {
  return consumeLicenseOnceInTransaction(db, input);
}

export function consumeLicenseOnce(
  db: DatabaseSync,
  input: ConsumeLicenseOnceInput,
): DisclosureLicense {
  return withImmediateTransaction(db, () => consumeLicenseOnceInTransaction(db, input));
}

export function readEligibilityBundle(
  db: DatabaseSync,
  input: {
    principalId?: string;
    guildId?: string;
    channelId?: string;
    nowMs?: number;
  },
): EligibilityBundle {
  const now = timeMs(input.nowMs);
  const nowIso = isoTime(now);
  db.exec("BEGIN");
  try {
    const barrier = readAuthorityBarrier(db);
    const permits = input.principalId
      ? db.prepare(
        `SELECT * FROM social_permits
          WHERE principal_id = ? AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY granted_at, entity_uuid`,
      ).all(input.principalId, nowIso).map((value) => permit(value as Row))
      : [];
    const prohibitions = db.prepare(
      `SELECT * FROM owner_prohibitions
        WHERE cleared_at IS NULL AND (
          (? IS NOT NULL AND target_principal_id = ?) OR
          (? IS NOT NULL AND target_room_id = ?)
        )
        ORDER BY created_at, entity_uuid`,
    ).all(
      input.principalId ?? null,
      input.principalId ?? null,
      input.guildId && input.channelId ? `room:${input.guildId}:${input.channelId}` : null,
      input.guildId && input.channelId ? `room:${input.guildId}:${input.channelId}` : null,
    ).map((value) => prohibition(value as Row));
    const trusted = input.guildId && input.channelId
      ? asRow(db.prepare(
        "SELECT * FROM trusted_rooms WHERE guild_id = ? AND channel_id = ?",
      ).get(input.guildId, input.channelId))
      : undefined;
    const restrictions = input.principalId
      ? db.prepare(
        `SELECT * FROM recipient_restrictions
          WHERE principal_id = ? AND cleared_at IS NULL
          ORDER BY set_at, entity_uuid`,
      ).all(input.principalId).map((value) => restriction(value as Row))
      : [];
    const boundaries = input.principalId
      ? db.prepare(
        `SELECT * FROM ashley_boundaries
          WHERE superseded_at IS NULL AND (target_principal_id IS NULL OR target_principal_id = ?)
          ORDER BY created_at, entity_uuid`,
      ).all(input.principalId).map((value) => boundary(value as Row))
      : [];
    const licenses = input.principalId
      ? db.prepare(
        `SELECT * FROM disclosure_licenses
          WHERE source_principal = ? AND revoked_at IS NULL
            AND uses_consumed < uses_allowed
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY grant_ref, entity_uuid`,
      ).all(input.principalId, nowIso).map((value) => license(value as Row))
      : [];
    const result: EligibilityBundle = {
      barrier: { epoch: barrier.epoch, revision: barrier.revision },
      absentAsOfMs: now,
      permits,
      prohibitions,
      trustedRoom: trusted ? trustedRoom(trusted) : null,
      restrictions,
      boundaries,
      licenses,
    };
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve the read failure */ }
    throw error;
  }
}

export type SocialEligibilityVerdict = "drop" | "capture_quarantine" | "allow_social";

/** Mechanical policy projection used by the advisory bot-facing route. */
export function classifyEligibility(
  bundle: EligibilityBundle,
  location: "dm" | "room",
  options: { roomSeedActive?: boolean } = {},
): { verdict: SocialEligibilityVerdict; audienceHint: "dm" | "room" | "unknown" } {
  // A room capture is ambient perception. A person-scoped direct prohibition
  // bars addressing that person, but it does not erase the room's shared
  // reality. Room-targeted hard policy still blocks the room as a destination.
  const blockedByProhibition = bundle.prohibitions.some((item) =>
    item.hardStop || item.scope === "no_contact"
      || (location === "dm" && (item.scope === "no_dm" || item.scope === "no_direct"))
      || (location === "room" && item.targetRoomId != null && item.scope === "no_direct"));
  const blockedByRestriction = location === "dm" && bundle.restrictions.some((item) =>
    item.kind === "do_not_contact" || item.kind === "no_dm");
  const blockedByBoundary = bundle.boundaries.some((item) =>
    item.scope === "no_contact"
      || (location === "dm" && (item.scope === "no_direct" || item.scope === "no_dm")));
  if (blockedByProhibition || blockedByRestriction || blockedByBoundary) {
    return { verdict: "capture_quarantine", audienceHint: location };
  }
  if (location === "room" && options.roomSeedActive === true && bundle.trustedRoom?.mode === "trusted_social") {
    return { verdict: "allow_social", audienceHint: "room" };
  }
  if (location === "dm" && bundle.permits.some((item) =>
    item.scope === "person_wide" || item.scope === "dm_only")) {
    return { verdict: "allow_social", audienceHint: "dm" };
  }
  return { verdict: "capture_quarantine", audienceHint: location };
}
