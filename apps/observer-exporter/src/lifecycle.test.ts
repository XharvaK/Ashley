import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { extractEvidence } from "./evidence.js";
import { fieldDayWindow } from "./field-day.js";

const window = fieldDayWindow("2026-08-26");
const insideMs = window.start.getTime() + 60_000;
const insideIso = new Date(insideMs).toISOString();

function sidecarDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE inbox_events (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      state TEXT NOT NULL,
      wake_id TEXT,
      attempt_count INTEGER NOT NULL,
      consumed_at_ms INTEGER,
      next_eligible_at_ms INTEGER,
      terminal_reason TEXT,
      last_failure_class TEXT
    );
    CREATE TABLE wakes (
      wake_id TEXT PRIMARY KEY,
      occurrence_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      state TEXT NOT NULL,
      terminal_reason TEXT,
      captured_trigger_generation INTEGER,
      captured_authority_revision INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE cycle_records (
      cycle_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      state TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      trigger_ref TEXT,
      occupant_id TEXT,
      authority_epoch INTEGER NOT NULL,
      architecture_epoch TEXT NOT NULL,
      admitted_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE settlements (
      settlement_id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      wake_id TEXT,
      semantic_pass INTEGER,
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
      suppressed INTEGER NOT NULL,
      origin TEXT NOT NULL,
      nuclear_finalization_reason TEXT
    );
    CREATE TABLE system_notice_outbox (
      notice_id INTEGER PRIMARY KEY,
      notice_key TEXT NOT NULL,
      projection_key TEXT NOT NULL,
      cycle_id TEXT,
      conversation_id TEXT NOT NULL,
      notice_text TEXT NOT NULL,
      send_status TEXT NOT NULL,
      nuclear_reservation_id INTEGER,
      discord_message_id TEXT,
      origin TEXT NOT NULL
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
      secret_omitted INTEGER NOT NULL,
      delivered INTEGER NOT NULL
    );
    CREATE TABLE observations (
      observation_id TEXT PRIMARY KEY,
      cycle_id TEXT,
      generation INTEGER,
      derived INTEGER NOT NULL,
      replay_safe INTEGER NOT NULL,
      modality TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      provenance TEXT NOT NULL,
      data_classification TEXT NOT NULL,
      secret_omitted INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE periodic_cognition_schedule (
      id TEXT PRIMARY KEY,
      authority_epoch INTEGER NOT NULL,
      next_eligible_at_ms INTEGER NOT NULL,
      pending_occurrence_id TEXT,
      pending_wake_id TEXT,
      pending_due_at_ms INTEGER,
      pending_expires_at_ms INTEGER,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE TABLE periodic_cognition_occurrence_receipts (
      schedule_occurrence_id TEXT PRIMARY KEY,
      disposition TEXT NOT NULL,
      wake_id TEXT,
      authority_epoch INTEGER NOT NULL,
      eligible_at_ms INTEGER NOT NULL,
      closed_at_ms INTEGER NOT NULL,
      detail TEXT
    );
    CREATE TABLE causal_ledger (
      id INTEGER PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      thought_unavailable INTEGER NOT NULL
    );
  `);
  return db;
}

function observabilityDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE allocation_receipts (
      request_id TEXT PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL
    );
    CREATE TABLE thought_dispatch_diagnostics (
      id INTEGER PRIMARY KEY,
      cycle_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      request_id TEXT NOT NULL,
      pass INTEGER NOT NULL,
      code TEXT NOT NULL,
      stage TEXT NOT NULL,
      dispatch_truth TEXT NOT NULL,
      primary_dispatch_truth TEXT,
      secondary_dispatch_truth TEXT,
      publication_reason TEXT,
      attempt_ordinal INTEGER,
      finish_reason TEXT,
      error_code TEXT,
      created_at_ms INTEGER NOT NULL
    );
  `);
  return db;
}

function nuclearDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
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
      text TEXT NOT NULL,
      discord_message_id TEXT,
      sent_at TEXT
    );
  `);
  return db;
}

function seedLifecycle(sidecar: DatabaseSync, observability: DatabaseSync, nuclear: DatabaseSync): void {
  sidecar.prepare(
    `INSERT INTO cycle_records
      (cycle_id, conversation_id, generation, state, trigger_kind, authority_epoch,
       architecture_epoch, admitted_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("cycle-draft", "thread-1", 1, "sending", "owner_message", 1, "ashley-v0.2.1", insideMs, insideMs);
  sidecar.prepare(
    `INSERT INTO cycle_records
      (cycle_id, conversation_id, generation, state, trigger_kind, authority_epoch,
       architecture_epoch, admitted_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("cycle-silence", "thread-1", 1, "silent", "owner_message", 1, "ashley-v0.2.1", insideMs + 1, insideMs + 1);
  sidecar.prepare(
    `INSERT INTO cycle_records
      (cycle_id, conversation_id, generation, state, trigger_kind, authority_epoch,
       architecture_epoch, admitted_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("cycle-superseded", "thread-1", 1, "terminal", "owner_message", 1, "ashley-v0.2.1", insideMs + 2, insideMs + 2);

  sidecar.prepare(
    `INSERT INTO wakes
      (wake_id, occurrence_id, source_kind, conversation_id, cycle_id, state,
       terminal_reason, captured_trigger_generation, captured_authority_revision,
       created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("wake-draft", "occ-draft", "inbox", "thread-1", "cycle-draft", "authorized", null, 1, 1, insideMs, insideMs);
  sidecar.prepare(
    `INSERT INTO wakes
      (wake_id, occurrence_id, source_kind, conversation_id, cycle_id, state,
       terminal_reason, captured_trigger_generation, captured_authority_revision,
       created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("wake-silence", "occ-silence", "inbox", "thread-1", "cycle-silence", "terminal", "completed", 1, 1, insideMs + 1, insideMs + 1);
  sidecar.prepare(
    `INSERT INTO wakes
      (wake_id, occurrence_id, source_kind, conversation_id, cycle_id, state,
       terminal_reason, captured_trigger_generation, captured_authority_revision,
       created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("wake-superseded", "occ-superseded", "inbox", "thread-1", "cycle-superseded", "terminal", "superseded", 1, 1, insideMs + 2, insideMs + 2);

  sidecar.prepare(
    `INSERT INTO inbox_events
      (id, conversation_id, kind, created_at_ms, status, state, wake_id,
       attempt_count, consumed_at_ms, next_eligible_at_ms, terminal_reason, last_failure_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("event-draft", "thread-1", "owner_message", insideMs, "consumed", "terminal", "wake-draft", 1, insideMs + 10, null, "completed", null);
  sidecar.prepare(
    `INSERT INTO inbox_events
      (id, conversation_id, kind, created_at_ms, status, state, wake_id,
       attempt_count, consumed_at_ms, next_eligible_at_ms, terminal_reason, last_failure_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("event-silence", "thread-1", "owner_message", insideMs + 1, "consumed", "terminal", "wake-silence", 1, insideMs + 10, null, "completed", null);
  sidecar.prepare(
    `INSERT INTO inbox_events
      (id, conversation_id, kind, created_at_ms, status, state, wake_id,
       attempt_count, consumed_at_ms, next_eligible_at_ms, terminal_reason, last_failure_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("event-superseded", "thread-1", "owner_message", insideMs + 2, "consumed", "terminal", "wake-superseded", 1, insideMs + 10, null, "superseded", null);

  sidecar.prepare(
    `INSERT INTO settlements
      (settlement_id, cycle_id, generation, wake_id, semantic_pass, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("settle-draft", "cycle-draft", 1, "wake-draft", 1, JSON.stringify({
    speech: { mode: "draft", surfaceDraft: "do not export this draft" },
    commitments: { conversational: ["answer"] },
    operations: { observationsConsumed: ["observation-1"] },
  }));
  sidecar.prepare(
    `INSERT INTO settlements
      (settlement_id, cycle_id, generation, wake_id, semantic_pass, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("settle-silence", "cycle-silence", 1, "wake-silence", 1, JSON.stringify({
    speech: { mode: "none", surfaceDraft: null },
    commitments: { conversational: ["silence"] },
  }));
  sidecar.prepare(
    `INSERT INTO speech_outbox
      (outbox_id, settlement_id, projection_key, cycle_id, generation, conversation_id,
       licensed_text, send_status, nuclear_reservation_id, discord_message_ids_json,
       suppressed, origin, nuclear_finalization_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "settle-draft", "speech:1", "cycle-draft", 1, "thread-1", "do not export this licensed text", "pending", 1, "[]", 0, "live", null);

  sidecar.prepare(
    `INSERT INTO observations
      (observation_id, cycle_id, generation, derived, replay_safe, modality,
       payload_json, provenance, data_classification, secret_omitted, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("observation-1", "cycle-draft", 1, 0, 1, "text", JSON.stringify({ content: "do not export" }), "test", "ordinary", 0, insideMs);

  sidecar.prepare(
    `INSERT INTO periodic_cognition_schedule
      (id, authority_epoch, next_eligible_at_ms, pending_occurrence_id,
       pending_wake_id, pending_due_at_ms, pending_expires_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("ashley-periodic-v1", 1, insideMs + 10_000, null, null, null, null, insideMs);
  sidecar.prepare(
    `INSERT INTO periodic_cognition_occurrence_receipts
      (schedule_occurrence_id, disposition, wake_id, authority_epoch,
       eligible_at_ms, closed_at_ms, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("occ-empty", "skipped_empty", null, 1, insideMs, insideMs + 2, "do not export detail");

  sidecar.prepare(
    `INSERT INTO causal_ledger
      (id, cycle_id, generation, payload_json, thought_unavailable)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(1, "cycle-draft", 1, JSON.stringify({ secret: "do not export" }), 0);

  observability.prepare(
    `INSERT INTO thought_dispatch_diagnostics
      (id, cycle_id, generation, request_id, pass, code, stage, dispatch_truth,
       primary_dispatch_truth, secondary_dispatch_truth, publication_reason,
       attempt_ordinal, finish_reason, error_code, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "cycle-draft", 1, "request-1", 1, "provider_unavailable", "provider_dispatch", "unknown", "unknown", null, null, 1, null, "provider_timeout", insideMs);

  nuclear.prepare(
    `INSERT INTO delivery_reservations
      (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
       error_category, finalization_reason, created_at, finalized_at,
       cognitive_v021_projection_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "owner-1", "discord", "thread-1", "reactive", "reactive", "reserved", null, null, insideIso, null, "speech:1");
  nuclear.prepare(
    `INSERT INTO delivery_reservations
      (id, owner_id, channel, thread_id, trigger, delivery_lane, state,
       error_category, finalization_reason, created_at, finalized_at,
       cognitive_v021_projection_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(2, "owner-1", "discord", "thread-1", "reactive", "reactive", "committed", null, null, insideIso, insideIso, "speech:2");
  nuclear.prepare(
    `INSERT INTO delivery_bubbles
      (id, reservation_id, ordinal, text, discord_message_id, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(1, 1, 0, "do not export bubble", null, null);
  nuclear.prepare(
    `INSERT INTO delivery_bubbles
      (id, reservation_id, ordinal, text, discord_message_id, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(2, 2, 0, "do not export bubble", "discord-1", insideIso);
  nuclear.prepare(
    `INSERT INTO delivery_bubbles
      (id, reservation_id, ordinal, text, discord_message_id, sent_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(3, 2, 1, "do not export bubble", "discord-2", insideIso);
}

function seedSharedOwnerEvents(
  sidecar: DatabaseSync,
  kind: "draft" | "silence" | "superseded",
): void {
  const cycleId = "cycle-shared-" + kind;
  const wakeId = "wake-shared-" + kind;
  const inside = insideMs + (kind === "draft" ? 10 : kind === "silence" ? 20 : 30);
  const wakeTerminalReason = kind === "superseded" ? "superseded" : null;
  sidecar.prepare(
    `INSERT INTO cycle_records
      (cycle_id, conversation_id, generation, state, trigger_kind, authority_epoch,
       architecture_epoch, admitted_at_ms, updated_at_ms)
     VALUES (?, ?, 1, ?, 'owner_message', 1, 'ashley-v0.2.1', ?, ?)`,
  ).run(cycleId, "thread-shared", kind === "superseded" ? "terminal" : "sending", inside, inside);
  sidecar.prepare(
    `INSERT INTO wakes
      (wake_id, occurrence_id, source_kind, conversation_id, cycle_id, state,
       terminal_reason, captured_trigger_generation, captured_authority_revision,
       created_at_ms, updated_at_ms)
     VALUES (?, ?, 'inbox', 'thread-shared', ?, ?, ?, 1, 1, ?, ?)`,
  ).run(wakeId, "occ-shared-" + kind, cycleId, kind === "superseded" ? "terminal" : "authorized", wakeTerminalReason, inside, inside);

  if (kind === "draft" || kind === "silence") {
    sidecar.prepare(
      `INSERT INTO settlements
        (settlement_id, cycle_id, generation, wake_id, semantic_pass, payload_json)
       VALUES (?, ?, 1, ?, 1, ?)`,
    ).run(
      "settle-shared-" + kind,
      cycleId,
      wakeId,
      JSON.stringify(kind === "draft"
        ? { speech: { mode: "draft" }, commitments: { conversational: ["answer"] } }
        : { speech: { mode: "none" }, commitments: { conversational: ["silence"] } }),
    );
  }
  if (kind === "draft") {
    sidecar.prepare(
      `INSERT INTO speech_outbox
        (outbox_id, settlement_id, projection_key, cycle_id, generation, conversation_id,
         licensed_text, send_status, nuclear_reservation_id, discord_message_ids_json,
         suppressed, origin, nuclear_finalization_reason)
       VALUES (10, ?, 'speech:10', ?, 1, 'thread-shared', 'licensed', 'pending', NULL, '[]', 0, 'live', NULL)`,
    ).run("settle-shared-draft", cycleId);
  }

  const insertEvent = sidecar.prepare(
    `INSERT INTO inbox_events
      (id, conversation_id, kind, created_at_ms, status, state, wake_id,
       attempt_count, consumed_at_ms, next_eligible_at_ms, terminal_reason, last_failure_class)
     VALUES (?, 'thread-shared', 'owner_message', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  insertEvent.run(
    "event-shared-covered-" + kind,
    inside,
    "consumed",
    "terminal",
    wakeId,
    1,
    inside + 1,
    null,
    kind === "superseded" ? "superseded" : "completed",
  );
  insertEvent.run(
    "event-shared-uncovered-" + kind,
    inside + 1,
    "pending",
    "pending",
    wakeId,
    0,
    null,
    inside + 2,
    null,
  );
}

describe("bounded cognitive lifecycle evidence", () => {
  it("projects publication, silence, transfer, delivery, convergence, supersession, infrastructure, and periodic facts without payloads", () => {
    const sidecar = sidecarDatabase();
    const observability = observabilityDatabase();
    const nuclear = nuclearDatabase();
    try {
      seedLifecycle(sidecar, observability, nuclear);
      const before = JSON.stringify({
        sidecar: sidecar.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
        observability: observability.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
        nuclear: nuclear.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
      });
      const result = extractEvidence({
        nuclear,
        continuity: null,
        cognitiveSidecar: sidecar,
        cognitiveObservability: observability,
        window,
      });
      const lifecycle = result.evidence.cognitive_lifecycle as Record<string, unknown>;
      const publications = lifecycle.publications as Array<Record<string, unknown>>;
      const delivery = lifecycle.delivery as Array<Record<string, unknown>>;
      const obligations = lifecycle.owner_obligations as Array<Record<string, unknown>>;
      const failures = lifecycle.infrastructure_failures as Array<Record<string, unknown>>;
      const periodic = lifecycle.periodic as Array<Record<string, unknown>>;

      expect(publications).toEqual(expect.arrayContaining([
        expect.objectContaining({
          settlement_id: "settle-draft",
          publication_status: "succeeded",
          speech_authored: true,
          speech_transferred: true,
          semantic_silence: "not_explicit",
        }),
        expect.objectContaining({
          settlement_id: "settle-silence",
          publication_status: "succeeded",
          speech_authored: false,
          semantic_silence: "explicit",
        }),
      ]));
      expect(delivery).toEqual(expect.arrayContaining([
        expect.objectContaining({
          reservation_id: 1,
          delivery_status: "delivery_pending",
          speech_transferred: true,
        }),
        expect.objectContaining({
          reservation_id: 2,
          delivery_status: "delivery_confirmed",
          conversation_evidence_convergence: "gap",
        }),
      ]));
      expect(obligations).toEqual(expect.arrayContaining([
        expect.objectContaining({ owner_event_id: "event-draft", disposition: "transferred" }),
        expect.objectContaining({ owner_event_id: "event-silence", disposition: "resolved" }),
        expect.objectContaining({ owner_event_id: "event-superseded", disposition: "superseded" }),
      ]));
      expect(failures).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: "thought_dispatch_diagnostics", code: "provider_unavailable" }),
      ]));
      expect(periodic).toEqual(expect.arrayContaining([
        expect.objectContaining({ occurrence_id: "occ-empty", disposition: "skipped_empty" }),
      ]));

      const serialized = JSON.stringify(result.evidence);
      expect(serialized).not.toMatch(/payload_json|licensed_text|notice_text|reasoning|surfaceDraft|secret|do not export/iu);
      expect(JSON.stringify(result.surfaces)).not.toMatch(/payload_json|licensed_text|notice_text|reasoning/iu);
      const after = JSON.stringify({
        sidecar: sidecar.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
        observability: observability.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
        nuclear: nuclear.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(),
      });
      expect(after).toBe(before);
    } finally {
      sidecar.close();
      observability.close();
      nuclear.close();
    }
  });

  it("marks a missing lifecycle source UNKNOWN instead of representing it as an empty capture", () => {
    const result = extractEvidence({
      nuclear: null,
      continuity: null,
      cognitiveSidecar: null,
      cognitiveObservability: null,
      window,
    });
    const lifecycle = result.evidence.cognitive_lifecycle as Record<string, unknown>;
    expect(lifecycle.source_capture).toMatchObject({
      nuclear: "UNKNOWN",
      cognitive_sidecar: "UNKNOWN",
      cognitive_observability: "UNKNOWN",
    });
    expect(lifecycle.publications).toEqual([]);
  });

  it("attributes owner obligation outcomes to the exact event terminal state", () => {
    const sidecar = sidecarDatabase();
    const observability = observabilityDatabase();
    const nuclear = nuclearDatabase();
    try {
      seedSharedOwnerEvents(sidecar, "draft");
      seedSharedOwnerEvents(sidecar, "silence");
      seedSharedOwnerEvents(sidecar, "superseded");

      const result = extractEvidence({
        nuclear,
        continuity: null,
        cognitiveSidecar: sidecar,
        cognitiveObservability: observability,
        window,
      });
      const lifecycle = result.evidence.cognitive_lifecycle as Record<string, unknown>;
      const obligations = lifecycle.owner_obligations as Array<Record<string, unknown>>;
      const dispositionByEvent = new Map(
        obligations.map((obligation) => [String(obligation.owner_event_id), obligation.disposition]),
      );

      expect(Object.fromEntries(dispositionByEvent)).toMatchObject({
        "event-shared-covered-draft": "transferred",
        "event-shared-uncovered-draft": "unresolved",
        "event-shared-covered-silence": "resolved",
        "event-shared-uncovered-silence": "unresolved",
        "event-shared-covered-superseded": "superseded",
        "event-shared-uncovered-superseded": "unresolved",
      });
    } finally {
      sidecar.close();
      observability.close();
      nuclear.close();
    }
  });

  it("marks lifecycle evidence partial when a relevant surface exceeds the bound", () => {
    const sidecar = sidecarDatabase();
    const observability = observabilityDatabase();
    const nuclear = nuclearDatabase();
    try {
      const insert = sidecar.prepare(
        `INSERT INTO inbox_events
          (id, conversation_id, kind, created_at_ms, status, state, wake_id,
           attempt_count, consumed_at_ms, next_eligible_at_ms, terminal_reason, last_failure_class)
         VALUES (?, 'thread-overflow', 'owner_message', ?, 'pending', 'pending', NULL, 0, NULL, NULL, NULL, NULL)`,
      );
      for (let index = 0; index < 501; index += 1) {
        insert.run("event-overflow-" + index, insideMs + index);
      }

      const result = extractEvidence({
        nuclear,
        continuity: null,
        cognitiveSidecar: sidecar,
        cognitiveObservability: observability,
        window,
      });
      const lifecycle = result.evidence.cognitive_lifecycle as Record<string, unknown>;
      expect(lifecycle.source_capture).toMatchObject({ cognitive_sidecar: "partial" });
      expect((lifecycle.owner_obligations as unknown[])).toHaveLength(500);
      expect(result.surfaces.failed).toEqual(expect.arrayContaining([
        { name: "inbox_events", error_class: "enumeration_overflow:inbox_events", state: "UNKNOWN" },
      ]));
    } finally {
      sidecar.close();
      observability.close();
      nuclear.close();
    }
  });

  it("filters current lifecycle rows before applying the bounded read", () => {
    const sidecar = sidecarDatabase();
    const observability = observabilityDatabase();
    const nuclear = nuclearDatabase();
    try {
      const insert = sidecar.prepare(
        `INSERT INTO inbox_events
          (id, conversation_id, kind, created_at_ms, status, state, wake_id,
           attempt_count, consumed_at_ms, next_eligible_at_ms, terminal_reason, last_failure_class)
         VALUES (?, 'thread-current', 'owner_message', ?, 'pending', 'pending', NULL, 0, NULL, NULL, NULL, NULL)`,
      );
      for (let index = 0; index < 600; index += 1) {
        insert.run("event-historical-" + index, window.start.getTime() - index - 1);
      }
      insert.run("event-current", insideMs);

      const result = extractEvidence({
        nuclear,
        continuity: null,
        cognitiveSidecar: sidecar,
        cognitiveObservability: observability,
        window,
      });
      const lifecycle = result.evidence.cognitive_lifecycle as Record<string, unknown>;
      expect(lifecycle.source_capture).toMatchObject({ cognitive_sidecar: "complete" });
      expect(lifecycle.owner_obligations).toEqual([
        expect.objectContaining({ owner_event_id: "event-current", disposition: "unresolved" }),
      ]);
    } finally {
      sidecar.close();
      observability.close();
      nuclear.close();
    }
  });
});
