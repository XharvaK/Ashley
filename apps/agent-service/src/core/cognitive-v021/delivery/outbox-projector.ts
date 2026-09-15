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
  updateOutboxStatus,
} from "../speech/outbox.js";
import {
  admitExternalPublication,
  type ExternalPublicationCandidate,
} from "../settlement/publish.js";
import { externalDmPrincipal } from "../social/dm-activation.js";
import {
  getSystemNotice,
  updateSystemNoticeStatus,
} from "../speech/infrastructure-notice.js";
import { recordDeliveryC3TerminalFailure } from "../failure/c3-recorder.js";
import type {
  DeliveryIntent,
  OutboxDeliveryProjector as OutboxDeliveryProjectorContract,
  OutboxSendStatus,
  SpeechOutboxRow,
  SystemNoticeOutbox,
} from "../types.js";

export type ProjectionGate = (intent: DeliveryIntent) => { ok: true } | { ok: false; reason: string };

export type OutboxDeliveryProjectorOptions = {
  nowMs?: () => number;
  gate?: ProjectionGate;
  isCurrentGeneration?: (row: SpeechOutboxRow | SystemNoticeOutbox) => boolean;
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

function markTerminalFromDestination(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  row: SpeechOutboxRow | SystemNoticeOutbox,
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
    } else {
      updateSystemReconciliation(sidecar, row, terminal.status, assessment, reservationId);
    }
  } else if (state === "sending") {
    if ("outboxId" in row) {
      updateOutboxStatus(sidecar, row.outboxId, "sending", {
        discordMessageIds: assessment.confirmedPrefix
          .map((bubble) => bubble.discordMessageId)
          .filter((id): id is string => Boolean(id)),
        nuclearReservationId: reservationId,
      });
    } else {
      updateSystemNoticeStatus(sidecar, row.noticeId, "sending", {
        discordMessageId: assessment.complete ? assessment.confirmedPrefix[0]?.discordMessageId ?? null : null,
        nuclearReservationId: reservationId,
      });
    }
  } else if ("outboxId" in row) {
    updateOutboxStatus(sidecar, row.outboxId, "projected", { nuclearReservationId: reservationId, finalizationReason: null });
  } else {
    updateSystemNoticeStatus(sidecar, row.noticeId, "projected", { nuclearReservationId: reservationId });
  }
  return assessment;
}

function projectedRow(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  reservationId: number,
): SpeechOutboxRow | SystemNoticeOutbox | null {
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
  return null;
}

function markDeliveredEvidence(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  reservationId: number,
  row: SpeechOutboxRow | SystemNoticeOutbox,
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
  const role = "outboxId" in row ? "ashley" : "system";
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
  if ("outboxId" in row) appendAshleyEvidence(sidecar, input);
  else appendSystemEvent(sidecar, input);
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
  } else {
    updateSystemNoticeStatus(sidecar, row.noticeId, "sending", {
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
    const generation = "outboxId" in row
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
): SpeechOutboxRow | SystemNoticeOutbox | null {
  const match = /^(speech|system):(\d+)$/.exec(projectionKey);
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return match[1] === "speech"
    ? getSpeechOutbox(sidecar, id)
    : getSystemNotice(sidecar, id);
}

function explicitSourceRow(
  sidecar: DatabaseSync,
  reservationId: number,
): SpeechOutboxRow | SystemNoticeOutbox | null {
  const speech = sidecar.prepare(
    "SELECT outbox_id FROM speech_outbox WHERE nuclear_reservation_id = ? LIMIT 1",
  ).get(reservationId) as Row | undefined;
  if (speech) return getSpeechOutbox(sidecar, number(speech.outbox_id));
  const notice = sidecar.prepare(
    "SELECT notice_id FROM system_notice_outbox WHERE nuclear_reservation_id = ? LIMIT 1",
  ).get(reservationId) as Row | undefined;
  return notice ? getSystemNotice(sidecar, number(notice.notice_id)) : null;
}

function sweepReservationIds(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  limit: number,
): ReservationSweepPage {
  const speech: number[] = [];
  const notices: number[] = [];
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
    } else if (notices.length < limit) {
      notices.push(ownerId);
    }
  }

  // Read candidates from the durable nuclear owner, then reserve output slots
  // for both sidecar families. The final fill keeps the sweep bounded while
  // preventing one family from consuming every slot.
  const speechQuota = Math.ceil(limit / 2);
  const noticeQuota = Math.floor(limit / 2);
  const selected = [
    ...speech.slice(0, speechQuota),
    ...notices.slice(0, noticeQuota),
  ];
  for (const id of [...speech.slice(speechQuota), ...notices.slice(noticeQuota)]) {
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
  row: SpeechOutboxRow | SystemNoticeOutbox,
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
  ) {}

  private reserve(row: SpeechOutboxRow | SystemNoticeOutbox, textValue: string): number {
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
    const initialState = external ? "drafted" : "reserved";
    this.nuclear.exec("BEGIN IMMEDIATE");
    try {
      const result = this.nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, user_message_id, decision_id, trigger,
            delivery_lane, initiative_reservation_id, state, error_category, finalization_reason,
            draft_text, first_bubble_deadline_at, first_sent_at,
            generation_lease_expires_at, delivery_lease_expires_at,
            created_at, finalized_at, cognitive_v021_projection_key,
            destination_json, attempt_input_basis_json, hard_dependency_bundle_json, license_refs_json)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, ?, NULL, NULL,
                 ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)`,
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
        external ? JSON.stringify(external.destination) : null,
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

  private async projectRow(row: SpeechOutboxRow | SystemNoticeOutbox): Promise<void> {
    const decision = shouldProject(row, this.options);
    if (!decision.ok) {
      if (decision.status === "suppressed") {
        if ("outboxId" in row) updateOutboxStatus(this.sidecar, row.outboxId, "suppressed", { finalizationReason: decision.reason });
        else updateSystemNoticeStatus(this.sidecar, row.noticeId, "suppressed");
      }
      return;
    }
    if ("outboxId" in row) updateOutboxStatus(this.sidecar, row.outboxId, "projecting");
    else updateSystemNoticeStatus(this.sidecar, row.noticeId, "projecting");
    const reservationId = this.reserve(row, "outboxId" in row ? row.licensedText : row.noticeText);
    const external = row.deliveryIntent.externalPublication;
    if (external) {
      const principal = external.destination.kind === "external_dm"
        ? external.destination.principalId
        : null;
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
      const admission = principal && externalDmPrincipal() === principal
        ? admitExternalPublication(this.nuclear, this.nuclear, candidate)
        : { admitted: false, quarantined: true, reason: "external_principal_mismatch", reservationId };
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
        } else {
          updateSystemNoticeStatus(this.sidecar, row.noticeId, "suppressed");
        }
        return;
      }
    }
    const destination = projectionReservation(this.nuclear, row.projectionKey);
    if (destination) {
      markTerminalFromDestination(this.sidecar, this.nuclear, row, destination);
    } else if ("outboxId" in row) {
      updateOutboxStatus(this.sidecar, row.outboxId, "projected", { nuclearReservationId: reservationId, finalizationReason: null });
    } else {
      updateSystemNoticeStatus(this.sidecar, row.noticeId, "projected", { nuclearReservationId: reservationId });
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
}

export function createOutboxProjector(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  options: OutboxDeliveryProjectorOptions = {},
): OutboxDeliveryProjector {
  return new OutboxDeliveryProjector(sidecar, nuclear, options);
}
