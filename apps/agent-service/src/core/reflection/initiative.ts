import type { DatabaseSync } from "node:sqlite";
import { entityName } from "../entity-names.js";
import { completeChat } from "../../mistral-client.js";
import { reflectionInitiativeOutputStructuredRequest } from "../cognitive-v021/thought/reflection-output-contract.js";
import type { EvidenceRef } from "../types.js";
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
  REFLECTION_AUTHORITY_CLASSES,
} from "./authority.js";

const MAX_OPEN_COGNITIVE_REVIEW_REQUESTS = 8;

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
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
          `You are ${entityName()} Reflection, an advisory cognitive reviewer.`,
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
      responseFormat: "json_schema",
      structuredOutput: reflectionInitiativeOutputStructuredRequest(),
      // Caller ceilings may narrow policy but never widen it. The adjudication
      // needs room for the xhigh reasoning control before the action object is
      // emitted, so the caller requests the policy ceiling and lets the
      // Model Fabric row own the actual value.
      maxTokens: 16384,
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

