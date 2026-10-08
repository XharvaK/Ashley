import { readHomeFile } from "../../home/home.js";
import type { DatabaseSync } from "node:sqlite";
import { searchEpisodes, toThoughtEpisode } from "../memory/episodes.js";
import { lookupTerms } from "../memory/lookup-terms.js";
import { WORKSPACE_WORKER_REQUEST_SCHEMA_ID } from "@composer-assistant/sandbox-v2";
import { sha256 } from "../../model-fabric/hash.js";
import { currentReleaseId } from "../../rollout/capabilities.js";
import type { WebSearchProvider } from "../../perception/search-provider.js";
import { THOUGHT_OUTPUT_SCHEMA_ID } from "../thought/contract-identity.js";
import { getCapabilityReality } from "../thought/capability-reality.js";
import { observationViewFromStorage } from "../observation/view.js";
import { listInFlightForThoughtCycle } from "../effect/in-flight.js";
import { projectInFlightConsequence } from "../thought/consequence-projection.js";
import { listConcerns } from "../concerns/lineage.js";
import { listFutureTriggers } from "../initiative/future-triggers.js";
import { listObservationSubscriptions } from "../observation/subscriptions.js";
import { projectSocialOperationDelegations } from "../../relationship/social-authority.js";
import type { Observation, ObservationRequest } from "../types.js";
import { listLiveMemoryAssertions, REDACTED_MEMORY_STATEMENT } from "../memory/assertions.js";
import { strengthScores } from "../memory/strength.js";
import type { SocialAudience } from "../social/types.js";
import {
  CapabilityUnavailableError,
  isValidTypedInspectionRequest,
  safeReasonCode,
} from "../thought/typed-inspection.js";

type Scope = {
  cycleId: string;
  generation: number;
  conversationId: string;
  ownerId: string;
};

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedLimit(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(64, Math.max(1, value)) : 32;
}

function cursorScope(scope: Scope, kind: string, filter?: unknown): string {
  return sha256({
    cycleId: scope.cycleId,
    generation: scope.generation,
    conversationId: scope.conversationId,
    ownerId: scope.ownerId,
    kind,
    filter,
  });
}

function offsetFromCursor(value: unknown, expectedScope: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "string") throw new CapabilityUnavailableError("inspect_cursor_invalid");
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || parts[1] !== expectedScope) {
    throw new CapabilityUnavailableError("inspect_cursor_scope_mismatch");
  }
  const offset = Number(parts[2]);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new CapabilityUnavailableError("inspect_cursor_invalid");
  return offset;
}

function nextCursor(offset: number, hasMore: boolean, scopeHash: string): string | null {
  return hasMore ? "v1." + scopeHash + "." + String(offset) : null;
}

function observation(
  req: ObservationRequest,
  kind: string,
  payload: Record<string, unknown>,
): Observation {
  return {
    observationId: "v021:observation:" + req.requestId,
    cycleId: req.cycleId,
    generation: req.generation,
    derived: false,
    replaySafe: true,
    modality: "tool",
    payload,
    provenance: "sidecar:" + kind,
    dataClassification: "never_public",
    secretOmitted: true,
  };
}

function requireScope(
  req: ObservationRequest,
  sidecar: DatabaseSync | undefined,
  ownerId: string | undefined,
): Scope {
  if (req.audience?.kind !== "owner_private") {
    throw new CapabilityUnavailableError("capability_not_in_live_set");
  }
  if (!sidecar || !ownerId) throw new CapabilityUnavailableError("inspect_unavailable");
  const row = sidecar.prepare(
    "SELECT cycle_id, generation, conversation_id, occupant_id FROM cycle_records WHERE cycle_id = ? AND generation = ?",
  ).get(req.cycleId, req.generation) as Row | undefined;
  if (
    !row
    || row.cycle_id !== req.cycleId
    || Number(row.generation) !== req.generation
    || row.occupant_id !== ownerId
    || typeof row.conversation_id !== "string"
    || row.conversation_id.length === 0
  ) {
    throw new CapabilityUnavailableError("inspect_scope_unavailable");
  }
  return {
    cycleId: req.cycleId,
    generation: req.generation,
    conversationId: row.conversation_id,
    ownerId,
  };
}

function namedCapability(
  req: ObservationRequest,
  nuclear: DatabaseSync,
  nowMs: () => number,
  webSearchProvider?: Pick<WebSearchProvider, "available">,
): Observation {
  const request = req.request as { operationKind: string };
  const reality = getCapabilityReality(nuclear, {
    audience: req.audience as SocialAudience,
    nowMs: nowMs(),
    webSearchProvider,
  });
  const name = request.operationKind;
  const operation = reality.operationCapabilities?.find((item) => item.operationKind === name);
  const semantic = reality.semanticObservations?.find((item) => item.operationKind === name);
  // W3-P7 is capability discovery only. A renderer is not present in this
  // candidate, so the inspection surface reports the bounded affordance as
  // unavailable without advertising a new executable operation.
  const renderedViewUnavailable = name === "rendered_view";
  if (!operation && !semantic && !renderedViewUnavailable) {
    throw new CapabilityUnavailableError("operation_not_available");
  }
  const schemaId = name === "candidate.develop"
    ? WORKSPACE_WORKER_REQUEST_SCHEMA_ID
    : THOUGHT_OUTPUT_SCHEMA_ID;
  const capability = operation
    ? {
        ...operation,
        authorityConditions: [...operation.authorityConditions],
        hardLimits: [...operation.hardLimits],
      }
    : semantic
      ? {
        operationKind: semantic?.operationKind,
        semanticClass: semantic?.semanticClass,
        readOnly: true,
        available: semantic?.available === true,
        authorityConditions: [
          "Owner-private audience is required.",
          "The current cycle must belong to the configured Owner.",
        ],
        hardLimits: [
          "Read-only metadata inspection.",
          "No content bytes or write authority are returned.",
          "No social-operation delegation record is available.",
        ],
        authorizedProjectIds: [],
      }
      : {
        operationKind: "rendered_view",
        semanticClass: "observation" as const,
        readOnly: true as const,
        available: false,
        authorityConditions: [
          "Owner-private audience is required.",
          "The current cycle must belong to the configured Owner.",
        ],
        hardLimits: [
          "Read-only capability metadata only; no screenshot is captured.",
          "No browser, desktop driver, click, form-fill, or navigation authority is available.",
        ],
        authorizedProjectIds: [],
      };
  const availability = operation?.available ?? semantic?.available ?? false;
  const reasonCode = availability
    ? null
    : reality.reachability?.reasons[name] ?? "unavailable";
  const socialOperationDelegation = projectSocialOperationDelegations(nuclear, {
    audience: req.audience as SocialAudience | undefined,
    nowMs: nowMs(),
  });
  return observation(req, "capability.inspect", {
    operationKind: name,
    schemaId,
    availability,
    reasonCode,
    capability,
    authorityConditions: capability.authorityConditions,
    targets: capability.authorizedProjectIds,
    limits: capability.hardLimits,
    ...(renderedViewUnavailable ? { rendered_view: "unavailable" } : {}),
    releaseAsOf: reality.asOf ?? {
      capturedAtMs: nowMs(),
      releaseId: currentReleaseId(),
      status: "no_row",
      releaseRows: [],
    },
    socialOperationDelegation,
  });
}

function inspectEvidence(
  req: ObservationRequest,
  sidecar: DatabaseSync,
  scope: Scope,
  nowMs: () => number,
): Observation {
  const request = req.request as { filter?: { modality?: string }; limit?: number; cursor?: string };
  const limit = boundedLimit(request.limit);
  const filter = request.filter ?? {};
  const scopeHash = cursorScope(scope, "evidence.inspect", filter);
  const offset = offsetFromCursor(request.cursor, scopeHash);
  const rows = sidecar.prepare(
    "SELECT o.observation_id, o.modality, o.provenance, o.data_classification, " +
    "o.derived, o.created_at_ms, o.parent_artifact_id, o.representation_id, " +
    "o.view_metadata_json FROM observations o " +
    "JOIN cycle_records c ON c.cycle_id = o.cycle_id AND c.generation = o.generation " +
    "WHERE c.conversation_id = ? AND c.occupant_id = ? " +
    "AND o.secret_omitted = 0 " +
    "AND lower(o.data_classification) NOT IN ('secret', 'forgotten') " +
    "ORDER BY o.created_at_ms ASC, o.observation_id ASC",
  ).all(scope.conversationId, scope.ownerId) as Row[];
  const matched = rows.filter((row) =>
    filter.modality === undefined || row.modality === filter.modality);
  const page = matched.slice(offset, offset + limit).map((row) => {
    let view = null;
    try {
      view = observationViewFromStorage(
        row.parent_artifact_id,
        row.representation_id,
        row.view_metadata_json,
      );
    } catch {
      view = null;
    }
    const coverage = view === null ? null : {
      requestedSelector: view.requestedSelector,
      returnedSelector: view.returnedSelector,
      completeness: view.completeness,
      omission: view.omission,
      contentHashBasis: view.contentHashBasis,
    };
    return {
      observationId: row.observation_id,
      capturedAtMs: Number(row.created_at_ms),
      modality: row.modality,
      provenance: row.provenance,
      dataClassification: row.data_classification,
      derived: Number(row.derived) === 1,
      parentArtifactId: row.parent_artifact_id ?? null,
      representationIds: row.representation_id ? [row.representation_id] : [],
      coverage,
      accessLimits: ["metadata_only", "content_bytes_not_available"],
    };
  });
  const end = offset + page.length;
  return observation(req, "evidence.inspect", {
    searchedPopulation: rows.length,
    matchedPopulation: matched.length,
    rows: page,
    nextCursor: nextCursor(end, end < matched.length, scopeHash),
    capturedAtMs: nowMs(),
    accessLimits: ["metadata_only", "no_payload_json", "no_byte_paging"],
  });
}

function storedPurpose(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.purpose === "string" && value.purpose.trim().length > 0
    ? value.purpose
    : null;
}

/**
 * Growth V1 §4.6.3 deliberate recall: Ashley looks through her own live
 * Owner-private memories. Every query term is matched case-insensitively
 * against the statement; matches rank by terms matched, then by strength.
 * Read-only: looking does not count as a recall or a use.
 */
const MEMORY_LOOKUP_EPISODE_LIMIT = 5;

function lookupMemory(
  req: ObservationRequest,
  sidecar: DatabaseSync,
  scope: Scope,
  nowMs: () => number,
): Observation {
  const request = req.request as { query: string; kinds?: string[]; limit?: number; cursor?: string };
  const limit = boundedLimit(request.limit);
  const kinds = request.kinds ? [...new Set(request.kinds)].sort() : null;
  const scopeHash = cursorScope(scope, "memory.lookup", { query: request.query, kinds });
  const offset = offsetFromCursor(request.cursor, scopeHash);
  const terms = lookupTerms(request.query);
  const now = nowMs();
  const candidates = listLiveMemoryAssertions(sidecar).filter((assertion) =>
    assertion.statement !== REDACTED_MEMORY_STATEMENT
    && (!assertion.audienceScope || assertion.audienceScope.kind === "owner_private")
    && (kinds === null || kinds.includes(assertion.memoryKind)));
  const scores = strengthScores(sidecar, candidates.map((assertion) => assertion.assertionKey), now);
  const matches = candidates
    .map((assertion) => {
      const text = assertion.statement.toLowerCase();
      return { assertion, hits: terms.filter((term) => text.includes(term)).length };
    })
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits
      || (scores.get(b.assertion.assertionKey) ?? 0) - (scores.get(a.assertion.assertionKey) ?? 0)
      || a.assertion.assertionKey.localeCompare(b.assertion.assertionKey));
  const end = offset + limit;
  // Episodes ride on the first page: the conversations these words recall.
  const episodes = offset === 0 && (kinds === null || kinds.includes("shared_episode"))
    ? searchEpisodes(sidecar, terms, MEMORY_LOOKUP_EPISODE_LIMIT)
      .filter((episode) => episode.dataClassification !== "secret")
      .map(toThoughtEpisode)
    : [];
  return observation(req, "memory.lookup", {
    query: request.query,
    ...(kinds ? { kinds } : {}),
    memories: matches.slice(offset, end).map(({ assertion }) => ({
      key: assertion.assertionKey,
      statement: assertion.statement,
      memoryKind: assertion.memoryKind,
      source: assertion.dimensions.source,
      time: assertion.dimensions.time,
      strength: Math.round((scores.get(assertion.assertionKey) ?? 0) * 1000) / 1000,
    })),
    ...(episodes.length > 0 ? { episodes } : {}),
    searchedPopulation: candidates.length,
    matchedCount: matches.length,
    nextCursor: nextCursor(end, end < matches.length, scopeHash),
    capturedAtMs: now,
    accessLimits: ["owner_private", "live_memories_only", "read_only"],
  });
}

function inspectTemporal(
  req: ObservationRequest,
  nuclear: DatabaseSync,
  sidecar: DatabaseSync,
  scope: Scope,
  nowMs: () => number,
): Observation {
  const request = req.request as { limit?: number; cursor?: string };
  const limit = boundedLimit(request.limit);
  const scopeHash = cursorScope(scope, "temporal.inspect");
  const offset = offsetFromCursor(request.cursor, scopeHash);
  const concerns = listConcerns(sidecar, scope.conversationId).map((item) => ({
    concernId: item.concernId,
    statement: item.statement,
    status: item.status,
    assertionKey: item.assertionKey,
    dimensions: {
      status: item.dimensions.status,
      reliability: item.dimensions.reliability,
      time: item.dimensions.time,
    },
  }));
  const triggers = listFutureTriggers(sidecar, scope.conversationId, {
    includeTerminal: true,
    limit: 1000,
  }).map((item) => {
    const purpose = storedPurpose(item.payload);
    return {
      triggerId: item.triggerId,
      concernId: item.concernId,
      dueAtMs: item.dueAtMs,
      status: item.status,
      purpose,
      purposeStatus: purpose === null ? "absent" : "stored",
      objectiveFacetState: "missing_pre_w4_p2",
    };
  });
  const commitments = nuclear.prepare(
    "SELECT entity_uuid, text, status, due_at, data_classification " +
    "FROM ashley_self_commitments WHERE owner_id = ? " +
    "AND status != 'forgotten' AND lower(data_classification) != 'secret' " +
    "ORDER BY due_at ASC, entity_uuid ASC",
  ).all(scope.ownerId).map((value) => {
    const row = value as Row;
    return {
      commitmentId: row.entity_uuid,
      text: row.text,
      status: row.status,
      dueAt: row.due_at ?? null,
      dataClassification: row.data_classification,
    };
  });
  const subscriptions = listObservationSubscriptions(sidecar, scope.conversationId, {
    includeCancelled: true,
    limit: 1000,
  }).filter((item) => item.requesterId === scope.ownerId).map((item) => ({
    subscriptionId: item.subscriptionId,
    concernId: item.concernId,
    source: item.source,
    scope: item.scope,
    topicKeys: [...item.topicKeys],
    match: item.match,
    status: item.status,
    expiresAtMs: item.expiresAtMs,
  }));
  const total = Math.max(concerns.length, triggers.length, commitments.length, subscriptions.length);
  const end = offset + limit;
  return observation(req, "temporal.inspect", {
    concerns: concerns.slice(offset, end),
    futureTriggers: triggers.slice(offset, end),
    commitments: commitments.slice(offset, end),
    subscriptions: subscriptions.slice(offset, end),
    searchedPopulation: total,
    nextCursor: nextCursor(end, end < total, scopeHash),
    capturedAtMs: nowMs(),
    accessLimits: ["owner_private", "forgotten_and_secret_commitments_excluded", "subscription_source_urls_excluded"],
  });
}

function inspectWork(
  req: ObservationRequest,
  sidecar: DatabaseSync,
  scope: Scope,
  nowMs: () => number,
): Observation {
  const request = req.request as { limit?: number; cursor?: string };
  const limit = boundedLimit(request.limit);
  const scopeHash = cursorScope(scope, "work.inspect");
  const offset = offsetFromCursor(request.cursor, scopeHash);
  const rows = sidecar.prepare(
    "SELECT d.operation_id, d.operation_kind, d.origin_cycle_id, d.origin_generation, " +
    "d.state, d.terminal_state, d.error_code, d.start_at_ms, d.terminal_at_ms, " +
    "d.admission_at_ms, d.operation_deadline_at_ms, d.observation_ref, d.receipt_ref " +
    "FROM detached_operations d JOIN cycle_records c " +
    "ON c.cycle_id = d.origin_cycle_id AND c.generation = d.origin_generation " +
    "WHERE d.conversation_id = ? AND c.occupant_id = ? " +
    "ORDER BY d.updated_at_ms DESC, d.operation_id ASC",
  ).all(scope.conversationId, scope.ownerId) as Row[];
  const detachedOperations = rows.slice(offset, offset + limit).map((row) => ({
    operationId: row.operation_id,
    operationKind: row.operation_kind,
    originCycleId: row.origin_cycle_id,
    originGeneration: Number(row.origin_generation),
    state: row.state,
    terminalState: row.terminal_state ?? null,
    errorCode: typeof row.error_code === "string" ? safeReasonCode(row.error_code) : null,
    startAtMs: row.start_at_ms === null || row.start_at_ms === undefined ? null : Number(row.start_at_ms),
    terminalAtMs: row.terminal_at_ms === null || row.terminal_at_ms === undefined ? null : Number(row.terminal_at_ms),
    admittedAtMs: Number(row.admission_at_ms),
    deadlineAtMs: Number(row.operation_deadline_at_ms),
    observationRef: row.observation_ref ?? null,
    receiptRef: row.receipt_ref ?? null,
  }));
  const cycles = sidecar.prepare(
    "SELECT cycle_id, generation FROM cycle_records WHERE conversation_id = ? AND occupant_id = ? ORDER BY admitted_at_ms ASC, cycle_id ASC",
  ).all(scope.conversationId, scope.ownerId) as Row[];
  const inFlightEffects = cycles.flatMap((cycle) => {
    const cycleId = typeof cycle.cycle_id === "string" ? cycle.cycle_id : "";
    const generation = Number(cycle.generation);
    if (!cycleId || !Number.isSafeInteger(generation)) return [];
    return listInFlightForThoughtCycle(sidecar, cycleId).map((item) =>
      projectInFlightConsequence(item, cycleId, generation, { kind: "owner_private" }));
  });
  const end = offset + limit;
  const pagePopulation = Math.max(rows.length, inFlightEffects.length);
  return observation(req, "work.inspect", {
    detachedOperations,
    inFlightEffects: inFlightEffects.slice(offset, end),
    searchedPopulation: rows.length + inFlightEffects.length,
    nextCursor: nextCursor(end, end < pagePopulation, scopeHash),
    capturedAtMs: nowMs(),
    accessLimits: ["owner_private", "request_bodies_excluded", "no_worker_started"],
  });
}

export function executeTypedInspection(input: {
  req: ObservationRequest;
  nuclear: DatabaseSync;
  sidecar?: DatabaseSync;
  ownerId?: string;
  nowMs: () => number;
  webSearchProvider?: Pick<WebSearchProvider, "available">;
  /** E1: her home folder, when the host has one. */
  homeRoot?: string;
}): Observation | null {
  const { req } = input;
  if (!isValidTypedInspectionRequest(req.kind, req.request)) return null;
  const scope = requireScope(req, input.sidecar, input.ownerId);
  if (req.kind === "capability.inspect") {
    return namedCapability(req, input.nuclear, input.nowMs, input.webSearchProvider);
  }
  if (!input.sidecar) throw new CapabilityUnavailableError("inspect_unavailable");
  if (req.kind === "evidence.inspect") {
    return inspectEvidence(req, input.sidecar, scope, input.nowMs);
  }
  if (req.kind === "temporal.inspect") {
    return inspectTemporal(req, input.nuclear, input.sidecar, scope, input.nowMs);
  }
  if (req.kind === "memory.lookup") {
    return lookupMemory(req, input.sidecar, scope, input.nowMs);
  }
  if (req.kind === "home.read") {
    if (!input.homeRoot) throw new CapabilityUnavailableError("home_unavailable");
    try {
      return { ...observation(req, "home.read", readHomeFile(input.homeRoot, String(req.request.path))), secretOmitted: false };
    } catch (error) {
      throw new CapabilityUnavailableError(error instanceof Error && error.message === "home_path_invalid" ? "home_path_invalid" : "home_file_missing");
    }
  }
  return inspectWork(req, input.sidecar, scope, input.nowMs);
}
