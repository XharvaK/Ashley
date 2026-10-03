import type { DatabaseSync } from "node:sqlite";
import type { MemoryAssertion, MemoryKind } from "../types.js";
import { listLiveMemoryAssertions, REDACTED_MEMORY_STATEMENT } from "./assertions.js";

/**
 * Growth V1 §4.5 memory strength. Host arithmetic only: Thought sets how much
 * a memory matters (salience) when forming it; the Host tracks how often it
 * comes back and is actually used. Strength orders recall; it never deletes.
 */
export const DEFAULT_SALIENCE = 0.5;
export const STRENGTH_HALF_LIFE_MS = 30 * 86_400_000;

export type MemoryStrengthRow = {
  assertionKey: string;
  salience: number;
  recallCount: number;
  lastRecalledAtMs: number | null;
  useCount: number;
  lastUsedAtMs: number | null;
  formedAtMs: number;
};

function clampSalience(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : DEFAULT_SALIENCE;
}

/** First formation wins; a re-admission never resets counters. */
export function recordMemoryFormation(
  db: DatabaseSync,
  input: { assertionKey: string; salience?: unknown; nowMs: number },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO memory_strength
       (assertion_key, salience, recall_count, use_count, formed_at_ms)
     VALUES (?, ?, 0, 0, ?)`,
  ).run(input.assertionKey, clampSalience(input.salience), input.nowMs);
}

function touch(db: DatabaseSync, keys: Iterable<string>, nowMs: number, column: "recall" | "use"): void {
  const unique = [...new Set(keys)].filter((key) => key.trim());
  if (unique.length === 0) return;
  const sql = column === "recall"
    ? "UPDATE memory_strength SET recall_count = recall_count + 1, last_recalled_at_ms = ? WHERE assertion_key = ?"
    : "UPDATE memory_strength SET use_count = use_count + 1, last_used_at_ms = ? WHERE assertion_key = ?";
  const statement = db.prepare(sql);
  for (const key of unique) statement.run(nowMs, key);
}

/** The memory entered Thought's input. */
export function recordMemoryRecall(db: DatabaseSync, keys: Iterable<string>, nowMs: number): void {
  touch(db, keys, nowMs, "recall");
}

/** Thought cited the memory in its accepted settlement. */
export function recordMemoryUse(db: DatabaseSync, keys: Iterable<string>, nowMs: number): void {
  touch(db, keys, nowMs, "use");
}

export function getMemoryStrength(db: DatabaseSync, assertionKey: string): MemoryStrengthRow | null {
  const row = db.prepare("SELECT * FROM memory_strength WHERE assertion_key = ?").get(assertionKey) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

function mapRow(row: Record<string, unknown>): MemoryStrengthRow {
  const nullable = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    assertionKey: String(row.assertion_key),
    salience: Number(row.salience),
    recallCount: Number(row.recall_count),
    lastRecalledAtMs: nullable(row.last_recalled_at_ms),
    useCount: Number(row.use_count),
    lastUsedAtMs: nullable(row.last_used_at_ms),
    formedAtMs: Number(row.formed_at_ms),
  };
}

/**
 * salience x recency decay (30-day half-life since last use, or formation)
 * x reinforcement (1 + ln(1 + uses)). A memory without a strength row (formed
 * before strength existed) scores as a fresh default-salience memory.
 */
export function memoryStrengthScore(row: MemoryStrengthRow | null, nowMs: number): number {
  if (!row) return DEFAULT_SALIENCE;
  const lastTouch = Math.max(row.formedAtMs, row.lastUsedAtMs ?? row.formedAtMs);
  const age = Math.max(0, nowMs - lastTouch);
  const decay = Math.pow(0.5, age / STRENGTH_HALF_LIFE_MS);
  return row.salience * decay * (1 + Math.log(1 + row.useCount));
}

export function strengthScores(db: DatabaseSync, keys: readonly string[], nowMs: number): Map<string, number> {
  const scores = new Map<string, number>();
  const statement = db.prepare("SELECT * FROM memory_strength WHERE assertion_key = ?");
  for (const key of new Set(keys)) {
    const row = statement.get(key) as Record<string, unknown> | undefined;
    scores.set(key, memoryStrengthScore(row ? mapRow(row) : null, nowMs));
  }
  return scores;
}

// ── Core profile (§4.6.1) ────────────────────────────────────────────────

const SELF_KINDS: ReadonlySet<MemoryKind> = new Set(["learned_self_evidence", "ashley_interpretation", "open_question"]);
export const CORE_PROFILE_OWNER_LIMIT = 12;
export const CORE_PROFILE_SELF_LIMIT = 8;

export type CoreProfileEntry = Readonly<{
  key: string;
  statement: string;
  memoryKind: MemoryKind;
  source: string;
  strength: number;
  channel?: `domus:${string}`;
}>;

/** Always-present memory: what Ashley knows best about the Owner and herself. */
export type CoreProfile = Readonly<{
  owner: readonly CoreProfileEntry[];
  self: readonly CoreProfileEntry[];
}>;

function ownerPrivate(assertion: MemoryAssertion): boolean {
  return !assertion.audienceScope || assertion.audienceScope.kind === "owner_private";
}

export function buildCoreProfile(
  db: DatabaseSync,
  nowMs: number,
  limits: { owner?: number; self?: number } = {},
): CoreProfile {
  const live = listLiveMemoryAssertions(db)
    .filter((assertion) => assertion.statement !== REDACTED_MEMORY_STATEMENT && ownerPrivate(assertion));
  const scores = strengthScores(db, live.map((assertion) => assertion.assertionKey), nowMs);
  const entry = (assertion: MemoryAssertion): CoreProfileEntry => ({
    key: assertion.assertionKey,
    statement: assertion.statement,
    memoryKind: assertion.memoryKind,
    source: assertion.dimensions.source,
    strength: Math.round((scores.get(assertion.assertionKey) ?? 0) * 1000) / 1000,
    ...(assertion.channel !== "discord" ? { channel: assertion.channel } : {}),
  });
  const ranked = (items: MemoryAssertion[], limit: number) => items
    .map(entry)
    .sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key))
    .slice(0, limit);
  return Object.freeze({
    owner: ranked(live.filter((assertion) => !SELF_KINDS.has(assertion.memoryKind)), limits.owner ?? CORE_PROFILE_OWNER_LIMIT),
    self: ranked(live.filter((assertion) => SELF_KINDS.has(assertion.memoryKind)), limits.self ?? CORE_PROFILE_SELF_LIMIT),
  });
}
