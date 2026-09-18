import type { DatabaseSync } from "node:sqlite";
import { planContentBubbles } from "../../delivery/bubble-plan.js";
import {
  getDeliveryReservation,
  listDeliveryBubbles,
} from "../../delivery/store.js";
import {
  appendAshleyEvidence,
  appendSystemEvent,
} from "../evidence/conversation-log.js";
import {
  getSpeechOutbox,
  registerCognitiveDeliveryDatabases,
  updateOutboxStatus,
} from "../speech/outbox.js";
import {
  getInterimOutbox,
  updateInterimStatus,
} from "../operation/interim.js";
import {
  admitExternalPublication,
  type ExternalPublicationCandidate,
} from "../settlement/publish.js";
import { externalDmPrincipal } from "../social/dm-activation.js";
import { isRoomPublicationEnabled } from "../social/room-activation.js";
import {
  getSystemNotice,
  updateSystemNoticeStatus,
} from "../speech/infrastructure-notice.js";
import { recordDeliveryC3TerminalFailure } from "../failure/c3-recorder.js";
import { cancelDeliveryReservation } from "../../delivery/abort-registry.js";
import { getCycle, updateCycleState } from "../cycle/inbox.js";
import type {
  DeliveryIntent,
  OperationInterimOutbox,
  OutboxDeliveryProjector as OutboxDeliveryProjectorContract,
  OutboxSendStatus,
  SpeechOutboxRow,
  SystemNoticeOutbox,
} from "../types.js";

export type ProjectionGate = (intent: DeliveryIntent) => { ok: true } | { ok: false; reason: string };

export type ProjectableRow = SpeechOutboxRow | SystemNoticeOutbox | OperationInterimOutbox;

export type OutboxDeliveryProjectorOptions = {
  nowMs?: () => number;
  gate?: ProjectionGate;
  isCurrentGeneration?: (row: ProjectableRow) => boolean;
  leaseMs?: number;
};

type Row = Record<string, unknown>;

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isTerminal(status: OutboxSendStatus): boolean {
  return status === "delivered" || status === "partially_delivered" || status === "send_failure" || status === "suppressed" || status === "suppressed_shadow";
}

function intentTrigger(intent: DeliveryIntent): "reactive" | "proactive" {
  return intent.deliveryLane === "proactive" ? "proactive" : "reactive";
}

function projectionReservation(db: DatabaseSync, key: string): Row | undefined {
  return db.prepare("SELECT * FROM delivery_reservations WHERE cognitive_v021_projection_key = ? LIMIT 1").get(key) as Row | undefined;
}

type DeliveryBubble = ReturnType<typeof listDeliveryBubbles>[number];

type ReceiptAssessment = Readonly<{
  confirmedPrefix: readonly DeliveryBubble[];
  complete: boolean;
  conflict: boolean;
}>;

function receiptAssessment(bubbles: readonly DeliveryBubble[]): ReceiptAssessment {
  const confirmedPrefix: DeliveryBubble[] = [];
  let gap = false;
  let conflict = false;
  for (const bubble of bubbles) {
    const hasMessageId = Boolean(bubble.discordMessageId?.trim());
    const hasSentAt = Boolean(bubble.sentAt?.trim());
    if (hasMessageId && hasSentAt && !gap) {
      confirmedPrefix.push({
        ...bubble,
        discordMessageId: bubble.discordMessageId!.trim(),
        sentAt: bubble.sentAt!.trim(),
      });
      continue;
    }
    if (!hasMessageId && !hasSentAt) {
      gap = true;
      continue;
    }
    // A one-sided receipt is not valid. A valid receipt after an unconfirmed
    // bubble is also not a prefix and therefore cannot be used as history.
    conflict = true;
  }
  return {
    confirmedPrefix,
    complete: !conflict && bubbles.length > 0 && confirmedPrefix.length === bubbles.length,
    conflict,
  };
}

function terminalReconciliation(
  state: string,
  assessment: ReceiptAssessment,
): { status: OutboxSendStatus; finalizationReason: string | null } {
  if (assessment.conflict) {
    return { status: "send_failure", finalizationReason: "reconciliation_conflict" };
  }
  if (assessment.complete) {
    return { status: "delivered", finalizationReason: null };
  }
  if (state === "committed") {
    return { status: "send_failure", finalizationReason: "reconciliation_conflict" };
  }
  if (state === "partially_delivered") {
    return assessment.confirmedPrefix.length > 0 && !assessment.complete
      ? { status: "partially_delivered", finalizationReason: null }
      : { status: "send_failure", finalizationReason: "reconciliation_conflict" };
  }
  if (assessment.confirmedPrefix.length > 0) {
    return { status: "partially_delivered", finalizationReason: null };
  }
  if (state === "cancelled") return { status: "suppressed", finalizationReason: null };
  return { status: "send_failure", finalizationReason: null };
}

function updateSpeechReconciliation(
  sidecar: DatabaseSync,
  row: SpeechOutboxRow,
  status: OutboxSendStatus,
  assessment: ReceiptAssessment,
  reservationId: number,
  finalizationReason: string | null,
): void {
  if (isTerminal(row.sendStatus)) return;
  updateOutboxStatus(sidecar, row.outboxId, status, {
    discordMessageIds: assessment.confirmedPrefix
      .map((bubble) => bubble.discordMessageId)
      .filter((id): id is string => Boolean(id)),
    nuclearReservationId: reservationId,
    finalizationReason,
  });
}

function updateSystemReconciliation(
  sidecar: DatabaseSync,
  row: SystemNoticeOutbox,
  status: OutboxSendStatus,
  assessment: ReceiptAssessment,
  reservationId: number,
): void {
  if (isTerminal(row.sendStatus)) return;
  updateSystemNoticeStatus(sidecar, row.noticeId, status, {
    discordMessageId: assessment.conflict ? null : assessment.confirmedPrefix[0]?.discordMessageId ?? null,
    nuclearReservationId: reservationId,
  });
}

function updateInterimReconciliation(
  sidecar: DatabaseSync,
  row: OperationInterimOutbox,
  status: OutboxSendStatus,
  assessment: ReceiptAssessment,
  reservationId: number,
): void {
  if (isTerminal(row.sendStatus)) return;
  updateInterimStatus(sidecar, row.interimId, status, {
    discordMessageId: assessment.conflict ? null : assessment.confirmedPrefix[0]?.discordMessageId ?? null,
    nuclearReservationId: reservationId,
  });
}

function markTerminalFromDestination(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  row: ProjectableRow,
  destination: Row,
): ReceiptAssessment {
  const state = text(destination.state);
  const reservationId = number(destination.id);
  const bubbles = listDeliveryBubbles(nuclear, reservationId);
  const baseAssessment = receiptAssessment(bubbles);
  const assessment: ReceiptAssessment = "noticeId" in row && bubbles.length !== 1
    ? { ...baseAssessment, complete: false, conflict: true }
    : baseAssessment;
  if (["committed", "aborted", "cancelled", "expired", "partially_delivered"].includes(state)) {
    const terminal = terminalReconciliation(state, assessment);
    const finalizationReason = terminal.finalizationReason ?? (text(destination.finalization_reason) || null);
    if ("outboxId" in row) {
      updateSpeechReconciliation(sidecar, row, terminal.status, assessment, reservationId, finalizationReason);
    } else if ("noticeId" in row) {
      updateSystemReconciliation(sidecar, row, terminal.status, assessment, reservationId);
    } else {
      updateInterimReconciliation(sidecar, row, terminal.status, assessment, reservationId);
    }
  } else if (state === "sending") {
    if ("outboxId" in row) {
      updateOutboxStatus(sidecar, row.outboxId, "sending", {
        discordMessageIds: assessment.confirmedPrefix
          .map((bubble) => bubble.discordMessageId)
          .filter((id): id is string => Boolean(id)),
        nuclearReservationId: reservationId,
      });
    } else if ("noticeId" in row) {
      updateSystemNoticeStatus(sidecar, row.noticeId, "sending", {
        discordMessageId: assessment.complete ? assessment.confirmedPrefix[0]?.discordMessageId ?? null : null,
        nuclearReservationId: reservationId,
      });
    } else {
      updateInterimStatus(sidecar, row.interimId, "sending", {
        discordMessageId: assessment.complete ? assessment.confirmedPrefix[0]?.discordMessageId ?? null : null,
        nuclearReservationId: reservationId,
      });
    }
  } else if ("outboxId" in row) {
    updateOutboxStatus(sidecar, row.outboxId, "projected", { nuclearReservationId: reservationId, finalizationReason: null });
  } else if ("noticeId" in row) {
    updateSystemNoticeStatus(sidecar, row.noticeId, "projected", { nuclearReservationId: reservationId });
  } else {
    updateInterimStatus(sidecar, row.interimId, "projected", { nuclearReservationId: reservationId });
  }
  return assessment;
}

function projectedRow(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  reservationId: number,
): ProjectableRow | null {
  const destination = nuclear.prepare(
    "SELECT cognitive_v021_projection_key FROM delivery_reservations WHERE id = ?",
  ).get(reservationId) as Row | undefined;
  const key = text(destination?.cognitive_v021_projection_key);
  if (key.startsWith("speech:")) {
    const id = Number(key.slice("speech:".length));
    return Number.isFinite(id) ? getSpeechOutbox(sidecar, id) : null;
  }
  if (key.startsWith("system:")) {
    const id = Number(key.slice("system:".length));
    return Number.isFinite(id) ? getSystemNotice(sidecar, id) : null;
  }
  if (key.startsWith("interim:")) {
    const id = Number(key.slice("interim:".length));
    return Number.isFinite(id) ? getInterimOutbox(sidecar, id) : null;
  }
  return null;
}

function markDeliveredEvidence(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  reservationId: number,
  row: ProjectableRow,
  assessment: ReceiptAssessment,
): void {
  const destination = getDeliveryReservation(nuclear, reservationId);
  if (
    !destination ||
    !["committed", "partially_delivered", "aborted", "cancelled", "expired"].includes(destination.state)
  ) return;
  if (assessment.conflict) return;
  if (destination.state === "committed" && !assessment.complete) return;
  if (destination.state === "partially_delivered" && assessment.complete) return;
  const delivered = assessment.confirmedPrefix;
  if (delivered.length === 0) return;
  // Interim hold drafts are Ashley speech owned by a detached operation, so
  // delivered interim text joins Ashley evidence like settlement speech.
  const role = "outboxId" in row || "interimId" in row ? "ashley" : "system";
  const existing = sidecar.prepare(
    `SELECT row_id FROM conversation_evidence_log
      WHERE reservation_id = ? AND role = ? LIMIT 1`,
  ).get(reservationId, role);
  if (existing) return;
  const input = {
    conversationId: row.conversationId,
    text: delivered.map((bubble) => bubble.text).join("\n\n"),
    discordMessageIds: delivered.map((bubble) => bubble.discordMessageId!),
    reservationId,
    producingCycleId: row.cycleId,
    delivered: true,
    dataClassification: "never_public" as const,
  };
  if ("outboxId" in row || "interimId" in row) appendAshleyEvidence(sidecar, input);
  else appendSystemEvent(sidecar, input);
}

/**
 * Delivery owns this narrow lifecycle convergence. A sending cycle remains
 * sending only while a durable continuation owner is still valid; terminal
 * delivery truth removes that owner without replaying or inventing a receipt.
 */
function convergeTerminalSendingCycle(
  sidecar: DatabaseSync,
  row: ProjectableRow,
  nowMs: number,
): void {
  if (!row.cycleId) return;
  const cycle = getCycle(sidecar, row.cycleId);
  if (!cycle || cycle.state !== "sending") return;
  const current = "outboxId" in row
    ? getSpeechOutbox(sidecar, row.outboxId)
    : "noticeId" in row
      ? getSystemNotice(sidecar, row.noticeId)
      : getInterimOutbox(sidecar, row.interimId);
  if (!current || !isTerminal(current.sendStatus)) return;
  // Queue ownership and delivery lifecycle are independent. The queue may
  // remain active for the next Thought while this speech/ACK has already
  // reached terminal delivery truth.
  updateCycleState(sidecar, cycle.cycleId, "silent", nowMs);
}

/** Mark a claimed nuclear projection as sending in its source sidecar. */
export function markProjectedDeliverySending(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  reservationId: number,
): boolean {
  const row = projectedRow(sidecar, nuclear, reservationId);
  if (!row) return false;
  if ("outboxId" in row) {
    updateOutboxStatus(sidecar, row.outboxId, "sending", {
      nuclearReservationId: reservationId,
    });
  } else if ("noticeId" in row) {
    updateSystemNoticeStatus(sidecar, row.noticeId, "sending", {
      nuclearReservationId: reservationId,
    });
  } else {
    updateInterimStatus(sidecar, row.interimId, "sending", {
      nuclearReservationId: reservationId,
    });
  }
  return true;
}

/** Reconcile nuclear receipt/finalization truth back to the v0.2.1 outbox. */
export function reconcileProjectedDelivery(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  reservationId: number,
): boolean {
  return reconcileProjectedDeliveryInternal(sidecar, nuclear, reservationId).ok;
}

type ReconciliationOutcome = Readonly<{
  ok: boolean;
  conflict: boolean;
}>;

function reconcileProjectedDeliveryInternal(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  reservationId: number,
): ReconciliationOutcome {
  const row = projectedRow(sidecar, nuclear, reservationId);
  if (!row) return { ok: false, conflict: false };
  const destination = nuclear.prepare(
    "SELECT * FROM delivery_reservations WHERE id = ?",
  ).get(reservationId) as Row | undefined;
  if (!destination) return { ok: false, conflict: false };
  const assessment = markTerminalFromDestination(sidecar, nuclear, row, destination);
  const destinationState = text(destination.state);
  const terminalState = ["committed", "aborted", "cancelled", "expired", "partially_delivered"].includes(destinationState);
  const conflict = terminalState && terminalReconciliation(destinationState, assessment).finalizationReason === "reconciliation_conflict";
  if (!conflict && (destinationState === "aborted" || destinationState === "expired" || destinationState === "partially_delivered")) {
    const cycle = row.cycleId
      ? sidecar.prepare("SELECT generation FROM cycle_records WHERE cycle_id = ? LIMIT 1").get(row.cycleId) as Row | undefined
      : undefined;
    const generation = "outboxId" in row || "interimId" in row
      ? row.generation
      : cycle ? number(cycle.generation) : null;
    if (row.cycleId && generation != null) {
      const deliveredBubbleCount = assessment.confirmedPrefix.length;
      const finalizedAt = text(destination.finalized_at);
      const parsedFinalizedAt = Date.parse(finalizedAt);
      recordDeliveryC3TerminalFailure(sidecar, {
        reservationId,
        cycleId: row.cycleId,
        generation,
        state: destinationState,
        occurredAtMs: Number.isFinite(parsedFinalizedAt) ? parsedFinalizedAt : Date.now(),
        deliveredBubbleCount,
      });
    }
  }
  markDeliveredEvidence(sidecar, nuclear, reservationId, row, assessment);
  convergeTerminalSendingCycle(sidecar, row, Date.now());
  return { ok: true, conflict };
}

export type DeliveryReconciliationSweep = Readonly<{
  scanned: number;
  reconciled: number;
  conflicts: number;
}>;

const ACTIVE_RECONCILIATION_STATUSES: readonly OutboxSendStatus[] = [
  "pending",
  "projecting",
  "projected",
  "sending",
];
const RECONCILIATION_OWNER_PAGE_SIZE = 50;
const reconciliationCursorByNuclearOwner = new WeakMap<DatabaseSync, number>();

type ReservationSweepPage = Readonly<{
  reservationIds: readonly number[];
  nextCursor: number | null;
}>;

function projectedSourceRow(
  sidecar: DatabaseSync,
  projectionKey: string,
): ProjectableRow | null {
  const match = /^(speech|system|interim):(\d+)$/.exec(projectionKey);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (match[1] === "speech") return getSpeechOutbox(sidecar, id);
  if (match[1] === "system") return getSystemNotice(sidecar, id);
  return getInterimOutbox(sidecar, id);
}

function explicitSourceRow(
  sidecar: DatabaseSync,
  reservationId: number,
): ProjectableRow | null {
  const speech = sidecar.prepare(
    "SELECT outbox_id FROM speech_outbox WHERE nuclear_reservation_id = ? LIMIT 1",
  ).get(reservationId) as Row | undefined;
  if (speech) return getSpeechOutbox(sidecar, number(speech.outbox_id));
  const notice = sidecar.prepare(
    "SELECT notice_id FROM system_notice_outbox WHERE nuclear_reservation_id = ? LIMIT 1",
  ).get(reservationId) as Row | undefined;
  if (notice) return getSystemNotice(sidecar, number(notice.notice_id));
  const interim = sidecar.prepare(
    "SELECT interim_id FROM operation_interim_outbox WHERE nuclear_reservation_id = ? LIMIT 1",
  ).get(reservationId) as Row | undefined;
  return interim ? getInterimOutbox(sidecar, number(interim.interim_id)) : null;
}

function sweepReservationIds(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  limit: number,
): ReservationSweepPage {
  const speech: number[] = [];
  const notices: number[] = [];
  const interim: number[] = [];
  const afterReservationId = reconciliationCursorByNuclearOwner.get(nuclear) ?? 0;
  const owners = nuclear.prepare(
    `SELECT id, cognitive_v021_projection_key
       FROM delivery_reservations
      WHERE id > ?
      ORDER BY id ASC
      LIMIT ?`,
  );

  const rows = owners.all(afterReservationId, RECONCILIATION_OWNER_PAGE_SIZE) as Row[];
  for (const owner of rows) {
    const ownerId = number(owner.id);
    const row = text(owner.cognitive_v021_projection_key)
      ? projectedSourceRow(sidecar, text(owner.cognitive_v021_projection_key))
      : explicitSourceRow(sidecar, ownerId);
    if (!row || !ACTIVE_RECONCILIATION_STATUSES.includes(row.sendStatus)) continue;
    if ("outboxId" in row) {
      if (speech.length < limit) speech.push(ownerId);
    } else if ("noticeId" in row) {
      if (notices.length < limit) notices.push(ownerId);
    } else if (interim.length < limit) {
      interim.push(ownerId);
    }
  }

  // Read candidates from the durable nuclear owner, then reserve output slots
  // for both sidecar families. The final fill keeps the sweep bounded while
  // preventing one family from consuming every slot. Interim hold rows fill
  // only leftover slots, so existing speech/notice selection is unchanged.
  const speechQuota = Math.ceil(limit / 2);
  const noticeQuota = Math.floor(limit / 2);
  const selected = [
    ...speech.slice(0, speechQuota),
    ...notices.slice(0, noticeQuota),
  ];
  for (const id of [...speech.slice(speechQuota), ...notices.slice(noticeQuota), ...interim]) {
    if (selected.length >= limit) break;
    selected.push(id);
  }
  return {
    reservationIds: selected,
    nextCursor: rows.length === RECONCILIATION_OWNER_PAGE_SIZE
      ? number(rows[rows.length - 1]?.id)
      : null,
  };
}

/**
 * Reconcile a bounded set of terminal nuclear delivery reservations. This is
 * an existing-owner sweep: it creates no delivery work and never resends. The
 * durable nuclear owner is scanned one page per sweep. A process-local cursor
 * advances between successful sweeps; it is mechanical traversal state only,
 * so restart resets it safely while reconciliation remains idempotent.
 */
export function reconcileProjectedDeliverySweep(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  options: { limit?: number } = {},
): DeliveryReconciliationSweep {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 25)));
  const page = sweepReservationIds(sidecar, nuclear, limit);
  const rows = page.reservationIds.map((id) => ({ id }));
  let reconciled = 0;
  let conflicts = 0;
  for (const item of rows) {
    const reservationId = number(item.id);
    if (reservationId <= 0) continue;
    const outcome = reconcileProjectedDeliveryInternal(sidecar, nuclear, reservationId);
    if (!outcome.ok) continue;
    reconciled += 1;
    if (outcome.conflict) conflicts += 1;
  }
  if (page.nextCursor == null) reconciliationCursorByNuclearOwner.delete(nuclear);
  else reconciliationCursorByNuclearOwner.set(nuclear, page.nextCursor);
  return { scanned: rows.length, reconciled, conflicts };
}

function shouldProject(
  row: ProjectableRow,
  options: OutboxDeliveryProjectorOptions,
): { ok: true } | { ok: false; status?: "pending" | "suppressed"; reason: string } {
  if (isTerminal(row.sendStatus)) return { ok: false, reason: "terminal" };
  if (row.origin === "shadow" || row.sendStatus === "suppressed_shadow") return { ok: false, status: "suppressed", reason: "shadow" };
  if (options.isCurrentGeneration && !options.isCurrentGeneration(row)) return { ok: false, status: "suppressed", reason: "superseded_generation" };
  if (options.gate) {
    const gate = options.gate(row.deliveryIntent);
    if (!gate.ok) {
      if (gate.reason === "daily_cap") return { ok: false, status: "pending", reason: gate.reason };
      return { ok: false, status: "suppressed", reason: gate.reason };
    }
  }
  return { ok: true };
}

export class OutboxDeliveryProjector implements OutboxDeliveryProjectorContract {
  constructor(
    private readonly sidecar: DatabaseSync,
    private readonly nuclear: DatabaseSync,
    private readonly options: OutboxDeliveryProjectorOptions = {},
  ) {
    registerCognitiveDeliveryDatabases(sidecar, nuclear);
  }

  private cancelSuppressedReservation(row: ProjectableRow): void {
    if (row.sendStatus !== "suppressed" && row.sendStatus !== "suppressed_shadow") return;
    const bound = row.nuclearReservationId == null
      ? projectionReservation(this.nuclear, row.projectionKey)
      : undefined;
    const reservationId = row.nuclearReservationId ?? (bound ? number(bound.id) : null);
    if (reservationId == null || reservationId <= 0) return;
    const reservation = getDeliveryReservation(this.nuclear, reservationId);
    if (!reservation || !["drafted", "reserved", "sending"].includes(reservation.state)) return;
    cancelDeliveryReservation(this.nuclear, {
      reservationId,
      ownerId: reservation.ownerId,
    });
  }

  private reserve(row: ProjectableRow, textValue: string): number {
    const key = row.projectionKey;
    const existing = projectionReservation(this.nuclear, key);
    if (existing) {
      markTerminalFromDestination(this.sidecar, this.nuclear, row, existing);
      return number(existing.id);
    }

    const now = this.options.nowMs?.() ?? Date.now();
    const nowIso = new Date(now).toISOString();
    const leaseIso = new Date(now + (this.options.leaseMs ?? 120_000)).toISOString();
    const bubbles = planContentBubbles(textValue);
    const external = row.deliveryIntent.externalPublication;
    const destination = external?.destination ?? row.deliveryIntent.destination;
    const initialState = external ? "drafted" : "reserved";
    const commitmentBindings = row.deliveryIntent.commitmentBindings ?? [];
    const commitmentBinding = commitmentBindings.length === 1 ? commitmentBindings[0] : undefined;
    const commitmentId = commitmentBinding?.commitmentId ?? null;
    const speechOutboxId = "outboxId" in row ? row.outboxId : null;
    this.nuclear.exec("BEGIN IMMEDIATE");
    try {
      const result = this.nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, user_message_id, decision_id, trigger,
            delivery_lane, initiative_reservation_id, state, error_category, finalization_reason,
            draft_text, first_bubble_deadline_at, first_sent_at,
            generation_lease_expires_at, delivery_lease_expires_at,
            created_at, finalized_at, cognitive_v021_projection_key,
            commitment_id, commitment_occurrence_id, commitment_attempt_id, speech_outbox_id,
            destination_json, attempt_input_basis_json, hard_dependency_bundle_json, license_refs_json)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, ?, NULL, NULL,
                 ?, NULL, NULL, NULL, ?, ?, NULL,
                 ?, ?, ?, ?, ?,
                 ?, ?, ?, ?)`,
      ).run(
        row.deliveryIntent.ownerId,
        row.deliveryIntent.channel,
        row.deliveryIntent.threadId,
        intentTrigger(row.deliveryIntent),
        row.deliveryIntent.deliveryLane,
        initialState,
        textValue,
        leaseIso,
        nowIso,
        key,
        commitmentId,
        null,
        null,
        speechOutboxId,
        destination ? JSON.stringify(destination) : null,
        external ? JSON.stringify(external.attemptInputBasis) : null,
        external ? JSON.stringify(external.hardDependencyBundle) : null,
        external ? JSON.stringify(external.licenseRefs) : "[]",
      );
      const reservationId = number(result.lastInsertRowid);
      const insertBubble = this.nuclear.prepare(
        `INSERT INTO delivery_bubbles
           (reservation_id, ordinal, text, discord_message_id, sent_at)
         VALUES (?, ?, ?, NULL, NULL)`,
      );
      for (const bubble of bubbles) insertBubble.run(reservationId, bubble.ordinal, bubble.text);
      this.nuclear.exec("COMMIT");
      return reservationId;
    } catch (error) {
      try { this.nuclear.exec("ROLLBACK"); } catch { /* preserve insert error */ }
      const reconciled = projectionReservation(this.nuclear, key);
      if (reconciled) {
        markTerminalFromDestination(this.sidecar, this.nuclear, row, reconciled);
        return number(reconciled.id);
      }
      throw error;
    }
  }

  private async projectRow(row: ProjectableRow): Promise<void> {
    this.cancelSuppressedReservation(row);
    const decision = shouldProject(row, this.options);
    if (!decision.ok) {
      if (decision.status === "suppressed") {
        if ("outboxId" in row) updateOutboxStatus(this.sidecar, row.outboxId, "suppressed", { finalizationReason: decision.reason });
        else if ("noticeId" in row) updateSystemNoticeStatus(this.sidecar, row.noticeId, "suppressed");
        else updateInterimStatus(this.sidecar, row.interimId, "suppressed");
      }
      return;
    }
    if ("outboxId" in row) updateOutboxStatus(this.sidecar, row.outboxId, "projecting");
    else if ("noticeId" in row) updateSystemNoticeStatus(this.sidecar, row.noticeId, "projecting");
    else updateInterimStatus(this.sidecar, row.interimId, "projecting");
    const reservationId = this.reserve(
      row,
      "outboxId" in row ? row.licensedText : "noticeId" in row ? row.noticeText : row.surfaceDraft,
    );
    const external = row.deliveryIntent.externalPublication;
    if (external) {
      const candidate: ExternalPublicationCandidate = {
        ownerId: row.deliveryIntent.ownerId,
        reservationId,
        attemptInputBasis: external.attemptInputBasis,
        hardDependencyBundle: external.hardDependencyBundle,
        destination: external.destination,
        interactionIntent: external.interactionIntent,
        licenseRefs: [...external.licenseRefs],
        ...(external.materialHash ? { materialHash: external.materialHash } : {}),
        nowMs: this.options.nowMs?.() ?? Date.now(),
      };
      const admission = external.destination.kind === "external_dm"
        ? externalDmPrincipal() === external.destination.principalId
          ? admitExternalPublication(this.nuclear, this.nuclear, candidate)
          : { admitted: false, quarantined: true, reason: "external_principal_mismatch", reservationId }
        : isRoomPublicationEnabled(process.env, external.destination.channelId)
          ? admitExternalPublication(this.nuclear, this.nuclear, candidate)
          : { admitted: false, quarantined: true, reason: "room_publication_disabled", reservationId };
      if (!admission.admitted) {
        const nowIso = new Date(this.options.nowMs?.() ?? Date.now()).toISOString();
        this.nuclear.prepare(
          `UPDATE delivery_reservations
              SET state = 'aborted', error_category = ?, finalization_reason = 'send_failure', finalized_at = ?
            WHERE id = ? AND state = 'drafted'`,
        ).run(admission.reason ?? "external_publication_blocked", nowIso, reservationId);
        if ("outboxId" in row) {
          updateOutboxStatus(this.sidecar, row.outboxId, "suppressed", {
            nuclearReservationId: reservationId,
            finalizationReason: `external_publication_blocked:${admission.reason ?? "unknown"}`,
          });
        } else if ("noticeId" in row) {
          updateSystemNoticeStatus(this.sidecar, row.noticeId, "suppressed");
        } else {
          updateInterimStatus(this.sidecar, row.interimId, "suppressed");
        }
        return;
      }
    }
    const destination = projectionReservation(this.nuclear, row.projectionKey);
    if (destination) {
      markTerminalFromDestination(this.sidecar, this.nuclear, row, destination);
    } else if ("outboxId" in row) {
      updateOutboxStatus(this.sidecar, row.outboxId, "projected", { nuclearReservationId: reservationId, finalizationReason: null });
    } else if ("noticeId" in row) {
      updateSystemNoticeStatus(this.sidecar, row.noticeId, "projected", { nuclearReservationId: reservationId });
    } else {
      updateInterimStatus(this.sidecar, row.interimId, "projected", { nuclearReservationId: reservationId });
    }
  }

  async project(outboxId: number): Promise<void> {
    const row = getSpeechOutbox(this.sidecar, outboxId);
    if (!row) throw new Error("speech_outbox_missing");
    await this.projectRow(row);
  }

  async projectSystem(noticeId: number): Promise<void> {
    const row = getSystemNotice(this.sidecar, noticeId);
    if (!row) throw new Error("system_notice_missing");
    await this.projectRow(row);
  }

  async projectInterim(interimId: number): Promise<void> {
    const row = getInterimOutbox(this.sidecar, interimId);
    if (!row) throw new Error("interim_missing");
    await this.projectRow(row);
  }
}

export function createOutboxProjector(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  options: OutboxDeliveryProjectorOptions = {},
): OutboxDeliveryProjector {
  return new OutboxDeliveryProjector(sidecar, nuclear, options);
}
