export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type UnknownValue = "UNKNOWN";

export const COVERAGE_SOURCES = [
  "transcript_session",
  "nuclear",
  "cognitive_sidecar",
  "cognitive_observability",
  "continuity",
] as const;

export type CoverageSource = (typeof COVERAGE_SOURCES)[number];

export const COVERAGE_DISPOSITIONS = [
  "complete_empty",
  "complete_nonempty",
  "partial",
  "unavailable_or_unchecked",
  "completeness_unknown",
] as const;

export type CoverageDisposition = (typeof COVERAGE_DISPOSITIONS)[number];

export type SourceInterval = {
  start: string;
  end: string;
};

export type SourceCoverage = {
  source_identity: string;
  requested_interval: SourceInterval;
  observed_interval: SourceInterval | null | UnknownValue;
  disposition: CoverageDisposition;
  /** Count of rows observed on the source's allowlisted timestamp surfaces. */
  record_count: number | UnknownValue;
  failure_omission_state: string | null | UnknownValue;
};

export type SourceCoverageMap = Record<CoverageSource, SourceCoverage> & {
  /** Modern canonical transcript coverage is optional for legacy direct callers. */
  modern_transcript?: SourceCoverage;
};

export type FieldDayWindow = {
  fieldDay: string;
  timezone: "Europe/Istanbul";
  boundary: "04:00";
  start: Date;
  end: Date;
};

export type SurfaceTableStatus =
  | "present"
  | "schema_surface_absent"
  | "query_failed";

export type SurfaceReport = {
  tables: Record<string, SurfaceTableStatus>;
  used: string[];
  failed: Array<{
    name: string;
    error_class: string;
    state: "UNKNOWN" | "BLOCKED";
  }>;
};

export type Identity = {
  checkoutSha: string | UnknownValue;
  runtimeBuildIdentity: string | UnknownValue;
  runtimeSourceSha: string | UnknownValue;
  buildIdentity: string | UnknownValue;
  contractId: string | UnknownValue;
  nuclearSchemaVersion: number | UnknownValue;
  continuitySchemaVersion: number | UnknownValue;
  lineageId: string | UnknownValue;
  memoryEvidenceState: string | UnknownValue;
  recallState: string | UnknownValue;
  currentnessAuthority: string | UnknownValue;
  c1ContractVersion: number | UnknownValue;
  cutoverAt: string | null | UnknownValue;
  c1EpochId: string | UnknownValue;
  recallEpochId: string | UnknownValue;
  recallCutoffPresent: true | "recall_cutoff_missing" | UnknownValue;
  recallCutoffMessageId: number | string | null | UnknownValue;
  cognitionMode: string | UnknownValue;
  fieldDay: string;
};

export type TranscriptMessage = {
  ts: string;
  role: "user" | "assistant";
  text_redacted: string;
  source: string | null;
  run_id: string | null;
  decision_id: number | string | null;
  episode_id: number | string | null;
  provenance: "live" | "shadow" | "unknown";
  nuclear_message_id: number | string | null;
  join_method: "stable_identifier" | "timestamp_text_hash" | null;
  join_confidence: "high" | "ambiguous" | "none" | null;
  /** Present only when the message came from the modern cognitive evidence log. */
  evidence_row_id?: string | null;
  conversation_id?: string | null;
  discord_message_ids?: string[];
  cycle_id?: string | null;
  generation?: number | null;
  reservation_id?: number | null;
  outbox_id?: number | null;
  settlement_id?: string | null;
  delivery_bubble_ids?: Array<number | string>;
};

export type TranscriptSession = {
  session_id: string;
  channel: string;
  messages: TranscriptMessage[];
  source?: "legacy_jsonl" | "cognitive_v021" | "mixed";
  conversation_id?: string;
};

export type TranscriptGap = {
  class:
    | "UNKNOWN"
    | "MISSING_JSONL"
    | "MISSING_NUCLEAR"
    | "SOURCE_CONFLICT"
    | "MISSING_MODERN"
    | "AMBIGUOUS_MODERN_JOIN";
  detail: string;
};

export type ExternalIngressProjection = {
  /** Stable durable evidence identity. */
  evidence_row_id: string;
  lineage_id: string | UnknownValue;
  evidence_version: number | UnknownValue;
  conversation_id: string;
  cycle_id: string | null | UnknownValue;
  cycle_disposition: string | null | UnknownValue;
  captured_at: string;
  text_redacted: string;
  capture_ref: string | null | UnknownValue;
  discord_message_id: string | null | UnknownValue;
  speaker_principal_id: string | null | UnknownValue;
  speaker_kind: "external_human" | "external_bot" | "UNKNOWN";
  location: JsonObject | UnknownValue;
  audience_at_capture: "dm" | "room" | "UNKNOWN";
  provenance: JsonObject | UnknownValue;
  source_status: string | UnknownValue;
  attachment_count: number | UnknownValue;
  capture_status: string | UnknownValue;
  capture_state: string | UnknownValue;
  admission_status: string | UnknownValue;
  admission_marker_state: string | UnknownValue;
  /** Capture/admission state is mechanical and does not authorize Thought. */
  admission_state:
    | "capture_only"
    | "external_eligible_pending"
    | "quarantined_external"
    | "cognitively_admitted"
    | "UNKNOWN";
  quarantine_reason: string | null | UnknownValue;
  cognition_state: "not_reached" | "cycle_admitted" | "thought_observed" | "UNKNOWN";
  publication_state: "not_attempted" | "observed" | "UNKNOWN";
  delivery_state: "not_attempted" | "delivered" | "partial" | "failed" | "UNKNOWN";
};

export type TranscriptConflict = {
  session_id: string;
  jsonl: {
    ts: string;
    role: "user" | "assistant";
    text_redacted: string;
  };
  nuclear: {
    id: number | string;
    ts: string;
    role: "user" | "assistant";
    text_redacted: string;
  };
  reason: "text_mismatch" | "stable_identifier_mismatch";
};

export type TranscriptDocument = {
  field_day: string;
  identity: Identity | null;
  sessions: TranscriptSession[];
  /** External evidence is explicit and is never folded into ordinary sessions. */
  external_ingress?: ExternalIngressProjection[];
  gaps: TranscriptGap[];
  source_conflicts: TranscriptConflict[];
  source_inventory?: {
    legacy_jsonl: {
      available: boolean;
      record_count: number;
    };
    modern_cognitive: {
      available: boolean;
      activity_count: number;
      record_count: number;
      extraction_status: "complete" | "partial" | "empty" | "unavailable" | "UNKNOWN";
    };
  };
};

export type TranscriptAssembly = {
  coverage: "NORMAL" | "DEGRADED_PARTIAL";
  transcript: TranscriptDocument;
  gaps: TranscriptGap[];
  source_conflicts: TranscriptConflict[];
  legacy_source_available?: boolean;
  legacy_record_count?: number;
  modern_source_attempted?: boolean;
  modern_source_available?: boolean;
  modern_activity_count?: number;
  modern_message_count?: number;
  legacy_gaps?: TranscriptGap[];
  modern_gaps?: TranscriptGap[];
};

export type EvidenceProjection = {
  decision_log: JsonObject[];
  capability_releases: JsonObject[];
  capability_events: JsonObject[];
  memory_contract_state: JsonObject | null | UnknownValue;
  memory_corrections: JsonObject[];
  memory_correction_targets: JsonObject[];
  memory_deny_barriers: JsonObject[];
  memory_deny_barrier_members: JsonObject[];
  memory_correction_receipts: JsonObject[];
  memory_correction_outcomes: JsonObject[];
  memory_reconciliation_requests: JsonObject[];
  memory_evidence_qualification_epochs: JsonObject[];
  memory_evidence_qualification_events: JsonObject[];
  recall_qualification_epochs: JsonObject[];
  recall_qualification_events: JsonObject[];
  recall_live_cutovers: JsonObject[];
  continuity_lineage: JsonObject | null | UnknownValue;
  continuity_sessions: JsonObject[];
  /** Bounded, redacted facts projected from the existing lifecycle owners. */
  cognitive_lifecycle: JsonObject | UnknownValue;
  /** External capture and admission facts, separate from ordinary conversation. */
  external_ingress?: ExternalIngressProjection[];
  /** Per-turn evidence reconstructed from durable modern lifecycle joins. */
  turn_evidence?: JsonObject[];
  /** Observed Expression requests whose durable turn relation may be absent. */
  expression_attempts?: JsonObject[];
};

export type IdentityExtraction = {
  identity: Identity;
  surfaces: SurfaceReport;
};

export type EvidenceExtraction = {
  evidence: EvidenceProjection;
  surfaces: SurfaceReport;
};

export type ExportOptions = {
  dataRoot: string;
  outRoot: string;
  ashleyCheckout: string;
  fieldDay: string;
  closedAsOf?: string;
  now?: Date;
  environment?: Record<string, string | undefined>;
};

export type ExportResult = {
  bundleId: string;
  bundleDir: string;
  files: ["manifest.json", "identity.json", "transcript.json", "evidence.json"];
  coverage: "NORMAL" | "DEGRADED_PARTIAL";
  identity: Identity;
  sourceCoverage: SourceCoverageMap;
};

export type ArtifactType =
  | "transcript"
  | "analysis"
  | "attestation"
  | "finding"
  | "longitudinal"
  | "post_cutover";

export type PublishArtifact = {
  type: ArtifactType;
  source: string;
  target: string;
};

export type PublishManifest = {
  field_day: string;
  bundle_id: string;
  observer_pass_id: string;
  artifacts: PublishArtifact[];
};

export type PublishOptions = {
  artifactsRoot: string;
  fieldLabWorktree: string;
  fieldDay: string;
  bundleId: string;
  observerPassId: string;
  environment?: Record<string, string | undefined>;
  remote?: string;
  branch?: string;
};

export type PublishResult = {
  status: "published" | "noop";
  commit: string | null;
  targets: string[];
};
