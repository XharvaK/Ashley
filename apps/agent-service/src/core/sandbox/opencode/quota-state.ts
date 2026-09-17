/**
 * Persisted OpenCode quota-class capacity. Not nuclear. Not per-model health.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { QuotaClass } from "./catalog.js";

export type ClassCapacity = "unknown" | "available" | "quota_exhausted";
export type ModelHealth = "unknown" | "available" | "temporarily_unavailable";

export type QuotaClassRecord = {
  capacity: ClassCapacity;
  providerResetAtMs: number | null;
  hostNextProbeAtMs: number | null;
};

export type QuotaStateFile = {
  NVIDIA_FREE: QuotaClassRecord;
  OTHER_FREE: QuotaClassRecord;
};

export const DEFAULT_HOST_PROBE_BACKOFF_MS = 60 * 60 * 1000;

const emptyRecord = (): QuotaClassRecord => ({
  capacity: "unknown",
  providerResetAtMs: null,
  hostNextProbeAtMs: null,
});

export function emptyQuotaState(): QuotaStateFile {
  return {
    NVIDIA_FREE: emptyRecord(),
    OTHER_FREE: emptyRecord(),
  };
}

function isCapacity(value: unknown): value is ClassCapacity {
  return value === "unknown" || value === "available" || value === "quota_exhausted";
}

function parseRecord(value: unknown): QuotaClassRecord {
  if (!value || typeof value !== "object") return emptyRecord();
  const row = value as Record<string, unknown>;
  const providerResetAtMs = typeof row.providerResetAtMs === "number" && Number.isFinite(row.providerResetAtMs)
    ? row.providerResetAtMs
    : null;
  const hostNextProbeAtMs = typeof row.hostNextProbeAtMs === "number" && Number.isFinite(row.hostNextProbeAtMs)
    ? row.hostNextProbeAtMs
    : null;
  return {
    capacity: isCapacity(row.capacity) ? row.capacity : "unknown",
    providerResetAtMs,
    hostNextProbeAtMs,
  };
}

export function loadQuotaState(path: string): QuotaStateFile {
  if (!path || !existsSync(path)) return emptyQuotaState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyQuotaState();
    const row = parsed as Record<string, unknown>;
    return {
      NVIDIA_FREE: parseRecord(row.NVIDIA_FREE),
      OTHER_FREE: parseRecord(row.OTHER_FREE),
    };
  } catch {
    return emptyQuotaState();
  }
}

export function saveQuotaState(path: string, state: QuotaStateFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function recordClassAvailable(state: QuotaStateFile, quotaClass: QuotaClass): QuotaStateFile {
  const next = { ...state, [quotaClass]: { ...state[quotaClass] } };
  next[quotaClass].capacity = "available";
  next[quotaClass].hostNextProbeAtMs = null;
  return next;
}

export function recordClassExhausted(
  state: QuotaStateFile,
  quotaClass: QuotaClass,
  input: { nowMs: number; providerResetAtMs?: number | null; backoffMs?: number },
): QuotaStateFile {
  const next = { ...state, [quotaClass]: { ...state[quotaClass] } };
  next[quotaClass].capacity = "quota_exhausted";
  next[quotaClass].providerResetAtMs = input.providerResetAtMs ?? null;
  const backoff = input.backoffMs ?? DEFAULT_HOST_PROBE_BACKOFF_MS;
  next[quotaClass].hostNextProbeAtMs = input.nowMs + backoff;
  return next;
}

export type QuotaEvidenceKind = "success" | "quota_exhausted" | "model_failure";

export function classifyOpenCodeFailure(input: {
  status?: number | null;
  text?: string;
}): QuotaEvidenceKind {
  if (input.status === 429) return "quota_exhausted";
  const text = (input.text ?? "").toLowerCase();
  if (/\bquota[-_ ]?(exceeded|exhausted|limit)\b/.test(text)) return "quota_exhausted";
  if (/\brate[-_ ]limit\b/.test(text) && /\bexceeded\b/.test(text)) return "quota_exhausted";
  return "model_failure";
}
