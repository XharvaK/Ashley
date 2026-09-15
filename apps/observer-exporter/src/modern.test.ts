import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { extractEvidence } from "./evidence.js";
import { fieldDayWindow } from "./field-day.js";
import { captureModernConversation } from "./modern.js";
import { assembleTranscript } from "./transcript.js";
import {
  createNuclearFixture,
  removeTemp,
  tempDir,
} from "../../../test/observer-support.js";

const window = fieldDayWindow("2026-09-14");
const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) removeTemp(path);
});

function inside(turn: number, offset = 0): number {
  return window.start.getTime() + turn * 60_000 + offset;
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function sidecar(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cycle_records (
      cycle_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      state TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      admitted_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE thought_steps (
      request_id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      pass INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE settlements (
      settlement_id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE speech_outbox (
      outbox_id INTEGER PRIMARY KEY,
      settlement_id TEXT NOT NULL,
      projection_key TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      conversation_id TEXT NOT NULL,
      licensed_text TEXT NOT NULL,
      send_status TEXT NOT NULL,
      nuclear_reservation_id INTEGER,
      discord_message_ids_json TEXT NOT NULL,
      suppressed INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL,
      nuclear_finalization_reason TEXT
    );
    CREATE TABLE conversation_evidence_log (
      row_id TEXT PRIMARY KEY,
      lineage_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT,
      created_at_ms INTEGER NOT NULL,
      discord_message_ids_json TEXT NOT NULL,
      reservation_id INTEGER,
      producing_cycle_id TEXT,
      content_hash TEXT NOT NULL,
      source_status TEXT NOT NULL,
      data_classification TEXT NOT NULL,
      secret_omitted INTEGER NOT NULL DEFAULT 0,
      delivered INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function addExternalCompatibilitySchema(db: DatabaseSync): void {
  db.exec(`
    ALTER TABLE conversation_evidence_log ADD COLUMN speaker_principal_id TEXT;
    ALTER TABLE conversation_evidence_log ADD COLUMN speaker_kind TEXT;
    ALTER TABLE conversation_evidence_log ADD COLUMN location_json TEXT;
    ALTER TABLE conversation_evidence_log ADD COLUMN audience_at_capture TEXT;
    ALTER TABLE conversation_evidence_log ADD COLUMN sent_at_ms INTEGER;
    ALTER TABLE conversation_evidence_log ADD COLUMN reply_to_message_id TEXT;
    ALTER TABLE conversation_evidence_log ADD COLUMN mention_ids_json TEXT;
    ALTER TABLE conversation_evidence_log ADD COLUMN attachment_refs_json TEXT;
    ALTER TABLE conversation_evidence_log ADD COLUMN provenance_json TEXT;
    CREATE TABLE inbox_events (
      id INTEGER PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT,
      created_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      state TEXT NOT NULL,
      terminal_reason TEXT,
      quarantine_reason TEXT,
      wake_id TEXT,
      envelope_json TEXT
    );
  `);
}

function insertExternalEvidence(db: DatabaseSync, rowId: string, producingCycleId: string | null = null): void {
  db.prepare(
    `INSERT INTO conversation_evidence_log
      (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
       discord_message_ids_json, reservation_id, producing_cycle_id, content_hash,
       source_status, data_classification,
       speaker_principal_id, speaker_kind, location_json, audience_at_capture,
       sent_at_ms, reply_to_message_id, mention_ids_json, attachment_refs_json, provenance_json)
     VALUES (?, ?, 1, ?, 'external_dialog', ?, ?, ?, NULL, ?, 'hash', 'received', 'ordinary',
       ?, 'external_human', ?, 'dm', ?, NULL, '[]', '[]', ?)`,
  ).run(
    rowId,
    `lineage-${rowId}`,
    "dm:ashley-bot:person-1",
    "External hello",
    inside(2),
    JSON.stringify([`discord-${rowId}`]),
    producingCycleId,
    "person-1",
    JSON.stringify({ kind: "external_dm", principalId: "person-1", channelId: "dm-1" }),
    inside(2),
    JSON.stringify({ source: "discord", receivedAtMs: inside(2) }),
  );
}

function insertExternalMarkers(db: DatabaseSync, rowId: string): void {
  db.prepare(
    `INSERT INTO inbox_events
      (id, conversation_id, kind, payload_json, created_at_ms, status, state,
       terminal_reason, quarantine_reason, wake_id, envelope_json)
     VALUES (?, ?, 'external_captured', ?, ?, 'pending', 'pending', NULL, NULL, NULL, ?)` ,
  ).run(
    9001,
    "dm:ashley-bot:person-1",
    JSON.stringify({
      captureRef: `extcap:${rowId}`,
      evidenceRowId: rowId,
      conversationKey: "dm:ashley-bot:person-1",
      discordMessageId: `discord-${rowId}`,
    }),
    inside(2),
    JSON.stringify({ speakerPrincipalId: "person-1" }),
  );
  db.prepare(
    `INSERT INTO inbox_events
      (id, conversation_id, kind, payload_json, created_at_ms, status, state,
       terminal_reason, quarantine_reason, wake_id, envelope_json)
     VALUES (?, ?, 'quarantined_external', ?, ?, 'failed_terminal', 'quarantined',
       'unknown_external', 'unknown_external', NULL, NULL)` ,
  ).run(
    9002,
    "dm:ashley-bot:person-1",
    JSON.stringify({
      captureRef: `extcap:${rowId}`,
      evidenceRowId: rowId,
      conversationKey: "dm:ashley-bot:person-1",
      discordMessageId: `discord-${rowId}`,
    }),
    inside(2, 1),
  );
}

function attentionDatabase(): DatabaseSync {
  return new DatabaseSync(":memory:");
}

function addAttentionSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE attention_requests (
      id INTEGER PRIMARY KEY,
      lane TEXT NOT NULL,
      purpose TEXT NOT NULL,
      model_alias TEXT NOT NULL,
      resolved_model_id TEXT,
      provider_id TEXT,
      route_alias TEXT,
      state TEXT NOT NULL,
      outcome TEXT,
      error_class TEXT,
      queued_at TEXT NOT NULL,
      eligible_at TEXT NOT NULL,
      age_origin_at TEXT NOT NULL,
      deadline_at TEXT,
      reserved_at TEXT,
      dispatch_started_at TEXT,
      ended_at TEXT,
      actual_input_tokens INTEGER,
      actual_output_tokens INTEGER,
      delivery_reservation_id INTEGER,
      created_at TEXT NOT NULL,
      thought_invocation_id TEXT,
      thought_cycle_id TEXT,
      thought_generation INTEGER,
      actual_provider TEXT,
      actual_wire_binding_id TEXT
    );
    CREATE TABLE delivery_reservations (
      id INTEGER PRIMARY KEY,
      owner_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      delivery_lane TEXT NOT NULL,
      state TEXT NOT NULL,
      error_category TEXT,
      finalization_reason TEXT,
      created_at TEXT NOT NULL,
      finalized_at TEXT,
      cognitive_v021_projection_key TEXT
    );
    CREATE TABLE delivery_bubbles (
      id INTEGER PRIMARY KEY,
      reservation_id INTEGER NOT NULL,
      ordinal INTEGER NOT NULL,
      text TEXT,
      discord_message_id TEXT,
      sent_at TEXT
    );
  `);
}

function addTurn(
  cognitive: DatabaseSync,
  attention: DatabaseSync,
  turn: number,
  path: "primary" | "fallback" | "direct",
): void {
  const cycleId = `cycle-${turn}`;
  const settlementId = `settlement-${turn}`;
  const reservationId = turn;
  const outboxId = turn;
  const timestamp = inside(turn);
  const draft = `Thought draft ${turn}`;
  const licensed = path === "direct" ? draft : `Adapted speech ${turn}`;
  const discordId = `discord-ashley-${turn}`;

  cognitive.prepare(
    `INSERT INTO cycle_records
      (cycle_id, conversation_id, generation, state, trigger_kind, admitted_at_ms, updated_at_ms)
     VALUES (?, ?, 1, 'terminal', 'owner_message', ?, ?)`,
  ).run(cycleId, "conversation-1", timestamp, timestamp + 2_000);
  cognitive.prepare(
    `INSERT INTO thought_steps
      (request_id, cycle_id, generation, pass, kind, payload_json, created_at_ms)
     VALUES (?, ?, 1, 1, 'settlement', ?, ?)`,
  ).run(
    `thought-step-${turn}`,
    cycleId,
    JSON.stringify({ kind: "settlement", settlement: { speech: { mode: "draft", surfaceDraft: draft } } }),
    timestamp + 1_000,
  );
  cognitive.prepare(
    `INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json)
     VALUES (?, ?, 1, ?)`,
  ).run(settlementId, cycleId, JSON.stringify({ kind: "settlement" }));
  cognitive.prepare(
    `INSERT INTO speech_outbox
      (outbox_id, settlement_id, projection_key, cycle_id, generation, conversation_id,
       licensed_text, send_status, nuclear_reservation_id, discord_message_ids_json,
       suppressed, origin)
     VALUES (?, ?, ?, ?, 1, 'conversation-1', ?, 'sent', ?, ?, 0, 'live')`,
  ).run(outboxId, settlementId, `projection-${turn}`, cycleId, licensed, reservationId, JSON.stringify([discordId]));
  cognitive.prepare(
    `INSERT INTO conversation_evidence_log
      (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
       discord_message_ids_json, reservation_id, producing_cycle_id, content_hash,
       source_status, data_classification, delivered)
     VALUES (?, ?, 1, 'conversation-1', 'owner', ?, ?, ?, NULL, NULL, 'owner-hash', 'received', 'ordinary', 0)`,
  ).run(`owner-row-${turn}`, `owner-lineage-${turn}`, `Owner message ${turn}`, timestamp, JSON.stringify([`discord-owner-${turn}`]));
  cognitive.prepare(
    `INSERT INTO conversation_evidence_log
      (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
       discord_message_ids_json, reservation_id, producing_cycle_id, content_hash,
       source_status, data_classification, delivered)
     VALUES (?, ?, 1, 'conversation-1', 'ashley', ?, ?, ?, ?, ?, 'ashley-hash', 'delivered', 'ordinary', 1)`,
  ).run(`ashley-row-${turn}`, `ashley-lineage-${turn}`, licensed, timestamp + 3_000, JSON.stringify([discordId]), reservationId, cycleId);

  attention.prepare(
    `INSERT INTO attention_requests
      (id, lane, purpose, model_alias, resolved_model_id, provider_id, route_alias,
       state, outcome, error_class, queued_at, eligible_at, age_origin_at, deadline_at,
       dispatch_started_at, ended_at, actual_input_tokens, actual_output_tokens,
       delivery_reservation_id, created_at, thought_invocation_id, thought_cycle_id,
       thought_generation, actual_provider, actual_wire_binding_id)
     VALUES (?, 'interactive', 'thought', 'thought-model', 'thought-model-v1', 'groq',
       'ashley_thought', 'terminal', 'completed', NULL, ?, ?, ?, ?, ?, ?, 100, 20,
       NULL, ?, ?, ?, 1, 'groq', NULL)`,
  ).run(1000 + turn, iso(timestamp), iso(timestamp), iso(timestamp), iso(timestamp), iso(timestamp + 500), iso(timestamp), iso(timestamp), `thought-${turn}`, cycleId);

  if (path !== "direct") {
    const primaryFailed = path === "fallback";
    attention.prepare(
      `INSERT INTO attention_requests
        (id, lane, purpose, model_alias, resolved_model_id, provider_id, route_alias,
         state, outcome, error_class, queued_at, eligible_at, age_origin_at, deadline_at,
         dispatch_started_at, ended_at, actual_input_tokens, actual_output_tokens,
         delivery_reservation_id, created_at)
       VALUES (?, 'interactive', 'expression', ?, ?, ?, ?, 'terminal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    ).run(
      2000 + turn,
      primaryFailed ? "qwen/qwen3.8-27b" : "qwen/qwen3.8-27b",
      primaryFailed ? "qwen/qwen3.8-27b" : "qwen/qwen3.8-27b",
      "groq",
      "ashley_expression",
      primaryFailed ? "error" : "completed",
      primaryFailed ? "provider_timeout" : null,
      iso(timestamp), iso(timestamp), iso(timestamp), iso(timestamp), iso(timestamp + 800), iso(timestamp + 700),
      200, primaryFailed ? 0 : 40, reservationId, iso(timestamp),
    );
    if (primaryFailed) {
      attention.prepare(
        `INSERT INTO attention_requests
          (id, lane, purpose, model_alias, resolved_model_id, provider_id, route_alias,
           state, outcome, error_class, queued_at, eligible_at, age_origin_at, deadline_at,
           dispatch_started_at, ended_at, actual_input_tokens, actual_output_tokens,
           delivery_reservation_id, created_at)
         VALUES (?, 'interactive', 'expression', ?, ?, ?, ?, 'terminal', 'completed', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      ).run(
        3000 + turn,
        "nvidia/nemotron-3.5-lightning-30b-a3b",
        "nvidia/nemotron-3.5-lightning-30b-a3b",
        "nim",
        "ashley_expression_fallback",
        iso(timestamp), iso(timestamp), iso(timestamp), iso(timestamp), iso(timestamp + 1_200), iso(timestamp + 1_100),
        200, 38, reservationId, iso(timestamp),
      );
    }
  }

  attention.prepare(
    `INSERT INTO delivery_reservations
      (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
       error_category, finalization_reason, created_at, finalized_at, cognitive_v021_projection_key)
     VALUES (?, 'owner-1', 'discord', 'conversation-1', 'owner_message', 'reactive', 'committed', NULL, 'sent', ?, ?, ?)`,
  ).run(reservationId, iso(timestamp), iso(timestamp + 4_000), `projection-${turn}`);
  attention.prepare(
    `INSERT INTO delivery_bubbles (id, reservation_id, ordinal, text, discord_message_id, sent_at)
     VALUES (?, ?, 0, ?, ?, ?)`,
  ).run(4000 + turn, reservationId, licensed, discordId, iso(timestamp + 3_500));
}

function seedDatabases(paths: { cognitive: DatabaseSync; attention: DatabaseSync }): void {
  addAttentionSchema(paths.attention);
  addTurn(paths.cognitive, paths.attention, 1, "primary");
  addTurn(paths.cognitive, paths.attention, 2, "fallback");
  addTurn(paths.cognitive, paths.attention, 3, "direct");
}

describe("modern Field Lab transcript and turn evidence", () => {
  it("captures Owner ingress and Ashley output from modern durable stores", () => {
    const cognitive = sidecar();
    const attention = attentionDatabase();
    seedDatabases({ cognitive, attention });
    const capture = captureModernConversation({
      cognitiveSidecar: cognitive,
      nuclear: attention,
      window,
    });

    expect(capture.modernActivityCount).toBeGreaterThan(0);
    expect(capture.sessions).toHaveLength(1);
    expect(capture.sessions[0]?.messages.map((message) => message.role)).toEqual([
      "user", "assistant", "user", "assistant", "user", "assistant",
    ]);
    expect(capture.sessions[0]?.messages[0]).toMatchObject({
      text_redacted: "Owner message 1",
      evidence_row_id: "owner-row-1",
      conversation_id: "conversation-1",
      discord_message_ids: ["discord-owner-1"],
    });
    expect(capture.sessions[0]?.messages[1]).toMatchObject({
      text_redacted: "Adapted speech 1",
      evidence_row_id: "ashley-row-1",
      cycle_id: "cycle-1",
      reservation_id: 1,
    });
    cognitive.close();
    attention.close();
  });

  it("classifies observed primary, fallback, and unbound expression paths without configured inference", () => {
    const cognitive = sidecar();
    const attention = attentionDatabase();
    seedDatabases({ cognitive, attention });
    const capture = captureModernConversation({ cognitiveSidecar: cognitive, nuclear: attention, window });
    const turns = capture.turns as Array<Record<string, any>>;

    expect(turns).toHaveLength(3);
    expect(capture.expressionAttempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "QWEN_PRIMARY", correlation_status: "linked" }),
      expect.objectContaining({ path: "LIGHTNING_FALLBACK", correlation_status: "linked" }),
    ]));
    expect(turns[0]).toMatchObject({
      path: "QWEN_PRIMARY",
      expression: { route: "ashley_expression", provider: "groq", model_alias: "qwen/qwen3.8-27b", outcome: "completed" },
      thought: { provider: "groq", attention_request_id: 1001, surface_draft: "Thought draft 1" },
      final_speech: { licensed_text: "Adapted speech 1", delivery_reservation_id: 1 },
    });
    expect(turns[1]).toMatchObject({
      path: "LIGHTNING_FALLBACK",
      expression: { route: "ashley_expression_fallback", provider: "nim", model_alias: "nvidia/nemotron-3.5-lightning-30b-a3b", outcome: "completed" },
      fallback: { trigger: "provider_timeout" },
    });
    expect(turns[2]?.path).not.toBe("QWEN_PRIMARY");
    expect(turns[2]?.path).not.toBe("LIGHTNING_FALLBACK");
    expect(turns[2]).toMatchObject({
      path: "UNKNOWN",
      thought: { provider: "groq", surface_draft: "Thought draft 3" },
      final_speech: { licensed_text: "Thought draft 3" },
    });
    expect(JSON.stringify(turns[2])).not.toMatch(/qwen|nemotron|reasoning_content|reasoning_format|payload_json/iu);
    cognitive.close();
    attention.close();
  });

  it("retains observed unbound Expression attempts as gaps instead of timestamp-joining them", () => {
    const cognitive = sidecar();
    const attention = attentionDatabase();
    seedDatabases({ cognitive, attention });
    attention.prepare("UPDATE attention_requests SET delivery_reservation_id = NULL WHERE purpose = 'expression'").run();

    const capture = captureModernConversation({ cognitiveSidecar: cognitive, nuclear: attention, window });
    expect(capture.expressionAttempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "QWEN_PRIMARY", correlation_status: "unbound" }),
      expect.objectContaining({ path: "LIGHTNING_FALLBACK", correlation_status: "unbound" }),
    ]));
    expect(capture.modernGaps.map((gap) => gap.detail)).toEqual(expect.arrayContaining([
      "expression_attention_correlation_missing:2001",
      "expression_attention_correlation_missing:2002",
      "expression_attention_correlation_missing:3002",
    ]));
    expect((capture.turns as Array<Record<string, any>>)[0]?.path).toBe("UNKNOWN");
    cognitive.close();
    attention.close();
  });

  it("keeps modern transcript coverage non-normal when durable activity cannot be extracted", () => {
    const cognitive = sidecar();
    const attention = attentionDatabase();
    addAttentionSchema(attention);
    cognitive.prepare(
      `INSERT INTO cycle_records
        (cycle_id, conversation_id, generation, state, trigger_kind, admitted_at_ms, updated_at_ms)
       VALUES ('cycle-gap', 'conversation-gap', 1, 'terminal', 'owner_message', ?, ?)`,
    ).run(inside(1), inside(1));
    cognitive.prepare(
      `INSERT INTO conversation_evidence_log
        (row_id, lineage_id, version, conversation_id, role, text, created_at_ms,
         discord_message_ids_json, content_hash, source_status, data_classification)
       VALUES ('owner-gap', 'lineage-gap', 1, 'conversation-gap', 'owner', 'Owner gap', ?, '[]', 'hash', 'received', 'ordinary')`,
    ).run(inside(1));
    const capture = captureModernConversation({ cognitiveSidecar: cognitive, nuclear: attention, window });
    expect(capture.modernActivityCount).toBeGreaterThan(0);
    expect(capture.modernGaps.length).toBeGreaterThan(0);
    expect(capture.modernMessageCount).toBe(1);
    cognitive.close();
    attention.close();
  });

  it("does not manufacture modern transcript rows for a true empty day", () => {
    const root = tempDir("observer-modern-empty-");
    temporaryPaths.push(root);
    const sessionsRoot = `${root}/sessions`;
    mkdirSync(sessionsRoot, { recursive: true });
    const cognitive = sidecar();
    const attention = attentionDatabase();
    addAttentionSchema(attention);
    const result = assembleTranscript({
      sessionsRoot,
      window,
      nuclear: attention,
      cognitiveSidecar: cognitive,
    });
    expect(result.transcript.sessions).toEqual([]);
    expect(result.modern_activity_count).toBe(0);
    expect(result.modern_message_count).toBe(0);
    expect(result.coverage).toBe("DEGRADED_PARTIAL");
    cognitive.close();
    attention.close();
  });

  it("preserves raw-reasoning absence and records delivery/fidelity provenance", () => {
    const cognitive = sidecar();
    const attention = attentionDatabase();
    seedDatabases({ cognitive, attention });
    const capture = captureModernConversation({ cognitiveSidecar: cognitive, nuclear: attention, window });
    const first = (capture.turns as Array<Record<string, any>>)[0];
    expect(first).toMatchObject({
      final_speech: {
        delivered_text: "Adapted speech 1",
        discord_message_ids: ["discord-ashley-1"],
        delivery_result: "delivered",
      },
      fidelity: { status: "UNKNOWN", provenance: "no_standalone_durable_receipt" },
    });
    expect(first.thought.reasoning_tokens).toBe("UNKNOWN");
    expect(JSON.stringify(capture)).not.toMatch(/reasoning_content|reasoning_format|hidden_reasoning|payload_json/iu);
    cognitive.close();
    attention.close();
  });

  it("preserves external attribution and quarantine separately from ordinary conversation", () => {
    const cognitive = sidecar();
    const attention = attentionDatabase();
    addExternalCompatibilitySchema(cognitive);
    addAttentionSchema(attention);
    insertExternalEvidence(cognitive, "external-row-1");
    insertExternalMarkers(cognitive, "external-row-1");

    const capture = captureModernConversation({ cognitiveSidecar: cognitive, nuclear: attention, window });
    const externalIngress = (capture as typeof capture & { externalIngress?: Array<Record<string, unknown>> }).externalIngress;

    expect(externalIngress).toEqual([
      expect.objectContaining({
        evidence_row_id: "external-row-1",
        capture_ref: "extcap:external-row-1",
        discord_message_id: "discord-external-row-1",
        conversation_id: "dm:ashley-bot:person-1",
        text_redacted: "External hello",
        speaker_principal_id: "person-1",
        speaker_kind: "external_human",
        location: { kind: "external_dm", principalId: "person-1", channelId: "dm-1" },
        audience_at_capture: "dm",
        capture_status: "pending",
        capture_state: "pending",
        admission_status: "failed_terminal",
        admission_marker_state: "quarantined",
        admission_state: "quarantined_external",
        quarantine_reason: "unknown_external",
        cognition_state: "not_reached",
        publication_state: "not_attempted",
        delivery_state: "not_attempted",
      }),
    ]);
    expect(capture.sessions).toEqual([]);
    expect(JSON.stringify(externalIngress)).not.toMatch(/payload_json|envelope_json|sourceUrl/iu);

    const root = tempDir("observer-modern-external-complete-");
    temporaryPaths.push(root);
    const sessionsRoot = `${root}/sessions`;
    mkdirSync(sessionsRoot, { recursive: true });
    const transcript = assembleTranscript({
      sessionsRoot,
      window,
      nuclear: attention,
      cognitiveSidecar: cognitive,
    });
    expect(transcript.coverage).toBe("NORMAL");
    expect(transcript.transcript.sessions).toEqual([]);
    expect(transcript.transcript.external_ingress).toEqual(externalIngress);

    const extracted = extractEvidence({
      nuclear: attention,
      continuity: null,
      cognitiveSidecar: cognitive,
      window,
    });
    expect(extracted.evidence.cognitive_lifecycle).toMatchObject({
      external_ingress: externalIngress,
    });
    cognitive.close();
    attention.close();
  });

  it("marks missing external lifecycle markers as a modern source gap", () => {
    const root = tempDir("observer-modern-external-gap-");
    temporaryPaths.push(root);
    const sessionsRoot = `${root}/sessions`;
    mkdirSync(sessionsRoot, { recursive: true });
    const cognitive = sidecar();
    const attention = attentionDatabase();
    addExternalCompatibilitySchema(cognitive);
    addAttentionSchema(attention);
    insertExternalEvidence(cognitive, "external-row-gap");

    const capture = captureModernConversation({ cognitiveSidecar: cognitive, nuclear: attention, window });
    expect(capture.modernGaps.map((gap) => gap.detail)).toContain(
      "external_marker_missing:external-row-gap",
    );
    const transcript = assembleTranscript({
      sessionsRoot,
      window,
      nuclear: attention,
      cognitiveSidecar: cognitive,
    });
    expect(transcript.coverage).toBe("DEGRADED_PARTIAL");
    expect(transcript.modern_gaps?.map((gap) => gap.detail)).toContain(
      "external_marker_missing:external-row-gap",
    );
    cognitive.close();
    attention.close();
  });

  it("preserves an observed social cycle disposition without treating it as delivery", () => {
    const cognitive = sidecar();
    const attention = attentionDatabase();
    addExternalCompatibilitySchema(cognitive);
    addAttentionSchema(attention);
    cognitive.exec("ALTER TABLE cycle_records ADD COLUMN disposition TEXT;");
    insertExternalEvidence(cognitive, "external-row-silence", "external-cycle-1");
    cognitive.prepare(
      `INSERT INTO cycle_records
        (cycle_id, conversation_id, generation, state, trigger_kind, admitted_at_ms, updated_at_ms, disposition)
       VALUES ('external-cycle-1', 'dm:ashley-bot:person-1', 1, 'terminal', 'external_message', ?, ?, 'intentional_silence')`,
    ).run(inside(3), inside(3));

    const capture = captureModernConversation({ cognitiveSidecar: cognitive, nuclear: attention, window });
    expect(capture.externalIngress).toEqual([
      expect.objectContaining({
        cycle_id: "external-cycle-1",
        cycle_disposition: "intentional_silence",
        cognition_state: "cycle_admitted",
        publication_state: "not_attempted",
        delivery_state: "not_attempted",
      }),
    ]);
    cognitive.close();
    attention.close();
  });
});
