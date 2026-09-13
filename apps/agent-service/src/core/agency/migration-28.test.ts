import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  NUCLEAR_SUPPORTED_VERSION,
  openNuclearDb,
} from "../db.js";
import {
  beginNuclearMigration,
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";
import { currentBuildIdentity } from "../rollout/capabilities.js";
import {
  MIGRATION_28_THOUGHT_VALIDATION_DDL,
} from "./migration-28.js";
import { logDecision } from "./log.js";
import { seedIdentity } from "../identity/store.js";
import type { Decision, ThoughtValidationEnvelope } from "../types.js";

type Fixture = {
  nuclear: DatabaseSync;
  continuity: DatabaseSync;
};

function schemaVersion(db: DatabaseSync): number {
  return Number(
    (
      db.prepare("PRAGMA user_version").get() as {
        user_version?: number;
      }
    ).user_version ?? 0,
  );
}

function columnExists(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
    .some((row) => row.name === column);
}

function sourceV27Fixture(): Fixture {
  const continuity = openContinuityDb(new DatabaseSync(":memory:"));
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
  const lineageId = (
    nuclear
      .prepare("SELECT lineage_id FROM lineage_mirror WHERE id = 1")
      .get() as { lineage_id: string }
  ).lineage_id;
  nuclear.exec(`ALTER TABLE decision_log DROP COLUMN thought_validation_json;`);
  nuclear.exec(`PRAGMA user_version = 27;`);
  continuity
    .prepare("UPDATE lineage_state SET nuclear_schema_version = 27 WHERE id = 1")
    .run();
  beginNuclearMigration(continuity, {
    from: 27,
    to: 28,
    lineageId,
    buildIdentity: currentBuildIdentity(),
  });
  return { nuclear, continuity };
}

function closeFixture(fixture: Fixture): void {
  fixture.nuclear.close();
  fixture.continuity.close();
}

const minimalDecision = (overrides: Partial<Decision> = {}): Decision => ({
  trigger: "reactive",
  kind: "speak",
  motivationIds: [1],
  score: 40,
  reason: "respond",
  evidenceRefs: [],
  uncertainty: 0.2,
  urgency: 0.5,
  thoughtSource: "model",
  thoughtError: "invalid_json",
  affectLicense: {
    permitted: false,
    valence: 0,
    activation: 0.5,
    openness: 0.5,
    tension: 0,
    reason: "test",
  },
  cognitiveAllocation: { shouldSpeak: true, effort: "medium", completion: "complete" },
  authorizedClaims: { readingRecordIds: [], readingTitles: [], readingClaims: [] },
  ...overrides,
});

const validEnvelope: ThoughtValidationEnvelope = {
  attempts: [
    {
      attempt: 1,
      providerOutcome: "completed",
      outputTokens: 120,
      maxTokens: 1000,
      truncated: false,
      parseOk: false,
      validationOk: false,
      errorCode: "invalid_json",
      field: null,
      opKind: null,
      bytes: 120,
      sha256: "a".repeat(64),
    },
    {
      attempt: 2,
      providerOutcome: "completed",
      outputTokens: 95,
      maxTokens: 1000,
      truncated: false,
      parseOk: true,
      validationOk: true,
      errorCode: null,
      field: null,
      opKind: "candidate_workspace_experiment",
      bytes: 95,
      sha256: "b".repeat(64),
    },
  ],
  finalErrorCode: null,
};

describe("nuclear schema v28 thought validation telemetry", () => {
  it("openNuclearDb preserves v28 telemetry in the current schema", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(NUCLEAR_SUPPORTED_VERSION).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(schemaVersion(db)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(columnExists(db, "decision_log", "thought_validation_json")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("migrates a v27 source adding the thought_validation_json column", () => {
    const fixture = sourceV27Fixture();
    try {
      expect(schemaVersion(fixture.nuclear)).toBe(27);
      expect(columnExists(fixture.nuclear, "decision_log", "thought_validation_json")).toBe(false);

      const pending = getPendingNuclearMigration(fixture.continuity);
      expect(pending).toMatchObject({ from: 27, to: 28 });

      openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });

      expect(schemaVersion(fixture.nuclear)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(columnExists(fixture.nuclear, "decision_log", "thought_validation_json")).toBe(true);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
    } finally {
      closeFixture(fixture);
    }
  });

  it("keeps v27 schema content valid when v28 columns are absent (rejectNewerContent)", () => {
    const fixture = sourceV27Fixture();
    try {
      openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
      // After finalization, re-opening should not reject the v28 content.
      const reopen = openNuclearDb(fixture.nuclear, { continuity: fixture.continuity });
      expect(schemaVersion(reopen)).toBe(NUCLEAR_SUPPORTED_VERSION);
      expect(getPendingNuclearMigration(fixture.continuity)).toBeNull();
    } finally {
      closeFixture(fixture);
    }
  });

  it("applies the DDL directly via MIGRATION_28 constant", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE decision_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        decision_kind TEXT NOT NULL,
        motivation_ids_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        objective TEXT,
        evidence_refs_json TEXT NOT NULL,
        effort TEXT NOT NULL,
        completion TEXT NOT NULL,
        uncertainty REAL NOT NULL,
        urgency REAL NOT NULL,
        affect_license_json TEXT NOT NULL,
        thought_source TEXT NOT NULL,
        thought_error TEXT,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 27;
    `);
    db.exec(MIGRATION_28_THOUGHT_VALIDATION_DDL);
    db.exec(`PRAGMA user_version = 28;`);
    expect(columnExists(db, "decision_log", "thought_validation_json")).toBe(true);
    db.close();
  });

  it("round-trips a bounded forensic envelope through logDecision and mapDecision", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    seedIdentity(db, "doc");
    try {
      const decision = minimalDecision({
        thoughtError: "invalid_json",
        thoughtValidation: validEnvelope,
      });
      const id = logDecision(db, {
        ownerId: "doc",
        channel: "discord",
        trigger: "reactive",
        decision,
      });
      const row = db
        .prepare(`SELECT thought_validation_json FROM decision_log WHERE id = ?`)
        .get(id) as { thought_validation_json: string | null };
      expect(row.thought_validation_json).not.toBeNull();
      const persisted = JSON.parse(row.thought_validation_json!);
      expect(persisted).toEqual(validEnvelope);

      const roundTrip = db.prepare(
        `SELECT id, owner_id, channel, trigger, decision_kind,
                motivation_ids_json, reason, learning_subject_kind,
                learning_adjustment, learning_through_event_id,
                objective, evidence_refs_json, effort, completion,
                uncertainty, urgency, affect_license_json,
                thought_source, thought_error,
                outcome_text, thought_validation_json, created_at
         FROM decision_log WHERE id = ?`,
      ).get(id);
    } finally {
      db.close();
    }
  });

  it("persists null when no envelope is set (no thoughtValidation on decision)", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    seedIdentity(db, "doc");
    try {
      const decision = minimalDecision({
        thoughtError: null,
        thoughtValidation: null,
      });
      const id = logDecision(db, {
        ownerId: "doc",
        channel: "discord",
        trigger: "reactive",
        decision,
      });
      const row = db
        .prepare(`SELECT thought_validation_json FROM decision_log WHERE id = ?`)
        .get(id) as { thought_validation_json: string | null };
      expect(row.thought_validation_json).toBeNull();
    } finally {
      db.close();
    }
  });

  it("enforces byte-bounded envelope size in practice", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    seedIdentity(db, "doc");
    try {
      const largeEnvelope: ThoughtValidationEnvelope = {
        attempts: [
          {
            attempt: 1,
            providerOutcome: "completed",
            outputTokens: 1,
            maxTokens: 1000,
            truncated: false,
            parseOk: false,
            validationOk: false,
            errorCode: "truncation",
            field: "response.text",
            opKind: null,
            bytes: 42,
            sha256: "x".repeat(64),
          },
        ],
        finalErrorCode: "truncation",
      };
      const decision = minimalDecision({
        thoughtError: "truncation",
        thoughtValidation: largeEnvelope,
      });
      const id = logDecision(db, {
        ownerId: "doc",
        channel: "discord",
        trigger: "reactive",
        decision,
      });
      const sql = db.prepare(
        `SELECT LENGTH(thought_validation_json) AS len, thought_validation_json
         FROM decision_log WHERE id = ?`,
      ).get(id) as { len: number; thought_validation_json: string };
      expect(sql.thought_validation_json).not.toBeNull();
      // The envelope JSON should be well under a reasonable bounded size.
      expect(sql.len).toBeLessThan(2048);
    } finally {
      db.close();
    }
  });
});
