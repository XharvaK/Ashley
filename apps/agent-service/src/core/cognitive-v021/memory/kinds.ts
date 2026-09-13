import type { MemoryKind } from "../types.js";

/**
 * Single canonical MemoryKind authority for v0.2.1.
 *
 * This leaf module owns the 11-member value set and predicate used by:
 * - Thought output-contract schema construction (model guidance);
 * - Thought structural parser validation (authoritative defense);
 * - durable nomination / assertion fences (final defense in depth).
 *
 * It imports only the MemoryKind type so Thought, memory, and retrieval
 * layers can share it without creating import cycles. Do not duplicate the
 * 11-member set elsewhere. Do not add host semantic aliasing here: invalid
 * kinds are rejected, never mapped.
 */
export const MEMORY_KINDS: readonly MemoryKind[] = [
  "owner_preference",
  "owner_self_description",
  "owner_goal",
  "owner_world_claim",
  "project_knowledge",
  "commitment",
  "relational_boundary",
  "shared_episode",
  "open_question",
  "ashley_interpretation",
  "learned_self_evidence",
] as const;

const MEMORY_KIND_SET: ReadonlySet<string> = new Set<string>(MEMORY_KINDS);

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === "string" && MEMORY_KIND_SET.has(value);
}
