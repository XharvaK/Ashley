import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  THOUGHT_UNAVAILABLE_NOTICE,
  type DeliveryIntent,
  type Generation,
  type OutboxOrigin,
  type OutboxSendStatus,
  type SystemNoticeOutbox,
} from "../types.js";

export { THOUGHT_UNAVAILABLE_NOTICE };

export const USER_FACING_THOUGHT_FAILURE_CODES = [
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_AUTHENTICATION_FAILED",
  "PROVIDER_REQUEST_INVALID",
  "PROVIDER_TRANSPORT_FAILURE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_INTERNAL",
  "THOUGHT_DEADLINE_EXCEEDED",
  "STRUCTURED_OUTPUT_INVALID",
  "STRUCTURAL_RETRY_EXHAUSTED",
  "LOCAL_DISPATCH_FAILURE",
  "CANCELLED",
  "SPEECH_FIDELITY_REJECTED",
  "AUTHORITY_REJECTED",
  "THOUGHT_BUDGET_EXHAUSTED",
  "OPERATION_DISPATCH_FAILED",
  "PUBLICATION_PERSISTENCE_FAILED",
  "UNKNOWN",
] as const;

export type UserFacingThoughtFailureCode = typeof USER_FACING_THOUGHT_FAILURE_CODES[number];

/**
 * FAILURE-TRUTH-COMPLETENESS-01: typed terminal families.
 *
 * Mechanical infrastructure classification only. Thought remains the sole
 * semantic author. Each supported reachable notice-emitting family maps to
 * exactly one Owner-facing presentation code. Provider dispatch/outcome
 * truth and publication/delivery truth remain independent dimensions and
 * are never derived from (or into) the local terminal cause.
 */
export const THOUGHT_TERMINAL_FAMILIES = [
  "thought_deadline",
  "provider",
  "allocation",
  "structural_exhausted",
  "structural_invalid",
  "authority",
  "budget_exhausted",
  "operation_dispatch",
  "fidelity",
  "publication_persistence",
  "cancelled",
  "foreign",
] as const;

export type ThoughtTerminalFamily = typeof THOUGHT_TERMINAL_FAMILIES[number];

export const MAX_TERMINAL_CODES = 8 as const;
const MAX_TERMINAL_CODE_LENGTH = 128 as const;
const MAX_TERMINAL_STAGE_LENGTH = 64 as const;

function sanitizeTerminalCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TERMINAL_CODE_LENGTH);
}

function sanitizeTerminalCodes(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const code = sanitizeTerminalCode(value);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= MAX_TERMINAL_CODES) break;
  }
  return out;
}

function sanitizeTerminalStage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_TERMINAL_STAGE_LENGTH);
  return trimmed ? trimmed : undefined;
}

export type ThoughtTerminalDescriptor = Readonly<{
  /** Proven local terminal family. Determines Owner presentation. */
  family: ThoughtTerminalFamily;
  /** Exact bounded child reasons/codes. Retained diagnostically; never parsed for classification. */
  codes: readonly string[];
  /** Terminal stage (e.g. provider_dispatch, parser, allocation). Diagnostic only. */
  stage?: string;
  /**
   * Normalized provider failure class. Only the provider family reads this
   * for classification. All other families ignore incidental provider detail
   * (retained diagnostically, never overriding the proven local family).
   */
  providerFailureClass?: string | null;
}>;

export function makeThoughtTerminal(
  family: ThoughtTerminalFamily,
  options: {
    codes?: readonly unknown[];
    stage?: unknown;
    providerFailureClass?: string | null;
  } = {},
): ThoughtTerminalDescriptor {
  return {
    family,
    codes: sanitizeTerminalCodes(options.codes ?? []),
    ...(sanitizeTerminalStage(options.stage) !== undefined
      ? { stage: sanitizeTerminalStage(options.stage)! }
      : {}),
    ...(options.providerFailureClass !== undefined
      ? { providerFailureClass: sanitizeTerminalCode(options.providerFailureClass) }
      : {}),
  };
}

function classifyProviderFailureClass(failureClass?: string | null): UserFacingThoughtFailureCode {
  const failureCode = typeof failureClass === "string" ? failureClass.trim().toLowerCase() : "";
  switch (failureCode) {
    case "rate_limited":
    case "quota_exhausted":
    case "provider_quota":
      return "RATE_LIMITED";
    case "provider_unavailable":
    case "mistral_unavailable":
    case "provider_model_unavailable":
      return "PROVIDER_UNAVAILABLE";
    case "credential_invalid":
    case "authentication_failed":
    case "unauthorized":
      return "PROVIDER_AUTHENTICATION_FAILED";
    case "bad_request":
    case "invalid_request":
      return "PROVIDER_REQUEST_INVALID";
    case "network_error":
    case "provider_transport_failure":
      return "PROVIDER_TRANSPORT_FAILURE";
    case "timeout":
    case "provider_timeout":
      return "PROVIDER_TIMEOUT";
    case "provider_internal":
      return "PROVIDER_INTERNAL";
    case "structured_output_untrusted":
    case "structured_output_native_unsupported":
    case "malformed_output":
    case "malformed_json":
    case "schema_violation":
      return "STRUCTURED_OUTPUT_INVALID";
    case "aborterror":
    case "cancelled":
      return "CANCELLED";
    case "route_disabled":
    case "operator_disabled":
    case "capability_mismatch":
    case "configuration_error":
    case "agent_not_ready":
    case "local_quota_exceeded":
    case "request_exceeds_tpm_budget":
    case "dispatch_data_plane_missing":
      return "LOCAL_DISPATCH_FAILURE";
    default:
      return "UNKNOWN";
  }
}

/**
 * Total mechanical presentation policy over the typed terminal domain.
 * Supported known family -> bounded Owner code. Foreign -> UNKNOWN.
 * Incidental provider detail never overrides a proven local family.
 */
export function classifyThoughtTerminal(
  descriptor: ThoughtTerminalDescriptor,
): UserFacingThoughtFailureCode {
  switch (descriptor.family) {
    case "thought_deadline":
      return "THOUGHT_DEADLINE_EXCEEDED";
    case "provider":
      return classifyProviderFailureClass(descriptor.providerFailureClass);
    case "allocation":
      return "LOCAL_DISPATCH_FAILURE";
    case "structural_exhausted":
      return "STRUCTURAL_RETRY_EXHAUSTED";
    case "structural_invalid":
      return "STRUCTURED_OUTPUT_INVALID";
    case "authority":
      return "AUTHORITY_REJECTED";
    case "budget_exhausted":
      return "THOUGHT_BUDGET_EXHAUSTED";
    case "operation_dispatch":
      return "OPERATION_DISPATCH_FAILED";
    case "fidelity":
      return "SPEECH_FIDELITY_REJECTED";
    case "publication_persistence":
      return "PUBLICATION_PERSISTENCE_FAILED";
    case "cancelled":
      return "CANCELLED";
    case "foreign":
      return "UNKNOWN";
    default: {
      const exhaustive: never = descriptor.family;
      return exhaustive;
    }
  }
}

// Bounded legacy-string recognition for the pre-typed seam. The typed
// descriptor path above is primary; this keeps old string callers total
// without requiring comma-permutation keys.
const FIDELITY_FAILURE_STRINGS = new Set([
  "DRAFT_COMMITMENT_CONFLICT",
  "EMPTY_COMMITMENTS_WITH_DRAFT",
  "DRAFT_REQUIRED",
  "NONE_SURFACE_FORBIDDEN",
  "MUST_SAY_MISSING",
  "MUST_NOT_PRESENT",
  "UNWITNESSED_HIGH_RISK_CLAIM",
]);

const AUTHORITY_FAILURE_STRINGS = new Set([
  "CURRENTNESS_UNVERIFIED",
  "RECEIPT_REQUIRED",
  "RECEIPT_CONTRADICTS_CLAIM",
  "IN_FLIGHT_UNKNOWN",
  "CAPABILITY_UNAVAILABLE",
  "EFFECT_NOT_AUTHORIZED",
  "RELATIONAL_BOUNDARY",
  "RELATIONAL_WITHDRAWAL",
  "SOURCE_CLASS_INSUFFICIENT",
  "STALE_STATE",
  "IDENTITY_MUTATION_FORBIDDEN",
  "SECRET_OR_CREDENTIAL",
  "REVISION_BUDGET_EXHAUSTED",
  "DISPATCH_EPOCH_CHANGED",
  "STALE_GENERATION",
  "DRAFT_COMMITMENT_CONFLICT",
  "EMPTY_COMMITMENTS_WITH_DRAFT",
  "AUTHORITY_TRANSITION_ACTIVE",
  "AUTHORITY_PACK_INCOMPLETE",
  "AUTHORITY_VECTOR_STALE",
  "DERIVED_SCOPE_INVALIDATED",
  "DERIVED_SCOPE_UNAVAILABLE",
  "OPERATIONAL_CLAIM_STATE_MISMATCH",
  "OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN",
]);

function classifyLegacyReason(reason: string): UserFacingThoughtFailureCode | null {
  const trimmed = reason.trim();
  if (!trimmed) return null;
  // Comma-joined authority/dispatch sets: a known parent family stays known
  // even when an unfamiliar child is retained. Split is only for legacy
  // recognition; the typed path never parses joined strings.
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
    if (parts.length > 0 && parts.some((part) => AUTHORITY_FAILURE_STRINGS.has(part))) {
      return "AUTHORITY_REJECTED";
    }
    return null;
  }
  switch (trimmed) {
    case "thought_deadline":
      return "THOUGHT_DEADLINE_EXCEEDED";
    case "context_allocation_required_overflow":
    case "capacity_deferred":
      return "LOCAL_DISPATCH_FAILURE";
    case "pass_exhausted":
    case "revision_exhausted":
      return "THOUGHT_BUDGET_EXHAUSTED";
    case "observation_unavailable":
    case "effect_unavailable":
      return "OPERATION_DISPATCH_FAILED";
    case "authority_rejected":
    case "effect_not_authorized":
      return "AUTHORITY_REJECTED";
    case "publication_rejected_diagnostic_persistence_failed":
      return "PUBLICATION_PERSISTENCE_FAILED";
    case "structural_correction_scope_violation":
    case "malformed":
      // Single malformed output without independently proven exhaustion is
      // structured-output-invalid, not retry-exhausted. Proven exhaustion
      // uses the typed structural_exhausted family.
      return "STRUCTURED_OUTPUT_INVALID";
    case "cancelled":
      return "CANCELLED";
    default:
      break;
  }
  if (FIDELITY_FAILURE_STRINGS.has(trimmed)) return "SPEECH_FIDELITY_REJECTED";
  if (AUTHORITY_FAILURE_STRINGS.has(trimmed)) return "AUTHORITY_REJECTED";
  return null;
}

export function classifyThoughtFailureCode(input: {
  reason: string;
  failureCode?: string | null;
}): UserFacingThoughtFailureCode {
  // Local terminal family takes precedence over incidental provider detail.
  // A proven local deadline/authority/fidelity/budget family must not become
  // provider-unavailable (or UNKNOWN) because of accompanying metadata.
  const legacy = classifyLegacyReason(input.reason);
  if (legacy !== null) return legacy;

  return classifyProviderFailureClass(input.failureCode);
}

export function formatThoughtFailureNotice(input: {
  reason: string;
  failureCode?: string | null;
  terminal?: ThoughtTerminalDescriptor;
}): string {
  const code = input.terminal
    ? classifyThoughtTerminal(input.terminal)
    : classifyThoughtFailureCode(input);
  return `${THOUGHT_UNAVAILABLE_NOTICE} Error code: ${code}`;
}

export function formatThoughtTerminalNotice(terminal: ThoughtTerminalDescriptor): string {
  return `${THOUGHT_UNAVAILABLE_NOTICE} Error code: ${classifyThoughtTerminal(terminal)}`;
}

/**
 * Durable terminal diagnostic mirror for the causal ledger. Only the
 * already-bounded/sanitized descriptor fields are retained (family, codes,
 * optional stage, optional provider class). No prose, no provider payload.
 * Notice key, projection key, notice text, legacy reason, and C3 input are
 * never derived from this structure.
 */
export type ThoughtTerminalDiagnostic = {
  family: ThoughtTerminalFamily;
  codes: string[];
  stage?: string;
  providerFailureClass?: string;
};

function toTerminalDiagnostic(terminal: ThoughtTerminalDescriptor): ThoughtTerminalDiagnostic {
  return {
    family: terminal.family,
    codes: [...terminal.codes],
    ...(terminal.stage !== undefined ? { stage: terminal.stage } : {}),
    ...(typeof terminal.providerFailureClass === "string" && terminal.providerFailureClass.length > 0
      ? { providerFailureClass: terminal.providerFailureClass }
      : {}),
  };
}

export type EmitInfrastructureNoticeInput = {
  ownerId: string;
  channel: string;
  threadId: string;
  conversationId: string;
  cycleId?: string | null;
  generation?: Generation | null;
  reason: string;
  failureCode?: string | null;
  /**
   * Typed terminal descriptor for presentation. When present, Owner-facing
   * classification uses the proven family (never comma-string parsing).
   * `reason` remains the exact legacy marker for the notice key and C3
   * behavior preservation. Typed detail never participates in notice
   * identity: the notice key is exactly the pre-packet formula.
   */
  terminal?: ThoughtTerminalDescriptor;
  origin?: OutboxOrigin;
  trigger?: DeliveryIntent["trigger"];
  deliveryLane?: DeliveryIntent["deliveryLane"];
};

type Row = Record<string, unknown>;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntent(value: unknown): DeliveryIntent | null {
  try {
    const parsed = JSON.parse(text(value, "null")) as DeliveryIntent;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function mapNotice(row: unknown): SystemNoticeOutbox | null {
  if (typeof row !== "object" || row === null) return null;
  const value = row as Row;
  const intent = parseIntent(value.delivery_intent_json);
  if (!intent) return null;
  return {
    noticeId: number(value.notice_id),
    noticeKey: text(value.notice_key),
    projectionKey: text(value.projection_key),
    cycleId: value.cycle_id == null ? null : text(value.cycle_id),
    conversationId: text(value.conversation_id),
    deliveryIntent: intent,
    noticeText: text(value.notice_text),
    sendStatus: text(value.send_status) as SystemNoticeOutbox["sendStatus"],
    nuclearReservationId: value.nuclear_reservation_id == null ? null : number(value.nuclear_reservation_id),
    discordMessageId: value.discord_message_id == null ? null : text(value.discord_message_id),
    origin: text(value.origin) as OutboxOrigin,
  };
}

export function getSystemNotice(db: DatabaseSync, noticeId: number): SystemNoticeOutbox | null {
  return mapNotice(db.prepare("SELECT * FROM system_notice_outbox WHERE notice_id = ?").get(noticeId));
}

export function getSystemNoticeByKey(db: DatabaseSync, noticeKey: string): SystemNoticeOutbox | null {
  return mapNotice(db.prepare("SELECT * FROM system_notice_outbox WHERE notice_key = ?").get(noticeKey));
}

export function listSystemNotices(
  db: DatabaseSync,
  options: { limit?: number; statuses?: OutboxSendStatus[] } = {},
): SystemNoticeOutbox[] {
  const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
  const placeholders = options.statuses && options.statuses.length > 0
    ? options.statuses.map(() => "?").join(",")
    : "";
  const where = placeholders ? " WHERE send_status IN (" + placeholders + ")" : "";
  const args: Array<string | number> = options.statuses && options.statuses.length > 0
    ? [...options.statuses, limit]
    : [limit];
  return db.prepare("SELECT * FROM system_notice_outbox" + where + " ORDER BY notice_id ASC LIMIT ?")
    .all(...args).map(mapNotice).filter((row): row is SystemNoticeOutbox => row !== null);
}

function markLedgerUnavailable(db: DatabaseSync, input: EmitInfrastructureNoticeInput): void {
  if (!input.cycleId || input.generation == null) return;
  const defaults = {
    cycleId: input.cycleId,
    generation: input.generation,
    triggerKind: "owner_message",
    occupantId: input.ownerId,
    authorityEpoch: 1,
    settlementId: null,
    observationIds: [],
    effectIds: [],
    authorityCodes: [],
    nominationIds: [],
    outboxId: null,
    fidelity: "skipped",
    thoughtUnavailable: true,
    architectureEpoch: "v0.2.1",
  };
  const existing = db.prepare(
    "SELECT payload_json FROM causal_ledger WHERE cycle_id = ? AND generation = ? LIMIT 1",
  ).get(input.cycleId, input.generation) as Row | undefined;
  let prior: Row = {};
  if (existing && typeof existing.payload_json === "string") {
    try {
      const parsed = JSON.parse(existing.payload_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) prior = parsed as Row;
    } catch {
      // Preserve the typed unavailable marker even if an older payload is malformed.
    }
  }
  const payload = {
    ...defaults,
    ...prior,
    thoughtUnavailable: true,
    // Durable terminal diagnostic mirror. Merges with (never replaces)
    // unrelated payload fields; latest terminal wins per (cycle, generation).
    // Absent terminal preserves any prior diagnostic rather than erasing it.
    ...(input.terminal ? { thoughtTerminal: toTerminalDiagnostic(input.terminal) } : {}),
  };
  const update = db.prepare(
    "UPDATE causal_ledger SET thought_unavailable = 1, payload_json = ? WHERE cycle_id = ? AND generation = ?",
  ).run(JSON.stringify(payload), input.cycleId, input.generation);
  if (Number(update.changes) === 0) {
    db.prepare(
      `INSERT INTO causal_ledger (cycle_id, generation, payload_json, thought_unavailable)
       VALUES (?, ?, ?, 1)`,
    ).run(input.cycleId, input.generation, JSON.stringify(payload));
  }
}

/** Persist attempt-level mechanical failure truth without creating Owner UI. */
export function recordInfrastructureFailureDiagnostic(
  db: DatabaseSync,
  input: EmitInfrastructureNoticeInput,
): void {
  markLedgerUnavailable(db, input);
}

export function emitInfrastructureNotice(
  db: DatabaseSync,
  input: EmitInfrastructureNoticeInput,
): SystemNoticeOutbox {
  const cycle = input.cycleId ?? "none";
  const generation = input.generation == null ? "none" : String(input.generation);
  const reason = input.reason.trim() || "unavailable";
  // FAILURE-TRUTH-COMPLETENESS-01 correction: notice identity is exactly the
  // pre-packet formula. Typed terminal detail classifies presentation only
  // and must never split one logical notice into multiple notices. C3 also
  // infers the legacy reason from the final key segment, so any suffix would
  // corrupt that inference as well as idempotence.
  const noticeKey =
    `thought_failure:${input.conversationId}:${cycle}:${generation}:${reason}`;
  const existing = getSystemNoticeByKey(db, noticeKey);
  if (existing) return existing;

  const origin = input.origin ?? "live";
  const trigger = input.trigger ?? "owner_message_reactive";
  const deliveryLane = input.deliveryLane ?? (trigger === "owner_message_reactive" ? "reactive" : "proactive");
  const intent: DeliveryIntent = {
    ownerId: input.ownerId,
    channel: input.channel,
    threadId: input.threadId,
    conversationId: input.conversationId,
    trigger,
    deliveryLane,
    purpose: "system_notice",
  };
  const status = origin === "shadow" ? "suppressed_shadow" : "pending";
  const provisionalKey = `system:pending:${randomUUID()}`;
  const noticeText = formatThoughtFailureNotice({ reason, failureCode: input.failureCode, terminal: input.terminal });
  const inserted = db.prepare(
    `INSERT INTO system_notice_outbox
       (notice_key, projection_key, cycle_id, conversation_id, notice_text,
        send_status, nuclear_reservation_id, discord_message_id, origin, delivery_intent_json)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  ).run(
    noticeKey,
    provisionalKey,
    input.cycleId ?? null,
    input.conversationId,
    noticeText,
    status,
    origin,
    JSON.stringify(intent),
  );
  const noticeId = number(inserted.lastInsertRowid);
  db.prepare("UPDATE system_notice_outbox SET projection_key = ? WHERE notice_id = ?")
    .run(`system:${noticeId}`, noticeId);
  markLedgerUnavailable(db, input);
  const notice = getSystemNotice(db, noticeId);
  if (!notice) throw new Error("system_notice_insert_lost");
  return notice;
}

export function updateSystemNoticeStatus(
  db: DatabaseSync,
  noticeId: number,
  status: SystemNoticeOutbox["sendStatus"],
  options: { nuclearReservationId?: number | null; discordMessageId?: string | null } = {},
): SystemNoticeOutbox {
  const discordMessageIdClause = options.discordMessageId === undefined
    ? ""
    : ", discord_message_id = ?";
  const parameters: Array<string | number | null> = [
    status,
    options.nuclearReservationId ?? null,
  ];
  if (options.discordMessageId !== undefined) {
    parameters.push(options.discordMessageId);
  }
  parameters.push(noticeId);
  db.prepare(
    `UPDATE system_notice_outbox
     SET send_status = ?,
         nuclear_reservation_id = COALESCE(?, nuclear_reservation_id)${discordMessageIdClause}
     WHERE notice_id = ?`,
  ).run(...parameters);
  const notice = getSystemNotice(db, noticeId);
  if (!notice) throw new Error("system_notice_missing");
  return notice;
}
