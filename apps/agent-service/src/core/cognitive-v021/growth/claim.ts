import { APPRAISAL_NOTE_MAX_CHARS, MOOD_DIMENSIONS, type MoodAppraisal } from "./mood.js";
import {
  EXPECTATION_CHECKS_PER_SETTLEMENT,
  EXPECTATION_LESSON_MAX_CHARS,
  EXPECTATION_STATEMENT_MAX_CHARS,
  EXPECTATIONS_PER_SETTLEMENT,
  isExpectationOutcome,
  type ExpectationCheck,
} from "./expectations.js";
import {
  REVISION_EVIDENCE_REFS_MAX,
  REVISION_POSITIONS_PER_SETTLEMENT,
  REVISION_RATIONALE_MAX_CHARS,
  REVISION_TEXT_MAX_CHARS,
  REVISION_TOPIC_MAX_CHARS,
  REVISIONS_PER_SETTLEMENT,
  isRevisionLayer,
  isRevisionPosition,
  type RevisionPosition,
  type RevisionProposal,
} from "./revisions.js";
import {
  DIARY_MAX_CHARS,
  NARRATIVE_MAX_CHARS,
  NIGHT_CLOSE_QUESTIONS_MAX,
  NIGHT_SALIENCE_MAX,
  type NightClaim,
} from "./night.js";

/**
 * Growth V1 G4: what one settlement may author about Ashley's growth. Every
 * part is optional and every word is hers; the Host bounds and stores it.
 */
export type GrowthClaim = {
  appraisal?: MoodAppraisal;
  expectations?: string[];
  expectationChecks?: ExpectationCheck[];
  revisions?: RevisionProposal[];
  revisionPositions?: RevisionPosition[];
};

type Row = Record<string, unknown>;

function record(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : null;
}

function text(value: unknown, max: number): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function onlyKeys(value: Row, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function boundedArray(value: unknown, max: number): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && value.length <= max;
}

function validAppraisal(value: unknown): boolean {
  const appraisal = record(value);
  if (!appraisal || !onlyKeys(appraisal, ["note", ...MOOD_DIMENSIONS])) return false;
  if (!text(appraisal.note, APPRAISAL_NOTE_MAX_CHARS)) return false;
  return MOOD_DIMENSIONS.every((dimension) => appraisal[dimension] === undefined
    || (typeof appraisal[dimension] === "number" && Number.isFinite(appraisal[dimension])
      && Math.abs(appraisal[dimension] as number) <= 1));
}

function validCheck(value: unknown): boolean {
  const check = record(value);
  return check !== null && onlyKeys(check, ["expectationId", "outcome", "lesson"])
    && text(check.expectationId, 200) && isExpectationOutcome(check.outcome) && text(check.lesson, EXPECTATION_LESSON_MAX_CHARS);
}

function validProposal(value: unknown): boolean {
  const proposal = record(value);
  if (!proposal || !onlyKeys(proposal, ["layer", "topic", "revisesEntryId", "text", "rationale", "evidenceRefs"])) return false;
  if (!isRevisionLayer(proposal.layer) || !text(proposal.text, REVISION_TEXT_MAX_CHARS)) return false;
  if (!text(proposal.rationale, REVISION_RATIONALE_MAX_CHARS)) return false;
  if (proposal.topic !== undefined && !text(proposal.topic, REVISION_TOPIC_MAX_CHARS)) return false;
  if (proposal.revisesEntryId !== undefined && !Number.isSafeInteger(proposal.revisesEntryId)) return false;
  return boundedArray(proposal.evidenceRefs, REVISION_EVIDENCE_REFS_MAX)
    && proposal.evidenceRefs.every((ref) => text(ref, 200));
}

function validPosition(value: unknown): boolean {
  const position = record(value);
  return position !== null && onlyKeys(position, ["revisionId", "position", "rationale"])
    && Number.isSafeInteger(position.revisionId) && isRevisionPosition(position.position)
    && text(position.rationale, REVISION_RATIONALE_MAX_CHARS);
}

/** Structural check for the settlement's `growth` field. */
export function isValidGrowthClaim(value: unknown): value is GrowthClaim {
  const growth = record(value);
  if (!growth || Object.keys(growth).length === 0) return false;
  if (!onlyKeys(growth, ["appraisal", "expectations", "expectationChecks", "revisions", "revisionPositions"])) return false;
  if (growth.appraisal !== undefined && !validAppraisal(growth.appraisal)) return false;
  if (growth.expectations !== undefined && !(boundedArray(growth.expectations, EXPECTATIONS_PER_SETTLEMENT)
    && growth.expectations.every((item) => text(item, EXPECTATION_STATEMENT_MAX_CHARS)))) return false;
  if (growth.expectationChecks !== undefined && !(boundedArray(growth.expectationChecks, EXPECTATION_CHECKS_PER_SETTLEMENT)
    && growth.expectationChecks.every(validCheck))) return false;
  if (growth.revisions !== undefined && !(boundedArray(growth.revisions, REVISIONS_PER_SETTLEMENT)
    && growth.revisions.every(validProposal))) return false;
  if (growth.revisionPositions !== undefined && !(boundedArray(growth.revisionPositions, REVISION_POSITIONS_PER_SETTLEMENT)
    && growth.revisionPositions.every(validPosition))) return false;
  return true;
}

/** Structural check for the settlement's `night` field (NIGHT pass only). */
export function isValidNightClaim(value: unknown): value is NightClaim {
  const night = record(value);
  if (!night || Object.keys(night).length === 0) return false;
  if (!onlyKeys(night, ["diary", "salience", "closeQuestions", "narrative"])) return false;
  if (night.diary !== undefined && !text(night.diary, DIARY_MAX_CHARS)) return false;
  if (night.narrative !== undefined && !text(night.narrative, NARRATIVE_MAX_CHARS)) return false;
  if (night.salience !== undefined && !(boundedArray(night.salience, NIGHT_SALIENCE_MAX) && night.salience.every((item) => {
    const entry = record(item);
    return entry !== null && onlyKeys(entry, ["key", "salience"]) && text(entry.key, 200)
      && typeof entry.salience === "number" && entry.salience >= 0 && entry.salience <= 1;
  }))) return false;
  if (night.closeQuestions !== undefined && !(boundedArray(night.closeQuestions, NIGHT_CLOSE_QUESTIONS_MAX)
    && night.closeQuestions.every((key) => text(key, 200)))) return false;
  return true;
}
