import { DatabaseSync } from "node:sqlite";
import { evaluatePublicDisclosure, type EthPubProtectedCategory } from "../privacy/disclosure.js";
import { detectCredentialShape } from "../privacy/secrets.js";
import type {
  CapabilityReality,
  CycleTriggerKind,
  EffectProposal,
  EffectReceipt,
  PublicPresenceCapability,
  PublicPresenceContext,
} from "./types.js";

export const PUBLIC_PRESENCE_OPERATION = "discord.public_presence" as const;
export const PUBLIC_PRESENCE_AUDIENCE = "FULLY_PUBLIC" as const;
export const MAX_PUBLIC_PRESENCE_CHARS = 128 as const;
export const PUBLIC_PRESENCE_TTL_HOURS = 12 as const;
export const PUBLIC_PRESENCE_TTL_MS = PUBLIC_PRESENCE_TTL_HOURS * 60 * 60 * 1000;

export type PublicPresenceDecision =
  | { action: "set"; text: string }
  | { action: "clear" }
  | null;

export type PublicPresenceEffectRequest = Exclude<PublicPresenceDecision, null>;

export type PublicPresenceValidationCode =
  | "invalid_request"
  | "invalid_action"
  | "extra_field"
  | "text_required"
  | "empty"
  | "whitespace_only"
  | "too_long"
  | "control_character"
  | "credential_shape"
  | "private_material"
  | "protected_category"
  | "unknown_classification"
  | "never_public"
  | "sensitive_until_reclassified"
  | "thought_authorization_required";

export type PublicPresenceValidationResult =
  | { ok: true; decision: PublicPresenceEffectRequest }
  | { ok: false; code: PublicPresenceValidationCode };

export type PublicPresenceDisclosureFacts = Readonly<{
  classification?: "ordinary" | "sensitive" | "never_public" | "secret" | null;
  protectedCategories?: readonly EthPubProtectedCategory[];
  thoughtAuthorized?: boolean;
}>;

export type PublicPresenceOpportunityInput = Readonly<{
  cycleTriggerKind: CycleTriggerKind | string;
  wakeSourceKind: string;
  eventKind: string;
  channel: unknown;
  occupantId: unknown;
  configuredOwnerId: unknown;
  reconciling: boolean;
}>;

export type PublicPresenceProjectionOutcome = "succeeded" | "failed" | "unknown";
export type PublicPresenceProjectionState = "pending" | "projected" | "failed" | "unknown";

export type PublicPresenceState = Readonly<{
  action: "set" | "clear";
  text: string | null;
  authoredAtMs: number;
  expiresAtMs: number | null;
  sourceCycleId: string;
  sourceGeneration: number;
  sourceEffectId: string;
  stateRevision: number;
  projectionState: PublicPresenceProjectionState;
  projectionAttemptAtMs: number | null;
  projectionOutcome: PublicPresenceProjectionOutcome | null;
  projectionCause: string | null;
  projectionError: string | null;
  updatedAtMs: number;
}>;

export type PublicPresenceProjectionReceiptInput = Readonly<{
  stateRevision: number;
  sourceEffectId: string;
  outcome: PublicPresenceProjectionOutcome;
  cause: string;
  error?: string | null;
  atMs: number;
}>;

type RecordValue = Record<string, unknown>;

const STATE_ID = "ashley-public-presence-v1" as const;
const INTERNAL_MATERIAL_PATTERN = /\b(?:system\s+prompt|developer\s+message|hidden\s+reasoning|chain\s+of\s+thought|provider\s+internals?|authentication\s+material|session\s+material|private\s+owner\s+(?:information|data))\b/i;
const CREDENTIAL_ASSIGNMENT_PATTERN = /(?:api[_ -]?key|access[_ -]?token|secret[_ -]?key|password)\s*[:=]/i;
const UNSAFE_CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function publicPresenceCapability(): PublicPresenceCapability {
  return Object.freeze({
    operationKind: PUBLIC_PRESENCE_OPERATION,
    semanticClass: "effect" as const,
    audience: PUBLIC_PRESENCE_AUDIENCE,
    available: true as const,
    requiredRequestFields: Object.freeze(["action"] as ["action"]),
    optionalRequestFields: Object.freeze(["text"] as ["text"]),
  });
}

/** Add or remove the autonomous-only affordance without changing other facts. */
export function withPublicPresenceCapability(
  reality: CapabilityReality,
  enabled: boolean,
): CapabilityReality {
  const { publicPresence: _previous, ...base } = reality;
  return enabled ? { ...base, publicPresence: publicPresenceCapability() } : base;
}

/**
 * This is a lineage gate, not a semantic selector. It deliberately uses the
 * durable/source-owned identity of the opportunity and a fixed audience.
 */
export function isAutonomousPublicPresenceOpportunity(
  input: PublicPresenceOpportunityInput,
): boolean {
  return input.cycleTriggerKind === "idle_opportunity"
    && input.wakeSourceKind === "idle"
    && input.eventKind === "idle_opportunity"
    && input.channel === "discord"
    && nonEmptyString(input.configuredOwnerId)
    && input.occupantId === input.configuredOwnerId
    && !input.reconciling;
}

function disclosureCode(reason: string): PublicPresenceValidationCode {
  switch (reason) {
    case "protected_category": return "protected_category";
    case "unknown_classification": return "unknown_classification";
    case "never_public": return "never_public";
    case "sensitive_until_reclassified": return "sensitive_until_reclassified";
    case "thought_authorization_required": return "thought_authorization_required";
    case "secret": return "credential_shape";
    default: return "private_material";
  }
}

/** Validate an exact Thought-authored request. This adapter never rewrites text. */
export function validatePublicPresenceRequest(
  request: unknown,
  facts: PublicPresenceDisclosureFacts = {},
): PublicPresenceValidationResult {
  if (!isRecord(request)) return { ok: false, code: "invalid_request" };
  const action = request.action;
  if (action === "clear") {
    if (Object.keys(request).some((key) => key !== "action")) {
      return { ok: false, code: "extra_field" };
    }
    return { ok: true, decision: { action: "clear" } };
  }
  if (action !== "set") return { ok: false, code: "invalid_action" };
  if (Object.keys(request).some((key) => key !== "action" && key !== "text")) {
    return { ok: false, code: "extra_field" };
  }
  if (typeof request.text !== "string") return { ok: false, code: "text_required" };
  const text = request.text;
  if (text.length === 0) return { ok: false, code: "empty" };
  if (text.trim().length === 0) return { ok: false, code: "whitespace_only" };
  if ([...text].length > MAX_PUBLIC_PRESENCE_CHARS) return { ok: false, code: "too_long" };
  if (UNSAFE_CONTROL_PATTERN.test(text)) return { ok: false, code: "control_character" };
  if (detectCredentialShape(text).hit || CREDENTIAL_ASSIGNMENT_PATTERN.test(text)) {
    return { ok: false, code: "credential_shape" };
  }
  if (INTERNAL_MATERIAL_PATTERN.test(text)) return { ok: false, code: "private_material" };

  const disclosure = evaluatePublicDisclosure({
    classification: facts.classification === undefined ? "ordinary" : facts.classification,
    protectedCategories: [...(facts.protectedCategories ?? [])],
    conditionallyPublicAshleyMaterial: true,
    thoughtAuthorized: facts.thoughtAuthorized ?? true,
  });
  if (!disclosure.allowed) return { ok: false, code: disclosureCode(disclosure.reason) };
  return { ok: true, decision: { action: "set", text } };
}

function textValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value);
}

function nullableString(value: unknown): string | null {
  return value == null ? null : textValue(value);
}

function mapState(row: RecordValue | undefined): PublicPresenceState | null {
  if (!row) return null;
  return {
    action: row.action === "clear" ? "clear" : "set",
    text: textValue(row.text),
    authoredAtMs: numberValue(row.authored_at_ms),
    expiresAtMs: nullableNumber(row.expires_at_ms),
    sourceCycleId: textValue(row.source_cycle_id) ?? "",
    sourceGeneration: numberValue(row.source_generation),
    sourceEffectId: textValue(row.source_effect_id) ?? "",
    stateRevision: numberValue(row.state_revision),
    projectionState: row.projection_state as PublicPresenceProjectionState,
    projectionAttemptAtMs: nullableNumber(row.projection_attempt_at_ms),
    projectionOutcome: row.projection_outcome == null
      ? null
      : row.projection_outcome as PublicPresenceProjectionOutcome,
    projectionCause: nullableString(row.projection_cause),
    projectionError: nullableString(row.projection_error),
    updatedAtMs: numberValue(row.updated_at_ms),
  };
}

export function readPublicPresenceState(db: DatabaseSync): PublicPresenceState | null {
  return mapState(db.prepare(
    "SELECT * FROM public_presence_state WHERE id = ? LIMIT 1",
  ).get(STATE_ID) as RecordValue | undefined);
}

export function readPublicPresenceContext(
  db: DatabaseSync,
  nowMs = Date.now(),
): PublicPresenceContext {
  const state = readPublicPresenceState(db);
  const active = state?.action === "set"
    && typeof state.text === "string"
    && state.text.length > 0
    && state.expiresAtMs !== null
    && state.expiresAtMs > nowMs;
  return {
    audience: PUBLIC_PRESENCE_AUDIENCE,
    text: active ? state.text : null,
    authoredAtMs: state?.authoredAtMs ?? null,
    expiresAtMs: state?.expiresAtMs ?? null,
  };
}

function stateRow(db: DatabaseSync): RecordValue | undefined {
  return db.prepare(
    "SELECT * FROM public_presence_state WHERE id = ? LIMIT 1",
  ).get(STATE_ID) as RecordValue | undefined;
}

function assertId(value: string, name: string): void {
  if (!nonEmptyString(value)) throw new Error(`${name}_required`);
}

export function applyPublicPresenceDecision(input: {
  db: DatabaseSync;
  decision: PublicPresenceEffectRequest;
  cycleId: string;
  generation: number;
  effectId: string;
  authoredAtMs: number;
}): PublicPresenceState {
  assertId(input.cycleId, "cycle_id");
  assertId(input.effectId, "effect_id");
  if (!Number.isSafeInteger(input.generation) || !Number.isSafeInteger(input.authoredAtMs)) {
    throw new Error("public_presence_timestamp_invalid");
  }
  const validation = validatePublicPresenceRequest(input.decision);
  if (!validation.ok) throw new Error(`public_presence_${validation.code}`);
  const decision = validation.decision;

  input.db.exec("BEGIN IMMEDIATE");
  try {
    const previous = mapState(stateRow(input.db));
    const stateRevision = (previous?.stateRevision ?? 0) + 1;
    const isSet = decision.action === "set";
    input.db.prepare(`
      INSERT INTO public_presence_state (
        id, action, text, authored_at_ms, expires_at_ms,
        source_cycle_id, source_generation, source_effect_id, state_revision,
        projection_state, projection_attempt_at_ms, projection_outcome,
        projection_cause, projection_error, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET
        action = excluded.action,
        text = excluded.text,
        authored_at_ms = excluded.authored_at_ms,
        expires_at_ms = excluded.expires_at_ms,
        source_cycle_id = excluded.source_cycle_id,
        source_generation = excluded.source_generation,
        source_effect_id = excluded.source_effect_id,
        state_revision = excluded.state_revision,
        projection_state = excluded.projection_state,
        projection_attempt_at_ms = excluded.projection_attempt_at_ms,
        projection_outcome = excluded.projection_outcome,
        projection_cause = excluded.projection_cause,
        projection_error = excluded.projection_error,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      STATE_ID,
      decision.action,
      isSet ? decision.text : null,
      input.authoredAtMs,
      isSet ? input.authoredAtMs + PUBLIC_PRESENCE_TTL_MS : null,
      input.cycleId,
      input.generation,
      input.effectId,
      stateRevision,
      input.authoredAtMs,
    );
    input.db.prepare(`
      INSERT INTO causal_ledger (cycle_id, generation, payload_json, thought_unavailable)
      VALUES (?, ?, ?, 0)
    `).run(
      input.cycleId,
      input.generation,
      JSON.stringify({
        kind: "public_presence_decision",
        action: decision.action,
        audience: PUBLIC_PRESENCE_AUDIENCE,
        ...(isSet ? { text: decision.text } : {}),
        authoredAtMs: input.authoredAtMs,
        expiresAtMs: isSet ? input.authoredAtMs + PUBLIC_PRESENCE_TTL_MS : null,
        sourceEffectId: input.effectId,
        stateRevision,
      }),
    );
    input.db.exec("COMMIT");
  } catch (error) {
    try { input.db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  }
  const state = readPublicPresenceState(input.db);
  if (!state) throw new Error("public_presence_state_missing_after_write");
  return state;
}

function projectionStateFor(
  outcome: PublicPresenceProjectionOutcome,
): PublicPresenceProjectionState {
  if (outcome === "succeeded") return "projected";
  return outcome;
}

export function recordPublicPresenceProjection(
  db: DatabaseSync,
  input: PublicPresenceProjectionReceiptInput,
): { accepted: boolean; state: PublicPresenceState | null } {
  if (
    !Number.isSafeInteger(input.stateRevision)
    || !nonEmptyString(input.sourceEffectId)
    || (input.outcome !== "succeeded" && input.outcome !== "failed" && input.outcome !== "unknown")
    || !nonEmptyString(input.cause)
    || (input.error !== undefined && input.error !== null && typeof input.error !== "string")
    || !Number.isSafeInteger(input.atMs)
  ) {
    return { accepted: false, state: readPublicPresenceState(db) };
  }
  const cause = input.cause.slice(0, 64);
  const error = input.error == null ? null : input.error.slice(0, 256);
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = mapState(stateRow(db));
    if (
      !current
      || current.stateRevision !== input.stateRevision
      || current.sourceEffectId !== input.sourceEffectId
    ) {
      db.exec("ROLLBACK");
      return { accepted: false, state: current };
    }
    db.prepare(`
      UPDATE public_presence_state
      SET projection_state = ?,
          projection_attempt_at_ms = ?,
          projection_outcome = ?,
          projection_cause = ?,
          projection_error = ?,
          updated_at_ms = ?
      WHERE id = ? AND state_revision = ? AND source_effect_id = ?
    `).run(
      projectionStateFor(input.outcome),
      input.atMs,
      input.outcome,
      cause,
      error,
      input.atMs,
      STATE_ID,
      input.stateRevision,
      input.sourceEffectId,
    );
    db.prepare(`
      INSERT INTO causal_ledger (cycle_id, generation, payload_json, thought_unavailable)
      VALUES (?, ?, ?, 0)
    `).run(
      current.sourceCycleId,
      current.sourceGeneration,
      JSON.stringify({
        kind: "public_presence_projection",
        audience: PUBLIC_PRESENCE_AUDIENCE,
        stateRevision: input.stateRevision,
        sourceEffectId: input.sourceEffectId,
        outcome: input.outcome,
        cause,
        atMs: input.atMs,
        ...(error ? { error } : {}),
      }),
    );
    db.exec("COMMIT");
    return { accepted: true, state: readPublicPresenceState(db) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  }
}

function eventPayload(value: unknown): RecordValue {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Independent executor defense against forged or interactive proposals. */
export function isAutonomousPublicPresenceProposal(
  db: DatabaseSync,
  proposal: Pick<EffectProposal, "cycleId" | "originEventId">,
  configuredOwnerId: string,
): boolean {
  const originEventId = proposal.originEventId;
  if (!nonEmptyString(configuredOwnerId) || !nonEmptyString(originEventId)) return false;
  const cycle = db.prepare(`
    SELECT trigger_kind, occupant_id, wake_id, state
    FROM cycle_records WHERE cycle_id = ? LIMIT 1
  `).get(proposal.cycleId) as RecordValue | undefined;
  if (!cycle) return false;
  const wakeId = textValue(cycle.wake_id);
  if (!wakeId) return false;
  const wake = db.prepare(`
    SELECT source_kind, state FROM wakes WHERE wake_id = ? LIMIT 1
  `).get(wakeId) as RecordValue | undefined;
  const event = db.prepare(`
    SELECT kind, payload_json FROM inbox_events WHERE id = ? LIMIT 1
  `).get(originEventId) as RecordValue | undefined;
  if (!wake || !event) return false;
  const payload = eventPayload(event.payload_json);
  return isAutonomousPublicPresenceOpportunity({
    cycleTriggerKind: textValue(cycle.trigger_kind) ?? "",
    wakeSourceKind: textValue(wake.source_kind) ?? "",
    eventKind: textValue(event.kind) ?? "",
    channel: payload.channel,
    occupantId: cycle.occupant_id,
    configuredOwnerId,
    reconciling: wake.state === "reconciling" || event.kind === "reconciling",
  }) && payload.ownerId === configuredOwnerId;
}

export function publicPresenceReceipt(
  proposal: EffectProposal,
  input: {
    outcome: EffectReceipt["outcome"];
    claims: Record<string, unknown>;
    atMs: number;
  },
): EffectReceipt {
  return {
    receiptId: `v021:public-presence:${proposal.effectId}`,
    effectId: proposal.effectId,
    idempotencyKey: proposal.idempotencyKey,
    outcome: input.outcome,
    claims: input.claims,
    atMs: input.atMs,
    dataClassification: "ordinary",
    secretOmitted: false,
  };
}
