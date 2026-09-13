import type { DatabaseSync } from "node:sqlite";
import type { C5Mode, C5Provenance } from "./types.js";

export const C5_SUPPORTED_CONTRACT_VERSION = 1;

export function c5ContractVersion(db: DatabaseSync): number | null {
  try {
    const row = db.prepare(
      `SELECT highest_contract_version
       FROM cognitive_maturation_contract_state WHERE wave = 'c5'`,
    ).get() as { highest_contract_version?: number } | undefined;
    return row ? Number(row.highest_contract_version ?? 0) : null;
  } catch {
    return null;
  }
}

export function assertC5ContractCompatible(db: DatabaseSync): void {
  let marker: {
    highest_contract_version?: number;
    live_authority_existed?: number;
  } | undefined;
  try {
    marker = db.prepare(
      `SELECT highest_contract_version, live_authority_existed
       FROM cognitive_maturation_contract_state WHERE wave = 'c5'`,
    ).get() as {
      highest_contract_version?: number;
      live_authority_existed?: number;
    } | undefined;
  } catch {
    throw new Error("relational_graduation_contract_state_unavailable");
  }
  const version = marker ? Number(marker.highest_contract_version ?? 0) : null;
  if (version == null) throw new Error("relational_graduation_contract_state_unavailable");
  if (version > C5_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `relational_graduation_contract_unsupported:${version}>${C5_SUPPORTED_CONTRACT_VERSION}`,
    );
  }
  if (version < C5_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(
      `relational_graduation_contract_too_old:${version}<${C5_SUPPORTED_CONTRACT_VERSION}`,
    );
  }
  if (Number(marker?.live_authority_existed ?? 0) !== 0) {
    throw new Error("relational_graduation_live_authority_unexpected");
  }
}

/** C5 dark apply is a fixture-only path. It is not persisted capability activation. */
export function relationalGraduationCanInfluence(
  db: DatabaseSync,
  mode: C5Mode,
): boolean {
  assertC5ContractCompatible(db);
  return mode === "dark_apply";
}

export const c5CanInfluence = relationalGraduationCanInfluence;

export function normalizeC5WriteMode(
  db: DatabaseSync,
  requested: C5Mode | undefined,
): C5Mode {
  assertC5ContractCompatible(db);
  const mode = requested ?? "observe";
  if (mode === "apply") {
    throw new Error("relational_graduation_live_apply_not_authorized");
  }
  return mode;
}

export function provenanceForC5Mode(mode: C5Mode): C5Provenance {
  return mode === "dark_apply" ? "live" : "shadow";
}

export function c5CapabilityState(db: DatabaseSync): C5Mode {
  try {
    const row = db.prepare(
      `SELECT state FROM cognitive_maturation_contract_state WHERE wave = 'c5'`,
    ).get() as { state?: string } | undefined;
    return row?.state === "dark_apply" || row?.state === "apply"
      ? row.state
      : "observe";
  } catch {
    return "observe";
  }
}
