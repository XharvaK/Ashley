import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DataClassification } from "../types.js";
import type { SocialAudience } from "../social/types.js";
import { detectCredentialShape } from "../../privacy/secrets.js";

const MAX_EFFECT_DIAGNOSTIC_CHARS = 262_144;

export type EffectSupervisionDiagnosticSummary = Readonly<{
  initialDeadlineAtMs: number;
  renewalCount: number;
  firstSuccessfulRenewalAtMs: number | null;
  lastSuccessfulRenewalAtMs: number | null;
  maxObservedGapMs: number;
  fenceOrAbortReason: string | null;
}>;

export type EffectDiagnosticRow = Readonly<{
  diagnosticId: string;
  effectId: string;
  conversationId: string;
  cycleId: string;
  generation: number;
  audienceScope: SocialAudience | null;
  dataClassification: DataClassification;
  secretOmitted: boolean;
  diagnostic: Record<string, unknown>;
  atMs: number;
}>;

export type RecordEffectDiagnosticInput = Readonly<{
  diagnosticId?: string;
  effectId: string;
  conversationId: string;
  cycleId: string;
  generation: number;
  audienceScope: SocialAudience | null;
  dataClassification: DataClassification;
  secretOmitted: boolean;
  diagnostic: Record<string, unknown>;
  atMs: number;
}>;

type DbRow = Record<string, unknown>;

function safeSupervisionReason(value: string | null): string | null {
  if (value === null) return null;
  if (!/^[a-z0-9_.-]{1,120}$/i.test(value) || detectCredentialShape(value).hit) return "reason_omitted";
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalAudience(value: unknown): SocialAudience | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "owner_private":
      return { kind: "owner_private" };
    case "owner_dm":
      return typeof value.threadId === "string" && value.threadId.trim()
        ? { kind: "owner_dm", threadId: value.threadId }
        : null;
    case "dm":
      return typeof value.principalId === "string" && value.principalId.trim()
        ? { kind: "dm", principalId: value.principalId }
        : null;
    case "room":
      return typeof value.roomId === "string" && value.roomId.trim()
        ? { kind: "room", roomId: value.roomId }
        : null;
    default:
      return null;
  }
}

function audienceJson(value: unknown): string | null {
  const audience = canonicalAudience(value);
  if (!audience) return null;
  switch (audience.kind) {
    case "owner_private":
      return JSON.stringify({ kind: "owner_private" });
    case "owner_dm":
      return JSON.stringify({ kind: "owner_dm", threadId: audience.threadId });
    case "dm":
      return JSON.stringify({ kind: "dm", principalId: audience.principalId });
    case "room":
      return JSON.stringify({ kind: "room", roomId: audience.roomId });
  }
}

function parseDiagnostic(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mapRow(value: unknown): EffectDiagnosticRow | null {
  if (!isRecord(value)) return null;
  const diagnostic = parseDiagnostic(value.diagnostic_json);
  if (!diagnostic) return null;
  let scope: SocialAudience | null = null;
  try {
    scope = canonicalAudience(JSON.parse(stringValue(value.audience_scope_json)));
  } catch {
    scope = null;
  }
  const classification = stringValue(value.data_classification);
  if (!["ordinary", "sensitive", "never_public", "secret"].includes(classification)) return null;
  return {
    diagnosticId: stringValue(value.diagnostic_id),
    effectId: stringValue(value.effect_id),
    conversationId: stringValue(value.conversation_id),
    cycleId: stringValue(value.cycle_id),
    generation: numberValue(value.generation),
    audienceScope: scope,
    dataClassification: classification as DataClassification,
    secretOmitted: numberValue(value.secret_omitted) === 1,
    diagnostic,
    atMs: numberValue(value.at_ms),
  };
}

export function recordEffectDiagnostic(
  db: DatabaseSync,
  input: RecordEffectDiagnosticInput,
): EffectDiagnosticRow {
  if (!input.effectId.trim() || !input.conversationId.trim() || !input.cycleId.trim()) {
    throw new Error("effect_diagnostic_binding_required");
  }
  if (!Number.isSafeInteger(input.generation) || input.generation < 0 || !Number.isSafeInteger(input.atMs) || input.atMs < 0) {
    throw new Error("effect_diagnostic_time_or_generation_invalid");
  }
  const existing = db.prepare("SELECT * FROM effect_diagnostics WHERE effect_id = ? LIMIT 1").get(input.effectId);
  if (existing) {
    const mapped = mapRow(existing);
    if (mapped
      && mapped.conversationId === input.conversationId
      && mapped.cycleId === input.cycleId
      && mapped.generation === input.generation
      && audienceJson(mapped.audienceScope) === audienceJson(input.audienceScope)
      && mapped.dataClassification === input.dataClassification
      && mapped.secretOmitted === input.secretOmitted) return mapped;
    if (mapped) throw new Error("effect_diagnostic_binding_conflict");
    throw new Error("effect_diagnostic_existing_row_invalid");
  }
  const diagnosticJson = JSON.stringify(input.diagnostic);
  if (diagnosticJson.length > MAX_EFFECT_DIAGNOSTIC_CHARS) {
    throw new Error("effect_diagnostic_too_large");
  }
  const diagnosticId = input.diagnosticId?.trim() || `v021:effect-diagnostic:${randomUUID()}`;
  db.prepare(
    `INSERT INTO effect_diagnostics
       (diagnostic_id, effect_id, conversation_id, cycle_id, generation, audience_scope_json,
        data_classification, secret_omitted, diagnostic_json, at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    diagnosticId,
    input.effectId,
    input.conversationId,
    input.cycleId,
    input.generation,
    audienceJson(input.audienceScope),
    input.dataClassification,
    input.secretOmitted ? 1 : 0,
    diagnosticJson,
    input.atMs,
  );
  const row = db.prepare("SELECT * FROM effect_diagnostics WHERE effect_id = ? LIMIT 1").get(input.effectId);
  const mapped = mapRow(row);
  if (!mapped) throw new Error("effect_diagnostic_persist_failed");
  return mapped;
}

/** Resolve only within the owning conversation and exact captured audience. */
export function resolveEffectDiagnosticRef(
  db: DatabaseSync,
  diagnosticId: string,
  conversationId: string,
  audienceScope: SocialAudience | null,
): EffectDiagnosticRow | null {
  const scope = audienceJson(audienceScope);
  if (!diagnosticId.trim() || !conversationId.trim() || !scope) return null;
  return mapRow(db.prepare(
    `SELECT diagnostic.*
       FROM effect_diagnostics AS diagnostic
       JOIN cycle_records AS cycle ON cycle.cycle_id = diagnostic.cycle_id
      WHERE diagnostic.diagnostic_id = ?
        AND diagnostic.conversation_id = ?
        AND cycle.conversation_id = ?
        AND diagnostic.audience_scope_json = ?
        AND diagnostic.data_classification <> 'secret'
      LIMIT 1`,
  ).get(diagnosticId, conversationId, conversationId, scope));
}

export function updateEffectDiagnosticSupervision(
  db: DatabaseSync,
  effectId: string,
  summary: EffectSupervisionDiagnosticSummary,
): boolean {
  if (!effectId.trim()
    || !Number.isSafeInteger(summary.initialDeadlineAtMs)
    || summary.initialDeadlineAtMs < 0
    || !Number.isSafeInteger(summary.renewalCount)
    || summary.renewalCount < 0
    || !Number.isSafeInteger(summary.maxObservedGapMs)
    || summary.maxObservedGapMs < 0
    || (summary.firstSuccessfulRenewalAtMs !== null
      && (!Number.isSafeInteger(summary.firstSuccessfulRenewalAtMs) || summary.firstSuccessfulRenewalAtMs < 0))
    || (summary.lastSuccessfulRenewalAtMs !== null
      && (!Number.isSafeInteger(summary.lastSuccessfulRenewalAtMs) || summary.lastSuccessfulRenewalAtMs < 0))) return false;
  const row = db.prepare("SELECT diagnostic_json FROM effect_diagnostics WHERE effect_id = ? LIMIT 1").get(effectId) as DbRow | undefined;
  const diagnostic = parseDiagnostic(row?.diagnostic_json);
  if (!diagnostic || diagnostic.redacted === true) return false;
  diagnostic.supervision = {
    initialDeadlineAtMs: summary.initialDeadlineAtMs,
    renewalCount: summary.renewalCount,
    firstSuccessfulRenewalAtMs: summary.firstSuccessfulRenewalAtMs,
    lastSuccessfulRenewalAtMs: summary.lastSuccessfulRenewalAtMs,
    maxObservedGapMs: summary.maxObservedGapMs,
    fenceOrAbortReason: safeSupervisionReason(summary.fenceOrAbortReason),
  };
  const serialized = JSON.stringify(diagnostic);
  if (serialized.length > MAX_EFFECT_DIAGNOSTIC_CHARS) return false;
  return Number(db.prepare("UPDATE effect_diagnostics SET diagnostic_json = ? WHERE effect_id = ?")
    .run(serialized, effectId).changes) === 1;
}

/** Merge a final worker diagnostic while preserving acceptance-time continuation evidence. */
export function mergeEffectDiagnostic(
  db: DatabaseSync,
  effectId: string,
  update: Record<string, unknown>,
): boolean {
  if (!effectId.trim()) return false;
  const row = db.prepare("SELECT diagnostic_json FROM effect_diagnostics WHERE effect_id = ? LIMIT 1")
    .get(effectId) as DbRow | undefined;
  const current = parseDiagnostic(row?.diagnostic_json);
  if (!current || current.redacted === true) return false;
  const merged = {
    ...current,
    ...update,
    ...(current.continuation === undefined ? {} : { continuation: current.continuation }),
  };
  const serialized = JSON.stringify(merged);
  if (serialized.length > MAX_EFFECT_DIAGNOSTIC_CHARS) return false;
  return Number(db.prepare("UPDATE effect_diagnostics SET diagnostic_json = ? WHERE effect_id = ?")
    .run(serialized, effectId).changes) === 1;
}

export function updateEffectDiagnosticContinuation(
  db: DatabaseSync,
  effectId: string,
  continuation: { state: string; terminalClass: string; effectTruth: string },
): boolean {
  if (!effectId.trim()
    || !/^[a-z0-9_.-]{1,80}$/i.test(continuation.state)
    || !/^[a-z0-9_.-]{1,80}$/i.test(continuation.terminalClass)
    || !/^[a-z0-9_.-]{1,80}$/i.test(continuation.effectTruth)) return false;
  const row = db.prepare("SELECT diagnostic_json FROM effect_diagnostics WHERE effect_id = ? LIMIT 1")
    .get(effectId) as DbRow | undefined;
  const diagnostic = parseDiagnostic(row?.diagnostic_json);
  if (!diagnostic || diagnostic.redacted === true || !isRecord(diagnostic.continuation)) return false;
  diagnostic.continuation = {
    ...diagnostic.continuation,
    state: continuation.state,
    terminalClass: continuation.terminalClass,
    effectTruth: continuation.effectTruth,
  };
  const serialized = JSON.stringify(diagnostic);
  if (serialized.length > MAX_EFFECT_DIAGNOSTIC_CHARS) return false;
  return Number(db.prepare("UPDATE effect_diagnostics SET diagnostic_json = ? WHERE effect_id = ?")
    .run(serialized, effectId).changes) === 1;
}
