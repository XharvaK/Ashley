import type { DatabaseSync } from "node:sqlite";
import { listRelationshipMotivationProjections } from "../relationship/projections.js";
import {
  getOpenCognitiveItem,
  openCognitiveItemEligibleForInfluence,
} from "../cognition/open-items.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import type { Motivation, Trigger } from "../types.js";
import { factInfluenceEligibleAt } from "../memory/facts.js";
import {
  episodeInfluenceEligibleAt,
  mindStateItemInfluenceEligibleAt,
  sourceCoveredByDenyBarrier,
} from "../memory/eligibility.js";
import {
  isLearnedInfluenceEligible,
} from "../learned-autonomy/eligibility.js";
import type { LearnedAutonomyMode } from "../learned-autonomy/types.js";

export const MAX_PROACTIVE_MOTIVATION_CANDIDATES = 8;
export const MAX_REACTIVE_MOTIVATION_CANDIDATES = 12;
export const MAX_MOTIVATIONS_PER_SOURCE = 3;

type IndexedMotivation = {
  item: Motivation;
  index: number;
};

function numericRefId(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function rowExists(
  db: DatabaseSync,
  sql: string,
  ...params: Array<string | number>
): boolean {
  return db.prepare(sql).get(...params) !== undefined;
}

function relationshipRefKey(refType: string, refId: string | number): string {
  return refType + ":" + String(refId);
}

function currentRelationshipRefs(
  db: DatabaseSync,
  ownerId: string,
): Set<string> {
  return new Set(
    listRelationshipMotivationProjections(db, ownerId, "proactive").map(
      (projection) =>
        relationshipRefKey(projection.refType, projection.refId),
    ),
  );
}

function sourceIsCurrentlyEligible(
  db: DatabaseSync,
  ownerId: string,
  item: Motivation,
  nowIso: string,
  relationshipRefs: Set<string>,
  learnedAutonomyMode: LearnedAutonomyMode = "observe",
): boolean {
  if (item.ownerId != null && item.ownerId !== ownerId) return false;
  if (item.refType == null || item.refId == null) {
    return item.kind === "silence_ok";
  }

  const refId = item.refId;
  const numericId = numericRefId(refId);
  switch (item.refType) {
    case "open_cognitive_item": {
      if (typeof refId !== "string") return false;
      const cognitiveItem = getOpenCognitiveItem(db, ownerId, refId);
      return (
        cognitiveItem !== null &&
        openCognitiveItemEligibleForInfluence(
          db,
          cognitiveItem,
          Date.parse(nowIso),
        )
      );
    }
    case "question":
      return (
        numericId !== null &&
        rowExists(
          db,
          `SELECT 1 FROM questions
           WHERE id = ? AND owner_id = ? AND status IN ('open', 'pursuing')`,
          numericId,
          ownerId,
        )
      );
    case "fact":
      return (
        numericId !== null &&
        factInfluenceEligibleAt(db, ownerId, numericId, nowIso)
      );
    case "opinion":
      return (
        numericId !== null &&
        rowExists(
          db,
          `SELECT 1 FROM opinions current
           WHERE current.id = ? AND current.owner_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM opinions newer
               WHERE newer.owner_id = current.owner_id
                 AND newer.topic = current.topic
                 AND newer.id > current.id
             )`,
          numericId,
          ownerId,
        )
      );
    case "mind_state":
      return (
        numericId !== null &&
        rowExists(
          db,
          `SELECT 1 FROM mind_state_items
           WHERE id = ? AND owner_id = ? AND status = 'active'`,
          numericId,
          ownerId,
        ) &&
        mindStateItemInfluenceEligibleAt(db, ownerId, numericId, nowIso)
      );
    case "identity":
      return (
        numericId !== null &&
        rowExists(
          db,
          `SELECT 1 FROM identity_entries
           WHERE id = ? AND owner_id = ? AND layer = 'stable'
             AND (kind = 'boundary' OR kind LIKE 'boundary.%')`,
          numericId,
          ownerId,
        )
      );
    case "message":
      return (
        numericId !== null &&
        rowExists(
          db,
          `SELECT 1 FROM mem_messages
           WHERE id = ? AND owner_id = ? AND redacted_at IS NULL`,
          numericId,
          ownerId,
        )
      );
    case "episode":
      return (
        numericId !== null &&
        rowExists(
          db,
          `SELECT 1 FROM episodes
           WHERE id = ? AND owner_id = ? AND status = 'active'
             AND provenance = 'live'`,
          numericId,
          ownerId,
        ) &&
        episodeInfluenceEligibleAt(db, ownerId, numericId, nowIso) &&
        !sourceCoveredByDenyBarrier(db, "episode", numericId, nowIso)
      );
    case "take":
      return (
        numericId !== null &&
        capabilityCanInfluence(db, "reading") &&
        capabilityCanInfluence(db, "curiosity_consolidation") &&
        rowExists(
          db,
          `SELECT 1
             FROM cur_takes t
             JOIN cur_reads r ON r.id = t.read_id AND r.item_id = t.item_id
            WHERE t.id = ? AND t.provenance = 'live'
              AND t.evidence_kind = 'read_record'
              AND r.provenance = 'live'`,
          numericId,
        )
      );
    case "learned_influence":
      return (
        numericId !== null &&
        learnedAutonomyMode === "dark_apply" &&
        isLearnedInfluenceEligible(
          db,
          numericId,
          learnedAutonomyMode,
          new Date(nowIso),
        )
      );
    case "doc_reminder":
      return (
        capabilityCanInfluence(db, "relational_initiative") &&
        rowExists(
          db,
          `SELECT 1 FROM doc_reminders
           WHERE entity_uuid = ? AND owner_id = ?
             AND status IN ('pending', 'due')
             AND due_at IS NOT NULL AND due_at <= ?`,
          String(refId),
          ownerId,
          nowIso,
        )
      );
    case "ashley_self_commitment":
    case "mutual_commitment":
    case "relational_tension":
      return relationshipRefs.has(relationshipRefKey(item.refType, refId));
    case "state":
      return String(refId) === ownerId;
    case "withdrawal":
    case "scheduled_proactive":
      return false;
    default:
      return false;
  }
}

/** Final source revalidation for a selected candidate before delivery claim. */
export function motivationCurrentlyEligible(
  db: DatabaseSync,
  ownerId: string,
  item: Motivation,
  now = new Date(),
  learnedAutonomyMode: LearnedAutonomyMode = "observe",
): boolean {
  const needsRelationshipRefs =
    item.refType === "ashley_self_commitment" ||
    item.refType === "mutual_commitment" ||
    item.refType === "relational_tension";
  const relationshipRefs = needsRelationshipRefs
    ? currentRelationshipRefs(db, ownerId)
    : new Set<string>();
  return sourceIsCurrentlyEligible(
    db,
    ownerId,
    item,
    now.toISOString(),
    relationshipRefs,
    learnedAutonomyMode,
  );
}

function summaryKey(summary: string): string {
  return summary.trim().replace(/\s+/g, " ").toLowerCase();
}

function sourceRank(item: Motivation): number {
  return item.refType === "open_cognitive_item" ? 1 : 0;
}

function isAnchor(item: Motivation, trigger: Trigger): boolean {
  if (trigger !== "reactive") return false;
  return (
    item.kind === "user_message" ||
    item.kind === "silence_signal" ||
    item.kind === "boundary"
  );
}

function betterDuplicate(
  candidate: IndexedMotivation,
  current: IndexedMotivation,
): IndexedMotivation {
  const candidateRank = sourceRank(candidate.item);
  const currentRank = sourceRank(current.item);
  if (candidateRank !== currentRank) {
    return candidateRank < currentRank ? candidate : current;
  }
  if (candidate.item.score !== current.item.score) {
    return candidate.item.score > current.item.score ? candidate : current;
  }
  return candidate.index < current.index ? candidate : current;
}

function ordered(
  items: IndexedMotivation[],
  trigger: Trigger,
): IndexedMotivation[] {
  return [...items].sort((a, b) => {
    const anchorDelta =
      Number(isAnchor(b.item, trigger)) - Number(isAnchor(a.item, trigger));
    if (anchorDelta !== 0) return anchorDelta;
    const scoreDelta = b.item.score - a.item.score;
    return scoreDelta !== 0 ? scoreDelta : a.index - b.index;
  });
}

/**
 * Deterministic semantic narrowing before Decision and Thought.
 *
 * This is not the Attention Governor. It only bounds the source-backed
 * material that one wake may ask Thought to consider.
 */
export function selectMotivationCandidates(
  db: DatabaseSync,
  ownerId: string,
  trigger: Trigger,
  motivations: Motivation[],
  now = new Date(),
  options: { learnedAutonomyMode?: LearnedAutonomyMode } = {},
): Motivation[] {
  const nowIso = now.toISOString();
  const needsRelationshipRefs = motivations.some(
    (item) =>
      item.refType === "ashley_self_commitment" ||
      item.refType === "mutual_commitment" ||
      item.refType === "relational_tension",
  );
  const relationshipRefs = needsRelationshipRefs
    ? currentRelationshipRefs(db, ownerId)
    : new Set<string>();
  const eligible = motivations
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      sourceIsCurrentlyEligible(
        db,
        ownerId,
        item,
        nowIso,
        relationshipRefs,
        options.learnedAutonomyMode ?? "observe",
      ),
    )
    .filter(
      ({ item }) =>
        trigger !== "proactive" || item.kind !== "boundary",
    );

  const deduped: IndexedMotivation[] = [];
  for (const candidate of ordered(eligible, trigger)) {
    const refKey =
      candidate.item.refType != null && candidate.item.refId != null
        ? relationshipRefKey(candidate.item.refType, candidate.item.refId)
        : null;
    const semanticKey = summaryKey(candidate.item.summary);
    const duplicateIndex = deduped.findIndex((existing) => {
      const existingRefKey =
        existing.item.refType != null && existing.item.refId != null
          ? relationshipRefKey(existing.item.refType, existing.item.refId)
          : null;
      const existingSummaryKey = summaryKey(existing.item.summary);
      return (
        (refKey != null && existingRefKey === refKey) ||
        (semanticKey !== "" && existingSummaryKey === semanticKey)
      );
    });
    if (duplicateIndex >= 0) {
      deduped[duplicateIndex] = betterDuplicate(
        candidate,
        deduped[duplicateIndex]!,
      );
      continue;
    }
    deduped.push(candidate);
  }

  const maxCandidates =
    trigger === "proactive"
      ? MAX_PROACTIVE_MOTIVATION_CANDIDATES
      : MAX_REACTIVE_MOTIVATION_CANDIDATES;
  const selected: IndexedMotivation[] = [];
  const sourceCounts = new Map<string, number>();
  for (const candidate of ordered(deduped, trigger)) {
    if (candidate.item.kind === "silence_ok") continue;
    const source = candidate.item.refType ?? candidate.item.kind;
    if (!isAnchor(candidate.item, trigger)) {
      const count = sourceCounts.get(source) ?? 0;
      if (count >= MAX_MOTIVATIONS_PER_SOURCE) continue;
      if (selected.length >= maxCandidates) continue;
      sourceCounts.set(source, count + 1);
    }
    selected.push(candidate);
  }

  const silence = eligible.find(({ item }) => item.kind === "silence_ok");
  if (silence && selected.length < maxCandidates) selected.push(silence);
  return selected.map(({ item }) => item);
}
