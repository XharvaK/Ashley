import { existsSync, readdirSync, statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { tableColumns, tableExists } from "./sqlite.js";
import { COVERAGE_SOURCES } from "./types.js";
import type {
  CoverageSource,
  FieldDayWindow,
  SourceCoverage,
  SourceCoverageMap,
  TranscriptAssembly,
} from "./types.js";

type DatabaseCoverageSource = Exclude<CoverageSource, "transcript_session">;
type TimestampFormat = "epoch_ms" | "iso";
type CoverageSurface = {
  table: string;
  columns: readonly string[];
  format: TimestampFormat;
};

type CoverageRelation = {
  localColumn: string;
  relatedTable: string;
  relatedColumn: string;
  timestamp: CoverageSurface;
};

type RequiredCoverageSurface = {
  table: string;
  columns: readonly string[];
  timestamp?: CoverageSurface;
  relation?: CoverageRelation;
};

export type FieldDayWhere = {
  sql: string;
  args: readonly (string | number)[];
};

const BOUNDED_ENUMERATION_LIMIT = 501;
const MAX_ENUMERATED_RECORDS = BOUNDED_ENUMERATION_LIMIT - 1;

const SOURCE_IDENTITIES: Record<CoverageSource, string> = {
  transcript_session: "conversations/sessions",
  nuclear: "conversations/nuclear.db",
  cognitive_sidecar: "cognitive-v021.db",
  cognitive_observability: "cognitive-v021-observability.db",
  continuity: "continuity.db",
};

const MODERN_TRANSCRIPT_IDENTITY = "cognitive-v021.db:conversation_evidence_log + lifecycle";

const REQUIRED_DATABASE_SURFACES: Record<DatabaseCoverageSource, readonly RequiredCoverageSurface[]> = {
  nuclear: [
    {
      table: "mem_messages",
      columns: ["created_at"],
      timestamp: { table: "mem_messages", columns: ["created_at"], format: "iso" },
    },
    {
      table: "delivery_reservations",
      columns: ["id", "owner_id", "channel", "thread_id", "trigger", "delivery_lane", "state", "error_category", "finalization_reason", "created_at", "finalized_at", "cognitive_v021_projection_key"],
      timestamp: { table: "delivery_reservations", columns: ["created_at", "finalized_at"], format: "iso" },
    },
    {
      table: "delivery_bubbles",
      columns: ["reservation_id", "ordinal", "discord_message_id", "sent_at"],
      timestamp: { table: "delivery_bubbles", columns: ["sent_at"], format: "iso" },
      relation: {
        localColumn: "reservation_id",
        relatedTable: "delivery_reservations",
        relatedColumn: "id",
        timestamp: { table: "delivery_reservations", columns: ["created_at", "finalized_at"], format: "iso" },
      },
    },
    {
      table: "attention_requests",
      columns: ["id", "purpose", "model_alias", "provider_id", "route_alias", "state", "outcome", "created_at", "dispatch_started_at", "ended_at", "actual_input_tokens", "actual_output_tokens"],
      timestamp: { table: "attention_requests", columns: ["created_at", "dispatch_started_at", "ended_at"], format: "iso" },
    },
  ],
  cognitive_sidecar: [
    {
      table: "inbox_events",
      columns: ["id", "conversation_id", "kind", "created_at_ms", "status", "state", "terminal_reason", "wake_id"],
      timestamp: { table: "inbox_events", columns: ["created_at_ms"], format: "epoch_ms" },
    },
    {
      table: "cycle_records",
      columns: ["cycle_id", "conversation_id", "generation", "state", "admitted_at_ms", "updated_at_ms"],
      timestamp: { table: "cycle_records", columns: ["admitted_at_ms", "updated_at_ms"], format: "epoch_ms" },
    },
    {
      table: "observations",
      columns: ["observation_id", "cycle_id", "generation", "derived", "replay_safe", "modality", "provenance", "created_at_ms"],
      timestamp: { table: "observations", columns: ["created_at_ms"], format: "epoch_ms" },
    },
    {
      table: "wakes",
      columns: ["wake_id", "occurrence_id", "conversation_id", "cycle_id", "state", "terminal_reason", "created_at_ms", "updated_at_ms"],
      timestamp: { table: "wakes", columns: ["created_at_ms", "updated_at_ms"], format: "epoch_ms" },
    },
    {
      table: "settlements",
      columns: ["settlement_id", "cycle_id", "generation", "payload_json"],
      relation: {
        localColumn: "cycle_id",
        relatedTable: "cycle_records",
        relatedColumn: "cycle_id",
        timestamp: { table: "cycle_records", columns: ["admitted_at_ms", "updated_at_ms"], format: "epoch_ms" },
      },
    },
    {
      table: "thought_steps",
      columns: ["request_id", "cycle_id", "generation", "pass", "kind", "payload_json", "created_at_ms"],
      timestamp: { table: "thought_steps", columns: ["created_at_ms"], format: "epoch_ms" },
    },
    {
      table: "speech_outbox",
      columns: ["outbox_id", "settlement_id", "projection_key", "cycle_id", "generation", "send_status", "nuclear_reservation_id", "discord_message_ids_json"],
      relation: {
        localColumn: "cycle_id",
        relatedTable: "cycle_records",
        relatedColumn: "cycle_id",
        timestamp: { table: "cycle_records", columns: ["admitted_at_ms", "updated_at_ms"], format: "epoch_ms" },
      },
    },
    {
      table: "system_notice_outbox",
      columns: ["notice_id", "cycle_id", "conversation_id", "send_status", "nuclear_reservation_id", "discord_message_id"],
      relation: {
        localColumn: "cycle_id",
        relatedTable: "cycle_records",
        relatedColumn: "cycle_id",
        timestamp: { table: "cycle_records", columns: ["admitted_at_ms", "updated_at_ms"], format: "epoch_ms" },
      },
    },
    {
      table: "conversation_evidence_log",
      columns: ["row_id", "lineage_id", "version", "conversation_id", "role", "created_at_ms", "discord_message_ids_json", "reservation_id", "producing_cycle_id", "content_hash", "source_status", "secret_omitted", "delivered"],
      timestamp: { table: "conversation_evidence_log", columns: ["created_at_ms"], format: "epoch_ms" },
    },
    {
      table: "periodic_cognition_schedule",
      columns: ["id", "authority_epoch", "next_eligible_at_ms", "updated_at_ms"],
      timestamp: { table: "periodic_cognition_schedule", columns: ["updated_at_ms"], format: "epoch_ms" },
    },
    {
      table: "periodic_cognition_occurrence_receipts",
      columns: ["schedule_occurrence_id", "disposition", "wake_id", "authority_epoch", "eligible_at_ms", "closed_at_ms"],
      timestamp: { table: "periodic_cognition_occurrence_receipts", columns: ["eligible_at_ms", "closed_at_ms"], format: "epoch_ms" },
    },
    {
      table: "causal_ledger",
      columns: ["id", "cycle_id", "generation", "thought_unavailable"],
      relation: {
        localColumn: "cycle_id",
        relatedTable: "cycle_records",
        relatedColumn: "cycle_id",
        timestamp: { table: "cycle_records", columns: ["admitted_at_ms", "updated_at_ms"], format: "epoch_ms" },
      },
    },
  ],
  cognitive_observability: [
    {
      table: "allocation_receipts",
      columns: ["request_id", "cycle_id", "generation", "created_at_ms"],
      timestamp: { table: "allocation_receipts", columns: ["created_at_ms"], format: "epoch_ms" },
    },
    {
      table: "thought_dispatch_diagnostics",
      columns: ["id", "cycle_id", "generation", "request_id", "pass", "code", "stage", "dispatch_truth", "created_at_ms"],
      timestamp: { table: "thought_dispatch_diagnostics", columns: ["created_at_ms"], format: "epoch_ms" },
    },
  ],
  continuity: [
    {
      table: "lineage_state",
      columns: ["lineage_id", "updated_at"],
      timestamp: { table: "lineage_state", columns: ["updated_at"], format: "iso" },
    },
    {
      table: "continuity_events",
      columns: ["occurred_at"],
      timestamp: { table: "continuity_events", columns: ["occurred_at"], format: "iso" },
    },
    {
      table: "runtime_sessions",
      columns: ["session_id", "started_at"],
      timestamp: { table: "runtime_sessions", columns: ["started_at"], format: "iso" },
    },
  ],
};

type ObservedTimestamp = {
  milliseconds: number;
  iso: string;
};

function requestedInterval(window: FieldDayWindow): { start: string; end: string } {
  return {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
  };
}

function baseCoverage(source: CoverageSource, window: FieldDayWindow): Pick<SourceCoverage, "source_identity" | "requested_interval"> {
  return {
    source_identity: SOURCE_IDENTITIES[source],
    requested_interval: requestedInterval(window),
  };
}

function unknownCoverage(
  source: CoverageSource,
  window: FieldDayWindow,
  disposition: "unavailable_or_unchecked" | "completeness_unknown",
  failure: string,
  recordCount: number | "UNKNOWN" = "UNKNOWN",
  observedInterval: SourceCoverage["observed_interval"] = "UNKNOWN",
): SourceCoverage {
  return {
    ...baseCoverage(source, window),
    observed_interval: observedInterval,
    disposition,
    record_count: recordCount,
    failure_omission_state: failure,
  };
}

function parseTimestamp(value: unknown, format: TimestampFormat): ObservedTimestamp | null {
  let milliseconds: number;
  if (format === "epoch_ms") {
    if (typeof value === "bigint") milliseconds = Number(value);
    else if (typeof value === "number") milliseconds = value;
    else return null;
    if (!Number.isSafeInteger(milliseconds)) return null;
  } else {
    if (typeof value !== "string" || value.trim() === "") return null;
    milliseconds = Date.parse(value);
    if (Number.isNaN(milliseconds)) return null;
  }
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return { milliseconds, iso: date.toISOString() };
}

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function reference(alias: string | null, column: string): string {
  return alias == null ? quoted(column) : `${quoted(alias)}.${quoted(column)}`;
}

function windowBounds(format: TimestampFormat, window: FieldDayWindow): [string | number, string | number] {
  return format === "epoch_ms"
    ? [window.start.getTime(), window.end.getTime()]
    : [window.start.toISOString(), window.end.toISOString()];
}

function timestampPredicate(
  surface: CoverageSurface,
  alias: string | null,
  window: FieldDayWindow,
): FieldDayWhere {
  const clauses = surface.columns.map((column) => {
    const value = reference(alias, column);
    return `(${value} >= ? AND ${value} < ?)`;
  });
  const [start, end] = windowBounds(surface.format, window);
  return {
    sql: clauses.join(" OR "),
    args: surface.columns.flatMap(() => [start, end]),
  };
}

function timestampExpression(
  surface: CoverageSurface,
  alias: string | null,
  window: FieldDayWindow,
): FieldDayWhere {
  const [start, end] = windowBounds(surface.format, window);
  return {
    sql: `CASE ${surface.columns.map((column) => {
      const value = reference(alias, column);
      return `WHEN (${value} >= ? AND ${value} < ?) THEN ${value}`;
    }).join(" ")} END`,
    args: surface.columns.flatMap(() => [start, end]),
  };
}

function relationPredicate(
  relation: CoverageRelation,
  alias: string | null,
  window: FieldDayWindow,
): FieldDayWhere {
  const relatedWindow = timestampPredicate(relation.timestamp, "related", window);
  return {
    sql: `EXISTS (
      SELECT 1 FROM ${quoted(relation.relatedTable)} AS ${quoted("related")}
       WHERE ${reference("related", relation.relatedColumn)} = ${reference(alias, relation.localColumn)}
         AND (${relatedWindow.sql})
    )`,
    args: relatedWindow.args,
  };
}

function relationExpression(
  relation: CoverageRelation,
  alias: string | null,
  window: FieldDayWindow,
): FieldDayWhere {
  const relatedExpression = timestampExpression(relation.timestamp, "related", window);
  const relatedWindow = timestampPredicate(relation.timestamp, "related", window);
  return {
    sql: `(SELECT ${relatedExpression.sql}
             FROM ${quoted(relation.relatedTable)} AS ${quoted("related")}
            WHERE ${reference("related", relation.relatedColumn)} = ${reference(alias, relation.localColumn)}
              AND (${relatedWindow.sql})
            LIMIT 1)`,
    args: [...relatedExpression.args, ...relatedWindow.args],
  };
}

function surfaceWhere(
  surface: RequiredCoverageSurface,
  window: FieldDayWindow,
  alias: string | null,
): FieldDayWhere {
  const clauses: string[] = [];
  const args: Array<string | number> = [];
  if (surface.timestamp) {
    const ownWindow = timestampPredicate(surface.timestamp, alias, window);
    clauses.push(`(${ownWindow.sql})`);
    args.push(...ownWindow.args);
  }
  if (surface.relation) {
    const relatedWindow = relationPredicate(surface.relation, alias, window);
    clauses.push(`(${relatedWindow.sql})`);
    args.push(...relatedWindow.args);
  }
  return {
    sql: clauses.length === 0 ? "1 = 1" : clauses.join(" OR "),
    args,
  };
}

function surfaceExpression(
  surface: RequiredCoverageSurface,
  window: FieldDayWindow,
  alias: string | null,
): { sql: string; args: readonly (string | number)[]; format: TimestampFormat } {
  if (surface.timestamp && surface.relation) {
    const ownWindow = timestampPredicate(surface.timestamp, alias, window);
    const ownExpression = timestampExpression(surface.timestamp, alias, window);
    const relatedExpression = relationExpression(surface.relation, alias, window);
    return {
      sql: `CASE WHEN (${ownWindow.sql}) THEN ${ownExpression.sql} ELSE ${relatedExpression.sql} END`,
      args: [...ownWindow.args, ...ownExpression.args, ...relatedExpression.args],
      format: surface.timestamp.format,
    };
  }
  if (surface.timestamp) {
    const expression = timestampExpression(surface.timestamp, alias, window);
    return { ...expression, format: surface.timestamp.format };
  }
  if (surface.relation) {
    const expression = relationExpression(surface.relation, alias, window);
    return { ...expression, format: surface.relation.timestamp.format };
  }
  return { sql: "NULL", args: [], format: "epoch_ms" };
}

function readSurfaceTimestamps(
  db: DatabaseSync,
  surface: RequiredCoverageSurface,
  window: FieldDayWindow,
): { observed: ObservedTimestamp[]; overflow: boolean } {
  const expression = surfaceExpression(surface, window, "source");
  const where = surfaceWhere(surface, window, "source");
  const rows = db.prepare(
    `SELECT ${expression.sql} AS observed_time
       FROM ${quoted(surface.table)} AS ${quoted("source")}
      WHERE ${where.sql}
      ORDER BY observed_time ASC
      LIMIT ${BOUNDED_ENUMERATION_LIMIT}`,
  ).all(...expression.args, ...where.args) as Array<{ observed_time?: unknown }>;
  const timestampFormat = surface.timestamp?.format ?? surface.relation?.timestamp.format ?? "epoch_ms";
  const observed: ObservedTimestamp[] = [];
  for (const row of rows) {
    const timestamp = parseTimestamp(row.observed_time, timestampFormat);
    if (!timestamp || timestamp.milliseconds < window.start.getTime() || timestamp.milliseconds >= window.end.getTime()) {
      throw new Error(`invalid_timestamp:${surface.table}`);
    }
    observed.push(timestamp);
  }
  return {
    observed: observed.slice(0, MAX_ENUMERATED_RECORDS),
    overflow: rows.length > MAX_ENUMERATED_RECORDS,
  };
}

function readRelatedTimestamps(
  db: DatabaseSync,
  surface: RequiredCoverageSurface,
  relation: CoverageRelation,
  window: FieldDayWindow,
): { observed: ObservedTimestamp[]; overflow: boolean; uncertainty?: string } {
  const source = quoted(surface.table);
  const related = quoted(relation.relatedTable);
  const localColumn = quoted(relation.localColumn);
  const relatedColumn = quoted(relation.relatedColumn);
  const unmatched = db.prepare(
    `SELECT 1 AS present
       FROM ${source} AS source
       LEFT JOIN ${related} AS related ON related.${relatedColumn} = source.${localColumn}
      WHERE related.${relatedColumn} IS NULL
      LIMIT 1`,
  ).get() as { present?: unknown } | undefined;
  const enumeration = readSurfaceTimestamps(db, surface, window);
  return {
    ...enumeration,
    ...(unmatched ? { uncertainty: `field_day_relation_unknown:${surface.table}` } : {}),
  };
}

function enumerateRequiredSurface(
  db: DatabaseSync,
  surface: RequiredCoverageSurface,
  window: FieldDayWindow,
): { matchingCount: number; observed: ObservedTimestamp[]; overflow: boolean; uncertainty?: string } {
  if (!tableExists(db, surface.table)) {
    throw new Error(`schema_surface_absent:${surface.table}`);
  }
  const available = tableColumns(db, surface.table);
  const missing = surface.columns.filter((column) => !available.has(column));
  if (missing.length > 0) {
    throw new Error(`column_absent:${surface.table}.${missing[0]}`);
  }
  if (surface.relation) {
    if (!tableExists(db, surface.relation.relatedTable)) {
      throw new Error(`schema_relation_absent:${surface.table}.${surface.relation.relatedTable}`);
    }
    const relatedColumns = tableColumns(db, surface.relation.relatedTable);
    if (!relatedColumns.has(surface.relation.relatedColumn)) {
      throw new Error(`column_absent:${surface.relation.relatedTable}.${surface.relation.relatedColumn}`);
    }
    const missingRelatedTimestamp = surface.relation.timestamp.columns.find(
      (column) => !relatedColumns.has(column),
    );
    if (missingRelatedTimestamp) {
      throw new Error(`column_absent:${surface.relation.relatedTable}.${missingRelatedTimestamp}`);
    }
    const enumeration = readRelatedTimestamps(db, surface, surface.relation, window);
    return { matchingCount: enumeration.observed.length, ...enumeration };
  }
  if (surface.timestamp) {
    const missingTimestamp = surface.timestamp.columns.find((column) => !available.has(column));
    if (missingTimestamp) throw new Error(`column_absent:${surface.table}.${missingTimestamp}`);
    const enumeration = readSurfaceTimestamps(db, surface, window);
    return { matchingCount: enumeration.observed.length, ...enumeration };
  }
  const table = quoted(surface.table);
  const row = db.prepare(`SELECT 1 AS present FROM ${table} LIMIT 1`).get() as { present?: unknown } | undefined;
  return {
    matchingCount: row == null ? 0 : 1,
    observed: [],
    overflow: false,
    ...(row == null ? {} : { uncertainty: `field_day_relation_unknown:${surface.table}` }),
  };
}

function requiredSurfaceForTable(table: string): RequiredCoverageSurface | undefined {
  for (const surfaces of Object.values(REQUIRED_DATABASE_SURFACES)) {
    const surface = surfaces.find((candidate) => candidate.table === table);
    if (surface) return surface;
  }
  return undefined;
}

export function fieldDayWhere(table: string, window: FieldDayWindow): FieldDayWhere {
  const surface = requiredSurfaceForTable(table);
  if (!surface) throw new Error(`coverage_surface_unknown:${table}`);
  return surfaceWhere(surface, window, surface.table);
}

function observedInterval(values: readonly ObservedTimestamp[]): SourceCoverage["observed_interval"] {
  if (values.length === 0) return null;
  let first = values[0];
  let last = values[0];
  for (const value of values.slice(1)) {
    if (value.milliseconds < first.milliseconds) first = value;
    if (value.milliseconds > last.milliseconds) last = value;
  }
  return { start: first.iso, end: last.iso };
}

function failureState(failures: readonly string[]): string {
  return failures.length === 0 ? "UNKNOWN" : failures.join(";");
}

export function sourceCoverageForDatabase(input: {
  db: DatabaseSync | null;
  source: DatabaseCoverageSource;
  window: FieldDayWindow;
  failure?: string;
}): SourceCoverage {
  if (!input.db) {
    return unknownCoverage(
      input.source,
      input.window,
      "unavailable_or_unchecked",
      input.failure ?? "UNKNOWN",
    );
  }

  const observed: ObservedTimestamp[] = [];
  const failures: string[] = [];
  let recordCount = 0;
  for (const surface of REQUIRED_DATABASE_SURFACES[input.source]) {
    try {
      const enumeration = enumerateRequiredSurface(input.db, surface, input.window);
      recordCount += enumeration.matchingCount;
      observed.push(...enumeration.observed);
      if (enumeration.overflow) failures.push(`enumeration_overflow:${surface.table}`);
      if (enumeration.uncertainty) failures.push(enumeration.uncertainty);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "query_failed";
      failures.push(detail.startsWith("schema_surface_absent:") || detail.startsWith("column_absent:")
        || detail.startsWith("field_day_relation_unknown:")
          ? detail
          : `query_failed:${surface.table}`);
    }
  }

  const interval = observedInterval(observed);
  if (failures.length === 0) {
    return {
      ...baseCoverage(input.source, input.window),
      observed_interval: interval,
      disposition: recordCount === 0 ? "complete_empty" : "complete_nonempty",
      record_count: recordCount,
      failure_omission_state: null,
    };
  }

  if (recordCount > 0) {
    return {
      ...baseCoverage(input.source, input.window),
      observed_interval: interval,
      disposition: "partial",
      record_count: recordCount,
      failure_omission_state: failureState(failures),
    };
  }

  return unknownCoverage(
    input.source,
    input.window,
    "completeness_unknown",
    failureState(failures),
  );
}

function directoryExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function sourceCoverageForTranscript(input: {
  sessionsRoot: string;
  window: FieldDayWindow;
  transcript: TranscriptAssembly;
}): SourceCoverage {
  if (!directoryExists(input.sessionsRoot)) {
    return unknownCoverage(
      "transcript_session",
      input.window,
      "unavailable_or_unchecked",
      "source_missing_or_unreadable",
    );
  }
  try {
    readdirSync(input.sessionsRoot);
  } catch {
    return unknownCoverage(
      "transcript_session",
      input.window,
      "unavailable_or_unchecked",
      "source_unreadable",
    );
  }

  const timestamps: ObservedTimestamp[] = [];
  let invalidTimestamp = false;
  const legacySessions = input.transcript.transcript.sessions.filter((session) => session.source !== "cognitive_v021");
  for (const session of legacySessions) {
    for (const message of session.messages) {
      const timestamp = parseTimestamp(message.ts, "iso");
      if (!timestamp || timestamp.milliseconds < input.window.start.getTime() || timestamp.milliseconds >= input.window.end.getTime()) {
        invalidTimestamp = true;
        continue;
      }
      timestamps.push(timestamp);
    }
  }
  const failures = (input.transcript.legacy_gaps ?? input.transcript.gaps)
    .map((gap) => `transcript_gap:${gap.class}`);
  if (invalidTimestamp) failures.push("invalid_timestamp");
  const uniqueFailures = [...new Set(failures)];
  const recordCount = timestamps.length;
  const interval = observedInterval(timestamps);
  if (uniqueFailures.length === 0) {
    return {
      ...baseCoverage("transcript_session", input.window),
      observed_interval: interval,
      disposition: recordCount === 0 ? "complete_empty" : "complete_nonempty",
      record_count: recordCount,
      failure_omission_state: null,
    };
  }
  if (recordCount > 0) {
    return {
      ...baseCoverage("transcript_session", input.window),
      observed_interval: interval,
      disposition: "partial",
      record_count: recordCount,
      failure_omission_state: failureState(uniqueFailures),
    };
  }
  return unknownCoverage(
    "transcript_session",
    input.window,
    "completeness_unknown",
    failureState(uniqueFailures),
  );
}

export function sourceCoverageForModernTranscript(input: {
  window: FieldDayWindow;
  transcript: TranscriptAssembly;
}): SourceCoverage {
  if (!input.transcript.modern_source_attempted) {
    return {
      source_identity: MODERN_TRANSCRIPT_IDENTITY,
      requested_interval: requestedInterval(input.window),
      observed_interval: null,
      disposition: "complete_empty",
      record_count: 0,
      failure_omission_state: null,
    };
  }
  if (!input.transcript.modern_source_available) {
    return {
      source_identity: MODERN_TRANSCRIPT_IDENTITY,
      requested_interval: requestedInterval(input.window),
      observed_interval: "UNKNOWN",
      disposition: "unavailable_or_unchecked",
      record_count: "UNKNOWN",
      failure_omission_state: "source_missing_or_unreadable",
    };
  }
  const timestamps: ObservedTimestamp[] = [];
  for (const session of input.transcript.transcript.sessions) {
    if (session.source !== "cognitive_v021") continue;
    for (const message of session.messages) {
      const timestamp = parseTimestamp(message.ts, "iso");
      if (timestamp) timestamps.push(timestamp);
    }
  }
  const activityCount = input.transcript.modern_activity_count ?? 0;
  const recordCount = input.transcript.modern_message_count ?? timestamps.length;
  const gaps = input.transcript.modern_gaps ?? [];
  if (gaps.length === 0 && activityCount === 0) {
    return {
      source_identity: MODERN_TRANSCRIPT_IDENTITY,
      requested_interval: requestedInterval(input.window),
      observed_interval: observedInterval(timestamps),
      disposition: "complete_empty",
      record_count: recordCount,
      failure_omission_state: null,
    };
  }
  if (gaps.length === 0 && activityCount > 0 && recordCount > 0) {
    return {
      source_identity: MODERN_TRANSCRIPT_IDENTITY,
      requested_interval: requestedInterval(input.window),
      observed_interval: observedInterval(timestamps),
      disposition: "complete_nonempty",
      record_count: recordCount,
      failure_omission_state: null,
    };
  }
  return {
    source_identity: MODERN_TRANSCRIPT_IDENTITY,
    requested_interval: requestedInterval(input.window),
    observed_interval: observedInterval(timestamps),
    disposition: "partial",
    record_count: recordCount,
    failure_omission_state: failureState(gaps.map((gap) => `transcript_gap:${gap.class}:${gap.detail}`)),
  };
}

export function buildSourceCoverage(input: {
  sessionsRoot: string;
  window: FieldDayWindow;
  transcript: TranscriptAssembly;
  databases: {
    nuclear: DatabaseSync | null;
    cognitive_sidecar: DatabaseSync | null;
    cognitive_observability: DatabaseSync | null;
    continuity: DatabaseSync | null;
  };
  failures?: Partial<Record<DatabaseCoverageSource, string>>;
}): SourceCoverageMap {
  const modern = input.transcript.modern_source_attempted
    ? sourceCoverageForModernTranscript(input)
    : undefined;
  return {
    transcript_session: sourceCoverageForTranscript(input),
    nuclear: sourceCoverageForDatabase({
      db: input.databases.nuclear,
      source: "nuclear",
      window: input.window,
      failure: input.failures?.nuclear,
    }),
    cognitive_sidecar: sourceCoverageForDatabase({
      db: input.databases.cognitive_sidecar,
      source: "cognitive_sidecar",
      window: input.window,
      failure: input.failures?.cognitive_sidecar,
    }),
    cognitive_observability: sourceCoverageForDatabase({
      db: input.databases.cognitive_observability,
      source: "cognitive_observability",
      window: input.window,
      failure: input.failures?.cognitive_observability,
    }),
    continuity: sourceCoverageForDatabase({
      db: input.databases.continuity,
      source: "continuity",
      window: input.window,
      failure: input.failures?.continuity,
    }),
    ...(modern ? { modern_transcript: modern } : {}),
  };
}

function isComplete(disposition: SourceCoverage["disposition"]): boolean {
  return disposition === "complete_empty" || disposition === "complete_nonempty";
}

export function aggregateCoverage(sourceCoverage: SourceCoverageMap): "NORMAL" | "DEGRADED_PARTIAL" {
  const modern = sourceCoverage.modern_transcript;
  if (modern) {
    if (!isComplete(modern.disposition)) return "DEGRADED_PARTIAL";
    if (!COVERAGE_SOURCES.filter((source) => source !== "transcript_session").every((source) => {
      const coverage = sourceCoverage[source];
      return coverage != null && isComplete(coverage.disposition);
    })) {
      return "DEGRADED_PARTIAL";
    }
    if (modern.disposition === "complete_nonempty") return "NORMAL";
    return sourceCoverage.transcript_session.disposition === "complete_nonempty"
      ? "NORMAL"
      : "DEGRADED_PARTIAL";
  }
  if (!COVERAGE_SOURCES.every((source) => {
    const coverage = sourceCoverage[source];
    return coverage != null && isComplete(coverage.disposition);
  })) {
    return "DEGRADED_PARTIAL";
  }
  return sourceCoverage.transcript_session.disposition === "complete_nonempty"
    ? "NORMAL"
    : "DEGRADED_PARTIAL";
}
