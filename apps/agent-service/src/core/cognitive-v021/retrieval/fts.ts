import type { DatabaseSync } from "node:sqlite";
import type {
  AssertionKey,
  DataClassification,
  EpistemicDimensions,
  MemoryKind,
  RetrievalInfrastructureState,
} from "../types.js";
import { DerivedStore } from "./derived-store.js";
import { hasAuthorityBarrier, requireStableAuthorityBarrier } from "../authority/barrier.js";
import { hasPendingDerivedInvalidation } from "../authority/journal.js";

export type RawFtsMemoryRow = {
  assertionKey: AssertionKey;
  statement: string;
  memoryKind: MemoryKind | null;
  rank: number;
  dimensions: EpistemicDimensions | null;
  live: boolean;
  dataClassification: DataClassification;
  sourceStore: "live_memory" | "quarantined_memory";
};

export type LogFtsRow = {
  rowId: string;
  conversationId: string;
  text: string;
  rank: number;
  role: "owner" | "ashley" | "system" | "unknown";
  dataClassification: DataClassification;
  lineageId: string | null;
  version: number | null;
  sourceStore: "conversation_log";
};

export type FtsSearchResult<T> = {
  state: RetrievalInfrastructureState;
  rows: T[];
};

const VALID_CLASSIFICATIONS = new Set<DataClassification>(["ordinary", "sensitive", "never_public"]);

export function searchMemoryFts(
  derivedStore: DerivedStore,
  sidecarDb: DatabaseSync,
  ftsQuery: string | null,
  options: { limit?: number; authorityDb?: DatabaseSync } = {},
): FtsSearchResult<RawFtsMemoryRow> {
  if (!ftsQuery || !ftsQuery.trim()) {
    return { state: "ready", rows: [] };
  }

  let authoritySnapshot: ReturnType<typeof requireStableAuthorityBarrier> | null = null;
  if (options.authorityDb && hasAuthorityBarrier(options.authorityDb)) {
    try {
      authoritySnapshot = requireStableAuthorityBarrier(options.authorityDb);
    } catch {
      return { state: "unavailable", rows: [] };
    }
  }

  // Ensure derived index is ready and valid (O(1) when valid, reconciles when invalid)
  const ready = derivedStore.isReady(sidecarDb, { authorityDb: options.authorityDb });
  if (!ready) {
    return { state: "unavailable", rows: [] };
  }

  const limit = Math.max(1, options.limit ?? 100);

  try {
    const ftsRows = derivedStore.db.prepare(`
      SELECT assertion_key, statement, memory_kind, rank
      FROM memory_fts
      WHERE memory_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{
      assertion_key: string;
      statement: string;
      memory_kind: string;
      rank: number;
    }>;

    if (ftsRows.length === 0) {
      if (authoritySnapshot) {
        try {
          requireStableAuthorityBarrier(options.authorityDb!, authoritySnapshot);
        } catch {
          derivedStore.markInvalid();
          return { state: "unavailable", rows: [] };
        }
      }
      return { state: "ready", rows: [] };
    }

    const keys = ftsRows.map((r) => r.assertion_key);
    const placeholders = keys.map(() => "?").join(",");
    const sidecarRows = sidecarDb.prepare(`
      SELECT assertion_key, dimensions_json, live, data_classification
      FROM sidecar_memory_assertions
      WHERE assertion_key IN (${placeholders})
    `).all(...keys) as Array<{
      assertion_key: string;
      dimensions_json: string | null;
      live: number;
      data_classification: string;
    }>;

    const sidecarMap = new Map(sidecarRows.map((r) => [r.assertion_key, r]));

    const resultRows: RawFtsMemoryRow[] = [];
    for (const ftsRow of ftsRows) {
      if (options.authorityDb && hasPendingDerivedInvalidation(options.authorityDb, ftsRow.assertion_key)) {
        derivedStore.markInvalid();
        return { state: "unavailable", rows: [] };
      }
      const sidecar = sidecarMap.get(ftsRow.assertion_key);
      if (!sidecar) {
        // Orphan FTS row: missing from authoritative sidecar. Fail closed.
        derivedStore.markInvalid();
        return { state: "unavailable", rows: [] };
      }

      const rawClassification = sidecar.data_classification as DataClassification;
      if (!VALID_CLASSIFICATIONS.has(rawClassification)) {
        // Unknown, secret, or malformed classification. Fail closed.
        derivedStore.markInvalid();
        return { state: "unavailable", rows: [] };
      }

      const live = Boolean(sidecar.live === 1);
      const dimensions = sidecar.dimensions_json
        ? (JSON.parse(sidecar.dimensions_json) as EpistemicDimensions)
        : null;

      resultRows.push({
        assertionKey: ftsRow.assertion_key,
        statement: ftsRow.statement,
        memoryKind: (ftsRow.memory_kind as MemoryKind) || null,
        rank: Number(ftsRow.rank),
        dimensions,
        live,
        dataClassification: rawClassification,
        sourceStore: live ? "live_memory" : "quarantined_memory",
      });
    }

    if (authoritySnapshot) {
      try {
        requireStableAuthorityBarrier(options.authorityDb!, authoritySnapshot);
      } catch {
        derivedStore.markInvalid();
        return { state: "unavailable", rows: [] };
      }
    }

    return { state: "ready", rows: resultRows };
  } catch {
    return { state: "unavailable", rows: [] };
  }
}

export function searchConversationFts(
  derivedStore: DerivedStore,
  sidecarDb: DatabaseSync,
  conversationId: string,
  ftsQuery: string | null,
  options: { limit?: number; excludeRowIds?: Set<string>; authorityDb?: DatabaseSync } = {},
): FtsSearchResult<LogFtsRow> {
  if (!ftsQuery || !ftsQuery.trim()) {
    return { state: "ready", rows: [] };
  }

  let authoritySnapshot: ReturnType<typeof requireStableAuthorityBarrier> | null = null;
  if (options.authorityDb && hasAuthorityBarrier(options.authorityDb)) {
    try {
      authoritySnapshot = requireStableAuthorityBarrier(options.authorityDb);
    } catch {
      return { state: "unavailable", rows: [] };
    }
  }

  const ready = derivedStore.isReady(sidecarDb, {
    authorityDb: options.authorityDb,
    conversationId,
  });
  if (!ready) {
    return { state: "unavailable", rows: [] };
  }

  const limit = Math.max(1, options.limit ?? 50);

  try {
    const ftsRows = derivedStore.db.prepare(`
      SELECT row_id, conversation_id, text, rank
      FROM conversation_fts
      WHERE conversation_fts MATCH ? AND conversation_id = ?
      ORDER BY rank ASC
      LIMIT ?
    `).all(ftsQuery, conversationId, limit) as Array<{
      row_id: string;
      conversation_id: string;
      text: string;
      rank: number;
    }>;

    if (ftsRows.length === 0) {
      if (authoritySnapshot) {
        try {
          requireStableAuthorityBarrier(options.authorityDb!, authoritySnapshot);
        } catch {
          derivedStore.markInvalid();
          return { state: "unavailable", rows: [] };
        }
      }
      return { state: "ready", rows: [] };
    }

    const filteredFts = options.excludeRowIds
      ? ftsRows.filter((r) => !options.excludeRowIds!.has(r.row_id))
      : ftsRows;

    if (filteredFts.length === 0) {
      return { state: "ready", rows: [] };
    }

    const rowIds = filteredFts.map((r) => r.row_id);
    const placeholders = rowIds.map(() => "?").join(",");
    const sidecarRows = sidecarDb.prepare(`
      SELECT row_id, role, data_classification, lineage_id, version
      FROM conversation_evidence_log
      WHERE row_id IN (${placeholders})
    `).all(...rowIds) as Array<{
      row_id: string;
      role: string;
      data_classification: string;
      lineage_id: string | null;
      version: number | null;
    }>;

    const sidecarMap = new Map(sidecarRows.map((r) => [r.row_id, r]));

    const resultRows: LogFtsRow[] = [];
    for (const ftsRow of filteredFts) {
      if (options.authorityDb && hasPendingDerivedInvalidation(options.authorityDb, ftsRow.row_id, conversationId)) {
        derivedStore.markInvalid();
        return { state: "unavailable", rows: [] };
      }
      const sidecar = sidecarMap.get(ftsRow.row_id);
      if (!sidecar) {
        // Orphan FTS row: missing from authoritative sidecar. Fail closed.
        derivedStore.markInvalid();
        return { state: "unavailable", rows: [] };
      }

      const rawClassification = sidecar.data_classification as DataClassification;
      if (!VALID_CLASSIFICATIONS.has(rawClassification)) {
        // Unknown, secret, or malformed classification. Fail closed.
        derivedStore.markInvalid();
        return { state: "unavailable", rows: [] };
      }

      resultRows.push({
        rowId: ftsRow.row_id,
        conversationId: ftsRow.conversation_id,
        text: ftsRow.text,
        rank: Number(ftsRow.rank),
        role: (sidecar.role === "owner" || sidecar.role === "ashley" || sidecar.role === "system"
          ? sidecar.role
          : "unknown"),
        dataClassification: rawClassification,
        lineageId: sidecar.lineage_id ?? null,
        version: sidecar.version ?? null,
        sourceStore: "conversation_log",
      });
    }

    if (authoritySnapshot) {
      try {
        requireStableAuthorityBarrier(options.authorityDb!, authoritySnapshot);
      } catch {
        derivedStore.markInvalid();
        return { state: "unavailable", rows: [] };
      }
    }

    return { state: "ready", rows: resultRows };
  } catch {
    return { state: "unavailable", rows: [] };
  }
}
