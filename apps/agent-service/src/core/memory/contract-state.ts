import type { DatabaseSync } from "node:sqlite";

export type MemoryContractState = {
  c1ContractVersion: number;
  currentnessAuthority: "mem_facts" | "memory_assertions";
  cutoverAt: string | null;
  appliedC1AuthorityExists: boolean;
  correctionSeq: number;
};

type Row = Record<string, unknown>;

function asRow(value: unknown): Row | null {
  return typeof value === "object" && value !== null ? value as Row : null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

export function getMemoryContractState(
  db: DatabaseSync,
): MemoryContractState | null {
  if (!tableExists(db, "memory_contract_state")) return null;
  const source = asRow(db.prepare(
    `SELECT c1_contract_version, currentness_authority, cutover_at,
            applied_c1_authority_exists, correction_seq
     FROM memory_contract_state WHERE id = 1`,
  ).get());
  if (!source) return null;
  if (
    source.currentness_authority !== "mem_facts" &&
    source.currentness_authority !== "memory_assertions"
  ) return null;
  return {
    c1ContractVersion: numberValue(source.c1_contract_version),
    currentnessAuthority: source.currentness_authority,
    cutoverAt: typeof source.cutover_at === "string" ? source.cutover_at : null,
    appliedC1AuthorityExists: numberValue(source.applied_c1_authority_exists) === 1,
    correctionSeq: numberValue(source.correction_seq),
  };
}

export function requireMemoryContractState(
  db: DatabaseSync,
): MemoryContractState {
  const state = getMemoryContractState(db);
  if (!state) throw new Error("memory_contract_state_unavailable");
  return state;
}

export function isMemoryAssertionsCurrentnessAuthority(
  db: DatabaseSync,
): boolean {
  return getMemoryContractState(db)?.currentnessAuthority === "memory_assertions";
}

/** Increment the C1 high-water number inside the caller's transaction. */
export function incrementCorrectionSequence(db: DatabaseSync): number {
  const result = db.prepare(
    `UPDATE memory_contract_state
     SET correction_seq = correction_seq + 1 WHERE id = 1`,
  ).run();
  if (Number(result.changes) !== 1) {
    throw new Error("memory_contract_state_unavailable");
  }
  return requireMemoryContractState(db).correctionSeq;
}
