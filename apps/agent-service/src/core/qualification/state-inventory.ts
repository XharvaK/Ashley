import type { DatabaseSync } from "node:sqlite";

/**
 * Wave 4 — allowlist-by-EXCLUSION state inventory.
 *
 * `snapshotLive` enumerates EVERY table present in the opened nuclear DB and
 * diffs every row. A table is part of the live behavioral projection only if it
 * is explicitly classified LIVE. Any table not present in LIVE or NON_LIVE (and
 * not an FTS shadow) throws "UNCLASSIFIED_TABLE" — this forces the harness to
 * enumerate new tables rather than silently ignoring them. Differences are
 * confined to an explicit, source-justified exclusion map.
 */

export type TableClass =
  | "LIVE"
  | "SHADOW_ARTIFACT"
  | "CONTROL_PLANE"
  | "OBSERVABILITY_EXCEPTION"
  | "TELEMETRY"
  | "EPHEMERAL_SHADOW_EXECUTION_STATE";

type LiveRule = { cls: "LIVE"; excludeColumns?: string[]; reason: string };
type NonLiveRule = { cls: Exclude<TableClass, "LIVE">; reason: string };
export type Rule = LiveRule | NonLiveRule;

/** Tables whose rows ARE the live behavioral state. Compared exactly. */
const LIVE: Record<string, LiveRule> = {
  internal_state: { cls: "LIVE", reason: "live behavioral/mind state" },
  mem_messages: {
    cls: "LIVE",
    excludeColumns: ["created_at", "entity_uuid"],
    reason: "live conversation history; timestamps/entity_uuid normalized",
  },
  mem_threads: {
    cls: "LIVE",
    excludeColumns: ["created_at", "updated_at", "entity_uuid"],
    reason: "live thread registry; timestamps/entity_uuid normalized",
  },
  mem_facts: { cls: "LIVE", reason: "live facts (motivations + evidence)" },
  opinions: { cls: "LIVE", reason: "live opinions (motivations + evidence)" },
  questions: { cls: "LIVE", reason: "live open questions (motivations)" },
  mind_state_items: { cls: "LIVE", reason: "live mind-state items" },
  affective_state: {
    cls: "LIVE",
    excludeColumns: ["created_at", "updated_at"],
    reason: "live affect; timestamps normalized",
  },
  affective_events: {
    cls: "LIVE",
    excludeColumns: ["created_at", "updated_at"],
    reason: "live affect events; timestamps normalized",
  },
  identity_entries: { cls: "LIVE", reason: "live stable identity block" },
  motivations: {
    cls: "LIVE",
    excludeColumns: ["created_at"],
    reason: "live motivations; timestamp normalized",
  },
  decision_log: {
    cls: "LIVE",
    excludeColumns: ["created_at", "updated_at"],
    reason: "live decision record; timestamps normalized (clock frozen => JSON timestamps match)",
  },
  initiative_reservations: {
    cls: "LIVE",
    excludeColumns: ["entity_uuid"],
    reason: "live proactive machinery; entity_uuid normalized",
  },
  delivery_reservations: {
    cls: "LIVE",
    excludeColumns: ["entity_uuid"],
    reason: "live delivery state; entity_uuid normalized",
  },
  delivery_inbound_messages: {
    cls: "LIVE",
    excludeColumns: ["entity_uuid"],
    reason: "live delivery inbound; entity_uuid normalized",
  },
  delivery_bubbles: {
    cls: "LIVE",
    excludeColumns: ["entity_uuid"],
    reason: "live delivery bubbles; entity_uuid normalized",
  },
  delivery_auxiliary_messages: {
    cls: "LIVE",
    excludeColumns: ["entity_uuid"],
    reason: "live delivery aux; entity_uuid normalized",
  },
  own_time_sessions: { cls: "LIVE", reason: "live own-time session state" },
  reflection_events: { cls: "LIVE", reason: "live reflection input to Decision" },
  initiative_learning: { cls: "LIVE", reason: "live learning snapshot to Decision" },
  doc_reminders: { cls: "LIVE", reason: "live relationship reminder" },
  ashley_self_commitments: { cls: "LIVE", reason: "live self-commitment" },
  mutual_commitments: { cls: "LIVE", reason: "live mutual commitment" },
  scheduled_proactive_messages: { cls: "LIVE", reason: "live scheduled proactive" },
  relational_tensions: { cls: "LIVE", reason: "live relational tension" },
  withdrawal_records: { cls: "LIVE", reason: "live withdrawal record" },
  relationship_motivation_claims: { cls: "LIVE", reason: "live relationship motivation claim" },
  open_cognitive_items: {
    cls: "LIVE",
    reason: "live durable Open Cognitive Item semantic state",
  },
  open_cognitive_item_attention: {
    cls: "LIVE",
    reason: "live durable Open Cognitive Item attention state",
  },
  open_cognitive_item_transitions: {
    cls: "LIVE",
    reason: "live Open Cognitive Item transition audit",
  },
  perception_artifacts: {
    cls: "LIVE",
    excludeColumns: ["created_at", "updated_at", "entity_uuid"],
    reason: "live perception; ids/timestamps normalized",
  },
  conversational_reads: {
    cls: "LIVE",
    excludeColumns: ["created_at", "updated_at", "entity_uuid"],
    reason: "live conversational read; ids/timestamps normalized",
  },
  capability_contracts: { cls: "LIVE", reason: "static capability contract" },
  cur_items: { cls: "LIVE", reason: "LIVE-adjacent shared read-selection state" },
  cur_sources: { cls: "LIVE", reason: "LIVE-adjacent source registry" },
  cur_provenance: { cls: "LIVE", reason: "live read provenance marker" },
  kv: { cls: "LIVE", reason: "not written by shadow" },
  // design-only / retired surfaces, not written by shadow cognition:
  external_actions: { cls: "LIVE", reason: "external agency design-only; not written by shadow" },
  external_action_events: { cls: "LIVE", reason: "external agency design-only; not written by shadow" },
  external_entity_notes: { cls: "LIVE", reason: "external agency design-only; not written by shadow" },
  vault_credential_index: { cls: "LIVE", reason: "external agency design-only; not written by shadow" },
  external_agency_state: { cls: "LIVE", reason: "external agency design-only; not written by shadow" },
};

/** Tables excluded from the live projection (each with a stated reason). */
const NON_LIVE: Record<string, NonLiveRule> = {
  memory_evidence_qualification_epochs: {
    cls: "CONTROL_PLANE",
    reason: "C1 qualification epoch custody; no live semantic authority",
  },
  memory_evidence_qualification_events: {
    cls: "CONTROL_PLANE",
    reason: "C1 qualification evidence ledger; no live semantic authority",
  },
  memory_contract_state: {
    cls: "CONTROL_PLANE",
    reason: "C1 contract marker and cutover ledger; memory_evidence remains unpromoted",
  },
  memory_assertions: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 assertion-first evidence remains observe-only and non-influential before promotion",
  },
  memory_corrections: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 correction proposals and receipts are shadow evidence before promotion",
  },
  memory_correction_targets: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 correction target resolution is shadow-only before promotion",
  },
  memory_deny_barriers: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 deny barriers are observe-only protection artifacts before promotion",
  },
  memory_deny_barrier_members: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 deny-barrier membership history is shadow-only before promotion",
  },
  memory_contradictions: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 contradiction records are evidence artifacts, not promoted live truth",
  },
  memory_derivation_links: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 derivation links are shadow lineage metadata before promotion",
  },
  memory_episode_claims: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 episode claim links remain shadow evidence before promotion",
  },
  memory_correction_receipts: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 correction receipts are settlement evidence, not live behavioral state",
  },
  memory_correction_outcomes: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 correction outcomes are shadow settlement evidence before promotion",
  },
  memory_reconciliation_requests: {
    cls: "SHADOW_ARTIFACT",
    reason: "C1 reconciliation requests are shadow repair metadata before promotion",
  },
  cognitive_maturation_contract_state: {
    cls: "CONTROL_PLANE",
    reason: "C1-C5 contract marker and activation ledger; not live behavioral state",
  },
  context_budget_policies: {
    cls: "SHADOW_ARTIFACT",
    reason: "C2 bounded projection policy metadata; no durable semantic mutation",
  },
  context_allocation_receipts: {
    cls: "SHADOW_ARTIFACT",
    reason: "C2 allocation receipts and route metadata; prompt projection is not memory authority",
  },
  context_summary_projections: {
    cls: "SHADOW_ARTIFACT",
    reason: "C2 bounded summary artifacts; same persistent truth can produce different projections",
  },
  learned_influences: {
    cls: "SHADOW_ARTIFACT",
    reason: "C3 learned bindings remain unpromoted shadow/fixture influence records",
  },
  learned_influence_evidence: {
    cls: "SHADOW_ARTIFACT",
    reason: "C3 evidence links remain subordinate to C1 currentness and provenance",
  },
  learned_choice_receipts: {
    cls: "SHADOW_ARTIFACT",
    reason: "C3 choice receipts prove bounded selection, not Agency authority",
  },
  identity_seed_lineage: {
    cls: "SHADOW_ARTIFACT",
    reason: "C3 seed lineage does not mutate Ashley Identity authority",
  },
  episodes: { cls: "SHADOW_ARTIFACT", reason: "shadow episodes diverge pre-promotion; live subset compared in Track E/C" },
  episode_messages: { cls: "SHADOW_ARTIFACT", reason: "derived from episodes" },
  cognitive_runs: { cls: "SHADOW_ARTIFACT", reason: "shadow analysis run (shadow-only reader)" },
  learning_revisions: {
    cls: "SHADOW_ARTIFACT",
    reason: "shadow revisions never auto-apply; live subset compared in Track P",
  },
  cur_reads: { cls: "SHADOW_ARTIFACT", reason: "shadow reads inert pre-promotion; live subset exact" },
  cur_takes: { cls: "SHADOW_ARTIFACT", reason: "shadow takes inert pre-promotion; live subset exact" },
  cur_source_candidates: { cls: "SHADOW_ARTIFACT", reason: "shadow source candidates inert pre-promotion; live subset exact" },
  evidence_links: {
    cls: "SHADOW_ARTIFACT",
    reason: "links whose source is a live artifact are exact; shadow-sourced may differ — excluded from live projection",
  },
  cognitive_jobs: {
    cls: "CONTROL_PLANE",
    reason: "status/attempts/updated_at/last_error excluded; row identity compared in guard test; readers are executor/prune/owner-endpoints only",
  },
  capability_events: {
    cls: "CONTROL_PLANE",
    reason: "qualification ledger; no live-behavior reader; Fixture C excepted",
  },
  capability_releases: {
    cls: "CONTROL_PLANE",
    reason: "qualification ledger; row SET legitimately differs when shadow execution records live_shadow events for more capabilities (Fixture A) — not live behavioral state. Influence is governed by state='active' + dependency chain, unchanged pre-promotion.",
  },
  recall_qualification_epochs: {
    cls: "CONTROL_PLANE",
    reason: "recall qualification epoch registry; mirrored from the authoritative capability_events ledger; no live-behavior reader",
  },
  recall_qualification_events: {
    cls: "CONTROL_PLANE",
    reason: "recall qualification epoch evidence mirror; duplicated from capability_events; no live-behavior reader",
  },
  model_continuity_state: { cls: "CONTROL_PLANE", reason: "Track M — attention dispatch side effects" },
  model_continuity_events: { cls: "CONTROL_PLANE", reason: "Track M — attention dispatch side effects" },
  open_cognitive_item_wake_cursor: {
    cls: "CONTROL_PLANE",
    reason: "bounded OCI wake scheduling cursor; no semantic authority",
  },
  open_cognitive_item_review_cursor: {
    cls: "CONTROL_PLANE",
    reason: "bounded OCI Reflection review scheduling cursor; no semantic authority",
  },
  attention_requests: { cls: "CONTROL_PLANE", reason: "Track M — attention dispatch side effects" },
  attention_daily_usage: { cls: "CONTROL_PLANE", reason: "Track M — attention dispatch side effects" },
  attention_dispatch_counter: { cls: "CONTROL_PLANE", reason: "Track M — attention dispatch side effects" },
  change_proposals: { cls: "CONTROL_PLANE", reason: "design-only; not written by shadow" },
  change_proposal_events: { cls: "CONTROL_PLANE", reason: "design-only; not written by shadow" },
  identity_reviews: {
    cls: "CONTROL_PLANE",
    reason: "Track R — review state for foundational revisions; never reaches live behavior; requires dual owner approval to apply",
  },
  lineage_mirror: { cls: "CONTROL_PLANE", reason: "continuity lineage ledger; not written by shadow; in-memory sidecar in tests" },
  authority_transition_barrier: {
    cls: "CONTROL_PLANE",
    reason: "W4 cross-owner currentness barrier; coordination state, not live semantic state",
  },
  canonical_owner_versions: {
    cls: "CONTROL_PLANE",
    reason: "W4 canonical-owner version vector; coordination state, not live semantic state",
  },
  derived_invalidation_journal: {
    cls: "CONTROL_PLANE",
    reason: "W4 derived projection invalidation/reconciliation journal; no semantic authority",
  },
  sandbox_approval_events: { cls: "CONTROL_PLANE", reason: "sandbox broker ledger; not written by shadow" },
  sandbox_approval_proposals: { cls: "CONTROL_PLANE", reason: "sandbox broker ledger; not written by shadow" },
  sandbox_task_admissions: {
    cls: "CONTROL_PLANE",
    reason: "observe-only sandbox effect admission ledger; never influences live behavior; shadow turn decisions may differ (deliberation) so the ledger is not part of the live projection",
  },
  candidate_changesets: {
    cls: "CONTROL_PLANE",
    reason: "M5 sealed candidate change-set metadata; advisory work state; not Identity/Mind State/Recall",
  },
  candidate_changeset_events: {
    cls: "CONTROL_PLANE",
    reason: "M5 append-only change-set audit metadata; no patch bytes or secrets",
  },
  bounded_operation_tasks: {
    cls: "CONTROL_PLANE",
    reason: "M6 bounded-operation task work state; audit and safe-stop only; not Identity/Mind State/Recall; no automatic resume",
  },
  operational_jobs: {
    cls: "CONTROL_PLANE",
    reason: "durable operational-job envelope; identity/lifecycle/fencing/reporting; not sandbox authority",
  },
  operational_job_deliveries: {
    cls: "CONTROL_PLANE",
    reason: "idempotent ack/completion delivery linkage for durable operational jobs",
  },
  verification_receipts: {
    cls: "CONTROL_PLANE",
    reason: "M4 verification recovery/evidence receipts; not a permission source",
  },
  bounded_operation_steps: {
    cls: "CONTROL_PLANE",
    reason: "M6 bounded-operation step receipts; operational history only",
  },
  patch_export_records: {
    cls: "CONTROL_PLANE",
    reason: "M7 named patch_export receipt/witness metadata; copy facts only; not apply or Identity",
  },
  engineering_admissions: {
    cls: "CONTROL_PLANE",
    reason: "sandbox engineering task admission ledger; control-plane state",
  },
  engineering_runs: {
    cls: "CONTROL_PLANE",
    reason: "sandbox engineering task run execution state; control-plane state",
  },
  engineering_signals: {
    cls: "CONTROL_PLANE",
    reason: "sandbox engineering runtime cancel signals; control-plane state",
  },
  runtime_flags: {
    cls: "CONTROL_PLANE",
    reason: "dynamic engineering runtime flags; control-plane state",
  },
  forget_receipts: {
    cls: "OBSERVABILITY_EXCEPTION",
    reason: "correction #4: explicit /forget receipt may truthfully include shadow artifact counts; documented, not a behavioral divergence",
  },
  recall_live_cutovers: {
    cls: "CONTROL_PLANE",
    reason: "Track C explicit live watermark configuration",
  },
  cognitive_predictions: {
    cls: "SHADOW_ARTIFACT",
    reason: "C4 selected prediction history; observe/dark-apply integration is not live Thought authority",
  },
  cognitive_outcome_observations: {
    cls: "SHADOW_ARTIFACT",
    reason: "C4 append-only operational observation history; not semantic authority",
  },
  cognitive_outcome_adjudications: {
    cls: "SHADOW_ARTIFACT",
    reason: "C4 append-only semantic adjudication history; not current truth",
  },
  working_view_links: {
    cls: "SHADOW_ARTIFACT",
    reason: "C4 links to C1 assertions; C1 remains currentness authority",
  },
  lived_experience_links: {
    cls: "SHADOW_ARTIFACT",
    reason: "C4 index over independently owned episodes and operational receipts",
  },
  thought_calibration_adjustments: {
    cls: "SHADOW_ARTIFACT",
    reason: "C4 future-Thought calibration history; no current-turn authority",
  },
  relationship_projections: {
    cls: "SHADOW_ARTIFACT",
    reason: "C5 current/history projection; observe or fixture-only dark apply, never live behavioral authority",
  },
  interaction_contracts: {
    cls: "SHADOW_ARTIFACT",
    reason: "C5 typed relationship contracts; accepted state is not promoted live authority",
  },
  consent_records: {
    cls: "SHADOW_ARTIFACT",
    reason: "C5 append-only consent evidence; derived eligibility is not a capability authority flag",
  },
  repair_proposals: {
    cls: "SHADOW_ARTIFACT",
    reason: "C5 repair proposals remain separate from adjudicated relationship state",
  },
  repair_evidence: {
    cls: "SHADOW_ARTIFACT",
    reason: "C5 repair evidence is inspectable shadow evidence, not delivery or authority",
  },
  repair_adjudications: {
    cls: "SHADOW_ARTIFACT",
    reason: "C5 repair adjudication is evidence for Evaluation/Relationship, not a score or authority widening",
  },
};

const FTS_RE = /_fts(_data|_idx|_docsize|_config|_content)?$/;

export function classifyTable(name: string): Rule {
  const live = LIVE[name];
  if (live) return live;
  const nonLive = NON_LIVE[name];
  if (nonLive) return nonLive;
  if (FTS_RE.test(name)) {
    return { cls: "SHADOW_ARTIFACT", reason: "FTS shadow index derived from episodes" };
  }
  throw new Error(`UNCLASSIFIED_TABLE: ${name} — add to LIVE or NON_LIVE map`);
}

export function listTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

const TS_COL_RE = /(_at|timestamp)$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeValue(col: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (col === "entity_uuid" || col === "thread_id") return "<UUID>";
  if (typeof value === "string") {
    if (value.startsWith("local:") || value.startsWith("sim:")) return "<LOCALID>";
    if (UUID_RE.test(value)) return "<UUID>";
    if (TS_COL_RE.test(col) || col === "created_at" || col === "updated_at") {
      return "<TS>";
    }
  }
  return value;
}

function projectRow(rule: LiveRule, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(row)) {
    if (rule.excludeColumns?.includes(col)) continue;
    out[col] = normalizeValue(col, value);
  }
  return out;
}

export type Row = Record<string, unknown>;

function canonRow(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = row[k];
  return JSON.stringify(sorted);
}

export function snapshotTable(db: DatabaseSync, name: string): Row[] {
  return db.prepare(`SELECT * FROM "${name}"`).all() as Row[];
}

/** Full live behavioral projection: only LIVE tables, projected + normalized. */
export function snapshotLive(db: DatabaseSync): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of listTables(db)) {
    const rule = classifyTable(name);
    if (rule.cls !== "LIVE") continue;
    const rows = snapshotTable(db, name).map((row) => canonRow(projectRow(rule, row)));
    rows.sort();
    out[name] = rows;
  }
  return out;
}

/** Rows of every table in a given non-live class (for guarding / reporting). */
export function snapshotClass(db: DatabaseSync, cls: TableClass): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const name of listTables(db)) {
    const rule = classifyTable(name);
    if (rule.cls !== cls) continue;
    out[name] = snapshotTable(db, name);
  }
  return out;
}

export type LiveDiff = {
  table: string;
  onlyInA?: string;
  onlyInB?: string;
  firstColumnDiff?: { column: string; a: unknown; b: unknown };
};

export function diffLive(a: Record<string, string[]>, b: Record<string, string[]>): LiveDiff | null {
  const tables = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const table of [...tables].sort()) {
    const setA = new Set(a[table] ?? []);
    const setB = new Set(b[table] ?? []);
    if (setA.size === setB.size && [...setA].every((v) => setB.has(v))) continue;
    // find a row in A not in B
    for (const row of setA) {
      if (!setB.has(row)) {
        for (const other of setB) {
          const parsedA = JSON.parse(row) as Record<string, unknown>;
          const parsedB = JSON.parse(other) as Record<string, unknown>;
          if (Object.keys(parsedA).length !== Object.keys(parsedB).length) {
            return { table, onlyInA: row };
          }
          for (const col of Object.keys(parsedA)) {
            if (JSON.stringify(parsedA[col]) !== JSON.stringify(parsedB[col])) {
              return {
                table,
                onlyInA: row,
                onlyInB: other,
                firstColumnDiff: { column: col, a: parsedA[col], b: parsedB[col] },
              };
            }
          }
        }
        return { table, onlyInA: row };
      }
    }
    for (const row of setB) {
      if (!setA.has(row)) return { table, onlyInB: row };
    }
  }
  return null;
}

export function expectLiveEquivalent(
  a: Record<string, string[]>,
  b: Record<string, string[]>,
  label = "live projection",
): void {
  const diff = diffLive(a, b);
  if (diff) {
    const detail = diff.firstColumnDiff
      ? ` column=${diff.firstColumnDiff.column} A=${JSON.stringify(diff.firstColumnDiff.a)} B=${JSON.stringify(diff.firstColumnDiff.b)}`
      : diff.onlyInA
        ? ` onlyInA=${diff.onlyInA}`
        : ` onlyInB=${diff.onlyInB}`;
    throw new Error(`LIVE_PROJECTION_DIVERGENCE [${label}] table=${diff.table}${detail}`);
  }
}
