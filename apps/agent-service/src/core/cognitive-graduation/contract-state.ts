import type { DatabaseSync } from "node:sqlite";
import type { C4Mode, C4Provenance } from "./types.js";

export const C4_SUPPORTED_CONTRACT_VERSION = 1;

export function c4ContractVersion(db: DatabaseSync): number | null {
  try {
    const row = db.prepare(
      `SELECT highest_contract_version
       FROM cognitive_maturation_contract_state WHERE wave = 'c4'`,
    ).get() as { highest_contract_version?: number } | undefined;
    return row ? Number(row.highest_contract_version ?? 0) : null;
  } catch {
    return null;
  }
}

export function assertC4ContractCompatible(db: DatabaseSync): void {
  const version = c4ContractVersion(db);
  if (version == null) throw new Error("cognitive_graduation_contract_state_unavailable");
  if (version > C4_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `cognitive_graduation_contract_unsupported:${version}>${C4_SUPPORTED_CONTRACT_VERSION}`,
    );
  }
  if (version < C4_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `cognitive_graduation_contract_too_old:${version}<${C4_SUPPORTED_CONTRACT_VERSION}`,
    );
  }
}

/** C4 dark apply is a fixture-only path. It is not the persisted capability state. */
export function cognitiveGraduationCanInfluence(
  db: DatabaseSync,
  mode: C4Mode,
): boolean {
  assertC4ContractCompatible(db);
  return mode === "dark_apply";
}

export function normalizeC4WriteMode(db: DatabaseSync, requested: C4Mode | undefined): C4Mode {
  assertC4ContractCompatible(db);
  const mode = requested ?? "observe";
  if (mode === "apply") {
    throw new Error("cognitive_graduation_live_apply_not_authorized");
  }
  return mode;
}

export function provenanceForC4Mode(mode: C4Mode): C4Provenance {
  return mode === "dark_apply" ? "live" : "shadow";
}

export function c4CapabilityState(db: DatabaseSync): C4Mode {
  try {
    const row = db.prepare(
      `SELECT state FROM cognitive_maturation_contract_state WHERE wave = 'c4'`,
    ).get() as { state?: string } | undefined;
    return row?.state === "dark_apply" || row?.state === "apply"
      ? row.state
      : "observe";
  } catch {
    return "observe";
  }
}
