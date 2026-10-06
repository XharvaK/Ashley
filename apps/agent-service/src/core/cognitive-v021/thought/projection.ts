import { createHash } from "node:crypto";
import {
  buildOperationalEffectNamespace,
} from "../effect/effect-ref.js";
import { MAX_EFFECT_ROUNDS } from "../types.js";
import type {
  AssertionKey,
  AuthorityCode,
  CapabilityReality,
  CycleId,
  CycleTriggerKind,
  DataClassification,
  DeskEntry,
  EpistemicDimensions,
  Generation,
  IdentitySlice,
  InFlightRecord,
  LearnedSelfSlice,
  MemoryKind,
  Observation,
  OccupantId,
  RememberDirective,
  RetrievalHit,
  RetrievalInfrastructureState,
  RetrievalRequest,
  RuntimeCondition,
  ThoughtInput,
  ThoughtOccupancy,
  WorkingContextItem,
  PublicPresenceContext,
} from "../types.js";
import type { ChatMessage } from "../../model-routing/types.js";
import type { DomainPointersSection } from "./domain-pointers.js";
import type { IdentityOrientationKernel } from "./orientation-kernel.js";
import type { ThoughtSourceCurrentness } from "./source-currentness.js";
import type { AvailableSocialDestination } from "../social/types.js";
import { getOccupiedConcernProjection } from "./occupied-concerns.js";
import {
  projectInFlightConsequence,
  type ProjectedInFlightRecord,
} from "./consequence-projection.js";

export type { ProjectedInFlightRecord } from "./consequence-projection.js";

export type CompactMemoryEvidence = {
  kind: "key" | "lex";
  ref: string;
  sourceStore: "live_memory" | "quarantined_memory";
  memoryKind: MemoryKind | null;
  dimensions: EpistemicDimensions | null;
  snippet: string;
  supportCount?: number;
  source?: string | null;
  subject?: string[] | null;
  audienceScope?: RetrievalHit["audienceScope"];
  licenseRefs?: string[];
  channel?: `domus:${string}`;
};

export type CompactConversationEvidence = {
  kind: "log";
  ref: string;
  sourceStore: "conversation_log";
  role: "owner" | "ashley" | "system" | "unknown";
  snippet: string;
  lineageId?: string | null;
  version?: number | null;
  provenance?: string | null;
  source?: string | null;
  subject?: string[] | null;
  audienceScope?: RetrievalHit["audienceScope"];
  licenseRefs?: string[];
};

export type CompactRetrievalEvidence =
  | CompactMemoryEvidence
  | CompactConversationEvidence;

export type ProjectedRetrievalResult = {
  request: RetrievalRequest;
  hits: CompactRetrievalEvidence[];
  state: RetrievalInfrastructureState;
  miss: boolean;
  /**
   * Number of allocator-eligible retrieval candidates omitted only because
   * they did not fit the Thought semantic budget (allocator-stage loss).
   * Present only when > 0. Absence means no KNOWN allocator-stage retrieval
   * omission; it says nothing about FTS limits, defense fuse, dedup,
   * query formation, undiscovered evidence, or pre-allocator eligibility.
   * No IDs, snippets, ranks, or refs cross the wire with this count.
   */
  allocatorOmittedCount?: number;
};

export type ProjectedThoughtInput = {
  /** Host-only label of delivered input; never serialized to Thought. */
  sawSecret?: boolean;
  /** Host-only disclosure scope, never serialized to Thought. */
  audience?: ThoughtInput["audience"];
  cycleId: CycleId;
  generation: Generation;
  occupantId: OccupantId;
  authorityEpoch: number;
  trigger: {
    kind: CycleTriggerKind;
    ref: string;
    continuityRecovery?: ThoughtInput["trigger"]["continuityRecovery"];
    selfChangeResult?: ThoughtInput["trigger"]["selfChangeResult"];
  };
  commitmentDue?: ThoughtInput["commitmentDue"];
  rawConversation: ThoughtInput["rawConversation"];
  conversationSelection?: ThoughtInput["conversationSelection"];
  workingContext: WorkingContextItem[];
  /**
   * Number of allocator-eligible OPTIONAL Working Context items (topic and
   * other only) omitted by allocator bounds (local item-size fuse and/or
   * semantic-budget packing). Present only when > 0; the object is absent
   * otherwise, so no empty selection object is ever valid. Absence means no
   * KNOWN allocator-stage optional omission; it says nothing about source
   * store completeness, lifecycle filtering, ineligible/private records, or
   * required Working Context (excluded from this count). No IDs, text, or
   * subtype breakdowns cross the wire with this count.
   */
  workingContextSelection?: {
    optionalAllocatorOmittedCount: number;
  };
  deskEntries?: DeskEntry[];
  occupancy: ThoughtOccupancy[];
  /** Host-captured concern snapshots; non-enumerable and excluded from model wire. */
  concernSnapshots?: Readonly<Record<string, string>>;
  /** Host-only source witness; non-enumerable and excluded from model wire. */
  sourceCurrentness?: ThoughtSourceCurrentness;
  /** Legacy in-process compatibility; C2 wire identity is orientationKernel. */
  constitution: IdentitySlice;
  learnedSelfSlice: LearnedSelfSlice;
  /** Legacy in-process compatibility; C2 wire capability is orientationKernel. */
  capabilityReality: CapabilityReality;
  wakeCauses?: ThoughtInput["wakeCauses"];
  previousInvocationDelta?: string;
  thoughtLegDeadlineAtMs?: number;
  clock?: ThoughtInput["clock"];
  coreProfile?: ThoughtInput["coreProfile"];
  threadStory?: ThoughtInput["threadStory"];
  episodes?: ThoughtInput["episodes"];
  activityJournal?: ThoughtInput["activityJournal"];
  growth?: ThoughtInput["growth"];
  attention?: ThoughtInput["attention"];
  innerPass?: ThoughtInput["innerPass"];
  domus?: ThoughtInput["domus"];
  domusNow?: ThoughtInput["domusNow"];
  places?: ThoughtInput["places"];
  home?: ThoughtInput["home"];
  will?: ThoughtInput["will"];
  /** Current public state is model-visible only during autonomous cognition. */
  publicPresence?: PublicPresenceContext;
  availableDestinations?: readonly AvailableSocialDestination[];
  observations: Observation[];
  retrieval: ProjectedRetrievalResult;
  inFlight: ProjectedInFlightRecord[];
  allowedOperationalEffectRefs: readonly string[];
  authorityObjections: AuthorityCode[];
  runtimeCondition: RuntimeCondition;
  rememberDirective: RememberDirective | null;
  orientationKernel?: IdentityOrientationKernel;
  domainPointers?: DomainPointersSection;
  effectBudget: Readonly<{
    maxEffectRounds: number;
    usedEffectRounds: number;
    remainingEffectRounds: number;
  }>;
  settlementOnly?: boolean;
};

export type ThoughtModelProjection = {
  projected: ProjectedThoughtInput;
  provenance: Map<string, RetrievalHit>;
  semanticProjectionHash: string;
  dispatchMessagesHash: string;
};

/**
 * Keep legacy C2 fields available to in-process callers without exposing
 * payload already owned by the orientation kernel on the model wire.
 */
export function attachC2CompatibilityFields(
  projected: object,
  source: Pick<ThoughtInput, "constitution" | "capabilityReality">,
): ProjectedThoughtInput {
  Object.defineProperties(projected, {
    constitution: {
      value: source.constitution,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    capabilityReality: {
      value: source.capabilityReality,
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });
  return projected as ProjectedThoughtInput;
}

export function attachSourceCurrentness(
  projected: object,
  sourceCurrentness: ThoughtSourceCurrentness | undefined,
): ProjectedThoughtInput {
  if (sourceCurrentness !== undefined) {
    Object.defineProperty(projected, "sourceCurrentness", {
      value: sourceCurrentness,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return projected as ProjectedThoughtInput;
}

const MAX_DUPLICATE_COMPARISON_NODES = 65_536;
const MAX_DUPLICATE_COMPARISON_DEPTH = 64;

function exactJsonValueEqual(left: unknown, right: unknown): boolean {
  let remainingNodes = MAX_DUPLICATE_COMPARISON_NODES;
  const compare = (leftValue: unknown, rightValue: unknown, depth: number): boolean => {
    remainingNodes -= 1;
    if (remainingNodes < 0 || depth > MAX_DUPLICATE_COMPARISON_DEPTH) return false;
    if (Object.is(leftValue, rightValue)) return true;
    if (typeof leftValue !== typeof rightValue || leftValue === null || rightValue === null) return false;
    if (typeof leftValue !== "object" || typeof rightValue !== "object") return false;
    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      if (!Array.isArray(leftValue) || !Array.isArray(rightValue)
        || leftValue.length !== rightValue.length
        || leftValue.length > MAX_DUPLICATE_COMPARISON_NODES) return false;
      for (let index = 0; index < leftValue.length; index += 1) {
        if (!compare(leftValue[index], rightValue[index], depth + 1)) return false;
      }
      return true;
    }
    const leftPrototype = Object.getPrototypeOf(leftValue);
    const rightPrototype = Object.getPrototypeOf(rightValue);
    if ((leftPrototype !== Object.prototype && leftPrototype !== null)
      || (rightPrototype !== Object.prototype && rightPrototype !== null)) return false;
    const leftKeys = Object.keys(leftValue);
    const rightKeys = Object.keys(rightValue);
    if (leftKeys.length !== rightKeys.length
      || leftKeys.length > MAX_DUPLICATE_COMPARISON_NODES) return false;
    for (let index = 0; index < leftKeys.length; index += 1) {
      const key = leftKeys[index];
      if (key !== rightKeys[index]
        || !compare(
          (leftValue as Record<string, unknown>)[key!],
          (rightValue as Record<string, unknown>)[key!],
          depth + 1,
        )) return false;
    }
    return true;
  };
  try {
    return compare(left, right, 0);
  } catch {
    return false;
  }
}

/**
 * Derive one canonical model-visible observation. Executor/model identity is
 * a Host-owned execution fact. A root `lastObservation` is omitted only when
 * it exactly repeats an observation already retained in a worker step. The
 * raw durable observation remains unchanged. Large or malformed values that
 * exceed the bounded comparison path are preserved for allocator validation.
 */
export function modelVisibleObservation(observation: Observation): Observation {
  const payload = observation.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return observation;
  const objectPayload = payload as Record<string, unknown>;
  const summaryDerivation = objectPayload.summaryDerivation;
  if (summaryDerivation !== undefined) {
    if (typeof summaryDerivation !== "object" || summaryDerivation === null || Array.isArray(summaryDerivation)
      || typeof objectPayload.summary !== "string") {
      throw new Error("worker_summary_derivation_invalid");
    }
    const derivation = summaryDerivation as Record<string, unknown>;
    if (derivation.derivation !== "worker_interpretation" || !Array.isArray(derivation.stepObservationIds)) {
      throw new Error("worker_summary_derivation_invalid");
    }
    const steps = Array.isArray(objectPayload.steps) ? objectPayload.steps : [];
    for (const observationId of derivation.stepObservationIds) {
      if (typeof observationId !== "string" || observationId.length === 0) {
        throw new Error("worker_summary_derivation_invalid");
      }
      const retainedStep = steps.some((step) => typeof step === "object"
        && step !== null
        && !Array.isArray(step)
        && (step as Record<string, unknown>).observationId === observationId
        && (step as Record<string, unknown>).observation != null);
      if (!retainedStep) throw new Error("required_observation_view_missing");
    }
  }
  const removeSelectedModel = Object.prototype.hasOwnProperty.call(objectPayload, "selectedModelId");
  const steps = objectPayload.steps;
  const lastObservation = objectPayload.lastObservation;
  const removeDuplicateLastObservation = Object.prototype.hasOwnProperty.call(objectPayload, "lastObservation")
    && Array.isArray(steps)
    && steps.length <= MAX_DUPLICATE_COMPARISON_NODES
    && steps.some((step) => typeof step === "object"
      && step !== null
      && !Array.isArray(step)
      && Object.prototype.hasOwnProperty.call(step, "observation")
      && exactJsonValueEqual((step as Record<string, unknown>).observation, lastObservation));
  const removeImageDataUri = Object.prototype.hasOwnProperty.call(objectPayload, "imageDataUri");
  if (!removeSelectedModel && !removeDuplicateLastObservation && !removeImageDataUri) return observation;
  const projectedPayload = { ...objectPayload };
  if (removeSelectedModel) delete projectedPayload.selectedModelId;
  if (removeDuplicateLastObservation) delete projectedPayload.lastObservation;
  if (removeImageDataUri) delete projectedPayload.imageDataUri;
  return { ...observation, payload: projectedPayload };
}

/** Pure, non-mutating projection for the complete model-visible observation set. */
function modelVisibleObservations(observations: Observation[]): Observation[] {
  const projected = observations.map(modelVisibleObservation);
  return projected.every((item, index) => item === observations[index]) ? observations : projected;
}

/**
 * Return the exact model-visible projection. C2's legacy identity and
 * capability fields remain readable in-process but are not serialized beside
 * their canonical orientation-kernel owners.
 */
export function modelVisibleThoughtProjection(
  projected: ProjectedThoughtInput,
): Record<string, unknown> {
  const visibleObservations = modelVisibleObservations(projected.observations);
  const occupiedConcernProjection = getOccupiedConcernProjection(projected.occupancy);
  if (projected.orientationKernel === undefined) {
    if (visibleObservations === projected.observations && occupiedConcernProjection === undefined) {
      return projected;
    }
    const result: Record<string, unknown> = {
      ...projected,
      observations: visibleObservations,
      ...(occupiedConcernProjection === undefined ? {} : { occupancy: occupiedConcernProjection }),
    };
    for (const key of Object.getOwnPropertyNames(projected)) {
      const descriptor = Object.getOwnPropertyDescriptor(projected, key);
      if (descriptor && !descriptor.enumerable) {
        Object.defineProperty(result, key, descriptor);
      }
    }
    return result;
  }

  const visibleProjection: Record<string, unknown> = Object.fromEntries(
    Object.entries(projected).filter(([key]) => key !== "constitution" && key !== "capabilityReality"),
  );
  visibleProjection.observations = visibleObservations;
  if (occupiedConcernProjection !== undefined) {
    visibleProjection.occupancy = occupiedConcernProjection;
  }
  const visibleOrientationKernel = Object.fromEntries(
    Object.entries(projected.orientationKernel)
      .filter(([key]) => key !== "stableSelf" && key !== "stableSelfPointers"),
  );
  return {
    ...visibleProjection,
    orientationKernel: visibleOrientationKernel,
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function computeSemanticProjectionHash(projected: ProjectedThoughtInput): string {
  return sha256(JSON.stringify(modelVisibleThoughtProjection(projected)));
}

export function computeDispatchMessagesHash(messages: ChatMessage[]): string {
  return sha256(JSON.stringify(messages));
}

export function projectRetrievalHit(hit: RetrievalHit): CompactRetrievalEvidence {
  const externalMetadata = (hit.audienceScope !== undefined && hit.audienceScope !== null && hit.audienceScope.kind !== "owner_private") ||
    hit.source != null ||
    (hit.subject != null && hit.subject.length > 0) ||
    (hit.licenseRefs != null && hit.licenseRefs.length > 0);
  if (hit.sourceStore === "conversation_log") {
    return {
      kind: "log",
      ref: hit.ref,
      sourceStore: "conversation_log",
      role: hit.role ?? "unknown",
      snippet: hit.snippet,
      ...(externalMetadata ? {
        source: hit.source ?? null,
        subject: hit.subject ?? null,
        audienceScope: hit.audienceScope,
        licenseRefs: hit.licenseRefs ?? [],
      } : {}),
    };
  }

  const kind = hit.kind === "key" ? "key" : "lex";
  const supportCount = hit.supportRefs ? hit.supportRefs.length : undefined;

  return {
    kind,
    ref: hit.ref,
    sourceStore: hit.sourceStore === "quarantined_memory" ? "quarantined_memory" : "live_memory",
    memoryKind: hit.memoryKind,
    dimensions: hit.dimensions,
    snippet: hit.snippet,
    supportCount: supportCount && supportCount > 0 ? supportCount : undefined,
    ...(externalMetadata ? {
      source: hit.source ?? null,
      subject: hit.subject ?? null,
      audienceScope: hit.audienceScope,
      licenseRefs: hit.licenseRefs ?? [],
    } : {}),
    ...(hit.channel ? { channel: hit.channel } : {}),
  };
}

export function projectThoughtInput(
  fullInput: ThoughtInput,
  rankedHits: RetrievalHit[],
  infrastructureState: RetrievalInfrastructureState = "ready",
): {
  projected: ProjectedThoughtInput;
  provenance: Map<string, RetrievalHit>;
  semanticProjectionHash: string;
} {
  const c2Input = fullInput as ThoughtInput & {
    orientationKernel?: IdentityOrientationKernel;
    domainPointers?: DomainPointersSection;
  };
  const provenance = new Map<string, RetrievalHit>();
  const compactHits: CompactRetrievalEvidence[] = [];

  for (const hit of rankedHits) {
    provenance.set(hit.ref, hit);
    compactHits.push(projectRetrievalHit(hit));
  }

  // E2b: preserve source retrieval truth. The allocator-stage projection must
  // not recompute miss from post-budget survivors: total allocator omission
  // is not a retrieval miss. fullInput.retrieval.miss is the source fact.
  const isMiss = fullInput.retrieval.miss;
  const operationalNamespace = buildOperationalEffectNamespace(
    fullInput.cycleId,
    fullInput.generation,
    fullInput.inFlight.map((item) => item.effectId),
  );

  const projected: ProjectedThoughtInput = {
    cycleId: fullInput.cycleId,
    generation: fullInput.generation,
    occupantId: fullInput.occupantId,
    authorityEpoch: fullInput.authorityEpoch,
    trigger: fullInput.trigger,
    ...(fullInput.commitmentDue === undefined ? {} : { commitmentDue: fullInput.commitmentDue }),
    rawConversation: fullInput.rawConversation,
    ...(fullInput.conversationSelection === undefined
      ? {}
      : { conversationSelection: fullInput.conversationSelection }),
    workingContext: fullInput.workingContext,
    ...(fullInput.deskEntries === undefined ? {} : { deskEntries: fullInput.deskEntries }),
    occupancy: fullInput.occupancy,
    constitution: fullInput.constitution,
    learnedSelfSlice: fullInput.learnedSelfSlice,
    capabilityReality: fullInput.capabilityReality,
    ...(fullInput.wakeCauses === undefined ? {} : { wakeCauses: [...fullInput.wakeCauses] }),
    ...(fullInput.previousInvocationDelta === undefined ? {} : { previousInvocationDelta: fullInput.previousInvocationDelta }),
    ...(fullInput.thoughtLegDeadlineAtMs === undefined ? {} : { thoughtLegDeadlineAtMs: fullInput.thoughtLegDeadlineAtMs }),
    ...(fullInput.clock === undefined ? {} : { clock: fullInput.clock }),
    ...(fullInput.coreProfile === undefined ? {} : { coreProfile: fullInput.coreProfile }),
    ...(fullInput.threadStory === undefined ? {} : { threadStory: fullInput.threadStory }),
    ...(fullInput.episodes === undefined ? {} : { episodes: fullInput.episodes }),
    ...(fullInput.activityJournal === undefined ? {} : { activityJournal: fullInput.activityJournal }),
    ...(fullInput.growth === undefined ? {} : { growth: fullInput.growth }),
    ...(fullInput.attention === undefined ? {} : { attention: fullInput.attention }),
    ...(fullInput.innerPass === undefined ? {} : { innerPass: fullInput.innerPass }),
    ...(fullInput.domus === undefined ? {} : { domus: fullInput.domus }),
    ...(fullInput.domusNow === undefined ? {} : { domusNow: fullInput.domusNow }),
    ...(fullInput.places === undefined ? {} : { places: fullInput.places }),
    ...(fullInput.home === undefined ? {} : { home: fullInput.home }),
    ...(fullInput.will === undefined ? {} : { will: fullInput.will }),
    ...(fullInput.publicPresence === undefined ? {} : { publicPresence: fullInput.publicPresence }),
    ...(fullInput.availableDestinations === undefined ? {} : {
      availableDestinations: [...fullInput.availableDestinations],
    }),
    observations: fullInput.observations,
    retrieval: {
      request: fullInput.retrieval.request,
      hits: compactHits,
      state: infrastructureState,
      miss: isMiss,
    },
    inFlight: fullInput.inFlight.map((item) => ({
      ...projectInFlightConsequence(
        item,
        fullInput.cycleId,
        fullInput.generation,
        fullInput.audience,
      ),
    })),
    allowedOperationalEffectRefs: [...operationalNamespace.allowedOperationalEffectRefs],
    authorityObjections: fullInput.authorityObjections,
    runtimeCondition: fullInput.runtimeCondition,
    rememberDirective: fullInput.rememberDirective,
    ...(c2Input.orientationKernel === undefined ? {} : { orientationKernel: c2Input.orientationKernel }),
    ...(c2Input.domainPointers === undefined ? {} : { domainPointers: c2Input.domainPointers }),
    effectBudget: fullInput.effectBudget ?? {
      maxEffectRounds: MAX_EFFECT_ROUNDS,
      usedEffectRounds: 0,
      remainingEffectRounds: MAX_EFFECT_ROUNDS,
    },
    ...(fullInput.settlementOnly === undefined ? {} : { settlementOnly: fullInput.settlementOnly }),
  };

  if (fullInput.audience !== undefined) {
    Object.defineProperty(projected, "audience", {
      value: fullInput.audience,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  if (fullInput.concernSnapshots !== undefined) {
    Object.defineProperty(projected, "concernSnapshots", {
      value: fullInput.concernSnapshots,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  attachSourceCurrentness(projected, fullInput.sourceCurrentness);

  if (c2Input.orientationKernel !== undefined) {
    attachC2CompatibilityFields(projected, fullInput);
  }

  const semanticProjectionHash = computeSemanticProjectionHash(projected);

  return {
    projected,
    provenance,
    semanticProjectionHash,
  };
}
