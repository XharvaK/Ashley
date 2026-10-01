// Influence contract state bounds compatibility; a mode is not effect authority.
import type { DatabaseSync } from "node:sqlite";

export const INFLUENCE_SUPPORTED_CONTRACT_VERSION = 1;
export type InfluenceMode = "observe" | "dark_apply" | "apply";

export function assertInfluenceContractCompatible(db: DatabaseSync): void {
  let version: number | null;
  try {
    const row = db.prepare("SELECT highest_contract_version FROM influence_contract_state WHERE id=1").get();
    version = row ? Number(row.highest_contract_version) : null;
  } catch { version = null; }
  if (version === null) throw new Error("learned_autonomy_contract_state_unavailable");
  if (version > INFLUENCE_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(`learned_autonomy_contract_unsupported:${version}>${INFLUENCE_SUPPORTED_CONTRACT_VERSION}`);
  }
  if (version !== INFLUENCE_SUPPORTED_CONTRACT_VERSION) {
    throw new Error(`learned_autonomy_contract_too_old:${version}<${INFLUENCE_SUPPORTED_CONTRACT_VERSION}`);
  }
}

export function influenceMode(db: DatabaseSync): InfluenceMode {
  assertInfluenceContractCompatible(db);
  const value = db.prepare("SELECT state FROM influence_contract_state WHERE id=1").get()?.state;
  if (value !== "observe" && value !== "dark_apply" && value !== "apply") {
    throw new Error("learned_autonomy_contract_mode_invalid");
  }
  return value;
}

/** Caller supplies authenticated Owner authority; selecting a mode does not adjudicate a proposal. */
export function setInfluenceMode(db: DatabaseSync, selected: InfluenceMode, ownerId: string, nowMs: number): void {
  assertInfluenceContractCompatible(db);
  if (!["observe", "dark_apply", "apply"].includes(selected) || !ownerId.trim() || !Number.isFinite(nowMs)) {
    throw new Error("learned_autonomy_contract_mode_invalid");
  }
  db.prepare(`UPDATE influence_contract_state SET state=?,mode_set_by=?,mode_set_at_ms=?,
    live_authority_existed=CASE WHEN ?='apply' THEN 1 ELSE live_authority_existed END WHERE id=1`)
    .run(selected, ownerId, nowMs, selected);
}
