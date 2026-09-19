import type { DatabaseSync } from "node:sqlite";
import { isAuthorizedOwnerId } from "../../owner-auth.js";
import { env } from "../../env.js";
import type { ConversationEvidenceRecord, ThoughtContinuityRecovery } from "./types.js";

export type CanonicalOwnerResolutionInput = {
  payload?: Record<string, unknown> | null;
  cycle?: { occupantId?: string | null; conversationId?: string } | null;
  wake?: { occupantId?: string | null } | null;
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
 */
export function resolveCanonicalOwnerPrincipal(
  db: DatabaseSync | undefined,
  input: CanonicalOwnerResolutionInput,
): string | null {
  // 1. Explicit authorized payload ownerId
  const payloadOwnerId = text(input.payload?.ownerId);
  if (payloadOwnerId && isAuthorizedOwnerId(payloadOwnerId)) {
    return payloadOwnerId;
  }

  // 2. Authorized cycle or wake occupant principal
  const cycleOccupant = text(input.cycle?.occupantId);
  if (cycleOccupant && isAuthorizedOwnerId(cycleOccupant)) {
    return cycleOccupant;
  }
  const wakeOccupant = text(input.wake?.occupantId);
  if (wakeOccupant && isAuthorizedOwnerId(wakeOccupant)) {
    return wakeOccupant;
  }

  // 3. Direct Owner trigger evidence principal
  if (input.triggerEvidence?.role === "owner") {
    const speakerPrincipal = text(input.triggerEvidence.speakerPrincipalId);
    if (speakerPrincipal && isAuthorizedOwnerId(speakerPrincipal)) {
      return speakerPrincipal;
    }
    if (!speakerPrincipal && env.discordOwnerId && isAuthorizedOwnerId(env.discordOwnerId)) {
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
      if (predOwnerId && isAuthorizedOwnerId(predOwnerId)) {
        return predOwnerId;
      }

      const predWakeId = text(eventRow.wake_id);
      if (predWakeId) {
        const cycleRow = db.prepare(
          "SELECT occupant_id FROM cycle_records WHERE wake_id = ? OR cycle_id = (SELECT cycle_id FROM wakes WHERE wake_id = ?)",
        ).get(predWakeId, predWakeId) as DbRow | undefined;
        const cycleOccupantId = text(cycleRow?.occupant_id);
        if (cycleOccupantId && isAuthorizedOwnerId(cycleOccupantId)) {
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
          if (sp && isAuthorizedOwnerId(sp)) {
            return sp;
          }
          if (!sp && env.discordOwnerId && isAuthorizedOwnerId(env.discordOwnerId)) {
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
          if (sp && isAuthorizedOwnerId(sp)) {
            return sp;
          }
          if (!sp && env.discordOwnerId && isAuthorizedOwnerId(env.discordOwnerId)) {
            return env.discordOwnerId;
          }
        }
      }

      const nextRepairOf = text(predPayload?.repairOfEventId) || text(eventRow.repair_of_event_id);
      predId = nextRepairOf;
    }
  }

  return null;
}
