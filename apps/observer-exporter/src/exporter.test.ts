import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalize, computeBundleId } from "./canonical-json.js";
import {
  exportFieldObservation,
  type ExportOptions,
} from "./exporter.js";
import { createContinuityFixture, createNuclearFixture, git, readJson, removeTemp, tempDir, writeJsonLines } from "../../../test/observer-support.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) removeTemp(path);
});

function fixture(): { dataRoot: string; outRoot: string; sessionsRoot: string; checkout: string } {
  const root = tempDir("observer-export-");
  temporaryPaths.push(root);
  const dataRoot = join(root, "ashley-data");
  const outRoot = join(root, "field-bundles");
  const sessionsRoot = join(dataRoot, "conversations", "sessions");
  mkdirSync(join(dataRoot, "conversations"), { recursive: true });
  const nuclear = createNuclearFixture(join(dataRoot, "conversations", "nuclear.db"));
  nuclear.prepare("INSERT INTO mem_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    1,
    "thread-1",
    "owner-1",
    "user",
    "export me",
    "discord",
    "2026-08-26T01:10:00.000Z",
    "never_public",
  );
  nuclear.close();
  const continuity = createContinuityFixture(join(dataRoot, "continuity.db"));
  continuity.exec("CREATE TABLE continuity_events (occurred_at TEXT NOT NULL);");
  continuity.prepare("INSERT INTO lineage_state VALUES (?, ?, ?, ?, ?)").run(
    1,
    "lineage-1",
    41,
    "build-1",
    "2026-08-26T00:00:00.000Z",
  );
  continuity.close();
  createCoverageDatabase(join(dataRoot, "cognitive-v021.db"), `
    CREATE TABLE inbox_events (id TEXT, conversation_id TEXT, kind TEXT, created_at_ms INTEGER, status TEXT, state TEXT, terminal_reason TEXT, wake_id TEXT);
    CREATE TABLE cycle_records (cycle_id TEXT, conversation_id TEXT, generation INTEGER, state TEXT, admitted_at_ms INTEGER, updated_at_ms INTEGER);
    CREATE TABLE thought_steps (request_id TEXT, cycle_id TEXT, generation INTEGER, pass INTEGER, kind TEXT, payload_json TEXT, created_at_ms INTEGER);
    CREATE TABLE observations (observation_id TEXT, cycle_id TEXT, generation INTEGER, derived INTEGER, replay_safe INTEGER, modality TEXT, provenance TEXT, created_at_ms INTEGER);
    CREATE TABLE wakes (wake_id TEXT, occurrence_id TEXT, conversation_id TEXT, cycle_id TEXT, state TEXT, terminal_reason TEXT, created_at_ms INTEGER, updated_at_ms INTEGER);
    CREATE TABLE settlements (settlement_id TEXT, cycle_id TEXT, generation INTEGER, payload_json TEXT);
    CREATE TABLE speech_outbox (outbox_id INTEGER, settlement_id TEXT, projection_key TEXT, cycle_id TEXT, generation INTEGER, conversation_id TEXT, licensed_text TEXT, send_status TEXT, nuclear_reservation_id INTEGER, discord_message_ids_json TEXT, suppressed INTEGER, origin TEXT);
    CREATE TABLE system_notice_outbox (notice_id INTEGER, cycle_id TEXT, conversation_id TEXT, send_status TEXT, nuclear_reservation_id INTEGER, discord_message_id TEXT);
    CREATE TABLE conversation_evidence_log (row_id TEXT, lineage_id TEXT, version INTEGER, conversation_id TEXT, role TEXT, created_at_ms INTEGER, discord_message_ids_json TEXT, reservation_id INTEGER, producing_cycle_id TEXT, content_hash TEXT, source_status TEXT, secret_omitted INTEGER, delivered INTEGER, data_classification TEXT);
    CREATE TABLE periodic_cognition_schedule (id TEXT, authority_epoch INTEGER, next_eligible_at_ms INTEGER, updated_at_ms INTEGER);
    CREATE TABLE periodic_cognition_occurrence_receipts (schedule_occurrence_id TEXT, disposition TEXT, wake_id TEXT, authority_epoch INTEGER, eligible_at_ms INTEGER, closed_at_ms INTEGER);
    CREATE TABLE causal_ledger (id INTEGER, cycle_id TEXT, generation INTEGER, thought_unavailable INTEGER);
  `);
  createCoverageDatabase(join(dataRoot, "cognitive-v021-observability.db"), `
    CREATE TABLE allocation_receipts (request_id TEXT, cycle_id TEXT, generation INTEGER, created_at_ms INTEGER);
    CREATE TABLE thought_dispatch_diagnostics (id INTEGER, cycle_id TEXT, generation INTEGER, request_id TEXT, pass INTEGER, code TEXT, stage TEXT, dispatch_truth TEXT, created_at_ms INTEGER);
  `);
  writeJsonLines(sessionsRoot, "session-1", [
    { ts: "2026-08-26T01:10:00.000Z", role: "user", text: "export me" },
  ]);
  return {
    dataRoot,
    outRoot,
    sessionsRoot,
    checkout: git(process.cwd(), ["rev-parse", "--show-toplevel"]),
  };
}

function options(fixturePaths: ReturnType<typeof fixture>, now: string): ExportOptions {
  return {
    dataRoot: fixturePaths.dataRoot,
    outRoot: fixturePaths.outRoot,
    ashleyCheckout: fixturePaths.checkout,
    fieldDay: "2026-08-26",
    closedAsOf: "2026-08-27T02:00:00.000Z",
    now: new Date(now),
    environment: {},
  };
}

describe("deterministic observer export", () => {
  it("writes only extracted bundle files, cleans snapshots, and does not mutate source", async () => {
    const paths = fixture();
    const nuclearPath = join(paths.dataRoot, "conversations", "nuclear.db");
    const before = readFileSync(nuclearPath);
    const first = await exportFieldObservation(options(paths, "2026-08-28T00:00:00.000Z"));
    const second = await exportFieldObservation(options(paths, "2026-08-28T00:01:00.000Z"));
    expect(second.bundleId).toBe(first.bundleId);
    expect(first.files).toEqual(["manifest.json", "identity.json", "transcript.json", "evidence.json"]);
    expect(readFileSync(nuclearPath)).toEqual(before);
    expect(first.coverage).toBe("NORMAL");
    const manifest = readJson<{
      bundle_id: string;
      bundle_schema_version: number;
      source_coverage: Record<string, { disposition: string }>;
    }>(join(first.bundleDir, "manifest.json"));
    expect(manifest.bundle_id).toBe(first.bundleId);
    expect(manifest.bundle_schema_version).toBe(2);
    expect(manifest.source_coverage.cognitive_sidecar.disposition).toBe("complete_empty");
    expect(manifest.source_coverage.cognitive_observability.disposition).toBe("complete_empty");
    expect(Object.keys(first.sourceCoverage).sort()).toEqual([
      "cognitive_observability",
      "cognitive_sidecar",
      "continuity",
      "modern_transcript",
      "nuclear",
      "transcript_session",
    ]);
    const bundleText = ["manifest.json", "identity.json", "transcript.json", "evidence.json"]
      .map((file) => readFileSync(join(first.bundleDir, file), "utf8"))
      .join("\n");
    expect(bundleText).not.toMatch(/payload_json|prompt|reasoning/iu);
    expect(first.bundleDir).not.toContain(`${join(paths.dataRoot, "conversations")}`);
    expect(requireNoDatabaseFiles(paths.outRoot)).toBe(true);
  });

  it("does not publish NORMAL when lifecycle capture is partial", async () => {
    const paths = fixture();
    const sidecarPath = join(paths.dataRoot, "cognitive-v021.db");
    const sidecar = new DatabaseSync(sidecarPath);
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
    sidecar.close();

    const result = await exportFieldObservation(options(paths, "2026-08-28T00:00:00.000Z"));
    expect(result.coverage).not.toBe("NORMAL");
    const manifest = readJson<{ coverage: string }>(join(result.bundleDir, "manifest.json"));
    expect(manifest.coverage).not.toBe("NORMAL");
  });

  it("keeps a missing cognitive source unavailable and degrades the aggregate", async () => {
    const paths = fixture();
    const missingPath = join(paths.dataRoot, "cognitive-v021-observability.db");
    rmSync(missingPath);
    const result = await exportFieldObservation(options(paths, "2026-08-28T00:00:00.000Z"));
    expect(result.coverage).toBe("DEGRADED_PARTIAL");
    expect(result.sourceCoverage.cognitive_observability).toMatchObject({
      disposition: "unavailable_or_unchecked",
      record_count: "UNKNOWN",
      failure_omission_state: "source_missing",
    });
  });

  it("does not call an empty session source globally normal", async () => {
    const paths = fixture();
    rmSync(paths.sessionsRoot, { recursive: true, force: true });
    mkdirSync(paths.sessionsRoot, { recursive: true });
    const result = await exportFieldObservation(options(paths, "2026-08-28T00:00:00.000Z"));
    expect(result.coverage).toBe("DEGRADED_PARTIAL");
    expect(result.sourceCoverage.transcript_session).toMatchObject({
      disposition: "complete_empty",
      record_count: 0,
    });
  });

  it("emits degraded coverage when a session message file is unreadable", async () => {
    const paths = fixture();
    const messagesPath = join(paths.sessionsRoot, "session-1", "messages.jsonl");
    rmSync(messagesPath);
    mkdirSync(messagesPath);
    const result = await exportFieldObservation(options(paths, "2026-08-28T00:00:00.000Z"));
    expect(result.coverage).toBe("DEGRADED_PARTIAL");
    expect(result.sourceCoverage.transcript_session).toMatchObject({
      disposition: "completeness_unknown",
      record_count: "UNKNOWN",
    });
  });

  it("creates a new revision identity for changed evidence and retains the prior bundle", async () => {
    const paths = fixture();
    const first = await exportFieldObservation(options(paths, "2026-08-28T00:00:00.000Z"));
    appendFileSync(join(paths.sessionsRoot, "session-1", "messages.jsonl"), JSON.stringify({
      ts: "2026-08-26T01:11:00.000Z",
      role: "assistant",
      text: "new evidence",
    }) + "\n", "utf8");
    const second = await exportFieldObservation(options(paths, "2026-08-28T00:02:00.000Z"));
    expect(second.bundleId).not.toBe(first.bundleId);
    expect(readFileSync(join(first.bundleDir, "manifest.json"))).toBeTruthy();
    const manifest = readJson<{ revision_of?: string; previous_bundle_ids?: string[] }>(join(second.bundleDir, "manifest.json"));
    expect(manifest.revision_of).toBe(first.bundleId);
    expect(manifest.previous_bundle_ids).toContain(first.bundleId);
  });

  it("keeps volatile values out of the semantic hash and binds contract versions", () => {
    const base = {
      bundle_schema_version: 2,
      exporter_version: "observer-exporter@0.1.0",
      redaction_profile: "ashley-credential-omission-v1",
      field_day: "2026-08-26",
      timezone: "Europe/Istanbul",
      boundary: "04:00",
      identity: { checkoutSha: "a", runtimeBuildIdentity: "UNKNOWN" },
      transcript: { sessions: [] },
      evidence: { capability_events: [] },
      coverage: "DEGRADED_PARTIAL",
      surfaces: { failed: [] },
    };
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(computeBundleId(base)).toBe(computeBundleId({ ...base }));
    expect(computeBundleId({ ...base, exporter_version: "observer-exporter@0.2.0" })).not.toBe(computeBundleId(base));
    expect(computeBundleId({ ...base, redaction_profile: "other-profile" })).not.toBe(computeBundleId(base));
    expect(computeBundleId({ ...base, extracted_at: "2026-08-28T00:00:00.000Z" })).toBe(computeBundleId(base));
  });
});

function requireNoDatabaseFiles(root: string): boolean {
  const entries = readDirRecursive(root);
  return entries.every((path) => !path.endsWith(".db") && !path.endsWith("-wal") && !path.endsWith("-shm"));
}

function createCoverageDatabase(path: string, schema: string): void {
  const db = new DatabaseSync(path);
  db.exec(schema);
  db.close();
}

function readDirRecursive(root: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const output: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) output.push(...readDirRecursive(path));
    else output.push(path);
  }
  return output;
}
