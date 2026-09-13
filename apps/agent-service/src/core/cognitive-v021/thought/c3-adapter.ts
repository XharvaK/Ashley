import type { DatabaseSync } from "node:sqlite";
import {
  isC3AllowlistedTerminalClass,
  listC3TerminalExperiences,
} from "../failure/c3-recorder.js";
import type {
  C3ExternalEffectTruth,
  C3TerminalExperienceRecord,
} from "../failure/types.js";
import {
  buildCoverageManifest,
  type CoverageManifest,
  type CoverageManifestDomain,
} from "./coverage-manifest.js";

export const C3_FAILURE_DOMAIN = "failures_interruptions" as const;
export const C3_FAILURE_CANONICAL_STORE = "cognitive-v021.db:c3_terminal_experiences" as const;

/**
 * Compact, source-owned C3 facts for the existing C2 projection pipeline.
 * Attempt lineage and notice text stay out of the model-facing candidate.
 */
export type C3ExperienceCandidate = Readonly<{
  candidateId: string;
  experienceId: string;
  obligationFrontierId: string | null;
  cycleId: string;
  generation: number;
  terminalPhase: string;
  failureClass: string;
  terminalDisposition: "terminal";
  publicationState: "published" | "unpublished";
  externalEffectTruth: C3ExternalEffectTruth;
  receiptRef: string | null;
  unresolvedState: number;
  rawEvidenceRefsJson: string;
  noticeId: string | null;
  occurredAtMs: number;
  sourceDomainOwner: string;
  sourceCurrentnessRef: string | null;
}>;

export type C3AdapterOptions = {
  cycleId?: string | null;
  generation?: number | null;
  obligationFrontierId?: string | null;
  sourceCurrentnessRefs?: readonly string[];
  limit?: number;
  enabled?: boolean;
};

export type C3ExperienceAdapterResult = Readonly<{
  version: 1;
  canonicalStore: typeof C3_FAILURE_CANONICAL_STORE;
  queryStatus: "success" | "failed" | "disabled";
  candidates: readonly C3ExperienceCandidate[];
  coverageManifest: CoverageManifest;
  coverage: CoverageManifestDomain;
}>;

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceConversationIds(db: DatabaseSync, conversationId: string): Set<string> {
  const rows = db.prepare(
    "SELECT cycle_id FROM cycle_records WHERE conversation_id = ?",
  ).all(conversationId);
  return new Set(rows.filter(isRow).map((value) => String(value.cycle_id ?? "")).filter(Boolean));
}

function boundedLimit(value: number | undefined): number {
  return Math.max(1, Math.min(25, Math.floor(value ?? 8)));
}

function evidenceRefsFromJson(rawEvidenceRefsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(rawEvidenceRefsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!isRow(value) || typeof value.kind !== "string" || typeof value.id !== "string") return [];
      return [`${value.kind}:${value.id}`];
    });
  } catch {
    return [];
  }
}

function isSourceCurrent(
  record: C3TerminalExperienceRecord,
  options: C3AdapterOptions,
): boolean {
  if (record.unresolvedState === 1) return true;
  const cycleBound = options.cycleId != null && record.cycleId === options.cycleId &&
    (options.generation == null || record.generation === options.generation);
  const obligationBound = options.obligationFrontierId != null &&
    record.obligationFrontierId === options.obligationFrontierId;
  const currentnessBound = options.sourceCurrentnessRefs?.includes(record.sourceCurrentnessRef ?? "") ?? false;
  return cycleBound || obligationBound || currentnessBound;
}

function toCandidate(record: C3TerminalExperienceRecord): C3ExperienceCandidate {
  return Object.freeze({
    candidateId: record.experienceId,
    experienceId: record.experienceId,
    obligationFrontierId: record.obligationFrontierId,
    cycleId: record.cycleId,
    generation: record.generation,
    terminalPhase: record.terminalPhase,
    failureClass: record.failureClass,
    terminalDisposition: "terminal" as const,
    publicationState: record.publicationState,
    externalEffectTruth: record.externalEffectTruth,
    receiptRef: record.receiptRef,
    unresolvedState: record.unresolvedState,
    rawEvidenceRefsJson: record.rawEvidenceRefsJson,
    noticeId: record.noticeId,
    occurredAtMs: record.occurredAtMs,
    sourceDomainOwner: record.sourceDomainOwner,
    sourceCurrentnessRef: record.sourceCurrentnessRef,
  });
}

function result(
  queryStatus: C3ExperienceAdapterResult["queryStatus"],
  disposition: CoverageManifestDomain["disposition"],
  candidates: readonly C3ExperienceCandidate[],
  counts: {
    source: number;
    eligible: number;
    ineligible: number;
    stale: number;
  },
  evidenceRefs: readonly string[] = [],
): C3ExperienceAdapterResult {
  const coverageManifest = buildCoverageManifest([{
    domain: C3_FAILURE_DOMAIN,
    disposition,
    queryStatus: queryStatus === "failed" ? "failed" : "success",
    sourceRecordCount: counts.source,
    eligibleRecordCount: counts.eligible,
    ineligibleRecordCount: counts.ineligible,
    staleRecordCount: counts.stale,
    candidateIds: candidates.map((candidate) => candidate.candidateId),
    evidenceRefs,
  }]);
  const coverage = coverageManifest.domains[0]!;
  return Object.freeze({
    version: 1 as const,
    canonicalStore: C3_FAILURE_CANONICAL_STORE,
    queryStatus,
    candidates: Object.freeze([...candidates]),
    coverageManifest,
    coverage,
  });
}

/**
 * Read C3 through the existing C2 source-adapter boundary. Currentness is
 * source-owned: unresolved state or an explicit active cycle/obligation
 * binding is required. Age never promotes resolved history.
 */
export function adaptC3Experiences(
  sidecar: DatabaseSync,
  conversationId: string,
  options: C3AdapterOptions = {},
): C3ExperienceAdapterResult {
  if (options.enabled === false) {
    return result("disabled", "DEFERRED", [], {
      source: 0,
      eligible: 0,
      ineligible: 0,
      stale: 0,
    });
  }

  try {
    const cycleIds = sourceConversationIds(sidecar, conversationId);
    const records = listC3TerminalExperiences(sidecar, { limit: 1_000 })
      .filter((record) => cycleIds.has(record.cycleId));
    const validTerminal = records.filter((record) =>
      record.redacted === 0 &&
      record.terminalDisposition === "terminal" &&
      isC3AllowlistedTerminalClass(record.failureClass),
    );
    const eligible = validTerminal
      .filter((record) => isSourceCurrent(record, options))
      .sort((left, right) => right.occurredAtMs - left.occurredAtMs || left.experienceId.localeCompare(right.experienceId));
    const candidates = eligible.slice(0, boundedLimit(options.limit)).map(toCandidate);
    const redactedOrNonTerminal = records.length - validTerminal.length;
    const stale = validTerminal.length - eligible.length;
    const disposition = eligible.length > 0
      ? "INCLUDED" as const
      : records.length === 0
        ? "EMPTY" as const
        : redactedOrNonTerminal === records.length
          ? "INELIGIBLE" as const
          : stale === records.length
            ? "STALE" as const
            : "INELIGIBLE" as const;
    return result("success", disposition, candidates, {
      source: records.length,
      eligible: eligible.length,
      ineligible: redactedOrNonTerminal,
      stale,
    }, candidates.flatMap((candidate) => evidenceRefsFromJson(candidate.rawEvidenceRefsJson)));
  } catch {
    return result("failed", "UNREACHABLE", [], {
      source: 0,
      eligible: 0,
      ineligible: 0,
      stale: 0,
    });
  }
}
