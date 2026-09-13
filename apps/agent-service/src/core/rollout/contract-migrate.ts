import type { DatabaseSync } from "node:sqlite";
import {
  DECLARED_CONTRACT_ID,
  DECLARED_CONTRACT_VERSION,
  LEGACY_CONTRACT_ID,
  LEGACY_V2_CONTRACT_ID,
  LEGACY_V2_CONTRACT_VERSION,
  V3_ONLY_CAPABILITY_NAMES,
  declaredContractHash,
  legacyContractHash,
  v2ContractHash,
} from "../attention/contract-material.js";
import { currentBuildIdentity } from "./capabilities.js";

type ReleaseRow = {
  capability: string;
  release_id: string;
  state: string;
  eval_seed_count: number;
  qualified_at: string | null;
  promoted_at: string | null;
  rolled_back_at: string | null;
  failure_kind: string | null;
  failure_reason: string | null;
  updated_at: string;
  contract_id: string | null;
  build_identity: string | null;
  model_epoch: number;
};

/**
 * Activate capability contract v2 globally. Preserves v1 release rows and events;
 * copies capability state onto v2 release_id rows without relabeling v1 evidence.
 */
export function migrateCapabilityContractV1ToV2(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const v2Hash = v2ContractHash();
  const v1Hash = legacyContractHash();
  const build = currentBuildIdentity();

  db.prepare(
    `INSERT OR IGNORE INTO capability_contracts
       (contract_id, version, spec_hash, created_at, active)
     VALUES (?, ?, ?, ?, 0)`,
  ).run(LEGACY_CONTRACT_ID, "1", v1Hash, now);

  const active = db
    .prepare(
      `SELECT contract_id FROM capability_contracts WHERE active = 1 LIMIT 1`,
    )
    .get() as { contract_id?: string } | undefined;
  if (
    active?.contract_id === LEGACY_V2_CONTRACT_ID ||
    active?.contract_id === DECLARED_CONTRACT_ID
  ) {
    return;
  }

  db.prepare(
    `UPDATE capability_contracts SET active = 0 WHERE active = 1`,
  ).run();
  db.prepare(
    `INSERT INTO capability_contracts
       (contract_id, version, spec_hash, created_at, active)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(LEGACY_V2_CONTRACT_ID, LEGACY_V2_CONTRACT_VERSION, v2Hash, now);

  const releases = db
    .prepare(
      `SELECT capability, release_id, state, eval_seed_count, qualified_at,
              promoted_at, rolled_back_at, failure_kind, failure_reason,
              updated_at, contract_id, build_identity, model_epoch
       FROM capability_releases`,
    )
    .all() as ReleaseRow[];

  const v1ReleaseIds = new Set<string>([LEGACY_CONTRACT_ID]);
  for (const row of releases) {
    if (row.contract_id === LEGACY_CONTRACT_ID) {
      v1ReleaseIds.add(row.release_id);
    }
  }

  for (const row of releases) {
    if (row.capability === "relationship_state") continue;
    if (
      !v1ReleaseIds.has(row.release_id) &&
      row.release_id !== LEGACY_V2_CONTRACT_ID
    ) {
      continue;
    }
    db.prepare(
      `INSERT INTO capability_releases
         (capability, release_id, state, eval_seed_count, qualified_at,
          promoted_at, rolled_back_at, failure_kind, failure_reason,
          updated_at, contract_id, build_identity, model_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(capability, release_id) DO UPDATE SET
         state = excluded.state,
         eval_seed_count = excluded.eval_seed_count,
         qualified_at = excluded.qualified_at,
         promoted_at = excluded.promoted_at,
         rolled_back_at = excluded.rolled_back_at,
         failure_kind = excluded.failure_kind,
         failure_reason = excluded.failure_reason,
         updated_at = excluded.updated_at,
         contract_id = excluded.contract_id,
         build_identity = excluded.build_identity,
         model_epoch = excluded.model_epoch`,
    ).run(
      row.capability,
      LEGACY_V2_CONTRACT_ID,
      row.state,
      row.eval_seed_count,
      row.qualified_at,
      row.promoted_at,
      row.rolled_back_at,
      row.failure_kind,
      row.failure_reason,
      now,
      LEGACY_V2_CONTRACT_ID,
      row.build_identity ?? build,
      row.model_epoch ?? 0,
    );
  }

  db.prepare(
    `INSERT OR IGNORE INTO capability_releases
       (capability, release_id, state, eval_seed_count, qualified_at,
        promoted_at, rolled_back_at, failure_kind, failure_reason,
        updated_at, contract_id, build_identity, model_epoch)
     VALUES ('relationship_state', ?, 'observe', 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 0)`,
  ).run(LEGACY_V2_CONTRACT_ID, now, LEGACY_V2_CONTRACT_ID, build);
}

/**
 * Activate capability contract v3 globally. Preserves v2 release rows and events;
 * copies capability state onto new v3 release_id rows without mutating v2 evidence.
 */
export function migrateCapabilityContractV2ToV3(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const v3Hash = declaredContractHash();
  const v2Hash = v2ContractHash();
  const build = currentBuildIdentity();

  db.prepare(
    `INSERT OR IGNORE INTO capability_contracts
       (contract_id, version, spec_hash, created_at, active)
     VALUES (?, ?, ?, ?, 0)`,
  ).run(LEGACY_V2_CONTRACT_ID, LEGACY_V2_CONTRACT_VERSION, v2Hash, now);

  const active = db
    .prepare(
      `SELECT contract_id, spec_hash FROM capability_contracts WHERE active = 1 LIMIT 1`,
    )
    .get() as { contract_id?: string; spec_hash?: string } | undefined;
  if (
    active?.contract_id === DECLARED_CONTRACT_ID &&
    active.spec_hash === v3Hash
  ) {
    return;
  }

  db.prepare(
    `UPDATE capability_contracts SET active = 0 WHERE active = 1`,
  ).run();
  db.prepare(
    `INSERT INTO capability_contracts
       (contract_id, version, spec_hash, created_at, active)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(DECLARED_CONTRACT_ID, DECLARED_CONTRACT_VERSION, v3Hash, now);

  const v2Releases = db
    .prepare(
      `SELECT capability, release_id, state, eval_seed_count, qualified_at,
              promoted_at, rolled_back_at, failure_kind, failure_reason,
              updated_at, contract_id, build_identity, model_epoch
       FROM capability_releases
       WHERE contract_id = ? OR release_id = ?`,
    )
    .all(LEGACY_V2_CONTRACT_ID, LEGACY_V2_CONTRACT_ID) as ReleaseRow[];

  for (const row of v2Releases) {
    db.prepare(
      `INSERT OR IGNORE INTO capability_releases
         (capability, release_id, state, eval_seed_count, qualified_at,
          promoted_at, rolled_back_at, failure_kind, failure_reason,
          updated_at, contract_id, build_identity, model_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.capability,
      DECLARED_CONTRACT_ID,
      row.state,
      row.eval_seed_count,
      row.qualified_at,
      row.promoted_at,
      row.rolled_back_at,
      row.failure_kind,
      row.failure_reason,
      now,
      DECLARED_CONTRACT_ID,
      row.build_identity ?? build,
      row.model_epoch ?? 0,
    );
  }

  for (const capability of V3_ONLY_CAPABILITY_NAMES) {
    db.prepare(
      `INSERT OR IGNORE INTO capability_releases
         (capability, release_id, state, eval_seed_count, qualified_at,
          promoted_at, rolled_back_at, failure_kind, failure_reason,
          updated_at, contract_id, build_identity, model_epoch)
       VALUES (?, ?, 'observe', 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 0)`,
    ).run(capability, DECLARED_CONTRACT_ID, now, DECLARED_CONTRACT_ID, build);
  }
}
