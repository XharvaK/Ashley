import type {
  ConversationalCommitment,
  EpistemicCommitment,
  Observation,
  OperationalStateClaim,
  SpeechMode,
  Stance,
} from "../types.js";
import {
  claimsOwnConversationalReadActivity,
  claimsOwnReadingActivity,
  claimsOwnVisionActivity,
  stripQuotedHypotheticals,
} from "../../honesty/claims.js";
import { claimsCurrentness } from "../authority/currentness-detectors.js";

export type FidelityCommitments = {
  epistemic?: readonly EpistemicCommitment[];
  operational?: readonly OperationalStateClaim[];
  conversational?: readonly ConversationalCommitment[];
  stance?: Stance;
};

export type FidelityInput = {
  mode: SpeechMode;
  draft: string | null;
  mustSay?: readonly string[];
  mustNot?: readonly string[];
  /**
   * Kept as an input-only compatibility field for historical callers. VNext
   * authoring does not emit or consult acceptable realizations.
   */
  acceptableRealizations?: readonly string[];
  commitments?: FidelityCommitments;
  /**
   * Bounded identity view: fidelity resolves Thought-authored observation
   * refs by exact ID and checks production modality compatibility. Payloads
   * never enter fidelity (evidence starvation preserved).
   */
  observations?: readonly Pick<Observation, "observationId" | "modality">[];
};

export type FidelityFailureCode =
  | "DRAFT_COMMITMENT_CONFLICT"
  | "EMPTY_COMMITMENTS_WITH_DRAFT"
  | "DRAFT_REQUIRED"
  | "NONE_SURFACE_FORBIDDEN"
  | "MUST_SAY_MISSING"
  | "MUST_NOT_PRESENT"
  | "UNWITNESSED_HIGH_RISK_CLAIM";

export type FidelityResult =
  | { ok: true; code: "ok"; draft: string | null }
  | { ok: false; code: FidelityFailureCode; detail: string };

type FidelityFailure = Extract<FidelityResult, { ok: false }>;

function fail(code: FidelityFailureCode, detail: string): FidelityFailure {
  return { ok: false, code, detail };
}

function hasText(value: string, required: string): boolean {
  return required.length === 0 || value.includes(required);
}

const OPERATIONAL_SUBJECT = "(?:task|request|job|operation|effect|file|message|change|update|test|check|command|deployment|build|roundtrip|sandbox|reservation|trigger|subscription|project|document|directory|folder|config|configuration|patch|release|result|it)";

const AFFIRMATIVE_OPERATIONAL_PATTERNS = [
  new RegExp(`\\b(?:i|we)\\s+(?:just\\s+|already\\s+|successfully\\s+)?(?:worked|succeeded|completed|finished|sent|created|updated|deleted|verified|ran|executed)\\s+(?:(?:the|this|that|my|your)\\s+)?${OPERATIONAL_SUBJECT}\\b`, "i"),
  new RegExp(`\\b(?:i|we)\\s+(?:did|got|made)\\s+(?:it|(?:(?:the|this|that)\\s+)?(?:task|request|job|operation|effect))\\b`, "i"),
  new RegExp(`\\b(?:the|this|that|our|your)\\s+${OPERATIONAL_SUBJECT}\\s+(?:worked|succeeded|passed|completed|finished)\\b`, "i"),
  new RegExp(`\\b(?:the|this|that|our|your)\\s+${OPERATIONAL_SUBJECT}\\s+(?:is|was|has been|have been)\\s+(?:complete|completed|done|successful|sent|created|updated|deleted|verified)\\b`, "i"),
  new RegExp(`\\b(?:done|completed|finished)\\s*[-—:]\\s+(?:(?:the|this|that)\\s+)?${OPERATIONAL_SUBJECT}\\b`, "i"),
];

/**
 * Keep lexical high-risk checks focused on direct assertive clauses. Quoted,
 * reported, hypothetical, and explicitly disclaimed prose is not Ashley's
 * own operational assertion.
 */
function directAssertiveSegments(text: string): string[] {
  const clean = stripQuotedHypotheticals(text)
    .replace(/\b(?:they|he|she|you|someone|the user)\s+(?:said|says|mentioned|reported|claimed|asked|wrote)\b[^.!?]*(?:[.!?]|$)/gi, " ")
    .replace(/\b(?:i|we)\s+(?:do not|don't|cannot|can't|can not|never)\s+(?:claim|say|pretend|mean|have|know)\b[^.!?]*(?:[.!?]|$)/gi, " ");
  return clean
    .split(/[.!?]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function claimsAffirmativeOperationalEffect(text: string): boolean {
  return directAssertiveSegments(text).some((segment) =>
    AFFIRMATIVE_OPERATIONAL_PATTERNS.some((pattern) => pattern.test(segment)),
  );
}

function directAssertiveProse(text: string): string {
  return directAssertiveSegments(text).join(". ");
}

/**
 * Production observation modalities that can truthfully warrant each
 * high-risk detector class. Enum-domain policy only; observation payloads
 * are never read. Legacy strings (url/web/vision/screenshot) are not
 * producible Observation modalities and are not accepted here.
 */
const READING_DISCOVERY_MODALITIES: ReadonlySet<string> = new Set(["page", "tool", "text"]);
const VISION_MODALITIES: ReadonlySet<string> = new Set(["image"]);

const EXTERNAL_EVIDENCE_SOURCES: ReadonlySet<string> = new Set(["tool", "perception"]);

function countSpanOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + 1;
  }
}

function spanDetectorClasses(span: string): { reading: boolean; vision: boolean } {
  return {
    reading: claimsOwnConversationalReadActivity(span) || claimsOwnReadingActivity(span),
    vision: claimsOwnVisionActivity(span),
  };
}

function isInterpretiveBinding(commitment: EpistemicCommitment): boolean {
  return commitment.dimensions.source === "ashley_interpretation"
    && commitment.dimensions.status === "interpreted"
    && commitment.observationRefs === undefined;
}

type MaskOutcome =
  | { ok: true; text: string }
  | { ok: false; failure: FidelityFailure };

/**
 * Mechanical span licensing. Thought-authored surfaceSpans that validate are
 * removed so the remainder backstop sees only unbound surface. The Host never
 * decides which commitment a sentence probably corresponds to: every license
 * flows from an exact literal span Thought itself authored.
 */
function maskLicensedSpans(
  draft: string,
  epistemic: readonly EpistemicCommitment[],
  modalityById: ReadonlyMap<string, string>,
): MaskOutcome {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const commitment of epistemic) {
    const refs = commitment.observationRefs;
    // A present observation ref is binding evidence even when its span is
    // detector-vacuous, so resolve every ref before any early exit.
    if (refs !== undefined) {
      for (const ref of refs) {
        if (!modalityById.has(ref)) {
          return { ok: false, failure: fail("UNWITNESSED_HIGH_RISK_CLAIM", "evidence-bound surface claim cites an unknown observation") };
        }
      }
    }
    if (typeof commitment.surfaceSpan !== "string" || commitment.surfaceSpan.length === 0) {
      continue;
    }
    const span = commitment.surfaceSpan;
    const occurrences = countSpanOccurrences(draft, span);
    if (EXTERNAL_EVIDENCE_SOURCES.has(commitment.dimensions.source)) {
      // Evidence-bound spans must survive exactly once: Expression may not
      // drop, rewrite, or duplicate a guarded surface claim.
      if (occurrences !== 1) {
        return { ok: false, failure: fail("DRAFT_COMMITMENT_CONFLICT", "evidence-bound surface span is not preserved exactly once") };
      }
      const fired = spanDetectorClasses(span);
      if (!fired.reading && !fired.vision) {
        continue; // vacuous span: licenses and masks nothing
      }
      const boundRefs = refs ?? [];
      if (boundRefs.length === 0) {
        return { ok: false, failure: fail("UNWITNESSED_HIGH_RISK_CLAIM", "evidence-bound surface claim cites no observation") };
      }
      const modalities = boundRefs
        .map((ref) => modalityById.get(ref))
        .filter((modality): modality is string => modality !== undefined);
      if (fired.reading && !modalities.some((modality) => READING_DISCOVERY_MODALITIES.has(modality))) {
        return { ok: false, failure: fail("UNWITNESSED_HIGH_RISK_CLAIM", "evidence-bound reading claim has no compatible observation") };
      }
      if (fired.vision && !modalities.some((modality) => VISION_MODALITIES.has(modality))) {
        return { ok: false, failure: fail("UNWITNESSED_HIGH_RISK_CLAIM", "evidence-bound vision claim has no compatible observation") };
      }
      const start = draft.indexOf(span);
      ranges.push({ start, end: start + span.length });
      continue;
    }
    if (isInterpretiveBinding(commitment)) {
      // Expression may naturally rephrase ordinary interpretive prose; a
      // rephrased surface that still trips the backstop is unbound and
      // rejects in the remainder phase.
      if (occurrences === 0) continue;
      if (occurrences > 1) {
        return { ok: false, failure: fail("DRAFT_COMMITMENT_CONFLICT", "interpretive surface span is ambiguous") };
      }
      const fired = spanDetectorClasses(span);
      if (!fired.reading && !fired.vision) continue;
      const start = draft.indexOf(span);
      ranges.push({ start, end: start + span.length });
      continue;
    }
    // Other semantic sources suppress nothing in this packet.
  }
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      return { ok: false, failure: fail("DRAFT_COMMITMENT_CONFLICT", "licensed surface spans overlap") };
    }
  }
  let text = draft;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    text = text.slice(0, ranges[index].start) + text.slice(ranges[index].end);
  }
  return { ok: true, text };
}

/**
 * Structural speech licensing. This is intentionally not an entailment model.
 * Thought commitments and explicit speech constraints remain authoritative;
 * this function only rejects an incompatible surface.
 */
export function fidelityCheck(input: FidelityInput): FidelityResult {
  if (input.mode === "none") {
    return input.draft === null || input.draft.trim() === ""
      ? { ok: true, code: "ok", draft: null }
      : fail("NONE_SURFACE_FORBIDDEN", "mode=none requires a null surfaceDraft");
  }

  if (input.draft === null || input.draft.trim().length === 0) {
    return fail("DRAFT_REQUIRED", "mode=draft requires a non-empty draft");
  }

  const draft = input.draft;
  const commitments = input.commitments ?? {};
  const mustSay = input.mustSay ?? [];
  const mustNot = input.mustNot ?? [];
  const observations = input.observations ?? [];
  const modalityById = new Map(observations.map((item) => [item.observationId, item.modality]));
  const masked = maskLicensedSpans(draft, commitments.epistemic ?? [], modalityById);
  if (!masked.ok) {
    return masked.failure;
  }
  const directSpeech = directAssertiveProse(masked.text);
  // Remainder backstop: ambient observations are inert. A high-risk surface
  // claim is licensed only inside a mechanically bound span (masked above).
  if (claimsOwnVisionActivity(directSpeech)) {
    return fail("UNWITNESSED_HIGH_RISK_CLAIM", "vision claim has no licensed evidence");
  }
  if (
    claimsOwnConversationalReadActivity(directSpeech) || claimsOwnReadingActivity(directSpeech)
  ) {
    return fail("UNWITNESSED_HIGH_RISK_CLAIM", "reading claim has no licensed evidence");
  }
  const mustSaySatisfied = mustSay.every((required) => hasText(draft, required));
  if (!mustSaySatisfied) {
    return fail("DRAFT_COMMITMENT_CONFLICT", "mustSay is absent from the licensed draft");
  }

  const forbidden = mustNot.find((value) => value.length > 0 && draft.includes(value));
  if (forbidden) {
    return fail("DRAFT_COMMITMENT_CONFLICT", `mustNot is present: ${forbidden}`);
  }

  const affirmativeEffectClaim = claimsAffirmativeOperationalEffect(draft);
  if (affirmativeEffectClaim) {
    const hasSucceededOperationalClaim = commitments.operational?.some(
      (claim) => claim.claimedState === "succeeded",
    );
    if (!hasSucceededOperationalClaim) {
      return fail("DRAFT_COMMITMENT_CONFLICT", "affirmative effect claim on surface without operational success commitment");
    }
  }

  if (claimsCurrentness(draft)) {
    const hasCurrentnessCommitment = commitments.epistemic?.some(
      (c) => c.dimensions.time === "current",
    );
    if (!hasCurrentnessCommitment) {
      return fail("DRAFT_COMMITMENT_CONFLICT", "currentness claim on surface without current epistemic commitment");
    }
  }

  return { ok: true, code: "ok", draft };
}
