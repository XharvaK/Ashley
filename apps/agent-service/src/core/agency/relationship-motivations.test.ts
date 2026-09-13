import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import { recordWithdrawal } from "../relationship/authority.js";
import { decide } from "./decide.js";
import { collectMotivations } from "./motivations.js";

const OWNER_ID = "doc";

function activateRelationshipCapabilities(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at,
        contract_id, build_identity, model_epoch)
     VALUES (?, ?, 'active', ?, ?, ?, ?, 0)
     ON CONFLICT(capability, release_id) DO UPDATE SET
       state = 'active', promoted_at = excluded.promoted_at,
       updated_at = excluded.updated_at, contract_id = excluded.contract_id,
       build_identity = excluded.build_identity, model_epoch = excluded.model_epoch`,
  );
  for (const capability of [
    "recall",
    "mind_state",
    "thought",
    "relational_initiative",
    "relationship_state",
  ]) {
    insert.run(
      capability,
      currentContractId(),
      now,
      now,
      currentContractId(),
      currentBuildIdentity(),
    );
  }
}

function seedRelationshipSources(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ashley_self_commitments
       (owner_id, entity_uuid, data_classification, text, status, due_at,
        source_entity_type, source_entity_uuid, evidence_json, text_hash,
        created_at, updated_at)
     VALUES (?, 'self-1', 'ordinary', 'finish the continuity audit', 'active',
             NULL, 'manual', 'source-self-1', NULL, 'hash-self-1', ?, ?)`,
  ).run(OWNER_ID, now, now);
  db.prepare(
    `INSERT INTO mutual_commitments
       (owner_id, entity_uuid, data_classification, text, status,
        doc_confirmed_at, ashley_confirmed_at, doc_evidence_entity_uuid,
        ashley_delivery_entity_uuid, source_entity_type, source_entity_uuid,
        evidence_json, text_hash, created_at, updated_at)
     VALUES (?, 'mutual-1', 'ordinary', 'listen back to the mix together',
             'active', NULL, NULL, NULL, NULL, 'manual', 'source-mutual-1',
             NULL, 'hash-mutual-1', ?, ?)`,
  ).run(OWNER_ID, now, now);
  db.prepare(
    `INSERT INTO relational_tensions
       (owner_id, entity_uuid, data_classification, text, status, repair_status,
        linked_withdrawal_entity_uuid, last_repair_decision_id,
        source_entity_type, source_entity_uuid, evidence_json, text_hash,
        created_at, updated_at)
     VALUES (?, 'tension-1', 'ordinary', 'unfinished pacing disagreement',
             'open', 'open', NULL, NULL, 'manual', 'source-tension-1',
             NULL, 'hash-tension-1', ?, ?)`,
  ).run(OWNER_ID, now, now);
}

function hasRef(
  motivations: ReturnType<typeof collectMotivations>,
  refType: string,
  refId: string,
): boolean {
  return motivations.some(
    (motivation) =>
      motivation.refType === refType && String(motivation.refId) === refId,
  );
}

describe("relationship motivation projections", () => {
  it("projects active relationship sources and drops completed sources", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      activateRelationshipCapabilities(db);
      seedRelationshipSources(db);

      const initial = collectMotivations(db, OWNER_ID, "proactive");
      expect(hasRef(initial, "ashley_self_commitment", "self-1")).toBe(true);
      expect(hasRef(initial, "mutual_commitment", "mutual-1")).toBe(true);
      expect(hasRef(initial, "relational_tension", "tension-1")).toBe(true);
      expect(
        initial.filter((motivation) => motivation.refType === "relational_tension"),
      ).toHaveLength(1);
      const decision = decide(initial, "proactive", {
        db,
        ownerId: OWNER_ID,
      });
      expect(decision.evidenceRefs).toContainEqual({
        type: "ashley_self_commitment",
        id: "self-1",
      });

      db.prepare(
        "UPDATE ashley_self_commitments SET status = 'fulfilled' WHERE entity_uuid = 'self-1'",
      ).run();
      db.prepare(
        "UPDATE mutual_commitments SET status = 'released' WHERE entity_uuid = 'mutual-1'",
      ).run();
      db.prepare(
        "UPDATE relational_tensions SET status = 'resolved' WHERE entity_uuid = 'tension-1'",
      ).run();

      const completed = collectMotivations(db, OWNER_ID, "proactive");
      expect(hasRef(completed, "ashley_self_commitment", "self-1")).toBe(false);
      expect(hasRef(completed, "mutual_commitment", "mutual-1")).toBe(false);
      expect(hasRef(completed, "relational_tension", "tension-1")).toBe(false);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("treats withdrawal as a gate and permits tension only after explicit repair eligibility",
    () => {
      const db = openNuclearDb(new DatabaseSync(":memory:"));
      const originalMode = env.cognitionMode;
      try {
        env.cognitionMode = "apply";
        activateRelationshipCapabilities(db);
        seedRelationshipSources(db);
        const withdrawalUuid = recordWithdrawal(db, {
          ownerId: OWNER_ID,
          initiator: "doc",
          scope: "relationship_pause",
          reason: "need space before repair",
          sourceEntityType: "manual",
          sourceEntityUuid: "source-withdrawal-1",
        });

        const blocked = collectMotivations(db, OWNER_ID, "proactive");
        expect(hasRef(blocked, "relational_tension", "tension-1")).toBe(false);
        expect(
          blocked.some((motivation) => motivation.refType === "withdrawal"),
        ).toBe(false);

        db.prepare(
          "UPDATE withdrawal_records SET repair_status = 'eligible' WHERE entity_uuid = ?",
        ).run(withdrawalUuid);
        const eligible = collectMotivations(db, OWNER_ID, "proactive");
        expect(hasRef(eligible, "relational_tension", "tension-1")).toBe(true);
      } finally {
        env.cognitionMode = originalMode;
        db.close();
      }
    });

  it("does not project relationship sources in observe mode or mutate them",
    () => {
      const db = openNuclearDb(new DatabaseSync(":memory:"));
      const originalMode = env.cognitionMode;
      try {
        env.cognitionMode = "observe";
        seedRelationshipSources(db);
        const before = db
          .prepare(
            "SELECT entity_uuid, status, repair_status FROM relational_tensions",
          )
          .all();
        const motivations = collectMotivations(db, OWNER_ID, "proactive");
        expect(
          motivations.some((motivation) =>
            [
              "ashley_self_commitment",
              "mutual_commitment",
              "relational_tension",
            ].includes(String(motivation.refType)),
          ),
        ).toBe(false);
        const after = db
          .prepare(
            "SELECT entity_uuid, status, repair_status FROM relational_tensions",
          )
          .all();
        expect(after).toEqual(before);
      } finally {
        env.cognitionMode = originalMode;
        db.close();
      }
    });
});
