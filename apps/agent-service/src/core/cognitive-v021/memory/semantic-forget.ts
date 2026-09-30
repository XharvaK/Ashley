import type { DatabaseSync } from "node:sqlite";
import { buildForgetPlan, confirmV021Forget, cancelV021Forget } from "../commands.js";
import { applyV021Forget } from "./forget.js";
import { createForgetPreview, type CategoryCounts, type ForgetTarget } from "../../continuity/forget-preview.js";

/**
 * A2 semantic forgetting (decision 4). The Owner asks in plain words; Thought
 * proposes a forget naming the phrases and records it covers, says what it
 * covers and asks for a yes; the Host erases only after the Owner's yes in a
 * later message of the same Owner-private conversation. The Host expands
 * derived records (supports, episodes, thread stories, revisions) and runs
 * the exact-phrase sweep over raw logs as the floor. The erase bumps the
 * forget epoch, so a Thought already in flight that saw the records is
 * refused and re-runs (R2).
 */

export const FORGET_PHRASES_MAX = 8;
export const FORGET_RECORD_REFS_MAX = 50;
export const FORGET_PHRASE_MAX_CHARS = 200;
/** A proposal waits a day for the Owner's answer. */
export const FORGET_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export type ForgetClaim =
  | { action: "propose"; phrases: string[]; recordRefs?: string[] }
  | { action: "confirm"; proposalId: string }
  | { action: "cancel"; proposalId: string };

/** What Thought sees of a forget it proposed and the Owner has not answered. */
export type ThoughtPendingForget = {
  proposalId: string;
  proposedAtMs: number;
  expiresAtMs: number;
  covers: CategoryCounts;
};

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

/** Structural check at the Thought boundary; the Host decides the rest. */
export function isValidForgetClaim(value: unknown): value is ForgetClaim {
  if (!isRecord(value)) return false;
  if (value.action === "propose") {
    if (Object.keys(value).some((key) => !["action", "phrases", "recordRefs"].includes(key))) return false;
    if (!Array.isArray(value.phrases) || value.phrases.length < 1 || value.phrases.length > FORGET_PHRASES_MAX) return false;
    if (!value.phrases.every((phrase) => boundedText(phrase, 2, FORGET_PHRASE_MAX_CHARS))) return false;
    if (value.recordRefs === undefined) return true;
    return Array.isArray(value.recordRefs)
      && value.recordRefs.length >= 1
      && value.recordRefs.length <= FORGET_RECORD_REFS_MAX
      && value.recordRefs.every((ref) => boundedText(ref, 1, 400));
  }
  if (value.action === "confirm" || value.action === "cancel") {
    if (Object.keys(value).some((key) => !["action", "proposalId"].includes(key))) return false;
    return boundedText(value.proposalId, 1, 200);
  }
  return false;
}

/** Owner-private conversations only: rooms and contact DMs can never forget. */
export function isOwnerPrivateConversation(conversationId: string): boolean {
  return !conversationId.startsWith("room:") && !conversationId.startsWith("dm:");
}

function addTarget(targets: ForgetTarget[], counts: CategoryCounts, target: ForgetTarget): void {
  if (targets.some((item) => item.entityType === target.entityType && item.entityUuid === target.entityUuid)) return;
  targets.push(target);
  counts[target.entityType] = (counts[target.entityType] ?? 0) + 1;
}

function stringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Records named by id, and everything derived from them. Unknown refs are ignored. */
function recordRefTargets(sidecar: DatabaseSync, refs: readonly string[]): ForgetTarget[] {
  const targets: ForgetTarget[] = [];
  const counts: CategoryCounts = {};
  const add = (entityType: string, entityUuid: string) =>
    addTarget(targets, counts, { entityType, entityUuid, action: "redact" });
  const rowIds = new Set<string>();
  const cited = new Set<string>();
  for (const ref of refs) {
    const assertion = sidecar.prepare(
      "SELECT assertion_key FROM sidecar_memory_assertions WHERE assertion_key = ?",
    ).get(ref) as Row | undefined;
    if (assertion) {
      cited.add(ref);
      add("v021_memory_assertion", ref);
      for (const row of sidecar.prepare("SELECT support_id FROM sidecar_memory_supports WHERE assertion_key = ?").all(ref) as Row[]) {
        add("v021_memory_support", String(row.support_id));
      }
      for (const row of sidecar.prepare("SELECT nomination_id FROM durable_nominations WHERE assertion_key = ?").all(ref) as Row[]) {
        add("v021_nomination", String(row.nomination_id));
      }
      continue;
    }
    const evidence = sidecar.prepare(
      "SELECT row_id, conversation_id FROM conversation_evidence_log WHERE row_id = ?",
    ).get(ref) as Row | undefined;
    if (evidence && isOwnerPrivateConversation(String(evidence.conversation_id))) {
      cited.add(ref);
      rowIds.add(ref);
      add("v021_conversation_evidence", ref);
      continue;
    }
    const episode = sidecar.prepare(
      "SELECT episode_id FROM episodes_v2 WHERE episode_id = ? AND forgotten_at_ms IS NULL",
    ).get(ref) as Row | undefined;
    if (episode) {
      cited.add(ref);
      add("v021_episode", ref);
    }
  }
  if (rowIds.size > 0) {
    for (const row of sidecar.prepare(
      "SELECT episode_id, evidence_row_ids_json FROM episodes_v2 WHERE forgotten_at_ms IS NULL",
    ).all() as Row[]) {
      if (stringArray(row.evidence_row_ids_json).some((id) => rowIds.has(id))) add("v021_episode", String(row.episode_id));
    }
    const conversations = new Set<string>();
    for (const id of rowIds) {
      const row = sidecar.prepare("SELECT conversation_id FROM conversation_evidence_log WHERE row_id = ?").get(id) as Row | undefined;
      if (row) conversations.add(String(row.conversation_id));
    }
    for (const row of sidecar.prepare("SELECT conversation_id FROM thread_stories WHERE forgotten_at_ms IS NULL").all() as Row[]) {
      if (conversations.has(String(row.conversation_id))) add("v021_thread_story", String(row.conversation_id));
    }
  }
  for (const target of [...targets]) {
    if (target.entityType === "v021_episode") cited.add(target.entityUuid);
  }
  if (cited.size > 0) {
    // A revision resting on a forgotten record can never apply.
    for (const row of sidecar.prepare("SELECT revision_id, evidence_ref FROM growth_revision_evidence").all() as Row[]) {
      if (cited.has(String(row.evidence_ref))) add("v021_growth_revision", String(row.revision_id));
    }
  }
  return targets;
}

export type SemanticForgetPlan = { targets: ForgetTarget[]; categoryCounts: CategoryCounts };

/** Discover every target a proposed forget covers, without changing a row. */
export function planSemanticForget(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  input: { ownerId: string; phrases: readonly string[]; recordRefs?: readonly string[] },
): SemanticForgetPlan {
  const targets: ForgetTarget[] = [];
  const categoryCounts: CategoryCounts = {};
  for (const phrase of input.phrases) {
    const topic = phrase.trim();
    if (!topic) continue;
    for (const target of buildForgetPlan(sidecar, nuclear, input.ownerId, topic).targets) {
      addTarget(targets, categoryCounts, target);
    }
  }
  for (const target of recordRefTargets(sidecar, input.recordRefs ?? [])) {
    addTarget(targets, categoryCounts, target);
  }
  return { targets, categoryCounts };
}

export type SemanticForgetOutcome =
  | { kind: "proposed"; proposalId: string; categoryCounts: CategoryCounts }
  | { kind: "nothing_found" }
  | { kind: "confirmed"; proposalId: string; deleted: number }
  | { kind: "cancelled"; proposalId: string }
  | { kind: "refused"; reason: string };

export type SemanticForgetContext = {
  sidecar: DatabaseSync;
  nuclear: DatabaseSync;
  continuity: DatabaseSync | undefined;
  /** The Owner principal continuity previews and tombstones are kept for. */
  ownerId: string;
  identityOwnerId?: string;
  conversationId: string;
  settlementId: string;
  /** When the Owner message that triggered this turn was captured. */
  triggerCreatedAtMs: number | null;
  ownerTurn: boolean;
  nowMs: number;
};

/**
 * Apply a published settlement's forget claim. Idempotent per settlement:
 * a replayed proposal finds its row, a replayed confirm finds the proposal
 * already resolved.
 */
export function applySemanticForget(context: SemanticForgetContext, claim: ForgetClaim): SemanticForgetOutcome {
  const { sidecar } = context;
  if (!context.ownerTurn) return { kind: "refused", reason: "not_owner_turn" };
  if (!isOwnerPrivateConversation(context.conversationId)) return { kind: "refused", reason: "not_owner_private" };
  if (!context.ownerId.trim()) return { kind: "refused", reason: "owner_unconfigured" };
  if (!context.continuity) return { kind: "refused", reason: "continuity_unavailable" };

  if (claim.action === "propose") {
    const existing = sidecar.prepare(
      "SELECT proposal_id, category_counts_json FROM forget_proposals WHERE settlement_id = ?",
    ).get(context.settlementId) as Row | undefined;
    if (existing) {
      return { kind: "proposed", proposalId: String(existing.proposal_id), categoryCounts: JSON.parse(String(existing.category_counts_json)) as CategoryCounts };
    }
    const plan = planSemanticForget(sidecar, context.nuclear, {
      ownerId: context.ownerId,
      phrases: claim.phrases,
      ...(claim.recordRefs ? { recordRefs: claim.recordRefs } : {}),
    });
    if (plan.targets.length === 0) return { kind: "nothing_found" };
    const preview = createForgetPreview(context.continuity, {
      ownerId: context.ownerId,
      targets: plan.targets,
      categoryCounts: plan.categoryCounts,
      ttlMs: FORGET_PROPOSAL_TTL_MS,
    });
    sidecar.prepare(
      `INSERT INTO forget_proposals
         (proposal_id, settlement_id, conversation_id, category_counts_json, phrases_json, status, created_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(
      preview.previewId,
      context.settlementId,
      context.conversationId,
      JSON.stringify(plan.categoryCounts),
      JSON.stringify(claim.phrases.map((phrase) => phrase.trim()).filter(Boolean)),
      context.nowMs,
      context.nowMs + FORGET_PROPOSAL_TTL_MS,
    );
    return { kind: "proposed", proposalId: preview.previewId, categoryCounts: plan.categoryCounts };
  }

  const proposal = sidecar.prepare(
    "SELECT proposal_id, conversation_id, phrases_json, status, created_at_ms, expires_at_ms, resolved_settlement_id FROM forget_proposals WHERE proposal_id = ?",
  ).get(claim.proposalId) as Row | undefined;
  if (!proposal) return { kind: "refused", reason: "unknown_proposal" };
  if (String(proposal.status) !== "pending") {
    if (String(proposal.resolved_settlement_id) === context.settlementId) {
      return String(proposal.status) === "confirmed"
        ? { kind: "confirmed", proposalId: claim.proposalId, deleted: 0 }
        : { kind: "cancelled", proposalId: claim.proposalId };
    }
    return { kind: "refused", reason: "proposal_resolved" };
  }
  if (String(proposal.conversation_id) !== context.conversationId) return { kind: "refused", reason: "other_conversation" };

  if (claim.action === "cancel") {
    cancelV021Forget(context.continuity, { ownerId: context.ownerId, previewId: claim.proposalId });
    markResolved(sidecar, claim.proposalId, "cancelled", context);
    return { kind: "cancelled", proposalId: claim.proposalId };
  }

  if (Number(proposal.expires_at_ms) <= context.nowMs) return { kind: "refused", reason: "proposal_expired" };
  // The yes must come in a message the Owner sent after she asked.
  if (context.triggerCreatedAtMs === null || context.triggerCreatedAtMs <= Number(proposal.created_at_ms)) {
    return { kind: "refused", reason: "no_owner_answer_after_proposal" };
  }
  const result = confirmV021Forget(context.sidecar, context.nuclear, context.continuity, {
    ownerId: context.ownerId,
    previewId: claim.proposalId,
    nowMs: context.nowMs,
    ...(context.identityOwnerId ? { identityOwnerId: context.identityOwnerId } : {}),
  });
  // The exact-phrase floor: rows written after the plan (her own reply naming
  // what she will forget arrives on receipt) are swept too.
  let swept = 0;
  for (const phrase of stringArray(proposal.phrases_json)) {
    swept += applyV021Forget(sidecar, { topic: phrase, nowMs: context.nowMs }).changedRows;
  }
  markResolved(sidecar, claim.proposalId, "confirmed", context);
  return { kind: "confirmed", proposalId: claim.proposalId, deleted: result.deleted + swept };
}

function markResolved(
  sidecar: DatabaseSync,
  proposalId: string,
  status: "confirmed" | "cancelled",
  context: Pick<SemanticForgetContext, "settlementId" | "nowMs">,
): void {
  sidecar.prepare(
    "UPDATE forget_proposals SET status = ?, phrases_json = NULL, resolved_at_ms = ?, resolved_settlement_id = ? WHERE proposal_id = ? AND status = 'pending'",
  ).run(status, context.nowMs, context.settlementId, proposalId);
}

/** An unanswered proposal lapses; its phrases are not kept past the wait. */
export function expireForgetProposals(sidecar: DatabaseSync, nowMs: number): number {
  return Number(sidecar.prepare(
    "UPDATE forget_proposals SET phrases_json = NULL WHERE status = 'pending' AND expires_at_ms <= ? AND phrases_json IS NOT NULL",
  ).run(nowMs).changes);
}

/** Pending proposals in this conversation, newest first, for Thought. */
export function pendingForgetsForThought(
  sidecar: DatabaseSync,
  conversationId: string,
  nowMs: number,
): ThoughtPendingForget[] {
  return (sidecar.prepare(
    `SELECT proposal_id, category_counts_json, created_at_ms, expires_at_ms FROM forget_proposals
      WHERE conversation_id = ? AND status = 'pending' AND expires_at_ms > ?
      ORDER BY created_at_ms DESC LIMIT 3`,
  ).all(conversationId, nowMs) as Row[]).map((row) => ({
    proposalId: String(row.proposal_id),
    proposedAtMs: Number(row.created_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
    covers: JSON.parse(String(row.category_counts_json)) as CategoryCounts,
  }));
}
