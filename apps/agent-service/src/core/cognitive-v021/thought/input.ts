import type { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_LAST_N_TURNS,
  DEFAULT_OCCUPANCY_COMPACT_K,
  type CapabilityReality,
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
} from "../types.js";
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

export type BuildThoughtInputOptions = {
  sidecar: DatabaseSync;
  cycle: CycleRecord;
  triggerText?: string;
  triggerEvidence?: ConversationEvidenceRecord | null;
  rawConversation?: ConversationEvidenceRecord[];
  workingContext?: WorkingContextItem[];
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
  /** One coherent source package for the current semantic pass. */
  sourceCapture?: ThoughtSourceCapture;
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
  const selectedOccupancy = occupancySelection(
    options.sidecar,
    options.cycle.conversationId,
    occupancyK,
    options.occupancy,
  );
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
  for (const item of workingContext) if (item.concernId) relevantConcernIds.add(item.concernId);
  for (const item of selectedOccupancy.selected) relevantConcernIds.add(item.concernId);
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
      .map((concern) => [concern.concernId, concern] as const),
  );
  for (const concernId of [...relevantConcernIds].sort()) {
    const concern = concernsById.get(concernId);
    concernDependencies[concernId] = concern ? currentConcernDependency(concern) : null;
    if (concern) concernSnapshots[concernId] = concern.snapshotHash;
  }
  const occupiedConcernProjection = buildOccupiedConcernProjection(
    selectedOccupancy.selected,
    [...concernsById.values()],
  );

  const futurePointer = domainPointers.pointers.find((pointer) => pointer.domain === "future_triggers");
  const sourceCurrentness = captureThoughtSourceCurrentness(
    options.sidecar,
    options.authorityDb,
    options.cycle.occupantId,
    workingContext,
    {
      conversationId: options.cycle.conversationId,
      workingContext,
      occupancy: selectedOccupancy.selected,
      occupancyLimit: occupancyK,
      occupancyBoundary: selectedOccupancy.boundary,
      concernMembership: domainPointers.pointers.find((pointer) => pointer.domain === "concerns")?.entityIds ?? [],
      concernDependencies,
      scheduledFutureTriggerIds: futurePointer?.entityIds ?? [],
      terminalEvidence: futurePointer?.terminalEvidence ?? [],
    },
  );
  return Object.freeze({
    workingContext: Object.freeze([...workingContext]),
    occupancy: Object.freeze([...selectedOccupancy.selected]),
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
  const rawConversation = conversationSelection.selectedEvidence;
  const workingContext = [...sourceCapture.workingContext];
  const occupancy = enrichOccupancyForThought(
    sourceCapture.occupancy,
    sourceCapture.occupiedConcernProjection,
  );
  const concernSnapshots = sourceCapture.concernSnapshots;
  const learnedSelfSlice = options.learnedSelfSlice ?? buildLearnedSelfSlice(options.sidecar);
  const identity = options.constitution as IdentitySlice & Partial<IdentityOrientationSource>;
  const orientationKernel = options.orientationKernel ?? buildOrientationKernel({
    constitution: identity,
    capabilityReality: options.capabilityReality,
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
    },
    options.derivedStore,
    { authorityDb: options.authorityDb },
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
    rawConversation,
    ...(conversationSelection.frontierIncludedIds.length > 0 || conversationSelection.currentTriggerRowId !== null
      ? {
          conversationSelection: {
            frontierIncludedIds: conversationSelection.frontierIncludedIds,
            omittedEvidenceIds: conversationSelection.omittedEvidenceIds,
            ...(conversationSelection.currentTriggerRowId === null
              ? {}
              : { currentTriggerRowId: conversationSelection.currentTriggerRowId }),
          },
        }
      : {}),
    workingContext,
    occupancy,
    concernSnapshots,
    // Keep the legacy IdentitySlice wire shape compact. The richer
    // category-separated fields have already been captured by the orientation
    // kernel and must not be duplicated in the old compatibility field.
    constitution: {
      constitutional: [...options.constitution.constitutional],
      stableSelf: [...options.constitution.stableSelf],
    },
    learnedSelfSlice,
    capabilityReality: options.capabilityReality,
    observations: options.observations ?? [],
    retrieval,
    inFlight: options.inFlight ?? listInFlight(options.sidecar, options.cycle.cycleId),
    authorityObjections: options.authorityObjections ?? [],
    runtimeCondition: emptyRuntimeCondition(options.runtimeCondition),
    rememberDirective: options.rememberDirective ?? null,
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
