import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Decision, EvidenceRef, Motivation } from "../types.js";
import {
  getAssertion,
  type MemoryAssertion,
} from "./assertions.js";
import {
  assertionCurrentAt,
  influenceEligibleUnderAssertionsAt,
  mindStateItemInfluenceEligibleUnderAssertionsAt,
  sourceCoveredByDenyBarrierUnderAssertions,
} from "./eligibility.js";
import {
  recordMemoryEvidenceLiveShadow,
  type C1EventResult,
  type RecordC1LiveShadowInput,
} from "../rollout/memory-evidence-qualification-epoch.js";

export type C1ShadowSourceType =
  | "fact"
  | "episode"
  | "mind_state"
  | "hot_message";

export type C1ShadowAction =
  | "include_current"
  | "label_historical"
  | "label_corrected"
  | "narrow_to_claims"
  | "deny";

export type C1ShadowReason =
  | "eligible_current"
  | "terminated"
  | "unknown_facet"
  | "i0"
  | "outside_authority_interval"
  | "open_deny_barrier"
  | "open_contradiction"
  | "missing_assertion"
  | "source_missing"
  | "corrected_history"
  | "historical_only";

export type C1ShadowDecisionClass =
  | "no_c1_material"
  | "same_current"
  | "would_relabel"
  | "would_filter"
  | "would_narrow"
  | "mixed_change"
  | "unmapped_fail_closed"
  | "evaluation_error";

export type C1ShadowErrorCode =
  | "candidate_overflow"
  | "receipt_overflow"
  | "database_read_error"
  | "canonicalization_error"
  | "source_key_collision"
  | "invariant_violation";

export type C1ShadowReceiptV1 = {
  schema: "c1-shadow-receipt/v1";
  decisionId: string;
  trigger: "reactive" | "proactive";
  currentnessAuthority: "mem_facts";
  decisionClass: C1ShadowDecisionClass;
  errorCode?: C1ShadowErrorCode;
  qualifies: boolean;
  sourceCount: number;
  countsBySourceType: Record<C1ShadowSourceType, number>;
  countsByAction: Partial<Record<C1ShadowAction, number>>;
  countsByReason: Partial<Record<C1ShadowReason, number>>;
  candidateDigestSha256: string;
  sampledSources: Array<{
    sourceType: C1ShadowSourceType;
    sourceId: string;
    assertionIds: string[];
    correctionIds: string[];
    action: C1ShadowAction;
    reason: C1ShadowReason;
  }>;
  omittedSourceCount: number;
};

export type C1ShadowWitnessInput = {
  ownerId: string;
  decisionId: number;
  trigger: "reactive" | "proactive";
  decision: Pick<Decision, "evidenceRefs" | "motivationIds">;
  /** The motivations selected by the persisted Decision. */
  motivations: readonly Pick<Motivation, "id" | "kind" | "refType" | "refId">[];
  /** Final provider-bound identifiers exposed by the composed turn. */
  turn: {
    facts: ReadonlyArray<{ id: number }>;
    hotMessages: ReadonlyArray<{ id: number }>;
  };
  observedAt: string;
};

export type C1ShadowWitness = C1ShadowReceiptV1 & {
  sourceKey: string;
};

export type C1ShadowWitnessBuildResult = {
  witness: C1ShadowWitness | null;
  diagnostic: C1ShadowErrorCode | null;
};

export type C1ShadowWitnessRecordResult =
  | C1EventResult
  | { recorded: false; reason: "decision_id_required" };

type Row = Record<string, unknown>;

type Candidate = {
  sourceType: C1ShadowSourceType;
  sourceId: string;
  assertionIds: number[];
  correctionIds: number[];
  action: C1ShadowAction;
  reason: C1ShadowReason;
  blocking: boolean;
};

type CandidateRequest = {
  sourceType: C1ShadowSourceType;
  sourceId: number;
  required: boolean;
};

type AssertionAssessment = {
  action: C1ShadowAction;
  reason: C1ShadowReason;
  blocking: boolean;
};

const SOURCE_TYPES: C1ShadowSourceType[] = [
  "fact",
  "episode",
  "mind_state",
  "hot_message",
];
const ACTIONS: C1ShadowAction[] = [
  "include_current",
  "label_historical",
  "label_corrected",
  "narrow_to_claims",
  "deny",
];

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function positiveId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function sourceKey(decisionId: number): string {
  return `c1-shadow:v1:decision:${decisionId}`;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

function correctionIdsForAssertions(
  db: DatabaseSync,
  assertionIds: number[],
): number[] {
  const ids = uniqueNumbers(assertionIds);
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(", ");
  return uniqueNumbers((db.prepare(
    `SELECT DISTINCT correction_id
     FROM memory_correction_targets
     WHERE assertion_id IN (${marks})`,
  ).all(...ids) as Array<{ correction_id?: number }>).map((row) => Number(row.correction_id)));
}

function correctionIdsForMessage(
  db: DatabaseSync,
  ownerId: string,
  messageId: number,
): number[] {
  return uniqueNumbers((db.prepare(
    `SELECT id FROM memory_corrections
     WHERE owner_id = ? AND source_message_id = ?`,
  ).all(ownerId, messageId) as Array<{ id?: number }>).map((row) => Number(row.id)));
}

function barrierCoversAssertion(
  db: DatabaseSync,
  assertionId: number,
  at: string,
): boolean {
  try {
    return db.prepare(
      `SELECT 1 FROM memory_deny_barrier_members
       WHERE assertion_id = ? AND held_from <= ?
         AND (held_to IS NULL OR ? < held_to)
       LIMIT 1`,
    ).get(assertionId, at, at) !== undefined;
  } catch {
    return true;
  }
}

function contradictionOpen(db: DatabaseSync, assertionId: number): boolean {
  try {
    const rows = db.prepare(
      `SELECT kind FROM memory_contradictions
       WHERE status = 'open' AND (left_assertion_id = ? OR right_assertion_id = ?)`,
    ).all(assertionId, assertionId) as Array<{ kind?: string }>;
    return rows.some((row) => row.kind !== "temporal_nonoverlap");
  } catch {
    return true;
  }
}

function assessmentForAssertion(
  db: DatabaseSync,
  assertion: MemoryAssertion,
  sourceType: C1ShadowSourceType,
  sourceId: number,
  at: string,
): AssertionAssessment {
  if (assertion.terminationReason !== null) {
    return {
      action: "label_corrected",
      reason: "corrected_history",
      blocking: false,
    };
  }
  if (assertion.subjectFacet === "unknown") {
    return { action: "deny", reason: "unknown_facet", blocking: true };
  }
  if (assertion.subjectFacet === "ashley_side") {
    return {
      action: "label_historical",
      reason: "historical_only",
      blocking: false,
    };
  }
  if (assertion.influenceClass === "I0") {
    return { action: "deny", reason: "i0", blocking: false };
  }
  if (!assertionCurrentAt(assertion, at)) {
    return {
      action: "label_historical",
      reason: assertion.authorityFrom === null
        ? "historical_only"
        : "outside_authority_interval",
      blocking: false,
    };
  }
  if (assertion.supportState !== "supported") {
    return { action: "deny", reason: "open_contradiction", blocking: false };
  }
  const barrier = sourceType === "fact" || sourceType === "episode"
    ? sourceCoveredByDenyBarrierUnderAssertions(db, sourceType, sourceId, at)
    : barrierCoversAssertion(db, assertion.id, at);
  if (barrier) {
    return { action: "deny", reason: "open_deny_barrier", blocking: false };
  }
  if (contradictionOpen(db, assertion.id)) {
    return { action: "deny", reason: "open_contradiction", blocking: false };
  }
  if (!influenceEligibleUnderAssertionsAt(db, assertion.id, at)) {
    return { action: "deny", reason: "open_contradiction", blocking: false };
  }
  return { action: "include_current", reason: "eligible_current", blocking: false };
}

function reasonPriority(reason: C1ShadowReason): number {
  return [
    "source_missing",
    "missing_assertion",
    "unknown_facet",
    "corrected_history",
    "outside_authority_interval",
    "historical_only",
    "open_deny_barrier",
    "open_contradiction",
    "i0",
    "eligible_current",
  ].indexOf(reason);
}

function chooseReason(assessments: AssertionAssessment[]): C1ShadowReason {
  return [...assessments]
    .map((assessment) => assessment.reason)
    .sort((left, right) => reasonPriority(left) - reasonPriority(right))[0]
    ?? "source_missing";
}

function candidateFromAssertions(
  db: DatabaseSync,
  sourceType: C1ShadowSourceType,
  sourceId: number,
  assertions: MemoryAssertion[],
  correctionIds: number[],
  at: string,
): Candidate {
  if (assertions.length === 0) {
    return {
      sourceType,
      sourceId: String(sourceId),
      assertionIds: [],
      correctionIds: uniqueNumbers(correctionIds),
      action: "deny",
      reason: "missing_assertion",
      blocking: true,
    };
  }
  const assessments = assertions.map((assertion) =>
    assessmentForAssertion(db, assertion, sourceType, sourceId, at));
  const families = new Set(assessments.map((assessment) => {
    if (assessment.action === "include_current") return "current";
    if (assessment.action === "narrow_to_claims") return "narrow";
    if (assessment.action === "deny") return "filter";
    return "relabel";
  }));
  const hasCurrent = assessments.some((assessment) => assessment.action === "include_current");
  const hasDeny = assessments.some((assessment) => assessment.action === "deny");
  const hasCorrected = assessments.some((assessment) => assessment.action === "label_corrected");
  const hasHistorical = assessments.some((assessment) => assessment.action === "label_historical");
  let action: C1ShadowAction;
  if (hasCurrent && (hasDeny || hasCorrected || hasHistorical)) {
    action = "narrow_to_claims";
  } else if (hasCorrected) {
    action = "label_corrected";
  } else if (hasHistorical) {
    action = "label_historical";
  } else if (hasDeny) {
    action = "deny";
  } else {
    action = "include_current";
  }
  if (families.size > 1 && action === "include_current") action = "narrow_to_claims";
  return {
    sourceType,
    sourceId: String(sourceId),
    assertionIds: uniqueNumbers(assertions.map((assertion) => assertion.id)),
    correctionIds: uniqueNumbers(correctionIds),
    action,
    reason: chooseReason(assessments),
    blocking: assessments.some((assessment) => assessment.blocking),
  };
}

function missingCandidate(
  sourceType: C1ShadowSourceType,
  sourceId: number,
  reason: "source_missing" | "missing_assertion" | "unknown_facet" = "source_missing",
): Candidate {
  return {
    sourceType,
    sourceId: String(sourceId),
    assertionIds: [],
    correctionIds: [],
    action: "deny",
    reason,
    blocking: true,
  };
}

function factCandidate(
  db: DatabaseSync,
  ownerId: string,
  request: CandidateRequest,
  at: string,
): Candidate | null {
  const row = db.prepare(
    `SELECT id FROM mem_facts
     WHERE id = ? AND owner_id = ? AND superseded_by IS NULL LIMIT 1`,
  ).get(request.sourceId, ownerId);
  if (!isRow(row)) return request.required
    ? missingCandidate("fact", request.sourceId)
    : null;
  const assertions = db.prepare(
    `SELECT * FROM memory_assertions
     WHERE owner_id = ? AND legacy_fact_id = ? ORDER BY id ASC`,
  ).all(ownerId, request.sourceId)
    .map(getAssertionRow)
    .filter((assertion): assertion is MemoryAssertion => assertion !== null);
  return candidateFromAssertions(
    db,
    "fact",
    request.sourceId,
    assertions,
    correctionIdsForAssertions(db, assertions.map((assertion) => assertion.id)),
    at,
  );
}

function getAssertionRow(value: unknown): MemoryAssertion | null {
  if (!isRow(value)) return null;
  return getAssertionFromRow(value);
}

function getAssertionFromRow(row: Row): MemoryAssertion | null {
  const id = positiveId(row.id);
  if (id === null) return null;
  const assertion = getAssertionFromRecord(row);
  return assertion;
}

function getAssertionFromRecord(row: Row): MemoryAssertion | null {
  const kind = text(row.kind);
  const subjectFacet = text(row.subject_facet);
  const lineageKind = text(row.lineage_kind);
  const derivationKind = text(row.derivation_kind);
  const supportState = text(row.support_state);
  const influenceClass = text(row.influence_class);
  const worldIntervalBasis = text(row.world_interval_basis);
  const authorityBasis = text(row.authority_basis);
  const terminationReason = row.termination_reason == null ? null : text(row.termination_reason);
  if (![
    "keyed_fact", "episode_claim", "owner_interpretation",
  ].includes(kind) || ![
    "owner_model", "external_verifiable", "ashley_side", "unknown",
  ].includes(subjectFacet) || ![
    "unknown", "explicit_seed", "owner_designated", "observed_overlap", "ashley_native",
  ].includes(lineageKind) || !["observed", "derived"].includes(derivationKind) || ![
    "supported", "unsupported", "uncertain",
  ].includes(supportState) || !["I0", "I1", "I2", "I3"].includes(influenceClass) || ![
    "adjudicated", "legacy_unknown",
  ].includes(worldIntervalBasis) || ![
    "adjudicated", "legacy_supersession", "legacy_current",
  ].includes(authorityBasis) || (terminationReason !== null && ![
    "superseded", "invalidated", "forgotten", "scope_refined", "source_disputed",
  ].includes(terminationReason))) return null;
  return {
    id: positiveId(row.id) ?? 0,
    entityUuid: text(row.entity_uuid),
    ownerId: text(row.owner_id),
    kind: kind as MemoryAssertion["kind"],
    subjectFacet: subjectFacet as MemoryAssertion["subjectFacet"],
    lineageKind: lineageKind as MemoryAssertion["lineageKind"],
    derivationKind: derivationKind as MemoryAssertion["derivationKind"],
    supportState: supportState as MemoryAssertion["supportState"],
    influenceClass: influenceClass as MemoryAssertion["influenceClass"],
    category: row.category == null ? null : text(row.category),
    key: row.key == null ? null : text(row.key),
    value: row.value == null ? null : text(row.value),
    claimText: row.claim_text == null ? null : text(row.claim_text),
    sourceKind: text(row.source_kind),
    sourceEntityUuid: row.source_entity_uuid == null ? null : text(row.source_entity_uuid),
    sourceMessageId: row.source_message_id == null ? null : numberValue(row.source_message_id),
    sourceQuote: row.source_quote == null ? null : text(row.source_quote),
    legacyFactId: row.legacy_fact_id == null ? null : numberValue(row.legacy_fact_id),
    legacyEpisodeId: row.legacy_episode_id == null ? null : numberValue(row.legacy_episode_id),
    recordedAt: text(row.recorded_at),
    validFrom: row.valid_from == null ? null : text(row.valid_from),
    validTo: row.valid_to == null ? null : text(row.valid_to),
    worldIntervalBasis: worldIntervalBasis as MemoryAssertion["worldIntervalBasis"],
    authorityFrom: row.authority_from == null ? null : text(row.authority_from),
    authorityTo: row.authority_to == null ? null : text(row.authority_to),
    authorityBasis: authorityBasis as MemoryAssertion["authorityBasis"],
    terminationReason: terminationReason as MemoryAssertion["terminationReason"],
    supersededByAssertionId: row.superseded_by_assertion_id == null
      ? null
      : numberValue(row.superseded_by_assertion_id),
    confidence: numberValue(row.confidence),
    importance: numberValue(row.importance),
    dataClassification: text(row.data_classification) as MemoryAssertion["dataClassification"],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function episodeCandidate(
  db: DatabaseSync,
  ownerId: string,
  request: CandidateRequest,
  at: string,
): Candidate | null {
  const row = db.prepare(
    `SELECT id, provenance FROM episodes
     WHERE id = ? AND owner_id = ? AND status = 'active' LIMIT 1`,
  ).get(request.sourceId, ownerId);
  if (!isRow(row) || text(row.provenance) !== "live") {
    return request.required ? missingCandidate("episode", request.sourceId) : null;
  }
  const claims = db.prepare(
    `SELECT a.*
     FROM memory_episode_claims AS c
     JOIN memory_assertions AS a ON a.id = c.assertion_id
     WHERE c.episode_id = ? AND a.owner_id = ? ORDER BY a.id ASC`,
  ).all(request.sourceId, ownerId)
    .map(getAssertionRow)
    .filter((assertion): assertion is MemoryAssertion => assertion !== null);
  return candidateFromAssertions(
    db,
    "episode",
    request.sourceId,
    claims,
    correctionIdsForAssertions(db, claims.map((claim) => claim.id)),
    at,
  );
}

function messageCandidate(
  db: DatabaseSync,
  ownerId: string,
  request: CandidateRequest,
  at: string,
): Candidate | null {
  const row = db.prepare(
    `SELECT id, redacted_at FROM mem_messages
     WHERE id = ? AND owner_id = ? LIMIT 1`,
  ).get(request.sourceId, ownerId);
  if (!isRow(row) || row.redacted_at != null) {
    return request.required ? missingCandidate("hot_message", request.sourceId) : null;
  }
  const assertions = db.prepare(
    `SELECT * FROM memory_assertions
     WHERE owner_id = ? AND source_message_id = ? ORDER BY id ASC`,
  ).all(ownerId, request.sourceId)
    .map(getAssertionRow)
    .filter((assertion): assertion is MemoryAssertion => assertion !== null);
  if (assertions.length === 0 && !request.required) return null;
  return candidateFromAssertions(
    db,
    "hot_message",
    request.sourceId,
    assertions,
    [
      ...correctionIdsForAssertions(db, assertions.map((assertion) => assertion.id)),
      ...correctionIdsForMessage(db, ownerId, request.sourceId),
    ],
    at,
  );
}

function mindStateCandidate(
  db: DatabaseSync,
  ownerId: string,
  request: CandidateRequest,
  at: string,
): Candidate | null {
  const row = db.prepare(
    `SELECT source_type, source_id FROM mind_state_items
     WHERE id = ? AND owner_id = ? AND status = 'active' LIMIT 1`,
  ).get(request.sourceId, ownerId);
  if (!isRow(row)) return request.required
    ? missingCandidate("mind_state", request.sourceId)
    : null;
  const sourceType = text(row.source_type);
  const sourceId = positiveId(row.source_id);
  if (sourceId === null) return missingCandidate("mind_state", request.sourceId, "unknown_facet");
  const nested: CandidateRequest = { sourceType: "fact", sourceId, required: true };
  if (sourceType === "fact") return remapCandidate(
    factCandidate(db, ownerId, nested, at),
    "mind_state",
    request.sourceId,
  );
  if (sourceType === "episode") return remapCandidate(
    episodeCandidate(db, ownerId, { ...nested, sourceType: "episode" }, at),
    "mind_state",
    request.sourceId,
  );
  if (sourceType === "message" || sourceType === "hot_message") return remapCandidate(
    messageCandidate(db, ownerId, { ...nested, sourceType: "hot_message" }, at),
    "mind_state",
    request.sourceId,
  );
  if (sourceType === "mind_state") {
    const eligible = mindStateItemInfluenceEligibleUnderAssertionsAt(db, ownerId, sourceId, at);
    return eligible
      ? {
          sourceType: "mind_state",
          sourceId: String(request.sourceId),
          assertionIds: [],
          correctionIds: [],
          action: "include_current",
          reason: "eligible_current",
          blocking: false,
        }
      : missingCandidate("mind_state", request.sourceId, "unknown_facet");
  }
  return missingCandidate("mind_state", request.sourceId, "unknown_facet");
}

function remapCandidate(
  candidate: Candidate | null,
  sourceType: C1ShadowSourceType,
  sourceId: number,
): Candidate {
  if (!candidate) return missingCandidate(sourceType, sourceId);
  return { ...candidate, sourceType, sourceId: String(sourceId) };
}

function c1SourceType(refType: string): C1ShadowSourceType | null {
  if (refType === "fact") return "fact";
  if (refType === "episode") return "episode";
  if (refType === "mind_state") return "mind_state";
  if (refType === "message" || refType === "hot_message") return "hot_message";
  return null;
}

function addRequest(
  requests: Map<string, CandidateRequest>,
  sourceType: C1ShadowSourceType,
  value: unknown,
  required: boolean,
): void {
  const sourceId = positiveId(value);
  if (sourceId === null) return;
  const key = `${sourceType}:${sourceId}`;
  const existing = requests.get(key);
  requests.set(key, existing
    ? { ...existing, required: existing.required || required }
    : { sourceType, sourceId, required });
}

function collectRequests(input: C1ShadowWitnessInput): CandidateRequest[] {
  const requests = new Map<string, CandidateRequest>();
  const finalFacts = new Set(input.turn.facts.map((fact) => fact.id));
  const finalHotMessages = new Set(input.turn.hotMessages.map((message) => message.id));
  const userMessageIds = new Set(input.motivations
    .filter((motivation) => motivation.kind === "user_message" && motivation.refType === "message")
    .map((motivation) => positiveId(motivation.refId))
    .filter((id): id is number => id !== null));

  const addRef = (ref: { type: string; id: string | number }, required: boolean) => {
    const sourceType = c1SourceType(ref.type);
    if (!sourceType) return;
    const id = positiveId(ref.id);
    if (id === null) return;
    if (sourceType === "fact" && finalFacts.size > 0 && !finalFacts.has(id)) return;
    if (sourceType === "hot_message" && finalHotMessages.size > 0 && !finalHotMessages.has(id)) {
      if (userMessageIds.has(id)) return;
      return;
    }
    addRequest(requests, sourceType, id, required);
  };

  for (const ref of input.decision.evidenceRefs ?? []) addRef(ref, true);
  const selectedIds = new Set(input.decision.motivationIds ?? []);
  for (const motivation of input.motivations) {
    if (!motivation.id || !selectedIds.has(motivation.id) || !motivation.refType || motivation.refId == null) continue;
    if (motivation.kind === "user_message" && motivation.refType === "message") continue;
    addRef({ type: motivation.refType, id: motivation.refId }, true);
  }
  for (const fact of input.turn.facts) addRequest(requests, "fact", fact.id, false);
  for (const message of input.turn.hotMessages) addRequest(requests, "hot_message", message.id, false);
  return [...requests.values()].sort((left, right) =>
    `${left.sourceType}:${left.sourceId}`.localeCompare(`${right.sourceType}:${right.sourceId}`));
}

function evaluateCandidate(
  db: DatabaseSync,
  ownerId: string,
  request: CandidateRequest,
  at: string,
): Candidate | null {
  switch (request.sourceType) {
    case "fact":
      return factCandidate(db, ownerId, request, at);
    case "episode":
      return episodeCandidate(db, ownerId, request, at);
    case "mind_state":
      return mindStateCandidate(db, ownerId, request, at);
    case "hot_message":
      return messageCandidate(db, ownerId, request, at);
  }
}

function emptyCounts<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function decisionClassFor(candidates: Candidate[]): C1ShadowDecisionClass {
  if (candidates.length === 0) return "no_c1_material";
  if (candidates.some((candidate) => candidate.blocking)) return "unmapped_fail_closed";
  const families = new Set(candidates.map((candidate) => {
    switch (candidate.action) {
      case "include_current": return "current";
      case "narrow_to_claims": return "narrow";
      case "deny": return "filter";
      default: return "relabel";
    }
  }));
  if (families.size > 1) return "mixed_change";
  switch ([...families][0]) {
    case "current": return "same_current";
    case "relabel": return "would_relabel";
    case "filter": return "would_filter";
    case "narrow": return "would_narrow";
    default: return "no_c1_material";
  }
}

function errorReceipt(
  decisionId: number,
  trigger: "reactive" | "proactive",
  errorCode: C1ShadowErrorCode,
): C1ShadowReceiptV1 {
  return {
    schema: "c1-shadow-receipt/v1",
    decisionId: String(decisionId),
    trigger,
    currentnessAuthority: "mem_facts",
    decisionClass: "evaluation_error",
    errorCode,
    qualifies: false,
    sourceCount: 0,
    countsBySourceType: emptyCounts(SOURCE_TYPES),
    countsByAction: {},
    countsByReason: {},
    candidateDigestSha256: digest({ errorCode }),
    sampledSources: [],
    omittedSourceCount: 0,
  };
}

function makeWitness(
  decisionId: number,
  trigger: "reactive" | "proactive",
  receipt: C1ShadowReceiptV1,
): C1ShadowWitness {
  return {
    ...receipt,
    sourceKey: sourceKey(decisionId),
  };
}

function receiptForCandidates(
  decisionId: number,
  trigger: "reactive" | "proactive",
  candidates: Candidate[],
): C1ShadowReceiptV1 {
  const ordered = [...candidates].sort((left, right) => {
    const a = canonical({
      sourceType: left.sourceType,
      sourceId: left.sourceId,
      assertionIds: uniqueNumbers(left.assertionIds),
      correctionIds: uniqueNumbers(left.correctionIds),
      action: left.action,
      reason: left.reason,
    });
    const b = canonical({
      sourceType: right.sourceType,
      sourceId: right.sourceId,
      assertionIds: uniqueNumbers(right.assertionIds),
      correctionIds: uniqueNumbers(right.correctionIds),
      action: right.action,
      reason: right.reason,
    });
    return a.localeCompare(b);
  });
  const decisionClass = decisionClassFor(ordered);
  const qualifies = [
    "same_current", "would_relabel", "would_filter", "would_narrow", "mixed_change",
  ].includes(decisionClass);
  const countsBySourceType = emptyCounts(SOURCE_TYPES);
  const countsByAction: Partial<Record<C1ShadowAction, number>> = {};
  const countsByReason: Partial<Record<C1ShadowReason, number>> = {};
  for (const candidate of ordered) {
    countsBySourceType[candidate.sourceType] += 1;
    countsByAction[candidate.action] = (countsByAction[candidate.action] ?? 0) + 1;
    countsByReason[candidate.reason] = (countsByReason[candidate.reason] ?? 0) + 1;
  }
  const digestCandidates = ordered.map((candidate) => ({
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    assertionIds: uniqueNumbers(candidate.assertionIds).map(String),
    correctionIds: uniqueNumbers(candidate.correctionIds).map(String),
    action: candidate.action,
    reason: candidate.reason,
  }));
  const sampledSources = ordered.slice(0, 12).map((candidate) => ({
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    assertionIds: uniqueNumbers(candidate.assertionIds).slice(0, 8).map(String),
    correctionIds: uniqueNumbers(candidate.correctionIds).slice(0, 8).map(String),
    action: candidate.action,
    reason: candidate.reason,
  }));
  const receipt: C1ShadowReceiptV1 = {
    schema: "c1-shadow-receipt/v1",
    decisionId: String(decisionId),
    trigger,
    currentnessAuthority: "mem_facts",
    decisionClass,
    qualifies,
    sourceCount: ordered.length,
    countsBySourceType,
    countsByAction,
    countsByReason,
    candidateDigestSha256: digest(digestCandidates),
    sampledSources,
    omittedSourceCount: Math.max(0, ordered.length - sampledSources.length),
  };
  if (Buffer.byteLength(canonical(receipt), "utf8") > 4000) {
    return errorReceipt(decisionId, trigger, "receipt_overflow");
  }
  return receipt;
}

export function buildC1ShadowWitness(
  db: DatabaseSync,
  input: C1ShadowWitnessInput,
): C1ShadowWitnessBuildResult {
  const decisionId = positiveId(input.decisionId);
  if (decisionId === null) {
    return { witness: null, diagnostic: "invariant_violation" };
  }
  if (input.trigger !== "reactive" && input.trigger !== "proactive") {
    return {
      witness: makeWitness(decisionId, "reactive", errorReceipt(
        decisionId,
        "reactive",
        "invariant_violation",
      )),
      diagnostic: "invariant_violation",
    };
  }
  const observedAt = input.observedAt;
  try {
    const requests = collectRequests(input);
    if (requests.length > 32) {
      return {
        witness: makeWitness(
          decisionId,
          input.trigger,
          errorReceipt(decisionId, input.trigger, "candidate_overflow"),
        ),
        diagnostic: "candidate_overflow",
      };
    }
    const candidates = requests
      .map((request) => evaluateCandidate(db, input.ownerId, request, observedAt))
      .filter((candidate): candidate is Candidate => candidate !== null);
    const receipt = receiptForCandidates(decisionId, input.trigger, candidates);
    return {
      witness: makeWitness(decisionId, input.trigger, receipt),
      diagnostic: receipt.errorCode ?? null,
    };
  } catch {
    return {
      witness: makeWitness(
        decisionId,
        input.trigger,
        errorReceipt(decisionId, input.trigger, "database_read_error"),
      ),
      diagnostic: "database_read_error",
    };
  }
}

export function recordC1ShadowWitness(
  db: DatabaseSync,
  input: C1ShadowWitnessInput,
  now = new Date(),
): C1ShadowWitnessRecordResult {
  const built = buildC1ShadowWitness(db, input);
  if (!built.witness) return { recorded: false, reason: "decision_id_required" };
  const witnessInput: RecordC1LiveShadowInput = {
    ownerId: input.ownerId,
    sourceKey: built.witness.sourceKey,
    decisionClass: built.witness.decisionClass,
    qualifies: built.witness.qualifies,
    trigger: built.witness.trigger,
    sourceCount: Math.min(32, Math.max(0, built.witness.sourceCount)),
    detail: (() => {
      const { sourceKey: _sourceKey, ...receipt } = built.witness!;
      return receipt;
    })(),
    occurredAt: input.observedAt,
  };
  return recordMemoryEvidenceLiveShadow(db, witnessInput, now);
}
