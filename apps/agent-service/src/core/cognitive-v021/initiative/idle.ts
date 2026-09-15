import type { DatabaseSync } from "node:sqlite";
import { getCycle, resolveDurableContinuationOwner } from "../cycle/inbox.js";
import { listOccupancy } from "../concerns/occupancy.js";
import { fireDueTriggers } from "./future-triggers.js";
import {
  collectSubscriptionObservations,
  listObservationSubscriptions,
  type ExternalSubscriptionPollOptions,
  type SubscriptionItem,
} from "../observation/subscriptions.js";
import { getActiveDeferredFrontier } from "../frontier/ledger.js";
import {
  type CycleRecord,
  type CommitmentEvidenceCompleteness,
  type FutureTrigger,
  type InboxEvent,
  type KernelRunResult,
  type LearnedSelfSlice,
  type MindOccupancy,
  type Observation,
  type ThoughtExecutionDispatchTruth,
  type ThoughtExecutionProvenance,
} from "../types.js";
import { admitWake, getWake } from "../wake/ledger.js";
import { occurrenceIdFor } from "../wake/identity.js";
import {
  PRIVATE_THOUGHT_POLICY_ID,
  PRIVATE_THOUGHT_WINDOW_MS,
  getPrivateReservation,
  getPrivateBudgetProjection,
  markPrivateReservationUnknown,
  releasePrivateReservation,
  reservePrivateThought,
} from "../private-budget/ledger.js";
import {
  PERIODIC_CURIOSITY_MAX_ITEMS,
  evaluatePeriodicPoll,
  periodicEventId,
  readSchedule,
  type PeriodicPollDecision,
  type PeriodicRunnable,
} from "./periodic-schedule.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import {
  persistOrVerifyObservations,
  resolveObservationBinding,
} from "../observation/persistence.js";
import {
  claimCommitmentOpportunity,
  isCommitmentsEnabled,
  listDueCommitmentOpportunities,
  recoverCommitmentOpportunities,
  recheckCommitmentOpportunity,
  type CommitmentOpportunity,
} from "../../relationship/commitment-admission.js";
import { appendSystemEvent } from "../evidence/conversation-log.js";
import { evaluateInquiryOperationalGate } from "./eligibility.js";

const GROUNDED_STATUSES = new Set(["active", "investigating", "waiting_for_evidence"]);
type IdleRunnerResult = Partial<KernelRunResult> & {
  speechMode?: "none" | "draft";
  settlement?: { speech?: { mode?: "none" | "draft" } };
  dormant?: boolean;
};

export type IdleThoughtContext = {
  sidecar: DatabaseSync;
  cycle: CycleRecord;
  wakeId: string;
  event: InboxEvent | null;
  trigger: { kind: "idle_opportunity" | "commitment_due" | "subscription_item" | "future_trigger_due"; ref: string };
  commitmentId?: string;
  realizationClause?: string;
  evidenceCompleteness?: CommitmentEvidenceCompleteness;
  occupancy: MindOccupancy[];
  observations: Observation[];
  dueTriggers: FutureTrigger[];
  privateBudgetReservation: import("../types.js").PrivateBudgetReservation;
};

export type IdleThoughtRunner = (input: IdleThoughtContext) => Promise<IdleRunnerResult> | IdleRunnerResult;
export type IdleObservationDraft = Omit<Observation, "cycleId" | "generation">;
export type IdleObservationProvider = (input: {
  conversationId: string;
  nowMs: number;
  occupancy: MindOccupancy[];
}) => Promise<IdleObservationDraft[]> | IdleObservationDraft[];

export type IdleTickOptions = {
  conversationId?: string;
  occupantId?: string;
  authorityEpoch?: number;
  nowMs?: number;
  learnedSelfSlice?: LearnedSelfSlice;
  subscriptionItems?: Array<SubscriptionItem | string>;
  curiosityItems?: Array<SubscriptionItem | string>;
  items?: Array<SubscriptionItem | string>;
  /** Optional deterministic transport boundary for admitted external watches. */
  externalWatch?: Omit<ExternalSubscriptionPollOptions, "nowMs">;
  runThought?: IdleThoughtRunner;
  thought?: IdleThoughtRunner;
  thoughtRunner?: IdleThoughtRunner;
  curiosityObservationProvider?: IdleObservationProvider;
  /** Policy identity is configuration; capacity remains ledger-owned. */
  privateBudgetPolicyId?: string;
  /**
   * P1 periodic enablement input (agent passes env resolution). Absent ⇒
   * env read inside the schedule evaluation (default OFF, fail closed).
   */
  periodicCognitionEnabled?: boolean;
  /** Nuclear relationship store used only for admitted commitment opportunities. */
  commitmentDb?: DatabaseSync;
  commitmentOwnerId?: string;
  commitment?: CommitmentOpportunity;
  /**
   * P1 pre-resolved periodic admission for this conversation (set only by
   * tickIdleOpportunity from a bound_runnable/admit_runnable decision).
   * Verified against the schedule before any admission or Thought.
   */
  periodic?: {
    occurrenceId: string;
    triggerRef: string;
    boundWakeId: string;
    reservationId: string;
    observations: IdleObservationDraft[];
  };
};

export type IdleTickReason =
  | "empty_house"
  | "active_frontier"
  | "occupancy_unreachable"
  | "wake_cancelled"
  | "wake_stale"
  | "private_compute_budget"
  | "private_compute_clock_reconciliation"
  | "private_compute_concurrent"
  | "thought_runner_missing"
  | "thought_failed"
  | "commitment_deferred"
  | "commitment_missed"
  | "commitment_not_found"
  | "periodic_not_due"
  | "periodic_disabled"
  | "periodic_pending_retained"
  | "periodic_skipped_empty"
  | "periodic_expired"
  | "periodic_terminal_observed"
  | "periodic_observation_binding_conflict";

export type IdleTickResult = {
  conversationId: string | null;
  eligible: boolean;
  reason: IdleTickReason | null;
  thoughtModelAttempts: number;
  acceptedSettlements: number;
  thoughtCalls: number;
  cycleId: string | null;
  observations: Observation[];
  firedTriggers: FutureTrigger[];
  suppressedTriggers: FutureTrigger[];
  dormant: boolean;
  /** Compatibility additions for the W9 idle truth boundary. */
  idleEligible?: boolean;
  semanticAbsenceClaim?: "yes" | "no";
  thoughtExecutionProvenance?: ThoughtExecutionProvenance;
};

/** Scheduler-only overlap guard. It is not a budget counter or capacity source. */
const activePrivateCalls = new Set<string>();
const UNKNOWN_EXECUTION_PROVENANCE: ThoughtExecutionProvenance = Object.freeze({
  dispatchTruth: "unknown",
  providerAttempts: "unknown",
});

function mergeExecutionProvenance(
  current: ThoughtExecutionProvenance | null,
  next: ThoughtExecutionProvenance | undefined,
): ThoughtExecutionProvenance | null {
  if (!next) return current;
  if (!current) return next;
  const dispatchTruth: ThoughtExecutionDispatchTruth = current.dispatchTruth === "sent"
    || next.dispatchTruth === "sent"
    ? "sent"
    : current.dispatchTruth === "unknown" || next.dispatchTruth === "unknown"
      ? "unknown"
      : "not_sent";
  const providerAttempts = current.providerAttempts === "unknown"
    || next.providerAttempts === "unknown"
    ? "unknown"
    : current.providerAttempts + next.providerAttempts;
  return { dispatchTruth, providerAttempts };
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function groundedOccupancy(db: DatabaseSync, conversationId: string): MindOccupancy[] {
  try {
    return listOccupancy(db, conversationId).filter((item) => GROUNDED_STATUSES.has(item.status));
  } catch (error) {
    throw occupancyUnreachable(error);
  }
}

function occupancyUnreachable(cause: unknown): Error {
  const error = new Error("idle_occupancy_unreachable");
  Object.defineProperty(error, "cause", { value: cause, enumerable: false });
  return error;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.toLocaleLowerCase() : String(error).toLocaleLowerCase();
}

function isOccupancyUnreachable(error: unknown): boolean {
  const message = errorText(error);
  return message === "idle_occupancy_unreachable"
    || message.includes("mind_occupancy")
    || message.includes("database is locked")
    || message.includes("database table is locked")
    || message.includes("sqlite_busy");
}

function logOccupancyUnreachable(conversationId: string | null, error: unknown): void {
  console.warn("[cognitive-v021] idle_occupancy_unreachable", {
    conversationId,
    disposition: "UNREACHABLE",
    canonicalStore: "cognitive-v021.db:mind_occupancy",
    error: errorText(error),
  });
}

function runner(options: IdleTickOptions): IdleThoughtRunner | undefined {
  return options.runThought ?? options.thought ?? options.thoughtRunner;
}

function inputItems(options: IdleTickOptions): Array<SubscriptionItem | string> {
  return [...(options.subscriptionItems ?? []), ...(options.curiosityItems ?? []), ...(options.items ?? [])];
}

function conversationCandidates(
  db: DatabaseSync,
  options: IdleTickOptions,
  firedTriggers: FutureTrigger[],
  items: Array<SubscriptionItem | string>,
): string[] {
  if (options.conversationId) return [options.conversationId];
  const ids = new Set<string>(firedTriggers.map((trigger) => trigger.conversationId));
  try {
    db.prepare(
      "SELECT DISTINCT conversation_id FROM mind_occupancy WHERE status IN ('active', 'investigating', 'waiting_for_evidence')",
    ).all().forEach((row) => {
      if (typeof row === "object" && row !== null && typeof (row as { conversation_id?: unknown }).conversation_id === "string") ids.add((row as { conversation_id: string }).conversation_id);
    });
  } catch (error) {
    throw occupancyUnreachable(error);
  }
  if (items.length > 0) {
    for (const subscription of listObservationSubscriptions(db)) ids.add(subscription.conversationId);
  }
  return [...ids].sort();
}

function remapObservation(
  observation: IdleObservationDraft | Observation,
  cycle: CycleRecord,
): Observation {
  return { ...observation, cycleId: cycle.cycleId, generation: cycle.generation };
}

function emptyResult(
  conversationId: string | null,
  reason: IdleTickReason,
  firedTriggers: FutureTrigger[],
  suppressedTriggers: FutureTrigger[],
): IdleTickResult {
  return {
    conversationId,
    eligible: false,
    idleEligible: false,
    reason,
    thoughtModelAttempts: 0,
    acceptedSettlements: 0,
    thoughtCalls: 0,
    cycleId: null,
    observations: [],
    firedTriggers,
    suppressedTriggers,
    dormant: false,
    semanticAbsenceClaim: reason === "empty_house" ? "yes" : "no",
  };
}

function recordBudgetExhaustionEvidence(
  db: DatabaseSync,
  input: {
    conversationId: string;
    policyId: string;
    nowMs: number;
    wakeId?: string | null;
    cycleId?: string | null;
  },
): void {
  // Repeated polling must not create an unbounded evidence stream while the
  // same rolling budget window remains exhausted. The first factual stop in
  // the window is sufficient for a later Thought turn to observe it.
  const recent = db.prepare(
    `SELECT row_id
       FROM conversation_evidence_log
      WHERE conversation_id = ?
        AND role = 'system'
        AND source_status = 'capacity_exhausted'
        AND created_at_ms > ?
      ORDER BY created_at_ms DESC, rowid DESC
      LIMIT 1`,
  ).get(input.conversationId, Math.max(0, input.nowMs - PRIVATE_THOUGHT_WINDOW_MS));
  if (recent) return;
  appendSystemEvent(db, {
    conversationId: input.conversationId,
    text: "Private Thought execution stopped because the private compute budget was exhausted; this is an operational stop, not a semantic conclusion.",
    nowMs: input.nowMs,
    sourceStatus: "capacity_exhausted",
    dataClassification: "never_public",
    audienceAtCapture: "owner_private",
    producingCycleId: input.cycleId ?? null,
    provenance: {
      kind: "operational_stop",
      reason: "capacity_exhausted",
      budget: "private_compute_budget",
      policyId: input.policyId,
      wakeId: input.wakeId ?? null,
    },
  });
}

function settleUnsettledPrivateReservation(db: DatabaseSync, reservationId: string, nowMs: number): void {
  const current = getPrivateReservation(db, reservationId);
  if (!current || current.state !== "held") return;

  if (current.dispatchTruth === "not_started" && current.releaseProofRef != null) {
    const owner = resolveDurableContinuationOwner(db, {
      wakeId: current.wakeId,
      conversationId: current.conversationId,
    });
    if (owner.status === "valid_owner" || owner.status === "indeterminate_identity") {
      // Conserve held + proof; do not mark unknown and do not release.
      return;
    }
    if (owner.status === "proven_no_owner") {
      // Safely release using the persisted proof.
      try {
        releasePrivateReservation(db, {
          reservationId: current.reservationId,
          proofRef: current.releaseProofRef,
          dispatchTruth: "not_started",
          invocationId: current.invocationId ?? undefined,
          attemptId: current.attemptId ?? undefined,
          nowMs,
        });
      } catch {
        // Leave for recovery.
      }
      return;
    }
  }

  markPrivateReservationUnknown(db, reservationId, { nowMs });
}

async function tickPeriodicConversation(
  db: DatabaseSync,
  conversationId: string,
  options: IdleTickOptions,
  periodic: NonNullable<IdleTickOptions["periodic"]>,
  ctx: {
    occupancy: MindOccupancy[];
    thought: IdleThoughtRunner | undefined;
    firedTriggers: FutureTrigger[];
    suppressedTriggers: FutureTrigger[];
    items: Array<SubscriptionItem | string>;
    nowMs: number;
  },
): Promise<IdleTickResult> {
  const { nowMs } = ctx;
  const suppressed = ctx.suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId);
  const conversationTriggers = ctx.firedTriggers.filter((trigger) => trigger.conversationId === conversationId);
  if (conversationTriggers.length > 0) {
    // A due authored trigger owns this poll (T8 precedence): the periodic
    // occurrence stays pending in its window.
    return emptyResult(conversationId, "periodic_pending_retained", [], suppressed);
  }
  if (!ctx.thought) {
    return {
      ...emptyResult(conversationId, "thought_runner_missing", [], suppressed),
      eligible: true,
      idleEligible: true,
      semanticAbsenceClaim: "no",
      observations: [],
    };
  }
  // Fail closed: the delegation must still be the schedule's pending
  // occurrence on the frozen binding.
  const schedule = readSchedule(db);
  if (!schedule || schedule.pendingOccurrenceId !== periodic.occurrenceId || schedule.pendingWakeId !== periodic.boundWakeId) {
    return emptyResult(conversationId, "periodic_pending_retained", [], suppressed);
  }
  const wake = getWake(db, periodic.boundWakeId);
  if (!wake || wake.conversationId !== conversationId) return emptyResult(conversationId, "wake_cancelled", [], suppressed);
  const cycle = getCycle(db, wake.cycleId);
  if (!cycle || cycle.wakeId !== wake.wakeId) return emptyResult(conversationId, "wake_cancelled", [], suppressed);
  // Exactly-once Thought per occurrence: a live event row means durable work
  // owns the occurrence now (in-flight, deferred, or finished → observed).
  const eventId = periodicEventId(periodic.occurrenceId);
  if (db.prepare("SELECT id FROM inbox_events WHERE id = ?").get(eventId)) {
    return emptyResult(conversationId, "periodic_pending_retained", [], suppressed);
  }
  const policyId = options.privateBudgetPolicyId ?? PRIVATE_THOUGHT_POLICY_ID;
  const budget = reservePrivateThought(db, {
    admissionId: `private-thought:${wake.wakeId}`,
    wakeId: wake.wakeId,
    conversationId,
    policyId,
    wallClockNowMs: nowMs,
  });
  if (budget.kind === "refused") {
    if (budget.reason === "capacity_exhausted") {
      recordBudgetExhaustionEvidence(db, { conversationId, policyId, nowMs, wakeId: wake.wakeId, cycleId: cycle.cycleId });
    }
    return emptyResult(
      conversationId,
      budget.reason === "clock_reconciliation" ? "private_compute_clock_reconciliation" : "private_compute_budget",
      [],
      [],
    );
  }
  if (budget.reservation.state !== "held" || budget.reservation.reservationId !== periodic.reservationId) {
    // Foreign or non-held reservation: never run on it (fail closed — the
    // next poll retries or observes terminal truth).
    return emptyResult(conversationId, "private_compute_budget", [], []);
  }
  // A bound periodic occurrence carries its complete observation draft set
  // from the unbound admission path. Recovery must not re-match subscriptions
  // or acquire a replacement set.
  const observations = periodic.observations.map((observation) => remapObservation(observation, cycle));
  let binding: ReturnType<typeof persistOrVerifyObservations>;
  try {
    binding = persistOrVerifyObservations(db, observations, nowMs);
  } catch {
    return emptyResult(conversationId, "periodic_observation_binding_conflict", [], suppressed);
  }
  const eventPayload: Record<string, unknown> = {
    cycleId: cycle.cycleId,
    periodicScheduleOccurrenceId: periodic.occurrenceId,
    privateBudgetReservationId: budget.reservation.reservationId,
    ownerId: options.occupantId,
    channel: "discord",
    occupantId: options.occupantId ?? "private",
    observationsCapture: observations.length > 0 ? "present" : "none",
    observationIds: binding.observationIds,
    observationCount: binding.observationCount,
    observationBindingHash: binding.observationBindingHash,
  };
  const beforeAppend = resolveObservationBinding(db, eventPayload, cycle);
  if (beforeAppend.kind === "unknown") {
    return emptyResult(conversationId, "periodic_observation_binding_conflict", [], suppressed);
  }
  const appended = appendInboxEvent(db, {
    id: eventId,
    wakeId: wake.wakeId,
    conversationId,
    kind: "idle_opportunity",
    payload: eventPayload,
    createdAtMs: nowMs,
  });
  const afterAppend = resolveObservationBinding(db, eventPayload, cycle);
  if (afterAppend.kind === "unknown") {
    return emptyResult(conversationId, "periodic_observation_binding_conflict", [], suppressed);
  }
  return executeAdmittedThought(db, {
    conversationId,
    cycle,
    wakeId: wake.wakeId,
    event: appended,
    trigger: { kind: "idle_opportunity", ref: periodic.triggerRef },
    occupancy: ctx.occupancy,
    observations: afterAppend.observations,
    dueTriggers: [],
    suppressedTriggers: suppressed,
    reservation: budget.reservation,
    nowMs,
    thought: ctx.thought,
  });
}

async function tickConversation(
  db: DatabaseSync,
  conversationId: string,
  options: IdleTickOptions,
  firedTriggers: FutureTrigger[],
  suppressedTriggers: FutureTrigger[],
  items: Array<SubscriptionItem | string>,
  dueEvents: InboxEvent[],
): Promise<IdleTickResult> {
  const activeFrontier = getActiveDeferredFrontier(db, conversationId);
  const dueTriggers = firedTriggers.filter((trigger) => trigger.conversationId === conversationId);
  if (activeFrontier) {
    return emptyResult(conversationId, "active_frontier", [], [...suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId), ...dueTriggers]);
  }

  let occupancy: MindOccupancy[];
  try {
    occupancy = groundedOccupancy(db, conversationId);
  } catch (error) {
    if (!isOccupancyUnreachable(error)) throw error;
    logOccupancyUnreachable(conversationId, error);
    return emptyResult(conversationId, "occupancy_unreachable", [], suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId));
  }
  const nowMs = options.nowMs ?? Date.now();
  const matched = collectSubscriptionObservations(db, conversationId, items, { nowMs: options.nowMs });
  const thought = runner(options);
  const commitment = options.commitment;
  const staleSuppressed = suppressedTriggers.some((trigger) => trigger.conversationId === conversationId);

  // P1 periodic delegation: a pre-resolved bound/admitted occurrence runs on
  // its frozen binding (no re-selection, no re-acquisition, no re-admission,
  // and no empty-house short-circuit — bound work outlives occupancy).
  if (options.periodic && !commitment) {
    return tickPeriodicConversation(db, conversationId, options, options.periodic, {
      occupancy,
      thought,
      firedTriggers,
      suppressedTriggers,
      items,
      nowMs,
    });
  }

  let acquired: IdleObservationDraft[] = [];
  if (
    thought &&
    !activePrivateCalls.has(conversationId) &&
    dueTriggers.length === 0 &&
    !commitment &&
    (!staleSuppressed || occupancy.length > 0 || matched.length > 0) &&
    options.curiosityObservationProvider
  ) {
    try {
      acquired = (await options.curiosityObservationProvider({ conversationId, nowMs, occupancy })).slice(0, 12);
    } catch {
      acquired = [];
    }
  }
  const inquiryGate = evaluateInquiryOperationalGate({
    hasGroundedOccupancy: occupancy.length > 0,
    hasDueTrigger: dueTriggers.length > 0,
    hasMatchedObservation: matched.length > 0,
    hasAcquiredObservation: acquired.length > 0,
    hasCommitment: commitment !== undefined,
  });
  if (!inquiryGate.ok) {
    return emptyResult(conversationId, "empty_house", [], suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId));
  }

  if (!thought) {
    return {
      ...emptyResult(conversationId, "thought_runner_missing", dueTriggers, suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId)),
      eligible: true,
      idleEligible: true,
      semanticAbsenceClaim: "no",
      observations: matched,
    };
  }
  if (activePrivateCalls.has(conversationId)) return emptyResult(conversationId, "private_compute_concurrent", dueTriggers, []);

  if (commitment && !thought) {
    return {
      ...emptyResult(conversationId, "thought_runner_missing", [], suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId)),
      eligible: true,
      idleEligible: true,
      semanticAbsenceClaim: "no",
      observations: matched,
    };
  }
  if (commitment && options.commitmentDb) {
    const wake = recheckCommitmentOpportunity(options.commitmentDb, {
      ownerId: options.commitmentOwnerId ?? options.occupantId ?? "owner",
      commitmentId: commitment.commitmentId,
      nowMs,
    });
    if (wake.kind === "defer") return emptyResult(conversationId, "commitment_deferred", dueTriggers, []);
    if (wake.kind === "missed") return emptyResult(conversationId, "commitment_missed", dueTriggers, []);
    if (wake.kind === "not_found") return emptyResult(conversationId, "commitment_not_found", dueTriggers, []);
    const claimed = claimCommitmentOpportunity(options.commitmentDb, {
      ownerId: options.commitmentOwnerId ?? options.occupantId ?? "owner",
      commitmentId: commitment.commitmentId,
      nowMs,
    });
    if (!claimed) return emptyResult(conversationId, "private_compute_concurrent", dueTriggers, []);
  }
  const triggerKind = commitment
    ? "commitment_due" as const
    : dueTriggers.length > 0
    ? "future_trigger_due" as const
    : matched.length > 0
      ? "subscription_item" as const
      : "idle_opportunity" as const;
  const triggerRef = commitment
    ? commitment.commitmentId
    : dueTriggers.length > 0
    ? dueTriggers.map((trigger) => trigger.triggerId).join(",")
    : matched.length > 0
      ? matched.map((observation) => observation.observationId).join(",")
      : `${occupancy.map((item) => item.concernId).join(",")}:tick:${nowMs}`;
  const policyId = options.privateBudgetPolicyId ?? PRIVATE_THOUGHT_POLICY_ID;
  const budgetProjection = getPrivateBudgetProjection(db, {
    conversationId,
    policyId,
    wallClockNowMs: nowMs,
  });
  const dueWake = dueTriggers[0]?.wakeId ? getWake(db, dueTriggers[0].wakeId) : null;
  const sourceKind = triggerKind === "future_trigger_due"
    ? "future_trigger" as const
    : triggerKind === "subscription_item"
      ? "subscription" as const
      : "idle" as const;
  const occurrenceId = occurrenceIdFor({ sourceKind, triggerRef, conversationId });
  const existingWakeRow = db.prepare("SELECT wake_id FROM wakes WHERE occurrence_id = ?").get(occurrenceId) as { wake_id?: unknown } | undefined;
  const existingWake = dueWake ?? (typeof existingWakeRow?.wake_id === "string" ? getWake(db, existingWakeRow.wake_id) : null);
  const admissionInput = {
    occurrenceId,
    triggerRef,
    sourceKind,
    conversationId,
    triggerKind,
    occupantId: options.occupantId ?? "private",
    authorityEpoch: options.authorityEpoch ?? 1,
    capturedAuthorityRevision: 0,
    nowMs,
  };
  const admission = dueWake
    ? { kind: "existing" as const, wake: dueWake }
    : existingWake
      ? admitWake(db, admissionInput)
      : budgetProjection.clockState === "clock_reconciliation"
        ? { kind: "clock_reconciliation" as const }
        : budgetProjection.remaining <= 0
          ? { kind: "budget_exhausted" as const }
          : admitWake(db, admissionInput);
  if (admission.kind === "clock_reconciliation") return emptyResult(conversationId, "private_compute_clock_reconciliation", dueTriggers, []);
  if (admission.kind === "budget_exhausted") {
    recordBudgetExhaustionEvidence(db, { conversationId, policyId, nowMs });
    return emptyResult(conversationId, "private_compute_budget", dueTriggers, []);
  }
  if (admission.kind === "cancelled") return emptyResult(conversationId, "wake_cancelled", dueTriggers, suppressedTriggers);
  if (admission.kind === "stale") return emptyResult(conversationId, "wake_stale", dueTriggers, suppressedTriggers);
  const cycle = getCycle(db, admission.wake.cycleId);
  if (!cycle) throw new Error("idle_cycle_missing");
  const wakeId = cycle.wakeId;
  const event = dueEvents.find((candidate) => candidate.wakeId === wakeId) ?? null;
  const observations = [...matched, ...acquired].map((observation) => remapObservation(observation, cycle));
  const budget = reservePrivateThought(db, {
    admissionId: `private-thought:${wakeId}`,
    wakeId,
    conversationId,
    policyId,
    wallClockNowMs: nowMs,
  });
  if (budget.kind === "refused") {
    if (budget.reason === "capacity_exhausted") {
      recordBudgetExhaustionEvidence(db, { conversationId, policyId, nowMs, wakeId, cycleId: cycle.cycleId });
    }
    return emptyResult(
      conversationId,
      budget.reason === "clock_reconciliation" ? "private_compute_clock_reconciliation" : "private_compute_budget",
      dueTriggers,
      [],
    );
  }
  if (budget.reservation.state !== "held") return emptyResult(conversationId, "private_compute_budget", dueTriggers, []);
  return executeAdmittedThought(db, {
    conversationId,
    cycle,
    wakeId,
    event,
    trigger: { kind: triggerKind, ref: triggerRef },
    ...(commitment ? {
      commitmentId: commitment.commitmentId,
      realizationClause: commitment.realizationClause,
      evidenceCompleteness: "unknown" as const,
    } : {}),
    occupancy,
    observations,
    dueTriggers,
    suppressedTriggers: suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId),
    reservation: budget.reservation,
    nowMs,
    thought,
  });
}

/** Shared Thought-execution tail: settle, provenance, and result mapping. */
async function executeAdmittedThought(
  db: DatabaseSync,
  input: {
    conversationId: string;
    cycle: CycleRecord;
    wakeId: string;
    event: InboxEvent | null;
    trigger: { kind: "idle_opportunity" | "commitment_due" | "subscription_item" | "future_trigger_due"; ref: string };
    commitmentId?: string;
    realizationClause?: string;
    evidenceCompleteness?: CommitmentEvidenceCompleteness;
    occupancy: MindOccupancy[];
    observations: Observation[];
    dueTriggers: FutureTrigger[];
    suppressedTriggers: FutureTrigger[];
    reservation: import("../types.js").PrivateBudgetReservation;
    nowMs: number;
    thought: IdleThoughtRunner;
  },
): Promise<IdleTickResult> {
  const {
    conversationId,
    cycle,
    wakeId,
    event,
    trigger,
    commitmentId,
    realizationClause,
    evidenceCompleteness,
    occupancy,
    observations,
    dueTriggers,
    suppressedTriggers,
    reservation,
    nowMs,
    thought,
  } = input;
  activePrivateCalls.add(conversationId);
  try {
    const result = await thought({
      sidecar: db,
      cycle,
      wakeId,
      event,
      trigger,
      ...(commitmentId ? { commitmentId } : {}),
      ...(realizationClause ? { realizationClause } : {}),
      ...(evidenceCompleteness ? { evidenceCompleteness } : {}),
      occupancy,
      observations,
      dueTriggers,
      privateBudgetReservation: reservation,
    });
    settleUnsettledPrivateReservation(db, reservation.reservationId, nowMs);
    const thoughtModelAttempts = number(result.thoughtModelAttempts, 1);
    const acceptedSettlements = number(result.acceptedSettlements, result.published === true ? 1 : 0);
    // Dormancy is semantic state. Only the Thought settlement may publish it;
    // the idle scheduler reports an explicit result without writing state.
    const dormant = result.dormant === true;
    return {
      conversationId,
      eligible: true,
      reason: null,
      thoughtModelAttempts,
      acceptedSettlements,
      thoughtCalls: 1,
      cycleId: cycle.cycleId,
      observations,
      firedTriggers: dueTriggers,
      suppressedTriggers: suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId),
      dormant,
      idleEligible: true,
      semanticAbsenceClaim: "no",
      thoughtExecutionProvenance: result.thoughtExecutionProvenance ?? UNKNOWN_EXECUTION_PROVENANCE,
    };
  } catch {
    try { settleUnsettledPrivateReservation(db, reservation.reservationId, nowMs); } catch { /* preserve the idle failure result */ }
    return {
      conversationId,
      eligible: true,
      reason: "thought_failed",
      thoughtModelAttempts: 1,
      acceptedSettlements: 0,
      thoughtCalls: 1,
      cycleId: cycle.cycleId,
      observations,
      firedTriggers: dueTriggers,
      suppressedTriggers: suppressedTriggers.filter((trigger) => trigger.conversationId === conversationId),
      dormant: false,
      idleEligible: true,
      semanticAbsenceClaim: "no",
      thoughtExecutionProvenance: UNKNOWN_EXECUTION_PROVENANCE,
    };
  } finally {
    activePrivateCalls.delete(conversationId);
  }
}

/**
 * Maps a periodic poll decision to the tick reason surfaced only when the
 * conversations loop found nothing (empty_house). Null preserves the
 * pre-P1 reason exactly (schedule-less or thought-carrying ticks).
 */
function periodicReasonFor(decision: PeriodicPollDecision): IdleTickReason | null {
  switch (decision.kind) {
    case "no_schedule_disabled":
    case "bound_runnable":
    case "admit_runnable":
    case "admission_unavailable":
      return null;
    case "schedule_created":
    case "not_due":
      return "periodic_not_due";
    case "disabled_retained":
      return "periodic_disabled";
    case "trigger_deferred":
    case "epoch_blocked":
    case "pending_retained":
      return "periodic_pending_retained";
    case "terminal_observed":
    case "stale_closed":
      return "periodic_terminal_observed";
    case "skipped_empty":
      return "periodic_skipped_empty";
    case "expired":
    case "epoch_abandoned":
      return "periodic_expired";
  }
}

export async function tickIdleOpportunity(
  db: DatabaseSync,
  options: IdleTickOptions = {},
): Promise<IdleTickResult> {
  void options.learnedSelfSlice;
  const nowMs = options.nowMs ?? Date.now();
  if (options.conversationId && getActiveDeferredFrontier(db, options.conversationId)) {
    return emptyResult(options.conversationId, "active_frontier", [], []);
  }

  let due;
  try {
    due = await fireDueTriggers(db, { conversationId: options.conversationId, nowMs });
  } catch (error) {
    if (!isOccupancyUnreachable(error)) throw error;
    logOccupancyUnreachable(options.conversationId ?? null, error);
    return emptyResult(options.conversationId ?? null, "occupancy_unreachable", [], []);
  }
  let items = inputItems(options);
  let commitment: CommitmentOpportunity | undefined = options.commitment;
  if (!commitment && options.commitmentDb && isCommitmentsEnabled()) {
    recoverCommitmentOpportunities(options.commitmentDb, {
      ownerId: options.commitmentOwnerId ?? options.occupantId ?? "owner",
      nowMs,
    });
    commitment = listDueCommitmentOpportunities(
      options.commitmentDb,
      options.commitmentOwnerId ?? options.occupantId ?? "owner",
      nowMs,
      1,
    )[0];
  }
  // P1 periodic evaluation (R7 §9.2 order): T8 already fired above and never
  // touches the schedule row. The schedule never gates a trigger.
  const periodicDecision = await evaluatePeriodicPoll(db, {
    scopeConversationId: options.conversationId,
    occupantId: options.occupantId,
    authorityEpoch: options.authorityEpoch,
    nowMs,
    enabled: options.periodicCognitionEnabled,
    policyId: options.privateBudgetPolicyId,
    subscriptionItems: items,
    externalWatchPoll: options.externalWatch ?? {},
    onExternalWatchItems: (polledItems) => {
      items = [...items, ...polledItems];
    },
    dueTriggerFired: due.fired.length > 0,
    acquireObservations: options.curiosityObservationProvider
      ? async ({ conversationId, nowMs: acquireNowMs, occupancy }) => {
        try {
          const acquired = await options.curiosityObservationProvider!({ conversationId, nowMs: acquireNowMs, occupancy });
          return (Array.isArray(acquired) ? acquired : []).slice(0, PERIODIC_CURIOSITY_MAX_ITEMS);
        } catch {
          return [];
        }
      }
      : undefined,
  });
  let delegated: IdleTickResult | null = null;
  let delegatedConversation: string | null = null;
  if (!commitment && (periodicDecision.kind === "bound_runnable" || periodicDecision.kind === "admit_runnable")) {
    // The occurrence's Thought runs through the same per-conversation path
    // on its frozen binding; the conversation is skipped in the normal loop
    // below so the obligation executes exactly once.
    const runnable = periodicDecision.runnable;
    delegatedConversation = runnable.conversationId;
    delegated = await tickConversation(db, runnable.conversationId, {
      ...options,
      nowMs,
      periodic: {
        occurrenceId: runnable.occurrenceId,
        triggerRef: runnable.triggerRef,
        boundWakeId: runnable.wakeId,
        reservationId: runnable.reservationId,
        observations: runnable.observations,
      },
    }, due.fired, due.suppressedStale, items, due.events);
  }
  if (
    periodicDecision.kind === "pending_retained"
    && periodicDecision.reason === "periodic_observation_binding_conflict"
  ) {
    // A bound occurrence with no reconstructible binding is not ordinary
    // idle work. Retain the durable opportunity and prevent the normal
    // conversation loop from dispatching a fabricated empty capture.
    return emptyResult(
      options.conversationId ?? null,
      "periodic_observation_binding_conflict",
      due.fired,
      due.suppressedStale,
    );
  }
  const periodicReason = periodicReasonFor(periodicDecision);
  let conversations: string[];
  try {
    conversations = conversationCandidates(db, options, due.fired, items);
  } catch (error) {
    if (!isOccupancyUnreachable(error)) throw error;
    logOccupancyUnreachable(options.conversationId ?? null, error);
    return emptyResult(options.conversationId ?? null, "occupancy_unreachable", due.fired, due.suppressedStale);
  }
  if (conversations.length === 0 && !delegated) {
    return emptyResult(options.conversationId ?? null, periodicReason ?? "empty_house", due.fired, due.suppressedStale);
  }
  const results: IdleTickResult[] = [];
  if (delegated) results.push(delegated);
  for (const conversationId of conversations) {
    if (conversationId === delegatedConversation) continue;
    results.push(await tickConversation(db, conversationId, { ...options, nowMs, ...(commitment ? { commitment } : {}) }, due.fired, due.suppressedStale, items, due.events));
  }
  const thoughtExecutionProvenance = results.reduce<ThoughtExecutionProvenance | null>(
    (current, result) => mergeExecutionProvenance(current, result.thoughtExecutionProvenance),
    null,
  );
  const baseReason: IdleTickReason | null = results.every((result) => result.reason === "empty_house")
    ? "empty_house"
    : results.find((result) => result.reason !== null)?.reason ?? null;
  // Periodic reasons surface only when the conversations loop found nothing:
  // no existing reason semantics change (any non-empty conversation result
  // dominates, exactly as before P1).
  const reason = baseReason === "empty_house" ? (periodicReason ?? baseReason) : baseReason;
  return {
    conversationId: options.conversationId ?? (results.length === 1 ? results[0]!.conversationId : null),
    eligible: results.some((result) => result.eligible),
    reason,
    thoughtModelAttempts: results.reduce((total, result) => total + result.thoughtModelAttempts, 0),
    acceptedSettlements: results.reduce((total, result) => total + result.acceptedSettlements, 0),
    thoughtCalls: results.reduce((total, result) => total + result.thoughtCalls, 0),
    cycleId: results.length === 1 ? results[0]!.cycleId : null,
    observations: results.flatMap((result) => result.observations),
    firedTriggers: due.fired,
    suppressedTriggers: due.suppressedStale,
    dormant: results.some((result) => result.dormant),
    idleEligible: results.some((result) => result.idleEligible === true),
    semanticAbsenceClaim: results.some((result) => result.semanticAbsenceClaim === "no") ? "no" : "yes",
    ...(thoughtExecutionProvenance ? { thoughtExecutionProvenance } : {}),
  };
}
