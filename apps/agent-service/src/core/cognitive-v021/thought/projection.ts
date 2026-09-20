import { createHash } from "node:crypto";
import {
  buildOperationalEffectNamespace,
  mintEffectRef,
} from "../effect/effect-ref.js";
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
};

export type ProjectedInFlightRecord = {
  effectRef: string;
  status: "in_flight" | "receipted" | "unknown";
};

export type ProjectedThoughtInput = {
  cycleId: CycleId;
  generation: Generation;
  occupantId: OccupantId;
  authorityEpoch: number;
  trigger: {
    kind: CycleTriggerKind;
    ref: string;
    continuityRecovery?: ThoughtInput["trigger"]["continuityRecovery"];
  };
  commitmentDue?: ThoughtInput["commitmentDue"];
  rawConversation: ThoughtInput["rawConversation"];
  conversationSelection?: ThoughtInput["conversationSelection"];
  workingContext: WorkingContextItem[];
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

/**
 * Derive the model-visible observation view. Executor/model identity is a
 * Host-owned execution fact, not cognition evidence: the raw durable
 * Observation retains it, and only this derived view omits the single
 * top-level payload key `selectedModelId`. Pure and non-mutating: inputs,
 * observations, and payloads are copied, never edited in place. No
 * deep-scrub of strings and no nested-key handling.
 */
function modelVisibleObservations(observations: Observation[]): Observation[] {
  let changed = false;
  const mapped = observations.map((observation) => {
    const payload = observation.payload;
    if (
      typeof payload !== "object"
      || payload === null
      || Array.isArray(payload)
      || !Object.prototype.hasOwnProperty.call(payload, "selectedModelId")
    ) {
      return observation;
    }
    changed = true;
    const { selectedModelId: _omitted, ...rest } = payload as Record<string, unknown>;
    return { ...observation, payload: rest };
  });
  return changed ? mapped : observations;
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

  const isMiss = infrastructureState === "ready" && compactHits.length === 0;
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
      effectRef: mintEffectRef(fullInput.cycleId, fullInput.generation, item.effectId),
      status: item.status,
    })),
    allowedOperationalEffectRefs: [...operationalNamespace.allowedOperationalEffectRefs],
    authorityObjections: fullInput.authorityObjections,
    runtimeCondition: fullInput.runtimeCondition,
    rememberDirective: fullInput.rememberDirective,
    ...(c2Input.orientationKernel === undefined ? {} : { orientationKernel: c2Input.orientationKernel }),
    ...(c2Input.domainPointers === undefined ? {} : { domainPointers: c2Input.domainPointers }),
  };

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
