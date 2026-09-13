import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { requireRouteEnabled, resolveRoute } from "../model-routing/router.js";
import { routeBinding } from "../model-routing/registry.js";
import type { RouteId } from "../model-routing/types.js";
import {
  canEnterModelContext,
  type DataClassification,
} from "../privacy/classification.js";
import {
  episodeInfluenceEligibleAt,
  influenceEligibleAt,
  sourceCoveredByDenyBarrier,
} from "../memory/eligibility.js";
import {
  annotationForAssertion,
  annotationForMessage,
} from "../memory/context-role.js";
import type {
  ContextInputCandidate,
  ContextRequest,
  ContextRouteBinding,
  ContextRouteClass,
  EligibleInputRef,
} from "./types.js";
import type { EvidenceRef } from "../types.js";

const CLASSIFICATIONS = new Set<DataClassification>([
  "ordinary",
  "sensitive",
  "never_public",
  "secret",
]);

const ROUTE_ALIASES: Record<string, RouteId> = {
  thought: "thought",
  expression: "ashley_expression",
  expression_fallback: "ashley_expression_fallback",
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function resolvedRouteId(request: ContextRequest): RouteId {
  const requested = request.routeId?.trim();
  if (requested) {
    const alias = ROUTE_ALIASES[requested];
    if (alias) return alias;
    try {
      routeBinding(requested as RouteId);
      return requested as RouteId;
    } catch {
      throw new Error(`context_route_unknown:${requested}`);
    }
  }
  try {
    return resolveRoute(request.purpose).route;
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : `context_route_unknown:${request.purpose}`,
    );
  }
}

function adapterClass(provider: string): string {
  return `${provider}-adapter`;
}

/** Derive route trust from the current canonical route registry. */
export function deriveContextRoute(request: ContextRequest): ContextRouteBinding {
  const routeId = resolvedRouteId(request);
  const binding = requireRouteEnabled(routeId);
  const routeClass: ContextRouteClass = request.surface === "public"
    ? "public_surface"
    : "remote_companion";
  const profileFingerprint = `sha256:${digest({
    route: binding.route,
    provider: binding.provider,
    configuredModelId: binding.configuredModelId,
    contextProfile: binding.contextProfile,
  })}`;
  const routePolicySnapshotId = `route-policy-v1:${binding.route}:${profileFingerprint.slice(8, 24)}`;
  if (request.routeClassHint && request.routeClassHint !== routeClass) {
    throw new Error("context_route_class_mismatch");
  }
  return {
    routeId: binding.route,
    routeClass,
    provider: binding.provider,
    adapterClass: adapterClass(binding.provider),
    profileId: binding.contextProfile,
    profileVersion: 1,
    profileFingerprint,
    routePolicySnapshotId,
  };
}

function sourceAssertionId(
  db: DatabaseSync,
  candidate: ContextInputCandidate,
): number | null {
  if (Number.isInteger(candidate.assertionId) && Number(candidate.assertionId) > 0) {
    return Number(candidate.assertionId);
  }
  if (candidate.sourceType !== "fact" && candidate.sourceType !== "episode" && candidate.sourceType !== "message") return null;
  const sourceId = Number(candidate.sourceId);
  if (!Number.isInteger(sourceId) || sourceId <= 0) return null;
  try {
    if (candidate.sourceType === "fact") {
      const row = db.prepare(
        `SELECT id FROM memory_assertions WHERE legacy_fact_id = ?
         ORDER BY id DESC LIMIT 1`,
      ).get(sourceId) as { id?: number } | undefined;
      return Number.isInteger(row?.id) ? Number(row?.id) : null;
    }
    if (candidate.sourceType === "message") {
      const row = db.prepare(
        `SELECT id FROM memory_assertions
         WHERE source_message_id = ? ORDER BY id LIMIT 1`,
      ).get(sourceId) as { id?: number } | undefined;
      return Number.isInteger(row?.id) ? Number(row?.id) : null;
    }
    const row = db.prepare(
      `SELECT assertion_id FROM memory_episode_claims
       WHERE episode_id = ? ORDER BY assertion_id LIMIT 1`,
    ).get(sourceId) as { assertion_id?: number } | undefined;
    return Number.isInteger(row?.assertion_id) ? Number(row?.assertion_id) : null;
  } catch {
    return null;
  }
}

type SourceMetadata = {
  classification?: DataClassification;
  influenceClass?: ContextInputCandidate["influenceClass"];
  entityUuid?: string | null;
};

function sourceMetadata(
  db: DatabaseSync,
  ownerId: string,
  candidate: ContextInputCandidate,
  assertionId: number | null,
): SourceMetadata {
  try {
    if (assertionId != null) {
      const row = db.prepare(
        `SELECT data_classification, influence_class, entity_uuid
         FROM memory_assertions WHERE owner_id = ? AND id = ? LIMIT 1`,
      ).get(ownerId, assertionId) as Record<string, unknown> | undefined;
      return {
        classification: row?.data_classification as DataClassification | undefined,
        influenceClass: row?.influence_class as ContextInputCandidate["influenceClass"],
        entityUuid: typeof row?.entity_uuid === "string" ? row.entity_uuid : null,
      };
    }
    const sourceId = Number(candidate.sourceId);
    if (candidate.sourceType === "message" && Number.isInteger(sourceId)) {
      const row = db.prepare(
        `SELECT data_classification, entity_uuid FROM mem_messages
         WHERE owner_id = ? AND id = ? LIMIT 1`,
      ).get(ownerId, sourceId) as Record<string, unknown> | undefined;
      return {
        classification: row?.data_classification as DataClassification | undefined,
        entityUuid: typeof row?.entity_uuid === "string" ? row.entity_uuid : null,
      };
    }
    if (candidate.sourceType === "episode" && Number.isInteger(sourceId)) {
      const row = db.prepare(
        `SELECT data_classification FROM episodes
         WHERE owner_id = ? AND id = ? LIMIT 1`,
      ).get(ownerId, sourceId) as Record<string, unknown> | undefined;
      return { classification: row?.data_classification as DataClassification | undefined };
    }
  } catch {
    /* Unknown source metadata fails closed at the classification check. */
  }
  return {};
}

function defaultRef(
  candidate: ContextInputCandidate,
  index: number,
): EvidenceRef {
  if (candidate.ref) return candidate.ref;
  const id = candidate.sourceId ?? `inline:${index + 1}`;
  return { type: "message", id };
}

function defaultMessageRole(section: string): "system" | "user" | "assistant" {
  return section === "safety" || section === "constitutional_safety" ||
      section === "identity" || section === "instructions"
    ? "system"
    : "user";
}

function isLabeledRole(
  role: ContextInputCandidate["memoryContextRole"],
): boolean {
  return role === "historical_source_evidence" || role === "corrected_source_evidence";
}

function isMemorySource(sourceType: string): boolean {
  return sourceType === "fact" ||
    sourceType === "episode" || sourceType === "memory_assertion";
}

function evaluateCandidate(
  db: DatabaseSync,
  request: ContextRequest,
  route: ContextRouteBinding,
  candidate: ContextInputCandidate,
  index: number,
): EligibleInputRef | null {
  const content = candidate.content;
  if (typeof content !== "string" || content.length === 0) return null;
  const sourceType = candidate.sourceType ?? candidate.ref?.type ?? "inline";
  const sourceId = candidate.sourceId ?? candidate.ref?.id ?? `inline:${index + 1}`;
  const assertionId = sourceAssertionId(db, candidate);
  const metadata = sourceMetadata(db, request.ownerId, candidate, assertionId);
  const classification = candidate.classification ?? metadata.classification ?? "never_public";
  if (!classification || !CLASSIFICATIONS.has(classification)) return null;
  if (!canEnterModelContext(classification, request.surface)) return null;
  if (candidate.ownerId && candidate.ownerId !== request.ownerId) return null;

  const at = new Date().toISOString();
  const queriedInfluence = assertionId == null
    ? null
    : influenceEligibleAt(db, assertionId, at);
  const queriedEpisodeInfluence = sourceType === "episode"
    ? episodeInfluenceEligibleAt(db, request.ownerId, Number(sourceId), at)
    : null;
  const barrierCovered = candidate.barrierCovered === true || sourceCoveredByDenyBarrier(
    db,
    sourceType,
    sourceId,
    at,
  );
  const labeled = isLabeledRole(candidate.memoryContextRole);
  const influenceEligible = candidate.influenceEligible ??
    (queriedEpisodeInfluence ?? queriedInfluence ?? true);
  const retrievalEligible = candidate.retrievalEligible ?? true;
  const influenceClass = candidate.influenceClass ?? metadata.influenceClass ?? null;

  // C2 never accepts a caller-supplied string as remote-egress authority.
  if (
    route.routeClass === "remote_companion" &&
    (influenceClass === "I2" || influenceClass === "I3")
  ) return null;
  if (influenceClass === "I4") return null;
  if (!retrievalEligible) return null;
  if (barrierCovered && !labeled) return null;
  if (!labeled && !influenceEligible) return null;
  if (!labeled && (influenceClass === "I0" || candidate.provenance === "shadow")) return null;
  if (candidate.memoryContextRole === "current_source_evidence" && !influenceEligible) return null;
  if (candidate.provenance === "shadow" && !labeled) return null;

  const annotated = candidate.memoryContextRole ?? (
    assertionId != null
      ? annotationForAssertion(db, request.ownerId, assertionId)?.memory_context_role
      : sourceType === "message" && Number.isInteger(Number(sourceId))
        ? annotationForMessage(db, request.ownerId, Number(sourceId))?.memory_context_role
        : null
  );
  const memoryContextRole = annotated ?? (
    isMemorySource(sourceType) && influenceEligible
      ? "current_source_evidence"
      : null
  );
  return {
    ref: candidate.ref ?? defaultRef(candidate, index),
    sourceType,
    sourceId,
    section: candidate.section,
    content,
    classification,
    influenceClass,
    provenance: candidate.provenance ?? null,
    memoryContextRole,
    assertionId,
    correctionIds: [...new Set(candidate.correctionIds ?? [])],
    barrierCovered,
    influenceEligible,
    retrievalEligible,
    required: candidate.required === true || request.requiredSections?.includes(candidate.section) === true,
    priority: Number.isFinite(candidate.priority) ? Number(candidate.priority) : 0,
    authorized: candidate.authorized !== false,
    observedAt: candidate.observedAt ?? null,
    routeClass: route.routeClass,
    entityUuid: candidate.entityUuid ?? metadata.entityUuid ?? null,
    messageRole: candidate.messageRole ?? defaultMessageRole(candidate.section),
  };
}

/** Build an eligible, non-authoritative input set. Ineligible material is omitted. */
export function buildEligibleInputs(
  db: DatabaseSync,
  request: ContextRequest,
): EligibleInputRef[] {
  const route = deriveContextRoute(request);
  const candidates = request.inputs ?? [];
  return candidates
    .map((candidate, index) => evaluateCandidate(db, request, route, candidate, index))
    .filter((candidate): candidate is EligibleInputRef => candidate !== null);
}
