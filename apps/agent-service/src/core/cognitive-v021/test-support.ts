import { DatabaseSync } from "node:sqlite";
import { openCognitiveSidecarDb } from "./sidecar/db.js";
import { admitCycle, type AdmitCycleInput } from "./cycle/inbox.js";
import { admitWake } from "./wake/ledger.js";
import { occurrenceIdFor } from "./wake/identity.js";
import { SETTLEMENT_SCHEMA_VERSION } from "./types.js";
import type { ThoughtSemanticOutput, ThoughtSettlementDraft, CycleRecord } from "./types.js";

export function openTestSidecar(): DatabaseSync {
  return openCognitiveSidecarDb(new DatabaseSync(":memory:"), {
    dataPlane: { kind: "isolated" },
  });
}

/** Rewind an in-memory current sidecar to a structurally valid historical fixture version. */
export function setTestSidecarVersion(db: DatabaseSync, version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) throw new Error("test_sidecar_version_invalid");
  if (version < 58) db.exec("DROP TABLE IF EXISTS self_change_ladder_history; DROP TABLE IF EXISTS self_change_ladder");
  if (version < 57) db.exec("DROP TABLE IF EXISTS self_change_result_receipts");
  if (version < 56) db.exec("DROP TABLE IF EXISTS attention_watches; DROP TABLE IF EXISTS thalamus_decisions; DROP TABLE IF EXISTS thalamus_state");
  if (version < 54) db.exec("DROP TABLE IF EXISTS night_gate_receipts");
  if (version < 53) {
    db.exec("DROP TABLE IF EXISTS private_budget_policies");
    const cols=new Set(db.prepare("PRAGMA table_info(private_budget_reservations)").all().map(row=>row.name));
    if(cols.has("policy_fingerprint"))db.exec("ALTER TABLE private_budget_reservations DROP COLUMN policy_fingerprint");
  }
  if (version < 52) {
    db.exec("DROP TRIGGER IF EXISTS learned_influence_delete_children; DROP TABLE IF EXISTS learned_influence_branch_evidence; DROP INDEX IF EXISTS idx_learned_influences_branch; DROP INDEX IF EXISTS idx_learned_choice_receipts_cycle;");
    for (const [table, names] of [
      ["learned_influences", ["branch_key", "proposed_cycle_id", "admitting_cycle_id", "position_rationale"]],
      ["learned_choice_receipts", ["cycle_id", "counterfactual_ids_json"]],
      ["influence_contract_state", ["mode_set_by", "mode_set_at_ms"]],
    ] as const) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
      for (const name of names) if (columns.has(name)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    }
  }
  if (version < 51) {
    for (const table of ["learned_choice_receipts", "learned_influence_evidence", "learned_influences", "interest_touches", "influence_contract_state"]) db.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  if (version < 50) {
    for (const table of ["graduation_recorder_keys", "graduation_calibration", "graduation_adjudications", "graduation_observations", "graduation_contract_state"]) db.exec(`DROP TABLE IF EXISTS ${table}`);
    const columns = new Set(db.prepare("PRAGMA table_info(expectations)").all().map(row => row.name));
    for (const column of ["judgment_class", "observable", "horizon_hours", "check_kind", "graduation_lifecycle"]) {
      if (columns.has(column)) db.exec(`ALTER TABLE expectations DROP COLUMN ${column}`);
    }
  }
  if (version < 35) {
    db.exec("DROP TABLE IF EXISTS owner_discord_transport_captures");
    db.exec("DROP TABLE IF EXISTS owner_discord_transport_cursors");
  }
  if (version < 34) {
    const columns = new Set((db.prepare("PRAGMA table_info(future_triggers)").all() as Array<{ name?: unknown }>)
      .map((row) => typeof row.name === "string" ? row.name : ""));
    for (const column of ["timing_policy", "evidence_refs_json"]) {
      if (columns.has(column)) db.exec(`ALTER TABLE future_triggers DROP COLUMN ${column}`);
    }
  }
  if (version < 33) {
    const columns = new Set((db.prepare("PRAGMA table_info(concerns)").all() as Array<{ name?: unknown }>)
      .map((row) => typeof row.name === "string" ? row.name : ""));
    if (columns.has("objective_json")) db.exec("ALTER TABLE concerns DROP COLUMN objective_json");
  }
  if (version < 32) {
    db.exec("DROP INDEX IF EXISTS idx_observations_representation");
    db.exec("DROP INDEX IF EXISTS idx_observations_parent_artifact");
    for (const column of ["view_metadata_json", "representation_id", "parent_artifact_id"]) {
      const columns = new Set((db.prepare("PRAGMA table_info(observations)").all() as Array<{ name?: unknown }>)
        .map((row) => typeof row.name === "string" ? row.name : ""));
      if (columns.has(column)) db.exec(`ALTER TABLE observations DROP COLUMN ${column}`);
    }
  }
  if (version < 31) {
    for (const [table, column] of [
      ["sidecar_memory_supports", "support_ref_json"],
      ["concerns", "support_refs_json"],
      ["desk_entries", "support_refs_json"],
    ] as const) {
      const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>)
        .map((row) => typeof row.name === "string" ? row.name : ""));
      if (columns.has(column)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  }
  if (version < 28) db.exec("DROP TABLE IF EXISTS effect_diagnostics");
  if (version < 26) {
    const columns = new Set((db.prepare("PRAGMA table_info(working_context_items)").all() as Array<{ name?: unknown }>)
      .map((row) => typeof row.name === "string" ? row.name : ""));
    for (const column of ["legacy_scope", "audience_state", "applicability_lifecycle"]) {
      if (columns.has(column)) db.exec(`ALTER TABLE working_context_items DROP COLUMN ${column}`);
    }
  }
  db.exec(`PRAGMA user_version = ${version}`);
  db.prepare("UPDATE cognitive_sidecar_meta SET schema_version = ? WHERE id = 1").run(version);
}

export function makeThoughtDraft(
  overrides: Partial<ThoughtSettlementDraft> = {},
): ThoughtSettlementDraft {
  return {
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    cycleId: "cycle-1",
    generation: 1,
    authorityEpoch: 1,
    occupantId: "doc",
    architectureEpoch: "v0.2.1",
    triggerRef: "owner-1",
    interpretation: {
      discourseActs: ["inform"],
      referentBindings: [],
      corrections: [],
      unresolvedAmbiguities: [],
      topics: ["topic"],
    },
    commitments: {
      epistemic: [{
        dimensions: {
          source: "owner_utterance",
          status: "asserted",
          time: "historical",
          reliability: "owner_supplied",
        },
        statement: "topic",
      }],
      operational: [],
      conversational: ["answer"],
      stance: {
        warmth: "medium",
        humorAllowed: false,
        disagreement: false,
        uncertaintyDisplay: true,
      },
    },
    speech: {
      mode: "draft",
      mustSay: ["hello"],
      mustNot: [],
      surfaceDraft: "hello",
      acceptableRealizations: ["hello"],
      presentationDirectives: [],
    },
    workingContextDelta: [],
    concernDeltas: [],
    occupancyDelta: [],
    futureTriggers: [],
    subscriptions: [],
    durableNominations: [],
    operations: {
      observationsConsumed: [],
      effectsCompleted: [],
      intentsStillInFlight: [],
    },
    authority: { objectionsApplied: [], revisionCount: 0 },
    ...overrides,
  };
}

/** Test fixture producer: every fixture cycle is admitted through the W5 wake owner. */
export function admitTestCycle(
  db: DatabaseSync,
  input: Omit<AdmitCycleInput, "wakeId">,
): CycleRecord {
  const triggerRef = input.triggerRef ?? input.cycleId ?? `${input.triggerKind}:test`;
  const admission = admitWake(db, {
    occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef: `test:${triggerRef}`, conversationId: input.conversationId }),
    triggerRef,
    sourceKind: "inbox",
    conversationId: input.conversationId,
    cycleId: input.cycleId,
    generation: input.generation,
    triggerKind: input.triggerKind,
    occupantId: input.occupantId,
    authorityEpoch: input.authorityEpoch,
    architectureEpoch: input.architectureEpoch,
    preemptedGeneration: input.preemptedGeneration,
    capturedAuthorityRevision: 0,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (admission.kind === "cancelled" || admission.kind === "stale") throw new Error("test_wake_terminal");
  db.prepare(`
    INSERT OR IGNORE INTO inbox_events
      (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
    VALUES (?, ?, ?, '{}', ?, 'claimed', ?)
  `).run(
    triggerRef,
    input.conversationId,
    input.triggerKind,
    input.nowMs ?? Date.now(),
    admission.wake.wakeId,
  );
  return admitCycle(db, { ...input, wakeId: admission.wake.wakeId });
}

export function makeSemanticSettlement(
  overrides: Record<string, unknown> = {},
): Extract<ThoughtSemanticOutput, { kind: "settlement" }> & { commitments: NonNullable<Extract<ThoughtSemanticOutput, { kind: "settlement" }>["commitments"]> } {
  const base = {
    kind: "settlement",
    interpretation: { discourseActs: ["inform"], topics: ["topic"] },
    commitments: {
      epistemic: [{ dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" }, statement: "topic" }],
      conversational: ["answer"], stance: { warmth: "medium", humorAllowed: false, disagreement: false, uncertaintyDisplay: true },
    },
    speech: { mode: "draft", mustSay: ["hello"], surfaceDraft: "hello" },
  };
  const merged = { ...base, ...overrides } as Record<string, unknown>;
  const optionalArrays = [
    "workingContextDeltas", "concernDeltas", "occupancyDeltas", "futureTriggerDeltas",
    "subscriptionDeltas", "durableNominations",
  ];
  for (const key of optionalArrays) if (Array.isArray(merged[key]) && merged[key].length === 0) delete merged[key];
  for (const key of ["interpretation", "commitments", "evidenceUse"]) {
    const child = merged[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const normalized = { ...(child as Record<string, unknown>) };
    for (const childKey of Object.keys(normalized)) {
      if (Array.isArray(normalized[childKey]) && normalized[childKey].length === 0) delete normalized[childKey];
    }
    if (Object.keys(normalized).length === 0) delete merged[key];
    else merged[key] = normalized;
  }
  const speech = merged.speech;
  if (speech && typeof speech === "object" && !Array.isArray(speech)) {
    const normalized = { ...(speech as Record<string, unknown>) };
    delete normalized.acceptableRealizations;
    for (const key of ["mustSay", "mustNotSay", "presentationDirectives"]) {
      if (Array.isArray(normalized[key]) && normalized[key].length === 0) delete normalized[key];
    }
    merged.speech = normalized;
  }
  return merged as Extract<ThoughtSemanticOutput, { kind: "settlement" }> & { commitments: NonNullable<Extract<ThoughtSemanticOutput, { kind: "settlement" }>["commitments"]> };
}
