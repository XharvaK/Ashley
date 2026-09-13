import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";

export const C1_CONTRACT_VERSION = 1;

export const C1_TABLES = [
  "memory_contract_state",
  "memory_assertions",
  "memory_corrections",
  "memory_correction_targets",
  "memory_deny_barriers",
  "memory_deny_barrier_members",
  "memory_contradictions",
  "memory_derivation_links",
  "memory_episode_claims",
  "memory_correction_receipts",
  "memory_correction_outcomes",
  "memory_reconciliation_requests",
] as const;

export const C1_INDEXES = [
  "idx_memory_assertions_owner_authority",
  "idx_memory_assertions_legacy_fact",
  "idx_memory_assertions_legacy_episode",
  "idx_memory_corrections_owner_source",
  "idx_memory_correction_targets_assertion",
  "idx_memory_barrier_members_assertion_open",
  "idx_memory_contradictions_assertion",
  "idx_memory_derivation_links_consumer",
  "idx_memory_episode_claims_assertion",
  "idx_memory_reconciliation_requests_consumer",
] as const;

export const MIGRATION_36_MEMORY_EVIDENCE_DDL = `
CREATE TABLE IF NOT EXISTS memory_contract_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  c1_contract_version INTEGER NOT NULL CHECK (c1_contract_version >= 1),
  currentness_authority TEXT NOT NULL
    CHECK (currentness_authority IN ('mem_facts', 'memory_assertions')),
  cutover_at TEXT,
  applied_c1_authority_exists INTEGER NOT NULL DEFAULT 0
    CHECK (applied_c1_authority_exists IN (0, 1)),
  correction_seq INTEGER NOT NULL DEFAULT 0
    CHECK (correction_seq >= 0)
);

CREATE TABLE IF NOT EXISTS memory_assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('keyed_fact', 'episode_claim', 'owner_interpretation')),
  subject_facet TEXT NOT NULL
    CHECK (subject_facet IN ('owner_model', 'external_verifiable', 'ashley_side', 'unknown')),
  lineage_kind TEXT NOT NULL
    CHECK (lineage_kind IN ('unknown', 'explicit_seed', 'owner_designated', 'observed_overlap', 'ashley_native')),
  derivation_kind TEXT NOT NULL CHECK (derivation_kind IN ('observed', 'derived')),
  support_state TEXT NOT NULL
    CHECK (support_state IN ('supported', 'unsupported', 'uncertain')),
  influence_class TEXT NOT NULL CHECK (influence_class IN ('I0', 'I1', 'I2', 'I3')),
  category TEXT CHECK (category IS NULL OR category IN ('project', 'preference', 'person', 'ongoing', 'pinned')),
  key TEXT,
  value TEXT,
  claim_text TEXT,
  source_kind TEXT NOT NULL,
  source_entity_uuid TEXT,
  source_message_id INTEGER,
  source_quote TEXT,
  legacy_fact_id INTEGER,
  legacy_episode_id INTEGER,
  recorded_at TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  world_interval_basis TEXT NOT NULL
    CHECK (world_interval_basis IN ('adjudicated', 'legacy_unknown')),
  authority_from TEXT,
  authority_to TEXT,
  authority_basis TEXT NOT NULL
    CHECK (authority_basis IN ('adjudicated', 'legacy_supersession', 'legacy_current')),
  termination_reason TEXT
    CHECK (termination_reason IS NULL OR termination_reason IN ('superseded', 'invalidated', 'forgotten', 'scope_refined', 'source_disputed')),
  superseded_by_assertion_id INTEGER REFERENCES memory_assertions(id),
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  importance INTEGER NOT NULL DEFAULT 0 CHECK (importance >= 0 AND importance <= 100),
  data_classification TEXT NOT NULL DEFAULT 'never_public',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind <> 'keyed_fact' OR (category IS NOT NULL AND key IS NOT NULL AND value IS NOT NULL)),
  CHECK (kind = 'keyed_fact' OR claim_text IS NOT NULL),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_from < valid_to),
  CHECK (authority_to IS NULL OR authority_from IS NULL OR authority_from < authority_to)
);

CREATE TABLE IF NOT EXISTS memory_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  source_message_id INTEGER NOT NULL REFERENCES mem_messages(id),
  correction_ordinal INTEGER NOT NULL CHECK (correction_ordinal >= 1),
  admission_path TEXT NOT NULL CHECK (admission_path IN (
    'typed_control', 'typed_slash', 'conversational_deterministic',
    'conversational_owner_confirmed'
  )),
  class TEXT NOT NULL CHECK (class IN (
    'TEMPORAL_SUPERSESSION', 'INTERPRETATION_INVALIDATION',
    'PROVENANCE_CORRECTION', 'SCOPE_REFINEMENT', 'unclassified'
  )),
  scope_text TEXT NOT NULL,
  proposal_json TEXT NOT NULL DEFAULT '{}',
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN (
    'received', 'proposed', 'clarification_required', 'admitted',
    'applying', 'applied', 'observe_recorded', 'rejected'
  )),
  stop_required INTEGER NOT NULL DEFAULT 0 CHECK (stop_required IN (0, 1)),
  barrier_id INTEGER REFERENCES memory_deny_barriers(id),
  adjudicated_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  capability_mode_at_write TEXT NOT NULL
    CHECK (capability_mode_at_write IN ('observe', 'apply')),
  UNIQUE (owner_id, source_message_id, correction_ordinal)
);

CREATE TABLE IF NOT EXISTS memory_correction_targets (
  correction_id INTEGER NOT NULL REFERENCES memory_corrections(id),
  assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),
  inclusion_reason TEXT NOT NULL CHECK (inclusion_reason IN (
    'exact_key', 'unique_value', 'claim_overlap', 'derivation_link',
    'conservative_lexical', 'owner_confirmed'
  )),
  resolution_basis TEXT NOT NULL CHECK (resolution_basis IN (
    'deterministic', 'owner_confirmed', 'conservative_hold', 'proposed', 'rejected'
  )),
  application_state TEXT NOT NULL CHECK (application_state IN (
    'pending', 'held', 'applied', 'skipped'
  )),
  PRIMARY KEY (correction_id, assertion_id)
);

CREATE TABLE IF NOT EXISTS memory_deny_barriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_uuid TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  correction_id INTEGER NOT NULL UNIQUE REFERENCES memory_corrections(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'narrowed', 'released')),
  committed_at TEXT NOT NULL,
  scope_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS memory_deny_barrier_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barrier_id INTEGER NOT NULL REFERENCES memory_deny_barriers(id),
  assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),
  held_from TEXT NOT NULL,
  held_to TEXT,
  hold_reason TEXT NOT NULL CHECK (hold_reason IN ('deterministic', 'owner_confirmed', 'conservative_hold')),
  authorized_by_correction_id INTEGER NOT NULL REFERENCES memory_corrections(id),
  closed_by_correction_id INTEGER REFERENCES memory_corrections(id),
  membership_seq INTEGER NOT NULL CHECK (membership_seq >= 1),
  CHECK (held_to IS NULL OR held_to >= held_from),
  CHECK ((held_to IS NULL AND closed_by_correction_id IS NULL) OR
         (held_to IS NOT NULL AND closed_by_correction_id IS NOT NULL)),
  UNIQUE (barrier_id, membership_seq)
);

CREATE TABLE IF NOT EXISTS memory_contradictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  left_assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),
  right_assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),
  kind TEXT NOT NULL CHECK (kind IN (
    'owner_self_vs_derived', 'peer_derived', 'external_sources',
    'owner_vs_external', 'temporal_nonoverlap'
  )),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved_by_correction', 'recorded_unresolved')),
  created_at TEXT NOT NULL,
  CHECK (left_assertion_id <> right_assertion_id)
);

CREATE TABLE IF NOT EXISTS memory_derivation_links (
  assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),
  consumer_kind TEXT NOT NULL CHECK (consumer_kind IN (
    'episode_claim', 'mind_state_item', 'open_cognitive_item', 'motivation',
    'learning_revision', 'cur_take', 'relationship_target', 'fts_episode'
  )),
  consumer_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (assertion_id, consumer_kind, consumer_id)
);

CREATE TABLE IF NOT EXISTS memory_episode_claims (
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  assertion_id INTEGER NOT NULL REFERENCES memory_assertions(id),
  span_start INTEGER NOT NULL CHECK (span_start >= 0),
  span_end INTEGER NOT NULL CHECK (span_end >= span_start),
  excerpt TEXT NOT NULL,
  PRIMARY KEY (episode_id, assertion_id)
);

CREATE TABLE IF NOT EXISTS memory_correction_receipts (
  correction_id INTEGER PRIMARY KEY REFERENCES memory_corrections(id),
  barrier_committed INTEGER NOT NULL CHECK (barrier_committed IN (0, 1)),
  fanout_state TEXT NOT NULL CHECK (fanout_state IN ('not_started', 'pending', 'complete', 'failed')),
  readback_ok INTEGER NOT NULL CHECK (readback_ok IN (0, 1)),
  barrier_membership_seq_high INTEGER NOT NULL DEFAULT 0
    CHECK (barrier_membership_seq_high >= 0),
  completed_at TEXT,
  CHECK (completed_at IS NULL OR (fanout_state = 'complete' AND readback_ok = 1))
);

CREATE TABLE IF NOT EXISTS memory_correction_outcomes (
  correction_id INTEGER PRIMARY KEY REFERENCES memory_corrections(id),
  class TEXT NOT NULL CHECK (class IN (
    'TEMPORAL_SUPERSESSION', 'INTERPRETATION_INVALIDATION',
    'PROVENANCE_CORRECTION', 'SCOPE_REFINEMENT', 'unclassified'
  )),
  ashley_error_kind TEXT NOT NULL CHECK (ashley_error_kind IN (
    'stale_persistence', 'original_inference_error', 'provenance_error',
    'overgeneralization', 'unknown'
  )),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_reconciliation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  correction_id INTEGER NOT NULL REFERENCES memory_corrections(id),
  consumer_kind TEXT NOT NULL,
  consumer_id INTEGER NOT NULL,
  requested_action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'acknowledged', 'owner_applied', 'owner_declined'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (correction_id, consumer_kind, consumer_id, requested_action)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_assertions_owner_authority
  ON memory_assertions (owner_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_assertions_legacy_fact
  ON memory_assertions (legacy_fact_id) WHERE legacy_fact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_assertions_legacy_episode
  ON memory_assertions (legacy_episode_id) WHERE legacy_episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_corrections_owner_source
  ON memory_corrections (owner_id, source_message_id, correction_ordinal);
CREATE INDEX IF NOT EXISTS idx_memory_correction_targets_assertion
  ON memory_correction_targets (assertion_id, correction_id);
CREATE INDEX IF NOT EXISTS idx_memory_barrier_members_assertion_open
  ON memory_deny_barrier_members (assertion_id, held_to, barrier_id);
CREATE INDEX IF NOT EXISTS idx_memory_contradictions_assertion
  ON memory_contradictions (left_assertion_id, right_assertion_id, status);
CREATE INDEX IF NOT EXISTS idx_memory_derivation_links_consumer
  ON memory_derivation_links (consumer_kind, consumer_id, assertion_id);
CREATE INDEX IF NOT EXISTS idx_memory_episode_claims_assertion
  ON memory_episode_claims (assertion_id, episode_id);
CREATE INDEX IF NOT EXISTS idx_memory_reconciliation_requests_consumer
  ON memory_reconciliation_requests (consumer_kind, consumer_id, status);
`;

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? value as Row : null;
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

function assertionForLegacyFact(
  db: DatabaseSync,
  factId: number,
): Row | null {
  return asRow(db.prepare(
    "SELECT id FROM memory_assertions WHERE legacy_fact_id = ?",
  ).get(factId));
}

function assertionForLegacyEpisode(
  db: DatabaseSync,
  episodeId: number,
): Row | null {
  return asRow(db.prepare(
    "SELECT id FROM memory_assertions WHERE legacy_episode_id = ?",
  ).get(episodeId));
}

function backfillLegacyFacts(db: DatabaseSync): void {
  if (!tableExists(db, "mem_facts")) return;
  const rows = db.prepare(
    `SELECT id, owner_id, category, key, value, confidence, importance,
            source_message_id, source_quote, superseded_by, created_at,
            data_classification
     FROM mem_facts ORDER BY id`,
  ).all() as Row[];
  const byId = new Map<number, Row>();
  for (const fact of rows) byId.set(numberValue(fact.id), fact);
  const assertionIds = new Map<number, number>();
  const insert = db.prepare(
    `INSERT INTO memory_assertions
       (entity_uuid, owner_id, kind, subject_facet, lineage_kind,
        derivation_kind, support_state, influence_class, category, key, value,
        source_kind, source_message_id, source_quote, legacy_fact_id,
        recorded_at, valid_from, valid_to, world_interval_basis,
        authority_from, authority_to, authority_basis, termination_reason,
        confidence, importance, data_classification, created_at, updated_at)
     VALUES (?, ?, 'keyed_fact', 'unknown', 'unknown', 'derived', 'supported',
             'I0', ?, ?, ?, 'legacy_mem_fact', ?, ?, ?, ?, NULL, NULL,
             'legacy_unknown', NULL, ?, ?, ?, ?, ?, ?, ?, ?)` ,
  );
  for (const fact of rows) {
    const factId = numberValue(fact.id);
    const existing = assertionForLegacyFact(db, factId);
    if (existing) {
      assertionIds.set(factId, numberValue(existing.id));
      continue;
    }
    const successorId = fact.superseded_by == null
      ? null
      : numberValue(fact.superseded_by);
    const forgotten = successorId === factId;
    const successor = successorId === null || forgotten
      ? null
      : byId.get(successorId);
    const createdAt = textValue(fact.created_at, new Date(0).toISOString());
    const termination = forgotten
      ? "forgotten"
      : successor
        ? "superseded"
        : null;
    const authorityBasis = successor ? "legacy_supersession" : "legacy_current";
    const authorityTo = successor
      ? textValue(successor.created_at, createdAt)
      : null;
    const result = insert.run(
      newEntityUuid(),
      textValue(fact.owner_id),
      textValue(fact.category),
      textValue(fact.key),
      textValue(fact.value),
      fact.source_message_id == null ? null : numberValue(fact.source_message_id),
      fact.source_quote == null ? null : textValue(fact.source_quote),
      factId,
      createdAt,
      authorityTo,
      authorityBasis,
      termination,
      Math.max(0, Math.min(1, numberValue(fact.confidence))),
      Math.max(0, Math.min(100, Math.round(numberValue(fact.importance)))),
      textValue(fact.data_classification, defaultUnclassifiedConversational()),
      createdAt,
      textValue(fact.updated_at, createdAt),
    );
    assertionIds.set(factId, Number(result.lastInsertRowid));
  }

  const updateSuccessor = db.prepare(
    `UPDATE memory_assertions
     SET superseded_by_assertion_id = ?
     WHERE legacy_fact_id = ? AND termination_reason = 'superseded'`,
  );
  for (const fact of rows) {
    const successorId = fact.superseded_by == null ? null : numberValue(fact.superseded_by);
    if (successorId === null || successorId === numberValue(fact.id)) continue;
    const assertionId = assertionIds.get(successorId);
    if (assertionId === undefined) continue;
    updateSuccessor.run(assertionId, numberValue(fact.id));
  }
}

function backfillLegacyEpisodes(db: DatabaseSync): void {
  if (!tableExists(db, "episodes")) return;
  const columns = tableColumns(db, "episodes");
  const requiredColumns = ["id", "owner_id", "summary", "status", "created_at"];
  if (requiredColumns.some((column) => !columns.has(column))) return;
  const entityUuidExpression = columns.has("entity_uuid")
    ? "entity_uuid"
    : "NULL AS entity_uuid";
  const updatedAtExpression = columns.has("updated_at")
    ? "updated_at"
    : "created_at AS updated_at";
  const classificationExpression = columns.has("data_classification")
    ? "data_classification"
    : "NULL AS data_classification";
  const rows = db.prepare(
    `SELECT id, owner_id, summary, ${entityUuidExpression}, created_at,
            ${updatedAtExpression}, ${classificationExpression}
     FROM episodes WHERE status = 'active' ORDER BY id`,
  ).all() as Row[];
  const insert = db.prepare(
    `INSERT INTO memory_assertions
       (entity_uuid, owner_id, kind, subject_facet, lineage_kind,
        derivation_kind, support_state, influence_class, claim_text,
        source_kind, source_entity_uuid, legacy_episode_id, recorded_at,
        valid_from, valid_to, world_interval_basis, authority_from,
        authority_to, authority_basis, termination_reason, confidence,
        importance, data_classification, created_at, updated_at)
     VALUES (?, ?, 'episode_claim', 'unknown', 'unknown', 'derived', 'supported',
             'I0', ?, 'legacy_episode_summary', ?, ?, ?, NULL, NULL,
             'legacy_unknown', NULL, NULL, 'legacy_current', NULL, 0, 0, ?, ?, ?)` ,
  );
  const claim = db.prepare(
    `INSERT OR IGNORE INTO memory_episode_claims
       (episode_id, assertion_id, span_start, span_end, excerpt)
     VALUES (?, ?, 0, ?, ?)`,
  );
  for (const episode of rows) {
    const episodeId = numberValue(episode.id);
    const summary = textValue(episode.summary);
    const existing = assertionForLegacyEpisode(db, episodeId);
    const assertionId = existing
      ? numberValue(existing.id)
      : Number(insert.run(
        newEntityUuid(),
        textValue(episode.owner_id),
        summary,
        typeof episode.entity_uuid === "string" && episode.entity_uuid.length > 0
          ? episode.entity_uuid
          : null,
        episodeId,
        textValue(episode.created_at, new Date(0).toISOString()),
        typeof episode.data_classification === "string" && episode.data_classification.length > 0
          ? episode.data_classification
          : defaultUnclassifiedConversational(),
        textValue(episode.created_at, new Date(0).toISOString()),
        textValue(episode.updated_at, textValue(episode.created_at, new Date(0).toISOString())),
      ).lastInsertRowid);
    if (!assertionId) continue;
    claim.run(episodeId, assertionId, summary.length, summary);
  }
}

/** Apply the complete additive C1 schema and conservative shadow backfill. */
export function ensureNuclearV36Schema(db: DatabaseSync): void {
  db.exec(MIGRATION_36_MEMORY_EVIDENCE_DDL);
  db.prepare(
    `INSERT OR IGNORE INTO memory_contract_state
       (id, c1_contract_version, currentness_authority, cutover_at,
        applied_c1_authority_exists, correction_seq)
     VALUES (1, ?, 'mem_facts', NULL, 0, 0)`,
  ).run(C1_CONTRACT_VERSION);
  backfillLegacyFacts(db);
  backfillLegacyEpisodes(db);
}

function fail(version: number, detail: string): never {
  throw new Error(`nuclear_schema_content_invalid:v${version}:${detail}`);
}

function requireTable(db: DatabaseSync, version: number, table: string): void {
  if (!tableExists(db, table)) fail(version, `missing_table:${table}`);
}

function requireColumns(
  db: DatabaseSync,
  version: number,
  table: string,
  columns: string[],
): void {
  const names = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>)
      .map((row) => row.name),
  );
  for (const column of columns) {
    if (!names.has(column)) fail(version, `missing_column:${table}.${column}`);
  }
}

function requireSqlFragments(
  db: DatabaseSync,
  version: number,
  table: string,
  fragments: string[],
): void {
  const row = asRow(db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
  const sql = textValue(row?.sql).toLowerCase().replace(/\s+/g, " ");
  for (const fragment of fragments) {
    if (!sql.includes(fragment.toLowerCase())) {
      fail(version, `missing_constraint:${table}:${fragment}`);
    }
  }
}

/** Validate the C1 schema after the migration wrapper commits its DDL. */
export function validateNuclearV36Schema(
  db: DatabaseSync,
  version = 36,
): void {
  const required: Record<string, string[]> = {
    memory_contract_state: [
      "id", "c1_contract_version", "currentness_authority", "cutover_at",
      "applied_c1_authority_exists", "correction_seq",
    ],
    memory_assertions: [
      "id", "entity_uuid", "owner_id", "kind", "subject_facet",
      "lineage_kind", "derivation_kind", "support_state", "influence_class",
      "category", "key", "value", "claim_text", "source_kind",
      "source_entity_uuid", "source_message_id", "source_quote",
      "legacy_fact_id", "legacy_episode_id", "recorded_at", "valid_from",
      "valid_to", "world_interval_basis", "authority_from", "authority_to",
      "authority_basis", "termination_reason", "superseded_by_assertion_id",
      "confidence", "importance", "data_classification", "created_at",
      "updated_at",
    ],
    memory_corrections: [
      "id", "entity_uuid", "owner_id", "source_message_id",
      "correction_ordinal", "admission_path", "class", "scope_text",
      "proposal_json", "lifecycle_status", "stop_required", "barrier_id",
      "adjudicated_at", "idempotency_key", "capability_mode_at_write",
    ],
    memory_correction_targets: [
      "correction_id", "assertion_id", "inclusion_reason", "resolution_basis",
      "application_state",
    ],
    memory_deny_barriers: [
      "id", "entity_uuid", "owner_id", "correction_id", "status",
      "committed_at", "scope_note",
    ],
    memory_deny_barrier_members: [
      "id", "barrier_id", "assertion_id", "held_from", "held_to",
      "hold_reason", "authorized_by_correction_id", "closed_by_correction_id",
      "membership_seq",
    ],
    memory_contradictions: [
      "id", "owner_id", "left_assertion_id", "right_assertion_id", "kind",
      "status", "created_at",
    ],
    memory_derivation_links: [
      "assertion_id", "consumer_kind", "consumer_id", "created_at",
    ],
    memory_episode_claims: [
      "episode_id", "assertion_id", "span_start", "span_end", "excerpt",
    ],
    memory_correction_receipts: [
      "correction_id", "barrier_committed", "fanout_state", "readback_ok",
      "barrier_membership_seq_high", "completed_at",
    ],
    memory_correction_outcomes: [
      "correction_id", "class", "ashley_error_kind", "created_at",
    ],
    memory_reconciliation_requests: [
      "id", "correction_id", "consumer_kind", "consumer_id",
      "requested_action", "status", "created_at", "updated_at",
    ],
  };
  for (const table of C1_TABLES) {
    requireTable(db, version, table);
    requireColumns(db, version, table, required[table] ?? []);
  }
  requireSqlFragments(db, version, "memory_assertions", [
    "unknown", "I0", "I3", "legacy_unknown", "termination_reason",
  ]);
  requireSqlFragments(db, version, "memory_corrections", [
    "unclassified", "stop_required",
  ]);
  requireSqlFragments(db, version, "memory_correction_targets", [
    "conservative_hold", "application_state",
  ]);
  requireSqlFragments(db, version, "memory_deny_barrier_members", [
    "held_to", "membership_seq",
  ]);
  requireSqlFragments(db, version, "memory_correction_receipts", [
    "fanout_state", "readback_ok",
  ]);
  const marker = asRow(db.prepare(
    `SELECT c1_contract_version, currentness_authority, cutover_at,
            applied_c1_authority_exists, correction_seq
     FROM memory_contract_state WHERE id = 1`,
  ).get());
  if (!marker) fail(version, "missing_marker_row");
  if (numberValue(marker.c1_contract_version) < C1_CONTRACT_VERSION) {
    fail(version, "c1_contract_version_too_old");
  }
  if (marker.currentness_authority !== "mem_facts" &&
      marker.currentness_authority !== "memory_assertions") {
    fail(version, "invalid_currentness_authority");
  }
}
