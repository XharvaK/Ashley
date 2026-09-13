import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  SIDECAR_META_EXPECTED,
  transitionSidecarImplementationVersion,
} from "./sidecar-meta-transition.mjs";

function openMeta(spec = "0.2.1.r5", overrides = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cognitive_sidecar_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      architecture_epoch TEXT NOT NULL,
      implementation_spec_version TEXT NOT NULL,
      thought_contract_version INTEGER NOT NULL,
      authority_epoch INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.prepare(
    `INSERT INTO cognitive_sidecar_meta
       (id, schema_version, architecture_epoch, implementation_spec_version,
        thought_contract_version, authority_epoch)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(
    overrides.schemaVersion ?? SIDECAR_META_EXPECTED.schemaVersion,
    overrides.architectureEpoch ?? SIDECAR_META_EXPECTED.architectureEpoch,
    spec,
    overrides.thoughtContractVersion ?? SIDECAR_META_EXPECTED.thoughtContractVersion,
    overrides.authorityEpoch ?? 7,
  );
  return db;
}

function snapshot(db) {
  return db.prepare("SELECT * FROM cognitive_sidecar_meta WHERE id = 1").get();
}

test("SW-5 performs the exact r5 to r6 transition and changes one column", () => {
  const db = openMeta("0.2.1.r5");
  try {
    const before = snapshot(db);
    const result = transitionSidecarImplementationVersion(db, "forward");
    const after = snapshot(db);
    assert.deepEqual(result, {
      direction: "forward",
      from: "0.2.1.r5",
      to: "0.2.1.r6",
      changedRows: 1,
      schemaVersion: 8,
      architectureEpoch: "v0.2.1",
      thoughtContractVersion: 2,
    });
    assert.equal(after.implementation_spec_version, "0.2.1.r6");
    assert.equal(after.authority_epoch, before.authority_epoch);
    assert.equal(after.schema_version, before.schema_version);
    assert.equal(after.architecture_epoch, before.architecture_epoch);
    assert.equal(after.thought_contract_version, before.thought_contract_version);
  } finally {
    db.close();
  }
});

test("SW-6 performs the exact r6 to r5 rollback transition", () => {
  const db = openMeta("0.2.1.r6");
  try {
    const result = transitionSidecarImplementationVersion(db, "rollback");
    assert.equal(result.from, "0.2.1.r6");
    assert.equal(result.to, "0.2.1.r5");
    assert.equal(result.changedRows, 1);
    assert.equal(snapshot(db).implementation_spec_version, "0.2.1.r5");
  } finally {
    db.close();
  }
});

test("SW-5 fails closed on any unexpected singleton identity", () => {
  const db = openMeta("0.2.1.r5", { schemaVersion: 7 });
  try {
    const before = snapshot(db);
    assert.throws(
      () => transitionSidecarImplementationVersion(db, "forward"),
      /sidecar_meta_identity_mismatch/,
    );
    assert.deepEqual(snapshot(db), before);
  } finally {
    db.close();
  }
});

test("SW-5 rolls back when the conditional update does not change exactly one row", () => {
  const db = openMeta("0.2.1.r5");
  try {
    db.exec(`
      CREATE TRIGGER skip_meta_update
      BEFORE UPDATE OF implementation_spec_version ON cognitive_sidecar_meta
      BEGIN SELECT RAISE(IGNORE); END;
    `);
    assert.throws(
      () => transitionSidecarImplementationVersion(db, "forward"),
      /sidecar_meta_transition_changes:0/,
    );
    assert.equal(snapshot(db).implementation_spec_version, "0.2.1.r5");
  } finally {
    db.close();
  }
});

test("SW-6 rolls back when read-back differs from the requested version", () => {
  const db = openMeta("0.2.1.r6");
  try {
    db.exec(`
      CREATE TRIGGER tamper_meta_readback
      AFTER UPDATE OF implementation_spec_version ON cognitive_sidecar_meta
      BEGIN
        UPDATE cognitive_sidecar_meta SET implementation_spec_version = 'tampered' WHERE id = 1;
      END;
    `);
    assert.throws(
      () => transitionSidecarImplementationVersion(db, "rollback"),
      /sidecar_meta_transition_readback_mismatch/,
    );
    assert.equal(snapshot(db).implementation_spec_version, "0.2.1.r6");
  } finally {
    db.close();
  }
});
