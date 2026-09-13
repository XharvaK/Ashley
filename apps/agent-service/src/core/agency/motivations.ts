import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { listOpenQuestions } from "../state/questions.js";
import { listRecentTakes } from "../curiosity/feed.js";
import { listActiveFacts } from "../memory/facts.js";
import { getState } from "../state/store.js";
import { listIdentity, listOpinions } from "../identity/store.js";
import { listActiveMindStateItems } from "../state/mind-items.js";
import { mindStateItemInfluenceEligibleAt } from "../memory/eligibility.js";
import { annotationForFact } from "../memory/context-role.js";
import type {
  MindStateItem,
  MindStateItemKind,
  Motivation,
  MotivationKind,
  Opinion,
  Trigger,
} from "../types.js";
import type { DataClassification } from "../privacy/classification.js";
import { capabilityCanInfluence } from "../rollout/capabilities.js";
import { listActiveLearnedInfluences } from "../learned-autonomy/eligibility.js";
import { recordChoiceReceipt } from "../learned-autonomy/receipts.js";
import type { LearnedAutonomyMode } from "../learned-autonomy/types.js";
import { isBoundaryRelevant } from "./boundary-relevance.js";
import { relationshipCanInfluence } from "../relationship/influence.js";
import { listDueDocReminders } from "../relationship/store.js";
import { tryClaimRelationshipMotivation } from "../relationship/claims.js";
import { listRelationshipMotivationProjections } from "../relationship/projections.js";
import {
  openCognitiveItemEligibleForInfluence,
  type OpenCognitiveItemRecord,
} from "../cognition/open-items.js";
import { selectOpenCognitiveItemsForWake } from "../cognition/wake-selection.js";

export type MindStateMotivationInput = {
  kind: MindStateItemKind;
  text: string;
  activation: number;
  urgency: number;
  id: number;
};

export type MotivationCollectionOptions = {
  /** Qualification-only ablation; the production default keeps OCI enabled. */
  includeOpenCognitiveItems?: boolean;
  /**
   * When false, build in-memory motivations without inserting rows.
   * Durable Thought retries must not re-persist the owner request.
   */
  persist?: boolean;
  /** Qualification-only C3 mode; observe is the default. */
  learnedAutonomyMode?: LearnedAutonomyMode;
};

export function mindStateItemToMotivation(
  item: MindStateMotivationInput,
): { kind: MotivationKind; score: number; summary: string; refType: "mind_state"; refId: number } {
  const kind: MotivationKind =
    item.kind === "unfinished" || item.kind === "commitment"
      ? "unfinished"
      : item.kind === "interest"
        ? "identity"
        : "callback";
  const score = Math.max(20, Math.min(100, item.activation * 55 + item.urgency * 45));
  return {
    kind,
    score,
    summary: item.text.trim().slice(0, 1000),
    refType: "mind_state",
    refId: item.id,
  };
}

function ageHours(iso: string): number {

  const parsed = Date.parse(iso);
  return Number.isFinite(parsed)
    ? Math.max(0, (Date.now() - parsed) / 3_600_000)
    : Number.POSITIVE_INFINITY;
}

let ephemeralMotivationId = 0;

function persistMotivation(
  db: DatabaseSync,
  ownerId: string,
  kind: MotivationKind,
  score: number,
  summary: string,
  refType: string | null = null,
  refId: string | number | null = null,
  write = true,
  dataClassification: DataClassification | null = null,
): Motivation {
  const createdAt = new Date().toISOString();
  const clipped = summary.trim().slice(0, 1000);
  const boundedScore = Math.max(0, score);
  if (!write) {
    ephemeralMotivationId -= 1;
    return {
      id: ephemeralMotivationId,
      ownerId,
      kind,
      score: boundedScore,
      refType,
      refId,
      summary: clipped,
      createdAt,
    };
  }
  const result = db
    .prepare(
      `INSERT INTO motivations
         (owner_id, kind, score, ref_type, ref_id, summary, created_at,
          consumed_at, data_classification)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      ownerId,
      kind,
      boundedScore,
      refType,
      refId == null ? null : String(refId),
      clipped,
      createdAt,
      dataClassification,
    );
  return {
    id: Number(result.lastInsertRowid),
    ownerId,
    kind,
    score: boundedScore,
    refType,
    refId,
    summary: clipped,
    createdAt,
  };
}

function learnedMotivationHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function addLearnedInterestMotivations(
  db: DatabaseSync,
  ownerId: string,
  mode: LearnedAutonomyMode | undefined,
  write: boolean,
): Motivation[] {
  if (mode !== "dark_apply") return [];
  const learned = listActiveLearnedInfluences(db, ownerId, { mode });
  return learned.map((influence) => {
    const motivation = persistMotivation(
      db,
      ownerId,
      "learned_interest",
      62,
      influence.text,
      "learned_influence",
      String(influence.id),
      write,
      influence.dataClassification,
    );
    if (write) {
      recordChoiceReceipt(db, {
        learnedInfluenceId: influence.id,
        choiceKind: "motivation_admission",
        candidateIds: [`learned:${influence.id}`],
        selectedIds: [`learned:${influence.id}`],
        rankDelta: { [String(influence.id)]: 1 },
        policyBinding: "c3-agency-dark-v1",
        reasonCode: "qualified_learned_interest",
        inputContentHash: learnedMotivationHash(`learned:${influence.id}`),
        outputContentHash: learnedMotivationHash(motivation.summary),
        eligibleInputAffectedRanking: true,
        agencyMadeFinalChoice: false,
        dataClassification: influence.dataClassification,
      });
    }
    return motivation;
  });
}

function userMessageScore(message: string): number {
  return /^(?:hi|hey|hello|ok|okay|k|lol|haha|nice|cool|thanks|ty|yeah|yep|nope|hm|hmm)[!.? ]*$/i.test(
    message.trim(),
  )
    ? 32
    : 100;
}

/**
 * Detects unambiguous conversational requests for space or silence from the owner.
 *
 * Conservative by design: false-positive silence suppresses cognition entirely,
 * while false-negative silence safely proceeds to Thought where the model can
 * still choose to remain silent.
 *
 * Distinguishes conversational directives ("stop messaging me", "leave me alone",
 * standalone "stop") from procedural/task control language ("stop after X",
 * "stop when verification fails", "stop on error").
 */
export function isSilenceRequest(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;

  // 1. Explicit qualified conversational silence phrases (unambiguous intent)
  const qualifiedSilence =
    /\b(?:stop\s+(?:messaging|pinging|talking|replying)(?:\s+me|\s+to\s+me)?|don't\s+(?:message|ping|talk\s+to|reply\s+to)\s+me|do\s+not\s+(?:message|ping|talk\s+to|reply\s+to)\s+me|leave\s+me\s+alone|give\s+me\s+(?:some\s+)?space|i\s+need\s+(?:some\s+)?space)\b/i;
  if (qualifiedSilence.test(trimmed)) {
    return true;
  }

  // 2. Standalone or near-standalone conversational space directives
  const normalized = trimmed
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/[!.?]+$/g, "")
    .trim()
    .toLowerCase();

  const standaloneDirectives = new Set([
    "stop",
    "please stop",
    "pls stop",
    "not now",
    "not right now",
    "later",
    "talk later",
    "catch you later",
    "can we talk later",
    "let's talk later",
    "lets talk later",
    "busy",
    "i'm busy",
    "im busy",
    "busy right now",
    "i am busy",
    "i'm busy right now",
    "im busy right now",
    "i'm busy, talk later",
    "im busy, talk later",
    "busy, talk later",
    "i'm busy talk later",
    "im busy talk later",
    "busy talk later",
    "leave me alone",
    "please leave me alone",
    "give me space",
    "please give me space",
  ]);

  if (standaloneDirectives.has(normalized)) {
    return true;
  }

  // Also match short compound patterns like "i'm busy [...] not now/later" under ~40 chars
  if (
    normalized.length <= 40 &&
    /^(?:i(?:'m|\s+am)\s+busy|busy)\s*[,;-]?\s*(?:talk\s+later|later|not\s+now|not\s+right\s+now)$/i.test(
      normalized,
    )
  ) {
    return true;
  }

  return false;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9à-ÿ]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );
}

/** Bounded relevance: shared tokens or explicit mind-state text match. */
export function isTextRelevant(message: string, candidate: string): boolean {
  const msg = message.trim();
  if (!msg) return false;
  const messageTokens = tokenize(msg);
  if (messageTokens.size === 0) return false;
  const candidateTokens = tokenize(candidate);
  let hits = 0;
  for (const token of candidateTokens) {
    if (messageTokens.has(token)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

function addOpinions(
  db: DatabaseSync,
  ownerId: string,
  opinions: Opinion[],
  message: string,
  requireRelevance: boolean,
  write: boolean,
): Motivation[] {
  return opinions
    .filter((opinion) => ageHours(opinion.updatedAt) <= 168)
    .filter((opinion) =>
      !requireRelevance ||
      isTextRelevant(message, `${opinion.topic} ${opinion.stance}`),
    )
    .slice(0, 4)
    .map((opinion) =>
      persistMotivation(
        db,
        ownerId,
        "opinion",
        Math.max(20, 60 - ageHours(opinion.updatedAt) * 2),
        `Current opinion on ${opinion.topic}: ${opinion.stance}`,
        "opinion",
        opinion.id,
        write,
      ),
    );
}

function openCognitiveItemMotivation(
  item: OpenCognitiveItemRecord,
): { kind: MotivationKind; score: number } {
  // These are mechanical candidate compatibility values, not care,
  // attachment, relationship, or emotional importance scores.
  switch (item.kind) {
    case "question":
      return { kind: "question", score: 58 };
    case "revisit":
      return { kind: "unfinished", score: 52 };
    case "concern":
      return { kind: "unfinished", score: 44 };
  }
}

function addOpenCognitiveItems(
  db: DatabaseSync,
  ownerId: string,
  trigger: Trigger,
  message: string,
  write: boolean,
): Motivation[] {
  const reactiveRelevant = trigger === "reactive";
  const now = new Date();
  return selectOpenCognitiveItemsForWake(db, ownerId, now)
    .items
    .filter((item) => openCognitiveItemEligibleForInfluence(db, item, now.getTime()))
    .filter(
      (item) =>
        !reactiveRelevant ||
        !message ||
        isTextRelevant(message, item.semanticSummary),
    )
    .slice(0, 8)
    .map((item) => {
      const projection = openCognitiveItemMotivation(item);
      return persistMotivation(
        db,
        ownerId,
        projection.kind,
        projection.score,
        item.semanticSummary,
        "open_cognitive_item",
        item.entityUuid,
        write,
      );
    });
}

export function collectMotivations(
  db: DatabaseSync,
  ownerId: string,
  trigger: Trigger,
  userMessage?: string,
  userMessageId?: number,
  options: MotivationCollectionOptions = {},
): Motivation[] {
  const motivations: Motivation[] = [];
  const write = options.persist !== false;
  const state = getState(db, ownerId);
  const message = userMessage?.trim() ?? "";
  const reactiveRelevant = trigger === "reactive";

  for (const question of listOpenQuestions(db, ownerId, 8)) {
    if (
      reactiveRelevant &&
      message &&
      !isTextRelevant(message, question.text)
    ) {
      continue;
    }
    motivations.push(
      persistMotivation(
        db,
        ownerId,
        "question",
        Math.max(20, Math.min(100, question.priority * 2 + 30)),
        question.text,
        "question",
        question.id,
        write,
      ),
    );
  }

  for (const fact of listActiveFacts(db, ownerId, reactiveRelevant ? 24 : 10)) {
    if (
      reactiveRelevant &&
      message &&
      !isTextRelevant(message, `${fact.key} ${fact.value}`)
    ) {
      continue;
    }
    const motivation = persistMotivation(
        db,
        ownerId,
        "fact",
        Math.max(15, Math.min(80, fact.importance * 0.7)),
        `${fact.key}: ${fact.value}`,
        "fact",
        fact.id,
        write,
      );
    const annotation = annotationForFact(db, ownerId, fact.id);
    if (annotation) {
      motivation.memoryContextRole = annotation.memory_context_role;
      motivation.memoryAssertionIds = annotation.memory_assertion_ids;
      motivation.memoryCorrectionIds = annotation.memory_correction_ids;
    }
    motivations.push(motivation);
  }

  motivations.push(
    ...addOpinions(
      db,
      ownerId,
      listOpinions(db, ownerId),
      message,
      reactiveRelevant && Boolean(message),
      write,
    ),
  );

  for (const take of capabilityCanInfluence(db, "reading") &&
    capabilityCanInfluence(db, "curiosity_consolidation")
    ? listRecentTakes(db, 12)
        .filter(
          (candidate) =>
            candidate.evidenceKind === "read_record" &&
            candidate.provenance === "live" &&
            candidate.readProvenance === "live",
        )
        .slice(0, 6)
    : []) {
    if (
      reactiveRelevant &&
      message &&
      !isTextRelevant(message, `${take.title} ${take.take}`)
    ) {
      continue;
    }
    const score = Math.max(20, 55 - ageHours(take.createdAt) * 3);
    const motivation = persistMotivation(
        db,
        ownerId,
        "take",
        score,
        `${take.title}: ${take.take}`,
        "take",
        take.id,
        write,
      );
    motivations.push({
      ...motivation,
      sourceAuthorityClass: take.authorityClass,
    });
  }

  motivations.push(
    ...addLearnedInterestMotivations(
      db,
      ownerId,
      options.learnedAutonomyMode,
      write,
    ),
  );

  for (const unfinished of state.unfinished.slice(0, 4)) {
    if (
      reactiveRelevant &&
      message &&
      !isTextRelevant(message, unfinished)
    ) {
      continue;
    }
    motivations.push(
      persistMotivation(
        db,
        ownerId,
        "unfinished",
        48,
        unfinished,
        "state",
        ownerId,
        write,
      ),
    );
  }

  for (const item of capabilityCanInfluence(db, "mind_state")
    ? listActiveMindStateItems(db, ownerId, 12)
        .filter((candidate) => mindStateItemInfluenceEligibleAt(db, ownerId, candidate.id))
    : []) {
    // Active Mind State may always candidate; relevance still preferred on reactive.
    if (
      reactiveRelevant &&
      message &&
      item.urgency < 0.75 &&
      !isTextRelevant(message, item.text)
    ) {
      continue;
    }
    const m = mindStateItemToMotivation({
      kind: item.kind,
      text: item.text,
      activation: item.activation,
      urgency: item.urgency,
      id: item.id,
    });
    motivations.push(
      persistMotivation(db, ownerId, m.kind, m.score, m.summary, m.refType, m.refId, write),
    );
  }

  if (options.includeOpenCognitiveItems !== false) {
    motivations.push(...addOpenCognitiveItems(db, ownerId, trigger, message, write));
  }

  for (const projection of listRelationshipMotivationProjections(
    db,
    ownerId,
    trigger,
    message,
  )) {
    motivations.push(
      persistMotivation(
        db,
        ownerId,
        projection.kind,
        projection.score,
        projection.summary,
        projection.refType,
        projection.refId,
        write,
      ),
    );
  }

  if (state.availability !== "available") {
    motivations.push(
      persistMotivation(
        db,
        ownerId,
        "availability",
        70,
        `Availability is ${state.availability}.`,
        "state",
        ownerId,
        write,
      ),
    );
  }

  if (trigger === "reactive" && message) {
    motivations.push(
      persistMotivation(
        db,
        ownerId,
        isSilenceRequest(message) ? "silence_signal" : "user_message",
        isSilenceRequest(message) ? 100 : userMessageScore(message),
        message,
        "message",
        userMessageId ?? null,
        write,
      ),
    );
    // Boundaries enter the pool only when relevance-licensed.
    for (const boundary of listIdentity(db, ownerId)
      .filter((entry) =>
        entry.layer === "stable" &&
        (entry.kind === "boundary" || entry.kind.startsWith("boundary.")))
      .slice(0, 6)) {
      if (!isBoundaryRelevant(message, boundary.text)) continue;
      motivations.push(
        persistMotivation(
          db,
          ownerId,
          "boundary",
          55,
          boundary.text,
          "identity",
          boundary.id,
          write,
        ),
      );
    }
  }

  if (trigger === "proactive") {
    // Proactive may still see stable boundaries to suppress initiative, not refuse.
    for (const boundary of listIdentity(db, ownerId)
      .filter((entry) =>
        entry.layer === "stable" &&
        (entry.kind === "boundary" || entry.kind.startsWith("boundary.")))
      .slice(0, 6)) {
      motivations.push(
        persistMotivation(
          db,
          ownerId,
          "boundary",
          40,
          boundary.text,
          "identity",
          boundary.id,
          write,
        ),
      );
    }
  }

  if (
    trigger === "proactive" &&
    relationshipCanInfluence(db, env.cognitionMode, "relational_initiative")
  ) {
    const nowIso = new Date().toISOString();
    for (const reminder of listDueDocReminders(db, ownerId, nowIso)) {
      const motivation = persistMotivation(
        db,
        ownerId,
        "reminder",
        72,
        reminder.text,
        "doc_reminder",
        reminder.entityUuid,
        write,
      );
      if (
        tryClaimRelationshipMotivation(db, {
          ownerId,
          relationshipEntityType: "doc_reminder",
          relationshipEntityUuid: reminder.entityUuid,
          motivationId: motivation.id!,
        })
      ) {
        motivations.push(motivation);
      }
    }
  }

  motivations.push(
    persistMotivation(
      db,
      ownerId,
      "silence_ok",
      trigger === "proactive" ? 8 : 2,
      "Silence is always available when nothing earns the interruption.",
      null,
      null,
      write,
    ),
  );

  return motivations.sort((a, b) => b.score - a.score);
}
