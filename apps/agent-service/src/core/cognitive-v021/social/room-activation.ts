import type { DatabaseSync } from "node:sqlite";
import {
  appendInboxEventInTransaction,
  getCurrentCycle,
} from "../cycle/inbox.js";
import { absorbFreshMessagesInTransaction } from "../cycle/fence.js";
import { getEvidenceByRowId } from "../evidence/conversation-log.js";
import type { ConversationEvidenceRecord } from "../types.js";
import type { DepRef, HardDependencyBundle } from "./types.js";
import {
  classifyEligibility,
  readEligibilityBundle,
  type EligibilityBundle,
} from "../../relationship/social-authority.js";
import { isRoomSeedActive } from "../../relationship/room-seeding.js";

type Row = Record<string, unknown>;

export type RoomPromotionResult = Readonly<{
  promoted: number;
  waiting: number;
  rejected: number;
  cycleIds: readonly string[];
  eventIds: readonly string[];
}>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Row
    : null;
}

function payloadOf(value: unknown): Row {
  if (typeof value !== "string") return {};
  try { return record(JSON.parse(value)) ?? {}; } catch { return {}; }
}

export function roomIdentity(guildId: string, channelId: string): string {
  const guild = guildId.trim();
  const channel = channelId.trim();
  if (!guild || !channel) throw new Error("room_identity_required");
  return `room:${guild}:${channel}`;
}

export function configuredRoomChannel(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.RA_ROOM_PUBLICATION?.trim();
  return value || null;
}

/** The staged room gate is one explicitly configured Discord channel. */
export function isRoomPublicationEnabled(
  env: NodeJS.ProcessEnv = process.env,
  channelId?: string,
): boolean {
  const configured = configuredRoomChannel(env);
  return isRoomSeedActive(env) && configured !== null
    && (channelId === undefined || configured === channelId.trim());
}

export type OwnerRoomDestination = Readonly<{
  kind: "room";
  roomId: string;
  guildId: string;
  channelId: string;
  ownerRoom: true;
}>;

/** Distinguish an authenticated Owner room destination from external room speech. */
export function isOwnerRoomDestination(value: unknown): value is OwnerRoomDestination {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== "room"
    || candidate.ownerRoom !== true
    || typeof candidate.roomId !== "string"
    || typeof candidate.guildId !== "string"
    || typeof candidate.channelId !== "string"
  ) return false;
  const guildId = candidate.guildId.trim();
  const channelId = candidate.channelId.trim();
  if (guildId !== candidate.guildId || channelId !== candidate.channelId) return false;
  try {
    return candidate.roomId === roomIdentity(guildId, channelId);
  } catch {
    return false;
  }
}

function roomLocation(evidence: ConversationEvidenceRecord): {
  guildId: string;
  channelId: string;
  speakerPrincipalId: string;
} | null {
  const location = record(evidence.location);
  const guildId = text(location?.guildId);
  const channelId = text(location?.channelId);
  const speakerPrincipalId = text(evidence.speakerPrincipalId);
  if (location?.kind !== "room" || !guildId || !channelId || !speakerPrincipalId) return null;
  return { guildId, channelId, speakerPrincipalId };
}

function markerRows(sidecar: DatabaseSync, limit: number): Row[] {
  return sidecar.prepare(
    `SELECT id, conversation_id, payload_json
       FROM inbox_events
      WHERE kind = 'external_eligible_pending'
        AND wake_id IS NULL
        AND state = 'pending'
        AND status = 'pending'
      ORDER BY created_at_ms ASC, id ASC
      LIMIT ?`,
  ).all(limit) as Row[];
}

function markPromotionMarkerConsumed(
  sidecar: DatabaseSync,
  markerId: string,
  nowMs: number,
): void {
  sidecar.prepare(
    `UPDATE inbox_events
        SET status = 'consumed', state = 'terminal', terminal_reason = 'completed',
            consumed_at_ms = ?, claim_token = NULL, worker_id = NULL,
            lease_expires_at_ms = NULL, next_eligible_at_ms = NULL
      WHERE id = ? AND kind = 'external_eligible_pending'
        AND wake_id IS NULL AND state = 'pending' AND status = 'pending'`,
  ).run(nowMs, markerId);
}

function activeRoomEligibility(
  nuclear: DatabaseSync,
  evidence: ConversationEvidenceRecord,
  nowMs: number,
): { bundle: EligibilityBundle; location: NonNullable<ReturnType<typeof roomLocation>> } | null {
  const location = roomLocation(evidence);
  if (!location) return null;
  const bundle = readEligibilityBundle(nuclear, {
    principalId: location.speakerPrincipalId,
    guildId: location.guildId,
    channelId: location.channelId,
    nowMs,
  });
  const decision = classifyEligibility(bundle, "room", { roomSeedActive: true });
  return decision.verdict === "allow_social" ? { bundle, location } : null;
}

/**
 * Promote room captures only for the one staged room. This is the room-side
 * constructor for an external cognitive cycle; it is never called by the
 * capture or batch routes and remains closed unless both room gates are set.
 */
export function promoteEligibleRoomPending(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  options: {
    nowMs?: number;
    ownerId?: string;
    limit?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
): RoomPromotionResult {
  const env = options.env ?? process.env;
  const configuredChannel = configuredRoomChannel(env);
  if (!isRoomPublicationEnabled(env, configuredChannel ?? undefined) || !configuredChannel) {
    return { promoted: 0, waiting: 0, rejected: 0, cycleIds: [], eventIds: [] };
  }

  const nowMs = options.nowMs ?? Date.now();
  const limit = Math.max(1, Math.min(1000, Math.floor(options.limit ?? 100)));
  const promoted: string[] = [];
  const eventIds: string[] = [];
  let waiting = 0;
  let rejected = 0;

  for (const row of markerRows(sidecar, limit)) {
    const markerId = text(row.id);
    const conversationId = text(row.conversation_id);
    const payload = payloadOf(row.payload_json);
    const evidenceRowId = text(payload.evidenceRowId);
    if (!markerId || !conversationId || !evidenceRowId || !conversationId.startsWith("room:")) {
      waiting += 1;
      continue;
    }
    const evidence = getEvidenceByRowId(sidecar, evidenceRowId);
    const location = evidence ? roomLocation(evidence) : null;
    if (!evidence || !location || location.channelId !== configuredChannel
      || conversationId !== roomIdentity(location.guildId, location.channelId)) {
      waiting += 1;
      continue;
    }

    let eligibility: ReturnType<typeof activeRoomEligibility>;
    try {
      eligibility = activeRoomEligibility(nuclear, evidence, nowMs);
    } catch {
      waiting += 1;
      continue;
    }
    if (!eligibility) {
      waiting += 1;
      continue;
    }

    sidecar.exec("BEGIN IMMEDIATE");
    try {
      const existingMarker = sidecar.prepare(
        "SELECT state, status, wake_id FROM inbox_events WHERE id = ? AND kind = 'external_eligible_pending'",
      ).get(markerId) as { state?: unknown; status?: unknown; wake_id?: unknown } | undefined;
      if (!existingMarker || existingMarker.state !== "pending" || existingMarker.status !== "pending" || existingMarker.wake_id !== null) {
        sidecar.exec("COMMIT");
        continue;
      }

      const current = getCurrentCycle(sidecar, conversationId, { includeIdle: false });
      const roomId = roomIdentity(location.guildId, location.channelId);
      const utteranceId = `external:utterance:${evidence.rowId}`;
      const destination = {
        kind: "room" as const,
        roomId,
        guildId: location.guildId,
        channelId: location.channelId,
      };
      const event = appendInboxEventInTransaction(sidecar, {
        id: utteranceId,
        wakeId: current?.wakeId,
        conversationId,
        kind: "external_utterance",
        payload: {
          ...(current ? { cycleId: current.cycleId } : {}),
          evidenceRowId: evidence.rowId,
          captureRef: text(payload.captureRef) ?? `extcap:${evidence.rowId}`,
          discordMessageId: text(payload.discordMessageId) ?? evidence.discordMessageIds[0] ?? evidence.rowId,
          ownerId: options.ownerId ?? "default",
          channel: "discord",
          threadId: conversationId,
          externalDestination: destination,
          audience: { kind: "room", roomId },
        },
        createdAtMs: nowMs,
        capturedAuthorityRevision: eligibility.bundle.barrier.revision,
      }, utteranceId);

      const eventPayload = record(event.payload);
      const cycleId = text(eventPayload?.cycleId);
      if (!cycleId) throw new Error("external_cycle_missing");
      absorbFreshMessagesInTransaction(sidecar, cycleId, [evidence.rowId], {
        nowMs,
        projectionVersion: "ra-p16-room-v1",
      });

      const markerEnvelope = sidecar.prepare(
        "SELECT envelope_json FROM inbox_events WHERE id = ?",
      ).get(markerId) as { envelope_json?: unknown } | undefined;
      if (markerEnvelope?.envelope_json != null) {
        const envelopeJson = typeof markerEnvelope.envelope_json === "string"
          ? markerEnvelope.envelope_json
          : JSON.stringify(markerEnvelope.envelope_json);
        sidecar.prepare("UPDATE inbox_events SET envelope_json = ? WHERE id = ?")
          .run(envelopeJson, event.id);
      }
      markPromotionMarkerConsumed(sidecar, markerId, nowMs);
      sidecar.exec("COMMIT");
      promoted.push(cycleId);
      eventIds.push(event.id);
    } catch {
      try { sidecar.exec("ROLLBACK"); } catch { /* preserve promotion failure */ }
      rejected += 1;
    }
  }

  return {
    promoted: promoted.length,
    waiting,
    rejected,
    cycleIds: promoted,
    eventIds,
  };
}

function dep(
  bundle: EligibilityBundle,
  table: string,
  key: string,
  rowRevision: number | null,
): DepRef {
  return {
    table,
    key,
    rowRevision,
    barrier: { epoch: bundle.barrier.epoch, revision: bundle.barrier.revision },
    absentAsOfMs: bundle.absentAsOfMs,
  };
}

function roomLicenseRefs(
  nuclear: DatabaseSync,
  ownerId: string,
  roomId: string,
  nowMs: number,
): Array<{ entityUuid: string; version: number }> {
  const rows = nuclear.prepare(
    `SELECT entity_uuid, version, grantee_audience_json
       FROM disclosure_licenses
      WHERE owner_id = ? AND revoked_at IS NULL
        AND uses_consumed < uses_allowed
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY grant_ref, entity_uuid`,
  ).all(ownerId, new Date(nowMs).toISOString()) as Row[];
  return rows.flatMap((row) => {
    let audience: Row | null = null;
    try { audience = record(JSON.parse(String(row.grantee_audience_json ?? ""))); } catch { audience = null; }
    if (audience?.kind !== "room" || audience.roomId !== roomId) return [];
    const entityUuid = text(row.entity_uuid);
    const version = Number(row.version);
    return entityUuid && Number.isInteger(version) ? [{ entityUuid, version }] : [];
  });
}

function roomProhibitionRevision(
  nuclear: DatabaseSync,
  ownerId: string,
  roomId: string,
): number | null {
  const row = nuclear.prepare(
    `SELECT version FROM owner_prohibitions
      WHERE owner_id = ? AND target_room_id = ? AND cleared_at IS NULL
      ORDER BY version DESC, rowid DESC LIMIT 1`,
  ).get(ownerId, roomId) as Row | undefined;
  const version = Number(row?.version);
  return Number.isInteger(version) ? version : null;
}

export type RoomAuthorityBinding = Readonly<{
  bundle: HardDependencyBundle;
  licenseRefs: readonly string[];
}>;

/** Build a stable-room S5 dependency bundle without requiring a per-bot permit. */
export function buildRoomAuthorityBinding(
  nuclear: DatabaseSync,
  input: {
    ownerId: string;
    roomId: string;
    guildId: string;
    channelId: string;
    nowMs?: number;
  },
): RoomAuthorityBinding {
  const roomId = roomIdentity(input.guildId, input.channelId);
  if (input.roomId !== roomId) throw new Error("room_identity_mismatch");
  const nowMs = input.nowMs ?? Date.now();
  const eligibility = readEligibilityBundle(nuclear, {
    guildId: input.guildId,
    channelId: input.channelId,
    nowMs,
  });
  if (eligibility.trustedRoom?.mode !== "trusted_social") throw new Error("room_not_authorized");
  const licenses = roomLicenseRefs(nuclear, input.ownerId, roomId, nowMs);
  return {
    bundle: {
      permit: dep(eligibility, "social_permits", `room:${roomId}`, null),
      prohibitionAbsence: dep(
        eligibility,
        "owner_prohibitions",
        roomId,
        roomProhibitionRevision(nuclear, input.ownerId, roomId),
      ),
      roomState: dep(eligibility, "trusted_rooms", `room:${input.guildId}:${input.channelId}`, 1),
      recipientRestrictionAbsence: dep(eligibility, "recipient_restrictions", `room:${roomId}`, null),
      ashleyBoundaryAbsence: dep(eligibility, "ashley_boundaries", `room:${roomId}`, null),
      licenses: licenses.map((item) => dep(eligibility, "disclosure_licenses", item.entityUuid, item.version)),
      capability: dep(eligibility, "capability_authority", "capability:room", null),
      destinationAccess: dep(eligibility, "destination_access", `room:${roomId}`, null),
      barrier: { epoch: eligibility.barrier.epoch, revision: eligibility.barrier.revision },
    },
    licenseRefs: licenses.map((item) => item.entityUuid),
  };
}
