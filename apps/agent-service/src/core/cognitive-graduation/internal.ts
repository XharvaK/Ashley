import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  maxClassification,
  type DataClassification,
} from "../privacy/classification.js";
import type { CognitiveEvidenceRef } from "./types.js";

export type DbRow = Record<string, unknown>;

export function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export function nullableText(value: unknown): string | null {
  return value == null ? null : text(value);
}

export function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value);
}

export function classification(value: unknown): DataClassification {
  return value === "ordinary" || value === "sensitive" ||
    value === "never_public" || value === "secret"
    ? value
    : "never_public";
}

export function requireText(value: unknown, name: string, max: number): string {
  const result = text(value).trim();
  if (!result) throw new Error(`cognitive_graduation_${name}_required`);
  if (result.length > max) throw new Error(`cognitive_graduation_${name}_too_long`);
  return result;
}

export function requireBoundedJson(
  value: unknown,
  name: string,
  maxBytes: number,
): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(value ?? {}) ?? "{}";
  } catch {
    throw new Error(`cognitive_graduation_${name}_json_invalid`);
  }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    throw new Error(`cognitive_graduation_${name}_too_large`);
  }
  return encoded;
}

export function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function parseObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return isRow(parsed) ? parsed : {};
}

export function parseEvidenceRefs(value: unknown): CognitiveEvidenceRef[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    if (!isRow(entry) || (typeof entry.id !== "string" && typeof entry.id !== "number")) {
      return [];
    }
    if (entry.type === "assertion" || entry.type === "learned_influence") {
      return [{ type: entry.type, id: entry.id } as CognitiveEvidenceRef];
    }
    const allowed = new Set([
      "message", "episode", "fact", "question", "opinion", "take", "identity",
      "mind_state", "doc_reminder", "ashley_self_commitment", "mutual_commitment",
      "scheduled_proactive", "relational_tension", "withdrawal", "open_cognitive_item",
    ]);
    return typeof entry.type === "string" && allowed.has(entry.type)
      ? [{ type: entry.type, id: entry.id } as CognitiveEvidenceRef]
      : [];
  });
}

export function normalizeEvidenceRefs(value: CognitiveEvidenceRef[]): CognitiveEvidenceRef[] {
  if (!Array.isArray(value)) throw new Error("cognitive_graduation_evidence_refs_required");
  const result: CognitiveEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || (typeof item.id !== "string" && typeof item.id !== "number")) {
      throw new Error("cognitive_graduation_evidence_ref_invalid");
    }
    const type = String(item.type);
    const allowed = (type === "assertion" || type === "learned_influence") || new Set([
      "message", "episode", "fact", "question", "opinion", "take", "identity",
      "mind_state", "doc_reminder", "ashley_self_commitment", "mutual_commitment",
      "scheduled_proactive", "relational_tension", "withdrawal", "open_cognitive_item",
    ]).has(type);
    if (!allowed) throw new Error("cognitive_graduation_evidence_ref_invalid");
    const key = `${type}:${String(item.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ type: type as CognitiveEvidenceRef["type"], id: item.id });
  }
  if (result.length === 0) throw new Error("cognitive_graduation_evidence_refs_required");
  return result;
}

export function assertionIds(refs: CognitiveEvidenceRef[]): number[] {
  return refs.flatMap((ref) => {
    if (ref.type !== "assertion") return [];
    const id = Number(ref.id);
    return Number.isSafeInteger(id) && id > 0 ? [id] : [];
  });
}

export function combinedClassification(
  requested: DataClassification | null | undefined,
  ...sources: Array<DataClassification | null | undefined>
): DataClassification {
  return maxClassification(requested, ...sources);
}

export function rejectSecret(classificationValue: DataClassification, reason: string): void {
  if (classificationValue === "secret") throw new Error(reason);
}

export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function newC4Id(): string {
  return randomUUID();
}

export function ownerDecisionExists(
  db: DatabaseSync,
  decisionId: number,
  ownerId: string,
): boolean {
  return db.prepare(
    `SELECT 1 FROM decision_log WHERE id = ? AND owner_id = ?`,
  ).get(decisionId, ownerId) !== undefined;
}

export function hasUnsafeReasoningMarker(value: string): boolean {
  return /<\s*think\b|chain\s+of\s+thought|reasoning\s+trace|internal\s+monologue|hidden\s+cot/i.test(value);
}

export function validatePolicyLineage(lineage: Record<string, unknown> | undefined): string {
  const value = lineage ?? {};
  for (const key of Object.keys(value)) {
    if (/prompt|completion|response_body|raw_body|chain|cot|secret/i.test(key)) {
      throw new Error("cognitive_graduation_policy_lineage_raw_payload_refused");
    }
  }
  return requireBoundedJson(value, "policy_lineage", 4000);
}

export function stableEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => stableEqual(value, right[index]));
  }
  if (isRow(left) && isRow(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && stableEqual(left[key], right[key]));
  }
  return false;
}
