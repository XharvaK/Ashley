import type { DatabaseSync } from "node:sqlite";
import { completeChat } from "../../mistral-client.js";
import type {
  Decision,
  EvidenceRef,
  Motivation,
  MotivationKind,
  ReflectionMode,
} from "../types.js";
import { requireStableAuthorityBarrier } from "../cognitive-v021/authority/barrier.js";
import {
  claimOpenCognitiveItemReviewRequests,
  recordOpenCognitiveReviewDisposition,
  transitionOpenCognitiveItem,
  type OpenCognitiveItemTransitionAction,
} from "../cognition/reconsideration.js";
import {
  openCognitiveItemSourceEligibleForInfluence,
  type OpenCognitiveItemRecord,
} from "../cognition/open-items.js";
import {
  getReflectionEvent,
  insertReflectionEvent,
  listEvidenceWindow,
  listInitiativeLearning,
  listPendingSubjects,
  listReflectionEvents,
  markPendingSubjectApplied,
  saveInitiativeLearning,
  type ClassifiedSignal,
  type ReflectionEvent,
} from "./store.js";
import {
  REFLECTION_AUTHORITY_CLASSES,
  REFLECTION_WRITE_PATH_CLASSIFICATION,
} from "./authority.js";

const CLASSIFIER_VERSION = 1;
const EVIDENCE_WINDOW = 20;
const MAX_OPEN_COGNITIVE_REVIEW_REQUESTS = 8;
const PROACTIVE_KINDS = new Set<MotivationKind>([
  "question",
  "fact",
  "callback",
  "opinion",
  "take",
  "unfinished",
  "identity",
  "availability",
  "reminder",
  "scheduled_proactive",
]);

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function normalizeEmoji(emoji: string): string {
  return emoji.replace(/\uFE0F/g, "");
}

function classifySignal(emoji: string): ClassifiedSignal {
  const normalized = normalizeEmoji(emoji);
  if (normalized === "\u{1F44D}") return "positive";
  if (normalized === "\u{1F44E}") return "negative";
  return "neutral";
}

function parseMotivationIds(value: unknown): number[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => typeof id === "number")
      : [];
  } catch {
    return [];
  }
}

function asMotivationKind(value: unknown): MotivationKind | null {
  if (typeof value !== "string") return null;
  return PROACTIVE_KINDS.has(value as MotivationKind)
    ? (value as MotivationKind)
    : null;
}

export function calculateInitiativeAdjustment(
  positiveCount: number,
  negativeCount: number,
): number {
  const net = positiveCount - negativeCount;
  if (Math.abs(net) < 2) return 0;
  return Math.max(-8, Math.min(8, Math.sign(net) * 2 * (Math.abs(net) - 1)));
}

export function processPendingReflectionEvents(
  db: DatabaseSync,
  ownerId?: string,
): void {
  for (const subject of listPendingSubjects(db, ownerId)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      requireStableAuthorityBarrier(db);
      const events = listEvidenceWindow(
        db,
        subject.ownerId,
        subject.motivationKind,
        EVIDENCE_WINDOW,
      );
      const positiveCount = events.filter(
        (event) => event.classifiedSignal === "positive",
      ).length;
      const negativeCount = events.filter(
        (event) => event.classifiedSignal === "negative",
      ).length;
      const processedAt = new Date().toISOString();
      saveInitiativeLearning(db, {
        ownerId: subject.ownerId,
        motivationKind: subject.motivationKind,
        positiveCount,
        negativeCount,
        adjustment: calculateInitiativeAdjustment(
          positiveCount,
          negativeCount,
        ),
        windowSize: events.length,
        lastEventId: events[0]?.id ?? null,
        updatedAt: processedAt,
      });
      markPendingSubjectApplied(
        db,
        subject.ownerId,
        subject.motivationKind,
        processedAt,
      );
      requireStableAuthorityBarrier(db);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

export type OpenCognitiveReviewProposal = {
  action: OpenCognitiveItemTransitionAction;
  reason: string;
  evidenceRefs?: EvidenceRef[];
  replacementEntityUuid?: string;
  now?: Date;
  /** Advisory provenance; never semantic authorship. */
  authorityClass?: "NON_AUTHORITATIVE_ADVISORY_OUTPUT";
};

export type OpenCognitiveReviewProposalFactory = (
  item: OpenCognitiveItemRecord,
) => OpenCognitiveReviewProposal | null;

export type OpenCognitiveReviewAdjudicator = (
  db: DatabaseSync,
  item: OpenCognitiveItemRecord,
) => Promise<OpenCognitiveReviewProposal | null>;

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return isRow(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseReflectionReviewResponse(
  text: string,
): OpenCognitiveReviewProposal | null {
  const parsed = parseJsonObject(text);
  if (!parsed) return null;
  const action = String(parsed.action ?? "").trim().toLowerCase();
  const actionMap: Record<string, OpenCognitiveItemTransitionAction> = {
    keep: "keep_open",
    keep_open: "keep_open",
    withdraw: "withdraw",
    supersede: "supersede",
    resolve: "resolve",
  };
  const normalizedAction = actionMap[action];
  if (!normalizedAction) return null;
  const evidenceRefs = Array.isArray(parsed.evidenceRefs)
    ? parsed.evidenceRefs.flatMap((value) => {
        if (!isRow(value) || typeof value.type !== "string") return [];
        if (typeof value.id !== "string" && typeof value.id !== "number") return [];
        return [{ type: value.type, id: value.id } as EvidenceRef];
      })
    : undefined;
  return {
    action: normalizedAction,
    reason: `reflection_model_${normalizedAction}`,
    authorityClass: REFLECTION_AUTHORITY_CLASSES.advisoryOutput,
    ...(evidenceRefs ? { evidenceRefs } : {}),
    ...(typeof parsed.replacementEntityUuid === "string"
      ? { replacementEntityUuid: parsed.replacementEntityUuid.trim() }
      : {}),
  };
}

async function modelReflectionAdjudicator(
  db: DatabaseSync,
  item: OpenCognitiveItemRecord,
): Promise<OpenCognitiveReviewProposal | null> {
  const response = await completeChat(
    [
      {
        role: "system",
        content: [
          "You are Ashley Reflection, an advisory cognitive reviewer.",
          "Use only the bounded grounded state supplied below.",
          "Return strict JSON with action KEEP, WITHDRAW, SUPERSEDE, or RESOLVE.",
          "RESOLVE requires grounded evidenceRefs.",
          "SUPERSEDE requires replacementEntityUuid.",
          "Do not speak, send messages, alter relationship truth, identity, Recall, or capability state.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          kind: item.kind,
          status: item.status,
          semanticSummary: item.semanticSummary,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          sourceRevision: item.sourceRevision,
          attention: {
            considerationCount: item.attention?.considerationCount ?? 0,
            reviewRequestedAt: item.attention?.reviewRequestedAt ?? null,
            lastOutcomeCode: item.attention?.lastOutcomeCode ?? null,
          },
        }),
      },
    ],
    {
      route: "thought",
      purpose: "thought_observation",
      logicalRole: "reflection_initiative",
      lane: "exchange_cognition",
      maxTokens: 300,
      temperature: 0,
      ownerId: item.ownerId,
      attentionDb: db,
    },
  );
  return parseReflectionReviewResponse(response.text);
}

/**
 * Consume a bounded set of OCI review requests under Reflection ownership.
 * Every lifecycle mutation is delegated to the OCI transition owner after a
 * fresh source, capability, provenance, relationship, and owner check.
 */
export function processPendingOpenCognitiveReviews(
  db: DatabaseSync,
  ownerId?: string,
  proposal:
    | OpenCognitiveReviewProposal
    | OpenCognitiveReviewProposalFactory = {
    action: "keep_open",
    reason: "reflection_keep_open",
  },
): { processed: number; skipped: number } {
  const owners = ownerId
    ? [ownerId]
    : (
        db
          .prepare(
            `SELECT DISTINCT o.owner_id
             FROM open_cognitive_items o
             JOIN open_cognitive_item_attention a ON a.item_id = o.id
             WHERE o.status = 'OPEN' AND a.review_requested_at IS NOT NULL
             ORDER BY o.owner_id ASC`,
          )
          .all() as Array<{ owner_id?: string }>
      )
        .map((row) => row.owner_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0);
  let processed = 0;
  let skipped = 0;
  for (const owner of owners) {
    if (processed + skipped >= MAX_OPEN_COGNITIVE_REVIEW_REQUESTS) break;
    const remaining = MAX_OPEN_COGNITIVE_REVIEW_REQUESTS - processed - skipped;
    const requests = claimOpenCognitiveItemReviewRequests(db, owner, remaining);
    for (const item of requests) {
      if (processed + skipped >= MAX_OPEN_COGNITIVE_REVIEW_REQUESTS) break;
      if (!openCognitiveItemSourceEligibleForInfluence(db, item)) {
        recordOpenCognitiveReviewDisposition(db, item.id, "source_unavailable");
        skipped += 1;
        continue;
      }
      let requested: OpenCognitiveReviewProposal | null;
      try {
        requested = typeof proposal === "function" ? proposal(item) : proposal;
      } catch {
        requested = null;
      }
      if (!requested) {
        recordOpenCognitiveReviewDisposition(db, item.id, "adjudicator_unprocessable");
        skipped += 1;
        continue;
      }
      try {
        const { authorityClass: _authorityClass, ...transition } = requested;
        void _authorityClass;
        transitionOpenCognitiveItem(db, {
          ...transition,
          ownerId: item.ownerId,
          entityUuid: item.entityUuid,
        });
        processed += 1;
      } catch {
        recordOpenCognitiveReviewDisposition(db, item.id, "invalid_transition");
        skipped += 1;
      }
    }
  }
  return { processed, skipped };
}

/** Production review consumer. Successful model output is advisory; OCI transitions remain final authority. */
export async function processPendingOpenCognitiveReviewsAsync(
  db: DatabaseSync,
  ownerId?: string,
  adjudicator: OpenCognitiveReviewAdjudicator = modelReflectionAdjudicator,
): Promise<{ processed: number; skipped: number }> {
  const owners = ownerId
    ? [ownerId]
    : (
        db
          .prepare(
            `SELECT DISTINCT o.owner_id
             FROM open_cognitive_items o
             JOIN open_cognitive_item_attention a ON a.item_id = o.id
             WHERE o.status = 'OPEN' AND a.review_requested_at IS NOT NULL
             ORDER BY o.owner_id ASC`,
          )
          .all() as Array<{ owner_id?: string }>
      )
        .map((row) => row.owner_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0);
  let processed = 0;
  let skipped = 0;
  for (const owner of owners) {
    if (processed + skipped >= MAX_OPEN_COGNITIVE_REVIEW_REQUESTS) break;
    const remaining = MAX_OPEN_COGNITIVE_REVIEW_REQUESTS - processed - skipped;
    const requests = claimOpenCognitiveItemReviewRequests(db, owner, remaining);
    for (const item of requests) {
      if (processed + skipped >= MAX_OPEN_COGNITIVE_REVIEW_REQUESTS) break;
      if (!openCognitiveItemSourceEligibleForInfluence(db, item)) {
        recordOpenCognitiveReviewDisposition(db, item.id, "source_unavailable");
        skipped += 1;
        continue;
      }
      let requested: OpenCognitiveReviewProposal | null;
      try {
        requested = await adjudicator(db, item);
      } catch {
        recordOpenCognitiveReviewDisposition(db, item.id, "adjudicator_failure");
        skipped += 1;
        continue;
      }
      if (!requested) {
        recordOpenCognitiveReviewDisposition(db, item.id, "adjudicator_unprocessable");
        skipped += 1;
        continue;
      }
      try {
        const { authorityClass: _authorityClass, ...transition } = requested;
        void _authorityClass;
        transitionOpenCognitiveItem(db, {
          ...transition,
          ownerId: item.ownerId,
          entityUuid: item.entityUuid,
        });
        processed += 1;
      } catch {
        recordOpenCognitiveReviewDisposition(db, item.id, "invalid_transition");
        skipped += 1;
      }
    }
  }
  return { processed, skipped };
}

export function recordInitiativeReaction(
  db: DatabaseSync,
  ownerId: string,
  input: { messageId: string; emoji: string },
): { matchedInitiative: boolean; event: ReflectionEvent | null } {
  let reservation = db
    .prepare(
      `SELECT r.id AS reservation_id, r.decision_id,
              d.trigger, d.motivation_ids_json
       FROM initiative_reservations r
       JOIN decision_log d ON d.id = r.decision_id
       WHERE r.owner_id = ? AND r.discord_message_id = ?
         AND r.committed_at IS NOT NULL
       LIMIT 1`,
    )
    .get(ownerId, input.messageId);

  if (!isRow(reservation)) {
    reservation = db
      .prepare(
        `SELECT ir.id AS reservation_id, ir.decision_id,
                d.trigger, d.motivation_ids_json
         FROM delivery_bubbles b
         JOIN delivery_reservations dr ON dr.id = b.reservation_id
         JOIN initiative_reservations ir
           ON ir.id = dr.initiative_reservation_id
         JOIN decision_log d ON d.id = ir.decision_id
         WHERE dr.owner_id = ?
           AND b.discord_message_id = ?
           AND ir.committed_at IS NOT NULL
         LIMIT 1`,
      )
      .get(ownerId, input.messageId);
  }

  if (!isRow(reservation)) {
    return { matchedInitiative: false, event: null };
  }

  const classifiedSignal = classifySignal(input.emoji);
  const motivationIds = parseMotivationIds(reservation.motivation_ids_json);
  const motivationId = motivationIds.length === 1 ? motivationIds[0]! : null;
  const motivation =
    motivationId === null
      ? null
      : db
          .prepare(
            `SELECT kind
             FROM motivations
             WHERE id = ? AND owner_id = ?`,
          )
          .get(motivationId, ownerId);
  const subjectKind = isRow(motivation)
    ? asMotivationKind(motivation.kind)
    : null;

  let reason = "eligible";
  if (classifiedSignal === "neutral") reason = "unsupported_signal";
  else if (reservation.trigger !== "proactive") reason = "non_proactive_decision";
  else if (motivationIds.length !== 1) reason = "ambiguous_decision_motivations";
  else if (!subjectKind) reason = "missing_or_ineligible_motivation";

  const eligible = reason === "eligible";
  requireStableAuthorityBarrier(db);
  const createdAt = new Date().toISOString();
  const event = insertReflectionEvent(db, {
    ownerId,
    kind: "initiative_reaction",
    sourceKey: `discord_reaction:${ownerId}:${input.messageId}:${normalizeEmoji(input.emoji)}`,
    decisionId:
      typeof reservation.decision_id === "number"
        ? reservation.decision_id
        : Number(reservation.decision_id),
    reservationId:
      typeof reservation.reservation_id === "number"
        ? reservation.reservation_id
        : Number(reservation.reservation_id),
    discordMessageId: input.messageId,
    subjectKind,
    rawSignal: input.emoji,
    classifiedSignal,
    classifierVersion: CLASSIFIER_VERSION,
    status: eligible ? "pending" : "ignored",
    reason,
    detailJson: JSON.stringify({ motivationId }),
    createdAt,
    processedAt: eligible ? null : createdAt,
  });
  if (event.status === "pending") {
    processPendingReflectionEvents(db, ownerId);
  }
  return {
    matchedInitiative: true,
    event: getReflectionEvent(db, event.id),
  };
}

export function applyInitiativeLearning(
  db: DatabaseSync,
  ownerId: string,
  motivations: Motivation[],
  mode: ReflectionMode,
): Motivation[] {
  const learning = new Map(
    listInitiativeLearning(db, ownerId).map((row) => [
      row.motivationKind,
      row,
    ]),
  );
  return motivations.map((motivation) => {
    const learned = learning.get(motivation.kind);
    if (!learned || learned.lastEventId === null) return motivation;
    const adjustment = mode === "apply" ? learned.adjustment : 0;
    return {
      ...motivation,
      baseScore: motivation.score,
      score: Math.max(0, motivation.score + adjustment),
      learningAdjustment: adjustment,
      learningThroughEventId: learned.lastEventId,
      learningAuthorityClass:
        REFLECTION_WRITE_PATH_CLASSIFICATION.applyInitiativeLearning,
    };
  });
}

export function attachLearningSnapshot(
  decision: Decision,
  motivations: Motivation[],
): Decision {
  if (decision.trigger !== "proactive" || decision.motivationIds.length !== 1) {
    return decision;
  }
  const selected = motivations.find(
    (motivation) => motivation.id === decision.motivationIds[0],
  );
  if (
    !selected ||
    selected.learningAdjustment === undefined ||
    selected.learningThroughEventId === undefined
  ) {
    return decision;
  }
  return {
    ...decision,
    learning: {
      subjectKind: selected.kind,
      adjustment: selected.learningAdjustment,
      throughEventId: selected.learningThroughEventId,
      authorityClass: "MECHANICAL_CALIBRATION",
    },
  };
}

export function getReflectionOverview(
  db: DatabaseSync,
  ownerId: string,
  mode: ReflectionMode,
  limit = 20,
): {
  mode: ReflectionMode;
  events: ReflectionEvent[];
  learning: ReturnType<typeof listInitiativeLearning>;
} {
  return {
    mode,
    events: listReflectionEvents(db, ownerId, limit),
    learning: listInitiativeLearning(db, ownerId),
  };
}
