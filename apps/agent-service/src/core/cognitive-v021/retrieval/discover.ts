import type { DatabaseSync } from "node:sqlite";
import type {
  AssertionKey,
  DataClassification,
  EpistemicDimensions,
  MemoryKind,
  RetrievalHit,
  RetrievalInfrastructureState,
  RetrievalRequest,
  RetrievalResult,
} from "../types.js";
import type { SocialAudience } from "../social/types.js";
import { getConversationEvidence } from "../evidence/conversation-log.js";
import { getMemoryAssertion, REDACTED_MEMORY_STATEMENT } from "../memory/assertions.js";
import { listMemorySupports } from "../memory/supports.js";
import { DerivedStore, openDerivedStore } from "./derived-store.js";
import { buildFtsQueryString, tokenizeForQuery } from "./query.js";
import { searchConversationFts, searchMemoryFts } from "./fts.js";
import { rankCandidates } from "./rank.js";
import { deduplicateCandidates } from "./dedup.js";
import { hasAuthorityBarrier } from "../authority/barrier.js";
import { hasPendingDerivedInvalidation } from "../authority/journal.js";

export type RetrieveCandidatesInput = {
  conversationId: string;
  request: RetrievalRequest;
  rawConversationRowIds?: Set<string>;
  authorityDb?: DatabaseSync;
  /**
   * Bounded Owner-private cross-surface recall scope: explicitly allowed
   * additional conversation IDs (the authenticated Owner's trusted rooms).
   * Honored only for the `owner_private` audience; every other audience
   * searches its own conversation only.
   */
  crossSurfaceConversationIds?: readonly string[];
};

export type RetrieveCandidatesOptions = {
  authorityDb?: DatabaseSync;
  audience?: SocialAudience;
  licenses?: string[];
};

export function tokenizeForDiscovery(text: string): string[] {
  return tokenizeForQuery(text);
}

function fetchExactKeyHits(
  sidecarDb: DatabaseSync,
  assertionKeys: string[],
  authorityDb?: DatabaseSync,
  audience: SocialAudience = { kind: "owner_private" },
  licenses: readonly string[] = [],
): RetrievalHit[] {
  const uniqueKeys = [...new Set(assertionKeys.filter(Boolean))];
  const hits: RetrievalHit[] = [];

  for (const key of uniqueKeys) {
    if (authorityDb && hasAuthorityBarrier(authorityDb) && hasPendingDerivedInvalidation(authorityDb, key)) continue;
    const assertion = getMemoryAssertion(sidecarDb, key);
    if (!assertion) continue;
    if (assertion.dataClassification === "secret") continue;
    if (assertion.statement === REDACTED_MEMORY_STATEMENT) continue;
    if (!retrievalHitEligible({
      audienceScope: assertion.audienceScope ?? { kind: "owner_private" },
      protectionStatus: assertion.protectionStatus ?? null,
      licenseRefs: assertion.licenseRefs ?? [],
      dataClassification: assertion.dataClassification,
    }, audience, licenses)) continue;

    const supportRefs = listMemorySupports(sidecarDb, assertion.assertionKey).map(
      (support) => support.sourceRef ?? support.supportId,
    );

    hits.push({
      kind: "key",
      sourceStore: assertion.live ? "live_memory" : "quarantined_memory",
      ref: assertion.assertionKey,
      snippet: assertion.statement.slice(0, 500),
      score: -100, // Top deterministic tier
      assertionKey: assertion.assertionKey,
      memoryKind: assertion.memoryKind,
      dimensions: assertion.dimensions,
      dataClassification: assertion.dataClassification,
      live: assertion.live,
      supportRefs,
      source: assertion.sourcePrincipal ?? null,
      subject: assertion.subject ?? null,
      audienceScope: assertion.audienceScope ?? { kind: "owner_private" },
      licenseRefs: assertion.licenseRefs ?? [],
      protectionStatus: assertion.protectionStatus ?? null,
    });
  }

  return hits;
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

function retrievalHitEligible(
  value: {
    audienceScope?: SocialAudience | null;
    protectionStatus?: "admitted" | "unresolved" | null;
    licenseRefs?: string[];
    dataClassification?: DataClassification;
  },
  audience: SocialAudience,
  licenses: readonly string[],
): boolean {
  if (audience.kind === "owner_private") return true;
  if (value.dataClassification === "secret") return false;
  if (!value.audienceScope) return false;
  if (value.protectionStatus !== "admitted") return false;
  const refs = value.licenseRefs ?? [];
  if (sameAudience(value.audienceScope, audience)) {
    return refs.every((ref) => licenses.includes(ref));
  }
  return refs.length > 0 && refs.every((ref) => licenses.includes(ref));
}

function evidenceAudience(row: ReturnType<typeof getConversationEvidence>): SocialAudience | null {
  if (!row) return null;
  const location = row.location;
  if (!location || typeof location !== "object" || Array.isArray(location)) return null;
  const value = location as Record<string, unknown>;
  if (value.kind === "external_dm" && typeof value.principalId === "string") {
    return { kind: "dm", principalId: value.principalId };
  }
  if (value.kind === "room") {
    if (typeof value.roomId === "string" && value.roomId.trim()) {
      return { kind: "room", roomId: value.roomId };
    }
    if (typeof value.guildId === "string" && typeof value.channelId === "string") {
      return { kind: "room", roomId: `room:${value.guildId}:${value.channelId}` };
    }
  }
  return null;
}

type CrossSurfaceRawRow = {
  row_id?: unknown;
  lineage_id?: unknown;
  version?: unknown;
  conversation_id?: unknown;
  text?: unknown;
  data_classification?: unknown;
  secret_omitted?: unknown;
  speaker_kind?: unknown;
  source_status?: unknown;
};

/**
 * Authoritative recheck for one cross-surface log hit. FTS is discovery, not
 * authority: the candidate row is re-read from the sidecar and must still
 * satisfy every eligibility bound (allowed conversation, Owner/Ashley
 * attribution on the raw column, current lineage version, non-secret, not
 * secret-omitted, present non-redacted text). Anything else fails closed.
 */
function recheckCrossSurfaceLogHit(
  sidecarDb: DatabaseSync,
  rowId: string,
  allowedConversationIds: ReadonlySet<string>,
): ReturnType<typeof getConversationEvidence> {
  const row = sidecarDb.prepare(
    `SELECT row_id, lineage_id, version, conversation_id, text,
            data_classification, secret_omitted, speaker_kind, source_status
       FROM conversation_evidence_log
      WHERE row_id = ?`,
  ).get(rowId) as CrossSurfaceRawRow | undefined;
  if (!row || typeof row.row_id !== "string") return null;
  if (typeof row.conversation_id !== "string" || !allowedConversationIds.has(row.conversation_id)) {
    return null;
  }
  // Raw-column check on purpose: the mapped record defaults unknown
  // attribution to Owner, which must never admit a cross-surface row.
  if (row.speaker_kind !== "owner" && row.speaker_kind !== "ashley") return null;
  if (row.data_classification === "secret") return null;
  if (Number(row.secret_omitted) === 1) return null;
  if (typeof row.text !== "string" || !row.text || row.text === "[redacted]") return null;
  if (row.source_status === "redacted") return null;
  if (typeof row.lineage_id === "string" && row.lineage_id) {
    const latest = sidecarDb.prepare(
      `SELECT version FROM conversation_evidence_log
        WHERE lineage_id = ?
        ORDER BY version DESC
        LIMIT 1`,
    ).get(row.lineage_id) as { version?: unknown } | undefined;
    if (Number(latest?.version) !== Number(row.version)) return null;
  }
  return getConversationEvidence(sidecarDb, rowId);
}

/**
 * Deterministic tiered indexed retrieval.
 * Composes exact-key fetch, FTS5 BM25 memory and conversation search,
 * strict tier ranking, and safe narrow deduplication.
 */
export function retrieveCandidates(
  sidecarDb: DatabaseSync,
  input: RetrieveCandidatesInput,
  derivedStore?: DerivedStore,
  options: RetrieveCandidatesOptions = {},
): RetrievalResult {
  const request: RetrievalRequest = { ...input.request, includeLogSearch: true };
  const authorityDb = options.authorityDb ?? input.authorityDb;
  const audience = options.audience ?? { kind: "owner_private" };
  const licenses = options.licenses ?? [];

  // Bounded Owner-private cross-surface recall. The allowed set is an
  // explicit host-resolved list, never an inferred prefix. Any non-Owner
  // audience searches its own conversation only, so Owner-private evidence
  // can never flow toward a room through this scope.
  const crossSurfaceScope = audience.kind === "owner_private"
    ? [...new Set(
      (input.crossSurfaceConversationIds ?? []).filter((id) =>
        typeof id === "string" && id.trim() && id !== input.conversationId),
    )]
    : [];
  const crossSurfaceAllowed = new Set(crossSurfaceScope);

  // Tier 1: Exact-key hits from sidecar memory assertions (authoritative sidecar query)
  const exactKeyHits = fetchExactKeyHits(sidecarDb, request.assertionKeys ?? [], authorityDb, audience, licenses);

  // Fail closed if persistent derived store is unavailable: lexical infrastructure cannot run
  if (!derivedStore) {
    const ranked = rankCandidates({
      exactKeyHits,
      rawTriggerFtsHits: [],
      concernFtsHits: [],
      logHits: [],
    });
    const deduped = deduplicateCandidates(ranked, {
      rawConversationRowIds: input.rawConversationRowIds,
    });
    return {
      request,
      hits: deduped.survivors,
      state: "unavailable",
      miss: false,
    };
  }

  let infrastructureState: RetrievalInfrastructureState = "ready";

  // FTS query formation
  const rawTriggerQuery = buildFtsQueryString(request.triggerTerms ?? []);
  const concernQuery = buildFtsQueryString(request.workingContextTopics ?? []);

  // Tier 2: Raw owner trigger BM25 over memory_fts
  const rawTriggerResult = searchMemoryFts(derivedStore, sidecarDb, rawTriggerQuery, { authorityDb });
  if (rawTriggerResult.state === "unavailable") {
    infrastructureState = "unavailable";
  }
  const rawTriggerHits: RetrievalHit[] = rawTriggerResult.rows.flatMap((row) => {
    const assertion = getMemoryAssertion(sidecarDb, row.assertionKey);
    const metadata = {
      audienceScope: assertion?.audienceScope ?? { kind: "owner_private" } as SocialAudience,
      protectionStatus: assertion?.protectionStatus ?? null,
      licenseRefs: assertion?.licenseRefs ?? [],
      dataClassification: row.dataClassification,
    };
    if (!retrievalHitEligible(metadata, audience, licenses)) return [];
    return [{
      kind: "lexical" as const,
      sourceStore: row.sourceStore,
      ref: row.assertionKey,
      snippet: row.statement.slice(0, 500),
      score: row.rank,
      assertionKey: row.assertionKey,
      memoryKind: row.memoryKind,
      dimensions: row.dimensions,
      dataClassification: row.dataClassification,
      live: row.live,
      supportRefs: listMemorySupports(sidecarDb, row.assertionKey).map(
        (s) => s.sourceRef ?? s.supportId,
      ),
      source: assertion?.sourcePrincipal ?? null,
      subject: assertion?.subject ?? null,
      audienceScope: metadata.audienceScope,
      licenseRefs: metadata.licenseRefs,
      protectionStatus: metadata.protectionStatus,
    }];
  });

  // Tier 3: Derived Working-Context BM25 over memory_fts
  const concernResult = searchMemoryFts(derivedStore, sidecarDb, concernQuery, { authorityDb });
  if (concernResult.state === "unavailable") {
    infrastructureState = "unavailable";
  }
  const concernHits: RetrievalHit[] = concernResult.rows.flatMap((row) => {
    const assertion = getMemoryAssertion(sidecarDb, row.assertionKey);
    const metadata = {
      audienceScope: assertion?.audienceScope ?? { kind: "owner_private" } as SocialAudience,
      protectionStatus: assertion?.protectionStatus ?? null,
      licenseRefs: assertion?.licenseRefs ?? [],
      dataClassification: row.dataClassification,
    };
    if (!retrievalHitEligible(metadata, audience, licenses)) return [];
    return [{
      kind: "lexical" as const,
      sourceStore: row.sourceStore,
      ref: row.assertionKey,
      snippet: row.statement.slice(0, 500),
      score: row.rank,
      assertionKey: row.assertionKey,
      memoryKind: row.memoryKind,
      dimensions: row.dimensions,
      dataClassification: row.dataClassification,
      live: row.live,
      supportRefs: listMemorySupports(sidecarDb, row.assertionKey).map(
        (s) => s.sourceRef ?? s.supportId,
      ),
      source: assertion?.sourcePrincipal ?? null,
      subject: assertion?.subject ?? null,
      audienceScope: metadata.audienceScope,
      licenseRefs: metadata.licenseRefs,
      protectionStatus: metadata.protectionStatus,
    }];
  });

  // Tier 4: Historical conversation-log BM25 over conversation_fts
  let logHits: RetrievalHit[] = [];
  if (request.includeLogSearch) {
    const combinedLogQuery = rawTriggerQuery || concernQuery;
    const logResult = searchConversationFts(derivedStore, sidecarDb, input.conversationId, combinedLogQuery, {
      excludeRowIds: input.rawConversationRowIds,
      authorityDb,
      ...(crossSurfaceScope.length > 0 ? { additionalConversationIds: crossSurfaceScope } : {}),
    });
    if (logResult.state === "unavailable") {
      infrastructureState = "unavailable";
    }
    logHits = logResult.rows.flatMap((row) => {
      const crossSurface = row.conversationId !== input.conversationId;
      const evidence = crossSurface
        ? recheckCrossSurfaceLogHit(sidecarDb, row.rowId, crossSurfaceAllowed)
        : getConversationEvidence(sidecarDb, row.rowId);
      // A failed cross-surface recheck (or an orphan index row) is not a
      // candidate at all. Same-conversation rows always resolve here because
      // searchConversationFts already fails closed on orphans.
      if (!evidence) return [];
      const scope = evidenceAudience(evidence) ?? { kind: "owner_private" } as SocialAudience;
      const metadata = {
        audienceScope: scope,
        protectionStatus: scope ? "admitted" as const : null,
        licenseRefs: [] as string[],
        dataClassification: row.dataClassification,
      };
      if (audience.kind !== "owner_private" &&
          (!evidence || evidence.dataClassification === "secret" || evidence.secretOmitted || !sameAudience(scope, audience))) return [];
      if (!retrievalHitEligible(metadata, audience, licenses) && audience.kind !== "owner_private") return [];
      return [{
        kind: "log" as const,
        sourceStore: "conversation_log" as const,
        ref: row.rowId,
        snippet: row.text.slice(0, 500),
        score: row.rank,
        assertionKey: null,
        memoryKind: null,
        dimensions: null,
        dataClassification: row.dataClassification,
        live: null,
        role: row.role ?? "unknown",
        supportRefs: [row.lineageId ?? row.rowId],
        source: evidence?.speakerPrincipalId ?? null,
        subject: null,
        audienceScope: scope,
        licenseRefs: metadata.licenseRefs,
        protectionStatus: metadata.protectionStatus,
      }];
    });
  }

  // Tiered deterministic ranking with defense-in-depth fuse
  const ranked = rankCandidates({
    exactKeyHits,
    rawTriggerFtsHits: rawTriggerHits,
    concernFtsHits: concernHits,
    logHits,
  });

  // Narrow safe deduplication
  const deduped = deduplicateCandidates(ranked, {
    rawConversationRowIds: input.rawConversationRowIds,
  });

  const hits = deduped.survivors;
  const isMiss = infrastructureState === "ready" && hits.length === 0;

  return {
    request,
    hits,
    state: infrastructureState,
    miss: isMiss,
  };
}
