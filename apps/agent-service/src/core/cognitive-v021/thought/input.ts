import type { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_LAST_N_TURNS,
  DEFAULT_OCCUPANCY_COMPACT_K,
  type CapabilityReality,
  type CapabilityRealityReasonCode,
  type CommitmentDueProjection,
  type ConversationEvidenceRecord,
  type CycleRecord,
  type IdentitySlice,
  type InFlightRecord,
  type MindOccupancy,
  type Observation,
  type ThoughtInput,
  type WorkingContextItem,
  type LearnedSelfSlice,
  type AuthorityCode,
  type RuntimeCondition,
  type RememberDirective,
  type CycleTriggerKind,
  type PublicPresenceContext,
  type DeskEntry,
} from "../types.js";
import type { AvailableSocialDestination, SocialAudience } from "../social/types.js";
import {
  getConversationEvidence,
  listConversationEvidence,
} from "../evidence/conversation-log.js";
import { listInFlight } from "../effect/in-flight.js";
import { listWorkingContext } from "../evidence/working-context.js";
import { listConcerns } from "../concerns/lineage.js";
import { getActiveDeferredFrontier } from "../frontier/ledger.js";
import type { DeferredReactiveFrontierRecord } from "../frontier/types.js";
import { retrieveCandidates } from "../retrieval/discover.js";
import { buildRetrievalQuery, tokenizeForQuery } from "../retrieval/query.js";
import type { DerivedStore } from "../retrieval/derived-store.js";
import { buildLearnedSelfSlice } from "../identity/learned-self.js";
import {
  buildOrientationKernel,
  type IdentityOrientationKernel,
  type IdentityOrientationSource,
} from "./orientation-kernel.js";
import {
  buildDomainPointers,
  type DomainPointersSection,
} from "./domain-pointers.js";
import {
  adaptC3Experiences,
  type C3ExperienceAdapterResult,
} from "./c3-adapter.js";
import {
  adaptOwnTimeSession,
  type OwnTimeSessionCandidate,
} from "../curiosity/own-time-adapter.js";
import {
  captureThoughtSourceCurrentness,
  type ConcernCurrentnessEntry,
  type ThoughtSourceCapture,
} from "./source-currentness.js";
import {
  buildOccupiedConcernProjection,
  enrichOccupancyForThought,
} from "./occupied-concerns.js";
import { isDeskEntryAudienceEligible, listDeskEntries } from "../desk/store.js";

export type BuildThoughtInputOptions = {
  sidecar: DatabaseSync;
  cycle: CycleRecord;
  triggerText?: string;
  triggerEvidence?: ConversationEvidenceRecord | null;
  rawConversation?: ConversationEvidenceRecord[];
  workingContext?: WorkingContextItem[];
  deskEntries?: DeskEntry[];
  occupancy?: MindOccupancy[];
  constitution: IdentitySlice;
  learnedSelfSlice?: LearnedSelfSlice;
  capabilityReality: CapabilityReality;
  observations?: Observation[];
  inFlight?: InFlightRecord[];
  authorityObjections?: AuthorityCode[];
  runtimeCondition?: Partial<RuntimeCondition>;
  rememberDirective?: RememberDirective | null;
  lastNTurns?: number;
  occupancyK?: number;
  derivedStore?: DerivedStore;
  authorityDb?: DatabaseSync;
  /** Optional precomputed C2 sections for deterministic recovery/test seams. */
  orientationKernel?: IdentityOrientationKernel;
  domainPointers?: DomainPointersSection;
  c3Experiences?: C3ExperienceAdapterResult;
  c3AdapterEnabled?: boolean;
  staticOperatingContract?: string;
  stableSelfBound?: number;
  /** Host-derived recovery/profile trigger. It is not a new persisted authority. */
  triggerKindOverride?: CycleTriggerKind;
  /** Set only for the autonomous idle-opportunity public-presence affordance. */
  publicPresence?: PublicPresenceContext;
  /** One coherent source package for the current semantic pass. */
  sourceCapture?: ThoughtSourceCapture;
  /** Audience for this lifecycle. Legacy Owner callers default to Owner-private. */
  audience?: SocialAudience;
  /**
   * Bounded Owner-participated room IDs for authenticated Owner-private
   * recall. Forwarded to retrieval only for the `owner_private` audience;
   * silently dropped for every other audience so room Thought can never
   * receive a cross-surface scope.
   */
  crossSurfaceConversationIds?: readonly string[];
  /** Authenticated Owner identity remains authoritative in a room audience. */
  authenticatedOwner?: boolean;
  /** Current permitted destination facts. Thought may choose; Host does not fan out. */
  availableDestinations?: readonly AvailableSocialDestination[];
  /** Fire-time commitment meaning and three-state evidence completeness. */
  commitmentDue?: CommitmentDueProjection;
  /** Active disclosure-license entity UUIDs already resolved by the Host. */
  licenses?: string[];
};

export type ThoughtInputWithC2 = ThoughtInput & {
  orientationKernel: IdentityOrientationKernel;
  domainPointers: DomainPointersSection;
  c3Experiences: C3ExperienceAdapterResult;
};

function currentConcernDependency(
  concern: ReturnType<typeof listConcerns>[number],
): ConcernCurrentnessEntry {
  return {
    snapshotHash: concern.snapshotHash,
    status: concern.status,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

type AudienceBoundValue = {
  audienceScope?: SocialAudience | null;
  protectionStatus?: "admitted" | "unresolved" | null;
  licenseRefs?: string[];
  dataClassification?: string;
};

function ownerAudience(): SocialAudience {
  return { kind: "owner_private" };
}

function audienceKey(audience: SocialAudience): string {
  if (audience.kind === "owner_private") return "owner_private";
  if (audience.kind === "owner_dm") return `owner_dm:${audience.threadId}`;
  if (audience.kind === "dm") return `dm:${audience.principalId}`;
  return `room:${audience.roomId}`;
}

function sameAudience(left: SocialAudience | null | undefined, right: SocialAudience): boolean {
  return left !== null && left !== undefined && audienceKey(left) === audienceKey(right);
}

function locationAudience(location: unknown): SocialAudience | null {
  if (!isRecord(location) || typeof location.kind !== "string") return null;
  if (location.kind === "owner_dm" && typeof location.threadId === "string" && location.threadId.trim()) {
    return { kind: "owner_dm", threadId: location.threadId };
  }
  if (location.kind === "external_dm" && typeof location.principalId === "string" && location.principalId.trim()) {
    return { kind: "dm", principalId: location.principalId };
  }
  if (location.kind === "room") {
    if (typeof location.roomId === "string" && location.roomId.trim()) {
      return { kind: "room", roomId: location.roomId };
    }
    if (typeof location.guildId === "string" && typeof location.channelId === "string" &&
        location.guildId.trim() && location.channelId.trim()) {
      return { kind: "room", roomId: `room:${location.guildId}:${location.channelId}` };
    }
  }
  return null;
}

function evidenceMatchesAudience(
  row: ConversationEvidenceRecord,
  audience: SocialAudience,
): boolean {
  if (audience.kind === "owner_private") return true;
  if (audience.kind === "owner_dm") return false;
  if (row.audienceAtCapture !== (audience.kind === "dm" ? "dm" : "room")) return false;
  return sameAudience(locationAudience(row.location), audience);
}

function licenseRefsValid(value: AudienceBoundValue, licenses: readonly string[]): boolean {
  const refs = value.licenseRefs ?? [];
  return refs.every((ref) => typeof ref === "string" && licenses.includes(ref));
}

/**
 * External input requires an explicit scope and an admitted protection record.
 * Legacy Owner rows remain unchanged because Owner-private is the existing
 * source boundary, not a new disclosure decision.
 */
function structuredValueEligible(
  value: AudienceBoundValue,
  audience: SocialAudience,
  licenses: readonly string[],
): boolean {
  if (audience.kind === "owner_private") return true;
  if (value.dataClassification === "secret") return false;
  if (!value.audienceScope) return false;
  if (value.protectionStatus !== "admitted") return false;
  if (sameAudience(value.audienceScope, audience)) return licenseRefsValid(value, licenses);
  const refs = value.licenseRefs ?? [];
  return refs.length > 0 && licenseRefsValid(value, licenses);
}

function filterEvidence(
  rows: readonly ConversationEvidenceRecord[],
  audience: SocialAudience,
): ConversationEvidenceRecord[] {
  return audience.kind === "owner_private"
    ? [...rows]
    : rows.filter((row) =>
      row.dataClassification !== "secret" && !row.secretOmitted && evidenceMatchesAudience(row, audience));
}

function filterStructured<T extends AudienceBoundValue>(
  rows: readonly T[],
  audience: SocialAudience,
  licenses: readonly string[],
): T[] {
  return audience.kind === "owner_private"
    ? [...rows]
    : rows.filter((row) => structuredValueEligible(row, audience, licenses));
}

function filterInFlight(
  rows: readonly InFlightRecord[],
  audience: SocialAudience,
): InFlightRecord[] {
  if (audience.kind === "owner_private") return [...rows];
  // In-flight effects are already host-owned operational records. Their
  // audience binding is the required protection boundary; unlike semantic
  // memory, they do not need a second admission facet to remain visible to
  // the same lifecycle.
  return rows.filter((row) => sameAudience(row.audienceScope, audience));
}

function filterConstitution(
  constitution: IdentitySlice,
  audience: SocialAudience,
): IdentitySlice {
  if (audience.kind === "owner_private") return constitution;
  const marked = constitution as IdentitySlice & {
    privateDerivative?: readonly string[];
    privateDerivativeIndexes?: readonly number[];
  };
  const denied = new Set(marked.privateDerivative ?? []);
  const deniedIndexes = new Set(marked.privateDerivativeIndexes ?? []);
  return {
    constitutional: constitution.constitutional.filter((entry, index) =>
      !denied.has(entry) && !deniedIndexes.has(index)),
    stableSelf: constitution.stableSelf.filter((entry, index) =>
      !denied.has(entry) && !deniedIndexes.has(index)),
  };
}

export function filterCapabilityReality(
  capability: CapabilityReality,
  audience: SocialAudience,
  licenses: readonly string[],
  authenticatedOwner = false,
): CapabilityReality {
  if (audience.kind === "owner_private" || (authenticatedOwner && audience.kind === "room")) {
    return capability.reachability === undefined
      ? capability
      : {
          ...capability,
          reachability: {
            ...capability.reachability,
            audience: { ...audience },
          },
        };
  }
  const capabilityAllowed = (name: string): boolean =>
    licenses.includes(name) || licenses.includes(`capability:${name}`);
  const previousReasons = capability.reachability?.reasons ?? {};
  const reasonFor = (
    name: string,
    value: boolean,
    sourceValue: boolean,
    options: { licenseName?: string; ownerOnly?: boolean; perception?: boolean } = {},
  ): CapabilityRealityReasonCode => {
    if (value) return "capability_exists";
    if (options.ownerOnly && sourceValue) return "another_audience_only";
    if (sourceValue && !capabilityAllowed(options.licenseName ?? name)) return "needs_owner_approval";
    if (options.perception && !sourceValue) return "evidence_not_acquired";
    return previousReasons[name] ?? "unavailable";
  };
  const filtered = {
    ...capability,
    vision: capability.vision && capabilityAllowed("vision"),
    attachmentText: capability.attachmentText && capabilityAllowed("attachment_text"),
    conversationalRead: capability.conversationalRead && capabilityAllowed("conversational_read"),
    webSearch: capability.webSearch && capabilityAllowed("web_search"),
    canOfferProjectInspection: false,
    canOfferWorkspace: false,
    canOfferVerification: false,
    canOfferAuthorship: false,
    canOfferBoundedOperation: false,
    canOfferPatchExport: false,
    approvedProjectIds: [],
    operationCapabilities: capability.operationCapabilities?.map((item) => ({ ...item, available: false })),
    publicPresence: undefined,
  };
  const reasons: Record<string, CapabilityRealityReasonCode> = {
    vision: reasonFor("vision", filtered.vision, capability.vision, { licenseName: "vision", perception: true }),
    attachmentText: reasonFor("attachmentText", filtered.attachmentText, capability.attachmentText, {
      licenseName: "attachment_text",
      perception: true,
    }),
    conversationalRead: reasonFor("conversationalRead", filtered.conversationalRead, capability.conversationalRead, {
      licenseName: "conversational_read",
      perception: true,
    }),
    webSearch: reasonFor("webSearch", filtered.webSearch, capability.webSearch, {
      licenseName: "web_search",
      perception: true,
    }),
    canOfferProjectInspection: reasonFor("canOfferProjectInspection", false, capability.canOfferProjectInspection, { ownerOnly: true }),
    canOfferWorkspace: reasonFor("canOfferWorkspace", false, capability.canOfferWorkspace, { ownerOnly: true }),
    canOfferVerification: reasonFor("canOfferVerification", false, capability.canOfferVerification, { ownerOnly: true }),
    canOfferAuthorship: reasonFor("canOfferAuthorship", false, capability.canOfferAuthorship, { ownerOnly: true }),
    canOfferBoundedOperation: reasonFor("canOfferBoundedOperation", false, capability.canOfferBoundedOperation),
    canOfferPatchExport: reasonFor("canOfferPatchExport", false, capability.canOfferPatchExport),
  };
  for (const item of capability.operationCapabilities ?? []) {
    reasons[item.operationKind] = reasonFor(item.operationKind, false, item.available, { ownerOnly: true });
  }
  return {
    ...filtered,
    reachability: {
      audience: { ...audience },
      reasons,
    },
  };
}

function filterLearnedSelf(
  slice: LearnedSelfSlice,
  audience: SocialAudience,
  licenses: readonly string[],
): LearnedSelfSlice {
  if (audience.kind === "owner_private") return slice;
  const broad = slice.broadOrientation;
  const broadAllowed = broad && structuredValueEligible(broad, audience, licenses)
    ? broad
    : undefined;
  const linked = (slice.personLinked ?? []).filter((entry) =>
    sameAudience(entry.audience, audience) &&
    (entry.protectionStatus === undefined || entry.protectionStatus === "admitted") &&
    licenseRefsValid(entry, licenses));
  const dispositions = [
    ...(broadAllowed?.dispositions ?? []),
    ...linked.flatMap((entry) => entry.dispositions),
  ];
  const interests = [
    ...(broadAllowed?.interests ?? []),
    ...linked.flatMap((entry) => entry.interests),
  ];
  const supportRefs = [
    ...(broadAllowed?.supportRefs ?? []),
    ...linked.flatMap((entry) => entry.supportRefs ?? []),
  ];
  const result: LearnedSelfSlice = {
    dispositions: [...new Set(dispositions)],
    interests: [...new Set(interests)],
    ...(supportRefs.length === 0 ? {} : { supportRefs: [...new Set(supportRefs)] }),
    ...(broadAllowed === undefined ? {} : { broadOrientation: broadAllowed }),
    ...(linked.length === 0 ? {} : { personLinked: linked }),
  };
  return result;
}

function tokenize(text: string): string[] {
  return tokenizeForQuery(text);
}

function loadWorkingContext(db: DatabaseSync, conversationId: string): WorkingContextItem[] {
  const rows = db.prepare(
    `SELECT id, conversation_id, type, payload_json, superseded, updated_generation
       FROM working_context_items
      WHERE conversation_id = ? AND superseded = 0
      ORDER BY COALESCE(updated_generation, 0) DESC, id ASC`,
  ).all(conversationId);
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const payload = jsonValue(row.payload_json);
    if (!isRecord(payload)) return [];
    return [{
      id: typeof row.id === "string" ? row.id : String(row.id ?? ""),
      conversationId,
      type: payload.type as WorkingContextItem["type"],
      text: typeof payload.text === "string" ? payload.text : "",
      concernId: typeof payload.concernId === "string" ? payload.concernId : null,
      sourceTurnIds: Array.isArray(payload.sourceTurnIds) ? payload.sourceTurnIds.filter((id): id is string => typeof id === "string") : [],
      status: payload.status === "abandoned" || payload.status === "superseded" ? payload.status : "active",
      supersedesId: typeof payload.supersedesId === "string" ? payload.supersedesId : null,
      updatedGeneration: Number(row.updated_generation ?? payload.updatedGeneration ?? 0),
      audienceScope: isRecord(payload.audienceScope) ? payload.audienceScope as WorkingContextItem["audienceScope"] : null,
      sourcePrincipal: typeof payload.sourcePrincipal === "string" ? payload.sourcePrincipal : null,
      sourceEvidenceRef: typeof payload.sourceEvidenceRef === "string" ? payload.sourceEvidenceRef : null,
      protectionSubjects: Array.isArray(payload.protectionSubjects)
        ? payload.protectionSubjects.filter((value): value is string => typeof value === "string")
        : null,
      protectionBasisRefs: Array.isArray(payload.protectionBasisRefs)
        ? payload.protectionBasisRefs.filter((value): value is string => typeof value === "string")
        : [],
      protectionStatus: payload.protectionStatus === "admitted" || payload.protectionStatus === "unresolved"
        ? payload.protectionStatus
        : null,
      licenseRefs: Array.isArray(payload.licenseRefs)
        ? payload.licenseRefs.filter((value): value is string => typeof value === "string")
        : [],
    } satisfies WorkingContextItem];
  });
}

function loadOccupancy(db: DatabaseSync, conversationId: string, limit: number): MindOccupancy[] {
  const rows = db.prepare(
    `SELECT conversation_id, concern_id, status, priority, updated_cycle, updated_generation
       FROM mind_occupancy
      WHERE conversation_id = ?
      ORDER BY priority DESC, updated_generation DESC, concern_id ASC
      LIMIT ?`,
  ).all(conversationId, limit);
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    return [{
      conversationId: String(row.conversation_id ?? conversationId),
      concernId: String(row.concern_id ?? ""),
      status: String(row.status ?? "active") as MindOccupancy["status"],
      priority: Number(row.priority ?? 0),
      updatedCycle: String(row.updated_cycle ?? ""),
      updatedGeneration: Number(row.updated_generation ?? 0),
    } satisfies MindOccupancy];
  });
}

export type ConversationSelectionOptions = {
  lastNTurns?: number;
  triggerEvidence?: ConversationEvidenceRecord | null;
  composeLogIds?: string[];
  activeFrontier?: DeferredReactiveFrontierRecord | null;
  /** Test/recovery seam for already loaded evidence; obligations still read the store. */
  suppliedEvidence?: ConversationEvidenceRecord[];
};

export type ConversationSelectionResult = {
  selectedEvidence: ConversationEvidenceRecord[];
  frontierIncludedIds: string[];
  omittedEvidenceIds: string[];
  currentTriggerRowId: string | null;
};

function orderedEvidence(rows: ConversationEvidenceRecord[]): ConversationEvidenceRecord[] {
  return [...rows].sort((left, right) =>
    left.createdAtMs - right.createdAtMs || left.rowId.localeCompare(right.rowId),
  );
}

/**
 * Select the ordinary recency window plus every active frontier obligation.
 * Required frontier evidence fails closed when it cannot be recovered.
 */
export function frontierAwareEvidenceSelection(
  db: DatabaseSync,
  conversationId: string,
  options: ConversationSelectionOptions = {},
): ConversationSelectionResult {
  const lastNTurns = Math.max(1, Math.floor(options.lastNTurns ?? DEFAULT_LAST_N_TURNS));
  const all = options.suppliedEvidence ?? listConversationEvidence(db, conversationId, {
    limit: 1000,
    includeOlderVersions: false,
  });
  const ordered = orderedEvidence(all.filter((row) => row.conversationId === conversationId));
  const latestByLineage = new Map<string, ConversationEvidenceRecord>();
  for (const row of ordered) latestByLineage.set(row.lineageId, row);
  const selectedMap = new Map<string, ConversationEvidenceRecord>();
  for (const row of ordered.slice(-lastNTurns)) selectedMap.set(row.rowId, row);

  function addCurrentEvidence(row: ConversationEvidenceRecord): ConversationEvidenceRecord {
    if (row.conversationId !== conversationId) {
      throw new Error(`active_frontier_required_evidence_missing:${row.rowId}`);
    }
    const current = latestByLineage.get(row.lineageId) ?? row;
    selectedMap.set(current.rowId, current);
    return current;
  }

  let currentTriggerRowId: string | null = null;
  if (options.triggerEvidence) {
    currentTriggerRowId = addCurrentEvidence(options.triggerEvidence).rowId;
  }

  // composeLogIds are obligations only while an active deferred frontier owns
  // the conversation. Resolved and exhausted frontiers return to recency.
  const requiredRowIds = new Set<string>();
  if (options.activeFrontier) {
    for (const id of options.composeLogIds ?? []) {
      if (id.trim()) requiredRowIds.add(id);
    }
    if (options.activeFrontier.latestEvidenceRowId.trim()) {
      requiredRowIds.add(options.activeFrontier.latestEvidenceRowId);
    }
  }

  const frontierIncludedIds: string[] = [];
  const frontierIncludedSet = new Set<string>();
  for (const requiredId of requiredRowIds) {
    const supplied = ordered.find((row) => row.rowId === requiredId);
    const turn = supplied ?? getConversationEvidence(db, requiredId);
    if (!turn || turn.conversationId !== conversationId) {
      throw new Error(`active_frontier_required_evidence_missing:${requiredId}`);
    }
    const current = addCurrentEvidence(turn);
    if (!frontierIncludedSet.has(current.rowId)) {
      frontierIncludedSet.add(current.rowId);
      frontierIncludedIds.push(current.rowId);
    }
  }

  const selectedEvidence = orderedEvidence([...selectedMap.values()]);
  return {
    selectedEvidence,
    frontierIncludedIds,
    currentTriggerRowId,
    omittedEvidenceIds: [],
  };
}

function emptyRuntimeCondition(partial?: Partial<RuntimeCondition>): RuntimeCondition {
  return {
    fallback: partial?.fallback ?? false,
    compression: partial?.compression ?? false,
    lookupFailed: partial?.lookupFailed ?? false,
    thoughtUnavailable: partial?.thoughtUnavailable ?? false,
  };
}

function hasTable(db: DatabaseSync, name: string): boolean {
  try {
    const row = db.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(name) as { present?: number } | undefined;
    return Number(row?.present ?? 0) === 1;
  } catch {
    return false;
  }
}

function canReadNuclearOwnTime(db: DatabaseSync): boolean {
  // The live serve path supplies nuclear.db as authorityDb. The second
  // marker keeps older sidecar-only test/recovery seams optional while still
  // allowing a missing own_time_sessions table to surface as UNREACHABLE on a
  // recognizably nuclear database.
  return hasTable(db, "own_time_sessions") || hasTable(db, "internal_state");
}

function appendOwnTimePointer(
  section: DomainPointersSection,
  candidate: OwnTimeSessionCandidate,
): DomainPointersSection {
  if (section.pointers.some((pointer) => pointer.domain === candidate.domain)) return section;
  const augmented = {
    version: section.version,
    conversationId: section.conversationId,
    cycleId: section.cycleId,
    pointers: Object.freeze([...section.pointers, candidate]),
  } as DomainPointersSection & {
    coverageManifest: DomainPointersSection["coverageManifest"];
  };
  Object.defineProperty(augmented, "coverageManifest", {
    value: section.coverageManifest,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(augmented);
}

function occupancySelection(
  db: DatabaseSync,
  conversationId: string,
  limit: number,
  supplied?: MindOccupancy[],
): { selected: MindOccupancy[]; boundary: MindOccupancy | null } {
  if (supplied) return { selected: supplied.slice(0, limit), boundary: null };
  const rows = loadOccupancy(db, conversationId, limit + 1);
  return { selected: rows.slice(0, limit), boundary: rows[limit] ?? null };
}

/**
 * Capture every mechanically relevant source used by one semantic pass.
 * Callers pass this package back to buildThoughtInput so no second source read
 * can silently diverge from the currentness witness.
 */
export function captureThoughtSourcePackage(
  options: BuildThoughtInputOptions,
  occupancyK = Math.max(1, Math.min(100, options.occupancyK ?? DEFAULT_OCCUPANCY_COMPACT_K)),
): ThoughtSourceCapture {
  const workingContext = options.workingContext
    ?? listWorkingContext(options.sidecar, options.cycle.conversationId);
  const audience = options.audience ?? ownerAudience();
  const licenses = options.licenses ?? [];
  const eligibleWorkingContext = filterStructured(workingContext, audience, licenses);
  const deskEntries = options.deskEntries ?? listDeskEntries(options.sidecar, { audience });
  const eligibleDeskEntries = deskEntries.filter((entry) => isDeskEntryAudienceEligible(entry, audience));
  const selectedOccupancy = occupancySelection(
    options.sidecar,
    options.cycle.conversationId,
    occupancyK,
    options.occupancy,
  );
  const eligibleOccupancy = filterStructured(selectedOccupancy.selected, audience, licenses);
  const baseDomainPointers = options.domainPointers ?? buildDomainPointers(
    options.sidecar,
    options.cycle.conversationId,
    options.cycle.cycleId,
    options.authorityDb,
    options.cycle.occupantId,
  );
  const domainPointers = options.authorityDb && canReadNuclearOwnTime(options.authorityDb)
    ? appendOwnTimePointer(
      baseDomainPointers,
      adaptOwnTimeSession(options.authorityDb, options.cycle.occupantId),
    )
    : baseDomainPointers;

  const relevantConcernIds = new Set<string>();
  for (const item of eligibleWorkingContext) if (item.concernId) relevantConcernIds.add(item.concernId);
  for (const item of eligibleOccupancy) relevantConcernIds.add(item.concernId);
  for (const pointer of domainPointers.pointers) {
    for (const evidence of pointer.terminalEvidence ?? []) relevantConcernIds.add(evidence.concernId);
  }

  let futureRows: Array<Record<string, unknown>> = [];
  try {
    futureRows = options.sidecar.prepare(
      `SELECT concern_id FROM future_triggers
        WHERE conversation_id = ? AND status IN ('scheduled', 'suppressed_stale')
        ORDER BY due_at_ms ASC, trigger_id ASC`,
    ).all(options.cycle.conversationId) as Array<Record<string, unknown>>;
  } catch {
    futureRows = [];
  }
  for (const row of futureRows) {
    if (typeof row.concern_id === "string" && row.concern_id.trim()) relevantConcernIds.add(row.concern_id);
  }

  const concernDependencies: Record<string, ConcernCurrentnessEntry | null> = {};
  const concernSnapshots: Record<string, string> = {};
  const concernsById = new Map(
    listConcerns(options.sidecar, options.cycle.conversationId)
      .filter((concern) => structuredValueEligible(concern, audience, licenses))
      .map((concern) => [concern.concernId, concern] as const),
  );
  for (const concernId of [...relevantConcernIds].sort()) {
    const concern = concernsById.get(concernId);
    concernDependencies[concernId] = concern ? currentConcernDependency(concern) : null;
    if (concern) concernSnapshots[concernId] = concern.snapshotHash;
  }
  const occupiedConcernProjection = buildOccupiedConcernProjection(
    eligibleOccupancy,
    [...concernsById.values()],
  );

  const futurePointer = domainPointers.pointers.find((pointer) => pointer.domain === "future_triggers");
  const sourceCurrentness = captureThoughtSourceCurrentness(
    options.sidecar,
    options.authorityDb,
    options.cycle.occupantId,
    eligibleWorkingContext,
    {
      conversationId: options.cycle.conversationId,
      workingContext: eligibleWorkingContext,
      occupancy: eligibleOccupancy,
      occupancyLimit: occupancyK,
      occupancyBoundary: selectedOccupancy.boundary,
      concernMembership: domainPointers.pointers.find((pointer) => pointer.domain === "concerns")?.entityIds ?? [],
      concernDependencies,
      scheduledFutureTriggerIds: futurePointer?.entityIds ?? [],
      terminalEvidence: futurePointer?.terminalEvidence ?? [],
    },
  );
  return Object.freeze({
    workingContext: Object.freeze([...eligibleWorkingContext]),
    deskEntries: Object.freeze([...eligibleDeskEntries]),
    occupancy: Object.freeze([...eligibleOccupancy]),
    occupiedConcernProjection,
    concernSnapshots: Object.freeze({ ...concernSnapshots }),
    domainPointers,
    sourceCurrentness,
  });
}

/** Assemble the fixed Thought input set. Workspace notes are intentionally absent. */
export function buildThoughtInput(options: BuildThoughtInputOptions): ThoughtInputWithC2 {
  const lastNTurns = Math.max(1, Math.min(100, options.lastNTurns ?? DEFAULT_LAST_N_TURNS));
  const occupancyK = Math.max(1, Math.min(100, options.occupancyK ?? DEFAULT_OCCUPANCY_COMPACT_K));
  const audience = options.audience ?? ownerAudience();
  const licenses = options.licenses ?? [];
  const sourceCapture = options.sourceCapture ?? captureThoughtSourcePackage(options, occupancyK);
  const activeFrontier = getActiveDeferredFrontier(
    options.sidecar,
    options.cycle.conversationId,
  );
  const conversationSelection = frontierAwareEvidenceSelection(
    options.sidecar,
    options.cycle.conversationId,
    {
      lastNTurns,
      triggerEvidence: options.triggerEvidence,
      composeLogIds: activeFrontier ? options.cycle.composeLogIds : [],
      activeFrontier,
      suppliedEvidence: options.rawConversation,
    },
  );
  const rawConversation = filterEvidence(conversationSelection.selectedEvidence, audience);
  const workingContext = filterStructured(sourceCapture.workingContext, audience, licenses);
  const deskEntries = sourceCapture.deskEntries.filter((entry) => isDeskEntryAudienceEligible(entry, audience));
  const selectedOccupancy = filterStructured(sourceCapture.occupancy, audience, licenses);
  const occupancy = enrichOccupancyForThought(
    selectedOccupancy,
    sourceCapture.occupiedConcernProjection.filter((item) =>
      selectedOccupancy.some((row) => row.concernId === item.concernId)),
  );
  const concernIds = new Set([
    ...workingContext.flatMap((item) => item.concernId ? [item.concernId] : []),
    ...selectedOccupancy.map((item) => item.concernId),
  ]);
  const concernSnapshots = Object.fromEntries(
    Object.entries(sourceCapture.concernSnapshots).filter(([concernId]) => concernIds.has(concernId)),
  );
  const learnedSelfSlice = filterLearnedSelf(
    options.learnedSelfSlice ?? buildLearnedSelfSlice(options.sidecar),
    audience,
    licenses,
  );
  const constitution = filterConstitution(options.constitution, audience);
  const capabilityReality = filterCapabilityReality(
    options.capabilityReality,
    audience,
    licenses,
    options.authenticatedOwner === true,
  );
  const identity = constitution as IdentitySlice & Partial<IdentityOrientationSource>;
  const orientationKernel = options.orientationKernel && audience.kind === "owner_private"
    ? options.orientationKernel
    : buildOrientationKernel({
    constitution: identity,
    capabilityReality,
    staticOperatingContract: options.staticOperatingContract,
    stableSelfBound: options.stableSelfBound,
    learnedSelf: learnedSelfSlice,
  });
  const domainPointers = sourceCapture.domainPointers;
  const c3Experiences = options.c3Experiences ?? adaptC3Experiences(
    options.sidecar,
    options.cycle.conversationId,
    {
      cycleId: options.cycle.cycleId,
      generation: options.cycle.generation,
      obligationFrontierId: activeFrontier?.frontierId,
      enabled: options.c3AdapterEnabled,
    },
  );
  const triggerText = options.triggerText ?? options.cycle.triggerRef;
  const query = buildRetrievalQuery({
    triggerText,
    workingContext,
    occupancy,
    db: options.sidecar,
  });

  const rawConversationRowIds = new Set(rawConversation.map((r) => r.rowId));

  const eligibleObservations = filterStructured(options.observations ?? [], audience, licenses);
  const eligibleInFlight = filterInFlight(
    options.inFlight ?? listInFlight(options.sidecar, options.cycle.cycleId),
    audience,
  );
  const rememberDirective = options.rememberDirective && structuredValueEligible(
    options.rememberDirective,
    audience,
    licenses,
  ) ? options.rememberDirective : null;

  const retrieval = retrieveCandidates(
    options.sidecar,
    {
      conversationId: options.cycle.conversationId,
      request: {
        triggerTerms: query.rawTriggerTerms,
        workingContextTopics: query.concernTerms,
        assertionKeys: query.exactKeys,
        includeLogSearch: true,
      },
      rawConversationRowIds,
      ownerId: options.cycle.occupantId,
      ...(audience.kind === "owner_private" &&
      options.crossSurfaceConversationIds &&
      options.crossSurfaceConversationIds.length > 0
        ? { crossSurfaceConversationIds: options.crossSurfaceConversationIds }
        : {}),
    },
    options.derivedStore,
    { authorityDb: options.authorityDb, audience, licenses, ownerId: options.cycle.occupantId },
  );

  const thoughtInput: ThoughtInputWithC2 = {
    cycleId: options.cycle.cycleId,
    generation: options.cycle.generation,
    occupantId: options.cycle.occupantId,
    authorityEpoch: options.cycle.authorityEpoch,
    trigger: {
      kind: options.triggerKindOverride ?? options.cycle.triggerKind as CycleTriggerKind,
      ref: options.cycle.triggerRef,
    },
    ...(options.commitmentDue === undefined ? {} : { commitmentDue: { ...options.commitmentDue } }),
    rawConversation,
    ...(conversationSelection.frontierIncludedIds.length > 0 || conversationSelection.currentTriggerRowId !== null
      ? {
          conversationSelection: {
            frontierIncludedIds: conversationSelection.frontierIncludedIds.filter((id) =>
              rawConversation.some((row) => row.rowId === id)),
            omittedEvidenceIds: conversationSelection.omittedEvidenceIds,
            ...(conversationSelection.currentTriggerRowId === null ||
              !rawConversation.some((row) => row.rowId === conversationSelection.currentTriggerRowId)
              ? {}
              : { currentTriggerRowId: conversationSelection.currentTriggerRowId }),
          },
        }
      : {}),
    workingContext,
    ...(deskEntries.length > 0 ? { deskEntries } : {}),
    occupancy,
    concernSnapshots,
    // Keep the legacy IdentitySlice wire shape compact. The richer
    // category-separated fields have already been captured by the orientation
    // kernel and must not be duplicated in the old compatibility field.
    constitution: {
      constitutional: [...constitution.constitutional],
      stableSelf: [...constitution.stableSelf],
    },
    learnedSelfSlice,
    capabilityReality,
    ...(options.publicPresence === undefined ? {} : { publicPresence: options.publicPresence }),
    ...(options.availableDestinations === undefined ? {} : {
      availableDestinations: options.availableDestinations.map((item) => ({
        audience: { ...item.audience },
        source: item.source,
        permitScope: item.permitScope,
      })),
    }),
    observations: eligibleObservations,
    retrieval,
    inFlight: eligibleInFlight,
    authorityObjections: options.authorityObjections ?? [],
    runtimeCondition: emptyRuntimeCondition(options.runtimeCondition),
    rememberDirective,
    orientationKernel,
    domainPointers,
    c3Experiences,
  };

  Object.defineProperty(thoughtInput, "sourceCurrentness", {
    value: sourceCapture.sourceCurrentness,
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return thoughtInput;
}
