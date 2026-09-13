import type {
  Decision,
  DecisionKind,
  EvidenceRef,
  Motivation,
  MotivationKind,
  NonAuthoritativeContentClass,
  Trigger,
} from "../types.js";
import type { OwnTimeReportConstraint } from "./own-time-constraint.js";
import { relevantBoundaryIdSet } from "./boundary-relevance.js";
import { evaluateWithdrawalSilence } from "../relationship/repair.js";
import { env } from "../../env.js";
import { isSilenceRequest } from "./motivations.js";

/**
 * Thought implementation (Agency location).
 * Owns transient cognitive decisions; Expression consumes Decision, does not re-infer them.
 */
function motivationIds(motivations: Motivation[]): number[] {
  return motivations
    .map((motivation) => motivation.id)
    .filter((id): id is number => id !== undefined);
}

function isFluff(summary: string): boolean {
  return /^(?:hi|hey|hello|ok|okay|k|lol|haha|nice|cool|thanks|ty|yeah|yep|nope|hm|hmm)[!.? ]*$/i.test(
    summary.trim(),
  );
}

const HIGH_STAKES_RE =
  /\b(?:delete (?:my |all )?(?:memory|identity|data)|wipe (?:me|memory)|password|api[_ -]?key|private key|recovery code|foundational (?:identity|value)|change who you are|overdose|pharmacolog)\b/i;

const URGENCY_RE =
  /\b(?:urgent|emergency|right now|immediately|asap|crisis)\b/i;

const COMPLEX_RE =
  /\b(?:debug|stack trace|race condition|deadlock|foundational|constitution|identity review|pharmacolog|mechanism|contraindication)\b/i;

function mapMotivationKind(kind: MotivationKind): DecisionKind {
  switch (kind) {
    case "question":
      return "ask";
    case "unfinished":
      return "revisit";
    case "take":
      return "share";
    case "opinion":
      return "challenge";
    case "fact":
      return "revisit";
    case "callback":
      return "revisit";
    case "identity":
      return "share";
    case "availability":
      return "speak";
    case "boundary":
      return "refuse";
    case "user_message":
      return "speak";
    case "silence_signal":
      return "silence";
    case "silence_ok":
      return "silence";
    case "reminder":
      return "revisit";
    case "scheduled_proactive":
      return "share";
    case "learned_interest":
      return "share";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function normalizedObjective(
  trigger: Trigger,
  kind: DecisionKind,
  fluff: boolean,
): string {
  if (trigger === "reactive") {
    if (kind === "silence") return "honor the request for space";
    if (fluff) return "acknowledge the greeting";
    return "respond to the direct message";
  }
  switch (kind) {
    case "share":
      return "surface a grounded proactive share";
    case "ask":
      return "ask a grounded proactive question";
    case "revisit":
      return "revisit unfinished material";
    case "challenge":
      return "offer a grounded challenge";
    case "silence":
      return "remain silent";
    case "refuse":
      return "refuse only if grounded and solicited";
    case "speak":
    case "delay":
      return "consider proactive contact";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function allocateEffort(input: {
  fluff: boolean;
  kind: DecisionKind;
  summary: string;
  ownTimeActive: boolean;
  relevantRefusal: boolean;
}): Decision["cognitiveAllocation"]["effort"] {
  if (input.fluff) return "low";
  if (
    input.kind === "refuse" ||
    input.relevantRefusal ||
    input.ownTimeActive ||
    HIGH_STAKES_RE.test(input.summary) ||
    COMPLEX_RE.test(input.summary)
  ) {
    return "high";
  }
  return "medium";
}

function allocateUrgency(summary: string, mindUrgency: number): number {
  if (URGENCY_RE.test(summary)) return Math.max(0.8, mindUrgency);
  if (mindUrgency >= 0.75) return mindUrgency;
  return 0;
}

function makeDecision(
  trigger: Trigger,
  kind: DecisionKind,
  motivations: Motivation[],
  reason: string,
  score: number,
  options: {
    fluff?: boolean;
    ownTime?: OwnTimeReportConstraint | null;
    userSummary?: string;
    relevantBoundaryIds?: ReadonlySet<number>;
    mindUrgency?: number;
  } = {},
): Decision {
  const fluff = options.fluff === true;
  const ownTime = options.ownTime ?? null;
  const relevantBoundaryIds = options.relevantBoundaryIds ?? new Set<number>();
  const summary = options.userSummary ?? motivations[0]?.summary ?? "";
  const relevantRefusal =
    trigger === "reactive" &&
    motivations.some(
      (item) =>
        item.kind === "boundary" &&
        item.id !== undefined &&
        relevantBoundaryIds.has(item.id),
    );

  const selected = motivations.filter((motivation) => {
    if (motivation.kind !== "boundary") return true;
    return (
      motivation.id !== undefined && relevantBoundaryIds.has(motivation.id)
    );
  });

  const evidenceTypes = new Set([
    "message",
    "episode",
    "fact",
    "question",
    "opinion",
    "take",
    "identity",
    "mind_state",
    "doc_reminder",
    "ashley_self_commitment",
    "mutual_commitment",
    "relational_tension",
    "open_cognitive_item",
  ]);
  const evidenceRefs = selected
    .filter(
      (motivation) =>
        motivation.refType &&
        evidenceTypes.has(motivation.refType) &&
        motivation.refId != null &&
        // Keep message id as provenance only; text is not re-materialized later.
        !(motivation.kind === "user_message" && motivation.refType === "message"),
    )
    .map((motivation) => ({
      type: motivation.refType as EvidenceRef["type"],
      id: motivation.refId!,
    }));

  // User message provenance retained separately via motivation ids / runtime.
  const userMessageRef = selected.find(
    (item) => item.kind === "user_message" && item.refType === "message",
  );
  if (userMessageRef?.refId != null) {
    evidenceRefs.unshift({
      type: "message",
      id: userMessageRef.refId,
    });
  }

  let authorizedClaims = {
    readingRecordIds: [] as number[],
    readingTitles: [] as string[],
    readingClaims: [] as Decision["authorizedClaims"]["readingClaims"],
  };
  let ownTimeReport: Decision["ownTimeReport"];
  let finalKind = kind;
  let finalReason = reason;

  if (ownTime && ownTime.canInfluence) {
    ownTimeReport = {
      status: ownTime.status,
      reason: ownTime.reason,
      sessionId: ownTime.sessionId,
      selectedTakeIds: ownTime.selectedTakeIds,
    };
    if (ownTime.status === "reportable_takes") {
      finalKind = "share";
      finalReason = "Share what stood out while Doc was away.";
      for (const takeId of ownTime.selectedTakeIds) {
        evidenceRefs.push({ type: "take", id: takeId });
      }
      authorizedClaims = {
        readingRecordIds: ownTime.readingClaims.map((claim) => claim.readRecordId),
        readingTitles: ownTime.readingClaims.map((claim) => claim.title),
        readingClaims: ownTime.readingClaims,
      };
    } else {
      finalKind = "speak";
      finalReason = "Answer Doc's ask about what happened while they were away.";
    }
  }

  const effort = allocateEffort({
    fluff,
    kind: finalKind,
    summary,
    ownTimeActive: ownTime?.canInfluence === true,
    relevantRefusal,
  });
  const urgency = allocateUrgency(summary, options.mindUrgency ?? 0);

  return {
    trigger,
    kind: finalKind,
    motivationIds: motivationIds(selected),
    score,
    reason: finalReason,
    objective: normalizedObjective(trigger, finalKind, fluff),
    evidenceRefs,
    uncertainty: 0,
    urgency,
    thoughtSource: "deterministic",
    thoughtError: null,
    affectLicense: {
      permitted: false,
      valence: 0,
      activation: 0.5,
      openness: 0.5,
      tension: 0,
      reason: "neutral baseline",
    },
    cognitiveAllocation: {
      shouldSpeak: finalKind !== "silence" && finalKind !== "delay",
      effort,
      completion: finalKind === "delay" ? "hold" : "complete",
    },
    authorizedClaims,
    ...(ownTimeReport ? { ownTimeReport } : {}),
  };
}

/**
 * Relocate Conversation's kind→take license reconstruction onto Decision.
 * Takes must already be loaded before Expression; no new inference.
 * Preserves report-finalizer structured claims when already present.
 */
export function attachAuthorizedClaims(
  decision: Decision,
  takes: Array<{
    id: number;
    title: string;
    evidenceKind: "scan_excerpt" | "read_record";
    readId: number | null;
    provenance: "shadow" | "live";
    readProvenance?: "shadow" | "live" | null;
    authorityClass?: NonAuthoritativeContentClass;
  }>,
): Decision {
  if (decision.authorizedClaims.readingClaims.length > 0) {
    return decision;
  }
  if (decision.kind !== "share" && decision.kind !== "ask") {
    return decision;
  }
  const licensedTakeIds = new Set(
    decision.evidenceRefs
      .filter((ref) => ref.type === "take")
      .map((ref) => Number(ref.id)),
  );
  const slice = takes
    .filter(
      (take) =>
        licensedTakeIds.has(take.id) &&
        take.evidenceKind === "read_record" &&
        take.readId !== null &&
        take.provenance === "live" &&
        (take.readProvenance ?? "live") === "live" &&
        (take.authorityClass ?? "NON_AUTHORITATIVE_DERIVED_CONTENT") ===
          "NON_AUTHORITATIVE_DERIVED_CONTENT",
    )
    .slice(0, 2);
  return {
    ...decision,
    authorizedClaims: {
      readingRecordIds: slice.flatMap((take) =>
        take.readId === null ? [] : [take.readId]),
      readingTitles: slice.map((take) => take.title),
      readingClaims: [],
    },
  };
}

export type DecideOptions = {
  ownTime?: OwnTimeReportConstraint | null;
  userMessage?: string;
  mindUrgency?: number;
  db?: import("node:sqlite").DatabaseSync;
  ownerId?: string;
};

export function decide(
  motivations: Motivation[],
  trigger: Trigger,
  options: DecideOptions = {},
): Decision {
  const ownTime = options.ownTime ?? null;
  const userText =
    options.userMessage ??
    motivations.find((item) => item.kind === "user_message")?.summary ??
    "";
  const relevantBoundaryIds = relevantBoundaryIdSet(userText, motivations);

  const silenceSignal = motivations.find(
    (motivation) =>
      motivation.kind === "silence_signal" && motivation.score >= 70,
  );
  if (trigger === "reactive" && silenceSignal) {
    return makeDecision(
      trigger,
      "silence",
      [silenceSignal],
      "The user asked for space.",
      silenceSignal.score,
      { ownTime: null, userSummary: silenceSignal.summary, relevantBoundaryIds },
    );
  }

  const userMessage = motivations.find(
    (motivation) => motivation.kind === "user_message",
  );
  if (trigger === "reactive" && userMessage) {
    if (options.db && options.ownerId) {
      const withdrawalCode = evaluateWithdrawalSilence(
        options.db,
        options.ownerId,
        env.cognitionMode,
        userText,
      );
      if (withdrawalCode) {
        return {
          ...makeDecision(
            trigger,
            "silence",
            [userMessage],
            "Honoring active withdrawal scope.",
            userMessage.score,
            {
              ownTime: null,
              userSummary: userMessage.summary,
              relevantBoundaryIds,
            },
          ),
          silenceReasonCode: withdrawalCode,
        };
      }
    }
    if (isSilenceRequest(userMessage.summary)) {
      return makeDecision(
        trigger,
        "silence",
        [userMessage],
        "The user asked for space.",
        userMessage.score,
        {
          ownTime: null,
          userSummary: userMessage.summary,
          relevantBoundaryIds,
        },
      );
    }

    // Own-time constraint applies only on speak-path reactive asks.
    const effectiveOwnTime =
      ownTime && ownTime.canInfluence ? ownTime : null;

    const substantive = motivations
      .filter(
        (motivation) =>
          motivation !== userMessage &&
          motivation.kind !== "silence_ok" &&
          motivation.kind !== "availability" &&
          motivation.kind !== "boundary",
      )
      .sort((a, b) => b.score - a.score)[0];

    const fluff = isFluff(userMessage.summary);
    const selected = [
      userMessage,
      ...(substantive && !fluff ? [substantive] : []),
      ...motivations.filter(
        (item) =>
          item.kind === "boundary" &&
          item.id !== undefined &&
          relevantBoundaryIds.has(item.id),
      ),
    ];

    return makeDecision(
      trigger,
      "speak",
      selected,
      "A direct message deserves an answer.",
      Math.max(userMessage.score, substantive?.score ?? 0),
      {
        fluff,
        ownTime: effectiveOwnTime,
        userSummary: userMessage.summary,
        relevantBoundaryIds,
        mindUrgency: options.mindUrgency,
      },
    );
  }

  if (trigger === "reactive") {
    return makeDecision(
      trigger,
      "speak",
      motivations.slice(0, 2),
      "A reactive turn without a user-message marker still defaults to speaking.",
      motivations[0]?.score ?? 0,
      { relevantBoundaryIds, mindUrgency: options.mindUrgency },
    );
  }

  if (options.db && options.ownerId) {
    const withdrawalCode = evaluateWithdrawalSilence(
      options.db,
      options.ownerId,
      env.cognitionMode,
      undefined,
      { proactive: true },
    );
    if (withdrawalCode) {
      return {
        ...makeDecision(
          trigger,
          "silence",
          motivations.slice(0, 1),
          "Honoring active withdrawal scope.",
          motivations[0]?.score ?? 0,
          { relevantBoundaryIds },
        ),
        silenceReasonCode: withdrawalCode,
      };
    }
  }

  // Proactive: never emit unsolicited refuse from a boundary motivation.
  const candidate = motivations
    .filter(
      (motivation) =>
        motivation.kind !== "silence_ok" &&
        motivation.kind !== "silence_signal" &&
        motivation.kind !== "user_message" &&
        motivation.kind !== "boundary",
    )
    .sort((a, b) => b.score - a.score)[0];
  if (!candidate || candidate.score < 25) {
    return makeDecision(
      trigger,
      "silence",
      candidate ? [candidate] : motivations.slice(0, 1),
      "Nothing currently earns a proactive interruption.",
      candidate?.score ?? 0,
      { relevantBoundaryIds },
    );
  }

  const mapped = mapMotivationKind(candidate.kind);
  const kind = mapped === "refuse" ? "speak" : mapped;

  return makeDecision(
    trigger,
    kind,
    [candidate],
    `A ${candidate.kind} has enough weight to surface.`,
    candidate.score,
    { userSummary: candidate.summary, relevantBoundaryIds },
  );
}
