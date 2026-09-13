import type { DatabaseSync } from "node:sqlite";
import type {
  AffectLicense,
  Decision,
  DecisionKind,
  EvidenceRef,
  MotivationKind,
  ThoughtValidationEnvelope,
  Trigger,
} from "../types.js";

export type LoggedDecision = {
  id: number;
  ownerId: string;
  channel: string;
  trigger: Trigger;
  decisionKind: DecisionKind;
  motivationIds: number[];
  reason: string;
  objective: string | null;
  evidenceRefs: EvidenceRef[];
  effort: "low" | "medium" | "high";
  completion: "complete" | "hold";
  uncertainty: number;
  urgency: number;
  affectLicense: AffectLicense;
  thoughtSource: "deterministic" | "model" | "fallback";
  thoughtError: string | null;
  learningSubjectKind: MotivationKind | null;
  learningAdjustment: number;
  learningThroughEventId: number | null;
  outcomeText: string | null;
  thoughtValidation: ThoughtValidationEnvelope | null;
  createdAt: string;
};

type LogDecisionInput = {
  ownerId: string;
  channel: string;
  trigger: Trigger;
  decision: Decision;
  outcomeText?: string | null;
};

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function decisionKind(value: unknown): DecisionKind | null {
  const kind = stringValue(value);
  if (
    kind === "speak" ||
    kind === "silence" ||
    kind === "delay" ||
    kind === "ask" ||
    kind === "revisit" ||
    kind === "share" ||
    kind === "challenge" ||
    kind === "refuse"
  ) {
    return kind;
  }
  return null;
}

function trigger(value: unknown): Trigger | null {
  const valueText = stringValue(value);
  return valueText === "reactive" || valueText === "proactive"
    ? valueText
    : null;
}

function motivationKind(value: unknown): MotivationKind | null {
  const kind = stringValue(value);
  switch (kind) {
    case "user_message":
    case "question":
    case "fact":
    case "callback":
    case "opinion":
    case "take":
    case "unfinished":
    case "identity":
    case "availability":
    case "boundary":
    case "silence_signal":
    case "silence_ok":
      return kind;
    default:
      return null;
  }
}

function parseIds(value: unknown): number[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => typeof id === "number")
      : [];
  } catch {
    return [];
  }
}

function parseEvidenceRefs(value: unknown): EvidenceRef[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is EvidenceRef => {
      if (!isRow(entry)) return false;
      const validType =
        entry.type === "message" ||
        entry.type === "episode" ||
        entry.type === "fact" ||
        entry.type === "question" ||
        entry.type === "opinion" ||
        entry.type === "take" ||
        entry.type === "identity" ||
        entry.type === "mind_state" ||
        entry.type === "doc_reminder" ||
        entry.type === "ashley_self_commitment" ||
        entry.type === "mutual_commitment" ||
        entry.type === "scheduled_proactive" ||
        entry.type === "relational_tension" ||
        entry.type === "withdrawal" ||
        entry.type === "open_cognitive_item";
      return validType &&
        (typeof entry.id === "string" || typeof entry.id === "number");
    });
  } catch {
    return [];
  }
}

function parseEvidenceRef(value: unknown): EvidenceRef | undefined {
  if (!isRow(value)) return undefined;
  if (typeof value.id !== "string" && typeof value.id !== "number") {
    return undefined;
  }
  switch (value.type) {
    case "message":
    case "episode":
    case "fact":
    case "question":
    case "opinion":
    case "take":
    case "identity":
    case "mind_state":
    case "doc_reminder":
    case "ashley_self_commitment":
    case "mutual_commitment":
    case "scheduled_proactive":
    case "relational_tension":
    case "withdrawal":
    case "open_cognitive_item":
      return { type: value.type, id: value.id };
    default:
      return undefined;
  }
}

function parseThoughtValidation(value: unknown): ThoughtValidationEnvelope | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as ThoughtValidationEnvelope;
  } catch {
    return null;
  }
}

function parseAffectLicense(value: unknown): AffectLicense {
  const fallback: AffectLicense = {
    permitted: false,
    valence: 0,
    activation: 0.5,
    openness: 0.5,
    tension: 0,
    reason: "No persisted affect license.",
  };
  if (typeof value !== "string") return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRow(parsed)) return fallback;
    const source = parseEvidenceRef(parsed.source);
    return {
      permitted: parsed.permitted === true,
      valence: numberValue(parsed.valence),
      activation: numberValue(parsed.activation),
      openness: numberValue(parsed.openness),
      tension: numberValue(parsed.tension),
      reason: stringValue(parsed.reason),
      ...(source ? { source } : {}),
    };
  } catch {
    return fallback;
  }
}

function mapDecision(row: unknown): LoggedDecision | null {
  if (!isRow(row)) return null;
  const kind = decisionKind(row.decision_kind);
  const rowTrigger = trigger(row.trigger);
  if (!kind || !rowTrigger) return null;
  return {
    id: numberValue(row.id),
    ownerId: stringValue(row.owner_id),
    channel: stringValue(row.channel),
    trigger: rowTrigger,
    decisionKind: kind,
    motivationIds: parseIds(row.motivation_ids_json),
    reason: stringValue(row.reason),
    objective: typeof row.objective === "string" ? row.objective : null,
    evidenceRefs: parseEvidenceRefs(row.evidence_refs_json),
    effort:
      row.effort === "medium" || row.effort === "high" ? row.effort : "low",
    completion: row.completion === "hold" ? "hold" : "complete",
    uncertainty: numberValue(row.uncertainty),
    urgency: numberValue(row.urgency),
    affectLicense: parseAffectLicense(row.affect_license_json),
    thoughtSource:
      row.thought_source === "model" || row.thought_source === "fallback"
        ? row.thought_source
        : "deterministic",
    thoughtError: typeof row.thought_error === "string" ? row.thought_error : null,
    learningSubjectKind: motivationKind(row.learning_subject_kind),
    learningAdjustment: numberValue(row.learning_adjustment),
    learningThroughEventId:
      row.learning_through_event_id === null ||
      row.learning_through_event_id === undefined
        ? null
        : numberValue(row.learning_through_event_id),
    outcomeText:
      typeof row.outcome_text === "string" ? row.outcome_text : null,
    thoughtValidation: parseThoughtValidation(row.thought_validation_json),
    createdAt: stringValue(row.created_at),
  };
}

export function logDecision(db: DatabaseSync, input: LogDecisionInput): number;
export function logDecision(
  db: DatabaseSync,
  ownerId: string,
  channel: string,
  trigger: Trigger,
  decision: Decision,
  outcomeText?: string | null,
): number;
export function logDecision(
  db: DatabaseSync,
  inputOrOwner: LogDecisionInput | string,
  channel?: string,
  decisionTrigger?: Trigger,
  decision?: Decision,
  outcomeText: string | null = null,
): number {
  const input: LogDecisionInput =
    typeof inputOrOwner === "string"
      ? {
          ownerId: inputOrOwner,
          channel: channel ?? "discord",
          trigger: decisionTrigger ?? "reactive",
          decision: decision ?? {
            trigger: decisionTrigger ?? "reactive",
            kind: "silence",
            motivationIds: [],
            score: 0,
            reason: "missing decision",
            evidenceRefs: [],
            uncertainty: 1,
            urgency: 0,
            thoughtSource: "deterministic",
            thoughtError: null,
            affectLicense: {
              permitted: false,
              valence: 0,
              activation: 0.5,
              openness: 0.5,
              tension: 0,
              reason: "missing decision",
            },
            cognitiveAllocation: {
              shouldSpeak: false,
              effort: "low",
              completion: "complete",
            },
            authorizedClaims: {
              readingRecordIds: [],
              readingTitles: [],
              readingClaims: [],
            },
          },
          outcomeText,
        }
      : inputOrOwner;
  const result = db
    .prepare(
      `INSERT INTO decision_log
         (owner_id, channel, trigger, decision_kind, motivation_ids_json,
          reason, learning_subject_kind, learning_adjustment,
          learning_through_event_id, objective, evidence_refs_json, effort,
          completion, uncertainty, urgency, affect_license_json,
          thought_source, thought_error, outcome_text, hold_reason_code,
          silence_reason_code, thought_validation_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.ownerId,
        input.channel,
        input.trigger,
        input.decision.kind,
        JSON.stringify(input.decision.motivationIds),
        input.decision.reason,
        input.decision.learning?.subjectKind ?? null,
        input.decision.learning?.adjustment ?? 0,
        input.decision.learning?.throughEventId ?? null,
        input.decision.objective ?? null,
        JSON.stringify(input.decision.evidenceRefs),
        input.decision.cognitiveAllocation.effort,
        input.decision.cognitiveAllocation.completion,
        input.decision.uncertainty,
        input.decision.urgency,
        JSON.stringify(input.decision.affectLicense),
        input.decision.thoughtSource,
        input.decision.thoughtError,
        input.outcomeText ?? null,
        input.decision.holdReasonCode ?? null,
        input.decision.silenceReasonCode ?? null,
        input.decision.thoughtValidation ? JSON.stringify(input.decision.thoughtValidation) : null,
        new Date().toISOString(),
      );
  const ids = input.decision.motivationIds;
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    db.prepare(
      `UPDATE motivations
       SET consumed_at = ?
       WHERE id IN (${placeholders}) AND owner_id = ?`,
    ).run(new Date().toISOString(), ...ids, input.ownerId);
  }
  return Number(result.lastInsertRowid);
}

export function setDecisionOutcome(
  db: DatabaseSync,
  decisionId: number,
  outcomeText: string | null,
): void {
  db.prepare("UPDATE decision_log SET outcome_text = ? WHERE id = ?").run(
    outcomeText,
    decisionId,
  );
}

export function getDecision(
  db: DatabaseSync,
  decisionId: number,
): LoggedDecision | null {
  const row = db
    .prepare(
      `SELECT id, owner_id, channel, trigger, decision_kind,
              motivation_ids_json, reason, learning_subject_kind,
              learning_adjustment, learning_through_event_id,
              objective, evidence_refs_json, effort, completion,
              uncertainty, urgency, affect_license_json,
          thought_source, thought_error,
              outcome_text, thought_validation_json, created_at
        FROM decision_log
        WHERE id = ?`,
    )
    .get(decisionId);
  return mapDecision(row);
}

export function listRecentDecisions(
  db: DatabaseSync,
  ownerId: string,
  limit = 20,
): LoggedDecision[] {
  const rows = db
    .prepare(
      `SELECT id, owner_id, channel, trigger, decision_kind,
              motivation_ids_json, reason, learning_subject_kind,
              learning_adjustment, learning_through_event_id,
              objective, evidence_refs_json, effort, completion,
              uncertainty, urgency, affect_license_json,
          thought_source, thought_error,
              outcome_text, thought_validation_json, created_at
        FROM decision_log
        WHERE owner_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(ownerId, Math.max(1, Math.min(100, limit)))
    .map(mapDecision)
    .filter((decisionRow): decisionRow is LoggedDecision => decisionRow !== null);
  return rows;
}
