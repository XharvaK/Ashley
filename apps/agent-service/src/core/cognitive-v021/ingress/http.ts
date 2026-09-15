import { randomUUID } from "node:crypto";
import type express from "express";
import type { DatabaseSync } from "node:sqlite";
import { resolveActiveThread } from "../../memory/threads.js";
import {
  appendExternalUtteranceInTransaction,
  appendOwnerUtteranceInTransaction,
  getEvidenceByRowId,
} from "../evidence/conversation-log.js";
import { resolveSocialConversation } from "../../memory/threads.js";
import { notifySidecarPostCommit } from "../retrieval/derived-store.js";
import { appendCycleLogIds, appendInboxEventInTransaction, getCycle, getInboxEvent } from "../cycle/inbox.js";
import {
  composeOrPreemptInTransaction,
  preemptExternalRoomAttemptsInTransaction,
} from "../cycle/fence.js";
import { cancelActiveThought } from "../cycle/active.js";
import {
  advanceDeferredFrontierEvidence,
  getActiveDeferredFrontier,
} from "../frontier/ledger.js";
import type { CycleRecord, InboxEvent } from "../types.js";
import type { AttachmentIntakeRef } from "../../perception/types.js";
import {
  classifyEligibility,
  readEligibilityBundle,
} from "../../relationship/social-authority.js";
import { isRoomSeedActive } from "../../relationship/room-seeding.js";

export type CognitiveIngressBody = {
  userId: string;
  message: string;
  channel?: string;
  threadId?: string;
  discordMessageIds?: string[];
  inboundDiscordMessageIds?: string[];
  finalFragmentReceivedAtMs?: number;
  attachments?: Array<{
    discordAttachmentId: string;
    declaredMime: string;
    fileName: string;
    declaredByteSize?: number;
    sourceUrl: string;
  }>;
};

export type CognitiveIngressResult = {
  accepted: true;
  evidenceRowId: string;
  inboxEventId: string;
  conversationId: string;
  cycleId: string;
  generation: number;
  action: "compose" | "preempt";
  duplicate?: boolean;
  evidenceRecordId: string;
  admittedAtMs: number;
};

function resolveExistingWorkDisposition(
  sidecar: DatabaseSync,
  conversationId: string,
  evidenceRowId: string,
): { inbox: InboxEvent; cycle: CycleRecord } {
  const rows = sidecar.prepare(
    `SELECT id FROM inbox_events
      WHERE conversation_id = ?
        AND json_extract(payload_json, '$.evidenceRowId') = ?
      ORDER BY created_at_ms ASC`,
  ).all(conversationId, evidenceRowId) as Array<{ id?: unknown }>;

  if (rows.length === 0) {
    throw new Error("corrupt_duplicate_work_disposition_missing_inbox");
  }

  const matchedEvents: InboxEvent[] = [];
  for (const r of rows) {
    if (typeof r?.id === "string") {
      const ev = getInboxEvent(sidecar, r.id);
      if (ev) matchedEvents.push(ev);
    }
  }

  if (matchedEvents.length === 0) {
    throw new Error("corrupt_duplicate_work_disposition_missing_inbox");
  }

  const cycleIds = new Set<string>();
  for (const ev of matchedEvents) {
    const payload = (typeof ev.payload === "object" && ev.payload !== null && !Array.isArray(ev.payload))
      ? (ev.payload as Record<string, unknown>)
      : {};
    const cycleId = typeof payload.cycleId === "string" ? payload.cycleId : null;
    if (cycleId) cycleIds.add(cycleId);
  }

  if (cycleIds.size === 0) {
    throw new Error("corrupt_duplicate_work_disposition_missing_cycle");
  }
  if (cycleIds.size > 1) {
    throw new Error("corrupt_duplicate_work_disposition_conflicting_cycles");
  }

  const [targetCycleId] = Array.from(cycleIds);
  const cycle = getCycle(sidecar, targetCycleId);
  if (!cycle) {
    throw new Error("corrupt_duplicate_work_disposition_cycle_missing");
  }

  const isLeader = cycle.triggerRef === evidenceRowId;
  const isFollower = cycle.composeLogIds.includes(evidenceRowId);
  if (!isLeader && !isFollower) {
    throw new Error("corrupt_duplicate_work_disposition_cycle_inconsistent");
  }

  return { inbox: matchedEvents[0], cycle };
}

export function admitCognitiveIngress(
  sidecar: DatabaseSync,
  nuclearDb: DatabaseSync,
  input: CognitiveIngressBody,
  options: { nowMs?: number; occupantId?: string | null; authorityEpoch?: number } = {},
): CognitiveIngressResult {
  const channel = input.channel ?? "discord";
  if (channel !== "discord") throw new Error("channel_retired");
  const text = input.message.trim();
  if (!text) throw new Error("message_required");
  const conversationId = resolveActiveThread(nuclearDb, input.userId, channel);
  const discordMessageIds = input.discordMessageIds ?? input.inboundDiscordMessageIds ?? [];
  const admittedAtMs = options.nowMs ?? input.finalFragmentReceivedAtMs ?? Date.now();

  sidecar.exec("BEGIN IMMEDIATE");
  let evidence: ReturnType<typeof appendOwnerUtteranceInTransaction>["evidence"];
  try {
    const appendResult = appendOwnerUtteranceInTransaction(sidecar, {
      conversationId,
      text,
      discordMessageIds,
      nowMs: admittedAtMs,
    });
    evidence = appendResult.evidence;

    if (appendResult.duplicate) {
      const disposition = resolveExistingWorkDisposition(sidecar, evidence.conversationId, evidence.rowId);
      sidecar.exec("COMMIT");
      return {
        accepted: true,
        evidenceRowId: evidence.rowId,
        evidenceRecordId: evidence.rowId,
        inboxEventId: disposition.inbox.id,
        conversationId: evidence.conversationId,
        cycleId: disposition.cycle.cycleId,
        generation: disposition.cycle.generation,
        action: "compose",
        duplicate: true,
        admittedAtMs: evidence.createdAtMs,
      };
    }

    const roomPreemptions = preemptExternalRoomAttemptsInTransaction(sidecar, admittedAtMs);
    const activeFrontier = getActiveDeferredFrontier(sidecar, conversationId);
    if (activeFrontier) {
      advanceDeferredFrontierEvidence(sidecar, activeFrontier.frontierId, evidence.rowId, admittedAtMs);
      appendCycleLogIds(sidecar, activeFrontier.cycleId, [evidence.rowId], admittedAtMs);
      const inbox = appendInboxEventInTransaction(
        sidecar,
        {
          conversationId,
          kind: "owner_utterance",
          payload: {
            cycleId: activeFrontier.cycleId,
            evidenceRowId: evidence.rowId,
            discordMessageIds: evidence.discordMessageIds,
            ownerId: input.userId,
            channel,
            threadId: input.threadId ?? conversationId,
            attachments: input.attachments ?? [],
            subsumedByFrontierId: activeFrontier.frontierId,
          },
          createdAtMs: admittedAtMs,
          initialTerminalReason: "subsumed_by_frontier",
        },
        randomUUID(),
      );
      sidecar.exec("COMMIT");
      for (const cancellation of roomPreemptions) cancelActiveThought(cancellation);
      try { notifySidecarPostCommit(sidecar, { changedRowIds: [evidence.rowId] }); } catch {}
      return {
        accepted: true,
        evidenceRowId: evidence.rowId,
        inboxEventId: inbox.id,
        conversationId,
        cycleId: activeFrontier.cycleId,
        generation: activeFrontier.generation,
        action: "compose",
        evidenceRecordId: evidence.rowId,
        admittedAtMs: evidence.createdAtMs,
      };
    }

    const fence = composeOrPreemptInTransaction(sidecar, {
      conversationId,
      evidenceRowIds: [evidence.rowId],
      triggerKind: "owner_message",
      triggerRef: evidence.rowId,
      occupantId: options.occupantId ?? input.userId,
      authorityEpoch: options.authorityEpoch ?? 1,
      nowMs: admittedAtMs,
    });
    const inbox = appendInboxEventInTransaction(
      sidecar,
      {
        conversationId,
        wakeId: fence.cycle.wakeId,
        kind: "owner_utterance",
        payload: {
          cycleId: fence.cycleId,
          evidenceRowId: evidence.rowId,
          discordMessageIds: evidence.discordMessageIds,
          ownerId: input.userId,
          channel,
          threadId: input.threadId ?? conversationId,
          attachments: input.attachments ?? [],
        },
        createdAtMs: admittedAtMs,
      },
      randomUUID(),
    );
    sidecar.exec("COMMIT");
    for (const cancellation of roomPreemptions) cancelActiveThought(cancellation);
    if (fence.activeThoughtCancellation) {
      cancelActiveThought(fence.activeThoughtCancellation);
    }
    try { notifySidecarPostCommit(sidecar, { changedRowIds: [evidence.rowId] }); } catch {}
    return {
      accepted: true,
      evidenceRowId: evidence.rowId,
      inboxEventId: inbox.id,
      conversationId,
      cycleId: fence.cycleId,
      generation: fence.generation,
      action: fence.action,
      evidenceRecordId: evidence.rowId,
      admittedAtMs: evidence.createdAtMs,
    };
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export type ExternalEnvelopeLocation =
  | { kind: "external_dm"; principalId: string; channelId: string }
  | { kind: "room"; guildId: string; channelId: string };

export type ExternalCaptureEnvelope = {
  speakerPrincipalId: string;
  speakerKind: "external_human" | "external_bot";
  location: ExternalEnvelopeLocation;
  audienceAtCapture: "unknown";
  sentAtMs: number;
  discordMessageId: string;
  replyToMessageId?: string;
  mentionIds: string[];
  attachmentRefs: AttachmentIntakeRef[];
  provenance: { source: "discord"; receivedAtMs: number };
};

export type ExternalGateHint = "drop" | "capture_quarantine" | "allow_social";

export type ExternalCaptureBody = {
  envelope: ExternalCaptureEnvelope;
  message: string;
  discordMessageId: string;
  attachments: AttachmentIntakeRef[];
  gateHint?: ExternalGateHint;
  conversationKey?: string;
};

export type ExternalCaptureResult = {
  captureRef: string;
  conversationKey: string;
  duplicate: boolean;
};

export type ExternalBatchInput = {
  captureRefs: string[];
  conversationKey: string;
  finalFragmentReceivedAtMs?: number;
};

export type ExternalBatchItemResult = {
  captureRef: string;
  disposition:
    | "external_eligible_pending"
    | "quarantined_external"
    | "already_batched"
    | "capture_missing"
    | "capture_invalid";
  notificationQueued?: boolean;
  reason?: string;
};

export type ExternalBatchResult = {
  accepted: true;
  conversationKey: string;
  results: ExternalBatchItemResult[];
};

export type ExternalAdmissionOptions = {
  nowMs?: number;
  ownerId?: string;
  roomSeedActive?: boolean;
  projectSystemNotice?: (noticeId: number) => Promise<void> | void;
};

type ExternalCapturePayload = {
  captureRef: string;
  evidenceRowId: string;
  conversationKey: string;
  discordMessageId: string;
  gateHint?: ExternalGateHint;
};

type ExternalInboxRow = {
  id?: unknown;
  kind?: unknown;
  conversation_id?: unknown;
  payload_json?: unknown;
};

type ExternalRecord = Record<string, unknown>;

const MAX_EXTERNAL_MESSAGE_LENGTH = 4_000;
const MAX_EXTERNAL_ATTACHMENTS = 4;
const MAX_EXTERNAL_MENTIONS = 100;
const MAX_SOCIAL_NOTIFICATION_WINDOW_MS = 15 * 60_000;
const MAX_SOCIAL_NOTIFICATIONS_PER_DAY = 20;

export function isExternalSocialCaptureEnabled(): boolean {
  return process.env.RA_SOCIAL_CAPTURE === "true" || process.env.RA_SOCIAL_CAPTURE === "1";
}

function externalRecord(value: unknown): ExternalRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ExternalRecord
    : null;
}

function externalRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function externalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateExternalAttachmentRefs(value: unknown): AttachmentIntakeRef[] | null {
  if (!Array.isArray(value) || value.length > MAX_EXTERNAL_ATTACHMENTS) return null;
  const refs: AttachmentIntakeRef[] = [];
  for (const item of value) {
    const row = externalRecord(item);
    const discordAttachmentId = externalRequiredText(row?.discordAttachmentId);
    const declaredMime = externalRequiredText(row?.declaredMime);
    const fileName = externalRequiredText(row?.fileName);
    const sourceUrl = externalRequiredText(row?.sourceUrl);
    const declaredByteSize = row?.declaredByteSize;
    if (!discordAttachmentId || !declaredMime || !fileName || !sourceUrl) return null;
    if (declaredByteSize !== undefined &&
      (typeof declaredByteSize !== "number" || !Number.isInteger(declaredByteSize) || declaredByteSize < 0)) {
      return null;
    }
    refs.push({
      discordAttachmentId,
      declaredMime,
      fileName,
      ...(declaredByteSize === undefined ? {} : { declaredByteSize }),
      sourceUrl,
    });
  }
  return refs;
}

function validateExternalEnvelope(
  value: unknown,
  discordMessageId: string,
): ExternalCaptureEnvelope {
  const row = externalRecord(value);
  const speakerPrincipalId = externalRequiredText(row?.speakerPrincipalId);
  const speakerKind = row?.speakerKind;
  const audienceAtCapture = row?.audienceAtCapture;
  const sentAtMs = externalFiniteNumber(row?.sentAtMs);
  const envelopeMessageId = externalRequiredText(row?.discordMessageId);
  const location = externalRecord(row?.location);
  const provenance = externalRecord(row?.provenance);
  const mentionIds = row?.mentionIds;
  const attachmentRefs = validateExternalAttachmentRefs(row?.attachmentRefs);
  const replyToMessageId = row?.replyToMessageId;

  if (!speakerPrincipalId ||
    (speakerKind !== "external_human" && speakerKind !== "external_bot") ||
    audienceAtCapture !== "unknown" ||
    sentAtMs == null ||
    !envelopeMessageId ||
    envelopeMessageId !== discordMessageId.trim() ||
    !Array.isArray(mentionIds) ||
    mentionIds.length > MAX_EXTERNAL_MENTIONS ||
    !mentionIds.every((id) => typeof id === "string" && Boolean(id.trim())) ||
    !attachmentRefs ||
    !provenance ||
    provenance.source !== "discord" ||
    externalFiniteNumber(provenance.receivedAtMs) == null) {
    throw new Error("external_envelope_invalid");
  }

  let normalizedLocation: ExternalEnvelopeLocation;
  if (location?.kind === "external_dm") {
    const principalId = externalRequiredText(location.principalId);
    const channelId = externalRequiredText(location.channelId);
    if (!principalId || !channelId || principalId !== speakerPrincipalId) {
      throw new Error("external_envelope_invalid");
    }
    normalizedLocation = { kind: "external_dm", principalId, channelId };
  } else if (location?.kind === "room") {
    const guildId = externalRequiredText(location.guildId);
    const channelId = externalRequiredText(location.channelId);
    if (!guildId || !channelId) throw new Error("external_envelope_invalid");
    normalizedLocation = { kind: "room", guildId, channelId };
  } else {
    throw new Error("external_envelope_invalid");
  }

  if (replyToMessageId !== undefined &&
    (typeof replyToMessageId !== "string" || !replyToMessageId.trim())) {
    throw new Error("external_envelope_invalid");
  }

  return {
    speakerPrincipalId,
    speakerKind,
    location: normalizedLocation,
    audienceAtCapture,
    sentAtMs,
    discordMessageId: envelopeMessageId,
    ...(typeof replyToMessageId === "string" ? { replyToMessageId: replyToMessageId.trim() } : {}),
    mentionIds: mentionIds.map((id) => id.trim()),
    attachmentRefs,
    provenance: { source: "discord", receivedAtMs: externalFiniteNumber(provenance.receivedAtMs)! },
  };
}

function sameAttachmentRefs(left: AttachmentIntakeRef[], right: AttachmentIntakeRef[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveExternalConversationKey(
  envelope: ExternalCaptureEnvelope,
  requestedKey: string | undefined,
): string {
  const key = requestedKey?.trim() ?? "";
  if (envelope.location.kind === "room") {
    const expected = `room:${envelope.location.guildId}:${envelope.location.channelId}`;
    if (key && key !== expected) throw new Error("external_conversation_invalid");
    return expected;
  }
  const match = /^dm:([^:]+):([^:]+)$/.exec(key);
  if (!match || match[2] !== envelope.speakerPrincipalId) {
    throw new Error("external_conversation_invalid");
  }
  return key;
}

function validateExternalCaptureBody(input: ExternalCaptureBody): {
  envelope: ExternalCaptureEnvelope;
  message: string;
  discordMessageId: string;
  attachments: AttachmentIntakeRef[];
  conversationKey: string;
  gateHint?: ExternalGateHint;
} {
  const discordMessageId = externalRequiredText(input?.discordMessageId);
  if (!discordMessageId || typeof input?.message !== "string") {
    throw new Error("external_capture_body_invalid");
  }
  if (input.message.length > MAX_EXTERNAL_MESSAGE_LENGTH) {
    throw new Error("external_message_too_long");
  }
  const envelope = validateExternalEnvelope(input.envelope, discordMessageId);
  const attachments = validateExternalAttachmentRefs(input.attachments);
  if (!attachments || !sameAttachmentRefs(attachments, envelope.attachmentRefs)) {
    throw new Error("external_envelope_invalid");
  }
  const gateHint = input.gateHint;
  if (gateHint !== undefined && gateHint !== "drop" && gateHint !== "capture_quarantine" && gateHint !== "allow_social") {
    throw new Error("external_capture_body_invalid");
  }
  return {
    envelope,
    message: input.message,
    discordMessageId,
    attachments,
    conversationKey: resolveExternalConversationKey(envelope, input.conversationKey),
    ...(gateHint === undefined ? {} : { gateHint }),
  };
}

function finiteAdmissionTime(value: number | undefined): number {
  const nowMs = value ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new Error("external_admission_time_invalid");
  return nowMs;
}

function insertExternalMarker(
  db: DatabaseSync,
  input: {
    id: string;
    conversationId: string;
    kind: string;
    payload: unknown;
    createdAtMs: number;
    status: "pending" | "failed_terminal";
    state: "pending" | "quarantined";
    terminalReason?: string;
    quarantineReason?: string;
    envelope?: ExternalCaptureEnvelope;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO inbox_events
       (id, conversation_id, kind, payload_json, created_at_ms, status, state,
        terminal_reason, quarantine_reason, wake_id, envelope_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  ).run(
    input.id,
    input.conversationId,
    input.kind,
    JSON.stringify(input.payload),
    input.createdAtMs,
    input.status,
    input.state,
    input.terminalReason ?? null,
    input.quarantineReason ?? null,
    input.envelope == null ? null : JSON.stringify(input.envelope),
  );
}

function externalPayload(row: ExternalInboxRow): ExternalCapturePayload | null {
  if (typeof row.payload_json !== "string") return null;
  try {
    const payload = externalRecord(JSON.parse(row.payload_json));
    if (!payload) return null;
    const captureRef = externalRequiredText(payload.captureRef);
    const evidenceRowId = externalRequiredText(payload.evidenceRowId);
    const conversationKey = externalRequiredText(payload.conversationKey);
    const discordMessageId = externalRequiredText(payload.discordMessageId);
    if (!captureRef || !evidenceRowId || !conversationKey || !discordMessageId) return null;
    const gateHint = payload.gateHint;
    if (gateHint !== undefined && gateHint !== "drop" && gateHint !== "capture_quarantine" && gateHint !== "allow_social") {
      return null;
    }
    return { captureRef, evidenceRowId, conversationKey, discordMessageId, ...(gateHint === undefined ? {} : { gateHint }) };
  } catch {
    return null;
  }
}

function readExternalCaptureMarker(
  db: DatabaseSync,
  captureRef: string,
): { row: ExternalInboxRow; payload: ExternalCapturePayload } | null {
  if (!captureRef.startsWith("extcap:") || captureRef.length <= "extcap:".length) return null;
  const row = db.prepare(
    `SELECT id, kind, conversation_id, payload_json
       FROM inbox_events
      WHERE id = ? AND kind = 'external_captured'`,
  ).get(`external:capture:${captureRef.slice("extcap:".length)}`) as ExternalInboxRow | undefined;
  if (!row) return null;
  const payload = externalPayload(row);
  return payload ? { row, payload } : null;
}

function outcomeMarkerId(kind: "external_eligible_pending" | "quarantined_external", evidenceRowId: string): string {
  return `${kind === "external_eligible_pending" ? "external:eligible" : "external:quarantine"}:${evidenceRowId}`;
}

function hasExternalOutcome(db: DatabaseSync, evidenceRowId: string): boolean {
  const row = db.prepare(
    `SELECT 1 AS present
       FROM inbox_events
      WHERE id IN (?, ?)
      LIMIT 1`,
  ).get(
    outcomeMarkerId("external_eligible_pending", evidenceRowId),
    outcomeMarkerId("quarantined_external", evidenceRowId),
  ) as { present?: unknown } | undefined;
  return row?.present === 1;
}

function externalLocationForEligibility(evidence: {
  speakerPrincipalId?: string | null;
  location?: unknown;
}): { location: "dm" | "room"; principalId: string; guildId?: string; channelId: string } | null {
  const principalId = externalRequiredText(evidence.speakerPrincipalId);
  const location = externalRecord(evidence.location);
  if (!principalId || !location) return null;
  if (location.kind === "external_dm") {
    const locationPrincipal = externalRequiredText(location.principalId);
    const channelId = externalRequiredText(location.channelId);
    if (!locationPrincipal || locationPrincipal !== principalId || !channelId) return null;
    return { location: "dm", principalId, channelId };
  }
  if (location.kind === "room") {
    const guildId = externalRequiredText(location.guildId);
    const channelId = externalRequiredText(location.channelId);
    if (!guildId || !channelId) return null;
    return { location: "room", principalId, guildId, channelId };
  }
  return null;
}

function notificationDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function queueSocialNotificationInTransaction(
  db: DatabaseSync,
  input: { ownerId: string; principalId: string; conversationId: string; nowMs: number },
): { noticeId: number; created: boolean } {
  const ownerId = externalRequiredText(input.ownerId) ?? "default";
  const principalId = externalRequiredText(input.principalId) ?? "unknown";
  const day = notificationDay(input.nowMs);
  const window = Math.floor(input.nowMs / MAX_SOCIAL_NOTIFICATION_WINDOW_MS);
  const windowKey = `social_notify:${ownerId}:${principalId}:${day}:window:${window}`;
  const existingWindow = db.prepare(
    "SELECT notice_id FROM system_notice_outbox WHERE notice_key = ?",
  ).get(windowKey) as { notice_id?: unknown } | undefined;
  if (existingWindow?.notice_id != null) {
    return { noticeId: Number(existingWindow.notice_id), created: false };
  }

  const dailyPrefix = `social_notify:${ownerId}:${principalId}:${day}:window:`;
  const daily = db.prepare(
    "SELECT COUNT(*) AS count FROM system_notice_outbox WHERE notice_key LIKE ?",
  ).get(`${dailyPrefix}%`) as { count?: unknown } | undefined;
  const dailyCount = Number(daily?.count ?? 0);
  const noticeKey = dailyCount >= MAX_SOCIAL_NOTIFICATIONS_PER_DAY
    ? `social_notify_digest:${ownerId}:${principalId}:${day}`
    : windowKey;
  const existing = db.prepare(
    "SELECT notice_id FROM system_notice_outbox WHERE notice_key = ?",
  ).get(noticeKey) as { notice_id?: unknown } | undefined;
  if (existing?.notice_id != null) {
    return { noticeId: Number(existing.notice_id), created: false };
  }

  const noticeText = dailyCount >= MAX_SOCIAL_NOTIFICATIONS_PER_DAY
    ? "Additional external Discord contact attempts were retained for review after the daily notification cap was reached."
    : `An external contact attempt from Discord principal ${principalId} was retained for review.`;
  const deliveryIntent = {
    ownerId,
    channel: "discord",
    threadId: `social_notify:${ownerId}`,
    conversationId: input.conversationId,
    trigger: "recovery" as const,
    deliveryLane: "social_notify" as const,
    purpose: "system_notice" as const,
  };
  const inserted = db.prepare(
    `INSERT INTO system_notice_outbox
       (notice_key, projection_key, cycle_id, conversation_id, notice_text,
        send_status, nuclear_reservation_id, discord_message_id, origin, delivery_intent_json)
     VALUES (?, ?, NULL, ?, ?, 'pending', NULL, NULL, 'live', ?)`,
  ).run(
    noticeKey,
    `system:pending:${randomUUID()}`,
    input.conversationId,
    noticeText,
    JSON.stringify(deliveryIntent),
  );
  const noticeId = Number(inserted.lastInsertRowid);
  db.prepare("UPDATE system_notice_outbox SET projection_key = ? WHERE notice_id = ?")
    .run(`system:${noticeId}`, noticeId);
  return { noticeId, created: true };
}

function projectSocialNotices(
  noticeIds: number[],
  project: ExternalAdmissionOptions["projectSystemNotice"],
): void {
  if (!project) return;
  for (const noticeId of noticeIds) {
    try {
      const result = project(noticeId);
      if (result && typeof (result as Promise<void>).then === "function") {
        void (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Pending notices remain durable and are reconsidered during startup.
    }
  }
}

export function admitExternalCapture(
  sidecar: DatabaseSync,
  _nuclearDb: DatabaseSync,
  input: ExternalCaptureBody,
  options: { nowMs?: number } = {},
): ExternalCaptureResult {
  const body = validateExternalCaptureBody(input);
  const nowMs = finiteAdmissionTime(options.nowMs);
  sidecar.exec("BEGIN IMMEDIATE");
  try {
    const appendResult = appendExternalUtteranceInTransaction(sidecar, {
      conversationId: body.conversationKey,
      text: body.message,
      discordMessageIds: [body.discordMessageId],
      nowMs,
      sourceStatus: "received",
      speakerPrincipalId: body.envelope.speakerPrincipalId,
      speakerKind: body.envelope.speakerKind,
      location: body.envelope.location,
      audienceAtCapture: body.envelope.location.kind === "room" ? "room" : "dm",
      sentAtMs: body.envelope.sentAtMs,
      replyToMessageId: body.envelope.replyToMessageId,
      mentionIds: body.envelope.mentionIds,
      attachmentRefs: body.envelope.attachmentRefs,
      provenance: body.envelope.provenance,
    });
    const evidence = appendResult.evidence;
    if (evidence.conversationId !== body.conversationKey) {
      throw new Error("external_evidence_conversation_conflict");
    }
    resolveSocialConversation(sidecar, body.envelope.location.kind === "room"
      ? {
        kind: "room",
        guildId: body.envelope.location.guildId,
        channelId: body.envelope.location.channelId,
        nowMs,
      }
      : {
        kind: "dm",
        ashleyBotId: body.conversationKey.split(":")[1],
        principalId: body.envelope.speakerPrincipalId,
        channelId: body.envelope.location.channelId,
        nowMs,
      });
    const captureRef = `extcap:${evidence.rowId}`;
    insertExternalMarker(sidecar, {
      id: `external:capture:${evidence.rowId}`,
      conversationId: body.conversationKey,
      kind: "external_captured",
      payload: {
        captureRef,
        evidenceRowId: evidence.rowId,
        conversationKey: body.conversationKey,
        discordMessageId: body.discordMessageId,
        ...(body.gateHint === undefined ? {} : { gateHint: body.gateHint }),
      } satisfies ExternalCapturePayload,
      createdAtMs: evidence.createdAtMs,
      status: "pending",
      state: "pending",
      envelope: body.envelope,
    });
    sidecar.exec("COMMIT");
    try { notifySidecarPostCommit(sidecar, { changedRowIds: [evidence.rowId] }); } catch {}
    return {
      captureRef,
      conversationKey: body.conversationKey,
      duplicate: appendResult.duplicate,
    };
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function markExternalOutcome(
  db: DatabaseSync,
  input: {
    evidenceRowId: string;
    conversationId: string;
    captureRef: string;
    kind: "external_eligible_pending" | "quarantined_external";
    createdAtMs: number;
    reason?: string;
    authority?: { epoch: number; revision: number };
  },
): void {
  const quarantine = input.kind === "quarantined_external";
  insertExternalMarker(db, {
    id: outcomeMarkerId(input.kind, input.evidenceRowId),
    conversationId: input.conversationId,
    kind: input.kind,
    payload: {
      captureRef: input.captureRef,
      evidenceRowId: input.evidenceRowId,
      conversationKey: input.conversationId,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.authority ? { authority: input.authority } : {}),
    },
    createdAtMs: input.createdAtMs,
    status: quarantine ? "failed_terminal" : "pending",
    state: quarantine ? "quarantined" : "pending",
    ...(quarantine ? { terminalReason: "permanent_failure", quarantineReason: input.reason ?? "external_quarantined" } : {}),
  });
}

export function admitExternalBatch(
  sidecar: DatabaseSync,
  nuclearDb: DatabaseSync,
  input: ExternalBatchInput,
  options: ExternalAdmissionOptions = {},
): ExternalBatchResult {
  const conversationKey = externalRequiredText(input?.conversationKey);
  if (!conversationKey ||
    !Array.isArray(input?.captureRefs) ||
    input.captureRefs.length === 0 ||
    input.captureRefs.length > 100 ||
    !input.captureRefs.every((ref) => typeof ref === "string" && Boolean(ref.trim()))) {
    throw new Error("external_batch_invalid");
  }
  const nowMs = finiteAdmissionTime(options.nowMs ?? input.finalFragmentReceivedAtMs);
  const results: ExternalBatchItemResult[] = [];
  const noticeIds: number[] = [];
  sidecar.exec("BEGIN IMMEDIATE");
  try {
    for (const rawRef of input.captureRefs) {
      const captureRef = rawRef.trim();
      const marker = readExternalCaptureMarker(sidecar, captureRef);
      if (!marker) {
        results.push({ captureRef, disposition: "capture_missing", reason: "capture_missing" });
        continue;
      }
      const { payload } = marker;
      if (payload.conversationKey !== conversationKey ||
        marker.row.conversation_id !== conversationKey ||
        payload.evidenceRowId !== captureRef.slice("extcap:".length) ||
        hasExternalOutcome(sidecar, payload.evidenceRowId)) {
        if (hasExternalOutcome(sidecar, payload.evidenceRowId)) {
          results.push({ captureRef, disposition: "already_batched" });
        } else {
          results.push({ captureRef, disposition: "capture_invalid", reason: "capture_conversation_mismatch" });
        }
        continue;
      }
      const evidence = getEvidenceByRowId(sidecar, payload.evidenceRowId);
      if (!evidence || evidence.role !== "external_dialog") {
        results.push({ captureRef, disposition: "capture_invalid", reason: "evidence_missing" });
        continue;
      }
      const location = externalLocationForEligibility(evidence);
      let decision: ReturnType<typeof classifyEligibility> | null = null;
      let reason = "ineligible_current_authority";
      if (evidence.text === null || evidence.text.length === 0) {
        reason = "empty_contact";
      } else if (!location) {
        reason = "external_envelope_invalid";
      } else {
        try {
          const bundle = readEligibilityBundle(nuclearDb, {
            principalId: location.principalId,
            guildId: location.guildId,
            channelId: location.channelId,
            nowMs,
          });
          decision = classifyEligibility(bundle, location.location, {
            roomSeedActive: options.roomSeedActive ?? isRoomSeedActive(),
          });
          if (decision.verdict === "allow_social") {
            markExternalOutcome(sidecar, {
              evidenceRowId: evidence.rowId,
              conversationId: conversationKey,
              captureRef,
              kind: "external_eligible_pending",
              createdAtMs: nowMs,
              authority: { epoch: bundle.barrier.epoch, revision: bundle.barrier.revision },
            });
            results.push({
              captureRef,
              disposition: "external_eligible_pending",
              notificationQueued: false,
            });
            continue;
          }
          reason = decision.verdict === "capture_quarantine"
            ? "ineligible_current_authority"
            : "ineligible_current_authority";
        } catch {
          reason = "db_error";
        }
      }

      const notice = queueSocialNotificationInTransaction(sidecar, {
        ownerId: options.ownerId ?? "default",
        principalId: evidence.speakerPrincipalId ?? "unknown",
        conversationId: conversationKey,
        nowMs,
      });
      markExternalOutcome(sidecar, {
        evidenceRowId: evidence.rowId,
        conversationId: conversationKey,
        captureRef,
        kind: "quarantined_external",
        createdAtMs: nowMs,
        reason,
      });
      if (notice.created) noticeIds.push(notice.noticeId);
      results.push({
        captureRef,
        disposition: "quarantined_external",
        notificationQueued: true,
      });
    }
    sidecar.exec("COMMIT");
    projectSocialNotices(noticeIds, options.projectSystemNotice);
    return { accepted: true, conversationKey, results };
  } catch (error) {
    try { sidecar.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function externalHandlerStatus(error: unknown): number {
  const status = externalRecord(error)?.httpStatus;
  if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) return status;
  const message = error instanceof Error ? error.message : String(error);
  if (message === "external_admission_closed" || message === "forbidden" || message === "bot_service_unauthorized") return 403;
  if (message.startsWith("external_") || message === "message_too_long") return 400;
  return 500;
}

function externalHandlerError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const row = externalRecord(error);
  return typeof row?.message === "string" ? row.message : "external_ingress_failed";
}

function externalEnabled(value: boolean | (() => boolean) | undefined): boolean {
  return typeof value === "function" ? value() : value === true;
}

export function createExternalCaptureHandler(options: {
  sidecar: DatabaseSync;
  nuclearDb: DatabaseSync;
  authorizeBotService: () => void;
  enabled?: boolean | (() => boolean);
  nowMs?: () => number;
  projectSystemNotice?: (noticeId: number) => Promise<void> | void;
}): express.RequestHandler {
  return (req, res) => {
    try {
      options.authorizeBotService();
      if (!externalEnabled(options.enabled)) throw new Error("external_admission_closed");
      const body = (req.body ?? {}) as ExternalCaptureBody;
      const result = admitExternalCapture(options.sidecar, options.nuclearDb, body, {
        nowMs: options.nowMs?.(),
      });
      res.status(202).json(result);
    } catch (error) {
      res.status(externalHandlerStatus(error)).json({ error: externalHandlerError(error) });
    }
  };
}

export function createExternalBatchHandler(options: {
  sidecar: DatabaseSync;
  nuclearDb: DatabaseSync;
  authorizeBotService: () => void;
  enabled?: boolean | (() => boolean);
  ownerId?: string;
  nowMs?: () => number;
  projectSystemNotice?: (noticeId: number) => Promise<void> | void;
}): express.RequestHandler {
  return (req, res) => {
    try {
      options.authorizeBotService();
      if (!externalEnabled(options.enabled)) throw new Error("external_admission_closed");
      const body = (req.body ?? {}) as ExternalBatchInput;
      const result = admitExternalBatch(options.sidecar, options.nuclearDb, body, {
        ownerId: options.ownerId,
        nowMs: options.nowMs?.(),
        projectSystemNotice: options.projectSystemNotice,
      });
      res.status(202).json(result);
    } catch (error) {
      res.status(externalHandlerStatus(error)).json({ error: externalHandlerError(error) });
    }
  };
}

export function createCognitiveIngressHandler(options: {
  sidecar: DatabaseSync;
  nuclearDb: DatabaseSync;
  authorizeOwner: (userId: string) => void;
  maxMessageLength?: number;
}): express.RequestHandler {
  return (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<CognitiveIngressBody>;
      if (typeof body.userId !== "string") throw new Error("owner_required");
      options.authorizeOwner(body.userId);
      if (typeof body.message !== "string") throw new Error("message_required");
      if (body.message.length > (options.maxMessageLength ?? 4000)) throw new Error("message_too_long");
      const result = admitCognitiveIngress(options.sidecar, options.nuclearDb, {
        userId: body.userId,
        message: body.message,
        channel: body.channel,
        threadId: body.threadId,
        discordMessageIds: body.discordMessageIds,
        inboundDiscordMessageIds: body.inboundDiscordMessageIds,
        finalFragmentReceivedAtMs: body.finalFragmentReceivedAtMs,
        attachments: body.attachments,
      });
      res.status(202).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "owner_required" ? 403 : message === "message_too_long" ? 400 : 400;
      res.status(status).json({ error: message });
    }
  };
}
