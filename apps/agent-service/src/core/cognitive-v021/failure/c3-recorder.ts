import type { DatabaseSync } from "node:sqlite";
import type {
  C3ExternalEffectTruth,
  C3RawEvidenceRef,
  C3TerminalExperienceRecord,
  C3TerminalExperienceListOptions,
} from "./types.js";

export const C3_ALLOWLISTED_TERMINAL_CLASSES = [
  "unavailable",
  "malformed",
  "revision_exhausted",
  "authority_rejected",
  "context_allocation_required_overflow",
  "permanent_terminal",
  "age_exhausted",
  "attempts_exhausted",
  "capacity_wait_max_duration_exceeded",
  "delivery_aborted",
  "delivery_expired",
  "delivery_partially_delivered",
] as const;

export type C3AllowlistedTerminalClass = typeof C3_ALLOWLISTED_TERMINAL_CLASSES[number];

export function isC3AllowlistedTerminalClass(
  value: unknown,
): value is C3AllowlistedTerminalClass {
  return typeof value === "string" &&
    (C3_ALLOWLISTED_TERMINAL_CLASSES as readonly string[]).includes(value);
}

type Row = Record<string, unknown>;

function row(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? value as Row : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableText(value: unknown): string | null {
  return value == null ? null : text(value);
}

function hasForbiddenEvidenceKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenEvidenceKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, child]) =>
    key === "notice_text" || key === "felt_meaning" || hasForbiddenEvidenceKey(child));
}

function validateJsonFields(input: C3TerminalExperienceRecord): void {
  let rawEvidence: unknown;
  try {
    rawEvidence = JSON.parse(input.rawEvidenceRefsJson);
  } catch {
    throw new Error("c3_experience_raw_evidence_invalid");
  }
  if (!Array.isArray(rawEvidence) || hasForbiddenEvidenceKey(rawEvidence) || rawEvidence.some((item) => {
    const value = row(item);
    return !value || typeof value.kind !== "string" || typeof value.id !== "string";
  })) {
    throw new Error("c3_experience_raw_evidence_invalid");
  }
  if (input.attemptLineageJson != null) {
    try {
      JSON.parse(input.attemptLineageJson);
    } catch {
      throw new Error("c3_experience_attempt_lineage_invalid");
    }
  }
}

function validateRecord(input: C3TerminalExperienceRecord): void {
  if (!input.experienceId.trim() || !input.cycleId.trim() || !input.terminalPhase.trim() || !input.sourceDomainOwner.trim()) {
    throw new Error("c3_experience_identity_invalid");
  }
  if (!isC3AllowlistedTerminalClass(input.failureClass)) {
    throw new Error(`c3_experience_failure_class_not_allowlisted:${input.failureClass}`);
  }
  if (input.terminalDisposition !== "terminal") throw new Error("c3_experience_disposition_invalid");
  if (input.publicationState !== "published" && input.publicationState !== "unpublished") {
    throw new Error("c3_experience_publication_state_invalid");
  }
  if (!["not_attempted", "no_effect_proven", "effect_verified", "effect_indeterminate"].includes(input.externalEffectTruth)) {
    throw new Error("c3_experience_effect_truth_invalid");
  }
  if (!Number.isInteger(input.generation) || input.generation < 0 || !Number.isInteger(input.occurredAtMs)) {
    throw new Error("c3_experience_numeric_field_invalid");
  }
  if (!Number.isInteger(input.unresolvedState) || input.unresolvedState < 0 || !Number.isInteger(input.redacted) || ![0, 1].includes(input.redacted)) {
    throw new Error("c3_experience_state_field_invalid");
  }
  validateJsonFields(input);
}

function mapRecord(value: unknown): C3TerminalExperienceRecord | null {
  const source = row(value);
  if (!source) return null;
  return {
    experienceId: text(source.experience_id),
    obligationFrontierId: nullableText(source.obligation_frontier_id),
    cycleId: text(source.cycle_id),
    generation: number(source.generation),
    attemptId: nullableText(source.attempt_id),
    attemptLineageJson: nullableText(source.attempt_lineage_json),
    terminalPhase: text(source.terminal_phase),
    failureClass: text(source.failure_class),
    terminalDisposition: text(source.terminal_disposition) as "terminal",
    publicationState: text(source.publication_state) as "published" | "unpublished",
    externalEffectTruth: text(source.external_effect_truth) as C3ExternalEffectTruth,
    receiptRef: nullableText(source.receipt_ref),
    unresolvedState: number(source.unresolved_state),
    rawEvidenceRefsJson: text(source.raw_evidence_refs_json),
    noticeId: nullableText(source.notice_id),
    occurredAtMs: number(source.occurred_at_ms),
    sourceDomainOwner: text(source.source_domain_owner),
    sourceCurrentnessRef: nullableText(source.source_currentness_ref),
    redacted: number(source.redacted),
  };
}

export function recordC3TerminalExperience(
  db: DatabaseSync,
  input: C3TerminalExperienceRecord,
): C3TerminalExperienceRecord | null {
  if (!isC3AllowlistedTerminalClass(input.failureClass)) return null;
  validateRecord(input);
  db.prepare(
    `INSERT OR IGNORE INTO c3_terminal_experiences
       (experience_id, obligation_frontier_id, cycle_id, generation, attempt_id,
        attempt_lineage_json, terminal_phase, failure_class, terminal_disposition,
        publication_state, external_effect_truth, receipt_ref, unresolved_state,
        raw_evidence_refs_json, notice_id, occurred_at_ms, source_domain_owner,
        source_currentness_ref, redacted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.experienceId,
    input.obligationFrontierId,
    input.cycleId,
    input.generation,
    input.attemptId,
    input.attemptLineageJson,
    input.terminalPhase,
    input.failureClass,
    input.terminalDisposition,
    input.publicationState,
    input.externalEffectTruth,
    input.receiptRef,
    input.unresolvedState,
    input.rawEvidenceRefsJson,
    input.noticeId,
    input.occurredAtMs,
    input.sourceDomainOwner,
    input.sourceCurrentnessRef,
    input.redacted,
  );
  const stored = mapRecord(db.prepare(
    "SELECT * FROM c3_terminal_experiences WHERE experience_id = ?",
  ).get(input.experienceId));
  if (!stored) throw new Error("c3_experience_insert_lost");
  return stored;
}

export function safeRecordC3TerminalExperience(
  db: DatabaseSync,
  input: C3TerminalExperienceRecord,
): C3TerminalExperienceRecord | null {
  try {
    return recordC3TerminalExperience(db, input);
  } catch {
    console.warn(
      "[cognitive-v021] c3_write_deferred_for_forward_repair",
      { experienceId: input.experienceId, error: "derived_c3_write_failed" },
    );
    return null;
  }
}

export function listC3TerminalExperiences(
  db: DatabaseSync,
  options: C3TerminalExperienceListOptions = {},
): C3TerminalExperienceRecord[] {
  const conditions: string[] = [];
  const args: Array<string | number> = [];
  if (options.cycleId) {
    conditions.push("cycle_id = ?");
    args.push(options.cycleId);
  }
  if (options.unresolvedOnly) conditions.push("unresolved_state != 0");
  if (options.unresolvedState != null) {
    conditions.push("unresolved_state = ?");
    args.push(options.unresolvedState);
  }
  const limit = Math.max(1, Math.min(1000, options.limit ?? 100));
  args.push(limit);
  return db.prepare(
    `SELECT * FROM c3_terminal_experiences
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY occurred_at_ms ASC, experience_id ASC
     LIMIT ?`,
  ).all(...args).map(mapRecord).filter((item): item is C3TerminalExperienceRecord => item !== null);
}

function rawEvidence(refs: C3RawEvidenceRef[]): string {
  return JSON.stringify(refs);
}

function safeSourceCurrentness(cycleId: string, generation: number, supplied?: string | null): string {
  return supplied ?? `${cycleId}:generation:${generation}`;
}

function effectTruthForDispatch(dispatchTruth: string): C3ExternalEffectTruth {
  return dispatchTruth === "not_started" ? "no_effect_proven" : "effect_indeterminate";
}

function effectTruthForThought(failureClass: string): C3ExternalEffectTruth {
  return failureClass === "unavailable" || failureClass === "context_allocation_required_overflow"
    ? "no_effect_proven"
    : "not_attempted";
}

function sanitizedErrorCode(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim().slice(0, 128);
  if (!trimmed || !/^[A-Za-z0-9_.:-]+$/.test(trimmed) || /(password|secret|credential|token|api[-_]?key)/i.test(trimmed)) {
    return "sanitized_error";
  }
  return trimmed;
}

export type ThoughtC3TerminalFailureInput = {
  noticeKey: string;
  noticeId: string | number;
  cycleId: string;
  generation: number;
  occurredAtMs: number;
  failureClass?: string;
  attemptId?: string | null;
  sourceCurrentnessRef?: string | null;
};

export function buildThoughtC3TerminalFailure(
  input: ThoughtC3TerminalFailureInput,
): C3TerminalExperienceRecord | null {
  const inferred = input.noticeKey.split(":").at(-1) ?? "";
  const failureClass = input.failureClass ?? inferred;
  if (!isC3AllowlistedTerminalClass(failureClass)) return null;
  return {
    experienceId: `c3:thought:${input.noticeKey}`,
    obligationFrontierId: null,
    cycleId: input.cycleId,
    generation: input.generation,
    attemptId: input.attemptId ?? null,
    attemptLineageJson: input.attemptId == null ? null : JSON.stringify({ attemptId: input.attemptId }),
    terminalPhase: "thought",
    failureClass,
    terminalDisposition: "terminal",
    publicationState: "unpublished",
    externalEffectTruth: effectTruthForThought(failureClass),
    receiptRef: null,
    unresolvedState: 0,
    rawEvidenceRefsJson: rawEvidence([
      { kind: "system_notice_outbox", id: String(input.noticeId) },
      { kind: "cycle_records", id: input.cycleId },
      ...(input.attemptId ? [{ kind: "thought_steps", id: input.attemptId }] : []),
    ]),
    noticeId: String(input.noticeId),
    occurredAtMs: input.occurredAtMs,
    sourceDomainOwner: "thought",
    sourceCurrentnessRef: safeSourceCurrentness(input.cycleId, input.generation, input.sourceCurrentnessRef),
    redacted: 0,
  };
}

export function recordThoughtC3TerminalFailure(
  db: DatabaseSync,
  input: ThoughtC3TerminalFailureInput,
): C3TerminalExperienceRecord | null {
  const record = buildThoughtC3TerminalFailure(input);
  return record ? safeRecordC3TerminalExperience(db, record) : null;
}

export type RetryC3TerminalFailureInput = {
  eventId: string;
  attemptId: string;
  wakeId: string | null;
  cycleId: string;
  generation: number;
  ordinal: number;
  dispatchTruth: string;
  failureClass: string;
  errorCode: string | null;
  occurredAtMs: number;
  sourceCurrentnessRef?: string | null;
};

export function buildRetryC3TerminalFailure(
  input: RetryC3TerminalFailureInput,
): C3TerminalExperienceRecord | null {
  if (!isC3AllowlistedTerminalClass(input.failureClass)) return null;
  return {
    experienceId: `c3:retry:${input.eventId}:${input.attemptId}:${input.failureClass}`,
    obligationFrontierId: null,
    cycleId: input.cycleId,
    generation: input.generation,
    attemptId: input.attemptId,
    attemptLineageJson: JSON.stringify({
      eventId: input.eventId,
      wakeId: input.wakeId,
      ordinal: input.ordinal,
      dispatchTruth: input.dispatchTruth,
      failureClass: input.failureClass,
      errorCode: sanitizedErrorCode(input.errorCode),
    }),
    terminalPhase: "retry",
    failureClass: input.failureClass,
    terminalDisposition: "terminal",
    publicationState: "unpublished",
    externalEffectTruth: effectTruthForDispatch(input.dispatchTruth),
    receiptRef: `durable_work_attempt:${input.attemptId}`,
    unresolvedState: 0,
    rawEvidenceRefsJson: rawEvidence([
      { kind: "inbox_events", id: input.eventId },
      { kind: "durable_work_attempts", id: input.attemptId },
      ...(input.wakeId ? [{ kind: "wakes", id: input.wakeId }] : []),
      { kind: "cycle_records", id: input.cycleId },
    ]),
    noticeId: null,
    occurredAtMs: input.occurredAtMs,
    sourceDomainOwner: "retry",
    sourceCurrentnessRef: safeSourceCurrentness(input.cycleId, input.generation, input.sourceCurrentnessRef),
    redacted: 0,
  };
}

export function recordRetryC3TerminalFailure(
  db: DatabaseSync,
  input: RetryC3TerminalFailureInput,
): C3TerminalExperienceRecord | null {
  const record = buildRetryC3TerminalFailure(input);
  return record ? safeRecordC3TerminalExperience(db, record) : null;
}

export type FrontierC3TerminalFailureInput = {
  frontierId: string;
  cycleId: string;
  generation: number;
  occurredAtMs: number;
  sourceCurrentnessRef?: string | null;
};

export function buildFrontierC3TerminalFailure(
  input: FrontierC3TerminalFailureInput,
): C3TerminalExperienceRecord {
  return {
    experienceId: `c3:frontier:${input.frontierId}:capacity_wait_max_duration_exceeded`,
    obligationFrontierId: input.frontierId,
    cycleId: input.cycleId,
    generation: input.generation,
    attemptId: null,
    attemptLineageJson: null,
    terminalPhase: "frontier",
    failureClass: "capacity_wait_max_duration_exceeded",
    terminalDisposition: "terminal",
    publicationState: "unpublished",
    externalEffectTruth: "no_effect_proven",
    receiptRef: null,
    unresolvedState: 0,
    rawEvidenceRefsJson: rawEvidence([
      { kind: "deferred_reactive_frontiers", id: input.frontierId },
      { kind: "cycle_records", id: input.cycleId },
    ]),
    noticeId: null,
    occurredAtMs: input.occurredAtMs,
    sourceDomainOwner: "frontier",
    sourceCurrentnessRef: safeSourceCurrentness(input.cycleId, input.generation, input.sourceCurrentnessRef),
    redacted: 0,
  };
}

export function recordFrontierC3TerminalFailure(
  db: DatabaseSync,
  input: FrontierC3TerminalFailureInput,
): C3TerminalExperienceRecord | null {
  return safeRecordC3TerminalExperience(db, buildFrontierC3TerminalFailure(input));
}

export type DeliveryC3TerminalFailureInput = {
  reservationId: number;
  cycleId: string;
  generation: number;
  state: "aborted" | "expired" | "partially_delivered";
  occurredAtMs: number;
  deliveredBubbleCount?: number;
  sourceCurrentnessRef?: string | null;
};

export function buildDeliveryC3TerminalFailure(
  input: DeliveryC3TerminalFailureInput,
): C3TerminalExperienceRecord | null {
  const failureClass = `delivery_${input.state}`;
  const delivered = input.deliveredBubbleCount ?? 0;
  const effectTruth: C3ExternalEffectTruth = input.state === "partially_delivered" || delivered > 0
    ? "effect_indeterminate"
    : "no_effect_proven";
  return {
    experienceId: `c3:delivery:${input.reservationId}:${failureClass}`,
    obligationFrontierId: null,
    cycleId: input.cycleId,
    generation: input.generation,
    attemptId: null,
    attemptLineageJson: null,
    terminalPhase: "delivery",
    failureClass,
    terminalDisposition: "terminal",
    publicationState: delivered > 0 ? "published" : "unpublished",
    externalEffectTruth: effectTruth,
    receiptRef: `delivery_reservation:${input.reservationId}`,
    unresolvedState: 0,
    rawEvidenceRefsJson: rawEvidence([
      { kind: "delivery_reservations", id: String(input.reservationId) },
      { kind: "cycle_records", id: input.cycleId },
    ]),
    noticeId: null,
    occurredAtMs: input.occurredAtMs,
    sourceDomainOwner: "delivery",
    sourceCurrentnessRef: safeSourceCurrentness(input.cycleId, input.generation, input.sourceCurrentnessRef),
    redacted: 0,
  };
}

export function recordDeliveryC3TerminalFailure(
  db: DatabaseSync,
  input: DeliveryC3TerminalFailureInput,
): C3TerminalExperienceRecord | null {
  const record = buildDeliveryC3TerminalFailure(input);
  return record ? safeRecordC3TerminalExperience(db, record) : null;
}
