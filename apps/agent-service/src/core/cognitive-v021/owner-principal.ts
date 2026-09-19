import type { DatabaseSync } from "node:sqlite";
import { isAuthorizedOwnerId } from "../../owner-auth.js";
import { env } from "../../env.js";
import type { ConversationEvidenceRecord, ThoughtContinuityRecovery } from "./types.js";

export type CanonicalOwnerResolutionInput = {
  payload?: Record<string, unknown> | null;
  cycle?: { occupantId?: string | null; conversationId?: string; triggerKind?: string } | null;
  wake?: { occupantId?: string | null; triggerKind?: string } | null;
  triggerEvidence?: ConversationEvidenceRecord | null;
  continuityRecovery?: {
    primaryPredecessorEventId?: string | null;
    outstandingOwnerEvidenceRefs?: readonly string[] | string[];
    reason?: string;
  } | null;
  predecessorEventId?: string | null;
};

type DbRow = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidOwnerCandidate(id: string): boolean {
  if (!id) return false;
  const lower = id.toLowerCase();
  if (lower === "owner" || lower === "default" || lower === "system" || lower === "user") {
    return false;
  }
  return isAuthorizedOwnerId(id);
}

function parsePayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function isAutonomousCuriosityContext(
  input: CanonicalOwnerResolutionInput,
  db?: DatabaseSync,
): boolean {
  const payload = input.payload;
  if (payload) {
    const originKind = text(payload.originKind);
    if (originKind === "ASHLEY_CURIOSITY" || originKind === "SYSTEM_INITIATIVE") {
      return true;
    }
    const triggerRef = text(payload.triggerRef);
    if (triggerRef.startsWith("curiosity:") || triggerRef.startsWith("initiative:")) {
      return true;
    }
    const undertakingId = text(payload.workerUndertakingId);
    if (undertakingId && db) {
      const undertakingRow = db.prepare(
        "SELECT origin_kind FROM worker_undertakings WHERE undertaking_id = ?",
      ).get(undertakingId) as DbRow | undefined;
      const opOrigin = text(undertakingRow?.origin_kind);
      if (opOrigin === "ASHLEY_CURIOSITY" || opOrigin === "SYSTEM_INITIATIVE") {
        return true;
      }
    }
  }

  const triggerKind = text(input.cycle?.triggerKind) || text(input.wake?.triggerKind);
  if (
    triggerKind === "idle_opportunity" ||
    triggerKind === "commitment_due" ||
    triggerKind === "future_trigger_due" ||
    triggerKind === "subscription_item"
  ) {
    return true;
  }

  return false;
}

/**
 * Canonical owner principal resolution (Campaign-1 / Incident 2026-09-19 repair).
 *
 * Invariant: Owner-private licensed speech requires a mechanically proven canonical Owner principal.
 * Never treat conversation/thread UUID as canonical Owner identity.
 *
 * Resolves from, in descending trustworthiness:
 * 1. explicit authorized payload ownerId
 * 2. authorized cycle / wake occupant principal
 * 3. direct Owner trigger evidence principal
 * 4. predecessor lineage (via continuityRecovery or repairOfEventId) payload/wake/evidence
 * 5. Host-configured canonical Owner root of trust (single-Owner system)
 */
export function resolveCanonicalOwnerPrincipal(
  db: DatabaseSync | undefined,
  input: CanonicalOwnerResolutionInput,
): string | null {
  // 1. Explicit authorized payload ownerId
  const payloadOwnerId = text(input.payload?.ownerId);
  if (payloadOwnerId) {
    if (isValidOwnerCandidate(payloadOwnerId)) {
      return payloadOwnerId;
    }
    // An explicit, unprovable/unauthorized ownerId in payload rejects immediately:
    // never substitute fallback when caller explicitly claims an invalid owner.
    return null;
  }

  // 2. Authorized cycle or wake occupant principal
  const cycleOccupant = text(input.cycle?.occupantId);
  if (cycleOccupant) {
    if (isValidOwnerCandidate(cycleOccupant)) {
      return cycleOccupant;
    }
    return null;
  }
  const wakeOccupant = text(input.wake?.occupantId);
  if (wakeOccupant) {
    if (isValidOwnerCandidate(wakeOccupant)) {
      return wakeOccupant;
    }
    return null;
  }

  // 3. Direct Owner trigger evidence principal
  if (input.triggerEvidence?.role === "owner") {
    const speakerPrincipal = text(input.triggerEvidence.speakerPrincipalId);
    if (speakerPrincipal) {
      if (isValidOwnerCandidate(speakerPrincipal)) {
        return speakerPrincipal;
      }
      return null;
    }
    if (env.discordOwnerId && isValidOwnerCandidate(env.discordOwnerId)) {
      return env.discordOwnerId;
    }
  }

  // 4. Predecessor lineage
  if (db) {
    const continuityPred = text(input.continuityRecovery?.primaryPredecessorEventId);
    const directPred = text(input.predecessorEventId);
    const payloadRepairOf = text(input.payload?.repairOfEventId);
    const storedContinuity = input.payload?.continuityRecovery as Record<string, unknown> | undefined;
    const storedPred = text(storedContinuity?.primaryPredecessorEventId);

    let predId = continuityPred || directPred || payloadRepairOf || storedPred;
    const maxDepth = 5;
    let depth = 0;
    const seen = new Set<string>();

    while (predId && depth < maxDepth && !seen.has(predId)) {
      seen.add(predId);
      depth++;

      const eventRow = db.prepare(
        "SELECT id, payload_json, wake_id, repair_of_event_id FROM inbox_events WHERE id = ?",
      ).get(predId) as DbRow | undefined;

      if (!eventRow) break;

      const predPayload = parsePayload(eventRow.payload_json);
      const predOwnerId = text(predPayload?.ownerId);
      if (predOwnerId && isValidOwnerCandidate(predOwnerId)) {
        return predOwnerId;
      }

      const predWakeId = text(eventRow.wake_id);
      if (predWakeId) {
        const cycleRow = db.prepare(
          "SELECT occupant_id FROM cycle_records WHERE wake_id = ? OR cycle_id = (SELECT cycle_id FROM wakes WHERE wake_id = ?)",
        ).get(predWakeId, predWakeId) as DbRow | undefined;
        const cycleOccupantId = text(cycleRow?.occupant_id);
        if (cycleOccupantId && isValidOwnerCandidate(cycleOccupantId)) {
          return cycleOccupantId;
        }
      }

      const evidenceRowId = text(predPayload?.evidenceRowId);
      if (evidenceRowId) {
        const evRow = db.prepare(
          "SELECT speaker_principal_id, role FROM conversation_evidence_log WHERE row_id = ?",
        ).get(evidenceRowId) as DbRow | undefined;
        if (text(evRow?.role) === "owner") {
          const sp = text(evRow?.speaker_principal_id);
          if (sp && isValidOwnerCandidate(sp)) {
            return sp;
          }
          if (!sp && env.discordOwnerId && isValidOwnerCandidate(env.discordOwnerId)) {
            return env.discordOwnerId;
          }
        }
      }

      const refs = Array.isArray(storedContinuity?.outstandingOwnerEvidenceRefs)
        ? storedContinuity.outstandingOwnerEvidenceRefs
        : Array.isArray(input.continuityRecovery?.outstandingOwnerEvidenceRefs)
          ? input.continuityRecovery.outstandingOwnerEvidenceRefs
          : [];

      for (const ref of refs) {
        const refStr = text(ref);
        if (!refStr) continue;
        const evRow = db.prepare(
          "SELECT speaker_principal_id, role FROM conversation_evidence_log WHERE row_id = ?",
        ).get(refStr) as DbRow | undefined;
        if (text(evRow?.role) === "owner") {
          const sp = text(evRow?.speaker_principal_id);
          if (sp && isValidOwnerCandidate(sp)) {
            return sp;
          }
          if (!sp && env.discordOwnerId && isValidOwnerCandidate(env.discordOwnerId)) {
            return env.discordOwnerId;
          }
        }
      }

      const nextRepairOf = text(predPayload?.repairOfEventId) || text(eventRow.repair_of_event_id);
      predId = nextRepairOf;
    }
  }

  // 5. Host-configured canonical Owner root of trust (single-Owner system)
  // Authoritative identity truth for autonomous / Host-owned cycles (curiosity, idle, etc.)
  const configuredOwner = text(env.discordOwnerId);
  if (configuredOwner && isValidOwnerCandidate(configuredOwner)) {
    if (isAutonomousCuriosityContext(input, db)) {
      return configuredOwner;
    }
  }

  return null;
}
