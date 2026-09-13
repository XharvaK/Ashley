#!/usr/bin/env node

import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

export const SIDECAR_META_EXPECTED = Object.freeze({
  schemaVersion: 8,
  architectureEpoch: "v0.2.1",
  thoughtContractVersion: 2,
});

export const SIDECAR_META_TRANSITIONS = Object.freeze({
  forward: Object.freeze({ from: "0.2.1.r5", to: "0.2.1.r6" }),
  rollback: Object.freeze({ from: "0.2.1.r6", to: "0.2.1.r5" }),
});

function readMeta(db) {
  return db.prepare(
    `SELECT id, schema_version, architecture_epoch,
            implementation_spec_version, thought_contract_version
       FROM cognitive_sidecar_meta
      WHERE id = 1`,
  ).get();
}

function assertExpectedMeta(row, expectedImplementationSpecVersion) {
  if (
    !row ||
    Number(row.id) !== 1 ||
    Number(row.schema_version) !== SIDECAR_META_EXPECTED.schemaVersion ||
    row.architecture_epoch !== SIDECAR_META_EXPECTED.architectureEpoch ||
    row.implementation_spec_version !== expectedImplementationSpecVersion ||
    Number(row.thought_contract_version) !== SIDECAR_META_EXPECTED.thoughtContractVersion
  ) {
    throw new Error("sidecar_meta_identity_mismatch");
  }
}

/**
 * Execute the bounded deployment-only implementation-spec transition.
 *
 * This is deliberately not called by application startup. It verifies the
 * complete singleton identity, changes only implementation_spec_version, and
 * fails closed unless exactly one row changes and the read-back matches.
 */
export function transitionSidecarImplementationVersion(db, direction) {
  const transition = SIDECAR_META_TRANSITIONS[direction];
  if (!transition) throw new Error("sidecar_meta_transition_direction_invalid");

  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;

    assertExpectedMeta(readMeta(db), transition.from);
    const result = db.prepare(
      `UPDATE cognitive_sidecar_meta
          SET implementation_spec_version = ?
        WHERE id = 1 AND implementation_spec_version = ?`,
    ).run(transition.to, transition.from);
    const changedRows = Number(result.changes);
    if (changedRows !== 1) {
      throw new Error(`sidecar_meta_transition_changes:${changedRows}`);
    }

    const after = readMeta(db);
    if (!after || after.implementation_spec_version !== transition.to) {
      throw new Error("sidecar_meta_transition_readback_mismatch");
    }

    db.exec("COMMIT");
    transactionStarted = false;
    return {
      direction,
      from: transition.from,
      to: transition.to,
      changedRows,
      schemaVersion: SIDECAR_META_EXPECTED.schemaVersion,
      architectureEpoch: SIDECAR_META_EXPECTED.architectureEpoch,
      thoughtContractVersion: SIDECAR_META_EXPECTED.thoughtContractVersion,
    };
  } catch (error) {
    if (transactionStarted) {
      try { db.exec("ROLLBACK"); } catch { /* preserve the transition failure */ }
    }
    throw error;
  }
}

function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--direction" || argv[2] !== "--db") {
    throw new Error("usage: node scripts/stabilization/sidecar-meta-transition.mjs --direction <forward|rollback> --db <path>");
  }
  return { direction: argv[1], databasePath: argv[3] };
}

function isMain() {
  return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMain()) {
  let db;
  try {
    const { direction, databasePath } = parseArguments(process.argv.slice(2));
    db = new DatabaseSync(databasePath);
    const result = transitionSidecarImplementationVersion(db, direction);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`sidecar meta transition failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    try { db?.close(); } catch { /* preserve the original result */ }
  }
}
