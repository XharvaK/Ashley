import { thoughtInputContainsSecret } from "../input.js";
import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "../../../model-routing/types.js";
import type {
  RetrievalHit,
  ThoughtInput,
  DeskEntry,
  WorkingContextItem,
} from "../../types.js";
import { MAX_EFFECT_ROUNDS } from "../../types.js";
import { AppError } from "../../../../errors.js";
import {
  computeDispatchMessagesHash,
  computeSemanticProjectionHash,
  attachC2CompatibilityFields,
  attachSourceCurrentness,
  modelVisibleObservation,
  modelVisibleThoughtProjection,
  projectRetrievalHit,
  type CompactRetrievalEvidence,
  type ProjectedThoughtInput,
} from "../projection.js";
import {
  thoughtContractProfile,
  thoughtContractProfileKey,
  thoughtOutputCompatibilityInstruction,
  type ThoughtContractProfile,
} from "../output-contract.js";
import {
  BYTES_PER_TOKEN,
  deriveThoughtBudget,
  MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
  MAX_SUPPORTED_COMPOSITION_BYTES,
  estimateRequestInputBytes,
  estimateRequestTokens,
  type SemanticProjectionEnvelope,
} from "./budget.js";
import {
  allocationTokenComponent,
  boundRequiredSectionData,
  buildAllocationCandidates,
  type AllocationCandidate,
  INNER_LIFE_SECTIONS,
} from "./sections.js";
import type {
  AllocationFailureDiagnostic,
  AllocationDiagnostics,
  AllocationReceipt,
  AllocationTokenBreakdown,
} from "./receipt.js";
import {
  buildAllocationCoverageManifest,
  COVERAGE_DISPOSITIONS,
  type CoverageManifest,
} from "../coverage-manifest.js";
import {
  REQUIRED_INNER_LIFE_SECTION_BYTES,
  REQUIRED_LEARNED_SELF_BYTES,
  REQUIRED_OBSERVATION_COUNT,
  REQUIRED_WC_ITEM_BYTES,
  REQUIRED_WC_PROJECTED_POOL_BYTES,
  inspectRequiredObservation,
  utf8JsonBytes,
} from "./composition-contract.js";
import {
  getAuthoritativeLineageId,
} from "../../../continuity/db.js";
import {
  listPendingOrAppliedTombstones,
  listTombstoneTargets,
} from "../../../continuity/forget-preview.js";
import { recordAllocationReceipt, recordDiagnostic } from "../diagnostics.js";
import { projectInFlightConsequence } from "../consequence-projection.js";
import {
  buildOperationalEffectNamespace,
} from "../../effect/effect-ref.js";
import type {
  C3ExperienceAdapterResult,
  C3ExperienceCandidate,
} from "../c3-adapter.js";
import {
  formatThoughtStructuralCorrectionData,
  formatThoughtStructuralFeedback,
  type StructuralFeedbackInput,
} from "../structural-feedback.js";

const MAX_AVAILABLE_SOCIAL_DESTINATIONS = 8;

export class RequiredOverflowError extends AppError {
  readonly requiredOverflowCount = 1;
  readonly section: string;
  readonly estimatedInputTokens: number;
  readonly semanticBudgetTokens: number;
  readonly failure: AllocationFailureDiagnostic | null;

  constructor(
    message: string,
    details: {
      section?: string;
      estimatedInputTokens?: number;
      semanticBudgetTokens?: number;
      failure?: AllocationFailureDiagnostic;
    } = {},
  ) {
    super("context_allocation_required_overflow", message, 422);
    this.section = details.section ?? "unknown";
    this.estimatedInputTokens = details.estimatedInputTokens ?? 0;
    this.semanticBudgetTokens = details.semanticBudgetTokens ?? 0;
    this.failure = details.failure ?? null;
  }
}

export function thoughtMessagesForProjection(
  projected: ProjectedThoughtInput,
  structuralFeedback?: StructuralFeedbackInput,
  messageMemo?: ThoughtProjectionMessageMemo,
): ChatMessage[] {
  const memo = messageMemo ?? buildThoughtProjectionMessageMemo(structuralFeedback, thoughtContractProfile(projected));
  // E2a conditional guidance: appended only when the projected Thought input
  // truthfully carries a recency omission. Complete-view cycles keep a
  // byte-identical system message. Thought owns all interpretation of the
  // fact; this sentence states the count's meaning and window scope only.
  const recencyOmission = projected.conversationSelection?.recencyOmittedCount ?? 0;
  // E2b conditional guidance: appended only when the FINAL projected Thought
  // input truthfully carries an allocator-stage retrieval omission. Loop
  // tentatives never carry the count (final-only disclosure), so this branch
  // is inert during packing and complete-view finals keep a byte-identical
  // system message. States the count's meaning and allocator-stage scope
  // only; assigns no importance, mandates no speech.
  const retrievalOmission = projected.retrieval.allocatorOmittedCount ?? 0;
  // E2c conditional guidance: appended only when the FINAL projected Thought
  // input truthfully carries an allocator-stage optional Working Context
  // omission. Same final-only inertness as E2b.
  const optionalWcOmission =
    projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0;
  // Ordered append: E2a, then E2b, then E2c. Byte-identical to the previous
  // E2a/E2b branch tree for all pre-E2c combinations; E2c appends last.
  let systemContent = memo.systemContent;
  if (recencyOmission > 0) systemContent += ` ${RECENCY_OMISSION_GUIDANCE}`;
  if (retrievalOmission > 0) systemContent += ` ${ALLOCATOR_OMISSION_GUIDANCE}`;
  if (optionalWcOmission > 0) systemContent += ` ${WC_OPTIONAL_OMISSION_GUIDANCE}`;
  const imageUrls = directVisualImageUrls(projected);
  return [
    {
      role: "system",
      content: systemContent,
    },
    {
      role: "user",
      content: JSON.stringify(modelVisibleThoughtProjection(projected)),
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
    },
    ...(memo.correctionData ? [{ role: "user" as const, content: memo.correctionData }] : []),
  ];
}

/** Extract Host-only direct visual parts without exposing bytes in the JSON projection. */
export function directVisualImageUrls(projected: ProjectedThoughtInput): string[] {
  if (projected.audience !== undefined && projected.audience.kind !== "owner_private") return [];
  const urls: string[] = [];
  for (const observation of projected.observations) {
    if (observation.modality !== "image" || observation.view?.access !== "direct_visual") continue;
    const payload = observation.payload;
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
    const imageDataUri = (payload as Record<string, unknown>).imageDataUri;
    if (typeof imageDataUri !== "string"
      || !/^data:image\/(?:png|jpeg|jpg|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/.test(imageDataUri)) continue;
    urls.push(imageDataUri);
    if (urls.length >= 4) break;
  }
  return urls;
}

export type ThoughtProjectionMessageMemo = Readonly<{
  systemContent: string;
  correctionData: string | null;
}>;

/**
 * E2a factual recency-loss guidance. Emitted conditionally by
 * thoughtMessagesForProjection only when the projected input carries
 * conversationSelection.recencyOmittedCount > 0. States the count's meaning
 * and source-window scope; assigns no importance, mandates no speech, and
 * makes no claim about evidence beyond the Host's bounded source read.
 */
export const RECENCY_OMISSION_GUIDANCE =
  "When conversationSelection.recencyOmittedCount is present, it is the number of audience-eligible current-version conversation rows omitted by the ordinary recency window within the Host's bounded source read; do not infer the omitted content or treat the count as exhaustive beyond that source window.";

/**
 * E2b factual allocator-loss guidance. Emitted conditionally by
 * thoughtMessagesForProjection only when the FINAL projected input carries
 * retrieval.allocatorOmittedCount > 0. States the count's meaning and
 * allocator-stage scope; assigns no importance, mandates no speech, and
 * reveals and licenses nothing about the omitted evidence.
 */
export const ALLOCATOR_OMISSION_GUIDANCE =
  "retrieval.allocatorOmittedCount counts allocator-eligible retrieval hits omitted by the Thought semantic budget. It excludes pre-allocator loss and reveals and licenses nothing.";

/**
 * E2c factual optional-WC-loss guidance. Emitted conditionally by
 * thoughtMessagesForProjection only when the FINAL projected input carries
 * workingContextSelection.optionalAllocatorOmittedCount > 0. States the
 * count's meaning and allocator-stage scope; assigns no importance, mandates
 * no speech, and reveals and licenses nothing about the omitted items.
 */
export const WC_OPTIONAL_OMISSION_GUIDANCE =
  "workingContextSelection.optionalAllocatorOmittedCount counts allocator-eligible optional Working Context items omitted by allocator bounds. Required Working Context items are excluded from this count, and the count reveals and licenses no omitted content.";

function buildThoughtProjectionMessageMemo(
  structuralFeedback: StructuralFeedbackInput | undefined,
  profile: ThoughtContractProfile,
): ThoughtProjectionMessageMemo {
  const feedback = formatThoughtStructuralFeedback(structuralFeedback);
  const correctionData = formatThoughtStructuralCorrectionData(structuralFeedback);
  return {
    systemContent: [
      "You are Ashley's Thought layer.",
      "Return exactly one JSON semantic Thought output.",
      thoughtOutputCompatibilityInstruction(profile),
      "Code validates identity, authority, speech licensing, and publication.",
      "Do not return finalLicensedText, settlementId, delivery, outbox, reservation, or workspace state.",
      ...(feedback ? [feedback] : []),
    ].join(" "),
    correctionData,
  };
}

export type AllocateThoughtProjectionOptions = {
  sidecar?: DatabaseSync;
  /** Authoritative continuity sidecar used by the live allocation path. */
  continuityDb?: DatabaseSync;
  thoughtInput: ThoughtInput;
  semanticProjectionEnvelope?: SemanticProjectionEnvelope;
  /** Short alias for callers that already hold the named envelope. */
  semanticEnvelope?: SemanticProjectionEnvelope;
  /** Qualification/test shorthand for a logical input ceiling. */
  semanticBudgetTokens?: number;
  /** @deprecated Provider capacity is owned by Attention. */
  quotaBucket?: string;
  maxOutputTokens?: number;
  requestId: string;
  structuralFeedback?: StructuralFeedbackInput;
  observabilityDb?: DatabaseSync;
};

export type AllocatedThoughtProjection = {
  messages: ChatMessage[];
  projected: ProjectedThoughtInput & {
    c3Experiences?: {
      version: 1;
      candidates: readonly C3ExperienceCandidate[];
    };
  };
  provenance: Map<string, RetrievalHit>;
  receipt: AllocationReceipt;
  hashes: {
    semanticProjectionHash: string;
    dispatchMessagesHash: string;
  };
};

function mergeCoverageManifests(
  base: CoverageManifest,
  additional: CoverageManifest | undefined,
): CoverageManifest {
  if (!additional) return base;
  const domains = Object.freeze([...base.domains, ...additional.domains]);
  const dispositionCounts = Object.fromEntries(
    COVERAGE_DISPOSITIONS.map((disposition) => [disposition, 0]),
  ) as Record<(typeof COVERAGE_DISPOSITIONS)[number], number>;
  for (const domain of domains) dispositionCounts[domain.disposition] += 1;
  return Object.freeze({
    version: 1 as const,
    domains,
    entries: domains,
    dispositionCounts: Object.freeze(dispositionCounts),
  });
}

function continuityContextFor(db: DatabaseSync) {
  const authoritativeLineageId = getAuthoritativeLineageId(db);
  const tombstoneTargets = listPendingOrAppliedTombstones(db, authoritativeLineageId)
    .flatMap((tombstone) => listTombstoneTargets(db, tombstone.tombstoneId));
  return { authoritativeLineageId, tombstoneTargets } as const;
}

export function allocateThoughtProjection(
  opts: AllocateThoughtProjectionOptions,
): AllocatedThoughtProjection {
  const allocationStartedAtMs = Date.now();
  const input = opts.thoughtInput;
  const budget = deriveThoughtBudget({
    quotaBucket: opts.quotaBucket,
    maxOutputTokens: opts.maxOutputTokens,
    semanticProjectionEnvelope: opts.semanticProjectionEnvelope,
    semanticEnvelope: opts.semanticEnvelope,
    semanticBudgetTokens: opts.semanticBudgetTokens,
  });

  const trigger = input.trigger as { kind?: unknown; ref?: unknown } | null | undefined;
  if (trigger === null || trigger === undefined || typeof trigger.ref !== "string" || trigger.ref.trim() === "") {
    throw new RequiredOverflowError(
      "Required trigger evidence is missing",
      {
        section: "trigger_evidence",
        estimatedInputTokens: 0,
        failure: {
          kind: "structural_safety",
          constraint: "required_trigger_present",
          measuredValue: 0,
          unit: "items",
          limit: 1,
          stage: "required_set_validation",
          measurementBasis: "exact",
        },
      },
    );
  }
  const rawObservations: unknown = (input as { observations?: unknown }).observations;
  if (rawObservations !== undefined && !Array.isArray(rawObservations)) {
    throw new RequiredOverflowError(
      "Required observations must be supplied as an array",
      {
        section: "observations",
        failure: {
          kind: "structural_safety",
          constraint: "required_observation_collection_shape",
          measuredValue: 1,
          unit: "items",
          limit: 0,
          stage: "required_set_validation",
          measurementBasis: "exact",
        },
      },
    );
  }
  const inputObservations = rawObservations === undefined
    ? []
    : rawObservations as NonNullable<ThoughtInput["observations"]>;
  if (inputObservations.length > REQUIRED_OBSERVATION_COUNT) {
    throw new RequiredOverflowError(
      `Required observation count exceeds the supported count (count: ${inputObservations.length}, limit: ${REQUIRED_OBSERVATION_COUNT})`,
      {
        section: "observations",
        failure: {
          kind: "evidence_count_limit",
          constraint: "required_observation_count",
          measuredValue: inputObservations.length,
          unit: "items",
          limit: REQUIRED_OBSERVATION_COUNT,
          stage: "required_set_validation",
          measurementBasis: "exact",
        },
      },
    );
  }
  for (const observation of inputObservations) {
    if (typeof observation !== "object" || observation === null || Array.isArray(observation)) {
      throw new RequiredOverflowError(
        "A required observation must have an object root",
        {
          section: "observations",
          failure: {
            kind: "structural_safety",
            constraint: "observation_root_shape",
            measuredValue: 1,
            unit: "nodes",
            limit: 1,
            stage: "observation_validation",
            measurementBasis: "exact",
          },
        },
      );
    }
    const inspection = inspectRequiredObservation(observation);
    if (!inspection.ok) {
      const { failure } = inspection;
      const measurement = failure.measurementBasis === "lower_bound" ? "at least " : "";
      throw new RequiredOverflowError(
        `Required observation failed ${failure.constraint} (measured ${measurement}${failure.measuredValue} ${failure.unit}, limit ${failure.limit} ${failure.unit}, stage ${failure.stage})`,
        { section: "observations", failure },
      );
    }
  }
  const requiredSectionBounds = boundRequiredSectionData(input);
  if (requiredSectionBounds.learnedSelfSlice === null) {
    const learnedSelfBytes = utf8JsonBytes(input.learnedSelfSlice ?? null);
    throw new RequiredOverflowError(
      `Required learned-self slice exceeds the local byte bound (bytes: ${learnedSelfBytes}, limit: ${REQUIRED_LEARNED_SELF_BYTES})`,
      {
        section: "learned_self",
        failure: {
          kind: "required_set_packing",
          constraint: "required_learned_self_byte_bound",
          measuredValue: learnedSelfBytes,
          unit: "bytes",
          limit: REQUIRED_LEARNED_SELF_BYTES,
          stage: "required_set_validation",
          measurementBasis: "exact",
        },
      },
    );
  }
  for (const entry of INNER_LIFE_SECTIONS) {
    const value = (input as ThoughtInput & Record<string, unknown>)[entry.field];
    if (value === undefined) continue;
    const bytes = utf8JsonBytes(value);
    if (bytes > REQUIRED_INNER_LIFE_SECTION_BYTES) {
      throw new RequiredOverflowError(
        `Required ${entry.section} section exceeds the local byte bound (bytes: ${bytes}, limit: ${REQUIRED_INNER_LIFE_SECTION_BYTES})`,
        {
          section: entry.section,
          failure: {
            kind: "required_set_packing",
            constraint: "required_inner_life_byte_bound",
            measuredValue: bytes,
            unit: "bytes",
            limit: REQUIRED_INNER_LIFE_SECTION_BYTES,
            stage: "required_set_validation",
            measurementBasis: "exact",
          },
        },
      );
    }
  }
  const boundedLearnedSelfSlice = requiredSectionBounds.learnedSelfSlice;
  const canonicalObservations = requiredSectionBounds.observations.map(modelVisibleObservation);
  for (const observation of canonicalObservations) {
    const inspection = inspectRequiredObservation(observation);
    if (!inspection.ok) {
      const { failure } = inspection;
      throw new RequiredOverflowError(
        `Canonical required observation failed ${failure.constraint} (measured ${failure.measuredValue} ${failure.unit}, limit ${failure.limit} ${failure.unit}, stage ${failure.stage})`,
        { section: "observations", failure },
      );
    }
    if (inspection.serializedBytes > MAX_LOGICAL_SERIALIZED_INPUT_BYTES) {
      const failure: AllocationFailureDiagnostic = {
        kind: "serialized_request_bytes",
        constraint: "logical_input_byte_envelope",
        measuredValue: inspection.serializedBytes,
        unit: "bytes",
        limit: MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
        stage: "observation_validation",
        measurementBasis: "exact",
      };
      throw new RequiredOverflowError(
        `Canonical required observation exceeds the whole-request byte envelope (bytes: ${inspection.serializedBytes}, limit: ${MAX_LOGICAL_SERIALIZED_INPUT_BYTES}, stage: observation_validation)`,
        { section: "observations", failure },
      );
    }
  }
  const boundedRequiredSectionData = Object.freeze({
    ...requiredSectionBounds,
    observations: canonicalObservations,
  });

  // Prepare full provenance and compact retrieval hits
  const provenance = new Map<string, RetrievalHit>();
  const compactRetrievalHits: CompactRetrievalEvidence[] = [];

  for (const hit of input.retrieval.hits) {
    provenance.set(hit.ref, hit);
    compactRetrievalHits.push(projectRetrievalHit(hit));
  }

  const continuityContext = opts.continuityDb ? continuityContextFor(opts.continuityDb) : undefined;
  const allCandidates = buildAllocationCandidates(
    input,
    compactRetrievalHits,
    continuityContext,
    boundedRequiredSectionData,
  );
  const excludedCandidates = allCandidates.filter((candidate) =>
    candidate.continuityCandidate?.invalidationReason !== undefined,
  );
  const eligibleCandidates = allCandidates.filter((candidate) =>
    candidate.continuityCandidate?.invalidationReason === undefined,
  );
  // E2b: freeze the post-authoritative-invalidation allocator-eligible
  // retrieval denominator BEFORE packing. Tombstoned/redacted candidates are
  // in excludedCandidates by construction and contribute zero. This scalar is
  // read only by the FINAL render (final-only disclosure); the packing loop
  // never sees E2b metadata, so candidate decisions stay HEAD-equivalent.
  const allocatorEligibleRetrievalCount = eligibleCandidates.filter((candidate) =>
    candidate.section === "retrieval_compact",
  ).length;
  // E2c: freeze the post-authoritative-invalidation allocator-eligible
  // OPTIONAL Working Context denominator BEFORE packing. Required Working
  // Context sections and desk_entry are excluded by namespace; tombstoned /
  // redacted candidates are in excludedCandidates by construction and
  // contribute zero. Read only by the FINAL render (final-only disclosure).
  const allocatorEligibleOptionalWcCount = eligibleCandidates.filter((candidate) =>
    candidate.section === "working_context_topic" ||
    candidate.section === "working_context_other",
  ).length;
  // Pack mandatory sections before budget-sensitive context. This preserves
  // the existing candidate ownership while preventing optional history from
  // consuming space needed by a later mandatory section.
  const requiredWorkingContext = eligibleCandidates.filter((candidate) =>
    candidate.section.startsWith("working_context") && candidate.required,
  );
  const requiredWorkingContextBytes = requiredWorkingContext.reduce(
    (total, candidate) => total + utf8JsonBytes(candidate.data),
    0,
  );
  const oversizedRequiredWorkingContext = requiredWorkingContext.find((candidate) =>
    utf8JsonBytes(candidate.data) > REQUIRED_WC_ITEM_BYTES,
  );
  if (
    oversizedRequiredWorkingContext ||
    requiredWorkingContextBytes > REQUIRED_WC_PROJECTED_POOL_BYTES
  ) {
    const offendingBytes = oversizedRequiredWorkingContext
      ? utf8JsonBytes(oversizedRequiredWorkingContext.data)
      : requiredWorkingContextBytes;
    throw new RequiredOverflowError(
      `Required Working Context exceeds the bounded projected pool (bytes: ${offendingBytes}, itemLimit: ${REQUIRED_WC_ITEM_BYTES}, poolLimit: ${REQUIRED_WC_PROJECTED_POOL_BYTES})`,
      {
        section: "working_context_pool",
        failure: {
          kind: "required_set_packing",
          constraint: oversizedRequiredWorkingContext
            ? "required_working_context_item_byte_bound"
            : "required_working_context_pool_byte_bound",
          measuredValue: offendingBytes,
          unit: "bytes",
          limit: oversizedRequiredWorkingContext
            ? REQUIRED_WC_ITEM_BYTES
            : REQUIRED_WC_PROJECTED_POOL_BYTES,
          stage: "required_set_validation",
          measurementBasis: "exact",
        },
      },
    );
  }
  const candidates = [
    ...eligibleCandidates.filter((candidate) => candidate.required),
    ...eligibleCandidates.filter((candidate) => !candidate.required),
  ];

  const includedCandidates: AllocationCandidate[] = [];
  const omittedCandidates: AllocationReceipt["decision"]["omitted"] = [];
  const omittedCandidateData: AllocationCandidate[] = [];
  const conversationIncluded: ThoughtInput["rawConversation"] = [];
  const conversationOmittedIds = new Set(input.conversationSelection?.omittedEvidenceIds ?? []);
  const workingContextIncluded: WorkingContextItem[] = [];
  const deskEntriesIncluded: DeskEntry[] = [];
  const retrievalHitsIncluded: CompactRetrievalEvidence[] = [];
  let observationsIncluded = boundedRequiredSectionData.observations.length === 0;
  let orientationKernelIncluded = false;
  let domainPointersIncluded = false;
  let c3ExperiencesIncluded = false;
  let compression = false;

  const c2Input = input as ThoughtInput & {
    orientationKernel?: ProjectedThoughtInput["orientationKernel"];
    domainPointers?: ProjectedThoughtInput["domainPointers"];
    c3Experiences?: C3ExperienceAdapterResult;
    conversationSelection?: ThoughtInput["conversationSelection"];
  };
  const contractProfile = thoughtContractProfile(input);
  const messageMemo = buildThoughtProjectionMessageMemo(opts.structuralFeedback, contractProfile);
  const projectedInFlight = boundedRequiredSectionData.inFlight.map((item) =>
    projectInFlightConsequence(item, input.cycleId, input.generation, input.audience));
  const operationalNamespace = buildOperationalEffectNamespace(
    input.cycleId,
    input.generation,
    boundedRequiredSectionData.inFlight.map((item) => item.effectId),
  );

  const structuralTokens = (value: unknown): number => {
    const serialized = typeof value === "string" ? value : JSON.stringify(value ?? null);
    return Math.ceil(Buffer.byteLength(serialized, "utf8") / BYTES_PER_TOKEN);
  };
  let renderTentativeCallCount = 0;
  let thoughtMessagesForProjectionCallCount = 0;

  function orderedConversation(rows: ThoughtInput["rawConversation"]): ThoughtInput["rawConversation"] {
    return [...rows].sort((left, right) =>
      left.createdAtMs - right.createdAtMs || left.rowId.localeCompare(right.rowId),
    );
  }

  function renderTentative(
    wc: WorkingContextItem[],
    deskEntries: DeskEntry[],
    retrieval: CompactRetrievalEvidence[],
    conversation: ThoughtInput["rawConversation"],
    includeOrientationKernel = orientationKernelIncluded,
    includeDomainPointers = domainPointersIncluded,
    includeC3Experiences = c3ExperiencesIncluded,
    // E2b final-only disclosure: loop tentatives call WITHOUT this flag and
    // stay HEAD-identical (recomputed miss, no count). Only the FINAL render
    // passes finalizeDisclosure, repairing source miss truth and emitting the
    // exact allocator-stage omission count. No speculative disclosure exists.
    finalizeDisclosure = false,
    includeObservations = observationsIncluded,
  ): ProjectedThoughtInput & {
    c3Experiences?: {
      version: 1;
      candidates: readonly C3ExperienceCandidate[];
    };
  } {
    renderTentativeCallCount += 1;
    // MISS_TENTATIVE_POLICY = FINAL_PROJECTION_ONLY: tentatives retain the
    // HEAD transient recomputation so packing decisions stay byte-identical;
    // the final render preserves source retrieval truth (total allocator
    // omission is not a retrieval miss).
    const isMiss = finalizeDisclosure
      ? input.retrieval.miss
      : input.retrieval.state === "ready" && retrieval.length === 0;
    // E2b final-only omission count: frozen post-invalidation eligible total
    // minus FINAL included hits. Computed only under finalizeDisclosure, so
    // anticipated (not-yet-omitted) loss never enters candidate estimation.
    const finalRetrievalOmittedCount = finalizeDisclosure
      ? allocatorEligibleRetrievalCount - retrieval.length
      : 0;
    // E2c final-only omission count: frozen post-invalidation eligible
    // OPTIONAL WC total minus FINAL included optional WC items. Same
    // section namespace on both sides (no subtype predicate); fuse and
    // budget omissions both fail to reach inclusion, so both are counted.
    const finalIncludedOptionalWcCount = finalizeDisclosure
      ? includedCandidates.filter((candidate) =>
          candidate.section === "working_context_topic" ||
          candidate.section === "working_context_other",
        ).length
      : 0;
    const finalOptionalWcOmittedCount = finalizeDisclosure
      ? allocatorEligibleOptionalWcCount - finalIncludedOptionalWcCount
      : 0;
    const hasConversationSelection =
      c2Input.conversationSelection !== undefined || conversationOmittedIds.size > 0;
    const projected = {
      ...(includeOrientationKernel && c2Input.orientationKernel !== undefined
        ? { orientationKernel: c2Input.orientationKernel }
        : {}),
      learnedSelfSlice: boundedLearnedSelfSlice,
      occupantId: input.occupantId,
      authorityEpoch: input.authorityEpoch,
      constitution: input.constitution,
      capabilityReality: input.capabilityReality,
      ...(input.publicPresence === undefined ? {} : { publicPresence: input.publicPresence }),
      ...(input.availableDestinations === undefined ? {} : {
        availableDestinations: [...input.availableDestinations].slice(0, MAX_AVAILABLE_SOCIAL_DESTINATIONS),
      }),
      workingContext: wc,
      // E2c: allocator-stage optional-WC loss honesty. Present only when
      // > 0; absence means no KNOWN allocator-stage optional omission.
      // Counts post-invalidation eligible topic/other items actually
      // omitted by fuse or budget — never required WC, never desk,
      // never invalidated rows, never refs or subtype breakdowns.
      ...(finalOptionalWcOmittedCount > 0
        ? {
            workingContextSelection: {
              optionalAllocatorOmittedCount: finalOptionalWcOmittedCount,
            },
          }
        : {}),
      ...(input.deskEntries === undefined ? {} : { deskEntries }),
      occupancy: boundedRequiredSectionData.occupancy,
      ...(includeDomainPointers && c2Input.domainPointers !== undefined
        ? { domainPointers: c2Input.domainPointers }
        : {}),
      rawConversation: orderedConversation(conversation),
      retrieval: {
        request: input.retrieval.request,
        hits: retrieval,
        state: input.retrieval.state,
        miss: isMiss,
        // E2b: allocator-stage loss honesty. Present only when > 0; absence
        // means no KNOWN allocator-stage retrieval omission. Counts only
        // post-invalidation eligible candidates actually omitted by budget —
        // never pre-allocator loss, never invalidated rows, never refs.
        ...(finalRetrievalOmittedCount > 0
          ? { allocatorOmittedCount: finalRetrievalOmittedCount }
          : {}),
      },
      cycleId: input.cycleId,
      generation: input.generation,
      trigger: input.trigger,
      ...(input.commitmentDue === undefined ? {} : { commitmentDue: input.commitmentDue }),
      ...(input.wakeCauses === undefined ? {} : { wakeCauses: [...input.wakeCauses] }),
      ...(input.previousInvocationDelta === undefined ? {} : { previousInvocationDelta: input.previousInvocationDelta }),
      ...(input.thoughtLegDeadlineAtMs === undefined ? {} : { thoughtLegDeadlineAtMs: input.thoughtLegDeadlineAtMs }),
      ...(input.clock === undefined ? {} : { clock: input.clock }),
      ...(input.coreProfile === undefined ? {} : { coreProfile: input.coreProfile }),
      ...(input.threadStory === undefined ? {} : { threadStory: input.threadStory }),
      ...(input.episodes === undefined ? {} : { episodes: input.episodes }),
      ...(input.activityJournal === undefined ? {} : { activityJournal: input.activityJournal }),
      ...(input.growth === undefined ? {} : { growth: input.growth }),
      ...(input.innerPass === undefined ? {} : { innerPass: input.innerPass }),
      ...(input.pendingForget === undefined ? {} : { pendingForget: input.pendingForget }),
      observations: includeObservations ? boundedRequiredSectionData.observations : [],
      inFlight: projectedInFlight,
      allowedOperationalEffectRefs: [...operationalNamespace.allowedOperationalEffectRefs],
      authorityObjections: input.authorityObjections,
      runtimeCondition: {
        ...input.runtimeCondition,
        compression: compression || input.runtimeCondition.compression,
      },
      rememberDirective: input.rememberDirective,
      effectBudget: input.effectBudget ?? {
        maxEffectRounds: MAX_EFFECT_ROUNDS,
        usedEffectRounds: 0,
        remainingEffectRounds: MAX_EFFECT_ROUNDS,
      },
      ...(input.settlementOnly === undefined ? {} : { settlementOnly: input.settlementOnly }),
      ...(hasConversationSelection
        ? {
            conversationSelection: {
              frontierIncludedIds: [...(c2Input.conversationSelection?.frontierIncludedIds ?? [])],
              omittedEvidenceIds: [...conversationOmittedIds],
              ...(c2Input.conversationSelection?.currentTriggerRowId === undefined
                ? {}
                : { currentTriggerRowId: c2Input.conversationSelection.currentTriggerRowId }),
              // E2a: pre-allocation recency loss, carried unchanged. Never
              // merged with budget-stage omittedEvidenceIds and never
              // mutated by allocator budgeting.
              ...(c2Input.conversationSelection?.recencyOmittedCount === undefined
                ? {}
                : { recencyOmittedCount: c2Input.conversationSelection.recencyOmittedCount }),
            },
          }
        : {}),
      ...(includeC3Experiences && c2Input.c3Experiences !== undefined
        ? {
            c3Experiences: {
              version: 1 as const,
              candidates: c2Input.c3Experiences.candidates,
            },
          }
        : {}),
    };

    if (input.audience !== undefined) {
      Object.defineProperty(projected, "audience", {
        value: input.audience,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }

    if (input.concernSnapshots !== undefined) {
      Object.defineProperty(projected, "concernSnapshots", {
        value: input.concernSnapshots,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }

    attachSourceCurrentness(projected, input.sourceCurrentness);

    if (includeOrientationKernel && c2Input.orientationKernel !== undefined) {
      attachC2CompatibilityFields(projected, input);
    }
    return projected;
  }

  // Exact serialize-then-estimate candidate inclusion loop
  for (const candidate of candidates) {
    if (
      (candidate.section.startsWith("working_context") || candidate.section === "desk_entry") &&
      !candidate.required &&
      utf8JsonBytes(candidate.data) > REQUIRED_WC_ITEM_BYTES
    ) {
      compression = true;
      omittedCandidateData.push(candidate);
      omittedCandidates.push({
        id: candidate.id,
        section: candidate.section,
        ref: candidate.ref,
        required: candidate.required,
        priority: candidate.priority,
        estimatedTokens: structuralTokens(candidate.data),
        reason: "fuse",
        requiredness: candidate.requiredness,
      });
      continue;
    }
    let tentativeWc = workingContextIncluded;
    let tentativeDeskEntries = deskEntriesIncluded;
    let tentativeRetrieval = retrievalHitsIncluded;
    let tentativeConversation = conversationIncluded;
    let tentativeObservationsIncluded = observationsIncluded;
    let tentativeOrientationKernel = orientationKernelIncluded;
    let tentativeDomainPointers = domainPointersIncluded;
    let tentativeC3Experiences = c3ExperiencesIncluded;

    if (candidate.section === "recent_raw") {
      tentativeConversation = [...conversationIncluded, candidate.data as ThoughtInput["rawConversation"][number]];
    } else if (candidate.section.startsWith("working_context")) {
      tentativeWc = [...workingContextIncluded, candidate.data as WorkingContextItem];
    } else if (candidate.section === "desk_entry") {
      tentativeDeskEntries = [...deskEntriesIncluded, candidate.data as DeskEntry];
    } else if (candidate.section === "retrieval_compact") {
      tentativeRetrieval = [...retrievalHitsIncluded, candidate.data as CompactRetrievalEvidence];
    } else if (candidate.section === "observations") {
      tentativeObservationsIncluded = true;
    } else if (candidate.section === "orientation_kernel") {
      tentativeOrientationKernel = true;
    } else if (candidate.section === "domain_pointers") {
      tentativeDomainPointers = true;
    } else if (candidate.section === "c3_terminal_experiences") {
      tentativeC3Experiences = true;
    }

    const tentativeProjected = renderTentative(
      tentativeWc,
      tentativeDeskEntries,
      tentativeRetrieval,
      tentativeConversation,
      tentativeOrientationKernel,
      tentativeDomainPointers,
      tentativeC3Experiences,
      false,
      tentativeObservationsIncluded,
    );
    thoughtMessagesForProjectionCallCount += 1;
    const tentativeMessages = thoughtMessagesForProjection(
      tentativeProjected,
      undefined,
      messageMemo,
    );

    const estimate = estimateRequestTokens(tentativeMessages, {
      maxTokens: budget.maxOutputTokens,
    });
    const totalDemand = estimate.estimatedInputTokens + estimate.estimatedOutputTokens;
    const tentativeInputBytes = estimateRequestInputBytes(tentativeMessages);
    const exceedsSerializedByteEnvelope = tentativeInputBytes > MAX_LOGICAL_SERIALIZED_INPUT_BYTES;

    if (
      estimate.estimatedInputTokens <= budget.semanticBudgetTokens
      && !exceedsSerializedByteEnvelope
    ) {
      // Accepted!
      includedCandidates.push(candidate);
      if (candidate.section === "recent_raw") {
        conversationIncluded.push(candidate.data as ThoughtInput["rawConversation"][number]);
      } else if (candidate.section.startsWith("working_context")) {
        workingContextIncluded.push(candidate.data as WorkingContextItem);
      } else if (candidate.section === "desk_entry") {
        deskEntriesIncluded.push(candidate.data as DeskEntry);
      } else if (candidate.section === "retrieval_compact") {
        retrievalHitsIncluded.push(candidate.data as CompactRetrievalEvidence);
      } else if (candidate.section === "observations") {
        observationsIncluded = true;
      } else if (candidate.section === "orientation_kernel") {
        orientationKernelIncluded = true;
      } else if (candidate.section === "domain_pointers") {
        domainPointersIncluded = true;
      } else if (candidate.section === "c3_terminal_experiences") {
        c3ExperiencesIncluded = true;
      }
    } else {
      // Exceeds TPM budget
      if (candidate.required) {
        if (exceedsSerializedByteEnvelope) {
          const failure: AllocationFailureDiagnostic = {
            kind: "serialized_request_bytes",
            constraint: "logical_input_byte_envelope",
            measuredValue: tentativeInputBytes,
            unit: "bytes",
            limit: MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
            stage: "global_allocation",
            measurementBasis: "exact",
          };
          throw new RequiredOverflowError(
            `Required section '${candidate.section}' exceeds the whole-request byte envelope (bytes: ${tentativeInputBytes}, limit: ${MAX_LOGICAL_SERIALIZED_INPUT_BYTES})`,
            { section: candidate.section, failure },
          );
        }
        const failure: AllocationFailureDiagnostic = {
          kind: "required_set_packing",
          constraint: "semantic_token_budget",
          measuredValue: estimate.estimatedInputTokens,
          unit: "tokens",
          limit: budget.semanticBudgetTokens,
          stage: "global_allocation",
          measurementBasis: "exact",
          ...(candidate.section === "observations"
            ? { fallback: "retained_detail_access_unavailable" as const }
            : {}),
        };
        throw new RequiredOverflowError(
          `Required section '${candidate.section}' cannot be packed within the semantic input budget (input: ${estimate.estimatedInputTokens} tokens, limit: ${budget.semanticBudgetTokens} tokens)`,
          {
            section: candidate.section,
            estimatedInputTokens: estimate.estimatedInputTokens,
            semanticBudgetTokens: budget.semanticBudgetTokens,
            failure,
          },
        );
      }
      // Omit optional candidate
      compression = true;
      omittedCandidateData.push(candidate);
      if (candidate.section === "recent_raw" && candidate.ref) {
        conversationOmittedIds.add(candidate.ref);
      }
      omittedCandidates.push({
        id: candidate.id,
        section: candidate.section,
        ref: candidate.ref,
        required: candidate.required,
        priority: candidate.priority,
        estimatedTokens: structuralTokens(candidate.data),
        reason: "budget_omission",
        requiredness: candidate.requiredness,
      });
    }
  }

  // E2b final-only disclosure: the packing loop above ran HEAD-identical
  // tentatives (no count, no guidance, transient miss). Only this FINAL render
  // repairs source miss truth and emits the exact allocator-stage omission
  // count from the frozen post-invalidation denominator and FINAL inclusions.
  const renderFinal = () => {
    const projected = renderTentative(
      workingContextIncluded,
      deskEntriesIncluded,
      retrievalHitsIncluded,
      conversationIncluded,
      orientationKernelIncluded,
      domainPointersIncluded,
      c3ExperiencesIncluded,
      true,
      observationsIncluded,
    );
    thoughtMessagesForProjectionCallCount += 1;
    const messages = thoughtMessagesForProjection(projected, undefined, messageMemo);
    const estimate = estimateRequestTokens(messages, { maxTokens: budget.maxOutputTokens });
    return { projected, messages, estimate };
  };
  const disclosesLoss = (projected: ReturnType<typeof renderTentative>): boolean =>
    (projected.retrieval.allocatorOmittedCount ?? 0) > 0
    || (projected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0) > 0;
  const unfitted = renderFinal();
  let final = unfitted;
  // Disclosure fit: tentatives are packed without the loss disclosure, which
  // only the final render carries, so a pack that lands just under the
  // envelope can overshoot once the disclosure is added. Make room by
  // evicting the lowest-priority optional inclusions (the last accepted)
  // and re-rendering; the disclosed counts are recomputed from the final
  // inclusions, so they stay exact. Required sections are never evicted.
  // All or nothing: if no eviction makes the disclosure fit, every eviction
  // is undone and the gate below fails closed on the original allocation.
  const snapshot = {
    included: [...includedCandidates],
    conversation: [...conversationIncluded],
    conversationOmitted: new Set(conversationOmittedIds),
    workingContext: [...workingContextIncluded],
    deskEntries: [...deskEntriesIncluded],
    retrieval: [...retrievalHitsIncluded],
    flags: { observationsIncluded, orientationKernelIncluded, domainPointersIncluded, c3ExperiencesIncluded, compression },
    omitted: omittedCandidates.length,
    omittedData: omittedCandidateData.length,
  };
  const replace = <T>(items: T[], next: readonly T[]): void => {
    items.splice(0, items.length, ...next);
  };
  while (disclosesLoss(final.projected) && final.estimate.estimatedInputTokens > budget.semanticBudgetTokens) {
    let index = includedCandidates.length - 1;
    while (index >= 0 && includedCandidates[index]!.required) index -= 1;
    if (index < 0) break;
    const [evicted] = includedCandidates.splice(index, 1);
    if (!evicted) break;
    const drop = <T>(items: T[], item: unknown): void => {
      const at = items.indexOf(item as T);
      if (at >= 0) items.splice(at, 1);
    };
    if (evicted.section === "recent_raw") {
      drop(conversationIncluded, evicted.data);
      if (evicted.ref) conversationOmittedIds.add(evicted.ref);
    } else if (evicted.section.startsWith("working_context")) {
      drop(workingContextIncluded, evicted.data);
    } else if (evicted.section === "desk_entry") {
      drop(deskEntriesIncluded, evicted.data);
    } else if (evicted.section === "retrieval_compact") {
      drop(retrievalHitsIncluded, evicted.data);
    } else if (evicted.section === "observations") {
      observationsIncluded = false;
    } else if (evicted.section === "orientation_kernel") {
      orientationKernelIncluded = false;
    } else if (evicted.section === "domain_pointers") {
      domainPointersIncluded = false;
    } else if (evicted.section === "c3_terminal_experiences") {
      c3ExperiencesIncluded = false;
    }
    compression = true;
    omittedCandidateData.push(evicted);
    omittedCandidates.push({
      id: evicted.id,
      section: evicted.section,
      ref: evicted.ref,
      required: evicted.required,
      priority: evicted.priority,
      estimatedTokens: structuralTokens(evicted.data),
      reason: "budget_omission",
      requiredness: evicted.requiredness,
    });
    final = renderFinal();
  }
  if (disclosesLoss(final.projected) && final.estimate.estimatedInputTokens > budget.semanticBudgetTokens && final !== unfitted) {
    replace(includedCandidates, snapshot.included);
    replace(conversationIncluded, snapshot.conversation);
    conversationOmittedIds.clear();
    for (const id of snapshot.conversationOmitted) conversationOmittedIds.add(id);
    replace(workingContextIncluded, snapshot.workingContext);
    replace(deskEntriesIncluded, snapshot.deskEntries);
    replace(retrievalHitsIncluded, snapshot.retrieval);
    ({ observationsIncluded, orientationKernelIncluded, domainPointersIncluded, c3ExperiencesIncluded, compression } = snapshot.flags);
    omittedCandidates.length = snapshot.omitted;
    omittedCandidateData.length = snapshot.omittedData;
    final = unfitted;
  }
  const { projected: finalProjected, messages: finalMessages, estimate: finalEstimate } = final;
  // the Host records only that secret evidence was present; it never reads or judges it.
  const sawSecret = (input.audience === undefined || input.audience.kind === "owner_private")
    && (thoughtInputContainsSecret(finalProjected)
      || finalProjected.retrieval.hits.some((hit) => thoughtInputContainsSecret(provenance.get(hit.ref))));
  Object.defineProperty(finalProjected, "sawSecret", { value: sawSecret, enumerable: false });

  // E2b+E2c disclosure-scoped caller-envelope gate: applies ONLY when a
  // loss disclosure is present on the FINAL wire. The fixed global byte gate
  // below is the 262144-token logical byte envelope; caller envelopes
  // may be smaller, so disclosed finals must satisfy the ACTUAL caller
  // envelope or fail closed. NOT a generic final budget gate — complete
  // (undisclosed) finals take no new check. The section names which loss
  // disclosures the overflowing wire carries; no causal attribution is
  // attempted between them.
  const hasRetrievalDisclosure = (finalProjected.retrieval.allocatorOmittedCount ?? 0) > 0;
  const hasWcDisclosure =
    (finalProjected.workingContextSelection?.optionalAllocatorOmittedCount ?? 0) > 0;
  if (
    (hasRetrievalDisclosure || hasWcDisclosure) &&
    finalEstimate.estimatedInputTokens > budget.semanticBudgetTokens
  ) {
    const section = hasRetrievalDisclosure && hasWcDisclosure
      ? "joint_loss_disclosure"
      : hasRetrievalDisclosure
        ? "retrieval_loss_disclosure"
        : "working_context_loss_disclosure";
    const disclosureKind = hasRetrievalDisclosure && hasWcDisclosure
      ? "retrieval + Working Context loss"
      : hasRetrievalDisclosure
        ? "retrieval-loss"
        : "Working Context-loss";
    throw new RequiredOverflowError(
      `Truthful ${disclosureKind} disclosure exceeds the caller semantic envelope (input: ${finalEstimate.estimatedInputTokens}, semanticBudgetTokens: ${budget.semanticBudgetTokens})`,
      {
        section,
        estimatedInputTokens: finalEstimate.estimatedInputTokens,
        semanticBudgetTokens: budget.semanticBudgetTokens,
        failure: {
          kind: "semantic_token_budget",
          constraint: "semantic_token_budget",
          measuredValue: finalEstimate.estimatedInputTokens,
          unit: "tokens",
          limit: budget.semanticBudgetTokens,
          stage: "final_render",
          measurementBasis: "exact",
        },
      },
    );
  }
  const finalLogicalInputBytes = estimateRequestInputBytes(finalMessages);
  if (finalLogicalInputBytes > MAX_LOGICAL_SERIALIZED_INPUT_BYTES) {
    throw new RequiredOverflowError(
      `Logical input composition exceeds the frozen byte envelope (bytes: ${finalLogicalInputBytes}, limit: ${MAX_LOGICAL_SERIALIZED_INPUT_BYTES})`,
      {
        section: "logical_input_envelope",
        estimatedInputTokens: finalEstimate.estimatedInputTokens,
        semanticBudgetTokens: budget.semanticBudgetTokens,
        failure: {
          kind: "serialized_request_bytes",
          constraint: "logical_input_byte_envelope",
          measuredValue: finalLogicalInputBytes,
          unit: "bytes",
          limit: MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
          stage: "final_render",
          measurementBasis: "exact",
        },
      },
    );
  }

  const componentTokens: Partial<Record<ReturnType<typeof allocationTokenComponent>, number>> = {};
  for (const candidate of includedCandidates) {
    const component = allocationTokenComponent(candidate.section);
    componentTokens[component] = (componentTokens[component] ?? 0) + structuralTokens(candidate.data);
  }
  if (finalMessages.length > 2) {
    componentTokens.authority_revision_feedback_tokens =
      (componentTokens.authority_revision_feedback_tokens ?? 0) + structuralTokens(finalMessages.slice(2));
  }
  const tokenBreakdown: AllocationTokenBreakdown = {
    static_contract_tokens: structuralTokens(finalMessages[0]?.content ?? ""),
    conversation_tokens: componentTokens.conversation_tokens ?? 0,
    working_context_tokens: componentTokens.working_context_tokens ?? 0,
    identity_kernel_tokens: componentTokens.identity_kernel_tokens ?? 0,
    domain_pointer_tokens: componentTokens.domain_pointer_tokens ?? 0,
    learned_self_tokens: componentTokens.learned_self_tokens ?? 0,
    retrieval_tokens: componentTokens.retrieval_tokens ?? 0,
    observations_tokens: componentTokens.observations_tokens ?? 0,
    in_flight_effect_tokens: componentTokens.in_flight_effect_tokens ?? 0,
    inner_life_tokens: componentTokens.inner_life_tokens ?? 0,
    authority_revision_feedback_tokens: componentTokens.authority_revision_feedback_tokens ?? 0,
    omitted_for_budget_tokens: omittedCandidateData.reduce(
      (total, candidate) => total + structuralTokens(candidate.data),
      0,
    ),
    omitted_for_budget_count: omittedCandidates.length,
    required_overflow_count: 0,
  };

  const requiredBaseEstimatedTokens = candidates
    .filter((candidate) => candidate.required)
    .reduce((total, candidate) => total + structuralTokens(candidate.data), 0);
  const optionalContextEstimatedTokens = candidates
    .filter((candidate) => !candidate.required)
    .reduce((total, candidate) => total + structuralTokens(candidate.data), 0);
  const systemMessageBytes = Buffer.byteLength(finalMessages[0]?.content ?? "", "utf8");
  const visibleProjection = modelVisibleThoughtProjection(finalProjected);
  const visibleProjectionJson = JSON.stringify(visibleProjection);
  const volatileFields = new Set([
    "cycleId",
    "generation",
    "trigger",
    "wakeCauses",
    "previousInvocationDelta",
    "thoughtLegDeadlineAtMs",
    "clock",
    "episodes",
    "activityJournal",
    "growth",
    "innerPass",
    "pendingForget",
    "rawConversation",
    "deskEntries",
    "observations",
    "retrieval",
    "workingContextSelection",
    "inFlight",
    "authorityObjections",
    "runtimeCondition",
    "rememberDirective",
    "conversationSelection",
  ]);
  const firstVolatileField = Object.keys(visibleProjection).find((key) => volatileFields.has(key)) ?? null;
  const firstVolatileMarker = firstVolatileField === null
    ? -1
    : visibleProjectionJson.indexOf(`${JSON.stringify(firstVolatileField)}:`);
  const firstVolatileByteOffset = firstVolatileMarker < 0
    ? null
    : Buffer.byteLength(visibleProjectionJson.slice(0, firstVolatileMarker), "utf8");
  const stablePrefixFields = [
    "orientationKernel",
    "learnedSelfSlice",
    "occupantId",
    "authorityEpoch",
  ] as const;
  const stablePrefixProjection = Object.fromEntries(
    stablePrefixFields
      .filter((field) => Object.prototype.hasOwnProperty.call(visibleProjection, field))
      .map((field) => [field, visibleProjection[field]]),
  );
  const candidateS0S1PrefixBytes = systemMessageBytes
    + Buffer.byteLength(JSON.stringify(stablePrefixProjection), "utf8");
  const diagnostics: AllocationDiagnostics = {
    system_message_bytes: systemMessageBytes,
    logical_input_bytes: finalLogicalInputBytes,
    logical_input_byte_limit: MAX_LOGICAL_SERIALIZED_INPUT_BYTES,
    max_supported_composition_bytes: MAX_SUPPORTED_COMPOSITION_BYTES,
    orientation_kernel_bytes: finalProjected.orientationKernel === undefined
      ? 0
      : Buffer.byteLength(JSON.stringify(finalProjected.orientationKernel), "utf8"),
    required_base_estimated_tokens: requiredBaseEstimatedTokens,
    optional_context_estimated_tokens: optionalContextEstimatedTokens,
    system_prefix_bytes: systemMessageBytes,
    system_prefix_estimated_tokens: tokenBreakdown.static_contract_tokens,
    candidate_S0_S1_prefix_bytes: candidateS0S1PrefixBytes,
    candidate_S0_S1_prefix_estimated_tokens: Math.ceil(candidateS0S1PrefixBytes / BYTES_PER_TOKEN),
    first_volatile_field: firstVolatileField,
    first_volatile_byte_offset: firstVolatileByteOffset,
    allocation_candidate_count: candidates.length,
    renderTentative_call_count: renderTentativeCallCount,
    thoughtMessagesForProjection_call_count: thoughtMessagesForProjectionCallCount,
    thoughtOutputCompatibilityInstruction_call_count: 1,
    thought_contract_profile: thoughtContractProfileKey(contractProfile),
    formatThoughtStructuralFeedback_call_count: 1,
    formatThoughtStructuralCorrectionData_call_count: 1,
    inFlightEffectRefMap_call_count: 1,
    allocation_elapsed_ms: Math.max(0, Date.now() - allocationStartedAtMs),
  };

  const coverageManifest = mergeCoverageManifests(buildAllocationCoverageManifest({
    included: includedCandidates,
    omitted: omittedCandidateData,
    excluded: excludedCandidates,
  }), c2Input.domainPointers?.coverageManifest);
  const coverageManifestWithC3 = mergeCoverageManifests(
    coverageManifest,
    c2Input.c3Experiences?.coverageManifest,
  );

  const semanticProjectionHash = computeSemanticProjectionHash(finalProjected);
  const dispatchMessagesHash = computeDispatchMessagesHash(finalMessages);

  const receipt: AllocationReceipt = {
    cycleId: input.cycleId,
    generation: input.generation,
    requestId: opts.requestId,
    policyId: "thought-projection-v1",
    policyVersion: 1,
    semanticProjectionEnvelope: budget.semanticProjectionEnvelope,
    coverageManifest: coverageManifestWithC3,
    diagnostics,
    tokenBreakdown,
    quotaBucket: budget.quotaBucket,
    hardTpm: budget.hardTpm,
    maxOutputTokens: budget.maxOutputTokens,
    estimatedInputTokens: finalEstimate.estimatedInputTokens,
    estimatedOutputTokens: finalEstimate.estimatedOutputTokens,
    totalDemandTokens: finalEstimate.estimatedInputTokens + finalEstimate.estimatedOutputTokens,
    headroomTokens: budget.semanticBudgetTokens - finalEstimate.estimatedInputTokens,
    compression,
    requiredOverflow: false,
    decision: {
      included: includedCandidates.map((c) => ({
        id: c.id,
        section: c.section,
        ref: c.ref,
        required: c.required,
        priority: c.priority,
        estimatedTokens: structuralTokens(c.data),
        requiredness: c.requiredness,
      })),
      omitted: omittedCandidates,
      includedWireBytes: Buffer.byteLength(JSON.stringify(finalMessages), "utf8"),
      estimatedInputTokens: finalEstimate.estimatedInputTokens,
    },
    semanticProjectionHash,
    dispatchMessagesHash,
  };

  if (opts.observabilityDb) {
    try {
      recordAllocationReceipt(opts.observabilityDb, receipt);
      if (compression || omittedCandidates.length > 0) {
        recordDiagnostic(opts.observabilityDb, {
          cycleId: receipt.cycleId,
          generation: receipt.generation,
          requestId: receipt.requestId,
          pass: 1,
          code: "context_allocation_optional_degradation",
          stage: "allocation",
          dispatchTruth: "not_sent",
          semanticProjectionHash,
          dispatchMessagesHash,
          estimatedInputTokens: receipt.estimatedInputTokens,
          totalDemandTokens: receipt.totalDemandTokens,
          createdAtMs: Date.now(),
        });
      }
    } catch {
      // Observability persistence failures must not block thought allocation
    }
  }

  return {
    messages: finalMessages,
    projected: finalProjected,
    provenance,
    receipt,
    hashes: {
      semanticProjectionHash,
      dispatchMessagesHash,
    },
  };
}
