import type { DatabaseSync } from "node:sqlite";

export const C2_SUPPORTED_CONTRACT_VERSION = 1;

export function c2ContractVersion(db: DatabaseSync): number | null {
  try {
    const row = db.prepare(
      `SELECT highest_contract_version FROM cognitive_maturation_contract_state
       WHERE wave = 'c2'`,
    ).get() as { highest_contract_version?: number } | undefined;
    return row ? Number(row.highest_contract_version ?? 0) : null;
  } catch {
    return null;
  }
}

export function assertC2ContractCompatible(db: DatabaseSync): void {
  const version = c2ContractVersion(db);
  if (version == null) throw new Error("c2_contract_state_unavailable");
  if (version > C2_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `c2_contract_version_unsupported:${version}>${C2_SUPPORTED_CONTRACT_VERSION}`,
    );
  }
  if (version < C2_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `c2_contract_version_too_old:${version}<${C2_SUPPORTED_CONTRACT_VERSION}`,
    );
  }
}

export function contextBudgetCanInfluence(
  db: DatabaseSync,
  mode: "observe" | "dark_apply" | "apply",
): boolean {
  assertC2ContractCompatible(db);
  return mode === "dark_apply";
}
