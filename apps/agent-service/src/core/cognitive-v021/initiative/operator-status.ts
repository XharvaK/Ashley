import type { DatabaseSync } from "node:sqlite";
import { listConversationEvidence } from "../evidence/conversation-log.js";
import { listConcerns } from "../concerns/lineage.js";
import { listOccupancy } from "../concerns/occupancy.js";
import { buildOccupiedConcernProjection } from "../thought/occupied-concerns.js";
import {
  PERIODIC_CADENCE_MS,
  readSchedule,
  type PeriodicScheduleRow,
} from "./periodic-schedule.js";
import {
  listPeriodicDiagnostics,
  type PeriodicDiagnosticRecord,
} from "./periodic-diagnostics.js";
import { isPeriodicCognitionEnabled } from "../dispatch/live.js";

export type LegacyProactiveStatus = {
  enabled: boolean;
  paused: boolean;
  sentToday: number;
  maxPerDay: number;
  lastSentAt: string | null;
  minIdleHours: number;
};

export type ProactiveOperatorStatus = {
  statusAvailability: "available" | "unavailable";
  legacyProactiveEnabled: boolean;
  legacyPaused: boolean;
  legacySentToday: number;
  legacyMaxPerDay: number;
  legacyLastSentAt: string | null;
  legacyMinIdleHours: number;
  periodicCognitionEnabled: boolean;
  periodicScheduleState: "unavailable" | "not_initialized" | "waiting" | "pending" | "disabled";
  periodicCadenceMs: number;
  nextEligibleAt: string | null;
  pendingOccurrenceId: string | null;
  activeConversationId: string | null;
  lastOwnerEvidenceAt: string | null;
  eligibleOccupiedConcernCount: number;
  lastPeriodicOccurrence: {
    outcome: string;
    detail: string | null;
    eligibleAt: string;
    closedAt: string;
  } | null;
  lastProactiveThought: {
    cycleId: string;
    generation: number;
    conversationId: string;
    triggerKind: string;
    state: string;
    admittedAt: string;
  } | null;
  lastProactiveDelivery: {
    outboxId: number;
    cycleId: string;
    generation: number;
    status: string;
    suppressed: boolean;
    nuclearReservationId: number | null;
  } | null;
  /**
   * P2 shadow: stance observed on the latest published settlement, if queried
   * from existing evidence. Absent means no expressed initiative preference.
   * Observational only; never a behavior input.
   */
  lastInitiativePreference: {
    stance: "willing" | "strong" | "absent";
    settlementId: string | null;
    cycleId: string | null;
  } | null;
};

function iso(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

function activeConversationId(nuclear: DatabaseSync, ownerId: string): string | null {
  const row = nuclear.prepare(
    `SELECT id FROM mem_threads
      WHERE owner_id = ? AND status = 'active'
      ORDER BY updated_at DESC LIMIT 1`,
  ).get(ownerId) as { id?: unknown } | undefined;
  return typeof row?.id === "string" && row.id.trim() ? row.id : null;
}

function scheduleState(
  schedule: PeriodicScheduleRow | null,
  enabled: boolean,
): ProactiveOperatorStatus["periodicScheduleState"] {
  if (!enabled) return "disabled";
  if (!schedule) return "not_initialized";
  return schedule.pendingOccurrenceId ? "pending" : "waiting";
}

function lastPeriodicOccurrence(
  diagnostic: PeriodicDiagnosticRecord | undefined,
): ProactiveOperatorStatus["lastPeriodicOccurrence"] {
  if (!diagnostic) return null;
  return {
    outcome: diagnostic.occurrence.disposition,
    detail: diagnostic.occurrence.detail,
    eligibleAt: new Date(diagnostic.occurrence.eligibleAtMs).toISOString(),
    closedAt: new Date(diagnostic.occurrence.closedAtMs).toISOString(),
  };
}

function lastProactiveThought(
  diagnostics: readonly PeriodicDiagnosticRecord[],
): ProactiveOperatorStatus["lastProactiveThought"] {
  const cycle = diagnostics.find((diagnostic) => diagnostic.cycle !== null)?.cycle;
  if (!cycle) return null;
  return {
    cycleId: cycle.cycleId,
    generation: cycle.generation,
    conversationId: cycle.conversationId,
    triggerKind: cycle.triggerKind,
    state: cycle.state,
    admittedAt: new Date(cycle.admittedAtMs).toISOString(),
  };
}

function lastProactiveDelivery(
  diagnostics: readonly PeriodicDiagnosticRecord[],
): ProactiveOperatorStatus["lastProactiveDelivery"] {
  for (const diagnostic of diagnostics) {
    const speech = diagnostic.publication.speechOutbox;
    if (!speech) continue;
    return {
      outboxId: speech.outboxId,
      cycleId: speech.cycleId,
      generation: speech.generation,
      status: speech.sendStatus,
      suppressed: speech.suppressed,
      nuclearReservationId: speech.nuclearReservationId,
    };
  }
  return null;
}

export function buildProactiveOperatorStatus(input: {
  sidecar: DatabaseSync;
  nuclear: DatabaseSync;
  observabilityDb: DatabaseSync;
  ownerId: string;
  legacy: LegacyProactiveStatus;
  nowMs?: number;
}): ProactiveOperatorStatus {
  const periodicEnabled = isPeriodicCognitionEnabled();
  const schedule = readSchedule(input.sidecar);
  const conversationId = activeConversationId(input.nuclear, input.ownerId);
  const evidence = conversationId
    ? listConversationEvidence(input.sidecar, conversationId)
      .filter((row) => row.role === "owner")
      .at(-1)
    : undefined;
  const occupancy = conversationId ? listOccupancy(input.sidecar, conversationId) : [];
  const concerns = conversationId ? listConcerns(input.sidecar, conversationId) : [];
  const diagnostics = listPeriodicDiagnostics(input.sidecar, input.observabilityDb, {
    limit: 100,
    nowMs: input.nowMs,
  });
  const latest = diagnostics[0];

  return {
    statusAvailability: "available",
    legacyProactiveEnabled: input.legacy.enabled,
    legacyPaused: input.legacy.paused,
    legacySentToday: input.legacy.sentToday,
    legacyMaxPerDay: input.legacy.maxPerDay,
    legacyLastSentAt: input.legacy.lastSentAt,
    legacyMinIdleHours: input.legacy.minIdleHours,
    periodicCognitionEnabled: periodicEnabled,
    periodicScheduleState: scheduleState(schedule, periodicEnabled),
    periodicCadenceMs: PERIODIC_CADENCE_MS,
    nextEligibleAt: iso(schedule?.nextEligibleAtMs),
    pendingOccurrenceId: schedule?.pendingOccurrenceId ?? null,
    activeConversationId: conversationId,
    lastOwnerEvidenceAt: iso(evidence?.createdAtMs),
    eligibleOccupiedConcernCount: buildOccupiedConcernProjection(occupancy, concerns).length,
    lastPeriodicOccurrence: lastPeriodicOccurrence(latest),
    lastProactiveThought: lastProactiveThought(diagnostics),
    lastProactiveDelivery: lastProactiveDelivery(diagnostics),
    // P2 shadow: stance + refs from the latest accepted settlement row only.
    // The bounded raw reason is never surfaced here; the settlement owns it.
    lastInitiativePreference: lastInitiativePreference(input.sidecar),
  };
}

function lastInitiativePreference(
  sidecar: DatabaseSync,
): ProactiveOperatorStatus["lastInitiativePreference"] {
  let row: { payload_json?: unknown } | undefined;
  try {
    row = sidecar.prepare(
      `SELECT payload_json FROM settlements ORDER BY rowid DESC LIMIT 1`,
    ).get() as { payload_json?: unknown } | undefined;
  } catch {
    return null;
  }
  if (!row || typeof row.payload_json !== "string") return null;
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const preference = record.initiativePreference;
  if (preference === undefined) {
    return {
      stance: "absent",
      settlementId: typeof record.settlementId === "string" ? record.settlementId : null,
      cycleId: typeof record.cycleId === "string" ? record.cycleId : null,
    };
  }
  if (typeof preference !== "object" || preference === null || Array.isArray(preference)) return null;
  const stance = (preference as Record<string, unknown>).stance;
  if (stance !== "willing" && stance !== "strong") return null;
  return {
    stance,
    settlementId: typeof record.settlementId === "string" ? record.settlementId : null,
    cycleId: typeof record.cycleId === "string" ? record.cycleId : null,
  };
}

export function unavailableProactiveOperatorStatus(input: {
  legacy: LegacyProactiveStatus;
}): ProactiveOperatorStatus {
  return {
    statusAvailability: "unavailable",
    legacyProactiveEnabled: input.legacy.enabled,
    legacyPaused: input.legacy.paused,
    legacySentToday: input.legacy.sentToday,
    legacyMaxPerDay: input.legacy.maxPerDay,
    legacyLastSentAt: input.legacy.lastSentAt,
    legacyMinIdleHours: input.legacy.minIdleHours,
    periodicCognitionEnabled: isPeriodicCognitionEnabled(),
    periodicScheduleState: "unavailable",
    periodicCadenceMs: PERIODIC_CADENCE_MS,
    nextEligibleAt: null,
    pendingOccurrenceId: null,
    activeConversationId: null,
    lastOwnerEvidenceAt: null,
    eligibleOccupiedConcernCount: 0,
    lastPeriodicOccurrence: null,
    lastProactiveThought: null,
    lastProactiveDelivery: null,
    lastInitiativePreference: null,
  };
}
