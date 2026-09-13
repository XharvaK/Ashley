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
};

export type RetrieveCandidatesOptions = {
  authorityDb?: DatabaseSync;
};

export function tokenizeForDiscovery(text: string): string[] {
  return tokenizeForQuery(text);
}

function fetchExactKeyHits(
  sidecarDb: DatabaseSync,
  assertionKeys: string[],
  authorityDb?: DatabaseSync,
): RetrievalHit[] {
  const uniqueKeys = [...new Set(assertionKeys.filter(Boolean))];
  const hits: RetrievalHit[] = [];

  for (const key of uniqueKeys) {
    if (authorityDb && hasAuthorityBarrier(authorityDb) && hasPendingDerivedInvalidation(authorityDb, key)) continue;
    const assertion = getMemoryAssertion(sidecarDb, key);
    if (!assertion) continue;
    if (assertion.dataClassification === "secret") continue;
    if (assertion.statement === REDACTED_MEMORY_STATEMENT) continue;

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
    });
  }

  return hits;
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

  // Tier 1: Exact-key hits from sidecar memory assertions (authoritative sidecar query)
  const exactKeyHits = fetchExactKeyHits(sidecarDb, request.assertionKeys ?? [], authorityDb);

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
  const rawTriggerHits: RetrievalHit[] = rawTriggerResult.rows.map((row) => ({
    kind: "lexical",
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
  }));

  // Tier 3: Derived Working-Context BM25 over memory_fts
  const concernResult = searchMemoryFts(derivedStore, sidecarDb, concernQuery, { authorityDb });
  if (concernResult.state === "unavailable") {
    infrastructureState = "unavailable";
  }
  const concernHits: RetrievalHit[] = concernResult.rows.map((row) => ({
    kind: "lexical",
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
  }));

  // Tier 4: Historical conversation-log BM25 over conversation_fts
  let logHits: RetrievalHit[] = [];
  if (request.includeLogSearch) {
    const combinedLogQuery = rawTriggerQuery || concernQuery;
    const logResult = searchConversationFts(derivedStore, sidecarDb, input.conversationId, combinedLogQuery, {
      excludeRowIds: input.rawConversationRowIds,
      authorityDb,
    });
    if (logResult.state === "unavailable") {
      infrastructureState = "unavailable";
    }
    logHits = logResult.rows.map((row) => ({
      kind: "log",
      sourceStore: "conversation_log",
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
    }));
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
