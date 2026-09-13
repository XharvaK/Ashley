import { randomUUID } from "node:crypto";
import type express from "express";
import type { DatabaseSync } from "node:sqlite";
import { resolveActiveThread } from "../../memory/threads.js";
import { appendOwnerUtteranceInTransaction } from "../evidence/conversation-log.js";
import { notifySidecarPostCommit } from "../retrieval/derived-store.js";
import { appendCycleLogIds, appendInboxEventInTransaction, getCycle, getInboxEvent } from "../cycle/inbox.js";
import { composeOrPreemptInTransaction } from "../cycle/fence.js";
import { cancelActiveThought } from "../cycle/active.js";
import {
  advanceDeferredFrontierEvidence,
  getActiveDeferredFrontier,
} from "../frontier/ledger.js";
import type { CycleRecord, InboxEvent } from "../types.js";

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
  discordPresence?: { status: "online" | "idle"; label: string };
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
            discordPresence: input.discordPresence ?? null,
            subsumedByFrontierId: activeFrontier.frontierId,
          },
          createdAtMs: admittedAtMs,
          initialTerminalReason: "subsumed_by_frontier",
        },
        randomUUID(),
      );
      sidecar.exec("COMMIT");
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
          discordPresence: input.discordPresence ?? null,
        },
        createdAtMs: admittedAtMs,
      },
      randomUUID(),
    );
    sidecar.exec("COMMIT");
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
        discordPresence: body.discordPresence,
      });
      res.status(202).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "owner_required" ? 403 : message === "message_too_long" ? 400 : 400;
      res.status(status).json({ error: message });
    }
  };
}
