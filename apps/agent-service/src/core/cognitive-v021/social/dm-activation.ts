import type { DatabaseSync } from "node:sqlite";
import {
  appendInboxEventInTransaction,
  getCurrentCycle,
} from "../cycle/inbox.js";
import { absorbFreshMessagesInTransaction } from "../cycle/fence.js";
import {
  getEvidenceByRowId,
} from "../evidence/conversation-log.js";
import type { ConversationEvidenceRecord } from "../types.js";
import type { DepRef, HardDependencyBundle } from "./types.js";
import {
  classifyEligibility,
  readEligibilityBundle,
  type EligibilityBundle,
} from "../../relationship/social-authority.js";
import { getRaEffectiveConfig, type RaEnvironment } from "../../relationship/ra-effective-config.js";

type Row = Record<string, unknown>;

export type ExternalDmActivation = Readonly<{
  principalId: string | null;
  cognitionEnabled: boolean;
  publicationEnabled: boolean;
}>;

export type ExternalDmPromotionResult = Readonly<{
  promoted: number;
  waiting: number;
  rejected: number;
  cycleIds: readonly string[];
  eventIds: readonly string[];
}>;

export function externalDmPrincipal(env: RaEnvironment = process.env): string | null {
  return getRaEffectiveConfig(env).dmPrincipal;
}

export function isExternalDmCognitionEnabled(env: RaEnvironment = process.env): boolean {
  const config = getRaEffectiveConfig(env);
  return config.dmCognitionEnabled && config.dmPrincipal !== null;
}

export function isExternalDmPublicationEnabled(env: RaEnvironment = process.env): boolean {
  const config = getRaEffectiveConfig(env);
  return config.dmPublicationEnabled && config.dmPrincipal !== null;
}

export function readExternalDmActivation(env: RaEnvironment = process.env): ExternalDmActivation {
  const config = getRaEffectiveConfig(env);
  return {
    principalId: config.dmPrincipal,
    cognitionEnabled: config.dmCognitionEnabled && config.dmPrincipal !== null,
    publicationEnabled: config.dmPublicationEnabled && config.dmPrincipal !== null,
  };
}

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Row
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function payloadOf(value: unknown): Row {
  if (typeof value !== "string") return {};
  try { return record(JSON.parse(value)) ?? {}; } catch { return {}; }
}

function externalDmLocation(evidence: ConversationEvidenceRecord): {
  principalId: string;
  channelId: string;
} | null {
  const location = record(evidence.location);
  if (location?.kind !== "external_dm") return null;
  const principalId = text(location.principalId);
  const channelId = text(location.channelId);
  if (!principalId || !channelId || evidence.speakerPrincipalId !== principalId) return null;
  return { principalId, channelId };
}

function markerRows(sidecar: DatabaseSync, limit: number): Row[] {
  return sidecar.prepare(
    `SELECT id, conversation_id, payload_json, created_at_ms
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

function activeDmEligibility(
  nuclear: DatabaseSync,
  evidence: ConversationEvidenceRecord,
  nowMs: number,
): { bundle: EligibilityBundle; location: { principalId: string; channelId: string } } | null {
  const location = externalDmLocation(evidence);
  if (!location) return null;
  const bundle = readEligibilityBundle(nuclear, {
    principalId: location.principalId,
    channelId: location.channelId,
    nowMs,
  });
  const decision = classifyEligibility(bundle, "dm");
  return decision.verdict === "allow_social" ? { bundle, location } : null;
}

/**
 * Promote only the exact configured DM principal. Capture and eligibility
 * markers remain durable when the activation gate is absent or partial.
 * This is the sole P15 constructor for an external cognitive wake/cycle.
 */
export function promoteEligiblePending(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  options: {
    nowMs?: number;
    ownerId?: string;
    limit?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
): ExternalDmPromotionResult {
  const activation = readExternalDmActivation(options.env);
  if (!activation.cognitionEnabled || !activation.principalId) {
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
    if (!markerId || !conversationId || !evidenceRowId || !conversationId.startsWith("dm:")) {
      waiting += 1;
      continue;
    }
    const evidence = getEvidenceByRowId(sidecar, evidenceRowId);
    const location = evidence ? externalDmLocation(evidence) : null;
    if (!evidence || !location || location.principalId !== activation.principalId) {
      waiting += 1;
      continue;
    }

    let eligibility: ReturnType<typeof activeDmEligibility>;
    try {
      eligibility = activeDmEligibility(nuclear, evidence, nowMs);
    } catch {
      waiting += 1;
      continue;
    }
    if (!eligibility) {
      // A revoke or restriction before promotion does not destroy the knock.
      // It remains pending for a later effective Owner grant.
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
      const utteranceId = `external:utterance:${evidence.rowId}`;
      const destination = {
        kind: "external_dm" as const,
        principalId: location.principalId,
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
          audience: { kind: "dm", principalId: location.principalId },
        },
        createdAtMs: nowMs,
        capturedAuthorityRevision: eligibility.bundle.barrier.revision,
      }, utteranceId);

      const eventPayload = record(event.payload);
      const cycleId = text(eventPayload?.cycleId);
      if (!cycleId) throw new Error("external_cycle_missing");
      absorbFreshMessagesInTransaction(sidecar, cycleId, [evidence.rowId], {
        nowMs,
        projectionVersion: "ra-p15-dm-v1",
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
    } catch (error) {
      try { sidecar.exec("ROLLBACK"); } catch { /* preserve promotion error */ }
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

export type ExternalDmAuthorityBinding = Readonly<{
  bundle: HardDependencyBundle;
  licenseRefs: readonly string[];
}>;

/** Build the coherent S5 dependency vector used by the external DM rail. */
export function buildExternalDmAuthorityBinding(
  nuclear: DatabaseSync,
  input: { principalId: string; channelId: string; nowMs?: number },
): ExternalDmAuthorityBinding {
  const eligibility = readEligibilityBundle(nuclear, {
    principalId: input.principalId,
    channelId: input.channelId,
    nowMs: input.nowMs,
  });
  const permit = eligibility.permits.find((item) =>
    item.scope === "person_wide" || item.scope === "dm_only");
  const licenseRefs = eligibility.licenses.map((item) => item.entityUuid);
  return {
    bundle: {
      permit: dep(eligibility, "social_permits", permit?.entityUuid ?? `principal:${input.principalId}`, permit?.version ?? null),
      prohibitionAbsence: dep(eligibility, "owner_prohibitions", `principal:${input.principalId}`, null),
      roomState: dep(eligibility, "trusted_rooms", "absent-room", null),
      recipientRestrictionAbsence: dep(eligibility, "recipient_restrictions", `principal:${input.principalId}`, null),
      ashleyBoundaryAbsence: dep(eligibility, "ashley_boundaries", `principal:${input.principalId}`, null),
      licenses: eligibility.licenses.map((item) => dep(eligibility, "disclosure_licenses", item.entityUuid, item.version)),
      capability: dep(eligibility, "capability_authority", "capability:external_dm", null),
      destinationAccess: dep(eligibility, "destination_access", `dm:${input.principalId}`, null),
      barrier: { epoch: eligibility.barrier.epoch, revision: eligibility.barrier.revision },
    },
    licenseRefs,
  };
}
