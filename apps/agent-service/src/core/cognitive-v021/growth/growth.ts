import { frictionForThought, recordFriction } from "./friction.js";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../../privacy/classification.js";
import type { GrowthClaim } from "./claim.js";
import { MOOD_BASELINE, readMood, recordAppraisal, type MoodVector } from "./mood.js";
import { latestNarrative, listDiary } from "./night.js";
import {
  checkExpectations,
  expireStaleExpectations,
  listOpenExpectations,
  listRecentLessons,
  listSourceRecords,
  recordExpectations,
  type ExpectationOutcome,
} from "./expectations.js";
import {
  REVISION_THRESHOLDS,
  evaluateRevisions,
  isFoundationalLayer,
  listCurrentOpinions,
  listCurrentPractices,
  listOpenRevisions,
  proposeRevisions,
  recordRevisionPositions,
  revisableIdentityEntries,
  revisionEvidenceStats,
  type ProposalOutcome,
  type RevisableIdentityEntry,
  type RevisionEvaluation,
  type RevisionLayer,
  type RevisionPositionKind,
} from "./revisions.js";

/**
 * Growth V1 G4: what Ashley sees of her own growth, and how one settlement's
 * growth claim is recorded. Owner-private only.
 */

export type IdentityStore = { nuclear: DatabaseSync; ownerId: string };

export type ThoughtGrowth = {
  friction: ReturnType<typeof frictionForThought>;
  practices?: Array<{ revisionId: number; text: string; heldSinceMs: number }>;
  /** How she feels right now; an input to weigh, never a script to act out. */
  mood: MoodVector & { baseline: MoodVector; reason?: string; lastAppraisalAtMs?: number };
  /** Her current identity entries that a revision may target, by entry id. */
  self?: RevisableIdentityEntry[];
  opinions?: Array<{ revisionId: number; topic: string; stance: string; heldSinceMs: number }>;
  /** Revisions still gathering evidence or waiting on a decision. */
  revisions?: Array<{
    revisionId: number;
    layer: RevisionLayer;
    topic?: string;
    revisesEntryId?: number;
    proposed: string;
    evidence: number;
    /** Separate passes that brought new evidence, and the days between the first and last. */
    passes: number;
    spanDays: number;
    needs: string;
    ashleyPosition?: RevisionPositionKind;
    ownerDecision?: string;
  }>;
  /** Expectations she recorded and has not checked yet. */
  expectations?: Array<{ expectationId: string; statement: string; atMs: number }>;
  /** A9: how what each contact or site told her has held up (expectations by outcome). */
  sources?: Array<{ source: string; met: number; missed: number; mixed: number; open: number }>;
  /** What recent checks taught her. */
  lessons?: Array<{ expectationId: string; statement: string; outcome: ExpectationOutcome; lesson: string; atMs: number }>;
  /** Her latest weekly "who I am becoming" narrative. */
  becoming?: { text: string; writtenAtMs: number };
  /** Her last diary entry. */
  diary?: { day: string; text: string };
};

function needsFor(layer: RevisionLayer): string {
  if (isFoundationalLayer(layer)) return "your affirmation in a later pass and the Owner's approval";
  if (layer === "practice") return "2 independent origins, or 1 origin and your affirmation in a later pass";
  const threshold = REVISION_THRESHOLDS[layer];
  const days = Math.round(threshold.spanMs / 86_400_000);
  const passes = threshold.passes > 1 ? `, proposed in ${threshold.passes} separate passes over ${days} days` : "";
  const delay = threshold.delayMs > 0 ? `, then ${Math.round(threshold.delayMs / 3_600_000)} h` : "";
  return `${threshold.evidence} independent origins${passes}${delay}`;
}

export function growthForThought(db: DatabaseSync, identityStore: IdentityStore | null, nowMs: number): ThoughtGrowth {
  const mood = readMood(db, nowMs);
  const self = identityStore ? revisableIdentityEntries(identityStore.nuclear, identityStore.ownerId) : [];
  const opinions = listCurrentOpinions(db).map((revision) => ({
    revisionId: revision.revisionId,
    topic: revision.topic ?? revision.targetKey,
    stance: revision.proposedText,
    heldSinceMs: revision.appliedAtMs ?? revision.updatedAtMs,
  }));
  const revisions = listOpenRevisions(db).map((revision) => {
    const stats = revisionEvidenceStats(db, revision.revisionId);
    return {
      revisionId: revision.revisionId,
      layer: revision.layer,
      ...(revision.topic ? { topic: revision.topic } : {}),
      ...(revision.revisesEntryId === null ? {} : { revisesEntryId: revision.revisesEntryId }),
      proposed: revision.proposedText,
      evidence: stats.count,
      passes: stats.passes,
      spanDays: Math.round((stats.spanMs / 86_400_000) * 10) / 10,
      needs: needsFor(revision.layer),
      ...(revision.ashleyPosition ? { ashleyPosition: revision.ashleyPosition } : {}),
      ...(revision.ownerDecision ? { ownerDecision: revision.ownerDecision } : {}),
    };
  });
  const expectations = listOpenExpectations(db, nowMs).map((item) => ({
    expectationId: item.expectationId,
    statement: item.statement,
    atMs: item.createdAtMs,
  }));
  const lessons = listRecentLessons(db).map((item) => ({
    expectationId: item.expectationId,
    statement: item.statement,
    outcome: item.status as ExpectationOutcome,
    lesson: item.lesson ?? "",
    atMs: item.checkedAtMs ?? item.createdAtMs,
  }));
  const sources = listSourceRecords(db);
  const becoming = latestNarrative(db);
  const [diary] = listDiary(db, 1);
  return {
    friction: frictionForThought(db, nowMs),
    practices: listCurrentPractices(db).map(revision => ({ revisionId: revision.revisionId, text: revision.proposedText, heldSinceMs: revision.appliedAtMs ?? revision.updatedAtMs })),
    mood: {
      valence: mood.valence,
      energy: mood.energy,
      openness: mood.openness,
      tension: mood.tension,
      baseline: { ...MOOD_BASELINE },
      ...(mood.reason ? { reason: mood.reason } : {}),
      ...(mood.lastAppraisalAtMs === null ? {} : { lastAppraisalAtMs: mood.lastAppraisalAtMs }),
    },
    ...(self.length === 0 ? {} : { self }),
    ...(opinions.length === 0 ? {} : { opinions }),
    ...(revisions.length === 0 ? {} : { revisions }),
    ...(expectations.length === 0 ? {} : { expectations }),
    ...(lessons.length === 0 ? {} : { lessons }),
    ...(sources.length === 0 ? {} : { sources }),
    ...(becoming ? { becoming: { text: becoming.text, writtenAtMs: becoming.createdAtMs } } : {}),
    ...(diary ? { diary: { day: diary.day, text: diary.text } } : {}),
  };
}

export type GrowthRecordResult = {
  appraised: boolean;
  expectations: string[];
  checked: string[];
  proposals: ProposalOutcome[];
  positions: number[];
  evaluation: RevisionEvaluation;
};

/**
 * Record one settlement's growth claim after publication, then check every
 * open revision against its threshold. Runs on every Owner-private
 * settlement, so a revision whose wait ran out applies without a new claim.
 */
export function recordGrowth(
  db: DatabaseSync,
  input: {
    cycleId: string;
    claim?: GrowthClaim;
    identityStore: IdentityStore | null;
    dataClassification: DataClassification;
    nowMs: number;
  },
): GrowthRecordResult {
  const { claim, nowMs } = input;
  for (const [index, friction] of (claim?.friction ?? []).slice(0, 2).entries()) {
    recordFriction(db, { frictionId: `thought-friction:${input.cycleId}:${index}`, kind: friction.kind, refs: friction.refs, note: friction.note, cycleId: input.cycleId, nowMs, dataClassification: input.dataClassification });
  }
  expireStaleExpectations(db, nowMs);
  const checked = claim?.expectationChecks
    ? checkExpectations(db, { cycleId: input.cycleId, checks: claim.expectationChecks, dataClassification: input.dataClassification, nowMs })
    : [];
  const expectations = claim?.expectations
    ? recordExpectations(db, { cycleId: input.cycleId, statements: claim.expectations, dataClassification: input.dataClassification, nowMs })
    : [];
  const appraised = claim?.appraisal
    ? recordAppraisal(db, { cycleId: input.cycleId, appraisal: claim.appraisal, dataClassification: input.dataClassification, nowMs }).applied !== null
    : false;
  const positions = claim?.revisionPositions
    ? recordRevisionPositions(db, { cycleId: input.cycleId, positions: claim.revisionPositions, dataClassification: input.dataClassification, nowMs })
    : [];
  const proposals = claim?.revisions
    ? proposeRevisions(db, {
        cycleId: input.cycleId,
        proposals: claim.revisions,
        dataClassification: input.dataClassification,
        identity: input.identityStore ? revisableIdentityEntries(input.identityStore.nuclear, input.identityStore.ownerId) : null,
        nowMs,
      })
    : [];
  const evaluation = evaluateRevisions(db, input.identityStore, nowMs);
  return { appraised, expectations, checked, proposals, positions, evaluation };
}
