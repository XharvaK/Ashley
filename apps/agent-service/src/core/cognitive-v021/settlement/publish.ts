import type { DatabaseSync } from "node:sqlite";
import { readAuthorityBarrier, requireCurrentAuthorityBinding } from "../authority/barrier.js";
import { insertOutboxPending } from "../speech/outbox.js";
import type {
  CycleTriggerKind,
  DeliveryIntent,
  DurableNomination,
  FutureTriggerDelta,
  OutboxOrigin,
  PublishedCognitiveSettlement,
  PublicationRejectionReason,
  SubscriptionDelta,
} from "../types.js";
import type {
  AttemptInputBasis,
  HardDependencyBundle,
  InteractionIntent,
  SocialAudience,
} from "../social/types.js";
import { hashAttemptBasis } from "../social/basis.js";
import { consumeLicenseOnceInExistingTransaction } from "../../relationship/social-authority.js";
import {
  getDeliveryReservation,
  reserveExternalDeliveryInTransaction,
} from "../../delivery/store.js";
import { isRoomPublicationEnabled, roomIdentity } from "../social/room-activation.js";
import { applyWorkingContextDelta } from "../evidence/working-context.js";
import { applyConcernDelta, getConcern } from "../concerns/lineage.js";
import { applyOccupancyDelta } from "../concerns/occupancy.js";
import { enqueueDurableNomination } from "../memory/nomination.js";
import { assertSubscriptionCapacity } from "../observation/subscriptions.js";
import { sanitizeFutureTriggerPayload } from "../initiative/future-triggers.js";
import { beginConsequenceInTransaction, getWakeForCycle, getWake } from "../wake/ledger.js";
import {
  assertThoughtSourceCurrentness,
  isThoughtSourceCurrentnessError,
  type ThoughtSourceCurrentness,
} from "../thought/source-currentness.js";

export type PublicationOptions = {
  origin?: OutboxOrigin;
  deliveryIntent?: DeliveryIntent;
  nowMs?: number;
  triggerKind?: CycleTriggerKind;
  fidelity?: "passed" | "rejected" | "skipped";
  thoughtUnavailable?: boolean;
  authorityDb?: DatabaseSync;
  expectedCurrentness?: import("../types.js").AuthorityCurrentnessBinding;
  currentness?: import("../types.js").AuthorityPacks["currentness"];
  sourceCurrentness?: ThoughtSourceCurrentness;
  wakeId?: string;
  wakeLeaseToken?: string | null;
  semanticPass?: number;
};

export type PublicationResult = {
  published: boolean;
  replayed: boolean;
  reason?: PublicationRejectionReason;
  settlementId: string | null;
  outboxId: number | null;
};

export class FutureTriggerSnapshotConflictError extends Error {
  readonly code = "future_trigger_snapshot_conflict" as const;

  constructor() {
    super("future_trigger_snapshot_conflict");
    this.name = "FutureTriggerSnapshotConflictError";
  }
}

export type PublishedSettlementIdentity = {
  settlementId: string;
  outboxId: number | null;
};

type DbRow = Record<string, unknown>;
function stringValue(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function numberValue(value: unknown, fallback = 0): number { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? n : fallback; }
function json(value: unknown): string { return JSON.stringify(value ?? null); }

function containsRedactionMarker(value: unknown): boolean {
  if (value === "[redacted]") return true;
  if (Array.isArray(value)) return value.some(containsRedactionMarker);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.redacted === true) return true;
    return Object.values(record).some(containsRedactionMarker);
  }
  return false;
}

function consumedObservationsAreAvailable(
  db: DatabaseSync,
  observationIds: readonly string[],
): boolean {
  for (const observationId of observationIds) {
    const row = db.prepare(
      "SELECT payload_json FROM observations WHERE observation_id = ? LIMIT 1",
    ).get(observationId) as DbRow | undefined;
    if (!row || typeof row.payload_json !== "string") return false;
    try {
      if (containsRedactionMarker(JSON.parse(row.payload_json))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function currentGeneration(db: DatabaseSync, conversationId: string): number | null {
  const row = db.prepare("SELECT MAX(generation) AS generation FROM cycle_records WHERE conversation_id = ?").get(conversationId) as DbRow | undefined;
  if (!row || row.generation == null) return null;
  return numberValue(row.generation);
}

function authorityFenceReason(options: PublicationOptions): PublicationResult["reason"] | null {
  if (!options.authorityDb && !options.expectedCurrentness) return null;
  if (!options.authorityDb || !options.expectedCurrentness) return "authority_vector_stale";
  try {
    requireCurrentAuthorityBinding(options.authorityDb, options.expectedCurrentness);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "authority_vector_stale";
    return message === "authority_barrier_not_stable"
      ? "authority_transition"
      : "authority_vector_stale";
  }
}

function publicationFence(
  db: DatabaseSync,
  settlement: PublishedCognitiveSettlement,
  conversationId: string,
): boolean {
  const cycle = db.prepare(
    "SELECT generation, authority_epoch, wake_id FROM cycle_records WHERE cycle_id = ? LIMIT 1",
  ).get(settlement.cycleId) as DbRow | undefined;
  return cycle != null
    && numberValue(cycle.generation, -1) === settlement.generation
    && numberValue(cycle.authority_epoch, -1) === settlement.authorityEpoch
    && (!settlement.wakeId || String(cycle.wake_id ?? "") === settlement.wakeId)
    && currentGeneration(db, conversationId) === settlement.generation;
}

function applyFutureTriggerDelta(db: DatabaseSync, delta: FutureTriggerDelta): void {
  if (delta.op === "cancel") {
    db.prepare("UPDATE future_triggers SET status = 'cancelled' WHERE trigger_id = ?").run(delta.triggerId);
    return;
  }
  const trigger = delta.trigger;
  const concern = getConcern(db, trigger.concernId);
  if (!concern) throw new Error("future_trigger_concern_missing");
  if (concern.snapshotHash !== trigger.snapshotHash) throw new FutureTriggerSnapshotConflictError();
  const existing = db.prepare(
    "SELECT status FROM future_triggers WHERE trigger_id = ? LIMIT 1",
  ).get(trigger.triggerId) as { status?: unknown } | undefined;
  if (existing && existing.status !== "scheduled") throw new Error("future_trigger_terminal");
  db.prepare(
    `INSERT INTO future_triggers
       (trigger_id, conversation_id, concern_id, due_at_ms, snapshot_hash, status, payload_json)
     VALUES (?, ?, ?, ?, ?, 'scheduled', ?)
     ON CONFLICT(trigger_id) DO UPDATE SET due_at_ms=excluded.due_at_ms,
       snapshot_hash=excluded.snapshot_hash, status='scheduled', payload_json=excluded.payload_json`,
  ).run(trigger.triggerId, trigger.conversationId, trigger.concernId, trigger.dueAtMs, trigger.snapshotHash, json(sanitizeFutureTriggerPayload(trigger.payload ?? {})));
}

function applySubscriptionDelta(db: DatabaseSync, delta: SubscriptionDelta): void {
  if (delta.op === "cancel") {
    db.prepare("UPDATE observation_subscriptions SET cancelled = 1 WHERE subscription_id = ?").run(delta.subscriptionId);
    return;
  }
  db.prepare(
    `INSERT INTO observation_subscriptions
       (subscription_id, conversation_id, spec_json, cancelled)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(subscription_id) DO UPDATE SET conversation_id=excluded.conversation_id,
       spec_json=excluded.spec_json, cancelled=0`,
  ).run(delta.subscription.subscriptionId, delta.subscription.conversationId, json(delta.subscription));
}

function applyNomination(db: DatabaseSync, nomination: DurableNomination): void {
  enqueueDurableNomination(db, nomination);
}

function existingSettlementForCycleGeneration(
  db: DatabaseSync,
  cycleId: string,
  generation: number,
): DbRow | undefined {
  return db.prepare(
    `SELECT settlement_id, cycle_id, generation
       FROM settlements
      WHERE cycle_id = ? AND generation = ?
      LIMIT 1`,
  ).get(cycleId, generation) as DbRow | undefined;
}

export function publishSemanticTransaction(
  db: DatabaseSync,
  settlement: PublishedCognitiveSettlement,
  options: PublicationOptions = {},
): PublicationResult {
  const nowMs = options.nowMs ?? Date.now();
  const wake = getWakeForCycle(db, settlement.cycleId);
  const wakeId = options.wakeId ?? settlement.wakeId ?? wake?.wakeId;
  if (!wakeId) return { published: false, replayed: false, reason: "wake_missing", settlementId: null, outboxId: null };
  if (!wake || wake.wakeId !== wakeId) return { published: false, replayed: false, reason: "wake_missing", settlementId: null, outboxId: null };
  if (wake.state === "terminal") return { published: false, replayed: false, reason: "wake_terminal", settlementId: null, outboxId: null };
  if (wake.state === "reconciling") return { published: false, replayed: false, reason: "wake_reconciliation_required", settlementId: null, outboxId: null };
  const authorityDb = options.authorityDb;
  const authorityTransaction = authorityDb !== undefined && authorityDb !== db;
  let authorityTransactionOpen = false;
  let sidecarTransactionOpen = false;
  const rollbackAuthority = (): void => {
    if (!authorityTransactionOpen || !authorityDb) return;
    authorityDb.exec("ROLLBACK");
    authorityTransactionOpen = false;
  };
  const commitAuthority = (): void => {
    if (!authorityTransactionOpen || !authorityDb) return;
    authorityDb.exec("COMMIT");
    authorityTransactionOpen = false;
  };
  try {
    // Hold the canonical authority database write lock for the complete
    // sidecar compare-and-accept window. Without this lock an authority
    // transition could begin after the second read but before publication
    // commit, leaving a durable settlement bound to stale semantic state.
    if (authorityTransaction && authorityDb) {
      authorityDb.exec("BEGIN IMMEDIATE");
      authorityTransactionOpen = true;
    }
    const initialAuthorityFailure = authorityFenceReason(options);
    if (initialAuthorityFailure) {
      rollbackAuthority();
      return { published: false, replayed: false, reason: initialAuthorityFailure, settlementId: null, outboxId: null };
    }
    db.exec("BEGIN IMMEDIATE");
    sidecarTransactionOpen = true;
    const existing = existingSettlementForCycleGeneration(
      db,
      settlement.cycleId,
      settlement.generation,
    );
    if (existing) {
      const existingSettlementId = stringValue(existing.settlement_id, settlement.settlementId);
      const outbox = getSpeechOutboxBySettlementUnsafe(db, existingSettlementId);
      db.exec("COMMIT");
      sidecarTransactionOpen = false;
      commitAuthority();
      return { published: true, replayed: true, settlementId: existingSettlementId, outboxId: outbox };
    }
    const semanticPass = options.semanticPass ?? 1;
    if (!Number.isInteger(semanticPass) || semanticPass < 1) {
      db.exec("ROLLBACK");
      sidecarTransactionOpen = false;
      rollbackAuthority();
      return { published: false, replayed: false, reason: "consequence_exists", settlementId: null, outboxId: null };
    }
    const currentWake = getWake(db, wakeId);
    if (!currentWake || currentWake.state === "terminal") {
      db.exec("ROLLBACK");
      sidecarTransactionOpen = false;
      rollbackAuthority();
      return { published: false, replayed: false, reason: "wake_terminal", settlementId: null, outboxId: null };
    }
    let durableDeliveryIntent = options.deliveryIntent;
    if (options.wakeLeaseToken && (currentWake.state === "authorized" || currentWake.state === "consequence_pending")) {
      const consequence = beginConsequenceInTransaction(db, wakeId, options.wakeLeaseToken, semanticPass, nowMs);
      if (durableDeliveryIntent?.socialLifecycle) {
        durableDeliveryIntent = {
          ...durableDeliveryIntent,
          socialLifecycle: {
            consequenceChainId: consequence.chainId,
            attemptId: durableDeliveryIntent.socialLifecycle.attemptId,
          },
        };
      }
    } else if (currentWake.state === "consequence_pending") {
      db.exec("ROLLBACK");
      sidecarTransactionOpen = false;
      rollbackAuthority();
      return { published: false, replayed: false, reason: "consequence_exists", settlementId: null, outboxId: null };
    }
    const conversationId = awaitlessConversation(settlement, db);
    if (!publicationFence(db, settlement, conversationId)) {
      db.exec("COMMIT");
      sidecarTransactionOpen = false;
      commitAuthority();
      return { published: false, replayed: false, reason: "stale_generation", settlementId: null, outboxId: null };
    }

    if (options.sourceCurrentness) {
      try {
        assertThoughtSourceCurrentness(
          db,
          authorityDb,
          options.sourceCurrentness,
          settlement.workingContextDelta ?? [],
          {
            concernDeltas: settlement.concernDeltas ?? [],
            occupancyDeltas: settlement.occupancyDelta ?? [],
            futureTriggers: settlement.futureTriggers ?? [],
          },
        );
      } catch (error) {
        if (!isThoughtSourceCurrentnessError(error)) throw error;
        db.exec("ROLLBACK");
        sidecarTransactionOpen = false;
        rollbackAuthority();
        return { published: false, replayed: false, reason: "source_currentness_stale", settlementId: null, outboxId: null };
      }
    }

    if (!consumedObservationsAreAvailable(db, settlement.operations.observationsConsumed)) {
      db.exec("ROLLBACK");
      sidecarTransactionOpen = false;
      rollbackAuthority();
      return { published: false, replayed: false, reason: "source_currentness_stale", settlementId: null, outboxId: null };
    }

    for (const delta of (settlement.workingContextDelta ?? [])) applyWorkingContextDelta(db, delta, settlement);
    for (const delta of (settlement.concernDeltas ?? [])) applyConcernDelta(db, delta, settlement);
    for (const delta of (settlement.occupancyDelta ?? [])) applyOccupancyDelta(db, delta, settlement);
    if (settlement.subscriptions) assertSubscriptionCapacity(db, conversationId, settlement.subscriptions);
    for (const delta of (settlement.futureTriggers ?? [])) applyFutureTriggerDelta(db, delta);
    for (const delta of (settlement.subscriptions ?? [])) applySubscriptionDelta(db, delta);
    for (const nomination of (settlement.durableNominations ?? [])) applyNomination(db, nomination);

    // Second fence: semantic deltas were prepared, but no publication row or
    // speech projection may be written after the cycle/authority changed.
    const secondAuthorityFailure = authorityFenceReason(options);
    if (secondAuthorityFailure) {
      db.exec("ROLLBACK");
      sidecarTransactionOpen = false;
      rollbackAuthority();
      return { published: false, replayed: false, reason: secondAuthorityFailure, settlementId: null, outboxId: null };
    }
    if (!publicationFence(db, settlement, conversationId)) {
      // The semantic deltas above are provisional. A stale second fence must
      // roll back those writes together with the refused publication.
      db.exec("ROLLBACK");
      sidecarTransactionOpen = false;
      rollbackAuthority();
      return { published: false, replayed: false, reason: "stale_generation", settlementId: null, outboxId: null };
    }

    const currentnessWitness = options.currentness ? {
      binding: options.currentness.binding ?? { complete: options.currentness.complete === true },
      complete: options.currentness.complete === true || (options.currentness.binding as any)?.complete === true,
      observedObservationIds: options.currentness.observedObservationIds ?? [],
    } : (settlement as any).currentnessWitness ?? (settlement as any).currentness ?? null;

    db.prepare(
      `INSERT INTO settlements (settlement_id, cycle_id, generation, wake_id, semantic_pass, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(settlement.settlementId, settlement.cycleId, settlement.generation, wakeId, semanticPass, json({ ...settlement, wakeId, currentnessWitness }));

    let outboxId: number | null = null;
    if (settlement.speech.mode === "draft") {
      const outbox = insertOutboxPending(db, {
        settlementId: settlement.settlementId,
        cycleId: settlement.cycleId,
        generation: settlement.generation,
        conversationId,
        licensedText: settlement.speech.finalLicensedText ?? settlement.speech.surfaceDraft ?? "",
        origin: options.origin ?? "live",
        deliveryIntent: durableDeliveryIntent,
        commitmentBindings: settlement.commitmentBindings,
      });
      outboxId = outbox.outboxId;
    }
    const ledgerPayload = {
      cycleId: settlement.cycleId,
      generation: settlement.generation,
      triggerKind: options.triggerKind ?? "owner_message",
      occupantId: settlement.occupantId,
      authorityEpoch: settlement.authorityEpoch,
      settlementId: settlement.settlementId,
      observationIds: settlement.operations.observationsConsumed,
      ...(settlement.operations.retrievalRefsUsed
        ? { retrievalRefsUsed: settlement.operations.retrievalRefsUsed }
        : {}),
      ...(settlement.operations.sourceRefsUsed
        ? { sourceRefsUsed: settlement.operations.sourceRefsUsed }
        : {}),
      effectIds: settlement.operations.effectsCompleted,
      authorityCodes: settlement.authority.objectionsApplied,
      nominationIds: (settlement.durableNominations ?? []).map((item) => item.nominationId),
      outboxId,
      fidelity: options.fidelity ?? "skipped",
      thoughtUnavailable: options.thoughtUnavailable ?? false,
      architectureEpoch: settlement.architectureEpoch,
    };
    db.prepare(
      `INSERT INTO causal_ledger
         (cycle_id, generation, payload_json, thought_unavailable)
       VALUES (?, ?, ?, 0)`,
    ).run(settlement.cycleId, settlement.generation, json(ledgerPayload));

    db.prepare("UPDATE cycle_records SET state = ?, updated_at_ms = ? WHERE cycle_id = ? AND generation = ?")
      .run(outboxId === null ? "silent" : "sending", nowMs, settlement.cycleId, settlement.generation);
    db.exec("COMMIT");
    sidecarTransactionOpen = false;
    // Keep the authority lock until the sidecar commit has made the semantic
    // publication durable, then release the read fence.
    commitAuthority();
    return { published: true, replayed: false, settlementId: settlement.settlementId, outboxId };
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    if (sidecarTransactionOpen) {
      try { db.exec("ROLLBACK"); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
      sidecarTransactionOpen = false;
    }
    if (authorityTransactionOpen && authorityDb) {
      try { rollbackAuthority(); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
    }
    if (error instanceof FutureTriggerSnapshotConflictError) {
      if (rollbackFailures.length > 0) {
        throw new AggregateError(
          [error, ...rollbackFailures],
          "future_trigger_snapshot_conflict_rollback_failed",
        );
      }
      return {
        published: false,
        replayed: false,
        reason: "future_trigger_snapshot_conflict",
        settlementId: null,
        outboxId: null,
      };
    }
    if (rollbackFailures.length > 0) {
      throw new AggregateError([error, ...rollbackFailures], "publication_rollback_failed");
    }
    throw error;
  }
}

function awaitlessConversation(settlement: PublishedCognitiveSettlement, db: DatabaseSync): string {
  const row = db.prepare("SELECT conversation_id FROM cycle_records WHERE cycle_id = ? LIMIT 1").get(settlement.cycleId) as DbRow | undefined;
  return stringValue(row?.conversation_id, settlement.triggerRef);
}

function getSpeechOutboxBySettlementUnsafe(db: DatabaseSync, settlementId: string): number | null {
  const row = db.prepare("SELECT outbox_id FROM speech_outbox WHERE settlement_id = ?").get(settlementId) as DbRow | undefined;
  return row?.outbox_id == null ? null : numberValue(row.outbox_id);
}

/** Read the durable publication identity without applying any semantic delta. */
export function getPublishedSettlementIdentity(
  db: DatabaseSync,
  cycleId: string,
  generation: number,
): PublishedSettlementIdentity | null {
  const row = existingSettlementForCycleGeneration(db, cycleId, generation);
  if (!row) return null;
  const settlementId = stringValue(row.settlement_id);
  if (!settlementId) return null;
  return {
    settlementId,
    outboxId: getSpeechOutboxBySettlementUnsafe(db, settlementId),
  };
}

export type ExternalPublicationDestination =
  | {
      kind: "external_dm" | "dm";
      principalId: string;
      channelId?: string;
      threadId?: string;
    }
  | {
      kind: "room";
      roomId: string;
      guildId?: string;
      channelId?: string;
      threadId?: string;
    };

export type ExternalPublicationCandidate = {
  ownerId: string;
  reservationId: number;
  attemptInputBasis: AttemptInputBasis;
  /** Optional lifecycle witness used by P14; omission preserves the current lifecycle head. */
  lifecycleAttemptInputBasis?: AttemptInputBasis;
  currentAttemptInputBasis?: AttemptInputBasis;
  hardDependencyBundle: HardDependencyBundle;
  destination: ExternalPublicationDestination;
  interactionIntent: InteractionIntent;
  licenseRefs: string[];
  materialHash?: string;
  nowMs?: number;
  /** Bounded closure is a candidate property, never Host-fabricated speech. */
  closure?: { allowed?: boolean; hardStop?: boolean };
  capabilityRefs?: string[];
  commitmentId?: string | null;
};

export type ExternalPublicationAdmission = {
  admitted: boolean;
  quarantined: boolean;
  reason?: string;
  reservationId: number;
  reservation?: import("../../delivery/types.js").DeliveryReservationRow;
  postConsumptionBarrier?: { epoch: number; revision: number };
};

type AuthorityDepRef = HardDependencyBundle["permit"];
type ExternalDestination = {
  kind: "external_dm" | "room";
  audience: SocialAudience;
  principalId?: string;
  roomId?: string;
  guildId?: string;
  channelId?: string;
  threadId?: string;
};

type AuthorityRow = Record<string, unknown>;

function isTable(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try { return JSON.parse(value); } catch { return undefined; }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boolFlag(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

/** RA-P13 remains closed unless the explicit external-DM publication gate is set. */
export function isExternalDmPublicationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return boolFlag(env.RA_DM_PUBLICATION);
}

function normalizeDestination(destination: ExternalPublicationDestination): ExternalDestination | null {
  if (!destination || typeof destination !== "object") return null;
  if ((destination.kind === "external_dm" || destination.kind === "dm") &&
      typeof destination.principalId === "string" && destination.principalId.trim()) {
    return {
      kind: "external_dm",
      audience: { kind: "dm", principalId: destination.principalId },
      principalId: destination.principalId,
      channelId: destination.channelId,
      threadId: destination.threadId,
    };
  }
  if (destination.kind === "room" && typeof destination.roomId === "string" && destination.roomId.trim()
    && typeof destination.guildId === "string" && destination.guildId.trim()
    && typeof destination.channelId === "string" && destination.channelId.trim()) {
    return {
      kind: "room",
      audience: { kind: "room", roomId: destination.roomId },
      roomId: destination.roomId,
      guildId: destination.guildId,
      channelId: destination.channelId,
      threadId: destination.threadId,
    };
  }
  return null;
}

function basisEquivalent(left: AttemptInputBasis, right: AttemptInputBasis): boolean {
  try { return hashAttemptBasis(left) === hashAttemptBasis(right); } catch { return false; }
}

function dependencyBarrierMatches(
  dependency: AuthorityDepRef,
  barrier: { epoch: number; revision: number },
): boolean {
  return dependency.barrier.epoch === barrier.epoch && dependency.barrier.revision === barrier.revision;
}

const DEPENDENCY_TABLES = new Set([
  "social_permits",
  "owner_prohibitions",
  "trusted_rooms",
  "recipient_restrictions",
  "ashley_boundaries",
  "disclosure_licenses",
]);

function dependencyRow(db: DatabaseSync, dependency: AuthorityDepRef): AuthorityRow | undefined {
  if (!DEPENDENCY_TABLES.has(dependency.table)) return undefined;
  if (!isTable(db, dependency.table)) return undefined;
  const direct = db.prepare(
    `SELECT * FROM ${dependency.table} WHERE entity_uuid = ? LIMIT 1`,
  ).get(dependency.key) as AuthorityRow | undefined;
  if (direct) return direct;

  // The canonical binding uses entity_uuid. These narrow fallbacks make the
  // reader tolerant of a principal/room key produced by a source adapter while
  // keeping the whitelist above closed to arbitrary SQL identifiers.
  if (dependency.key.startsWith("principal:") &&
      (dependency.table === "social_permits" || dependency.table === "recipient_restrictions")) {
    const principalId = dependency.key.slice("principal:".length);
    return db.prepare(
      `SELECT * FROM ${dependency.table} WHERE principal_id = ? ORDER BY rowid DESC LIMIT 1`,
    ).get(principalId) as AuthorityRow | undefined;
  }
  if (dependency.key.startsWith("room:") && dependency.table === "trusted_rooms") {
    const parts = dependency.key.split(":");
    if (parts.length === 3) {
      return db.prepare(
        "SELECT * FROM trusted_rooms WHERE guild_id = ? AND channel_id = ? LIMIT 1",
      ).get(parts[1], parts[2]) as AuthorityRow | undefined;
    }
  }
  if (dependency.key.startsWith("room:") && dependency.table === "owner_prohibitions") {
    return db.prepare(
      "SELECT * FROM owner_prohibitions WHERE target_room_id = ? ORDER BY version DESC, rowid DESC LIMIT 1",
    ).get(dependency.key) as AuthorityRow | undefined;
  }
  return undefined;
}

function rowActive(row: AuthorityRow | undefined, nowMs: number): boolean {
  if (!row) return false;
  if (row.revoked_at != null || row.cleared_at != null || row.superseded_at != null) return false;
  if (typeof row.expires_at === "string" && Date.parse(row.expires_at) <= nowMs) return false;
  if (row.mode === "disengaged") return false;
  return true;
}

function dependencyCurrent(
  db: DatabaseSync,
  dependency: AuthorityDepRef,
  barrier: { epoch: number; revision: number },
  nowMs: number,
): boolean {
  if (!dependencyBarrierMatches(dependency, barrier)) return false;
  if (!DEPENDENCY_TABLES.has(dependency.table)) {
    // Capability and destination access are represented by the candidate's
    // coherent host bundle in this packet. Their absence proof remains bound
    // to the same barrier and is therefore safe until P15/P16 add rows.
    return dependency.rowRevision === null;
  }
  const row = dependencyRow(db, dependency);
  if (dependency.rowRevision === null) return !row || !rowActive(row, nowMs);
  if (!row || !rowActive(row, nowMs)) return false;
  const revision = row.version == null ? 1 : Number(row.version);
  return Number.isInteger(revision) && revision === dependency.rowRevision;
}

function allDependenciesCurrent(
  db: DatabaseSync,
  bundle: HardDependencyBundle,
  barrier: { epoch: number; revision: number },
  nowMs: number,
): boolean {
  const dependencies: AuthorityDepRef[] = [
    bundle.permit,
    bundle.prohibitionAbsence,
    bundle.roomState,
    bundle.recipientRestrictionAbsence,
    bundle.ashleyBoundaryAbsence,
    ...bundle.licenses,
    bundle.capability,
    bundle.destinationAccess,
  ];
  return dependencies.every((dependency) => dependencyCurrent(db, dependency, barrier, nowMs));
}

function currentBarrier(db: DatabaseSync): { epoch: number; revision: number } {
  const barrier = readAuthorityBarrier(db);
  if (barrier.state !== "stable") throw new Error("authority_transition");
  return { epoch: barrier.epoch, revision: barrier.revision };
}

function currentRowsForDestination(
  db: DatabaseSync,
  ownerId: string,
  destination: ExternalDestination,
  nowMs: number,
): {
  permit: AuthorityRow | undefined;
  prohibitions: AuthorityRow[];
  restrictions: AuthorityRow[];
  boundaries: AuthorityRow[];
} {
  const principalId = destination.principalId ?? null;
  const roomId = destination.roomId ?? null;
  const prohibitions = db.prepare(
    `SELECT * FROM owner_prohibitions
      WHERE owner_id = ? AND cleared_at IS NULL AND
        ((? IS NOT NULL AND target_principal_id = ?) OR
         (? IS NOT NULL AND target_room_id = ?))`,
  ).all(ownerId, principalId, principalId, roomId, roomId) as AuthorityRow[];
  const restrictions = principalId
    ? db.prepare(
      `SELECT * FROM recipient_restrictions
        WHERE owner_id = ? AND principal_id = ? AND cleared_at IS NULL`,
    ).all(ownerId, principalId) as AuthorityRow[]
    : [];
  const boundaries = principalId
    ? db.prepare(
      `SELECT * FROM ashley_boundaries
        WHERE owner_id = ? AND superseded_at IS NULL
          AND (target_principal_id IS NULL OR target_principal_id = ?)`,
    ).all(ownerId, principalId) as AuthorityRow[]
    : [];
  const permit = principalId
    ? db.prepare(
      `SELECT * FROM social_permits
        WHERE owner_id = ? AND principal_id = ? AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?) ORDER BY version DESC LIMIT 1`,
    ).get(ownerId, principalId, new Date(nowMs).toISOString()) as AuthorityRow | undefined
    : undefined;
  return { permit, prohibitions, restrictions, boundaries };
}

function audienceFromLicense(value: unknown):
  | { kind: "dm"; principalId: string }
  | { kind: "room"; roomId: string }
  | { kind: "exact_principals"; principalIds: string[] }
  | null {
  const candidate = asRecord(value);
  if (!candidate) return null;
  if ((candidate.kind === "dm" || candidate.kind === "external_dm") && typeof candidate.principalId === "string") {
    return { kind: "dm", principalId: candidate.principalId };
  }
  if (candidate.kind === "room" && typeof candidate.roomId === "string") {
    return { kind: "room", roomId: candidate.roomId };
  }
  if (candidate.kind === "exact_principal" && typeof candidate.principalId === "string") {
    return { kind: "exact_principals", principalIds: [candidate.principalId] };
  }
  if (candidate.kind === "exact_principals" || candidate.kind === "principals") {
    const values = candidate.principalIds ?? candidate.principals;
    if (Array.isArray(values)) {
      const principalIds = values.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (principalIds.length > 0) return { kind: "exact_principals", principalIds };
    }
  }
  return null;
}

function licenseCoversDestination(
  row: AuthorityRow,
  destination: ExternalDestination,
): boolean {
  const audience = audienceFromLicense(parseJson(row.grantee_audience_json));
  if (!audience) return false;
  if (audience.kind === "dm") {
    return destination.kind === "external_dm" && destination.principalId === audience.principalId;
  }
  if (audience.kind === "room") {
    return destination.kind === "room" && destination.roomId === audience.roomId;
  }
  return destination.kind === "external_dm" && audience.principalIds.length === 1
    && audience.principalIds[0] === destination.principalId;
}

function licenseRows(
  db: DatabaseSync,
  refs: readonly string[],
  ownerId?: string,
): AuthorityRow[] {
  if (refs.length === 0 || !isTable(db, "disclosure_licenses")) return [];
  const placeholders = refs.map(() => "?").join(",");
  if (ownerId === undefined) {
    return db.prepare(
      `SELECT * FROM disclosure_licenses WHERE entity_uuid IN (${placeholders})`,
    ).all(...refs) as AuthorityRow[];
  }
  return db.prepare(
    `SELECT * FROM disclosure_licenses
      WHERE owner_id = ? AND entity_uuid IN (${placeholders})`,
  ).all(ownerId, ...refs) as AuthorityRow[];
}

function licenseVersion(row: AuthorityRow): number {
  const version = Number(row.version);
  return Number.isInteger(version) ? version : 0;
}

function licenseUsable(
  row: AuthorityRow,
  destination: ExternalDestination,
  nowMs: number,
  reservationOwned: boolean,
  materialHash?: string,
  useNo?: number,
): string | null {
  if (!licenseCoversDestination(row, destination)) return "audience_mismatch";
  if (materialHash && row.material_hash !== materialHash) return "license_material_mismatch";
  if (row.revoked_at != null) return "license_revoked";
  if (typeof row.expires_at === "string") {
    const expiryMs = Date.parse(row.expires_at);
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) return "license_expired";
  }
  const consumed = Number(row.uses_consumed);
  const allowed = Number(row.uses_allowed);
  if (!reservationOwned && (!Number.isInteger(consumed) || !Number.isInteger(allowed) || consumed >= allowed)) {
    return "license_consumed";
  }
  if (reservationOwned && useNo != null && consumed !== useNo) return "authority_vector_stale";
  return null;
}

function policyReason(
  db: DatabaseSync,
  candidate: ExternalPublicationCandidate,
  destination: ExternalDestination,
  nowMs: number,
): string | null {
  const rows = currentRowsForDestination(db, candidate.ownerId, destination, nowMs);
  const hardProhibition = rows.prohibitions.some((row) => boolFlag(row.hard_stop) || row.scope === "no_contact");
  if (hardProhibition) return "hard_stop";
  if (destination.kind === "external_dm") {
    const directProhibition = rows.prohibitions.some((row) => row.scope === "no_dm" || row.scope === "no_direct");
    if (directProhibition) return "owner_prohibition";
  }
  const hardBoundary = rows.boundaries.some((row) => row.scope === "no_contact");
  if (hardBoundary) return "hard_stop";
  if (destination.kind === "external_dm"
    && rows.boundaries.some((row) => row.scope === "no_dm" || row.scope === "no_direct")) return "ashley_boundary";
  if (destination.kind === "external_dm") {
    if (candidate.closure?.hardStop === true) return "hard_stop";
    const restriction = rows.restrictions.find((row) => typeof row.kind === "string");
    if (restriction?.kind === "do_not_contact" || restriction?.kind === "no_dm") return "recipient_restricted";
    if (candidate.interactionIntent === "initiate" && restriction?.kind === "no_initiation") return "recipient_no_initiation";
    if (restriction?.kind === "room_only") return "recipient_room_only";
    const hasPermit = rows.permit != null &&
      (rows.permit.scope === "person_wide" || rows.permit.scope === "dm_only");
    const closureAllowed = candidate.closure?.allowed === true;
    const closureHardStop = Boolean(candidate.closure?.hardStop);
    const closure = closureAllowed
      && !closureHardStop
      && candidate.interactionIntent === "continue"
      && (candidate.capabilityRefs?.length ?? 0) === 0
      && candidate.commitmentId == null;
    if (!hasPermit && !closure) return "dm_requires_person_permit";
    if (candidate.interactionIntent === "initiate" && rows.boundaries.some((row) => row.scope === "no_initiation")) {
      return "ashley_no_initiation";
    }
  }
  if (destination.kind === "room") {
    if (candidate.interactionIntent !== "continue") return "room_no_initiation";
    if (!destination.guildId || !destination.channelId
      || destination.roomId !== roomIdentity(destination.guildId, destination.channelId)) {
      return "room_not_authorized";
    }
    if (!destination.guildId || !destination.channelId
      || !isRoomPublicationEnabled(process.env, destination.channelId)) {
      return "room_not_yet_activated";
    }
    const room = db.prepare(
      `SELECT mode FROM trusted_rooms WHERE guild_id = ? AND channel_id = ? LIMIT 1`,
    ).get(destination.guildId, destination.channelId) as AuthorityRow | undefined;
    if (room?.mode !== "trusted_social") return "room_not_authorized";
  }
  return null;
}

function bundleWithBarrier(
  bundle: HardDependencyBundle,
  barrier: { epoch: number; revision: number },
  licenseVersions: Map<string, number>,
): HardDependencyBundle {
  const update = (dependency: AuthorityDepRef): AuthorityDepRef => ({
    ...dependency,
    barrier,
    ...(licenseVersions.has(dependency.key) ? { rowRevision: licenseVersions.get(dependency.key)! } : {}),
  });
  return {
    permit: update(bundle.permit),
    prohibitionAbsence: update(bundle.prohibitionAbsence),
    roomState: update(bundle.roomState),
    recipientRestrictionAbsence: update(bundle.recipientRestrictionAbsence),
    ashleyBoundaryAbsence: update(bundle.ashleyBoundaryAbsence),
    licenses: bundle.licenses.map(update),
    capability: update(bundle.capability),
    destinationAccess: update(bundle.destinationAccess),
    barrier,
  };
}

function selectNuclearDb(db: DatabaseSync, authorityDb?: DatabaseSync): DatabaseSync {
  if (isTable(db, "delivery_reservations") && isTable(db, "authority_transition_barrier")) return db;
  if (authorityDb && isTable(authorityDb, "delivery_reservations") && isTable(authorityDb, "authority_transition_barrier")) return authorityDb;
  throw new Error("external_publication_authority_db_missing");
}

function admissionFailure(
  candidate: ExternalPublicationCandidate,
  reason: string,
): ExternalPublicationAdmission {
  return {
    admitted: false,
    quarantined: true,
    reason,
    reservationId: candidate.reservationId,
  };
}

function validateCandidateShape(candidate: ExternalPublicationCandidate): string | null {
  if (!candidate.ownerId?.trim()) return "social_owner_required";
  if (!Number.isInteger(candidate.reservationId) || candidate.reservationId < 1) return "reservation_required";
  if (!Array.isArray(candidate.licenseRefs) || candidate.licenseRefs.length === 0) return "license_required";
  if (candidate.licenseRefs.some((ref) => typeof ref !== "string" || !ref.trim())) return "license_ref_invalid";
  if (!candidate.hardDependencyBundle || !candidate.hardDependencyBundle.barrier) return "hard_dependency_bundle_missing";
  return null;
}

function currentnessReason(
  db: DatabaseSync,
  candidate: ExternalPublicationCandidate,
  reservation: ReturnType<typeof getDeliveryReservation>,
  nowMs: number,
): string | null {
  try {
    hashAttemptBasis(candidate.attemptInputBasis);
  } catch {
    return "attempt_basis_invalid";
  }
  const lifecycleBasis = candidate.currentAttemptInputBasis
    ?? candidate.lifecycleAttemptInputBasis
    ?? reservation?.attemptInputBasis;
  if (lifecycleBasis && !basisEquivalent(candidate.attemptInputBasis, lifecycleBasis as AttemptInputBasis)) {
    return "stale_basis";
  }
  try {
    const barrier = currentBarrier(db);
    const expected = candidate.hardDependencyBundle.barrier;
    if (barrier.epoch !== expected.epoch || barrier.revision !== expected.revision) return "authority_vector_stale";
    if (!allDependenciesCurrent(db, candidate.hardDependencyBundle, barrier, nowMs)) return "authority_vector_stale";
  } catch (error) {
    return error instanceof Error ? error.message : "authority_vector_stale";
  }
  return null;
}

function storedLicenseRefs(value: unknown): Array<{
  entityUuid: string;
  useNo?: number;
  consumedByReservationId?: number;
  materialHash?: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item === "string" && item.trim()) return [{ entityUuid: item }];
    const record = asRecord(item);
    if (!record || typeof record.licenseEntityUuid !== "string") return [];
    return [{
      entityUuid: record.licenseEntityUuid,
      ...(Number.isInteger(record.useNo) ? { useNo: Number(record.useNo) } : {}),
      ...(Number.isInteger(record.consumedByReservationId) ? { consumedByReservationId: Number(record.consumedByReservationId) } : {}),
      ...(typeof record.materialHash === "string" ? { materialHash: record.materialHash } : {}),
    }];
  });
}

function normalizedDestinationKey(value: unknown): string | null {
  const normalized = normalizeDestination(value as ExternalPublicationDestination);
  if (!normalized) return null;
  return JSON.stringify(normalized);
}

function reservationMatchesCandidate(
  reservation: NonNullable<ReturnType<typeof getDeliveryReservation>>,
  candidate: ExternalPublicationCandidate,
): boolean {
  const storedBasis = reservation.attemptInputBasis as AttemptInputBasis | undefined;
  if (!storedBasis || !basisEquivalent(candidate.attemptInputBasis, storedBasis)) return false;
  if (normalizedDestinationKey(reservation.destination) !== normalizedDestinationKey(candidate.destination)) return false;
  const storedRefs = new Set(storedLicenseRefs(reservation.licenseRefs ?? []).map((ref) => ref.entityUuid));
  const candidateRefs = new Set(candidate.licenseRefs.map((ref) => ref.trim()).filter(Boolean));
  return storedRefs.size === candidateRefs.size && [...candidateRefs].every((ref) => storedRefs.has(ref));
}

function revalidateExternalReservationInTransaction(
  db: DatabaseSync,
  reservation: NonNullable<ReturnType<typeof getDeliveryReservation>>,
  nowMs: number,
): string | null {
  if (!reservation.destination || !reservation.hardDependencyBundle || !reservation.attemptInputBasis) {
    return "external_binding_missing";
  }
  const destination = normalizeDestination(reservation.destination as ExternalPublicationDestination);
  if (!destination) return "destination_invalid";
  let bundle: HardDependencyBundle;
  try { bundle = reservation.hardDependencyBundle as HardDependencyBundle; } catch { return "hard_dependency_bundle_invalid"; }
  let barrier: { epoch: number; revision: number };
  try { barrier = currentBarrier(db); } catch (error) { return error instanceof Error ? error.message : "authority_transition"; }
  if (barrier.epoch !== bundle.barrier.epoch || barrier.revision !== bundle.barrier.revision) return "authority_vector_stale";
  if (!allDependenciesCurrent(db, bundle, barrier, nowMs)) return "authority_vector_stale";

  const refs = storedLicenseRefs(reservation.licenseRefs ?? []);
  const rows = licenseRows(db, refs.map((ref) => ref.entityUuid), reservation.ownerId);
  if (refs.length === 0 || rows.length !== refs.length) return "license_missing";
  for (const ref of refs) {
    const row = rows.find((value) => value.entity_uuid === ref.entityUuid);
    if (!row) return "license_missing";
    const dep = bundle.licenses.find((item) => item.key === ref.entityUuid);
    if (!dep || licenseVersion(row) !== dep.rowRevision) return "authority_vector_stale";
    const reason = licenseUsable(
      row,
      destination,
      nowMs,
      ref.consumedByReservationId === reservation.id,
      ref.materialHash,
      ref.useNo,
    );
    if (reason) return reason;
  }

  const syntheticCandidate: ExternalPublicationCandidate = {
    ownerId: reservation.ownerId,
    reservationId: reservation.id,
    attemptInputBasis: reservation.attemptInputBasis as AttemptInputBasis,
    hardDependencyBundle: bundle,
    destination: reservation.destination as ExternalPublicationDestination,
    interactionIntent: "continue",
    licenseRefs: refs.map((ref) => ref.entityUuid),
  };
  return policyReason(db, syntheticCandidate, destination, nowMs);
}

/** Recheck the reservation binding immediately before an external dispatch part. */
export function recheckExternalPublicationReservation(
  db: DatabaseSync,
  reservationId: number,
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const reservation = getDeliveryReservation(db, reservationId);
  if (!reservation) return { ok: false, reason: "delivery_reservation_missing" };
  const destination = normalizeDestination(reservation.destination as ExternalPublicationDestination);
  if (!destination) return { ok: false, reason: "destination_invalid" };
  if (destination.kind === "external_dm" && !isExternalDmPublicationEnabled()) {
    return { ok: false, reason: "external_publication_disabled" };
  }
  if (destination.kind === "room" && !isRoomPublicationEnabled(process.env, destination.channelId)) {
    return { ok: false, reason: "room_publication_disabled" };
  }
  if (reservation.state !== "reserved" && reservation.state !== "sending") {
    return { ok: false, reason: "delivery_not_sendable" };
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = getDeliveryReservation(db, reservationId);
    if (!current) throw new Error("delivery_reservation_missing");
    const reason = revalidateExternalReservationInTransaction(db, current, nowMs);
    if (reason) {
      db.exec("ROLLBACK");
      return { ok: false, reason };
    }
    db.exec("COMMIT");
    return { ok: true };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve recheck error */ }
    return { ok: false, reason: error instanceof Error ? error.message : "external_recheck_failed" };
  }
}

/**
 * Destination-bound S5 admission. The function is deliberately closed by
 * default and only binds a drafted reservation after the coherent authority
 * read, disclosure checks, CAS reservation, and one-shot consumption succeed.
 */
export function admitExternalPublication(
  db: DatabaseSync,
  authorityDb: DatabaseSync | undefined,
  candidate: ExternalPublicationCandidate,
): ExternalPublicationAdmission {
  const shapeError = validateCandidateShape(candidate);
  if (shapeError) return admissionFailure(candidate, shapeError);

  let nuclear: DatabaseSync;
  try { nuclear = selectNuclearDb(db, authorityDb); } catch (error) {
    return admissionFailure(candidate, error instanceof Error ? error.message : "external_publication_authority_db_missing");
  }
  const nowMs = candidate.nowMs ?? Date.now();
  const destination = normalizeDestination(candidate.destination);
  if (!destination) return admissionFailure(candidate, "destination_invalid");
  if (destination.kind === "external_dm" && !isExternalDmPublicationEnabled()) {
    return admissionFailure(candidate, "external_publication_disabled");
  }

  nuclear.exec("BEGIN IMMEDIATE");
  try {
    let reservation = getDeliveryReservation(nuclear, candidate.reservationId);
    if (!reservation || reservation.ownerId !== candidate.ownerId) throw new Error("delivery_reservation_missing");
    if (reservation.state === "reserved" || reservation.state === "sending") {
      if (!reservationMatchesCandidate(reservation, candidate)) {
        nuclear.exec("ROLLBACK");
        return admissionFailure(candidate, "delivery_reservation_binding_conflict");
      }
      const existingReason = revalidateExternalReservationInTransaction(nuclear, reservation, nowMs);
      if (!existingReason) {
        nuclear.exec("COMMIT");
        return { admitted: true, quarantined: false, reservationId: candidate.reservationId, reservation };
      }
      nuclear.exec("ROLLBACK");
      return admissionFailure(candidate, existingReason);
    }
    const basisReason = currentnessReason(nuclear, candidate, reservation, nowMs);
    if (basisReason) {
      nuclear.exec("ROLLBACK");
      return admissionFailure(candidate, basisReason);
    }
    const refs = [...new Set(candidate.licenseRefs.map((ref) => ref.trim()).filter(Boolean))];
    if (refs.length === 0) throw new Error("license_required");
    const rows = licenseRows(nuclear, refs, candidate.ownerId);
    if (rows.length !== refs.length) throw new Error("license_missing");
    const bundleLicenseKeys = new Set(candidate.hardDependencyBundle.licenses.map((ref) => ref.key));
    if (refs.some((ref) => !bundleLicenseKeys.has(ref))) throw new Error("license_binding_missing");
    for (const ref of refs) {
      const row = rows.find((value) => value.entity_uuid === ref);
      if (!row) throw new Error("license_missing");
      const reason = licenseUsable(row, destination, nowMs, false, candidate.materialHash);
      if (reason) throw new Error(reason);
    }
    const policy = policyReason(nuclear, candidate, destination, nowMs);
    if (policy) {
      nuclear.exec("ROLLBACK");
      return admissionFailure(candidate, policy);
    }

    reservation = reserveExternalDeliveryInTransaction(nuclear, candidate.reservationId, {
      destination: candidate.destination,
      attemptInputBasis: candidate.attemptInputBasis,
      hardDependencyBundle: candidate.hardDependencyBundle,
      licenseRefs: refs,
    });

    const consumed: Array<{
      entityUuid: string;
      useNo: number;
      materialHash: string;
      version: number;
    }> = [];
    for (const ref of refs) {
      const before = rows.find((value) => value.entity_uuid === ref);
      if (!before) throw new Error("license_missing");
      const after = consumeLicenseOnceInExistingTransaction(nuclear, {
        entityUuid: ref,
        expectedVersion: licenseVersion(before),
        reservationId: String(candidate.reservationId),
        nowMs,
      });
      consumed.push({
        entityUuid: ref,
        useNo: after.usesConsumed,
        materialHash: after.materialHash,
        version: after.version,
      });
    }

    const postBarrier = currentBarrier(nuclear);
    const postVersions = new Map(consumed.map((item) => [item.entityUuid, item.version]));
    const postBundle = bundleWithBarrier(candidate.hardDependencyBundle, postBarrier, postVersions);
    const useRefs = consumed.map((item) => ({
      licenseEntityUuid: item.entityUuid,
      useNo: item.useNo,
      consumedByReservationId: candidate.reservationId,
      consumedAtBarrier: postBarrier,
      materialHash: item.materialHash,
    }));
    const updated = nuclear.prepare(
      `UPDATE delivery_reservations
          SET hard_dependency_bundle_json = ?, license_refs_json = ?
        WHERE id = ? AND state = 'reserved'`,
    ).run(JSON.stringify(postBundle), JSON.stringify(useRefs), candidate.reservationId);
    if (Number(updated.changes) !== 1) throw new Error("delivery_reservation_claim_lost");
    const finalReservation = getDeliveryReservation(nuclear, candidate.reservationId);
    if (!finalReservation) throw new Error("delivery_reservation_missing");
    nuclear.exec("COMMIT");
    return {
      admitted: true,
      quarantined: false,
      reservationId: candidate.reservationId,
      reservation: finalReservation,
      postConsumptionBarrier: postBarrier,
    };
  } catch (error) {
    try { nuclear.exec("ROLLBACK"); } catch { /* preserve admission failure */ }
    return admissionFailure(candidate, error instanceof Error ? error.message : "external_publication_blocked");
  }
}
