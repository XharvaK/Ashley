import type { DatabaseSync } from "node:sqlite";
import type { LearnedAutonomyMode } from "./types.js";

export const C3_SUPPORTED_CONTRACT_VERSION = 1;

export function c3ContractVersion(db: DatabaseSync): number | null {
  try {
    const row = db.prepare(
      `SELECT highest_contract_version
       FROM cognitive_maturation_contract_state WHERE wave = 'c3'`,
    ).get() as { highest_contract_version?: number } | undefined;
    return row ? Number(row.highest_contract_version ?? 0) : null;
  } catch {
    return null;
  }
}

export function assertC3ContractCompatible(db: DatabaseSync): void {
  const version = c3ContractVersion(db);
  if (version == null) throw new Error("learned_autonomy_contract_state_unavailable");
  if (version > C3_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `learned_autonomy_contract_unsupported:${version}>${C3_SUPPORTED_CONTRACT_VERSION}`,
    );
  }
  if (version < C3_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `learned_autonomy_contract_too_old:${version}<${C3_SUPPORTED_CONTRACT_VERSION}`,
    );
  }
}

/**
 * The first C3 slice is fixture-only dark apply. It is deliberately separate
 * from capability promotion and from the master cognition mode.
 */
export function learnedAutonomyCanInfluence(
  db: DatabaseSync,
  mode: LearnedAutonomyMode,
): boolean {
  assertC3ContractCompatible(db);
  return mode === "dark_apply";
}
