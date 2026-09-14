import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fieldDayWindow } from "./field-day.js";
import {
  aggregateCoverage,
  sourceCoverageForDatabase,
  sourceCoverageForModernTranscript,
  sourceCoverageForTranscript,
} from "./coverage.js";
import { extractEvidence } from "./evidence.js";
import type { SourceCoverageMap, TranscriptAssembly } from "./types.js";

const window = fieldDayWindow("2026-08-26");
const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function memoryDatabase(sql: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(sql);
  return db;
}

function validSidecar(sql = ""): DatabaseSync {
  return memoryDatabase(`
    CREATE TABLE inbox_events (id TEXT, conversation_id TEXT, kind TEXT, created_at_ms INTEGER, status TEXT, state TEXT, terminal_reason TEXT, wake_id TEXT, attempt_count INTEGER, consumed_at_ms INTEGER, next_eligible_at_ms INTEGER, last_failure_class TEXT);
    CREATE TABLE cycle_records (cycle_id TEXT, conversation_id TEXT, generation INTEGER, state TEXT, admitted_at_ms INTEGER, updated_at_ms INTEGER);
    CREATE TABLE thought_steps (request_id TEXT, cycle_id TEXT, generation INTEGER, pass INTEGER, kind TEXT, payload_json TEXT, created_at_ms INTEGER);
    CREATE TABLE observations (observation_id TEXT, cycle_id TEXT, generation INTEGER, derived INTEGER, replay_safe INTEGER, modality TEXT, provenance TEXT, created_at_ms INTEGER);
    CREATE TABLE wakes (wake_id TEXT, occurrence_id TEXT, conversation_id TEXT, cycle_id TEXT, state TEXT, terminal_reason TEXT, created_at_ms INTEGER, updated_at_ms INTEGER);
    CREATE TABLE settlements (settlement_id TEXT, cycle_id TEXT, generation INTEGER, payload_json TEXT);
    CREATE TABLE speech_outbox (outbox_id INTEGER, settlement_id TEXT, projection_key TEXT, cycle_id TEXT, generation INTEGER, send_status TEXT, nuclear_reservation_id INTEGER, discord_message_ids_json TEXT);
    CREATE TABLE system_notice_outbox (notice_id INTEGER, cycle_id TEXT, conversation_id TEXT, send_status TEXT, nuclear_reservation_id INTEGER, discord_message_id TEXT);
    CREATE TABLE conversation_evidence_log (row_id TEXT, lineage_id TEXT, version INTEGER, conversation_id TEXT, role TEXT, created_at_ms INTEGER, discord_message_ids_json TEXT, reservation_id INTEGER, producing_cycle_id TEXT, content_hash TEXT, source_status TEXT, data_classification TEXT, secret_omitted INTEGER, delivered INTEGER);
    CREATE TABLE periodic_cognition_schedule (id TEXT, authority_epoch INTEGER, next_eligible_at_ms INTEGER, updated_at_ms INTEGER);
    CREATE TABLE periodic_cognition_occurrence_receipts (schedule_occurrence_id TEXT, disposition TEXT, wake_id TEXT, authority_epoch INTEGER, eligible_at_ms INTEGER, closed_at_ms INTEGER);
    CREATE TABLE causal_ledger (id INTEGER, cycle_id TEXT, generation INTEGER, thought_unavailable INTEGER);
    ${sql}
  `);
}

function validObservability(sql = ""): DatabaseSync {
  return memoryDatabase(`
    CREATE TABLE allocation_receipts (request_id TEXT, cycle_id TEXT, generation INTEGER, created_at_ms INTEGER);
    CREATE TABLE thought_dispatch_diagnostics (id INTEGER, cycle_id TEXT, generation INTEGER, request_id TEXT, pass INTEGER, code TEXT, stage TEXT, dispatch_truth TEXT, created_at_ms INTEGER);
    ${sql}
  `);
}

function validContinuity(sql = ""): DatabaseSync {
  return memoryDatabase(`
    CREATE TABLE lineage_state (lineage_id TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE continuity_events (occurred_at TEXT NOT NULL);
    CREATE TABLE runtime_sessions (session_id TEXT, started_at TEXT NOT NULL);
    ${sql}
  `);
}

function validNuclear(sql = ""): DatabaseSync {
  return memoryDatabase(`
    CREATE TABLE mem_messages (created_at TEXT NOT NULL);
    CREATE TABLE delivery_reservations (id INTEGER, owner_id TEXT, channel TEXT, thread_id TEXT, trigger TEXT, delivery_lane TEXT, state TEXT, error_category TEXT, finalization_reason TEXT, created_at TEXT, finalized_at TEXT, cognitive_v021_projection_key TEXT);
    CREATE TABLE delivery_bubbles (reservation_id INTEGER, ordinal INTEGER, discord_message_id TEXT, sent_at TEXT);
    CREATE TABLE attention_requests (id INTEGER, purpose TEXT, model_alias TEXT, provider_id TEXT, route_alias TEXT, state TEXT, outcome TEXT, created_at TEXT, dispatch_started_at TEXT, ended_at TEXT, actual_input_tokens INTEGER, actual_output_tokens INTEGER);
    ${sql}
  `);
}

function transcriptAssembly(
  messages: TranscriptAssembly["transcript"]["sessions"][number]["messages"],
  gaps: TranscriptAssembly["gaps"] = [],
): TranscriptAssembly {
  return {
    coverage: gaps.length === 0 ? "NORMAL" : "DEGRADED_PARTIAL",
    transcript: {
      field_day: window.fieldDay,
      identity: null,
      sessions: [{ session_id: "session-1", channel: "discord", messages }],
      gaps,
      source_conflicts: [],
    },
    gaps,
    source_conflicts: [],
  };
}

function completeMap(transcriptDisposition: "complete_empty" | "complete_nonempty"): SourceCoverageMap {
  const requested_interval = {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
  };
  const make = (source_identity: string, disposition: SourceCoverageMap["nuclear"]["disposition"]): SourceCoverageMap["nuclear"] => ({
    source_identity,
    requested_interval,
    observed_interval: disposition === "complete_nonempty"
      ? { start: requested_interval.start, end: requested_interval.end }
      : null,
    disposition,
    record_count: disposition === "complete_nonempty" ? 1 : 0,
    failure_omission_state: null,
  });
  return {
    transcript_session: make("conversations/sessions", transcriptDisposition),
    nuclear: make("conversations/nuclear.db", "complete_empty"),
    cognitive_sidecar: make("cognitive-v021.db", "complete_empty"),
    cognitive_observability: make("cognitive-v021-observability.db", "complete_empty"),
    continuity: make("continuity.db", "complete_empty"),
  };
}

describe("per-source observer coverage", () => {
  it("classifies complete empty and complete nonempty database sources with bounded intervals", () => {
    const empty = validNuclear();
    const emptyCoverage = sourceCoverageForDatabase({ db: empty, source: "nuclear", window });
    expect(emptyCoverage).toMatchObject({
      source_identity: "conversations/nuclear.db",
      disposition: "complete_empty",
      record_count: 0,
      observed_interval: null,
      failure_omission_state: null,
    });

    const populated = validNuclear(`
      INSERT INTO mem_messages VALUES ('2026-08-26T01:10:00.000Z');
      INSERT INTO mem_messages VALUES ('2026-08-27T01:10:00.000Z');
    `);
    const populatedCoverage = sourceCoverageForDatabase({ db: populated, source: "nuclear", window });
    expect(populatedCoverage).toMatchObject({
      disposition: "complete_nonempty",
      record_count: 1,
      observed_interval: {
        start: "2026-08-26T01:10:00.000Z",
        end: "2026-08-26T01:10:00.000Z",
      },
      failure_omission_state: null,
    });
    empty.close();
    populated.close();
  });

  it("marks a timestamp surface incomplete when the bounded enumeration overflows", () => {
    const nuclear = validNuclear();
    const insert = nuclear.prepare("INSERT INTO mem_messages (created_at) VALUES (?)");
    for (let index = 0; index < 501; index += 1) {
      insert.run(new Date(window.start.getTime() + index * 1_000).toISOString());
    }

    const coverage = sourceCoverageForDatabase({ db: nuclear, source: "nuclear", window });
    expect(coverage).toMatchObject({
      disposition: "partial",
      record_count: 500,
      observed_interval: {
        start: window.start.toISOString(),
      },
    });
    expect(coverage.failure_omission_state).toContain("enumeration_overflow:mem_messages");
    nuclear.close();
  });

  it("filters the requested timestamp window before applying the bounded limit", () => {
    const nuclear = validNuclear();
    const insert = nuclear.prepare("INSERT INTO mem_messages (created_at) VALUES (?)");
    for (let index = 0; index < 600; index += 1) {
      insert.run(new Date(window.start.getTime() - (index + 1) * 1_000).toISOString());
    }
    insert.run(new Date(window.start.getTime() + 1_000).toISOString());

    const coverage = sourceCoverageForDatabase({ db: nuclear, source: "nuclear", window });
    expect(coverage).toMatchObject({
      disposition: "complete_nonempty",
      record_count: 1,
      failure_omission_state: null,
    });
    nuclear.close();
  });

  it("uses cycle records as the field-day relation for timestamp-free sidecar surfaces", () => {
    const sidecar = validSidecar(`
      INSERT INTO cycle_records (cycle_id, conversation_id, generation, state, updated_at_ms)
        VALUES ('cycle-related', 'thread-related', 1, 'terminal', ${window.start.getTime() + 1_000});
      INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json)
        VALUES ('settlement-related', 'cycle-related', 1, '{}');
      INSERT INTO speech_outbox (outbox_id, settlement_id, cycle_id, generation, send_status, nuclear_reservation_id, discord_message_ids_json)
        VALUES (1, 'settlement-related', 'cycle-related', 1, 'pending', NULL, '[]');
      INSERT INTO system_notice_outbox (notice_id, cycle_id, conversation_id, send_status, nuclear_reservation_id, discord_message_id)
        VALUES (1, 'cycle-related', 'thread-related', 'pending', NULL, NULL);
      INSERT INTO causal_ledger (id, cycle_id, generation, thought_unavailable)
        VALUES (1, 'cycle-related', 1, 0);
    `);

    const coverage = sourceCoverageForDatabase({ db: sidecar, source: "cognitive_sidecar", window });
    expect(coverage).toMatchObject({
      disposition: "complete_nonempty",
      record_count: 5,
      failure_omission_state: null,
    });
    sidecar.close();
  });

  it("reports honest uncertainty for a timestamp-free row without its owner relation", () => {
    const sidecar = validSidecar(`
      INSERT INTO system_notice_outbox (notice_id, cycle_id, conversation_id, send_status, nuclear_reservation_id, discord_message_id)
        VALUES (1, NULL, 'thread-unbound', 'pending', NULL, NULL);
    `);

    const coverage = sourceCoverageForDatabase({ db: sidecar, source: "cognitive_sidecar", window });
    expect(coverage).toMatchObject({
      disposition: "completeness_unknown",
      record_count: "UNKNOWN",
    });
    expect(coverage.failure_omission_state).toContain("field_day_relation_unknown:system_notice_outbox");
    sidecar.close();
  });

  it("correlates lifecycle cycle relations to the outer settlement row", () => {
    const sidecar = validSidecar(`
      INSERT INTO cycle_records (cycle_id, conversation_id, generation, state, admitted_at_ms, updated_at_ms)
        VALUES ('cycle-old', 'thread-old', 1, 'terminal', ${window.start.getTime() - 2_000}, ${window.start.getTime() - 1_000});
      INSERT INTO cycle_records (cycle_id, conversation_id, generation, state, admitted_at_ms, updated_at_ms)
        VALUES ('cycle-current', 'thread-current', 1, 'terminal', ${window.start.getTime() + 1_000}, ${window.start.getTime() + 2_000});
      INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json)
        VALUES ('settlement-old', 'cycle-old', 1, '{}');
      INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json)
        VALUES ('settlement-current', 'cycle-current', 1, '{}');
    `);

    const result = extractEvidence({
      nuclear: null,
      continuity: null,
      cognitiveSidecar: sidecar,
      cognitiveObservability: null,
      window,
    });
    const lifecycle = result.evidence.cognitive_lifecycle as Record<string, unknown>;
    expect(lifecycle.source_capture).toMatchObject({ cognitive_sidecar: "complete" });
    expect((lifecycle.publications as Array<Record<string, unknown>>).map((row) => row.settlement_id))
      .toEqual(["settlement-current"]);
    sidecar.close();
  });

  it("excludes unrelated historical cycle relations before the lifecycle bound", () => {
    const sidecar = validSidecar();
    const cycleInsert = sidecar.prepare(
      "INSERT INTO cycle_records (cycle_id, conversation_id, generation, state, admitted_at_ms, updated_at_ms) VALUES (?, ?, 1, 'terminal', ?, ?)",
    );
    const settlementInsert = sidecar.prepare(
      "INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, 1, '{}')",
    );
    for (let index = 0; index < 501; index += 1) {
      const cycleId = `cycle-old-${index}`;
      cycleInsert.run(
        cycleId,
        `thread-old-${index}`,
        window.start.getTime() - 2_000,
        window.start.getTime() - 1_000,
      );
      settlementInsert.run(`settlement-old-${index}`, cycleId);
    }
    cycleInsert.run(
      "cycle-current",
      "thread-current",
      window.start.getTime() + 1_000,
      window.start.getTime() + 2_000,
    );
    settlementInsert.run("settlement-current", "cycle-current");

    const result = extractEvidence({
      nuclear: null,
      continuity: null,
      cognitiveSidecar: sidecar,
      cognitiveObservability: null,
      window,
    });
    const lifecycle = result.evidence.cognitive_lifecycle as Record<string, unknown>;
    expect(lifecycle.source_capture).toMatchObject({ cognitive_sidecar: "complete" });
    expect((lifecycle.publications as Array<Record<string, unknown>>).map((row) => row.settlement_id))
      .toEqual(["settlement-current"]);
    sidecar.close();
  });

  it("does not mark cognitive-sidecar coverage complete when speech projection_key is missing", () => {
    const sidecar = validSidecar();
    sidecar.exec("DROP TABLE speech_outbox");
    sidecar.exec(`
      CREATE TABLE speech_outbox (
        outbox_id INTEGER,
        settlement_id TEXT,
        cycle_id TEXT,
        generation INTEGER,
        send_status TEXT,
        nuclear_reservation_id INTEGER,
        discord_message_ids_json TEXT
      )
    `);

    const coverage = sourceCoverageForDatabase({ db: sidecar, source: "cognitive_sidecar", window });
    expect(["complete_empty", "complete_nonempty"]).not.toContain(coverage.disposition);
    const result = extractEvidence({
      nuclear: null,
      continuity: null,
      cognitiveSidecar: sidecar,
      cognitiveObservability: null,
      window,
    });
    const lifecycle = result.evidence.cognitive_lifecycle as Record<string, unknown>;
    expect(lifecycle.source_capture).toMatchObject({ cognitive_sidecar: "partial" });
    sidecar.close();
  });

  it("includes a reservation finalized inside the field day when it was created before it", () => {
    const nuclear = validNuclear(`
      INSERT INTO delivery_reservations (id, state, created_at, finalized_at)
        VALUES (1, 'committed', '2026-08-25T12:00:00.000Z', '2026-08-26T01:10:00.000Z');
    `);

    const coverage = sourceCoverageForDatabase({ db: nuclear, source: "nuclear", window });
    expect(coverage).toMatchObject({
      disposition: "complete_nonempty",
      record_count: 1,
      failure_omission_state: null,
    });
    nuclear.close();
  });

  it("includes an unsent bubble attached to a reservation relevant to the field day", () => {
    const nuclear = validNuclear(`
      INSERT INTO delivery_reservations (id, state, created_at, finalized_at)
        VALUES (1, 'reserved', '2026-08-26T01:10:00.000Z', NULL);
      INSERT INTO delivery_bubbles (reservation_id, ordinal, discord_message_id, sent_at)
        VALUES (1, 0, NULL, NULL);
    `);

    const coverage = sourceCoverageForDatabase({ db: nuclear, source: "nuclear", window });
    expect(coverage).toMatchObject({
      disposition: "complete_nonempty",
      record_count: 2,
      failure_omission_state: null,
    });
    nuclear.close();
  });

  it("includes a wake updated inside the field day when it was created before it", () => {
    const sidecar = validSidecar(`
      INSERT INTO wakes (wake_id, occurrence_id, conversation_id, cycle_id, state, terminal_reason, created_at_ms, updated_at_ms)
        VALUES ('wake-updated', 'occ-updated', 'thread-updated', 'cycle-updated', 'terminal', 'completed', ${window.start.getTime() - 1}, ${window.start.getTime() + 1_000});
    `);

    const coverage = sourceCoverageForDatabase({ db: sidecar, source: "cognitive_sidecar", window });
    expect(coverage).toMatchObject({
      disposition: "complete_nonempty",
      record_count: 1,
      failure_omission_state: null,
    });
    sidecar.close();
  });

  it("keeps a cycle-admitted settlement in coverage after the cycle update leaves the field day", () => {
    const sidecar = validSidecar(`
      INSERT INTO cycle_records (cycle_id, conversation_id, generation, state, admitted_at_ms, updated_at_ms)
        VALUES ('cycle-admitted', 'thread-admitted', 1, 'terminal', ${window.start.getTime() + 1_000}, ${window.end.getTime() + 1_000});
      INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json)
        VALUES ('settlement-admitted', 'cycle-admitted', 1, '{}');
    `);

    const coverage = sourceCoverageForDatabase({ db: sidecar, source: "cognitive_sidecar", window });
    expect(coverage).toMatchObject({
      disposition: "complete_nonempty",
      record_count: 2,
      failure_omission_state: null,
    });
    sidecar.close();
  });

  it("includes an open periodic occurrence whose eligibility is inside the field day", () => {
    const sidecar = validSidecar(`
      INSERT INTO periodic_cognition_occurrence_receipts
        (schedule_occurrence_id, disposition, wake_id, authority_epoch, eligible_at_ms, closed_at_ms)
        VALUES ('occ-open', 'pending', NULL, 1, ${window.start.getTime() + 1_000}, NULL);
    `);

    const coverage = sourceCoverageForDatabase({ db: sidecar, source: "cognitive_sidecar", window });
    expect(coverage).toMatchObject({
      disposition: "complete_nonempty",
      record_count: 1,
      failure_omission_state: null,
    });
    sidecar.close();
  });

  it("degrades aggregate coverage when lifecycle enumeration is partial", () => {
    const nuclear = validNuclear();
    const insert = nuclear.prepare(
      "INSERT INTO delivery_reservations (id, state, created_at, finalized_at) VALUES (?, 'committed', ?, ?)",
    );
    for (let index = 0; index < 501; index += 1) {
      insert.run(
        index + 1,
        "2026-08-25T12:00:00.000Z",
        new Date(window.start.getTime() + index * 1_000).toISOString(),
      );
    }

    const lifecycleResult = extractEvidence({
      nuclear,
      continuity: null,
      cognitiveSidecar: null,
      cognitiveObservability: null,
      window,
    });
    const lifecycle = lifecycleResult.evidence.cognitive_lifecycle as Record<string, unknown>;
    expect(lifecycle.source_capture).toMatchObject({ nuclear: "partial" });

    const sourceCoverage = sourceCoverageForDatabase({ db: nuclear, source: "nuclear", window });
    expect(sourceCoverage.disposition).toBe("partial");
    const aggregateInputs = completeMap("complete_nonempty");
    aggregateInputs.nuclear = sourceCoverage;
    expect(aggregateCoverage(aggregateInputs)).toBe("DEGRADED_PARTIAL");
    nuclear.close();
  });

  it("distinguishes partial, unavailable, and completeness-unknown database truth", () => {
    const partial = validSidecar(`
      INSERT INTO inbox_events (id, conversation_id, kind, created_at_ms, status, wake_id)
        VALUES ('event-1', 'thread-1', 'owner_message', ${window.start.getTime() + 1000}, 'pending', 'wake-1');
    `);
    partial.exec("DROP TABLE wakes");
    const partialCoverage = sourceCoverageForDatabase({ db: partial, source: "cognitive_sidecar", window });
    expect(partialCoverage.disposition).toBe("partial");
    expect(partialCoverage.record_count).toBe(1);
    expect(partialCoverage.failure_omission_state).toContain("schema_surface_absent:wakes");

    const unavailable = sourceCoverageForDatabase({ db: null, source: "continuity", window, failure: "source_missing" });
    expect(unavailable).toMatchObject({
      disposition: "unavailable_or_unchecked",
      record_count: "UNKNOWN",
      observed_interval: "UNKNOWN",
      failure_omission_state: "source_missing",
    });

    const unknown = memoryDatabase("CREATE TABLE continuity_events (occurred_at TEXT NOT NULL);");
    const unknownCoverage = sourceCoverageForDatabase({ db: unknown, source: "continuity", window });
    expect(unknownCoverage).toMatchObject({
      disposition: "completeness_unknown",
      record_count: "UNKNOWN",
      observed_interval: "UNKNOWN",
    });
    expect(unknownCoverage.failure_omission_state).toContain("schema_surface_absent:lineage_state");
    partial.close();
    unknown.close();
  });

  it("requires every bounded speech and settlement surface before sidecar completeness", () => {
    const sidecar = validSidecar();
    sidecar.exec("DROP TABLE speech_outbox");
    const coverage = sourceCoverageForDatabase({ db: sidecar, source: "cognitive_sidecar", window });
    expect(coverage.disposition).toBe("completeness_unknown");
    expect(coverage.failure_omission_state).toContain("schema_surface_absent:speech_outbox");
    sidecar.close();
  });

  it("does not call modern activity normal when extraction yields no transcript rows", () => {
    const assembly = transcriptAssembly([]);
    assembly.modern_source_attempted = true;
    assembly.modern_source_available = true;
    assembly.modern_activity_count = 1;
    assembly.modern_message_count = 0;
    assembly.modern_gaps = [{ class: "MISSING_MODERN", detail: "owner_cycle_relation_missing" }];

    const coverage = completeMap("complete_empty");
    coverage.modern_transcript = sourceCoverageForModernTranscript({ window, transcript: assembly });

    expect(coverage.modern_transcript).toMatchObject({
      disposition: "partial",
      record_count: 0,
    });
    expect(aggregateCoverage(coverage)).toBe("DEGRADED_PARTIAL");
  });

  it("requires delivery receipt surfaces before nuclear completeness", () => {
    const nuclear = validNuclear();
    nuclear.exec("DROP TABLE delivery_bubbles");
    const coverage = sourceCoverageForDatabase({ db: nuclear, source: "nuclear", window });
    expect(coverage.disposition).toBe("completeness_unknown");
    expect(coverage.failure_omission_state).toContain("schema_surface_absent:delivery_bubbles");
    nuclear.close();
  });

  it("classifies transcript/session records without treating an empty session as normal", () => {
    const root = mkdtempSync(join(tmpdir(), "observer-coverage-"));
    temporaryPaths.push(root);
    mkdirSync(join(root, "session-1"));
    const emptyCoverage = sourceCoverageForTranscript({
      sessionsRoot: root,
      window,
      transcript: transcriptAssembly([]),
    });
    expect(emptyCoverage.disposition).toBe("complete_empty");
    expect(emptyCoverage.record_count).toBe(0);

    const populated = transcriptAssembly([{
      ts: "2026-08-26T02:00:00.000Z",
      role: "user",
      text_redacted: "hello",
      source: "discord",
      run_id: null,
      decision_id: null,
      episode_id: null,
      provenance: "live",
      nuclear_message_id: 1,
      join_method: "stable_identifier",
      join_confidence: "high",
    }]);
    const populatedCoverage = sourceCoverageForTranscript({ sessionsRoot: root, window, transcript: populated });
    expect(populatedCoverage.disposition).toBe("complete_nonempty");
    expect(populatedCoverage.record_count).toBe(1);

    const partial = sourceCoverageForTranscript({
      sessionsRoot: root,
      window,
      transcript: transcriptAssembly(populated.transcript.sessions[0].messages, [
        { class: "UNKNOWN", detail: "messages_jsonl_invalid:session-1:2" },
      ]),
    });
    expect(partial.disposition).toBe("partial");
    expect(partial.record_count).toBe(1);
  });

  it("requires complete truth from every source and a nonempty transcript for NORMAL", () => {
    expect(aggregateCoverage(completeMap("complete_empty"))).toBe("DEGRADED_PARTIAL");
    expect(aggregateCoverage(completeMap("complete_nonempty"))).toBe("NORMAL");
    const unavailable = completeMap("complete_nonempty");
    unavailable.cognitive_observability.disposition = "unavailable_or_unchecked";
    expect(aggregateCoverage(unavailable)).toBe("DEGRADED_PARTIAL");
  });

  it("serializes only source coverage metadata", () => {
    const dbs = [
      validSidecar(),
      validObservability(),
      validContinuity(),
    ];
    const serialized = JSON.stringify({
      nuclear: sourceCoverageForDatabase({ db: validNuclear(), source: "nuclear", window }),
      cognitive_sidecar: sourceCoverageForDatabase({ db: dbs[0], source: "cognitive_sidecar", window }),
      cognitive_observability: sourceCoverageForDatabase({ db: dbs[1], source: "cognitive_observability", window }),
      continuity: sourceCoverageForDatabase({ db: dbs[2], source: "continuity", window }),
    });
    expect(serialized).not.toMatch(/payload_json|prompt|reasoning/iu);
    for (const db of dbs) db.close();
  });
});
