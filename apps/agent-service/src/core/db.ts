import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  dataPlaneOwnsFile,
  isolatedPlaneForFile,
  isReservedProductionStoragePath,
  mayMigrateStorage,
  reservedProductionDataDir,
  reservedProductionNuclearDbPath,
  type DataPlaneContext,
} from "./data-plane.js";
import {
  beginNuclearMigration,
  ensureAuthoritativeLineage,
  finalizeNuclearMigration,
  getPendingNuclearMigration,
  markNuclearMigrationCommitted,
  openContinuityDb,
  recordContinuityEvent,
  rollbackNuclearMigration,
  requireLineageMatch,
  requireSidecarLineageForNuclearMirror,
  type NuclearMigrationDescriptor,
} from "./continuity/db.js";
import { ensureEntityUuidAndClassification } from "./continuity/nuclear-targetable.js";
import { registerContinuityFor, getContinuityFor, getContinuityForNuclearPath } from "./continuity/registry.js";
import {
  MIGRATION_14_DECISION_LOG_COLUMNS,
  MIGRATION_14_MOTIVATIONS_KIND,
  MIGRATION_14_RELATIONSHIP_DDL,
} from "./relationship/migration-14.js";
import {
  MIGRATION_15_ATTENTION_PURPOSE,
  MIGRATION_15_PERCEPTION_DDL,
} from "./perception/migration-15.js";
import { MIGRATION_18_ATTENTION_BUCKETS } from "./perception/migration-18.js";
import {
  migrateCapabilityContractV1ToV2,
  migrateCapabilityContractV2ToV3,
} from "./rollout/contract-migrate.js";
import {
  MIGRATION_16_CHANGE_PROPOSAL_DDL,
} from "./change-proposal/migration-16.js";
import {
  MIGRATION_17_EXTERNAL_AGENCY_DDL,
} from "./external-agency/migration-17.js";
import { MIGRATION_19_SANDBOX_APPROVAL_DDL } from "./sandbox/migration-19.js";
import { MIGRATION_20_CAPABILITY_EVENT_KINDS_DDL } from "./rollout/migration-20.js";
import { MIGRATION_21_PROVENANCE_DDL } from "./provenance/migration-21.js";
import { MIGRATION_22_RECALL_AUTHORITY_DDL } from "./provenance/migration-22.js";
import { MIGRATION_23_OPEN_COGNITIVE_ITEMS_DDL } from "./cognition/migration-23.js";
import {
  ensureNuclearV28Schema,
  ensureOpenCognitiveV24Schema,
  ensureOpenCognitiveV25Schema,
  validateNuclearSchemaContent,
} from "./cognition/schema-contract.js";
import {
  MIGRATION_24_OPEN_COGNITIVE_ITEMS_DDL,
} from "./cognition/migration-24.js";
import { MIGRATION_25_OPEN_COGNITIVE_ORDERING_DDL } from "./cognition/migration-25.js";
import { MIGRATION_26_RECALL_QUALIFICATION_EPOCHS_DDL } from "./rollout/migration-26.js";
import { MIGRATION_27_SANDBOX_TASK_ADMISSIONS_DDL } from "./sandbox/migration-27.js";
import { MIGRATION_28_THOUGHT_VALIDATION_DDL } from "./agency/migration-28.js";
import {
  ensureNuclearV29Schema,
  MIGRATION_29_PHASE_LIFECYCLE_DDL,
} from "./delivery/migration-29.js";
import {
  ensureNuclearV30Schema,
  MIGRATION_30_CANDIDATE_CHANGESET_DDL,
} from "./sandbox/migration-30.js";
import {
  ensureNuclearV31Schema,
  MIGRATION_31_BOUNDED_OPERATION_DDL,
} from "./sandbox/migration-31.js";
import {
  ensureNuclearV32Schema,
  MIGRATION_32_PATCH_EXPORT_DDL,
} from "./sandbox/migration-32.js";
import {
  ensureNuclearV33Schema,
  MIGRATION_33_OPERATIONAL_JOBS_DDL,
} from "./sandbox/migration-33.js";
import {
  ensureNuclearV34Schema,
  MIGRATION_34_DURABLE_COGNITION_DDL,
} from "./sandbox/migration-34.js";
import {
  ensureNuclearV35Schema as ensureNuclearV35DeliverySchema,
  MIGRATION_35_DELIVERY_LANE_DDL,
} from "./sandbox/migration-35.js";
import {
  ensureNuclearV37Schema,
  MIGRATION_37_CONTEXT_BUDGET_DDL,
} from "./context-allocation/migration-36.js";
import {
  ensureNuclearV36Schema,
  MIGRATION_36_MEMORY_EVIDENCE_DDL,
} from "./memory/migration.js";
import {
  ensureNuclearV38Schema,
  MIGRATION_38_LEARNED_AUTONOMY_DDL,
} from "./learned-autonomy/migration-37.js";
import {
  ensureNuclearV39Schema,
  MIGRATION_39_COGNITIVE_GRADUATION_DDL,
} from "./cognitive-graduation/migration-38.js";
import {
  ensureNuclearV40Schema,
  MIGRATION_40_RELATIONAL_GRADUATION_DDL,
} from "./relationship/migration-39.js";
import {
  ensureNuclearV41Schema,
  MIGRATION_41_C1_QUALIFICATION_DDL,
} from "./rollout/migration-41.js";
import {
  ensureNuclearV42Schema,
  MIGRATION_42_COGNITIVE_PROJECTION_KEY_DDL,
} from "./delivery/migration-42.js";
import {
  ensureNuclearV43Schema,
  MIGRATION_43_THOUGHT_ATTEMPT_DDL,
} from "./cognitive-v021/migration-43.js";
import {
  ensureNuclearV44Schema,
  MIGRATION_44_AUTHORITY_BARRIER_DDL,
} from "./cognitive-v021/migration-44.js";
import { reconcileAuthorityBarrierOnStartup } from "./cognitive-v021/authority/barrier.js";
import { repairMemoryProjectionOnStartup } from "./memory/cutover.js";
import {
  continuityGeneration,
  durableSemanticKeyHash,
  semanticIdentityHash,
} from "./cognition/identity.js";
import { currentBuildIdentity } from "./rollout/capabilities.js";

export { reservedProductionNuclearDbPath as NUCLEAR_DB_PATH };

const OBSERVED_NUCLEAR_BASELINE_VERSION = 43 as const;
export const NUCLEAR_SUPPORTED_VERSION = OBSERVED_NUCLEAR_BASELINE_VERSION + 1;

export type NuclearMigrationTestFault =
  | "before_pending"
  | "after_pending"
  | "during_ddl"
  | "after_nuclear_commit"
  | "during_sidecar_update"
  | "after_sidecar_update"
  | "before_finalization";

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS identity_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    TEXT NOT NULL,
  layer       TEXT NOT NULL CHECK (layer IN ('stable', 'dynamic')),
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('seeded', 'organic', 'manual')),
  revised_from INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nuclear_identity_owner
  ON identity_entries (owner_id, layer, updated_at DESC);

CREATE TABLE IF NOT EXISTS opinions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT NOT NULL,
  topic        TEXT NOT NULL,
  stance       TEXT NOT NULL,
  confidence   REAL NOT NULL DEFAULT 0.5,
  revised_from INTEGER,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nuclear_opinions_owner
  ON opinions (owner_id, topic, id DESC);

CREATE TABLE IF NOT EXISTS questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    TEXT NOT NULL,
  subject     TEXT NOT NULL CHECK (subject IN ('about_doc', 'about_self', 'about_world')),
  text        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('open', 'pursuing', 'resolved', 'forgotten')),
  priority    REAL NOT NULL DEFAULT 0.5,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nuclear_questions_open
  ON questions (owner_id, status, priority DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS internal_state (
  owner_id          TEXT PRIMARY KEY,
  focus             TEXT,
  mood              TEXT,
  unfinished_json   TEXT NOT NULL DEFAULT '[]',
  availability      TEXT NOT NULL DEFAULT 'available',
  last_decision_id  INTEGER,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mem_threads (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived')),
  channel             TEXT NOT NULL DEFAULT 'discord',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nuclear_threads_active
  ON mem_threads (owner_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS mem_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   TEXT NOT NULL REFERENCES mem_threads(id),
  owner_id    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text        TEXT NOT NULL,
  channel     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nuclear_messages_hot
  ON mem_messages (thread_id, id DESC);

CREATE TABLE IF NOT EXISTS mem_facts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id          TEXT NOT NULL,
  category          TEXT NOT NULL
                      CHECK (category IN ('project', 'preference', 'person', 'ongoing', 'pinned')),
  key               TEXT NOT NULL,
  value             TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 0.8,
  importance        INTEGER NOT NULL DEFAULT 50,
  source_message_id INTEGER,
  superseded_by     INTEGER,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nuclear_facts_active
  ON mem_facts (owner_id, importance DESC, id DESC)
  WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS cur_sources (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('rss', 'atom', 'json', 'search')),
  url             TEXT NOT NULL,
  interest        TEXT NOT NULL,
  weight          REAL NOT NULL DEFAULT 1,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_fetched_at TEXT,
  last_error      TEXT
);

CREATE TABLE IF NOT EXISTS cur_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    INTEGER NOT NULL REFERENCES cur_sources(id),
  url          TEXT NOT NULL,
  url_key      TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  excerpt      TEXT,
  interest     TEXT NOT NULL,
  published_at TEXT,
  seen_at      TEXT NOT NULL,
  score        REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'scanned'
                 CHECK (status IN ('scanned', 'noted', 'read', 'skipped'))
);
CREATE INDEX IF NOT EXISTS idx_nuclear_items_seen
  ON cur_items (seen_at DESC, score DESC);

CREATE TABLE IF NOT EXISTS cur_takes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES cur_items(id),
  interest     TEXT NOT NULL,
  take         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  surfaced_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_nuclear_takes_recent
  ON cur_takes (created_at DESC);

CREATE TABLE IF NOT EXISTS cur_provenance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL
                CHECK (kind IN ('scan', 'read', 'take', 'search', 'surface',
                                'mention', 'link', 'radar')),
  item_id     INTEGER,
  detail      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nuclear_provenance_recent
  ON cur_provenance (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS motivations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'user_message', 'question', 'fact', 'callback', 'opinion',
                 'take', 'unfinished', 'identity', 'availability', 'silence_signal',
                 'silence_ok'
               )),
  score        REAL NOT NULL,
  ref_type     TEXT,
  ref_id       TEXT,
  summary      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  consumed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_nuclear_motivations_owner
  ON motivations (owner_id, created_at DESC, score DESC);

CREATE TABLE IF NOT EXISTS decision_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id            TEXT NOT NULL,
  channel             TEXT NOT NULL,
  trigger             TEXT NOT NULL CHECK (trigger IN ('reactive', 'proactive')),
  decision_kind       TEXT NOT NULL CHECK (decision_kind IN (
                         'speak', 'silence', 'delay', 'ask', 'revisit',
                         'share', 'challenge'
                       )),
  motivation_ids_json TEXT NOT NULL,
  reason              TEXT NOT NULL,
  outcome_text        TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nuclear_decisions_owner
  ON decision_log (owner_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS initiative_reservations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id           TEXT NOT NULL,
  decision_id        INTEGER NOT NULL REFERENCES decision_log(id),
  text               TEXT NOT NULL,
  thread_id          TEXT NOT NULL,
  angle              TEXT NOT NULL,
  reason             TEXT NOT NULL,
  material_key       TEXT,
  discord_message_id TEXT,
  created_at         TEXT NOT NULL,
  committed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_nuclear_reservations_owner
  ON initiative_reservations (owner_id, created_at DESC);
`;

const MIGRATION_2 = `
ALTER TABLE decision_log
  ADD COLUMN learning_subject_kind TEXT;
ALTER TABLE decision_log
  ADD COLUMN learning_adjustment REAL NOT NULL DEFAULT 0;
ALTER TABLE decision_log
  ADD COLUMN learning_through_event_id INTEGER;

CREATE TABLE reflection_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id              TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('initiative_reaction')),
  source_key            TEXT NOT NULL UNIQUE,
  decision_id           INTEGER,
  reservation_id        INTEGER,
  discord_message_id    TEXT NOT NULL,
  subject_kind          TEXT,
  raw_signal            TEXT NOT NULL,
  classified_signal     TEXT NOT NULL
                            CHECK (classified_signal IN ('positive', 'negative', 'neutral')),
  classifier_version    INTEGER NOT NULL,
  status                TEXT NOT NULL
                            CHECK (status IN ('pending', 'applied', 'ignored')),
  reason                TEXT NOT NULL,
  detail_json           TEXT NOT NULL DEFAULT '{}',
  created_at            TEXT NOT NULL,
  processed_at          TEXT
);
CREATE INDEX idx_reflection_events_owner
  ON reflection_events (owner_id, id DESC);
CREATE INDEX idx_reflection_events_pending
  ON reflection_events (status, owner_id, subject_kind, id);

CREATE TABLE initiative_learning (
  owner_id        TEXT NOT NULL,
  motivation_kind TEXT NOT NULL,
  positive_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  adjustment     REAL NOT NULL DEFAULT 0,
  window_size    INTEGER NOT NULL DEFAULT 0,
  last_event_id  INTEGER,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (owner_id, motivation_kind)
);
`;

const MIGRATION_3 = `
ALTER TABLE decision_log ADD COLUMN objective TEXT;
ALTER TABLE decision_log ADD COLUMN evidence_refs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE decision_log ADD COLUMN effort TEXT NOT NULL DEFAULT 'low';
ALTER TABLE decision_log ADD COLUMN completion TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE decision_log ADD COLUMN uncertainty REAL NOT NULL DEFAULT 0;
ALTER TABLE decision_log ADD COLUMN urgency REAL NOT NULL DEFAULT 0;
ALTER TABLE decision_log ADD COLUMN affect_license_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE episodes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id                TEXT NOT NULL,
  thread_id               TEXT NOT NULL REFERENCES mem_threads(id),
  summary                 TEXT NOT NULL,
  entities                TEXT NOT NULL DEFAULT '',
  source_start_message_id INTEGER NOT NULL REFERENCES mem_messages(id),
  source_end_message_id   INTEGER NOT NULL REFERENCES mem_messages(id),
  salience                REAL NOT NULL DEFAULT 0.5,
  unresolved              INTEGER NOT NULL DEFAULT 0 CHECK (unresolved IN (0, 1)),
  status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'forgotten')),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE(owner_id, thread_id, source_start_message_id, source_end_message_id)
);
CREATE INDEX idx_episodes_owner
  ON episodes (owner_id, status, unresolved DESC, salience DESC, updated_at DESC);

CREATE TABLE episode_messages (
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES mem_messages(id),
  PRIMARY KEY (episode_id, message_id)
);

CREATE VIRTUAL TABLE episodes_fts USING fts5(summary, entities);

CREATE TABLE mind_state_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN (
                'goal', 'concern', 'commitment', 'interest', 'unfinished'
              )),
  text        TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  activation  REAL NOT NULL DEFAULT 0.5,
  urgency     REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'resolved', 'forgotten')),
  due_at      TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(owner_id, kind, source_type, source_id)
);
CREATE INDEX idx_mind_state_active
  ON mind_state_items (owner_id, status, urgency DESC, activation DESC, updated_at DESC);

CREATE TABLE affective_state (
  owner_id    TEXT PRIMARY KEY,
  valence     REAL NOT NULL DEFAULT 0,
  activation  REAL NOT NULL DEFAULT 0.5,
  openness    REAL NOT NULL DEFAULT 0.5,
  tension     REAL NOT NULL DEFAULT 0,
  reason      TEXT NOT NULL DEFAULT 'neutral baseline',
  source_type TEXT,
  source_id   TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE affective_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id         TEXT NOT NULL,
  source_type      TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  valence_delta    REAL NOT NULL,
  activation_delta REAL NOT NULL,
  openness_delta   REAL NOT NULL,
  tension_delta    REAL NOT NULL,
  reason           TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  UNIQUE(owner_id, source_type, source_id)
);
CREATE INDEX idx_affective_events_owner
  ON affective_events (owner_id, created_at DESC);

CREATE TABLE cognitive_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind = 'consolidate_thread'),
  source_key    TEXT NOT NULL UNIQUE,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  available_at  TEXT NOT NULL,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_cognitive_jobs_due
  ON cognitive_jobs (status, available_at, id);

CREATE TABLE cognitive_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES cognitive_jobs(id),
  owner_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  model       TEXT,
  input_json  TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  error       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_cognitive_runs_owner
  ON cognitive_runs (owner_id, created_at DESC);

CREATE TABLE evidence_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE(owner_id, target_type, target_id, source_type, source_id)
);

CREATE TABLE learning_revisions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id       TEXT NOT NULL,
  target_layer   TEXT NOT NULL CHECK (target_layer IN (
                   'dynamic_identity', 'stable_identity', 'opinion'
                 )),
  target_key     TEXT NOT NULL,
  previous_value TEXT,
  proposed_value TEXT NOT NULL,
  rationale      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed', 'applied', 'reverted', 'rejected')),
  apply_after    TEXT NOT NULL,
  applied_at     TEXT,
  reverted_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_learning_revisions_owner
  ON learning_revisions (owner_id, status, target_layer, target_key, created_at DESC);
`;

const MIGRATION_4 = `
ALTER TABLE decision_log ADD COLUMN thought_source TEXT NOT NULL DEFAULT 'deterministic'
  CHECK (thought_source IN ('deterministic', 'model', 'fallback'));
ALTER TABLE decision_log ADD COLUMN thought_error TEXT;

ALTER TABLE mind_state_items ADD COLUMN wake_state TEXT NOT NULL DEFAULT 'consumed'
  CHECK (wake_state IN ('pending', 'claimed', 'consumed'));
ALTER TABLE mind_state_items ADD COLUMN wake_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mind_state_items ADD COLUMN next_wake_at TEXT;
ALTER TABLE mind_state_items ADD COLUMN claimed_at TEXT;
ALTER TABLE mind_state_items ADD COLUMN surfaced_at TEXT;
UPDATE mind_state_items
SET wake_state = 'pending', next_wake_at = updated_at
WHERE status = 'active' AND urgency >= 0.85
  AND kind IN ('commitment', 'concern');
CREATE INDEX idx_mind_state_wake
  ON mind_state_items (owner_id, status, wake_state, next_wake_at, urgency DESC);

ALTER TABLE mem_facts ADD COLUMN origin TEXT NOT NULL DEFAULT 'legacy'
  CHECK (origin IN ('legacy', 'manual', 'explicit_user'));
ALTER TABLE mem_facts ADD COLUMN source_quote TEXT;

ALTER TABLE cognitive_runs ADD COLUMN episode_id INTEGER REFERENCES episodes(id);
CREATE INDEX idx_cognitive_runs_episode ON cognitive_runs (episode_id);

ALTER TABLE learning_revisions ADD COLUMN applied_target_id INTEGER;

CREATE INDEX idx_episodes_thread_end
  ON episodes (owner_id, thread_id, source_end_message_id DESC);
`;

const MIGRATION_5 = `
CREATE TABLE forget_receipts (
  id                    TEXT PRIMARY KEY,
  owner_id              TEXT NOT NULL,
  messages_redacted     INTEGER NOT NULL DEFAULT 0,
  episodes_forgotten    INTEGER NOT NULL DEFAULT 0,
  facts_reconciled      INTEGER NOT NULL DEFAULT 0,
  revisions_reconciled  INTEGER NOT NULL DEFAULT 0,
  state_reconciled      INTEGER NOT NULL DEFAULT 0,
  evidence_removed      INTEGER NOT NULL DEFAULT 0,
  runs_redacted         INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL
);
CREATE INDEX idx_forget_receipts_owner
  ON forget_receipts (owner_id, created_at DESC);

ALTER TABLE mem_messages ADD COLUMN redacted_at TEXT;
ALTER TABLE mem_messages ADD COLUMN redaction_receipt_id TEXT
  REFERENCES forget_receipts(id);
CREATE INDEX idx_nuclear_messages_visible
  ON mem_messages (thread_id, redacted_at, id DESC);

CREATE TABLE cur_reads (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id                INTEGER NOT NULL UNIQUE REFERENCES cur_items(id),
  final_url              TEXT NOT NULL,
  content_hash           TEXT NOT NULL,
  retrieved_at           TEXT NOT NULL,
  model                  TEXT NOT NULL,
  model_metadata_json    TEXT NOT NULL DEFAULT '{}',
  evidence_excerpts_json TEXT NOT NULL DEFAULT '[]',
  cleaned_chars          INTEGER NOT NULL DEFAULT 0,
  created_at             TEXT NOT NULL
);
CREATE INDEX idx_cur_reads_recent ON cur_reads (retrieved_at DESC, id DESC);

ALTER TABLE cur_takes ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'scan_excerpt'
  CHECK (evidence_kind IN ('scan_excerpt', 'read_record'));
ALTER TABLE cur_takes ADD COLUMN read_id INTEGER REFERENCES cur_reads(id);
CREATE INDEX idx_cur_takes_evidence ON cur_takes (evidence_kind, read_id, created_at DESC);
`;

const MIGRATION_6 = `
CREATE TABLE capability_releases (
  capability       TEXT NOT NULL,
  release_id       TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'observe'
                     CHECK (state IN ('observe', 'active', 'rolled_back', 'disabled')),
  eval_seed_count  INTEGER NOT NULL DEFAULT 0,
  qualified_at     TEXT,
  promoted_at      TEXT,
  rolled_back_at   TEXT,
  failure_kind     TEXT,
  failure_reason   TEXT,
  updated_at       TEXT NOT NULL,
  PRIMARY KEY (capability, release_id)
);
CREATE INDEX idx_capability_releases_state
  ON capability_releases (release_id, state, capability);

CREATE TABLE capability_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  capability  TEXT NOT NULL,
  release_id  TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN (
                'isolated_eval', 'live_shadow', 'behavioral_breach',
                'critical_failure'
              )),
  source_key  TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  UNIQUE(capability, release_id, kind, source_key),
  FOREIGN KEY (capability, release_id)
    REFERENCES capability_releases(capability, release_id)
);
CREATE INDEX idx_capability_events_window
  ON capability_events (capability, release_id, kind, occurred_at DESC);
`;

const MIGRATION_7 = `
CREATE TABLE IF NOT EXISTS motivations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL,
  kind TEXT NOT NULL, score REAL NOT NULL, ref_type TEXT, ref_id TEXT,
  summary TEXT NOT NULL, created_at TEXT NOT NULL, consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS decision_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL,
  channel TEXT NOT NULL, trigger TEXT NOT NULL, decision_kind TEXT NOT NULL,
  motivation_ids_json TEXT NOT NULL, reason TEXT NOT NULL, outcome_text TEXT,
  created_at TEXT NOT NULL, learning_subject_kind TEXT,
  learning_adjustment REAL NOT NULL DEFAULT 0,
  learning_through_event_id INTEGER, objective TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]', effort TEXT NOT NULL DEFAULT 'low',
  completion TEXT NOT NULL DEFAULT 'complete', uncertainty REAL NOT NULL DEFAULT 0,
  urgency REAL NOT NULL DEFAULT 0, affect_license_json TEXT NOT NULL DEFAULT '{}',
  thought_source TEXT NOT NULL DEFAULT 'deterministic', thought_error TEXT
);
CREATE TABLE IF NOT EXISTS initiative_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL,
  decision_id INTEGER NOT NULL REFERENCES decision_log(id), text TEXT NOT NULL,
  thread_id TEXT NOT NULL, angle TEXT NOT NULL, reason TEXT NOT NULL,
  material_key TEXT, discord_message_id TEXT, created_at TEXT NOT NULL,
  committed_at TEXT
);

ALTER TABLE motivations RENAME TO motivations_v6;
CREATE TABLE motivations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN (
                 'user_message', 'question', 'fact', 'callback', 'opinion',
                 'take', 'unfinished', 'identity', 'availability', 'boundary',
                 'silence_signal', 'silence_ok'
               )),
  score        REAL NOT NULL,
  ref_type     TEXT,
  ref_id       TEXT,
  summary      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  consumed_at  TEXT
);
INSERT INTO motivations
  (id, owner_id, kind, score, ref_type, ref_id, summary, created_at, consumed_at)
SELECT id, owner_id, kind, score, ref_type, ref_id, summary, created_at, consumed_at
FROM motivations_v6;
DROP TABLE motivations_v6;
CREATE INDEX idx_nuclear_motivations_owner
  ON motivations (owner_id, created_at DESC, score DESC);

ALTER TABLE decision_log RENAME TO decision_log_v6;
CREATE TABLE decision_log (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id                   TEXT NOT NULL,
  channel                    TEXT NOT NULL,
  trigger                    TEXT NOT NULL CHECK (trigger IN ('reactive', 'proactive')),
  decision_kind              TEXT NOT NULL CHECK (decision_kind IN (
                                'speak', 'silence', 'delay', 'ask', 'revisit',
                                'share', 'challenge', 'refuse'
                              )),
  motivation_ids_json        TEXT NOT NULL,
  reason                     TEXT NOT NULL,
  outcome_text               TEXT,
  created_at                 TEXT NOT NULL,
  learning_subject_kind      TEXT,
  learning_adjustment        REAL NOT NULL DEFAULT 0,
  learning_through_event_id  INTEGER,
  objective                  TEXT,
  evidence_refs_json         TEXT NOT NULL DEFAULT '[]',
  effort                     TEXT NOT NULL DEFAULT 'low',
  completion                 TEXT NOT NULL DEFAULT 'complete',
  uncertainty                REAL NOT NULL DEFAULT 0,
  urgency                    REAL NOT NULL DEFAULT 0,
  affect_license_json        TEXT NOT NULL DEFAULT '{}',
  thought_source             TEXT NOT NULL DEFAULT 'deterministic'
                               CHECK (thought_source IN ('deterministic', 'model', 'fallback')),
  thought_error              TEXT
);
INSERT INTO decision_log
  (id, owner_id, channel, trigger, decision_kind, motivation_ids_json,
   reason, outcome_text, created_at, learning_subject_kind, learning_adjustment,
   learning_through_event_id, objective, evidence_refs_json, effort, completion,
   uncertainty, urgency, affect_license_json, thought_source, thought_error)
SELECT id, owner_id, channel, trigger, decision_kind, motivation_ids_json,
       reason, outcome_text, created_at, learning_subject_kind, learning_adjustment,
       learning_through_event_id, objective, evidence_refs_json, effort, completion,
       uncertainty, urgency, affect_license_json, thought_source, thought_error
FROM decision_log_v6;

ALTER TABLE initiative_reservations RENAME TO initiative_reservations_v6;
CREATE TABLE initiative_reservations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id           TEXT NOT NULL,
  decision_id        INTEGER NOT NULL REFERENCES decision_log(id),
  text               TEXT NOT NULL,
  thread_id          TEXT NOT NULL,
  angle              TEXT NOT NULL,
  reason             TEXT NOT NULL,
  material_key       TEXT,
  discord_message_id TEXT,
  created_at         TEXT NOT NULL,
  committed_at       TEXT
);
INSERT INTO initiative_reservations
  (id, owner_id, decision_id, text, thread_id, angle, reason, material_key,
   discord_message_id, created_at, committed_at)
SELECT id, owner_id, decision_id, text, thread_id, angle, reason, material_key,
       discord_message_id, created_at, committed_at
FROM initiative_reservations_v6;
DROP TABLE initiative_reservations_v6;
DROP TABLE decision_log_v6;
CREATE INDEX idx_nuclear_decisions_owner
  ON decision_log (owner_id, created_at DESC, id DESC);
CREATE INDEX idx_nuclear_reservations_owner
  ON initiative_reservations (owner_id, created_at DESC);
`;

const MIGRATION_8 = `
CREATE TABLE IF NOT EXISTS episodes (id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS cognitive_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL,
  kind TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL,
  last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cognitive_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES cognitive_jobs(id), owner_id TEXT NOT NULL,
  kind TEXT NOT NULL, model TEXT, input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, error TEXT,
  created_at TEXT NOT NULL, episode_id INTEGER REFERENCES episodes(id)
);

ALTER TABLE cognitive_jobs RENAME TO cognitive_jobs_v7;
CREATE TABLE cognitive_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('consolidate_thread', 'consolidate_curiosity')),
  source_key    TEXT NOT NULL UNIQUE,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  available_at  TEXT NOT NULL,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
INSERT INTO cognitive_jobs
  (id, owner_id, kind, source_key, payload_json, status, attempts,
   available_at, last_error, created_at, updated_at)
SELECT id, owner_id, kind, source_key, payload_json, status, attempts,
       available_at, last_error, created_at, updated_at
FROM cognitive_jobs_v7;

ALTER TABLE cognitive_runs RENAME TO cognitive_runs_v7;
CREATE TABLE cognitive_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES cognitive_jobs(id),
  owner_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  model       TEXT,
  input_json  TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  error       TEXT,
  created_at  TEXT NOT NULL,
  episode_id  INTEGER REFERENCES episodes(id)
);
INSERT INTO cognitive_runs
  (id, job_id, owner_id, kind, model, input_json, output_json, status,
   error, created_at, episode_id)
SELECT id, job_id, owner_id, kind, model, input_json, output_json, status,
       error, created_at, episode_id
FROM cognitive_runs_v7;
DROP TABLE cognitive_runs_v7;
DROP TABLE cognitive_jobs_v7;
CREATE INDEX idx_cognitive_jobs_due
  ON cognitive_jobs (status, available_at, id);
CREATE INDEX idx_cognitive_runs_owner
  ON cognitive_runs (owner_id, created_at DESC);
CREATE INDEX idx_cognitive_runs_episode ON cognitive_runs (episode_id);

CREATE TABLE IF NOT EXISTS cur_source_candidates (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  url                 TEXT NOT NULL,
  url_key             TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('rss', 'atom', 'json')),
  interest            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'proposed'
                        CHECK (status IN ('proposed', 'probation', 'active', 'rejected')),
  successful_fetches  INTEGER NOT NULL DEFAULT 0,
  originating_read_id INTEGER NOT NULL REFERENCES cur_reads(id),
  last_error          TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cur_source_candidates_status
  ON cur_source_candidates (status, successful_fetches, updated_at);
`;

const MIGRATION_9 = `
CREATE TABLE IF NOT EXISTS identity_reviews (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id             TEXT NOT NULL,
  revision_id          INTEGER NOT NULL UNIQUE REFERENCES learning_revisions(id),
  target_kind          TEXT NOT NULL CHECK (target_kind IN ('value', 'boundary')),
  ashley_position      TEXT CHECK (ashley_position IN ('affirm', 'object', 'defer')),
  ashley_rationale     TEXT,
  ashley_evidence_type TEXT,
  ashley_evidence_id   TEXT,
  ashley_decided_at    TEXT,
  doc_decision         TEXT CHECK (doc_decision IN ('approve', 'reject', 'defer')),
  doc_rationale        TEXT,
  doc_decided_at       TEXT,
  applied_at           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_identity_reviews_owner
  ON identity_reviews (owner_id, applied_at, updated_at DESC, id DESC);
`;

const MIGRATION_10 = `
CREATE TABLE IF NOT EXISTS own_time_sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id          TEXT NOT NULL,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  start_message_id  INTEGER,
  end_message_id    INTEGER,
  created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_own_time_sessions_one_open
  ON own_time_sessions (owner_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_own_time_sessions_owner_ended
  ON own_time_sessions (owner_id, ended_at DESC, id DESC);
`;

const MIGRATION_11 = `
CREATE TABLE IF NOT EXISTS delivery_reservations (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id                   TEXT NOT NULL,
  channel                    TEXT NOT NULL,
  thread_id                  TEXT NOT NULL,
  user_message_id            INTEGER,
  decision_id                INTEGER,
  trigger                    TEXT NOT NULL
                               CHECK (trigger IN ('reactive', 'proactive')),
  initiative_reservation_id  INTEGER,
  state                      TEXT NOT NULL
                               CHECK (state IN (
                                 'drafted', 'reserved', 'sending', 'committed',
                                 'partially_delivered', 'aborted', 'cancelled', 'expired'
                               )),
  error_category             TEXT,
  finalization_reason        TEXT,
  draft_text                 TEXT,
  first_bubble_deadline_at   TEXT,
  first_sent_at              TEXT,
  generation_lease_expires_at TEXT,
  delivery_lease_expires_at  TEXT,
  created_at                 TEXT NOT NULL,
  finalized_at               TEXT
);
CREATE INDEX IF NOT EXISTS idx_delivery_reservations_owner_state
  ON delivery_reservations (owner_id, state, id DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_reservations_decision
  ON delivery_reservations (decision_id);
CREATE INDEX IF NOT EXISTS idx_delivery_reservations_initiative
  ON delivery_reservations (initiative_reservation_id);

CREATE TABLE IF NOT EXISTS delivery_inbound_messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id      INTEGER NOT NULL REFERENCES delivery_reservations(id) ON DELETE CASCADE,
  ordinal             INTEGER NOT NULL,
  owner_id            TEXT NOT NULL,
  channel             TEXT NOT NULL,
  discord_message_id  TEXT NOT NULL,
  UNIQUE (reservation_id, ordinal),
  UNIQUE (owner_id, channel, discord_message_id)
);
CREATE INDEX IF NOT EXISTS idx_delivery_inbound_reservation
  ON delivery_inbound_messages (reservation_id, ordinal);

CREATE TABLE IF NOT EXISTS delivery_bubbles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id      INTEGER NOT NULL REFERENCES delivery_reservations(id) ON DELETE CASCADE,
  ordinal             INTEGER NOT NULL,
  text                TEXT NOT NULL,
  discord_message_id  TEXT,
  sent_at             TEXT,
  UNIQUE (reservation_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_delivery_bubbles_reservation
  ON delivery_bubbles (reservation_id, ordinal);

CREATE TABLE IF NOT EXISTS delivery_auxiliary_messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id      INTEGER NOT NULL REFERENCES delivery_reservations(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('progress', 'delivery_error')),
  text                TEXT NOT NULL,
  discord_message_id  TEXT,
  sent_at             TEXT
);
CREATE INDEX IF NOT EXISTS idx_delivery_aux_reservation
  ON delivery_auxiliary_messages (reservation_id, id);
`;

const MIGRATION_12 = `
CREATE TABLE IF NOT EXISTS attention_dispatch_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_seq INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO attention_dispatch_counter (id, next_seq) VALUES (1, 1);

CREATE TABLE IF NOT EXISTS attention_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane TEXT NOT NULL CHECK (lane IN (
    'interactive', 'urgent_grounded', 'exchange_cognition', 'curiosity_maintenance'
  )),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'expression', 'thought', 'thought_observation', 'exchange_cognition',
    'curiosity_consolidation', 'maintenance'
  )),
  model_alias TEXT NOT NULL,
  resolved_model_id TEXT,
  model_epoch INTEGER,
  state TEXT NOT NULL CHECK (state IN ('queued', 'reserved', 'running', 'terminal')),
  outcome TEXT CHECK (
    outcome IS NULL OR outcome IN (
      'completed', 'cancelled', 'timeout', 'rate_limited', 'error', 'aborted'
    )
  ),
  error_class TEXT,
  queued_at TEXT NOT NULL,
  eligible_at TEXT NOT NULL,
  age_origin_at TEXT NOT NULL,
  deadline_at TEXT,
  reserved_at TEXT,
  dispatch_started_at TEXT,
  ended_at TEXT,
  dispatch_sequence INTEGER,
  lease_expires_at TEXT,
  recovery_class TEXT,
  folded_at TEXT,
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_input_tokens INTEGER NOT NULL DEFAULT 0,
  reserved_output_tokens INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens INTEGER,
  actual_output_tokens INTEGER,
  budget_retain_until TEXT,
  delivery_reservation_id INTEGER,
  decision_id INTEGER,
  cognitive_job_id INTEGER,
  owner_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (state IN ('queued', 'reserved', 'running') AND outcome IS NULL)
    OR (state = 'terminal' AND outcome IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_attention_requests_state_lane
  ON attention_requests (state, lane, eligible_at);
CREATE INDEX IF NOT EXISTS idx_attention_requests_dispatch_seq
  ON attention_requests (dispatch_sequence);
CREATE INDEX IF NOT EXISTS idx_attention_requests_folded
  ON attention_requests (folded_at, ended_at);
CREATE INDEX IF NOT EXISTS idx_attention_requests_budget
  ON attention_requests (state, reserved_at, budget_retain_until);

CREATE TABLE IF NOT EXISTS attention_daily_usage (
  day_utc TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  resolved_model_id TEXT NOT NULL DEFAULT '',
  model_epoch INTEGER NOT NULL DEFAULT 0,
  requests_completed INTEGER NOT NULL DEFAULT 0,
  requests_cancelled INTEGER NOT NULL DEFAULT 0,
  requests_timeout INTEGER NOT NULL DEFAULT 0,
  requests_rate_limited INTEGER NOT NULL DEFAULT 0,
  requests_error INTEGER NOT NULL DEFAULT 0,
  requests_aborted INTEGER NOT NULL DEFAULT 0,
  lane_interactive INTEGER NOT NULL DEFAULT 0,
  lane_urgent_grounded INTEGER NOT NULL DEFAULT 0,
  lane_exchange_cognition INTEGER NOT NULL DEFAULT 0,
  lane_curiosity_maintenance INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens INTEGER NOT NULL DEFAULT 0,
  actual_output_tokens INTEGER NOT NULL DEFAULT 0,
  unknown_reserved_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day_utc, model_alias, resolved_model_id, model_epoch)
);

CREATE TABLE IF NOT EXISTS model_continuity_state (
  alias TEXT PRIMARY KEY,
  resolved_model_id TEXT,
  model_epoch INTEGER NOT NULL DEFAULT 0,
  last_accepted_dispatch_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_continuity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL,
  previous_resolved_id TEXT,
  new_resolved_id TEXT,
  previous_epoch INTEGER,
  new_epoch INTEGER,
  detected_at TEXT NOT NULL,
  dispatch_sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('baseline', 'resolved_change', 'unresolved_alias')),
  action TEXT NOT NULL CHECK (action IN ('none', 'demote_model_sensitive_to_observe'))
);
CREATE INDEX IF NOT EXISTS idx_model_continuity_events_alias
  ON model_continuity_events (alias, detected_at DESC);

CREATE TABLE IF NOT EXISTS capability_contracts (
  contract_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_contracts_one_active
  ON capability_contracts (active) WHERE active = 1;
`;

function ensureCapabilityLineageColumns(db: DatabaseSync): void {
  const releaseCols = new Set(
    (
      db.prepare(`PRAGMA table_info(capability_releases)`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  if (!releaseCols.has("contract_id")) {
    db.exec(`ALTER TABLE capability_releases ADD COLUMN contract_id TEXT`);
  }
  if (!releaseCols.has("build_identity")) {
    db.exec(`ALTER TABLE capability_releases ADD COLUMN build_identity TEXT`);
  }
  if (!releaseCols.has("model_epoch")) {
    db.exec(
      `ALTER TABLE capability_releases ADD COLUMN model_epoch INTEGER NOT NULL DEFAULT 0`,
    );
  }
  const eventCols = new Set(
    (
      db.prepare(`PRAGMA table_info(capability_events)`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );
  if (!eventCols.has("contract_id")) {
    db.exec(`ALTER TABLE capability_events ADD COLUMN contract_id TEXT`);
  }
  if (!eventCols.has("build_identity")) {
    db.exec(`ALTER TABLE capability_events ADD COLUMN build_identity TEXT`);
  }
  if (!eventCols.has("model_epoch")) {
    db.exec(
      `ALTER TABLE capability_events ADD COLUMN model_epoch INTEGER NOT NULL DEFAULT 0`,
    );
  }
}

function userVersion(db: DatabaseSync): number {
  const row: unknown = db.prepare("PRAGMA user_version").get();
  if (typeof row !== "object" || row === null || !("user_version" in row)) {
    return 0;
  }
  const value = row.user_version;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nuclearLineageMirrorId(db: DatabaseSync): string | null {
  const row = db
    .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
    .get() as { lineage_id?: string } | undefined;
  const lineageId = row?.lineage_id?.trim() ?? "";
  return lineageId.length > 0 ? lineageId : null;
}

function reconcilePendingNuclearMigration(
  db: DatabaseSync,
  continuity: DatabaseSync,
): void {
  const pending = getPendingNuclearMigration(continuity);
  if (!pending) return;
  if (
    (pending.from !== 22 || pending.to !== 23) &&
    (pending.from !== 23 || pending.to !== 24) &&
    (pending.from !== 24 || pending.to !== 25) &&
    (pending.from !== 25 || pending.to !== 26) &&
    (pending.from !== 26 || pending.to !== 27) &&
    (pending.from !== 27 || pending.to !== 28) &&
    (pending.from !== 28 || pending.to !== 29) &&
    (pending.from !== 29 || pending.to !== 30) &&
    (pending.from !== 30 || pending.to !== 31) &&
    (pending.from !== 31 || pending.to !== 32) &&
    (pending.from !== 32 || pending.to !== 33) &&
    (pending.from !== 33 || pending.to !== 34) &&
    (pending.from !== 34 || pending.to !== 35) &&
    (pending.from !== 35 || pending.to !== 36) &&
    (pending.from !== 36 || pending.to !== 37) &&
    (pending.from !== 37 || pending.to !== 38) &&
    (pending.from !== 38 || pending.to !== 39) &&
    (pending.from !== 39 || pending.to !== 40) &&
    (pending.from !== 40 || pending.to !== 41)
  ) {
    throw new Error("continuity_pending_migration_unsupported");
  }
  const mirrorLineageId = nuclearLineageMirrorId(db);
  if (!mirrorLineageId) {
    throw new Error("nuclear_lineage_mirror_missing");
  }
  if (mirrorLineageId !== pending.lineageId) {
    const err = new Error("continuity_lineage_mismatch") as Error & { code: string };
    err.code = "continuity_lineage_mismatch";
    throw err;
  }
  const actualVersion = userVersion(db);
  const descriptor: NuclearMigrationDescriptor = {
    from: pending.from,
    to: pending.to,
    lineageId: pending.lineageId,
    buildIdentity: pending.buildIdentity,
  };
  if (actualVersion === pending.from) {
    validateNuclearSchemaContent(db, pending.from as 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44, {
      rejectNewerContent: true,
    });
    rollbackNuclearMigration(continuity, descriptor);
    return;
  }
  if (actualVersion === pending.to) {
    validateNuclearSchemaContent(db, pending.to as 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44, {
      rejectNewerContent: true,
    });
    finalizeNuclearMigration(continuity, descriptor, "recovered");
    return;
  }
  throw new Error(
    `continuity_pending_migration_version_mismatch:${actualVersion}`,
  );
}

function backfillOpenCognitiveIdentityGenerations(db: DatabaseSync): void {
  const rows = db.prepare(
    `SELECT id, owner_id, source_type, source_id, source_entity_uuid, kind,
            semantic_summary, source_revision, contract_id, build_identity,
            model_epoch, model_identity
     FROM open_cognitive_items`,
  ).all() as Array<Record<string, unknown>>;
  const update = db.prepare(
    `UPDATE open_cognitive_items
     SET semantic_key_hash = ?, semantic_identity_hash = ?,
         continuity_generation = ?
     WHERE id = ?`,
  );
  for (const row of rows) {
    const semantic = semanticIdentityHash({
      ownerId: String(row.owner_id ?? ""),
      sourceType: String(row.source_type ?? ""),
      sourceId: String(row.source_id ?? ""),
      sourceEntityUuid: String(row.source_entity_uuid ?? ""),
      kind: String(row.kind ?? ""),
      semanticSummary: String(row.semantic_summary ?? ""),
      sourceRevision: String(row.source_revision ?? ""),
    });
    const generation = continuityGeneration({
      contractId: String(row.contract_id ?? ""),
      buildIdentity: String(row.build_identity ?? ""),
      modelIdentity: String(row.model_identity ?? ""),
      modelEpoch: Number(row.model_epoch ?? 0),
    });
    update.run(
      durableSemanticKeyHash({
        semanticIdentityHash: semantic,
        continuityGeneration: generation,
      }),
      semantic,
      generation,
      Number(row.id),
    );
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_open_cognitive_items_owner_semantic_generation
       ON open_cognitive_items (owner_id, semantic_identity_hash, continuity_generation)
       WHERE semantic_identity_hash <> '' AND continuity_generation <> ''`,
  );
}

function migrateNuclearSchemaWithProtocol(input: {
  db: DatabaseSync;
  continuity?: DatabaseSync;
  descriptor?: NuclearMigrationDescriptor;
  targetVersion: number;
  ddl: string;
  testMigrationFault?: NuclearMigrationTestFault;
  testFailAfterNuclearCommitBeforeContinuityFinalization?: boolean;
}): void {
  const {
    db,
    continuity,
    descriptor,
    targetVersion,
    ddl,
    testMigrationFault,
    testFailAfterNuclearCommitBeforeContinuityFinalization,
  } = input;
  const sidecarEnabled = continuity !== undefined && descriptor !== undefined;
  if (testMigrationFault === "before_pending") {
    throw new Error("test_fault_before_pending");
  }
  if (sidecarEnabled) {
    beginNuclearMigration(continuity, descriptor);
  }
  if (testMigrationFault === "after_pending") {
    throw new Error("test_fault_after_pending");
  }
  let transactionOpened = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionOpened = true;
    if (testMigrationFault === "during_ddl") {
      db.exec("CREATE TABLE migration_fault_probe (id INTEGER PRIMARY KEY)");
      throw new Error("test_fault_during_ddl");
    }
    if (targetVersion === 24) {
      ensureOpenCognitiveV24Schema(db);
      backfillOpenCognitiveIdentityGenerations(db);
    } else if (targetVersion === 25) {
      ensureOpenCognitiveV25Schema(db);
    } else if (targetVersion === 28) {
      ensureNuclearV28Schema(db);
    } else if (targetVersion === 29) {
      ensureNuclearV29Schema(db);
    } else if (targetVersion === 30) {
      ensureNuclearV30Schema(db);
    } else if (targetVersion === 31) {
      ensureNuclearV31Schema(db);
    } else if (targetVersion === 32) {
      ensureNuclearV32Schema(db);
    } else if (targetVersion === 33) {
      ensureNuclearV33Schema(db);
    } else if (targetVersion === 34) {
      ensureNuclearV34Schema(db);
    } else if (targetVersion === 35) {
      ensureNuclearV35DeliverySchema(db);
    } else if (targetVersion === 36) {
      ensureNuclearV36Schema(db);
    } else if (targetVersion === 37) {
      ensureNuclearV37Schema(db);
    } else if (targetVersion === 38) {
      ensureNuclearV38Schema(db);
    } else if (targetVersion === 39) {
      ensureNuclearV39Schema(db);
    } else if (targetVersion === 40) {
      ensureNuclearV40Schema(db);
    } else if (targetVersion === 41) {
      ensureNuclearV41Schema(db);
    } else if (targetVersion === 42) {
      ensureNuclearV42Schema(db);
    } else if (targetVersion === 43) {
      ensureNuclearV43Schema(db);
    } else if (targetVersion === 44) {
      ensureNuclearV44Schema(db);
    } else {
      db.exec(ddl);
    }
    db.exec(`PRAGMA user_version = ${targetVersion}`);
    validateNuclearSchemaContent(
      db,
      targetVersion as 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44,
    );
    const fk = db.prepare("PRAGMA foreign_key_check").all();
    if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
    const integrity = db.prepare("PRAGMA quick_check").get() as
      | { quick_check?: string }
      | undefined;
    if (
      integrity &&
      typeof integrity.quick_check === "string" &&
      integrity.quick_check !== "ok"
    ) {
      throw new Error("nuclear_integrity_failed:" + integrity.quick_check);
    }
    db.exec("COMMIT");
    transactionOpened = false;

    if (sidecarEnabled) {
      if (testMigrationFault === "after_nuclear_commit") {
        throw new Error("test_fault_after_nuclear_commit");
      }
      markNuclearMigrationCommitted(continuity, descriptor);
      if (testFailAfterNuclearCommitBeforeContinuityFinalization) {
        throw new Error(
          "test_fault_after_nuclear_commit_before_continuity_finalization",
        );
      }
      if (testMigrationFault === "after_sidecar_update") {
        throw new Error("test_fault_after_sidecar_update");
      }
      if (testMigrationFault === "before_finalization") {
        throw new Error("test_fault_before_finalization");
      }
      finalizeNuclearMigration(continuity, descriptor);
    }
  } catch (error) {
    if (transactionOpened) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the original migration failure */
      }
    }
    if (sidecarEnabled) {
      try {
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: descriptor.lineageId,
          detail: {
            phase: "failure",
            from: descriptor.from,
            to: descriptor.to,
            error: error instanceof Error ? error.message : "migration_failed",
          },
        });
      } catch {
        /* preserve the migration failure if continuity recording also fails */
      }
    }
    throw error;
  }
}

export function migrate(
  db: DatabaseSync,
  options: {
    continuity?: DatabaseSync;
    skipContinuityRequirement?: boolean;
    testMigrationFault?: NuclearMigrationTestFault;
    /** Test-only fault injection after nuclear commit and before sidecar finalization. */
    testFailAfterNuclearCommitBeforeContinuityFinalization?: boolean;
    dataPlane?: DataPlaneContext;
    migrate?: boolean;
  } = {},
): void {
  db.exec("PRAGMA foreign_keys = ON");
  const version = userVersion(db);
  if (version > NUCLEAR_SUPPORTED_VERSION) {
    const err = new Error(
      `unsupported_nuclear_schema:${version}>${NUCLEAR_SUPPORTED_VERSION}`,
    ) as Error & { code: string; version: number; supportedVersion: number };
    err.code = "unsupported_nuclear_schema";
    err.version = version;
    err.supportedVersion = NUCLEAR_SUPPORTED_VERSION;
    throw err;
  }
  const filePath = nuclearMainFile(db);
  const authorized = mayMigrateStorage({
    filePath,
    plane: options.dataPlane,
    migrate: options.migrate,
  });
  if (!authorized) {
    if (options.migrate === true) {
      const err = new Error("nuclear_migration_authority_required") as Error & { code: string };
      err.code = "nuclear_migration_authority_required";
      throw err;
    }
    if (version >= 25 && version <= NUCLEAR_SUPPORTED_VERSION) {
      validateNuclearSchemaContent(db, version as 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44);
    }
    return;
  }
  if (options.continuity) {
    reconcilePendingNuclearMigration(db, options.continuity);
  }
  if (userVersion(db) < 1) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(SCHEMA);
      db.exec("PRAGMA user_version = 1");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 2) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_2);
      db.exec("PRAGMA user_version = 2");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 3) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_3);
      db.exec("PRAGMA user_version = 3");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 4) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_4);
      db.exec("PRAGMA user_version = 4");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 5) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_5);
      db.exec("PRAGMA user_version = 5");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 6) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_6);
      db.exec("PRAGMA user_version = 6");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 7) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_7);
      db.exec("PRAGMA user_version = 7");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 8) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_8);
      db.exec("PRAGMA user_version = 8");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 9) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_9);
      db.exec("PRAGMA user_version = 9");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 10) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_10);
      db.exec("PRAGMA user_version = 10");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 11) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_11);
      db.exec("PRAGMA user_version = 11");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 12) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_12);
      ensureCapabilityLineageColumns(db);
      // Remap historical release-keyed rows onto the bootstrap contract without
      // merging active state upward unsafely or colliding source keys.
      const now = new Date().toISOString();
      const contractId = "ashley-capability-v1";
      const specHash = "pending-bootstrap";
      db.prepare(
        `INSERT OR IGNORE INTO capability_contracts
           (contract_id, version, spec_hash, created_at, active)
         VALUES (?, '1', ?, ?, 1)`,
      ).run(contractId, specHash, now);

      const releases = db
        .prepare(`SELECT capability, release_id, state, eval_seed_count,
                         qualified_at, promoted_at, rolled_back_at,
                         failure_kind, failure_reason, updated_at
                  FROM capability_releases`)
        .all() as Array<Record<string, unknown>>;
      for (const row of releases) {
        const buildId = String(row.release_id);
        if (buildId === contractId) {
          db.prepare(
            `UPDATE capability_releases
             SET contract_id = ?, build_identity = COALESCE(build_identity, ?)
             WHERE capability = ? AND release_id = ?`,
          ).run(contractId, buildId, String(row.capability), buildId);
          continue;
        }
        db.prepare(
          `INSERT OR IGNORE INTO capability_releases
             (capability, release_id, state, eval_seed_count, qualified_at,
              promoted_at, rolled_back_at, failure_kind, failure_reason,
              updated_at, contract_id, build_identity, model_epoch)
           VALUES (?, ?, 'observe', 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 0)`,
        ).run(String(row.capability), contractId, now, contractId, buildId);
        db.prepare(
          `UPDATE capability_releases
           SET contract_id = ?, build_identity = ?
           WHERE capability = ? AND release_id = ?`,
        ).run(contractId, buildId, String(row.capability), buildId);
      }

      const events = db
        .prepare(
          `SELECT capability, release_id, kind, source_key, detail_json, occurred_at
           FROM capability_events`,
        )
        .all() as Array<Record<string, unknown>>;
      for (const event of events) {
        const buildId = String(event.release_id);
        const remappedKey =
          buildId === contractId
            ? String(event.source_key)
            : `${buildId}:${String(event.source_key)}`;
        db.prepare(
          `INSERT OR IGNORE INTO capability_events
             (capability, release_id, kind, source_key, detail_json, occurred_at,
              contract_id, build_identity, model_epoch)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        ).run(
          String(event.capability),
          contractId,
          String(event.kind),
          remappedKey,
          event.detail_json == null ? null : String(event.detail_json),
          String(event.occurred_at),
          contractId,
          buildId,
        );
        db.prepare(
          `UPDATE capability_events
           SET contract_id = ?, build_identity = ?
           WHERE capability = ? AND release_id = ? AND kind = ? AND source_key = ?`,
        ).run(
          contractId,
          buildId,
          String(event.capability),
          String(event.release_id),
          String(event.kind),
          String(event.source_key),
        );
      }

      db.exec("PRAGMA user_version = 12");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (userVersion(db) < 13) {
    // Exact order: sidecar bootstrap (caller) → lineage validate/adopt →
    // snapshot → pending event → nuclear migrate/backfill.
    const continuity = options.continuity;
    if (!continuity) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorTable = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='lineage_mirror'`,
      )
      .get();
    const mirrorRow = mirrorTable
      ? (db
          .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
          .get() as { lineage_id?: string } | undefined)
      : undefined;
    let lineageId: string;
    if (mirrorRow?.lineage_id) {
      // Prior attempt left a mirror — never replace; sidecar must match.
      lineageId = requireSidecarLineageForNuclearMirror(
        continuity,
        mirrorRow.lineage_id,
        {
          nuclearSchemaVersion: priorVersion,
          buildIdentity: currentBuildIdentity(),
        },
      );
    } else {
      // First migration: adopt exactly once (idempotent on retry).
      lineageId = ensureAuthoritativeLineage(continuity, {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
        adoptIfMissing: true,
      }).lineageId;
    }
    // One consistent pre-migration snapshot per upgrade run — production nuclear path only.
    const snapshotDir = nuclearSnapshotDir(db, options.dataPlane);
    if (snapshotDir) {
        const snapshotPath = allocateSnapshotPath(
          snapshotDir,
          `nuclear-v${priorVersion}-pre13`,
        );
        try {
          const escaped = snapshotPath.replace(/'/g, "''");
          db.exec(`VACUUM INTO '${escaped}'`);
        } catch (error) {
          throw new Error(
            `pre_migration_snapshot_failed:${
              error instanceof Error ? error.message : "vacuum_failed"
            }`,
          );
        }
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId,
          detail: {
            phase: "snapshot",
            from: priorVersion,
            to: 13,
            path: snapshotPath,
          },
        });
    }
    recordContinuityEvent(continuity, {
      kind: "migration",
      lineageId,
      detail: {
        phase: "pending",
        from: priorVersion,
        to: 13,
      },
    });
    db.exec("BEGIN IMMEDIATE");
    try {
      ensureEntityUuidAndClassification(db, lineageId);
      db.exec("PRAGMA user_version = 13");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) {
        throw new Error("nuclear_fk_check_failed");
      }
      const integrity = db.prepare("PRAGMA quick_check").get() as
        | { quick_check?: string }
        | undefined;
      if (
        integrity &&
        typeof integrity.quick_check === "string" &&
        integrity.quick_check !== "ok"
      ) {
        throw new Error(`nuclear_integrity_failed:${integrity.quick_check}`);
      }
      db.exec("COMMIT");
      continuity
        .prepare(
          `UPDATE lineage_state SET nuclear_schema_version = 13, updated_at = ? WHERE id = 1`,
        )
        .run(new Date().toISOString());
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId,
        detail: { phase: "success", from: priorVersion, to: 13 },
      });
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId,
        detail: {
          phase: "failure",
          from: priorVersion,
          to: 13,
          error: error instanceof Error ? error.message : "migration_failed",
        },
      });
      throw error;
    }
  }
  if (userVersion(db) < 14) {
    const continuity = options.continuity;
    if (!continuity) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    if (!mirrorRow?.lineage_id) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    const lineageId = requireSidecarLineageForNuclearMirror(
      continuity,
      mirrorRow.lineage_id,
      {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      },
    );
    const snapshotDir = nuclearSnapshotDir(db, options.dataPlane);
    if (snapshotDir) {
        const snapshotPath = allocateSnapshotPath(
          snapshotDir,
          `nuclear-v${priorVersion}-pre14`,
        );
        try {
          const escaped = snapshotPath.replace(/'/g, "''");
          db.exec(`VACUUM INTO '${escaped}'`);
        } catch (error) {
          throw new Error(
            `pre_migration_snapshot_failed:${
              error instanceof Error ? error.message : "vacuum_failed"
            }`,
          );
        }
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId,
          detail: {
            phase: "snapshot",
            from: priorVersion,
            to: 14,
            path: snapshotPath,
          },
        });
    }
    recordContinuityEvent(continuity, {
      kind: "migration",
      lineageId,
      detail: { phase: "pending", from: priorVersion, to: 14 },
    });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_14_RELATIONSHIP_DDL);
      const decisionCols = new Set(
        (
          db.prepare(`PRAGMA table_info(decision_log)`).all() as Array<{
            name: string;
          }>
        ).map((row) => row.name),
      );
      if (!decisionCols.has("hold_reason_code")) {
        db.exec(MIGRATION_14_DECISION_LOG_COLUMNS);
      }
      db.exec(MIGRATION_14_MOTIVATIONS_KIND);
      ensureEntityUuidAndClassification(db, lineageId);
      migrateCapabilityContractV1ToV2(db);
      db.exec("PRAGMA user_version = 14");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      const integrity = db.prepare("PRAGMA quick_check").get() as
        | { quick_check?: string }
        | undefined;
      if (
        integrity &&
        typeof integrity.quick_check === "string" &&
        integrity.quick_check !== "ok"
      ) {
        throw new Error(`nuclear_integrity_failed:${integrity.quick_check}`);
      }
      db.exec("COMMIT");
      continuity
        .prepare(
          `UPDATE lineage_state SET nuclear_schema_version = 14, updated_at = ? WHERE id = 1`,
        )
        .run(new Date().toISOString());
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId,
        detail: { phase: "success", from: priorVersion, to: 14 },
      });
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId,
        detail: {
          phase: "failure",
          from: priorVersion,
          to: 14,
          error: error instanceof Error ? error.message : "migration_failed",
        },
      });
      throw error;
    }
  }
  if (userVersion(db) < 15) {
    const continuity = options.continuity;
    if (!continuity) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    if (!mirrorRow?.lineage_id) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    const lineageId = requireSidecarLineageForNuclearMirror(
      continuity,
      mirrorRow.lineage_id,
      {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      },
    );
    const snapshotDir = nuclearSnapshotDir(db, options.dataPlane);
    if (snapshotDir) {
        const snapshotPath = allocateSnapshotPath(
          snapshotDir,
          `nuclear-v${priorVersion}-pre15`,
        );
        try {
          const escaped = snapshotPath.replace(/'/g, "''");
          db.exec(`VACUUM INTO '${escaped}'`);
        } catch (error) {
          throw new Error(
            `pre_migration_snapshot_failed:${
              error instanceof Error ? error.message : "vacuum_failed"
            }`,
          );
        }
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId,
          detail: {
            phase: "snapshot",
            from: priorVersion,
            to: 15,
            path: snapshotPath,
          },
        });
    }
    recordContinuityEvent(continuity, {
      kind: "migration",
      lineageId,
      detail: { phase: "pending", from: priorVersion, to: 15 },
    });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_15_PERCEPTION_DDL);
      const attentionCols = db
        .prepare(`PRAGMA table_info(attention_requests)`)
        .all() as Array<{ name: string }>;
      const purposeCol = attentionCols.find((c) => c.name === "purpose");
      const purposeCheck = purposeCol
        ? db
            .prepare(
              `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'attention_requests'`,
            )
            .get() as { sql?: string } | undefined
        : undefined;
      if (
        !purposeCheck?.sql?.includes("attachment_fetch") ||
        !purposeCheck?.sql?.includes("conversational_read")
      ) {
        db.exec(MIGRATION_15_ATTENTION_PURPOSE);
      }
      migrateCapabilityContractV2ToV3(db);
      ensureEntityUuidAndClassification(db, lineageId);
      db.exec("PRAGMA user_version = 15");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      const integrity = db.prepare("PRAGMA quick_check").get() as
        | { quick_check?: string }
        | undefined;
      if (
        integrity &&
        typeof integrity.quick_check === "string" &&
        integrity.quick_check !== "ok"
      ) {
        throw new Error(`nuclear_integrity_failed:${integrity.quick_check}`);
      }
      db.exec("COMMIT");
      continuity
        .prepare(
          `UPDATE lineage_state SET nuclear_schema_version = 15, updated_at = ? WHERE id = 1`,
        )
        .run(new Date().toISOString());
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId,
        detail: { phase: "success", from: priorVersion, to: 15 },
      });
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId,
        detail: {
          phase: "failure",
          from: priorVersion,
          to: 15,
          error: error instanceof Error ? error.message : "migration_failed",
        },
      });
      throw error;
    }
  }
  if (userVersion(db) < 16) {
    const continuity = options.continuity;
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    const lineageId =
      mirrorRow?.lineage_id ??
      (options.skipContinuityRequirement ? "test-lineage" : undefined);
    if (!lineageId) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    if (continuity && mirrorRow?.lineage_id) {
      requireSidecarLineageForNuclearMirror(continuity, mirrorRow.lineage_id, {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      });
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId: mirrorRow.lineage_id,
        detail: { phase: "pending", from: priorVersion, to: 16 },
      });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_16_CHANGE_PROPOSAL_DDL);
      ensureEntityUuidAndClassification(db, lineageId);
      db.exec("PRAGMA user_version = 16");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      db.exec("COMMIT");
      if (continuity && mirrorRow?.lineage_id) {
        continuity
          .prepare(
            `UPDATE lineage_state SET nuclear_schema_version = 16, updated_at = ? WHERE id = 1`,
          )
          .run(new Date().toISOString());
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: { phase: "success", from: priorVersion, to: 16 },
        });
      }
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      if (continuity && mirrorRow?.lineage_id) {
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: {
            phase: "failure",
            from: priorVersion,
            to: 16,
            error: error instanceof Error ? error.message : "migration_failed",
          },
        });
      }
      throw error;
    }
  }
  if (userVersion(db) < 17) {
    const continuity = options.continuity;
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    const lineageId =
      mirrorRow?.lineage_id ??
      (options.skipContinuityRequirement ? "test-lineage" : undefined);
    if (!lineageId) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    if (continuity && mirrorRow?.lineage_id) {
      requireSidecarLineageForNuclearMirror(continuity, mirrorRow.lineage_id, {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      });
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId: mirrorRow.lineage_id,
        detail: { phase: "pending", from: priorVersion, to: 17 },
      });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_17_EXTERNAL_AGENCY_DDL);
      ensureEntityUuidAndClassification(db, lineageId);
      const now = new Date().toISOString();
      const build = currentBuildIdentity();
      const externalCaps = [
        "external_observe",
        "external_prepare",
        "external_private",
        "external_public",
      ];
      for (const capability of externalCaps) {
        db.prepare(
          `INSERT OR IGNORE INTO capability_releases
             (capability, release_id, state, eval_seed_count, qualified_at,
              promoted_at, rolled_back_at, failure_kind, failure_reason,
              updated_at, contract_id, build_identity, model_epoch)
           VALUES (?, ?, 'observe', 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 0)`,
        ).run(capability, "ashley-capability-v3", now, "ashley-capability-v3", build);
      }
      db.exec("PRAGMA user_version = 17");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      db.exec("COMMIT");
      if (continuity && mirrorRow?.lineage_id) {
        continuity
          .prepare(
            `UPDATE lineage_state SET nuclear_schema_version = 17, updated_at = ? WHERE id = 1`,
          )
          .run(new Date().toISOString());
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: { phase: "success", from: priorVersion, to: 17 },
        });
      }
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      if (continuity && mirrorRow?.lineage_id) {
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: {
            phase: "failure",
            from: priorVersion,
            to: 17,
            error: error instanceof Error ? error.message : "migration_failed",
          },
        });
      }
      throw error;
    }
  }
  if (userVersion(db) < 18) {
    const continuity = options.continuity;
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    const lineageId =
      mirrorRow?.lineage_id ??
      (options.skipContinuityRequirement ? "test-lineage" : undefined);
    if (!lineageId) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    if (continuity && mirrorRow?.lineage_id) {
      requireSidecarLineageForNuclearMirror(continuity, mirrorRow.lineage_id, {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      });
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId: mirrorRow.lineage_id,
        detail: { phase: "pending", from: priorVersion, to: 18 },
      });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const attentionCols = db
        .prepare(`PRAGMA table_info(attention_requests)`)
        .all() as Array<{ name: string }>;
      if (!attentionCols.some((c) => c.name === "quota_bucket")) {
        db.exec(MIGRATION_18_ATTENTION_BUCKETS);
      }
      const decisionCols = db
        .prepare(`PRAGMA table_info(decision_log)`)
        .all() as Array<{ name: string }>;
      if (!decisionCols.some((c) => c.name === "expression_fallback_policy")) {
        db.exec(
          `ALTER TABLE decision_log ADD COLUMN expression_fallback_policy TEXT`,
        );
      }
      db.exec("PRAGMA user_version = 18");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      db.exec("COMMIT");
      if (continuity && mirrorRow?.lineage_id) {
        continuity
          .prepare(
            `UPDATE lineage_state SET nuclear_schema_version = 18, updated_at = ? WHERE id = 1`,
          )
          .run(new Date().toISOString());
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: { phase: "success", from: priorVersion, to: 18 },
        });
      }
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      if (continuity && mirrorRow?.lineage_id) {
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: {
            phase: "failure",
            from: priorVersion,
            to: 18,
            error: error instanceof Error ? error.message : "migration_failed",
          },
        });
      }
      throw error;
    }
  }
  if (userVersion(db) < 19) {
    const continuity = options.continuity;
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    const lineageId =
      mirrorRow?.lineage_id ??
      (options.skipContinuityRequirement ? "test-lineage" : undefined);
    if (!lineageId) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    if (continuity && mirrorRow?.lineage_id) {
      requireSidecarLineageForNuclearMirror(continuity, mirrorRow.lineage_id, {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      });
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId: mirrorRow.lineage_id,
        detail: { phase: "pending", from: priorVersion, to: 19 },
      });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_19_SANDBOX_APPROVAL_DDL);
      ensureEntityUuidAndClassification(db, lineageId);
      db.exec("PRAGMA user_version = 19");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      db.exec("COMMIT");
      if (continuity && mirrorRow?.lineage_id) {
        continuity
          .prepare(
            `UPDATE lineage_state SET nuclear_schema_version = 19, updated_at = ? WHERE id = 1`,
          )
          .run(new Date().toISOString());
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: { phase: "success", from: priorVersion, to: 19 },
        });
      }
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      if (continuity && mirrorRow?.lineage_id) {
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: {
            phase: "failure",
            from: priorVersion,
            to: 19,
            error: error instanceof Error ? error.message : "migration_failed",
          },
        });
      }
      throw error;
    }
  }
  if (userVersion(db) < 20) {
    const continuity = options.continuity;
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    const lineageId =
      mirrorRow?.lineage_id ??
      (options.skipContinuityRequirement ? "test-lineage" : undefined);
    if (!lineageId) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    if (continuity && mirrorRow?.lineage_id) {
      requireSidecarLineageForNuclearMirror(continuity, mirrorRow.lineage_id, {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      });
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId: mirrorRow.lineage_id,
        detail: { phase: "pending", from: priorVersion, to: 20 },
      });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_20_CAPABILITY_EVENT_KINDS_DDL);
      db.exec("PRAGMA user_version = 20");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      db.exec("COMMIT");
      if (continuity && mirrorRow?.lineage_id) {
        continuity
          .prepare(
            `UPDATE lineage_state SET nuclear_schema_version = 20, updated_at = ? WHERE id = 1`,
          )
          .run(new Date().toISOString());
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: { phase: "success", from: priorVersion, to: 20 },
        });
      }
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      if (continuity && mirrorRow?.lineage_id) {
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: {
            phase: "failure",
            from: priorVersion,
            to: 20,
            error: error instanceof Error ? error.message : "migration_failed",
          },
        });
      }
      throw error;
    }
  }
  if (userVersion(db) < 21) {
    const continuity = options.continuity;
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    const lineageId =
      mirrorRow?.lineage_id ??
      (options.skipContinuityRequirement ? "test-lineage" : undefined);
    if (!lineageId) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    if (continuity && mirrorRow?.lineage_id) {
      requireSidecarLineageForNuclearMirror(continuity, mirrorRow.lineage_id, {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      });
      recordContinuityEvent(continuity, {
        kind: "migration",
        lineageId: mirrorRow.lineage_id,
        detail: { phase: "pending", from: priorVersion, to: 21 },
      });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATION_21_PROVENANCE_DDL);
      db.exec("PRAGMA user_version = 21");
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      db.exec("COMMIT");
      if (continuity && mirrorRow?.lineage_id) {
        continuity
          .prepare(
            `UPDATE lineage_state SET nuclear_schema_version = 21, updated_at = ? WHERE id = 1`,
          )
          .run(new Date().toISOString());
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: { phase: "success", from: priorVersion, to: 21 },
        });
      }
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      if (continuity && mirrorRow?.lineage_id) {
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: {
            phase: "failure",
            from: priorVersion,
            to: 21,
            error: error instanceof Error ? error.message : "migration_failed",
          },
        });
      }
      throw error;
    }
  }
  if (userVersion(db) < 22) {
    const continuity = options.continuity;
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    const lineageId =
      mirrorRow?.lineage_id ??
      (options.skipContinuityRequirement ? "test-lineage" : undefined);
    if (!lineageId) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    if (continuity && mirrorRow?.lineage_id) {
      requireSidecarLineageForNuclearMirror(continuity, mirrorRow.lineage_id, {
        nuclearSchemaVersion: priorVersion,
        buildIdentity: currentBuildIdentity(),
      });
    }

    let transactionOpened = false;
    try {
      // 1. Create VACUUM INTO pre-v22 snapshot for the real file-backed DB.
      const snapshotDir = nuclearSnapshotDir(db, options.dataPlane);
      if (snapshotDir) {
        const snapshotPath = allocateSnapshotPath(
          snapshotDir,
          `nuclear-v${priorVersion}-pre22`,
        );
        try {
          const escaped = snapshotPath.replace(/'/g, "''");
          db.exec(`VACUUM INTO '${escaped}'`);
        } catch (error) {
          throw new Error(
            `pre_migration_snapshot_failed:${
              error instanceof Error ? error.message : "vacuum_failed"
            }`,
          );
        }
        if (continuity && mirrorRow?.lineage_id) {
          recordContinuityEvent(continuity, {
            kind: "migration",
            lineageId: mirrorRow.lineage_id,
            detail: {
              phase: "snapshot",
              from: priorVersion,
              to: 22,
              path: snapshotPath,
            },
          });
        }
      }

      if (continuity && mirrorRow?.lineage_id) {
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: { phase: "pending", from: priorVersion, to: 22 },
        });
      }

      // 2. Disable foreign keys before the migration transaction and verify it.
      db.exec("PRAGMA foreign_keys = OFF");
      const fkStatusOff = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
      if (fkStatusOff.foreign_keys !== 0) {
        throw new Error("nuclear_fk_disable_failed");
      }

      // 5. BEGIN IMMEDIATE
      db.exec("BEGIN IMMEDIATE");
      transactionOpened = true;
      // 6. Execute v22 structural migration
      db.exec(MIGRATION_22_RECALL_AUTHORITY_DDL);
      // 7. PRAGMA user_version = 22
      db.exec("PRAGMA user_version = 22");
      // 8. PRAGMA foreign_key_check
      const fk = db.prepare("PRAGMA foreign_key_check").all();
      if (fk.length > 0) throw new Error("nuclear_fk_check_failed");
      // 9. PRAGMA quick_check
      const qc = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
      if (qc.quick_check !== "ok") throw new Error("nuclear_quick_check_failed");
      // 10. COMMIT
      db.exec("COMMIT");
      transactionOpened = false;

      // 11. PRAGMA foreign_keys = ON
      db.exec("PRAGMA foreign_keys = ON");
      // 12. Verify PRAGMA foreign_keys returns 1
      const fkStatusOn = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
      if (fkStatusOn.foreign_keys !== 1) {
        throw new Error("nuclear_fk_enable_failed");
      }

      if (continuity && mirrorRow?.lineage_id) {
        continuity
          .prepare(
            `UPDATE lineage_state SET nuclear_schema_version = 22, updated_at = ? WHERE id = 1`,
          )
          .run(new Date().toISOString());
        recordContinuityEvent(continuity, {
          kind: "migration",
          lineageId: mirrorRow.lineage_id,
          detail: { phase: "success", from: priorVersion, to: 22 },
        });
      }
    } catch (error) {
      if (transactionOpened) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
      }
      let foreignKeyRestoreError: Error | null = null;
      try {
        db.exec("PRAGMA foreign_keys = ON");
        const fkStatusOn = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
        if (fkStatusOn.foreign_keys !== 1) {
          throw new Error("nuclear_fk_enable_failed");
        }
      } catch (restoreError) {
        foreignKeyRestoreError = restoreError instanceof Error
          ? restoreError
          : new Error("nuclear_fk_enable_failed");
      }
      if (continuity && mirrorRow?.lineage_id) {
        try {
          recordContinuityEvent(continuity, {
            kind: "migration",
            lineageId: mirrorRow.lineage_id,
            detail: {
              phase: "failure",
              from: priorVersion,
              to: 22,
              error: error instanceof Error ? error.message : "migration_failed",
            },
          });
        } catch {
          /* preserve the migration failure if continuity recording also fails */
        }
      }
      if (foreignKeyRestoreError) {
        throw new Error(
          `${error instanceof Error ? error.message : "migration_failed"};${foreignKeyRestoreError.message}`,
          { cause: error },
        );
      }
      throw error;
    }
  }
  if (userVersion(db) < 23) {
    const continuity = options.continuity;
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    const priorVersion = userVersion(db);
    const lineageId =
      nuclearLineageMirrorId(db) ??
      (options.skipContinuityRequirement ? "test-lineage" : undefined);
    if (!lineageId) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && nuclearLineageMirrorId(db) ? continuity : undefined,
      targetVersion: 23,
      descriptor:
        continuity && nuclearLineageMirrorId(db)
          ? {
              from: priorVersion,
              to: 23,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_23_OPEN_COGNITIVE_ITEMS_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 24) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 24,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 24,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_24_OPEN_COGNITIVE_ITEMS_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 25) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 25,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 25,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_25_OPEN_COGNITIVE_ORDERING_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 26) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 26,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 26,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_26_RECALL_QUALIFICATION_EPOCHS_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 27) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 27,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 27,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_27_SANDBOX_TASK_ADMISSIONS_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 28) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 28,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 28,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_28_THOUGHT_VALIDATION_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 29) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 29,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 29,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_29_PHASE_LIFECYCLE_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 30) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 30,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 30,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_30_CANDIDATE_CHANGESET_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 31) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 31,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 31,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_31_BOUNDED_OPERATION_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 32) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 32,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 32,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_32_PATCH_EXPORT_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 33) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 33,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 33,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_33_OPERATIONAL_JOBS_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 34) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 34,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 34,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_34_DURABLE_COGNITION_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 35) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 35,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 35,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_35_DELIVERY_LANE_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 36) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 36,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 36,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_36_MEMORY_EVIDENCE_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 37) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 37,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 37,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_37_CONTEXT_BUDGET_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 38) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 38,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 38,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_38_LEARNED_AUTONOMY_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 39) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 39,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 39,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_39_COGNITIVE_GRADUATION_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 40) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 40,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 40,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_40_RELATIONAL_GRADUATION_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 41) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 41,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 41,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_41_C1_QUALIFICATION_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 42) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 42,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 42,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_42_COGNITIVE_PROJECTION_KEY_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 43) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 43,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 43,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_43_THOUGHT_ATTEMPT_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) < 44) {
    const continuity = options.continuity;
    const priorVersion = userVersion(db);
    const lineageId = nuclearLineageMirrorId(db);
    if (!continuity && !options.skipContinuityRequirement) {
      throw new Error("continuity_unavailable");
    }
    migrateNuclearSchemaWithProtocol({
      db,
      continuity: continuity && lineageId ? continuity : undefined,
      targetVersion: 44,
      descriptor:
        continuity && lineageId
          ? {
              from: priorVersion,
              to: 44,
              lineageId,
              buildIdentity: currentBuildIdentity(),
            }
          : undefined,
      ddl: MIGRATION_44_AUTHORITY_BARRIER_DDL,
      testMigrationFault: options.testMigrationFault,
      testFailAfterNuclearCommitBeforeContinuityFinalization:
        options.testFailAfterNuclearCommitBeforeContinuityFinalization,
    });
  }
  if (userVersion(db) >= 25) {
    validateNuclearSchemaContent(
      db,
      userVersion(db) as 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44,
    );
  }
  if (!options.skipContinuityRequirement && userVersion(db) >= 15) {
    const continuity = options.continuity;
    if (!continuity) {
      throw new Error("continuity_unavailable");
    }
    const mirrorRow = db
      .prepare(`SELECT lineage_id FROM lineage_mirror WHERE id = 1`)
      .get() as { lineage_id?: string } | undefined;
    if (!mirrorRow?.lineage_id) {
      throw new Error("nuclear_lineage_mirror_missing");
    }
    requireSidecarLineageForNuclearMirror(continuity, mirrorRow.lineage_id, {
      nuclearSchemaVersion: userVersion(db),
      buildIdentity: currentBuildIdentity(),
    });
  }
}

export type OpenNuclearOptions = {
  continuity?: DatabaseSync;
  /** When true, migrate without opening default continuity path (tests). */
  continuityOptional?: boolean;
  /** Test-only protocol fault injection. */
  testMigrationFault?: NuclearMigrationTestFault;
  /** Test-only fault injection after nuclear commit and before sidecar finalization. */
  testFailAfterNuclearCommitBeforeContinuityFinalization?: boolean;
  dataPlane?: DataPlaneContext;
  /** When false, never migrate. Opening is not migration authority. */
  migrate?: boolean;
};

function nuclearMainFile(db: DatabaseSync): string | null {
  const rows = db.prepare("PRAGMA database_list").all() as Array<{
    name?: string;
    file?: string;
  }>;
  const main = rows.find((row) => row.name === "main");
  const file = main?.file?.trim() ?? "";
  return file.length > 0 ? file : null;
}

function nuclearSnapshotDir(
  db: DatabaseSync,
  plane?: DataPlaneContext,
): string | null {
  if (plane) return plane.migrationBackupsDir;
  const mainFile = nuclearMainFile(db);
  if (!mainFile) return null;
  if (isReservedProductionStoragePath(mainFile)) {
    return join(reservedProductionDataDir(), "migration-backups");
  }
  return null;
}

function allocateSnapshotPath(dir: string, basenamePrefix: string): string {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 32; i += 1) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotPath = join(
      dir,
      `${basenamePrefix}-${stamp}-${randomUUID().slice(0, 8)}.db`,
    );
    if (!existsSync(snapshotPath)) return snapshotPath;
  }
  throw new Error("pre_migration_snapshot_failed:unique_path_exhausted");
}

function assertNuclearOpenAllowed(
  filePath: string | null,
  plane?: DataPlaneContext,
): void {
  if (!filePath || filePath === ":memory:") return;
  if (!isReservedProductionStoragePath(filePath)) return;
  if (plane?.kind === "production" && dataPlaneOwnsFile(plane, filePath)) {
    return;
  }
  const err = new Error("production_data_plane_required") as Error & { code: string };
  err.code = "production_data_plane_required";
  throw err;
}

function openDefaultContinuity(
  plane: DataPlaneContext | undefined,
  nuclearFilePath: string | null,
  migrate: boolean | undefined,
): DatabaseSync {
  const shouldMigrate = migrate !== false;
  if (plane?.kind === "isolated" && nuclearFilePath) {
    mkdirSync(dirname(plane.continuityDbPath), { recursive: true });
    return openContinuityDb(new DatabaseSync(plane.continuityDbPath), {
      dataPlane: plane,
      migrate: shouldMigrate,
    });
  }
  if (plane?.kind !== "production") {
    return openContinuityDb(new DatabaseSync(":memory:"), {
      dataPlane: plane,
      migrate: shouldMigrate,
    });
  }
  mkdirSync(dirname(plane.continuityDbPath), { recursive: true });
  return openContinuityDb(new DatabaseSync(plane.continuityDbPath), {
    dataPlane: plane,
    migrate: shouldMigrate,
  });
}

export function nuclearSchemaVersion(db: DatabaseSync): number {
  return userVersion(db);
}

function resolveMigrateOptions(
  db: DatabaseSync,
  options: OpenNuclearOptions,
): OpenNuclearOptions {
  const mainFile = nuclearMainFile(db);
  if (options.dataPlane) return options;
  if (!mainFile) return options;
  if (isReservedProductionStoragePath(mainFile)) return options;
  if (options.migrate === false) return options;
  return {
    ...options,
    migrate: true,
    dataPlane: isolatedPlaneForFile(mainFile),
  };
}

export function connectNuclearDb(
  existing: DatabaseSync,
  options: OpenNuclearOptions = {},
): DatabaseSync {
  return openNuclearDb(existing, { ...options, migrate: false });
}

export function openNuclearDb(
  existing?: DatabaseSync,
  options: OpenNuclearOptions = {},
): DatabaseSync {
  if (!existing) {
    const err = new Error("data_plane_required") as Error & { code: string };
    err.code = "data_plane_required";
    throw err;
  }
  const resolved = resolveMigrateOptions(existing, options);
  assertNuclearOpenAllowed(nuclearMainFile(existing), resolved.dataPlane);
  const mainFile = nuclearMainFile(existing);
  const continuity =
    resolved.continuity ??
    getContinuityFor(existing) ??
    (mainFile ? getContinuityForNuclearPath(mainFile) : undefined) ??
    (resolved.continuityOptional
      ? undefined
      : openDefaultContinuity(resolved.dataPlane, mainFile, resolved.migrate));
  migrate(existing, {
    continuity,
    skipContinuityRequirement: resolved.continuityOptional && !continuity,
    testMigrationFault: resolved.testMigrationFault,
    testFailAfterNuclearCommitBeforeContinuityFinalization:
      resolved.testFailAfterNuclearCommitBeforeContinuityFinalization,
    dataPlane: resolved.dataPlane,
    migrate: resolved.migrate,
  });
  if (userVersion(existing) >= 36) {
    repairMemoryProjectionOnStartup(existing);
  }
  if (continuity) registerContinuityFor(existing, continuity, mainFile);
  if (userVersion(existing) >= 44) reconcileAuthorityBarrierOnStartup(existing);
  return existing;
}
