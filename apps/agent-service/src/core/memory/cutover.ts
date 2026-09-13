import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { C1_CONTRACT_VERSION } from "./migration.js";
import {
  getMemoryContractState,
  requireMemoryContractState,
} from "./contract-state.js";
import { influenceEligibleAt } from "./eligibility.js";
import { rebuildMemFactsProjection } from "./projection-facts.js";
import type { SubjectFacet } from "./assertions.js";

export { recordRecallLiveCutover } from "../rollout/capabilities.js";

export type C1WriterInventoryEntry = {
  name: string;
  sourcePath: string;
  assertionFirst: boolean;
};

/** Closed implementation inventory used by the slice-5 cutover gate. */
export const C1_WRITER_INVENTORY: readonly C1WriterInventoryEntry[] = [
  {
    name: "upsertFact",
    sourcePath: "apps/agent-service/src/core/memory/facts.ts",
    assertionFirst: true,
  },
  {
    name: "writeFromUserTurn",
    sourcePath: "apps/agent-service/src/core/writers.ts",
    assertionFirst: true,
  },
  {
    name: "runtime.pinMemory",
    sourcePath: "apps/agent-service/src/core/runtime.ts",
    assertionFirst: true,
  },
  {
    name: "forgetByTopic",
    sourcePath: "apps/agent-service/src/core/memory/facts.ts",
    assertionFirst: true,
  },
  {
    name: "reconcileFacts",
    sourcePath: "apps/agent-service/src/core/memory/forget.ts",
    assertionFirst: true,
  },
  {
    name: "applyForgetTargets",
    sourcePath: "apps/agent-service/src/core/memory/forget.ts",
    assertionFirst: true,
  },
  {
    name: "forgetEpisodesByIds",
    sourcePath: "apps/agent-service/src/core/memory/episodes.ts",
    assertionFirst: true,
  },
  {
    name: "rebuildMemFactsProjection",
    sourcePath: "apps/agent-service/src/core/memory/projection-facts.ts",
    assertionFirst: true,
  },
];

const AFFECTED_INFLUENCE_PATHS = [
  "motivation_insert",
  "mindStateBlock",
  "resolveEvidenceRefs",
  "thought_candidate_json",
  "expression_memory_block",
] as const;

export type C1ConsistencyReport = {
  ok: boolean;
  currentnessAuthority: "mem_facts" | "memory_assertions" | null;
  totalFacts: number;
  totalAssertions: number;
  mappedFacts: number;
  unmappedFactIds: number[];
  mismatchedFactIds: number[];
  missingProjectionAssertionIds: number[];
  independentWriterNames: string[];
  errors: string[];
};

export type LegacyImpactInventory = {
  ownerId: string | null;
  totalMigratedAssertions: number;
  countsByFacet: Record<SubjectFacet, number>;
  remainingUnknown: number;
  currentlyInfluentialLegacyFacts: number;
  affectedPaths: string[];
  ownerVisibleBehaviorChange: "yes" | "no" | "UNKNOWN";
};

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? value as Row : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function count(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): number {
  return numberValue((db.prepare(sql).get(...params) as Row | undefined)?.count);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function currentAuthorityStart(row: Row): string | null {
  const authorityFrom = typeof row.authority_from === "string"
    ? row.authority_from
    : null;
  if (authorityFrom) return authorityFrom;
  return row.authority_basis === "legacy_current" && typeof row.recorded_at === "string"
    ? row.recorded_at
    : null;
}

function authorityCurrentAt(row: Row, at: string): boolean {
  if (row.termination_reason != null) return false;
  const from = currentAuthorityStart(row);
  if (from == null || from > at) return false;
  const to = typeof row.authority_to === "string" ? row.authority_to : null;
  return to == null || at < to;
}

function currentAssertionForFact(
  db: DatabaseSync,
  ownerId: string,
  factId: number,
  at: string,
): Row | null {
  const rows = db.prepare(
    `SELECT * FROM memory_assertions
     WHERE owner_id = ? AND legacy_fact_id = ?
     ORDER BY id DESC`,
  ).all(ownerId, factId).map(asRow).filter((row): row is Row => row !== null);
  return rows.find((row) => authorityCurrentAt(row, at)) ?? null;
}

function currentProjectionAssertions(
  db: DatabaseSync,
  ownerId: string,
  at: string,
): Row[] {
  return db.prepare(
    `SELECT * FROM memory_assertions
     WHERE owner_id = ? AND kind = 'keyed_fact'
     ORDER BY id ASC`,
  ).all(ownerId)
    .map(asRow)
    .filter((row): row is Row => row !== null)
    .filter((row) => authorityCurrentAt(row, at));
}

function writerViolations(
  inventory: readonly C1WriterInventoryEntry[],
): string[] {
  return inventory
    .filter((entry) => !entry.assertionFirst)
    .map((entry) => entry.name);
}

function assertSupportedContractVersion(db: DatabaseSync): void {
  const state = requireMemoryContractState(db);
  if (state.c1ContractVersion > C1_CONTRACT_VERSION) {
    throw new Error(
      `unsupported_memory_contract:${state.c1ContractVersion}>${C1_CONTRACT_VERSION}`,
    );
  }
}

function withTransaction<T>(db: DatabaseSync, callback: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* preserve the original cutover error */
    }
    throw error;
  }
}

export function verifyC1Consistency(
  db: DatabaseSync,
  options: {
    at?: string;
    writerInventory?: readonly C1WriterInventoryEntry[];
  } = {},
): C1ConsistencyReport {
  const state = getMemoryContractState(db);
  const at = options.at ?? new Date().toISOString();
  const inventory = options.writerInventory ?? C1_WRITER_INVENTORY;
  const totalFacts = count(db, "SELECT COUNT(*) AS count FROM mem_facts");
  const totalAssertions = count(db, "SELECT COUNT(*) AS count FROM memory_assertions");
  const unmappedFactIds = (db.prepare(
    `SELECT f.id
     FROM mem_facts AS f
     WHERE NOT EXISTS (
       SELECT 1 FROM memory_assertions AS a
       WHERE a.owner_id = f.owner_id AND a.legacy_fact_id = f.id
     )
     ORDER BY f.id ASC`,
  ).all() as Array<{ id?: number }>).map((row) => numberValue(row.id));
  const mismatchedFactIds: number[] = [];
  const facts = db.prepare(
    `SELECT id, owner_id, category, key, value, superseded_by
     FROM mem_facts ORDER BY id ASC`,
  ).all().map(asRow).filter((row): row is Row => row !== null);
  for (const fact of facts) {
    const factId = numberValue(fact.id);
    const assertion = currentAssertionForFact(
      db,
      stringValue(fact.owner_id),
      factId,
      at,
    );
    const factActive = fact.superseded_by == null;
    if (factActive !== (assertion !== null)) {
      mismatchedFactIds.push(factId);
      continue;
    }
    if (factActive && assertion && (
      stringValue(assertion.owner_id) !== stringValue(fact.owner_id) ||
      stringValue(assertion.category) !== stringValue(fact.category) ||
      stringValue(assertion.key) !== stringValue(fact.key) ||
      stringValue(assertion.value) !== stringValue(fact.value)
    )) {
      mismatchedFactIds.push(factId);
    }
  }
  const missingProjectionAssertionIds: number[] = [];
  const ownerIds = [...new Set(facts.map((fact) => stringValue(fact.owner_id)))];
  for (const ownerId of ownerIds) {
    for (const assertion of currentProjectionAssertions(db, ownerId, at)) {
      const assertionId = numberValue(assertion.id);
      const factId = numberValue(assertion.legacy_fact_id);
      const fact = facts.find((candidate) => numberValue(candidate.id) === factId);
      if (
        factId <= 0 ||
        !fact ||
        fact.superseded_by != null ||
        stringValue(fact.owner_id) !== ownerId ||
        stringValue(fact.category) !== stringValue(assertion.category) ||
        stringValue(fact.key) !== stringValue(assertion.key) ||
        stringValue(fact.value) !== stringValue(assertion.value)
      ) {
        missingProjectionAssertionIds.push(assertionId);
      }
    }
  }
  const independentWriterNames = writerViolations(inventory);
  const errors: string[] = [];
  if (!state) errors.push("memory_contract_state_unavailable");
  if (unmappedFactIds.length > 0) errors.push("unmapped_mem_facts");
  if (mismatchedFactIds.length > 0) errors.push("dual_write_mismatch");
  if (missingProjectionAssertionIds.length > 0) errors.push("missing_mem_fact_projection");
  if (independentWriterNames.length > 0) errors.push("independent_mem_fact_writer");
  return {
    ok: errors.length === 0,
    currentnessAuthority: state?.currentnessAuthority ?? null,
    totalFacts,
    totalAssertions,
    mappedFacts: totalFacts - unmappedFactIds.length,
    unmappedFactIds,
    mismatchedFactIds,
    missingProjectionAssertionIds: [...new Set(missingProjectionAssertionIds)],
    independentWriterNames,
    errors,
  };
}

export function buildLegacyImpactInventory(
  db: DatabaseSync,
  ownerId?: string,
  at = new Date().toISOString(),
): LegacyImpactInventory {
  const ownerClause = ownerId === undefined ? "" : " WHERE owner_id = ?";
  const params = ownerId === undefined ? [] : [ownerId];
  const rows = db.prepare(
    `SELECT subject_facet, COUNT(*) AS count
     FROM memory_assertions${ownerClause}
     GROUP BY subject_facet`,
  ).all(...params).map(asRow).filter((row): row is Row => row !== null);
  const countsByFacet: Record<SubjectFacet, number> = {
    owner_model: 0,
    external_verifiable: 0,
    ashley_side: 0,
    unknown: 0,
  };
  for (const row of rows) {
    const facet = stringValue(row.subject_facet) as SubjectFacet;
    if (facet in countsByFacet) countsByFacet[facet] = numberValue(row.count);
  }
  const totalMigratedAssertions = count(
    db,
    `SELECT COUNT(*) AS count FROM memory_assertions
     WHERE legacy_fact_id IS NOT NULL${ownerId === undefined ? "" : " AND owner_id = ?"}`,
    ...params,
  );
  const remainingUnknown = count(
    db,
    `SELECT COUNT(*) AS count FROM memory_assertions
     WHERE legacy_fact_id IS NOT NULL AND subject_facet = 'unknown'${ownerId === undefined ? "" : " AND owner_id = ?"}`,
    ...params,
  );
  const activeFacts = db.prepare(
    `SELECT f.id, f.owner_id
     FROM mem_facts AS f
     WHERE f.superseded_by IS NULL${ownerId === undefined ? "" : " AND f.owner_id = ?"}
     ORDER BY f.id ASC`,
  ).all(...params).map(asRow).filter((row): row is Row => row !== null);
  let currentlyInfluentialLegacyFacts = 0;
  for (const fact of activeFacts) {
    const assertion = currentAssertionForFact(
      db,
      stringValue(fact.owner_id),
      numberValue(fact.id),
      at,
    );
    if (assertion && !influenceEligibleAt(db, numberValue(assertion.id), at)) {
      currentlyInfluentialLegacyFacts += 1;
    }
  }
  const affected = currentlyInfluentialLegacyFacts > 0
    ? [...AFFECTED_INFLUENCE_PATHS]
    : [];
  return {
    ownerId: ownerId ?? null,
    totalMigratedAssertions,
    countsByFacet,
    remainingUnknown,
    currentlyInfluentialLegacyFacts,
    affectedPaths: affected,
    ownerVisibleBehaviorChange: currentlyInfluentialLegacyFacts > 0 ? "yes" : "no",
  };
}

export function cutoverMemoryAssertions(
  db: DatabaseSync,
  options: {
    now?: string;
    writerInventory?: readonly C1WriterInventoryEntry[];
    testFailAfterMarker?: boolean;
  } = {},
): {
  marker: NonNullable<ReturnType<typeof getMemoryContractState>>;
  consistency: C1ConsistencyReport;
  impact: LegacyImpactInventory;
} {
  assertSupportedContractVersion(db);
  const state = requireMemoryContractState(db);
  const now = options.now ?? new Date().toISOString();
  const writerInventory = options.writerInventory ?? C1_WRITER_INVENTORY;
  if (state.currentnessAuthority === "memory_assertions") {
    const consistency = verifyC1Consistency(db, { at: now, writerInventory });
    if (!consistency.ok) throw new Error("memory_cutover_consistency_failed");
    return {
      marker: state,
      consistency,
      impact: buildLegacyImpactInventory(db, undefined, now),
    };
  }
  const before = verifyC1Consistency(db, { at: now, writerInventory });
  if (before.independentWriterNames.length > 0) {
    throw new Error(
      `memory_cutover_independent_writer:${before.independentWriterNames.join(",")}`,
    );
  }
  if (!before.ok) throw new Error("memory_cutover_consistency_failed");
  const impact = buildLegacyImpactInventory(db, undefined, now);
  return withTransaction(db, () => {
    assertSupportedContractVersion(db);
    const current = requireMemoryContractState(db);
    if (current.currentnessAuthority !== "mem_facts") {
      throw new Error("memory_cutover_authority_changed");
    }
    const rechecked = verifyC1Consistency(db, { at: now, writerInventory });
    if (rechecked.independentWriterNames.length > 0) {
      throw new Error(
        `memory_cutover_independent_writer:${rechecked.independentWriterNames.join(",")}`,
      );
    }
    if (!rechecked.ok) throw new Error("memory_cutover_consistency_failed");
    db.prepare(
      `UPDATE memory_contract_state
       SET currentness_authority = 'memory_assertions', cutover_at = ?
       WHERE id = 1 AND currentness_authority = 'mem_facts'`,
    ).run(now);
    if (options.testFailAfterMarker) throw new Error("memory_cutover_interrupted");
    rebuildMemFactsProjection(db, { at: now });
    const after = verifyC1Consistency(db, { at: now, writerInventory });
    if (!after.ok) throw new Error("memory_cutover_projection_failed");
    const marker = requireMemoryContractState(db);
    return { marker, consistency: after, impact };
  });
}

/** Rebuild the projection on an authority-cutover restart and fail closed on unmapped facts. */
export function repairMemoryProjectionOnStartup(
  db: DatabaseSync,
  options: { at?: string } = {},
): C1ConsistencyReport {
  assertSupportedContractVersion(db);
  const state = requireMemoryContractState(db);
  if (!tableExists(db, "mem_facts")) {
    return {
      ok: true,
      currentnessAuthority: state.currentnessAuthority,
      totalFacts: 0,
      totalAssertions: count(db, "SELECT COUNT(*) AS count FROM memory_assertions"),
      mappedFacts: 0,
      unmappedFactIds: [],
      mismatchedFactIds: [],
      missingProjectionAssertionIds: [],
      independentWriterNames: [],
      errors: [],
    };
  }
  if (state.currentnessAuthority === "mem_facts") {
    return verifyC1Consistency(db, { at: options.at });
  }
  const at = options.at ?? new Date().toISOString();
  return withTransaction(db, () => {
    const before = verifyC1Consistency(db, { at });
    if (before.unmappedFactIds.length > 0) {
      throw new Error("memory_projection_unmapped");
    }
    rebuildMemFactsProjection(db, { at });
    const after = verifyC1Consistency(db, { at });
    if (!after.ok) throw new Error("memory_projection_inconsistent");
    return after;
  });
}
