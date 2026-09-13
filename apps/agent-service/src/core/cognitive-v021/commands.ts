import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  applyForgetTargets,
  type ForgetCounts,
  type ForgetHonesty,
  type ForgetResult,
} from "../memory/forget.js";
import {
  listMessageIdsMatchingTopic,
  resolveActiveThread,
} from "../memory/threads.js";
import {
  bindForgetPreviewDiscordMessage,
  cancelForgetPreview,
  confirmPreviewToTombstone,
  createForgetPreview,
  markTombstoneApplied,
  type CategoryCounts,
  type ForgetTarget,
} from "../continuity/forget-preview.js";
import {
  appendInboxEvent,
  getCycle,
  getInboxEvent,
} from "./cycle/inbox.js";
import { composeOrPreempt } from "./cycle/fence.js";
import {
  appendOwnerUtteranceWithStatus,
  listConversationEvidence,
} from "./evidence/conversation-log.js";
import { createRememberDirective } from "./memory/nomination.js";
import {
  applyV021ForgetTargets,
  planV021Forget,
  type V021ForgetPlan,
} from "./memory/forget.js";
import {
  buildOwnerKnowledgeView,
  renderOwnerKnowledgeView,
} from "./memory/views.js";
import type {
  ConversationEvidenceRecord,
  DataClassification,
  RememberDirective,
} from "./types.js";

type DbRow = Record<string, unknown>;

export type V021RememberCommandInput = {
  ownerId: string;
  text: string;
  sensitivity?: "none" | "private";
  discordMessageId?: string | null;
  nowMs?: number;
};

export type V021RememberCommandResult = {
  ok: true;
  queued: true;
  duplicate: boolean;
  fact: null;
  evidenceRowId: string;
  evidenceLineageId: string;
  inboxEventId: string;
  conversationId: string;
  cycleId: string;
  generation: number;
  action: "compose" | "preempt";
  dataClassification: DataClassification;
};

export type V021MemoryFact = {
  category: string;
  key: string;
  value: string;
};

export type V021MemorySummary = {
  facts: V021MemoryFact[];
  narrative: string | null;
  lastUpdated: string;
  threadId: string;
};

const EMPTY_COUNTS: ForgetCounts = {
  messagesRedacted: 0,
  episodesForgotten: 0,
  factsReconciled: 0,
  revisionsReconciled: 0,
  stateReconciled: 0,
  evidenceRemoved: 0,
  runsRedacted: 0,
};

const HONESTY: ForgetHonesty = {
  local: "Matching local v0.2.1 sidecar and compatibility records were redacted or reconciled.",
  discord: "Original Discord messages remain under Discord retention and control.",
  mistral: "Provider retention cannot be retroactively erased.",
  oldBackups: "Older backup packages may still contain forgotten material.",
};

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function record(value: unknown): DbRow {
  return isRow(value) ? value : {};
}

function eventCycle(event: ReturnType<typeof getInboxEvent>): {
  cycleId: string;
  generation: number;
  action: "compose" | "preempt";
} | null {
  if (!event) return null;
  const payload = record(event.payload);
  const cycleId = text(payload.cycleId);
  if (!cycleId) return null;
  const generation = number(payload.generation);
  const action = payload.action === "preempt" ? "preempt" : "compose";
  return { cycleId, generation, action };
}

function rememberEventPayload(
  directive: RememberDirective,
  input: V021RememberCommandInput,
  conversationId: string,
  cycleId: string,
  generation: number,
  action: "compose" | "preempt",
): Record<string, unknown> {
  // This payload is deliberately reference-only. Owner prose remains in the
  // evidence log and is read by Thought through the evidence row id.
  return {
    ...directive,
    ownerId: input.ownerId,
    channel: "discord",
    threadId: conversationId,
    triggerRef: directive.evidenceRowId,
    cycleId,
    generation,
    action,
  };
}

/** Queue `/remember` as owner evidence plus a reference-only kernel event. */
export function admitV021RememberCommand(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  input: V021RememberCommandInput,
): V021RememberCommandResult {
  const ownerId = input.ownerId.trim();
  const sourceText = input.text.trim();
  if (!ownerId) throw new Error("owner_id_required");
  if (!sourceText) throw new Error("message_required");

  const conversationId = resolveActiveThread(nuclear, ownerId, "discord");
  const evidenceResult = appendOwnerUtteranceWithStatus(sidecar, {
    conversationId,
    text: sourceText,
    discordMessageIds: input.discordMessageId ? [input.discordMessageId] : [],
    legacySensitivity: input.sensitivity ?? "none",
    nowMs: input.nowMs,
  });
  const evidence = evidenceResult.evidence;
  const directive = createRememberDirective(evidence);
  const inboxId = `remember:${evidence.rowId}`;
  let inbox = getInboxEvent(sidecar, inboxId);
  const existingCycle = eventCycle(inbox);

  if (!existingCycle || !getCycle(sidecar, existingCycle.cycleId)) {
    inbox = appendInboxEvent(sidecar, {
      id: inboxId,
      conversationId,
      kind: "owner_message",
      payload: directive,
      createdAtMs: input.nowMs,
    });
    const fenced = composeOrPreempt(sidecar, {
      conversationId,
      evidenceRowIds: [evidence.rowId],
      triggerKind: "owner_message",
      triggerRef: evidence.rowId,
      occupantId: ownerId,
      nowMs: input.nowMs,
    });
    const payload = rememberEventPayload(
      directive,
      input,
      conversationId,
      fenced.cycleId,
      fenced.generation,
      fenced.action,
    );
    sidecar
      .prepare("UPDATE inbox_events SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(payload), inbox.id);
    inbox = getInboxEvent(sidecar, inbox.id);
    if (!inbox) throw new Error("remember_inbox_missing");
    return {
      ok: true,
      queued: true,
      duplicate: evidenceResult.duplicate,
      fact: null,
      evidenceRowId: evidence.rowId,
      evidenceLineageId: evidence.lineageId,
      inboxEventId: inbox.id,
      conversationId,
      cycleId: fenced.cycleId,
      generation: fenced.generation,
      action: fenced.action,
      dataClassification: evidence.dataClassification,
    };
  }

  return {
    ok: true,
    queued: true,
    duplicate: true,
    fact: null,
    evidenceRowId: evidence.rowId,
    evidenceLineageId: evidence.lineageId,
    inboxEventId: inbox?.id ?? inboxId,
    conversationId,
    cycleId: existingCycle.cycleId,
    generation: existingCycle.generation,
    action: existingCycle.action,
    dataClassification: evidence.dataClassification,
  };
}

function narrativeLabel(role: ConversationEvidenceRecord["role"]): string {
  if (role === "owner") return "Owner";
  if (role === "ashley") return "Ashley";
  return "System";
}

/** Build the owner-only `/memory` response without a model summarizer. */
export function getV021MemorySummary(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  ownerId: string,
  includePrivate = false,
): V021MemorySummary {
  const threadId = resolveActiveThread(nuclear, ownerId, "discord");
  const view = buildOwnerKnowledgeView(sidecar);
  const facts = renderOwnerKnowledgeView(view)
    .map((value, index) => ({ assertion: view[index], value }))
    .filter(({ assertion }) => includePrivate || assertion.dataClassification !== "sensitive")
    .map(({ assertion, value }) => ({
      category: assertion.memoryKind,
      key: assertion.assertionKey,
      value,
    }));
  const evidence = listConversationEvidence(sidecar, threadId, {
    limit: 1000,
    includeOlderVersions: false,
  }).filter((row) => row.text !== null && (row.role !== "ashley" || row.delivered));
  const recent = evidence.slice(-8);
  const narrative = recent.length === 0
    ? null
    : recent.map((row) => `${narrativeLabel(row.role)}: ${row.text ?? ""}`).join("\n");
  const lastUpdatedMs = evidence.at(-1)?.createdAtMs ?? 0;
  return {
    facts,
    narrative,
    lastUpdated: new Date(lastUpdatedMs).toISOString(),
    threadId,
  };
}

function compatibilityForgetTargets(
  nuclear: DatabaseSync,
  ownerId: string,
  topic: string,
): ForgetTarget[] {
  const targets: ForgetTarget[] = [];
  const ids = listMessageIdsMatchingTopic(nuclear, ownerId, topic);
  for (const id of ids) {
    const row = nuclear
      .prepare("SELECT entity_uuid FROM mem_messages WHERE id = ? AND owner_id = ?")
      .get(id, ownerId);
    const entityUuid = isRow(row) ? text(row.entity_uuid) : "";
    if (!entityUuid) throw new Error("compatibility_message_uuid_missing");
    targets.push({ entityType: "mem_messages", entityUuid, action: "redact" });
  }
  return targets;
}

function mergeCategoryCounts(
  sidecar: V021ForgetPlan,
  compatibility: ForgetTarget[],
): CategoryCounts {
  const counts: CategoryCounts = { ...sidecar.categoryCounts };
  for (const target of compatibility) {
    counts[target.entityType] = (counts[target.entityType] ?? 0) + 1;
  }
  return counts;
}

function forgetFingerprint(ownerId: string, topic: string): string {
  return createHash("sha256")
    .update(`cognitive-v021-forget\u0000${ownerId}\u0000${topic.toLocaleLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

function buildForgetPlan(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  ownerId: string,
  topic: string,
): {
  sidecar: V021ForgetPlan;
  compatibility: ForgetTarget[];
  targets: ForgetTarget[];
  preview: string[];
  categoryCounts: CategoryCounts;
} {
  const sidecarPlan = planV021Forget(sidecar, { topic });
  const compatibility = compatibilityForgetTargets(nuclear, ownerId, topic);
  return {
    sidecar: sidecarPlan,
    compatibility,
    targets: [
      ...sidecarPlan.targets.map((target) => ({
        entityType: target.entityType,
        entityUuid: target.entityUuid,
        action: target.action === "detach" ? "detach" : "redact",
      } satisfies ForgetTarget)),
      ...compatibility,
    ],
    preview: [
      ...sidecarPlan.preview,
      ...compatibility.map((target) => `${target.entityType} (${target.action})`),
    ],
    categoryCounts: mergeCategoryCounts(sidecarPlan, compatibility),
  };
}

export function previewV021Forget(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  continuity: DatabaseSync,
  input: { ownerId: string; topic: string; nowMs?: number },
): ForgetResult {
  const ownerId = input.ownerId.trim();
  const topic = input.topic.trim();
  if (!ownerId) throw new Error("owner_id_required");
  if (!topic) throw new Error("forget_topic_required");
  const built = buildForgetPlan(sidecar, nuclear, ownerId, topic);
  if (built.targets.length === 0) {
    return {
      preview: [],
      deleted: 0,
      receiptId: null,
      counts: { ...EMPTY_COUNTS },
      categoryCounts: {},
      honesty: HONESTY,
    };
  }
  const created = createForgetPreview(continuity, {
    ownerId,
    targets: built.targets,
    categoryCounts: built.categoryCounts,
    topicDiagnosticFingerprint: forgetFingerprint(ownerId, topic),
  });
  return {
    preview: built.preview,
    deleted: 0,
    receiptId: null,
    counts: { ...EMPTY_COUNTS },
    previewId: created.previewId,
    expiresAt: created.expiresAt,
    categoryCounts: created.categoryCounts,
    honesty: HONESTY,
  };
}

export function confirmV021Forget(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  continuity: DatabaseSync,
  input: { ownerId: string; previewId: string; nowMs?: number },
): ForgetResult {
  const ownerId = input.ownerId.trim();
  const previewId = input.previewId.trim();
  if (!ownerId) throw new Error("owner_id_required");
  if (!previewId) throw new Error("forget_preview_id_required");
  const confirmed = confirmPreviewToTombstone(continuity, {
    previewId,
    ownerId,
  });
  const sidecarTargets = confirmed.targets
    .filter((target) => target.entityType.startsWith("v021_"))
    .map((target) => ({
      entityType: target.entityType,
      entityUuid: target.entityUuid,
      action: target.action,
    }));
  const compatibilityTargets = confirmed.targets.filter(
    (target) => target.entityType === "mem_messages",
  );
  const sidecarResult = applyV021ForgetTargets(sidecar, sidecarTargets, {
    nowMs: input.nowMs,
    delivery: { nuclearDb: nuclear, ownerId },
  });
  const nuclearResult = compatibilityTargets.length > 0
    ? applyForgetTargets(nuclear, ownerId, compatibilityTargets, {
        tombstoneId: confirmed.tombstoneId,
      })
    : null;
  markTombstoneApplied(
    continuity,
    confirmed.tombstoneId,
    nuclearResult?.receiptId ?? null,
  );
  return {
    preview: [],
    deleted: sidecarResult.changedRows + (nuclearResult?.deleted ?? 0),
    receiptId: nuclearResult?.receiptId ?? null,
    counts: nuclearResult?.counts ?? { ...EMPTY_COUNTS },
    previewId,
    categoryCounts: confirmed.categoryCounts,
    honesty: HONESTY,
    tombstoneId: confirmed.tombstoneId,
  };
}

export function cancelV021Forget(
  continuity: DatabaseSync,
  input: { ownerId: string; previewId: string },
): ForgetResult {
  const ownerId = input.ownerId.trim();
  const previewId = input.previewId.trim();
  if (!ownerId) throw new Error("owner_id_required");
  if (!previewId) throw new Error("forget_preview_id_required");
  cancelForgetPreview(continuity, previewId, ownerId);
  return {
    preview: [],
    deleted: 0,
    receiptId: null,
    counts: { ...EMPTY_COUNTS },
    previewId,
    honesty: HONESTY,
  };
}

export function bindV021ForgetPreview(
  continuity: DatabaseSync,
  input: { ownerId: string; previewId: string; confirmationDiscordMessageId: string },
): void {
  bindForgetPreviewDiscordMessage(continuity, input);
}
