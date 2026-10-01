import { restoreLegacyV53Objects } from "../cognition/__tests__/fixtures/legacy-v53.js";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import { validateNuclearSchemaContent } from "../cognition/schema-contract.js";

type PermitRow = {
  entity_uuid: string;
  owner_id: string;
  principal_id: string;
  scope: string;
  granted_at: string;
  expires_at: string | null;
  source_span_json: string;
  proposal_ref: string | null;
  version: number;
  revoked_at: string | null;
};

function readPermits(db: DatabaseSync): PermitRow[] {
  return db.prepare(
    `SELECT entity_uuid, owner_id, principal_id, scope, granted_at, expires_at,
            source_span_json, proposal_ref, version, revoked_at
       FROM social_permits ORDER BY entity_uuid`,
  ).all() as unknown as PermitRow[];
}

function userVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function delegationTableExists(db: DatabaseSync): boolean {
  return db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'social_operation_delegations'",
  ).get() !== undefined;
}

function seedPermits(db: DatabaseSync): void {
  const insert = db.prepare(
    `INSERT INTO social_permits
       (entity_uuid, owner_id, principal_id, scope, granted_at, expires_at,
        source_span_json, proposal_ref, version, revoked_at)
     VALUES (?, 'doc', ?, ?, ?, ?, ?, ?, 1, NULL)`,
  );
  insert.run(
    "permit-person-wide",
    "principal-person",
    "person_wide",
    "2026-09-20T00:00:00.000Z",
    null,
    JSON.stringify({ kind: "owner_control", route: "/relationship/permits" }),
    "proposal-person",
  );
  insert.run(
    "permit-room-only",
    "principal-room",
    "room_only",
    "2026-09-21T00:00:00.000Z",
    "2026-10-21T00:00:00.000Z",
    JSON.stringify({ kind: "owner_control", route: "/relationship/permits" }),
    null,
  );
}

function rewindToPreV53PermitOnly(nuclear: DatabaseSync, continuity: DatabaseSync): void {
  restoreLegacyV53Objects(nuclear);
  nuclear.exec("DROP TABLE IF EXISTS social_operation_delegations");
  nuclear.exec("DROP INDEX IF EXISTS idx_social_operation_delegations_live");
  nuclear.exec("DROP INDEX IF EXISTS idx_social_operation_delegations_lookup");
  nuclear.exec("PRAGMA user_version = 52");
  const rewound = continuity.prepare(
    "UPDATE lineage_state SET nuclear_schema_version = 52 WHERE id = 1",
  ).run();
  expect(Number(rewound.changes)).toBe(1);
}

describe("R-2 permit-only pre-V53 database migrates to V53 without minting operation grants", () => {
  it("leaves every existing social_permit untouched and creates zero delegation rows", () => {
    const db = new DatabaseSync(":memory:");
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    try {
      openNuclearDb(db, { continuity });
      seedPermits(db);
      const permitsBefore = readPermits(db);
      expect(permitsBefore).toHaveLength(2);

      rewindToPreV53PermitOnly(db, continuity);
      expect(userVersion(db)).toBe(52);
      expect(delegationTableExists(db)).toBe(false);
      expect(readPermits(db)).toEqual(permitsBefore);

      openNuclearDb(db, { continuity });
      expect(userVersion(db)).toBe(55);
      expect(delegationTableExists(db)).toBe(true);
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_social_operation_delegations_live'",
      ).get()).toEqual({ 1: 1 });
      expect(db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_social_operation_delegations_lookup'",
      ).get()).toEqual({ 1: 1 });

      expect(readPermits(db)).toEqual(permitsBefore);
      expect(db.prepare("SELECT COUNT(*) AS count FROM social_operation_delegations").get()).toEqual({ count: 0 });

      const permitsMatchingADelegation = db.prepare(
        `SELECT p.entity_uuid FROM social_permits p
          WHERE EXISTS (SELECT 1 FROM social_operation_delegations d WHERE d.principal_id = p.principal_id)`,
      ).all();
      expect(permitsMatchingADelegation).toEqual([]);

      expect(() => validateNuclearSchemaContent(db, 55)).not.toThrow();
    } finally {
      db.close();
      continuity.close();
    }
  });

  it("keeps a live permit as contact authority and mints no live operation grant", () => {
    const db = new DatabaseSync(":memory:");
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    try {
      openNuclearDb(db, { continuity });
      seedPermits(db);
      rewindToPreV53PermitOnly(db, continuity);
      openNuclearDb(db, { continuity });

      expect(db.prepare(
        "SELECT principal_id, scope FROM social_permits WHERE revoked_at IS NULL ORDER BY entity_uuid",
      ).all()).toEqual([
        { principal_id: "principal-person", scope: "person_wide" },
        { principal_id: "principal-room", scope: "room_only" },
      ]);
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM social_operation_delegations WHERE revoked_at IS NULL",
      ).get()).toEqual({ count: 0 });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM social_operation_delegations",
      ).get()).toEqual({ count: 0 });
    } finally {
      db.close();
      continuity.close();
    }
  });
});
